import type { EmbeddingAdapter } from '../types/adapter.js';
import type { VectorEntry, EmbeddingRef, SimilarityResult } from '../types/vector.js';
export declare class VectorIndex {
    private store;
    private embedding;
    private cacheFile;
    private batchSize;
    constructor(embedding?: EmbeddingAdapter, cacheFile?: string, batchSize?: number);
    get enabled(): boolean;
    load(): Promise<void>;
    save(): Promise<void>;
    addEntries(items: Array<{
        ref: EmbeddingRef;
        content: string;
    }>): Promise<VectorEntry[]>;
    removeByFile(filePath: string): Promise<void>;
    search(queryVector: number[], topK?: number, minScore?: number): Promise<SimilarityResult[]>;
    searchByText(text: string, topK?: number, minScore?: number): Promise<SimilarityResult[]>;
    get dimension(): number;
    get size(): number;
}
//# sourceMappingURL=vector-index.d.ts.map