# Agent-Service Loop 细版

本页只回答两个问题：

1. `agent-service` 主聊天 loop 每一步到底吃什么输入，吐什么输出。
2. 当前架构如何保证普通说话/沉默不再变成固定三段式 turn。

如果只想先看总览，回 `docs/CURRENT_ARCHITECTURE.md`。

## 当前核心结论

group chat 的普通路径现在只有一个决策请求：

```text
Turn 1:
  tool_choice = allowed_tools([submit_life_action])

submit_life_action(action_type=speak, messages=[...])
  -> runtime 直接发送 QQ 消息
  -> finish, total_turns=1

submit_life_action(action_type=silent)
  -> finish, no_reply=true, total_turns=1
```

只有确实需要外部结果时才有后续 turn：

```text
submit_life_action(action_type=search)
  -> web_search
  -> submit_life_action 或 stay_silent 收口

submit_life_action(action_type=image_task, 缺少直接登记所需信息)
  -> inspect_image_placeholder / request_image_task
  -> submit_life_action 或 stay_silent 收口
```

旧的 `emit_unread_meaning -> submit_life_action -> speak/stay_silent` 三段式不是当前主路径。`emit_unread_meaning` 只作为历史 replay / 旧日志兼容处理保留，不再出现在新 group loop 的 tool definitions 里。

## 输入结构

`buildInitialInput` 给主 loop 的输入由这些层组成：

- system：`runtimePrompt.systemPrompt` + Runtime contract + Single-turn tool contract。
- developer：稳定世界叙事、当前场景、小腻当前精力/行动成本、身份事实。
- user：真实入站 QQ 消息，渲染为 `<INPUT_MESSAGE ...>`；标签只保留 `message_id`、`chat_type="群聊/私聊"`、`group` / `private_peer`。
- assistant final：小腻过去真正发出的 QQ 消息，渲染为 `<OUTPUT_MESSAGE ...>`。
- assistant commentary：`<小腻近况>`、`<小腻的OS>`、`<ACTION>`、`<图片内容>`、`<system_reminder>`。

`<小腻近况>` 是上下文压缩后置顶的纯文本近况时报，像人类对刚才、今天、最近一段的模糊记忆；它不是 transcript，也不是召回结果。

`<小腻的OS>` 不是只带上一轮。只要历史 turn 还在当前上下文窗口里，那一轮留下的 OS 就可能被回放。

## 工具集合与 tool_choice

group chat 当前工具定义：

```text
submit_life_action
web_search, if enabled
speak_in_group
inspect_image_placeholder
request_image_task
stay_silent
```

private chat 当前工具定义：

```text
web_search, if enabled
reply_in_private
stay_silent
```

life-only presence tick 当前工具定义：

```text
submit_life_action
web_search, if enabled
stay_silent
```

presence 起源的 tick 是一个上下文特例：如果发现游标后的未读 IM，它可以先 materialize 出一个具体 delivery 目标；但输入组装仍读取全局最近事件流和 `xiaoni:global` 连续性，不把阿花/海涅这类跨会话 OS 丢进单个群/私聊局部历史之外。

group chat 第一轮：

```text
allowed_tools = [submit_life_action]
```

外部工具 follow-up：

```text
if latest life action is search:
  allowed_tools = [web_search, submit_life_action, stay_silent]

if latest life action is image_task and still needs external work:
  allowed_tools = [inspect_image_placeholder, request_image_task, submit_life_action, stay_silent]
```

工程层仍然会保留 actor tools in `tools`，因为 Responses API 的 tool definitions 是请求能力集合；真正每一轮能调用什么由 `tool_choice.allowed_tools` 收缩。

## `submit_life_action`

这是当前主回合的核心工具。它一次性提交：

| 字段 | 含义 |
|---|---|
| `unread_meaning` | 当前未读消息的一次性理解：焦点、消息动作、社交目标、是否对小腻说、是否有新推进 |
| `action_type` | `speak`、`silent`、`search`、`image_task`、`proactive` |
| `message` / `messages` | `speak` 或 `proactive` 时要发给 QQ 的可见文本 |
| `participation_judgment` | 有没有具体可说点；是否只是直接请求；证据引用 |
| `interest_level` | 这件事在她身上的拉力强度 |
| `reaction_authenticity` | 没有、轻微、已形成，还是空方便话 |
| `should_search` | 是否需要公开新资料 |
| `context_gap` / `gap_resolution` | 当前上下文缺口属于哪一类，应该怎么处理 |
| `xiaoni_os` | 本轮之后留给下一次运行的内部连续性 |
| `pending_share` | 可选，下一轮可能主动分享的材料；life-only 场景会并入 `<小腻的OS>` |

普通 `speak` / `proactive` / `silent` 会在 `commitLifeAction` 内直接收口，不再等待下一轮 actor tool：

- `speak` / `proactive` 且有 `messages`：直接调用 `sendMessage`。
- `silent`：直接返回 finished。
- `speak` / `proactive` 但没有 `messages`：降级成 silent，避免空发言。
- life-only `presence_tick` 的 `speak` / `proactive` / `image_task` 不会发送 QQ；runtime 会把可分享文本整理成 `我想回头分享这个：...` 并写回 `xiaoni_os`。

`search` 和部分 `image_task` 返回 `finished=false`，让 loop 进入必要的外部工具轮。

