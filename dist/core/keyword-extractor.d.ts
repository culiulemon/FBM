import type { LLMAdapter } from '../types/adapter.js';
export declare class KeywordExtractor {
    private llm;
    private model;
    constructor(llm?: LLMAdapter, model?: string);
    extract(userInput: string): Promise<string[]>;
    private extractFromLLM;
    private extractLocal;
    expand(keywords: string[]): Promise<string[]>;
}
//# sourceMappingURL=keyword-extractor.d.ts.map