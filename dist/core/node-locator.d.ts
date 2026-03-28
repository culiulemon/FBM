import type { HeadingNode, CodeBlockNode } from '../types/memory.js';
export declare function normalizeTitle(title: string): string;
export declare function levenshteinDistance(a: string, b: string): number;
export declare function fuzzyMatchTitle(normalized: string, target: string, maxDistance?: number): boolean;
export declare function parseMarkdown(content: string, filePath: string): HeadingNode[];
export declare class NodeLocator {
    locateByHeadingPath(headings: HeadingNode[], path: string[]): HeadingNode | null;
    private findInTree;
    extractContent(node: HeadingNode): string;
    locateCodeBlocks(headings: HeadingNode[], options?: {
        language?: string;
        index?: number;
        underHeading?: string;
    }): CodeBlockNode[];
    private collectCodeBlocks;
    searchFiles(rootDir: string, pattern?: string): Promise<string[]>;
    private scanDir;
}
//# sourceMappingURL=node-locator.d.ts.map