# Xiaoni Passive Recall Extractor

本文记录小腻被动召回第一版的提取边界。这里的 extractor 只处理 action-stream
和本地运行文件的安全特征，不训练模型，不调用生成式 LLM，不替小腻表达。

## Core Boundary

```text
action-stream item / runtime file path
  -> deterministic extractor
  -> cueClass + features + safeEmbeddingText + runtimePaths / fileCandidates
  -> shadow review endpoint
  -> later passive recall daemon
```

Extractor 只做事实提取：

- `qq_usage.py`：IM 阅读 cue。只保留 mode、peer、tool/source/tag 等结构特征，不把 inbox 正文写入 `safeEmbeddingText`。
- `/xiaoni-runtime/notes|reading|forever|toys` 文件路径：file provenance。识别 read/write/reference 和可索引目录。
- `send_in_private` / `send_in_group` / `qq_self_message`：小腻自己的 spoken fragment，可作为低权重、带 scope 的候选。
- LLM request、stack callback、fork provider payload、普通工具生命周期：operator/debug trace。
  默认不进入 shadow cue，也不进入 embedding。

Extractor 不做这些事：

- 不判断某条记忆是否应该浮现。
- 不生成 trigger/fragment 摘要。
- 不总结用户 IM 正文。
- 不更新 activation / threshold / cooldown。
- 不直接投递 `system_reminder`。

## Shadow Review

第一阶段只看 extractor 输出，不投递给小腻，也不写入 Notify Bucket。

```text
GET /api/xiaoni/passive-recall/shadow-cues
```

管理端查看页：

```text
/xiaoni-passive-recall
```

该接口复用 action-stream 的时间和 tag 参数，返回 `deliveryMode: "shadow_only"`。
返回体里有两个来源：

- `cues`：从 DB action-stream 提取的原始触发点。
- `fileCandidates`：从 `/xiaoni-runtime/forever|notes|reading|toys` 只读扫描出的文件候选。

参数：

```text
range / start_time / end_time / before_time / tags / limit
include_files / file_limit
```

用途是人工检查 cue 是否像我们要的“潜意识原始点”。只有 shadow 输出稳定后，才接
embedding、activation 和后续 daemon。daemon 即使接入，也必须先继续 shadow，不直接投递给主 agent。

## Cue Classes

```text
db_life_cue          当前生活/注意力线索，不是长期记忆
db_file_provenance   小腻写入或读取了可索引 runtime 文件
db_spoken_fragment   小腻自己发出的可见话语片段
普通工具观察     旁路信号，后续可辅助 activation 权重，但不作为 shadow cue 返回
工程审计轨迹     LLM/provider/stack/fork 审计轨迹，不作为 shadow cue 返回
```

## Current Code

- Extractor: `packages/persistence/xiaoni-passive-recall-extractor.js`
- Tests: `packages/persistence/__tests__/xiaoni-passive-recall-extractor.test.js`
- Shadow endpoint: `modules/admin-panel/backend/src/routes/agent-runtime-routes.ts`
- Action stream projection source: `packages/persistence/xiaoni-activity.js`

## Training Decision

第一版不训练模型。这里需要的是可审计、可测试、可回放的规则提取器。
如果以后要训练小模型，先用 extractor 输出的 `cueClass` / `features` / 人工修正结果积累标签；
在没有标签和误触发分析前，不引入训练模型。
