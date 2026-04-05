export type ImportanceLevel = 'critical' | 'high' | 'normal' | 'low'

export type BlockPointType = 'raw_context' | 'keyword_anchor'

export type BlockAction = 'create' | 'update' | 'ignore'

export type UpdateStrategy = 'incremental' | 'replace'

export interface BlockPayload {
  blockId: string
  type: BlockPointType
  keywordSentence?: string
  rawContent?: string
  directoryEntry: string
  category: string
  subCategory: string
  summary: string
  importance: ImportanceLevel
  sourceConversationId?: string
  accessCount: number
  lastAccessedAt: number
  createdAt: number
  updatedAt: number
  updateCount: number
  mergedFrom?: string[]
  status: 'active' | 'expired'
}

export interface NewBlockData {
  directoryEntry: string
  category: string
  subCategory: string
  keywords: string[]
  summary: string
  importance: ImportanceLevel
}

export interface BlockOperation {
  action: BlockAction
  targetBlockId?: string
  updateStrategy?: UpdateStrategy
  block?: NewBlockData
}

export interface TopicSegment {
  messageIndices: number[]
  topicHint: string
}

export interface SegmentationResult {
  segments: TopicSegment[]
}

export interface BlockData {
  blockId: string
  directoryEntry: string
  category: string
  subCategory: string
  summary: string
  importance: ImportanceLevel
  rawContents: string[]
  keywordSentences: string[]
  accessCount: number
  lastAccessedAt: number
  createdAt: number
  updatedAt: number
  sourceConversationId?: string
  mergedFrom?: string[]
}

export interface ConsolidationResult {
  created: number
  updated: number
  deleted: number
  skipped: number
}
