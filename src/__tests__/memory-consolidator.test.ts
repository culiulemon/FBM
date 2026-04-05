import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryConsolidator } from '../core/memory-consolidator.js'
import type { ConversationMessage } from '../types/conversation.js'

function createMockLLM(responses: string[]) {
  let callIndex = 0
  return {
    chat: vi.fn().mockImplementation(() => {
      const content = responses[callIndex++] || '{}'
      return Promise.resolve({ content })
    }),
  } as any
}

function createMockStore() {
  return {
    writeRawContext: vi.fn().mockResolvedValue(undefined),
    writeKeywordAnchors: vi.fn().mockResolvedValue(undefined),
    writeDirectoryEntry: vi.fn().mockResolvedValue(undefined),
    scrollDirectory: vi.fn().mockResolvedValue([]),
    searchDenseOnly: vi.fn().mockResolvedValue([]),
    scrollByBlockId: vi.fn().mockResolvedValue([]),
    getEmbedding: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
  } as any
}

function createMockDirectoryManager() {
  return {
    getDirectoryTextForLLM: vi.fn().mockResolvedValue(''),
    getFullTree: vi.fn().mockResolvedValue({}),
    buildDirectoryTreeText: vi.fn().mockResolvedValue(''),
  } as any
}

describe('MemoryConsolidator', () => {
  let consolidator: MemoryConsolidator
  let mockLLM: ReturnType<typeof createMockLLM>
  let mockStore: ReturnType<typeof createMockStore>
  let mockDirManager: ReturnType<typeof createMockDirectoryManager>

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('consolidate', () => {
    it('should return empty result when no messages', async () => {
      mockLLM = createMockLLM([])
      mockStore = createMockStore()
      mockDirManager = createMockDirectoryManager()
      consolidator = new MemoryConsolidator(mockLLM, mockStore, mockDirManager)

      const result = await consolidator.consolidate([])
      expect(result.created).toBe(0)
      expect(result.updated).toBe(0)
      expect(result.deleted).toBe(0)
    })

    it('should call LLM for topic segmentation and consolidation', async () => {
      const segmentationResponse = JSON.stringify({
        segments: [
          {
            topic: 'Rust Programming',
            messageIndices: [0, 1],
            summary: 'Discussion about Rust basics',
          },
        ],
      })

      const consolidationResponse = JSON.stringify({
        operations: [
          {
            action: 'create',
            summary: 'User discussed Rust programming basics',
            rawContext: 'User asked about Rust. Assistant explained ownership.',
            keywords: ['rust', 'programming', 'ownership'],
            importance: 'normal',
            category: '知识',
            subCategory: '技术',
            entryName: 'Rust编程基础',
          },
        ],
      })

      mockLLM = createMockLLM([segmentationResponse, consolidationResponse])
      mockStore = createMockStore()
      mockDirManager = createMockDirectoryManager()
      consolidator = new MemoryConsolidator(mockLLM, mockStore, mockDirManager)

      const messages: ConversationMessage[] = [
        { role: 'user', content: 'What is Rust?', timestamp: Date.now() },
        { role: 'assistant', content: 'Rust is a systems programming language with ownership.', timestamp: Date.now() },
      ]

      const result = await consolidator.consolidate(messages)
      expect(mockLLM.chat).toHaveBeenCalled()
      expect(result).toBeDefined()
    })

    it('should handle malformed LLM response gracefully', async () => {
      mockLLM = createMockLLM(['not valid json at all'])
      mockStore = createMockStore()
      mockDirManager = createMockDirectoryManager()
      consolidator = new MemoryConsolidator(mockLLM, mockStore, mockDirManager)

      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Hello', timestamp: Date.now() },
        { role: 'assistant', content: 'Hi there', timestamp: Date.now() },
      ]

      const result = await consolidator.consolidate(messages)
      expect(result).toBeDefined()
      expect(result.created).toBe(0)
    })

    it('should handle empty segments', async () => {
      const segmentationResponse = JSON.stringify({
        segments: [],
      })

      mockLLM = createMockLLM([segmentationResponse])
      mockStore = createMockStore()
      mockDirManager = createMockDirectoryManager()
      consolidator = new MemoryConsolidator(mockLLM, mockStore, mockDirManager)

      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Hi', timestamp: Date.now() },
        { role: 'assistant', content: 'Hello', timestamp: Date.now() },
      ]

      const result = await consolidator.consolidate(messages)
      expect(result.created).toBe(0)
    })
  })
})
