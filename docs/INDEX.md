# Docs Index

本目录是仓库内知识的 system of record。
先看这份索引，再按任务打开最少的相关文档。
- 全仓文档默认遵循渐进式披露：入口页只负责分流和给下一跳，细节只维护在被指向的主文档里。

## Agent Working Set
- 小腻当前活动、action/tool、LLM in_context、真实 trace、runtime busy flags：
  - 管理端“小腻活动”
- 前端页面、交互、生产前端问题：
  - `docs/AGENTS_FRONTEND.md`
- 后端接口、队列、共享数据模型、数据库访问：
  - `docs/AGENTS_BACKEND_DATA.md`
- 配置、部署、认证、密钥、本机调试访问：
  - `docs/AGENTS_SECRETS_LOCAL_STATE.md`
- embeddings：
  - `docs/AGENTS_EMBEDDINGS.md`
- OpenAI / LLM 请求、提示词、agent 设计官方参考：
  - `docs/AGENTS_OPENAI_REQUESTS.md`
- Codex + gstack 本机安装、升级、去重：
  - `docs/AGENTS_GSTACK_CODEX.md`
- 小腻主 prompt 正文：
  - `docs/XIAONI_MAIN_PROMPT_NEXT.md`
- 离线 memory replay 历史评测参考，不是当前 runtime memory 契约：
  - `docs/archive/AGENTS_MEMORY_EVAL-20260604-offline-replay.md`
- Git 提交、推送、PR：
  - `docs/AGENTS_GIT_PR.md`
- `AGENTS.md`、`docs/` 结构、gstack 使用约定、文档治理：
  - 使用 gstack 的 `$document-release`
  - 再看 `AGENTS.md`

## Runtime And Operations
- 当前业务与运行架构：
  - `docs/CURRENT_ARCHITECTURE.md`
- 小腻完整运行态总图，含服务、队列、数据库表、LLM provider、管理端和关键支路：
  - `docs/XIAONI_RUNTIME_STATE_DIAGRAM.md`
- `agent-service` loop 细版，含输入输出、工具契约、抑制路径、自学习闭环：
  - `docs/AGENTS_AGENT_LOOP_RUNTIME.md`
- 小腻被动发言 / 主动发言阶段图、数据源和来源：
  - `docs/XIAONI_SPEAKING_FLOW.md`
- 小腻数字生活 / `presence_context` 设计、已落地 presence slice 与当前空闲生活事件：
  - `docs/P0A_DIGITAL_LIFE_PRESENCE_CONTEXT.md`
- 小腻 homeostasis reducer、`agent_life_events` 事件流真相源和下一阶段边界：
  - `docs/P0A_XIAONI_HOMEOSTASIS_LOOP.md`
- 路线图：
  - `docs/ROADMAP.md`
- 当前主动队列：
  - `TODOS.md`
- 执行计划归档与当前候选：
  - `docs/exec-plans/README.md`
  - `docs/exec-plans/active/`
  - `docs/exec-plans/completed/`
- 历史快照归档：
  - `docs/archive/`
- 脚本入口：
  - `scripts/README.md`

## GStack Workflows
- 长任务自动评审：
  - `$autoplan`
- 架构与执行评审：
  - `$plan-eng-review`
- Bug / 异常根因调查：
  - `$investigate`
- OpenAI 产品/API 官方文档查询：
  - `$openai-docs`
- 站点或功能 QA：
  - `$qa`
- 提交、PR、发版：
  - `$ship`
- 发版后文档同步：
  - `$document-release`

## Maintenance Rules
- 修改代码时，如果对应文档已不再真实，顺手修正文档。
- 新文档优先放在 `docs/`，不要把关键知识只留在聊天记录里。
- 不要复制一份“差不多”的规则到多个地方；优先维护一个主文档，再由索引指向它。
- skill 名统一写成 `$skill-name` 格式，不混用 `/skill-name`。
- 仓库级交付规则统一看 `AGENTS.md`；这里不重复写一份。
