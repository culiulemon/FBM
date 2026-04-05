import { QdrantClient } from '@qdrant/js-client-rest'
import type { EmbeddingAdapter } from '../types/adapter.js'
import type { BlockPayload, BlockData, ImportanceLevel } from '../types/block.js'
import type { DirectoryEntry, DirectoryCategory, DirectorySubCategory, DirectoryTree } from '../types/directory.js'

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

const BLOCKS_COLLECTION = 'memory_blocks'
const DIRECTORY_COLLECTION = 'memory_directory'

export class QdrantStore {
  private client: QdrantClient
  private blocksCollection: string
  private directoryCollection: string
  private embedding: EmbeddingAdapter | null
  private _dimension: number | null

  constructor(port: number, embedding?: EmbeddingAdapter, blocksCollection?: string, directoryCollection?: string) {
    this.client = new QdrantClient({ url: `http://127.0.0.1:${port}`, timeout: 30000 })
    this.blocksCollection = blocksCollection ?? BLOCKS_COLLECTION
    this.directoryCollection = directoryCollection ?? DIRECTORY_COLLECTION
    this.embedding = embedding ?? null
    this._dimension = null
  }

  async init(): Promise<void> {
    this._dimension = this.embedding?.getDimension() ?? null
    await this.ensureCollections()
    await this.ensurePayloadIndices()
  }

  private async getEmbeddingDimension(): Promise<number> {
    if (this._dimension) return this._dimension
    if (!this.embedding) return 1024
    const dim = this.embedding.getDimension()
    if (dim) {
      this._dimension = dim
      return dim
    }
    const resp = await this.embedding.embed(['test'])
    this._dimension = resp.embeddings[0].length
    return this._dimension
  }

  private async ensureCollections(): Promise<void> {
    const collections = await this.client.getCollections()
    const names = new Set(collections.collections.map(c => c.name))
    const dim = await this.getEmbeddingDimension()

    if (!names.has(this.blocksCollection)) {
      await this.client.createCollection(this.blocksCollection, {
        vectors: {
          dense: { size: dim, distance: 'Cosine' },
        },
        sparse_vectors: {
          bm25: { modifier: 'idf' },
        },
      })
    }

    if (!names.has(this.directoryCollection)) {
      await this.client.createCollection(this.directoryCollection, {
        vectors: {
          dense: { size: dim, distance: 'Cosine' },
        },
      })
    }
  }

