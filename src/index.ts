export type {
  MemoryNode,
  HeadingNode,
  CodeBlockNode,
  ParagraphNode,
  ListNode,
} from './types/memory.js'

export type {
  NodeRef,
  HeadingIndex,
  MemoryIndex,
  KeywordMap,
  KeywordEntry,
} from './types/index.js'

export type {
  VectorEntry,
  EmbeddingRef,
  SimilarityResult,
  VectorStore,
} from './types/vector.js'

export type {
  RetrievalResult,
  MemorySummary,
  MemoryDocument,
  MemoryRoute,
  ConsolidationResult,
} from './types/retrieval.js'

export type {
  FBMConfig,
  StoreConfig,
  EmbeddingConfig,
  RetrievalConfig,
  ConsolidatorConfig,
} from './types/config.js'

export type {
  LLMAdapter,
  LLMResponse,
  EmbeddingAdapter,
  EmbeddingResponse,
} from './types/adapter.js'

export type { ConversationMessage } from './types/conversation.js'

export { FBM } from './core/fbm.js'
export { MemoryStore } from './core/store.js'
export { IndexEngine } from './core/index-engine.js'
export { NodeLocator, normalizeTitle, levenshteinDistance, fuzzyMatchTitle, parseMarkdown } from './core/node-locator.js'
export { KeywordExtractor } from './core/keyword-extractor.js'
export { MemoryRetriever } from './core/memory-retriever.js'
export { VectorIndex } from './core/vector-index.js'
export { MemoryConsolidator } from './core/memory-consolidator.js'
export { OpenAILLMAdapter } from './core/adapters/openai-llm.js'
export { OpenAIEmbeddingAdapter } from './core/adapters/openai-embedding.js'
