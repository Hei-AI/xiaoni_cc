# Xiaoni Runtime Guards And Media

本文档记录小腻主 runtime 里三类容易混淆的边界：QQ IM 入口开关、
`final_answer` 后续推进、图片理解 fork。它是当前代码契约的说明页，不记录
旧方案。

## Reference

| 领域 | 当前契约 | 代码入口 |
| --- | --- | --- |
| QQ 入站正文 | 始终先落 `agent_inbound_messages`，作为 QQ app inbox/window。 | `modules/provider-service/src/services/inbound-inbox-service.ts` |
| IM 入口 `is_enabled` | 为 `false` 时硬拦截 `phone_notification` 入 Notify Bucket；不代表删除 inbox 正文。`auto_reply_enabled` 只保留为兼容/派生字段。 | `modules/provider-service/src/services/inbound-agent-trigger-service.ts` |
| `phone_notification` | 只含状态栏摘要，不含 QQ 正文；小腻必须主动用 `$qq-usage` 才能看到正文。 | `modules/provider-service/src/services/inbound-agent-trigger-service.ts` |
| `final_answer` continuous loop | 模型返回 `final_answer` 且无 tool call 时，只表示本轮没有更多工具；不产生 final-answer 专用 prompt reminder，但同一连续 loop 的下一片必须追加普通 `self_continuation` developer reminder。 | `modules/agent-service/src/services/agent-loop-service.ts` |
| 图片理解 | `inspect_image_placeholder` 复用当前主 agent request，追加图片 base64 fork，返回文本观察。 | `modules/agent-service/src/services/agent-loop-service.ts` |
| 图片观察输出 | 主 agent 只收到 `<image id="...">含义是: ...</image>`；base64 不进入长期 replay。 | `modules/agent-service/src/services/agent-loop-service.ts` |

## IM Entry Hard Gate

QQ 入站链路分两层：

```text
NapCat
  -> provider-service normalize inbound
  -> write body into agent_inbound_messages
  -> check chat policy
  -> if is_enabled=true: enqueue phone_notification
  -> if is_enabled=false: skip phone_notification enqueue
```

`is_enabled=0` 是当前聊天对象的 IM 入口硬边界。它不影响消息落 inbox，也不
删除后续人工排障可见性；它只阻止主 loop 被这条 QQ 消息唤醒。`auto_reply_enabled`
不再作为独立可配置投递开关，只作为兼容/派生字段随 IM 入口同步。

排障时看三处：

1. `agent_inbound_messages` 是否有正文。
2. timeline 的 `phone_notification/routing` 是否为 `decision=skip`、
   `reason=auto_reply_disabled`；这里的 reason 是历史兼容命名，当前值由
   IM 入口 `is_enabled` 派生。
3. `agent_queue_messages` 是否没有对应 `phone_notification` pending row。

`agent_runtime_control.enabled=false` 是全局 runtime loop 暂停；它和
`is_enabled=0` 是两层不同开关。前者让 agent-service 不跑主 loop，
后者让 provider-service 不把某个聊天的新消息写入 Notify Bucket。

## Final Answer Continuation

`final_answer` 不等于“agent loop 结束”。当前目标策略是把它当作本轮模型输出，
按原始 phase 追加进 stack，然后让外层 loop 继续：

```text
OpenAI response phase=final_answer
  -> provider-service returns canonical response
  -> agent-service sees no tool_call
  -> append response output items into agent_stack_items
  -> do not append final-answer-specific reminder
  -> append normal self_continuation developer reminder before the next model slice
```

这不改写上一轮 transcript，也不把 `final_answer` phase 改成 `commentary`。
当前 runtime 不再追加 final-answer 专用 prompt reminder；连续 loop 只追加普通 `self_continuation` 模板。历史同类 Notify Bucket
行如果仍存在，也不再作为 prompt-facing `system_reminder` 渲染。

## Image Vision Fork

图片理解的目标有两个：

- 小腻必须在自己的完整上下文里理解图片，而不是交给一个无上下文图片摘要器。
- 图片 base64 只能短暂进入视觉 fork，不要反复占据主 loop replay 和 traffic
  持久化空间。

当前流程：

```text
main agent calls inspect_image_placeholder(image_id)
  -> agent-service resolves agent_media_assets by stable image id
  -> materialize image into data URL
  -> clone current CanonicalAgentTurnRequest
  -> append assistant message: 让我来看看这个图是啥意思
  -> append function_call inspect_image_placeholder
  -> append function_call_output.output=[{type: input_image, image_url: data URL}]
  -> POST provider-service /api/internal/llm/debug
       x-qqbot-no-traffic-persist: 1
       executionMode=image_vision_fork_no_persist
  -> record media observation text
  -> return <image id="...">含义是: ...</image>
```

图片 id 使用真实 `agent_media_assets.id`。不要生成 `image_1` 这类临时编号作为
主契约；临时 placeholder 只能作为兼容线索。

## Replay And Persistence

视觉 fork 请求里的 base64 不应该进入下面这些长期表或管理端回放骨架：

- `llm_request_slices`
- traffic / MITM 持久化日志
- 后续主 loop 的 `agent_stack_items` 可回放 image payload

主 loop 可继承的是图片观察文本：

```xml
<image id="...">含义是: ...</image>
```

如果之后需要重新看同一张图，模型应再次调用 `inspect_image_placeholder`，由
runtime 重新 materialize 图片并发起新的 no-persist vision fork。

## OpenAI Request Boundary

OpenAI 官方 vision 示例展示 `input_image` 放在 `user` message 的 content 数组
里。当前仓库的 image vision fork 不是要声明一个新的上游通用格式，而是复用
Codex-style tool output replay：把图片作为 `function_call_output.output` 数组
交回给同一次 fork request。Provider helper 必须保留这个数组，不能把它转成
字符串或丢掉 `input_image`。

## Verification

改动这些路径后，至少跑：

```bash
npm --prefix modules/agent-service test
npm --prefix modules/provider-service test
npm --prefix packages/persistence test
```

如果改到 compose 托管服务，按 `AGENTS.md` 的 `Done Means` 重新 build / up
对应服务，并检查健康状态。
