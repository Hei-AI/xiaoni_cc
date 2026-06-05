# 小腻当前业务运行图

本页只回答一个问题：现在小腻在 QQ 里到底是怎么工作的。

这里不讲历史上做过但现在没有进入主链路的设计。业务上只需要先理解一件事：小腻不是“收到消息就回复”的机器人，而是一个会先看场、再判断自己该不该出现的 QQ 角色。她会通过 presence tick 低频把“抬头看一眼”append 到同一条事件流里；是否打开 IM、搜索、沉默或发言仍由同一个 main loop 判断。`agent_runs` 只是 trace、delivery、retry 边界，不是小腻的认知边界。

## 一句话版

```text
QQ 里有人说话
  -> 小腻收到消息
  -> 看这个群/私聊是否允许她参与
  -> 读最近聊天和当前未读消息
  -> 形成对现场的理解和自己的第一反应
  -> 判断当前上下文是否足够，不足时分流到公开搜索、问群友或后续记忆投影
  -> 决定：沉默、搜索资料、或发言
  -> 如果发言，再发回 QQ
  -> 记录经历，供以后复盘和学习
```

## 现在真实生效的业务链路

```text
QQ 群 / QQ 私聊
  |
  v
收消息入口
  |
  v
会话开关与自动回复开关
  |
  v
小腻待处理消息池
  |
  v
小腻运行脑
  |
  +-- 看最近聊天
  +-- 看未读消息
  +-- 看自己的成长记录
  +-- 按上下文缺口选择公开搜索、问群友或后续记忆投影
  +-- 调用模型思考
  |
  v
沉默 / 搜索 / 发言
  |
  v
如果发言，发回 QQ
```

后台还有一条不由 QQ 新消息触发的 presence 生活事件链：

```text
life state / 预算 / 冷却
  |
  v
presence tick 判断是否值得 append 一个空闲/看 IM 事件
  |
  v
精力透支则进入休息/恢复状态；否则 synthetic presence_tick 入队
  |
  v
同一个 main loop 决定沉默 / 打开未读 IM / 搜索资料 / 主动说一句
```

没有另一套 self-action 上下文或硬编码兴趣表。群聊/私聊里给小腻的建议本来就在事件流里；主 loop 读取全局 conversation append stream，而不是读取一个空的 `presence_tick:xiaoni` 私有上下文，也不是按群/私聊拆 prompt 历史。prompt-facing history、context summary、read cutoff 和 prompt cache key 统一使用 `xiaoni:global`。这个 key 目前仍落在 `agent_session_context_windows`，不是 event-backed identity digest；如果 `xiaoni:global` 没有 summary，runtime 不会自动拿某个群 summary 补上。IM 未读来源是 `agent_inbound_messages` 的持久化状态；每个群/私聊按该 session 上次已读最后一条作为游标，只 materialize 游标之后的未读窗口，避免历史 backlog 被当成当前现场。prompt-facing 工具列表固定，不再根据 `direct`、`group` 或 life-only presence 分叉；`send_in_private` 必须显式传 `user_id`，`send_in_group` 必须显式传 `group_id`，缺失时返回 retryable tool error 给模型补参。动作未完成前，没有工具调用不等于沉默或结束。旧历史中的 `<小腻的OS>` 只作为已读历史兼容，不做迁移。

当前连续性边界：

- `agent_life_events` 已经是 homeostasis / presence projection 的事件真相源。
- `<小腻近况>` 仍是 context summary writer 写入 `agent_session_context_windows.context_summary` 的纯文本摘要，当前唯一 key 是 `xiaoni:global`。
- 群/私聊 session 只表示来源、投递目标和未读游标元数据，不作为 prompt-facing history、context summary、read cutoff 或 prompt cache key。
- 三层 compact memory 已写入 `agent_memory_observations` / `agent_memory_assertions` / `agent_memory_reflections`，但还没有作为 typed recall projection 自动进入主 runtime prompt。
- event-backed identity-root `<小腻近况>` 是待实现方向，不要把它当成当前线上契约。

