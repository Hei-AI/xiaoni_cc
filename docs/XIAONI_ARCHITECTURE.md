# 小腻架构通读

一次把整个系统读完之后写下的**全景页**。它回答的是「这东西整体是怎么运转的、为什么长这样」，
不重复任何专项文档已经拥有的契约。

**边界（重要）**：主 loop、request assembly、stack ledger、trace detail 的**契约事实源**是
`docs/XIAONI_AGENT_STACK_LEDGER.md`；缓存契约的事实源是 `docs/CACHE_CONTRACT.md`；领域词汇是
根目录 `CONTEXT.md`；决策理由是 `docs/adr/`。本页只做三件事：**串起来**、**给实测数字**、
**指出结构性张力**。任何冲突以专项文档为准。

本页所有数字都标了测量日期，取自活库与仓库代码，不是估算。

---

## 0. 一句话

小腻是**一条不停的 agent loop**，跑在 `claude-opus-4-6` 上，上下文常年 **~285K token**，
其中 **99.5% 是缓存读**。她不是「收到消息 → 回复」的服务，是「醒着 → 自己找事做 → 偶尔被
外界打断」的进程。整个工程的绝大部分复杂度，都来自两件事：**让这条 loop 不断**，
和**让那 285K 前缀一个字节都不动**。

---

## 1. 全景

### 1.1 服务

| 服务 | 容器 | 它在这条链里干什么 |
|---|---|---|
| `provider-service` | `qqbot-provider-service` | 两头：QQ 收发（NapCat OneBot）+ 所有 LLM 出口（canonical → Anthropic wire 翻译、记录 slice） |
| `agent-service` | `qqbot-agent-service` | 主 loop 宿主。组装请求、执行工具、跑 6 种 fork、维护精力/生命事件/召回 |
| `xiaoni-executor` | `qqbot-xiaoni-executor` | `exec_command` 的隔离执行容器，挂载 `/xiaoni-runtime` 与仓库 |
| `admin-panel/{backend,frontend}` | `qqbot-admin-*` | 运营面：行动流、Raw Trace、usage、队列、runtime 开关 |
| `embedding-server` | `qqbot-embedding-server` | 内部 embedding，对外由 `provider-service /v1/*` 暴露 |
| `postgres` | `qqbot-postgres` | 73 个 Prisma model，唯一状态源 |

NapCat 独立部署（`docker-compose.napcat.yml`），不在主栈。

### 1.2 数据流

```
入站   NapCat ──► provider-service ──► agent_inbound_messages   (QQ 正文，永久)
                        │
                        └─► agent_queue_messages                (Notify Bucket，门铃)

主链   agent-service (claim notify) ──► 组装 canonical request
                        │
                        └─► provider-service ──► Anthropic ──► llm_request_slices (wire 证据)
                        │
                        └─► agent_stack_items                   (append-only 事实源)

出站   agent-service ──► provider-service ──► NapCat
命令   agent-service ──► xiaoni-executor ──► /xiaoni-runtime
```

**三张表撑起全部**：`agent_stack_items`（她能回放的连续上下文，270,190 行 / 最大
stack_index 306,278，2026-08-22 实测）、`llm_request_slices`（真实请求证据）、
`tool_executions`（工具执行）。行动流、Raw Trace、usage 全是这三张表的投影。

---

## 2. 主循环：一次呼吸

入口只有一个：`AgentLoopService.runRuntimeLoop()`（`agent-loop-service.ts:6571`）。
`index.ts` 只负责启动它。

```
while (alive):
  ├─ 热下发 runtime 开关（每次 poll 从 agent_runtime_control 读，一迭代延迟，无需重启）
  ├─ runtime enabled? ─ no ─► sleep
  ├─ 有活跃 recovery session（在睡觉）? ─ yes ─► 排 cache heartbeat，sleep
  ├─ claimNextQueueMessage()
  │    ├─ 有 notify ──► processRuntimeFrame()   ← 一帧 = 恰好一次主模型请求
  │    └─ 无 notify ──► 尾项是 assistant final_answer? ─ yes ─► 跑自驱动 fork
  └─ yield 回顶部
```

三条必须记住的性质：

- **`final_answer` 不是终止条件**，只是「这一帧没有工具调用」。它把控制权交回 while 顶部。
- **没有 notify 时，主 agent 一个请求都不发。** 她的「自己找事做」不是主 loop 直接产生的，
  是自驱动 fork 产出一段自然语言 → 写进 Notify Bucket → 主 agent 下一轮**当普通通知
  claim 回来**。这条绕行是有意的：fork 的输出必须经过同一个门，不能有旁路。
