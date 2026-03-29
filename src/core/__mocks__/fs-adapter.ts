import { mkdir, writeFile, readFile, unlink, readdir, stat as nodeStat, access as nodeAccess } from 'node:fs/promises'
import { join as nodeJoin, basename as nodeBasename, extname as nodeExtname } from 'node:path'
import { existsSync } from 'node:fs'

export interface Stats {
  mtimeMs: number
  birthtimeMs: number
  isFile(): boolean
  isDirectory(): boolean
}

export interface DirEntryInfo {
  name: string
  isDirectory: boolean
}

export type WatchEventType = 'rename' | 'change'
export type WatchListener = (eventType: WatchEventType, filename: string | null) => void

export interface FSWatcher {
  close(): void
}

async function mkdirP(path: string, _options?: { recursive?: boolean }): Promise<void> {
  await mkdir(path, { recursive: true })
}

async function readFileFn(path: string, encoding?: string): Promise<string> {
  return readFile(path, encoding as BufferEncoding)
}

async function writeFileFn(path: string, data: string, _encoding?: string): Promise<void> {
  await writeFile(path, data, 'utf-8')
}

async function unlinkFn(path: string): Promise<void> {
  await unlink(path)
}

async function readdirFn(path: string): Promise<string[]> {
  return readdir(path)
}

async function readdirDetailedFn(path: string): Promise<DirEntryInfo[]> {
  const { readdir } = await import('node:fs/promises')
  const { stat } = await import('node:fs/promises')
  const entries = await readdir(path)
  const result: DirEntryInfo[] = []
  for (const entry of entries) {
    const s = await stat(`${path}/${entry}`)
    result.push({ name: entry, isDirectory: s.isDirectory() })
  }
  return result
}

async function statFn(path: string): Promise<Stats> {
  const s = await nodeStat(path)
  return {
    mtimeMs: s.mtimeMs,
    birthtimeMs: s.birthtimeMs,
    isFile: () => s.isFile(),
    isDirectory: () => s.isDirectory(),
  }
}

async function accessFn(path: string): Promise<void> {
  if (!existsSync(path)) throw new Error('ENOENT')
}

function joinFn(...segments: string[]): string {
  return nodeJoin(...segments)
}

function basenameFn(path: string, ext?: string): string {
  return nodeBasename(path, ext)
}

function extnameFn(path: string): string {
  return nodeExtname(path)
}

function watchFn(_dir: string, _listener: WatchListener): FSWatcher {
  return { close() {} }
}

export { mkdirP as mkdir, readFileFn as readFile, writeFileFn as writeFile, unlinkFn as unlink, readdirFn as readdir, readdirDetailedFn as readdirDetailed, statFn as stat, accessFn as access, joinFn as join, basenameFn as basename, extnameFn as extname, watchFn as watch }
