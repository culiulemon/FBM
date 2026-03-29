import type { HeadingNode, CodeBlockNode, MemoryNode } from '../types/memory.js'
import { readdirDetailed } from './fs-adapter.js'
import { join, extname } from './fs-adapter.js'

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[\s\u3000]+/g, ' ')
    .replace(/[^\w\s\u4e00-\u9fff]/g, '')
    .trim()
}

export function levenshteinDistance(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      )
    }
  }
  return dp[m][n]
}

export function fuzzyMatchTitle(normalized: string, target: string, maxDistance = 2): boolean {
  if (normalized === target) return true
  if (normalized.includes(target) || target.includes(normalized)) return true
  return levenshteinDistance(normalized, target) <= maxDistance
}

const HEADING_RE = /^(#{1,6})\s+(.+)$/
const CODE_FENCE_RE = /^```(\w*)\s*$/
const CODE_CLOSE_RE = /^```\s*$/
const LIST_RE = /^(\s*)([-*+]|\d+\.)\s+/

export function parseMarkdown(content: string, filePath: string): HeadingNode[] {
  const lines = content.split('\n')
  const rootHeadings: HeadingNode[] = []
  const headingStack: HeadingNode[] = []

  let i = 0
  let currentCodeBlock: { lang: string; startLine: number; lines: string[] } | null = null
  let currentParagraph: { startLine: number; lines: string[] } | null = null

  function flushParagraph(parent: HeadingNode | null) {
    if (!currentParagraph || currentParagraph.lines.length === 0) {
      currentParagraph = null
      return
    }
    const node: import('../types/memory.js').ParagraphNode = {
      type: 'paragraph',
      lineStart: currentParagraph.startLine,
      lineEnd: i - 1,
      content: currentParagraph.lines.join('\n'),
    }
    if (parent) {
      parent.children.push(node)
    }
    currentParagraph = null
  }

  function flushCodeBlock(parent: HeadingNode | null) {
    if (!currentCodeBlock) return
    const node: CodeBlockNode = {
      type: 'code',
      language: currentCodeBlock.lang,
      lineStart: currentCodeBlock.startLine,
      lineEnd: i - 1,
      content: currentCodeBlock.lines.join('\n'),
      raw: currentCodeBlock.lines.join('\n'),
    }
    if (parent) {
      parent.children.push(node)
    }
    currentCodeBlock = null
  }

  while (i < lines.length) {
    const line = lines[i]

    if (currentCodeBlock) {
      if (CODE_CLOSE_RE.test(line)) {
        flushCodeBlock(headingStack[headingStack.length - 1] ?? null)
      } else {
        currentCodeBlock.lines.push(line)
      }
      i++
      continue
    }

    const headingMatch = line.match(HEADING_RE)
    if (headingMatch) {
      flushParagraph(headingStack[headingStack.length - 1] ?? null)
      const level = headingMatch[1].length as 1 | 2 | 3 | 4 | 5 | 6
      const title = headingMatch[2].trim()
      const node: HeadingNode = {
        type: 'heading',
        level,
        title,
        normalizedTitle: normalizeTitle(title),
        lineStart: i,
        lineEnd: i,
        content: line,
        children: [],
      }

      while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
        headingStack.pop()
      }

      if (headingStack.length > 0) {
        headingStack[headingStack.length - 1].children.push(node)
      } else {
        rootHeadings.push(node)
      }
      headingStack.push(node)
      i++
      continue
    }

    const codeMatch = line.match(CODE_FENCE_RE)
    if (codeMatch) {
      flushParagraph(headingStack[headingStack.length - 1] ?? null)
      currentCodeBlock = { lang: codeMatch[1], startLine: i, lines: [] }
      i++
      continue
    }

    if (LIST_RE.test(line)) {
      flushParagraph(headingStack[headingStack.length - 1] ?? null)
      const parent = headingStack[headingStack.length - 1] ?? null
      const listLines: string[] = []
      const startLine = i
      while (i < lines.length && (LIST_RE.test(lines[i]) || lines[i].match(/^\s{2,}\S/))) {
        listLines.push(lines[i])
        i++
      }
      const node: import('../types/memory.js').ListNode = {
        type: 'list',
        lineStart: startLine,
        lineEnd: i - 1,
        content: listLines.join('\n'),
        ordered: /^\d+\./.test(listLines[0]),
        items: listLines.map(l => l.replace(/^\s*(?:[-*+]|\d+\.)\s+/, '').trim()),
      }
      if (parent) {
        parent.children.push(node)
      }
      continue
    }

    if (line.trim() === '') {
      flushParagraph(headingStack[headingStack.length - 1] ?? null)
      i++
      continue
    }

    if (!currentParagraph) {
      currentParagraph = { startLine: i, lines: [] }
    }
    currentParagraph.lines.push(line)
    i++
  }

  flushParagraph(headingStack[headingStack.length - 1] ?? null)
  flushCodeBlock(headingStack[headingStack.length - 1] ?? null)

  return rootHeadings
}

