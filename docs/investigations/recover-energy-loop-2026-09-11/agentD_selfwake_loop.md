# 小腻自激唤醒环 —— 代码链路 + 7 天量化 + 修法

作业范围：2026-09-05 ~ 2026-09-11（`now() - interval '7 days'`），只读代码 + 只读 DB，未改任何文件、未重启任何容器。

---

## 0. 一句话结论

**收帧（`rest_rejected_frame_yield`）之后把她重新叫醒的，主要是她自己刚才那一个 run 写进 stack 的内容。**

链路是：主 loop 每次 `appendAgentStackItemsSafe()`（= 每个工具调用/每条 assistant 文本落栈）都会 fire-and-forget 打一次
`fireActionStreamRecall()` → 投影动作流头部 → 最新一条当 query 跑 shadow recall → 命中就当场交精排 Agent →
精排说值得就 `enqueueAgentQueueMessage(source='system_reminder')` 进 Notify Bucket → 门铃响 → 主 loop 起新 run。

这条链上**唯一的闸是 `isXiaoniAsleep()`**（`agent_recovery_sessions` 有没有 active 行）。而 `rest_rejected` 的定义
就是「没建 session」→ `isXiaoniAsleep()` 恒为 false → **收帧对召回链零抑制**。

`<xiaoni_plan>`（潜意识 fork）那条腿反而是对的：收帧时 `actionPlan.hasFinalAnswer=false` →
`seed.settledOnFinalAnswer=false` → fork 直接丢 seed 不点火（代码注释已经写明这个意图）。
**但它挡不住第二跳**：收帧后第一个被召回叫醒的 run 往往以 `final_answer_yielded` 收工 → 立刻点火 fork → plan notify → 再起一个 run → 她再试 3 次 → 再收帧。

---

## 1. 代码链路（文件 / 函数 / 门）

### 1.1 被动召回：触发点

| 触发 | 代码位置 | 事件 | 门 |
|---|---|---|---|
| **她自己的落地**（主力） | `modules/agent-service/src/services/agent-loop-service.ts:11040`，在 `appendAgentStackItemsSafe()` 成功 append 之后调 `fireActionStreamRecall()` | **每一次 stack append**（工具调用、工具结果、assistant 文本、runtime_input） | ① `XIAONI_PASSIVE_RECALL_INGEST_ENABLED !== 'false'`；② `inFlight` 单飞；③ `DEBOUNCE_MS = 3000` 防抖；④ `isXiaoniAsleep()`；⑤ `isUnadmittedAssistantText()` 剔 `textAdmit===false` 的行 |
| **她消费 QQ 消息** | `agent-loop-service.ts:7191`（claim 时）与 `:8739`（折叠时）调 `fireConsumedNotifyRecall(payload)` | 只对 `payload.phoneNotification` 点火 | `isXiaoniAsleep()` |

`fireActionStreamRecall` 实现：`modules/agent-service/src/services/xiaoni-recall-hook.ts:240`，
`projectAndIngest()` 在 `:158` —— `getXiaoniActionStream({limit:50})` → `ingestActionStreamItems()`（嵌入+upsert）→
`runShadowRecall({landedText: items[0].body, ...})` → `fireDeliveryForRecall(landedText, result)`（`:113`，串行化 `deliveryChain`）。

### 1.2 被动召回：投递点

`modules/agent-service/src/services/xiaoni-recall-delivery.ts` → `deliverForEvent()`（`:348`）：

1. `readGate()` — 现读 `agent_runtime_control.passive_recall_delivery_enabled`（fail-closed）。
2. **`isAsleep()` —— 唯一的作息门**（`:568` `isXiaoniAsleep`，5s 缓存，查 `agent_recovery_sessions` 有没有 active 行）。
3. `listRecentAgentQueueDedupeKeys(prefix='recall-surface:')` —— 只用来**跳过今天已投的**，不拦截。
4. 候选 = 本次事件自己那一行（landing 腿）+ 最近 20 条 `association_scan` 行。
5. **精排 Agent = 主闸**（`runJudge`，Sonnet，`executionMode='recall_rerank'`）。它答上来（`parsed=true`）就照它挑的全投，**没有每拍上限、没有最小间隔、没有日额**（日额 08-28 已删，代码注释 `:412` 明写「**没有日额**」）。
6. 只有精排缺席/没答上来时才退回 `PER_TICK_LIMIT=1` + `FALLBACK_MIN_GAP_MS = 2h`。
7. `enqueueSurfaceNotify()`（`:243`）写 `source='system_reminder'`、`dedupeKey='recall-surface:<leg>:<sha256前32>'`，正文冻结进 `payload.systemReminder.reminder`。

