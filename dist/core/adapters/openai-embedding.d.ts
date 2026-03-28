import type { EmbeddingAdapter, EmbeddingResponse } from '../../types/adapter.js';
export declare class OpenAIEmbeddingAdapter implements EmbeddingAdapter {
    private baseUrl;
    private apiKey;
    private model;
    private _dimension;
    constructor(config: {
        baseUrl: string;
        apiKey: string;
        model: string;
        dimension?: number;
    });
    embed(texts: string[]): Promise<EmbeddingResponse>;
    getDimension(): number | undefined;
}
//# sourceMappingURL=openai-embedding.d.ts.map