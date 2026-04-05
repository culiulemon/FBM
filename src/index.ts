export type {
  FBMConfig,
  QdrantConfig,
  EmbeddingConfig,
  RetrievalConfig,
  LifecycleConfig,
  ExpirationThresholds,
} from './types/config.js'

export type {
  LLMAdapter,
  LLMResponse,
  EmbeddingAdapter,
  EmbeddingResponse,
} from './types/adapter.js'

export type { ConversationMessage } from './types/conversation.js'

export type {
  ImportanceLevel,
  BlockPointType,
  BlockAction,
  UpdateStrategy,
  BlockPayload,
  NewBlockData,
  BlockOperation,
  TopicSegment,
  SegmentationResult,
  BlockData,
  ConsolidationResult,
} from './types/block.js'

export type {
  DirectoryEntry,
  DirectoryCategory,
  DirectorySubCategory,
  DirectoryTree,
  ExpirationCandidate,
  ExpirationDecision,
  MergeCandidate,
  MergeDecision,
} from './types/directory.js'

export type { MemorySummary, BlockRetrievalResult } from './types/retrieval.js'

export { FBM } from './core/fbm.js'
export { QdrantStore } from './core/qdrant-store.js'
export { DirectoryManager } from './core/directory-manager.js'
export { BlockLifecycleManager } from './core/block-lifecycle.js'
export { MemoryConsolidator } from './core/memory-consolidator.js'
export { MemoryRetriever } from './core/memory-retriever.js'
export { KeywordExtractor } from './core/keyword-extractor.js'
export { OpenAILLMAdapter } from './core/adapters/openai-llm.js'
export { OpenAIEmbeddingAdapter } from './core/adapters/openai-embedding.js'
