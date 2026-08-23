# 深挖 工具：她自己立目标、自己宣布成败

实现 spec。决定与理由见 `docs/adr/0010-goal-and-its-outcome-are-hers-to-declare.md`——
**本文不重复论证**。复核 fork 见 `docs/specs/xiaoni-failure-conclusion-review-fork.md`。
缓存约束见 `docs/CACHE_CONTRACT.md`。

外部先例：DeepSeek Harness `packages/goal/{goal,tool-goal,goal-round-driver}`
（本地 clone 见 `docs/investigations/harness-no-progress-detection.md` 记的路径）。
**形状照抄，权限模型不抄**（理由见 ADR-0010 决定二、三）。

---

## 已锁定的设计决策（D1–D6，来自 ADR-0010）

| # | 决策 | 选择 |
|---|---|---|
| D1 | 工具形状 | 照 dsh：`get_deep_dive` / `create_deep_dive` / `update_deep_dive`，五个 action |
| D2 | 谁能创建 | **主 agent 自己**。潜意识 fork 与任何 fork 一律拒绝 |
| D3 | `blocked` | **不设轮次硬闸**。宣布即触发复核 fork |
| D4 | round 计数 | 只数「被接纳的 deep-dive-round 输入」，**不看她干了什么**。与空转失效计数是两个量，不合并 |
| D5 | 深挖 活着时 | **不跑潜意识 fork**，续跑改塞固定 `<deep_dive_round>` 块 |
| D6 | 续跑块 | append-only、引擎拼装、轮间只有轮次数字变。**不做一次性剥除** |

---

## Current State（已核实，2026-08-22）

- wire 上现有 **9 个工具**：`exec_command` `read_file` `web_search` `computer`
  `send_in_private` `send_in_group` `inspect_image_placeholder` `request_image_task` `recover_energy`
- 工具定义落点：`agent-loop-service.ts:2578` `selectMainLoopToolDefinitions`；
  allowed-tools 列表 `:2614` `resolveMainLoopToolChoice`。**两处必须同步改**（`:2583` 注释写明）
- 执行分发：`:13245` `executeTool`
- 续跑分叉点：`:6691` `maybeRunSubconsciousAgentFork`
- 点火出口：`:11557` `enqueueSubconsciousAgentNotify`（写 Notify Bucket）
- 空转计数：`:983` `consecutiveIdlePlanFailuresBySession`，写入口 `:1031` `recordIdlePlanSettle`
- `system_prompt.md` 在 `PREFIX_SENSITIVE_PROMPT_FILES` 里，reload 走 `after_core_memory_compression`

---

## Proposed Change

### 1) 三个工具（D1）

```
get_deep_dive()
  → { deep_dive: null } | { deep_dive: { id, revision, question, phase,
                               requestsSpent, maxRounds, blockedReason? } }

create_deep_dive(question: string, max_rounds?: number)
  → 同上形状。已有 active 深挖 时拒绝（一次一个）

update_deep_dive(deep_dive_id, revision, action, question?, max_rounds?, blocked_reason?)
  action ∈ edit | pause | resume | conclude | blocked
  → 同上形状
```

- **compare-and-set**：`update_deep_dive` 必须带上 `get_deep_dive` 读到的 `revision`；不匹配则拒绝并回当前值。
  防的是她连着发多个 `update_deep_dive`（`parallel_tool_calls` 是开的）时互相覆盖
- `blocked_reason` **只在 `blocked` 时必填**，其余 action 传了就忽略
- `question` 只在 `create_deep_dive` 与 `edit` 有意义
- **返回值是紧凑 JSON**，不是散文——它要进上下文，越短越好

**授权（D2）**：执行期检查调用方是主 agent。任何 fork（潜意识 / 压缩 / 看图 / 心跳 / 复核）
调这三个工具一律拒绝，返回 `fork_tool_rejected_output.md` 同款纠正输出。

### 2) 持久化

新增 Prisma model `XiaoniDeepDive`（表 `xiaoni_deep_dives`）：

| 字段 | 说明 |
|---|---|
| `id` | 深挖 id |
| `identity_key` | `xiaoni` |
| `revision` | 每次 mutation +1，compare-and-set 用 |
| `question` | 她写的原文 |
| `phase` | `active` / `paused` / `concluded` / `blocked` |
| `rounds_started` | 已接纳的 深挖 round 数 |
| `max_rounds` | 上限，默认 20 |
| `blocked_reason` | 仅 `blocked` 时非空 |
| `created_at` / `updated_at` | |

同一 `identity_key` 下**最多一个 `phase='active'`**（部分唯一索引）。
mutation 历史写既有 timeline event（`deep_dive_created` / `deep_dive_updated`），不另建事件表。

