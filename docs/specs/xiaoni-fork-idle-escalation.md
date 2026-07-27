# Spec: 自驱动 fork 的空转升级 —— 失效计数 + 上一份 plan 回贴

状态: **已上线并翻 ON**（2026-07-27，与作废腿 `xiaoni-plan-run-void-on-idle.md` 同时点火）· 作者对话确认 2026-07-25
实现: worktree feat/fork-idle-escalation（bc3772bd 等 3 commit）已合入 main；归零语义经 2026-07-27 两次拍板修订（见「连续空转计数器」节）

**取代** `docs/specs/xiaoni-anti-idle-external-authority.md` §2（"主 loop 里用固定模板替换 fork 的声音"）。
该 spec 的 §1 计数器设计仍然复用，§3 文案文件 `idle_escalation_reminder.md` 改为 fork 侧使用。

---

## 范围锁定（用户拍板）

- 升级信号**只进自驱动 fork 的引导 prompt**，**绝不进主 agent 上下文**。
- fork 引导 prompt 里要有两样东西：
  1. 「当前已连续 N 轮 xiaoni_plan 不起作用了，你现在应该用更严厉的语气给出 xiaoni_plan」
  2. **上一次 xiaoni_plan 的原文**
- 语气由 fork 自己拿捏，不用固定模板替换她的声音。
- 心理评估 fork 保持 OFF，不碰。
- 不 ping 用户，不发外呼。

---

## Context（为什么）

### 观测事实（trace `runtrace_1784969153999_faefb37f`,slice `llm_request_slices.id=90434`,2026-07-25 16:46）

| 指标 | 实测 |
|---|---|
| input 条目总数 | 655 |
| 其中 `<xiaoni_plan>` 块 | **95 条（14.5%）** |
| plan 块占请求体字节 | **89,992 / 496,640 字符（18.1%）**,约 49K token |
| 最长一段连续 plan（中间零条目） | **12 条** |
| 95 条里前 25 字不同的 | **22 种** —— 同一份计划被重写了 95 遍 |
| 整个请求里的 assistant 文本条目 | **0 条**（全被 text gate 剥掉） |
| 近 6h plan 触发的 run 中零工具调用的 | **111 / 146 = 76%** |
| 16:00 那一小时 fire 的 plan 数 | **68**（约每 53 秒一份） |
| 当前活 epoch（cutoff 205736 → 栈顶 206611,875 条）中的 plan | **138 条 = 15.8%** |

### 循环形状

```
plan 到达 → 她读自己的行为记录（function_call/output 全在,显示今天干了一堆）
          → 合理得出「今天够了」
          → settle on final_answer
          → 自述被 text gate 剥掉（有意为之,防负面状态传染）
          → C2 门 (:6235 !seed.settledOnFinalAnswer) 再 fire 一份 plan
          → 循环
```

### 根因

不是失忆 —— 她的产物（工具调用、文件、日记、发出的消息）**全部保留在上下文里**，被剥的只有 OS 通道那层自述，
而剥它是对的（`agent-loop-service.ts:801` 注释：防「摸鱼/等待」叙述自我强化，负面状态进上下文会往后传染）。

真实根因：**fork 每次都在信息真空里重新出题**。fork 拿到的是主请求克隆 + 她这一轮的自述，
但它**不知道自己上一份 plan 已经连着失败了多少轮**，也没有把上一份 plan 拎到眼前对照。
所以它每次都以为这是第一次，写出的 5 条方向语气恒定、内容雷同（22 种开头 / 95 条）。

升级信号必须放在 fork，**不能放主 agent** —— 往主上下文注入「你已经失败 94 次」本身就是最典型的
负面状态注入，正是 text gate 要挡的那一类。

### 已有资产

- `docs/xiaoni_prompt/idle_escalation_reminder.md` 文案已写好（两档,带 `{{IDLE_ROUNDS}}`），
  但 `grep -rn "idle_escalation\|consecutiveIdle" modules/agent-service/src` **零命中** —— 一行代码没接。
- fork 尾部追加通道已存在且已在用（见下）。

---

## Current State（已核实 2026-07-25）

