# 修复回忆流程：减少副模型调用 & 修正 Embedding 搜索输入

## 问题分析

当前回忆流程（`MemoryRetriever.retrieve()`）存在两个问题：

### 问题 1：副模型被调用了 2 次

在 [memory-retriever.ts:39-54](src/core/memory-retriever.ts#L39-L54) 中：
- 第 42 行：`keywordExtractor.extract(query)` → 第 1 次副模型调用（提取关键词）
- 第 50 行：`keywordExtractor.expand(keywords)` → 第 2 次副模型调用（扩展同义词）

`extract` 的 prompt 已经要求 LLM 深度思考并输出全面的关键词（见 [keyword-extractor.ts:3-5](src/core/keyword-extractor.ts#L3-L5)），而 `expand` 只是简单地在已有关键词基础上加同义词，属于冗余调用。

### 问题 2：用户原始对话直接被发给 Embedding 模型（核心 bug）

在 [memory-retriever.ts:63](src/core/memory-retriever.ts#L63)：
```typescript
const vectorResults = await this.vectorIndex.searchByText(query, this.topK)
```
这里传入的是**用户原始 query**，而非经过关键词提取后的结果。这导致用户的原始对话文本被直接发送给 Embedding 模型，而精心提取的关键词只被用于本地倒排索引搜索，完全没有参与向量搜索。

### 完整调用时序（当前）

```
用户 query
  ├─→ 副模型调用 #1: extract(query)     → 提取关键词
  ├─→ 副模型调用 #2: expand(keywords)    → 扩展同义词（冗余）
  ├─→ 本地倒排索引: search(expandedKeywords)  → 用关键词搜索
  ├─→ Embedding 调用: embed(query)       → 用原始 query 做向量搜索（bug）
  └─→ 主模型调用: summarize()            → 精炼结果
```

### 期望调用时序

```
用户 query
  ├─→ 副模型调用 #1: extract(query)     → 一次性提取+扩展关键词
  ├─→ 本地倒排索引: search(keywords)     → 用关键词搜索
  ├─→ Embedding 调用: embed(keywords)    → 用关键词做向量搜索
  └─→ 主模型调用: summarize()            → 精炼结果
```

## 修复方案

### 修改 1：合并 `extract` 和 `expand` 为单次 LLM 调用

**文件**: [keyword-extractor.ts](src/core/keyword-extractor.ts)

- 将 `expand` 方法中"添加同义词/关联词"的要求合并到 `KEYWORD_PROMPT` 中，让 LLM 在一次调用中同时完成提取和扩展
- `extract()` 方法直接返回完整的关键词列表（包含原始关键词 + 同义词/关联词）
- `expand()` 方法改为直接返回输入（不再调用 LLM），保持向后兼容
- 或者直接移除 `expand` 方法，在 `memory-retriever.ts` 中不再调用它

### 修改 2：使用关键词而非原始 query 进行向量搜索

**文件**: [memory-retriever.ts](src/core/memory-retriever.ts)

- 第 63 行：将 `query` 替换为 `expandedKeywords.join(' ')`，使 Embedding 模型使用经过语义分析的关键词组合进行搜索
- 删除第 48-54 行的 `expand` 调用，因为关键词扩展已在 `extract` 中完成

### 修改 3：调整 `extract` 的 prompt

**文件**: [keyword-extractor.ts](src/core/keyword-extractor.ts)

- 在 `KEYWORD_PROMPT` 中补充要求：不仅输出核心关键词，还要包含每个关键词的近义词、关联词、相关概念等，确保一次调用就能得到足够丰富的检索词

## 具体实施步骤

1. **修改 `keyword-extractor.ts`**：优化 `KEYWORD_PROMPT`，使其在一次调用中同时完成关键词提取和同义词扩展
2. **修改 `memory-retriever.ts`**：
   - 移除对 `expand()` 的调用（第 48-54 行）
   - 将向量搜索的输入从 `query` 改为 `keywords.join(' ')`（第 63 行）
   - 调整返回值中的 `expandedKeywords` 字段（直接等于 `keywords`）
3. **验证**：确认修改后的流程只有 1 次副模型调用 + 1 次 Embedding 调用
