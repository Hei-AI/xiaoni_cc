# 通用求助入口与福尔摩斯分流

当前实现契约。第三方独立视角的历史理由见 `docs/adr/0009-failure-conclusions-need-an-outside-reviewer.md`。
旧版 `blocked` 触发、克隆主上下文的方案已被替代；本页维护现行实现。

## 面向小腻的入口

`ask_li_ahua(request, context, help_id?)` 把“需要李阿花帮助的事情”提交为异步任务。日常计算机操作与研究问题都可使用，不要求创建 deep dive。
`request` 写需要的帮助，`context` 写现场、已尝试的办法、预期结果与边界。
调用只返回 task/help id 和 `pending`，不在主 agent turn 内等待 worker。完成或需要补充信息时，task worker 通过 Notify Bucket 另行唤醒小腻。同一件事补充必要信息时传回 `help_id`；新问题不复用旧编号。

小腻只看到异步委托任务、任务编号和后续结果；分类、worker 模型和重试机制不进入回传字段。返回中性的任务状态，不虚构李阿花本人说过或做过什么。处理结果不等于自动宣布小腻的深挖已经完成。
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

分类器读取本次请求、背景和该任务的历史反馈。worker 的输入只组装完成当前 Goal 所需的任务材料。
调查与执行均通过现有 provider 和 `exec_command`，执行环境为现有 xiaoni-executor；浏览器和其它本地能力先读对应 `SKILL.md`。
执行层拒绝其它工具，包括递归求助、QQ 发言和修改深挖状态；shell 内的行为边界由工作目录规则与帮手提示词约束，不声称是独立权限沙箱。
命令结果复用 `applyToolResultToLoopInput` 回传原始 `codex_output`、stdout/stderr 和拒绝信息；不能使用发送消息的精简回执函数，否则帮手只能看到 `ok` 而无法核对执行结果。

`execute` 是持久 Goal。worker 只有收到完整的 `<goal_completed>...</goal_completed>` 并取得可核对结果才结束；普通 final、部分进度、单次失败或单轮预算耗尽都重新排队继续。每轮开始外部动作前先检查现场，避免重启或重试造成重复提交。确实缺少必要输入时返回 `<goal_blocked>...</goal_blocked>`，任务进入等待补充状态；使用同一 `help_id` 补充后继续。
明确需要本人参与直接转人工。单次 worker 沿用 32 个模型 turn / 30 次工具调用的安全阀，达到安全阀只结束本轮，不结束 Goal。

## 持久化与重复调用

通过 `packages/persistence/agent-tasks.js` 的 Prisma 操作复用 `agent_tasks`，类型为 `xiaoni_help`。
使用 `help_*` 状态，现有只领取 `pending` 的图像 worker 不会消费求助。
`attempts`、原始请求、每次请求与返回结果保存在同一记录；比较并交换领取和 call ID 去重避免并发重复执行。

- `help_ready`：等待独立 help task worker 领取；主 loop 已经返回，不被阻塞。
- `help_running`：worker 已领取。服务替换后新进程可恢复领取，并把此前记录交给下一轮检查现场后继续。
- `help_waiting_input`：缺少必要输入；小腻收到 attention notify，使用原编号补充后回到 `help_ready`。
- `help_answered`：Goal 已完成并持久化，随后写入 completion notify。
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

新增主工具和主 prompt 改变部署时的缓存前缀，产生一次预期冷读。工具静态注册，所有克隆 fork 共用同一工具列表，之后不随求助状态变化。
分类和 worker 是独立 no-persist 请求，不改变主请求历史。主工具的 pending 回执和完成 notify 在生成时冻结，下一 run 逐字节回放；不把尝试次数、分类状态或时间插入主缓存前缀。
验证要求仍按仓库不可变缓存回归和相邻实际 wire request / cache-read 证据执行。

## 2026-09-13 验证记录

### 自有 reCAPTCHA 页面实测（17:55–17:58，UTC+8）

