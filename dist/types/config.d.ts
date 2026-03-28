export interface FBMConfig {
    memoryDir: string;
    llm: LLMConfig;
    store: StoreConfig;
    embedding?: EmbeddingConfig;
    consolidator: ConsolidatorConfig;
    dynamicMemory: DynamicMemoryConfig;
}
export interface LLMConfig {
    adapter: string;
    baseUrl: string;
    apiKey: string;
    model: string;
    maxTokens?: number;
    temperature?: number;
}
export interface StoreConfig {
    indexCacheFile?: string;
    watchFiles?: boolean;
    defaultMemoryTypes?: string[];
}
export interface EmbeddingConfig {
    adapter: string;
    baseUrl: string;
    apiKey: string;
    model: string;
    dimension?: number;
    batchSize?: number;
    vectorCacheFile?: string;
}
export interface ConsolidatorConfig {
    enabled: boolean;
    idleTimeoutMs: number;
    minConversationTurns: number;
    maxSummaryTokens: number;
}
export interface DynamicMemoryConfig {
    enabled: boolean;
    maxContextTokens: number;
    retrievalTopK: number;
    minScore: number;
    injectAsSystem: boolean;
}
//# sourceMappingURL=config.d.ts.map