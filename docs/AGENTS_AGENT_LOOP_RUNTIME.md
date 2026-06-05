# Agent-Service Loop 细版

本页只回答当前生效的 `agent-service` 主 loop 契约。旧的拆分决策与静默收口状态机已经不是当前主路径。

## 当前核心结论

小腻是连续事件流里的行动者。`agent_runs`、queue id、trace id、delivery state 只表示工程 trace / delivery / retry / observability 边界，不是小腻的认知边界。

普通 group / private 请求现在直接暴露行动工具，`tool_choice.allowed_tools(mode=auto)` 允许她按当前行动状态选择：

```text
group:
  exec_command
  web_search
  compress_core_memory
  speak_in_group
  inspect_image_placeholder
  request_image_task
  recover_energy

private:
  exec_command
  web_search
  compress_core_memory
  reply_in_private
  recover_energy

life-only:
  exec_command
  web_search
  compress_core_memory
  recover_energy
```

没有具体 QQ 会话目标的 life-only 事件不能发 QQ，也不能登记图片任务；它仍走同一个主 loop，可以做内部操作、查公开信息、压缩近况，或者由小腻自己按精力状态调用 `recover_energy`。

模型在动作未完成前如果没有调用任何工具，runtime 不把它当成沉默或结束，而是追加提醒继续：说话、搜索/看图/登记图任务、执行必要操作，或者按 `<STATE>` 自己选择 `recover_energy`。只有已经完成可见 delivery 后，后续没有工具调用才可以作为本 run 收口。

## 输入结构

`buildInitialInput` 给主 loop 的输入由这些层组成：

- system：`runtimePrompt.systemPrompt` 和稳定运行契约。
- developer：开头一次 `<CAPABILITIES>`，列出当前 tools、skills、路径和 energy cost；后段可以有当前状态、identity facts、presence context。
- user：真实入站 QQ 消息，渲染为 `<INPUT_MESSAGE ...>`。
- assistant `final_answer`：小腻过去真正发出去的 QQ 消息，渲染为 `<OUTPUT_MESSAGE ...>`。
- assistant `commentary`：`<小腻近况>`、`<xiaoni_os>`、`<ACTION>`、`<图片内容>`、`<STATE>`、`<system_reminder>`；旧历史中可能仍有 `<小腻的OS>`，只兼容读取，不迁移。

`<小腻近况>` 是上下文压缩后置顶的纯文本近况时报，当前存在 `agent_session_context_windows.context_summary`。普通群/私聊用当前 `payload.sessionKey`；life-only / presence-originated run 用 `xiaoni:global` 作为 context summary / read-cutoff 兼容 key。这个 key 还不是 event-backed identity-root digest，也不会自动 fallback 到某个群 summary。

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

### `speak_in_group`

向当前 QQ 群或明确指定的 QQ 群发送可见消息。成功后会 mark delivery committed，并记录可见 delivery life event。

### `reply_in_private`

向当前私聊用户或明确指定用户发送可见私聊消息。成功后同样参与 delivery commit 和防重。

### `web_search`

只用于公开事实、新鲜资料、官方页面或指定 URL。工具返回后 runtime 追加新的 `<STATE>`，由后续 loop 继续行动；搜索不是默认认真，也不是装样子。

### `inspect_image_placeholder`

当前上下文里有图片占位符但内容不清时使用。它只处理当前上下文可见图片 tag，不暴露本地 locator。

### `request_image_task`

能直接登记生成/编辑图片任务时使用。群聊里图片任务不能吞掉用户同时提出的可见回复需求；runtime 会强制补一条可见状态回复。

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

一次工程 trace/run 里只允许一次可见 delivery commit。这个是工程防重边界，不写成小腻自己的认知边界。

关键行为：

- `speak_in_group` / `reply_in_private` 参与 outbound fingerprint。
- 一旦 `markRunDeliveryCommitted` 成功，后续 outbound tool call 会被挡住。
- `request_image_task` 等有副作用工具在 delivery commit 后也会被挡住，避免发完话后继续登记重复任务。

## 运行态记录

成功收口后，`createConversation.rawResponse` 记录：

```text
sent_messages
xiaoni_os
pending_share
loop_stage_artifacts.unread_meaning
loop_stage_artifacts.core_memory_compression
context_budget_turns
responses_replay_items
total_turns
termination_reason
finish_reason
finish_outcome
no_reply
```

当前不再记录 `loop_stage_artifacts.life_action`。普通可见回复应看到 `termination_reason=reply_sent`；`recover_energy` 或无可见回复的完成结果是 `termination_reason=finish_no_reply`，但 recover 不会再写 silence decision life event。

## 自学习闭环

主 loop 收口后，如果有 `evictedTurns`：

```text
主 loop 完成
  -> scheduleContextCompressionMemoryWriter
  -> write_episodic_observations
  -> write_semantic_assertions
  -> write_memory_reflections
```

当前压缩阈值是 count-based：retained history 超过 `HISTORY_COMPACT_AT=200` 时触发。工程先把完整可读窗口带给模型，并强制模型调用 `compress_core_memory`；工具成功后才把 read cutoff 推进到只保留最近 `HISTORY_COMPACT_KEEP=30` 个 turns。token hard budget 也走同一个 `core_memory_pressure` / `compress_core_memory` 路径。

per-turn `feedback_memory_writer` 当前只保留 timeline start/end，不再调用 provider 写入长期学习；结束原因是 `disabled_feedback_episode_tool_removed`。

## 代码地图

- `TOOL_NAMES`：prompt-facing tool 名称集合。
- `selectActorToolDefinitions`：按 group/private/life-only 决定工具定义。
- `buildAllowedToolsToolChoice`：生成 Responses `allowed_tools`。
- `deriveTurnControlState`：从 replay 判断当前 loop 状态。
- `executeTool`：执行具体工具。
- `applyToolResultToLoopInput`：`finished=true` 时结束本 run；否则把 tool output replay 给后续请求。
- `buildDuplicateOutboundSuppression`：防止同一 run 重复 outbound。
- `recoverRuntimeEnergy`：按实际休息时长计算恢复，负精力从 0 开始。

## 排障

| 现象 | 看哪里 |
|---|---|
| 旧决策工具还出现在 request | `selectActorToolDefinitions` / `buildAllowedToolsToolChoice` 是否部署到当前容器 |
| 模型没调工具就结束 | no-tool continuation reminder；动作未完成前不应收口 |
| 普通发言没发出 | `tool_execution_logs`、provider send API、`markRunDeliveryCommitted` |
| 发了两次 | delivery commit / duplicate outbound fingerprint |
| 图任务吞了回复 | `request_image_task` 的 forced visible reply 逻辑 |
| life-only tick 想发 QQ | 没有具体 IM 目标时这是不允许的；看是否只用了内部工具或 `recover_energy` |
| `exec_command` 失败或长命令卡住 | `docs/AGENTS_XIAONI_EXECUTOR.md`、`qqbot-xiaoni-executor` logs、`xiaoni-session poll/kill` |
| 压缩后忘记刚才在干什么 | 是否出现 `core_memory_pressure` reminder、工具文本是否写入实际读取的 context key、read cutoff 是否在工具成功后推进 |
| 休息中被消息打断 | resting 状态下不读正文，只统计 unread/@；连续 3 次直接 @ 后按实际休息时长恢复精力并 append `<STATE>` |
| skill 没出现在能力列表 | 检查该 skill 的 `SKILL.md` 是否有 `## Runtime Cost` 和合法 `energy_cost` |
