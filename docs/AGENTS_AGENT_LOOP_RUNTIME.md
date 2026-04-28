# Agent-Service Loop 细版

本页只回答两个问题：

1. `agent-service` 里的 loop 每一步到底吃什么输入，吐什么输出。
2. 最近 `253631878` 这个群里，小腻为什么经常被抑制说话。

如果你只想先看总览，回 `docs/CURRENT_ARCHITECTURE.md`。

## 近期抑制路径

最近这个群的主路径不是“provider 忽略”，而是消息正常进入 main loop 后，在 loop 内被判成沉默。

现场证据来自 2026-04-28 的 live 库：

- `group_chat_settings.group_id=253631878` 是开的，`auto_reply_enabled=1`
- 最近 7 天：
  - `2026-04-28`: `35` 个 run，`33` 个 `no_reply`
  - `2026-04-27`: `15` 个 run，`15` 个 `no_reply`
- 最近两天 `emit_unread_meaning` 最常见分类：
  - `social_target=group`
  - `addressed_to_me=false`
  - `message_act=statement`
- 最近两天 `emit_inner_reaction` 最常见分类：
  - `preferred_action=silent`
  - `interest_level=low`
  - `reaction_authenticity=weak_but_real`

这意味着她不是“没看到”，而是“看到了，也有点感觉，但判断还不值得承担一句话”。

## 抑制图，Mermaid

```mermaid
flowchart TD
    A[QQ group message via NapCat] --> B[provider-service processAutoReply]
    B --> C{auto_reply_enabled?}
    C -- no --> C1[stop before loop]
    C -- yes --> D[agent_queue_messages enqueue]
    D --> E[agent-service processQueueMessage]
    E --> F[buildInitialInput<br/>[已读消息] + [未读消息] + runtime identity facts + current batch]
    F --> G[Turn 1<br/>allowed_tools = emit_unread_meaning]
    G --> H[UnreadMeaning output<br/>latest_unread_focus<br/>message_act<br/>social_target<br/>addressed_to_me<br/>has_real_novelty]
    H --> I[Turn 2<br/>allowed_tools = emit_inner_reaction]
    I --> J[InnerReaction output<br/>interest_level<br/>reaction_authenticity<br/>preferred_action<br/>should_search]
    J --> K{preferred_action == silent?}
    K -- yes --> S1[Turn 3<br/>allowed_tools = stay_silent]
    J --> L{preferred_action == speak<br/>and interest=low<br/>and authenticity=weak_but_real<br/>and no direct new cue?}
    L -- yes --> S1
    K -- no --> M{preferred_action in speak/search/image_task?}
    M -- yes --> N[Turn 3<br/>allowed_tools = recall_long_term_learning]
    N --> O[Recall output<br/>relevant feedback reflections]
    O --> P{search / speak / image_task / silent}
    P -- speak --> Q[allowed_tools includes speak_in_group]
    P -- search --> R[allowed_tools includes web_search or stay_silent]
    P -- silent --> S1
    Q --> T[provider-service /api/internal/send_group]
    T --> U[QQ group outbound]
    S1 --> V[finish_result.no_reply = true]
    U --> W[completeQueueMessage + completeAgentRun]
    V --> W
    W --> X[async feedback_memory_writer subagent]
    X --> Y[extract_feedback_episode]
    Y --> Z[synthesize_feedback_reflection]
    Z --> AA[update_learning_state]
```

## 抑制图，PlantUML

```plantuml
@startuml
title Xiaoni agent-service loop, recent silence path

start
:NapCat inbound group message;
:provider-service processAutoReply;

if (auto_reply_enabled?) then (no)
  :stop before loop;
  stop
else (yes)
  :enqueue agent_queue_messages;
endif

:agent-service processQueueMessage;
:buildInitialInput;
note right
[已读消息]
[未读消息]
runtime identity facts
current batch
end note

:Turn 1;
:allowed_tools = emit_unread_meaning;
:UnreadMeaning output;
note right
latest_unread_focus
message_act
social_target
addressed_to_me
has_real_novelty
reason
end note

:Turn 2;
:allowed_tools = emit_inner_reaction;
:InnerReaction output;
note right
interest_level
reaction_authenticity
preferred_action
should_search
felt_direction
end note

if (preferred_action == silent?) then (yes)
  :allowed_tools = stay_silent;
  :finish no_reply;
else (no)
  if (speak + low interest + weak_but_real + no direct new cue?) then (yes)
    :force downgrade to stay_silent;
    :finish no_reply;
  else (no)
    if (preferred_action in speak/search/image_task?) then (yes)
      :allowed_tools = recall_long_term_learning;
      :recall reflections;
    endif
    if (final action == speak) then (yes)
      :allowed_tools include speak_in_group;
      :provider-service send_group;
      :QQ outbound;
    elseif (final action == search)
      :allowed_tools include web_search;
    else
      :stay_silent;
    endif
  endif
endif

:completeQueueMessage + completeAgentRun;
:schedule feedback_memory_writer;
:extract_feedback_episode;
:synthesize_feedback_reflection;
:update_learning_state;
stop
@enduml
```

