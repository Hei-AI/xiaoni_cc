# 通用求助入口与福尔摩斯分流

当前实现契约。第三方独立视角的历史理由见 `docs/adr/0009-failure-conclusions-need-an-outside-reviewer.md`。
旧版 `blocked` 触发、克隆主上下文的方案已被替代；本页维护现行实现。

## 面向小腻的入口

`ask_li_ahua(request, context, help_id?)` 表达“向李阿花求助”。日常计算机操作与研究问题都可使用，不要求创建 deep dive。
`request` 写需要的帮助，`context` 写现场、已尝试的办法、预期结果与边界。
同一件事仍未解决时传回 `help_id`，并说明上次结果哪里没有解决；新问题不复用旧编号。

入口返回帮手的处理结果或人工交接状态，明确区分帮手与李阿花本人。帮手返回结果不等于自动宣布小腻的深挖已经完成。
人工交接走 `agent-service -> provider-service -> NapCat`，发到小腻与李阿花的 QQ 私聊；本人回复仍由现有 QQ inbox 进入，小腻用 `$qq-usage` 查看。

旧 `update_deep_dive(action=need_outsider)` 作为已有上下文的兼容入口，转入同一求助实现，以 deep dive ID 稳定关联求助记录，结果通过原 Notify Bucket 回传。
主 prompt 的主动求助入口是 `ask_li_ahua`。

## 内部分流

分类器使用独立请求，只能返回 `classify_assistance`，不能执行计算机操作。严格校验分类输出；失败不默认授权执行。

| 分类 | 处理 |
| --- | --- |
| investigate | 福尔摩斯独立调查，返回新的方向与可核对依据，保留由小腻自己形成结论的边界。 |
| execute | 帮手实际执行委托的计算机操作，验证结果，返回完成情况、产物、检查结果及未完成部分。 |
| human | 需要本人决定、个人信息、授权或明确指定本人参与，直接交给李阿花。 |
| clarify | 任务目标或必要信息不足，返回具体需要补充的问题。 |

分类器读取本次请求、背景和该求助的历史反馈。帮手使用全新上下文，只拿到求助材料，不克隆小腻的身份和主请求。
调查与执行均通过现有 provider 和 `exec_command`，执行环境为现有 xiaoni-executor；浏览器和其它本地能力先读对应 `SKILL.md`。
执行层拒绝其它工具，包括递归求助、QQ 发言和修改深挖状态；shell 内的行为边界由工作目录规则与帮手提示词约束，不声称是独立权限沙箱。
命令结果复用 `applyToolResultToLoopInput` 回传原始 `codex_output`、stdout/stderr 和拒绝信息；不能使用发送消息的精简回执函数，否则帮手只能看到 `ok` 而无法核对执行结果。

默认帮手最多处理同一求助两次；小腻再次反馈未解决时，直接转人工，附原始请求、补充内容和此前处理记录。
明确需要本人参与不必等两次。帮手没有给出可用结果时也转人工。分类澄清不占帮手尝试次数。
单次帮手沿用 32 个模型 turn / 30 次工具调用的预算；预算不是完成判据。

## 持久化与重复调用

通过 `packages/persistence/agent-tasks.js` 的 Prisma 操作复用 `agent_tasks`，类型为 `xiaoni_help`。
使用 `help_*` 状态，现有只领取 `pending` 的图像 worker 不会消费求助。
`attempts`、原始请求、每次请求与返回结果保存在同一记录；比较并交换领取和 call ID 去重避免并发重复执行。

- `help_running`：已经领取，同进程重复调用不执行；主 runtime 单宿主重启后，同编号再次求助转人工核实现场，不重新执行可能已产生副作用的动作。
- `help_answered` / `help_failed`：已返回结果或失败，可以用原编号继续。
- `help_human_sending`：已开始发送或发送结果不确定，不自动重发；先核对 QQ 记录。
- `help_human_sent`：已转交本人，后续调用返回等待本人回复。

分类为 `failure_review_fork_slices` 的 turn 0，帮手后续 turn 沿用该独立账本，metadata 标明阶段和类型。
主 `function_call_output` 由现有工具账本与 stack replay 路径保存，回放时不重新分类、不重新执行。

## 配置与缓存

本机配置放 `/home/liahua/.qqbot-local/agent-service.env`，compose 已读取该文件，无需另建服务。

| 配置 | 默认 |
| --- | --- |
| `AGENT_SHERLOCK_MODEL` | 当前主运行模型；可独立指定帮手模型。 |
| `AGENT_SHERLOCK_CLASSIFIER_MODEL` | 帮手模型；可独立指定分类器模型。 |
| `AGENT_HELP_HUMAN_QQ_ID` | 无默认；未配置不发送，并明确返回未转交。 |
| `AGENT_HELP_MAX_HELPER_ATTEMPTS` | 2。 |

新增主工具和主 prompt 改变部署时的缓存前缀，产生一次预期冷读。工具静态注册，所有克隆 fork 共用同一工具列表，之后不随求助状态变化。
分类和帮手是独立请求，不改变主请求历史。主工具结果和兼容入口通知在生成时冻结，下一 run 逐字节回放；不把尝试次数、分类状态或时间插入主缓存前缀。
验证要求仍按仓库不可变缓存回归和相邻实际 wire request / cache-read 证据执行。

## 2026-09-13 验证记录

- 新增求助回归 13/13 通过，覆盖分类、执行输出回传、人工分流、重复调用、并发领取、发送结果不确定与重启后转人工。
- 真实帮手验收 `help-smoke-fixed-20260913` 通过现有 provider → xiaoni-executor 执行 `python3 -c "print(17*19)"`：1 次工具调用、2 个执行 turn；下一次 canonical request 的工具回传确认为 `323\n`。该验收未向 QQ 发送测试消息。
- 缓存与深挖相关 agent 回归 93/93 通过；不可变缓存真库测试在主栈 Postgres 的 `qqbot_cache_test` 上 4/4 通过，无跳过。
- 受控真实 provider 请求 `help-cache-validation-20260913`：主请求 `llm_1789285308953_f2a342b3` 建立 17,783 cache tokens；克隆 heartbeat `llm_1789285312397_3f112dec` 与追加主输出历史后的请求 `llm_1789285314251_ad3597fc` 均读取 17,783 cache tokens。三者 wire tools/system 相同，后续主请求保留原消息字节。此为独立受控缓存验收，不冒充线上自然 run 的观测。
- 较广回归中，原有 `runtime frame waits before its single model slice when runtime control is disabled` 在任务 worktree 与未改动主工作区均超时；未改弱其断言。其余测试中两项依赖模块工作目录的图片脚本测试，改从模块目录运行后通过。