## 沉默与降级

沉默是有效结果，不是异常。当前工程层会把这些情况收成沉默：

- `action_type=silent`。
- `participation_judgment.status=no_sayable_point`。
- `participation_judgment.status=direct_request`，但当前 `unread_meaning` 没有 direct new cue。
- `action_type=speak` 但 `reaction_authenticity=empty_but_convenient`。
- `action_type=speak` 且 `interest_level=none`。
- `action_type=speak` 且 `interest_level=low`，没有直接把小腻拉进来的新理由。

direct new cue 的定义：

```text
unread_meaning.addressed_to_me = true
或 unread_meaning.social_target = me

并且：
  has_real_novelty = true
  或 message_act in {question, request, feedback}
```

## 外部信息分流

当前主 loop 不再提供 pre-reply recall 工具。小腻必须先判断当前上下文缺口属于哪一类：

- 当前上下文已经足够：直接在 `submit_life_action` 里说话或沉默。
- 私密、群内、关系连续性缺口：当前不要编造来源；能自然问群友就问，不能问就少说或沉默。后续由 typed recall projection 把长期记忆提前注入上下文。
- 公开事实、新鲜资料、官方页面或指定 URL：走 `web_search`，不是先查记忆。
- 图片内容不清：走 `inspect_image_placeholder`。
- 帮人生成/编辑图片：能直接登记就 `request_image_task`；不能直接登记则先补必要图片信息。

长期记忆由上下文压缩异步生成三层：

- episodic observations：具体发生过什么、谁在场、小腻的位置。
- semantic assertions：客观事实、当前状态、计划、claim；必须保留 owner、directed_to、scope 和证据摘要。
- reflections：至少两条已落库 episodic observations 支撑的跨时间模式。

## Delivery 防重

一轮 run 里只允许一次可见 delivery commit。

关键行为：

- `submit_life_action(action_type=speak|proactive)` 会被视为 outbound delivery，参与重复发送指纹计算。
- `speak_in_group` / `reply_in_private` 仍然支持 legacy/follow-up 路径，也参与相同防重。
- 一旦 `markRunDeliveryCommitted` 成功，后续 outbound tool call 会被挡住，避免同一 run 重复发第二次。

## 运行态记录

成功收口后，`createConversation.rawResponse` 会记录：

```text
sent_messages
xiaoni_os
pending_share
loop_stage_artifacts.unread_meaning
loop_stage_artifacts.life_action
context_budget_turns
responses_replay_items
total_turns
termination_reason
finish_reason
finish_outcome
no_reply
```

普通发言路径现在应看到：

```text
loop_stage_artifacts.life_action.action_type = speak
sent_messages = [...]
total_turns = 1
termination_reason = reply_sent
```

普通沉默路径现在应看到：

```text
loop_stage_artifacts.life_action.action_type = silent
sent_messages = []
total_turns = 1
termination_reason = finish_no_reply
no_reply = true
```

外部工具路径的 `total_turns` 可以大于 1，这是预期；它不再代表普通发言必须三段式。

## 自学习闭环

主 loop 收口后，如果有 `evictedTurns`：

```text
主 loop 完成
  -> scheduleContextCompressionMemoryWriter
  -> write_episodic_observations
  -> write_semantic_assertions
  -> write_memory_reflections
  -> scheduleContextSummaryWriter
  -> 生成新的纯文本 <小腻近况>
```

per-turn `feedback_memory_writer` 现在只保留 timeline start/end，不再调用 provider 写入长期学习；结束原因是 `disabled_feedback_episode_tool_removed`。

## 代码地图

- `LIFE_ACTION_TOOL`：`modules/agent-service/src/services/agent-loop-service.ts`
- `selectGroupLoopToolDefinitions`：决定 group chat 暴露哪些工具定义。
- `resolveGroupLoopToolChoice`：决定每一轮 allowed tools。
- `deriveTurnControlState`：从 replay 判断当前阶段和状态偏置。
- `parseLifeAction`：解析 `submit_life_action`。
- `commitLifeAction`：直接提交普通发言、主动发言、沉默，或打开外部工具续轮。
- `applyToolResultToLoopInput`：`finished=true` 时结束本 run；`finished=false` 时把 tool output replay 给下一轮。
- `buildDuplicateOutboundSuppression`：防止同一 run 重复 outbound。

## 排障

| 现象 | 看哪里 |
|---|---|
| 第一轮还是 `emit_unread_meaning` | `selectGroupLoopToolDefinitions` / `resolveGroupLoopToolChoice` 是否部署到当前容器 |
| 普通发言出现 `turn3` | `submit_life_action` 是否缺少 `messages`，或是否走了 `search/image_task` 外部工具路径 |
| 模型自然语言结束，没有工具调用 | provider canonical response；主 loop 要求每轮必须有 tool call |
| 明明要说却沉默 | `participation_judgment`、`reaction_authenticity`、`interest_level`、`unread_meaning` |
| 发了两次 | delivery commit / duplicate outbound fingerprint |
| life-only tick 想分享但没发出来 | 这是预期；无具体 IM 目标时看 `raw_response.xiaoni_os` 是否包含“我想回头分享这个” |
| 压缩后忘记刚才在干什么 | `context_summary_writer` 输入是否包含 `<小腻的OS>`，以及写出的 `<小腻近况>` 是否置顶回放 |
