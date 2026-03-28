import { MemoryType } from '../types/memory.js';
import { NodeLocator } from './node-locator.js';
const SHOULD_REMEMBER_PROMPT = `You are a memory gatekeeper. Given the conversation context, determine if there is information worth remembering long-term.

Rules:
- User preferences, technical decisions, project context are worth remembering
- Greetings, acknowledgments, simple Q&A are not worth remembering
- If yes, extract the information briefly

Output a JSON object:
- "shouldRemember": boolean
- "type": one of "knowledge", "experience", "preference", "event", "project" (only if shouldRemember is true)
- "title": concise title (only if shouldRemember is true)
- "content": extracted info as markdown (only if shouldRemember is true)
Output ONLY a JSON object, nothing else.`;
export class DynamicMemory {
    retriever;
    store;
    llm;
    config;
    nodeLocator;
    recentContext = [];
    lastRetrievedAt = 0;
    retrievalCooldownMs = 5000;
    constructor(deps) {
        this.retriever = deps.retriever;
        this.store = deps.store;
        this.llm = deps.llm ?? null;
        this.config = deps.config;
        this.nodeLocator = new NodeLocator();
    }
    async onUserMessage(message) {
        if (!this.config.enabled)
            return [];
        this.recentContext.push(message);
        if (this.recentContext.length > 20) {
            this.recentContext = this.recentContext.slice(-20);
        }
        const injections = [];
        const now = Date.now();
        if (now - this.lastRetrievedAt < this.retrievalCooldownMs)
            return injections;
        try {
            const summary = await this.retriever.retrieveAndSummarize(message.content);
            if (summary.summary && summary.results.length > 0) {
                this.lastRetrievedAt = now;
                const sources = summary.results.map(r => r.nodeRef.title);
                const injection = {
                    type: this.config.injectAsSystem ? 'system' : 'context',
                    content: `[Relevant Memory]\n${summary.summary}`,
                    sources,
                };
                injections.push(injection);
            }
        }
        catch {
            // retrieval failed, non-blocking
        }
        return injections;
    }
    async onAssistantMessage(message) {
        if (!this.config.enabled || !this.llm)
            return;
        this.recentContext.push(message);
        if (this.recentContext.length > 20) {
            this.recentContext = this.recentContext.slice(-20);
        }
        const recentMessages = this.recentContext.slice(-6);
        const contextText = recentMessages.map(m => `[${m.role}]: ${m.content}`).join('\n');
        try {
            const messages = [
                { role: 'system', content: SHOULD_REMEMBER_PROMPT },
                { role: 'user', content: contextText },
            ];
            const response = await this.llm.chat(messages, { temperature: 0, maxTokens: 500 });
            const jsonMatch = response.content.trim().match(/\{[\s\S]*\}/);
            if (!jsonMatch)
                return;
            const parsed = JSON.parse(jsonMatch[0]);
            if (!parsed.shouldRemember)
                return;
            const typeMap = {
                knowledge: MemoryType.Knowledge,
                experience: MemoryType.Experience,
                preference: MemoryType.Preference,
                event: MemoryType.Event,
                project: MemoryType.Project,
            };
            await this.store.write({
                type: typeMap[parsed.type] ?? MemoryType.Knowledge,
                title: parsed.title,
                content: parsed.content,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            });
        }
        catch {
            // auto-memory failed, non-blocking
        }
    }
    getContextMessages() {
        return [];
    }
    reset() {
        this.recentContext = [];
        this.lastRetrievedAt = 0;
    }
}
//# sourceMappingURL=dynamic-memory.js.map