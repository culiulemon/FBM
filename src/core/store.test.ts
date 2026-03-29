vi.mock('./fs-adapter.js', async () => {
  return await import('./__mocks__/fs-adapter.js')
})

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MemoryStore } from './store.js'
import { rm, readFile } from 'node:fs/promises'
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

  it('should create only the root memories directory on init', async () => {
    const { readdir } = await import('node:fs/promises')
    const entries = await readdir(testDir)
    expect(entries).toHaveLength(0)
  })

  it('should create a new file with createFile', async () => {
    const filePath = await store.createFile('test-doc', 'Test Title', 'Some content here.')
    const content = await readFile(filePath, 'utf-8')
    expect(content).toContain('# Test Title')
    expect(content).toContain('Some content here')
    expect(filePath.endsWith('test-doc.md')).toBe(true)
  })

  it('should sanitize file names', async () => {
    const filePath = await store.createFile('Tauri<2.0>: Desktop/App "Guide"', 'Title', 'test')
    const fileName = filePath.split(/[\\/]/).pop()!
    expect(fileName).not.toMatch(/[<>:"|?*]/)
    expect(filePath.endsWith('.md')).toBe(true)
  })

  it('should append a section to existing file', async () => {
    await store.createFile('user-info', 'Basic Info', 'Name: cucu')
    const filePath = await store.appendToFile('user-info', 'Tech Stack', 'TypeScript, React')

    const content = await readFile(filePath, 'utf-8')
    expect(content).toContain('# Basic Info')
    expect(content).toContain('## Tech Stack')
    expect(content).toContain('TypeScript, React')
  })

  it('should create file if not exists when appending', async () => {
    const filePath = await store.appendToFile('new-file', 'New Section', 'New content')
    const content = await readFile(filePath, 'utf-8')
    expect(content).toContain('# New Section')
    expect(content).toContain('New content')
  })

  it('should handle duplicate file names by adding timestamp', async () => {
    const path1 = await store.createFile('test-doc', 'Title', 'first')
    const path2 = await store.createFile('test-doc', 'Title', 'second')
    expect(path1).not.toBe(path2)
  })

  it('should get memory files with headings', async () => {
    await store.createFile('user-info', 'Basic Info', 'Name: cucu')
    await store.appendToFile('user-info', 'Tech Stack', 'TypeScript')
    await store.createFile('project-notes', 'Architecture', 'Some design')

    const files = await store.getMemoryFiles()
    expect(files).toHaveLength(2)

    const userInfo = files.find(f => f.fileName.includes('user-info'))
    expect(userInfo).toBeDefined()
    expect(userInfo!.headings).toContain('Basic Info')
    expect(userInfo!.headings).toContain('Tech Stack')

    const projectNotes = files.find(f => f.fileName.includes('project-notes'))
    expect(projectNotes).toBeDefined()
    expect(projectNotes!.headings).toContain('Architecture')
  })

  it('should return empty headings for files without # headings', async () => {
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(testDir, 'plain.md'), 'Just some text without headings', 'utf-8')

    const files = await store.getMemoryFiles()
    const plain = files.find(f => f.fileName === 'plain.md')
    expect(plain).toBeDefined()
    expect(plain!.headings).toHaveLength(0)
  })

  it('should write a memory document', async () => {
    const filePath = await store.write({
      title: 'Rust Async Programming',
      content: '# Rust Async Programming\n\nSome content here.',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })

    const content = await readFile(filePath, 'utf-8')
    expect(content).toContain('Some content here')
  })

  it('should read memories by keyword', async () => {
    await store.write({
      title: 'Rust Guide',
      content: 'Rust is a systems programming language',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    await store.write({
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
      title: 'Deletable Doc',
      content: 'to be deleted',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })

    await store.delete(filePath)
    const results = await store.read()
    expect(results).toHaveLength(0)
  })

  it('should handle empty title', async () => {
    const filePath = await store.write({
      title: '',
      content: 'empty title doc',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })

    expect(filePath).toContain('untitled')
  })
})
