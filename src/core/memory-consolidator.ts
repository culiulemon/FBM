import type { ConversationMessage } from '../types/conversation.js'
import type { MemoryDocument, ConsolidationResult, MemoryRoute } from '../types/retrieval.js'
import type { LLMAdapter, LLMMessage } from '../types/adapter.js'
import type { ConsolidatorConfig } from '../types/config.js'
import { MemoryStore } from './store.js'

const CONSOLIDATION_PROMPT = `You are a memory consolidation assistant. Analyze the conversation and extract information worth remembering long-term.

You will receive a list of existing memory files with their section headings and content summaries. For each piece of valuable information, decide which action to take:

Actions:
- "append": Add a NEW section to an existing file, or create a new file if the file doesn't exist yet. ONLY use this for topics that do NOT already have a matching section in any existing file.
- "update": Replace the content of an existing section with updated information. MUST use this when a section with a SIMILAR topic already exists — even if the information is partially new. Merge new information into the existing section rather than creating a duplicate.
- "delete": Remove an existing section that is no longer relevant or accurate.

Output a JSON array of objects with:
- "file": the target file name (without .md extension). MUST use an existing file name if the information is related to any existing section in that file.
- "title": the section heading title. For "update"/"delete", must match the EXACT existing heading title. For "append", use a clear, distinct title that does NOT overlap with any existing section.
- "content": the extracted information as structured markdown (ignored for delete action). For "update", include ALL relevant information (old + new merged).
- "action": one of "append", "update", "delete"

CRITICAL RULES (must follow strictly):
- NEVER create a new section if a similar topic already exists in the same file — use "update" instead with the EXACT existing heading.
- NEVER output two sections with similar topics in the same consolidation batch — merge them into one "update".
- Extract factual knowledge, lessons learned, user preferences, important decisions.
- Skip trivial small talk, greetings, acknowledgments, and information that is already accurately captured in existing sections.
- Content should be self-contained and understandable without the original conversation.
- File names should be concise and descriptive (e.g. "用户信息", "项目开发记录").
- Output ONLY a JSON array, nothing else.`

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
      return { memories: [], created: 0, updated: 0, deleted: 0, skipped: 0 }
    }

    let existingFiles: Array<{ fileName: string; sections: Array<{ heading: string; summary: string }> }>
    try {
      existingFiles = await this.store.getMemoryFiles()
    } catch {
      existingFiles = []
    }

    const fileListSection = existingFiles.length > 0
      ? `\n\nExisting memory files and sections:\n${existingFiles.map(f =>
          `- ${f.fileName.replace(/\.md$/, '')}:\n${f.sections.map(s => `    - ${s.heading}: ${s.summary}`).join('\n')}`
        ).join('\n')}`
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
        return { memories: [], created: 0, updated: 0, deleted: 0, skipped: 0 }
      }
      rawMemories = JSON.parse(jsonMatch[0])
    } catch {
      return { memories: [], created: 0, updated: 0, deleted: 0, skipped: 0 }
    }

    const result: ConsolidationResult = { memories: [], created: 0, updated: 0, deleted: 0, skipped: 0 }

    for (const raw of rawMemories) {
      try {
        const action = raw.action || 'append'
        const existingFile = existingFiles.find(
          f => f.fileName.replace(/\.md$/, '') === raw.file
        )

        let filePath: string
        if (action === 'delete') {
          if (existingFile) {
            filePath = await this.store.deleteSection(raw.file, raw.title)
            result.deleted++
          } else {
            result.skipped++
            continue
          }
        } else if (action === 'update') {
          if (existingFile) {
            filePath = await this.store.updateSection(raw.file, raw.title, raw.content)
          } else {
            filePath = await this.store.createFile(raw.file, raw.title, raw.content)
            result.created++
          }
          result.updated++
        } else {
          if (existingFile) {
            const hasExactSection = existingFile.sections.some(
              s => s.heading === raw.title
            )
            if (hasExactSection) {
              filePath = await this.store.updateSection(raw.file, raw.title, raw.content)
              result.updated++
            } else {
              filePath = await this.store.appendToFile(raw.file, raw.title, raw.content)
              result.created++
            }
          } else {
            filePath = await this.store.createFile(raw.file, raw.title, raw.content)
            result.created++
          }
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
