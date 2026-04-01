vi.mock('./fs-adapter.js', async () => {
  return await import('./__mocks__/fs-adapter.js')
})

import { describe, it, expect, vi } from 'vitest'
import { MemoryRetriever } from './memory-retriever.js'
import { IndexEngine } from './index-engine.js'
import { KeywordExtractor } from './keyword-extractor.js'
import { VectorIndex } from './vector-index.js'
import type { LLMAdapter, LLMResponse } from '../types/adapter.js'

function createMockLLM(responseContent: string): LLMAdapter {
  return {
    chat: vi.fn().mockResolvedValue({
      content: responseContent,
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
    } satisfies LLMResponse),
  } as unknown as LLMAdapter
}

describe('MemoryRetriever', () => {
  it('should return empty results when keyword extraction fails', async () => {
    const mockIndexEngine = { search: vi.fn() } as unknown as IndexEngine
    const mockKeywordExtractor = {
      extract: vi.fn().mockRejectedValue(new Error('LLM unavailable')),
    } as unknown as KeywordExtractor

    const retriever = new MemoryRetriever({
      indexEngine: mockIndexEngine,
      keywordExtractor: mockKeywordExtractor,
    })

    const results = await retriever.retrieve('test query')
    expect(results.results).toHaveLength(0)
  })

  it('should use extracted keywords for search', async () => {
    const mockIndexEngine = { search: vi.fn().mockReturnValue([]) } as unknown as IndexEngine
    const mockKeywordExtractor = {
      extract: vi.fn().mockResolvedValue(['test']),
    } as unknown as KeywordExtractor

    const retriever = new MemoryRetriever({
      indexEngine: mockIndexEngine,
      keywordExtractor: mockKeywordExtractor,
    })

    const results = await retriever.retrieve('test query')
    expect(results.results).toHaveLength(0)
    expect(mockIndexEngine.search).toHaveBeenCalledWith(['test'])
  })

  it('should return raw content when refineResults is false', async () => {
    const mockIndexEngine = { search: vi.fn().mockReturnValue([]) } as unknown as IndexEngine
    const mockKeywordExtractor = {
      extract: vi.fn().mockResolvedValue(['test']),
      expand: vi.fn().mockResolvedValue(['test']),
    } as unknown as KeywordExtractor
    const mockVectorIndex = {
      enabled: false,
      searchByText: vi.fn(),
    } as unknown as VectorIndex

    const retriever = new MemoryRetriever({
      indexEngine: mockIndexEngine,
      keywordExtractor: mockKeywordExtractor,
      vectorIndex: mockVectorIndex,
      refineResults: false,
    })

    const summary = await retriever.retrieveAndSummarize('test query')
    expect(summary.results).toHaveLength(0)
    expect(summary.summary).toBe('')
  })

  it('should return raw content without LLM call when refineResults is false and results exist', async () => {
    const testDir = (await import('node:os')).tmpdir()
    const { writeFile, mkdir } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const testFile = join(testDir, `fbm-retriever-test-${Date.now()}.md`)

    await mkdir((await import('node:os')).tmpdir(), { recursive: true })
    await writeFile(testFile, '# Section\n\nSome content here', 'utf-8')

    const mockNodeRef = {
      filePath: testFile,
      headingPath: ['Section'],
      lineStart: 0,
      lineEnd: 2,
      title: 'Section',
      depth: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    const mockIndexEngine = {
      search: vi.fn().mockReturnValue([mockNodeRef]),
    } as unknown as IndexEngine

    const mockKeywordExtractor = {
      extract: vi.fn().mockResolvedValue(['test']),
      expand: vi.fn().mockResolvedValue(['test']),
    } as unknown as KeywordExtractor

    const mockVectorIndex = {
      enabled: false,
      searchByText: vi.fn(),
    } as unknown as VectorIndex

    const retriever = new MemoryRetriever({
      indexEngine: mockIndexEngine,
      keywordExtractor: mockKeywordExtractor,
      vectorIndex: mockVectorIndex,
      refineResults: false,
    })

    const summary = await retriever.retrieveAndSummarize('test query')
    expect(summary.results).toHaveLength(1)
    expect(summary.query).toBe('test query')

    await (await import('node:fs/promises')).unlink(testFile).catch(() => {})
  })

  it('should pass query to LLM when refining with results', async () => {
    const testDir = (await import('node:os')).tmpdir()
    const { writeFile, mkdir } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const testFile = join(testDir, `fbm-retriever-test-${Date.now()}.md`)

    await mkdir((await import('node:os')).tmpdir(), { recursive: true })
    await writeFile(testFile, '# Section\n\nSome content here', 'utf-8')

    const mockNodeRef = {
      filePath: testFile,
      headingPath: ['Section'],
      lineStart: 0,
      lineEnd: 2,
      title: 'Section',
      depth: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    const mockIndexEngine = {
      search: vi.fn().mockReturnValue([mockNodeRef]),
    } as unknown as IndexEngine

    const mockKeywordExtractor = {
      extract: vi.fn().mockResolvedValue(['test']),
      expand: vi.fn().mockResolvedValue(['test']),
    } as unknown as KeywordExtractor

    const mockVectorIndex = {
      enabled: false,
      searchByText: vi.fn(),
    } as unknown as VectorIndex

    const llm = createMockLLM('Refined: relevant info only')
    const retriever = new MemoryRetriever({
      indexEngine: mockIndexEngine,
      keywordExtractor: mockKeywordExtractor,
      vectorIndex: mockVectorIndex,
      llm,
      refineResults: true,
    })

    await retriever.retrieveAndSummarize('user query about X')
    expect(llm.chat).toHaveBeenCalledOnce()
    const callArgs = (llm.chat as any).mock.calls[0][0]
    const userMsg = callArgs[1].content
    expect(userMsg).toContain('user query about X')

    await (await import('node:fs/promises')).unlink(testFile).catch(() => {})
  })

  it('should default refineResults to true', () => {
    const retriever = new MemoryRetriever({
      indexEngine: {} as IndexEngine,
      keywordExtractor: {} as KeywordExtractor,
    })
    expect((retriever as any).refineResults).toBe(true)
  })
})
