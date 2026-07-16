# Spec: 治空转 —— 连续空转的合成外部权威提醒

状态: **阻塞待裁决(D1)** · 默认 OFF 上线 · 作者对话确认 2026-07-14 · 注入点核实 2026-07-16
> ⚠️ 2026-07-16 真库核实发现本 spec 选定的注入点(`buildLoopSelfContinuationStackItem`)在生产里
> **已死 26 天**(最后一条 `self_continuation` stack item = 2026-06-20)。**照原样实现会得到一个
> ON/OFF 无差别的空开关。** 见文末「🔴 阻塞发现」,D1 定了才能动手。
> 思路(换驱动来源 = 外部权威)本身未被否定,只是接线点错了。
范围锁定 (用户拍板):
- 目标 = **只治空转/摆烂**(「我先等着看」「今天做够了」这类零动作松懈),别的随她自主。
- 心理评估 fork **保持关着、这轮不碰**。
- 驱动杆 = **合成外部权威提醒,全自动,不 ping 用户**(不靠把 `xiaoni_plan` 写得更狠)。

---

## Context(为什么)

现状链路已经完整:运行时**能检测空转**(`lastHistoryTurnEndsWithAssistantFinalAnswer` /
`settledOnFinalAnswer`)、**已剥掉空转叙述防自我强化**、**空转时已 fire 一份 `<xiaoni_plan>`**。
它照样失败,根因不是缺机制,是**驱动来源错了**:

- `xiaoni_plan` 是小腻**自己吐给自己**的续航指令 —— 自生的声音对她没有强制力,她没理由听自己的。
- 用户在 QQ 里骂她**有用** —— 那是**另一个人**给的、带真社交分量的外部信号。
- 上一个 commit `9d808e2d`(讲清定义/收工/循环/相处法)是改**措辞**,治不了这个 —— 根子是
  「权威来源」,不是文案。

结论:治空转要换**驱动来源**,把「外部权威」的语气机械地合成出来,在她连续空转时**替换**掉那份
她已经学会忽略的自生 plan。

## Scope

**In scope**
- 连续空转计数器(session 级,复用 `consecutiveOver...BySession` 同套路)。
- 过阈后,把 settle→continuation 的提醒从 self-continuation(她自己的声音)**替换**成外部权威升级提醒,
  轮数越多语气越硬。
- 外置提醒文案到 `docs/xiaoni_prompt/`,运营可直接改。
- 新增 `agent_runtime_control` 热开关,**默认 OFF**,热下发(同 psych gate / strip 套路)。

**Out of scope**
- 不动心理评估 fork(保持 OFF)。
- 不 ping 用户 / 不发外呼通知。
- 不改 `xiaoni_plan` 本身的文案或人设自主性。
- 不改压缩、精力、休眠机制。
- 「真阻塞 vs 空转」不做语义判断(靠机械信号区分,见下)。

## Current State(实测 2026-07-14)

| 机制 | 位置 | 现状 |
|---|---|---|
| 空转检测 | `agent-loop-service.ts:3891` `lastHistoryTurnEndsWithAssistantFinalAnswer`;`:5883` `settledOnFinalAnswer` | 已在用,门控自驱 fork |
| 空转叙述剥离 | `:3883` `isAssistantTextOutputReplayItem` | 已无条件剥,防「我先等着」replay 自我强化 |
| 自驱 plan 生成 | `:6119` `maybeRunSubconsciousAgentFork`(C2 门控 `!seed.settledOnFinalAnswer` return) | 只在空转 settle 时 fire;她自己的声音 → 无效 |
| self-continuation 冻结 | `:13856` `buildLoopSelfContinuationStackItem`(`content.system_reminder` 冻结,eventId 稳定) | ~~**提醒文本已 frozen-per-item,replay 读存好字节**~~ ⚠️ **2026-07-16 更正:该路径生产里最后一次 fire = 2026-06-20,已死。冻结机制本身没问题,但它不在任何真实 run 的路径上。见文末「🔴 阻塞发现」** |
| 心理评估 gate | `:703` `PSYCH_ASSESSMENT_GATE_ENABLED` | live `psych_assessment_gate_enabled = f`(关) |
| xiaoni_os 剥离 | `strip_xiaoni_os_from_requests` | live `= t`(开) |

