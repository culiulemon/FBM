import type { LLMAdapter, LLMResponse, LLMMessage, LLMOptions } from '../../types/adapter.js'

export class OpenAILLMAdapter implements LLMAdapter {
  private baseUrl: string
  private apiKey: string
  private model: string
  private maxTokens: number
  private temperature: number

  constructor(config: { baseUrl: string; apiKey: string; model: string; maxTokens?: number; temperature?: number }) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '')
    this.apiKey = config.apiKey
    this.model = config.model
    this.maxTokens = config.maxTokens ?? 4096
    this.temperature = config.temperature ?? 0.7
  }

  async chat(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse> {
    const url = this.baseUrl.endsWith('/chat/completions')
      ? this.baseUrl
      : `${this.baseUrl}/chat/completions`
    const body = {
      model: this.model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      max_tokens: options?.maxTokens ?? this.maxTokens,
      temperature: options?.temperature ?? this.temperature,
      ...(options?.stop ? { stop: options.stop } : {}),
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`LLM API error ${response.status}: ${errorText}`)
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
    }

    const choice = data.choices[0]
    return {
      content: choice.message.content,
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      } : undefined,
    }
  }
}
