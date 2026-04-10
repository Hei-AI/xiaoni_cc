# QQ Bot

基于 OneBot 11 的 QQ 机器人主仓。

当前主仓保留运行底座和管理端：

- `provider-service`: NapCat / OneBot 入口、LLM provider 执行、消息模拟、embeddings、queue 入口、transcript / relationship / self / topic side effect 调度
- `agent-service`: 主 agent loop runtime，消费 queue batch、重建上下文、执行 agent run，并控制 delivery state
- `admin-panel/backend`: 运营 API、Prompt 配置、队列管理、run workspace、流量查看/回放、relationship memory / topic lab 观测
- `admin-panel/frontend`: 管理界面
- `postgres`: 数据存储
- `docker-compose.napcat.yml`: NapCat 独立部署入口

## 目录

```text
.
├── docker-compose.yml
├── docker-compose.napcat.yml
├── database/
├── docs/
├── modules/
│   ├── admin-panel/
│   ├── agent-service/
│   ├── embedding-server/
│   ├── http-traffic-monitor/
│   └── provider-service/
├── packages/
├── resource/
└── scripts/
```

## 运行架构

主链：

```text
NapCat -> provider-service
                      \
                       -> agent-service
                       -> admin-backend -> admin-frontend
                       -> PostgreSQL (via admin / business data)
```

说明：

- NapCat 独立部署，不包含在主业务 compose 中。
- 管理端默认链路是前端 -> `admin-panel/backend`。
- `provider-service` 当前不仅负责 provider debug，也负责 OneBot 入站、queue 写入、timeline 记录，以及 transcript snapshot、relationship memory、self evolution、topic projection 等 side effect 调度。
- `agent-service` 负责消费消息批次、执行 loop agent，并把 run / trace / transcript / delivery state 写回 PostgreSQL。
- provider 侧的 participation 现在保留为硬安全边界和观测事件，主行为判断逐步收口到 `agent-service` runtime。
- HTTP 流量监控/回放属于管理端运维工具链。

## 快速开始

### 1. 创建网络

```bash
docker network create qq_bot_network
```

### 2. 启动 NapCat

```bash
mkdir -p resource/napcat_config resource/napcat_qq_data logs/napcat
docker compose -f docker-compose.napcat.yml up -d
```

### 3. 启动主栈

```bash
docker compose build
docker compose up -d
docker compose ps
```

默认服务：

- Admin Frontend: `http://localhost:3003`
- Admin Backend: `http://localhost:9080/api/health`
- Provider Service: `http://localhost:8091/health`

## 调试能力

保留的调试面：

- `provider-service` 健康检查、消息模拟、LLM 调试、简单队列接口、embeddings、transcript / memory side effect 调试入口
- Admin agent run workspace、会话明细、participation events、relationship memory、topic lab、runtime status
- Admin Queue Management
- Prompt 管理 / 编辑 / 调试
- Playground case library、Trace / Conversation 导入、Provider 请求 payload 查看
- HTTP 流量查看与回放

## 常用命令

```bash
docker compose logs -f qqbot-provider-service
docker compose logs -f qqbot-agent-service
docker compose logs -f qqbot-admin-backend
docker exec -it qqbot-provider-service /bin/sh
python3 scripts/start_modules.py start
python3 scripts/start_modules.py status
```

## 部署约定

这里有两条不同链路，必须区分：

- 本地开发链路：`npm run deploy:local`
  - 只用于本地前端联调，不会更新或中断公网管理端
  - 具体端口、访问地址和本机规则以 `docs/AGENTS_FRONTEND.md`、`docs/AGENTS_SECRETS_LOCAL_STATE.md` 为准

- 公网管理端链路：`npm run deploy`
  - 用于公网管理端 `qqbot-admin.liahuas.top`
  - 具体部署、认证和 debug token 规则以 `docs/AGENTS_SECRETS_LOCAL_STATE.md` 为准

## 本地文件约定

- `scripts/module_pids.json` 是本地 `start_modules.py` 写出的 PID 状态，不提交。
- NapCat 登录二维码和各类截图文件属于登录/排障产物，不提交。

## 文档

- [docs/START_HERE.md](docs/START_HERE.md)
- [docs/INDEX.md](docs/INDEX.md)
- [docs/ROADMAP.md](docs/ROADMAP.md)
