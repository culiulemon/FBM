import type { NodeRef } from '../types/index.js'
import type { RetrievalResult, MemorySummary } from '../types/retrieval.js'
import type { LLMAdapter, LLMMessage } from '../types/adapter.js'
import { IndexEngine } from './index-engine.js'
import { KeywordExtractor } from './keyword-extractor.js'
import { NodeLocator, parseMarkdown } from './node-locator.js'
import { VectorIndex } from './vector-index.js'
import { readFile } from './fs-adapter.js'

const SUMMARIZE_PROMPT = `你是一名记忆筛选助手。根据用户的对话匹配有用的信息，禁止篡改记忆或输出带有歧义的内容，禁止任何形式的修改内容，需要找出直接相关的信息。输出内容需与查询使用相同语言，用户的问题不是问你的，你只需要把合适的记忆递交出来就行，不做回答`

export class MemoryRetriever {
  private indexEngine: IndexEngine
  private keywordExtractor: KeywordExtractor
  private nodeLocator: NodeLocator
  private vectorIndex: VectorIndex
  private llm: LLMAdapter | null
  private topK: number
  private refineResults: boolean

  constructor(deps: {
    indexEngine: IndexEngine
    keywordExtractor: KeywordExtractor
    nodeLocator?: NodeLocator
    vectorIndex?: VectorIndex
    llm?: LLMAdapter
    topK?: number
    refineResults?: boolean
  }) {
    this.indexEngine = deps.indexEngine
    this.keywordExtractor = deps.keywordExtractor
    this.nodeLocator = deps.nodeLocator ?? new NodeLocator()
    this.vectorIndex = deps.vectorIndex ?? new VectorIndex()
    this.llm = deps.llm ?? null
    this.topK = deps.topK ?? 10
    this.refineResults = deps.refineResults ?? true
  }

  async retrieve(query: string): Promise<{ results: RetrievalResult[]; keywords: string[]; expandedKeywords: string[] }> {
    let keywords: string[] = []
    try {
      keywords = await this.keywordExtractor.extract(query)
    } catch (err) {
      console.warn('[MemoryRetriever] keyword extract failed:', err)
      return { results: [], keywords: [], expandedKeywords: [] }
    }

    const keywordResults = this.indexEngine.search(keywords)

    const keywordRetrievals = await this.resolveResults(keywordResults.slice(0, this.topK), 'keyword')

    let vectorRetrievals: RetrievalResult[] = []
    if (this.vectorIndex.enabled && keywords.length > 0) {
      try {
        const vectorResults = await this.vectorIndex.searchByMultipleTexts(keywords, this.topK)
        vectorRetrievals = await this.resolveVectorResults(vectorResults)
      } catch (err) {
        console.warn('[MemoryRetriever] vector search failed:', err)
      }
    }

    const results = this.mergeResults(keywordRetrievals, vectorRetrievals)
    return { results, keywords, expandedKeywords: keywords }
  }

  async summarize(query: string, results: RetrievalResult[]): Promise<MemorySummary> {
    if (!this.refineResults || !this.llm || results.length === 0) {
      const joined = results.map(r => r.content).join('\n\n---\n\n')
      return {
        query,
        results,
        summary: joined,
        tokenCount: this.estimateTokens(joined),
      }
    }

    const fragments = results
      .slice(0, 5)
      .map((r, i) => `[Fragment ${i + 1}] (${r.nodeRef.title})\n${r.content}`)
      .join('\n\n')

    const messages: LLMMessage[] = [
      { role: 'system', content: SUMMARIZE_PROMPT },
      { role: 'user', content: `Query: ${query}\n\nRetrieved fragments:\n${fragments}` },
    ]

    const response = await this.llm.chat(messages)
    return {
      query,
      results,
      summary: response.content,
      tokenCount: response.usage?.totalTokens ?? this.estimateTokens(response.content),
    }
  }

  async retrieveAndSummarize(query: string): Promise<MemorySummary> {
    const { results, keywords, expandedKeywords } = await this.retrieve(query)
    if (results.length === 0) {
      return { query, results: [], summary: '', tokenCount: 0, keywords, expandedKeywords }
    }

    if (!this.refineResults) {
      const joined = results.map(r => r.content).join('\n\n---\n\n')
      return {
        query,
        results,
        summary: joined,
        tokenCount: this.estimateTokens(joined),
        keywords,
        expandedKeywords,
      }
    }

    const summarized = await this.summarize(query, results)
    return { ...summarized, keywords, expandedKeywords }
  }

  private async resolveResults(nodeRefs: NodeRef[], source: 'keyword' | 'vector' | 'both'): Promise<RetrievalResult[]> {
    const results: RetrievalResult[] = []
    for (const ref of nodeRefs) {
      try {
        const content = await this.resolveNodeContent(ref)
        results.push({
          nodeRef: ref,
          content,
          score: 1.0,
          source,
        })
      } catch {
        // skip unresolvable nodes
      }
    }
    return results
  }

  private async resolveVectorResults(vectorResults: Array<{ entry: import('../types/vector.js').VectorEntry; score: number }>): Promise<RetrievalResult[]> {
    const results: RetrievalResult[] = []
    for (const vr of vectorResults) {
      const ref: NodeRef = {
        filePath: vr.entry.ref.filePath,
        headingPath: vr.entry.ref.headingPath,
        lineStart: vr.entry.ref.lineStart,
        lineEnd: vr.entry.ref.lineEnd,
        title: vr.entry.ref.title,
        depth: vr.entry.ref.headingPath.length,
        createdAt: vr.entry.createdAt,
        updatedAt: vr.entry.createdAt,
      }
      try {
        const content = await this.resolveNodeContent(ref)
        results.push({
          nodeRef: ref,
          content,
          score: vr.score,
          source: 'vector',
        })
      } catch {
        results.push({
          nodeRef: ref,
          content: vr.entry.content,
          score: vr.score,
          source: 'vector',
        })
      }
    }
    return results
  }

  private async resolveNodeContent(ref: NodeRef): Promise<string> {
    const fileContent = await readFile(ref.filePath, 'utf-8')
    if (ref.headingPath.length > 0) {
      const headings = parseMarkdown(fileContent, ref.filePath)
      const node = this.nodeLocator.locateByHeadingPath(headings, ref.headingPath)
      if (node) {
        return this.nodeLocator.extractContent(node)
      }
    }
    const lines = fileContent.split('\n')
    return lines.slice(ref.lineStart, ref.lineEnd + 1).join('\n')
  }

  private mergeResults(keywordResults: RetrievalResult[], vectorResults: RetrievalResult[]): RetrievalResult[] {
    const seen = new Map<string, RetrievalResult>()

    for (const r of keywordResults) {
      const key = `${r.nodeRef.filePath}:${r.nodeRef.headingPath.join('/')}`
      seen.set(key, { ...r, source: r.source })
    }

    for (const r of vectorResults) {
      const key = `${r.nodeRef.filePath}:${r.nodeRef.headingPath.join('/')}`
      const existing = seen.get(key)
      if (existing) {
        existing.score = Math.max(existing.score, r.score)
        existing.source = 'both'
      } else {
        seen.set(key, r)
      }
    }

    return [...seen.values()].sort((a, b) => b.score - a.score)
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4)
  }
}
