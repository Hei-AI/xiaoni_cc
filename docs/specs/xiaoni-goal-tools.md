# goal 工具：她自己立目标、自己宣布成败

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
| D1 | 工具形状 | 照 dsh：`get_goal` / `create_goal` / `update_goal`，五个 action |
| D2 | 谁能创建 | **主 agent 自己**。潜意识 fork 与任何 fork 一律拒绝 |
| D3 | `blocked` | **不设轮次硬闸**。宣布即触发复核 fork |
| D4 | round 计数 | 只数「被接纳的 goal-round 输入」，**不看她干了什么**。与空转失效计数是两个量，不合并 |
| D5 | goal 活着时 | **不跑潜意识 fork**，续跑改塞固定 `<goal_round>` 块 |
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
get_goal()
  → { goal: null } | { goal: { id, revision, objective, phase,
                               roundsStarted, maxGoalRounds, blockedReason? } }

create_goal(objective: string, max_goal_rounds?: number)
  → 同上形状。已有 active goal 时拒绝（一次一个）

update_goal(goal_id, revision, action, objective?, max_goal_rounds?, blocked_reason?)
  action ∈ edit | pause | resume | complete | blocked
  → 同上形状
```

- **compare-and-set**：`update_goal` 必须带上 `get_goal` 读到的 `revision`；不匹配则拒绝并回当前值。
  防的是她连着发多个 `update_goal`（`parallel_tool_calls` 是开的）时互相覆盖
- `blocked_reason` **只在 `blocked` 时必填**，其余 action 传了就忽略
- `objective` 只在 `create_goal` 与 `edit` 有意义
- **返回值是紧凑 JSON**，不是散文——它要进上下文，越短越好

**授权（D2）**：执行期检查调用方是主 agent。任何 fork（潜意识 / 压缩 / 看图 / 心跳 / 复核）
调这三个工具一律拒绝，返回 `fork_tool_rejected_output.md` 同款纠正输出。

### 2) 持久化

新增 Prisma model `XiaoniGoal`（表 `xiaoni_goals`）：

| 字段 | 说明 |
|---|---|
| `id` | goal id |
| `identity_key` | `xiaoni` |
| `revision` | 每次 mutation +1，compare-and-set 用 |
| `objective` | 她写的原文 |
| `phase` | `active` / `paused` / `completed` / `blocked` |
| `rounds_started` | 已接纳的 goal round 数 |
| `max_goal_rounds` | 上限，默认 20 |
| `blocked_reason` | 仅 `blocked` 时非空 |
| `created_at` / `updated_at` | |

同一 `identity_key` 下**最多一个 `phase='active'`**（部分唯一索引）。
mutation 历史写既有 timeline event（`goal_created` / `goal_updated`），不另建事件表。

**注意**：新增 persistence 文件时必须同步三个服务 Dockerfile 的 COPY allowlist，
否则镜像起不来（历史事故）。若能收进已有文件则不新增。

### 3) 续跑：goal 活着时潜意识 fork 让位（D5 / D6）

改 `maybeRunSubconsciousAgentFork`：

```
if (存在 phase='active' 的 goal && roundsStarted < maxGoalRounds)
    → enqueueGoalRoundNotify(goal)      // 不跑任何 fork
else
    → 既有的 runSubconsciousAgentFork(seed)
