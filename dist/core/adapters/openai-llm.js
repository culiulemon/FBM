export class OpenAILLMAdapter {
    baseUrl;
    apiKey;
    model;
    maxTokens;
    temperature;
    constructor(config) {
        this.baseUrl = config.baseUrl.replace(/\/$/, '');
        this.apiKey = config.apiKey;
        this.model = config.model;
        this.maxTokens = config.maxTokens ?? 4096;
        this.temperature = config.temperature ?? 0.7;
    }
    async chat(messages, options) {
        const url = `${this.baseUrl}/v1/chat/completions`;
        const body = {
            model: this.model,
            messages: messages.map(m => ({ role: m.role, content: m.content })),
            max_tokens: options?.maxTokens ?? this.maxTokens,
            temperature: options?.temperature ?? this.temperature,
            ...(options?.stop ? { stop: options.stop } : {}),
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
            throw new Error(`LLM API error ${response.status}: ${errorText}`);
        }
        const data = await response.json();
        const choice = data.choices[0];
        return {
            content: choice.message.content,
            usage: data.usage ? {
                promptTokens: data.usage.prompt_tokens,
                completionTokens: data.usage.completion_tokens,
                totalTokens: data.usage.total_tokens,
            } : undefined,
        };
    }
}
//# sourceMappingURL=openai-llm.js.map