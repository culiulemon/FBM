import type { LLMAdapter, LLMMessage } from '../types/adapter.js'
import type { ImportanceLevel } from '../types/block.js'
import type { ExpirationCandidate, ExpirationDecision, MergeCandidate, MergeDecision } from '../types/directory.js'
import type { QdrantStore } from './qdrant-store.js'
import type { DirectoryManager } from './directory-manager.js'
import { extractJsonObject, extractJsonArray } from './json-utils.js'

const IMPORTANCE_MULTIPLIERS: Record<string, number> = {
  critical: Infinity,
  high: 2.0,
  normal: 1.0,
  low: 0.5,
}

const DEFAULT_EXPIRATION_DAYS: Record<string, number> = {
  critical: Infinity,
  high: 730,
  normal: 180,
  low: 60,
}

const AUTO_UPGRADE_THRESHOLD = 10

const EXPIRATION_REVIEW_PROMPT = `你是一个记忆管理助手。以下记忆区块已经很长时间没有被召回使用，正在接受淘汰审查。

## 淘汰判断规则（严格按优先级）

### 第一优先级：重要度保护
- 标记为"critical"的区块：无条件保留，这是用户的核心身份信息
- 标记为"high"的区块：除非信息已经确定过时（如用户明确说过不再需要），否则保留
- 标记为"normal"的区块：根据内容价值判断
- 标记为"low"的区块：倾向于淘汰

### 第二优先级：内容价值判断
即使重要度不高，如果内容具有以下特征，也应该保留：
- 独特性：这类信息不太可能再次产生（如用户的特殊经历）
- 基础性：是理解其他记忆的背景知识
- 情感性：对用户有情感价值的信息

### 应该淘汰的情况
- 信息已确定过时（用户换了工作/地址/偏好等，且已有新区块记录）
- 纯过程性信息（如某次临时讨论的细节，结论已记录在其他区块）
- 重复信息（与另一个更活跃的区块内容高度重叠）
- 低价值的闲聊内容

## 待审查区块
{blocksList}

输出JSON数组：
[
  {
    "blockId": "...",
    "decision": "keep" | "expire" | "downgrade",
    "reason": "简述判断理由",
    "newImportance": "降级后的重要度（仅decision为downgrade时填写）"
  }
]`

const MERGE_PROMPT = `你是一个记忆管理助手。以下是两个记忆区块的摘要，请判断它们是否应该合并为一个区块。

## 合并标准
只有当满足以下条件时才合并：
- 两个区块讨论的是同一个话题或高度关联的话题
- 用户在同一次查询中几乎总是需要同时参考这两个区块的信息
- 合并后不会导致区块过于庞大（合并后的关键词不超过8个）

## 不应合并的情况
- 两个区块只是碰巧属于同一个子分类，但内容独立
- 合并后关键词过于杂乱，降低召回精度
- 两个区块分别代表同一话题的不同阶段（如"Rust初学"和"Rust进阶"），分开更有价值

## 区块A
目录条目: "{entryA}"
摘要: {summaryA}

## 区块B
目录条目: "{entryB}"
摘要: {summaryB}

输出JSON：
{
  "shouldMerge": true/false,
  "reason": "简述原因",
  "mergedDirectoryEntry": "合并后的目录条目（仅在shouldMerge为true时需要）",
  "mergedSummary": "合并后的摘要（仅在shouldMerge为true时需要）",
  "mergedKeywords": ["合并后的关键词句数组"]
}`

export class BlockLifecycleManager {
  private llm: LLMAdapter
  private store: QdrantStore
  private directoryManager: DirectoryManager
  private expirationDays: Record<string, number>
  private consolidationCount: number
  private mergeCheckInterval: number
  private enableExpiration: boolean
  private expirationCheckInterval: number

  constructor(
    llm: LLMAdapter,
    store: QdrantStore,
    directoryManager: DirectoryManager,
    mergeCheckInterval?: number,
    expirationDays?: Record<string, number>,
    enableExpiration?: boolean,
  ) {
    this.llm = llm
    this.store = store
    this.directoryManager = directoryManager
    this.mergeCheckInterval = mergeCheckInterval ?? 10
    this.expirationDays = expirationDays ?? DEFAULT_EXPIRATION_DAYS
    this.enableExpiration = enableExpiration ?? false
    this.expirationCheckInterval = 20
    this.consolidationCount = 0
  }

