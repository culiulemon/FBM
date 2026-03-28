const KEYWORD_PROMPT = `You are a keyword extraction assistant. Given the user's input, extract search keywords that would be useful for retrieving relevant documents from a knowledge base.

Rules:
- Extract 5-10 keywords and short phrases
- Include synonyms and related terms
- Include both English and Chinese terms if applicable
- Focus on nouns, technical terms, and specific concepts
- Output ONLY a JSON array of strings, nothing else

Example:
User input: "How do I fix the Tauri borrowing checker error with Mutex?"
Output: ["Tauri", "borrowing checker", "Mutex", "Rust", "async", "Arc", "concurrent access", "编译错误", "借用检查"]`;
export class KeywordExtractor {
    llm;
    model;
    constructor(llm, model) {
        this.llm = llm ?? null;
        this.model = model ?? 'gpt-4o-mini';
    }
    async extract(userInput) {
        if (this.llm) {
            try {
                return await this.extractFromLLM(userInput);
            }
            catch {
                // fall back to local extraction
            }
        }
        return this.extractLocal(userInput);
    }
    async extractFromLLM(userInput) {
        const messages = [
            { role: 'system', content: KEYWORD_PROMPT },
            { role: 'user', content: userInput },
        ];
        const response = await this.llm.chat(messages, { temperature: 0.3 });
        const content = response.content.trim();
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
            try {
                const parsed = JSON.parse(jsonMatch[0]);
                if (Array.isArray(parsed)) {
                    return parsed.filter((k) => typeof k === 'string' && k.length > 0);
                }
            }
            catch {
                // fall through to local
            }
        }
        return this.extractLocal(userInput);
    }
    extractLocal(text) {
        const cleaned = text.toLowerCase().replace(/[^\w\s\u4e00-\u9fff]/g, ' ');
        const words = cleaned.split(/\s+/).filter(w => w.length > 1);
        const freq = new Map();
        for (const word of words) {
            freq.set(word, (freq.get(word) ?? 0) + 1);
        }
        const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);
        const keywords = [];
        for (const [word, count] of sorted) {
            if (keywords.length >= 8)
                break;
            if (count >= 1 && word.length >= 2) {
                keywords.push(word);
            }
        }
        const chineseChars = text.match(/[\u4e00-\u9fff]{2,}/g);
        if (chineseChars) {
            for (const phrase of chineseChars) {
                if (keywords.length >= 10)
                    break;
                if (!keywords.includes(phrase)) {
                    keywords.push(phrase);
                }
            }
        }
        return keywords.length > 0 ? keywords : [text.slice(0, 50)];
    }
    async expand(keywords) {
        if (!this.llm)
            return keywords;
        const expanded = new Set(keywords);
        try {
            const messages = [
                {
                    role: 'system',
                    content: `Given a list of keywords, add up to 5 synonyms or related terms for each. Output ONLY a JSON array of strings. Include the original keywords.`,
                },
                { role: 'user', content: JSON.stringify(keywords) },
            ];
            const response = await this.llm.chat(messages, { temperature: 0.3 });
            const jsonMatch = response.content.trim().match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                if (Array.isArray(parsed)) {
                    for (const item of parsed) {
                        if (typeof item === 'string')
                            expanded.add(item);
                    }
                }
            }
        }
        catch {
            // expansion failed, return originals
        }
        return [...expanded];
    }
}
//# sourceMappingURL=keyword-extractor.js.map