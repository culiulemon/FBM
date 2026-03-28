import { MemoryStore } from './store.js';
import { IndexEngine } from './index-engine.js';
import { KeywordExtractor } from './keyword-extractor.js';
import { NodeLocator, parseMarkdown } from './node-locator.js';
import { MemoryRetriever } from './memory-retriever.js';
import { VectorIndex } from './vector-index.js';
import { MemoryConsolidator } from './memory-consolidator.js';
import { DynamicMemory } from './dynamic-memory.js';
import { readFile } from 'node:fs/promises';
export class FBM {
    config;
    store;
    indexEngine;
    keywordExtractor;
    nodeLocator;
    vectorIndex;
    retriever;
    consolidator;
    dynamicMemory;
    llm;
    embedding;
    unwatch = null;
    _initialized = false;
    constructor(config, llm, embedding) {
        this.config = config;
        this.llm = llm;
        this.embedding = embedding ?? null;
    }
    get initialized() {
        return this._initialized;
    }
    async init() {
        this.store = new MemoryStore(this.config.memoryDir, this.config.store);
        this.indexEngine = new IndexEngine(this.config.memoryDir, this.config.store?.indexCacheFile);
        this.keywordExtractor = new KeywordExtractor(this.llm);
        this.nodeLocator = new NodeLocator();
        this.vectorIndex = new VectorIndex(this.embedding ?? undefined, this.config.embedding?.vectorCacheFile, this.config.embedding?.batchSize);
        this.retriever = new MemoryRetriever({
            indexEngine: this.indexEngine,
            keywordExtractor: this.keywordExtractor,
            nodeLocator: this.nodeLocator,
            vectorIndex: this.vectorIndex,
            llm: this.llm,
            topK: this.config.dynamicMemory.retrievalTopK,
            maxTokens: this.config.dynamicMemory.maxContextTokens,
        });
        this.consolidator = new MemoryConsolidator(this.store, this.llm, this.config.consolidator);
        this.dynamicMemory = new DynamicMemory({
            retriever: this.retriever,
            store: this.store,
            llm: this.llm,
            config: this.config.dynamicMemory,
        });
        await this.store.init();
        await this.indexEngine.build();
        if (this.vectorIndex.enabled) {
            await this.vectorIndex.load();
            await this.rebuildVectors();
        }
        if (this.config.store?.watchFiles !== false) {
            this.unwatch = this.store.watch(async (event, filePath) => {
                if (event === 'unlink') {
                    await this.indexEngine.removeFile(filePath);
                    await this.vectorIndex.removeByFile(filePath);
                }
                else if (event === 'change' || event === 'add') {
                    await this.indexEngine.updateFile(filePath);
                }
            });
        }
        this.consolidator.onResult(async (result) => {
            for (const mem of result.memories) {
                if (mem.filePath) {
                    await this.indexEngine.indexFile(mem.filePath);
                    if (this.vectorIndex.enabled) {
                        await this.addVectorsForFile(mem.filePath);
                    }
                }
            }
        });
        this._initialized = true;
    }
    async retrieve(query) {
        this.ensureInitialized();
        return this.retriever.retrieveAndSummarize(query);
    }
    async onUserMessage(message) {
        this.ensureInitialized();
        this.consolidator.feedMessage(message);
        return this.dynamicMemory.onUserMessage(message);
    }
    async onAssistantMessage(message) {
        this.ensureInitialized();
        await this.dynamicMemory.onAssistantMessage(message);
    }
    getStore() {
        this.ensureInitialized();
        return this.store;
    }
    getIndexEngine() {
        this.ensureInitialized();
        return this.indexEngine;
    }
    getVectorIndex() {
        this.ensureInitialized();
        return this.vectorIndex;
    }
    getConsolidator() {
        this.ensureInitialized();
        return this.consolidator;
    }
    getDynamicMemory() {
        this.ensureInitialized();
        return this.dynamicMemory;
    }
    async shutdown() {
        this.consolidator.destroy();
        this.unwatch?.();
        this.dynamicMemory.reset();
        this._initialized = false;
    }
    ensureInitialized() {
        if (!this._initialized) {
            throw new Error('FBM is not initialized. Call init() first.');
        }
    }
    async rebuildVectors() {
        if (!this.vectorIndex.enabled || this.vectorIndex.size > 0)
            return;
        await this.addVectorsForDir(this.config.memoryDir);
    }
    async addVectorsForDir(dir) {
        const files = await this.nodeLocator.searchFiles(dir);
        for (const filePath of files) {
            await this.addVectorsForFile(filePath);
        }
    }
    async addVectorsForFile(filePath) {
        if (!this.embedding)
            return;
        try {
            const content = await readFile(filePath, 'utf-8');
            const headings = parseMarkdown(content, filePath);
            const items = headings.map((h) => ({
                ref: {
                    filePath,
                    headingPath: this.buildHeadingPath(h),
                    lineStart: h.lineStart,
                    lineEnd: h.lineEnd,
                    title: h.title,
                },
                content: this.nodeLocator.extractContent(h).slice(0, 1000),
            }));
            if (items.length > 0) {
                await this.vectorIndex.addEntries(items);
            }
        }
        catch {
            // skip unreadable files
        }
    }
    buildHeadingPath(heading) {
        const path = [heading.title];
        let current = heading;
        while (current.children) {
            const child = current.children.find((n) => n.type === 'heading');
            if (!child)
                break;
            path.push(child.title);
            current = child;
        }
        return path;
    }
}
//# sourceMappingURL=fbm.js.map