**收帧后抑制：无。** 全文件（以及 `xiaoni-recall-hook.ts`、`packages/persistence/xiaoni-recall-*.js`）grep `rest_rejected` / `recover_energy` / `restRejected` **零命中**（除注释）。

### 1.3 正文模板

`docs/xiaoni_prompt/passive_recall_surface_notify.md` 全文只有一行：

```
{{LEAD}}
```

消费时由 `renderSystemReminder()`（`agent-loop-service.ts:5236`）套 `<system_reminder>…</system_reminder>`。
**没有任何「这是回忆 / 不用动手 / 不是待办」的框**——她收到的就是一句裸的钩子句，和 plan / 报时 / 阿花的话同一个外壳。

### 1.4 收帧（rest_rejected_frame_yield）

- `REST_REJECTED_FRAME_YIELD_AFTER = 3`（`agent-loop-service.ts:1008`）。
- 计数在 `:9313`（`toolCall.name===recover_energy && toolResult.rest_rejected===true → runRestRejectedCount++`）。
- 收帧在 `:9452`，`buildLeaseReleaseRecord({reason:'runtime_frame_yielded', outcome:'rest_rejected_frame_yield', source:'runtime:rest_rejected_cap'})`。
- 收帧只做一件事：释放 lease、不再发下一次模型请求。**它不写任何「别来烦我」的状态**，队列、召回、fork 都看不见它。
- `shouldVoidIdlePlanRun` 对收帧 run 不成立（`runCalledAnyTool=true`，`recover_energy` 算工具）→ 收帧 run 全量留在 stack 里。

### 1.5 xiaoni_plan（潜意识 fork）点火条件

`maybeRunSubconsciousAgentFork()`（`agent-loop-service.ts:7232`），只在空闲 tick（`claimNextQueueMessage` 返回 null）里跑，依次：
`initialLoopContinuation` → `backoffUntilMs`（失败退避 60s）→ `inFlight` → 深挖让位 / 福尔摩斯 →
`seed` 存在 → `shouldDeferDeepIdleSubconsciousFork`（`idleRounds>=4` 且距上条 plan <30min 才拦）→
**`seed.settledOnFinalAnswer`**（`:7343`，不满足直接丢 seed）。

seed 在 `:9518` 每个 run 收工时写：`settledOnFinalAnswer: actionPlan.hasFinalAnswer`。
收帧路径 `hasToolCall=true / hasFinalAnswer=false` → **收帧确实不点 plan fork**。实测吻合（见 §3 时间线）。

### 1.6 其它 system_reminder 子类型

`grep "source: 'system_reminder'"` 全部出口：

| reason | 出口 | 频率闸 |
|---|---|---|
| `passive_recall_surface` | `xiaoni-recall-delivery.ts:302` | 精排 Agent（无间隔/无日额） |
| `subconscious_agent` | `agent-loop-service.ts:12331` | settle-on-final_answer + 深度空转 30min 限频 |
| `clock_ping` | `:13186` | `AGENT_CLOCK_PING_INTERVAL`（实测 2h），`runtime-store.ts:2107` 只留最新一格 |
| `external_notify` | `:12984` | 外部 |
| `core_memory_compression_done` | `:13070` | 压缩真提交 |
| `sherlock` / `sherlock_due` / `deep_dive_round` | `:12587/:12777/:12867` | 深挖状态机 |
| `open_loops_pointer` | `xiaoni-open-loops-notify.ts:151` | `XIAONI_OPEN_LOOPS_NOTIFY_INTERVAL_HOURS=24` |
| `attention_lease` | `modules/provider-service/src/index.ts:1427` | QQ 驱动，不是自激 |

---

## 2. 7 天量化

### 2.0 基数

