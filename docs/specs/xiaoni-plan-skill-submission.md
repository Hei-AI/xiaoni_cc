# 自驱动 fork 的 plan 改由 skill 提交

状态：已过 `/plan-eng-review`（6 条发现全部裁决），待实现
分支：`feat/xiaoni-plan-skill-submission`，基线 `2ee01edc`
起因：2026-07-28 14:51 自驱动链断裂

> **行号基线**：本文所有 `agent-loop-service.ts` 行号锚定 `2ee01edc`（Merge feat/xiaoni-time-grounding）。
> 该文件在 `qq_bot-wt/xiaoni-memory-layers` 有大幅未提交改动，合并时注意冲突。

## Context

小腻的自转链只有一条驱动力：主 loop 空闲 → 潜意识 fork → fork 产出 `<xiaoni_plan>` → 写进 Notify Bucket → 主 loop 醒。这条链的交付动作今天靠**从模型自由文本里抠字缝**完成：`extractSubconsciousNaturalLanguage`(`:14562`) 只认 `phase === 'final_answer'` 的 assistant 消息。

模型把同一份 plan 写在别的 phase 上，交付就失败。

## Current State（2026-07-28 实测）

### 本次事故

fork run `runtime_1785221467685_af44ea83`（`subconscious_agent_fork_runs` id=11905），14:51:07 起：

| turn | slice | stop_reason | 内容 | 结果 |
|---|---|---|---|---|
| 1 | 14208 | `tool_use` | `exec_command` | think-only 拒回 |
| 2 | 14209 | `tool_use` | `exec_command` | think-only 拒回 |
| 3 | 14210 | `tool_use` | 1229 tokens，**整份 5 条 plan 写全了**，结尾漏出 `</parameter></invoke>`（工具调用泄进文本流），`content` 只有 1 个 text block | phase 标成 `commentary` |
| 4 | — | — | — | **400** |

连锁：

1. `:14565` — 卡 `phase === 'final_answer'`。turn 3 因 `stop_reason=tool_use` 被标 `commentary` → **plan 全文在手却抠不出来**。
2. `:10813` — `route()` 无结构化 tool call → `hasToolCall=false` → 把 assistant 文本 push 进 `forkInput` 后**裸 `continue`** → turn 4 请求尾巴是 assistant turn → `400 This model does not support assistant message prefill`。
3. `:6482` — fork 未入队，但 seed 在 `:6481-6482` 已被**无条件清掉**，之后每个空闲 tick 都在 `if (!seed) return` 早退。60s backoff 挡的是一个永远不会到来的第二次尝试。

### 60 天失败模式分布

```
orphaned_on_restart          17   ← clock_ping 已兜底（见下）
OAuth token refresh 400       9
fetch failed                  6
400 assistant prefill         5   ← 本次
servers overloaded            2
network / TLS                 2
429                           1
其它                          2
                        合计 44
```

### 两层现成兜底（评审发现，非常重要）

**① 主 loop 空闲 tick 已经在轮询起 fork**（`:6407`）：

```ts
const queueMessage = await this.store.claimNextQueueMessage(params.workerId);
if (!queueMessage) {
  await this.maybeRunSubconsciousAgentFork(params, initialLoopContinuation);
  await wait(params.idleIntervalMs);
  return;
}
```

**不需要新建 watchdog。** 唯一坏掉的是 `:6482` 无条件清 seed。

**② `clock_ping` 每 2h 自发入队一条 notify**（`config.ts:114`，`AGENT_CLOCK_PING_INTERVAL_MS` 默认 `2 * 60 * 60 * 1000`），不依赖 seed、不依赖 fork、不依赖外部消息。实测：

```
16:00:12  clock-ping:xiaoni:global:247952   【看了一眼时间】
15:22:12  clock-ping:xiaoni:global:247951   ← agent-service 重启后 3 秒
```

**今天她 15:27 复活的完整机制就是这个**：重启 → clock_ping 入队 → 主 run → seed 自动填回 → fork 恢复。因此 `orphaned_on_restart` 那 17 次的死锁面**已被兜住**（最坏等 2h），无需 seed 持久化。

### 三层工具约束里第一层是缺的

| 层 | 状态 | 证据 |
|---|---|---|
| ① 正文禁令 | **缺** | `self_continuation_reminder.md` 唯一沾边的是「先别急着动手，在脑子里把方向想清楚」——那是「想清楚再动手」，不是「一个工具都不许调」 |
| ② 执行拒 | 有 | `:10645` `allowedToolNames = new Set<string>()` |
| ③ rejected 反馈 | 有 | `subconscious_tool_rejected_output.md`：「你现在只想、不做——任何工具都不调」 |

