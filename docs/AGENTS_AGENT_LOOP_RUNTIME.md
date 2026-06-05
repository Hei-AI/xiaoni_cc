# Agent-Service Loop 细版

本页只回答当前生效的 `agent-service` 主 loop 契约。旧的拆分决策与静默结束状态机已经不是当前主路径。

## 当前核心结论

小腻是连续事件流里的行动者。`agent_runs`、queue id、trace id、delivery state 只表示工程 trace / delivery / retry / observability 边界，不是小腻的认知边界。

普通 group / private / presence-originated 请求现在暴露同一套 main-loop 工具，`tool_choice.allowed_tools(mode=auto)` 允许她按当前行动状态选择：

```text
exec_command
web_search
compress_core_memory
send_in_private
send_in_group
inspect_image_placeholder
request_image_task
recover_energy
```

工具列表不再根据 `direct`、`group` 或 life-only presence 分叉。`direct/group` 只表示本次事件来源和内部兜底路径的默认上下文，不决定 prompt-facing 工具。`send_in_private` 必须显式传 `user_id`，`send_in_group` 必须显式传 `group_id`；缺目标时工具返回 retryable `tool_error`，由模型在下一轮补参重试。

模型在动作未完成前如果没有调用任何工具，runtime 不把它当成沉默或结束，而是追加提醒继续：说话、搜索/看图/登记图任务、执行必要操作，或者按 `<STATE>` 自己选择 `recover_energy`。已经完成可见 delivery 后，后续没有工具调用只表示当前内部执行 lease 可以释放；小腻行动流不会因此收口。

## 输入结构

`buildInitialInput` 给主 loop 的输入由这些层组成：

- system：`runtimePrompt.systemPrompt` 和稳定运行契约。
- developer：开头一次稳定上下文（可选 `world_narrative`、`<skills_instructions>`、`<CAPABILITIES>`），列出当前 tools、skills、路径和 energy cost；不再追加旧 presence 私有块或旧 history-reading developer 尾块，relationship / scene / presence context 也不进 request input。
- user：真实入站 QQ 消息，渲染为 `<INPUT_MESSAGE ...>`。
- assistant `final_answer`：小腻过去真正发出去的 QQ 消息，渲染为 `<OUTPUT_MESSAGE ...>`。
- assistant `commentary`：`<小腻近况>`、`<xiaoni_os>`、`<ACTION>`、`<图片内容>`、`<STATE>`、`<system_reminder>`；旧历史中可能仍有 `<小腻的OS>`，只兼容读取，不迁移。

`<小腻近况>` 是上下文压缩后置顶的纯文本近况时报，当前存在 `agent_session_context_windows.context_summary`。主 loop 的 prompt-facing history、context summary、read cutoff 和 prompt cache key 统一使用 `xiaoni:global`。群/私聊 session 只表示来源、投递目标和未读游标元数据，不形成任何 QQ 维度 prompt history/cache key。这个 key 还不是 event-backed identity-root digest，也不会自动 fallback 到某个群 summary。

`<xiaoni_os>` 是小腻留给之后自己的私密备注，不发给 QQ。不要在 prompt 或工具 description 里使用工程术语描述它。

未打开具体 IM 时只暴露 `<UNREAD_AVAILABLE unread_count="N" direct_mentions="M" />`；不暴露正文、preview、关键词、摘要或 thread list。

## 状态与恢复

`<STATE>` 不是每次都注入。工程只在状态事件发生时 append：

- action/tool 计数阈值。
- hosted `web_search` 后。
- 低精力提醒。
- `raw_energy < 0` 后的强制完整恢复。
- 休息中被连续直接 @ 打断。

`energy` 可以是负数。恢复计算从 `max(0, current_energy)` 开始，按实际休息时长线性恢复到 `max_energy`；120 分钟表示完全恢复。小腻只有在当前上下文看见 `<STATE energy/max_energy>` 时才知道具体精力数值，不能假装知道。

`recover_energy` 是唯一 prompt-facing 恢复工具：

```text
recover_energy(reason, duration_minutes, xiaoni_os)
```

`duration_minutes` 为 5 到 120；120 分钟是满恢复。历史/internal `rest_period`、`sleep_period` 可以作为兼容 life event 存在，但不能作为面向模型的工具暴露。

## 工具语义

### `send_in_group`

向明确指定的 QQ 群发送可见消息。必须显式传 `group_id`；缺失或非法时返回 retryable `tool_error`，不调用 provider。成功后会 mark delivery committed，并按目标群记录可见 delivery life event。

### `send_in_private`

向明确指定的 QQ 用户发送可见私聊消息。必须显式传 `user_id`；缺失或非法时返回 retryable `tool_error`，不调用 provider。成功后同样参与 delivery commit 和防重。

### `web_search`

只用于公开事实、新鲜资料、官方页面或指定 URL。工具返回后 runtime 追加新的 `<STATE>`，由后续 loop 继续行动；搜索不是默认认真，也不是装样子。

### `inspect_image_placeholder`

当前上下文里有图片占位符但内容不清时使用。它只处理当前上下文可见图片 tag，不暴露本地 locator。

### `request_image_task`

能直接登记生成/编辑图片任务时使用。群聊里图片任务不能吞掉用户同时提出的可见发言需求；runtime 会强制补一条可见状态发言。

### `exec_command`

