import type { LLMAdapter, LLMMessage } from '../types/adapter.js'
import type { MemorySummary, BlockRetrievalResult } from '../types/retrieval.js'
import type { QdrantStore } from './qdrant-store.js'
import type { DirectoryManager } from './directory-manager.js'
import type { BlockLifecycleManager } from './block-lifecycle.js'

const DIRECTORY_BROWSE_PROMPT = `你是一个记忆检索助手。以下是当前的记忆目录结构，请根据用户的查询，选择最相关的记忆分区。

## 记忆目录
{directoryText}

## 用户查询
{query}

## 输出格式
输出JSON，包含你选择的候选分区ID列表：
{
  "selectedBlockIds": ["block_id_1", "block_id_2"],
  "reasoning": "简述选择理由"
}

选择标准：
- 选择与用户查询话题最相关的分区
- 宁可多选不要漏选，可以选1-5个分区
- 如果没有任何相关分区，返回空数组

只输出JSON，不要输出任何其他内容。`

const REFINE_PROMPT = `你是一个记忆筛选助手。系统从记忆库中检索到了以下记忆内容，请根据当前对话上下文，筛选出与对话直接相关的信息。

## 当前对话上下文
{context}

## 检索到的记忆内容
{retrievedContent}

## 输出要求
1. 筛选出与当前对话直接相关的记忆信息
2. 去除无关的噪声内容
3. 用简洁、结构化的方式组织筛选结果
4. 保留所有可能有用的事实细节
5. 如果检索到的内容与当前对话完全无关，输出"无相关记忆"

直接输出筛选结果文本，不要输出JSON。`

export class MemoryRetriever {
  private llm: LLMAdapter
  private store: QdrantStore
  private directoryManager: DirectoryManager
  private lifecycle: BlockLifecycleManager
  private topK: number
  private minScore: number
  private refineResults: boolean

  constructor(
    llm: LLMAdapter,
    store: QdrantStore,
    directoryManager: DirectoryManager,
    lifecycle: BlockLifecycleManager,
    options?: { topK?: number; minScore?: number; refineResults?: boolean },
  ) {
    this.llm = llm
    this.store = store
    this.directoryManager = directoryManager
    this.lifecycle = lifecycle
    this.topK = options?.topK ?? 10
    this.minScore = options?.minScore ?? 0.3
    this.refineResults = options?.refineResults ?? true
  }

  async retrieve(query: string, context?: string): Promise<MemorySummary> {
    if (!query || query.trim().length === 0) {
      return { query, results: [], summary: '', tokenCount: 0 }
    }

    console.log('[Retriever] Starting retrieve for query:', query.slice(0, 100))

    const candidateBlockIds = await this.directoryPhase(query)
    console.log('[Retriever] directoryPhase returned', candidateBlockIds.length, 'candidates:', candidateBlockIds)

    const searchResults = await this.hybridSearchPhase(query, candidateBlockIds)
    console.log('[Retriever] hybridSearchPhase returned', searchResults.length, 'results')

    const blockIds = [...new Set(searchResults.map(r => r.blockId))]
    console.log('[Retriever] Unique blockIds:', blockIds)

    const fullBlocks = await this.fetchFullBlocks(blockIds)
    console.log('[Retriever] fetchFullBlocks returned', fullBlocks.length, 'blocks')

    for (const blockId of blockIds) {
      await this.lifecycle.onBlockAccessed(blockId).catch(() => {})
    }

    let summary: string
    if (this.refineResults && fullBlocks.length > 0) {
      summary = await this.refinePhase(query, fullBlocks, context)
    } else {
      summary = fullBlocks
        .map(b => `## ${b.directoryEntry}\n${b.summary}`)
        .join('\n\n')
    }

    const results: BlockRetrievalResult[] = searchResults.map(r => ({
      blockId: r.blockId,
      directoryEntry: '',
      category: '',
      subCategory: '',
      content: r.keywordSentence,
      score: r.score,
      source: r.source,
    }))

    const keywords = [...new Set(searchResults.map(r => r.keywordSentence).filter(Boolean))]

    return {
      query,
      results,
      summary,
      tokenCount: summary.length,
      keywords,
    }
  }

  private async directoryPhase(query: string): Promise<string[]> {
    try {
      const directoryText = await this.directoryManager.getDirectoryTextForLLM()

      if (directoryText.includes('暂无记忆目录')) {
        return []
      }

      const prompt = DIRECTORY_BROWSE_PROMPT
        .replace('{directoryText}', directoryText)
        .replace('{query}', query)

      const messages: LLMMessage[] = [
        { role: 'system', content: prompt },
      ]

      const response = await this.llm.chat(messages, { temperature: 0.3 })
      const parsed = this.parseBlockIds(response.content)
      return parsed
    } catch {
      return []
    }
  }

  private parseBlockIds(content: string): string[] {
    const trimmed = content.trim()
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return []

    try {
      const parsed = JSON.parse(jsonMatch[0])
      if (Array.isArray(parsed.selectedBlockIds)) {
        return parsed.selectedBlockIds
          .map((id: unknown) => typeof id === 'string' ? id.replace(/^block:/, '') : id)
          .filter((id: unknown) => typeof id === 'string')
      }
    } catch {
      // fall through
    }
    return []
  }

  private async hybridSearchPhase(
    query: string,
    candidateBlockIds: string[],
  ): Promise<Array<{ blockId: string; keywordSentence: string; score: number; source: 'dense' | 'sparse' | 'hybrid' }>> {
    try {
      return await this.store.searchHybrid(query, candidateBlockIds, this.topK, this.minScore)
    } catch {
      try {
        const denseResults = await this.store.searchDenseOnly(query, candidateBlockIds, this.topK, this.minScore)
        return denseResults.map(r => ({
          blockId: r.blockId,
          keywordSentence: '',
          score: r.score,
          source: 'dense' as const,
        }))
      } catch {
        return []
      }
    }
  }

  private async fetchFullBlocks(blockIds: string[]): Promise<Array<{
    blockId: string
    directoryEntry: string
    summary: string
    rawContents: string[]
    keywordSentences: string[]
  }>> {
    const blocks = []
    for (const blockId of blockIds) {
      try {
        const data = await this.store.assembleBlockData(blockId)
        if (data) {
          blocks.push(data)
        }
      } catch {
        // skip failed blocks
      }
    }
    return blocks
  }

  private async refinePhase(
    query: string,
    blocks: Array<{ directoryEntry: string; summary: string; rawContents: string[] }>,
    context?: string,
  ): Promise<string> {
    const retrievedContent = blocks
      .map(b => `### ${b.directoryEntry}\n${b.summary}\n\n原始内容片段:\n${b.rawContents.slice(0, 3).join('\n')}`)
      .join('\n\n---\n\n')

    const prompt = REFINE_PROMPT
      .replace('{context}', context ?? query)
      .replace('{retrievedContent}', retrievedContent)

    const messages: LLMMessage[] = [
      { role: 'system', content: prompt },
    ]

    try {
      const response = await this.llm.chat(messages, { temperature: 0.3 })
      return response.content
    } catch {
      return retrievedContent
    }
  }
}
