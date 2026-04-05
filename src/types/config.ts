export interface FBMConfig {
  memoryDir: string
  qdrant?: QdrantConfig
  embedding?: EmbeddingConfig
  retrieval?: RetrievalConfig
  lifecycle?: LifecycleConfig
}

export interface QdrantConfig {
  port?: number
  memoryBlocksCollection?: string
  memoryDirectoryCollection?: string
}

export interface EmbeddingConfig {
  batchSize?: number
}

export interface RetrievalConfig {
  refineResults?: boolean
  retrievalTopK?: number
  minScore?: number
  maxContextTokens?: number
  directoryThreshold?: number
}

export interface LifecycleConfig {
  enableExpiration?: boolean
  mergeCheckInterval?: number
  expirationThresholds?: ExpirationThresholds
}

export interface ExpirationThresholds {
  critical: number
  high: number
  normal: number
  low: number
}
