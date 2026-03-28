import type { LLMAdapter, LLMResponse, LLMMessage, LLMOptions } from '../../types/adapter.js';
export declare class OpenAILLMAdapter implements LLMAdapter {
    private baseUrl;
    private apiKey;
    private model;
    private maxTokens;
    private temperature;
    constructor(config: {
        baseUrl: string;
        apiKey: string;
        model: string;
        maxTokens?: number;
        temperature?: number;
    });
    chat(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse>;
}
//# sourceMappingURL=openai-llm.d.ts.map