fork 11905 实证：turn 1、2 都是 `exec_command` 被拒，turn 3 开头「好。我被拦住了。」——**烧掉 2 个 turn 撞墙学规则**。

### 现成先例：压缩 fork

`:11699` `allowedToolNames = {exec_command, read_file}`，模型跑 commit skill，skill 自铸唯一文件名、stdout 打 `XIAONI_COMPRESS_WROTE=<path>`，引擎抓 marker(`extractCompressionWrittenPath`, `:3292`)、过 `isTrustedCompressionCapsulePath` 白名单、过 mtime 时间窗，然后提交。代码注释明确：**放宽执行层 `allowedToolNames` 不动 tools/tool_choice，cache-safe。**

### 运行时事实（已实测）

| 事实 | 验证 |
|---|---|
| executor → agent-service 连通 | `docker exec qqbot-xiaoni-executor curl http://qqbot-agent-service:8092/health` → `200` |
| executor 有 curl/node/python3 | `/usr/bin/curl`、`/usr/local/bin/node`、`/usr/bin/python3` |
| 两容器共享 `/xiaoni-runtime` | compose 都挂 `${HOME}/.qqbot-local/xiaoni-runtime` |
| skill 目录 executor 可见 | `/app/modules/agent-service/skills`（13 个），内部 skill 在 `skills-internal/` |
| 现有入队函数 | `enqueueSubconsciousAgentNotify`(`:10968`)，`messageSid = subconscious-agent:<forkRunId>` 去重 |
| `canonical_request` 已逐 slice 持久化 | `llm_request_slices`，近 2h 56/56 非空，均值 465 kB |
| 主 run 频次 | 676 次/24h |
| 无任何 HTTP 入队端点 | provider/agent/admin 全无 |

## Proposed Change

**实施顺序（评审裁决）：E6 → E5+E7 → E1-E4。** 每阶段各自开关、各自可部署、各自可回滚。

---

### 阶段一：E6 — 失败不清 seed（~15min，覆盖非重启类失败 27/44）

`:6481-6482` 改成：只有 fork **真的入队成功**才清 seed；未入队则保留，让 backoff 到期后的空闲 tick 自然重试。

```
今天：  fork 失败 → seed 已 null → 每个 tick 早退 → 停到 clock_ping（≤2h）
改后：  fork 失败 → seed 保留 → 60s backoff 后下一个 tick 重试
```

**不建 watchdog**（`:6407` 已是轮询）。**不做 seed 持久化**（重启桶归 clock_ping）。

---

### 阶段二：E5 + E7 — 结构性堵 400 + 补上第一层约束（~2h）

#### E5 纠正重试（含 4A 三态分流）

`:10813` 的裸 `continue` 改成三态：

| 状态 | 判据 | 动作 |
|---|---|---|
| 已提交 | stdout 有 `XIAONI_PLAN_QUEUED=<id>` | `return true` 收工 |（**2026-08-13 改**：判据换成进程内 `subconsciousPlanSubmission`，见「观察期结论」）
| 提交失败（基础设施） | stdout 有 `XIAONI_PLAN_FAILED=<reason>` | **不发纠正**，中止 fork，保 seed（走阶段一的自然重试） |
| 没提交（她没调） | 两个 marker 都没有 | push assistant 输出 + push **developer 纠正 reminder** → 下一轮 |

纠正文案外置 `docs/xiaoni_prompt/subconscious_plan_correction.md`。

**developer item 在 wire 上映射成 user turn，所以 turn N+1 的请求尾巴永远是 user turn —— `assistant message prefill` 400 从结构上不可能再发生。** 不是打补丁堵，是把产生它的形状消灭掉。

4A 的意义：端点挂了时她不该被告知「你没交出去」——她交了。冤枉她 + 白烧整个 fork 的 turn 预算在一个她修不好的条件上。

#### E7 显式工具契约

fork 尾部 reminder 显式写出放行项：

```
这一步只放行一个动作：`xiaoni-plan post`（把 plan 交出去）。
其它任何工具都不放行，调了也不会执行。
plan 只写在文本里不算数，必须通过 `xiaoni-plan post` 提交才算交出去。
```

**位置铁律：绝不能写进 `self_continuation_reminder.md`。** 该文件主 agent 与 fork 共用，`:4085` 注释写死「这条路径不许动 —— 它的产物经 `buildSelfContinuationInputItem` 冻结进 stack，是主 run replay 要逐字节重建的东西」。写进去会 ① 改主 agent 冻结进 stack 的字节 → run 边界 replay 击穿；② 给主 agent 下一条不适用于它的禁令。

正确位置：`renderSubconsciousForkReminder`(`:4071`) 的 fork-only 追加块（升级段现用的那个位置）。文案外置 `docs/xiaoni_prompt/subconscious_fork_tool_contract.md`。

