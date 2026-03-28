export class OpenAIEmbeddingAdapter {
    baseUrl;
    apiKey;
    model;
    _dimension;
    constructor(config) {
        this.baseUrl = config.baseUrl.replace(/\/$/, '');
        this.apiKey = config.apiKey;
        this.model = config.model;
        this._dimension = config.dimension;
    }
    async embed(texts) {
        const url = `${this.baseUrl}/v1/embeddings`;
        const body = {
            model: this.model,
            input: texts,
        };
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Embedding API error ${response.status}: ${errorText}`);
        }
        const data = await response.json();
        const embeddings = data.data
            .sort((a, b) => a.index - b.index)
            .map(d => d.embedding);
        if (embeddings.length > 0 && !this._dimension) {
            this._dimension = embeddings[0].length;
        }
        return {
            embeddings,
            usage: data.usage ? {
                promptTokens: data.usage.prompt_tokens,
                totalTokens: data.usage.total_tokens,
            } : undefined,
        };
    }
    getDimension() {
        return this._dimension;
    }
}
//# sourceMappingURL=openai-embedding.js.map