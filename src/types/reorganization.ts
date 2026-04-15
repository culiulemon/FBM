import type { ImportanceLevel } from './block.js'

export interface ReorganizationCheckpoint {
  version: 1
  startedAt: number
  totalCategories: number
  completedCategories: string[]
  pendingOperations: ReorganizeOperation[]
  executedCount: number
}

export type ReorganizeOperation =
  | { action: 'split'; blockId: string }
  | { action: 'reclassify'; blockId: string; newCategory: string; newSubCategory: string }
  | { action: 'merge'; blockIdA: string; blockIdB: string }

export interface ReorganizationResult {
  splits: number
  reclassifications: number
  merges: number
  errors: number
}

export interface ReorganizationProgress {
  phase: 'scanning' | 'analyzing' | 'executing'
  current: number
  total: number
  detail: string
}

export interface SplitAssignment {
  directoryEntry: string
  category: string
  subCategory: string
  summary: string
  keywords: string[]
  importance: ImportanceLevel
  rawContextIndices: number[]
}

export interface AnalysisResult {
  operations: AnalysisOperation[]
  needsReclassify: NeedsReclassifyItem[]
}

export interface AnalysisOperation {
  action: 'split' | 'merge'
  blockId?: string
  blockIds?: string[]
  reason: string
  topicCount?: number
}

export interface NeedsReclassifyItem {
  blockId: string
  reason: string
}

export interface ReclassifyDecision {
  blockId: string
  reason: string
  newCategory: string
  newSubCategory: string
}