  onConsolidationComplete(): void {
    this.consolidationCount++
    if (this.consolidationCount % this.mergeCheckInterval === 0) {
      this.checkAndMerge().catch(err => {
        console.warn('[FBM] Lifecycle merge check failed:', err)
      })
    }
    if (this.enableExpiration && this.consolidationCount % this.expirationCheckInterval === 0) {
      this.runExpirationCycle().catch(err => {
        console.warn('[FBM] Lifecycle expiration check failed:', err)
      })
    }
  }

  async onBlockAccessed(blockId: string): Promise<void> {
    await this.store.updateBlockAccess(blockId)

    const entries = await this.directoryManager.getEntries()
    const entry = entries.find(e => e.blockId === blockId)
    if (entry) {
      const newImportance = this.checkAutoUpgrade(entry.importance, entry.accessCount + 1)
      if (newImportance !== entry.importance) {
        // importance upgraded
      }
    }
  }

  private checkAutoUpgrade(currentImportance: string, accessCount: number): string {
    if (accessCount < AUTO_UPGRADE_THRESHOLD) return currentImportance
    const levels: ImportanceLevel[] = ['low', 'normal', 'high', 'critical']
    const idx = levels.indexOf(currentImportance as ImportanceLevel)
    if (idx < levels.length - 1) {
      return levels[idx + 1]
    }
    return currentImportance
  }

  async scanExpirationCandidates(): Promise<ExpirationCandidate[]> {
    const entries = await this.directoryManager.getAllEntries()
    const now = Date.now()
    const candidates: ExpirationCandidate[] = []

    for (const entry of entries) {
      if (entry.importance === 'critical') continue

      const thresholdDays = this.expirationDays[entry.importance] ?? 180
      const daysSinceAccess = (now - entry.lastAccessedAt) / (1000 * 60 * 60 * 24)

      if (daysSinceAccess < thresholdDays) continue

      const accessScore = 1 / (1 + Math.log(Math.max(daysSinceAccess, 1)))
      const multiplier = IMPORTANCE_MULTIPLIERS[entry.importance] ?? 1.0
      const compositeScore = accessScore * multiplier

      if (compositeScore < 0.3) {
        candidates.push({
          blockId: entry.blockId,
          directoryEntry: entry.directoryEntry,
          summary: entry.summary,
          importance: entry.importance,
          accessCount: entry.pointCount,
          lastAccessedAt: entry.lastAccessedAt,
          daysSinceAccess,
          accessScore,
          compositeScore,
        })
      }
    }

    return candidates
  }

  async reviewExpiration(candidates: ExpirationCandidate[]): Promise<ExpirationDecision[]> {
    if (candidates.length === 0) return []

    const blocksList = candidates.map(c =>
      `blockId: ${c.blockId}\n目录条目: ${c.directoryEntry}\n重要度: ${c.importance}\n摘要: ${c.summary}\n${c.daysSinceAccess.toFixed(0)}天未访问`
    ).join('\n\n')

    const prompt = EXPIRATION_REVIEW_PROMPT.replace('{blocksList}', blocksList)

    const messages: LLMMessage[] = [
      { role: 'system', content: prompt },
    ]

    const response = await this.llm.chat(messages, { temperature: 0.3 })
    return this.parseExpirationDecisions(response.content)
  }

  private parseExpirationDecisions(content: string): ExpirationDecision[] {
    const jsonStr = extractJsonArray(content)
    if (!jsonStr) return []

    try {
      const parsed = JSON.parse(jsonStr)
      if (Array.isArray(parsed)) {
        return parsed.filter((d: unknown) =>
          typeof d === 'object' && d !== null && typeof (d as Record<string, unknown>).blockId === 'string'
        ) as ExpirationDecision[]
      }
    } catch {
      // fall through
    }
    return []
  }

  async executeExpiration(decisions: ExpirationDecision[]): Promise<{ expired: number; kept: number; downgraded: number }> {
    let expired = 0
    let kept = 0
    let downgraded = 0

    for (const decision of decisions) {
      if (decision.decision === 'expire') {
        await this.store.deleteBlock(decision.blockId)
        expired++
      } else if (decision.decision === 'downgrade') {
        downgraded++
      } else {
        kept++
      }
    }

    return { expired, kept, downgraded }
  }

  async runExpirationCycle(): Promise<{ expired: number; kept: number; downgraded: number }> {
    const candidates = await this.scanExpirationCandidates()
    if (candidates.length === 0) return { expired: 0, kept: 0, downgraded: 0 }
    const decisions = await this.reviewExpiration(candidates)
    return this.executeExpiration(decisions)
  }

