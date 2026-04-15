import type { LLMAdapter } from '../types/adapter.js'
import type { DirectoryEntry } from '../types/directory.js'
import type { ImportanceLevel } from '../types/block.js'
import type { QdrantStore } from './qdrant-store.js'
import type { DirectoryManager } from './directory-manager.js'
import type { BlockLifecycleManager } from './block-lifecycle.js'
import type {
  ReorganizeOperation,
  ReorganizationResult,
  ReorganizationProgress,
  ReorganizationCheckpoint,
  SplitAssignment,
  AnalysisResult,
  ReclassifyDecision,
} from '../types/reorganization.js'
import { extractJsonObject } from './json-utils.js'

const CHECKPOINT_KEY = 'fbm_reorganization_checkpoint'
const DIRTY_KEY = 'fbm_reorganization_dirty'

const ANALYSIS_PROMPT = `你是一个记忆整理助手。以下是分类「{categoryName}」下的所有记忆区块。请审查这些区块，找出需要整理的问题。

## 整理规则
1. **拆分**：如果一个区块包含了 2 个以上明显不相关的话题，标记为需要拆分
2. **合并**：如果多个区块讨论的是同一话题的不同方面，标记为需要合并
3. **疑似分类不当**：如果一个区块的话题明显不属于当前分类，标记为 needsReclassify（将在后续步骤中处理）
4. 不需要整理的区块不要输出

## 区块列表
{blocks}

## 输出格式
输出 JSON 对象：
{
  "operations": [
    {
      "action": "split",
      "blockId": "blk_xxx",
      "reason": "简述原因",
      "topicCount": 3
    },
    {
      "action": "merge",
      "blockIds": ["blk_aaa", "blk_bbb"],
      "reason": "简述原因"
    }
  ],
  "needsReclassify": [
    { "blockId": "blk_yyy", "reason": "该区块讨论的是旅行而非技术" }
  ]
}

如果没有需要整理的区块，输出 {"operations": [], "needsReclassify": []}。`

const RECLASSIFY_PROMPT = `你是一个记忆分类助手。以下是一些疑似分类不当的记忆区块，请结合完整分类目录，为每个区块指定正确的新分类。

## 完整分类目录
{fullDirectory}

## 疑似分类不当的区块
{suspiciousBlocks}

## 输出格式
输出 JSON 数组：
[
  {
    "blockId": "blk_yyy",
    "reason": "该区块讨论周末旅行计划",
    "newCategory": "生活",
    "newSubCategory": "旅行"
  }
]

如果某个区块的分类实际上是正确的，不要输出它。如果没有需要重分类的区块，输出空数组 []。`

const SPLIT_PROMPT = `你是一个记忆拆分助手。以下区块包含多个不相关话题，需要将其拆分为独立区块。

## 区块摘要
{summary}

## 关键词锚点
{keywords}

## 原始对话记录（共 {count} 条）
{rawContexts}

## 任务
1. 将每条原始对话记录分配到合适的子区块中
2. 为每个子区块生成新的 summary 和 keywords
3. 每条对话记录必须且只能分配到一个子区块，不能遗漏

## 输出格式
输出 JSON 对象：
{
  "assignments": [
    {
      "directoryEntry": "目录条目名",
      "category": "大类",
      "subCategory": "子类",
      "summary": "结构化摘要",
      "keywords": ["关键词句1", "关键词句2"],
      "importance": "normal",
      "rawContextIndices": [0, 3, 5]
    }
  ]
}

rawContextIndices 是分配给该子区块的对话记录索引（从 0 开始）。`

export class MemoryReorganizer {
  private llm: LLMAdapter
  private store: QdrantStore
  private directoryManager: DirectoryManager
  private lifecycle: BlockLifecycleManager
  private abortController: AbortController | null = null
  private _paused = false
  private _progress: ReorganizationProgress | null = null

  constructor(
    llm: LLMAdapter,
    store: QdrantStore,
    directoryManager: DirectoryManager,
    lifecycle: BlockLifecycleManager,
  ) {
    this.llm = llm
    this.store = store
    this.directoryManager = directoryManager
    this.lifecycle = lifecycle
  }

  get isRunning(): boolean {
    return this.abortController !== null && !this.abortController.signal.aborted
  }

  get isPaused(): boolean {
    return this._paused
  }

  get progress(): ReorganizationProgress | null {
    return this._progress
  }

  static isDirty(): boolean {
    return localStorage.getItem(DIRTY_KEY) === 'true'
  }

