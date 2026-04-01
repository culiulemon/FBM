import type { EmbeddingAdapter } from '../types/adapter.js'
import type { VectorEntry, EmbeddingRef, SimilarityResult, VectorStore, VectorMeta, VectorMetaStore } from '../types/vector.js'
import { readFile, writeFile, readFileBinary, writeFileBinary, unlink } from './fs-adapter.js'

function entryId(ref: EmbeddingRef): string {
  if (ref.sectionId) return `${ref.filePath}:${ref.sectionId}`
  return `${ref.filePath}:${ref.headingPath.join('/')}`
}

function contentHash(content: string): string {
  let h = 0
  for (let i = 0; i < content.length; i++) {
    h = ((h << 5) - h + content.charCodeAt(i)) | 0
  }
  return (h >>> 0).toString(36)
}

function metaPath(cacheFile: string): string {
  return cacheFile.replace(/\.vector-cache\.json$/, '.vector-meta.json')
}

function binPath(cacheFile: string): string {
  return cacheFile.replace(/\.vector-cache\.json$/, '.vector-cache.bin')
}

function legacyPath(cacheFile: string): string {
  return cacheFile
}

export class VectorIndex {
  private store: VectorStore
  private metaEntries: Map<string, VectorMeta>
  private embedding: EmbeddingAdapter | null
  private cacheFile: string | undefined
  private batchSize: number

  constructor(embedding?: EmbeddingAdapter, cacheFile?: string, batchSize?: number) {
    this.embedding = embedding ?? null
    this.cacheFile = cacheFile
    this.batchSize = batchSize ?? 20
    this.store = {
      entries: new Map(),
      dimension: 0,
      lastUpdated: 0,
    }
    this.metaEntries = new Map()
  }

  get enabled(): boolean {
    return this.embedding !== null
  }

  async load(): Promise<void> {
    if (!this.cacheFile) return
    const mp = metaPath(this.cacheFile)
    const bp = binPath(this.cacheFile)
    const lp = legacyPath(this.cacheFile)

    try {
      const metaContent = await readFile(mp, 'utf-8')
      const metaStore: VectorMetaStore = JSON.parse(metaContent)
      const binData = await readFileBinary(bp)

      this.store.dimension = metaStore.dimension
      this.store.lastUpdated = metaStore.lastUpdated
      this.store.entries = new Map()
      this.metaEntries = new Map()

      const dim = metaStore.dimension
      const bytesPerVector = dim * 4

      for (const meta of metaStore.entries) {
        const offset = meta.offset * bytesPerVector
        const vector = new Float32Array(binData.buffer, binData.byteOffset + offset, dim)
        const entry: VectorEntry = {
          id: meta.id,
          vector: new Float32Array(vector),
          ref: meta.ref,
          createdAt: meta.createdAt,
        }
        this.store.entries.set(meta.id, entry)
        this.metaEntries.set(meta.id, meta)
      }

      try { await unlink(lp) } catch {}
    } catch {
      await this.migrateFromLegacy(lp, mp, bp)
    }
  }

  private async migrateFromLegacy(lp: string, mp: string, bp: string): Promise<void> {
    let legacyContent: string
    try {
      legacyContent = await readFile(lp, 'utf-8')
    } catch {
      return
    }

    try {
      const legacy = JSON.parse(legacyContent)
      const dimension: number = legacy.dimension ?? 0
      if (dimension === 0 || !legacy.entries) return

      const entries = Object.values(legacy.entries) as Array<{
        id: string
        vector: number[]
        ref: EmbeddingRef
        content: string
        createdAt: number
      }>

      const metas: VectorMeta[] = []
      const totalBytes = entries.length * dimension * 4
      const buffer = new ArrayBuffer(totalBytes)
      const flat = new Float32Array(buffer)

      for (let i = 0; i < entries.length; i++) {
        const e = entries[i]
        const vec = new Float32Array(dimension)
        for (let j = 0; j < dimension && j < e.vector.length; j++) {
          vec[j] = e.vector[j]
        }
        flat.set(vec, i * dimension)

        metas.push({
          id: e.id,
          ref: e.ref,
          createdAt: e.createdAt,
          offset: i,
          contentHash: contentHash(e.content ?? ''),
        })
      }

      const metaStore: VectorMetaStore = {
        dimension,
        lastUpdated: legacy.lastUpdated ?? 0,
        entries: metas,
      }

      await writeFile(mp, JSON.stringify(metaStore), 'utf-8')
      await writeFileBinary(bp, new Uint8Array(buffer))
      try { await unlink(lp) } catch {}

      this.store.dimension = dimension
      this.store.lastUpdated = metaStore.lastUpdated
      this.store.entries = new Map()
      this.metaEntries = new Map()

      for (let i = 0; i < entries.length; i++) {
        const e = entries[i]
        const vec = new Float32Array(buffer, i * dimension * 4, dimension)
        const entry: VectorEntry = {
          id: e.id,
          vector: new Float32Array(vec),
          ref: e.ref,
          createdAt: e.createdAt,
        }
        this.store.entries.set(e.id, entry)
        this.metaEntries.set(e.id, metas[i])
      }

      console.log(`[VectorIndex] Migrated ${entries.length} entries from legacy format`)
    } catch (err) {
      console.warn('[VectorIndex] Legacy migration failed:', err)
    }
  }

