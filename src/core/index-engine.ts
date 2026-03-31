import type { HeadingNode, MemoryNode } from '../types/memory.js'
import type {
  NodeRef,
  HeadingIndex,
  MemoryIndex,
  KeywordMap,
  KeywordEntry,
  SerializedIndex,
} from '../types/index.js'
import { NodeLocator, parseMarkdown } from './node-locator.js'
import { readFile, writeFile, stat } from './fs-adapter.js'
import { join } from './fs-adapter.js'

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'between', 'out', 'off', 'over',
  'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when',
  'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more',
  'most', 'other', 'some', 'such', 'no', 'not', 'only', 'own', 'same',
  'so', 'than', 'too', 'very', 'just', 'because', 'but', 'and', 'or',
  'if', 'while', 'about', 'up', 'it', 'its', 'this', 'that', 'these',
  'those', 'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'him',
  'his', 'she', 'her', 'they', 'them', 'their', 'what', 'which', 'who',
  '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都',
  '一', '一个', '上', '也', '很', '到', '说', '要', '去', '你',
  '会', '着', '没有', '看', '好', '自己', '这',
])

const INDEX_VERSION = '1.0.0'

function tokenize(text: string): string[] {
  const cleaned = text.toLowerCase().replace(/[^\w\s\u4e00-\u9fff]/g, ' ')
  const words = cleaned.split(/\s+/).filter(w => w.length > 1 && !STOP_WORDS.has(w))
  const tokens = new Set<string>()
  for (const word of words) {
    tokens.add(word)
    for (let i = 0; i < word.length - 1; i++) {
      const bigram = word.slice(i, i + 2)
      if (!STOP_WORDS.has(bigram)) tokens.add(bigram)
    }
  }
  return [...tokens]
}

export class IndexEngine {
  private index: MemoryIndex
  private nodeLocator: NodeLocator
  private memoryDir: string
  private cacheFile: string | undefined

  constructor(memoryDir: string, cacheFile?: string) {
    this.memoryDir = memoryDir
    this.cacheFile = cacheFile
    this.nodeLocator = new NodeLocator()
    this.index = {
      version: INDEX_VERSION,
      files: new Map(),
      keywords: {},
      totalNodes: 0,
      lastUpdated: 0,
    }
  }

  async build(): Promise<void> {
    await this.loadCache()
    const files = await this.nodeLocator.searchFiles(this.memoryDir)
    for (const filePath of files) {
      await this.indexFile(filePath)
    }
    this.index.lastUpdated = Date.now()
    await this.saveCache()
  }

  async indexFile(filePath: string): Promise<void> {
    try {
      const content = await readFile(filePath, 'utf-8')
      const fileStat = await stat(filePath)
      const headings = parseMarkdown(content, filePath)
      const headingIndices: HeadingIndex[] = []

      for (const heading of headings) {
        const nodeRef = this.createNodeRef(heading, filePath, fileStat.mtimeMs)
        const headingIndex: HeadingIndex = { filePath, heading, nodeRef }
        headingIndices.push(headingIndex)
        this.indexKeywords(heading, nodeRef)
      }

      this.index.files.set(filePath, headingIndices)
      this.index.totalNodes += headings.length
    } catch {
      // skip unreadable files
    }
  }

  async removeFile(filePath: string): Promise<void> {
    const existing = this.index.files.get(filePath)
    if (existing) {
      for (const hi of existing) {
        this.removeNodeRefKeywords(hi.nodeRef)
      }
      this.index.totalNodes -= existing.length
      this.index.files.delete(filePath)
      this.index.lastUpdated = Date.now()
      await this.saveCache()
    }
  }

  async updateFile(filePath: string): Promise<void> {
    await this.removeFile(filePath)
    await this.indexFile(filePath)
    this.index.lastUpdated = Date.now()
    await this.saveCache()
  }

  search(keywords: string[]): NodeRef[] {
    const refMap = new Map<string, { ref: NodeRef; score: number }>()

    for (const keyword of keywords) {
      const normalized = keyword.toLowerCase()
      for (const [token, entry] of Object.entries(this.index.keywords)) {
        if (token.includes(normalized) || normalized.includes(token)) {
          for (const ref of entry.refs) {
            const key = `${ref.filePath}:${ref.headingPath.join('/')}`
            const existing = refMap.get(key)
            const score = existing ? existing.score + entry.frequency : entry.frequency
            refMap.set(key, { ref, score })
          }
        }
      }
    }

    return [...refMap.values()]
      .sort((a, b) => b.score - a.score)
      .map(v => v.ref)
  }

