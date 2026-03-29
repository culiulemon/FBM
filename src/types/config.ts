export interface FBMConfig {
  memoryDir: string
  store?: StoreConfig
  embedding?: EmbeddingConfig
  retrieval?: RetrievalConfig
  consolidator?: ConsolidatorConfig
}

export interface StoreConfig {
  indexCacheFile?: string
  watchFiles?: boolean
}

export interface EmbeddingConfig {
  batchSize?: number
  vectorCacheFile?: string
}

export interface RetrievalConfig {
  refineResults?: boolean
  retrievalTopK?: number
  minScore?: number
  maxContextTokens?: number
}

export interface ConsolidatorConfig {
  maxSummaryTokens?: number
}
