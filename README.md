# FBM - Fairy Bionic Memory

> 仿生记忆系统，为 AI Agent 提供持久化、可检索、自动整理的记忆能力。

## 理念

AI Agent 在多轮对话中面临"记忆断层"——上下文窗口有限，历史对话和知识无法持久化检索。FBM 模拟人类记忆的工作方式：

- **按需检索** — 宿主封装为工具，主模型按需调用，不阻塞普通对话
- **长期记忆** — 对话总结为结构化文档，相关记忆聚合到同一文件
- **双路检索** — 关键词匹配 + 向量语义检索，结果合并去重
- **精确定位** — Markdown 文档的标题级精确定位与全文提取

## 特性

- **零外部依赖** — 不依赖向量数据库、SQLite 等，纯文件系统存储 + 内存索引
- **完全解耦** — 独立 TypeScript 库，不依赖任何宿主应用内部模块
- **被动式设计** — FBM 不持有对话状态，所有操作由宿主按需调用
- **双路检索** — 关键词匹配 + 向量语义检索，结果合并去重
- **可配置精炼** — 检索结果可选副模型精炼或直接返回原始片段
- **跨层级定位** — Markdown 文档的标题级精确定位与全文提取
- **文件聚合** — 相关记忆自动聚合到同一文件，由 AI 决定文件名和分类
- **向量回溯** — 向量匹配命中后可精确定位到原始文档
- **优雅降级** — Embedding 未配置时自动降级为纯关键词模式
- **文件监听** — 外部修改记忆文件时自动热更新索引

## 架构

```
FBM Core
├── MemoryStore          记忆持久化（文件读写、变更监听、文件聚合）
├── IndexEngine          关键词倒排索引（标题树、增量更新、持久化缓存）
├── VectorIndex          向量索引（Embedding、余弦相似度、原文回溯）
├── KeywordExtractor     关键词提取（副模型 + 本地 TF-IDF 回退）
├── NodeLocator          节点定位（Markdown 解析、跨目录标题/代码块定位）
├── MemoryRetriever      记忆检索器（双路检索 → 合并 → 定位 → 精炼）
└── MemoryConsolidator   记忆总结（从对话中提取记忆、路由到目标文件）
```

### 记忆存储结构

```
memories/
├── 用户信息.md              ← AI 自主命名，包含多个章节
│   ├── # 基本信息
│   ├── # 技术背景
│   └── # 个人偏好
├── AuroraFairy项目开发.md
│   ├── # 架构设计
│   ├── # Tauri借用检查器陷阱
│   └── # FBM集成经验
├── 日常对话备忘.md
└── ...
```

相关记忆聚合到同一文件，文件名和章节组织由 AI 在总结时决定。每个文件内以 Markdown 标题（`#`、`##`）作为章节分隔。

## 快速开始

### 安装

```bash
npm install @fairy/bionic-memory
```

### 基本使用

```typescript
import { FBM, OpenAILLMAdapter, OpenAIEmbeddingAdapter } from '@fairy/bionic-memory'

const llm = new OpenAILLMAdapter({
  baseUrl: 'https://api.openai.com',
  apiKey: 'your-api-key',
  model: 'gpt-4o-mini',
})

const embedding = new OpenAIEmbeddingAdapter({
  baseUrl: 'https://api.openai.com',
  apiKey: 'your-api-key',
  model: 'text-embedding-3-small',
})

const fbm = new FBM(
  {
    memoryDir: './memories',
    retrieval: {
      refineResults: true,     // 副模型精炼检索结果（false 则返回原始片段）
      retrievalTopK: 10,
      minScore: 0.5,
    },
    consolidator: {
      maxSummaryTokens: 2000,
    },
    store: {
      watchFiles: true,
      indexCacheFile: './memories/.index-cache.json',
    },
    embedding: {
      batchSize: 20,
      vectorCacheFile: './memories/.vector-cache.json',
    },
  },
  llm,
  embedding,
)

await fbm.init()

// 检索记忆（工具模式，由宿主封装为 memory_search 工具供主模型调用）
const result = await fbm.retrieve('如何解决 Tauri 中的借用检查器问题？')
console.log(result.summary)       // 精炼后的记忆内容
console.log(result.results)       // 原始检索结果列表

// 总结对话（宿主在合适的时机调用，如对话结束、话题切换等）
const summary = await fbm.consolidate([
  { role: 'user', content: '我的名字是 cucu，今年 28 岁', timestamp: Date.now() },
  { role: 'assistant', content: '你好 cucu！很高兴认识你。', timestamp: Date.now() },
])
console.log(`${summary.created} 条新记忆已存储`)

// 单条写入记忆
await fbm.writeMemory('会议纪要', '2024-01-15 项目启动会议...', '项目记录')

// 关闭时释放资源
await fbm.shutdown()
```

### 仅关键词模式（无需 Embedding）

```typescript
const llm = new OpenAILLMAdapter({ baseUrl: '...', apiKey: '...', model: '...' })

const fbm = new FBM(
  {
    memoryDir: './memories',
    retrieval: { refineResults: true, retrievalTopK: 5, minScore: 0.3 },
  },
  llm,
  // 不传 embedding 参数，向量检索自动禁用
)
```

### 自定义适配器

```typescript
import type { LLMAdapter, EmbeddingAdapter } from '@fairy/bionic-memory'

const customLLM: LLMAdapter = {
  async chat(messages, options) {
    return { content: '...', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }
  },
}

const customEmbedding: EmbeddingAdapter = {
  async embed(texts) {
    return { embeddings: [[0.1, 0.2, ...]] }
  },
  getDimension() { return 1536 },
}

const fbm = new FBM(config, customLLM, customEmbedding)
```

### 常见场景

**连接本地 Ollama：**