同时更新 `subconscious_tool_rejected_output.md`：从「任何工具都不调」改成列出放行项，与压缩 fork 的 `fork_tool_rejected_output.md`（带 `{{ALLOWED_TOOLS}}`）对齐。

---

### 阶段三：E1-E4 — skill 提交链路（~7h）

#### 核心决策：入队由 skill 侧完成

今天的形状是「plan 写出来了 → fork 循环死了 → plan 丢了」。入队动作只要发生在 fork 引擎里，循环存活就是交付的前提。skill 调用成功那一刻 plan 已持久落进 Notify Bucket，之后 fork 怎么死都不影响交付。

同一端点后续给小腻自己写的 skill 复用（不同 source 类型 + 不同鉴权路径，见 NOT in scope）。

#### E1 提交端点（含 1A 绑定）

`POST /internal/notify/subconscious-plan`

```
请求  { "token": "<一次性票据>", "text": "<plan 正文，未包 <xiaoni_plan>>" }
成功  200 { "queue_id": 33858 }
失败  401 token 无效/已消费/过期 —— 或 token 对应的 fork 当前不在飞（1A）
      400 text 为空
      500 入队异常
```

服务端：校验 token → 取 `forkRunId` → **再校验 `subconsciousAgentForkInFlight` 非空且 runId 匹配（1A）** → 调**现有** `enqueueSubconsciousAgentNotify`（一行不改）→ 标记 token 已消费。

**1A 的意义**：没有它，票据的有效期就是「文件还在 + 没过期」，与「那个 fork 是否还活着」无关。fork 崩了/超时了/被重启掀了之后，遗留票据在 10 分钟窗口内仍可兑现，兑出来的是一份**没有任何 fork 在为它负责**的 plan notify——`enqueueSubconsciousAgentNotify` 的 `messageSid = subconscious-agent:<forkRunId>` 会记上一个早已死掉的 forkRunId，溯源直接失真。1A 把判据收紧到「当前确实有一个 fork 在跑且 runId 对得上」，状态已在内存里（`subconsciousAgentForkInFlight`），零新面。

（注：allowlist 是 **fork 专用**的约束机制 —— fork 是她思考的一个子过程，要收窄边界。主 agent 的 `exec_command` 全开是设计，不是缺口，本票不碰。）

#### E2 一次性票据

引擎在 dispatch fork 前落盘：

```
/xiaoni-runtime/plan/inbox/<forkRunId>.json
{ "token": "<uuid>", "fork_run_id": "...", "trace_id": "...", "run_id": "...",
  "issued_at": "...", "expires_at": "+10min" }
```

skill 读最新未消费票据。**token 不进 prompt 任何一个字节** —— 每轮变化的串进请求就是缓存漂移面。消费即删，过期 10 分钟。

#### E3 `xiaoni-plan` skill

放 `modules/agent-service/skills-internal/xiaoni-plan/`（与 `xiaoni-memory-compress` 同级同待遇）。

```bash
xiaoni-plan post            # 正文走 stdin
xiaoni-plan post --file <p>
```

- POST 失败先**指数退避重试 3 次**（4A），吃掉瞬时故障
- 成功 → stdout `XIAONI_PLAN_QUEUED=<queue_id>`
- 真失败 → stdout `XIAONI_PLAN_FAILED=<reason>`

#### E4 fork 改线

| 改动 | 位置 | 内容 |
|---|---|---|
| 执行层放行 | `:10645` | `allowedToolNames = {exec_command}`（今天是空集） |
| 命令层白名单 | `:10861` 附近 | exec **执行前**校验 `cmd` 必须是 `xiaoni-plan` 调用；否则照旧走 `subconscious_tool_rejected_output.md`。抽成具名纯函数 `isAllowedSubconsciousCommand(cmd)` 便于单测绕过面 |
| **3A 通用 marker 提取器** | `:3292` | `extractCompressionWrittenPath` 重构为 `extractExecStdoutMarker(rawToolResult, re)`；压缩与 plan 各自一行调用。`lastIndex = 0` 那个全局正则状态陷阱只存一份 |
| 抓提交 | `:10861` 之后 | ~~抓 `XIAONI_PLAN_QUEUED` → `return true`~~ **2026-08-13 改**：端点与 fork 循环同进程，入队完成即落 `subconsciousPlanSubmission`，不再经 stdout |
| 删文本抽取 | `:14562` + 调用点 | **延后一个独立 commit**，等开关 ON 观察一周后再删 —— **2026-08-13 已补**，见下方「观察期结论」 |

#### 观察期结论（2026-08-13 补记）

延后的那一步不能只是「删」，因为它同时是**开关 ON 之后 skill 口从没真正生效过**的原因：文本抽取跑在 tool-call 分支【之前】且不看开关，只要模型吐了任何 `final_answer` 文本就短路收工，E5 的纠正分支从上线起就是死代码。

