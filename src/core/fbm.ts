import type { FBMConfig } from '../types/config.js'
import type { LLMAdapter, EmbeddingAdapter } from '../types/adapter.js'
import type { ConsolidationResult } from '../types/block.js'
import type { MemorySummary } from '../types/retrieval.js'
import type { ConversationMessage } from '../types/conversation.js'
import { QdrantStore } from './qdrant-store.js'
import { DirectoryManager } from './directory-manager.js'
import { BlockLifecycleManager } from './block-lifecycle.js'
import { MemoryConsolidator } from './memory-consolidator.js'
import { MemoryRetriever } from './memory-retriever.js'
import { MemoryReorganizer } from './memory-reorganizer.js'

export class FBM {
  private config: FBMConfig
  private store!: QdrantStore
  private directoryManager!: DirectoryManager
  private lifecycle!: BlockLifecycleManager
  private consolidator!: MemoryConsolidator
  private retriever!: MemoryRetriever
  private _reorganizer!: MemoryReorganizer
  private llm: LLMAdapter
  private embedding: EmbeddingAdapter | null
  private _initialized = false

  constructor(config: FBMConfig, llm: LLMAdapter, embedding?: EmbeddingAdapter) {
    this.config = config
    this.llm = llm
    this.embedding = embedding ?? null
  }

  get initialized(): boolean {
    return this._initialized
  }

  async init(): Promise<void> {
    const port = this.config.qdrant?.port ?? 6333

    this.store = new QdrantStore(
      port,
      this.embedding ?? undefined,
      this.config.qdrant?.memoryBlocksCollection,
      this.config.qdrant?.memoryDirectoryCollection,
      this.config.embedding?.batchSize,
      this.config.qdrant?.bm25Language,
    )

    await this.store.init()

    this.directoryManager = new DirectoryManager(
      this.store,
      this.config.retrieval?.directoryThreshold,
    )

    this.lifecycle = new BlockLifecycleManager(
      this.llm,
      this.store,
      this.directoryManager,
      this.config.lifecycle?.mergeCheckInterval,
      undefined,
      this.config.lifecycle?.enableExpiration,
    )

    this.consolidator = new MemoryConsolidator(
      this.llm,
      this.store,
      this.directoryManager,
    )

    this.retriever = new MemoryRetriever(
      this.llm,
      this.store,
      this.directoryManager,
      this.lifecycle,
      {
        topK: this.config.retrieval?.retrievalTopK,
        minScore: this.config.retrieval?.minScore,
        refineResults: this.config.retrieval?.refineResults,
      },
    )

    this._reorganizer = new MemoryReorganizer(
      this.llm,
      this.store,
      this.directoryManager,
      this.lifecycle,
    )

    this._initialized = true
  }

  async retrieve(query: string | string[], context?: string): Promise<MemorySummary> {
    this.ensureInitialized()
    const queryStr = Array.isArray(query) ? query.join(' ') : query
    return this.retriever.retrieve(queryStr, context)
  }

  async consolidate(messages: ConversationMessage[]): Promise<ConsolidationResult> {
    this.ensureInitialized()
    const result = await this.consolidator.consolidate(messages)
    this.lifecycle.onConsolidationComplete()
    return result
  }

  getStore(): QdrantStore {
    this.ensureInitialized()
    return this.store
  }

  getDirectoryManager(): DirectoryManager {
    this.ensureInitialized()
    return this.directoryManager
  }

  getLifecycle(): BlockLifecycleManager {
    this.ensureInitialized()
    return this.lifecycle
  }

  getReorganizer(): MemoryReorganizer {
    this.ensureInitialized()
    return this._reorganizer
  }

  async getStats(): Promise<{ blockPoints: number; directoryEntries: number; uniqueBlocks: number }> {
    this.ensureInitialized()
    return this.store.getStats()
  }

  async reindexVectors(): Promise<number> {
    this.ensureInitialized()
    const stats = await this.store.getStats()
    return stats.blockPoints
  }

  async clearVectors(): Promise<void> {
    this.ensureInitialized()
    await this.store.clearAll()
  }

  async shutdown(): Promise<void> {
    this._initialized = false
  }

  async setBaseDir(baseDir: string): Promise<void> {
    const wasInitialized = this._initialized
    if (wasInitialized) {
      await this.shutdown()
    }

    this.config.memoryDir = `${baseDir}/memories`
    await this.init()
  }

  private ensureInitialized(): void {
    if (!this._initialized) {
      throw new Error('FBM is not initialized. Call init() first.')
    }
  }
}