  async detectMergeCandidates(): Promise<MergeCandidate[]> {
    const entries = await this.directoryManager.getAllEntries()
    const candidates: MergeCandidate[] = []

    const bySubCategory = new Map<string, typeof entries>()
    for (const entry of entries) {
      const key = `${entry.category}/${entry.subCategory}`
      if (!bySubCategory.has(key)) bySubCategory.set(key, [])
      bySubCategory.get(key)!.push(entry)
    }

    for (const [, group] of bySubCategory) {
      if (group.length < 2) continue

      const texts = group.map(e => e.directoryEntry)
      const vectors = await this.store.embed(texts)

      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const similarity = this.cosineSimilarity(vectors[i], vectors[j])

          if (similarity > 0.85) {
            candidates.push({
              blockIdA: group[i].blockId,
              blockIdB: group[j].blockId,
              entryA: group[i].directoryEntry,
              entryB: group[j].directoryEntry,
              summaryA: group[i].summary,
              summaryB: group[j].summary,
              similarity,
            })
          }
        }
      }
    }

    return candidates.sort((a, b) => b.similarity - a.similarity)
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0
    let dot = 0
    let normA = 0
    let normB = 0
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i]
      normA += a[i] * a[i]
      normB += b[i] * b[i]
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB)
    return denom === 0 ? 0 : dot / denom
  }

  async reviewMerge(candidate: MergeCandidate): Promise<MergeDecision> {
    const prompt = MERGE_PROMPT
      .replace('{entryA}', candidate.entryA)
      .replace('{summaryA}', candidate.summaryA)
      .replace('{entryB}', candidate.entryB)
      .replace('{summaryB}', candidate.summaryB)

    const messages: LLMMessage[] = [
      { role: 'system', content: prompt },
    ]

    const response = await this.llm.chat(messages, { temperature: 0.3 })
    return this.parseMergeDecision(response.content)
  }

  private parseMergeDecision(content: string): MergeDecision {
    const jsonStr = extractJsonObject(content)
    if (!jsonStr) return { shouldMerge: false, reason: 'parse failed' }

    try {
      const parsed = JSON.parse(jsonStr)
      return {
        shouldMerge: parsed.shouldMerge ?? false,
        reason: parsed.reason ?? '',
        mergedDirectoryEntry: parsed.mergedDirectoryEntry,
        mergedSummary: parsed.mergedSummary,
        mergedKeywords: parsed.mergedKeywords,
      }
    } catch {
      return { shouldMerge: false, reason: 'parse failed' }
    }
  }

  async executeMerge(candidate: MergeCandidate, decision: MergeDecision): Promise<string | null> {
    if (!decision.shouldMerge) return null

    const keepBlockId = candidate.blockIdA < candidate.blockIdB
      ? candidate.blockIdA
      : candidate.blockIdB
    const removeBlockId = keepBlockId === candidate.blockIdA
      ? candidate.blockIdB
      : candidate.blockIdA

    const keepData = await this.store.assembleBlockData(keepBlockId)
    const removeData = await this.store.assembleBlockData(removeBlockId)

    const category = keepData?.category ?? removeData?.category ?? ''
    const subCategory = keepData?.subCategory ?? removeData?.subCategory ?? ''
    const importance = keepData?.importance ?? 'normal'

    await this.store.deleteKeywordAnchors(keepBlockId)
    await this.store.deleteDirectoryEntry(keepBlockId)
    await this.store.deleteBlock(removeBlockId)

    if (decision.mergedSummary) {
      await this.store.writeRawContext(
        keepBlockId,
        decision.mergedSummary,
        decision.mergedDirectoryEntry ?? candidate.entryA,
        category, subCategory,
        decision.mergedSummary,
        importance,
      )
    }

    if (decision.mergedKeywords && decision.mergedKeywords.length > 0) {
      await this.store.writeKeywordAnchors(
        keepBlockId,
        decision.mergedKeywords,
        decision.mergedDirectoryEntry ?? candidate.entryA,
        category, subCategory,
        decision.mergedSummary ?? '',
        importance,
      )
    }

    const mergedKwCount = decision.mergedKeywords?.length ?? 0
    await this.store.writeDirectoryEntry(
      keepBlockId,
      decision.mergedDirectoryEntry ?? candidate.entryA,
      category, subCategory,
      decision.mergedSummary ?? '',
      decision.mergedKeywords ?? [],
      importance,
      1 + mergedKwCount,
    )

    return keepBlockId
  }

  async checkAndMerge(): Promise<number> {
    const candidates = await this.detectMergeCandidates()
    let mergeCount = 0

    for (const candidate of candidates.slice(0, 5)) {
      const decision = await this.reviewMerge(candidate)
      const result = await this.executeMerge(candidate, decision)
      if (result) mergeCount++
    }

    return mergeCount
  }
}