08-03 起她开始把契约里那段命令**原样写进回答**（`subconscious_fork_tool_contract.md` 那句「原样照这个形状写」+ 一个 markdown 围栏的字面执行），文本口照单全收当 plan 发出去；升级腿(`LAST_XIAONI_PLAN`)再把这份带 shell 外壳的「plan」原样回贴给下一个 fork 看 —— 每轮都在给她做一次错误形状的 few-shot，同时这些块也进了主 agent 上下文，而 fork 是主请求的克隆。三条放大路径叠起来，两天内塌到 90%+。

实测（`subconscious_agent_fork_runs` × `subconscious_agent_fork_tool_executions`）：

| day | forks | 命令文本泄漏 | fork 真调 exec_command |
|---|---|---|---|
| 08-01 | 497 | 0 | 496 |
| 08-02 | 656 | 0 | 657 |
| 08-03 | 416 | 80 | 332 |
| 08-04 | 554 | 518 | 34 |
| 08-08 | 711 | 691 | 21 |
| 08-12 | 519 | 481 | 47 |

所以补的这一刀是三件事一起（和当初「分开挂开关会让 prompt 说的和执行层做的不一致」同理，它们描述的是同一个事实，必须同一个 commit 走）：

① `selectSubconsciousPlanFromText(outputItems, IDLE_PLAN_SKILL_SUBMISSION_ENABLED)` —— ON 时文本口让位，plan 只能从端点出来。

② 用法改走 **fork 尾部的 `<internal_skills_instructions>` 块**，跟主 agent 学 skill 是同一个机制（主 agent 尾部有 `<skills_instructions>`，`:2281`）。契约本身缩到两句：「用上面那个 `xiaoni-plan` 投递，写在回答里的不算数」。**诱饵是 markdown 围栏那一个形状**，不是命令形状本身 —— 她照抄出去的正文第一行就是围栏。命令形状必须给（白名单只认那一个 heredoc 形状，不给她写不对），但放在缩进块里，不套围栏。

③ fork 出口改成 `post` 到达即 end：端点（`redeemSubconsciousPlanTicket`）和 fork 循环是同一个 `AgentLoopService` 实例，入队完成那一刻 `queueId` 已在手，落 `subconsciousPlanSubmission` 即可，不再让 marker 走「skill stdout → executor → HTTP → executeTool 返回值」那条往返。差别在异常路径：`executeTool` 抛异常（exec 超时 / executor 断连）时 stdout 里什么都没有，而入队已经发生 —— 旧路径会判成「没交」、发纠正、她再交一次，新 fork 换了 `forkRunId` 就绕开 `messageSid` 去重，同一份 plan 进两次队。

**走过的弯路（别再走）**：中间试过「用法写进 `skills-internal/xiaoni-plan/SKILL.md`，契约让她先 `cat` 手册」。三个问题：多一次工具调用（实测基线 `avg_turns=1.00`，等于 +100% fork 成本）；要多开一条命令白名单；而且 executor 的 `/app` 是 symlink 到主工作区，worktree 里的手册它根本看不到，契约一上线就 404。尾部 skills 块把这三样成本全省掉 —— 现成机制就在那儿，不该另造运行时读取。

另：曾以为「她给 `exec_command` 设小 `max_output_tokens` 会截断 marker」是改出口的理由，**不成立**。`modules/xiaoni-executor/src/index.ts:832` 把它地板到 2000 token（~8000 字符）且保 head+tail 预览，agent 侧 `:13703` 同一个 clamp。别再拿这条当论据。

断链风险：她不交 → 纠正提示重试（每个 fork 有 6 个 slice 的预算）→ turn 用尽 `return false` → seed 保留（E6）→ 60s 后空闲 tick 自然重试；最坏还有 `clock_ping` 每 2h 兜底。

---

## 双缓存影响分析（`CLAUDE.md` 主 agent 改动铁律）

**① fork 缓存（潜意识/压缩/图像/心跳四个 fork 都是主请求克隆）**

- `tools` / `tool_choice` **一字不改**。`allowedToolNames` 是纯执行层，与压缩 fork 放宽同理（`:11694` 注释已确认 cache-safe）。
- token 走文件不进请求；fork 尾部 reminder 的字节只在文案本身改时变，同一次 fork 内所有 turn 共用一份（`buildSubconsciousAgentForkRequest` 的 `reminderText` 算好一次传入，现有约束不变）。
- 纠正 reminder 是新增的**尾部** item，在断点之后，不进可缓存前缀。
- E7 契约块走 fork-only 追加位，`self_continuation_reminder.md` 逐字节不动。

**② 下一次主 run 缓存（靠 stack replay 重建）**