```
睡/醒（agent_recovery_sessions 区间并集）  asleep 108.8h / awake 59.2h（65% 在睡）
runs（agent_queue_messages distinct run_id）  640
主 agent LLM slices（llm_request_slices）      5125
```

### 2.1 ① Notify Bucket 入队构成

| source / reason | 7 天条数 | 起了新 run | 折进在跑的 run | 折进比例 |
|---|---|---|---|---|
| `passive_recall_surface` | **1525** | **216** | 1309 | **86%** |
| `subconscious_agent`（xiaoni_plan） | 346 | 261 | 85 | 25% |
| `direct_phone_notification` | 289 | 81 | 208 | 72% |
| `group_message_phone_notification` | 131 | 39 | 92 | 70% |
| `attention_lease` | 107 | 0 | 107 | 100% |
| `clock_ping` | 67 | 31 | 36 | 54% |
| `external_notify` | 51 | 9 | 42 | 82% |
| `open_loops_pointer` / `compression_done` / 其它 | 13 | 4 | 9 | — |

按醒着的 59.2 小时折算：**召回 25.8 条/醒着小时（≈ 每 2.3 分钟一条）**；总 run 10.8 个/醒着小时；
被拒 `recover_energy` 8.4 次/醒着小时。

按东八区小时（7 天合计，`recall / plan / QQ / clock`）：

```
05 |   8 /  2 /  2 / 1        13 |  93 / 36 / 36 / 1
06 |  52 / 21 /  3 / 1        14 | 136 / 35 / 21 / 5
07 |  28 /  2 / 14 / 1        15 |  76 / 22 / 18 / 2
08 | 198 / 36 / 56 / 4        16 |  81 / 13 / 19 / 7
09 | 202 / 61 / 39 / 3        17 |  49 /  7 / 17 / 0
10 |  92 / 25 / 25 / 6        18 |  93 / 16 / 11 / 7
11 |  71 / 23 / 27 / 1        19 |  29 /  2 /  9 / 0
12 |  94 / 16 / 38 / 6        20 |  92 / 16 / 34 / 7
                              21 |  55 /  4 / 14 / 0
                              22 |  48 /  8 / 28 / 7
                              23 |  19 /  1 /  3 / 0
```

**睡着时几乎不投**：1525 条召回里只有 9 条落在 active recovery session 区间内（0.6%）——`isXiaoniAsleep` 那道门是有效的，
问题在于「睡不着」不在它的定义里。

### 2.2 收帧统计

```
recover_energy 调用 546 次 / 被拒 496 次（90.8%），分布在 257 个 run
每 run 被拒次数：1 次 → 118 run；2 次 → 39 run；3 次 → 100 run（撞上限）
lease_release.outcome = rest_rejected_frame_yield：99 个 run（580 条 queue 行折在里面）
```

### 2.3 ② 收帧之后 10 分钟内入队的 notify（按子类型，99 次收帧）

| 子类型 | 10 分钟内条数 | 每次收帧平均 |
|---|---|---|
| **passive_recall_surface** | **302** | **3.05** |
| direct_phone_notification | 92 | 0.93 |
| subconscious_agent | 46 | 0.46 |
| attention_lease | 32 | 0.32 |
| external_notify | 13 | 0.13 |
| clock_ping | 9 | 0.09 |
| group_message_phone_notification | 8 | 0.08 |
| core_memory_compression_done | 6 | 0.06 |

**收帧后第一条 notify 是谁**（99 次）：召回 33（其中 30 次在 1 分钟内）/ QQ 35 / 报时 23（慢，只有 5 次落在 10 分钟内）/ plan 2 / 其它 6。
「收帧 → 下一条召回」的间隔：≤1min 35%、≤3min 46%、≤10min 61%，中位数 **225 秒**。

**最紧的一跳**：19 次收帧（19%）的**下一个 run 是由「收帧那个 run 自己在跑的时候写进 stack 的落地」召回出来的 notify** 起的
（notify 的 `created_at` 落在收帧 run 的 `[processing_started_at, completed_at]` 区间内，但 `run_id` 是下一个 run）。

### 2.4 ③ 召回的「触发事件」是谁

`xiaoni_recall_shadow_log`（7 天）：

