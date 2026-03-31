import type { MemoryDocument } from '../types/retrieval.js'
import type { StoreConfig } from '../types/config.js'
import { mkdir, writeFile, readFile, unlink, readdir, stat, access, join, basename, extname, watch } from './fs-adapter.js'
import type { FSWatcher } from './fs-adapter.js'
import { parseMarkdown, normalizeTitle, levenshteinDistance } from './node-locator.js'

const INVALID_CHARS = /[<>:"/\\|?*\x00-\x1f]/g
const MAX_FILENAME_LEN = 200

function sanitizeFileName(title: string): string {
  let safe = title.replace(INVALID_CHARS, '_').trim().replace(/\.+$/, '')
  if (safe.length === 0) safe = 'untitled'
  if (safe.length > MAX_FILENAME_LEN) safe = safe.slice(0, MAX_FILENAME_LEN)
  return safe
}

export class MemoryStore {
  private memoryDir: string
  private storeConfig: StoreConfig

  constructor(memoryDir: string, storeConfig?: StoreConfig) {
    this.memoryDir = memoryDir
    this.storeConfig = storeConfig ?? {}
  }

  async init(): Promise<void> {
    await mkdir(this.memoryDir, { recursive: true })
  }

  async write(doc: MemoryDocument): Promise<string> {
    return this.createFile(doc.fileName ?? doc.title, doc.title, doc.content)
  }

  async read(options: {
    keyword?: string
    since?: number
    path?: string
  } = {}): Promise<MemoryDocument[]> {
    if (options.path) {
      return this.readSingleFile(options.path)
    }

    const results: MemoryDocument[] = []
    let files: string[]
    try {
      files = await readdir(this.memoryDir)
    } catch {
      return results
    }

    for (const file of files) {
      if (!file.endsWith('.md')) continue
      const filePath = join(this.memoryDir, file)
      try {
        const content = await readFile(filePath, 'utf-8')
        const fileStat = await stat(filePath)

        if (options.since !== undefined && fileStat.mtimeMs < options.since) continue
        if (options.keyword && !content.toLowerCase().includes(options.keyword.toLowerCase())) continue

        results.push({
          title: file.replace(/\.md$/, ''),
          content,
          filePath,
          fileName: file,
          createdAt: fileStat.birthtimeMs,
          updatedAt: fileStat.mtimeMs,
        })
      } catch {
        continue
      }
    }

    return results.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  private async readSingleFile(filePath: string): Promise<MemoryDocument[]> {
    const content = await readFile(filePath, 'utf-8')
    const fileStat = await stat(filePath)
    return [{
      title: basename(filePath).replace(/\.md$/, ''),
      content,
      filePath,
      fileName: basename(filePath),
      createdAt: fileStat.birthtimeMs,
      updatedAt: fileStat.mtimeMs,
    }]
  }

  async getMemoryFiles(): Promise<Array<{ fileName: string; sections: Array<{ heading: string; summary: string }> }>> {
    const results: Array<{ fileName: string; sections: Array<{ heading: string; summary: string }> }> = []
    let files: string[]
    try {
      files = await readdir(this.memoryDir)
    } catch {
      return results
    }

    for (const file of files) {
      if (!file.endsWith('.md')) continue
      const filePath = join(this.memoryDir, file)
      try {
        const content = await readFile(filePath, 'utf-8')
        const nodes = parseMarkdown(content, filePath)
        const sections = this.extractSections(nodes, content)
        results.push({ fileName: file, sections })
      } catch {
        continue
      }
    }

    return results
  }

  private extractSections(nodes: import('../types/memory.js').HeadingNode[], rawContent: string): Array<{ heading: string; summary: string }> {
    const result: Array<{ heading: string; summary: string }> = []
    for (const node of nodes) {
      if (node.type === 'heading') {
        const sectionContent = this.extractNodeText(node, rawContent)
        const summary = sectionContent.length > 300
          ? sectionContent.slice(0, 300) + '...'
          : sectionContent
        result.push({ heading: node.title, summary })
        if (node.children) {
          for (const child of node.children) {
            if (child.type === 'heading') {
              result.push(...this.extractSections([child], rawContent))
            }
          }
        }
      }
    }
    return result
  }

  private extractNodeText(node: import('../types/memory.js').HeadingNode, rawContent: string): string {
    if (!node.lineEnd || !node.lineStart) return ''
    const lines = rawContent.split('\n')
    const sectionLines = lines.slice(node.lineStart, node.lineEnd + 1)
    return sectionLines.join('\n').trim()
  }

  async appendToFile(fileName: string, title: string, content: string): Promise<string> {
    const safeName = sanitizeFileName(fileName)
    const filePath = join(this.memoryDir, `${safeName}.md`)
    let existing = ''
    try {
      existing = await readFile(filePath, 'utf-8')
    } catch {
      // file does not exist yet, will create
    }
    const newContent = existing
      ? `${existing}\n\n## ${title}\n\n${content}`
      : `# ${title}\n\n${content}`
    await writeFile(filePath, newContent, 'utf-8')
    return filePath
  }

  async updateSection(fileName: string, heading: string, newContent: string): Promise<string> {
    const safeName = sanitizeFileName(fileName)
    const filePath = join(this.memoryDir, `${safeName}.md`)
    const existing = await readFile(filePath, 'utf-8')
    const lines = existing.split('\n')
    const normalizedTarget = normalizeTitle(heading)
    const newLines: string[] = []
    let replaced = false
    let i = 0
    while (i < lines.length) {
      const line = lines[i]
      const trimmed = line.trim()
      const isExactMatch = trimmed.startsWith('#') && (trimmed === `# ${heading}` || trimmed === `## ${heading}`)
      const isFuzzyMatch = !isExactMatch && trimmed.startsWith('#') && normalizeTitle(trimmed.replace(/^#+\s+/, '')) === normalizedTarget
      if (!replaced && (isExactMatch || isFuzzyMatch)) {
        const headingLine = line
        const oldContentLines: string[] = []
        i++
        while (i < lines.length && !this.isHeadingLine(lines[i])) {
          oldContentLines.push(lines[i])
          i++
        }
        const oldContent = oldContentLines.join('\n').trim()
        const merged = this.mergeContent(oldContent, newContent)
        newLines.push(headingLine)
        newLines.push('')
        newLines.push(merged)
        replaced = true
      } else {
        newLines.push(line)
        i++
      }
    }
    if (!replaced) {
      return this.appendToFile(fileName, heading, newContent)
    }
    const updated = newLines.join('\n')
    await writeFile(filePath, updated, 'utf-8')
    return filePath
  }

  private mergeContent(oldContent: string, newContent: string): string {
    if (!oldContent.trim()) return newContent
    if (!newContent.trim()) return oldContent

    const oldLines = oldContent.split('\n').filter(l => l.trim())
    const newLines = newContent.split('\n').filter(l => l.trim())
    const normalizedOld = oldLines.map(l => normalizeTitle(l))
    const merged: string[] = [...oldLines]
    const seen = new Set(normalizedOld)

    let addedCount = 0
    for (const line of newLines) {
      const normalized = normalizeTitle(line)
      if (seen.has(normalized)) continue

      const isDuplicate = normalizedOld.some(
        old => this.isSimilarLine(old, normalized)
      )
      if (isDuplicate) continue

      merged.push(line)
      seen.add(normalized)
      addedCount++
    }

    return merged.join('\n')
  }

  private isSimilarLine(normalizedOld: string, normalizedNew: string): boolean {
    if (!normalizedOld || !normalizedNew) return false
    if (normalizedOld === normalizedNew) return true
    if (normalizedOld.includes(normalizedNew) && normalizedNew.length >= 4) return true
    if (normalizedNew.includes(normalizedOld) && normalizedOld.length >= 4) return true
    const dist = levenshteinDistance(normalizedOld, normalizedNew)
    if (dist <= 1 && Math.min(normalizedOld.length, normalizedNew.length) >= 6) return false
    const maxLen = Math.max(normalizedOld.length, normalizedNew.length)
    return maxLen > 0 && dist / maxLen < 0.15
  }

  async deleteSection(fileName: string, heading: string): Promise<string> {
    const safeName = sanitizeFileName(fileName)
    const filePath = join(this.memoryDir, `${safeName}.md`)
    const existing = await readFile(filePath, 'utf-8')
    const lines = existing.split('\n')
    const normalizedTarget = normalizeTitle(heading)
    const newLines: string[] = []
    let i = 0
    let deleted = false
    while (i < lines.length) {
      const line = lines[i]
      const trimmed = line.trim()
      const isExactMatch = trimmed.startsWith('#') && (trimmed === `# ${heading}` || trimmed === `## ${heading}`)
      const isFuzzyMatch = !isExactMatch && trimmed.startsWith('#') && normalizeTitle(trimmed.replace(/^#+\s+/, '')) === normalizedTarget
      if (!deleted && (isExactMatch || isFuzzyMatch)) {
        deleted = true
        i++
        while (i < lines.length && !this.isHeadingLine(lines[i])) {
          i++
        }
      } else {
        newLines.push(line)
        i++
      }
    }
    if (!deleted) return filePath
    const updated = newLines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
    if (!updated) {
      await unlink(filePath)
      return filePath
    }
    await writeFile(filePath, updated, 'utf-8')
    return filePath
  }

  private isHeadingLine(line: string): boolean {
    const trimmed = line.trim()
    return trimmed.startsWith('# ') || trimmed.startsWith('## ') || trimmed.startsWith('### ')
  }

  async createFile(fileName: string, title: string, content: string): Promise<string> {
    let safeName = sanitizeFileName(fileName)
    let filePath = join(this.memoryDir, `${safeName}.md`)
    try {
      await access(filePath)
      safeName = `${safeName}-${Date.now()}`
      filePath = join(this.memoryDir, `${safeName}.md`)
    } catch {
      // file does not exist, use original name
    }
    const fileContent = `# ${title}\n\n${content}`
    await writeFile(filePath, fileContent, 'utf-8')
    return filePath
  }

  async update(filePath: string, content: string): Promise<void> {
    await writeFile(filePath, content, 'utf-8')
  }

  async delete(filePath: string): Promise<void> {
    await unlink(filePath)
  }

  watch(callback: (event: 'add' | 'change' | 'unlink', filePath: string) => void): () => void {
    if (this.storeConfig.watchFiles === false) {
      return () => {}
    }

    const watchers: FSWatcher[] = []
    const startWatch = (dir: string) => {
      try {
        const watcher = watch(dir, (eventType: string, filename: string | null) => {
          if (!filename || !filename.endsWith('.md')) return
          const fullPath = join(dir, filename)
          if (eventType === 'rename') {
            access(fullPath)
              .then(() => callback('add', fullPath))
              .catch(() => callback('unlink', fullPath))
          } else if (eventType === 'change') {
            callback('change', fullPath)
          }
        })
        watchers.push(watcher)
      } catch {
        // directory may not exist
      }
    }

    startWatch(this.memoryDir)

    return () => {
      for (const w of watchers) {
        w.close()
      }
      watchers.length = 0
    }
  }
}
