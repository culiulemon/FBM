import type { NodeRef, MemoryIndex } from '../types/index.js';
export declare class IndexEngine {
    private index;
    private nodeLocator;
    private memoryDir;
    private cacheFile;
    constructor(memoryDir: string, cacheFile?: string);
    build(): Promise<void>;
    indexFile(filePath: string): Promise<void>;
    removeFile(filePath: string): Promise<void>;
    updateFile(filePath: string): Promise<void>;
    search(keywords: string[]): NodeRef[];
    getIndex(): MemoryIndex;
    private createNodeRef;
    private buildHeadingPath;
    private indexKeywords;
    private removeNodeRefKeywords;
    private extractAllText;
    private loadCache;
    saveCache(): Promise<void>;
}
//# sourceMappingURL=index-engine.d.ts.map