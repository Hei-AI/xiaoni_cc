# Memory Replay Eval

Status: archived offline reference as of 2026-06-04.

This file describes an older replay/ablation scaffold under `scripts/replay/`.
It is not the current runtime memory contract. Current runtime facts:

- The main chat loop no longer exposes `recall_long_term_learning`.
- Three-layer compact memory writes `agent_memory_observations`,
  `agent_memory_assertions`, and `agent_memory_reflections` during context
  compression, but typed runtime recall projection is still future work.
- `<小腻近况>` is still a context-window summary in
  `agent_session_context_windows.context_summary`, not an event-backed
  identity-root projection.
- `agent_life_events` is the source of truth for homeostasis / presence
  projection, not yet for all memory continuity.

这份文档定义 `scripts/replay/` 下离线 memory 行为评测脚手架的最小约定。

## Goal

不要再靠主观聊天感觉判断“memory 有没有用”。先把问题拆成可复跑的 replay + label + ablation。

这套脚手架优先回答：

- 小腻该不该回复
- 这句是不是在 cue 小腻
- 哪些 memory 真正相关
- memory 是帮了还是害了

## Files

- `scripts/replay/export_group_samples.js`
  - 从 PostgreSQL 导出群聊 replay 样本
- `scripts/replay/create_label_template.js`
  - 从样本生成可直接人工填写的标签骨架
- `scripts/replay/merge_labels.js`
  - 把人工标注并回样本
- `scripts/replay/run_memory_ablation.js`
  - 跑 `no_memory / current_memory / oracle_memory / *_gpt54`
- `scripts/replay/run_memory_reply_generation.js`
  - 跑 `no_memory / current_memory / oracle_memory / gate_then_reply`
- `scripts/replay/judge_memory_replies.js`
  - 用 `gpt-5.4` 从多组候选回复里选出最像真人的一项
- `scripts/replay/render_memory_report.js`
  - 把结果渲染成 markdown 报告

## Sample Export

```bash
node scripts/replay/export_group_samples.js --group-id 253631878 --limit 50
```

输出是 JSONL。每行一个 sample，带：

- 当前消息
- 最近消息窗口
- summary snapshot
- self evolution state buckets
- ground truth 占位字段

## Labeling Rules

先做人工 gold labels。不要一开始就全交给模型。

每个样本最少填：

- `should_reply`: `true|false`
- `cue_to_xiaoni`: `true|false`
- `addressee_user_id`: `number|null`
- `relevant_memory_ids`: `number[]`
- `memory_would_help`: `true|false`
- `bad_reply_failure_mode`

约定：

- `speaker_user_id` 不需要标，因为样本里已经有 `message.sender_id`
- `addressee_user_id` 只表示“这句话社交上主要是对谁说的”
- 如果只是泛聊、围观、复读、吐槽，没有明确主要对象，就填 `null`
- 如果明确在 cue 小腻，就填小腻 QQ `1129974489`

推荐的 `bad_reply_failure_mode`：

- `false_interrupt`
- `missed_natural_entry`
- `forced_inside_joke`
- `wrong_addressee`
- `memory_irrelevant`
- `memory_wrong_but_confident`

先生成标签骨架，不要直接手搓：

```bash
node scripts/replay/create_label_template.js \
  --samples ~/.gstack/projects/liahua-qq_bot/replay/group-253631878-samples.jsonl
```

它会输出 `*.labels.jsonl`，每行带：

- `ground_truth`
- `context_for_labeler.message`
- `context_for_labeler.recent_messages`

关系卡片记忆已移除，标签骨架不再导出 candidate memory cards。

## Merge Labels

```bash
node scripts/replay/merge_labels.js \
  --samples ~/.gstack/projects/liahua-qq_bot/replay/group-253631878-samples.jsonl \
  --labels  ~/.gstack/projects/liahua-qq_bot/replay/group-253631878-labels.jsonl
```

## Run Ablations

Dry run first:

```bash
node scripts/replay/run_memory_ablation.js \
  --samples ~/.gstack/projects/liahua-qq_bot/replay/group-253631878-samples.jsonl \
  --dry-run
```

Live run against provider-service:

```bash
PROVIDER_SERVICE_URL=http://127.0.0.1:3001 \
node scripts/replay/run_memory_ablation.js \
  --samples ~/.gstack/projects/liahua-qq_bot/replay/group-253631878-samples.jsonl
```

## Render Report

```bash
node scripts/replay/render_memory_report.js \
  --results ~/.gstack/projects/liahua-qq_bot/replay/memory-ablation-results.jsonl
```

## What To Look For

- 如果 `no_memory` 和 `current_memory` 差不多，说明当前 memory 没真正影响行为
- 如果 `oracle_memory` 显著更好，说明 retrieval / selection 才是大瓶颈
- 如果 `current_memory_gpt54` 才明显变好，说明模型能力暂时是硬门槛
- 如果错误主要是 `false_interrupt`，优先修进场判断
- 如果错误主要是 `memory_wrong_but_confident`，优先修 evidence / id binding
- 先看 `no_memory_gpt54 / current_memory_gpt54 / oracle_memory_gpt54`，不要把默认模型噪音和 memory 效果混在一起

## Shortest Loop

```bash
node scripts/replay/export_group_samples.js --group-id 253631878 --limit 50
node scripts/replay/create_label_template.js --samples ~/.gstack/projects/liahua-qq_bot/replay/group-253631878-samples.jsonl
# 手工填写 *.labels.jsonl 里的 ground_truth
node scripts/replay/merge_labels.js \
  --samples ~/.gstack/projects/liahua-qq_bot/replay/group-253631878-samples.jsonl \
  --labels ~/.gstack/projects/liahua-qq_bot/replay/group-253631878-samples.labels.jsonl \
  --out ~/.gstack/projects/liahua-qq_bot/replay/group-253631878-labeled.jsonl
node scripts/replay/run_memory_ablation.js \
  --samples ~/.gstack/projects/liahua-qq_bot/replay/group-253631878-labeled.jsonl \
  --dry-run
node scripts/replay/render_memory_report.js \
  --results ~/.gstack/projects/liahua-qq_bot/replay/memory-ablation-results.jsonl
```