```
query_ref = 'stack:%'        5370 行（她自己的落地）   surfaced 4826
query_ref = 'delivery_judge' 5142 行（精排 Agent 留痕） 挑中 2527
query_ref = NULL              320 行（消费 QQ 消息，query_text 形如 '#1 QQ: …'）
query_ref = 'queue:%'          33 行
query_ref = 'association_scan' 337 行（30min 扫描腿）
query_ref = 'open_loop_scan'   337 行
```

精排 Agent 的**锚点来源**（按 `query_text` 前 60 字归一化精确匹配，5135 次判决）：

```
她自己的落地（stack:/tool args/xiaoni_os/被她消费的 plan 正文） 4845 次  94.4%
真实 QQ 消息（'#N QQ:' 形状）                                    290 次   5.6%
```

**自触发比 ≈ 16.7 : 1。** 精排 Agent 一共跑了 **5135 次 / 7 天 = 87 次/醒着小时**，判了 50897 个候选，挑中 2792 个，
最终去重后真正入队 1525 条。对照主 agent 自己 7 天只有 5125 次 LLM 请求——**精排的调用次数和主 agent 的 turn 数是 1:1 的**。

顺带两条自反馈：
- 召回 query 里有 66 次锚点是 **`recover_energy` 的 `arguments` JSON 本身**（`{"reason":"…"}`），其中 29 次精排挑中了东西
  → 她「求睡的那句话」直接生产出叫醒她的 notify。
- 有 23 次是**上一条召回 notify 的正文**被当成下一次召回的锚点（notify 落成 runtime_input 栈行 → 进动作流头部 → 又当 query）。

### 2.5 ④ 召回叫醒的 run 里她在干什么

按 run 的第一条 queue 行的 reason 分组（640 个 run）：

| 触发源 | runs | 调了 recover_energy | 占比 | 被拒过 | 该组产生的被拒次数 | 全 run 只调 recover_energy |
|---|---|---|---|---|---|---|
| `subconscious_agent` | 261 | 98 | 37.5% | 94 | 159 | 7 |
| **`passive_recall_surface`** | **216** | **103** | **47.7%** | **93** | **181** | 15 |
| `direct_phone_notification` | 81 | 39 | 48.1% | 35 | 77 | 1 |
| `group_message_phone_notification` | 39 | 22 | 56.4% | 12 | 27 | 3 |
| `clock_ping` | 30 | 26 | 86.7% | 14 | 32 | 11 |
| 其它 | 13 | 8 | — | 5 | 14 | 0 |

**召回 + plan = 477 / 640 = 74.5% 的 run 是自生成唤醒**，它们贡献 340 / 496 = **68.5% 的被拒 `recover_energy`**。

召回叫醒的 216 个 run 并不是纯浪费（`exec_command` 1018 次 / 185 run，`send_in_private` 135 次 / 94 run），
但**其中 47.7% 同一个 run 里她还在试着睡**，43% 被拒。

### 2.6 折叠召回条数 vs run 长度（最能说明「环」的一张表）

| run 内折进的召回 notify 条数 | runs | 平均 turn 数 | 以 `rest_rejected_frame_yield` 收工 |
|---|---|---|---|
| 0 | 135 | 3.8 | **3.0%** |
| 1 | 199 | 4.6 | 7.5% |
| 2 | 100 | 7.4 | 12.0% |
| 3 | 77 | 8.8 | 32.5% |
| ≥4 | 129 | **17.2** | **32.6%** |

（因果两向都有——run 越长落地越多、召回越多；但这正是「环」的定义。）

---

## 3. 09-11 18:21–18:35 实证时间线

