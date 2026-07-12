# Docs Index

本目录是仓库内知识的 system of record。
先看这份索引，再按任务打开最少的相关文档。
- 全仓文档默认遵循渐进式披露：入口页只负责分流和给下一跳，细节只维护在被指向的主文档里。

## Agent Working Set
- 小腻当前活动、action/tool、LLM in_context、真实 trace、runtime busy flags：
  - 管理端“小腻活动”
- 小腻主 loop、LLM request 组装、行动流事实源和 trace detail：
  - `docs/XIAONI_AGENT_STACK_LEDGER.md`
- 小腻当前运行面、Admin surface、本地 skills、prompt template 和数据归属：
  - `docs/XIAONI_RUNTIME_SURFACES.md`
- 小腻被动召回 extractor、action-stream cue 分类、无 LLM/无训练边界：
  - `docs/XIAONI_PASSIVE_RECALL_EXTRACTOR.md`
- 小腻召回语料生成端(记忆宫殿蒸馏)、语料收录策略、压缩提醒/skill prompt 联动：
  - `docs/XIAONI_MEMORY_PALACE_GENERATION.md`
- 小腻行动流、Raw Trace、恢复页、LLM usage、本地浏览器、站点发布和图片发送操作：
  - `docs/XIAONI_OPERATOR_HOWTO.md`
- 小腻时区切换、TIMESTAMPTZ 迁移和压缩后暂停闸门：
  - `docs/XIAONI_TIMEZONE_MIGRATION_PLAN.md`
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
- 小腻主 prompt 正文与 prompt-facing 模板：
  - `docs/XIAONI_MAIN_PROMPT_NEXT.md`
  - `docs/xiaoni_prompt/`
- 小腻 `recover_energy` tool、精力恢复曲线、clock、睡眠唤醒和重启恢复：
  - `docs/XIAONI_RECOVER_ENERGY_DESIGN.md`
- Git 提交、推送、PR：
  - `docs/AGENTS_GIT_PR.md`
- `AGENTS.md`、`docs/` 结构、gstack 使用约定、文档治理：
  - 使用 gstack 的 `$document-release`
  - 再看 `AGENTS.md`

## Runtime And Operations
- Xiaoni agent stack ledger、LLM request slices、tool executions 和行动流投影：
  - `docs/XIAONI_AGENT_STACK_LEDGER.md`
- Xiaoni runtime surfaces、local skills、site/browser/image task/usage observability：
  - `docs/XIAONI_RUNTIME_SURFACES.md`
- Xiaoni runtime 操作 how-to：
  - `docs/XIAONI_OPERATOR_HOWTO.md`
- Provider-service / Codex Provider 完整 request/response 记录和 Raw Trace provider payload：
  - `docs/XIAONI_AGENT_STACK_LEDGER.md`
- `xiaoni-executor` 命令执行服务：
  - `docs/AGENTS_XIAONI_EXECUTOR.md`
- 小腻主 prompt 文件和 runtime reminder 模板索引：
  - `docs/XIAONI_MAIN_PROMPT_NEXT.md`
  - `docs/remind.md`
- 路线图：
  - `docs/ROADMAP.md`
- 脚本入口：
  - `scripts/README.md`

## Xiaoni Doc Status
- `xiaoni-executor` 事实源：`docs/AGENTS_XIAONI_EXECUTOR.md`。
- Agent stack ledger、LLM request assembly、行动流投影和 trace detail 当前事实源：
  `docs/XIAONI_AGENT_STACK_LEDGER.md`。
- 当前可操作 surface 和本地 skill 清单事实源：`docs/XIAONI_RUNTIME_SURFACES.md`。
- 当前操作步骤事实源：`docs/XIAONI_OPERATOR_HOWTO.md`；skill 细节事实源仍是各
  `modules/agent-service/skills/*/SKILL.md`。
- Raw Trace provider payload 事实源：`provider-service` / Codex Provider 写入的 `llm_request_slices`；它不是独立行动流主卡片。
- Runtime loop、Notify Bucket、QQ inbox、IM 硬开关、`final_answer` 连续推进、
  图片理解 fork、recover_energy callback 和行动流事实源统一看
  `docs/XIAONI_AGENT_STACK_LEDGER.md`；`recover_energy` 的 tool 参数、clock、
  精力曲线和睡眠唤醒细节看 `docs/XIAONI_RECOVER_ENERGY_DESIGN.md`。
  不要再为这些主题新增重复架构页。
- Prompt 正文事实源：`docs/xiaoni_prompt/`。主 runtime 启动时预热
  `system_prompt.md`；prompt 文件变化后的重读受闸门控制：cache-prefix 敏感的
  `system_prompt.md` / `skills_instructions.md` 等下一次 core memory compression
  边界才清空稳定 prompt 并重读，其它 snippet 文件即时生效；
  runtime reminder 模板在对应 reminder 追加时读取。
  `modules/agent-service/src/prompts/xiaoni-main-agent.ts` 只保留加载入口。
- 旧 presence / homeostasis 设计文档已删除；小腻运行真相以当前 README /
  START_HERE、agent stack ledger、主 prompt 和活跃模块代码为准。
- 历史执行计划和旧 archive 不再作为仓库内阅读路径；当前契约只看本索引列出的
  活跃专项文档。
- 旧 runtime 图资产已删除；不要再新增与主文档重复、容易滞后的架构图。需要图时，
  先更新 `docs/XIAONI_AGENT_STACK_LEDGER.md` 或对应专项文档里的文字契约，再生成图。
- 已落地的临时工程计划、事故笔记和重复 fix notes 不再作为阅读路径；落地后的事实必须
  合并进 ledger、surface、how-to 或对应专项文档。

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
