import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockScroll = vi.fn()
const mockQuery = vi.fn()
const mockUpsert = vi.fn()
const mockCreateCollection = vi.fn()
const mockCreatePayloadIndex = vi.fn()
const mockGetCollections = vi.fn()
const mockGetCollection = vi.fn()
const mockDelete = vi.fn()
const mockSetPayload = vi.fn()
const mockDeleteCollection = vi.fn()

vi.mock('@qdrant/js-client-rest', () => ({
  QdrantClient: vi.fn().mockImplementation(() => ({
    scroll: mockScroll,
    query: mockQuery,
    upsert: mockUpsert,
    createCollection: mockCreateCollection,
    createPayloadIndex: mockCreatePayloadIndex,
    getCollections: mockGetCollections,
    getCollection: mockGetCollection,
    delete: mockDelete,
    setPayload: mockSetPayload,
    deleteCollection: mockDeleteCollection,
  })),
}))

import { QdrantStore } from '../core/qdrant-store.js'

function createMockEmbedding() {
  return {
    getDimension: vi.fn().mockReturnValue(3),
    embed: vi.fn().mockResolvedValue({ embeddings: [[0.1, 0.2, 0.3]] }),
  } as any
}

describe('QdrantStore', () => {
  let store: QdrantStore
  let mockEmbedding: ReturnType<typeof createMockEmbedding>

  beforeEach(() => {
    vi.clearAllMocks()
    mockEmbedding = createMockEmbedding()
    mockGetCollections.mockResolvedValue({ collections: [] })
    mockGetCollection.mockResolvedValue({ points_count: 0 })
    mockUpsert.mockResolvedValue({ operation_id: 1, status: 'completed' })
    mockScroll.mockResolvedValue({ points: [], next_page_offset: null })
    store = new QdrantStore(6333, mockEmbedding)
  })

  describe('init', () => {
    it('should create collections on first init', async () => {
      await store.init()
      expect(mockCreateCollection).toHaveBeenCalledTimes(2)
      expect(mockCreatePayloadIndex).toHaveBeenCalled()
    })

    it('should skip collection creation if they exist', async () => {
      mockGetCollections.mockResolvedValue({
        collections: [
          { name: 'memory_blocks' },
          { name: 'memory_directory' },
        ],
      })
      await store.init()
      expect(mockCreateCollection).not.toHaveBeenCalled()
    })
  })

  describe('writeRawContext', () => {
    it('should upsert a raw context point', async () => {
      await store.init()
      await store.writeRawContext(
        'block-1', 'test context', 'Test Entry',
        '知识', '技术', 'test summary', 'normal', 'conv-1',
      )
      expect(mockEmbedding.embed).toHaveBeenCalledWith(['test context'])
      expect(mockUpsert).toHaveBeenCalledWith(
        'memory_blocks',
        expect.objectContaining({
          points: expect.arrayContaining([
            expect.objectContaining({
              payload: expect.objectContaining({
                blockId: 'block-1',
                type: 'raw_context',
              }),
            }),
          ]),
        }),
      )
    })
  })

  describe('writeKeywordAnchors', () => {
    it('should upsert keyword anchor points', async () => {
      mockEmbedding.embed.mockResolvedValue({
        embeddings: [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]],
      })
      await store.init()
      await store.writeKeywordAnchors(
        'block-1', ['keyword1', 'keyword2'], 'Test Entry',
        '知识', '技术', 'test summary', 'normal',
      )
      expect(mockEmbedding.embed).toHaveBeenCalledWith(['keyword1', 'keyword2'])
      expect(mockUpsert).toHaveBeenCalledWith(
        'memory_blocks',
        expect.objectContaining({
          points: expect.arrayContaining([
            expect.objectContaining({
              payload: expect.objectContaining({
                blockId: 'block-1',
                type: 'keyword_anchor',
              }),
            }),
          ]),
        }),
      )
    })
  })

  describe('scrollByBlockId', () => {
    it('should scroll points filtered by blockId', async () => {
      await store.init()
      const fakePoints = [
        { id: 'p1', payload: { blockId: 'block-1', type: 'raw_context' } },
        { id: 'p2', payload: { blockId: 'block-1', type: 'keyword_anchor' } },
      ]
      mockScroll.mockResolvedValueOnce({ points: fakePoints, next_page_offset: null })

      const result = await store.scrollByBlockId('block-1')
      expect(result).toHaveLength(2)
    })

    it('should handle pagination', async () => {
      await store.init()
      const page1 = Array.from({ length: 100 }, (_, i) => ({
        id: `p${i}`, payload: { blockId: 'block-1' },
      }))
      const page2 = [{ id: 'p100', payload: { blockId: 'block-1' } }]
      mockScroll
        .mockResolvedValueOnce({ points: page1, next_page_offset: 'offset2' })
        .mockResolvedValueOnce({ points: page2, next_page_offset: null })

      const result = await store.scrollByBlockId('block-1')
      expect(result).toHaveLength(101)
      expect(mockScroll).toHaveBeenCalledTimes(2)
    })
  })

  describe('getBlockCount', () => {
    it('should return point count from collection info', async () => {
      mockGetCollection.mockResolvedValue({ points_count: 42 })
      const count = await store.getBlockCount()
      expect(count).toBe(42)
    })

    it('should return 0 on error', async () => {
      mockGetCollection.mockRejectedValue(new Error('fail'))
      const count = await store.getBlockCount()
      expect(count).toBe(0)
    })
  })

  describe('getStats', () => {
    it('should return combined stats', async () => {
      await store.init()
      mockGetCollection
        .mockResolvedValueOnce({ points_count: 10 })
        .mockResolvedValueOnce({ points_count: 5 })

      const stats = await store.getStats()
      expect(stats.blockPoints).toBe(10)
      expect(stats.directoryEntries).toBe(5)
    })
  })

  describe('deleteBlock', () => {
    it('should delete all points with matching blockId', async () => {
      await store.init()
      const fakePoints = [
        { id: 'p1', payload: { blockId: 'block-1' } },
        { id: 'p2', payload: { blockId: 'block-1' } },
      ]
      mockScroll
        .mockResolvedValueOnce({ points: fakePoints, next_page_offset: null })
        .mockResolvedValueOnce({ points: [], next_page_offset: null })
      mockDelete.mockResolvedValue({ operation_id: 1, status: 'completed' })

      await store.deleteBlock('block-1')
      expect(mockDelete).toHaveBeenCalled()
    })
  })

  describe('assembleBlockData', () => {
    it('should assemble block data from points', async () => {
      await store.init()

      const fakePayloads = [
        {
          blockId: 'b1',
          type: 'raw_context',
          rawContent: 'raw text',
          directoryEntry: 'Test',
          category: '知识',
          subCategory: '技术',
          summary: 'a summary',
          importance: 'normal',
          status: 'active',
          accessCount: 0,
          lastAccessedAt: 1000,
          createdAt: 1000,
          updatedAt: 1000,
          updateCount: 0,
        },
        {
          blockId: 'b1',
          type: 'keyword_anchor',
          keywordSentence: 'kw1',
          status: 'active',
        },
        {
          blockId: 'b1',
          type: 'keyword_anchor',
          keywordSentence: 'kw2',
          status: 'active',
        },
      ]
      const fakePoints = fakePayloads.map((p, i) => ({
        id: `p${i}`,
        payload: p,
      }))

      mockScroll.mockReset()
      mockScroll.mockResolvedValueOnce({ points: fakePoints, next_page_offset: null })

      const data = await store.assembleBlockData('b1')
      expect(data).toBeDefined()
      expect(data!.rawContents).toEqual(['raw text'])
      expect(data!.summary).toBe('a summary')
      expect(data!.keywordSentences).toEqual(['kw1', 'kw2'])
    })

    it('should return null for non-existent block', async () => {
      await store.init()
      mockScroll.mockResolvedValueOnce({ points: [], next_page_offset: null })

      const data = await store.assembleBlockData('nonexistent')
      expect(data).toBeNull()
    })
  })

  describe('clearAll', () => {
    it('should delete all points from both collections', async () => {
      await store.init()
      mockDelete.mockResolvedValue({ operation_id: 1, status: 'completed' })

      await store.clearAll()
      expect(mockDelete).toHaveBeenCalledTimes(2)
      expect(mockDelete).toHaveBeenCalledWith('memory_blocks', { filter: {} })
      expect(mockDelete).toHaveBeenCalledWith('memory_directory', { filter: {} })
    })
  })
})
