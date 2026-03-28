# FBM - Fairy Bionic Memory

> 仿生记忆系统，为 AI Agent 提供持久化、可检索、自动整理的记忆能力。

## 理念

AI Agent 在多轮对话中面临"记忆断层"——上下文窗口有限，历史对话和知识无法持久化检索。FBM 模拟人类记忆的工作方式：

- **短期记忆** — 对话过程中动态注入相关记忆，不阻塞主对话流
- **长期记忆** — 闲置对话自动总结为结构化文档，按类型分类永久存储
- **关联检索** — 双路检索（关键词 + 向量语义），从海量记忆中快速定位相关信息
- **记忆去重** — 自动检测重复记忆，智能合并或跳过

## 特性

- **零外部依赖** — 不依赖向量数据库、SQLite 等，纯文件系统存储 + 内存索引
- **完全解耦** — 独立 TypeScript 库，不依赖任何宿主应用内部模块
- **双路检索** — 关键词匹配 + 向量语义检索，结果合并去重
- **跨层级定位** — Markdown 文档的标题级精确定位与全文提取
- **后台总结** — 闲置对话自动由副模型总结、分类、命名、存储
- **向量回溯** — 向量匹配命中后可精确定位到原始文档
- **优雅降级** — Embedding 未配置时自动降级为纯关键词模式
- **文件监听** — 外部修改记忆文件时自动热更新索引

## 架构

```
FBM Core
├── MemoryStore          记忆持久化（分类存储、文件读写、变更监听）
├── IndexEngine          关键词倒排索引（标题树、增量更新、持久化缓存）
├── VectorIndex          向量索引（Embedding、余弦相似度、原文回溯）
├── KeywordExtractor     关键词提取（副模型 + 本地 TF-IDF 回退）
├── NodeLocator          节点定位（Markdown 解析、跨目录标题/代码块定位）
├── MemoryRetriever      记忆检索器（双路检索 → 合并 → 定位 → 总结）
├── MemoryConsolidator   后台记忆总结（闲置检测、智能分类命名、去重合并）
└── DynamicMemory        动态记忆加载（对话流中自动检索与注入）
```

### 记忆存储结构

```
memories/
├── knowledge/            知识类（技术概念、API 用法、领域知识）
│   └── Rust异步编程模型.md
├── experience/           经验类（踩坑记录、解决方案、最佳实践）
│   └── Tauri借用检查器陷阱.md
├── preference/           偏好类（用户习惯、代码风格、配置选择）
│   └── 代码风格偏好.md
├── event/                事件类（会议纪要、决策记录、里程碑）
│   └── 项目启动会议纪要.md
└── project/              项目类（架构设计、进度跟踪、技术选型）
    └── AuroraFairy架构设计.md
```

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
    embedding: {
      batchSize: 20,
      vectorCacheFile: './memories/.vector-cache.json',
    },
    consolidator: {
      enabled: true,
      idleTimeoutMs: 300_000,     // 5 分钟闲置后触发总结
      minConversationTurns: 4,     // 最少 4 轮对话才触发
      maxSummaryTokens: 2000,
    },
    dynamicMemory: {
      enabled: true,
      maxContextTokens: 2000,
      retrievalTopK: 10,
      minScore: 0.5,
      injectAsSystem: true,
    },
    store: {
      watchFiles: true,
      indexCacheFile: './memories/.index-cache.json',
    },
  },
  llm,
  embedding,
)

await fbm.init()

// 检索记忆
const result = await fbm.retrieve('如何解决 Tauri 中的借用检查器问题？')
console.log(result.summary)

// 对话中动态注入记忆
const injections = await fbm.onUserMessage({
  role: 'user',
  content: '帮我修复并发访问的 bug',
  timestamp: Date.now(),
})
// injections 可注入到 LLM 的 system/context 消息中

// 副模型回复后自动判断是否值得记忆
await fbm.onAssistantMessage({
  role: 'assistant',
  content: '...修复方案...',
  timestamp: Date.now(),
})

// 关闭时释放资源
await fbm.shutdown()
```

### 仅关键词模式（无需 Embedding）

```typescript
const llm = new OpenAILLMAdapter({ baseUrl: '...', apiKey: '...', model: '...' })

