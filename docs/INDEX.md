# Docs Index

本目录是仓库内知识的 system of record。
先看这份索引，再按任务打开最少的相关文档。

## Agent Working Set
- 前端页面、交互、生产前端问题：
  - `docs/AGENTS_FRONTEND.md`
- 后端接口、队列、共享数据模型、数据库访问：
  - `docs/AGENTS_BACKEND_DATA.md`
- 配置、部署、认证、密钥、本机调试访问：
  - `docs/AGENTS_SECRETS_LOCAL_STATE.md`
- embeddings：
  - `docs/AGENTS_EMBEDDINGS.md`
- Git 提交、推送、PR：
  - `docs/AGENTS_GIT_PR.md`
- `AGENTS.md`、`docs/` 结构、gstack 使用约定、文档治理：
  - 使用 `$harness-engineering`
  - 再看 `AGENTS.md`

## Runtime And Operations
- 路线图：
  - `docs/ROADMAP.md`
- 脚本入口：
  - `scripts/README.md`

## GStack Workflows
- 长任务自动评审：
  - `/autoplan`
- 架构与执行评审：
  - `/plan-eng-review`
- Bug / 异常根因调查：
  - `/investigate`
- 站点或功能 QA：
  - `/qa`
- 提交、PR、发版：
  - `/ship`

## Maintenance Rules
- 修改代码时，如果对应文档已不再真实，顺手修正文档。
- 新文档优先放在 `docs/`，不要把关键知识只留在聊天记录里。
- 不要复制一份“差不多”的规则到多个地方；优先维护一个主文档，再由索引指向它。
- 仓库级交付规则统一看 `AGENTS.md`；这里不重复写一份。
