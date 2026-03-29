import type { ConversationMessage } from '../types/conversation.js'
import type { MemoryDocument, ConsolidationResult, MemoryRoute } from '../types/retrieval.js'
import type { LLMAdapter, LLMMessage } from '../types/adapter.js'
import type { ConsolidatorConfig } from '../types/config.js'
import { MemoryStore } from './store.js'

const CONSOLIDATION_PROMPT = `You are a memory consolidation assistant. Analyze the conversation and extract information worth remembering long-term.

You will receive a list of existing memory files with their section headings. For each piece of valuable information, decide whether to add it to an existing file or create a new file.

Output a JSON array of objects with:
- "file": the target file name (without .md extension). Use an existing file name if the information belongs there, or create a descriptive new file name (2-6 words, meaningful for future retrieval).
- "title": a concise section title (2-8 words) for the new section within the file
- "content": the extracted information as structured markdown

Rules:
- Extract factual knowledge, lessons learned, user preferences, important decisions
- Skip trivial small talk, greetings, acknowledgments
- If multiple pieces are unrelated, output multiple objects
- Group related information into the same file
- Title should be descriptive and searchable
- Content should be self-contained and understandable without the original conversation
- File names should be concise and descriptive (e.g. "用户信息", "项目开发记录")
- Output ONLY a JSON array, nothing else`

export class MemoryConsolidator {
  private store: MemoryStore
  private llm: LLMAdapter
  private config: ConsolidatorConfig
  private onConsolidated: ((result: ConsolidationResult) => void) | null = null

  constructor(store: MemoryStore, llm: LLMAdapter, config: ConsolidatorConfig = {}) {
    this.store = store
    this.llm = llm
    this.config = config
  }

  onResult(callback: (result: ConsolidationResult) => void): void {
    this.onConsolidated = callback
  }

  async consolidate(messages: ConversationMessage[]): Promise<ConsolidationResult> {
    if (messages.length === 0) {
      return { memories: [], created: 0, skipped: 0 }
    }

    let existingFiles: Array<{ fileName: string; headings: string[] }>
    try {
      existingFiles = await this.store.getMemoryFiles()
    } catch {
      existingFiles = []
    }

    const fileListSection = existingFiles.length > 0
      ? `\n\nExisting memory files:\n${existingFiles.map(f => `- ${f.fileName.replace(/\.md$/, '')}: [${f.headings.join(', ')}]`).join('\n')}`
      : '\n\nNo existing memory files.'

    const conversationText = messages
      .map(m => `[${m.role}]: ${m.content}`)
      .join('\n')

    const llmMessages: LLMMessage[] = [
      { role: 'system', content: CONSOLIDATION_PROMPT + fileListSection },
      { role: 'user', content: conversationText },
    ]

    let rawMemories: MemoryRoute[]
    try {
      const response = await this.llm.chat(llmMessages, {
        maxTokens: this.config.maxSummaryTokens,
        temperature: 0.3,
      })
      const jsonMatch = response.content.trim().match(/\[[\s\S]*\]/)
      if (!jsonMatch) {
        return { memories: [], created: 0, skipped: 0 }
      }
      rawMemories = JSON.parse(jsonMatch[0])
    } catch {
      return { memories: [], created: 0, skipped: 0 }
    }

    const result: ConsolidationResult = { memories: [], created: 0, skipped: 0 }

    for (const raw of rawMemories) {
      try {
        const existingFile = existingFiles.find(
          f => f.fileName.replace(/\.md$/, '') === raw.file
        )

        let filePath: string
        if (existingFile) {
          filePath = await this.store.appendToFile(raw.file, raw.title, raw.content)
        } else {
          filePath = await this.store.createFile(raw.file, raw.title, raw.content)
        }

        const doc: MemoryDocument = {
          title: raw.title,
          content: raw.content,
          filePath,
          fileName: `${raw.file}.md`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }

        result.memories.push(doc)
        result.created++
      } catch {
        result.skipped++
      }
    }

    this.onConsolidated?.(result)
    return result
  }

  destroy(): void {
    // no-op: no timers or buffers to clean up
  }
}