| 机制 | 位置 | 现状 |
|---|---|---|
| fork = 主请求字节克隆 + 尾部追加 | `agent-loop-service.ts:2549` `buildSubconsciousAgentForkRequest` | 已如此,FORK 铁律注释在 `:2506` |
| 她的自述重注入 fork 尾部 | `:8203` `recentNarrationItems = outputItems.filter(isAssistantTextOutputReplayItem)` → `:2566` 打 `cache_volatile` 追加 | **已在用** —— 主 agent 看不到的自述,fork 一直看得到 |
| fork 引导 prompt | `:2570` `buildDeveloperInputItem([renderSelfContinuationReminder()])` | 尾部追加,断点之后 |
| 主 agent 续航提醒 | `:3922` `buildSelfContinuationInputItem()` → `:14191` `buildLoopSelfContinuationStackItem` 冻结进 stack | **与 fork 共用同一个 render 函数** |
| render 函数 | `:3910` `renderSelfContinuationReminder()` 读 `self_continuation_reminder.md` | **一个函数两个消费方** |
| C2 空转门 | `:6235` `if (!seed.settledOnFinalAnswer) return;` | 纯文本零动作收工 → fire fork |
| text gate | `:816` `isReplayItemStrippedByTextGate` | live `psych_assessment_gate_enabled = f` → 无条件全剥 |

### ⚠ 实现陷阱（本 spec 的核心风险）

`renderSelfContinuationReminder()` 同时喂 **fork** 和 **主 agent**。
直接往 `self_continuation_reminder.md` 里加升级句，那句话会跟着进主 agent 上下文并**冻结进 stack**，
违反范围锁定第一条。**必须先拆路径。**

---

## Proposed Change

### 1. 拆开两条路径（前置改动,零行为变化）

- 主 agent 保留 `renderSelfContinuationReminder()` + `self_continuation_reminder.md`，**一个字节不动**。
- fork 新增 `renderSubconsciousForkReminder({ idleRounds, lastPlanText })`，读**新文件**
  `docs/xiaoni_prompt/subconscious_fork_reminder.md`。
- 该新文件的**非升级分支内容与 `self_continuation_reminder.md` 现有正文逐字节一致**，
  保证 `idleRounds < 阈值` 时 fork 请求体与今天逐字节相同（fork-cache-alignment 无需改断言）。

### 2. 连续空转计数器

- `consecutiveIdleSettlesBySession: Map<sessionKey, number>`，放文件顶部 `consecutiveOver...BySession` 那一簇旁边。
- **+1**：一次 settle 满足 `settledOnFinalAnswer === true`（纯文本零动作收工）。
- **归零**：**只有一种场景**（user 拍板 2026-07-27 收窄，取代原「二选一」）——该 run 存在有效产出，
  即做过任何**碰世界的工具调用**（`send_*` / `exec_command` / `read_file` / 写文件…）。
  ~~或消费了一条真外部入向~~：已废除。被外部消息唤醒不归零——她真要响应必然调工具走同一条路归零；
  被叫醒却啥也没干，plan 照样没被执行，账不能被一条外来 ping 洗掉。
- **`recover_energy` 按结果**（user 2026-07-27 再修订，取代原「一律不归零」）：被身体**接受**
  （真睡着了/立即恢复）= 有效产出，**归零**——都睡着了不算空转；被身体**拒绝**（`rest_rejected`，
  睡不着）**不归零**——发起了但没睡成，等于没动。
- 计数只活在进程内存（对齐 `lastMainAgentForkSeed` 的现有做法）。重启后从 0 起，可接受。

### 3. 上一份 plan 的来源

- 新运行时字段 `lastEmittedPlanText: string | null`，在 fork 成功产出并 enqueue notify 时写入（`stripSubconsciousPlanWrapper` 之后的正文）。
- 为 null（重启后 / 首次）时**不进入升级分支**，按普通分支渲染。
- 开放项：是否改为从 `agent_stack_items` 读最近一条带 `<xiaoni_plan>` 的 `runtime_input` 以扛重启 —— 实现期定，不阻塞。

### 4. fork 引导 prompt 的升级段

`subconscious_fork_reminder.md` 在 `idleRounds >= IDLE_ESCALATION_AFTER_ROUNDS` 时额外渲染（追加在正文之后）：

```
【连续 {{IDLE_ROUNDS}} 轮了】
你上一次给出的 xiaoni_plan 已经连续 {{IDLE_ROUNDS}} 轮不起作用了 —— 她一个工具都没调,
只说了话就收工。你现在应该用更严厉的语气给出 xiaoni_plan,轮数越多越不留情面。

上一次的 xiaoni_plan 原文:
---
{{LAST_XIAONI_PLAN}}
---

别再把同一批方向换个说法重写一遍 —— 上面那份就是失败的那份。
```

