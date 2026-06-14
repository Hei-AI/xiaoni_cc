# Xiaoni Runtime Surfaces

本文是小腻当前运行面的参考页。它不替代主 loop 架构；主 loop、request assembly、
stack ledger 和 trace detail 仍以 `docs/XIAONI_AGENT_STACK_LEDGER.md` 为准。
实际操作步骤见 `docs/XIAONI_OPERATOR_HOWTO.md`。

## Public Operator Surfaces

| Surface | Current source | What it means |
| --- | --- | --- |
| Admin 小腻活动 / action stream | `packages/persistence/xiaoni-activity.js` + admin routes | 从 `agent_stack_items`、`llm_request_slices`、`tool_executions`、life/media/task 和 fork facts 投影当前行动、工具、模型 slice、可见投递、图片观察和 runtime busy flags。 |
| Raw Trace | `llm_request_slices` and fork slice tables | 展示对应 stack item / tool execution / LLM slice 的 canonical request、wire request/response 和 raw response。provider span 是证据，不是主行动卡。 |
| LLM usage observatory | `getXiaoniLlmUsageTimeline()` | 合并 main slices、core-memory compression fork、image vision fork 和 Codex provider image usage；支持 call/hour/day/month bucket、自动下采样和 search overlay。 |
| Recovery page | `agent_recovery_sessions` + `agent_session_life_states` | 展示当前精力投影、recover_energy 会话、clock、醒来原因和 wake count。 |
| QQ unread navigation | `$qq-usage` skill + `agent_inbound_messages` | 小腻主动打开 QQ inbox/window。`agent_queue_messages` 只是 Notify Bucket，不是 QQ app 未读列表。 |
| QQ image send | `$qq-send-image` + `agent-service /api/internal/qq-send-image` | 将 `/xiaoni-runtime` 下已有图片经 `provider-service -> NapCat` 发到群或私聊，并保留 status key 供补查。 |
| Xiaoni browser | `$xiaoni-browser` + host Playwright CLI bridge | 控制宿主机可见 Chrome 做页面检查、截图、console/network 调试和登录态网页操作。 |
| Xiaoni public site | `$xiaoni-site` + `$site-publish-check` | 管理 `https://xiaoni.liahuas.top` 的静态发布目录和上线前检查。 |

## Xiaoni Local Skills

这些 skill 是小腻通过 `exec_command` 自己读取和调用的本地手册，位置在
`modules/agent-service/skills`。

| Skill | Use when | Key boundary |
| --- | --- | --- |
| `$qq-usage` | 打开 QQ thread list、聚焦私聊/群聊、翻页、跳到最新、清角标。 | 只读/导航 QQ，不发消息；使用 QQ id 或 group id，不传内部 `session_key`。 |
| `$qq-send-image` | 已有 `/xiaoni-runtime` 下本地图片，需要发到群或私聊。 | 只发送本地图片；不生成、不识图、不导航 QQ。 |
| `$executor-container` | 准备用 `exec_command` 保存文件或确认持久化路径。 | 长期数据只放 `/xiaoni-runtime` 或 `/workspace/qq_bot` / `/app`。 |
| `$xiaoni-browser` | 控制宿主机可见 Chrome 做网页浏览、截图、交互、网络/console 检查。 | 走 host bridge 和 patched Playwright Extension；`ensure-extension --restart` 会重启可见 Chrome，需谨慎。 |
| `$xiaoni-site` | 构建、运行或调试 `https://xiaoni.liahuas.top`。 | 公网页面由 executor 内 `0.0.0.0:3458` 提供，不指向 executor API `8093`。 |
| `$site-publish-check` | 发布或修改 `xiaoni.liahuas.top` 页面后做上线前检查。 | 校验 dist 文件、公开 URL、首页链接、私有路径泄漏和同站资源 200。 |
| `$skill-creator` | 现有 skill 不够用，需要小腻自己创建本地能力。 | 新 skill 必须声明 `## Runtime Cost` 和有限数值 `energy_cost`。 |

`docs/xiaoni_prompt/skills_instructions.md` 只给模型常驻最小手册和探索方法；完整细节以各
`SKILL.md` 为准。

## Prompt-Facing Templates

模板正文只维护在 `docs/xiaoni_prompt/`，索引和装配规则看 `docs/remind.md`。

| Template family | Current behavior |
| --- | --- |
| QQ/attention | `phone_notification` 只表示状态栏未读摘要；正文必须通过 `$qq-usage` 主动打开。`attention_lease` 是短期余光提醒，不续期所有 inbox。 |
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