关键: `buildLoopSelfContinuationStackItem` 已经把提醒冻结进 stack item,所以换文本天然 replay 安全。

## Proposed Change

### 1. 连续空转计数器
- 新 `Map<sessionKey, number>` `consecutiveIdleSettlesBySession`,配 getter/incr/reset,放在文件顶部
  `consecutiveOver...BySession` 那一簇旁边,风格对齐。
- **incr**:一次 settle 满足 `settledOnFinalAnswer === true`(纯文本零动作收工)时 +1。
- **reset 到 0**:该 run 做了任何**碰世界的工具调用**(真动作,含 QQ 回复 = `send_*`),
  **或**消费了一条**真外部入向**(QQ 来消息)。 —— 即「她在响应真实输入 / 真干了活」就清零。
  → 计数器度量的是「连续、无真动作、无外部输入进来的空转 settle」,天然豁免「等回复→回复到了」的真阻塞。

### 2. 过阈替换提醒(注入点 = 现成冻结点)
常量(文件顶部,可调):
```
const IDLE_ESCALATION_AFTER_ROUNDS = 2;   // 第 1 轮空转仍走原自驱 plan(给她自主机会);≥2 连续 → 升级
```
- **轮 1 空转**:维持现状 —— 自驱 fork 出 `<xiaoni_plan>`(她自己的声音,不动)。
- **连续 ≥ `IDLE_ESCALATION_AFTER_ROUNDS`**:settle→continuation 的提醒**替换**为外部权威升级提醒,
  `{{IDLE_ROUNDS}}` 烤进文本;**替换而非叠加**(那份 plan 已连着失败 N 轮,不再重复),保持每 settle 一条 notify
  (对齐近期 one-shot/durable 收敛,不 pile-up)。
- 注入就发生在 `buildLoopSelfContinuationStackItem` 的 `inputItem` / `system_reminder` 构造处:
  过阈时 `renderSelfContinuationReminder()`(`:3843`)换成 `renderIdleEscalationReminder(rounds)`,
  轮数在 render 期烤进冻结文本。**下一 run replay 读 `content.system_reminder` 存好的字节,逐字节重建。**

### 3. 外置文案 `docs/xiaoni_prompt/idle_escalation_reminder.md`
- 与 `self_continuation_reminder.md` 同目录同加载(`readPromptSnippet`)。
- 语气 = **外部指令**:当下、具体、不商量、随 `{{IDLE_ROUNDS}}` 升级。**不是**自我反思(「问问你自己」),
  **不是**自我惩罚(「狠狠骂自己」)。分两档(按 rounds 选):
  - 稳档(2–3 轮):`【停一下】你已经连着 {{IDLE_ROUNDS}} 轮没动手了 —— 光想、光等,不算数。别再盘算,挑最要紧的那一件,现在就调一个工具把它往前推一步。做完再停。`
  - 硬档(≥4 轮):更短、更硬、不给退路(具体措辞 Phase 4 定稿)。

### 4. 运行时开关
- `agent_runtime_control.anti_idle_escalation_enabled`,**默认 false**。
- `setAntiIdleEscalationEnabled(value)` + `index.ts` poll 热下发(镜像 `setPsychAssessmentGateEnabled` `:346-348`)。
- OFF = 行为零变化(不计数不替换),让冻结缓存回归用例无需改动即绿。

## 双缓存影响分析(铁律)

① **fork 缓存**:自驱 fork 前缀 = 主请求克隆,不受影响。轮 1 仍走原 fork;过阈**替换**为主 loop 内的
   continuation item(非 fork),不改 fork 请求体前缀 → fork-cache-alignment 逐字节仍一致。

② **下一次主 run 缓存**:升级提醒经 `buildLoopSelfContinuationStackItem` 冻结进 `content.system_reminder`
   (eventId 稳定),`{{IDLE_ROUNDS}}` **在 render 期烤死**。replay 读存好字节、不重算 → **run 边界零击穿**。
   计数器/轮数只进**存好的 item content**,**不进 cacheable 前缀**(system+tools 前缀一字节不动)。
   —— 复用 `compression-done notify` 的 frozen-stamp 模式。

