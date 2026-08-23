# 复核 fork：她说「找不到」时，第三方替她再查一遍

实现 spec。决定与理由见 `docs/adr/0009-failure-conclusions-need-an-outside-reviewer.md`——
**本文不重复论证**，只写怎么落地。缓存约束见 `docs/CACHE_CONTRACT.md`。

---

## Context

主 agent 调 `update_deep_dive(action='blocked')` 宣布自己卡住时，工程起一个 fork：
克隆她 settle 那一刻的完整请求，尾部换一段第三方引导，用受限 `exec_command` 自己查一遍，
把**可核对的证据**经 Notify Bucket 交回。

它在结构上是自驱动 fork 的孪生兄弟——同一份 seed、同一条出口——**只有触发点、尾部 prompt
和输出契约不同**。因此实现的主体是复用，不是新建。

**前置依赖**：深挖 工具必须先落地，见 `docs/specs/xiaoni-deep-dive-tools.md`。

---

## 已锁定的设计决策（D1–D6，来自 ADR-0009）

| # | 决策 | 选择 |
|---|---|---|
| D1 | 触发点 | 主 agent 调 `update_deep_dive(action='blocked')` 成功之后（见 `docs/specs/xiaoni-deep-dive-tools.md` §5） |
| D2 | 与自驱动 fork 的关系 | 自然互斥——深挖 活着期间本来就不跑潜意识（ADR-0010 决定五） |
| D3 | 上下文 | **克隆** `lastMainAgentForkSeed.canonicalRequest`（settle 那一刻的完整请求），尾部追加第三方引导 |
| D4 | 输出 | **只许证据，不许指令**。每条须含 文件路径 + 原文 + 定位方式 |
| D5 | 出口 | Notify Bucket（settle 后没有开着的 tool call，`function_call_output` 不可用） |
| D6 | 空转 | 由它唤醒的 run **豁免**失效计数 |

---

## Current State（已核实，2026-08-22）

- settle seed 已经存在：`agent-loop-service.ts:6422` `lastMainAgentForkSeed`，
  含 `canonicalRequest` / `settledOnFinalAnswer`，在 `processRuntimeFrame` 收尾捕获（`:8491` 一带）
- 自驱动 fork 的完整链路：`maybeRunSubconsciousAgentFork:6691` → `runSubconsciousAgentFork:11072`
  → `enqueueSubconsciousAgentNotify:11557`
- fork 请求构造：`buildSubconsciousAgentForkRequest`——克隆 + 尾部 `cache_volatile` 重注 + developer 提醒
- 空转计数：`consecutiveIdlePlanFailuresBySession:983`，写入口 `recordIdlePlanSettle:1031`
- fork 账本：`subconscious_agent_fork_runs/items/slices/tool_executions`
- 工具限制走执行层 `allowedToolNames`；`tools` / `tool_choice` 一律不动（`:2620` 方框注释）
- prompt 模板一律外置在 `docs/xiaoni_prompt/`，`readPromptSnippet` 读取

---

## Proposed Change

### 1) 触发（D1）

**她自己声明，引擎不猜。** `update_deep_dive(action='blocked', blocked_reason=...)` 执行成功之后，
在同一次工具执行的收尾同步起复核 fork。

复核 fork 拿到的问题是**现成的结构化字段**：`question`（她当初想做成什么）+
`blocked_reason`（她说卡在哪）。不需要从她的出站文本里推断。

**速率上限**（不是开关，是正确性边界）：同一 深挖的 `blocked` **只触发一次**复核；
她 `resume` 之后再次 `blocked` 才会有第二次。防止反复宣布同一个 blocked 把她自己叫醒。

> **本节在 2026-08-22 当天重写过。** 初版是「引擎检测她说出失败结论」，
> 试过关键词表和「算术窄化 + 小模型判官」两种，都被否——理由记在
> `docs/adr/0009-*` §五之二的表格里，别再走回去。

### 2) 与潜意识 fork 的关系（D2）

