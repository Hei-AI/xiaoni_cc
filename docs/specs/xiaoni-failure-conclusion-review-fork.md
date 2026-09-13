# 通用求助入口与福尔摩斯分流

当前实现契约。第三方独立视角的历史理由见 `docs/adr/0009-failure-conclusions-need-an-outside-reviewer.md`。
旧版 `blocked` 触发、克隆主上下文的方案已被替代；本页维护现行实现。

## 面向小腻的入口

`ask_li_ahua(request, context, help_id?)` 表达“向李阿花求助”。日常计算机操作与研究问题都可使用，不要求创建 deep dive。
`request` 写需要的帮助，`context` 写现场、已尝试的办法、预期结果与边界。
同一件事仍未解决时传回 `help_id`，并说明上次结果哪里没有解决；新问题不复用旧编号。

小腻只看到“找李阿花获取帮助”。李阿花可在内部把求助交给福尔摩斯处理，或接收 QQ 私聊；分类、外包、模型和重试机制不进入工具描述或回传字段。返回中性的求助结果、待回复或未送达状态，不虚构李阿花本人说过或做过什么。处理结果不等于自动宣布小腻的深挖已经完成。
模型可见回传统一经过 `presentLiAhuaHelp` 白名单投影，包括旧记录的重复调用；内部来源与状态保留在工程账本中。QQ 求助正文只带问题、背景和此前求助结果，不暴露内部分流说明。既有 stack 历史按原字节回放，不重写旧回执。
人工交接走 `agent-service -> provider-service -> NapCat`，发到小腻与李阿花的 QQ 私聊；本人回复仍由现有 QQ inbox 进入，小腻用 `$qq-usage` 查看。

旧 `update_deep_dive(action=need_outsider)` 作为已有上下文的兼容入口，转入同一求助实现，以 deep dive ID 稳定关联求助记录，结果通过原 Notify Bucket 回传。
主 prompt 的主动求助入口是 `ask_li_ahua`。

## 内部分流

分类器使用独立请求，只能返回 `classify_assistance`，不能执行计算机操作。严格校验分类输出；失败不默认授权执行。

| 分类 | 处理 |
| --- | --- |
| investigate | 福尔摩斯独立调查，返回新的方向与可核对依据，保留由小腻自己形成结论的边界。 |
| execute | 执行 worker 实际完成李阿花转交的机械性计算机操作，验证结果，返回完成情况、产物、检查结果及未完成部分。语音转写的明确委托可包括使用当前浏览器和当前账号完成人机测试、Google 登录或授权、论坛内容代发和邮件发送；模型统一读取 `$xiaoni-browser` 后通过现役 Playwright 桥逐步完成页面操作。 |
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
| `AGENT_SHERLOCK_MODEL` | `claude-sonnet-4-6`；通过 provider 执行 worker。 |
| `AGENT_SHERLOCK_CLASSIFIER_MODEL` | `claude-sonnet-4-6`；通过 provider 执行分类器。 |
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
- 15:52（UTC+8）基于 `2a3a9716` 定向 build/up `agent-service`，未重启其它服务；容器与 `/health` 均健康，runtime 保持 enabled。合入同期主分支后相关回归 102/102，真库缓存再次 4/4；镜像中 50 项通过，网络隔离下跳过的真库项已由主栈真库验证覆盖。
- 运行容器确认 `ask_li_ahua` 已注册，QQ 本人收件配置已加载，尝试上限 2；帮手和分类器默认均通过 provider 使用 `claude-sonnet-4-6`，仍可分别用环境变量覆盖。
- 部署后首次全上下文 heartbeat 冷读，随后 `llm_1789286007056_e1a31bcb` 在 `xiaoni:global` 读取 365,359 / 365,362 input tokens 的缓存。两个真实 provider usage 事件的 wire tools/system 相同。此为线上完整上下文 heartbeat 验证，不是自然下一 run 的冒充记录。

### 求助入口表述收敛

按用户确认，小腻只看到向李阿花求助，内部分流与外包不外露。相关回归 56/56、主栈真库缓存 4/4 通过。受控 provider 验证 `help-facing-cache-20260913` 的三次 slice 为 `llm_1789290372199_b15829ff`、`llm_1789290374689_6fd3710c`、`llm_1789290377009_424553fd`；首次建立 17,371 cache tokens，克隆 heartbeat 与后续追加历史的请求均读取 17,371。wire tools/system 相同。工具描述和 system 的变化只在切换时改变前缀；新回执生成时冻结，旧 stack 历史不重写。

2026-09-13 17:07（UTC+8）已基于 `a07ff05c` 定向构建并更新 agent-service。镜像内求助/缓存对齐测试 22/22 通过，服务 healthy、runtime enabled；运行容器确认工具描述只表达找李阿花求助，旧回执投影不再返回内部来源字段。

2026-09-13 17:27（UTC+8）补齐语音转写测试委托：分类器把当前浏览器人机认证、当前 Google 账号登录或授权、论坛代发和邮件发送视为明确 `execute`，worker 读取 `$xiaoni-browser` 后通过 Playwright 桥逐步执行并验证。分类器和 worker 已显式切到 provider 的 `claude-sonnet-4-6`；定向求助与两支不可变 agent 缓存用例 53/53、真库缓存 4/4 通过。真实 Sonnet 4.6 no-persist 分类探针返回 `execute`，agent-service 定向 build/up 后 healthy，容器内模型环境和 prompt 均核对生效。