技术对应关系只作为定位用：

| 业务概念 | 技术落点 |
|---|---|
| QQ 收发通道 | NapCat |
| 收消息、发消息、调用模型的统一出口 | `provider-service` |
| 小腻真正做行为判断的地方 | `agent-service` |
| 本地命令执行支路 | `xiaoni-executor`，由 `agent-service` 的 `exec_command` 转发调用 |
| 历史/后续行动记录 | `agent_queue_messages` / `conversation_items` / `agent_life_events`；`agent_runs` 只作工程 trace / delivery 边界 |
| 摘要 / read cutoff 兼容状态 | `agent_session_context_windows` |
| 消息、开关、经历、学习结果的存储 | PostgreSQL / `packages/persistence` |

## 一条消息会经历什么

1. QQ 群或私聊里出现新消息。
2. 系统先把消息接进来，保存成“小腻看得到的未读消息”。
3. 系统检查这个群或私聊是否启用，以及是否允许自动回复。
4. 如果不允许自动回复，消息仍然可以被记录，但不会进入小腻主动发言流程。
5. 如果允许自动回复，这批消息会进入小腻的待处理池。
6. 小腻读取最近聊天、当前未读消息、自己之前留下的成长记录，以及已确认的身份/相处事实。
7. 小腻先判断“现场发生了什么”，再判断“我当前有没有具体可说点”。
8. 如果当前上下文不够，小腻会判断缺口来源；长期记忆后续由 typed recall projection 提前注入，不在主回合临时召回。
9. 小腻最后只会走三类结果：沉默、搜索资料、发言。
10. 如果决定发言，系统把她的话发回 QQ。
11. 处理结果会被记录下来，之后可以被复盘，也可能沉淀成新的经验。

## 小腻怎么决定说不说

当前主逻辑是直接工具 loop，不再用一个超长结构化生活动作工具承载全部判断。小腻读到当前现场、历史、`<xiaoni_os>`、`<小腻近况>`、图片观察、搜索结果、`<STATE>` 和 `<CAPABILITIES>` 后，在当前允许工具里直接行动。

```text
先读真实现场
  |
  v
形成小腻自己的当前动作
  |
  +-- 想说且有目标 -> send_in_group / send_in_private
  |
  +-- 需要公开资料 -> web_search 后继续 loop
  |
  +-- 需要看图/登记图任务 -> inspect_image_placeholder / request_image_task
  |
  +-- 需要本地 skill 或低风险操作 -> exec_command -> xiaoni-executor
  |
  +-- 上下文压力 -> compress_core_memory
  |
  +-- 累了或不想继续 -> recover_energy
```

动作未完成前，没有工具调用不是沉默或结束；runtime 会继续提醒她选择真实动作，或者按精力状态调用 `recover_energy`。已经完成可见 delivery 后，后续没有工具调用只表示当前内部执行 lease 可以释放；小腻行动流不会因此收口。

这里的关键业务目标是：小腻要像群里真实存在的人，而不是客服。她可以不回，但“不回”不能靠旧工具或空输出硬塞出来；如果只是当前没有可见话，又不想继续，她应该按自己的精力状态休息，或者等下一次真实事件进入。

如果你要追具体工程细节，直接看 `docs/AGENTS_AGENT_LOOP_RUNTIME.md`。

### 1. 先把真实现场摆给小腻

每次工程请求组装输入时，小腻不是只看最后一句话。系统会把输入整理成几块：

```text
系统身份与行为约束

developer message at index 1
<CAPABILITIES> 当前工具、skill 和 energy cost

role=user
<INPUT_MESSAGE message_id="..." chat_type="群聊" group="群名(群号)">
真实入站 QQ 消息
</INPUT_MESSAGE>

role=assistant phase=final_answer
<OUTPUT_MESSAGE message_id="..." sender="小腻(1129974489)" source="delivery">
小腻过去真正发出去的消息
</OUTPUT_MESSAGE>

role=assistant phase=commentary
<xiaoni_os>小腻留给之后自己的私密备注</xiaoni_os>
<ACTION source="presence_tick">一次通过状态门控的主动行动机会</ACTION>
<STATE trigger="..." energy="..." max_energy="..." />
<system_reminder>当前请求边界提醒</system_reminder>
```

