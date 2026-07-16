# Xiaoni Runtime Reminder Templates

本文只维护小腻 prompt-facing runtime reminder 的当前索引和装配边界。
模板正文的事实源是 `docs/xiaoni_prompt/`；不要在本文复制完整 system prompt 或
模板正文。

## Template Files

| Template | File | When Used |
| --- | --- | --- |
| `core_memory_pressure` | `docs/xiaoni_prompt/core_memory_pressure_reminder.md` | 上下文窗口触发强制压缩时，作为最高优先级当前输入。 |
| `phone_notification` | `docs/xiaoni_prompt/phone_notification_reminder.md` | Notify Bucket pick 到 QQ 状态栏通知时。 |
| `attention_lease` | `docs/xiaoni_prompt/attention_lease_reminder.md` | `$qq-usage` 主动查看某个 QQ 会话后，工程侧短期余光窗口内该会话又有新未读时。 |
| `image_task_pending` | `docs/xiaoni_prompt/image_task_pending.md` | `request_image_task` 已排队但成品图片 id/path 尚不存在时，防止小腻盲猜路径或误判任务失败。 |
| `image_task_notification` | `docs/xiaoni_prompt/image_task_notification.md` | 图片任务完成后由 task worker 写入 completion notify，再被主 loop pick。 |
| `self_continuation` | `docs/xiaoni_prompt/self_continuation_reminder.md` | 没有 notify，且候选 requestInput 最后一个 input item 是 `assistant final_answer` 时。 |
| `core_memory_compression_fork_forced` | `docs/xiaoni_prompt/core_memory_compression_fork_forced_reminder.md` | compression fork 用满整理轮次(>= FORCE_TURNS)仍未写 xiaoni_status 时的强制提醒。 |
| `image_vision_write_description` | `docs/xiaoni_prompt/image_vision_write_description_reminder.md` | image vision fork 要求模型用 `exec_command` 写入指定观察文件时。 |
| `image_vision_existing_observation` | `docs/xiaoni_prompt/image_vision_existing_observation_reminder.md` | 同一图片已有观察文件时，要求模型基于当前图片修正或补充。 |
| `image_vision_retry_missing_file` | `docs/xiaoni_prompt/image_vision_retry_missing_file_reminder.md` | image vision fork 返回 `final_answer` 但观察文件缺失或为空时。 |
| `image_vision_failed_after_retries` | `docs/xiaoni_prompt/image_vision_failed_after_retries_reminder.md` | image vision fork 多次失败后，返回给主 loop 的可恢复失败说明。 |
| `image_vision_unsupported_tool_output` | `docs/xiaoni_prompt/image_vision_unsupported_tool_output.md` | image vision fork 请求非 `exec_command` 工具时，作为 corrective tool output。 |
| `system_reminder_fallback` | `docs/xiaoni_prompt/system_reminder_fallback.md` | 工程传入空白普通 system reminder 时的兜底正文。 |
| `recover_energy_completed` | `docs/xiaoni_prompt/recover_energy_completed_reminder.md` | `recover_energy` 工具允许休息并自然醒后，作为同一个 tool call 的 callback 文本。 |
| `recover_energy_interrupted` | `docs/xiaoni_prompt/recover_energy_interrupted_reminder.md` | `recover_energy` 休息期间被私聊或群 @ 累计达到动态阈值后，作为同一个 tool call 的 callback 文本。 |
| `recover_energy_clock` | `docs/xiaoni_prompt/recover_energy_clock_reminder.md` | `recover_energy` 设置的 clock 到点且精力已可醒时，作为同一个 tool call 的 callback 文本。 |
| `recover_energy_clock_deferred` | `docs/xiaoni_prompt/recover_energy_clock_deferred_reminder.md` | clock 到点但精力仍低于最低可醒线，延后到可醒后作为同一个 tool call 的 callback 文本。 |
| `recover_energy_forced_completed` | `docs/xiaoni_prompt/recover_energy_forced_completed_reminder.md` | runtime 强制休息或恢复达到 hard cap 后的醒来提醒；forced runtime recovery 没有原始 tool call 时作为 runtime input。 |
| `recover_energy_batch_final_timeline` | `docs/xiaoni_prompt/recover_energy_batch_final_timeline.md` | 同批工具调用中 `recover_energy` 被 runtime 放到最后执行时，嵌入醒来提醒，说明哪些动作发生在睡前。 |
| `recover_energy_rejected` | `docs/xiaoni_prompt/recover_energy_rejected_reminder.md` | `recover_energy` 工具被工程拒绝时，作为同一个 tool call 的 callback 文本。 |