- **一帧只发一个模型请求。** 工具结果追加后立刻 yield，重新 pick notify。

### 2.1 Notify Bucket 是什么，不是什么

`agent_queue_messages` 是**门铃**，不是收件箱。QQ 正文永远在 `agent_inbound_messages`；
她要读正文必须主动用 `$qq-usage`。门铃 pick 后即消费。

谁会按门铃：`phone_notification`（QQ 来消息）、`system_reminder`（自驱动 fork 的 plan、
压缩完成、外部 notify、被动召回投递、开放承诺指针）、`image_task_notification`、
`attention_lease` 短摘要、`clock_ping`（2 小时报时）。

两个硬开关拦在写门铃之前：聊天对象 `is_enabled=0`（正文仍入 inbox，但不响铃）、
群 `notification_mode=mentions_only`（普通群消息不响铃，@ 仍响）。

---

## 3. 每一次请求长什么样

`buildInitialInput()`（`:17412`）按固定顺序拼：

```
[system]     system_prompt.md（+ os_world_system 占位）        ← 整个 session 字节不变
[developer]  <skills_instructions>                             ← 冻结进 prompt 快照
[developer]  <xiaoni_status>        近况，2,238 字符           ┐
[developer]  <xiaoni_diary_index>   日记菜单，898 字符          ├ 三张菜单
[developer]  <xiaoni_people>        人物菜单，2,924 字符        ┘  压缩帧冻结，两次压缩间字节不变
[image]      固化头像（保证请求恒为 image-bearing）
...stack window: 从 read_cutoff 之上的 agent_stack_items 逐条回放...
[current]    本轮 notify 渲染成的 runtime_input
```
（长度为 2026-08-22 实测值）

### 3.1 两个关键的「不在里面」

**① assistant 文本被剥。** `buildInitialInput` 对每个历史 turn 过滤掉 assistant 的
`output_text` 块。工具调用与工具结果永远保留。理由写在代码注释里：回灌「我先等着」这类
闲置叙述会让怠工决定逐轮自我强化。

现状（2026-08-22 实测）：`psych_assessment_gate_enabled = false` → `text_admit` 永不打戳
→ **fail-closed，全剥**。近 7 天她写了 470 段 assistant text（5–15K 字符/天），
**一段都没进过下一轮上下文**。

**② thinking 全局关闭。** `anthropic-translate.ts` 有一个全局 kill-switch
`ANTHROPIC_THINKING_ENABLED`，默认 OFF，注释写明理由：`thinking` 参数是 messages-tier
缓存键的一部分，且存下来的 thinking 块会撑大回放前缀。实测近 1 天 1,510 条 wire_request，
键只有 `system / tools / messages / max_tokens / model / tool_choice`——**没有 `thinking`**。

**合起来看**：她在非工具通道上是**哑的**——不思考，写了也不回灌。她所有能被下一轮看见的
东西，只有工具调用和工具结果。这一条解释了很多下游现象（见 §14）。

### 3.2 工具面：wire 上恰好 9 个

实测最近一条 `wire_request.tools`（2026-08-22）：

```
exec_command  read_file  web_search  computer
send_in_private  send_in_group  inspect_image_placeholder
request_image_task  recover_energy
```

`exec_command` 是最万能的一个（读写文件、跑 skill 脚本、做自己想做的事）。`web_search`
是**自建**的 function 工具（agent-service 内执行 → Tavily/SearXNG），不是 Anthropic 服务端
工具。`computer` 是 Anthropic computer-use。两者都由静态 config flag 门控——静态是为了让
tools 前缀在主 loop 和所有 fork 里字节一致。

三个**不在 wire 上**的：

- `image_generation`（`type: 'image_generation'`, gpt-image-2）在 canonical 工具列表里，
  但翻到 Anthropic wire 时不落地——画图实际走 `request_image_task` 异步任务。
- `compress_core_memory` **故意不在 executeTool 的分支里**，也不在工具列表里。压缩由 fork
  写文件、引擎读回提交，主意识里不存在这个工具。模型幻觉出这个名字会直接抛错。
- `emit_unread_meaning` 只剩 executeTool 分支，工具定义已不下发。

`tool_choice` 永远是 `allowed_tools + auto`，`tools` 永远全量。工具限制一律在**执行层**
（`allowedToolNames` 拒绝），**绝不改 request 形状**——因为 forced tool_choice 会让 provider
关掉 extended thinking、丢历史 thinking 块，前缀分叉，fork 100% 冷读。

