# Xiaoni Notify Runtime Architecture

这份文档说明小腻当前 runtime loop、Notify Bucket、QQ inbox 和工程工具之间的边界。它是 `docs/xiaoni-notify-runtime-*` 图资产的读图说明；如果图和本文冲突，以本文和活跃代码为准，并同步更新图源。

## 图资产

| 文件 | 用途 |
| --- | --- |
| `docs/xiaoni-notify-runtime-activity.svg` | 主活动图，强调唯一 Notify Bucket 和小腻主 loop 的 pick 点。 |
| `docs/xiaoni-notify-runtime-activity.mmd` | 活动图 Mermaid 语义源，不要求逐像素等同 SVG。 |
| `docs/xiaoni-notify-runtime-activity.puml` | 活动图 PlantUML 备选源。 |
| `docs/xiaoni-notify-runtime-component.svg` | PlantUML 渲染的组件图，强调服务、队列、LLM provider 和工具边界。 |
| `docs/xiaoni-notify-runtime-component.mmd` | 组件图 Mermaid 语义源。 |
| `docs/xiaoni-notify-runtime-component.puml` | 组件图 PlantUML 渲染源。 |
| `docs/mermaid-puppeteer.json` | Mermaid 导出 SVG 时使用的 Puppeteer 配置。 |

## 当前契约

`Notify Bucket` 是概念桶，不是一张新的业务表。当前持久化承载是 `agent_queue_messages`，收口在 `packages/persistence/agent-queue.js`。它只表示“门铃等待被 pick”，不表示小腻正在被这条通知长期占用。所有来源只能写入这个桶，只有 `agent-service` 主 loop 消费它。

QQ 正文不在 Notify Bucket。QQ 入站正文存在 `agent_inbound_messages`，收口在 `packages/persistence/inbound-inbox.js` 和 `packages/persistence/qq-usage.js`。小腻只有在模型主动选择 `$qq-usage` 时，才通过 `agent-service /api/internal/qq-usage` 读取 inbox/window。

聊天对象的 `auto_reply_enabled` 是 provider-service 侧硬边界。`auto_reply_enabled=false` 时，QQ 正文仍写入 `agent_inbound_messages`，但不写 `phone_notification` 到 Notify Bucket，也就不会因为这条 QQ 消息唤醒主 loop。

主 loop 由 `agent-service` 承载。一次 slice 的主链路是：

```text
loop tick
  -> build prompt
  -> build dev
  -> append history / replay items
  -> pick Notify Bucket event if available
  -> mark queue row consumed; run owns subsequent continuation
  -> combined finish
  -> POST provider-service /api/internal/agent/execute
  -> provider-service codex-provider / OpenAI
  -> parse assistant response / tool_call / final_answer
  -> Step 8 ResponseActionRouter
  -> ToolDispatcher / post action
  -> save transcript / replay / trace
  -> next loop
```

## 写入 Notify Bucket

| 来源 | 写入内容 | 当前代码入口 |
| --- | --- | --- |
| NapCat QQ message | `auto_reply_enabled=true` 时写 `phone_notification`，只含通知摘要，不含 QQ 正文。 | `modules/provider-service/src/services/inbound-agent-trigger-service.ts` |
| self continuation | `self_continuation`，空闲且未休息时维持连续主 loop。 | `modules/agent-service/src/services/runtime-store.ts` |
| image task completion | `image_task_completed` completion notify，下一轮仍由主 loop pick。 | `modules/agent-service/src/services/agent-task-worker-service.ts` |
| future presence / system reminder | 仍应写同一个 bucket。 | `packages/persistence/agent-queue.js` |

写入方不直接塞 prompt，也不直接改小腻当前认知。它们只把事件放进同一个 bucket，等待主 loop 在后续 slice 里 pick。事件一旦被 pick，就从 `pending` 变成 `consumed`：门铃已经进入上下文，后续模型切片不再从 Notify Bucket 重新 pick 或重新渲染这条事件为当前输入。

## QQ Inbox

QQ 入站链路分成两步：

```text
NapCat
  -> provider-service normalize inbound
  -> persist QQ body into agent_inbound_messages
  -> if auto_reply_enabled=true: enqueue phone_notification into Notify Bucket
  -> if auto_reply_enabled=false: timeline skip, no Notify Bucket row
```

`agent_inbound_messages` 是 QQ app 的正文 inbox/window。`phone_notification` 是状态栏通知。小腻看到通知，不等于已经打开 QQ 正文。

`$qq-usage` 当前走：

```text
exec_command runs qq-usage script
  -> agent-service /api/internal/qq-usage
  -> RuntimeStore
  -> packages/persistence/qq-usage.js
  -> agent_inbound_messages
```

这条链路不是 provider-service API。provider-service 负责写入 inbox 和 QQ 出站，agent-service 负责把 `$qq-usage` 作为小腻动作执行并记录 visit/seen life events。

## 模型请求与响应

Step 7 的模型请求不是 agent-service 直连 OpenAI。当前链路是：

```text
agent-service
  -> provider-service /api/internal/agent/execute
  -> codex-provider
  -> OpenAI
  -> codex-provider parse response
  -> agent-service action dispatch
```