- `IDLE_ESCALATION_AFTER_ROUNDS = 2`（常量,文件顶部可调）。第 1 轮空转仍走原文，给她自主机会。
- **单档**，严厉程度由 `{{IDLE_ROUNDS}}` 这个数字本身承载，不预设 2 档/3 档文案。
  开放项：是否复用 `idle_escalation_reminder.md` 的稳/硬两档 —— Phase 4 定，默认不做。

### 5. 运行时开关

- `agent_runtime_control.fork_idle_escalation_enabled`，**默认 false**，热下发（镜像 `setPsychAssessmentGateEnabled` `index.ts:346`）。
- OFF = 不计数、不渲染升级段 → 行为与今天逐字节一致。

---

## 双缓存影响分析（铁律）

### ① fork 缓存

fork = `cloneCanonicalAgentTurnRequest(baseRequest)` + **尾部追加**。升级段只进
`buildDeveloperInputItem([...])` 这一条尾部 item，**克隆前缀（system + tools + 全部历史）一字节不动**。
`{{LAST_XIAONI_PLAN}}`（约 950 字符）落在缓存断点之后的 cold tail，与现有 `recentNarrationItems`
（同样 tail、同样 `cache_volatile`）同形。→ `fork-cache-alignment.test.ts` 四个 fork 逐字节一致的断言不受影响。

### ② 下一次主 agent run 缓存

**主 agent 侧零改动**：`buildSelfContinuationInputItem` / `buildLoopSelfContinuationStackItem` /
`self_continuation_reminder.md` 全不动。计数器和上一份 plan **从不进入主请求、从不写 stack**。
fork 请求体 `no_persist: 'true'`，本就不参与主 run replay。→ run 边界零击穿。

**关键不变量**：升级信号是 fork 的**私有输入**，不是任何持久化 item 的内容。因此不存在
「live 请求与 stack replay 不一致」的风险类别 —— 它压根不进 stack。

### 验证要求（不能只推断）

改后取相邻两 slice 的 `wire_request` 实测 `cache_read_input_tokens`：
- OFF→ON 后，**主 turn** 的 `cache_read` 无变化（应完全不受影响）。
- fork slice 的 `cache_read` 与主 turn 同量级（当前基线：主 turn 269,423 / 270,374）。

---

## Acceptance Criteria

1. 开关 OFF：不计数、不渲染升级段，fork 与主 agent 请求体与改动前**逐字节一致**；
   三套缓存铁律用例全绿（`cache-replay-consistency` / `fork-cache-alignment` / `agent-stack-event-id-dedup`），**无需改任何断言**。
2. 开关 ON 且 `idleRounds < 2`：fork 引导 prompt 正文与 `self_continuation_reminder.md` 逐字节一致。
3. 开关 ON 且 `idleRounds >= 2` 且 `lastEmittedPlanText != null`：fork 尾部 item 含
   （a）正确的 `{{IDLE_ROUNDS}}` 数字，（b）上一份 plan 的**完整原文**。
4. **主 agent 上下文中不含任何升级痕迹**：该 run 之后 `agent_stack_items` 里新写的 `runtime_input`
   与 `content.system_reminder` 不出现 `连续`/`{{IDLE_ROUNDS}}`/升级段任何字样。（专项断言，本 spec 的核心约束。）
5. 计数器只在「有效产出」后归零（2026-07-27 两次修订：外部入向唤醒不归零；`recover_energy` 按结果——身体接受归零、被拒不归零）。
6. `lastEmittedPlanText == null`（重启后）时走普通分支，不崩、不渲染半截升级段。
7. 实测相邻 slice `cache_read_input_tokens`：主 turn 不受影响，fork 不穿透。
8. 心理评估 fork 仍 OFF、未被触碰。

---

## Testing Plan