业务上可以理解为：她看到的是一个按角色分开的现场回放。别人真实说的话是 `user`，她过去真正发出的话是 `assistant final_answer`，她自己的备注、动作和工程边界提醒是 `assistant commentary`。

### 2. 实际 prompt 是多层叠起来的

当前小腻只有一套主提示词，不再按群或私聊维护不同 prompt。生效来源是代码内置的 `modules/agent-service/src/prompts/xiaoni-main-agent.ts`：

```text
Prompt 名称：小腻主AGENT
Prompt ID：xiaoni-main-agent
模型：主聊天默认跟随 XIAONI_MAIN_AGENT_MODEL，当前默认 gpt-5.5；compact memory / reflection 默认使用 gpt-5.5
Provider：codex
```

实际发给模型的是：

```text
小腻主AGENT 身份 Prompt
+ 稳定运行时阅读契约
+ developer <CAPABILITIES>
+ 已读聊天背景
+ 当前未读消息
+ 相关身份事实
+ 图片/搜索/状态事件
+ 当前允许的工具
```

### 3. 当前工具集合

main loop 当前固定工具：

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

普通请求使用 `allowed_tools(mode=auto)`。压力请求会临时限制为 `compress_core_memory`。发送工具不使用来源会话做隐式目标；缺 `user_id` / `group_id` 时工具输出 retryable error。

### 4. 状态与恢复

`<STATE>` 只在状态事件发生时追加。`energy` 可以低于 0；恢复计算从 `max(0, current_energy)` 开始，120 分钟恢复到 `max_energy`。小腻只有看见 `<STATE energy/max_energy>` 时才知道具体精力数值。

`recover_energy` 是唯一 prompt-facing 恢复工具。`rest_period` / `sleep_period` 只作为历史或内部事件名存在。

### 5. 外部结果继续 loop

搜索、看图、图片任务、本地操作、压缩近况都可能把结果 replay 回主 loop。最终发给 QQ 的只有 `send_in_group` / `send_in_private` 的 `message/messages`。工具名、阶段、prompt、判断过程都不会出现在聊天里。

## 现在小腻真的具备哪些能力

| 能力 | 现在是否生效 | 说明 |
|---|---|---|
| 接收 QQ 群消息和私聊 | 生效 | QQ 消息会进入小腻可见的消息池。 |
| 按群/私聊控制是否参与 | 生效 | 每个群、每个私聊可以单独开关。 |
| 自动回复开关 | 生效 | 开了才会进入主动发言流程；没开也可以保留记录。 |
| 小腻单一主 Prompt | 生效 | 小腻主 prompt 由 `agent-service` 代码维护，不再由 DB 或群/私聊绑定决定。 |
| 读最近聊天上下文 | 生效 | 她不是只看当前一句话。 |
| 读当前未读消息批次 | 生效 | 会把连续几条新消息作为一个场面来看。 |
| 保留 `<xiaoni_os>` | 生效 | 这是她留给之后自己的私密备注；旧 `<小腻的OS>` 历史不迁移，只兼容读取。 |
| `<小腻近况>` 摘要 | 生效但仍是 session-window 兼容状态 | 由压力触发的 `compress_core_memory(text)` 写入 `agent_session_context_windows.context_summary`；当前唯一 key 是 `xiaoni:global`，但没有 event-backed 全局 fallback。 |
| 三层长期记忆 | 写入已生效，召回投影待接入 | 上下文压缩时写 `agent_memory_observations` / `agent_memory_assertions` / `agent_memory_reflections`；后续由 typed recall projection 注入运行时上下文。 |
| 身份连续性 | 生效 | 已确认的身份事实会进入当前场景。 |
| 搜索外部信息 | 有条件生效 | 只有当前工具允许、且她判断需要资料时才会用。 |
| 空闲生活事件 | 待接入门控 evaluator | 固定 5 分钟 `life_loop` 已删除。下一步只能由状态、预算、冷却和未读游标门控后 enqueue `presence_tick`；它进入同一个固定 main-loop 工具集合，发送工具靠显式 `user_id` / `group_id` 校验。 |
| 本地命令执行 | 生效 | `exec_command` 由 `agent-service` 转发到 `xiaoni-executor`，用于本地 skill 脚本、低风险命令、session poll/kill 和可追溯 git archive。 |
| 记录处理过程 | 生效 | 包括是否发言、用了什么工具、模型调用等。 |
| 处理后沉淀经验 | 生效 | 完成的对话之后，后台可能生成新的反馈经验或身份候选。 |