  static markDirty(): void {
    localStorage.setItem(DIRTY_KEY, 'true')
  }

  static clearDirty(): void {
    localStorage.removeItem(DIRTY_KEY)
  }

  static hasCheckpoint(): boolean {
    return localStorage.getItem(CHECKPOINT_KEY) !== null
  }

  static loadCheckpoint(): ReorganizationCheckpoint | null {
    const raw = localStorage.getItem(CHECKPOINT_KEY)
    if (!raw) return null
    try {
      return JSON.parse(raw) as ReorganizationCheckpoint
    } catch {
      return null
    }
  }

  static clearCheckpoint(): void {
    localStorage.removeItem(CHECKPOINT_KEY)
  }

  private saveCheckpoint(cp: ReorganizationCheckpoint): void {
    localStorage.setItem(CHECKPOINT_KEY, JSON.stringify(cp))
  }

  private checkAborted(): void {
    if (this.abortController?.signal.aborted) {
      throw new DOMException('Reorganization aborted', 'AbortError')
    }
  }

  private async waitForResume(): Promise<void> {
    while (this._paused && !this.abortController?.signal.aborted) {
      await new Promise(r => setTimeout(r, 1000))
    }
    this.checkAborted()
  }

  pause(): void {
    this._paused = true
  }

  resume(): void {
    this._paused = false
  }

  async run(signal?: AbortSignal): Promise<ReorganizationResult> {
    const result: ReorganizationResult = { splits: 0, reclassifications: 0, merges: 0, errors: 0 }
    this.abortController = signal ? Object.assign(new AbortController(), { signal }) : new AbortController()
    this._paused = false

    try {
      const checkpoint = MemoryReorganizer.loadCheckpoint()
      if (checkpoint && checkpoint.pendingOperations.length > 0) {
        await this.executeFromCheckpoint(checkpoint, result)
        return result
      }

      const categories = await this.scan()
      if (categories.size === 0) return result

      const cp: ReorganizationCheckpoint = {
        version: 1,
        startedAt: Date.now(),
        totalCategories: categories.size,
        completedCategories: [],
        pendingOperations: [],
        executedCount: 0,
      }

      await this.analyze(categories, cp, result)

      if (cp.pendingOperations.length > 0) {
        await this.executeFromCheckpoint(cp, result)
      }

      MemoryReorganizer.clearCheckpoint()
      MemoryReorganizer.clearDirty()
    } catch (err) {
      if ((err as DOMException).name === 'AbortError') {
        console.log('[Reorganizer] Aborted, checkpoint saved')
      } else {
        console.error('[Reorganizer] Error:', err)
        result.errors++
      }
    } finally {
      this.abortController = null
      this._paused = false
      this._progress = null
    }

    return result
  }

  cancel(): void {
    this._paused = false
    this.abortController?.abort()
  }

  private async scan(): Promise<Map<string, DirectoryEntry[]>> {
    this._progress = { phase: 'scanning', current: 0, total: 0, detail: '扫描区块...' }
    this.checkAborted()

    const entries = await this.directoryManager.getAllEntries()
    const grouped = new Map<string, DirectoryEntry[]>()

    for (const entry of entries) {
      const key = entry.category || '未分类'
      if (!grouped.has(key)) grouped.set(key, [])
      grouped.get(key)!.push(entry)
    }

    this.checkAborted()
    return grouped
  }

  private async analyze(
    categories: Map<string, DirectoryEntry[]>,
    cp: ReorganizationCheckpoint,
    result: ReorganizationResult,
  ): Promise<void> {
    const allNeedsReclassify: Array<{ blockId: string; reason: string; summary: string }> = []

    const catKeys = [...categories.keys()]
    let idx = cp.completedCategories.length

    for (; idx < catKeys.length; idx++) {
      this.checkAborted()
      await this.waitForResume()

      const catName = catKeys[idx]
      const entries = categories.get(catName)!

      this._progress = {
        phase: 'analyzing',
        current: idx + 1,
        total: catKeys.length,
        detail: `分析分类: ${catName}`,
      }

      const blocksText = entries
        .map(e => `[${e.blockId}] ${e.directoryEntry} (${e.importance}): ${e.summary}`)
        .join('\n')

      const prompt = ANALYSIS_PROMPT
        .replace('{categoryName}', catName)
        .replace('{blocks}', blocksText)

      try {
        const response = await this.llm.chat(
          [{ role: 'system', content: prompt }],
          { temperature: 0.2 },
        )
        const parsed = this.parseAnalysis(response.content)

        for (const op of parsed.operations) {
          if (op.action === 'split' && op.blockId) {
            cp.pendingOperations.push({ action: 'split', blockId: op.blockId })
          } else if (op.action === 'merge' && op.blockIds && op.blockIds.length >= 2) {
            cp.pendingOperations.push({
              action: 'merge',
              blockIdA: op.blockIds[0],
              blockIdB: op.blockIds[1],
            })
          }
        }

        for (const item of parsed.needsReclassify) {
          const entry = entries.find(e => e.blockId === item.blockId)
          allNeedsReclassify.push({
            blockId: item.blockId,
            reason: item.reason,
            summary: entry?.summary ?? '',
          })
        }
      } catch (err) {
        if ((err as DOMException).name === 'AbortError') throw err
        console.warn(`[Reorganizer] Analysis failed for category ${catName}:`, err)
        result.errors++
      }

      cp.completedCategories.push(catName)
      this.saveCheckpoint(cp)
    }

    if (allNeedsReclassify.length > 0) {
      await this.analyzeReclassify(allNeedsReclassify, cp, result)
    }
  }

