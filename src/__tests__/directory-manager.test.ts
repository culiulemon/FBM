import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DirectoryManager } from '../core/directory-manager.js'

function createMockStore(entries: any[] = []) {
  return {
    getDirectoryTree: vi.fn().mockImplementation(async () => {
      const catMap = new Map<string, Map<string, any[]>>()
      for (const entry of entries) {
        if (!catMap.has(entry.category)) catMap.set(entry.category, new Map())
        const subMap = catMap.get(entry.category)!
        if (!subMap.has(entry.subCategory)) subMap.set(entry.subCategory, [])
        subMap.get(entry.subCategory)!.push(entry)
      }
      const categories = []
      for (const [catName, subMap] of catMap) {
        const subCategories = []
        for (const [subName, subEntries] of subMap) {
          subCategories.push({ name: subName, entries: subEntries })
        }
        categories.push({ name: catName, subCategories })
      }
      return { categories, totalEntries: entries.length }
    }),
    scrollDirectory: vi.fn().mockResolvedValue(entries),
    searchDirectoryDense: vi.fn().mockResolvedValue([]),
  } as any
}

describe('DirectoryManager', () => {
  let manager: DirectoryManager
  let mockStore: ReturnType<typeof createMockStore>

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getFullTree', () => {
    it('should build a tree from directory entries', async () => {
      const entries = [
        { category: '知识', subCategory: '技术', directoryEntry: 'Rust基础', blockId: 'b1', summary: 's1', keywords: ['rust'], importance: 'normal' },
        { category: '知识', subCategory: '技术', directoryEntry: 'TypeScript', blockId: 'b2', summary: 's2', keywords: ['ts'], importance: 'normal' },
        { category: '知识', subCategory: '生活', directoryEntry: '菜谱', blockId: 'b3', summary: 's3', keywords: ['cooking'], importance: 'low' },
        { category: '偏好', subCategory: '风格', directoryEntry: '代码风格', blockId: 'b4', summary: 's4', keywords: ['style'], importance: 'high' },
      ]
      mockStore = createMockStore(entries)
      manager = new DirectoryManager(mockStore, 50)

      const tree = await manager.getFullTree()

      expect(tree.categories).toHaveLength(2)
      expect(tree.categories[0].name).toBe('知识')
      expect(tree.categories[0].subCategories).toHaveLength(2)
      expect(tree.totalEntries).toBe(4)
    })

    it('should return empty tree when no entries', async () => {
      mockStore = createMockStore([])
      manager = new DirectoryManager(mockStore, 50)
      const tree = await manager.getFullTree()
      expect(tree.categories).toHaveLength(0)
      expect(tree.totalEntries).toBe(0)
    })
  })

  describe('getCategories', () => {
    it('should return unique category names', async () => {
      const entries = [
        { category: '知识', subCategory: '技术', directoryEntry: 'A', blockId: 'b1' },
        { category: '偏好', subCategory: '风格', directoryEntry: 'B', blockId: 'b2' },
        { category: '知识', subCategory: '生活', directoryEntry: 'C', blockId: 'b3' },
      ]
      mockStore = createMockStore(entries)
      manager = new DirectoryManager(mockStore, 50)

      const categories = await manager.getCategories()
      expect(categories).toEqual(expect.arrayContaining(['知识', '偏好']))
      expect(categories).toHaveLength(2)
    })
  })

  describe('buildDirectoryTextForLLM', () => {
    it('should use flat format when under threshold', async () => {
      const entries = Array.from({ length: 10 }, (_, i) => ({
        category: '知识',
        subCategory: '技术',
        directoryEntry: `Entry${i}`,
        blockId: `b${i}`,
        summary: `Summary ${i}`,
        keywords: [`kw${i}`],
        importance: 'normal',
      }))
      mockStore = createMockStore(entries)
      manager = new DirectoryManager(mockStore, 50)

      const text = await manager.getDirectoryTextForLLM()
      expect(text).toContain('知识')
      expect(text).toContain('技术')
      expect(text).toContain('Entry0')
    })

    it('should use tree format when over threshold', async () => {
      const entries = Array.from({ length: 60 }, (_, i) => ({
        category: `Cat${i % 3}`,
        subCategory: `Sub${i % 5}`,
        directoryEntry: `Entry${i}`,
        blockId: `b${i}`,
        summary: `Summary ${i}`,
        keywords: [`kw${i}`],
        importance: 'normal',
      }))
      mockStore = createMockStore(entries)
      manager = new DirectoryManager(mockStore, 50)

      const text = await manager.getDirectoryTextForLLM()
      expect(text).toContain('/')
    })
  })

  describe('getTotalCount', () => {
    it('should return total entry count', async () => {
      const entries = [
        { category: 'A', subCategory: 'B', directoryEntry: 'E1', blockId: 'b1' },
        { category: 'A', subCategory: 'C', directoryEntry: 'E2', blockId: 'b2' },
      ]
      mockStore = createMockStore(entries)
      manager = new DirectoryManager(mockStore, 50)

      const count = await manager.getTotalCount()
      expect(count).toBe(2)
    })
  })

  describe('getEntries', () => {
    it('should filter by category', async () => {
      const entries = [
        { category: '知识', subCategory: '技术', directoryEntry: 'E1', blockId: 'b1' },
        { category: '偏好', subCategory: '风格', directoryEntry: 'E2', blockId: 'b2' },
      ]
      mockStore = createMockStore(entries)
      manager = new DirectoryManager(mockStore, 50)

      await manager.getEntries('知识')
      expect(mockStore.scrollDirectory).toHaveBeenCalledWith({ category: '知识' })
    })
  })
})
