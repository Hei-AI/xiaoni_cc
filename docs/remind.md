# Xiaoni Runtime Reminder Templates

本文只维护小腻 prompt-facing runtime reminder 的当前索引和装配边界。
模板正文的事实源是 `docs/xiaoni_prompt/`；不要在本文复制完整 system prompt 或
模板正文。

## Template Files

| Template | File | When Used |
| --- | --- | --- |
| `core_memory_pressure` | `docs/xiaoni_prompt/core_memory_pressure_reminder.md` | 上下文窗口触发强制压缩时，作为最高优先级当前输入。 |
| `phone_notification` | `docs/xiaoni_prompt/phone_notification_reminder.md` | Notify Bucket pick 到 QQ 状态栏通知时。 |
| `image_task_notification` | `docs/xiaoni_prompt/image_task_notification.md` | 图片任务完成后由 task worker 写入 completion notify，再被主 loop pick。 |
| `self_continuation` | `docs/xiaoni_prompt/self_continuation_reminder.md` | 没有 notify，且候选 requestInput 最后一个 input item 是 `assistant final_answer` 时。 |
| `system_reminder_fallback` | `docs/xiaoni_prompt/system_reminder_fallback.md` | 工程传入空白普通 system reminder 时的兜底正文。 |
| `recover_energy_completed` | `docs/xiaoni_prompt/recover_energy_completed_reminder.md` | `recover_energy` 工具允许休息并睡到到点后，作为同一个 tool call 的 callback 文本。 |
| `recover_energy_rejected` | `docs/xiaoni_prompt/recover_energy_rejected_reminder.md` | `recover_energy` 工具被工程拒绝时，作为同一个 tool call 的 callback 文本。 |

## Assembly Rules

- Runtime reminder 使用 `developer` role 进入当前 request input。
- Runtime reminder 的 `<system_reminder>` 正文前必须带当前东八区时间前缀，形如
  `[当前时间 东八区: 2026-06-12 22:51:11 UTC+08:00]`。该前缀是
  prompt-facing 体感时间，不是工程路由字段。
- Runtime reminder 是当前输入，不是 QQ 正文、assistant 历史或 `conversation_items.user_message`。
- `self_continuation` 不作为 `agent_queue_messages` trigger 生产；它只在无 notify 且候选 requestInput 尾项仍是 `assistant final_answer` 时，由本次 request 组装逻辑追加。
- 尾项不是 `assistant final_answer` 时，只是不追加 `self_continuation`；仍直接用候选 request 发起本次模型 slice。
- `final_answer` 后不追加 final-answer 专用 prompt reminder，也不提前把 `self_continuation` 写进上一帧 replay。
- `recover_energy` 的成功/拒绝说明必须作为该工具的 `function_call_output.output` 返回；不要 enqueue 恢复用 `self_continuation` notify，也不要用 `release_lease` 字段吞掉 callback。
- 自然文本型 tool callback 可以带同样的东八区时间前缀；结构化 JSON callback 必须继续保持合法 JSON。`exec_command.codex_output` 是终端 transcript，必须保持原样，不加该前缀。
- `phone_notification` 只表示 QQ 状态栏余光；QQ 正文仍必须由模型主动通过 `$qq-usage` 读取。
- `image_task_notification` 只携带继续处理图片任务所需线索；图片 bytes、trace/run、原始 prompt 等排障细节留在 DB/trace。
- `<CAPABILITIES>` 是能力成本表，不是 reminder。
- `<STATE>` 是状态感知，不是 reminder；它只保留小腻能体感理解的状态值，工程事件名留在代码侧。

## Deleted Legacy Reminder Concepts

这些名字不再是当前 prompt-facing 契约。旧数据只能作为持久层历史事实读取，不得重新渲染进 LLM context。

- `consciousness_tick`
- `presence_tick`
- `already_picked`
- `runtime_event_snapshot`
- `emit_unread_meaning`
- `turn_control`
- `tool_loop_monitor`
- `image_task_follow_up`
- final-answer 专用 reminder

主 loop、request 组装和 `final_answer` 连续推进的唯一架构说明见
`docs/XIAONI_AGENT_STACK_LEDGER.md`。