  private async analyzeReclassify(
    items: Array<{ blockId: string; reason: string; summary: string }>,
    cp: ReorganizationCheckpoint,
    result: ReorganizationResult,
  ): Promise<void> {
    this.checkAborted()
    await this.waitForResume()

    this._progress = {
      phase: 'analyzing',
      current: cp.completedCategories.length,
      total: cp.totalCategories,
      detail: '跨分类重分类分析...',
    }

    try {
      const tree = await this.directoryManager.buildDirectoryTreeText()
      const blocksText = items
        .map(i => `[${i.blockId}] ${i.summary} — 原因: ${i.reason}`)
        .join('\n')

      const prompt = RECLASSIFY_PROMPT
        .replace('{fullDirectory}', tree)
        .replace('{suspiciousBlocks}', blocksText)

      const response = await this.llm.chat(
        [{ role: 'system', content: prompt }],
        { temperature: 0.2 },
      )

      const decisions = this.parseReclassifyDecisions(response.content)
      for (const d of decisions) {
        cp.pendingOperations.push({
          action: 'reclassify',
          blockId: d.blockId,
          newCategory: d.newCategory,
          newSubCategory: d.newSubCategory,
        })
      }
      this.saveCheckpoint(cp)
    } catch (err) {
      if ((err as DOMException).name === 'AbortError') throw err
      console.warn('[Reorganizer] Reclassify analysis failed:', err)
      result.errors++
    }
  }

  private async executeFromCheckpoint(
    cp: ReorganizationCheckpoint,
    result: ReorganizationResult,
  ): Promise<void> {
    const validOps: ReorganizeOperation[] = []
    const existingEntries = await this.directoryManager.getAllEntries()
    const existingIds = new Set(existingEntries.map(e => e.blockId))

    for (const op of cp.pendingOperations) {
      if (op.action === 'split' && existingIds.has(op.blockId)) {
        validOps.push(op)
      } else if (op.action === 'reclassify' && existingIds.has(op.blockId)) {
        validOps.push(op)
      } else if (op.action === 'merge' && existingIds.has(op.blockIdA) && existingIds.has(op.blockIdB)) {
        validOps.push(op)
      }
    }

    cp.pendingOperations = validOps
    this.saveCheckpoint(cp)

    for (let i = cp.executedCount; i < validOps.length; i++) {
      this.checkAborted()
      await this.waitForResume()

      const op = validOps[i]
      const actionLabel = op.action === 'split' ? '拆分'
        : op.action === 'reclassify' ? '重分类' : '合并'

      this._progress = {
        phase: 'executing',
        current: i + 1,
        total: validOps.length,
        detail: `${actionLabel} ${op.action === 'merge' ? (op as { blockIdA: string }).blockIdA : (op as { blockId: string }).blockId}`,
      }

      try {
        if (op.action === 'split') {
          await this.executeSplit(op.blockId)
          result.splits++
        } else if (op.action === 'reclassify') {
          await this.executeReclassify(op.blockId, op.newCategory, op.newSubCategory)
          result.reclassifications++
        } else if (op.action === 'merge') {
          await this.lifecycle.executeMerge(
            { blockIdA: op.blockIdA, blockIdB: op.blockIdB } as any,
            { shouldMerge: true, reason: 'reorganizer', mergedSummary: '', mergedKeywords: [] },
          )
          result.merges++
        }
      } catch (err) {
        if ((err as DOMException).name === 'AbortError') throw err
        console.warn(`[Reorganizer] Execute failed for ${actionLabel}:`, err)
        result.errors++
      }

      cp.executedCount = i + 1
      this.saveCheckpoint(cp)
    }
  }

