export interface VectorEntry {
  id: string
  vector: Float32Array
  ref: EmbeddingRef
  createdAt: number
}

export interface EmbeddingRef {
  filePath: string
  headingPath: string[]
  lineStart: number
  lineEnd: number
  title: string
  sectionId?: string
}

export interface SimilarityResult {
  entry: VectorEntry
  score: number
}

export interface VectorStore {
  entries: Map<string, VectorEntry>
  dimension: number
  lastUpdated: number
}

export interface VectorMeta {
  id: string
  ref: EmbeddingRef
  createdAt: number
  offset: number
  contentHash: string
}

export interface VectorMetaStore {
  dimension: number
  lastUpdated: number
  entries: VectorMeta[]
}
