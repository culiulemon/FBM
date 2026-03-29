import type { EmbeddingAdapter } from '../types/adapter.js'
import type { VectorEntry, EmbeddingRef, SimilarityResult, VectorStore, SerializedVectorStore } from '../types/vector.js'
import { readFile, writeFile } from './fs-adapter.js'

function entryId(ref: EmbeddingRef): string {
  return `${ref.filePath}:${ref.headingPath.join('/')}:${ref.lineStart}-${ref.lineEnd}`
}

export class VectorIndex {
  private store: VectorStore
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
  }

  get enabled(): boolean {
    return this.embedding !== null
  }

  async load(): Promise<void> {
    if (!this.cacheFile) return
    try {
      const content = await readFile(this.cacheFile, 'utf-8')
      const serialized: SerializedVectorStore = JSON.parse(content)
      this.store.dimension = serialized.dimension
      this.store.lastUpdated = serialized.lastUpdated
      this.store.entries = new Map()
      for (const [id, entry] of Object.entries(serialized.entries)) {
        this.store.entries.set(id, entry)
      }
    } catch {
      // cache invalid or missing
    }
  }

  async save(): Promise<void> {
    if (!this.cacheFile) return
    const serialized: SerializedVectorStore = {
      dimension: this.store.dimension,
      lastUpdated: this.store.lastUpdated,
      entries: {},
    }
    for (const [id, entry] of this.store.entries) {
      serialized.entries[id] = entry
    }
    try {
      await writeFile(this.cacheFile, JSON.stringify(serialized), 'utf-8')
    } catch {
      // cache write failure is non-critical
    }
  }

  async addEntries(items: Array<{ ref: EmbeddingRef; content: string }>): Promise<VectorEntry[]> {
    if (!this.embedding) return []

    const entries: VectorEntry[] = []
    for (let i = 0; i < items.length; i += this.batchSize) {
      const batch = items.slice(i, i + this.batchSize)
      const texts = batch.map(b => b.content)
      const response = await this.embedding.embed(texts)

      for (let j = 0; j < batch.length; j++) {
        const id = entryId(batch[j].ref)
        const entry: VectorEntry = {
          id,
          vector: response.embeddings[j],
          ref: batch[j].ref,
          content: batch[j].content,
          createdAt: Date.now(),
        }
        this.store.entries.set(id, entry)
        entries.push(entry)
        if (this.store.dimension === 0) {
          this.store.dimension = response.embeddings[j].length
        }
      }
    }

    this.store.lastUpdated = Date.now()
    await this.save()
    return entries
  }

  async removeByFile(filePath: string): Promise<void> {
    for (const [id, entry] of this.store.entries) {
      if (entry.ref.filePath === filePath) {
        this.store.entries.delete(id)
      }
    }
    this.store.lastUpdated = Date.now()
    await this.save()
  }

  async search(queryVector: number[], topK = 5, minScore = 0.5): Promise<SimilarityResult[]> {
    const results: SimilarityResult[] = []
    for (const entry of this.store.entries.values()) {
      const score = cosineSimilarity(queryVector, entry.vector)
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
    return this.search(response.embeddings[0], topK, minScore)
  }

  async clear(): Promise<void> {
    this.store.entries.clear()
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

function cosineSimilarity(a: number[], b: number[]): number {
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
