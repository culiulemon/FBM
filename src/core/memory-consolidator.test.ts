vi.mock('./fs-adapter.js', async () => {
  return await import('./__mocks__/fs-adapter.js')
})

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { MemoryConsolidator } from './memory-consolidator.js'
import { MemoryStore } from './store.js'
import { rm, readFile } from 'node:fs/promises'
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
  })

  it('should create new memory files', async () => {
    const response = JSON.stringify([
      { file: 'user-info', title: 'Basic Info', content: 'Name: cucu\nAge: 28' },
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

    const content = await readFile(result.memories[0].filePath!, 'utf-8')
    expect(content).toContain('# Basic Info')
    expect(content).toContain('Name: cucu')
  })

  it('should append to existing file when file name matches', async () => {
    await store.createFile('user-info', 'Basic Info', 'Name: cucu')

    const response = JSON.stringify([
      { file: 'user-info', title: 'Tech Stack', content: 'TypeScript, React' },
    ])
    llm = createMockLLM(response)
    const consolidator = new MemoryConsolidator(store, llm)

    const messages: ConversationMessage[] = [
      { role: 'user', content: 'I use TypeScript and React', timestamp: Date.now() },
    ]

    const result = await consolidator.consolidate(messages)
    expect(result.memories).toHaveLength(1)

    const content = await readFile(result.memories[0].filePath!, 'utf-8')
    expect(content).toContain('# Basic Info')
    expect(content).toContain('## Tech Stack')
    expect(content).toContain('TypeScript, React')
  })

  it('should pass existing file list to LLM prompt', async () => {
    await store.createFile('existing-file', 'Old Section', 'old content')

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
      { file: 'new-file', title: 'New Section', content: 'new content' },
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
      { file: 'user-info', title: 'Name', content: 'cucu' },
      { file: 'project-notes', title: 'Architecture', content: 'Tauri + Vue' },
    ])
    llm = createMockLLM(response)
    const consolidator = new MemoryConsolidator(store, llm)

    const result = await consolidator.consolidate([
      { role: 'user', content: 'test', timestamp: Date.now() },
    ])

    expect(result.memories).toHaveLength(2)
    expect(result.created).toBe(2)
  })
})
