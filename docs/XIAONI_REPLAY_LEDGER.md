# Xiaoni Replay Ledger

本文档说明 `xiaoni_replay_events`。它是小腻 action replay 的唯一回放表。
如果你在排查“小腻行动流里这一条 Raw Trace 从哪里来”，先看这里，再看
`docs/AGENTS_BACKEND_DATA.md`。

## Reference

`xiaoni_replay_events` 由 `packages/persistence/xiaoni-replay-events.js` 管理。
业务模块不能直接写这张表。需要写入、查询或回填时，只能通过
`@qq-bot/persistence` 导出的 helper。

### Table Shape

| 字段 | 含义 |
|---|---|
| `event_id` | 业务稳定 id。Codex Provider 请求使用 `provider:codex:<llm_call_id>`。 |
| `identity_key` | 回放所属身份。小腻 action stream 使用 `xiaoni`；后台辅助请求使用内部 identity 隔离。 |
| `event_kind` | 事件类型。当前 Codex Provider 请求为 `codex_provider_request`。 |
| `source` | 来源。当前 action replay 只接受 `codex_provider`。 |
| `trace_id` | 工程 trace id，用于拼接 Raw Trace 和回填 conversation id。 |
| `conversation_id` | 管理端 trace 所属 conversation；缺失时可按 trace 回填，但不能覆盖已有值。 |
| `provider_call_id` | 对应 `llm_call_id`，也是合成 provider span 的主键。 |
| `model_name` / `model_provider` | 实际模型和 provider。 |
| `status` | Provider 成功请求写 `completed`。失败请求不写 replay row。 |
| `replayable` | 是否可作为 action replay 骨架。Codex Provider 成功请求写 `true`。 |
| `replay_payload` | canonical / wire request-response 和 effective unified config 的完整回放包。 |
| `wire_request` / `wire_response` | Raw Trace provider span 使用的上游请求和响应。 |
| `metadata` | span id、agent turn、prompt name、token usage、format version 等展示元数据。 |
| `source_table` / `source_id` | 审计来源去重引用，例如 `llm_call_logs` / `llm_call_id`。 |

### Public Helpers

| Helper | 用途 |
|---|---|
| `ensureXiaoniReplayEventSchema(config)` | 创建表和索引。服务启动时可以调用。 |
| `recordXiaoniReplayEvent(input, config)` | upsert 一个 replay event。只应在 persistence 层内持有 SQL。 |
| `listXiaoniReplayEvents(input, config)` | 按 identity、trace、conversation、provider call 查询 replay events。 |
| `findXiaoniReplayEventByEventId(eventId, config)` | action trace 入口按 event id 查唯一 replay row。 |
| `attachConversationIdToXiaoniReplayEventsByTrace(input, config)` | 按 trace id 给缺失的 replay row 回填 conversation id，不覆盖已有值。 |

## Write Contract

Codex Provider 成功请求的写入顺序是：

```text
provider-service OpenAIProvider.generateContent
  -> postResponses 内部完成 retry
  -> 得到最终成功 response
  -> recordProviderReplaySuccess
  -> runtimeStoreService.recordProviderReplayEvent
  -> packages/persistence.recordXiaoniReplayEvent
  -> 可选写 llm_call_logs 审计
```

失败请求不写 replay：

```text
Codex Provider 内部 retry 成功
  -> 只写最终成功 request / response

Codex Provider retry 耗尽
  -> 抛错并记录日志
  -> 不写 xiaoni_replay_events
  -> 不进入下一次 prompt replay
```

小腻 action stream 只读取 `identity_key = 'xiaoni'`、`source = 'codex_provider'`、
`replayable = true` 的行。后台工程辅助请求可以写同一张表，但必须使用内部
identity，不能污染小腻产品行动流。

## Trace Assembly

Raw Trace 的 provider skeleton 以 replay ledger 为准：

```text
xiaoni action event id
  -> findXiaoniReplayEventByEventId
  -> provider-request:wire:<llm_call_id>
  -> buildReplayProviderRequestSpan
```

`llm_call_logs`、`tool_execution_logs`、`agent_queue_messages` 不能作为 action
replay fallback。它们仍然是审计和工程排障表，但不决定小腻行动流里可点击的
回放骨架。

Traffic / MITM / CLIProxyAPI logs 只能做证据补充：

- 如果 replay ledger 有 `wire_request`，Trace 里只生成一条 `provider.request` span。
- 匹配到的 traffic rows 会挂在 generation span 的 evidence 里。
- span detail 可以从 CLIProxyAPI 请求日志补全真实上游 request / response。
- CLIProxyAPI 日志匹配只信 `x-llm-call-id` header，敏感 header 必须脱敏。

## Image Fork Boundary

图片理解 fork 不应成为长期 action replay 的 base64 来源。`inspect_image_placeholder`
会临时 clone 当前主 agent request，把图片 data URL 放进
`function_call_output.output=[input_image]`，并通过 no-persist debug 请求获取文本
观察。

可回放、可进入主上下文的是工具结果文本：

```xml
<image id="...">含义是: ...</image>
```

不可作为长期 replay 内容的是图片 base64、本次 fork 的 `input_image` data URL 和
no-persist traffic 请求。需要重新看图时，应按图片 id 重新 materialize 图片并发起
新的 vision fork。

## How To Verify Replay Writes

### 1. 查 action stream

```bash
curl -fsS 'http://127.0.0.1:9080/api/xiaoni/action-stream?limit=3'
```

返回的 Codex Provider 项应该带 `metadata.wirePayloadSource = "xiaoni_replay_events"`。

### 2. 查 trace target

```bash
curl -fsS 'http://127.0.0.1:9080/api/xiaoni/action-stream/events/<eventId>/trace'
```

成功时，provider span id 形如：

```text
provider-request:wire:<llm_call_id>
```

如果 replay ledger 没有对应 event，接口不能回退旧审计表拼出 Raw Trace。

### 3. 跑测试

```bash
npm --prefix modules/provider-service test
npm --prefix modules/admin-panel/backend test -- --runTestsByPath src/__tests__/trace-span-builder.test.ts src/__tests__/agent-runtime-routes.test.ts
node --test packages/persistence/__tests__/xiaoni-replay-events.test.js packages/persistence/__tests__/xiaoni-activity.test.js
```

关键覆盖：

- Provider 内部 retry 成功后只写一个成功 replay event。
- Provider retry 耗尽后不写 replay event。
- replay ledger 和 traffic 同时存在时，Trace 只生成一个 provider request skeleton。
- action trace 入口找不到 replay event 时，不回退旧 audit tables。
- conversation id 回填只填 `conversation_id IS NULL` 的 replay rows，不覆盖已有值。

## Why This Exists

旧链路里，LLM 审计表、traffic log、tool log、queue row 都可能被拿来拼 Raw Trace。
这会带来两个问题：

1. 失败请求、重试中间态和最终成功请求容易混在一起，下一次回放可能读到不该读的内容。
2. 同一次 Codex Provider 请求可能同时被 audit log 和 traffic log 表示，Trace UI 容易显示两条 provider request。

统一 replay ledger 把“能不能回放”变成一条明确规则：

```text
能出现在小腻 action replay 里
  = xiaoni_replay_events 里有 replayable codex_provider event
```

审计表可以更丰富，traffic log 可以更接近真实网络，但它们都不是回放骨架。
这样小腻下一次组装上下文时，只会继承成功完成的 Provider 内容，不会把失败尝试、
工程重试噪音或旧审计 fallback 重新带回 prompt。
