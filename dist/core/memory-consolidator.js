import { MemoryType } from '../types/memory.js';
import { NodeLocator } from './node-locator.js';
const CONSOLIDATION_PROMPT = `You are a memory consolidation assistant. Analyze the conversation and extract information worth remembering long-term.

For each piece of valuable information, output a JSON object with:
- "type": one of "knowledge", "experience", "preference", "event", "project"
- "title": a concise, descriptive title (2-8 words, meaningful for future retrieval)
- "content": the extracted information as structured markdown

Rules:
- Extract factual knowledge, lessons learned, user preferences, important decisions
- Skip trivial small talk, greetings, acknowledgments
- If multiple pieces are unrelated, output multiple objects as a JSON array
- Title should be descriptive and searchable, not generic
- Content should be self-contained and understandable without the original conversation
- Output ONLY a JSON array, nothing else`;
const DEDUP_PROMPT = `You are a memory deduplication assistant. Given a new memory document and a list of existing similar memories, determine the best action.

Output a JSON object with:
- "action": "create" | "merge" | "skip"
- "mergeTarget": (only if action is "merge") the file path of the document to merge into
- "reason": brief explanation

If the new memory is mostly redundant with an existing one, choose "merge".
If the new memory adds significant new information to an existing topic, choose "merge".
If the new memory is entirely new content, choose "create".
If the new memory is trivial or already fully covered, choose "skip".
Output ONLY a JSON object, nothing else.`;
export class MemoryConsolidator {
    store;
    llm;
    config;
    nodeLocator;
    idleTimer = null;
    conversationBuffer = [];
    onConsolidated = null;
    constructor(store, llm, config) {
        this.store = store;
        this.llm = llm;
        this.config = config;
        this.nodeLocator = new NodeLocator();
    }
    onResult(callback) {
        this.onConsolidated = callback;
    }
    feedMessage(message) {
        if (!this.config.enabled)
            return;
        this.conversationBuffer.push(message);
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
        }
        this.idleTimer = setTimeout(() => {
            void this.consolidate();
        }, this.config.idleTimeoutMs);
    }
    async consolidate() {
        if (this.conversationBuffer.length < this.config.minConversationTurns) {
            return { memories: [], merged: 0, created: 0, skipped: 0 };
        }
        const messages = [...this.conversationBuffer];
        this.conversationBuffer = [];
        const conversationText = messages
            .map(m => `[${m.role}]: ${m.content}`)
            .join('\n');
        const llmMessages = [
            { role: 'system', content: CONSOLIDATION_PROMPT },
            { role: 'user', content: conversationText },
        ];
        let rawMemories;
        try {
            const response = await this.llm.chat(llmMessages, {
                maxTokens: this.config.maxSummaryTokens,
                temperature: 0.3,
            });
            const jsonMatch = response.content.trim().match(/\[[\s\S]*\]/);
            if (!jsonMatch) {
                return { memories: [], merged: 0, created: 0, skipped: 0 };
            }
            rawMemories = JSON.parse(jsonMatch[0]);
        }
        catch {
            return { memories: [], merged: 0, created: 0, skipped: 0 };
        }
        const result = { memories: [], merged: 0, created: 0, skipped: 0 };
        for (const raw of rawMemories) {
            const type = this.parseMemoryType(raw.type);
            const doc = {
                type,
                title: raw.title,
                content: raw.content,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            };
            const action = await this.deduplicate(doc);
            if (action === 'skip') {
                result.skipped++;
                continue;
            }
            if (action === 'merge' && doc.filePath) {
                try {
                    const existing = await this.store.read({ path: doc.filePath });
                    if (existing.length > 0) {
                        const mergedContent = `${existing[0].content}\n\n## ${raw.title}\n\n${raw.content}`;
                        await this.store.update(doc.filePath, mergedContent);
                        result.memories.push({ ...existing[0], content: mergedContent, updatedAt: Date.now() });
                        result.merged++;
                        continue;
                    }
                }
                catch {
                    // fall through to create
                }
            }
            try {
                const filePath = await this.store.write(doc);
                doc.filePath = filePath;
                result.memories.push(doc);
                result.created++;
            }
            catch {
                result.skipped++;
            }
        }
        this.onConsolidated?.(result);
        return result;
    }
    parseMemoryType(typeStr) {
        const map = {
            knowledge: MemoryType.Knowledge,
            experience: MemoryType.Experience,
            preference: MemoryType.Preference,
            event: MemoryType.Event,
            project: MemoryType.Project,
            custom: MemoryType.Custom,
        };
        return map[typeStr.toLowerCase()] ?? MemoryType.Knowledge;
    }
    async deduplicate(doc) {
        const similar = await this.store.read({ keyword: doc.title });
        if (similar.length === 0)
            return 'create';
        const topSimilar = similar.slice(0, 3);
        const existingSummaries = topSimilar
            .map((s, i) => `[${i}] "${s.title}" (path: ${s.filePath})\n${s.content.slice(0, 200)}`)
            .join('\n\n');
        try {
            const messages = [
                { role: 'system', content: DEDUP_PROMPT },
                {
                    role: 'user',
                    content: `New memory:\nTitle: "${doc.title}"\nContent: ${doc.content.slice(0, 300)}\n\nExisting similar memories:\n${existingSummaries}`,
                },
            ];
            const response = await this.llm.chat(messages, { temperature: 0, maxTokens: 200 });
            const jsonMatch = response.content.trim().match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                if (parsed.action === 'merge' && parsed.mergeTarget) {
                    doc.filePath = parsed.mergeTarget;
                    return 'merge';
                }
                if (parsed.action === 'skip')
                    return 'skip';
            }
        }
        catch {
            // dedup failed, create new
        }
        return 'create';
    }
    destroy() {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }
    }
}
//# sourceMappingURL=memory-consolidator.js.map