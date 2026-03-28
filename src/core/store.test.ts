import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MemoryStore } from './store.js'
import { MemoryType } from '../types/memory.js'
import { mkdir, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('MemoryStore', () => {
  let testDir: string
  let store: MemoryStore

  beforeEach(async () => {
    testDir = join(tmpdir(), `fbm-test-${Date.now()}`)
    store = new MemoryStore(testDir)
    await store.init()
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  it('should create default type directories on init', async () => {
    const { readdir } = await import('node:fs/promises')
    const dirs = await readdir(testDir)
    expect(dirs).toContain('knowledge')
    expect(dirs).toContain('experience')
    expect(dirs).toContain('preference')
    expect(dirs).toContain('event')
    expect(dirs).toContain('project')
  })

  it('should write a memory document to correct type directory', async () => {
    const filePath = await store.write({
      type: MemoryType.Knowledge,
      title: 'Rust Async Programming',
      content: '# Rust Async Programming\n\nSome content here.',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })

    expect(filePath).toContain('knowledge')
    expect(filePath).toContain('Rust Async Programming.md')

    const content = await readFile(filePath, 'utf-8')
    expect(content).toContain('Some content here')
  })

  it('should sanitize file names', async () => {
    const filePath = await store.write({
      type: MemoryType.Knowledge,
      title: 'Tauri<2.0>: Desktop/App "Guide"',
      content: 'test',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })

    const fileName = filePath.split(/[\\/]/).pop()!
    expect(fileName).not.toMatch(/[<>:"|?*]/)
    expect(filePath.endsWith('.md')).toBe(true)
  })

  it('should handle duplicate file names by adding timestamp', async () => {
    const doc = {
      type: MemoryType.Knowledge,
      title: 'Test Document',
      content: 'first',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    const path1 = await store.write({ ...doc })
    const path2 = await store.write({ ...doc, content: 'second' })

    expect(path1).not.toBe(path2)
  })

  it('should read memories by type', async () => {
    await store.write({
      type: MemoryType.Knowledge,
      title: 'Knowledge Doc',
      content: 'knowledge content',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    await store.write({
      type: MemoryType.Preference,
      title: 'Preference Doc',
      content: 'preference content',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })

    const knowledgeDocs = await store.read({ type: MemoryType.Knowledge })
    expect(knowledgeDocs).toHaveLength(1)
    expect(knowledgeDocs[0].type).toBe(MemoryType.Knowledge)
    expect(knowledgeDocs[0].content).toContain('knowledge content')

    const preferenceDocs = await store.read({ type: MemoryType.Preference })
    expect(preferenceDocs).toHaveLength(1)
    expect(preferenceDocs[0].type).toBe(MemoryType.Preference)
  })

  it('should read memories by keyword', async () => {
    await store.write({
      type: MemoryType.Knowledge,
      title: 'Rust Guide',
      content: 'Rust is a systems programming language',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    await store.write({
      type: MemoryType.Knowledge,
      title: 'TypeScript Guide',
      content: 'TypeScript is a typed superset of JavaScript',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })

    const results = await store.read({ keyword: 'Rust' })
    expect(results).toHaveLength(1)
    expect(results[0].title).toBe('Rust Guide')
  })

  it('should update existing files', async () => {
    const filePath = await store.write({
      type: MemoryType.Knowledge,
      title: 'Updatable Doc',
      content: 'original content',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })

    await store.update(filePath, 'updated content')
    const content = await readFile(filePath, 'utf-8')
    expect(content).toBe('updated content')
  })

  it('should delete files', async () => {
    const filePath = await store.write({
      type: MemoryType.Knowledge,
      title: 'Deletable Doc',
      content: 'to be deleted',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })

    await store.delete(filePath)
    const results = await store.read({ type: MemoryType.Knowledge })
    expect(results).toHaveLength(0)
  })

  it('should return empty results for non-existent type directory', async () => {
    const results = await store.read({ type: MemoryType.Custom })
    expect(results).toHaveLength(0)
  })

  it('should handle empty title', async () => {
    const filePath = await store.write({
      type: MemoryType.Knowledge,
      title: '',
      content: 'empty title doc',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })

    expect(filePath).toContain('untitled')
  })
})
