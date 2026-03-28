export interface VectorEntry {
  id: string
  vector: number[]
  ref: EmbeddingRef
  content: string
  createdAt: number
}

export interface EmbeddingRef {
  filePath: string
  headingPath: string[]
  lineStart: number
  lineEnd: number
  title: string
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

export interface SerializedVectorStore {
  entries: Record<string, SerializedVectorEntry>
  dimension: number
  lastUpdated: number
}

export interface SerializedVectorEntry {
  id: string
  vector: number[]
  ref: EmbeddingRef
  content: string
  createdAt: number
}
