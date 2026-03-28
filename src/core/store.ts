import { MemoryType, MEMORY_TYPE_DIRS, DEFAULT_MEMORY_TYPES } from '../types/memory.js'
import type { MemoryDocument } from '../types/retrieval.js'
import type { StoreConfig } from '../types/config.js'
import { mkdir, writeFile, readFile, unlink, readdir, stat, access } from 'node:fs/promises'
import { watch } from 'node:fs'
import { join, basename, extname } from 'node:path'
import type { FSWatcher } from 'node:fs'

const INVALID_CHARS = /[<>:"/\\|?*\x00-\x1f]/g
const MAX_FILENAME_LEN = 200

function sanitizeFileName(title: string): string {
  let safe = title.replace(INVALID_CHARS, '_').trim().replace(/\.+$/, '')
  if (safe.length === 0) safe = 'untitled'
  if (safe.length > MAX_FILENAME_LEN) safe = safe.slice(0, MAX_FILENAME_LEN)
  if (!extname(safe).toLowerCase().endsWith('.md')) safe += '.md'
  return safe
}

function getTypeDir(memoryDir: string, type: MemoryType): string {
  return join(memoryDir, MEMORY_TYPE_DIRS[type])
}

function getTypeFromDirName(dirName: string): MemoryType {
  for (const [type, dir] of Object.entries(MEMORY_TYPE_DIRS)) {
    if (dir === dirName) return type as MemoryType
  }
  return MemoryType.Custom
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
    const types = this.storeConfig.defaultMemoryTypes
      ? this.storeConfig.defaultMemoryTypes.map(t => t as MemoryType)
      : DEFAULT_MEMORY_TYPES
    for (const type of types) {
      await mkdir(getTypeDir(this.memoryDir, type), { recursive: true })
    }
  }

  async write(doc: MemoryDocument): Promise<string> {
    const typeDir = getTypeDir(this.memoryDir, doc.type)
    await mkdir(typeDir, { recursive: true })
    let fileName = sanitizeFileName(doc.title)
    const filePath = join(typeDir, fileName)
    try {
      await access(filePath)
      const timestamp = Date.now()
      const nameWithoutExt = basename(fileName, '.md')
      fileName = sanitizeFileName(`${nameWithoutExt}_${timestamp}`)
    } catch {
      // file does not exist, use original name
    }
    const finalPath = join(typeDir, fileName)
    await writeFile(finalPath, doc.content, 'utf-8')
    return finalPath
  }

  async read(options: {
    type?: MemoryType
    keyword?: string
    since?: number
    path?: string
  } = {}): Promise<MemoryDocument[]> {
    if (options.path) {
      return this.readSingleFile(options.path)
    }

    const dirs: string[] = []
    if (options.type) {
      dirs.push(getTypeDir(this.memoryDir, options.type))
    } else {
      const types = this.storeConfig.defaultMemoryTypes
        ? this.storeConfig.defaultMemoryTypes.map(t => t as MemoryType)
        : DEFAULT_MEMORY_TYPES
      for (const type of types) {
        dirs.push(getTypeDir(this.memoryDir, type))
      }
    }

    const results: MemoryDocument[] = []
    for (const dir of dirs) {
      let files: string[]
      try {
        files = await readdir(dir)
      } catch {
        continue
      }
      for (const file of files) {
        if (!file.endsWith('.md')) continue
        const filePath = join(dir, file)
        try {
          const content = await readFile(filePath, 'utf-8')
          const fileStat = await stat(filePath)

          if (options.since !== undefined && fileStat.mtimeMs < options.since) continue
          if (options.keyword && !content.toLowerCase().includes(options.keyword.toLowerCase())) continue

          const dirName = basename(dir)
          results.push({
            type: getTypeFromDirName(dirName),
            title: file.replace(/\.md$/, ''),
            content,
            filePath,
            createdAt: fileStat.birthtimeMs,
            updatedAt: fileStat.mtimeMs,
          })
        } catch {
          continue
        }
      }
    }

    return results.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  private async readSingleFile(filePath: string): Promise<MemoryDocument[]> {
    const content = await readFile(filePath, 'utf-8')
    const fileStat = await stat(filePath)
    const type = getTypeFromDirName(basename(join(filePath, '..')))
    return [{
      type,
      title: basename(filePath).replace(/\.md$/, ''),
      content,
      filePath,
      createdAt: fileStat.birthtimeMs,
      updatedAt: fileStat.mtimeMs,
    }]
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
        const watcher = watch(dir, { recursive: true }, (eventType: string, filename: string | null) => {
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