**不需要显式互斥判断。** 深挖 处于 `active` 时，`maybeRunSubconsciousAgentFork` 已经改走
deep-dive-round 分支（`docs/specs/xiaoni-deep-dive-tools.md` §3），本来就不跑潜意识。
`blocked` 之后 深挖 离开 `active`，续跑自然退回潜意识 fork——这正确：
那时她需要的是「接下来干嘛」，而复核结论会作为一条独立 notify 到达。

fork 请求的 base 仍是 `lastMainAgentForkSeed.canonicalRequest`（settle 那一刻的完整请求），
**不重新构建**。

### 3) fork 请求（D3）

新增 `buildFailureReviewForkRequest(baseRequest, forkTurn, reminderText)`，与
`buildSubconsciousAgentForkRequest` 同形：

- `cloneCanonicalAgentTurnRequest(baseRequest)`，`store=false`，`parallel_tool_calls=true`
- `metadata`: `failure_review_fork:'true'`, `fork_turn`, `no_persist:'true'`
- input 尾部只追加**一个** developer item：`renderFailureReviewReminder()`
- **`reminderText` 必须整轮固定**：由 `runFailureReviewFork` 算一次后逐轮传入，
  不在 build 里重算（同 `buildSubconsciousAgentForkRequest` 注释里的教训——
  同一次 fork 的所有 turn 必须共用同一份字节，否则 turn-2 起冷读）
- `tools` / `tool_choice` **一个字不改**

### 4) fork 循环（D3）

复用 `runSubconsciousAgentFork` 的循环骨架，参数不同：

| 项 | 自驱动 fork | 复核 fork |
|---|---|---|
| `allowedToolNames` | `{exec_command}`（+ 配置开启时 `web_search`） | `{exec_command}` |
| 工具调用上限 | 5 | **30**（实验实测 22 次） |
| provider slice 上限 | 6 | **32** |
| `max_output_tokens` | `SUBCONSCIOUS_AGENT_FORK_MAX_OUTPUT_TOKENS` | **4000**（证据清单比 plan 长） |
| 完成判据 | 第一个 assistant `final_answer` | 同 |

越界工具返回 `docs/xiaoni_prompt/fork_tool_rejected_output.md` 同款纠正输出，**不执行**。

### 5) 输出契约（D4）

引导 prompt 外置：`docs/xiaoni_prompt/review_fork_reminder.md`（**初稿已写**，user 可改）。要点：

- 你不是小腻。你在复核**另一个 agent** 刚给出的一个失败结论
- 那个结论是：`<她说的原话>`
- 这些文件是她自己写的笔记。**去查。**
- 回来只报**你查到的东西**：每条必须是 `文件路径` + `原文` + `你是怎么定位到的`
- **不许给建议、不许给指令、不许评价她**
- 什么都没查到，就只回一行 `NO_FINDING`

引擎侧：

- 输出以 `NO_FINDING` 开头 → **不投递**，只落账本
- 否则投递

### 6) 出口（D5）

新增 `enqueueFailureReviewNotify`，照抄 `enqueueSubconsciousAgentNotify` 的形状：

- `messageSid` / `dedupeKey`：`failure-review:<forkRunId>`
- `reason`: `'failure_review'`（**空转豁免靠这个字段识别**）
- prompt-facing 渲染模板：`docs/xiaoni_prompt/review_fork_notify.md`
- 正文在 enqueue 时刻冻结进 `payload`，下一 run replay 从同一字段读回 → 逐字节可重建
- **不调用** `setLastEmittedSubconsciousPlan`（那是 plan 专用的空转升级回贴）

### 7) 空转豁免（D6）

`recordIdlePlanSettle:1031` 增加一个入参：本 run 的唤醒 `reason`。
`reason === 'failure_review'` 时**直接返回**，既不 +1 也不归零——**这个 run 在空转账本里不存在**。

同理，作废腿（`plan_void_on_idle_enabled`）对这类 run 不生效：它删的是「零产出的 plan run」，
复核 run 不是 plan run。

### 8) 账本

**推荐做法（增量最小）**：给 `subconscious_agent_fork_{runs,items,slices,tool_executions}`
四张表各加一列 `fork_kind VARCHAR(32) NOT NULL DEFAULT 'subconscious'`，复核 fork 写
`'failure_review'`。纯增列、无数据迁移、不新增 persistence 文件，
**不触发三个服务 Dockerfile 的 COPY allowlist 维护**。

