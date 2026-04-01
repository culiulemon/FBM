# 修复：切换副模型后下次请求不使用新模型

## 问题分析

**根因**：`AgentMemoryPage.vue` 的 `handleSaveFbmConfig()` 在保存 FBM 配置后，仅在 FBM **启用/禁用状态发生变化**时才调用 `fbmStore.ensureInit()` 或 `fbmStore.shutdown()`。如果 FBM 已经处于启用状态，用户修改了副模型（`providerId`）或 Embedding 模型（`embeddingProviderId`），**不会触发 FBM 重新初始化**，导致旧的 `OpenAILLMAdapter` 实例仍然被使用。

**调用链**：
1. 用户在 `AgentMemoryPage.vue` 中修改副模型 → `saveFbmConfig()` 写入 localStorage ✅
2. `handleSaveFbmConfig()` 检查启用状态变化 → 状态未变化 → **跳过重新初始化** ❌
3. 下次请求时 `fbmStore.ensureInit()` → `fbm?.initialized === true` → **直接返回** ❌
4. 所有 LLM 调用仍使用旧的 `OpenAILLMAdapter`（内部 `model` 字段是构造时固化的）❌

**关键代码位置**：
- [fbmStore.ts:42-43](file:///e:/Documents/code/AuroraFairy/src/stores/fbmStore.ts#L42-L43) — `ensureInit()` 在 `fbm?.initialized` 时直接 return
- [AgentMemoryPage.vue:369-379](file:///e:/Documents/code/AuroraFairy/src/components/AgentMemoryPage.vue#L369-L379) — `handleSaveFbmConfig` 缺少模型变更检测
- [openai-llm.ts](file:///e:/Documents/code/AuroraFairy/src/fbm/src/core/adapters/openai-llm.ts) — `model` 字段为 private，构造后不可变

## 修复方案

在 `handleSaveFbmConfig()` 中增加检测：当 FBM 已启用且 `providerId` 或 `embeddingProviderId` 发生变化时，调用 `fbmStore.reinitialize()` 以使用新配置重建 FBM 实例。

### 修改文件：`AgentMemoryPage.vue`

**修改 `handleSaveFbmConfig` 函数**：

```typescript
async function handleSaveFbmConfig() {
  const wasEnabled = stats.enabled
  const oldProviderId = loadSettings().fbmProviderId
  const oldEmbeddingProviderId = loadSettings().fbmEmbeddingProviderId
  saveFbmConfig()
  const providerChanged = oldProviderId !== fbmConfig.providerId
  const embeddingChanged = oldEmbeddingProviderId !== fbmConfig.embeddingProviderId

  if (fbmConfig.enabled && !wasEnabled) {
    await fbmStore.ensureInit()
  } else if (!fbmConfig.enabled && wasEnabled) {
    await fbmStore.shutdown()
  } else if (fbmConfig.enabled && wasEnabled && (providerChanged || embeddingChanged)) {
    await fbmStore.reinitialize()
  }
  refreshStats()
  showFbmConfig.value = false
}
```

**变更要点**：
1. 在 `saveFbmConfig()` 之前，记录当前的 `fbmProviderId` 和 `fbmEmbeddingProviderId`
2. 在 `saveFbmConfig()` 之后，比较新旧值是否发生变化
3. 新增 `else if` 分支：FBM 已启用且保持启用，但模型配置变化时 → 调用 `fbmStore.reinitialize()`

## 实施步骤

1. 编辑 `src/components/AgentMemoryPage.vue` 的 `handleSaveFbmConfig` 函数
2. 验证修改无误
