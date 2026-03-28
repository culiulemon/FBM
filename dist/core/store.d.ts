import { MemoryType } from '../types/memory.js';
import type { MemoryDocument } from '../types/retrieval.js';
import type { StoreConfig } from '../types/config.js';
export declare class MemoryStore {
    private memoryDir;
    private storeConfig;
    constructor(memoryDir: string, storeConfig?: StoreConfig);
    init(): Promise<void>;
    write(doc: MemoryDocument): Promise<string>;
    read(options?: {
        type?: MemoryType;
        keyword?: string;
        since?: number;
        path?: string;
    }): Promise<MemoryDocument[]>;
    private readSingleFile;
    update(filePath: string, content: string): Promise<void>;
    delete(filePath: string): Promise<void>;
    watch(callback: (event: 'add' | 'change' | 'unlink', filePath: string) => void): () => void;
}
//# sourceMappingURL=store.d.ts.map