## Template Fragments

| Fragment | File | Used By |
| --- | --- | --- |
| `phone_notification_direct_cue_line` | `docs/xiaoni_prompt/phone_notification_direct_cue_line.md` | `phone_notification` 的私聊短摘要行。 |
| `phone_notification_group_mention_cue_line` | `docs/xiaoni_prompt/phone_notification_group_mention_cue_line.md` | `phone_notification` 的群 @ 短摘要行。 |
| `phone_notification_group_activity_cue_line` | `docs/xiaoni_prompt/phone_notification_group_activity_cue_line.md` | `phone_notification` 的普通群动静短摘要行。 |

## Assembly Rules

- Runtime reminder 默认使用 `developer` role 进入当前 request input；`self_continuation`
  是例外，使用 `user` role。
- Runtime reminder 的 `<system_reminder>` 正文前必须带当前东八区时间前缀，形如
  `[当前时间 东八区: 2026-06-12 22:51:11 UTC+08:00]`。该前缀是
  prompt-facing 体感时间，不是工程路由字段。
- Runtime reminder 是当前输入，不是 QQ 正文、assistant 历史或 `conversation_items.user_message`。
- `self_continuation` 不作为 `agent_queue_messages` trigger 生产；它只在无 notify 且候选 requestInput 尾项仍是 `assistant final_answer` 时，由本次 request 组装逻辑追加。
- 尾项不是 `assistant final_answer` 时，只是不追加 `self_continuation`；仍直接用候选 request 发起本次模型 slice。
- `final_answer` 后不追加 final-answer 专用 prompt reminder，也不提前把 `self_continuation` 写进上一帧 replay。
- 模型主动调用 `recover_energy` 后，成功/被打断/clock 醒来/拒绝说明必须作为该工具的 `function_call_output.output` 返回；不要 enqueue 恢复用 `self_continuation` notify，也不要用 `release_lease` 字段吞掉 callback。
- runtime 强制休息没有原始 tool call，醒来后使用 runtime input `<system_reminder>`；不要伪造 `function_call_output`。
- 自然文本型 tool callback 可以带同样的东八区时间前缀；结构化 JSON callback 必须继续保持合法 JSON。`exec_command.codex_output` 是终端 transcript，必须保持原样，不加该前缀。
- `phone_notification` 只表示 QQ 状态栏余光；它可以携带允许通知的短 preview、
  图片/媒体占位、群名和最新发言人，帮助小腻判断是否切到 QQ。完整 QQ 正文和上下文
  仍必须由模型主动通过 `$qq-usage` 读取。
- `attention_lease` 是 `$qq-usage` 主动查看某个 QQ 会话后的短期余光提醒；它仍是
  普通 `system_reminder` runtime input，不是 QQ 正文，不写 `conversation_items`。
  模板变量只能使用会话名、未读数量、@/私聊次数、最新发言人、短 preview 和可执行的
  `$qq-usage` 目标线索；禁止放完整正文、topic、`rawBody`、`bodyForAgent`、
  `sessionKey`、`threadKey`、`queueId`、`traceId` 或 `runId`。
- `image_task_notification` 只携带继续处理图片任务所需线索；图片 bytes、trace/run、原始 prompt 等排障细节留在 DB/trace。
- `image_task_pending` 只允许说明任务仍在渲染中，且当前没有图片 id/path；如果此前盲猜路径导致发送失败，未来完成 notify 里的 id/path 会覆盖旧失败记忆。
- `core_memory_compression_fork_forced` 只在 compression fork 内使用，不进入主 loop 普通行动流；fork 成功后的 `compress_core_memory(text)` 才会推进未来 `<xiaoni_status>`。
- image vision fork 的正文观察必须来自 `/xiaoni-runtime/image-vision/observations/<image_id>.md`；
  provider `final_answer` 只是检查时机，不是观察内容。fork 内只执行 `exec_command`，
  其它工具请求只能收到 corrective tool output。
- `<CAPABILITIES>` 是能力成本表，不是 reminder。
- `<STATE>` 是状态感知，不是 reminder；它只保留小腻能体感理解的状态值，工程事件名留在代码侧。native tool 后追加的 `<STATE>` 只在下一次模型 slice 临时可见，不作为 reminder 或 replay 持久化。

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