## 每一步输入 / 输出

### 0. provider 入站边界

代码：`modules/provider-service/src/index.ts:601-690`

输入：

- NapCat inbound event
- 群/私聊配置
- `policy.autoReplyEnabled`

输出：

- 如果 `autoReplyEnabled=false`，这里就停
- 如果 `autoReplyEnabled=true`，写 timeline `participation.decision=delegated_to_agent_service_unified_planner`
- 再把语义化后的 inbound batch 推进 `agent_queue_messages`

关键点：

- 这里不负责“她到底该不该说”
- 这里只负责“允不允许进入主 loop”

### 1. buildInitialInput

代码：`modules/agent-service/src/services/agent-loop-service.ts:4031-4166`

输入：

- 历史 `ConversationTurn[]`
- 当前 queue batch
- runtime prompt
- runtime identity facts

输出长相：

```text
system: <小腻主AGENT system prompt + Runtime contract + Single-turn tool contract>

user: [已读消息]
user: ...历史对话...
user: <小腻的OS>...</小腻的OS>
user: [未读消息]
user: ...identity facts...
user: ...media placeholder context...
user: 2026-04-28T09:12:06.000+08:00 {楠楠(@1655827800)}
鸭叫也是一种接口
user: 2026-04-28T09:12:15.000+08:00 {小镜(@714457117)}
duck typing 如果它叫起来像鸭子那它就是诗
```

### 2. Turn 1, `emit_unread_meaning`

代码：

- tool desc: `agent-loop-service.ts:484-524`
- allowed-tools 收缩：`agent-loop-service.ts:973-978`
- 执行回显：`agent-loop-service.ts:3536-3550`

输入：

- 上一步完整 `buildInitialInput`
- `tool_choice = allowed_tools([emit_unread_meaning])`

输出 JSON：

```json
{
  "latest_unread_focus": "...",
  "message_act": "statement | question | joke | tease | feedback | reaction | request | unclear",
  "social_target": "me | someone_else | group | unclear",
  "addressed_to_me": false,
  "has_real_novelty": true,
  "confidence": "high",
  "reason": "..."
}
```

最近这个群的高频输出：

- `social_target=group`
- `addressed_to_me=false`
- `message_act=statement`

这已经把很多消息压成“群体接龙，不是拉我出来说话”。

### 3. Turn 2, `emit_inner_reaction`

代码：

- tool desc: `agent-loop-service.ts:526-571`
- allowed-tools 收缩：`agent-loop-service.ts:980-984`
- 执行回显：`agent-loop-service.ts:3551-3566`

输入：

- 原始 scene input
- 上一步 `emit_unread_meaning` 的 tool call 和 tool output replay

输出 JSON：

```json
{
  "interest_level": "none | low | medium | high",
  "wants_to_know_more": false,
  "recalled_prior_pattern": "...",
  "felt_direction": "...",
  "reaction_authenticity": "none | weak_but_real | formed | empty_but_convenient",
  "should_search": false,
  "preferred_action": "speak | silent | search | image_task",
  "reason": "..."
}
```

最近这个群的高频输出：

- `preferred_action=silent`
- `interest_level=low`
- `reaction_authenticity=weak_but_real`

这就是近期抑制说话的主入口。

## live 样本，沉默 run 是怎么一步步形成的

样本 trace：

- `run_id=run_1777338739504_9ea8802b`
- `trace_id=runtrace_1777338739504_842b2ab4`
- 结果：`no_reply=true`

它的 `tool_choice` 逐轮收缩是：

```json
turn1: {"mode":"required","type":"allowed_tools","tools":[{"name":"emit_unread_meaning","type":"function"}]}
turn2: {"mode":"required","type":"allowed_tools","tools":[{"name":"emit_inner_reaction","type":"function"}]}
turn3: {"mode":"required","type":"allowed_tools","tools":[{"name":"stay_silent","type":"function"}]}
```

也就是说，这条 run 在第二轮之后就已经被压缩成“只许沉默，不许 speak/search/recall”。

同一个样本的 live input 前几项长这样：

