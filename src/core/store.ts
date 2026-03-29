import type { MemoryDocument } from '../types/retrieval.js'
import type { StoreConfig } from '../types/config.js'
import { mkdir, writeFile, readFile, unlink, readdir, stat, access, join, basename, extname, watch } from './fs-adapter.js'
import type { FSWatcher } from './fs-adapter.js'
import { parseMarkdown } from './node-locator.js'

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

  async getMemoryFiles(): Promise<Array<{ fileName: string; headings: string[] }>> {
    const results: Array<{ fileName: string; headings: string[] }> = []
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
        const headings = this.extractAllHeadings(nodes)
        results.push({ fileName: file, headings })
      } catch {
        continue
      }
    }

    return results
  }

  private extractAllHeadings(nodes: import('../types/memory.js').HeadingNode[]): string[] {
    const result: string[] = []
    for (const node of nodes) {
      if (node.type === 'heading') {
        result.push(node.title)
        if (node.children) {
          for (const child of node.children) {
            if (child.type === 'heading') {
              result.push(...this.extractAllHeadings([child]))
            }
          }
        }
      }
    }
    return result
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
