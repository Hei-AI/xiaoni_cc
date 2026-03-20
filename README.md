# QQ Bot

基于 OneBot 11 的 QQ 机器人主仓。

当前主仓只保留运行底座和管理端：

- `qqbot-core`: 消息接入、队列、上下文、AI 调度、消息发送
- `admin-panel/backend`: 运营 API、Prompt 配置、队列管理、流量查看/回放
- `admin-panel/frontend`: 管理界面
- `mysql`: 数据存储
- `docker-compose.napcat.yml`: NapCat 独立部署入口

`openclaw-bridge` 已迁移到独立项目，不再保留在本仓。

## 目录

```text
.
├── docker-compose.yml
├── docker-compose.napcat.yml
├── database/
├── docs/
├── modules/
│   ├── admin-panel/
│   ├── http-traffic-monitor/
│   └── qqbot-core/
├── resource/
└── scripts/
```

## 运行架构

主链：

```text
NapCat -> qqbot-core -> MySQL
                  \
                   -> admin-backend -> admin-frontend
```

说明：

- NapCat 独立部署，不包含在主业务 compose 中。
- 管理端直接连接 `qqbot-core` 和 MySQL，不再经过函数注册中心。
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
- QQBot Core: `http://localhost:8081/health`

## 调试能力

保留的调试面：

- `qqbot-core` 健康检查、消息模拟、LLM 调试、简单队列接口
- Admin 会话/聊天查看
- Admin Queue Management
- Prompt 管理 / 编辑 / 调试
- HTTP 流量查看与回放

## 常用命令

```bash
docker compose logs -f qqbot-qqbot-core
docker compose logs -f qqbot-admin-backend
docker exec -it qqbot-qqbot-core /bin/sh
python3 scripts/start_modules.py start
python3 scripts/start_modules.py status
```

## 文档

- [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md)
- [docs/ROADMAP.md](docs/ROADMAP.md)
- [DOCKER.md](DOCKER.md)

历史设计文档见 `docs/archive/`。
