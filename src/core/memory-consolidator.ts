import type { ConversationMessage } from '../types/conversation.js'
import type { MemoryDocument, ConsolidationResult, MemoryRoute } from '../types/retrieval.js'
import type { LLMAdapter, LLMMessage } from '../types/adapter.js'
import type { ConsolidatorConfig } from '../types/config.js'
import { MemoryStore } from './store.js'
import { normalizeTitle } from './node-locator.js'

function parseYamlMemoryItems(text: string): MemoryRoute[] {
  const trimmed = text.trim()
  if (!trimmed.startsWith('- ')) return []

  const items: MemoryRoute[] = []
  let currentItem: Record<string, string> | null = null
  let currentKey = ''
  let valueLines: string[] = []

  const flushItem = () => {
    if (currentKey && currentItem) {
      currentItem[currentKey] = valueLines.join('\n').trim()
    }
    if (currentItem && currentItem.file && currentItem.title) {
      items.push({
        file: currentItem.file,
        title: currentItem.title,
        content: currentItem.content || '',
        action: (currentItem.action as MemoryRoute['action']) || 'append',
      })
    }
    currentItem = null
    currentKey = ''
    valueLines = []
  }

  for (const rawLine of trimmed.split('\n')) {
    const itemStart = rawLine.match(/^- (file|title|content|action):\s*(.*)/)
    if (itemStart) {
      flushItem()
      currentItem = {}
      currentKey = itemStart[1]
      valueLines = itemStart[2] ? [itemStart[2]] : []
      continue
    }

    const kvMatch = rawLine.match(/^\s{1,2}(file|title|content|action):\s*(.*)/)
    if (kvMatch && currentItem) {
      if (currentKey) {
        currentItem[currentKey] = valueLines.join('\n').trim()
      }
      currentKey = kvMatch[1]
      valueLines = kvMatch[2] ? [kvMatch[2]] : []
      continue
    }

    if (currentKey && currentItem) {
      valueLines.push(rawLine.replace(/^\s{2,}/, ''))
    }
  }
  flushItem()

  return items
}

function isValidMemoryRoute(obj: unknown): obj is MemoryRoute {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return false
  const r = obj as Record<string, unknown>
  return typeof r.file === 'string' && typeof r.title === 'string' && typeof r.content === 'string'
}

function extractAndParseJSON(text: string): unknown[] {
  const trimmed = text.trim()

  const arrayMatch = trimmed.match(/\[[\s\S]*\]/)
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0])
      if (Array.isArray(parsed)) return parsed
    } catch {}
  }

  const objectMatches = trimmed.match(/\{[\s\S]*?"action"\s*:\s*"[^"]*"[\s\S]*\}/g)
  if (objectMatches) {
    const results: unknown[] = []
    for (const m of objectMatches) {
      try {
        results.push(JSON.parse(m))
      } catch {}
    }
    if (results.length > 0) return results
  }

  try {
    const parsed = JSON.parse(trimmed)
    if (Array.isArray(parsed)) return parsed
    if (typeof parsed === 'object' && parsed !== null) return [parsed]
  } catch {}

  return []
}

function parseLLMResponse(content: string): MemoryRoute[] {
  const trimmed = content.trim()

  const jsonItems = extractAndParseJSON(trimmed)
  if (jsonItems.length > 0) {
    const valid = jsonItems.filter(isValidMemoryRoute)
    if (valid.length > 0) {
      if (valid.length < jsonItems.length) {
        console.warn(
          `[FBM] parseLLMResponse: ${jsonItems.length - valid.length} items discarded due to invalid structure`,
          'raw sample:', JSON.stringify(jsonItems.find(i => !isValidMemoryRoute(i)))
        )
      }
      return valid
    }
    console.warn('[FBM] parseLLMResponse: JSON parsed but no valid MemoryRoute items found')
  }

  const yamlItems = parseYamlMemoryItems(trimmed)
  if (yamlItems.length > 0) return yamlItems

  console.warn('[FBM] parseLLMResponse: failed to parse LLM response', trimmed.slice(0, 200))
  return []
}

const CONSOLIDATION_PROMPT = `You are a memory consolidation assistant. Analyze the conversation and extract information worth remembering long-term.

You will receive a list of existing memory files with their section headings and content summaries. For each piece of valuable information, decide which action to take:

Actions:
- "append": Add a NEW section to an existing file, or create a new file if the file doesn't exist yet. ONLY use this for topics that do NOT already have a matching section in any existing file.
- "update": Replace the content of an existing section with updated information. MUST use this when a section with a SIMILAR topic already exists — even if the information is partially new. Merge new information into the existing section rather than creating a duplicate.
- "delete": Remove an existing section that is no longer relevant or accurate.

Output a JSON array of objects with:
- "file": the target file name (without .md extension). MUST use an existing file name if the information is related to any existing section in that file.
- "title": the section heading title. For "update"/"delete", must match the EXACT existing heading title. For "append", use a clear, distinct title that does NOT overlap with any existing section.
- "content": the extracted information as structured markdown (ignored for delete action). For "update", provide ONLY the new or changed information — the system will automatically merge it with existing content.
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
      rawMemories = parseLLMResponse(response.content)
      if (rawMemories.length === 0) {
        return { memories: [], created: 0, updated: 0, deleted: 0, skipped: 0 }
      }
    } catch (err) {
      console.warn('[FBM] consolidation LLM call failed:', err)
      return { memories: [], created: 0, updated: 0, deleted: 0, skipped: 0 }
    }

    const result: ConsolidationResult = { memories: [], created: 0, updated: 0, deleted: 0, skipped: 0 }

    const processedSections = new Map<string, Set<string>>()

    const fileHasSection = (fileName: string, title: string): boolean => {
      const normalized = normalizeTitle(title)
      const existing = existingFiles.find(f => f.fileName.replace(/\.md$/, '') === fileName)
      if (existing) {
        if (existing.sections.some(s => normalizeTitle(s.heading) === normalized)) return true
      }
      const tracked = processedSections.get(fileName)
      if (tracked) {
        for (const t of tracked) {
          if (normalizeTitle(t) === normalized) return true
        }
      }
      return false
    }

    const trackSection = (fileName: string, title: string): void => {
      if (!processedSections.has(fileName)) {
        processedSections.set(fileName, new Set())
      }
      processedSections.get(fileName)!.add(title)
    }

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
          if (existingFile || fileHasSection(raw.file, raw.title)) {
            filePath = await this.store.updateSection(raw.file, raw.title, raw.content)
            trackSection(raw.file, raw.title)
          } else {
            filePath = await this.store.createFile(raw.file, raw.title, raw.content)
            trackSection(raw.file, raw.title)
            result.created++
          }
          result.updated++
        } else {
          if (existingFile || fileHasSection(raw.file, raw.title)) {
            if (fileHasSection(raw.file, raw.title)) {
              filePath = await this.store.updateSection(raw.file, raw.title, raw.content)
              result.updated++
            } else {
              filePath = await this.store.appendToFile(raw.file, raw.title, raw.content)
              trackSection(raw.file, raw.title)
              result.created++
            }
          } else {
            filePath = await this.store.createFile(raw.file, raw.title, raw.content)
            trackSection(raw.file, raw.title)
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
      } catch (err) {
        console.warn(`[FBM] failed to process memory item (file="${raw.file}", title="${raw.title}"):`, err)
        result.skipped++
      }
    }

    await this.onConsolidated?.(result)
    return result
  }

  destroy(): void {
    // no-op: no timers or buffers to clean up
  }
}
