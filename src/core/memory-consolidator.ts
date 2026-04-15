import type { ConversationMessage } from '../types/conversation.js'
import type { LLMAdapter, LLMMessage } from '../types/adapter.js'
import type { SegmentationResult, BlockOperation, ConsolidationResult } from '../types/block.js'
import type { QdrantStore } from './qdrant-store.js'
import type { DirectoryManager } from './directory-manager.js'
import { extractJsonObject, extractJsonArray } from './json-utils.js'

function generateBlockId(): string {
  const ts = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 8)
  return `blk_${ts}_${rand}`
}

const TOPIC_SEGMENTATION_PROMPT = `你是一个对话分析助手。你的任务是分析一段对话，判断其中是否包含多个不相关的话题。

## 不相关的定义
两个话题"不相关"指的是：用户在未来某次对话中，几乎不可能在同一条消息中同时提到这两个话题的关键词。

## 判断示例

✅ 需要拆分（完全不相关）：
- "Vue迁移React的技术讨论" 和 "周末看电影" → 技术和娱乐完全无关
- "用户的工作经历" 和 "用户的宠物名字" → 职业和宠物无关
- "编程问题" 和 "旅行计划" → 工作和休闲无关

❌ 不需要拆分（有内在关联）：
- "React组件设计" 和 "React状态管理" → 同属React技术栈
- "用户自我介绍" 和 "用户提到家人" → 同属个人信息
- "项目架构讨论" 和 "项目部署方案" → 同一项目的不同方面
- "讨论Rust" 和 "讨论Rust的所有权系统" → 同一话题的深入

## 注意
- 礼貌用语（"谢谢"、"好的"、"嗯"）不构成独立话题，忽略它们
- 短暂的过渡句（"对了"、"换个话题"）是话题切换的信号，不是话题本身
- 如果整段对话围绕一个大话题的不同方面，视为一个话题组

## 输出格式
输出JSON，严格遵循以下结构：
{
  "segments": [
    {
      "messageIndices": [0, 1, 2, 3],
      "topicHint": "一句话描述这组消息的核心话题"
    }
  ]
}

messageIndices 是消息在输入列表中的索引（从0开始）。
如果所有消息属于同一个话题，segments 只有一个元素，messageIndices 包含全部索引。
只输出JSON，不要输出任何其他内容。`

const CONSOLIDATION_PROMPT = `你是一个记忆整合助手。你将收到一组属于同一话题的对话消息，以及当前的记忆目录结构。你的任务是将对话中的有价值信息整合为记忆区块。

## 现有记忆目录
{directoryTree}

## 已有区块详情（可能与本次对话相关的区块）
{relatedBlocks}

## 整合规则

### 1. 判断动作
- "create"：这是一个全新的话题，现有目录中没有相关区块。创建新的记忆区块。
- "update"：现有目录中已有相关区块，本次对话提供了新的或更新的信息。更新该区块。
- "ignore"：这段对话没有值得长期记住的信息（闲聊、问候、重复信息）。

### 2. 目录分类
将记忆归入合适的分类路径。优先使用现有分类，只在确实不匹配时创建新分类。
路径格式：大类/子类
例如：技术经验/React相关、用户信息/基本信息

分类原则：
- 每个大类下的子类控制在10个以内
- 目录路径最多2层（大类/子类），具体条目是第3层由directoryEntry字段体现
- 同类信息必须归入同一个大类

### 3. 关键词句设计（最重要的部分）
你需要输出5-10个关键词句，这些词句将被向量化用于后续的记忆召回匹配。

关键词句设计原则：
- 站在"用户未来会怎么问"的角度来设计
- 全面拆解表层语义、深层意图、关联历史维度、上下文相关方向，穷尽所有可被用于检索关联点，不要泛泛的词
- 每个关键词句应该是一个完整的短语或短句，能独立表达一个信息点
- 覆盖不同的表述角度
- 避免使用只在当前对话中出现的临时表述

好的关键词句示例：
- "从Vue迁移到React花了两个月"
- "Redux和Vuex状态管理思路差异"
- "React函数组件比类组件更受用户偏好"

差的关键词句示例：
- "迁移"（太泛）
- "用户说React"（没有信息量）
- "上面讨论的前端框架"（依赖上下文，脱离对话后无意义）

### 4. 摘要质量
summary应该：
- 结构化呈现，保留所有有价值的事实细节（时间、数量、名称、结论等）
- 自包含，不需要原始对话即可理解
- 不丢失任何可能在未来有用的信息
- 用列表、小标题等格式组织，方便快速浏览

### 5. 重要度评定
为每个记忆区块评定重要度：
- "critical"：用户的核心身份信息（姓名、基本性格、核心价值观、关键人际关系等）
- "high"：重要的长期知识（工作技能、重要经历、长期偏好、重大决策）
- "normal"：普通信息（项目细节、临时讨论、一般性经验）
- "low"：低价值信息（日常闲聊中的非关键细节、已知的重复信息）

评定原则：
- 宁可偏高不要偏低，信息丢失比信息冗余代价更大
- 用户主动分享的个人信息通常至少是"high"
- 任何涉及用户身份认同的信息至少是"high"
- 纯技术讨论的细节通常是"normal"
- 临时性的、过程性的信息可以是"low"

## 输出格式
输出JSON数组，每个元素代表一个记忆区块的操作：
[
  {
    "action": "create" | "update" | "ignore",
    "targetBlockId": "现有区块的blockId（仅action为update时需要）",
    "updateStrategy": "incremental" | "replace"（仅action为update时需要）",
    "block": {
      "directoryEntry": "一句话总结，用作目录条目",
      "category": "大类名称",
      "subCategory": "子类名称",
      "keywords": [
        "关键词句1",
        "关键词句2",
        "关键词句3"
      ],
      "summary": "结构化的记忆总结，保留所有事实细节",
      "importance": "critical" | "high" | "normal" | "low"
    }
  }
]

只输出JSON数组，不要输出任何其他内容。`

