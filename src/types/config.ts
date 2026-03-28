export interface FBMConfig {
  memoryDir: string
  store: StoreConfig
  embedding?: EmbeddingConfig
  consolidator: ConsolidatorConfig
  dynamicMemory: DynamicMemoryConfig
}

export interface StoreConfig {
  indexCacheFile?: string
  watchFiles?: boolean
  defaultMemoryTypes?: string[]
}

export interface EmbeddingConfig {
  batchSize?: number
  vectorCacheFile?: string
}

export interface ConsolidatorConfig {
  enabled: boolean
  idleTimeoutMs: number
  minConversationTurns: number
  maxSummaryTokens: number
}

export interface DynamicMemoryConfig {
  enabled: boolean
  maxContextTokens: number
  retrievalTopK: number
  minScore: number
  injectAsSystem: boolean
}