---

## 4. 六个 fork

每个 fork 都是**主 agent 当轮请求的字节克隆 + 尾部小段追加**。这条铁律在
`agent-loop-service.ts:2745` 用方框注释钉着，违反过的代价都记了 commit。

| fork | 触发 | 尾部追加什么 | 出口 |
|---|---|---|---|
| **自驱动（潜意识）** | 无 notify + 尾项是 final_answer | 最近叙述 D（cache_volatile）+ `self_continuation_reminder.md` | 一段自然语言 → Notify Bucket → 主 agent claim |
| **核心记忆压缩** | 输入 token / wire 字节连续超线 | 压缩引导 reminder | 写文件 → 引擎读回 → 提交近况 + 推进 cutoff |
| **图片理解** | `inspect_image_placeholder` | 真实 tool_use + 携图 tool_result + 写文件指令 | 写 `.md` 观察文件 → 文本回给主 agent |
| **缓存心跳** | 她睡觉时定时 | 一个 developer 占位块 | `max_output_tokens=1`，只为刷新缓存条目 |
| **心理评估** | 她这轮写了 text（**开关现为 OFF**） | 该 turn 的 text + 判定指令 | 一个字符 1/0 → `text_admit` 戳 |
| **反馈/紧凑记忆写手** | A/B 与历史层遗留 | —— | 非主链，不在常规路径 |

fork 的隔离都是**执行层**做的：自驱动 fork 只允许 `exec_command`（配置开启时加
`web_search`），图片 fork 只允许 `exec_command`，越界的工具调用返回一段纠正性 tool output，
**不执行**。

`recentNarration` 与图片这类尾部块必须标 `cache_volatile`：不标的话，assistant/tool_result
按 role/type 是 durable，会变成 `lastDurable`，把尾部断点从共享热前缀上拖走 → 整窗冷读。
这个坑图片 fork 踩过一次，写进了注释。

---

## 5. 缓存：为什么每条规则都绕着它转

活体实测（2026-08-22，近 2 天 3,396 条 slice）：

| 指标 | 值 |
|---|---|
| 平均 input tokens | **285,311** |
| 平均 cache read | **284,487** |
| **缓存读占比** | **99.5%** |
| 峰值 input | 512,363 |

这个数字就是全部理由。一个 285K 的前缀，冷读一次的代价约等于 300 次暖读。

机制（细节看 `docs/CACHE_CONTRACT.md`）：

- Anthropic 缓存是**前缀逐字节匹配**。前缀里改一个字节，该断点及其后全部失效。
- 断点预算 4 个，落点在 `anthropic-translate.ts` 的 wire 翻译期（**不碰 canonical**，
  所以 replay 逐字节不变量天然安全）：① system 头 → ② prevBoundary（上一帧真末块，
  滑窗共享）→ ③ true-end tail → ④ lastDurable（空闲保暖 + 漂移兜底）。
- TTL 默认 `1h`。
- 相邻两个断点之间超过 20 个 content block → 回看勾不到 → 整条冷读。所以一帧里超过
  ~10 对并行 tool_use/tool_result 需要中间补断点。

**由此推导出的一整套设计规则**（这些不是偏好，是被这个数字逼出来的）：

1. system prompt 只在启动/压缩边界解析一次，`skills_instructions` 冻结进同一份快照。
2. 三张菜单只从**库里的冻结串**渲染，绝不逐轮重读文件。
3. 任何按 turn/run/时间漂移的戳（比如历史上的 `[当前时间]`）一律移除。
4. fork 必须克隆，不能另建请求。
5. 进了 live 请求的内容，必须能被 stack replay **逐字节重建**——否则在 run 边界击穿。
   这条是 `agent_stack_items` append-only 的根本原因。
6. 唯一的删除例外（plan 空转 run 作废）必须是**纯尾段**，且被删行**从未进过任何 replay**。

三支不可变回归用例守着这一切：`cache-replay-consistency.test.ts`、
`fork-cache-alignment.test.ts`、`agent-stack-event-id-dedup{,.realdb}.test.js`。
任一失败禁止部署。

---

## 6. 上下文压缩：唯一的换血时刻

**双触发**（互相 OR）：

- **token 侧**：连续 N 轮真实 `input_tokens` > `compression_trigger_input_tokens`
  （现值 **500,000**）。