const fbm = new FBM(
  {
    memoryDir: './memories',
    consolidator: { enabled: false },
    dynamicMemory: { enabled: true, retrievalTopK: 5, minScore: 0.3, injectAsSystem: false, maxContextTokens: 1500 },
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
    // 调用你自己的 LLM 服务 —— gRPC、WebSocket、本地进程、什么都行
    return { content: '...', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }
  },
}

const customEmbedding: EmbeddingAdapter = {
  async embed(texts) {
    // 调用你自己的 Embedding 服务 —— 本地 ONNX 模型、Python 后端等
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

**不使用 Embedding（纯关键词模式）：**

```typescript
const fbm = new FBM(config, llmAdapter)  // 不传第三个参数即可
```

### 向量化管理

```typescript
// 全量重建 —— 比如更换了 Embedding 模型后
const count = await fbm.reindexVectors()
console.log(`重建完成，共 ${count} 条向量`)

// 单文件更新 —— 比如外部修改了某个记忆文档
await fbm.reindexFile('./memories/knowledge/rust-async.md')

// 清空 —— 比如切换 Embedding 模型前
await fbm.clearVectors()
```

## API 概览

### FBM 主类

| 方法 | 说明 |
|------|------|
| `init()` | 初始化存储、构建索引、加载向量缓存、启动文件监听 |
| `retrieve(query)` | 检索记忆并返回总结 |
| `onUserMessage(msg)` | 用户消息处理（触发记忆检索注入 + 喂入总结器） |
| `onAssistantMessage(msg)` | 助手消息处理（触发自动记忆写入） |
| `reindexVectors()` | 清空并重建全部向量索引（返回向量条目数） |
| `reindexFile(filePath)` | 对单个文件重新向量化（返回向量条目数） |
| `clearVectors()` | 清空全部向量数据 |
| `shutdown()` | 释放资源（关闭监听器、定时器） |

### 各模块也可独立使用

```typescript
import { MemoryStore, IndexEngine, NodeLocator, KeywordExtractor } from '@fairy/bionic-memory'

const store = new MemoryStore('./memories')
await store.init()
await store.write({ type: MemoryType.Knowledge, title: '测试', content: '# 测试\n内容', createdAt: Date.now(), updatedAt: Date.now() })

const locator = new NodeLocator()
const headings = parseMarkdown(content, filePath)
const node = locator.locateByHeadingPath(headings, ['章节一', '子章节'])
```

## 检索流程

```
用户输入
  │
  ├─→ KeywordExtractor ─→ 关键词/同义词
  │       │
  │       ▼
  │   IndexEngine.search() ─→ 关键词匹配 NodeRef[]
  │
  ├─→ VectorIndex.searchByText() ─→ 语义匹配 SimilarityResult[]  (可选)
  │
  ├─→ 合并去重
  │
  ├─→ NodeLocator ─→ 定位原文内容
  │
  └─→ 副模型总结 ─→ MemorySummary
```

## 配置参考

### FBMConfig

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `memoryDir` | `string` | 是 | 记忆文件存储根目录 |
| `store` | `StoreConfig` | 否 | 存储配置 |
| `embedding` | `EmbeddingConfig` | 否 | 嵌入模型配置，不传则禁用向量检索 |
| `consolidator` | `ConsolidatorConfig` | 是 | 后台记忆总结配置 |
| `dynamicMemory` | `DynamicMemoryConfig` | 是 | 动态记忆加载配置 |

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
| `defaultMemoryTypes` | `string[]` | 全部类型 | 默认创建的记忆分类目录 |

### ConsolidatorConfig

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enabled` | `boolean` | - | 是否启用后台记忆总结 |
| `idleTimeoutMs` | `number` | - | 闲置多久后触发总结（毫秒） |
| `minConversationTurns` | `number` | - | 最少对话轮数才触发总结 |
| `maxSummaryTokens` | `number` | - | 总结最大 token 数 |

### DynamicMemoryConfig

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enabled` | `boolean` | - | 是否启用动态记忆注入 |
| `maxContextTokens` | `number` | - | 注入记忆的最大 token 数 |
| `retrievalTopK` | `number` | - | 每路检索返回的最大条目数 |
| `minScore` | `number` | - | 向量检索最低相似度阈值 |
| `injectAsSystem` | `boolean` | - | 是否以 system 消息注入（否则为 user 消息） |

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