export class NodeLocator {
  locateByHeadingPath(headings: HeadingNode[], path: string[]): HeadingNode | null {
    if (path.length === 0) return null
    return this.findInTree(headings, path, 0)
  }

  private findInTree(headings: HeadingNode[], path: string[], depth: number): HeadingNode | null {
    if (depth >= path.length) return null
    const normalizedTarget = normalizeTitle(path[depth])

    for (const h of headings) {
      if (fuzzyMatchTitle(h.normalizedTitle, normalizedTarget)) {
        if (depth === path.length - 1) return h
        const childHeadings = h.children.filter(
          (n): n is HeadingNode => n.type === 'heading'
        )
        return this.findInTree(childHeadings, path, depth + 1)
      }

      const childHeadings = h.children.filter(
        (n): n is HeadingNode => n.type === 'heading'
      )
      const foundInChildren = this.findInTree(childHeadings, path, depth)
      if (foundInChildren) return foundInChildren
    }

    return null
  }

  extractContent(node: HeadingNode): string {
    const parts: string[] = [node.content]
    for (const child of node.children) {
      if (child.type === 'heading') {
        parts.push(this.extractContent(child))
      } else {
        parts.push(child.content)
      }
    }
    return parts.join('\n')
  }

  locateCodeBlocks(
    headings: HeadingNode[],
    options?: { language?: string; index?: number; underHeading?: string }
  ): CodeBlockNode[] {
    const blocks: CodeBlockNode[] = []
    this.collectCodeBlocks(headings, blocks, options?.underHeading ? normalizeTitle(options.underHeading) : undefined)

    let filtered = blocks
    if (options?.language) {
      filtered = filtered.filter(b => b.language === options.language)
    }
    if (options?.index !== undefined) {
      const idx = options.index < 0 ? filtered.length + options.index : options.index
      return filtered[idx] !== undefined ? [filtered[idx]] : []
    }
    return filtered
  }

  private collectCodeBlocks(nodes: MemoryNode[], result: CodeBlockNode[], headingFilter?: string): void {
    for (const node of nodes) {
      if (node.type === 'heading') {
        if (headingFilter === undefined || fuzzyMatchTitle(node.normalizedTitle, headingFilter)) {
          for (const child of node.children) {
            if (child.type === 'code') {
              result.push(child)
            } else if (child.type === 'heading') {
              this.collectCodeBlocks([child], result, headingFilter)
            }
          }
        } else {
          this.collectCodeBlocks(node.children, result, headingFilter)
        }
      }
    }
  }

  async searchFiles(rootDir: string, pattern?: string): Promise<string[]> {
    const results: string[] = []
    await this.scanDir(rootDir, results, pattern)
    return results
  }

  private async scanDir(dir: string, results: string[], pattern?: string): Promise<void> {
    let entries
    try {
      entries = await readdirDetailed(dir)
    } catch {
      return
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory) {
        await this.scanDir(fullPath, results, pattern)
      } else if (extname(entry.name) === '.md') {
        if (!pattern || entry.name.toLowerCase().includes(pattern.toLowerCase())) {
          results.push(fullPath)
        }
      }
    }
  }
}