`final_answer` / `tool_call` / assistant message 都是模型响应内容。响应解析后由 `agent-service` 决定后续动作。历史 transcript 仍保持原始 phase：存下来的 `commentary` / `final_answer` 怎么样，回放和渲染就怎么样。

`final_answer` 当前有一条代码侧消费策略：

```text
canonical_response
  -> final_answer
  -> no tool_call and no visible delivery
  -> settle / release lease_release_reason=no_visible_delivery_observed
  -> later idle work uses the normal self_continuation path
```

当前 active loop 不再追加 `final_answer_turn_control` user scene input，也不再通过 `ResponseActionRouter` 写 `final_answer_idle` system reminder。历史 `reason=final_answer_idle` queue row 如果仍存在，只按普通内部 `system_reminder` 兼容读取，不作为新的 prompt-facing 契约。

## 动作分发

| 模型选择 | 当前执行路径 | 结果如何回到 loop |
| --- | --- | --- |
| `$qq-usage` | `exec_command` 运行本地 skill 脚本，脚本调 `agent-service /api/internal/qq-usage`。 | tool output 追加进后续 request，并记录 surface visit/seen。 |
| QQ reply | `agent-service -> provider-service -> NapCat`。 | delivery state、trace、conversation item 写回持久层。 |
| `exec_command` | `agent-service -> xiaoni-executor`。 | stdout/stderr/session result 作为 tool output 进入后续 request。 |
| `inspect_image_placeholder` | `agent-service` 复用当前主 agent request 发起 image vision fork；图片 base64 只进入 no-persist fork。 | 返回 `<image id="...">含义是: ...</image>`，该文本作为工具结果进入后续 request。 |
| image/provider task | `agent-service` 发起 task；完成后 task worker 存图并 enqueue completion notify。 | completion 回写 Notify Bucket，下一轮仍由 Step 5 pick。 |
| `final_answer` | 无外部工具分发；如果没有可见 delivery，代码侧以 `no_visible_delivery_observed` settle / release。 | transcript / replay 仍按原始 phase 保存；不会追加 prompt-facing follow-up reminder。 |
| message / silent | 无外部工具分发。 | 只保存 transcript / replay / trace；如果继续切片，原始 Notify 不会重新作为当前输入。 |

## 图片理解 Fork

`inspect_image_placeholder` 不是 provider-service 里的无上下文图片摘要器。当前实现要求小腻在自己的完整主 agent 上下文中看图：

```text
main agent request
  -> clone canonical request
  -> append assistant output_text: 让我来看看这个图是啥意思
  -> append function_call inspect_image_placeholder(image_id)
  -> append function_call_output.output=[input_image data URL]
  -> call provider-service /api/internal/llm/debug
       executionMode=image_vision_fork_no_persist
       x-qqbot-no-traffic-persist: 1
  -> record media observation
  -> return <image id="...">含义是: ...</image>
```

主 loop 不保留图片 base64。后续上下文只继承图片观察文本；如果需要重新看同一张图，再按稳定图片 id 重新调用 `inspect_image_placeholder`。

## 持久化边界

这些共享表和行为必须收口到 `packages/persistence`：

| 领域 | 当前持久层文件 |
| --- | --- |
| Notify Bucket / `agent_queue_messages` | `packages/persistence/agent-queue.js` |
| QQ inbox / `agent_inbound_messages` | `packages/persistence/inbound-inbox.js` |
| `$qq-usage` projection | `packages/persistence/qq-usage.js` |
| runtime / conversation / transcript / LLM call logs | `packages/persistence/agent-runtime.js` |

provider-service 和 agent-service 里的 store/service 类只能做适配和编排，不应散落共享表 SQL。

## 排障入口

- QQ 入站正文是否落库：看 `agent_inbound_messages` 和 provider-service 入站日志。
- Notify Bucket 是否写入：看 `agent_queue_messages` 的 `source`、`dedupe_key`、`status`、`available_at`。
- `auto_reply_enabled=0` 是否生效：看 provider-service timeline 的 `phone_notification/enqueue` 是否为 `eventPhase=skip`、`reason=auto_reply_disabled`，并确认 `agent_queue_messages` 没有对应 pending `phone_notification`。
- 主 loop 是否消费：看 agent-service worker 日志、`agent_queue_messages` lease 字段和 action stream trace。
- `$qq-usage` 看不到内容：先查 `agent-service /api/internal/qq-usage`，再查 `packages/persistence/qq-usage.js` 查询条件。
- 图片理解上下文或 base64 膨胀异常：查 `inspect_image_placeholder` 的 `image_vision_fork_no_persist` 请求、`agent_media_assets` 观察记录和 `<image id="...">` tool output；不要把 traffic / replay 里的 base64 当作正常长期产物。
- 模型请求或 provider 响应异常：查 provider-service `/api/internal/agent/execute`、codex-provider trace 和 `xiaoni_replay_events`。
- `exec_command` 异常：查 `xiaoni-executor` `/api/internal/exec-command`、session state 和审计日志。