export class MemoryConsolidator {
  private llm: LLMAdapter
  private store: QdrantStore
  private directoryManager: DirectoryManager

  constructor(llm: LLMAdapter, store: QdrantStore, directoryManager: DirectoryManager) {
    this.llm = llm
    this.store = store
    this.directoryManager = directoryManager
  }

  async consolidate(messages: ConversationMessage[]): Promise<ConsolidationResult> {
    if (messages.length === 0) {
      return { created: 0, updated: 0, deleted: 0, skipped: 0 }
    }

    console.log(`[Consolidator] Starting consolidation with ${messages.length} messages`)

    const directoryTree = await this.directoryManager.buildDirectoryTreeText()

    let relatedBlocks = ''
    try {
      const allEntries = await this.directoryManager.getEntries()
      if (allEntries.length > 0) {
        relatedBlocks = allEntries
          .slice(0, 20)
          .map(e => `- [${e.blockId}] ${e.directoryEntry} (${e.importance}): ${e.summary}`)
          .join('\n')
      }
    } catch {
      // best effort
    }

    const segmentation = await this.segmentTopics(messages)
    console.log(`[Consolidator] Segmented into ${segmentation.segments.length} segments`)

    let created = 0
    let updated = 0
    let skipped = 0

    for (const segment of segmentation.segments) {
      const segmentMessages = segment.messageIndices
        .filter(i => i < messages.length)
        .map(i => messages[i])

      if (segmentMessages.length === 0) continue

      const operations = await this.integrateSegment(segmentMessages, directoryTree, relatedBlocks)
      console.log(`[Consolidator] Segment "${segment.topicHint}": ${operations.length} operations:`, operations.map(o => o.action))

      for (const op of operations) {
        if (op.action === 'ignore') {
          skipped++
          continue
        }

        try {
          if (op.action === 'create' && op.block) {
            const blockId = generateBlockId()
            await this.writeBlock(blockId, op.block, segmentMessages)
            created++
            console.log(`[Consolidator] Created block ${blockId}: "${op.block.directoryEntry}"`)
          } else if (op.action === 'update' && op.block && op.targetBlockId) {
            await this.updateBlock(op.targetBlockId, op.block, op.updateStrategy ?? 'incremental', segmentMessages)
            updated++
            console.log(`[Consolidator] Updated block ${op.targetBlockId}: "${op.block.directoryEntry}"`)
          } else {
            console.warn('[Consolidator] Invalid operation:', op)
            skipped++
          }
        } catch (err) {
          console.warn(`[Consolidator] Failed to ${op.action} block:`, err)
          skipped++
        }
      }
    }

    console.log(`[Consolidator] Done: created=${created}, updated=${updated}, skipped=${skipped}`)
    return { created, updated, deleted: 0, skipped }
  }

