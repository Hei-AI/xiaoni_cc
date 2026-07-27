# Xiaoni Runtime Surfaces

本文是小腻当前运行面的参考页。它不替代主 loop 架构；主 loop、request assembly、
stack ledger 和 trace detail 仍以 `docs/XIAONI_AGENT_STACK_LEDGER.md` 为准。
实际操作步骤见 `docs/XIAONI_OPERATOR_HOWTO.md`。

## Public Operator Surfaces

| Surface | Current source | What it means |
| --- | --- | --- |
| Admin 小腻活动 / action stream | `packages/persistence/xiaoni-activity.js` + admin routes | 从 `agent_stack_items`、`llm_request_slices`、`tool_executions`、life/media/task 和 fork facts 投影当前行动、工具、模型 slice、可见投递、图片观察和 runtime busy flags。 |
| 被动浮现 Shadow（passive recall） | `packages/persistence/xiaoni-passive-recall-extractor.js` + `GET /api/xiaoni/passive-recall/shadow-cues` | 只读查看被动召回 extractor 的原始触发点和 runtime 文件候选，`deliveryMode: "shadow_only"`，不投递给主 agent、不写 Notify Bucket。边界事实源是 `docs/XIAONI_PASSIVE_RECALL_EXTRACTOR.md`。 |
| Raw Trace | `llm_request_slices` and fork slice tables | 展示对应 stack item / tool execution / LLM slice 的 canonical request、wire request/response 和 raw response。provider span 是证据，不是主行动卡。 |
| LLM usage observatory | `getXiaoniLlmUsageTimeline()` | 合并 main slices、core-memory compression fork、image vision fork 和 Codex provider image usage；支持 call/hour/day/month bucket、自动下采样和 search overlay。 |
| Recovery page | `agent_recovery_sessions` + `agent_session_life_states` | 展示当前精力投影、recover_energy 会话、clock、醒来原因和 wake count。 |
| Runtime settings | `agent_runtime_control` + admin runtime settings page | 控制主 loop enable、主模型 slice 前 yield、睡眠 cache heartbeat 暂停和压缩后暂停闸门；空转治理两开关 `fork_idle_escalation_enabled` / `plan_void_on_idle_enabled`（2026-07-27 起默认 ON，热下发，见 `docs/XIAONI_AGENT_STACK_LEDGER.md` 空转治理闭环）；并提供 provider outage 后的「手动恢复」按钮，经 `POST /api/agent-runtime/recover-now` 注入一条合成 `phone_notification` 唤醒 runtime。 |
| QQ unread navigation | `$qq-usage` skill + `agent_inbound_messages` | 小腻主动打开 QQ inbox/window。`agent_queue_messages` 只是 Notify Bucket，不是 QQ app 未读列表。 |
| QQ image send | `$qq-send-image` + `agent-service /api/internal/qq-send-image` | 将 `/xiaoni-runtime` 下已有图片经 `provider-service -> NapCat` 发到群或私聊，并保留 status key 供补查。 |
| Local image visibility | `$local-image-visibility` | 本地 PNG 已存在但没有可 inspect 的 image id 时，生成尺寸/缩略图/粗略颜色与 ascii 报告，必要时用可见浏览器打开小缩略图。 |
| Xiaoni browser | `$xiaoni-browser` + host Playwright CLI bridge | 控制宿主机可见 Chrome 做页面检查、截图、console/network 调试和登录态网页操作。 |
| Xiaoni public site | `$xiaoni-site` + `$site-publish-check` | 管理 `https://xiaoni.liahuas.top` 的静态发布目录和上线前检查。 |
| Forever archive | `$forever-archive` | 把值得保留的页面、文章、图片或玩具先复制到 `/xiaoni-runtime/forever/...`，避免把 `dist` 当成记忆源。 |
| QQ long-share prep | `$qq-share-splitter` | 把长笔记或 Markdown 草稿拆成 QQ 里能读的短消息，或改成短 teaser + 站点链接。 |

## Xiaoni Local Skills

这些 skill 是小腻通过 `exec_command` 自己读取和调用的本地手册，位置在
`modules/agent-service/skills`。