实验入口和正式密钥配置见 [scripts/README.md](../../scripts/README.md#recaptcha-自有站点实验)。使用 Google 官方 v2 测试密钥，不是正式风险挑战；尚无用户正式站点配置，不能据此断言真实图片验证码能力。

- 独立无头 Playwright 对照：真实点击 Google iframe 的复选框，再点击本站提交按钮。17:58:01 Google `siteverify` 返回 `success=true`、`hostname=testkey.google.com`；本站显式返回 `mode=test`、`liveVerification=false`。后端 5 项契约测试通过。
- 当前部署协助 worker：直接调用求助工具使用的 `runSherlockFork`，实际 Sonnet 4.6 → `exec_command` → xiaoni-executor → `$xiaoni-browser`，没有 mock 模型或执行器。实验 ID `recaptcha-lab-1789293319801`。不覆盖外层求助任务/重试/人工升级。
- 实测未完成：worker 运行 32 turn、30 次工具调用后返回 `text=null`、`goalCompleted=false`、`goalBlocked=false`。浏览器可加载 Google 组件，多次 locator/坐标点击后 `aria-checked` 仍为 false，页面提交按钮仍 disabled，没有该 worker 提交本站的成功证据。可确定失败发生在浏览器交互阶段；不能仅凭此归因于模型能力或 Google 风控，浏览器桥输入事件/跨 iframe 定位仍需另行排查。
- `exec_1789293397949_4abcab76` 与 `exec_1789293437693_4d630c62` 记录了点击后 false 的结果；`exec_1789293491091_07087f96` 的最终 snapshot 仍为未选中。独立 fork 账本保留 0–32 turn，按上述 fork ID 查询即可。宿主机临时结果 `/tmp/qqbot-recaptcha-agent-result.json` 与 `/tmp/qqbot-recaptcha-verifications.jsonl` 分别是 worker 结果和站点校验记录；后者此次成功来自无头对照，不能算作 worker 成功。

本实验只新增独立脚本，未修改主 agent 请求/提示词/stack replay，也未构建或重启 compose 服务；fork 前缀与下一主 run 缓存均无代码变更影响。

### 正式密钥复测（2026-09-13 20:12，UTC+8）

用户完成 Google 登录后，已注册 `qqbot-recaptcha-lab`（v2 复选框，控制台 site ID `767122017`）。按用户纠正，允许域名包含 `liahuas.top`，另保留 `localhost` 供本机实验；保存后重新打开设置页验证两者均存在。真实密钥只保存在 `/home/liahua/.qqbot-local/recaptcha-lab.env`（0600），不进入仓库。当前正式模式入口为 `http://localhost:18765`；本机对 `https://liahuas.top` 的请求 TLS 失败，不能把域名注册成功说成公网网站已上线。

本次仍通过部署的协助 worker 实际执行，fork ID `recaptcha-lab-1789301506513`。20:12:17 实际勾选并提交后，本站 Google `siteverify` 返回 `success=true`、`mode=live`、`liveVerification=true`、`hostname=localhost`。浏览器工具 snapshot 与站点审计 `/tmp/qqbot-recaptcha-live-verifications.jsonl` 一致；这是 worker 自身完成的正式验证，不是独立无头对照。证据：`exec_1789301536850_08880e15` 提交、`exec_1789301539853_6693becb` 读取成功结果、`exec_1789301543031_6ff7b954` 截图，截图副本 `/tmp/qqbot-recaptcha-live-success.png`。

本轮没有出现图片选择题，故结论仅为当前工具成功完成一次正式 reCAPTCHA 复选框验证；不能据此宣称能解图片验证码，也不能从前后两次结果推导旧点击问题已修复。没有改主 agent 代码或提示词，没有重启 compose 服务。

### 公网图片挑战实验及执行者边界（2026-09-13 20:18，UTC+8）

用户指定保留 `liahuas.top` 原有 AAAA 记录，改用 `https://captcha.liahuas.top`。已创建专用 Cloudflare Tunnel `qqbot-recaptcha-lab`（`b6952377-4c6e-4c3f-be92-8428122ec78c`）及该子域的 proxied CNAME；通过 Cloudflare API 核对根域记录保持不变。站点进程只在 `127.0.0.1:18766` 监听，Google 服务端 hostname 精确校验为 `captcha.liahuas.top`。Google 端允许 `liahuas.top` 及其子域，已移除 localhost，安全偏好为最高值 3。公网 `/config` 已验证为 live。

运行进程由本机临时 user systemd units `qqbot-recaptcha-lab`、`qqbot-recaptcha-tunnel` 管理（Restart=on-failure，不承诺重启机器后自动恢复）。私有配置分别为 `/home/liahua/.qqbot-local/recaptcha-lab.env` 和 `recaptcha-tunnel.yml`；原共享 tunnel 与 compose 服务均未重启。

**不能混淆两组执行者：**

- 目标是 `ask_li_ahua` 的协助 worker，模型 **claude-sonnet-4-6**，不是小腻主 Agent。本次从 worker 入口调用真实 `runSherlockFork`；公网 fork ID `recaptcha-lab-1789301883303`。20:18:41 Google 返回 `success=true`、`hostname=captcha.liahuas.top`，但本轮被直接放行，未证明图片解题能力。该 worker 最终仍在 32 turn / 30 次工具调用后返回空结果，不能把网页成功等同于 Goal 正确收口。
- **Codex 独立对照**使用全新未登录的无头 Chromium，触发了消防栓、自行车等真实图片题。截图识别及自行车、公交车图片点击由 Codex 执行，不是上述 Sonnet worker；自行车提交后 Google 显示“请重试”，随后出现公交车、红绿灯题，未取得图片挑战后的最终成功验证。用户询问执行者后停止 Codex 代选并关闭该独立浏览器。不得把这组操作计入目标 Agent 成绩。

实验探针可用 `RECAPTCHA_LAB_URL=https://captcha.liahuas.top RECAPTCHA_REQUIRE_IMAGE_CHALLENGE=true` 明确要求区分图片题与直接放行。两组结果证明网站已接入并能触发真实图片题；**当前目标 Agent 通过图片挑战仍未验证**。

### 独立 Input 的分阶段 Goal 实验（2026-09-13）

用户进一步要求用新 Input 的独立 worker，不写“忘掉历史”，目标为完成页面中的真实图片挑战，成功返回 `10`。实验实现见 [scripts/README.md](../../scripts/README.md#recaptcha-自有站点实验)：观察只读取当前截图及题目，决策只读取本帧结构化观察，执行器落实合法动作，验收独立读取本次真实服务端结果。没有主 Agent 历史、旧推理或跨阶段聊天 replay。每个 stage 的模型仍是 `claude-sonnet-4-6`；所有格子判断由模型产生，Codex 不提供选格答案。

`recaptcha-isolated-1789302629657` 实际执行了 25 个画面步骤、50 次独立 Sonnet 调用，没有通过。首条 `llm_1789302635724_7936e122` 的真实 wire 包含 image，canonical input 仅 1 项，后续每阶段同样为新 Input。日志揭示动态换图未完成时被错误标记为 ready，以及局部目标存在但布尔值为 false；据此收紧观察 Prompt，同时修正加载等待与点击前图片版本校验。失败不能用“已经选了图片”替代最终验收。

站点与阶段契约共 9 项测试通过，覆盖测试/正式密钥边界、Google 拒绝、域名不匹配、重复/越界格子、未加载完禁止动作、模型返回 10 但缺真实证据时拒绝完成。当前只新增实验脚本和 Prompt，未修改主 Agent 请求、fork 克隆前缀或下一 run replay，未部署或重启任何 compose 服务。**生产求助 worker 的改造与真实图片挑战成功验收仍未完成。**

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

### 异步 Goal worker

`ask_li_ahua` 改为与图片任务相同的入队/完成通知边界：调用当轮只写 `xiaoni_help` task 并立即返回 pending；独立 help task worker 领取并持续执行，完成后写 completion notify 唤醒小腻。执行结果必须使用明确完成标签，未完成与普通异常重新排队，缺输入则保留同一 Goal 等待补充。主 agent 不轮询，也不占用原 run 等待 worker。

2026-09-13 17:52（UTC+8）基于 `5ac0c841` 定向 build/up `agent-service`，服务 healthy、runtime enabled，`help_worker_busy` 健康字段生效；executor 和 embedding 容器未重建。异步求助回归 15/15、持久层求助回归 7/7、两支 agent 缓存契约 43/43、持久层 event-id mock/真库各 4/4 通过。全量 agent 测试执行到既有 runtime-enabled 等待用例前 142 项均通过；全量 persistence 的 runtime-control 旧断言漂移在未修改的 main 同样复现，不属于本变更。

部署切换后的首次 heartbeat 预期冷读，随后两次真实 Anthropic heartbeat 均读取 382,253 / 382,256 input tokens。受控相邻持久 slice `llm_1789293377372_40674028`、`llm_1789293392098_f9f79a82` 均读取 382,253 / 382,256；完整 `wire_request` MD5 同为 `8e0f25764e468b8e918f55b6375b140a`，system/tools MD5 分别同为 `8b31d4f0155d80db0947135304719ffd`、`214f44a7204d95fca355071ccdda8116`。这验证了工具描述切换后 fork 前缀重新稳定，也验证了下一主 run 所依赖的冻结 request 前缀没有随 run 或时间漂移。
