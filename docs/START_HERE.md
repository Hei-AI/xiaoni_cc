# Start Here

如果你是第一次接触这个仓库，先读这份入口。
目标不是一次读完全部文档，而是在 30 到 60 分钟内建立可工作的心智模型。

## First 5 Minutes
- 这是 QQ Bot 的主仓，但当前保留的是“运行底座 + 管理端”，不是完整旧业务全集。
- 默认先分清两条链：小腻行为链是 `NapCat -> provider-service -> agent-service -> provider-service -> NapCat`，管理端链是 `admin-frontend -> admin-backend -> provider-service / agent-service / PostgreSQL`。
- 管理端当前默认关注“小腻在做什么”：先看“小腻行动流”，再按需跳 raw trace、队列、流量或 Playground。
- 先信这些入口：`README.md`、`docs/INDEX.md`、`AGENTS.md`

## First 15 Minutes
- 想理解小腻当前运行链路，先看 `README.md` 的运行架构、`docs/XIAONI_AGENT_STACK_LEDGER.md`、`docs/XIAONI_NOTIFY_RUNTIME_ARCHITECTURE.md` 和 `docs/INDEX.md` 的最小下一跳；当前真相以 `modules/provider-service`、`modules/agent-service`、`packages/persistence` 和主 prompt 为准。
- 想排查小腻本地命令执行、长命令 session、git archive 或 Docker socket，直接看 `docs/AGENTS_XIAONI_EXECUTOR.md` 和 `modules/xiaoni-executor`。
- 想调管理端，先看 `modules/admin-panel/backend`、`modules/admin-panel/frontend`。
- 次级入口：`modules/http-traffic-monitor`、`modules/embedding-server`
- 当前运行数据库是 PostgreSQL
- 接任务前，先在 `docs/INDEX.md` 找对应专项文档，不要直接全仓漫游

## First 30 Minutes
- 看 `README.md`：确认部署方式、主栈服务、基本命令
- 看 `docs/INDEX.md`：按任务类型进入最少的专项文档
- 回到 `AGENTS.md`：确认仓库级约束和 `Done Means`

## Common Mistakes
- 不要因为 `agent-service` 在 compose 里，就把它当成管理端入口；它是 QQ 行为判断和后台 runtime 入口。
- 不要把 `exec_command` 误认为在 `agent-service` 本容器里直接执行；当前 compose 配置下它走独立的 `xiaoni-executor`。
- 不要把 provider 侧 participation 继续理解成完整“是否说话”的总决策器；它只保留硬边界和观测层。当前聊天对象 `is_enabled=0` 会硬拦截 `phone_notification` 入 Notify Bucket，`auto_reply_enabled` 只保留兼容/派生字段，主行为判断仍在 `agent-service` runtime。
- 不要再把旧的 conversation timeline、provider replay 或 `/api/runs` 当成当前调试主入口；现在看的是由 agent stack / tool / life facts 投影的小腻行动流。`agent_runs` 只作为内部 run / trace join key。
- 完成判定统一回到 `AGENTS.md` 的 `Done Means`，不要在这里脑补另一套交付标准。
- 不要把 `embedding-server` 当对外服务；对外是 `provider-service /v1/*`。
- 不要默认前端直连 `provider-service`；默认是前端 -> admin backend。
- 不要把 `agent_queue_messages` 当成 QQ 未读 inbox。它只是 Notify Bucket 的持久化门铃；被 pick 后即视为 consumed，QQ 正文在 `agent_inbound_messages`，只有模型主动用 `$qq-usage` 时才会通过 `agent-service /api/internal/qq-usage` 读取。
- 当前主发言判断在 `agent-service` loop。`topic projection`、`transcript snapshot`、三层长期记忆等能力可以作为 typed recall projection、观测、评测或异步产物存在，但不要把它们当成入口层“是否说话”的总决策器。
- 不要把空闲行为做成第二套 planner、presence runner、硬编码兴趣表，或靠 fake `consciousness_tick` / `presence_tick` 敲钟。当前目标只有一条连续主 runtime stream：QQ 消息变成 `phone_notification` 当前感官输入；模型 response、tool result、真实 QQ 正文、状态和记忆进入追加式 agent stack；`final_answer` 不是终止条件，也不产生专用 prompt reminder。是否打开 QQ、是否发言、是否继续做别的，都由同一条 loop 自己决定。完整契约看 `docs/XIAONI_AGENT_STACK_LEDGER.md` 和 `docs/remind.md`。
- 不要把“本地前端联调”和“公网 Docker 前端”当成同一条链路；本地页面调试只起本地 Vite 前端，后端仍走容器。
- 不要再让本地前端复用 `3003`；本地联调固定走 `13003`，公网 Docker 前端继续占用 `3003`。
- 不要再参考 `database/` 里的历史 MySQL 文档；当前真实数据库以 PostgreSQL 初始化脚本和 `packages/persistence` 为准。
- 不要把聊天记录、口头说明当文档真相；仓库内 markdown 才是可追溯来源。