```text
[已读消息]
2026-04-12 10:56 {漠然lc(@287944128)}
哈哈，确实
<小腻的OS>
这轮很轻，像是对方给了一个确认的回声；我把节奏收住了，没有把简单的共鸣说重。
</小腻的OS>
...
[未读消息]
2026-04-28T09:12:06.000+08:00 {楠楠(@1655827800)}
鸭叫也是一种接口
2026-04-28T09:12:15.000+08:00 {小镜(@714457117)}
duck typing 如果它叫起来像鸭子那它就是诗
```

这个样本最后数据库里落下来的 `finish_reason` 是：

```text
最新未读是群里延续的轻梗双关，没有直接点到我，也没有形成需要我承担的话语点；先保持沉默更贴合现场节奏。
```

这就是近期抑制说话最典型的工程路径：

```text
group chatter
-> unread meaning says: group / not addressed_to_me
-> inner reaction says: low pull, weak reaction
-> allowed_tools shrinks to stay_silent
-> run ends with no_reply=true
```

## 对照样本，会说话的 run 是怎么分叉出去的

样本 trace：

- `run_id=run_1777338762208_c83215ea`
- `trace_id=runtrace_1777338762208_7d1f7815`
- 结果：发出去了，但 run 尾部误标成 `delivery_error`

它的 `tool_choice` 逐轮收缩是：

```json
turn1: {"mode":"required","type":"allowed_tools","tools":[{"name":"emit_unread_meaning","type":"function"}]}
turn2: {"mode":"required","type":"allowed_tools","tools":[{"name":"emit_inner_reaction","type":"function"}]}
turn3: {"mode":"required","type":"allowed_tools","tools":[{"name":"recall_long_term_learning","type":"function"}]}
turn4: {"mode":"required","type":"allowed_tools","tools":[{"type":"web_search"},{"name":"speak_in_group","type":"function"},{"name":"inspect_image_placeholder","type":"function"},{"name":"request_image_task","type":"function"},{"name":"stay_silent","type":"function"}]}
```

这条 run 的关键分叉点是：

- `emit_unread_meaning` 把它判成 `request`
- `emit_inner_reaction` 把它判成 `preferred_action=speak`
- 所以第三轮不是 `stay_silent`，而是先走 `recall_long_term_learning`
- recall 后第四轮才真正开放 `speak_in_group`

所以近期“能说”和“被压住”的分叉，不在 provider，不在 prompt 名称，而在：

```text
UnreadMeaning 里的 social_target / addressed_to_me / message_act
+ InnerReaction 里的 preferred_action / interest_level / reaction_authenticity
```

### 4. 第一层抑制，直接判沉默

代码：`agent-loop-service.ts:986-992`

条件：

- `preferred_action === silent`

效果：

- 下一轮 `tool_choice` 被直接收缩成 `allowed_tools([stay_silent])`

### 5. 第二层抑制，weak speak downgrade

代码：

- `hasDirectNewCue`: `agent-loop-service.ts:929-937`
- `shouldDowngradeWeakSpeakToSilence`: `agent-loop-service.ts:939-944`
- 强制收缩：`agent-loop-service.ts:994-998`

条件必须同时成立：

```text
preferred_action = speak
interest_level = low
reaction_authenticity = weak_but_real
并且没有 direct new cue
```

`direct new cue` 的定义不是“有新消息”就算，而是：

- `addressed_to_me = true`
- 并且 `has_real_novelty = true`
- 或者 `message_act in {question, request, feedback}`

所以近期很多“能接一句”的场景，在这里被压回 `stay_silent`。

## 抑制逻辑不是一层，是三层

### A. 入口层，只控制能不能进 loop

代码：`modules/provider-service/src/index.ts:617-668`

这里唯一决定的是：

- `auto_reply_enabled=false`，直接不进 loop
- `auto_reply_enabled=true`，消息进入 loop

这层不是近期沉默主因。

### B. loop 行为层，决定这轮是否值得承担一句话

代码：

- `resolveGroupLoopToolChoice`: `agent-loop-service.ts:973-1033`
- `shouldDowngradeWeakSpeakToSilence`: `agent-loop-service.ts:939-944`

这层才是近期主因。

它的做法不是写一句“大模型你少说话”，而是工程上直接改下一轮允许的工具集合。

### C. delivery 层，防止一轮里重复发言

代码：

- `markRunDeliveryCommitted`: `agent-loop-service.ts:2501-2518`
- delivery state block: `agent-loop-service.ts:2432-2438`

这层负责：

- 已经发出去一次后，不允许同一 run 再发第二次
- 它防的是重复发送，不是近期沉默变多

