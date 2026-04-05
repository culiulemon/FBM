export interface MemorySummary {
  query: string
  results: BlockRetrievalResult[]
  summary: string
  tokenCount: number
  keywords?: string[]
  expandedKeywords?: string[]
}

export interface BlockRetrievalResult {
  blockId: string
  directoryEntry: string
  category: string
  subCategory: string
  content: string
  score: number
  source: 'dense' | 'sparse' | 'hybrid'
}
