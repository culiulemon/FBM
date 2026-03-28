import type { ConversationMessage } from '../types/conversation.js';
import type { DynamicMemoryConfig } from '../types/config.js';
import type { LLMAdapter } from '../types/adapter.js';
import { MemoryRetriever } from './memory-retriever.js';
import { MemoryStore } from './store.js';
export interface MemoryInjection {
    type: 'system' | 'context';
    content: string;
    sources: string[];
}
export declare class DynamicMemory {
    private retriever;
    private store;
    private llm;
    private config;
    private nodeLocator;
    private recentContext;
    private lastRetrievedAt;
    private readonly retrievalCooldownMs;
    constructor(deps: {
        retriever: MemoryRetriever;
        store: MemoryStore;
        llm?: LLMAdapter;
        config: DynamicMemoryConfig;
    });
    onUserMessage(message: ConversationMessage): Promise<MemoryInjection[]>;
    onAssistantMessage(message: ConversationMessage): Promise<void>;
    getContextMessages(): MemoryInjection[];
    reset(): void;
}
//# sourceMappingURL=dynamic-memory.d.ts.map