| Skill | Use when | Key boundary |
| --- | --- | --- |
| `$qq-usage` | 打开或搜索 QQ thread list、聚焦私聊/群聊、翻页、跳到最新、清角标、设置群通知模式或聚合延迟。 | 只读/导航 QQ，不发消息；使用 QQ id 或 group id，不传内部 `session_key`。 |
| `$qq-send-image` | 已有 `/xiaoni-runtime` 下本地图片，需要发到群或私聊。 | 只发送本地图片；不生成、不识图、不导航 QQ。 |
| `$local-image-visibility` | `/xiaoni-runtime/picture` 下有 PNG，但 `inspect_image_placeholder` 看不到或没有 image id。 | 只能做文件存在、尺寸、缩略图和粗略颜色/ascii 检查；不能替代语义视觉。 |
| `$executor-container` | 准备用 `exec_command` 保存文件或确认持久化路径。 | 长期数据只放 `/xiaoni-runtime` 或 `/workspace/qq_bot` / `/app`。 |
| `$xiaoni-browser` | 控制宿主机可见 Chrome 做网页浏览、截图、交互、网络/console 检查。 | 走 host bridge 和 patched Playwright Extension；`ensure-extension --restart` 会重启可见 Chrome，需谨慎。 |
| `$xiaoni-site` | 构建、运行或调试 `https://xiaoni.liahuas.top`。 | 公网页面由 executor 内 `0.0.0.0:3458` 提供，不指向 executor API `8093`。 |
| `$site-publish-check` | 发布或修改 `xiaoni.liahuas.top` 页面后做上线前检查。 | 校验 dist 文件、公开 URL、首页链接、私有路径泄漏和同站资源 200。 |
| `$forever-archive` | 页面、文章、图片或玩具值得长期保留，尤其是发布前后。 | `dist` 是展示输出，不是记忆源；归档副本落 `/xiaoni-runtime/forever/...`。 |
| `$qq-share-splitter` | 要把长笔记、阅读摘要或 Markdown 草稿发到 QQ。 | 只做分段辅助，不替代社交改写；长内容优先发站点链接 teaser。 |
| `$skill-creator` | 现有 skill 不够用，需要小腻自己创建本地能力。 | 新 skill 必须声明 `## Runtime Cost` 和有限数值 `energy_cost`。 |

`docs/xiaoni_prompt/skills_instructions.md` 只给模型常驻最小手册和探索方法；完整细节以各
`SKILL.md` 为准。

## Prompt-Facing Templates

模板正文只维护在 `docs/xiaoni_prompt/`，索引和装配规则看 `docs/remind.md`。

| Template family | Current behavior |
| --- | --- |
| QQ/attention | `phone_notification` 只表示状态栏未读短摘要；完整正文必须通过 `$qq-usage` 主动打开。群聊 `mentions_only` 模式下普通群消息只进 inbox，不敲状态栏；`set_group_notification_delay` 可以把普通群消息聚合成一条延迟提醒，群 @ 仍立即提醒。`attention_lease` 是短期余光提醒，不续期所有 inbox。 |
| Self continuation | 只有 no-notify 且候选 requestInput 尾项仍是 `assistant final_answer` 时追加；不是 queue trigger。 |
| Image tasks | `image_task_pending` 防止盲猜成品路径；`image_task_notification` 只在任务完成后提供 task id、图片 id/path 和目标说明。 |
| Recovery | 模型主动 `recover_energy` 的成功、被打断、clock、clock deferred 和拒绝都作为同一个 tool call 的 callback；强制休息醒来走 runtime input。 |
| Core memory pressure | 后台 compression fork 的当前输入；工程用 `allowed_tools` 限制为 `exec_command` + `compress_core_memory`。 |

## Data Ownership

- PostgreSQL 共享读写统一走 `packages/persistence`。新表先加 Prisma schema 和 persistence helper，再由服务层调用。
- `agent_stack_items` 是主可回放 stack；`llm_request_slices` 是完整 provider evidence；
  `tool_executions` 是工具调用和 callback 事实；`agent_life_events` 和
  `agent_session_life_states` 是 life projection 事实。
- `core_memory_compression_fork_*` 和 `image_vision_fork_*` 只记录 fork 自身，不改写主 loop
  的 stack 边界。
- 所有结构化时间写入使用 `TIMESTAMPTZ(3)` Instant；API 输出和小腻上下文必须复用
  `packages/persistence/time.js` 的东八区 timestamp helper。

## Verification

文档或代码触碰这些 surface 后，先用 `docs/XIAONI_OPERATOR_HOWTO.md` 的步骤确认用户入口；
再按变更范围至少跑：

```bash
npm --prefix modules/agent-service test
npm --prefix modules/admin-panel/backend test
node --test packages/persistence/__tests__/*.test.js
git diff --check
```

如果改了 compose 托管服务，完成定义仍回到 `AGENTS.md` 的 `Done Means`。