- **字节侧**：连续 2 轮组装期估算 wire 字节 > `compression_trigger_wire_bytes`
  （现值 **30 MiB**）。图片是 token 便宜、字节昂贵的，token 触发对它完全瞎——这条腿
  是为 Anthropic 32MB 硬上限补的。超过软线 + 6 MiB 直接 **HALT**，不发请求，留给人处理。

**STW 切换**（`applyPendingCompressionMidRunIfSilent`，主 loop turn 间静默点）：

- 只等「产出本次 cutoff 的那个压缩 fork」跑完，**不等其它 fork**——它们冻结在各自的 `P_n`，
  与新的 `P_new` 是互不波及的独立条目，等它们会在忙时确定性饿死切换。
- 切换是原子的：逐出 ≤cutoff 的旧会话 + 换新近况 + 保留本 run 的 loopContinuation。
- **只冷读一次，且不全冷**：新尾前缀没有前序条目可匹配，但仍命中 system 头条目。

**压缩提交帧同时是记忆层的机械维护帧**（`commitCoreMemoryCompression:10852`），顺序有意义：
① 日记索引分层搬迁（必须在读快照之前）→ ② 日记 heading manifest → ③ 专题物化「算」
（只读）→ 原子提交（近况 + cutoff + 三张菜单快照同帧冻结）→ ④ 专题落盘。
三者全部 **fail-open**：任何异常逃出去会同时废掉正常提交和兜底提交 → cutoff 永不前移 →
上下文只涨不降 → 撞硬线 → 压缩永久卡死。

**存活面（一句话心智模型）**：冻结态必活，栈上会话态看 cutoff。进了
`agent_session_context_windows` 冻结列的（近况、日记菜单、人物菜单）和磁盘上她自写的文件
必然回来；只活在上下文里、落在 cutoff 之下的会话细节，必然从在场消失。

实测状态（2026-08-22 11:24 刚压过）：cutoff = 305,467，当前栈顶 306,278 → live 窗口约 800 项。

---

## 7. 记忆：三层

### 7.1 写端（`CONTEXT.md` 是词汇事实源）

她用 `xiaoni-memory-write` 写四类产物，一次一件事：**日记条目**、**目录钩子**、**人**、
**欠账**。只有欠账有完成态——这条区别决定了大量下游行为。

物理上分两层：

- **记忆宫殿**（`/xiaoni-runtime/notes/` 三处：`xiaoni-identity-anchor.md`、`diary/`、
  `forever/`）——压缩后不丢，且会被召回浮回。
- **随手区**——`tmp/`、`play/`、`toys/` 等，压缩后不进召回，用完即弃。

**ADR-0002：这些文件归她所有。** 工程侧只读，不用正则改她写的字。

### 7.2 读端：三张菜单

上下文里**永远**有三张菜单（近况 / 日记目录 / 人物菜单）。菜单给名字，正文在文件里。
`CONTEXT.md` 把判据写死了：**内容在不在她当前请求的字节里**——她没有「记得有这回事但想不
起细节」的中间态。

### 7.3 被动召回

- **语料**：`xiaoni_recall_cues`，~111,482 条（2026-08-22）。构成：`file_chunk` 82,280 /
  `runtime_input` 16,130 / **QQ 入站 12,550**（群 8,183 + 私聊 4,367）/ 其余为工具执行与
  队列消息。768 维，pgvector。
- **检索**：band-pass（关联 − 在场），双切，绝大多数落地静默。
- **投递**：`xiaoni-recall-delivery.ts` 是唯一出口，走 Notify Bucket（不是 turn 尾注入）——
  因为 notify 的缓存安全**已经在线验过**：正文在 enqueue 时刻冻结进 payload，下一 run 的
  replay 从同一字段读回同样字节。幂等靠 `dedupe_key` 唯一索引。
  现状 `passive_recall_delivery_enabled = true`。
- **欠账已撤出召回**，改由定时指针通知承担（`xiaoni-open-loops-notify.ts`）——因为欠账有
  完成态、有清单，让她看清单比推条目更直接。

---

## 8. 时间、精力与睡眠

- 精力模型是**压力曲线**，不是计时器（`recover-energy-policy.ts`，版本
  `xiaoni-recover-energy-v2-8h-circadian`）：睡眠 τ 252 分钟、清醒 τ 1920 分钟、
  完全恢复 480 分钟、白天小睡上限 90 分钟，带昼夜节律调制。