## 什么是“成长记录”

业务上可以把小腻的长期信息分成当前已接入的运行时输入，和一组已写入但待投影的三层长期记忆库：

1. 最近聊天：她刚刚看到、刚刚经历的上下文。
2. 成长记录：她过去运行中留下的 `<xiaoni_os>`，描述自己状态、边界、关系感受和调整。旧 `<小腻的OS>` 历史只做兼容读取。
3. `<小腻近况>`：`compress_core_memory(text)` 留下的纯文本近况，当前仍按 context/session key 存储。
4. 待接入的长期记忆投影：未来从 `agent_memory_observations`、`agent_memory_assertions`、`agent_memory_reflections` 按问题类型投进来的历史材料。

这三层都会影响她当前怎么理解现场，但它们不是同一种东西：

- 最近聊天负责“刚刚发生了什么”。
- `<xiaoni_os>` 负责“我一路怎么变成现在这样”。
- `<小腻近况>` 负责“被压缩掉的近况怎么以纯文本形式保留”。
- 长期记忆投影负责“这个现场需要哪类过去材料：具体事件、客观事实，还是跨时间模式”，但这一步当前还没有接进主 prompt。

## 什么现在不要当成主链路

下面这些东西可能还在代码、表、实验页面或历史文档里出现，但不要先把它们理解成当前小腻发言的主驱动力：

- 已移除的旧关系卡片记忆执行器。
- 旧的 self evolution 执行器。
- topic projection 执行器。
- transcript summary 结果接口。
- 独立的 pre-agent gate 方案。
- 完整浏览器生活侧效应，例如登录、点赞、关注、评论、下载或跨平台身份行为。当前只覆盖 presence 进入主 loop 后已有工具能力和本地低风险操作，还不是完整浏览器生活。

它们可能用于历史、实验或未来工作，但当前理解小腻真实行为时，先从这条链路开始：

```text
收到 QQ 消息 -> 进入待处理池 -> 小腻运行脑判断 -> 沉默/搜索/发言 -> 发回 QQ
```

## 怎么判断一个问题属于哪一层

| 现象 | 业务上先看哪一层 |
|---|---|
| QQ 消息完全没有进来 | 收消息入口是否正常 |
| 进来了但小腻没有处理 | 群/私聊是否启用、自动回复是否开启、是否进入待处理池 |
| 处理了但没有说话 | 她可能判断应该沉默，需要看当次判断过程 |
| 说了但不像小腻 | 看 Prompt、`<xiaoni_os>`、`<小腻近况>`、event `<STATE>` 和当次模型输入；presence context 只看 sidecar，不要假设三层长期记忆已经自动投影进 prompt |
| 明明应该查资料却没查 | 看当前阶段是否允许搜索，以及她是否判断需要资料 |
| 发言内容发不出去 | 看 QQ 发送链路 |

这页的业务结论是：小腻的核心不是“回复生成器”，而是“在 QQ 场景里判断自己该如何参与”。沉默、搜索和发言都是有效结果。