  async save(): Promise<void> {
    if (!this.cacheFile) return
    const mp = metaPath(this.cacheFile)
    const bp = binPath(this.cacheFile)

    const dim = this.store.dimension
    const entries = [...this.store.entries.values()]
    const totalBytes = entries.length * dim * 4
    const buffer = new ArrayBuffer(totalBytes)
    const flat = new Float32Array(buffer)

    const metas: VectorMeta[] = []
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]
      flat.set(e.vector, i * dim)
      const existingMeta = this.metaEntries.get(e.id)
      metas.push({
        id: e.id,
        ref: e.ref,
        createdAt: e.createdAt,
        offset: i,
        contentHash: existingMeta?.contentHash ?? '',
      })
    }

    const metaStore: VectorMetaStore = {
      dimension: dim,
      lastUpdated: this.store.lastUpdated,
      entries: metas,
    }

    try {
      await writeFile(mp, JSON.stringify(metaStore), 'utf-8')
      if (entries.length > 0) {
        await writeFileBinary(bp, new Uint8Array(buffer))
      } else {
        try { await unlink(bp) } catch {}
      }
    } catch {
    }
  }

  async addEntries(items: Array<{ ref: EmbeddingRef; content: string }>): Promise<VectorEntry[]> {
    if (!this.embedding) return []

    const entries: VectorEntry[] = []
    for (let i = 0; i < items.length; i += this.batchSize) {
      const batch = items.slice(i, i + this.batchSize)
      try {
        const batchEntries = await this.embedBatch(batch)
        entries.push(...batchEntries)
      } catch {
        for (const item of batch) {
          try {
            const singleEntries = await this.embedBatch([item])
            entries.push(...singleEntries)
          } catch {
            console.warn('[VectorIndex] Skipping entry due to embedding error:', item.ref.title)
          }
        }
      }
    }

    this.store.lastUpdated = Date.now()
    await this.save()
    return entries
  }

  private async embedBatch(batch: Array<{ ref: EmbeddingRef; content: string }>): Promise<VectorEntry[]> {
    const texts = batch.map(b => b.content)
    const response = await this.embedding!.embed(texts)
    const entries: VectorEntry[] = []

    for (let j = 0; j < batch.length; j++) {
      const id = entryId(batch[j].ref)
      const rawVec = response.embeddings[j]
      const vector = new Float32Array(rawVec.length)
      for (let k = 0; k < rawVec.length; k++) {
        vector[k] = rawVec[k]
      }
      const entry: VectorEntry = {
        id,
        vector,
        ref: batch[j].ref,
        createdAt: Date.now(),
      }
      this.store.entries.set(id, entry)
      this.metaEntries.set(id, {
        id,
        ref: batch[j].ref,
        createdAt: entry.createdAt,
        offset: -1,
        contentHash: contentHash(batch[j].content),
      })
      entries.push(entry)
      if (this.store.dimension === 0) {
        this.store.dimension = rawVec.length
      }
    }

    return entries
  }

  async removeByFile(filePath: string): Promise<void> {
    for (const [id, entry] of this.store.entries) {
      if (entry.ref.filePath === filePath) {
        this.store.entries.delete(id)
        this.metaEntries.delete(id)
      }
    }
    this.store.lastUpdated = Date.now()
    await this.save()
  }

  async addEntriesIncremental(items: Array<{ ref: EmbeddingRef; content: string }>): Promise<VectorEntry[]> {
    if (!this.embedding) return []

    const newIds = new Set(items.map(it => entryId(it.ref)))

    const staleIds: string[] = []
    for (const [id, entry] of this.store.entries) {
      if (entry.ref.filePath === items[0]?.ref.filePath && !newIds.has(id)) {
        staleIds.push(id)
      }
    }
    for (const id of staleIds) {
      this.store.entries.delete(id)
      this.metaEntries.delete(id)
    }

    const changed = items.filter(it => {
      const id = entryId(it.ref)
      const existingMeta = this.metaEntries.get(id)
      if (!existingMeta) return true
      return existingMeta.contentHash !== contentHash(it.content)
    })

    if (changed.length === 0) return []

    const entries = await this.addEntries(changed)
    return entries
  }

  async search(queryVector: number[] | Float32Array, topK = 5, minScore = 0.5): Promise<SimilarityResult[]> {
    const results: SimilarityResult[] = []
    const qv = queryVector instanceof Float32Array ? queryVector : new Float32Array(queryVector)
    for (const entry of this.store.entries.values()) {
      const score = cosineSimilarity(qv, entry.vector)
      if (score >= minScore) {
        results.push({ entry, score })
      }
    }
    results.sort((a, b) => b.score - a.score)
    return results.slice(0, topK)
  }

  async searchByText(text: string, topK = 5, minScore = 0.5): Promise<SimilarityResult[]> {
    if (!this.embedding) return []
    const response = await this.embedding.embed([text])
    return this.search(new Float32Array(response.embeddings[0]), topK, minScore)
  }

  async searchByMultipleTexts(texts: string[], topK = 5, minScore = 0.5): Promise<SimilarityResult[]> {
    if (!this.embedding || texts.length === 0) return []

    const merged = new Map<string, SimilarityResult>()

    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize)
      const response = await this.embedding.embed(batch)

      for (let j = 0; j < batch.length; j++) {
        const results = await this.search(new Float32Array(response.embeddings[j]), topK, minScore)
        for (const r of results) {
          const existing = merged.get(r.entry.id)
          if (!existing || r.score > existing.score) {
            merged.set(r.entry.id, r)
          }
        }
      }
    }

    return [...merged.values()].sort((a, b) => b.score - a.score).slice(0, topK)
  }

  async clear(): Promise<void> {
    this.store.entries.clear()
    this.metaEntries.clear()
    this.store.dimension = 0
    this.store.lastUpdated = 0
    await this.save()
  }

  get dimension(): number {
    return this.store.dimension
  }

  get size(): number {
    return this.store.entries.size
  }
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dotProduct = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dotProduct / denom
}