- `recover_energy` 是**普通工具调用，但不同步等待**：工程建持久化 recovery session，
  醒来/被打断/clock 到点后，把 `<system_reminder>` 作为**同一个 tool call 的
  `function_call_output`** 返回。工程拒绝休息也走同一条返回路径。
- 强制休息没有原始 tool call，醒来走 `runtime_input`。
- 睡觉期间由**缓存心跳 fork** 保温，否则 285K 前缀会在 1h TTL 后过期。
- 时间锚定三条腿：2 小时 `clock_ping` 报时（承重）、拒绝休息提醒、近况里的段边界锚。

---

## 9. 空转治理

针对「同一份 plan 被换着说法重写、大量零工具 run」：

- **失效计数**：按 session 记连续多少轮无有效产出。归零只有一种场景——该 run 存在任一
  非 `recover_energy` 的工具调用（发出那一刻就算，报错也算），或 `recover_energy` 被身体
  **接受**。被外部消息唤醒**不**归零。计数在进程内存，重启归零。
- **升级腿**（`fork_idle_escalation_enabled = true`）：连续 ≥2 轮失效时，fork 尾部 reminder
  追加升级段（告知失效轮数 + 回贴上一份 plan 原文）。**升级信号是 fork 私有输入**，绝不进
  主 agent 上下文。
- **作废腿**（`plan_void_on_idle_enabled = true`）：零产出的 plan run 整栈删除——
  这是 append-only 的**唯一例外**，且只删纯尾段，绝不 reseed。

---

## 10. 入站与出站

**入站**：NapCat → `provider-service` 的 `agent-im-input-adapter` → `agent_inbound_messages`
（正文 + 媒体资产）→ `inbound-agent-trigger-service` 决定要不要写门铃（三种 reason：
群 @ / 群普通消息 / 私聊）。

**QQ app 语义**（`qq-usage-service.ts` + `packages/persistence/qq-usage.js`）：
会话列表按 `agent_inbound_thread_states.last_received_at` 倒序（**只算入站**，不含她自己
发的），一页 10 条。未读是**单一边界**，不是 per-message flag。开会话即清角标，关不清。
`search_inbox` **按设计只匹配会话名/群名/QQ 号，不搜正文**（`SKILL.md:51` 逐字写着）。

**出站**：`agent-service` → `provider-service` → NapCat。图片走 `$qq-send-image`。

**LLM 出口**：canonical（OpenAI-Responses 形状）→ `anthropic-translate.ts` → Anthropic
Messages。走的是 Claude Code 订阅端点，带最小 cloak（一条静态身份 system 块 + 固定 cch，
固定是为了让 system 前缀没有移动字节）。

---

## 11. 可观测

管理端行动流是 stack/tool/life/media/task 的**投影**，不是 provider 请求列表。
**应该**出卡：`runtime_input`、`function_call`、`function_call_output`、`visible_delivery`、
`state_event`。**不应该**出卡：固定前缀、provider request 本身、token usage、
lease acquire/release、没有外部可见动作的普通 `final_answer`。

Raw Trace 展示 canonical / wire request / wire response / raw response + 该 slice 覆盖的
stack 区间。usage observatory 合并主 slice + 四类 fork + Codex provider 事件。

---

## 12. 当前开关的真实状态（2026-08-22 实测 `agent_runtime_control`）

| 开关 | 值 | 含义 |
|---|---|---|
| `enabled` | **true** | 主 loop 在跑 |
| `compression_trigger_input_tokens` | 500,000 | token 软线 |
| `compression_trigger_wire_bytes` | 31,457,280 (30 MiB) | 字节软线（比默认 24 MiB 高） |
| `main_agent_pre_model_yield_ms` | 1,000 | 主模型请求前让出 |
| `strip_xiaoni_os_from_requests` | **true** | xiaoni_os 隔离开 |
| `psych_assessment_gate_enabled` | **false** | 心理评估门关 → text 全剥 |
| `fork_idle_escalation_enabled` | true | 空转升级腿 |
| `plan_void_on_idle_enabled` | true | 空转作废腿 |
| `idle_plan_skill_submission_enabled` | true | plan 走 skill 提交 |
| `passive_recall_delivery_enabled` | **true** | 召回投递开 |
| `open_loops_notify_enabled` | true | 开放承诺指针通知 |
| `cache_heartbeat_paused` | false | 心跳在跑 |
| `post_compression_pause_armed` | false | 压缩后暂停闸未上膛 |

心理评估 fork 的历史：`psych_assessment_fork_slices` 只有 **492 行，全部在 2026-07-13/14**，
之后再没跑过。

