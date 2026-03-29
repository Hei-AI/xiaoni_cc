# Start Here

如果你是第一次接触这个仓库，按下面顺序阅读。
目标不是一次读完全部文档，而是在 30 到 60 分钟内建立可工作的心智模型。

## 5 分钟版本
先理解三件事：

1. 这是一个什么仓库
- 这是 QQ Bot 的主仓，但当前保留的是“运行底座 + 管理端”，不是完整旧业务全集。

2. 主链路是什么
- 默认先记住这条链路：
  - `NapCat -> provider-service -> admin-backend -> admin-frontend`

3. 哪些目录值得信任
- 先看这些：
  - `README.md`
  - `docs/INDEX.md`

## 15 分钟版本
接着理解“什么是主入口，什么是辅助组件”。

### 主入口
- `modules/provider-service`
  - 外部能力接入层
  - 承接 provider debug、embeddings、NapCat 发消息、消息模拟、简单队列
- `modules/admin-panel/backend`
  - 运营 API
  - 为前端提供 conversations、queue、prompt、playground、traffic replay 等能力
- `modules/admin-panel/frontend`
  - 管理端 UI
  - 默认只调用 `admin-panel/backend`

### 辅助组件
- `postgres`
  - 当前运行数据库
- `modules/agent-service`
  - 队列 worker / agent loop 服务
  - 它在 compose 中运行，但不是新人理解系统时的第一个入口
- `modules/http-traffic-monitor`
  - 运维观测工具链，不是独立产品服务
- `modules/embedding-server`
  - `provider-service` 背后的 embedding 运行时实现细节，不是公共 API 面

## 30 分钟版本
读完这些后，你应该能开始接任务：

1. `README.md`
- 看部署方式、主栈服务、基本命令

2. `docs/INDEX.md`
- 根据任务类型进入对应专项文档

## 新人最容易踩的坑
- 不要因为 `agent-service` 在 compose 里，就误以为它是管理端主链路入口。
- 完成判定统一回到 `AGENTS.md` 的 `Done Means`，不要在这里脑补另一套交付标准。
- 不要把 `embedding-server` 当对外服务；对外是 `provider-service /v1/*`。
- 不要默认前端直连 `provider-service`；默认是前端 -> admin backend。
- 不要把“本地前端联调”和“公网 Docker 前端”当成同一条链路；本地页面调试只起本地 Vite 前端，后端仍走容器。
- 不要再让本地前端复用 `3003`；本地联调固定走 `13003`，公网 Docker 前端继续占用 `3003`。
- 不要把聊天记录、口头说明当文档真相；仓库内 markdown 才是可追溯来源。
