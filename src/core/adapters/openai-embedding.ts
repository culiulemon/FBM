import type { EmbeddingAdapter, EmbeddingResponse } from '../../types/adapter.js'

export class OpenAIEmbeddingAdapter implements EmbeddingAdapter {
  private baseUrl: string
  private apiKey: string
  private model: string
  private _dimension: number | undefined

  constructor(config: { baseUrl: string; apiKey: string; model: string; dimension?: number }) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '')
    this.apiKey = config.apiKey
    this.model = config.model
    this._dimension = config.dimension
  }

  async embed(texts: string[]): Promise<EmbeddingResponse> {
    const url = this.baseUrl.endsWith('/embeddings')
      ? this.baseUrl
      : `${this.baseUrl}/embeddings`
    const body = {
      model: this.model,
      input: texts,
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
      throw new Error(`Embedding API error ${response.status}: ${errorText}`)
    }

    const data = await response.json() as {
      data: Array<{ embedding: number[]; index: number }>
      usage?: { prompt_tokens: number; total_tokens: number }
    }

    const embeddings = data.data
      .sort((a, b) => a.index - b.index)
      .map(d => d.embedding)

    if (embeddings.length > 0 && !this._dimension) {
      this._dimension = embeddings[0].length
    }

    return {
      embeddings,
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens,
        totalTokens: data.usage.total_tokens,
      } : undefined,
    }
  }

  getDimension(): number | undefined {
    return this._dimension
  }
}