  getIndex(): MemoryIndex {
    return this.index
  }

  private createNodeRef(heading: HeadingNode, filePath: string, mtimeMs: number): NodeRef {
    const headingPath = this.buildHeadingPath(heading)
    return {
      filePath,
      headingPath,
      lineStart: heading.lineStart,
      lineEnd: heading.lineEnd,
      title: heading.title,
      depth: heading.level,
      createdAt: mtimeMs,
      updatedAt: mtimeMs,
    }
  }

  private buildHeadingPath(heading: HeadingNode): string[] {
    const path: string[] = [heading.title]
    let current = heading
    while (current.children) {
      const childHeading = current.children.find((n): n is HeadingNode => n.type === 'heading')
      if (!childHeading) break
      path.push(childHeading.title)
      current = childHeading
    }
    return path
  }

  private indexKeywords(node: MemoryNode, ref: NodeRef): void {
    const text = this.extractAllText(node)
    const tokens = tokenize(text)
    for (const token of tokens) {
      if (!this.index.keywords[token]) {
        this.index.keywords[token] = { token, refs: [ref], frequency: 1 }
      } else {
        const entry = this.index.keywords[token]
        const exists = entry.refs.some(
          r => r.filePath === ref.filePath && r.headingPath.join('/') === ref.headingPath.join('/')
        )
        if (!exists) {
          entry.refs.push(ref)
        }
        entry.frequency++
      }
    }
  }

  private removeNodeRefKeywords(ref: NodeRef): void {
    for (const [token, entry] of Object.entries(this.index.keywords)) {
      entry.refs = entry.refs.filter(
        r => !(r.filePath === ref.filePath && r.headingPath.join('/') === ref.headingPath.join('/'))
      )
      if (entry.refs.length === 0) {
        delete this.index.keywords[token]
      }
    }
  }

  private extractAllText(node: MemoryNode): string {
    if (node.type === 'heading') {
      return node.title + ' ' + node.children.map(c => this.extractAllText(c)).join(' ')
    }
    return node.content
  }

  private async loadCache(): Promise<void> {
    if (!this.cacheFile) return
    try {
      const content = await readFile(this.cacheFile, 'utf-8')
      const serialized: SerializedIndex = JSON.parse(content)
      if (serialized.version !== INDEX_VERSION) return

      this.index.version = serialized.version
      this.index.totalNodes = serialized.totalNodes
      this.index.lastUpdated = serialized.lastUpdated
      this.index.keywords = serialized.keywords

      this.index.files = new Map()
      for (const [filePath, indices] of Object.entries(serialized.files)) {
        const headingIndices: HeadingIndex[] = indices.map(si => ({
          filePath: si.filePath,
          heading: {
            type: 'heading',
            level: si.heading.level as 1 | 2 | 3 | 4 | 5 | 6,
            title: si.heading.title,
            normalizedTitle: si.heading.normalizedTitle,
            lineStart: si.heading.lineStart,
            lineEnd: si.heading.lineEnd,
            content: si.heading.content,
            children: [],
          },
          nodeRef: si.nodeRef,
        }))
        this.index.files.set(filePath, headingIndices)
      }
    } catch {
      // cache invalid or missing, rebuild from scratch
    }
  }

  async saveCache(): Promise<void> {
    if (!this.cacheFile) return
    const serialized: SerializedIndex = {
      version: this.index.version,
      totalNodes: this.index.totalNodes,
      lastUpdated: this.index.lastUpdated,
      keywords: this.index.keywords,
      files: {},
    }
    for (const [filePath, indices] of this.index.files.entries()) {
      serialized.files[filePath] = indices.map(hi => ({
        filePath: hi.filePath,
        heading: {
          type: 'heading',
          level: hi.heading.level,
          title: hi.heading.title,
          normalizedTitle: hi.heading.normalizedTitle,
          lineStart: hi.heading.lineStart,
          lineEnd: hi.heading.lineEnd,
          content: hi.heading.content,
        },
        nodeRef: hi.nodeRef,
      }))
    }
    try {
      await writeFile(this.cacheFile, JSON.stringify(serialized), 'utf-8')
    } catch {
      // cache write failure is non-critical
    }
  }
}