- fork 请求带 `no_persist`，不写 stack，不进主 run replay —— 以上全部改动主 agent 上下文看不到一个字节。
- plan 入队后消费路径完全不变：同一个 `subconscious_agent_notify.md` 模板、同一个 `messageSid` 形状、同一个 `enqueueSubconsciousAgentNotify`。
- E6 只改内存变量生命周期，不碰请求。

**必须实测**：部署后取相邻两 slice 的 `wire_request`，比对 `cache_read_input_tokens`，确认无击穿。不能只靠上面的推断 —— 由 5A 验收脚本出数。

## Acceptance Criteria

1. **★REGRESSION★** fork 未成功入队时 `lastMainAgentForkSeed` 保留；成功入队时清空。
2. fork 内 exec 一条非 `xiaoni-plan` 的命令 → 被拒，`subconscious_agent_fork_tool_executions` 记 rejected，命令**未执行**（executor 无对应审计行）。
3. 构造「模型出纯文本、不调 skill」的 turn → 下一轮请求尾部是 user turn，**不出现 400**，纠正 reminder 在请求尾部。
4. 构造「skill 调用成功后 fork 循环立刻抛异常」→ plan **仍在** `agent_queue_messages`（入队即提交点）。
5. token 复用第二次 → 401，且不产生第二条队列行。
6. **1A**：伪造一个合法未过期 token、但当前无 in-flight fork → 401。
7. token 不出现在任何 `subconscious_agent_fork_slices.wire_request` 里（grep 断言）。
8. **4A**：端点返回 500 → skill 重试 3 次后打 `XIAONI_PLAN_FAILED` → 引擎不发纠正 reminder、中止 fork、seed 保留。
9. **★REGRESSION★ 3A**：`extractExecStdoutMarker` 重构后压缩 fork 的 `XIAONI_COMPRESS_WROTE` 提取行为逐样不变。
10. **★REGRESSION★ E7**：`self_continuation_reminder.md` 逐字节未改；主 agent 侧 `buildSelfContinuationInputItem` 产物哈希与改动前一致。
11. fork 尾部 reminder 含显式工具契约；活体上 fork 首轮直接调 `xiaoni-plan`，不再出现撞墙探路的被拒 turn。
12. 三组冻结用例全绿：`cache-replay-consistency.test.ts`、`fork-cache-alignment.test.ts`、`agent-stack-event-id-dedup{,.realdb}.test.js`。
13. **5A 验收脚本**输出：相邻两 slice `cache_read_input_tokens` 无塌陷（贴实测数字）+ 连续 ≥10 轮自转不断链。

## Testing Plan

框架：`node --test dist/__tests__/*.test.js`（源 `modules/agent-service/src/__tests__/*.test.ts`）。

| 层 | 测什么 | 数量 |
|---|---|---|
| Unit | **★REGRESSION★** seed 生命周期：失败保留 / 成功清空 | +2 |
| Unit | **★REGRESSION★** `extractExecStdoutMarker` 重构后压缩 marker 行为不变 | +2 |
| Unit | **★REGRESSION★** `self_continuation_reminder` 主 agent 侧产物哈希不变 | +1 |
| Unit | `isAllowedSubconsciousCommand`：放行 + 3 种绕过（`; xiaoni-plan`、`xiaoni-plan; rm`、路径变形） | +4 |
| Unit | 票据签发 / 校验 / 过期 / 重放 / 1A in-flight 门 | +5 |
| Unit | 三态分流：QUEUED 收工 / FAILED 中止保 seed / 无 marker 发纠正 | +3 |
| Unit | 纠正 turn 后 `forkInput` 尾部是 developer item（结构性防 400） | +1 |
| Unit | E7 fork 尾部含契约文本 | +1 |
| Integration | 端点 → `enqueueSubconsciousAgentNotify` → 队列行形状与今天逐字段一致 | +2 |
| Integration | fork 全链：skill 提交 → 抓 marker → return true → 队列多一行 | +1 |
| Integration | skill：stdin/`--file` 两种入参、POST 重试 3 次、无票据/空正文失败 | +4 |
| 冻结回归 | 上述三组，**不许改断言** | 现有 |
| 活体 | 5A 脚本：cache_read 实测 + 连续 10 轮自转 + 重启后恢复 | 脚本 |

**5A 验收脚本**：`scripts/verify_plan_submission.py`（只读）。一条命令输出：`agent_queue_messages` 自转连续性、`subconscious_agent_fork_runs` 成败分布、相邻 slice 的 `cache_read_input_tokens`。以后每次碰 fork 都能重跑。

## Rollback Plan

