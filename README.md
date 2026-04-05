# FBM - Fairy Bionic Memory

> 仿生记忆系统，为 AI Agent 提供持久化、可检索、自动整理的区块记忆能力。

## 理念

AI Agent 在多轮对话中面临"记忆断层"——上下文窗口有限，历史对话和知识无法持久化检索。FBM 模拟人类记忆的工作方式：

- **按需检索** — 宿主封装为工具，主模型按需调用，不阻塞普通对话
- **区块记忆** — 对话被分割为结构化记忆区块（Block），按话题组织
- **分层目录** — 记忆通过 Category → SubCategory → Block 的目录树管理
- **三阶段检索** — 目录筛选 → dense+BM25 混合检索 → LLM 精炼
- **生命周期** — 记忆拥有重要度分级、访问追踪、过期淘汰与自动合并

## 特性

- **区块化记忆** — 对话按话题分割为独立区块，每个区块包含原始上下文和关键词锚点
- **分层目录** — Category → SubCategory → Entry 三级目录，LLM 智能分类
- **双向量策略** — Dense 向量（语义）+ BM25 稀疏向量（关键词），RRF 融合排序
- **三阶段检索** — 目录筛选 → 混合向量检索 → LLM 精炼，层层过滤精准定位
- **生命周期管理** — 重要度分级（critical/high/normal/low）、过期检查、自动合并
- **访问追踪** — 记录访问频率，高频区块自动升级重要度
- **完全解耦** — 独立 TypeScript 库，通过适配器注入 LLM 和 Embedding
- **被动式设计** — FBM 不持有对话状态，所有操作由宿主按需调用
- **优雅降级** — Embedding 未配置时自动降级为纯关键词模式

## 架构

```
FBM Core
├── QdrantStore            向量存储（Dense + BM25 稀疏向量、RRF 融合检索）
├── DirectoryManager       目录管理（分类/子类/条目、智能展示格式切换）
├── BlockLifecycleManager  生命周期（过期检查、自动合并、访问追踪与升级）
├── KeywordExtractor       关键词提取（LLM 提取 + 本地 TF-IDF 回退）
├── MemoryConsolidator     记忆整合（话题分割 → LLM 整合决策 → 写入向量）
└── MemoryRetriever        记忆检索（目录筛选 → 混合检索 → LLM 精炼）
```

### 区块数据模型

每个记忆区块（Block）在 Qdrant 中存储为多个向量点：

| 点类型 | 说明 | 向量 |
|--------|------|------|
| `raw_context` | 原始对话上下文（每区块 1 个） | Dense |
| `keyword_anchor` | 面向检索的关键词句（每区块 N 个） | Dense + BM25 |

同时维护一个 `memory_directory` 集合，存储所有区块的目录索引。

### 目录结构

```
Category (大类)
├── SubCategory (子类)
│   ├── Block Entry (目录条目)
│   │   ├── blockId
│   │   ├── summary
│   │   ├── keywordAnchors
│   │   └── importance
│   └── ...
└── ...
```

分类和子类由 LLM 在记忆整合时自动决定，无需预先定义。

## 快速开始

### 前置条件

FBM 使用 [Qdrant](https://qdrant.tech/) 作为向量数据库。启动 Qdrant：

```bash
docker run -p 6333:6333 qdrant/qdrant
```

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
    qdrant: {
      port: 6333,
    },
    retrieval: {
      refineResults: true,
      retrievalTopK: 10,
      minScore: 0.3,
    },
    lifecycle: {
      enableExpiration: true,
      mergeCheckInterval: 10,
    },
    embedding: {
      batchSize: 20,
    },
  },
  llm,
  embedding,
)

await fbm.init()

// 检索记忆
const result = await fbm.retrieve('如何解决 Tauri 中的借用检查器问题？')
console.log(result.summary)
console.log(result.results)

// 总结对话
const summary = await fbm.consolidate([
  { role: 'user', content: '我的名字是 cucu，今年 28 岁', timestamp: Date.now() },
  { role: 'assistant', content: '你好 cucu！很高兴认识你。', timestamp: Date.now() },
])
console.log(`创建 ${summary.created} 条，更新 ${summary.updated} 条，跳过 ${summary.skipped} 条`)

