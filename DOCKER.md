# Docker 部署说明

本指南基于当前 `docker-compose.yml` 与脚本整理，描述 QQ Bot 项目的容器化部署方式。通过阅读可了解服务列表、依赖关系与常用命令。

## 1. 目录与脚本
- `docker-compose.yml`：主业务服务（HTTP API、qqbot-core、admin-backend、admin-frontend、mysql、traffic-monitor）。
- `docker-compose.napcat.yml`：NapCat 单独部署配置。
- `scripts/docker-deploy.sh`：构建/启动/停止常用封装。
- `scripts/napcat-manage.sh`：NapCat 服务管理辅助脚本。

## 2. 服务概览
| 服务 | 容器名 | 端口映射 | 说明 |
| --- | --- | --- | --- |
| traffic-monitor | `qqbot-traffic-monitor` | `8888:8888` | mitmproxy 透明代理，用于抓取外部 HTTP/HTTPS 请求。|
| mysql | `qqbot-mysql` | `3306:3306` | 主数据库，挂载数据目录 `database/mysql_data`。|
| http-api | `qqbot-http-api` | `8080:8080` | OneBot/HTTP 入口，转发到 qqbot-core。|
| qqbot-core | `qqbot-core` | `8081:8081` | 核心机器人服务，连接 NapCat 与数据库。|
| admin-backend | `qqbot-admin-backend` | `9080:9080` | 管理后台 API。|
| admin-frontend | `qqbot-admin-frontend` | `3003:80` | 管理前端页面（Nginx 提供静态资源）。|

各容器挂载日志与资源目录，具体参见 compose 文件中的 `volumes`。

## 3. 网络结构
- 默认使用外部网络 `qq_bot_network`（bridge）。在首次部署前需执行：
  ```bash
  docker network create qq_bot_network
  ```
- 所有服务（含 mysql、traffic-monitor）都加入该网络以内部互联。
- NapCat 不在主 compose 中，通常通过 `docker-compose.napcat.yml` 运行在同一网络，供 qqbot-core 通过容器名 `napcat:3001` 连接。

## 4. 快速启动

> ⚠️ 必须使用 Docker Compose v2 CLI (`docker compose`)，请不要使用已废弃的 `docker-compose` 命令。

```bash
# 构建镜像（如需强制重建可附加 --no-cache）
docker compose build

# 启动核心服务栈
docker compose up -d

# 查看运行状态
docker compose ps

# 查看某个服务日志
docker compose logs -f qqbot-qqbot-core

# 停止并保留数据卷
docker compose down
```
- 需要一键执行数据库或 LLM 辅助任务时，可使用 `docker compose --profile ops run --rm init-db`、`update-llm-config`、`test-llm-config`。
- NapCat 独立栈：`docker compose -f docker-compose.napcat.yml up -d`，停止时改用 `down`。

## 5. 常见配置项
主要环境变量集中在 compose 文件中，可根据环境修改：
- 数据库：`MYSQL_HOST`、`MYSQL_PORT`、`MYSQL_USER`、`MYSQL_PASSWORD`、`MYSQL_DATABASE`。
- WebSocket：`WEBSOCKET_HOST`、`WEBSOCKET_PORT`、`WEBSOCKET_ACCESS_TOKEN`（NapCat 端配置）。
- 透明代理：默认由 traffic-monitor 负责，无需手动设定 `HTTP_PROXY`。

## 6. 验证与排错
- 健康检查：
  ```bash
  curl http://localhost:8080/health
  curl http://localhost:8081/health
  curl http://localhost:9080/api/health
  ```
- 检查数据库连接：`docker exec -it qqbot-mysql mysql -u qqbot_user -p qqbot_db`。
- 监控资源：`docker stats`、`docker ps`、`docker inspect <container>`。
- 若代理/iptables 调试，参考 `modules/http-traffic-monitor/transparent-proxy/README.md`。

## 7. 注意事项
- 确保日志与数据目录具备写权限（项目根目录的 `logs/`、`database/`）。
- 彻底清理可执行 `docker compose down -v`（会删除容器及数据卷）。
- 如需修改镜像标签或推送至仓库，可在各模块目录调整对应 Dockerfile。

此说明旨在贴合当前仓库结构，后续若 compose 或脚本改动，请同步更新本文件。