  private async segmentTopics(messages: ConversationMessage[]): Promise<SegmentationResult> {
    const conversationText = messages
      .map((m, i) => `[${i}] [${m.role}]: ${m.content}`)
      .join('\n')

    const llmMessages: LLMMessage[] = [
      { role: 'system', content: TOPIC_SEGMENTATION_PROMPT },
      { role: 'user', content: conversationText },
    ]

    const response = await this.llm.chat(llmMessages, { temperature: 0.3 })
    console.log(`[Consolidator] Segmentation response (first 300 chars): ${response.content.slice(0, 300)}`)
    return this.parseSegmentation(response.content)
  }

  private parseSegmentation(content: string): SegmentationResult {
    const jsonStr = extractJsonObject(content)
    if (!jsonStr) {
      return { segments: [{ messageIndices: [0], topicHint: 'default' }] }
    }

    try {
      const parsed = JSON.parse(jsonStr)
      if (parsed.segments && Array.isArray(parsed.segments)) {
        return parsed as SegmentationResult
      }
    } catch {
      // fall through
    }

    return { segments: [{ messageIndices: [0], topicHint: 'default' }] }
  }

  private async integrateSegment(messages: ConversationMessage[], directoryTree: string, relatedBlocks: string): Promise<BlockOperation[]> {
    const conversationText = messages
      .map(m => `[${m.role}]: ${m.content}`)
      .join('\n')

    const prompt = CONSOLIDATION_PROMPT
      .replace('{directoryTree}', directoryTree)
      .replace('{relatedBlocks}', relatedBlocks || '（无已有区块）')

    const llmMessages: LLMMessage[] = [
      { role: 'system', content: prompt },
      { role: 'user', content: conversationText },
    ]

    const response = await this.llm.chat(llmMessages, { temperature: 0.3 })
    console.log(`[Consolidator] LLM response for integration (first 500 chars): ${response.content.slice(0, 500)}`)
    return this.parseOperations(response.content)
  }

  private parseOperations(content: string): BlockOperation[] {
    const jsonStr = extractJsonArray(content)
    if (!jsonStr) return [{ action: 'ignore' }]

    try {
      const parsed = JSON.parse(jsonStr)
      if (Array.isArray(parsed)) {
        return parsed.filter(op =>
          typeof op === 'object' && op !== null && typeof op.action === 'string'
        )
      }
    } catch {
      // fall through
    }

    return [{ action: 'ignore' }]
  }

  private async writeBlock(
    blockId: string,
    block: NonNullable<BlockOperation['block']>,
    messages: ConversationMessage[],
  ): Promise<void> {
    const rawContent = messages.map(m => `[${m.role}]: ${m.content}`).join('\n')
    const conversationId = messages[0]?.timestamp?.toString()

    await this.store.writeRawContext(
      blockId, rawContent,
      block.directoryEntry, block.category, block.subCategory,
      block.summary, block.importance, conversationId,
    )

    await this.store.writeKeywordAnchors(
      blockId, block.keywords,
      block.directoryEntry, block.category, block.subCategory,
      block.summary, block.importance,
    )

    await this.store.writeDirectoryEntry(
      blockId, block.directoryEntry,
      block.category, block.subCategory,
      block.summary, block.keywords, block.importance,
      1 + block.keywords.length,
    )
  }

  private async updateBlock(
    blockId: string,
    block: NonNullable<BlockOperation['block']>,
    strategy: 'incremental' | 'replace',
    messages: ConversationMessage[],
  ): Promise<void> {
    const rawContent = messages.map(m => `[${m.role}]: ${m.content}`).join('\n')

    if (strategy === 'replace') {
      await this.store.deleteBlock(blockId)
    } else {
      await this.store.deleteKeywordAnchors(blockId)
      await this.store.deleteDirectoryEntry(blockId)
    }

    await this.store.writeRawContext(
      blockId, rawContent,
      block.directoryEntry, block.category, block.subCategory,
      block.summary, block.importance,
    )

    await this.store.writeKeywordAnchors(
      blockId, block.keywords,
      block.directoryEntry, block.category, block.subCategory,
      block.summary, block.importance,
    )

    const existingData = await this.store.assembleBlockData(blockId)
    const rawContextCount = existingData ? existingData.rawContents.length : 1
    await this.store.writeDirectoryEntry(
      blockId, block.directoryEntry,
      block.category, block.subCategory,
      block.summary, block.keywords, block.importance,
      rawContextCount + block.keywords.length,
    )
  }
}
