import type { QdrantStore } from './qdrant-store.js'
import type { DirectoryEntry, DirectoryTree } from '../types/directory.js'

const DEFAULT_THRESHOLD = 50

export class DirectoryManager {
  private store: QdrantStore
  private threshold: number

  constructor(store: QdrantStore, threshold?: number) {
    this.store = store
    this.threshold = threshold ?? DEFAULT_THRESHOLD
  }

  async getFullTree(): Promise<DirectoryTree> {
    return this.store.getDirectoryTree()
  }

  async getCategories(): Promise<string[]> {
    const tree = await this.getFullTree()
    return tree.categories.map(c => c.name)
  }

  async getSubCategories(category: string): Promise<string[]> {
    const tree = await this.getFullTree()
    const cat = tree.categories.find(c => c.name === category)
    return cat ? cat.subCategories.map(s => s.name) : []
  }

  async getEntries(category?: string, subCategory?: string): Promise<DirectoryEntry[]> {
    const filter: Record<string, unknown> = {}
    if (category) filter.category = category
    if (subCategory) filter.subCategory = subCategory
    return this.store.scrollDirectory(Object.keys(filter).length > 0 ? filter : undefined)
  }

  async getAllEntries(): Promise<DirectoryEntry[]> {
    return this.store.scrollDirectory()
  }

  async getTotalCount(): Promise<number> {
    const tree = await this.getFullTree()
    return tree.totalEntries
  }

  needsLayeredBrowsing(): boolean {
    return this.threshold <= DEFAULT_THRESHOLD
  }

  async buildDirectoryTreeText(): Promise<string> {
    const tree = await this.getFullTree()
    if (tree.totalEntries === 0) {
      return '（暂无记忆目录）'
    }

    let output = ''
    for (const cat of tree.categories) {
      output += `- ${cat.name}/\n`
      for (const sub of cat.subCategories) {
        output += `  - ${sub.name}/\n`
        for (const entry of sub.entries) {
          output += `    - ${entry.directoryEntry} [block:${entry.blockId}]\n`
        }
      }
    }
    return output
  }

  async buildDirectoryFlatText(): Promise<string> {
    const entries = await this.getAllEntries()
    if (entries.length === 0) {
      return '（暂无记忆目录）'
    }

    return entries
      .map(e => `- ${e.category}/${e.subCategory}/${e.directoryEntry} [block:${e.blockId}]`)
      .join('\n')
  }

  async getDirectoryTextForLLM(): Promise<string> {
    const count = await this.getTotalCount()
    if (count < this.threshold) {
      return this.buildDirectoryFlatText()
    }
    return this.buildDirectoryTreeText()
  }
}