// 查看统计
const stats = await fbm.getStats()
console.log(`区块点: ${stats.blockPoints}, 目录条目: ${stats.directoryEntries}`)

// 关闭
await fbm.shutdown()
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
    return { embeddings: [[0.1, 0.2, /* ... */]] }
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

## API 概览

### FBM 主类

| 方法 | 返回类型 | 说明 |
|------|----------|------|
| `init()` | `Promise<void>` | 初始化所有子模块（连接 Qdrant、构建索引） |
| `retrieve(query)` | `Promise<MemorySummary>` | 检索记忆，支持 `string` 或 `string[]` |
| `consolidate(messages)` | `Promise<ConsolidationResult>` | 从对话中提取记忆区块并写入 Qdrant |
| `getStore()` | `QdrantStore` | 获取底层 QdrantStore 实例 |
| `getDirectoryManager()` | `DirectoryManager` | 获取目录管理器实例 |
| `getLifecycle()` | `BlockLifecycleManager` | 获取生命周期管理器实例 |
| `getStats()` | `Promise<{ blockPoints, directoryEntries, uniqueBlocks }>` | 获取存储统计 |
| `reindexVectors()` | `Promise<number>` | 获取当前区块点数量 |
| `clearVectors()` | `Promise<void>` | 清空所有向量数据 |
| `setBaseDir(baseDir)` | `Promise<void>` | 更换基础目录并重新初始化 |
| `shutdown()` | `Promise<void>` | 关闭 FBM |

### QdrantStore

| 方法 | 说明 |
|------|------|
| `init()` | 初始化集合和索引（Dense + BM25） |
| `embed(texts)` | 批量文本嵌入 |
| `writeRawContext(...)` | 写入原始上下文点 |
| `writeKeywordAnchors(...)` | 写入关键词锚点 |
| `writeDirectoryEntry(...)` | 写入目录条目 |
| `assembleBlockData(blockId)` | 组装完整区块数据 |
| `searchHybrid(queryText, candidateBlockIds, topK?, minScore?)` | 混合检索（Dense + BM25 + RRF） |
| `searchDenseOnly(queryText, candidateBlockIds, topK?, minScore?)` | 纯 Dense 检索 |
| `scrollDirectory(filter?)` | 滚动查询目录条目 |
| `getDirectoryTree()` | 获取完整目录树 |
| `deleteBlock(blockId)` | 删除区块所有数据 |
| `updateBlockAccess(blockId)` | 更新区块访问时间和计数 |
| `getStats()` | 获取存储统计 |
| `clearAll()` | 清空所有集合 |

### DirectoryManager

| 方法 | 说明 |
|------|------|
| `getFullTree()` | 获取完整目录树 |
| `getCategories()` | 获取所有大类名称 |
| `getSubCategories(category)` | 获取指定大类下的子类 |
| `getEntries(category?, subCategory?)` | 按条件查询目录条目 |
| `getAllEntries()` | 获取所有目录条目 |
| `getDirectoryTextForLLM()` | 智能选择展示格式（条目少用扁平，多用树形） |

### BlockLifecycleManager

| 方法 | 说明 |
|------|------|
| `onConsolidationComplete()` | 整合完成回调，周期性触发合并检查 |
| `onBlockAccessed(blockId)` | 更新访问统计，检查自动升级（≥10 次提升重要度） |
| `scanExpirationCandidates()` | 扫描过期候选区块 |
| `reviewExpiration(candidates)` | LLM 审查过期候选 |
| `executeExpiration(decisions)` | 执行过期决策 |
| `runExpirationCycle()` | 完整过期检查周期 |
| `detectMergeCandidates()` | 检测合并候选（同子类内相似度 > 0.85） |
| `checkAndMerge()` | 完整合并检查流程 |

### MemoryConsolidator

| 方法 | 说明 |
|------|------|
| `consolidate(messages)` | 整合对话为记忆区块（话题分割 → LLM 决策 → 写入） |

### MemoryRetriever

| 方法 | 说明 |
|------|------|
| `retrieve(query, context?)` | 三阶段检索（目录筛选 → 混合检索 → 精炼） |

## 检索流程