  private async ensurePayloadIndices(): Promise<void> {
    const indexFields = [
      { collection: this.blocksCollection, field: 'blockId', schema: 'keyword' as const },
      { collection: this.blocksCollection, field: 'type', schema: 'keyword' as const },
      { collection: this.directoryCollection, field: 'blockId', schema: 'keyword' as const },
      { collection: this.directoryCollection, field: 'category', schema: 'keyword' as const },
      { collection: this.directoryCollection, field: 'subCategory', schema: 'keyword' as const },
      { collection: this.directoryCollection, field: 'importance', schema: 'keyword' as const },
      { collection: this.directoryCollection, field: 'status', schema: 'keyword' as const },
    ]

    for (const { collection, field, schema } of indexFields) {
      try {
        await this.client.createPayloadIndex(collection, {
          field_name: field,
          field_schema: schema,
        })
      } catch {
        // index may already exist
      }
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.embedding) throw new Error('No embedding adapter configured')
    const batchSize = 20
    const allEmbeddings: number[][] = []
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize)
      const resp = await this.embedding.embed(batch)
      allEmbeddings.push(...resp.embeddings)
    }
    return allEmbeddings
  }

  async writeRawContext(
    blockId: string,
    rawContent: string,
    directoryEntry: string,
    category: string,
    subCategory: string,
    summary: string,
    importance: ImportanceLevel,
    sourceConversationId?: string,
  ): Promise<void> {
    const vectors = await this.embed([rawContent])
    const now = Date.now()
    const pointId = uuid()

    const payload: BlockPayload = {
      blockId,
      type: 'raw_context',
      rawContent,
      directoryEntry,
      category,
      subCategory,
      summary,
      importance,
      sourceConversationId,
      accessCount: 0,
      lastAccessedAt: now,
      createdAt: now,
      updatedAt: now,
      updateCount: 0,
      status: 'active',
    }

    await this.client.upsert(this.blocksCollection, {
      points: [{
        id: pointId,
        vector: { dense: vectors[0] },
        payload: payload as unknown as Record<string, unknown>,
      }],
    })
  }

  async writeKeywordAnchors(
    blockId: string,
    keywords: string[],
    directoryEntry: string,
    category: string,
    subCategory: string,
    summary: string,
    importance: ImportanceLevel,
  ): Promise<void> {
    if (keywords.length === 0) return
    const vectors = await this.embed(keywords)
    const now = Date.now()

    const points = keywords.map((kw, i) => ({
      id: uuid(),
      vector: {
        dense: vectors[i],
        bm25: {
          text: kw,
          model: 'qdrant/bm25',
          options: { language: 'chinese' },
        } as unknown as number[],
      },
      payload: {
        blockId,
        type: 'keyword_anchor',
        keywordSentence: kw,
        directoryEntry,
        category,
        subCategory,
        summary,
        importance,
        accessCount: 0,
        lastAccessedAt: now,
        createdAt: now,
        updatedAt: now,
        updateCount: 0,
        status: 'active',
      } as unknown as Record<string, unknown>,
    }))

    await this.client.upsert(this.blocksCollection, { points })
  }

  async writeDirectoryEntry(
    blockId: string,
    directoryEntry: string,
    category: string,
    subCategory: string,
    summary: string,
    keywordAnchors: string[],
    importance: ImportanceLevel,
    pointCount: number,
  ): Promise<void> {
    const vectors = await this.embed([directoryEntry])
    const now = Date.now()

    await this.client.upsert(this.directoryCollection, {
      points: [{
        id: uuid(),
        vector: { dense: vectors[0] },
        payload: {
          blockId,
          directoryEntry,
          category,
          subCategory,
          fullPath: `${category}/${subCategory}/${directoryEntry}`,
          summary,
          keywordAnchors,
          pointCount,
          importance,
          createdAt: now,
          updatedAt: now,
          lastAccessedAt: now,
          accessCount: 0,
          status: 'active',
        },
      }],
    })
  }

  async scrollByBlockId(blockId: string): Promise<BlockPayload[]> {
    const points: BlockPayload[] = []
    let offset: string | number | undefined = undefined

    do {
      const result = await this.client.scroll(this.blocksCollection, {
        filter: {
          must: [
            { key: 'blockId', match: { value: blockId } },
            { key: 'status', match: { value: 'active' } },
          ],
        },
        limit: 100,
        offset,
        with_payload: true,
        with_vector: false,
      })

      for (const point of result.points) {
        points.push(point.payload as unknown as BlockPayload)
      }

      offset = result.next_page_offset as string | number | undefined
    } while (offset)

    return points
  }

  async assembleBlockData(blockId: string): Promise<BlockData | null> {
    const payloads = await this.scrollByBlockId(blockId)
    if (payloads.length === 0) return null

    const first = payloads[0]
    return {
      blockId,
      directoryEntry: first.directoryEntry,
      category: first.category,
      subCategory: first.subCategory,
      summary: first.summary,
      importance: first.importance,
      rawContents: payloads.filter(p => p.type === 'raw_context').map(p => p.rawContent ?? ''),
      keywordSentences: payloads.filter(p => p.type === 'keyword_anchor').map(p => p.keywordSentence ?? ''),
      accessCount: Math.max(...payloads.map(p => p.accessCount)),
      lastAccessedAt: Math.max(...payloads.map(p => p.lastAccessedAt)),
      createdAt: Math.min(...payloads.map(p => p.createdAt)),
      updatedAt: Math.max(...payloads.map(p => p.updatedAt)),
      sourceConversationId: first.sourceConversationId,
      mergedFrom: first.mergedFrom,
    }
  }

  async searchHybrid(
    queryText: string,
    candidateBlockIds: string[],
    topK: number = 10,
    minScore: number = 0.3,
  ): Promise<Array<{ pointId: string; blockId: string; keywordSentence: string; score: number; source: 'dense' | 'sparse' | 'hybrid' }>> {
    const queryVector = (await this.embed([queryText]))[0]

    const filter = candidateBlockIds.length > 0
      ? {
          must: [
            { key: 'type', match: { value: 'keyword_anchor' } },
            { key: 'blockId', match: { any: candidateBlockIds } },
            { key: 'status', match: { value: 'active' } },
          ],
        }
      : {
          must: [
            { key: 'type', match: { value: 'keyword_anchor' } },
            { key: 'status', match: { value: 'active' } },
          ],
        }

    try {
      const [hybridResults, denseResults] = await Promise.all([
        this.client.query(this.blocksCollection, {
          prefetch: [
            {
              query: queryVector,
              using: 'dense',
              filter,
              limit: topK,
            },
            {
              query: {
                text: queryText,
                model: 'qdrant/bm25',
                options: { language: 'chinese' },
              } as unknown as number[],
              using: 'bm25',
              filter,
              limit: topK,
            },
          ],
          query: { fusion: 'rrf' },
          limit: topK,
          with_payload: true,
        }),
        this.client.search(this.blocksCollection, {
          vector: { name: 'dense', vector: queryVector },
          filter,
          limit: topK,
          with_payload: true,
        }),
      ])

      console.log('[HybridCompare] query:', queryText.slice(0, 60))
      console.log('[HybridCompare] hybrid (dense+bm25+rrf):', hybridResults.points.length, 'results')
      for (const p of hybridResults.points) {
        const pl = p.payload as unknown as BlockPayload
        console.log('[HybridCompare]   hybrid - score:', p.score?.toFixed(4), 'kw:', (pl.keywordSentence ?? '').slice(0, 40))
      }
      console.log('[HybridCompare] dense-only:', denseResults.length, 'results')
      for (const p of denseResults) {
        const pl = p.payload as unknown as BlockPayload
        console.log('[HybridCompare]   dense  - score:', p.score?.toFixed(4), 'kw:', (pl.keywordSentence ?? '').slice(0, 40))
      }

      const scored: Array<{ pointId: string; blockId: string; keywordSentence: string; score: number; source: 'dense' | 'sparse' | 'hybrid' }> = []

      for (const point of hybridResults.points) {
        const payload = point.payload as unknown as BlockPayload
        scored.push({
          pointId: String(point.id),
          blockId: payload.blockId,
          keywordSentence: payload.keywordSentence ?? '',
          score: point.score,
          source: 'hybrid',
        })
      }

      return scored
    } catch (err) {
      console.warn('[QdrantStore] hybrid query failed, falling back to searchDenseOnly:', err)
      const denseResults = await this.searchDenseOnly(queryText, candidateBlockIds, topK, minScore)
      return denseResults.map(r => ({
        ...r,
        keywordSentence: '',
        source: 'dense' as const,
      }))
    }
  }

  async searchDenseOnly(
    queryText: string,
    candidateBlockIds: string[],
    topK: number = 10,
    minScore: number = 0.3,
  ): Promise<Array<{ pointId: string; blockId: string; score: number }>> {
    const queryVector = (await this.embed([queryText]))[0]

    const filter = candidateBlockIds.length > 0
      ? {
          must: [
            { key: 'type', match: { value: 'keyword_anchor' } },
            { key: 'blockId', match: { any: candidateBlockIds } },
            { key: 'status', match: { value: 'active' } },
          ],
        }
      : {
          must: [
            { key: 'type', match: { value: 'keyword_anchor' } },
            { key: 'status', match: { value: 'active' } },
          ],
        }

    const results = await this.client.search(this.blocksCollection, {
      vector: { name: 'dense', vector: queryVector },
      filter,
      limit: topK,
      with_payload: true,
    })

    return results
      .filter(r => r.score >= minScore)
      .map(r => ({
        pointId: String(r.id),
        blockId: (r.payload as unknown as BlockPayload).blockId,
        score: r.score,
      }))
  }

  async scrollDirectory(filter?: Record<string, unknown>): Promise<DirectoryEntry[]> {
    const entries: DirectoryEntry[] = []
    let offset: string | number | undefined = undefined

    const mustFilters: Array<{ key: string; match: { value: string } }> = [
      { key: 'status', match: { value: 'active' } },
    ]

    if (filter) {
      for (const [key, value] of Object.entries(filter)) {
        if (typeof value === 'string') {
          mustFilters.push({ key, match: { value } })
        }
      }
    }

    do {
      const result = await this.client.scroll(this.directoryCollection, {
        filter: { must: mustFilters },
        limit: 100,
        offset,
        with_payload: true,
        with_vector: false,
      })

      for (const point of result.points) {
        const p = point.payload as unknown as Record<string, unknown>
        entries.push({
          blockId: p.blockId as string,
          directoryEntry: p.directoryEntry as string,
          category: p.category as string,
          subCategory: p.subCategory as string,
          fullPath: p.fullPath as string,
          summary: p.summary as string,
          keywordAnchors: (p.keywordAnchors as string[]) ?? [],
          pointCount: (p.pointCount as number) ?? 0,
          importance: p.importance as string,
          createdAt: p.createdAt as number,
          updatedAt: p.updatedAt as number,
          lastAccessedAt: p.lastAccessedAt as number,
        })
      }

      offset = result.next_page_offset as string | number | undefined
    } while (offset)

    return entries
  }

  async getDirectoryTree(): Promise<DirectoryTree> {
    const entries = await this.scrollDirectory()

    const catMap = new Map<string, Map<string, DirectoryEntry[]>>()
    for (const entry of entries) {
      if (!catMap.has(entry.category)) {
        catMap.set(entry.category, new Map())
      }
      const subMap = catMap.get(entry.category)!
      if (!subMap.has(entry.subCategory)) {
        subMap.set(entry.subCategory, [])
      }
      subMap.get(entry.subCategory)!.push(entry)
    }

    const categories: DirectoryCategory[] = []
    for (const [catName, subMap] of catMap) {
      const subCategories: DirectorySubCategory[] = []
      for (const [subName, subEntries] of subMap) {
        subCategories.push({ name: subName, entries: subEntries })
      }
      categories.push({ name: catName, subCategories })
    }

    return { categories, totalEntries: entries.length }
  }

  async deleteBlock(blockId: string): Promise<void> {
    await this.client.delete(this.blocksCollection, {
      filter: {
        must: [{ key: 'blockId', match: { value: blockId } }],
      },
    })

    try {
      await this.client.delete(this.directoryCollection, {
        filter: {
          must: [{ key: 'blockId', match: { value: blockId } }],
        },
      })
    } catch {
      // directory entry may not exist
    }
  }

  async deleteDirectoryEntry(blockId: string): Promise<void> {
    await this.client.delete(this.directoryCollection, {
      filter: {
        must: [{ key: 'blockId', match: { value: blockId } }],
      },
    })
  }

  async updateBlockAccess(blockId: string): Promise<void> {
    const now = Date.now()

    const points = await this.scrollByBlockId(blockId)
    for (const _point of points) {
      // no-op: we update via directory entry for efficiency
    }

    try {
      const dirEntries = await this.scrollDirectory({ blockId })
      for (const _entry of dirEntries) {
        // update via point ID
      }
    } catch {
      // best effort
    }

    // Use batch update via payload
    try {
      await this.client.setPayload(this.directoryCollection, {
        payload: { lastAccessedAt: now, accessCount: { increment: 1 } } as unknown as Record<string, unknown>,
        filter: { must: [{ key: 'blockId', match: { value: blockId } }] },
      })
    } catch {
      // fallback: no-op
    }
  }

  async getBlockCount(): Promise<number> {
    try {
      const info = await this.client.getCollection(this.blocksCollection)
      return info.points_count ?? 0
    } catch {
      return 0
    }
  }

  async getDirectoryCount(): Promise<number> {
    try {
      const info = await this.client.getCollection(this.directoryCollection)
      return info.points_count ?? 0
    } catch {
      return 0
    }
  }

  async getStats(): Promise<{ blockPoints: number; directoryEntries: number; uniqueBlocks: number }> {
    const [blockPoints, directoryEntries] = await Promise.all([
      this.getBlockCount(),
      this.getDirectoryCount(),
    ])

    let uniqueBlocks = 0
    try {
      const entries = await this.scrollDirectory()
      uniqueBlocks = entries.length
    } catch {
      // fallback
    }

    return { blockPoints, directoryEntries, uniqueBlocks }
  }

  async searchDirectoryDense(
    queryText: string,
    topK: number = 5,
  ): Promise<DirectoryEntry[]> {
    const queryVector = (await this.embed([queryText]))[0]

    const results = await this.client.search(this.directoryCollection, {
      vector: { name: 'dense', vector: queryVector },
      filter: {
        must: [{ key: 'status', match: { value: 'active' } }],
      },
      limit: topK,
      with_payload: true,
    })

    return results.map(r => {
      const p = r.payload as unknown as Record<string, unknown>
      return {
        blockId: p.blockId as string,
        directoryEntry: p.directoryEntry as string,
        category: p.category as string,
        subCategory: p.subCategory as string,
        fullPath: p.fullPath as string,
        summary: p.summary as string,
        keywordAnchors: (p.keywordAnchors as string[]) ?? [],
        pointCount: (p.pointCount as number) ?? 0,
        importance: p.importance as string,
        createdAt: p.createdAt as number,
        updatedAt: p.updatedAt as number,
        lastAccessedAt: p.lastAccessedAt as number,
      }
    })
  }

  async clearAll(): Promise<void> {
    try {
      await this.client.delete(this.blocksCollection, { filter: {} })
    } catch {
      // collection may not exist
    }
    try {
      await this.client.delete(this.directoryCollection, { filter: {} })
    } catch {
      // collection may not exist
    }
  }
}
