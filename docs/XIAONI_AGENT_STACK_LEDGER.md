# Xiaoni Agent Stack Ledger

本文档是小腻主 loop、LLM 请求组装、行动流和 trace detail 的目标架构。
它描述本轮底层重构要落地的事实源；迁移完成前，旧表可以继续作为兼容投影或
provider evidence，但不能再被写成新的概念来源。

## Core Model

小腻不是一组离散客服请求，而是一条连续 agent loop：

```text
system prompt
developer prompt
agent_stack_items[0..n]
  -> assemble llm_request_slices[n]
  -> post provider
  -> append response.output_items
  -> append function_call_output for each invoked tool
  -> next loop tick
```

`final_answer` 不是终止条件。它只是模型本轮没有更多工具调用的输出形态；如果小腻
仍然活着，当前连续 loop 的下一轮必须先追加真实 notify 或普通 `self_continuation`
runtime input，再继续发下一次模型请求。
不要为了 `final_answer` 额外制造专用 prompt reminder。

目标伪代码：

```ts
const request = [system_prompt, init_developer_msg]

while (xiaoni_alive) {
  const notify = pickNotify()
  if (notify) request.push(render_system_reminder(notify))

  const response = post_llm(request)
  appendStackItems(response.output_items)
  request.push(...response.output_items)

  const toolCalls = parse_tool_calls(response.output_items)
  if (toolCalls.length > 0) {
    for (const call of toolCalls) {
      const result = invoke(call)
      const output = function_call_output(call.id, result)
      appendStackItems([output])
      request.push(output)
    }
    continue
  }

  if (phase(response.output_items) === "final_answer") {
    const reminder = renderSelfContinuationReminder()
    appendStackItems([reminder])
    request.push(reminder)
    continue
  }

  continue
}
```

## Tables

所有共享读写必须收口到 `packages/persistence`，并优先用 Prisma schema /
Prisma Client 表达。业务模块只调用 persistence helper，不直接拼 SQL。

### `agent_stack_items`

追加式事实源。每个模型可回放 item、工具输出、当前输入提醒、可见出站和必要状态
事件都在这里拥有稳定顺序。

| Field | Meaning |
| --- | --- |
| `id` | 稳定 id。 |
| `identity_key` | 小腻主 loop 使用 `xiaoni`。 |
| `stack_index` | 同一 identity 下单调递增顺序。 |
| `item_kind` | `runtime_input`、`assistant_output`、`function_call`、`function_call_output`、`visible_delivery`、`state_event`、`memory_event` 等。 |
| `role` | OpenAI request role，或内部投影 role。 |
| `phase` | 模型输出 phase，例如 `commentary` / `final_answer`。非模型 item 可为空。 |
| `provider_item_id` | provider 返回的 item id，若存在则保留。 |
| `tool_call_id` | function call / output 的稳定关联 id。 |
| `content` | 可回放 payload。只保存 provider 可接受的 output item 或 runtime 定义的结构化 item。 |
| `visibility` | `model_visible`、`trace_only`、`operator_only` 等。 |
| `source_type` / `source_id` | 来源表和来源 id，便于迁移期 join。 |
| `created_at` | 追加时间。 |

`system_prompt` 和稳定 developer prompt 不作为普通行动卡写入 stack；它们属于 request
assembly 固定前缀。`phone_notification`、`image_task_notification`、
`self_continuation`、`core_memory_pressure` 这类 reminder 只属于当前输入，可写入
stack 作为本轮 `runtime_input`，但不能写成 QQ 正文或 assistant 历史。

### `llm_request_slices`

每次真实 LLM 请求都记录为一个 slice。slice 不是小腻的认知边界，只是审计和 trace
边界。

| Field | Meaning |
| --- | --- |
| `id` | slice id。 |
| `identity_key` | `xiaoni`。 |
| `input_start_index` / `input_end_index` | 本次 request 读取的 stack 闭区间。 |
| `canonical_request` | 组装后的 provider-neutral request。 |
| `wire_request` | 实际发给 provider 的请求，敏感字段需脱敏或隔离存储。 |
| `raw_response` | provider 原始响应。 |
| `output_items` | 模型可回放输出 item。 |
| `status` | `completed`、`failed`、`cancelled`。 |
| `token_usage` | provider 返回的 usage。 |
| `trace_id` / `run_id` | 工程 trace / delivery join key。 |
| `created_at` / `completed_at` | 请求时间。 |

Raw Trace 的 LLM span detail 应直接展示 `canonical_request`、`wire_request`、
`raw_response` 和本次 slice 覆盖的 stack item 范围。

### `tool_executions`

每个工具调用都有独立执行记录，并通过 `tool_call_id` 回连 stack。

| Field | Meaning |
| --- | --- |
| `id` | tool execution id。 |
| `llm_request_slice_id` | 产生 tool call 的 LLM slice。 |
| `tool_call_id` | OpenAI function call id。 |
| `tool_name` | 工具名。 |
| `arguments` | 模型给出的参数。 |
| `result` | runtime 回传给模型的 `function_call_output.output`。 |
| `status` | `completed`、`failed`、`timeout`。 |
| `side_effect` | 是否产生 QQ 发言、读 inbox、文件写入、任务入队等副作用。 |
| `created_at` / `completed_at` | 执行时间。 |

