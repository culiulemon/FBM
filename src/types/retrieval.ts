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
  title: string
  content: string
  filePath?: string
  fileName?: string
  createdAt: number
  updatedAt: number
}

export interface MemoryRoute {
  file: string
  title: string
  content: string
  action: 'append' | 'update' | 'delete'
}

export interface ConsolidationResult {
  memories: MemoryDocument[]
  created: number
  updated: number
  deleted: number
  skipped: number
}