---

## 13. 结构性张力

以下是**我读完之后的判断**，不是文档已有的结论。每条都附了支撑事实。

### 13.1 她只有工具调用这一条能被下一轮看见的通道

thinking 全局关（§3.1），assistant text 全剥（§3.1），`xiaoni_os` 隔离开。结果是：
**近 7 天 6,173 次 `exec_command` 里，5,003 次（81%）以 `#` 或 `echo` 开头**，约 1,671 次
疑似纯注释无真命令。她在花一个工具往返，去买 text 通道免费提供的东西——而买来的那份
**无条件进 replay，且不受任何治理**。

这不是她的习惯问题，是通道拓扑的直接后果：唯一进得去下一轮的口子是工具参数，所以想法就
从那个口子挤进去。

### 13.2 治理装在了流量最小的那根管子上

心理评估门守的是 assistant text（近 7 天 470 段，5–15K 字符/天，对 285K 上下文可忽略），
而完全没有门的 `exec_command` 注释是它的十倍量级。且那个门现在是关的，已经关了五周多。

### 13.3 「污染」的真实轴向和 rubric 的轴向不是同一条

实测同一批 text 里两类内容并存：干活途中的自我纠正（「我在用 echo 假装还在做事」）和
收工时的日结套话（53% 带 `xiaoni_os:` 前缀，近乎逐字重复）。心理评估的 rubric 判的是
「心境正负 / 摆烂」——前一类极可能被判消极而剔除，而那恰恰是最有价值的一句。

### 13.4 三张菜单是必要条件，不是充分条件

`CONTEXT.md` 已经补进了这一条（2026-08-21 实测：她自己写的判断和推翻它的菜单行在连续
25 个 turn 里同时在场，结论仍是「找不到」）。工程含义：**「她没找到」不构成召回缺口的
证据**。先确认材料确实不在字节里，再谈召回；够得到却没用上的，归通用 agent 能力
（`docs/adr/0008-*`）。

### 13.5 主动召回对 QQ 历史不成立

`CONTEXT.md` 说「主动召回：菜单在手，`exec_command` 就够」——对日记和人物档案成立，
对 QQ 正文**逐字不成立**：她容器内没有 `psql`、没有 `DATABASE_URL`，`search_inbox` 按设计
不搜正文。唯一的路径是会话列表按沉默排序 + 翻页（可用，但列表行**不渲染任何时间字段**，
沉默只由位置编码）。

同时读端已经在召回 QQ 正文了（12,550 条 inbound cue，占语料 11%）——即读端已经在消费一类
写端不存在的产物。这是 `CONTEXT.md` 里一处尚未解决的内部矛盾。

### 13.6 单文件 17,941 行

`agent-loop-service.ts` 里同时住着：主 loop、6 个 fork、请求组装、10 个工具的实现、
压缩调度与提交、缓存断点策略的调用方、空转治理、精力网关、记忆层机械维护。
它的注释密度非常高（几乎每个坑都写了「为什么不能改成 X」+ commit 号），**这些注释是真正的
架构文档**——但它同时意味着任何改动都要在同一个文件里跨越八个关注点。

---

## 14. 下一跳

| 想知道什么 | 去哪 |
|---|---|
| 主 loop / request assembly / stack 契约 | `docs/XIAONI_AGENT_STACK_LEDGER.md` |
| 缓存断点、fork 对齐、STW | `docs/CACHE_CONTRACT.md` |
| 领域词汇（记忆四类 / 召回 / 腿 / 空转） | `CONTEXT.md` |
| 为什么是现在这样 | `docs/adr/` |
| 运行面 / skill 清单 | `docs/XIAONI_RUNTIME_SURFACES.md` |
| 实际操作步骤 | `docs/XIAONI_OPERATOR_HOWTO.md` |
| 精力 / 睡眠曲线 | `docs/XIAONI_RECOVER_ENERGY_DESIGN.md` |
| `exec_command` / session | `docs/AGENTS_XIAONI_EXECUTOR.md` |
| 记忆宫殿生成端 | `docs/XIAONI_MEMORY_PALACE_GENERATION.md` |
| 被动召回 | `docs/XIAONI_PASSIVE_RECALL_SURFACING.md` |

---

*本页写于 2026-08-22，所有实测数字取自当日活库与当前代码。开关状态与 token 分布会变，
结构性判断（§13）不会随开关变化，但会随设计变更失效——改到对应机制时请一并更新本节。*