## tool desc 原文片段

这些不是我概括的，是 loop 里真实喂给模型的工具描述方向。

### `speak_in_group`

```text
当一句话已经在我这里成熟到值得承担时，我使用这个工具。
我开口，是因为这句话此刻对我成立，也愿意承担它落在关系里的后果。
保持自然人话，贴近眼前场域。
让这句话在现场里真正新增一点东西。
一句已经成立就自然收住，把节奏留在现场里。
```

### `stay_silent`

```text
当这一轮自然走向沉默时，我使用这个工具。
沉默也是行动的一种落点，它把这一轮之后真正留下来的东西带到下一轮。
```

### `emit_unread_meaning`

```text
先只理解最新未读到底在讲什么，以及它此刻把注意力拉向了哪里。
这一步只产出理解，不产出行动。
```

### `emit_inner_reaction`

```text
在已经理解最新未读之后，只判断你体内有没有真实反应。
这里先不要替自己找一句能说出口的话，只看这条消息有没有真的在你身上碰出一点东西。
如果只是因为有个话口、顺手能接、补一句也不违和，那还不算你真正的反应。
```

### 6. Recall 不是默认步骤

代码：

- tool desc: `agent-loop-service.ts:573-603`
- 触发：`agent-loop-service.ts:1000-1004`
- 执行：`agent-loop-service.ts:3567-3618`

只有 `preferred_action in {speak, search, image_task}`，才允许先调 `recall_long_term_learning`。

输出长相：

```json
{
  "reason": "...",
  "topic_hint": "...",
  "query_text": "...",
  "items": [
    {
      "id": 99,
      "learning_key": "group_style_avoid_template_echo",
      "learning_scope": "...",
      "scope_type": "group_self",
      "reflection_type": "...",
      "confidence": "high",
      "rank": 1,
      "why_recalled": "...",
      "summary_text": "..."
    }
  ],
  "markdown_items": ["..."]
}
```

这一步会把“别再用固定模板占位”这类历史学习召回回来，再校准是否开口。

### 7. speak / search / stay_silent 最终动作

代码：

- 动作工具描述：`agent-loop-service.ts:347-482`
- 最终 allowed-tools：`agent-loop-service.ts:1014-1033`
- 发送：`agent-loop-service.ts:3814-3891`

最近会说话的 run，最终路径通常是：

```text
emit_unread_meaning
-> emit_inner_reaction
-> recall_long_term_learning
-> speak_in_group
```

最近被压住的 run，最终路径通常是：

```text
emit_unread_meaning
-> emit_inner_reaction
-> stay_silent
```

### 8. 第三层抑制，发过一次后禁止再发

代码：

- delivery commit：`agent-loop-service.ts:2501-2518`
- 二次发言限制：`agent-loop-service.ts:2432-2438`

这层不是“近期沉默变多”的主因，但它负责防止一轮里重复说两次。

也就是：

- 只要本 run 已经通过 speaking tool 成功发出去过
- 之后再想发 speaking tool，就会被 delivery state 挡住

### 9. 自学习闭环

主 loop 收口后，不是结束。

代码：

- 调度：`agent-loop-service.ts:2682-2691`
- 子 agent 总控：`agent-loop-service.ts:2938-3130`
- 三步写入：`agent-loop-service.ts:3156-3397`

闭环是异步跑的：

```text
主 loop 完成
  -> scheduleFeedbackMemorySubagent
  -> extract_feedback_episode
  -> synthesize_feedback_reflection
  -> update_learning_state
```

如果 reflection 被判成 identity 级别，还会继续：

```text
appendIdentityChangeCandidate
-> createAcceptedIdentityFact
```

这条闭环不会直接把这一轮“沉默”改成“说话”，但会影响以后 recall 时能召回什么经验。

## 你要找的“近期为什么被抑制”

压缩成一句话：

> 最近 `253631878` 的高频消息大多先被判成“群体陈述/群体接龙，不是直接拉我”，随后内在反应又常常只是 `low + weak_but_real`，所以在 loop 里被稳定收缩到 `stay_silent`。

不是 provider 先拦了她。

也不是 prompt 根本不让她说。

是 loop 里的分阶段 allowed-tools 收缩，在 live 数据上反复把她导向 `stay_silent`。

如果你继续往下追，下一层最值得看的不是“她为什么不说”，而是：

- 哪些 `group / statement / not addressed_to_me` 其实应该升级成值得接的话头
- 哪些 `weak_but_real` 被压得太保守
- 哪些旧 `xiaoni_os` 残留在 replay 里，继续把下一轮往“先收住”推