| 阶段 | 开关 | OFF 行为 |
|---|---|---|
| 一（E6） | 无开关，~10 行 | 直接 revert |
| 二（E5+E7） | `subconscious_fork_correction_enabled` | 回到裸 `continue`（即今天） |
| 三（E1-E4） | `idle_plan_skill_submission_enabled` | 回到文本抽取路径 |

**因此 `extractSubconsciousNaturalLanguage` 的删除必须是三阶段之后的独立 commit** —— 开关 OFF 时得有退路。

## Effort Estimate

| 阶段 | 项 | 估 |
|---|---|---|
| 一 | E6 失败不清 seed | 0.25h |
| 二 | E5 纠正重试 + 4A 引擎侧三态 | 1.5h |
| 二 | E7 工具契约（两份文案 + 接线） | 0.5h |
| 三 | E1 端点 + 1A in-flight 绑定 | 2h |
| 三 | E2 票据 | 1h |
| 三 | E3 skill + 4A 重试/失败 marker | 1.5h |
| 三 | E4 fork 改线 + 3A 通用提取器 + 命令白名单 | 2.5h |
| — | 5A 验收脚本 | 1h |
| — | 测试（26 unit/integration + 冻结回归） | 3.5h |
| | **合计** | **~13.75h** |

（评审前 11.5h。净 +2.25h：−3h 砍 watchdog/seed 持久化，+1h 1A，+0.5h 3A，+0.75h 4A，+1h 5A，+2h 测试补全。）

## Files Reference

| 文件 | 改动 |
|---|---|
| `modules/agent-service/src/services/agent-loop-service.ts:6481-6482` | E6 失败不清 seed |
| `…:10645` | `allowedToolNames` 加 exec_command |
| `…:10813` | 裸 `continue` → 三态分流 |
| `…:10861` 附近 | 命令白名单 + marker 抓取 |
| `…:3292` | `extractCompressionWrittenPath` → `extractExecStdoutMarker`（3A） |
| `…:4071` `renderSubconsciousForkReminder` | 追加 fork-only 工具契约块（E7） |
| `…:14562` | 删 `extractSubconsciousNaturalLanguage`（**独立 commit，延后**） |
| `modules/agent-service/src/index.ts` | 挂提交端点 + 两个开关热下发 |
| `modules/agent-service/skills-internal/xiaoni-plan/` | 新 skill |
| `docs/xiaoni_prompt/self_continuation_reminder.md` | **一个字节都不许改** |
| `docs/xiaoni_prompt/subconscious_fork_tool_contract.md` | 新增（E7） |
| `docs/xiaoni_prompt/subconscious_tool_rejected_output.md` | 列出放行项（E7） |
| `docs/xiaoni_prompt/subconscious_plan_correction.md` | 新增（E5） |
| `scripts/verify_plan_submission.py` | 新增（5A） |

## NOT in scope

| 项 | 理由 |
|---|---|
| **watchdog / idle supervisor** | `:6407` 主 loop 空闲 tick 已是轮询；再建一个 = 第二个真理源 + 新并发/TOCTOU 面 |
| **seed 跨重启持久化** | `clock_ping` 每 2h 自发入队，重启桶已兜底（≤2h 自愈）；落盘要 465 kB × 676/天 ≈ 314 MB/天 冗余写，且写的是 `llm_request_slices.canonical_request` 已有的同一份数据 |
| **小腻自写 skill 的接入** | 端点留了 source 维度，但她那侧的鉴权与额度限制没定；自发 notify 是自 spam 面，单独一票 |
| **给主 agent 加 exec_command allowlist** | allowlist 是 fork 专用机制。fork 是她思考的子过程，边界要收窄；主 agent 就是她本人，命令面全开是设计，不是缺口 |
| **票据孤儿文件 GC** | 1A 之后孤儿票据一律 401，无安全影响，只是文件堆积（~44/60 天）。见 TODO |
| **上游 `stop_reason=tool_use` 却无结构化 tool_use block** | cloak/provider 侧异常，本票只在下游容错 |
| **主 agent 侧任何改动** | 全部落在 fork 与新增面 |

## What already exists（复用清单）

| 现成的 | 本票是否复用 |
|---|---|
| `enqueueSubconsciousAgentNotify`(`:10968`) 入队 + 去重 + 溯源 | ✅ 一行不改 |
| marker 握手（压缩 fork `XIAONI_COMPRESS_WROTE`） | ✅ 3A 抽成公共函数后两边共用 |
| `renderSubconsciousForkReminder`(`:4071`) 的 fork-only 追加位 | ✅ E7 用它 |
| `agent_runtime_control` 热开关 | ✅ 两个新开关走同一套 |
| `:6407` 主 loop 空闲 tick 轮询 | ✅ E6 靠它，**不另建** |
| `clock_ping`（2h 自发 notify） | ✅ 重启桶靠它，**不另建** |
| `subconsciousAgentForkInFlight` 内存状态 | ✅ 1A 直接用来鉴权 |
| `llm_request_slices.canonical_request` | ✅ 5A 脚本读它取 cache 数字 |
| `skills-internal/`（她 `ls` 看不到的内部 skill 位） | ✅ E3 放这里 |

