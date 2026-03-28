import type { HeadingNode } from './memory.js';
export interface NodeRef {
    filePath: string;
    headingPath: string[];
    lineStart: number;
    lineEnd: number;
    title: string;
    depth: number;
    createdAt: number;
    updatedAt: number;
}
export interface HeadingIndex {
    filePath: string;
    heading: HeadingNode;
    nodeRef: NodeRef;
}
export interface KeywordEntry {
    token: string;
    refs: NodeRef[];
    frequency: number;
}
export interface KeywordMap {
    [token: string]: KeywordEntry;
}
export interface MemoryIndex {
    version: string;
    files: Map<string, HeadingIndex[]>;
    keywords: KeywordMap;
    totalNodes: number;
    lastUpdated: number;
}
export interface SerializedIndex {
    version: string;
    files: Record<string, SerializedHeadingIndex[]>;
    keywords: Record<string, SerializedKeywordEntry>;
    totalNodes: number;
    lastUpdated: number;
}
export interface SerializedHeadingIndex {
    filePath: string;
    heading: {
        type: 'heading';
        level: number;
        title: string;
        normalizedTitle: string;
        lineStart: number;
        lineEnd: number;
        content: string;
    };
    nodeRef: {
        filePath: string;
        headingPath: string[];
        lineStart: number;
        lineEnd: number;
        title: string;
        depth: number;
        createdAt: number;
        updatedAt: number;
    };
}
export interface SerializedKeywordEntry {
    token: string;
    refs: NodeRef[];
    frequency: number;
}
//# sourceMappingURL=index.d.ts.map