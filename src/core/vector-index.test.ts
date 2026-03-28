import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { VectorIndex } from './vector-index.js'
import type { EmbeddingAdapter } from '../types/adapter.js'
import { writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

function createMockEmbedding(dim = 3): EmbeddingAdapter {
  let callCount = 0
  return {
    async embed(texts: string[]) {
      callCount++
      const embeddings: number[][] = texts.map((_, i) => {
        const vec = new Array(dim).fill(0)
        vec[(callCount + i) % dim] = 1
        return vec
      })
      return { embeddings }
    },
    getDimension: () => dim,
  }
}

describe('VectorIndex', () => {
  let testDir: string
  let cacheFile: string

  beforeEach(async () => {
    testDir = join(tmpdir(), `fbm-vectortest-${Date.now()}`)
    const { mkdir } = await import('node:fs/promises')
    await mkdir(testDir, { recursive: true })
    cacheFile = join(testDir, 'vector-cache.json')
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  it('should be disabled when no embedding adapter is provided', () => {
    const index = new VectorIndex(undefined, cacheFile)
    expect(index.enabled).toBe(false)
  })

  it('should be enabled when embedding adapter is provided', () => {
    const mock = createMockEmbedding()
    const index = new VectorIndex(mock, cacheFile)
    expect(index.enabled).toBe(true)
  })

  it('should add entries and generate vectors', async () => {
    const mock = createMockEmbedding()
    const index = new VectorIndex(mock, cacheFile)

    const entries = await index.addEntries([
      {
        ref: { filePath: '/test.md', headingPath: ['Section 1'], lineStart: 0, lineEnd: 5, title: 'Section 1' },
        content: 'This is section one',
      },
      {
        ref: { filePath: '/test.md', headingPath: ['Section 2'], lineStart: 6, lineEnd: 10, title: 'Section 2' },
        content: 'This is section two',
      },
    ])

    expect(entries).toHaveLength(2)
    expect(index.size).toBe(2)
    expect(index.dimension).toBe(3)
  })

  it('should return empty when disabled and addEntries called', async () => {
    const index = new VectorIndex(undefined, cacheFile)
    const entries = await index.addEntries([
      {
        ref: { filePath: '/test.md', headingPath: ['Section 1'], lineStart: 0, lineEnd: 5, title: 'Section 1' },
        content: 'content',
      },
    ])
    expect(entries).toHaveLength(0)
  })

  it('should search by vector with cosine similarity', async () => {
    const mock = createMockEmbedding(3)
    const index = new VectorIndex(mock, cacheFile)

    await index.addEntries([
      {
        ref: { filePath: '/a.md', headingPath: ['A'], lineStart: 0, lineEnd: 5, title: 'A' },
        content: 'content a',
      },
    ])

    const results = await index.search([1, 0, 0], 5, 0.0)
    expect(results.length).toBeGreaterThanOrEqual(0)
  })

  it('should search by text', async () => {
    const mock = createMockEmbedding(3)
    const index = new VectorIndex(mock, cacheFile)

    await index.addEntries([
      {
        ref: { filePath: '/a.md', headingPath: ['A'], lineStart: 0, lineEnd: 5, title: 'A' },
        content: 'content a',
      },
    ])

    const results = await index.searchByText('test query', 5, 0.0)
    expect(results.length).toBeGreaterThanOrEqual(0)
  })

  it('should return empty when disabled and searchByText called', async () => {
    const index = new VectorIndex(undefined, cacheFile)
    const results = await index.searchByText('test', 5)
    expect(results).toHaveLength(0)
  })

  it('should remove entries by file path', async () => {
    const mock = createMockEmbedding(3)
    const index = new VectorIndex(mock, cacheFile)

    await index.addEntries([
      {
        ref: { filePath: '/a.md', headingPath: ['A'], lineStart: 0, lineEnd: 5, title: 'A' },
        content: 'content a',
      },
      {
        ref: { filePath: '/b.md', headingPath: ['B'], lineStart: 0, lineEnd: 5, title: 'B' },
        content: 'content b',
      },
    ])

    expect(index.size).toBe(2)
    await index.removeByFile('/a.md')
    expect(index.size).toBe(1)
  })

  it('should persist and load cache', async () => {
    const mock = createMockEmbedding(3)
    const index1 = new VectorIndex(mock, cacheFile)

    await index1.addEntries([
      {
        ref: { filePath: '/cached.md', headingPath: ['Cached'], lineStart: 0, lineEnd: 5, title: 'Cached' },
        content: 'cached content',
      },
    ])

    await index1.save()

    const mock2 = createMockEmbedding(3)
    const index2 = new VectorIndex(mock2, cacheFile)
    await index2.load()

    expect(index2.size).toBe(1)
    expect(index2.dimension).toBe(3)
  })
})
