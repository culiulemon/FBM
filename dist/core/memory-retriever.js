import { NodeLocator, parseMarkdown } from './node-locator.js';
import { VectorIndex } from './vector-index.js';
import { readFile } from 'node:fs/promises';
const SUMMARIZE_PROMPT = `You are a memory summarization assistant. Given the user's query and retrieved document fragments, summarize the relevant information concisely.
Rules:
- Only include information directly relevant to the query
- Be concise but comprehensive
- If fragments are from different topics, organize them logically
- Output in the same language as the query`;
export class MemoryRetriever {
    indexEngine;
    keywordExtractor;
    nodeLocator;
    vectorIndex;
    llm;
    topK;
    maxTokens;
    constructor(deps) {
        this.indexEngine = deps.indexEngine;
        this.keywordExtractor = deps.keywordExtractor;
        this.nodeLocator = deps.nodeLocator ?? new NodeLocator();
        this.vectorIndex = deps.vectorIndex ?? new VectorIndex();
        this.llm = deps.llm ?? null;
        this.topK = deps.topK ?? 10;
        this.maxTokens = deps.maxTokens ?? 2000;
    }
    async retrieve(query) {
        const keywords = await this.keywordExtractor.extract(query);
        const expandedKeywords = await this.keywordExtractor.expand(keywords);
        const keywordResults = this.indexEngine.search(expandedKeywords);
        const keywordRetrievals = await this.resolveResults(keywordResults.slice(0, this.topK), 'keyword');
        let vectorRetrievals = [];
        if (this.vectorIndex.enabled) {
            try {
                const vectorResults = await this.vectorIndex.searchByText(query, this.topK);
                vectorRetrievals = await this.resolveVectorResults(vectorResults);
            }
            catch {
                // vector search failed, continue with keyword results only
            }
        }
        return this.mergeResults(keywordRetrievals, vectorRetrievals);
    }
    async summarize(query, results) {
        if (!this.llm || results.length === 0) {
            return {
                query,
                results,
                summary: results.map(r => r.content).join('\n\n---\n\n'),
                tokenCount: this.estimateTokens(results.map(r => r.content).join('')),
            };
        }
        const fragments = results
            .slice(0, 5)
            .map((r, i) => `[Fragment ${i + 1}] (${r.nodeRef.title})\n${r.content}`)
            .join('\n\n');
        const messages = [
            { role: 'system', content: SUMMARIZE_PROMPT },
            { role: 'user', content: `Query: ${query}\n\nRetrieved fragments:\n${fragments}` },
        ];
        const response = await this.llm.chat(messages, { maxTokens: this.maxTokens });
        return {
            query,
            results,
            summary: response.content,
            tokenCount: response.usage?.totalTokens ?? this.estimateTokens(response.content),
        };
    }
    async retrieveAndSummarize(query) {
        const results = await this.retrieve(query);
        if (results.length === 0) {
            return { query, results: [], summary: '', tokenCount: 0 };
        }
        return this.summarize(query, results);
    }
    async resolveResults(nodeRefs, source) {
        const results = [];
        for (const ref of nodeRefs) {
            try {
                const content = await this.resolveNodeContent(ref);
                results.push({
                    nodeRef: ref,
                    content,
                    score: 1.0,
                    source,
                });
            }
            catch {
                // skip unresolvable nodes
            }
        }
        return results;
    }
    async resolveVectorResults(vectorResults) {
        const results = [];
        for (const vr of vectorResults) {
            const ref = {
                filePath: vr.entry.ref.filePath,
                headingPath: vr.entry.ref.headingPath,
                lineStart: vr.entry.ref.lineStart,
                lineEnd: vr.entry.ref.lineEnd,
                title: vr.entry.ref.title,
                depth: vr.entry.ref.headingPath.length,
                createdAt: vr.entry.createdAt,
                updatedAt: vr.entry.createdAt,
            };
            try {
                const content = await this.resolveNodeContent(ref);
                results.push({
                    nodeRef: ref,
                    content,
                    score: vr.score,
                    source: 'vector',
                });
            }
            catch {
                results.push({
                    nodeRef: ref,
                    content: vr.entry.content,
                    score: vr.score,
                    source: 'vector',
                });
            }
        }
        return results;
    }
    async resolveNodeContent(ref) {
        const fileContent = await readFile(ref.filePath, 'utf-8');
        if (ref.headingPath.length > 0) {
            const headings = parseMarkdown(fileContent, ref.filePath);
            const node = this.nodeLocator.locateByHeadingPath(headings, ref.headingPath);
            if (node) {
                return this.nodeLocator.extractContent(node);
            }
        }
        const lines = fileContent.split('\n');
        return lines.slice(ref.lineStart, ref.lineEnd + 1).join('\n');
    }
    mergeResults(keywordResults, vectorResults) {
        const seen = new Map();
        for (const r of keywordResults) {
            const key = `${r.nodeRef.filePath}:${r.nodeRef.headingPath.join('/')}`;
            seen.set(key, { ...r, source: r.source });
        }
        for (const r of vectorResults) {
            const key = `${r.nodeRef.filePath}:${r.nodeRef.headingPath.join('/')}`;
            const existing = seen.get(key);
            if (existing) {
                existing.score = Math.max(existing.score, r.score);
                existing.source = 'both';
            }
            else {
                seen.set(key, r);
            }
        }
        return [...seen.values()].sort((a, b) => b.score - a.score);
    }
    estimateTokens(text) {
        return Math.ceil(text.length / 4);
    }
}
//# sourceMappingURL=memory-retriever.js.map