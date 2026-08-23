# 目标由她自己立，成败也由她自己说

> **2026-08-23 修订：`goal` 更名为 `deep dive`。** 本 ADR 的六条决定全部不变，改的是**名字与
> 语义映射**。理由不是措辞：`goal` 在模型先验里就是待办（CC 的 TodoWrite、codex 的
> `update_plan`、dsh 的 task-goal 都占这个词），活体证据是上线后唯一一次使用为 78 秒内
> `create → complete`、`rounds_started=0` —— `<goal_round>` 一次都没渲染过，她把它当成了
> 事后贴的任务标签。这套机制服务的业务目标是**深度探索 / 深度思考**，名字要说这件事。
>
> 映射：`create_goal`/`get_goal`/`update_goal` → `create_deep_dive`/`get_deep_dive`/`update_deep_dive`；
> `objective`（想做成什么）→ `question`（想弄明白什么）；`complete`（做完了）→ `conclude`
> （得出结论了）；`max_goal_rounds`（轮次上限）→ `max_rounds`（安全阀，不是省着用的预算）；
> `rounds_started` 语义从「消耗」改读为**深度计数，越大越好**。表名 `xiaoni_goals` →
> `xiaoni_deep_dives`，`failure_review_fork_slices.goal_id` → `deep_dive_id`（幂等重命名迁移，
> 见 `ensureXiaoniDeepDiveSchema`）。
>
> 本文件名保留 —— ADR 是历史记录，改名会断掉引用它的那些链接。下文出现的 `goal` 一律读作
> `deep dive`。


2026-08-22 定。承接 `docs/adr/0008-*` 决定四（「干活途中的任务表示」当时因为「没有承载物」被推迟）——
**承载物就是工具本身。**

给主 agent 三个工具：`get_goal` / `create_goal` / `update_goal`。
`update_goal` 的 action 含 `complete` 与 `blocked`，`blocked` 必须带 `blocked_reason`。

**她调 `blocked` 的那一刻，触发复核 fork**（见 `docs/adr/0009-*`）。

**goal 活着期间，潜意识 fork 让位**：续跑改用引擎拼装的固定 `<goal_round>` 块。

---

## 一、为什么判定必须归模型

2026-08-22 对 Claude Code `2.1.239` / DeepSeek Harness / Pi / OpenAI Codex 的源码调研
（`docs/investigations/harness-no-progress-detection.md`）得到一个一致结论：

> **没有任何一家 harness 判定「这次工具调用有没有推进目标」。所有计数器量的都是资源。**

dsh 把这件事写得最直白（`packages/goal/goal-round-driver/README.md:32`）：

> The driver **does not classify the preceding activity** by correlating the goal message with
> `turn/end`, so provider errors and token limits are **not** prompt-level goal outcomes。

它数的是「这一轮的输入被接纳了没有」（`goal/README.md:26`：
`Positive rounds advance only on admitted goal-sourced user/message events`），
**完全不看模型干了什么**。

四家里唯一的语义判定，是**模型自己调 `complete` / `blocked`**。

本轮自己也撞过这堵墙：先后试过关键词表（脆，只覆盖一个用例）、零输出算术判据
（**实测失效**——她那次 grep 输出 1049 / 8090 / 2715 / 428 / 4572 字符，全部有输出、全部是噪音）、
小模型判官（可行但每天多 146 次调用）。**都不如让她自己说一句。**

---

## 二、为什么 `xiaoni_plan` 治不了这件事

`xiaoni_plan` 的职责是**点火**：主 agent 输出纯文本（`final_answer`、无工具调用）时，
loop 没有办法自动继续——请求的末项是 assistant，无法据此发起下一次请求。潜意识 fork 的存在
就是为了造出一条新的「输入侧」内容把 loop 重新点着。**它和「这件事做完没有」无关。**

dsh 解决同一个问题，形状一样（塞一条合成的 user-role 消息），**内容完全不同**：

| | dsh 每轮塞的 | 小腻每轮塞的 |
|---|---|---|
| 内容 | 固定指令块 + 同一个 objective + 一个轮次数字 | 潜意识 fork **现写的一段散文** |
| 轮间字节差异 | 几乎为零 | 每轮全新 |
| 实测后果 | append-only，前缀完美复用 | **95 份 plan 只有 22 种开头**，既污染又没法复用 |

`goal-round-driver/README.md:52` 逐字：
`One fixed instruction block plus the objective is added per admitted round.`

**病根不是「保留」，是「每轮重写」。**

---

## 三、决定

