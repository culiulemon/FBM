export interface DirectoryEntry {
  blockId: string
  directoryEntry: string
  category: string
  subCategory: string
  fullPath: string
  summary: string
  keywordAnchors: string[]
  pointCount: number
  importance: string
  createdAt: number
  updatedAt: number
  lastAccessedAt: number
  accessCount: number
}

export interface DirectoryCategory {
  name: string
  subCategories: DirectorySubCategory[]
}

export interface DirectorySubCategory {
  name: string
  entries: DirectoryEntry[]
}

export interface DirectoryTree {
  categories: DirectoryCategory[]
  totalEntries: number
}

export interface ExpirationCandidate {
  blockId: string
  directoryEntry: string
  summary: string
  importance: string
  accessCount: number
  lastAccessedAt: number
  daysSinceAccess: number
  accessScore: number
  compositeScore: number
}

export interface ExpirationDecision {
  blockId: string
  decision: 'keep' | 'expire' | 'downgrade'
  reason: string
  newImportance?: string
}

export interface MergeCandidate {
  blockIdA: string
  blockIdB: string
  entryA: string
  entryB: string
  summaryA: string
  summaryB: string
  similarity: number
}

export interface MergeDecision {
  shouldMerge: boolean
  reason: string
  mergedDirectoryEntry?: string
  mergedSummary?: string
  mergedKeywords?: string[]
}