**验证要求(不能只推断)**:改后取相邻两 slice 的 `wire_request` 实测 `cache_read_input_tokens`,
确认 OFF→ON 首帧冷读一次即回暖、后续主 turn 与 fork 不穿透。

## Acceptance Criteria

1. 开关 OFF:计数器不动、提醒不替换,行为与当前逐字节一致;三套缓存铁律用例全绿(无需改断言)。
2. 开关 ON + 连续空转达 `IDLE_ESCALATION_AFTER_ROUNDS`:该 settle 的 continuation `system_reminder`
   = 外部权威升级文本(含正确 `{{IDLE_ROUNDS}}`),**不是** self_continuation 原文,**不是**双份 notify。
3. 计数器在(a)任一碰世界工具调用 或(b)消费真外部入向 后归零;下次空转从 1 重新起。
4. run 边界 replay:含升级提醒的那一 run,下一 run 重建其 `content.system_reminder` 逐字节一致
   (cache-replay-consistency 用例新增子用例覆盖)。
5. 实测相邻 slice `cache_read_input_tokens`:ON 首帧一次冷读即回暖,后续主 turn + fork 均不穿透。
6. 心理评估 fork 仍 OFF、未被触碰。

## Testing Plan

| 层 | 测什么 | 数 |
|---|---|---|
| Unit | 计数器 incr/reset(动作清零、外部入向清零、纯空转累加);过阈选档(1→原文,2→稳,4→硬);`{{IDLE_ROUNDS}}` 注入 | +5 |
| Unit | `renderIdleEscalationReminder` 确定性(同 rounds → 同字节) | +2 |
| 缓存回归(不可弱化,只新增) | `cache-replay-consistency.test.ts` 新增:升级提醒 run 的 replay 逐字节重建;OFF 全绿不变 | +2 |
| 缓存回归 | `fork-cache-alignment.test.ts`:过阈后 fork 前缀仍逐字节一致 | 验证既有绿 |
| 真库/活体 | 相邻 slice `cache_read` 实测(ON 首帧冷读一次回暖) | 手验 |

## Rollback

- 一键:`anti_idle_escalation_enabled = false`(热下发,秒级,无需重启)→ 行为回到今天。
- 代码回退:摘除计数器 + `renderIdleEscalationReminder` 分支 + 删 prompt 文件;`buildLoopSelfContinuationStackItem`
  回落 `renderSelfContinuationReminder()`。

## Files Reference

| 文件 | 改动 |
|---|---|
| `modules/agent-service/src/services/agent-loop-service.ts:~840` | 新 `consecutiveIdleSettlesBySession` + getter/incr/reset |
| `…:703` 旁 | 新 `ANTI_IDLE_ESCALATION_ENABLED` + `setAntiIdleEscalationEnabled` |
| `…:3843` 旁 | 新 `renderIdleEscalationReminder(rounds)` |
| `…:6119` `maybeRunSubconsciousAgentFork` / settle 路径 | 计数器 incr/reset 接线;过阈时切换 continuation 提醒来源 |
| `…:13856` `buildLoopSelfContinuationStackItem` | 过阈用升级提醒作 `inputItem`/`system_reminder`(冻结不变) |
| `modules/agent-service/src/index.ts:346` 旁 | poll 热下发 `antiIdleEscalationEnabled` |
| `docs/xiaoni_prompt/idle_escalation_reminder.md` | 新文案(两档 + `{{IDLE_ROUNDS}}`) |
| `packages/persistence`(schema) | `agent_runtime_control.anti_idle_escalation_enabled` 列 + 映射 |
| `modules/agent-service/src/__tests__/cache-replay-consistency.test.ts` | 新增 replay 子用例(只增不改) |

## 🔴 阻塞发现(2026-07-16 核实 · 原「开放项」的答案 · 未解决前禁止实现)

原开放项问「settle→continuation 两条路径哪条真到主 loop、如何交错」。**答案是:通道 A 不存在了。
本 spec 选的注入点是一段生产里已死 26 天的代码。**

### 证据(真库 `qqbot_db`,非推断)

