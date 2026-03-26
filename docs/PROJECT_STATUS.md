# 项目状态

## 当前主仓范围

当前主仓保留：

- `provider-service`
- `admin-panel/backend`
- `admin-panel/frontend`
- `postgres`
- `docker-compose.napcat.yml`
- `http-traffic-monitor` 运维工具链

当前主仓已移除或已退出主链：

- cognition 管理端与相关 API
- `http-api`
- `queue-monitor`
- `qqbot-core` 运行职责

## 当前架构

```text
NapCat -> provider-service
                      \
                       -> admin-backend -> admin-frontend
```

补充说明：

- Queue 管理与消息模拟由 Admin 后端代理到 `provider-service /api/simple-queue/*`
- Prompt 管理为本地数据库驱动
- provider debug 和 embeddings 由 `provider-service` 提供
- 流量监控/回放是管理端运维工具链，不是独立业务服务

## 当前保留的调试能力

- `provider-service`
  - 健康检查
  - 状态接口
  - 消息模拟
  - LLM 调试
  - 简单队列接口
  - embeddings
- `admin-panel/backend`
  - conversations / timeline
  - queue monitor / simple queue proxy
  - prompt 管理与调试
  - playground
  - traffic replay / query
  - runtime status / logs
- `admin-panel/frontend`
  - dashboard
  - conversations
  - queue management
  - prompts
  - playground
  - traffic monitor / replay

## 已知运行约束

- NapCat 独立部署，不在主 compose 中。
- NapCat 未登录时，provider-service 的 NapCat 探针会显示 degraded，但不会影响消息模拟、queue、provider debug 和 embeddings 的本地验证。
- `modules/qqbot-core` 已从主仓运行面清理，不再作为运行、部署和接口真相源。
