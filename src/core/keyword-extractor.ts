import type { LLMAdapter, LLMMessage } from '../types/adapter.js'

const KEYWORD_PROMPT = `你是一个记忆仓库精灵，现有用户记忆仓库，完整留存全部历史对话、用户过往表述、行为偏好、相关背景、近期相关内容、关联话题、隐性诉求，遇到这个情景会需要哪些信息，不要浮于表面，要从以往记忆里寻找有用信息，关键词将用于本地查找而非在线搜索，多想想到底需要什么样的信息才能应对这一问题，不要傻傻地当一个智能搜索引擎关键词助手。当然，如果用户只是闲聊、或者询问常识性问题且不需要任何记忆就可以支撑回答用户时，你放弃深度思考直接输出"false"
请针对当前用户输入，全面拆解表层语义、深层意图、关联历史维度、上下文相关方向，穷尽所有可检索关联点，输出关键词 / 关键句数组
输出前需要至少2轮深度思考，以第一轮深度思考为依据再次往更广泛的地方想，只允许以数组形式输出最终结果，不允许输出其它任何内容`

export class KeywordExtractor {
  private llm: LLMAdapter | null
  private model: string

  constructor(llm?: LLMAdapter, model?: string) {
    this.llm = llm ?? null
    this.model = model ?? 'gpt-4o-mini'
  }

  async extract(userInput: string): Promise<string[]> {
    if (this.llm) {
      try {
        return await this.extractFromLLM(userInput)
      } catch {
        // fall back to local extraction
      }
    }
    return this.extractLocal(userInput)
  }

  private async extractFromLLM(userInput: string): Promise<string[]> {
    const messages: LLMMessage[] = [
      { role: 'system', content: KEYWORD_PROMPT },
      { role: 'user', content: userInput },
    ]
    const response = await this.llm!.chat(messages, { temperature: 0.7 })
    const content = response.content.trim()

    if (/^"?\s*false\s*"?$/i.test(content) || content === 'false') {
      return []
    }

    const jsonMatch = content.match(/\[[\s\S]*\]/)
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0])
        if (Array.isArray(parsed)) {
          return parsed.filter((k): k is string => typeof k === 'string' && k.length > 0)
        }
      } catch {
        // fall through to local
      }
    }
    return this.extractLocal(userInput)
  }

  private extractLocal(text: string): string[] {
    const cleaned = text.toLowerCase().replace(/[^\w\s\u4e00-\u9fff]/g, ' ')
    const words = cleaned.split(/\s+/).filter(w => w.length > 1)
    const freq = new Map<string, number>()
    for (const word of words) {
      freq.set(word, (freq.get(word) ?? 0) + 1)
    }

    const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1])

    const keywords: string[] = []
    for (const [word, count] of sorted) {
      if (keywords.length >= 8) break
      if (count >= 1 && word.length >= 2) {
        keywords.push(word)
      }
    }

    const chineseChars = text.match(/[\u4e00-\u9fff]{2,}/g)
    if (chineseChars) {
      for (const phrase of chineseChars) {
        if (keywords.length >= 10) break
        if (!keywords.includes(phrase)) {
          keywords.push(phrase)
        }
      }
    }

    return keywords.length > 0 ? keywords : [text.slice(0, 50)]
  }

  async expand(keywords: string[]): Promise<string[]> {
    if (!this.llm) return keywords

    const expanded = new Set(keywords)
    try {
      const messages: LLMMessage[] = [
        {
          role: 'system',
          content: `Given a list of keywords, add up to 5 synonyms or related terms for each. Output ONLY a JSON array of strings. Include the original keywords.`,
        },
        { role: 'user', content: JSON.stringify(keywords) },
      ]
      const response = await this.llm.chat(messages, { temperature: 0.3 })
      const jsonMatch = response.content.trim().match(/\[[\s\S]*\]/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (typeof item === 'string') expanded.add(item)
          }
        }
      }
    } catch {
      // expansion failed, return originals
    }
    return [...expanded]
  }
}
