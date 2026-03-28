import type { MemoryType } from './memory.js'
import type { NodeRef } from './index.js'

export interface RetrievalResult {
  nodeRef: NodeRef
  content: string
  score: number
  source: 'keyword' | 'vector' | 'both'
}

export interface MemorySummary {
  query: string
  results: RetrievalResult[]
  summary: string
  tokenCount: number
}

export interface MemoryDocument {
  type: MemoryType
  title: string
  content: string
  filePath?: string
  createdAt: number
  updatedAt: number
}

export interface ConsolidationResult {
  memories: MemoryDocument[]
  merged: number
  created: number
  skipped: number
}