| 层 | 测什么 | 数 |
|---|---|---|
| Unit | 计数器 incr/reset（有效产出归零 / 纯空转累加；~~外部入向归零 / recover_energy 不归零~~ 已被 07-27 修订取代） | +4 |
| Unit | `renderSubconsciousForkReminder` 确定性（同入参 → 同字节）；`idleRounds<2` 分支与 `self_continuation_reminder.md` 逐字节相等 | +3 |
| Unit | 升级分支渲染：`{{IDLE_ROUNDS}}` 注入正确、`{{LAST_XIAONI_PLAN}}` 原文完整、null 时降级 | +3 |
| **隔离专项** | 开关 ON + 升级触发后，主 loop 的 `buildSelfContinuationInputItem` 输出与开关 OFF 时**逐字节相同** | +1 |
| 缓存回归（不可弱化,只新增） | `fork-cache-alignment.test.ts`：升级后 fork 克隆前缀仍逐字节一致 | +1 |
| 缓存回归 | `cache-replay-consistency.test.ts`：主 run replay 不受影响（OFF/ON 两态） | +1 |
| 真库/活体 | 相邻 slice `cache_read` 实测；ON 后观察 24h 的零工具率与 plan 条数 | 手验 |

---

## Rollback

- 一键：`fork_idle_escalation_enabled = false`（热下发，秒级，无需重启）→ 行为回到今天。
- 代码回退：摘除计数器 + `renderSubconsciousForkReminder` + 删 `subconscious_fork_reminder.md`；
  `buildSubconsciousAgentForkRequest` 回落 `renderSelfContinuationReminder()`。
  主 agent 路径全程未动，回退不涉及。

---

## Files Reference

| 文件 | 改动 |
|---|---|
| `modules/agent-service/src/services/agent-loop-service.ts:~840` | 新 `consecutiveIdleSettlesBySession` + getter/incr/reset；新 `lastEmittedPlanText` |
| `…:703` 旁 | 新 `FORK_IDLE_ESCALATION_ENABLED` + `setForkIdleEscalationEnabled` |
| `…:3910` 旁 | 新 `renderSubconsciousForkReminder({idleRounds,lastPlanText})`；`renderSelfContinuationReminder` 不动 |
| `…:2549` `buildSubconsciousAgentForkRequest` | 新增 `idleRounds`/`lastPlanText` 入参；尾部 item 改用 `renderSubconsciousForkReminder` |
| `…:6235` `maybeRunSubconsciousAgentFork` | 读计数器并传入 fork；fork 产出后写 `lastEmittedPlanText` |
| `…:8203` settle 判定处 | 计数器 incr/reset 接线 |
| `modules/agent-service/src/index.ts:346` 旁 | poll 热下发 `forkIdleEscalationEnabled` |
| `docs/xiaoni_prompt/subconscious_fork_reminder.md` | **新文件**（正文 = 现 `self_continuation_reminder.md` 逐字节 + 升级段） |
| `packages/persistence`（schema + migration） | `agent_runtime_control.fork_idle_escalation_enabled` 列 + 映射 |
| `modules/agent-service/src/__tests__/fork-cache-alignment.test.ts` | 新增子用例（只增不改） |
| `modules/agent-service/src/__tests__/cache-replay-consistency.test.ts` | 新增子用例（只增不改） |
| `docs/specs/xiaoni-anti-idle-external-authority.md` | 标注 §2 被本 spec 取代 |

---

## Out of Scope

- **不改 text gate / 心理评估 gate**（保持 OFF）。剥自述是对的，不动。
- **不做 plan 堆积的字节压缩**。本 spec 赌的是升级生效后零工具率下降 → plan 条数自然减少。
  ON 后观察 24h，若 76% 的零工具率没有明显下降，再另开 issue 处理堆积本身。
- 不改压缩、精力、休眠机制。
- 不改主 agent 的 `self_continuation_reminder.md` 文案。
- 「真阻塞 vs 空转」不做语义判断，靠归零规则的机械信号区分。

---

## 开放项（实现期已全部裁决 2026-07-27）

1. `lastEmittedPlanText` 是否改为从 `agent_stack_items` 读，以扛住重启。→ **不改**：纯进程内存，
   重启后为 null 走普通分支安全降级；且作废腿上线后失败 plan 根本不在栈里，无从读。
2. 是否引入稳/硬两档（复用 `idle_escalation_reminder.md`）。→ **单档**，严厉程度由
   `{{IDLE_ROUNDS}}` 数字承载，文案落 `subconscious_fork_idle_escalation.md`（新文件，
   未复用 `idle_escalation_reminder.md`——那份是主 loop 注入时代的遗产，已废弃不接线）。
3. 「碰世界的工具调用」的确切白/黑名单 —— ~~`recover_energy` 已确定不归零~~ 07-27 改判：按**结果**——身体接受（真睡着/立即恢复）归零、`rest_rejected` 不归零；其余工具发出即算。
4. `IDLE_ESCALATION_AFTER_ROUNDS` 的值。→ **=2** 上线。
