import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

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

async function mkdir(path: string, _options?: { recursive?: boolean }): Promise<void> {
  try {
    await invoke('fbm_mkdir', { path })
  } catch (e) {
    throw new Error(String(e))
  }
}

async function writeFile(path: string, data: string, _encoding?: string): Promise<void> {
  try {
    await invoke('fbm_write_file', { path, content: data })
  } catch (e) {
    throw new Error(String(e))
  }
}

async function readFile(path: string, _encoding?: string): Promise<string> {
  try {
    return await invoke<string>('fbm_read_file', { path })
  } catch (e) {
    throw new Error(String(e))
  }
}

async function unlink(path: string): Promise<void> {
  try {
    await invoke('fbm_unlink', { path })
  } catch (e) {
    throw new Error(String(e))
  }
}

async function readdir(path: string): Promise<string[]> {
  try {
    return await invoke<string[]>('fbm_readdir', { path })
  } catch (e) {
    throw new Error(String(e))
  }
}

async function readdirDetailed(path: string): Promise<DirEntryInfo[]> {
  try {
    return await invoke<DirEntryInfo[]>('fbm_readdir_detailed', { path })
  } catch (e) {
    throw new Error(String(e))
  }
}

async function stat(path: string): Promise<Stats> {
  try {
    const raw = await invoke<{ mtimeMs: number; birthtimeMs: number; isFile: boolean; isDirectory: boolean }>('fbm_stat', { path })
    return {
      mtimeMs: raw.mtimeMs,
      birthtimeMs: raw.birthtimeMs,
      isFile: () => raw.isFile,
      isDirectory: () => raw.isDirectory,
    }
  } catch (e) {
    throw new Error(String(e))
  }
}

async function access(path: string): Promise<void> {
  try {
    const exists = await invoke<boolean>('fbm_exists', { path })
    if (!exists) throw new Error('ENOENT')
  } catch (e) {
    if (e instanceof Error && e.message === 'ENOENT') throw e
    throw new Error(String(e))
  }
}

function join(...segments: string[]): string {
  let result = segments[0] ?? ''
  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i]
    if (!seg) continue
    if (isAbsolute(seg)) {
      result = seg
    } else if (result.endsWith('/') || result.endsWith('\\')) {
      result += seg
    } else {
      result += '/' + seg
    }
  }
  return result.replace(/\\/g, '/')
}

function basename(path: string, ext?: string): string {
  const normalized = path.replace(/\\/g, '/')
  const lastSlash = normalized.lastIndexOf('/')
  let name = lastSlash === -1 ? normalized : normalized.slice(lastSlash + 1)
  if (ext !== undefined && name.endsWith(ext) && name.length > ext.length) {
    name = name.slice(0, -ext.length)
  }
  return name
}

function extname(path: string): string {
  const name = basename(path)
  const lastDot = name.lastIndexOf('.')
  if (lastDot <= 0) return ''
  return name.slice(lastDot)
}

function isAbsolute(path: string): boolean {
  const normalized = path.replace(/\\/g, '/')
  return normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)
}

function watch(dir: string, listener: WatchListener): FSWatcher {
  let unlisten: UnlistenFn | null = null

  const eventTypeMap: Record<string, WatchEventType> = {
    add: 'rename',
    remove: 'rename',
    change: 'change',
  }

  invoke('fbm_start_watch', { dir }).then(() => {
    listen<{ event: string; path: string }>('fbm-fs-watch', (tauriEvent) => {
      const payload = tauriEvent.payload
      const nodeEventType = eventTypeMap[payload.event] ?? 'change'
      const filename = basename(payload.path)
      listener(nodeEventType, filename)
    }).then((fn) => {
      unlisten = fn
    })
  }).catch(() => {})

  return {
    close(): void {
      invoke('fbm_stop_watch').catch(() => {})
      if (unlisten) {
        unlisten()
        unlisten = null
      }
    },
  }
}

export { mkdir, writeFile, readFile, unlink, readdir, readdirDetailed, stat, access, join, basename, extname, watch }