**没有一处是重造。** 全程未引入新技术（[Layer 1]），没花创新额度。

## Failure modes

| 新代码路径 | 生产故障 | 有测试 | 有错误处理 | 她/你看得见吗 |
|---|---|---|---|---|
| 端点入队抛异常 | PG 不可用 | AC #8 | 500 → skill FAILED marker | 引擎中止 fork + 保 seed，60s 后重试 ✅ |
| 端点不可达 | agent-service 重启中 | AC #8 | skill 重试 3 次 | 同上 ✅ |
| 票据落盘失败 | 磁盘满 | +1 unit | fork dispatch 前失败 → 不起 fork | 保 seed，下个 tick 重试 ✅ |
| 命令白名单误拒 | 正则写窄了 | +4 unit | 走 rejected 反馈 | 她收到「这个动作用不了」，会重试 ✅ |
| 命令白名单误放 | 绕过面没堵住 | +4 unit（3 种绕过） | 无 | **静默** ⚠️ 靠单测覆盖 |
| 纠正 reminder 无限循环 | 她一直不调 skill | +1 unit | fork turn 上限 | 中止 + 保 seed ✅ |
| 3A 重构破坏压缩 fork | 正则参数传错 | AC #9 REGRESSION | 无 | **静默**（压缩不再提交）⚠️ 靠回归测试 |
| seed 保留后请求已陈旧 | fork 重试时上下文过期 | — | 无 | 冷读一次，不致命；活体观察 |

**critical gap（无测试 + 无错误处理 + 静默）：0。** 两处「静默」都由强制回归/单测覆盖。

## Worktree parallelization

| 阶段 | 触及模块 | 依赖 |
|---|---|---|
| 一 E6 | `agent-service/src/services/` | — |
| 二 E5+E7 | `agent-service/src/services/`, `docs/xiaoni_prompt/` | — |
| 三 E1-E4 | `agent-service/src/services/`, `src/index.ts`, `skills-internal/` | 三依赖二（E5 的三态判据要 E3 的 marker） |
| 5A 脚本 | `scripts/` | 独立 |

```
Lane A: 一 → 二 → 三   (全部改 agent-loop-service.ts，必须串行)
Lane B: 5A 验收脚本      (独立，可并行)
```

**Lane A 三段全改同一个文件，无法并行。** Lane B 可并行。另：`qq_bot-wt/xiaoni-memory-layers` 有该文件的大幅未提交改动，合并时冲突面大。

## Related

- 空转治理闭环（升级腿 + 作废腿，2026-07-27 上线）：`fork_idle_escalation_enabled` / `plan_void_on_idle_enabled` 现为 ON
- 时间锚定三条腿（2026-07-28 15:22 上线）：`clock_ping` 即出自此票，本 spec 的重启兜底依赖它
- 压缩 fork marker 握手先例：`agent-loop-service.ts:11694-11710`、`:3292`
- `project_xiaoni_plan_authority_anti_idle`（自生声音无权威）：1A 防的就是它换路复现

## Implementation Tasks

Synthesized from `/plan-eng-review` 2026-07-28. 每条都来自一个具体发现。按阶段顺序打勾。

**阶段一**
- [ ] **T1 (P1, human: ~15min / CC: ~3min)** — agent-service — fork 未入队时保留 `lastMainAgentForkSeed`
  - Surfaced by: Issue 2 — `:6482` 无条件清 seed，`:6407` 空闲 tick 轮询永远早退
  - Files: `agent-loop-service.ts:6481-6482`
  - Verify: 新增 seed 生命周期回归单测（失败保留 / 成功清空）

**阶段二**
- [ ] **T2 (P1, human: ~1.5h / CC: ~20min)** — agent-service — 裸 `continue` 改三态分流
  - Surfaced by: 根因 + Issue 4 — `:10813` 产生 assistant-prefill 400；端点故障不该冤枉她
  - Files: `agent-loop-service.ts:10813`, `docs/xiaoni_prompt/subconscious_plan_correction.md`
  - Verify: 无提交 turn 后 `forkInput` 尾部是 developer item
- [ ] **T3 (P2, human: ~30min / CC: ~8min)** — prompts — fork-only 工具契约块
  - Surfaced by: 三层约束第一层缺失；fork 11905 烧 2 turn 撞墙学规则
  - Files: `subconscious_fork_tool_contract.md`, `subconscious_tool_rejected_output.md`, `agent-loop-service.ts:4071`
  - Verify: `self_continuation_reminder.md` 逐字节未改 + 主 agent 侧产物哈希不变