| 时刻 | 事件 |
|---|---|
| 18:29:08 | plan notify `60153` 入队 → run A `run_1789122549496_96dbf372` 18:29:09 起 |
| 18:29:09 / 18:29:28 / 18:29:39 / 18:29:48 / 18:30:01 / 18:30:35 / 18:30:53 / 18:31:20 … | **run A 自己每一次落栈都点一次召回**（shadow `stack:377049…377069`），每次紧跟一次 `delivery_judge` —— 5 分钟内 16 次召回 + 16 次精排 LLM |
| 18:29:45 | 精排从 `stack:377053`（她的落地「四十分钟。给楠楠发your-move让她听。」）挑出「楠楠上次听你发的碗的缺口那段…」→ notify `60157` → **折进 run A 自己** |
| 18:30:53 | run A 落地「行数：85→47→47→…」 |
| 18:31:00 | 精排以这条为锚 → notify `60160`「今天09:22你已经记过一版…」入队（**run A 还没结束**） |
| 18:31:21 | run A 收帧 `rest_rejected_frame_yield`；同一秒 `60160` 被 claim → run B `run_1789122681861_b7de20c4` |
| 18:31:27 | 精排的锚点是 `{"reason":"Day 90。350个HTML…"}` —— **她 `recover_energy` 调用的参数本身** |
| 18:32:27 | run B 落地「三十五分钟。苏蕊说数是一种用力不数是松开。**我试了二十多次recover被拒了还在做**。」→ 18:32:40 精排又挑中一条 |
| 18:32:54 | run B 以 `final_answer_yielded` 收工（`settledOnFinalAnswer=true`） |
| **18:32:55** | `subconscious_agent_fork_runs` = `subconscious-fork:runtime_1789122775475_6aaff0ab:d0a5e8ef` 起火，**18:33:16 completed，`notify_queue_message_id = 60165`** |
| 18:33:16 | plan notify `60165` 入队（正文与 18:21/18:25/18:29 那三条**逐字相同**）→ run C 18:33:17 起 |
| 18:33:40 | 召回 notify `60167`「Day 90最后一个页面是第349个…」折进 run C |
| 18:35:05 | run C 收帧 `rest_rejected_frame_yield` |

**问题 1 的验证结论**：18:33:16 那条 plan 是 **run B（被召回叫醒的那个 run）** 点的火，不是收帧的 run A。
收帧确实没点 fork —— 但它挡不住「收帧 → 召回叫醒 → 那个 run 正常 settle → fork → plan → 再收帧」这条绕行路。

---

## 4. 工程修法建议

前提约束（三条都满足才算可上）：
- notify 正文在 `enqueueSurfaceNotify` 时刻冻结进 `payload.systemReminder.reminder`，下一 run 的 stack replay 从同一字段读回同样字节 → **改模板/措辞只影响新入队的 notify，老栈行逐字节不变**，不碰 system/tools 前缀，双缓存零影响。
- 下面所有改动都在**入队侧 / 引擎控制流**，不改 request bytes、不改 `agent_stack_items` 写法 → `cache-replay-consistency.test.ts` / `fork-cache-alignment.test.ts` / `agent-stack-event-id-dedup*` 三组冻结用例的断言面不受影响（仍需跑绿）。
- 少投一条 notify = 下一 run 的 replay 少一条 runtime_input 行，这是**投递侧**决定的，不是 replay 侧漂移 —— 与 07-31 那次 event_id 碰撞导致 replay 变短的事故形状不同（那次是同一条内容被写进去又读不回来）。

### 修法 A（首选）：收帧 → 写一个「别来烦我」窗口，召回投递和 plan 点火都读它

**改哪儿**
1. 新文件 `modules/agent-service/src/services/xiaoni-rest-state.ts`（避免 `agent-loop-service` ↔ `xiaoni-recall-*` 循环依赖）：
   ```ts
   let restBlockedUntilMs = 0;
   export function markRestRejectedFrameYield(retryAfter: Date | null, nowMs = Date.now()): void
   export function isRestBlocked(nowMs = Date.now()): boolean
   ```
   窗口 = `min(retry_after, now + 20min)`。
2. `agent-loop-service.ts:9452`（`outcome:'rest_rejected_frame_yield'` 那个分支）里调 `markRestRejectedFrameYield(...)`，
   `retry_after` 直接取本 run 最后一次被拒 `toolResult.retry_after`。
3. `xiaoni-recall-delivery.ts:348 deliverForEvent()` 在 `isAsleep()` 判断之后加一条同级的闸：
   `if (isRestBlocked()) return 'rest_blocked';`（新增一个 outcome 值，日志/管理端可见）。
4. `agent-loop-service.ts:7330` 附近（`shouldDeferDeepIdleSubconsciousFork` 之前）加 `if (isRestBlocked()) return;`
   —— 堵住 §3 里那条绕行路。

