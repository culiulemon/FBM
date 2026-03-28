export interface LLMResponse {
    content: string;
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
}
export interface LLMAdapter {
    chat(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse>;
}
export interface LLMMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}
export interface LLMOptions {
    maxTokens?: number;
    temperature?: number;
    stop?: string[];
}
export interface EmbeddingResponse {
    embeddings: number[][];
    usage?: {
        promptTokens: number;
        totalTokens: number;
    };
}
export interface EmbeddingAdapter {
    embed(texts: string[]): Promise<EmbeddingResponse>;
    getDimension(): number | undefined;
}
//# sourceMappingURL=adapter.d.ts.map