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
- 小腻 `exec_command`、命令 session、git archive、executor 容器排障：
  - `docs/AGENTS_XIAONI_EXECUTOR.md`
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
- 小腻 action replay 唯一回放表、Codex Provider 成功-only 写入和 Raw Trace 组装：
  - `docs/XIAONI_REPLAY_LEDGER.md`
- `xiaoni-executor` 命令执行服务：
  - `docs/AGENTS_XIAONI_EXECUTOR.md`
- 小腻主 prompt、连续 loop、手机通知和 QQ 使用边界：
  - `docs/XIAONI_MAIN_PROMPT_NEXT.md`
- 小腻 Notify Bucket、QQ inbox、主 loop 和动作分发架构：
  - `docs/XIAONI_NOTIFY_RUNTIME_ARCHITECTURE.md`
- 小腻当前 runtime 状态图：
  - `docs/XIAONI_RUNTIME_STATE_DIAGRAM.md`
- 路线图：
  - `docs/ROADMAP.md`
- 执行计划归档与当前候选：
  - `docs/exec-plans/README.md`
  - `docs/exec-plans/active/`
  - `docs/exec-plans/completed/`
- 历史快照归档：
  - `docs/archive/`
- 脚本入口：
  - `scripts/README.md`

## Xiaoni Doc Status
- `xiaoni-executor` 事实源：`docs/AGENTS_XIAONI_EXECUTOR.md`。
- action replay / Raw Trace 事实源：`docs/XIAONI_REPLAY_LEDGER.md`。
- Prompt 正文事实源：`docs/XIAONI_MAIN_PROMPT_NEXT.md` 必须和
  `modules/agent-service/src/prompts/xiaoni-main-agent.ts` 同步。
- 旧 presence / homeostasis 设计文档已删除；小腻运行真相以当前 README /
  START_HERE、runtime 状态图、主 prompt 和活跃模块代码为准。
- 历史材料：`docs/archive/` 和 `docs/exec-plans/completed/` 只作追溯参考，
  其中的旧工具、旧分阶段描述和旧执行计划不是当前 runtime 契约。
- 图资产：docs/assets/xiaoni-* 和 docs/xiaoni-notify-runtime-* 只是说明图。
  若它们和当前运行事实冲突，以 `docs/XIAONI_NOTIFY_RUNTIME_ARCHITECTURE.md`、
  `docs/XIAONI_RUNTIME_STATE_DIAGRAM.md`、README / START_HERE 和活跃代码为准，
  并同时更新 SVG 及其 Mermaid / PlantUML 源。

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
- 生成缺失专项文档：
  - `$document-generate`

## Maintenance Rules
- 修改代码时，如果对应文档已不再真实，顺手修正文档。
- 新文档优先放在 `docs/`，不要把关键知识只留在聊天记录里。
- 不要复制一份“差不多”的规则到多个地方；优先维护一个主文档，再由索引指向它。
- skill 名统一写成 `$skill-name` 格式，不混用 `/skill-name`。
- 仓库级交付规则统一看 `AGENTS.md`；这里不重复写一份。
