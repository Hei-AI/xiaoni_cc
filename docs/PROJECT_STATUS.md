# 项目状态

## 当前主仓范围

主仓保留：

- `qqbot-core`
- `admin-panel/backend`
- `admin-panel/frontend`
- `mysql`
- `docker-compose.napcat.yml`
- `http-traffic-monitor` 运维工具链

主仓已移除或正在移除：

- `http-api`
- `queue-monitor`
- `openclaw-bridge`

## 当前架构

```text
NapCat -> qqbot-core -> MySQL
                  \
                   -> admin-backend -> admin-frontend
```

补充说明：

- Queue 管理由 Admin 后端代理到 `qqbot-core /api/simple-queue/*`
- Prompt 管理为本地数据库驱动
- 流量监控/回放是管理端运维工具链，不是独立业务服务

## 当前保留的调试能力

- `qqbot-core`
  - 健康检查
  - 状态接口
  - 消息模拟
  - LLM 调试
  - 简单队列接口
- `admin-panel`
  - 会话 / 聊天查看
  - 队列管理
  - Prompt 管理 / 编辑 / 调试
  - HTTP 流量查看 / 回放
  - 状态 / 日志查询

## 当前工作重点

- 按 [docs/TODO_REFACTOR.md](docs/TODO_REFACTOR.md) 完成仓库精简
- 清理本地运行资产和历史兼容层
- 验证在去除函数注册中心后主链仍稳定
- 确保 OpenClaw Bridge 已平移到独立项目并可继续运行