**注意**：新增 persistence 文件时必须同步三个服务 Dockerfile 的 COPY allowlist，
否则镜像起不来（历史事故）。若能收进已有文件则不新增。

### 3) 续跑：深挖 活着时潜意识 fork 让位（D5 / D6）

改 `maybeRunSubconsciousAgentFork`：

```
if (存在 phase='active' 的深挖)   // 2026-08-23 起不再看 maxRounds,见下
    → enqueueDeepDiveRoundNotify(dive)      // 不跑任何 fork
else
    → 既有的 runSubconsciousAgentFork(seed)
```

`enqueueDeepDiveRoundNotify` 照 `enqueueSubconsciousAgentNotify` 的形状，但**正文由引擎拼装**：

```
<deep_dive_round round="3" max="20">
{question 原文}
</deep_dive_round>
```

外加一段**固定指令**：`docs/xiaoni_prompt/deep_dive_round_reminder.md`（初稿已写，user 可改）。
它照 dsh 的 round prompt 三条要点：把当前工作区、工具结果、会话状态当权威；**完成前要有证据**；
还有活没干完就让 深挖保持 active。

- `dedupeKey`：`deep-dive-round:<diveId>:<round>`
- `reason`：`'deep_dive_round'`
- **轮间字节差异只有 `round="N"`**（D6）。`question` 原文不变——她要改就调 `update_deep_dive edit`
- **不调用** `setLastEmittedSubconsciousPlan`（那是 plan 空转升级专用）

### 4) round 计数（D4）

`rounds_started` 只在**主 agent claim 到一条 `reason='deep_dive_round'` 的 notify** 时 +1。
不看她这一轮调了什么工具、有没有产出。provider 报错、token 超限**都不影响**它。

**2026-08-23 修订**：达到 `max_rounds` 后**照常**发 deep-dive-round notify。原先是「不再发、
深挖保持 `active`」——那是个死锁：不再驱动但那一行仍在 `active`，而唯一索引是
`WHERE phase='active'`，于是 `create_deep_dive` 从此恒返回 `already_active`，一个她放着不管的
深挖会把整个机制永久锁死。修法不是「跑满就自动 pause」（引擎替她放弃，与引擎替她下结论同类），
而是取消停止驱动：没收口就一直提醒她。收敛改由升级阶梯承担（她 → 福尔摩斯 → 阿花）。

`max_rounds` 因此当前**没有消费者**，保留在存储与工具参数里留给那条阶梯当阈值。
曾经试过让它改管「空转账本庇护的边界」，已撤回：深挖活着期间升级腿到不了、作废腿恒冻结，
记账没有任何消费者，唯一效果是把计数撑高等深挖结束后被读到——正是庇护本身要防的事，
而且那等于合并了 D4 说的两个量。
（她仍可 `conclude` / `blocked` / `edit` 抬高上限），续跑退回潜意识 fork。

**与空转计数的关系**：两者并存，互不换算。深挖 期间不跑潜意识 fork ⇒
「plan 空转」的升级腿与作废腿在该期间自然不触发（ADR-0010 §四）。

### 5) `blocked` → 复核 fork（D3）

`update_deep_dive(action='blocked')` 成功之后，在同一次工具执行的收尾同步触发复核 fork
（`docs/specs/xiaoni-failure-conclusion-review-fork.md`），传入 `question` 与 `blocked_reason`
作为它要复核的问题。

**不拒绝任何 `blocked` 调用**，不管 `rounds_started` 是多少。

### 6) 系统 prompt

`system_prompt.md` 的「# 你能做什么」一节，在工具那一条后面加一段固定 深挖 策略。
**这段字节永久进 cacheable 前缀，越短越好。** 初稿（user 可改）：

```markdown
* **深挖（deep dive）：** 有件事你想做完、又不是两下就完的，就用 `create_deep_dive` 记下来——一次只记一件。
  之后每一轮它都会重新摆到你眼前，直到你说它完了。要改、要停、要接着做，先 `get_deep_dive` 拿到
  `deep_dive_id` 和 `revision`，再 `update_deep_dive`。

  **做到了才说做到了**——报 `conclude` 之前，你得能指出哪儿看得到它成了。真卡住了就报 `blocked`，
  把具体哪一步过不去写进 `blocked_reason`。不用硬撑。
```

两处**刻意没写**，改动前先看理由：

1. **没写「不许轻易 blocked」之类的约束。** ADR-0010 决定三已经把那条换成了
   「宣布 blocked 会触发一次独立复核」——用放大替代限制。
