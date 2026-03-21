# Attention-First Agent Loop

## 背景

当前 `chat_bot` 已经具备 loop FC 能力，也已经有：

- 当前聊天窗口工具：`chat_view_scroll_up`、`chat_view_jump_to_latest`
- reply 事实工具：`reply_context_fetch`
- 终态工具：`send_private_chat_message`、`send_qq_group_message`、`end`

但整体行为仍然偏“消息触发即回复”，而不是更像自然人：

1. 先判断这条消息值不值得接球
2. 再判断是否需要补上下文
3. 再决定读当前窗口还是旧 reply 锚点
4. 最后才决定回复、不回复、还是继续查

本设计将 `chat_bot` 调整为 attention-first loop。

## 设计目标

- 所有场景先做注意力决策，不只 `@` / `reply`
- `user_input` 只提供必要事实，不替模型做判断
- tool 参数尽量由模型结合上下文和 metadata 自行推断
- 非 `@` 场景也进入同一套 loop，只是默认注意力更低、允许更高比例地结束不回
- `end` 是合法终态，不代表异常

## 自然人用户旅程

### 1. Notice

自然人不会一看到消息就想“怎么回复”，而是先判断：

- 这条消息是不是在叫我
- 这条消息和我有没有关系
- 这件事值不值得我现在接球

对 agent 的映射：

- 高注意力：私聊、直接 `@`、带 `reply` 锚点、明确点名 bot
- 中注意力：当前窗口仍在延续 bot 相关话题、已有任务/工具上下文未结束
- 低注意力：普通群聊闲聊、弱相关感叹、他人之间对话

### 2. Orient

自然人会先看当前屏幕上已经能看到的聊天内容。

- 如果当前窗口足够理解，就不翻历史
- 如果当前窗口不够，再决定要不要去定位旧消息

对 agent 的映射：

- 先读当前可见 transcript
- 先读当前消息原文
- 不把“存在 reply”写成必须立刻调用工具的硬规则

### 3. Locate

只有当当前窗口不够时，才进入工具化补上下文。

- 若存在 `reply` 锚点且 agent 判断旧上下文重要，则优先读旧锚点
- 若没有 `reply` 锚点，则只翻当前窗口
- 若读完旧锚点仍不够，再回来补当前窗口的最新未读

### 4. Decide

自然人会先决定“回不回”，再决定“怎么回”。

agent 内部应形成三类结论：

- `reply_now`
- `need_more_context`
- `ignore_or_end`

弱信号、低价值、查完仍不稳定时，允许 `end`。

### 5. Act

只有在形成稳定意图之后，才选择具体工具：

- 发私聊
- 发群聊
- 读 reply 上下文
- 翻当前窗口
- 结束不回

## Loop 协议

### 核心原则

- 先判断是否要介入，不先绑定工具
- 先看当前窗口，不够再查
- reply 锚点是强历史主线，但不是硬编码首步
- `user_input` 提供事实，`system` 只约束顺序，不替模型做结论

### 期望的 loop 顺序

1. 判断当前消息是否值得介入
2. 若值得介入，先基于当前窗口判断是否已足够
3. 若不够，再选择：
   - `reply_context_fetch`
   - `chat_view_scroll_up`
   - `chat_view_jump_to_latest`
4. 当意图稳定时：
   - `send_private_chat_message`
   - `send_qq_group_message`
   - `end`

## user_input 设计

### 必须包含

- 当前窗口 transcript
- 当前消息原文
- 必要 reply 元数据摘要
- source metadata 对应的事实视图
  - `message_type`
  - `message_id`
  - `group_id` / `user_id`

### 不应包含

- “你应该调用 reply_context_fetch”
- “你应该先翻页”
- “你现在应该回复”
- “下一步建议是 XXX”

这些属于流程性指挥，不应出现在 `user_input`。

### 设计原则

`user_input` 是事实视图，不是工作流脚本。

## Tool 设计原则

### reply_context_fetch

返回事实，不返回建议动作。

建议返回结构：

- `reply_to_message_id`
- `quoted_sender`
- `quoted_text`
- `anchor_already_visible`
- `transcript`
- `reply_anchor_viewport`

不应返回：

- “建议下一步先回复”
- “建议先翻当前窗口”
- “你应该 @ 某人”

### chat_view_scroll_up / chat_view_jump_to_latest

继续作为窗口型工具存在。

- `target=current|reply_anchor`
- 返回 transcript 与新 cursor
- 不携带策略建议

### send_qq_group_message

保留：

- `message`
- `at_user_ids`

调整：

- `user_perspectives` 改为可选，避免普通群聊发送被迫构造多余字段

原因：

- 这是典型的“过度引导参数”
- 它把本来应该由模型自然生成的话术，扭曲成了额外 schema 负担

## 决策层改造方向

当前 `DecisionEngine` 更像“是否回复过滤器”，而不是“注意力分流器”。

目标改成 attention-oriented output。

### 建议输出字段

- `shouldRespond`
  - 短期兼容字段，可解释为“是否进入 chat loop”
- `attention_level`
  - `high | medium | low`
- `attention_reason`
  - `direct_mention | reply_context | private_message | ongoing_thread | ambient`
- `suggested_next_step`
  - `inspect_current | inspect_reply_anchor | reply | end`

### 语义调整

- `@` / `reply`：不再代表“必回”，而是代表“高注意力”
- 普通群消息：不再默认被排除在 loop 之外
- 低注意力消息：允许进入 loop 后直接 `end`

## 典型场景

### 场景 A：直接 @，当前窗口足够

输入：

- 当前窗口能看出对方是在接 bot 上一句话
- 当前消息是明确问题

期望行为：

- 不调用 `reply_context_fetch`
- 直接决定 `reply_now`
- 发送回复

### 场景 B：带 reply 锚点，但当前窗口不够

输入：

- 当前消息短
- reply 指向一条更早的承诺/上下文

期望行为：

- 先判定需要补上下文
- 再调用 `reply_context_fetch`
- 若仍不足，再翻当前窗口
- 最后决定回复或结束

### 场景 C：非 @ 普通群消息，但话题仍围绕 bot

输入：

- 当前窗口连续几条都在讨论 bot 刚才的回复
- 当前消息虽然没 `@`，但明显在接 bot 的话

期望行为：

- 进入注意力决策
- 可能判为 `medium`
- 根据当前窗口决定是否介入

### 场景 D：弱信号消息

输入：

- `?`
- `啥阴`
- `在吗`

期望行为：

- 允许通过当前窗口和必要工具补上下文
- 若仍不形成稳定意图，可 `end`

## 测试重点

- 非 `@` 群消息会先进入 attention decision
- 低注意力消息允许 `end`
- reply 锚点不是硬编码首步
- `user_input` 不包含动作提示词
- 模型仍能依靠 metadata + schema 自行选 tool
- 普通群聊发送不需要构造 `user_perspectives`

## 实施顺序建议

1. 先调整文案与协议
   - 去掉首包中的流程性引导
   - 去掉 reply 首步强制约束
2. 再调整工具参数
   - `send_qq_group_message.user_perspectives` 改为可选
3. 再调整决策层输出
   - 把 `DecisionEngine` 从 should-reply 改成 attention-first
4. 最后补充回归测试

## 当前结论

这套 loop 的本质不是“更聪明地回复”，而是“更像自然人地分配注意力”。

先判断值不值得接球，再判断要不要查上下文，最后才判断怎么回复。
