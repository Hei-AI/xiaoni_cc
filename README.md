# QQ Bot

基于 OneBot 11 的 QQ 机器人主仓。

当前主仓保留运行底座和管理端：

- `provider-service`: NapCat / OneBot 入口、LLM provider 执行、消息模拟、embeddings、queue 入口
- `agent-service`: 主 agent loop runtime，消费 queue batch、重建上下文、执行 agent run、控制 delivery state，并运行 presence 后台循环和 life event 投影
- `admin-panel/backend`: 运营 API、Prompt 配置、队列管理、run workspace、Image Lab、流量查看/回放、runtime status
- `admin-panel/frontend`: 管理界面，默认从“小腻活动”看她当前在做什么
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
                       -> provider-service -> NapCat
                       -> admin-backend -> admin-frontend
                       -> PostgreSQL (via admin / business data)
```

说明：

- NapCat 独立部署，不包含在主业务 compose 中。
- 管理端默认链路是前端 -> `admin-panel/backend`。
- `provider-service` 当前负责 provider debug、OneBot 入站和出站、queue 写入、image provider、embeddings 和 timeline 记录。
- `agent-service` 负责消费消息批次、执行 loop agent，并把 run / trace / transcript / delivery state / 三层长期记忆写回 PostgreSQL。
- 小腻主 prompt 只有一套，维护在 `modules/agent-service/src/prompts/xiaoni-main-agent.ts`；群/私聊不再绑定不同 prompt，DB prompt 表不再是小腻运行时来源。
- `agent-service` 运行 presence tick：它会把“小腻从自己的生活里抬头看一眼”的动作 append 进同一个 queue / agent loop。存在游标后的未读时，会打开最新未读会话并 materialize 成 `proactive_im_open`；每个群/私聊以上次已读最后一条为游标，旧 backlog 不会被当成当前现场。presence 起源的 tick 无论是否打开 IM，都读取全局最近事件流和 `xiaoni:global` 连续性；没有具体会话时也会走主 loop，可以提交内部 `submit_life_action`、`web_search` 或 `stay_silent`，但不能无目标直接发 QQ。想回头分享的内容会留进 `<小腻的OS>`，不走旁路兴趣表。
- provider 侧的 participation 现在保留为硬安全边界和观测事件，主行为判断逐步收口到 `agent-service` runtime。
- 当前主发言判断在 `agent-service`；topic projection、transcript snapshot、三层长期记忆等后台能力可以用于观测、后续 typed recall projection、评测或异步产物，但不要把它们当成入口层“是否说话”的总决策器。
- 当前对话历史里的 `<小腻的OS>` 视为小腻跨轮延续下来的内部状态与成长轨迹，按历史真相保留，并随已读历史一起参与上下文窗口管理。
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
- Agent Service: `http://localhost:8092/health`

## 调试能力

保留的调试面：

- Admin 小腻活动瀑布流：真实 trace 里的 action/tool、LLM in_context、发言、看群、历史后台行动、任务、图片观察和 runtime busy flags
- `provider-service` 健康检查、消息模拟、LLM 调试、简单队列接口、embeddings
- Admin agent run workspace、会话明细、participation events、runtime status、agent runtime task/media 观测
- Admin Queue Management
- Prompt 管理 / 编辑 / 调试仍可用于 Playground 和历史调试；小腻主 prompt 不再从 DB 读取。
- Playground case library、Trace / Conversation 导入、Provider 请求 payload 查看
- 空闲生活事件排障时，看 `presence_tick` / `proactive_im_open` 队列项、agent run trace、`agent_life_events`、`conversation_items` 和 Traffic 里的 `llm_call_id`；不要再把 `agent_digital_actions` 当成新自主行动主链路。
- Trace 里没有 MITM 命中的真实流量时，会从 `llm_call_logs.wire_request/wire_response` 合成 `provider.request` span；配置了 CLIProxyAPI 请求日志目录时，span detail 会优先展示真实上游 request / response，并脱敏敏感 header
- Image Lab 生成 / 编辑 / prompt assistant
- Codex local provider 使用 `/root/.qqbot-local/codex-auth-profiles/auth-profiles.json` 作为运行态 OAuth profile store；只在 profile 缺失时从只读 `/root/.codex/auth.json` bootstrap，刷新只写 auth-profiles，不改写 auth.json
- Traffic 只记录 Codex 限额信号，不做账号切换，也不改写 auth.json
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
- 临时探针、compact memory 导出和 smoke 产物放在 `tmp/`，不提交。

## 文档

- [docs/START_HERE.md](docs/START_HERE.md)
- [docs/INDEX.md](docs/INDEX.md)
- [docs/CURRENT_ARCHITECTURE.md](docs/CURRENT_ARCHITECTURE.md)
- [docs/ROADMAP.md](docs/ROADMAP.md)
