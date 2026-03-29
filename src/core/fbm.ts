import type { FBMConfig } from '../types/config.js'
import type { LLMAdapter, EmbeddingAdapter } from '../types/adapter.js'
import type { RetrievalResult, ConsolidationResult, MemorySummary } from '../types/retrieval.js'
import type { ConversationMessage } from '../types/conversation.js'
import type { HeadingNode } from '../types/memory.js'
import { MemoryStore } from './store.js'
import { IndexEngine } from './index-engine.js'
import { KeywordExtractor } from './keyword-extractor.js'
import { NodeLocator, parseMarkdown } from './node-locator.js'
import { MemoryRetriever } from './memory-retriever.js'
import { VectorIndex } from './vector-index.js'
import { MemoryConsolidator } from './memory-consolidator.js'
import { readFile } from './fs-adapter.js'

export class FBM {
  private config: FBMConfig
  private store!: MemoryStore
  private indexEngine!: IndexEngine
  private keywordExtractor!: KeywordExtractor
  private nodeLocator!: NodeLocator
  private vectorIndex!: VectorIndex
  private retriever!: MemoryRetriever
  private consolidator!: MemoryConsolidator
  private llm: LLMAdapter
  private embedding: EmbeddingAdapter | null
  private unwatch: (() => void) | null = null
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
    this.store = new MemoryStore(this.config.memoryDir, this.config.store)

    this.indexEngine = new IndexEngine(
      this.config.memoryDir,
      this.config.store?.indexCacheFile
    )

    this.keywordExtractor = new KeywordExtractor(this.llm)
    this.nodeLocator = new NodeLocator()

    this.vectorIndex = new VectorIndex(
      this.embedding ?? undefined,
      this.config.embedding?.vectorCacheFile,
      this.config.embedding?.batchSize
    )

    this.retriever = new MemoryRetriever({
      indexEngine: this.indexEngine,
      keywordExtractor: this.keywordExtractor,
      nodeLocator: this.nodeLocator,
      vectorIndex: this.vectorIndex,
      llm: this.llm,
      topK: this.config.retrieval?.retrievalTopK,
      refineResults: this.config.retrieval?.refineResults,
    })

    this.consolidator = new MemoryConsolidator(
      this.store,
      this.llm,
      this.config.consolidator
    )

    await this.store.init()
    await this.indexEngine.build()

    if (this.vectorIndex.enabled) {
      await this.vectorIndex.load()
      await this.rebuildVectors()
    }

    if (this.config.store?.watchFiles !== false) {
      this.unwatch = this.store.watch(async (event, filePath) => {
        if (event === 'unlink') {
          await this.indexEngine.removeFile(filePath)
          await this.vectorIndex.removeByFile(filePath)
        } else if (event === 'change' || event === 'add') {
          await this.indexEngine.updateFile(filePath)
          if (this.vectorIndex.enabled) {
            await this.addVectorsForFile(filePath)
          }
        }
      })
    }

    this.consolidator.onResult(async (result: ConsolidationResult) => {
      for (const mem of result.memories) {
        if (mem.filePath) {
          await this.indexEngine.indexFile(mem.filePath)
          if (this.vectorIndex.enabled) {
            await this.addVectorsForFile(mem.filePath)
          }
        }
      }
    })

    this._initialized = true
  }

  async retrieve(query: string): Promise<MemorySummary> {
    this.ensureInitialized()
    return this.retriever.retrieveAndSummarize(query)
  }

  async consolidate(messages: ConversationMessage[]): Promise<ConsolidationResult> {
    this.ensureInitialized()
    return this.consolidator.consolidate(messages)
  }

  async writeMemory(title: string, content: string, targetFile?: string): Promise<string> {
    this.ensureInitialized()
    if (targetFile) {
      return this.store.appendToFile(targetFile, title, content)
    }
    return this.store.createFile(title, title, content)
  }

  getStore(): MemoryStore {
    this.ensureInitialized()
    return this.store
  }

  getIndexEngine(): IndexEngine {
    this.ensureInitialized()
    return this.indexEngine
  }

  getVectorIndex(): VectorIndex {
    this.ensureInitialized()
    return this.vectorIndex
  }

  getConsolidator(): MemoryConsolidator {
    this.ensureInitialized()
    return this.consolidator
  }

  async reindexVectors(): Promise<number> {
    this.ensureInitialized()
    if (!this.vectorIndex.enabled) return 0
    await this.vectorIndex.clear()
    await this.addVectorsForDir(this.config.memoryDir)
    return this.vectorIndex.size
  }

  async reindexFile(filePath: string): Promise<number> {
    this.ensureInitialized()
    if (!this.vectorIndex.enabled) return 0
    await this.vectorIndex.removeByFile(filePath)
    await this.addVectorsForFile(filePath)
    return this.vectorIndex.size
  }

  async clearVectors(): Promise<void> {
    this.ensureInitialized()
    await this.vectorIndex.clear()
  }

  async shutdown(): Promise<void> {
    this.consolidator.destroy()
    this.unwatch?.()
    this._initialized = false
  }

  private ensureInitialized(): void {
    if (!this._initialized) {
      throw new Error('FBM is not initialized. Call init() first.')
    }
  }

  private async rebuildVectors(): Promise<void> {
    if (!this.vectorIndex.enabled || this.vectorIndex.size > 0) return
    await this.addVectorsForDir(this.config.memoryDir)
  }

  private async addVectorsForDir(dir: string): Promise<void> {
    const files = await this.nodeLocator.searchFiles(dir)
    for (const filePath of files) {
      await this.addVectorsForFile(filePath)
    }
  }

  private async addVectorsForFile(filePath: string): Promise<void> {
    if (!this.embedding) return
    try {
      const content = await readFile(filePath, 'utf-8')
      const headings = parseMarkdown(content, filePath)

      const items = headings.map((h: HeadingNode) => ({
        ref: {
          filePath,
          headingPath: this.buildHeadingPath(h),
          lineStart: h.lineStart,
          lineEnd: h.lineEnd,
          title: h.title,
        },
        content: `${h.title}\n${this.nodeLocator.extractContent(h).slice(0, 1000)}`,
      }))

      if (items.length > 0) {
        await this.vectorIndex.addEntries(items)
      }
    } catch {
      // skip unreadable files
    }
  }

  private buildHeadingPath(heading: HeadingNode): string[] {
    const path: string[] = [heading.title]
    let current = heading
    while (current.children) {
      const child = current.children.find(
        (n): n is HeadingNode => n.type === 'heading'
      )
      if (!child) break
      path.push(child.title)
      current = child
    }
    return path
  }
}