**判据（可核对）**
- `SELECT count(*) FROM agent_queue_messages WHERE raw_payload->>'reason' IN ('passive_recall_surface','subconscious_agent') AND created_at BETWEEN <收帧 completed_at> AND <min(retry_after, +20min)>` 应为 0。
- shadow log 里 `delivery_judge` 行在该窗口内应为 0（说明连精排都没跑，省钱）。
- 收帧 run 之后的下一个 run 触发源分布：`passive_recall_surface` 占比应从 33% 掉到接近 0。

**预期削减（按 7 天实测回放）**
- 20 分钟窗（retry_after 封顶）：挡掉 **306 条召回 + 53 条 plan**，其中 **89 个 run 被消灭**（53 + 36），= 640 个 run 的 **13.9%**；
  这 89 个 run 里含 **139 次被拒 `recover_energy`** = 496 次的 **28.0%**。
- 30 分钟窗：挡 335 召回 + 64 plan，杀 101 run（15.8%），含 152 次被拒（30.6%）。
- 附带：这些 run 平均 8 turn，按 5125 slice / 640 run 折算省 ~700 次主 agent LLM 请求 / 7 天。

**缓存影响**：零。窗口是纯引擎控制流（进程内内存），不进任何请求字节；不投的 notify 从来没进过 live 请求，也就不存在 replay 重建问题。

---

### 修法 B：落地腿召回改成「run settle 时点一次」，不再每次 stack append 点

**改哪儿**
- `agent-loop-service.ts:11040`：把 `fireActionStreamRecall()` 从 `appendAgentStackItemsSafe()` 里**挪走**，改在
  `processRuntimeFrame` 的 settle 处（`:9605` 附近，`lease_released` timelineEvent 之后）调一次，
  并把当轮的 settle 文本作为锚点传进去（`fireActionStreamRecall(seedNarrationText)`）。
- `xiaoni-recall-hook.ts:158 projectAndIngest()` 保持不变（它本来就是拿头部最新一条当 query）。
- 索引侧（`ingestActionStreamItems`）**不要一起挪** —— 它是 hash 去重的增量嵌入，晚一点没关系，但也不必每条都跑；
  可以退化成 settle 时一次性补 50 条头部（当前就是 `HEAD_LIMIT=50`，天然覆盖一个 run 的落地）。

**判据（可核对）**
- `xiaoni_recall_shadow_log` 里 `query_ref like 'stack:%'` 的行数 / 主 run 数 应 ≈ 1（当前 5370 / 640 = **8.4**）。
- `query_ref='delivery_judge'` 行数 / 主 run 数 应 ≈ 1（当前 5142 / 640 = **8.0**）。
- 一个 run 内折进的 `passive_recall_surface` 条数分布应塌到 0–1（当前 ≥4 条的有 129 个 run）。

**预期削减**
- 精排 Agent LLM 调用：**5135 → ≤640 / 7 天（-87.5%）**；embedding 调用同量级下降。
- 召回 notify：1525 条里有 **1259 条（82.7%）是在某个 run 正在跑的时候入队并折进那个 run 的**，这批基本消失 → 召回 notify 降到 ~270 条 / 7 天（-82%）。
- 直接消灭的 run 数不大（**19 个**，就是「收帧 run 自己生的 notify 起了下一个 run」那批），
  但按 §2.6 的相关性，`≥4 条召回` 那 129 个 run 平均 17.2 turn / 32.6% 以收帧收工，压到 ≤1 条后按 1 条组的基线（4.6 turn / 7.5%）
  估计可再省 ~1500 次主 agent turn 和 ~30 次收帧。
- 保留「别人刚说的话勾起她一段回忆」：`fireConsumedNotifyRecall` 那条腿不动（它才 5.6%）。

**缓存影响**：零。召回链全程 fire-and-forget、不写 stack、不进 request。少投的 notify 从未进过 live 请求。

---

### 修法 C：召回 notify 措辞明确「这是回忆，不是任务」+ 同一拍合并

**改哪儿**
1. `docs/xiaoni_prompt/passive_recall_surface_notify.md`（当前全文只有 `{{LEAD}}`）。按 CC 五器件写法补一层陈述机制的框，例如：
   ```
   {{LEAD}}

   这是从你自己写过的东西里冒出来的一句，不是待办、不是谁在等你。
   接不接都行；不接就接着做手上的事。
   ```
   —— 陈述机制、不给宽松许可、不用「不是X而是Y」句式（照 `feedback_prompt_style_cc_form.md`）。