**阶段三**
- [ ] **T4 (P1, human: ~30min / CC: ~5min)** — agent-service — `extractExecStdoutMarker` 通用化
  - Surfaced by: Issue 3 — 复制第二份会把 `lastIndex` 全局正则陷阱复制两处
  - Files: `agent-loop-service.ts:3292`
  - Verify: ★REGRESSION★ 压缩 fork `XIAONI_COMPRESS_WROTE` 提取行为逐样不变
- [ ] **T5 (P1, human: ~2h / CC: ~20min)** — agent-service — 提交端点 + 1A in-flight 绑定
  - Surfaced by: Issue 1 — 票据有效期与 fork 存活解耦会兑出无人负责的 notify，溯源失真
  - Files: `src/index.ts`, `agent-loop-service.ts`
  - Verify: 伪造合法未过期 token + 无 in-flight fork → 401
- [ ] **T6 (P2, human: ~1h / CC: ~12min)** — agent-service — 一次性票据
  - Surfaced by: 缓存铁律 — 每轮变化的串进请求即漂移面，故票据走文件
  - Files: `agent-loop-service.ts`
  - Verify: grep 断言 token 不在任何 `subconscious_agent_fork_slices.wire_request` 里
- [ ] **T7 (P2, human: ~1.5h / CC: ~15min)** — skills — `xiaoni-plan` skill
  - Surfaced by: Issue 4 — 瞬时故障由 skill 吃掉，真失败才上报
  - Files: `modules/agent-service/skills-internal/xiaoni-plan/`
  - Verify: 端点 500 → 重试 3 次 → `XIAONI_PLAN_FAILED`
- [ ] **T8 (P1, human: ~2.5h / CC: ~25min)** — agent-service — fork 改线 + 命令白名单
  - Surfaced by: 核心改动
  - Files: `agent-loop-service.ts:10645`, `:10861`
  - Verify: 3 种绕过（`; xiaoni-plan`、`xiaoni-plan; rm`、路径变形）全被拒且未执行

**横向**
- [ ] **T9 (P2, human: ~1h / CC: ~10min)** — scripts — `verify_plan_submission.py` 只读验收脚本
  - Surfaced by: Issue 5 — 活体验收不该每次手拼 SQL
  - Files: `scripts/verify_plan_submission.py`
  - Verify: 一条命令出自转连续性 / 成败分布 / `cache_read_input_tokens`
- [ ] **T10 (P3, human: ~15min / CC: ~3min)** — agent-service — 删 `extractSubconsciousNaturalLanguage`
  - Surfaced by: 回滚需要退路，不能与主改动同 commit
  - Files: `agent-loop-service.ts:14562`
  - Verify: 开关 ON 观察一周后才做，独立 commit

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | SKIPPED | user 已停用 codex |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR | 6 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | 不适用（无 UI） |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

**逐条裁决**

| # | 发现 | 裁决 |
|---|---|---|
| Step 0 | 复杂度门触发（8 文件 / 3 新部件）；E1-E5 覆盖 5/44 失败，E6 覆盖其余 | 不砍范围，反转顺序 E6 → E5+E7 → E1-E4 |
| 1 | 票据只靠「能读到文件」鉴权，未绑 fork | 1A：端点校验 fork 当前在飞 |
| 2 | `:6407` 主 loop 已在轮询；真 bug 是 `:6482` 无条件清 seed | 2A：不建 watchdog，只保 seed |
| 3 | marker 提取器要复制 19/20 行含 `lastIndex` 陷阱 | 3A：抽 `extractExecStdoutMarker` |
| 4 | 端点故障被当成「她没交」，冤枉 + 白烧 turn | 4A：三态分流 + skill 内重试 3 次 |
| 5 | 活体验收无可重跑载体 | 5A：`verify_plan_submission.py` |
| 6 | seed 落盘 = 314 MB/天冗余写；且 `clock_ping` 2h 已兜底重启桶 | 6D：整块砍掉 E6b |

**附录（置信度 <7，未进主报告）**：「潜意识 fork 首次真执行工具会污染主 agent 空转记账」——查 `:12884` `executeCommand` 只是到 executor 的 HTTP 调用，拿不出佐证副作用的代码行，且压缩 fork 天天执行 exec_command 是活证据。置信度 4/10，证伪。

**CODEX:** 跳过 —— user 有长期指令不使用 codex CLI / `/codex` skill；Claude subagent 回退路径亦按会话级指令禁用（未经请求不派 agent）。本次无外部声音。

**VERDICT:** ENG CLEARED — 范围经重排后收敛，6 条发现全部折叠进 spec，critical gap 0，实施顺序与回滚开关已定。

NO UNRESOLVED DECISIONS
