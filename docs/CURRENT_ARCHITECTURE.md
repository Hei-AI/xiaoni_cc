# 小腻当前业务运行图

本页只回答一个问题：现在小腻在 QQ 里到底是怎么工作的。

这里不讲历史上做过但现在没有进入主链路的设计。业务上只需要先理解一件事：小腻不是“收到消息就回复”的机器人，而是一个会先看场、再判断自己该不该出现的 QQ 角色。她也会低频做自己的数字行动：当前只允许受预算限制的真实 hosted `web_search`，不直接发 QQ。

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
  -> 记录这次经历，供以后复盘和学习
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
  +-- 看这次未读消息
  +-- 看自己的成长记录
  +-- 按上下文缺口选择公开搜索、问群友或后续记忆投影
  +-- 调用模型思考
  |
  v
沉默 / 搜索 / 回复
  |
  v
如果回复，发回 QQ
```

后台还有一条不由 QQ 新消息触发的自主数字行动链：

```text
小腻当前状态 / 预算 / 冷却
  |
  v
self-action loop 判断是否值得行动
  |
  v
真实 hosted web_search
  |
  v
agent_digital_actions 记录 motive / query / source_trace / residue
  |
  v
安全 share_seed 进入 agent_share_pool_items
  |
  v
后续 presence context / main loop 决定是否自然聊出来
```

技术对应关系只作为定位用：

| 业务概念 | 技术落点 |
|---|---|
| QQ 收发通道 | NapCat |
| 收消息、发消息、调用模型的统一出口 | `provider-service` |
| 小腻真正做行为判断的地方 | `agent-service` |
| 小腻自主 web_search 行动记录 | `agent_digital_actions` / `agent_share_pool_items` |
| 消息、开关、经历、学习结果的存储 | PostgreSQL / `packages/persistence` |

## 一条消息会经历什么

1. QQ 群或私聊里出现新消息。
2. 系统先把消息接进来，保存成“小腻看得到的未读消息”。
3. 系统检查这个群或私聊是否启用，以及是否允许自动回复。
4. 如果不允许自动回复，消息仍然可以被记录，但不会进入小腻主动发言流程。
5. 如果允许自动回复，这批消息会进入小腻的待处理池。
6. 小腻读取最近聊天、当前未读消息、自己之前留下的成长记录，以及已确认的身份/相处事实。
7. 小腻先判断“现场发生了什么”，再判断“我这轮有没有具体可说点”。
8. 如果当前上下文不够，小腻会判断缺口来源；长期记忆后续由 typed recall projection 提前注入，不在主回合临时召回。
9. 小腻最后只会走三类结果：沉默、搜索资料、发言。
10. 如果决定发言，系统把她的话发回 QQ。
11. 这次处理会被记录下来，之后可以被复盘，也可能沉淀成新的经验。

## 小腻怎么决定说不说

当前主逻辑是分阶段的，不是让模型一次性自由发挥。它更像一套“先读场、再看自己、判断缺口、最后行动”的内在流程。

```text
先读未读消息
  |
  v
理解现在的场面
  |
  v
形成小腻自己的内在反应
  |
  +-- 没有必要出现 -> 沉默
  |
  +-- 可能需要出现
        |
        v
      判断上下文缺口来源
        |
        +-- 私密/关系/群内连续性 -> 少猜，必要时问群友；后续依赖 typed recall projection
        |
        +-- 公开事实 -> 搜索或沉默
        |
        +-- 适合回应 -> 发言或沉默
```

这里的关键业务目标是：小腻要像群里真实存在的人，而不是客服。她可以不回，也应该经常不回。系统现在就是用下面这几层把这件事落地。

如果你要追具体工程细节，尤其是：

- 每一步输入长什么样
- 每一步工具定义长什么样
- `allowed_tools` 怎么逐轮收缩
- 最近 `253631878` 为什么经常被压到 `stay_silent`
- 自学习闭环怎么从主 loop 异步接走

直接看 `docs/AGENTS_AGENT_LOOP_RUNTIME.md`。

### 1. 先把真实现场摆给小腻

小腻每次运行时，不是只看最后一句话。系统会把输入整理成几块：

```text
系统身份与行为约束

developer message at index 1
<world_narrative> 当前世界叙事

