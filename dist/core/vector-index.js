import { readFile, writeFile } from 'node:fs/promises';
function entryId(ref) {
    return `${ref.filePath}:${ref.headingPath.join('/')}:${ref.lineStart}-${ref.lineEnd}`;
}
export class VectorIndex {
    store;
    embedding;
    cacheFile;
    batchSize;
    constructor(embedding, cacheFile, batchSize) {
        this.embedding = embedding ?? null;
        this.cacheFile = cacheFile;
        this.batchSize = batchSize ?? 20;
        this.store = {
            entries: new Map(),
            dimension: 0,
            lastUpdated: 0,
        };
    }
    get enabled() {
        return this.embedding !== null;
    }
    async load() {
        if (!this.cacheFile)
            return;
        try {
            const content = await readFile(this.cacheFile, 'utf-8');
            const serialized = JSON.parse(content);
            this.store.dimension = serialized.dimension;
            this.store.lastUpdated = serialized.lastUpdated;
            this.store.entries = new Map();
            for (const [id, entry] of Object.entries(serialized.entries)) {
                this.store.entries.set(id, entry);
            }
        }
        catch {
            // cache invalid or missing
        }
    }
    async save() {
        if (!this.cacheFile)
            return;
        const serialized = {
            dimension: this.store.dimension,
            lastUpdated: this.store.lastUpdated,
            entries: {},
        };
        for (const [id, entry] of this.store.entries) {
            serialized.entries[id] = entry;
        }
        try {
            await writeFile(this.cacheFile, JSON.stringify(serialized), 'utf-8');
        }
        catch {
            // cache write failure is non-critical
        }
    }
    async addEntries(items) {
        if (!this.embedding)
            return [];
        const entries = [];
        for (let i = 0; i < items.length; i += this.batchSize) {
            const batch = items.slice(i, i + this.batchSize);
            const texts = batch.map(b => b.content);
            const response = await this.embedding.embed(texts);
            for (let j = 0; j < batch.length; j++) {
                const id = entryId(batch[j].ref);
                const entry = {
                    id,
                    vector: response.embeddings[j],
                    ref: batch[j].ref,
                    content: batch[j].content,
                    createdAt: Date.now(),
                };
                this.store.entries.set(id, entry);
                entries.push(entry);
                if (this.store.dimension === 0) {
                    this.store.dimension = response.embeddings[j].length;
                }
            }
        }
        this.store.lastUpdated = Date.now();
        await this.save();
        return entries;
    }
    async removeByFile(filePath) {
        for (const [id, entry] of this.store.entries) {
            if (entry.ref.filePath === filePath) {
                this.store.entries.delete(id);
            }
        }
        this.store.lastUpdated = Date.now();
        await this.save();
    }
    async search(queryVector, topK = 5, minScore = 0.5) {
        const results = [];
        for (const entry of this.store.entries.values()) {
            const score = cosineSimilarity(queryVector, entry.vector);
            if (score >= minScore) {
                results.push({ entry, score });
            }
        }
        results.sort((a, b) => b.score - a.score);
        return results.slice(0, topK);
    }
    async searchByText(text, topK = 5, minScore = 0.5) {
        if (!this.embedding)
            return [];
        const response = await this.embedding.embed([text]);
        return this.search(response.embeddings[0], topK, minScore);
    }
    get dimension() {
        return this.store.dimension;
    }
    get size() {
        return this.store.entries.size;
    }
}
function cosineSimilarity(a, b) {
    if (a.length !== b.length || a.length === 0)
        return 0;
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dotProduct / denom;
}
//# sourceMappingURL=vector-index.js.map