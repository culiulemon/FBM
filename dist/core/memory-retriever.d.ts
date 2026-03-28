import type { RetrievalResult, MemorySummary } from '../types/retrieval.js';
import type { LLMAdapter } from '../types/adapter.js';
import { IndexEngine } from './index-engine.js';
import { KeywordExtractor } from './keyword-extractor.js';
import { NodeLocator } from './node-locator.js';
import { VectorIndex } from './vector-index.js';
export declare class MemoryRetriever {
    private indexEngine;
    private keywordExtractor;
    private nodeLocator;
    private vectorIndex;
    private llm;
    private topK;
    private maxTokens;
    constructor(deps: {
        indexEngine: IndexEngine;
        keywordExtractor: KeywordExtractor;
        nodeLocator?: NodeLocator;
        vectorIndex?: VectorIndex;
        llm?: LLMAdapter;
        topK?: number;
        maxTokens?: number;
    });
    retrieve(query: string): Promise<RetrievalResult[]>;
    summarize(query: string, results: RetrievalResult[]): Promise<MemorySummary>;
    retrieveAndSummarize(query: string): Promise<MemorySummary>;
    private resolveResults;
    private resolveVectorResults;
    private resolveNodeContent;
    private mergeResults;
    private estimateTokens;
}
//# sourceMappingURL=memory-retriever.d.ts.map