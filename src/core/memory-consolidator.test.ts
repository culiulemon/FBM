vi.mock('./fs-adapter.js', async () => {
  return await import('./__mocks__/fs-adapter.js')
})

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { MemoryConsolidator } from './memory-consolidator.js'
import { MemoryStore } from './store.js'
import { rm, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { LLMAdapter, LLMResponse } from '../types/adapter.js'
import type { ConversationMessage } from '../types/conversation.js'

function createMockLLM(responseContent: string): LLMAdapter {
  return {
    chat: vi.fn().mockResolvedValue({
      content: responseContent,
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
    } satisfies LLMResponse),
  } as unknown as LLMAdapter
}

describe('MemoryConsolidator', () => {
  let testDir: string
  let store: MemoryStore
  let llm: LLMAdapter

  beforeEach(async () => {
    testDir = join(tmpdir(), `fbm-consolidator-test-${Date.now()}`)
    store = new MemoryStore(testDir)
    await store.init()
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  it('should return empty result for empty messages', async () => {
    llm = createMockLLM('[]')
    const consolidator = new MemoryConsolidator(store, llm)

    const result = await consolidator.consolidate([])
    expect(result.memories).toHaveLength(0)
    expect(result.created).toBe(0)
    expect(result.updated).toBe(0)
    expect(result.deleted).toBe(0)
    expect(result.skipped).toBe(0)
  })

  it('should create new memory files with append action (default)', async () => {
    const response = JSON.stringify([
      { file: 'user-info', title: 'Basic Info', content: 'Name: cucu\nAge: 28', action: 'append' },
    ])
    llm = createMockLLM(response)
    const consolidator = new MemoryConsolidator(store, llm)

    const messages: ConversationMessage[] = [
      { role: 'user', content: 'My name is cucu, I am 28 years old', timestamp: Date.now() },
      { role: 'assistant', content: 'Nice to meet you cucu!', timestamp: Date.now() },
    ]

    const result = await consolidator.consolidate(messages)
    expect(result.memories).toHaveLength(1)
    expect(result.created).toBe(1)
    expect(result.updated).toBe(0)

    const content = await readFile(result.memories[0].filePath!, 'utf-8')
    expect(content).toContain('# Basic Info')
    expect(content).toContain('Name: cucu')
  })

  it('should append to existing file when file name matches', async () => {
    await store.createFile('user-info', 'Basic Info', 'Name: cucu')

    const response = JSON.stringify([
      { file: 'user-info', title: 'Tech Stack', content: 'TypeScript, React', action: 'append' },
    ])
    llm = createMockLLM(response)
    const consolidator = new MemoryConsolidator(store, llm)

    const messages: ConversationMessage[] = [
      { role: 'user', content: 'I use TypeScript and React', timestamp: Date.now() },
    ]

    const result = await consolidator.consolidate(messages)
    expect(result.memories).toHaveLength(1)
    expect(result.created).toBe(1)

    const content = await readFile(result.memories[0].filePath!, 'utf-8')
    expect(content).toContain('# Basic Info')
    expect(content).toContain('## Tech Stack')
    expect(content).toContain('TypeScript, React')
  })

  it('should update existing section with update action', async () => {
    await store.appendToFile('user-info', 'Basic Info', 'Name: cucu\nAge: 28')

    const response = JSON.stringify([
      { file: 'user-info', title: 'Basic Info', content: 'Name: cucu\nAge: 29\nCity: Shanghai', action: 'update' },
    ])
    llm = createMockLLM(response)
    const consolidator = new MemoryConsolidator(store, llm)

    const messages: ConversationMessage[] = [
      { role: 'user', content: 'I actually live in Shanghai now, and I turned 29', timestamp: Date.now() },
    ]

    const result = await consolidator.consolidate(messages)
    expect(result.memories).toHaveLength(1)
    expect(result.updated).toBe(1)
    expect(result.created).toBe(0)

    const content = await readFile(result.memories[0].filePath!, 'utf-8')
    expect(content).toContain('Age: 29')
    expect(content).toContain('City: Shanghai')
    expect(content).toContain('Age: 28')
  })

  it('should delete existing section with delete action', async () => {
    await store.appendToFile('user-info', 'Old Habit', 'Used to smoke')

    const response = JSON.stringify([
      { file: 'user-info', title: 'Old Habit', content: '', action: 'delete' },
    ])
    llm = createMockLLM(response)
    const consolidator = new MemoryConsolidator(store, llm)

    const messages: ConversationMessage[] = [
      { role: 'user', content: 'I quit smoking a long time ago', timestamp: Date.now() },
    ]

    const result = await consolidator.consolidate(messages)
    expect(result.deleted).toBe(1)
    expect(result.created).toBe(0)
  })

  it('should pass existing file sections with summaries to LLM prompt', async () => {
    await store.createFile('existing-file', 'Old Section', 'old content that is quite long to test summary truncation feature')

    llm = createMockLLM('[]')
    const consolidator = new MemoryConsolidator(store, llm)

    await consolidator.consolidate([
      { role: 'user', content: 'test', timestamp: Date.now() },
    ])

    expect(llm.chat).toHaveBeenCalledOnce()
    const callArgs = (llm.chat as any).mock.calls[0][0]
    const systemMsg = callArgs[0].content
    expect(systemMsg).toContain('existing-file')
    expect(systemMsg).toContain('Old Section')
  })

  it('should handle LLM returning invalid JSON gracefully', async () => {
    llm = createMockLLM('This is not JSON')
    const consolidator = new MemoryConsolidator(store, llm)

    const result = await consolidator.consolidate([
      { role: 'user', content: 'test', timestamp: Date.now() },
    ])

    expect(result.memories).toHaveLength(0)
  })

  it('should call onResult callback after consolidation', async () => {
    const response = JSON.stringify([
      { file: 'new-file', title: 'New Section', content: 'new content', action: 'append' },
    ])
    llm = createMockLLM(response)
    const consolidator = new MemoryConsolidator(store, llm)

    const callback = vi.fn()
    consolidator.onResult(callback)

    await consolidator.consolidate([
      { role: 'user', content: 'test', timestamp: Date.now() },
    ])

    expect(callback).toHaveBeenCalledOnce()
  })

  it('should create multiple files from multiple memories', async () => {
    const response = JSON.stringify([
      { file: 'user-info', title: 'Name', content: 'cucu', action: 'append' },
      { file: 'project-notes', title: 'Architecture', content: 'Tauri + Vue', action: 'append' },
    ])
    llm = createMockLLM(response)
    const consolidator = new MemoryConsolidator(store, llm)

    const result = await consolidator.consolidate([
      { role: 'user', content: 'test', timestamp: Date.now() },
    ])

    expect(result.memories).toHaveLength(2)
    expect(result.created).toBe(2)
  })

  it('should handle mixed actions in a single consolidation', async () => {
    await store.appendToFile('user-info', 'Hobby', 'Playing games')

    const response = JSON.stringify([
      { file: 'user-info', title: 'Hobby', content: 'Reading books and coding', action: 'update' },
      { file: 'user-info', title: 'Work', content: 'Software Engineer', action: 'append' },
    ])
    llm = createMockLLM(response)
    const consolidator = new MemoryConsolidator(store, llm)

    const result = await consolidator.consolidate([
      { role: 'user', content: 'I changed my hobby to reading and coding. I work as a software engineer', timestamp: Date.now() },
    ])

    expect(result.updated).toBe(1)
    expect(result.created).toBe(1)
    expect(result.memories).toHaveLength(2)
  })

  it('should default to append when action is missing', async () => {
    const response = JSON.stringify([
      { file: 'new-file', title: 'Section', content: 'content' },
    ])
    llm = createMockLLM(response)
    const consolidator = new MemoryConsolidator(store, llm)

    const result = await consolidator.consolidate([
      { role: 'user', content: 'test', timestamp: Date.now() },
    ])

    expect(result.created).toBe(1)
  })

  it('should auto-upgrade append to update when same heading exists in file', async () => {
    await store.appendToFile('user-info', '小红书账号', '昵称: cucu\nID: CUCU')

    const response = JSON.stringify([
      { file: 'user-info', title: '小红书账号', content: '昵称: cucu-new\nID: NEW_ID', action: 'append' },
    ])
    llm = createMockLLM(response)
    const consolidator = new MemoryConsolidator(store, llm)

    const result = await consolidator.consolidate([
      { role: 'user', content: 'My xiaohongshu ID changed to NEW_ID', timestamp: Date.now() },
    ])

    expect(result.updated).toBe(1)
    expect(result.created).toBe(0)

    const content = await readFile(join(testDir, 'user-info.md'), 'utf-8')
    expect(content).toContain('NEW_ID')
    const headingCount = (content.match(/^#{1,2} 小红书账号$/gm) || []).length
    expect(headingCount).toBe(1)
  })
})