  private async executeSplit(blockId: string): Promise<void> {
    const data = await this.store.assembleBlockData(blockId)
    if (!data) return

    const rawContexts = data.rawContents
    const keywords = data.keywordSentences

    const prompt = SPLIT_PROMPT
      .replace('{summary}', data.summary)
      .replace('{keywords}', keywords.join(', '))
      .replace('{count}', String(rawContexts.length))
      .replace('{rawContexts}', rawContexts.map((c, i) => `[${i}] ${c}`).join('\n'))

    const response = await this.llm.chat(
      [{ role: 'system', content: prompt }],
      { temperature: 0.2 },
    )

    const assignments = this.parseSplitAssignments(response.content)
    if (assignments.length === 0) return

    await this.store.deleteBlock(blockId)

    for (const assign of assignments) {
      const newBlockId = `blk_split_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const assignedContexts = assign.rawContextIndices
        .filter(i => i >= 0 && i < rawContexts.length)
        .map(i => rawContexts[i])

      for (const ctx of assignedContexts) {
        await this.store.writeRawContext(
          newBlockId, ctx,
          assign.directoryEntry, assign.category, assign.subCategory,
          assign.summary, assign.importance,
        )
      }

      if (assign.keywords.length > 0) {
        await this.store.writeKeywordAnchors(
          newBlockId, assign.keywords,
          assign.directoryEntry, assign.category, assign.subCategory,
          assign.summary, assign.importance,
        )
      }

      await this.store.writeDirectoryEntry(
        newBlockId, assign.directoryEntry,
        assign.category, assign.subCategory,
        assign.summary, assign.keywords, assign.importance,
        assignedContexts.length + assign.keywords.length,
      )
    }
  }

  private async executeReclassify(blockId: string, newCategory: string, newSubCategory: string): Promise<void> {
    await this.store.deleteDirectoryEntry(blockId)

    const data = await this.store.assembleBlockData(blockId)
    if (!data) return

    const entries = await this.directoryManager.getEntries()
    const entry = entries.find(e => e.blockId === blockId)

    await this.store.writeDirectoryEntry(
      blockId,
      entry?.directoryEntry ?? data.summary,
      newCategory,
      newSubCategory,
      data.summary,
      data.keywordSentences,
      (entry?.importance ?? 'normal') as ImportanceLevel,
      data.rawContents.length + data.keywordSentences.length,
    )

    await this.store.updateBlockPayloadFields(blockId, {
      category: newCategory,
      subCategory: newSubCategory,
    })
  }

  private parseAnalysis(content: string): AnalysisResult {
    const jsonStr = extractJsonObject(content)
    if (!jsonStr) return { operations: [], needsReclassify: [] }

    try {
      const parsed = JSON.parse(jsonStr)
      const operations = Array.isArray(parsed.operations)
        ? parsed.operations.filter((op: any) =>
            typeof op === 'object' && op !== null && typeof op.action === 'string'
          )
        : []
      const needsReclassify = Array.isArray(parsed.needsReclassify)
        ? parsed.needsReclassify.filter((item: any) =>
            typeof item === 'object' && item !== null && typeof item.blockId === 'string'
          )
        : []
      return { operations, needsReclassify }
    } catch {
      return { operations: [], needsReclassify: [] }
    }
  }

  private parseReclassifyDecisions(content: string): ReclassifyDecision[] {
    const jsonStr = extractJsonObject(content)
    if (!jsonStr) return []
    // try array first
    try {
      const arrMatch = content.trim().match(/\[[\s\S]*\]/)
      if (arrMatch) {
        const parsed = JSON.parse(arrMatch[0])
        if (Array.isArray(parsed)) {
          return parsed.filter((d: any) =>
            typeof d === 'object' && d !== null && typeof d.blockId === 'string'
          ) as ReclassifyDecision[]
        }
      }
    } catch { /* fall through */ }
    return []
  }

  private parseSplitAssignments(content: string): SplitAssignment[] {
    const jsonStr = extractJsonObject(content)
    if (!jsonStr) return []

    try {
      const parsed = JSON.parse(jsonStr)
      if (Array.isArray(parsed.assignments)) {
        return parsed.assignments.filter((a: any) =>
          typeof a === 'object' && a !== null && Array.isArray(a.rawContextIndices)
        ) as SplitAssignment[]
      }
    } catch { /* fall through */ }
    return []
  }
}