role=user
<INPUT_MESSAGE message_id="..." timestamp="..." sender="昵称(qq)" source="napcat">
真实入站 QQ 消息
</INPUT_MESSAGE>

role=assistant phase=final_answer
<OUTPUT_MESSAGE message_id="..." sender="小腻(1129974489)" source="delivery">
小腻过去真正发出去的消息
</OUTPUT_MESSAGE>

role=assistant phase=commentary
<小腻的OS>历史轮留下来的内部连续性</小腻的OS>
<ACTION source="presence_tick">主动打开群看了一眼</ACTION>
<system_reminder>本轮只需要处理指定的新入站消息</system_reminder>

developer message near the end
<current_relationship>关系/信任层</current_relationship>
<current_scene>现场状态</current_scene>
<小腻当前状态>presence context</小腻当前状态>
<system_reminder>turn_state 动态提醒</system_reminder>
```

业务上可以理解为：她看到的是一个按角色分开的现场回放。别人真实说的话是 `user`，她过去真正发出的话是 `assistant final_answer`，她自己的 OS、主动动作和工程边界提醒是 `assistant commentary`。

### 2. 实际 prompt 是三层叠起来的

当前小腻只有一套主提示词，不再按群或私聊维护不同 prompt。生效来源是代码内置的 `modules/agent-service/src/prompts/xiaoni-main-agent.ts`：

```text
Prompt 名称：小腻主AGENT
Prompt ID：xiaoni-main-agent
模型：主聊天默认跟随 XIAONI_MAIN_AGENT_MODEL，当前默认 gpt-5.5；compact memory / reflection 默认使用 gpt-5.5
Provider：codex
```

这个 Prompt 的第一层是小腻的身份和世界观。代码里保存的开头是：

```text
我叫小腻，IM 编码 1129974489。
我在 QQ 里生活，会看群、私聊、网页和自己的任务状态；聊天只是其中一个动作。
```

这层负责回答“她是谁”。它不是每轮决策规则本身，而是小腻的底色。

第二层是运行时阅读契约，系统每轮都会追加。它告诉小腻应该怎么读聊天现场：

```text
<INPUT_MESSAGE> 是真实入站 QQ 消息。
<OUTPUT_MESSAGE> 是小腻过去已经发出去的 QQ 消息。
<ACTION> 是小腻自己的动作或状态事件。
<小腻的OS> 是留给后续自己的内部连续性。
<system_reminder> 是工程控制逻辑给出的本轮边界提醒。
```

第三层是单轮工具契约。它把本轮收口限制在几种业务动作里：

```text
话已成立，而且值得我承担，就说。
事已成立，但理解未足，就先求知。
如果没有具体可说点，就沉默。