```

`enqueueGoalRoundNotify` 照 `enqueueSubconsciousAgentNotify` 的形状，但**正文由引擎拼装**：

```
<goal_round round="3" max="20">
{objective 原文}
</goal_round>
```

外加一段**固定指令**：`docs/xiaoni_prompt/goal_round_reminder.md`（初稿已写，user 可改）。
它照 dsh 的 round prompt 三条要点：把当前工作区、工具结果、会话状态当权威；**完成前要有证据**；
还有活没干完就让 goal 保持 active。

- `dedupeKey`：`goal-round:<goalId>:<round>`
- `reason`：`'goal_round'`
- **轮间字节差异只有 `round="N"`**（D6）。`objective` 原文不变——她要改就调 `update_goal edit`
- **不调用** `setLastEmittedSubconsciousPlan`（那是 plan 空转升级专用）

### 4) round 计数（D4）

`rounds_started` 只在**主 agent claim 到一条 `reason='goal_round'` 的 notify** 时 +1。
不看她这一轮调了什么工具、有没有产出。provider 报错、token 超限**都不影响**它。

达到 `max_goal_rounds` 后不再发 goal-round notify，goal 保持 `active`
（她仍可 `complete` / `blocked` / `edit` 抬高上限），续跑退回潜意识 fork。

**与空转计数的关系**：两者并存，互不换算。goal 期间不跑潜意识 fork ⇒
「plan 空转」的升级腿与作废腿在该期间自然不触发（ADR-0010 §四）。

### 5) `blocked` → 复核 fork（D3）

`update_goal(action='blocked')` 成功之后，在同一次工具执行的收尾同步触发复核 fork
（`docs/specs/xiaoni-failure-conclusion-review-fork.md`），传入 `objective` 与 `blocked_reason`
作为它要复核的问题。

**不拒绝任何 `blocked` 调用**，不管 `rounds_started` 是多少。

### 6) 系统 prompt

`system_prompt.md` 的「# 你能做什么」一节，在工具那一条后面加一段固定 goal 策略。
**这段字节永久进 cacheable 前缀，越短越好。** 初稿（user 可改）：

```markdown
* **目标（goal）：** 有件事你想做完、又不是两下就完的，就用 `create_goal` 记下来——一次只记一件。
  之后每一轮它都会重新摆到你眼前，直到你说它完了。要改、要停、要接着做，先 `get_goal` 拿到
  `goal_id` 和 `revision`，再 `update_goal`。

  **做到了才说做到了**——报 `complete` 之前，你得能指出哪儿看得到它成了。真卡住了就报 `blocked`，
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
3. 同一时刻最多一个 `active` goal；`revision` 不匹配的 `update_goal` 被拒绝并回当前值
4. goal `active` 且未达上限时，settle **不跑潜意识 fork**，改入队一条 `reason='goal_round'`
5. 相邻两轮 `<goal_round>` 块**除 `round="N"` 外逐字节相同**
6. `rounds_started` 只在 goal-round notify 被 claim 时 +1；她这一轮零工具也照样 +1
7. `blocked` 调用一律成功，且同步触发一次复核 fork
8. goal 进入 `completed` / `blocked` / `paused` 后，续跑退回潜意识 fork
9. **缓存**：goal 状态只经工具结果进上下文，**不存在常驻 goal prompt 块**
10. **缓存**：goal-round notify 进栈后下一 run replay 逐字节可重建；相邻 slice `cache_read` 无塌陷
11. 铁律缓存回归全绿：`cache-replay-consistency.test.ts`、`fork-cache-alignment.test.ts`、
    `agent-stack-event-id-dedup{,.realdb}.test.js`

## Testing Plan

| 层 | 内容 | 数量 |
|---|---|---|
| Unit | 三个工具的 schema 与参数校验；compare-and-set；fork 授权拒绝；action 与字段的配对 | +7 |
| Unit(cache) | 相邻两轮 goal-round 块字节差异只有轮次；工具列表两处同步 | +2 |
| Integration | goal active → 不跑潜意识；上限后退回；`blocked` → 触发复核；`complete` → 退回 | +4 |
| Real-DB | goal-round notify 的 run 边界 `cache_read` 实测无穿透 | +1 |

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
| `agent-loop-service.ts:6691` | 续跑分叉：active goal → goal-round notify |
| `agent-loop-service.ts` 新增 | `enqueueGoalRoundNotify` |
| `docs/xiaoni_prompt/goal_round_reminder.md` | ✅ 初稿已写 |
| `docs/xiaoni_prompt/system_prompt.md` | 「你能做什么」加 goal 策略段（初稿见 §6，**实现时才写进文件**） |
| `packages/persistence/prisma/schema.prisma` | 新增 `XiaoniGoal` |
| `packages/persistence/*.js` | goal 读写封装 |
| 管理端 | goal 当前状态与历史可见（观测 ADR-0010 §四要求的两个率） |

## Open（工程不该定的）

- **两段正文初稿已写**（`goal_round_reminder.md` 文件、system prompt 段见 §6），等 user 改
- `max_goal_rounds` 的默认值（暂定 20，**纯拍的，无依据**）
- 上线后要盯的两个数（ADR-0010 §四）：**goal 创建率**与 **`blocked` 调用时的
  `rounds_started` 分布**——后者若集中在 1，说明她拿 `blocked` 当逃生舱
