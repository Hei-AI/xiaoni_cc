# Docker 部署说明

当前主仓只保留最小运行栈：`mysql + provider-service + admin-backend + admin-frontend`。NapCat 继续通过 `docker-compose.napcat.yml` 独立部署。

## 1. Compose 文件

- `docker-compose.yml`
  - 主仓核心服务栈
- `docker-compose.napcat.yml`
  - NapCat 独立部署入口
## 2. 当前服务概览

| 服务 | 容器名 | 端口映射 | 说明 |
| --- | --- | --- | --- |
| mysql | `qqbot-mysql` | `3306:3306` | 主数据库，挂载 `database/mysql_data`。 |
| provider-service | `qqbot-provider-service` | `8091:8090` | 统一能力层，承接 provider 调试、embeddings、NapCat 发送与消息模拟。 |
| admin-backend | `qqbot-admin-backend` | `9080:9080` | 管理后台 API，负责会话、队列、Prompt、流量等运营接口。 |
| admin-frontend | `qqbot-admin-frontend` | `3003:80` | 管理前端页面。 |

不再包含：

- `http-api`
- `queue-monitor`
## 3. 网络关系

- 主仓服务使用 `qq_bot_network`。
- NapCat 需运行在同一网络中，供 `provider-service` 通过 `napcat:3000/3001` 访问。
首次创建网络：

```bash
docker network create qq_bot_network
```

## 4. 启动顺序

```bash
# 1. 启动主仓核心栈
docker compose up -d --build

# 2. 启动 NapCat
docker compose -f docker-compose.napcat.yml up -d

```

常用命令：

```bash
docker compose ps
docker compose logs -f qqbot-provider-service
docker compose down
docker compose --profile ops run --rm init-db
```

## 5. 关键挂载与本地目录

- `database/mysql_data`
  - MySQL 本地运行数据，仓库层面已忽略目录内容
- `resource/napcat_config`
  - 仅保留模板配置，实例配置不再纳入版本控制

## 6. 验证与排错

健康检查：

```bash
curl http://localhost:8091/health
curl http://localhost:9080/api/health
```

补充检查：

```bash
docker compose ps
docker exec -it qqbot-mysql mysql -u qqbot_user -pqqbot_password qqbot_db
```

如果需要流量抓包与回放，参考 `modules/http-traffic-monitor/transparent-proxy/README.md`；它仍保留在主仓，但定位为管理端附属运维工具域，不是默认 compose 服务。