工具结果进入下一轮 request 的唯一形态是 stack 中的
`function_call_output(call.id, result)`，而不是重新由日志拼一个近似文本。

### `stack_compactions`

当 stack 过长时，压缩是一个显式事件，而不是悄悄改写历史。

| Field | Meaning |
| --- | --- |
| `id` | compaction id。 |
| `identity_key` | `xiaoni`。 |
| `compacted_start_index` / `compacted_end_index` | 被压缩的 stack 范围。 |
| `summary_stack_item_id` | 写回 stack 的摘要 item。 |
| `method` | `compress_core_memory` 或未来官方 compaction。 |
| `created_at` | 压缩时间。 |

## Request Assembly

每轮请求由固定前缀和 stack 窗口组成：

```text
request =
  fixed system prompt
  fixed developer prompt
  developer <CAPABILITIES>
  pressure/state developer blocks if needed
  stack window from agent_stack_items
```

规则：

- 只 append 模型可回放输出，不 append 整个 provider envelope。
- 同一条 queue message 的 continuous loop 中，固定 `system prompt` 和稳定 developer
  前缀只在 loop 外组装一次；普通下一片只追加模型 output、tool output 和 runtime
  reminder。只有上下文压缩这类 P0 窗口收缩可以重组 request window。
- `current_input` / reminder 是当前感官输入，不是 QQ 正文，也不是 assistant 历史。
- QQ 正文只在模型主动用 `$qq-usage` 后，作为工具结果或可见 transcript 进入 stack。
- `conversation_items` 可以在迁移期继续作为 transcript 兼容投影，但不再是主 loop
  request assembly 的概念事实源。
- `xiaoni:global` 仍是主 loop 的 identity / prompt cache / summary key；
  `qq:direct:*` / `qq:group:*` 只做投递目标和 QQ app 未读游标 metadata。

## Activity Stream Projection

管理端“小腻行动流”是 stack/tool/life/media/task 事实的投影，不是 provider 请求列表。

应该生成卡片：

- `runtime_input`：真实 notify、self continuation、记忆压力等当前输入。
- `function_call`：模型请求工具。
- `function_call_output` / `tool_executions`：工具实际执行结果。
- `visible_delivery`：QQ 发言、图片发送等外界可见动作。
- `state_event` / `life_event`：休息、精力变化、看到消息、图片任务完成等重要状态。

不应该生成普通行动卡：

- system prompt / developer prompt 固定前缀。
- provider request 本身。
- token usage、retry metadata、lease acquire/release 等纯工程审计事件。
- 没有外部可见动作的普通 `final_answer`。

provider request / response evidence 直接来自 `llm_request_slices.wire_request` 和
`llm_request_slices.wire_response`。event search 可以搜 LLM slice / stack item / tool
execution，但结果必须回到相关 LLM slice、stack item 或行动卡上下文展示。

## Trace Detail

点击行动流卡片时，trace 聚焦真实事实源：

```text
function_call card
  -> agent_stack_items(function_call)
  -> llm_request_slices
  -> provider wire payload on llm_request_slices

tool result card
  -> tool_executions
  -> agent_stack_items(function_call_output)

visible delivery card
  -> delivery / conversation projection
  -> source stack item or tool execution
```

如果 provider evidence 缺失，Trace 不伪造 provider payload；仍展示 stack、LLM slice
和 tool execution 自身证据。

## Migration Plan

1. 文档和 API contract 先收口到本文，停止把 provider replay 或旧 transcript ledger
   描述成行动流事实源。
2. 在 `packages/persistence` 增加 Prisma schema 和 helper：`agent_stack_items`、
   `llm_request_slices`、`tool_executions`、`stack_compactions`。
3. `agent-service` 主 loop 写 stack ledger；旧 runtime LLM/tool audit 表和 provider
   replay ledger 已删除，schema ensure 会 drop 对应遗留表。
4. 管理端行动流和 trace detail 改读 stack ledger；provider request / response
   evidence 只从 `llm_request_slices` 读取。
5. 清理旧 provider-first / run-first 查询和误导性文档，删除不再使用的兼容路径。

## Verification

重构落地后至少覆盖：

```bash
npm --prefix modules/agent-service test
npm --prefix modules/admin-panel/backend test -- --runTestsByPath src/__tests__/trace-span-builder.test.ts src/__tests__/agent-runtime-routes.test.ts
node --test packages/persistence/__tests__/*.test.js
```

关键断言：

- 一个 LLM response 的 output items 按顺序追加到 `agent_stack_items`。
- tool call 和 `function_call_output` 用同一个 `tool_call_id` 回连。
- `final_answer` 后没有工具调用时不产生 final-answer 专用 reminder；下一轮必须由
  普通 self continuation 或真实 notify 作为 runtime input 推进。
- 行动流不会把 provider request、token usage 或 lease 事件当成普通行动卡。
- Trace detail 能从行动卡回到 stack item、LLM slice、tool execution 和可选
  provider evidence。