用于本地 skill 脚本或必要的低风险本地操作。当前 compose 配置下，`agent-service`
不会在自己容器里直接执行命令，而是通过 `XIAONI_EXECUTOR_URL` 转发到
`xiaoni-executor`。executor 会把 `/app` 路径映射到 `/workspace/qq_bot`，保存
session、审计日志和每次执行前的 git archive。QQ 阅读/导航仍通过 `$qq-usage`
的本地脚本，不把导航动作暴露成 OpenAI tools。

executor 细节和排障看 `docs/AGENTS_XIAONI_EXECUTOR.md`。

### `compress_core_memory`

压力专用工具。普通请求可以定义它并在 `<CAPABILITIES>` 列出成本，但默认 `allowed_tools` 不会强制它。只有 count-based 阈值或 token hard budget 压力触发时，runtime 追加：

```text
<system_reminder source="core_memory_pressure" required_tool="compress_core_memory">
```

并把当前请求的 `allowed_tools` 临时限制为 `compress_core_memory`。工具成功后，工程把 `text` 写入未来 `<小腻近况>` 并推进 read cutoff。

## Delivery 防重

一次内部执行 lease 里只允许一次可见 delivery commit。这个是工程防重边界，不写成小腻自己的认知边界。

关键行为：

- `send_in_group` / `send_in_private` 参与 outbound fingerprint。
- 一旦 `markLeaseVisibleDeliveryCommitted` 成功，后续 outbound tool call 会被挡住。
- `request_image_task` 等有副作用工具在 delivery commit 后也会被挡住，避免发完话后继续登记重复任务。

## 运行态记录

内部执行 lease 释放时，`createConversation.rawResponse` 记录：

```text
sent_messages
xiaoni_os
pending_share
unread_meaning
core_memory_compression
context_budget_turns
responses_replay_items
model_request_slices
lease_release
lease_release_reason
no_visible_delivery
```

当前不再记录 `loop_stage_artifacts.life_action`，新 runtime 代码也不再写入旧 terminal/no-reply 枚举值。普通可见发言在产品层表现为 `visible_delivery_committed` 事件；`recover_energy` 或无可见发言表现为 rest / no-visible-delivery 事件。数据库里仍存在 `termination_reason`、`finish_reason`、`no_reply` 等历史列名，仅作为未迁移 schema 的物理存储，不是产品运行态词汇。

## 自学习闭环

当前内部执行 lease 释放后，如果有被挤出窗口的 replay 条目：

```text
内部执行片段释放
  -> scheduleContextCompressionMemoryWriter
  -> write_episodic_observations
  -> write_semantic_assertions
  -> write_memory_reflections
```

当前压缩阈值是 count-based：retained history 超过 `HISTORY_COMPACT_AT=200` 时触发。工程先把完整可读窗口带给模型，并强制模型调用 `compress_core_memory`；工具成功后才把 read cutoff 推进到只保留最近 `HISTORY_COMPACT_KEEP=30` 个 replay 条目。token hard budget 也走同一个 `core_memory_pressure` / `compress_core_memory` 路径。

per-slice `feedback_memory_writer` 当前只保留 timeline start/end，不再调用 provider 写入长期学习；lease release reason 是 `disabled_feedback_episode_tool_removed`。

## 代码地图

- `TOOL_NAMES`：prompt-facing tool 名称集合。
- `selectMainLoopToolDefinitions`：固定 main-loop 工具定义。
- `buildAllowedToolsToolChoice`：生成 Responses `allowed_tools`。
- `deriveTurnControlState`：从 replay 判断当前 loop 状态。
- `executeTool`：执行具体工具。
- `applyToolResultToLoopInput`：内部 slice settled 时释放 execution lease；否则把 tool output replay 给后续请求。
- `buildDuplicateOutboundSuppression`：防止同一内部 execution lease 重复 outbound。
- `recoverRuntimeEnergy`：按实际休息时长计算恢复，负精力从 0 开始。

## 排障

| 现象 | 看哪里 |
|---|---|
| 旧决策工具还出现在 request | `selectMainLoopToolDefinitions` / `buildAllowedToolsToolChoice` 是否部署到当前容器 |
| 模型没调工具就停住 | no-tool continuation reminder；动作未进入 wait/rest/delivery 前要继续行动 |
| 普通发言没发出 | `tool_execution_logs`、provider send API、`markLeaseVisibleDeliveryCommitted` |
| 发了两次 | delivery commit / duplicate outbound fingerprint |
| 图任务吞了发言 | `request_image_task` 的 forced visible reply 逻辑 |
| send tool 没发出 | 看 `tool_execution_logs.result.tool_error`；缺 `user_id` / `group_id` 会返回 retryable error 给模型补参 |
| `exec_command` 失败或长命令卡住 | `docs/AGENTS_XIAONI_EXECUTOR.md`、`qqbot-xiaoni-executor` logs、`xiaoni-session poll/kill` |
| 压缩后忘记刚才在干什么 | 是否出现 `core_memory_pressure` reminder、工具文本是否写入实际读取的 context key、read cutoff 是否在工具成功后推进 |
| 休息中被消息打断 | resting 状态下不读正文，只统计 unread/@；连续 3 次直接 @ 后按实际休息时长恢复精力并 append `<STATE>` |
| skill 没出现在能力列表 | 检查该 skill 的 `SKILL.md` 是否有 `## Runtime Cost` 和合法 `energy_cost` |