群聊说话时，调用 speak_in_group。
需要求知时，调用 web_search。
最终不说时，调用 stay_silent。
无论说、查还是不说，都留下自然的 xiaoni_os。
```

所以“prompt 是啥”不能只看一个字段。实际发给模型的是：

```text
小腻主AGENT 身份 Prompt
+ 运行时阅读契约
+ 单轮工具契约
+ 已读聊天背景
+ 当前未读消息
+ 相关身份事实
+ 当前这批消息
+ 靠近末尾的当前关系、场景、小腻状态和可选 turn_state reminder
+ 当前阶段允许的工具
```

### 3. 第一步：理解未读消息，不准行动

第一步只允许小腻调用一个工具：

```text
emit_unread_meaning
```

这一步要她回答的不是“要不要回”，而是“眼前这批新消息到底在干什么”。工具会要求她给出这些字段：

| 字段 | 业务含义 |
|---|---|
| `latest_unread_focus` | 当前未读消息的重点是什么 |
| `message_act` | 这句话是在陈述、提问、玩笑、调侃、反馈、请求，还是不清楚 |
| `social_target` | 注意力是指向小腻、别人、整个群，还是不清楚 |
| `addressed_to_me` | 是否明确对小腻说 |
| `has_real_novelty` | 是否真的出现了新信息 |
| `confidence` | 她对这个理解有多确定 |
| `reason` | 为什么这么判断 |

这一步的业务意义是：先把“发生了什么”看清楚，避免她直接顺着话口回复。

### 4. 第二步：看有没有具体可说点

只有第一步完成后，系统才允许她调用：

```text
emit_inner_reaction
```

这一步也不允许她直接发言。它只问：这件事有没有真的在小腻身上碰出东西。

| 字段 | 业务含义 |
|---|---|
| `interest_level` | 兴趣强度：没有、低、中、高 |
| `wants_to_know_more` | 是否真的想知道更多 |
| `reaction_authenticity` | 反应强度：没有、轻微、已经形成，或没有具体可说点 |
| `participation_judgment` | 这轮有没有具体可说点、是否是直接请求，以及证据引用 |
| `should_search` | 是否需要查资料 |
| `preferred_action` | 倾向动作：发言、沉默、搜索 |
| `context_gap` | 当前上下文是否足够，缺口是私有记忆、公开信息，还是群内来源不明 |
| `gap_resolution` | 下一步应该不补、查记忆、web_search、问群友，还是先记忆再问/搜 |
| `reason` | 为什么 |

这里最重要的字段是 `participation_judgment`。如果只是“这句话好像能接一下”，会被标成 `empty_but_convenient` 或 `participation_judgment.status=no_sayable_point`，它不等于真正想说。小腻必须区分“我有具体可说点”和“我只是可以补一句”。

### 5. 如果倾向沉默，就只能沉默

如果第二步给出的 `preferred_action` 是 `silent`，系统下一步只允许：

```text
stay_silent
```

`stay_silent` 不是“什么都没发生”。它会记录：

| 字段 | 业务含义 |
|---|---|
| `reason` | 为什么这一轮不说 |
| `outcome` | 这一轮的沉默结果是什么 |
| `xiaoni_os` | 沉默之后留在小腻身上的余波，下一轮会继续带着 |

这就是为什么沉默也是有效结果。她不是失败了，而是判断“这轮不出现更自然”。

如果第二步没有具体可说点，系统同样只允许 `stay_silent`。也就是说，`preferred_action=speak` 不能绕过 `participation_judgment.status=no_sayable_point`；只有 `has_sayable_point`，或当前消息明确直接请求小腻处理时的 `direct_request`，才可能继续到最终动作。

### 6. 如果只是很弱地想说，还会被强制收住

系统还有一条额外保护：如果小腻第二步说“我想说”，但同时满足这些条件：

```text
interest_level = low
reaction_authenticity = weak_but_real
没有直接把她拉进来的新理由
```

那系统会把下一步限制成：

```text
stay_silent
```

“直接把她拉进来的新理由”必须是：有人明确对小腻说话，并且里面有新信息、问题、请求或反馈。否则，即使她有一点轻微反应，也不能为了显得活跃而开口。

### 7. 如果上下文不够，先判断缺口来源

现在不是“可能要说或要查就先召回”。第二步会先给出 `context_gap` 和 `gap_resolution`：

- `none`：当前上下文足够，直接进入最终动作。
- `needs_private_memory` / `unclear_group_reference`：当前主 loop 不再调用 pre-reply recall；后续由 typed recall projection 提前把相关长期记忆投进上下文。没投进来时要少猜，必要时问群友来源。
- `needs_public_info`：这是公开事实、新鲜资料、官方页面或指定 URL，直接走 `web_search`。
- `current_context_insufficient`：上下文不足但来源不明，优先少猜；可以问群友来源，或者保持沉默。

长期记忆由上下文压缩触发的三层 writer 生成：

- `agent_memory_observations`：episodic，保留具体发生过什么。
- `agent_memory_assertions`：semantic，保留客观事实、状态、计划、claim，并记录 owner、directed_to、scope 和 evidence_summary。
- `agent_memory_reflections`：reflection，至少两条已落库 observation 支撑的长期模式，按 person / dyad / group / self-continuity 等类型保存。

业务上，这一步的作用是让未来 runtime context 能按问题类型拿到合适记忆，而不是在当前回合临时让模型决定要不要召回。

### 8. 最后才允许搜索、发言或沉默

经过缺口分流之后，系统才打开最后动作。

如果第二步倾向是 `search`，下一步只允许：

```text
web_search
stay_silent
```

也就是说，判断需要资料时，她可以查；但如果查这个动作本身并不成立，也可以沉默。搜索不是默认认真，也不是装样子。只有现场需要新鲜公开事实、官方页面或指定 URL，而她知道得不够时才用。

如果第二步倾向是 `speak`，下一步允许：

```text
web_search
speak_in_group
stay_silent
```

她可以在搜索、问群友或读取已投影记忆后改变主意：说、继续查，或者沉默。

`speak_in_group` 会要求她给出：

| 字段 | 业务含义 |
|---|---|
| `message` / `messages` | 真正发到 QQ 群里的话，可以一段或多段 |
| `mention_user_ids` | 如确实自然需要，可以艾特具体人 |
| `xiaoni_os` | 这轮之后留给下一轮自己的内在延续，不发给群里 |

最终发给群友的只有 `message/messages`。工具名、阶段、prompt、判断过程都不会出现在聊天里。

所以，真正决定“小腻要不要开口”的地方，是小腻运行脑，不是收消息入口。

## 现在小腻真的具备哪些能力

| 能力 | 现在是否生效 | 说明 |
|---|---|---|
| 接收 QQ 群消息和私聊 | 生效 | QQ 消息会进入小腻可见的消息池。 |
| 按群/私聊控制是否参与 | 生效 | 每个群、每个私聊可以单独开关。 |
| 自动回复开关 | 生效 | 开了才会进入主动发言流程；没开也可以保留记录。 |
| 小腻单一主 Prompt | 生效 | 小腻主 prompt 由 `agent-service` 代码维护，不再由 DB 或群/私聊绑定决定。 |
| 读最近聊天上下文 | 生效 | 她不是只看当前一句话。 |
| 读当前未读消息批次 | 生效 | 会把连续几条新消息作为一个场面来看。 |
| 保留 `<小腻的OS>` | 生效 | 这是她之前对自己状态和成长的连续记录。 |
| 三层长期记忆 | 写入已生效，召回投影待接入 | 上下文压缩时写 `agent_memory_observations` / `agent_memory_assertions` / `agent_memory_reflections`；后续由 typed recall projection 注入运行时上下文。 |
| 身份连续性 | 生效 | 已确认的身份事实会进入当前场景。 |
| 搜索外部信息 | 有条件生效 | 只有当前阶段允许、且她判断需要资料时才会用。 |
| 自主 web_search 数字行动 | 生效 | 后台 self-action loop 低频触发真实 hosted `web_search`，写入 `agent_digital_actions` 和 share pool；不直接发 QQ。 |
| 记录本次处理过程 | 生效 | 包括是否发言、用了什么工具、模型调用等。 |
| 处理后沉淀经验 | 生效 | 完成的对话之后，后台可能生成新的反馈经验或身份候选。 |

## 什么是“成长记录”

业务上可以把小腻的长期信息分成三层运行时输入，加上一组三层长期记忆库：

1. 最近聊天：她刚刚看到、刚刚经历的上下文。
2. 成长记录：她过去运行中留下的 `<小腻的OS>`，描述自己状态、边界、关系感受和调整。
3. 长期记忆投影：从 `agent_memory_observations`、`agent_memory_assertions`、`agent_memory_reflections` 按问题类型投进来的历史材料。

这三层都会影响她当前怎么理解现场，但它们不是同一种东西：

- 最近聊天负责“刚刚发生了什么”。
- `<小腻的OS>` 负责“我一路怎么变成现在这样”。
- 长期记忆投影负责“这个现场需要哪类过去材料：具体事件、客观事实，还是跨时间模式”。

## 什么现在不要当成主链路

下面这些东西可能还在代码、表、实验页面或历史文档里出现，但不要先把它们理解成当前小腻发言的主驱动力：

- 已移除的旧关系卡片记忆执行器。
- 旧的 self evolution 执行器。
- topic projection 执行器。
- transcript summary 结果接口。
- 独立的 pre-agent gate 方案。
- 完整浏览器生活侧效应，例如登录、点赞、关注、评论、下载或跨平台身份行为。当前 self-action 只做 hosted `web_search`。

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
| 说了但不像小腻 | 看 Prompt、成长记录、三层长期记忆投影和当次模型输入 |
| 明明应该查资料却没查 | 看当前阶段是否允许搜索，以及她是否判断需要资料 |
| 发言内容发不出去 | 看 QQ 发送链路 |

这页的业务结论是：小腻的核心不是“回复生成”，而是“在 QQ 场景里判断自己该如何参与”。沉默、搜索和发言都是有效结果。
