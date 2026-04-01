import type { LLMAdapter, LLMMessage } from '../types/adapter.js'

const KEYWORD_PROMPT = `你是一个记忆仓库精灵，负责管理记忆仓库。仓库完整留存了全部历史对话、用户过往表述、行为偏好、相关背景、近期相关内容、关联话题、隐性诉求，遇到这个情景会需要哪些信息，不要浮于表面，要从以往记忆里寻找有用信息，关键词将用于本地查找而非在线搜索，多想想到底需要什么样的信息才能应对这一问题，不要傻傻地当一个智能搜索引擎关键词助手。
请结合用户最近的对话上下文，全面拆解表层语义、深层意图、关联历史维度、上下文相关方向，穷尽所有可检索关联点。不仅要输出核心关键词，还要为每个维度附上近义词、关联词、相关概念，确保覆盖面足够广。最后输出用于检索的关键词 / 关键句数组，如 ["关键词1", "关键词2", "关键词3", "关联词A", "近义词B", "相关概念C"]
输出前需要至少2轮深度思考，以第一轮深度思考为依据再次往更广泛的地方想，禁止当一个同义词工具，要想用哪些信息才能满足本地对话，例如用户说"记得我吗"，你应该输出["姓名","身份","社会关系","爱好","社交网络","联系方式","朋友","家人","性格","经历","回忆","过往","个人资料","基本信息"]，而不是仅仅输出["记得我吗","还记得我吗","你还记得我吗"]这类简单的同义词，用户是在向你提问，并非在让你组词。技巧在于站在归纳记忆的视角去反推关键词，同时为每个维度补充关联词汇。注意用户最近的消息是上下文的一部分，需要综合最近几条消息的语义来推断所需信息，重点关注最新一条消息的意图。只允许以一维字符串数组形式输出最终结果，不允许嵌套数组，不允许输出其它任何内容，输出结果保持在20个以内`

export class KeywordExtractor {
  private llm: LLMAdapter | null

  constructor(llm?: LLMAdapter, _model?: string) {
    this.llm = llm ?? null
  }

  async extract(userInput: string | string[]): Promise<string[]> {
    const inputs = Array.isArray(userInput) ? userInput : [userInput]
    if (this.llm) {
      try {
        return await this.extractFromLLM(inputs)
      } catch {
        // fall back to local extraction
      }
    }
    return this.extractLocal(inputs)
  }

  private async extractFromLLM(userInputs: string[]): Promise<string[]> {
    let userContent: string
    if (userInputs.length <= 1) {
      userContent = userInputs[0] || ''
    } else {
      const parts = userInputs.map((msg, i) => {
        if (i === userInputs.length - 1) {
          return `[最新消息]\n${msg}`
        }
        return `[近期消息]\n${msg}`
      })
      userContent = parts.join('\n\n')
    }
    const messages: LLMMessage[] = [
      { role: 'system', content: KEYWORD_PROMPT },
      { role: 'user', content: userContent },
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
          const flattened = parsed.flat(2).filter((k): k is string => typeof k === 'string' && k.length > 0)
          if (flattened.length > 0) return flattened
        }
      } catch {
        // fall through to local
      }
    }
    return this.extractLocal(userInputs)
  }

  private extractLocal(texts: string[]): string[] {
    const text = texts.join(' ')
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
    return keywords
  }
}
