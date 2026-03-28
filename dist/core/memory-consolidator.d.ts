import type { ConversationMessage } from '../types/conversation.js';
import type { ConsolidationResult } from '../types/retrieval.js';
import type { LLMAdapter } from '../types/adapter.js';
import type { ConsolidatorConfig } from '../types/config.js';
import { MemoryStore } from './store.js';
export declare class MemoryConsolidator {
    private store;
    private llm;
    private config;
    private nodeLocator;
    private idleTimer;
    private conversationBuffer;
    private onConsolidated;
    constructor(store: MemoryStore, llm: LLMAdapter, config: ConsolidatorConfig);
    onResult(callback: (result: ConsolidationResult) => void): void;
    feedMessage(message: ConversationMessage): void;
    consolidate(): Promise<ConsolidationResult>;
    private parseMemoryType;
    private deduplicate;
    destroy(): void;
}
//# sourceMappingURL=memory-consolidator.d.ts.map