```sql
SELECT date_trunc('day',created_at)::date d, count(*) FROM agent_stack_items
WHERE content->>'source'='self_continuation' GROUP BY 1 ORDER BY 1 DESC;
-- 2026-06-20 | 5432
-- 2026-06-19 | 8148
-- 2026-06-18 | 2104
-- 2026-06-13 | 1      ← 之后再无。今天 = 2026-07-16
```

- `source='self_continuation'` 的 stack item 共 15,686 条,**最后一条 2026-06-20**,断崖式归零(非衰减)。
  残留 item 的 `system_reminder` 里还带 `[当前时间 东八区: …]` 双戳 —— 那是 06-25 才修掉的击穿设计,
  佐证这批 item 全是旧世界产物。
- 对照:`<xiaoni_plan>` **活着**,今天 10:49 仍在写,落在 `content->>'source' = 'system_reminder'`
  (5,611 条),走 fork → durable notify 路径。

### 通道 A 的真实触发条件(`agent-loop-service.ts:6064-6072`, `:6123`, `:3902-3906`)

```
initialLoopContinuation = (recoveryAction.status === 'settled') ? recoveryAction.inputItems : []
queueMessage = claimNextQueueMessage()
if (!queueMessage) { maybeRunSubconsciousAgentFork(params, initialLoopContinuation) }   // 队列为空才走
  └─ if (initialLoopContinuation.length > 0) → processRuntimeFrame({ queueBacked:false, suppress })
       └─ shouldAllowSelfContinuationOnTerminalFinalAnswer = !queueBacked && suppress  → true
            └─ buildLoopSelfContinuationStackItem  ← 本 spec 原定的注入点
```

即通道 A ≠ 通用 settle 路径,而是 **「队列为空 AND 刚从 recover_energy 睡醒」** 的续航路径。
**每个真实 queue-driven run 都是 `queueBacked === true`,通道 A 对它们恒不 fire。**
`:6742-6751` 的注释亦独立确认此事实(「the next NOTIFY-driven wake run … is queue-backed,
so it does NOT append a self-continuation」)。

### 后果(为什么这是阻塞级)

照本 spec 原样实现 → 升级提醒注入进一段永不执行的代码 → **开关 ON 与 OFF 行为完全相同**。
所有验收条件(尤其 AC2)会「通过」,因为两边都不 fire;活体观察不到任何差别,极易被误判为
「外部权威这个思路也没用」而放弃 —— **这是本 spec 最大的风险,且与思路本身无关。**

### 待裁决(D1,实现前必须定)

- **选项 1(推荐)**:改注入到**活通道**。计数器接 `:8128-8135` 的 `settledOnFinalAnswer` 判定
  (那是唯一每个真实 run 都过的 settle 事实源);过阈时把 `maybeRunSubconsciousAgentFork` 产出的
  `<xiaoni_plan>` notify **替换**为升级提醒 notify(同一条 durable notify 通道,`source='system_reminder'`,
  已被验证进 replay 且缓存安全)。改动落 `:6157` 附近 + `enqueueSubconsciousAgentNotify`。
- **选项 2**:先查清 06-20 通道 A 归零是**有意取代**(durable notify 重构)还是**回归事故**,若为事故则先修复
  通道 A 再按原 spec 实现。
- 无论选哪个:`buildLoopSelfContinuationStackItem`(`:13856`)与 `renderSelfContinuationReminder`(`:3842`)
  的现存唯一活用途是**塑造潜意识 fork 自己的请求**(`:2546` `buildDeveloperInputItem`)——
  即 `self_continuation_reminder.md` 事实上是 **fork 的指令书**,不是主 loop 的推动。
  **改它的文案 = 改 fork 怎么写 `<xiaoni_plan>`,不是改小腻被怎么推。**
  近期 7 次 prompt 迭代若基于「它在推主 loop」的理解,则改错了对象。

## 开放项(实现期核实,不阻塞)

- `IDLE_ESCALATION_AFTER_ROUNDS` 与两档阈值 Phase 4 定稿(默认 2 / 稳 2–3 / 硬 ≥4)。
- 计数器 reset 条件里「消费真外部入向」的判定点,在选项 1 下需重新定位(原设想依附通道 A)。