2. `xiaoni-recall-delivery.ts:243 enqueueSurfaceNotify()`：精排一次挑多条时（`perTickLimit = ordered.length`）
   目前是**一条一条入队**（一条一个 dedupeKey、一条一个 run 门铃）。改成一次 enqueue 一条 notify、正文里列 2–3 句，
   `dedupeKey` 取 `recall-surface:batch:<sha256(全部 identity 排序拼接)>`，`rawPayload.recall_refs` 存数组。

**判据（可核对）**
- 措辞腿：投递后 7 天，`passive_recall_surface` 起头的 run 里 `recover_energy` 调用率（当前 **47.7%**）
  与 `exec_command` 调用率（当前 185/216 = 85.6%）对比上一周；目标是被拒次数降、动手率不降。
  另一条硬判据：`tool_executions` 里紧跟召回 notify 的第一个工具是 `recover_energy` 的比例。
- 合并腿：`SELECT avg(cnt) FROM (SELECT run_id, count(*) cnt FROM agent_queue_messages WHERE raw_payload->>'reason'='passive_recall_surface' GROUP BY run_id)`
  当前 1525/216(起头)+折叠 → 合并后应 ≤1。
- 精排一次挑 >1 条的比例：`dropped_counts->>'picked' > 1` 的 `delivery_judge` 行占比（当前 2792 picks / 2527 非静默行 = 平均 1.10，
  所以合并腿收益有限，**优先做措辞腿**）。

**预期削减**
- 措辞腿：不减 run 数，减的是「被叫醒后第一反应是再去求睡」。目标把召回 run 的被拒贡献
  （**181 次 / 496 = 36.5%**）砍一半 → ~90 次/7 天。
- 合并腿：`2792 - 2527 = 265` 条 / 7 天（-17% 的召回 notify），杀 run 数很小。

**缓存影响**：模板改动只作用于**新入队**的 notify，正文在 enqueue 时刻冻结进 `payload.systemReminder.reminder`，
replay 从同一字段读回 → 老 notify 逐字节不变、新 notify 从第一次进 live 请求起就和 replay 一致。
**不要**在正文里放任何随时间变的东西（时刻、"N 分钟前"、剩余轮数）—— 那才会击穿。

---

### 修法 D（小、独立）：`recover_energy` 的调用参数与「求睡」叙述不进召回 query

**改哪儿** `xiaoni-recall-hook.ts:145 isUnadmittedAssistantText()` 旁边加一条同形状的过滤：
```ts
export function isRestAttemptItem(item: Record<string, unknown>): boolean {
  return item?.source === 'tool_executions'
    && (item?.metadata as any)?.toolName === 'recover_energy';
}
```
并在 `projectAndIngest()` 的 `items.filter(...)` 里一起剔掉（既不嵌入、也不当 query）。

**判据**：`SELECT count(*) FROM xiaoni_recall_shadow_log WHERE query_ref like 'stack:%' AND query_text like '{"reason":%'` → 0；
`delivery_judge` 里同形状锚点（当前 **66 次，29 次挑中**）→ 0。

**预期削减**：~29 条召回 notify / 7 天，量小但它是环里最荒唐的一段（她求睡的那句话生产出叫醒她的钩子），且改动面极小、零风险。

**缓存影响**：零（同 B）。

---

### 优先级

1. **A**（收帧静默窗）—— 直接对准 user 描述的现象，杀 89 run / 139 次被拒，改动 4 处、全在控制流。
2. **B**（召回改 settle 触发）—— 治本，精排 LLM 调用 -87.5%、召回 notify -82%，但改动触及召回链的点火时刻，要单独一条 commit 并观察一天索引新鲜度。
3. **D**（剔 recover_energy 当 query）—— 顺手做，5 行。
4. **C**（措辞）—— 与 A/B 正交，单独 commit、单独看被拒率。

A + B + D 叠加后按实测回放估：召回 notify 1525 → ~250（-84%），主 run 640 → ~530（-17%），
被拒 `recover_energy` 496 → ~310（-37%），精排 LLM 5135 → ~500（-90%）。