```
retrieve(query) 被调用
  │
  ├─→ 目录阶段: DirectoryManager.getDirectoryTextForLLM()
  │       │
  │       └─→ LLM 从目录中选择 1-5 个候选 blockId
  │
  ├─→ 混合检索阶段: QdrantStore.searchHybrid()
  │       │
  │       ├─→ Dense 向量检索（语义相似度）
  │       ├─→ BM25 稀疏向量检索（关键词匹配）
  │       └─→ RRF 融合排序（失败时回退纯 Dense）
  │
  ├─→ 组装阶段: assembleBlockData()
  │       │
  │       └─→ 将 raw_context + keyword_anchor 聚合为完整区块内容
  │
  └─→ 精炼阶段 (refineResults=true):
          │
          └─→ LLM 筛选 + 结构化总结
       精炼阶段 (refineResults=false):
          │
          └─→ 直接返回原始区块内容
```

## 记忆整合流程

```
consolidate(messages) 被调用
  │
  ├─→ 话题分割: LLM 将消息按话题分组为 TopicSegment[]
  │
  └─→ 逐段整合:
          │
          ├─→ 获取当前目录结构
          ├─→ LLM 决定操作（create/update/ignore）
          │     ├── action: 'create' | 'update' | 'ignore'
          │     ├── category + subCategory（分类）
          │     ├── keywords（关键词句）
          │     ├── summary（摘要）
          │     └── importance（重要度）
          │
          ├─→ create: 写入 raw_context + keyword_anchors + directory entry
          ├─→ update: 按 strategy（incremental/replace）更新区块
          └─→ ignore: 跳过
```

## 配置参考

### FBMConfig

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `memoryDir` | `string` | 是 | 记忆文件存储根目录 |
| `qdrant` | `QdrantConfig` | 否 | Qdrant 配置 |
| `embedding` | `EmbeddingConfig` | 否 | 嵌入模型配置 |
| `retrieval` | `RetrievalConfig` | 否 | 检索配置 |
| `lifecycle` | `LifecycleConfig` | 否 | 生命周期配置 |

### QdrantConfig

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `port` | `number` | `6333` | Qdrant 服务端口 |
| `memoryBlocksCollection` | `string` | `'memory_blocks'` | 区块向量集合名 |
| `memoryDirectoryCollection` | `string` | `'memory_directory'` | 目录向量集合名 |

### EmbeddingConfig

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `batchSize` | `number` | `20` | 批量嵌入的每批数量 |

### RetrievalConfig

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `refineResults` | `boolean` | `true` | 是否用 LLM 精炼检索结果 |
| `retrievalTopK` | `number` | `10` | 检索返回的最大条目数 |
| `minScore` | `number` | `0.3` | 最低相似度阈值 |
| `maxContextTokens` | `number` | - | 最大上下文 token 数 |
| `directoryThreshold` | `number` | `50` | 目录展示格式切换阈值 |

### LifecycleConfig

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enableExpiration` | `boolean` | - | 是否启用过期检查 |
| `mergeCheckInterval` | `number` | `10` | 每多少次整合后触发一次合并检查 |
| `expirationThresholds` | `ExpirationThresholds` | - | 各重要度级别的过期天数 |

### ExpirationThresholds

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `critical` | `number` | `Infinity` | critical 级别过期天数 |
| `high` | `number` | `730` | high 级别过期天数 |
| `normal` | `number` | `180` | normal 级别过期天数 |
| `low` | `number` | `60` | low 级别过期天数 |

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

## 导出类型

```typescript
// 配置
export type { FBMConfig, QdrantConfig, EmbeddingConfig, RetrievalConfig, LifecycleConfig, ExpirationThresholds }

// 适配器
export type { LLMAdapter, LLMResponse, EmbeddingAdapter, EmbeddingResponse }

// 对话
export type { ConversationMessage }

// 区块
export type { ImportanceLevel, BlockPointType, BlockAction, UpdateStrategy, BlockPayload, NewBlockData, BlockOperation, TopicSegment, SegmentationResult, BlockData, ConsolidationResult }

// 目录
export type { DirectoryEntry, DirectoryCategory, DirectorySubCategory, DirectoryTree, ExpirationCandidate, ExpirationDecision, MergeCandidate, MergeDecision }

// 检索
export type { MemorySummary, BlockRetrievalResult }
```

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