备选（照 `psych_assessment_fork_slices` 的先例另起表族）代价更大，除非将来两者字段真的分化，
否则不建议。

### 9) 观测（ADR-0009 §六，因为不预验隔离性，这条是必需项）

- 管理端 LLM usage timeline 合并这一类 fork 的用量（与另外几类同处理）
- **fork 的输出文本单独可查**（不只存在 slice 的 wire payload 里）
- 上线后**人工读前 20 条输出**，判断人称与语气：
  **若它开口是「我想不起来了」这类第一人称自述，说明克隆没能隔离掉她的身份，
  按 ADR-0009 §六退回全新上下文方案**

---

## Acceptance Criteria

1. `update_deep_dive(action='blocked')` 成功 → 同步起一次复核 fork；同一 深挖的重复 `blocked` 不重复触发
2. 没有 `blocked` 调用时 → 行为与今天逐字节一致（自驱动 fork 照旧）
3. 复核 fork 只执行 `exec_command`；请求其它工具时返回纠正输出且**不执行**
4. 输出 `NO_FINDING` → 不入队；否则入队一条 `reason='failure_review'` 的 notify
5. 由该 notify 唤醒的 run **不改变**失效计数（既不 +1 也不归零），且不被作废腿删除
6. **缓存**：复核 fork 前缀与主 loop 逐字节一致（`fork-cache-alignment.test.ts` 新增用例）；
   同一次 fork 的 turn-1 与 turn-2 的 reminder 字节相同
7. **缓存**：该 notify 进栈后，下一 run 的 replay 能逐字节重建它；
   相邻 slice 的 `cache_read_input_tokens` 无塌陷
8. 铁律缓存回归全绿：`cache-replay-consistency.test.ts`、`fork-cache-alignment.test.ts`、
   `agent-stack-event-id-dedup{,.realdb}.test.js`

## Testing Plan

| 层 | 内容 | 数量 |
|---|---|---|
| Unit | `blocked` → 触发一次且仅一次、`NO_FINDING` 分支、`reason` 透传、`question`/`blocked_reason` 入参 | +5 |
| Unit(cache) | fork 前缀逐字节对齐；同一 fork 多 turn reminder 字节不变 | +2 |
| Integration | `blocked` → 起复核；无 `blocked` → 行为不变；复核 notify → 空转豁免 | +3 |
| Real-DB | notify 进栈后 run 边界 `cache_read` 实测无穿透 | +1 |

## Rollback

**按 user 决定不设运行时开关**（`docs/adr/0009` §五之一的同一立场：不加闸）。
回滚 = revert 该 commit + `docker compose build/up agent-service`。
速率上限（§1）不是开关，是防止反复唤醒的正确性边界，不可省。

## Files Reference

| 文件 | 改动 |
|---|---|
| `agent-loop-service.ts` `update_deep_dive` 执行分支 | `blocked` 成功后同步触发复核 |
| `agent-loop-service.ts` 新增 | `buildFailureReviewForkRequest` / `runFailureReviewFork` / `enqueueFailureReviewNotify` |
| `agent-loop-service.ts:1031` `recordIdlePlanSettle` | 增 `reason` 入参 + 豁免分支 |
| `docs/xiaoni_prompt/review_fork_reminder.md` | ✅ 初稿已写 |
| `docs/xiaoni_prompt/review_fork_notify.md` | ✅ 初稿已写 |
| `packages/persistence/prisma/schema.prisma` | 四张 fork 表各加 `fork_kind` |
| `packages/persistence/*.js` | fork 账本写入带上 `fork_kind` |
| 管理端 usage timeline | 纳入新 fork 类型 |

## Open

- `review_fork_reminder.md` 与 `review_fork_notify.md` **初稿已写**，措辞归 user——
  给她看的那一面（`<xiaoni_recheck>` 块怎么说话）最终不由工程定
- 前置依赖：本 spec 只有在 `docs/specs/xiaoni-deep-dive-tools.md` 落地之后才可实现