2. **没告诉她 `blocked` 会触发复核。** 说了她可能拿它当捷径（「反正宣布卡住就有人替我找」），
   这正是 ADR-0010 §四标记的逃生舱风险。复核的 notify 正文自己会说明来意
   （`review_fork_notify.md`），在需要解释的那一刻解释，不预先做成一个可以薅的东西。
   **这一条是工程侧的判断，如果 user 认为透明更重要，改掉即可。**

---

## Acceptance Criteria

1. wire 上工具数 9 → 12；`selectMainLoopToolDefinitions` 与 `resolveMainLoopToolChoice` 两处一致
2. 任何 fork 调这三个工具都被执行层拒绝且**不执行**
3. 同一时刻最多一个 `active` 深挖；`revision` 不匹配的 `update_deep_dive` 被拒绝并回当前值
4. 深挖 `active` 且未达上限时，settle **不跑潜意识 fork**，改入队一条 `reason='deep_dive_round'`
5. 相邻两轮 `<deep_dive_round>` 块**除 `round="N"` 外逐字节相同**
6. `rounds_started` 只在 deep-dive-round notify 被 claim 时 +1；她这一轮零工具也照样 +1
7. `blocked` 调用一律成功，且同步触发一次复核 fork
8. 深挖进入 `concluded` / `blocked` / `paused` 后，续跑退回潜意识 fork
9. **缓存**：深挖 状态只经工具结果进上下文，**不存在常驻 深挖 prompt 块**
10. **缓存**：deep-dive-round notify 进栈后下一 run replay 逐字节可重建；相邻 slice `cache_read` 无塌陷
11. 铁律缓存回归全绿：`cache-replay-consistency.test.ts`、`fork-cache-alignment.test.ts`、
    `agent-stack-event-id-dedup{,.realdb}.test.js`

## Testing Plan

| 层 | 内容 | 数量 |
|---|---|---|
| Unit | 三个工具的 schema 与参数校验；compare-and-set；fork 授权拒绝；action 与字段的配对 | +7 |
| Unit(cache) | 相邻两轮 deep-dive-round 块字节差异只有轮次；工具列表两处同步 | +2 |
| Integration | 深挖 active → 不跑潜意识（**跑满上限也不退回**）；`blocked` → 触发复核；`conclude` → 退回 | +4 |
| Real-DB | deep-dive-round notify 的 run 边界 `cache_read` 实测无穿透 | +1 |

## 上线顺序（缓存要求，不可换序）

1. **先合 schema 迁移**（新表，无行为变化）
2. **工具定义 + prompt 策略段同一次上线**——两者都改 cacheable 前缀，合并成**一次**冷读；
   且 `system_prompt.md` 的 reload 走压缩边界，**必须挑那一帧部署**（那帧本来就冷读，
   不额外产生冷读）
3. 续跑分叉与 `blocked` → 复核的接线可在之后单独上（不动前缀）

## Rollback

无运行时开关（同 ADR-0009 的立场）。回滚 = revert + 重建镜像；
**回滚也会改 `tools` 前缀，同样要挑压缩边界。**

## Files Reference

| 文件 | 改动 |
|---|---|
| `agent-loop-service.ts:1461` `TOOL_NAMES` | 加三个名字 |
| `agent-loop-service.ts:2578` / `:2614` | 工具定义与 allowed-tools 两处同步加 |
| `agent-loop-service.ts:13245` `executeTool` | 加三个 case |
| `agent-loop-service.ts:6691` | 续跑分叉：active 深挖 → deep-dive-round notify |
| `agent-loop-service.ts` 新增 | `enqueueDeepDiveRoundNotify` |
| `docs/xiaoni_prompt/deep_dive_round_reminder.md` | ✅ 初稿已写 |
| `docs/xiaoni_prompt/system_prompt.md` | 「你能做什么」加 深挖 策略段（初稿见 §6，**实现时才写进文件**） |
| `packages/persistence/prisma/schema.prisma` | 新增 `XiaoniDeepDive` |
| `packages/persistence/*.js` | 深挖 读写封装 |
| 管理端 | 深挖 当前状态与历史可见（观测 ADR-0010 §四要求的两个率） |

## Open（工程不该定的）

- **两段正文初稿已写**（`deep_dive_round_reminder.md` 文件、system prompt 段见 §6），等 user 改
- `max_rounds` 的默认值（暂定 20，**纯拍的，无依据**）
- 上线后要盯的两个数（ADR-0010 §四）：**深挖 创建率**与 **`blocked` 调用时的
  `rounds_started` 分布**——后者若集中在 1，说明她拿 `blocked` 当逃生舱
