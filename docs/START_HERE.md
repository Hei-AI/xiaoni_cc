# Start Here

如果你是第一次接触这个仓库，先读这份入口。
目标不是一次读完全部文档，而是在 30 到 60 分钟内建立可工作的心智模型。

## First 5 Minutes
- 这是 QQ Bot 的主仓，但当前保留的是“运行底座 + 管理端”，不是完整旧业务全集。
- 默认先记住主链路：`NapCat -> provider-service -> admin-backend -> admin-frontend`
- 先信这些入口：`README.md`、`docs/INDEX.md`、`AGENTS.md`

## First 15 Minutes
- 主入口只看四处：`modules/provider-service`、`modules/admin-panel/backend`、`modules/admin-panel/frontend`、`packages/persistence`
- 次级入口：`modules/agent-service`、`modules/http-traffic-monitor`、`modules/embedding-server`
- 当前运行数据库是 PostgreSQL
- 接任务前，先在 `docs/INDEX.md` 找对应专项文档，不要直接全仓漫游

## First 30 Minutes
- 看 `README.md`：确认部署方式、主栈服务、基本命令
- 看 `docs/INDEX.md`：按任务类型进入最少的专项文档
- 回到 `AGENTS.md`：确认仓库级约束和 `Done Means`

## Common Mistakes
- 不要因为 `agent-service` 在 compose 里，就误以为它是管理端主链路入口。
- 不要把 provider 侧 participation 继续理解成完整“是否说话”的总决策器；当前它更像硬边界和观测层，主行为判断在 `agent-service` runtime。
- 不要再把旧的 conversation timeline 当成当前调试主入口；现在看的是 agent run workspace。
- 完成判定统一回到 `AGENTS.md` 的 `Done Means`，不要在这里脑补另一套交付标准。
- 不要把 `embedding-server` 当对外服务；对外是 `provider-service /v1/*`。
- 不要默认前端直连 `provider-service`；默认是前端 -> admin backend。
- 不要以为 memory 已经退出运行链路；`relationship memory`、`self evolution`、`topic projection`、`transcript snapshot` 还在，只是不是新人理解主链时的第一站。
- 不要把“本地前端联调”和“公网 Docker 前端”当成同一条链路；本地页面调试只起本地 Vite 前端，后端仍走容器。
- 不要再让本地前端复用 `3003`；本地联调固定走 `13003`，公网 Docker 前端继续占用 `3003`。
- 不要再参考 `database/` 里的历史 MySQL 文档；当前真实数据库以 PostgreSQL 初始化脚本和 `packages/persistence` 为准。
- 不要把聊天记录、口头说明当文档真相；仓库内 markdown 才是可追溯来源。