**一、三个工具，照 dsh 的形状。**
`get_goal()` / `create_goal(objective, max_goal_rounds?)` /
`update_goal(goal_id, revision, action, objective?, max_goal_rounds?, blocked_reason?)`，
action ∈ `{edit, pause, resume, complete, blocked}`。**不自己发明形状**——dsh 已经把
compare-and-set、revision、round cap 这些踩过一遍。

**二、goal 由她自己创建。**
dsh 的 `create_goal` 要求直接人类回合，非人类回合与 subagent 一律拒绝。**我们不抄这条。**
她 81% 的 run 是自驱动的；限死在「别人问你时才算数」与她自己过日子的主线冲突。
潜意识 fork 也不许创建 goal——那会把规划权从主 agent 挪走，违反
`docs/adr/0007-plan-authority-is-verifiable-evidence.md`。

**三、`blocked` 不设硬闸，改成触发复核。**
dsh 的运行时会**拒绝**不满 3 轮的 `blocked` 调用。**不抄。** 那是纯 gate，而且实测在她身上
买不到东西——阿花逐条施压后动作数 15 → 35，**结局逐字相同**。

改成：**她照样可以随时宣布 blocked；宣布这个动作会触发一次独立复核**（ADR-0009）。
把「不许放弃」换成「你放弃时会有人替你再查一遍」。

**四、goal round 只数轮次，不掺产出判断。**
`roundsStarted` 只在一轮 goal-round 输入被接纳时 +1，**不看她这一轮干了什么**（照 dsh）。
它与空转失效计数是**两个不同的量**，不许合并：空转数的是「跑了却没产出」，
goal round 数的是「为这个目标跑了几轮」（有产出也算）。

**五、goal 活着时，潜意识 fork 让位。**
plan 的唯一职责是点火；goal 活着意味着点火理由已经存在。此时续跑改塞引擎拼装的固定
`<goal_round>` 块（objective 原文 + `round/maxGoalRounds`），**不跑潜意识 fork**。

这不与 ADR-0007 冲突：0007 说「规划是主 agent 的职责，潜意识只是唤醒器」——
goal 正是主 agent 自己定的规划，唤醒改由一个更便宜、更稳定的机制承担。
goal 结束（complete / blocked / pause）后，潜意识 fork 照旧接管。

**六、续跑块 append-only、字节稳定，不做一次性剥除。**
每轮追加的块必须满足两条：**① 不由模型生成**（引擎拼装的固定模板）；
**② 轮间只有轮次数字变**。理由见 §二——重写才是病根，保留不是。

一次性剥除（non-durable / 下一轮 evict）这条路也成立，但它要求 live 请求与 stack replay
逐字节一致的剥除逻辑收口在 `buildInitialInput` 唯一构建口，更脆。**等有实测数据说明
上下文确实被撑大了再上，不预先复杂化。**

---

## 四、后果

- **缓存（一次性）**：新增 3 个工具定义 = `tools` 数组变化 =
  **主 agent 与全部 fork 的整段前缀一次性失效**（`anthropic-translate.ts` 文件头：
  `changing tool definitions invalidates everything`）。必须**挑压缩边界那一帧上线**——
  那一帧本来就是冷读帧，不额外产生冷读。
- **缓存（稳态）**：`goal` 状态**只经 `get_goal()` 的工具结果进上下文，不做常驻 prompt 块**。
  做成常驻块的话 `roundsStarted` 每轮 +1 = 前缀每轮漂移 = 每轮击穿。
  dsh 同款处理（`tool-goal/README.md`：`Calls and results append after the reusable request
  prefix without invalidating earlier entries`）。
  `<goal_round>` 续跑块 append-only，落在可复用前缀之后。
- **空转治理**：goal 活着期间不跑潜意识 fork，因此「plan 空转」的两条腿（升级、作废）
  在该期间自然不触发。goal 自己有完成判据，不需要靠「有没有调工具」猜。
- **她会不会用**：新工具她不调就是死重（现状：10 个工具，81% 的动作走 `exec_command`）。
  靠两条保证——系统 prompt 里一段固定 goal 策略（照 dsh 的写法，含
  `Mark complete only when the objective is actually achieved`），
  以及每轮 `<goal_round>` 块里复述 objective。**上线后必须实测创建率与 `blocked` 调用率**；
  两者长期为零 = 这个设计失败，不要靠推断。
- **未验证**：她会不会把 `blocked` 当成逃生舱（一卡住就宣布 blocked 收工）。
  决定三取消了 dsh 的 3 轮硬闸，代价就是这个。观测口：`blocked` 调用的
  `roundsStarted` 分布——如果集中在 1，说明她在用它逃跑，那时候再考虑最小的软约束。