```typescript
const llm = new OpenAILLMAdapter({
  baseUrl: 'http://localhost:11434', apiKey: 'ollama', model: 'qwen2.5:7b',
})
const embedding = new OpenAIEmbeddingAdapter({
  baseUrl: 'http://localhost:11434', apiKey: 'ollama', model: 'nomic-embed-text',
})
```

**连接 vLLM / TEI 自部署：**

```typescript
const llm = new OpenAILLMAdapter({
  baseUrl: 'http://your-server:8000', apiKey: 'token-xxx', model: 'your-model',
})
```

### 向量化管理

```typescript
// 全量重建 —— 比如更换了 Embedding 模型后
const count = await fbm.reindexVectors()
console.log(`重建完成，共 ${count} 条向量`)

// 单文件更新 —— 比如外部修改了某个记忆文档
await fbm.reindexFile('./memories/用户信息.md')

// 清空 —— 比如切换 Embedding 模型前
await fbm.clearVectors()
```

## API 概览

### FBM 主类

| 方法 | 说明 |
|------|------|
| `init()` | 初始化存储、构建索引、加载向量缓存、启动文件监听 |
| `retrieve(query)` | 检索记忆，返回 `MemorySummary`（含精炼摘要和原始结果） |
| `consolidate(messages)` | 从对话中提取记忆并写入文件，返回 `ConsolidationResult` |
| `writeMemory(title, content, targetFile?)` | 单条写入记忆，可选指定目标文件 |
| `getStore()` | 获取 MemoryStore 实例 |
| `getIndexEngine()` | 获取 IndexEngine 实例 |
| `getVectorIndex()` | 获取 VectorIndex 实例 |
| `reindexVectors()` | 清空并重建全部向量索引（返回向量条目数） |
| `reindexFile(filePath)` | 对单个文件重新向量化（返回向量条目数） |
| `clearVectors()` | 清空全部向量数据 |
| `shutdown()` | 释放资源（关闭监听器） |

### 各模块也可独立使用

```typescript
import { MemoryStore, IndexEngine, NodeLocator, parseMarkdown } from '@fairy/bionic-memory'

const store = new MemoryStore('./memories')
await store.init()

// 创建新文件
await store.createFile('用户信息', '基本信息', '姓名：cucu')

// 追加章节到已有文件
await store.appendToFile('用户信息', '技术背景', '前端工程师，主用 TypeScript')

// 获取所有记忆文件及其章节标题
const files = await store.getMemoryFiles()
// [{ fileName: '用户信息.md', headings: ['基本信息', '技术背景'] }, ...]

// 标题级定位
const locator = new NodeLocator()
const headings = parseMarkdown(content, filePath)
const node = locator.locateByHeadingPath(headings, ['基本信息'])
const text = locator.extractContent(node)
```

## 检索流程

```
memory_search(query) 被调用
  │
  ├─→ KeywordExtractor.extract(query) ─→ 关键词
  │       │
  │       ▼
  │   KeywordExtractor.expand(keywords) ─→ 同义词扩展
  │       │
  │       ▼
  │   IndexEngine.search() ─→ 关键词匹配 NodeRef[]
  │
  ├─→ VectorIndex.searchByText(query) ─→ 语义匹配 SimilarityResult[]  (可选)
  │
  ├─→ 合并去重（按 filePath + headingPath）
  │
  ├─→ NodeLocator ─→ 定位原始文档章节内容
  │
  └─→ refineResults=true → 副模型精炼筛选（附带用户原始 query）
      refineResults=false → 直接返回原始章节内容
```

## 配置参考

### FBMConfig

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `memoryDir` | `string` | 是 | 记忆文件存储根目录 |
| `store` | `StoreConfig` | 否 | 存储配置 |
| `embedding` | `EmbeddingConfig` | 否 | 嵌入模型配置，不传则禁用向量检索 |
| `retrieval` | `RetrievalConfig` | 否 | 检索配置 |
| `consolidator` | `ConsolidatorConfig` | 否 | 记忆总结配置 |

> 副模型（LLM）和嵌入模型（Embedding）通过构造函数注入适配器实例，不写在 config 里。

### 适配器构造参数

**OpenAILLMAdapter**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `baseUrl` | `string` | - | API 地址（兼容 OpenAI / Ollama / vLLM 等） |
| `apiKey` | `string` | - | 认证密钥 |
| `model` | `string` | - | 模型名称 |
| `maxTokens` | `number` | `4096` | 最大输出 token |
| `temperature` | `number` | `0.7` | 默认温度 |

**OpenAIEmbeddingAdapter**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `baseUrl` | `string` | - | API 地址 |
| `apiKey` | `string` | - | 认证密钥 |
| `model` | `string` | - | 嵌入模型名称 |
| `dimension` | `number` | 自动检测 | 向量维度 |

### RetrievalConfig

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `refineResults` | `boolean` | `true` | 是否用副模型精炼检索结果（false 则返回原始片段） |
| `retrievalTopK` | `number` | `10` | 每路检索返回的最大条目数 |
| `minScore` | `number` | `0.5` | 向量检索最低相似度阈值 |

### EmbeddingConfig

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `batchSize` | `number` | `20` | 批量嵌入的每批数量 |
| `vectorCacheFile` | `string` | - | 向量缓存文件路径 |

### StoreConfig

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `indexCacheFile` | `string` | - | 关键词索引缓存文件路径 |
| `watchFiles` | `boolean` | `true` | 是否监听文件变更自动更新索引 |

### ConsolidatorConfig

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `maxSummaryTokens` | `number` | - | 总结最大 token 数 |

## 开发

```bash
npm install
npm run build        # TypeScript 编译
npm run test         # 运行测试
npm run test:watch   # 监听模式测试
npm run dev          # 监听模式编译
```

## License

MIT
