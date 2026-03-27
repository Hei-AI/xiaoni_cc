# Backend And Data Task Guide

仅在任务涉及后端接口、队列、共享数据模型、数据库访问时阅读本文件。

## Data Rules
- PostgreSQL 是当前运行数据库。
- 所有 PostgreSQL 持久化读写都必须收口到 `packages/persistence`，不要把共享持久化逻辑散到路由、页面服务或模块内临时实现。
- 持久层必须优先使用 ORM；当前标准实现是 `packages/persistence` 中的 Prisma schema 和 Prisma Client。
- 只有在明确确认 ORM 无法合理表达时才允许使用原生 SQL；原生 SQL 也必须留在 persistence 层，不能绕过该层直接落在业务模块。

## Regression Checks
- 队列/模拟/代理链路优先回归：
  - `./scripts/test-queue-connection.sh`
  - `./scripts/self-verification.sh`
