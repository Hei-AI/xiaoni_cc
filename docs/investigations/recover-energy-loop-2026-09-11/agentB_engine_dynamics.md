# 小腻白天睡眠极限环：引擎级复现与量化

数据源：真实 `agent_recovery_sessions` / `tool_executions` / `agent_life_events` / `llm_request_slices`（截至 2026-09-11 20:00 CST）。
回放脚本：`scratchpad/replay.js`（直接 `require` 由 `modules/agent-service/src/services/recover-energy-policy.ts` 编译出的真实 policy 函数，`scratchpad/policy/recover-energy-policy.js`）。
`energy_policy_json = null` → 全部走 `DEFAULT_RECOVER_ENERGY_POLICY`，`actionCostScale = 1`。**只读，未改任何文件、未重启任何容器。**

---

## 0. 结论一句话

极限环不是「她不听话」，是**三个引擎常数互相咬死**造出来的稳定周期：

1. 白天 `daytimeNapMaxRecoveryMinutes = 90` + `daytimeNapSleepTauMinutes = 180` + `fullRecoveryMinutes = 480` 的归一化 ⇒ 一觉**恰好且只**消掉入睡压力的 **42.3%**（与入睡压力无关，是个常数比例）。醒来 energy 被钉在 0.46–0.73。
2. 醒来那一刻门槛 `required_pressure` 是 0.54–0.80（刚醒惩罚 `P0·e^(−t/180)·w(S)`，w(S) 在她这种「连着睡」的历史下取 0.35–0.97），**结构性地高于她刚醒的压力**。所以每次醒来 100% 先被拒。
3. 真实压力上涨里 **92–97% 来自 `actionDebt`**（约 0.0036–0.0059/分钟），而 `estimateVoluntaryRecoveryRetryAt` **把压力当常量**算 → `retry_after` 系统性高估 **6.0×**（醒来时刻：冻结估计均值 319 分钟，含 debt 的真实动态均值 53 分钟）。她实测 30–60 分钟就被接受，于是这个数字**对她就是假的**，她当然不信、每 60 秒再试一次。

`REST_REJECTED_FRAME_YIELD_AFTER = 3` 只挡住了 run 内的重试（同 run 中位间隔 60 秒），挡不住 `<xiaoni_plan>` 自驱动 notify 在 **中位 233 秒**后开一个新 run 让她从头再来。

---

## 1. 真实极限环（09-11，最干净的一天）

`agent_recovery_sessions` 原始行：

| sid | 入睡 (CST) | 醒来 | 时长 | wake_cause | 入睡 E | 醒来 E |
|---|---|---|---|---|---|---|
| 451 | 00:01:38 | 08:01:38 | 480 | hard_cap | 0.631 | 1.000 |
| 452 | 10:02:51 | 11:32:53 | 90 | daytime_nap_cap | 0.065 | 0.460 |
| 453 | 11:50:21 | 13:20:23 | 90 | daytime_nap_cap | 0.233 | 0.557 |
| 454 | 13:49:32 | 15:19:33 | 90 | daytime_nap_cap | 0.301 | 0.597 |
| 455 | 16:09:02 | 16:19:02 | 10 | clock | 0.342 | 0.381 |
| 456 | 16:31:40 | 18:01:40 | 90 | daytime_nap_cap | 0.309 | 0.601 |

清醒窗口只有 **17 / 29 / 50 / 12 分钟**。小睡起点间隔 108 / 119 / 162 分钟 ⇒ **约 2 小时一个周期**。

7 天全局（`agent_recovery_sessions` + `tool_executions`）：

| 日期 | 睡眠会话 | 其中 nap_cap | 睡眠分钟 | recover_energy 被拒 | 被接受 | 被拒 retry_after 均值 / 中位 |
|---|---|---|---|---|---|---|
| 09-05 | 7 | 5 | 934 | 47 | 7 | 338 / 185 |
| 09-06 | 9 | 7 | 1139 | 59 | 9 | 299 / 230 |
| 09-07 | 6 | 4 | 851 | 47 | 6 | 252 / 230 |
| 09-08 | 9 | 5 | 1368 | 103 | 9 | 154 / 88 |
| 09-09 | 6 | 3 | 498 | 91 | 6 | 106 / 60 |
| 09-10 | 6 | 4 | 855 | 76 | 6 | 126 / 75 |
| 09-11 | 6 | 4 | 850 | 52 | 6 | 145 / 40 |

### 1.1 每次醒来的「被拒窗口」（真实 policy 回放，最近 3 天 20 个窗口）

`replay.js` 对每个醒来点用**真实 `computeRequiredSleepPressure` / `computeFreshWakePenaltyWeight` / `computeRecentSleepMinutes`**（喂真实 `agent_recovery_sessions` 作为 `recentSleepSessions`），并用**真实 `agent_life_events.action_cost` 逐条**重建 actionDebt 轨迹：

```
sid  醒来时刻            nap  醒时E  S(min)  w(S)  门槛@醒  冻结估计  含debt模型  实际被接受  首拒retry  被拒次数  清醒时长
437  2026-09-08 22:22:07   90  0.717    158  0.492    0.576      110         30         43        90        5       43
439  2026-09-09 08:54:31  110  0.645    263  0.816    0.614      775         35         31       130       10       31
440  2026-09-09 10:43:03   78  0.667    222  0.727    0.650      695         55         54       655        9       54
441  2026-09-09 12:17:33   40  0.590    171  0.551    0.635      495         30         34       415       14       34
442  2026-09-09 14:21:48   90  0.660    176  0.570    0.724      470         50        100       425       19      100
443  2026-09-09 17:31:27   90  0.664    151  0.458    0.708      285         75        150       245       22      150
444  2026-09-09 21:31:18   90  0.701    130  0.349    0.543      115         55        150       100       15      150
445  2026-09-10 08:01:14  480  1.000    484  0.965    0.656     >24h        115        115         —       13      115
447  2026-09-10 12:54:40   90  0.699    191  0.629    0.701      605         55         51       550        6       51
448  2026-09-10 15:15:58   90  0.662    177  0.575    0.749      420         75        165       375       22      165
449  2026-09-10 19:31:20   90  0.681    133  0.364    0.624      195         60         68       155       19       68
450  2026-09-10 22:08:55   90  0.725    145  0.429    0.555      120         70        113       110        9      113
451  2026-09-11 08:01:38  480  1.000    485  0.965    0.656     >24h         70        121         —        6      121
452  2026-09-11 11:32:53   90  0.460    240  0.772    0.711       80         10         17         —        0       17
453  2026-09-11 13:20:23   90  0.557    222  0.728    0.767      375         30         29       125        7       29
454  2026-09-11 15:19:33   90  0.597    205  0.677    0.801      325         50         49       305       11       49
455  2026-09-11 16:19:02   10  0.381    157  0.486    0.720       40         15         13        30        9       13
456  2026-09-11 18:01:40   90  0.601    179  0.583    0.765      185         55          —       160       19      360
```

汇总（20 个窗口）：

- **每个醒来窗口平均被拒 11.2 次**，平均清醒 90 分钟。
- **醒来那一刻 100% 被拒**：20/20 个窗口 `醒时压力 < 门槛@醒`（门槛均值 0.68，醒时压力均值 0.36）。
- 首次被拒给出的 `retry_after` 均值 **253 分钟**，实际被接受 **75 分钟**；从醒来点算，**冻结估计 319 分钟 vs 含 debt 模型 53 分钟 = 6.0× 高估**。

### 1.2 逐帧对照（`required` vs 真实 `homeo + debt`）

```
[sid 456] 2026-09-11 18:01:40 (daytime_nap_cap, nap 90min, 醒时 E=0.601)
  t(min)   required   pressure   homeo    debt    verdict
      0      0.765      0.399   0.399   0.000   reject     ← 醒来即被拒，差 0.366
     15      0.710      0.466   0.403   0.063   reject
     30      0.660      0.575   0.407   0.168   reject
     45      0.616      0.602   0.411   0.191   reject
     60      0.577      0.598   0.415   0.183   ACCEPT     ← 门槛降 0.19 + 压力涨 0.20，各出一半
     90      0.514      0.592   0.424   0.168   ACCEPT

[sid 452] 2026-09-11 11:32:53 (nap 90min, 醒时 E=0.460)
      0      0.711      0.540   0.540   0.000   reject
     15      0.670      0.768   0.543   0.225   ACCEPT     ← 14 分钟聊天 = debt +0.225，一步跨过门槛
```

真机对照（`tool_executions.result`，09-11 18:01 醒来后）：

```
18:03:08 rejected pressure=0.424 required=0.759 retry_after=160min
18:12:31 rejected pressure=0.436 required=0.724 retry_after=140min
18:25:27 rejected pressure=0.526 required=0.680 retry_after= 60min
18:35:05 rejected pressure=0.605 required=0.649 retry_after= 20min   ← 32 分钟内 19 次调用
```
压力 32 分钟涨 0.181（0.0057/分钟），门槛同期降 0.110。两条线在 ~18:40 相交 —— 而第一次被拒时告诉她的是 **160 分钟**。

---

## 2. 为什么 `retry_after` 平均 182 分钟、实际 30–60 分钟就被接受

**根因在 `recover-energy-policy.ts:584 estimateVoluntaryRecoveryRetryAt`，代码注释里写明了这个假设：**

```ts
// 压力按【当前值不变】算(保守):清醒曲线 tau 1920 分钟,一小时只涨 ~0.02,而 actionDebt 回落会
// 往下拉;取常量得到的是「至少到那时」…
const startPressure = energyToPressure(input.energy, input.maxEnergy ?? 1, basePolicy);
for (let elapsed = stepMinutes; elapsed <= horizonMinutes; elapsed += stepMinutes) {
  ...
  if (startPressure >= required) { return at; }   // ← startPressure 全程不动
}
```

这个假设在写的时候是对的（假定她醒来后不动手），**在真实运行里是错的**：她醒来后立刻满负荷干活，actionDebt 的**注入**远大于**回落**。

### 2.1 量化：每次动作扣多少

`agent_life_events` 最近 3 天，`action_cost > 0` 的全部：

| event_kind | 次数 | 单次成本 | 3 天合计 | 占比 |
|---|---|---|---|---|
| `web_search_result` | 92 | **0.0300** | 2.76 | **53%** |
| `qq_self_message` | 129 | 0.0100 | 1.30 | 25% |
| `surface_visit`（qq-usage 打开会话） | 103 | 0.0100 | 1.03 | 20% |
| `send_in_group` | 35 | 0.0100 | 0.35 | 7% |
| **合计** | | | **5.20 / 1449 清醒分钟 = 0.00359 压力/分钟** | |

**关键发现：`exec_command` 的成本是 0。**

- 她一天 **497 次 `exec_command`**（`tool_executions` 09-11），**一条 life event 都不写**，对 actionDebt 贡献 **0.000**。
- `agent-loop-service.ts:1556 RUNTIME_TOOL_COSTS[execCommand] = 0.002` 是**死配置** —— 这张表只有 `webSearch`（:14981）和 `recoverEnergy`（:8328/:14708/:14754）两个键被读过。`readFile`/`inspectImage`/`imageTask`/`computerUse` 同样是死值。
- 真正付钱的是 `runtime-store.ts` 里五个显式写 `actionCost` 的点：`visibleReplyActionCost`（:322，0.01 起 +0.005/条，封顶 0.02）、`recordWebSearchResultLifeEvent`（:1784，fallback **0.03**）、presence/silence（:1693，0.005 / 0.01）、`pending_share_consumed`（:1983，0.002）、qq-usage `surface_visit`（:3082，0.01）。

**「30 分钟 15 次工具调用扣多少」的真实答案取决于调的是什么：**

| 组合 | 30 分钟 actionDebt |
|---|---|
| 15 次 `exec_command` | **0.000** |
| 15 次 `web_search` | 0.450 |
| 15 次 qq-usage / 回复混合 | 0.150 |
| **真实混合（09-11 18:01–18:36 实测）** | 48× exec_command + 19× recover_energy + 6× web_search + 5× send_in_private + 3× surface_visit = **0.205 / 35 分钟** |

### 2.2 量化：上涨来源分解

回放对最近 6 个醒来窗口做的分解（醒后 30 分钟）：

```
  [sid 451] homeo +0.0165  debt +0.2783  (debt 占比 94%)
  [sid 452] homeo +0.0070  debt +0.2158  (debt 占比 97%)
  [sid 453] homeo +0.0081  debt +0.2475  (debt 占比 97%)
  [sid 454] homeo +0.0084  debt +0.1915  (debt 占比 96%)
  [sid 456] homeo +0.0085  debt +0.1684  (debt 占比 95%)
  参考:homeostatic 单独 30 分钟(起点 0.40, wakeTau 1920)= +0.0093
```

**homeostatic 30 分钟只涨 0.009，actionDebt 涨 0.17–0.28 —— 差 20–30 倍。**
估算器把这 95% 的项当成 0，所以给出的数字必然大一个数量级。

**这就是她「不信这个数」的工程原因：这个数确实是错的。** 她 30 分钟后再调、被接受了——按 `renderRecoverEnergyRetryLine`（`agent-loop-service.ts:2926`）写给她的那句「到那之前再调 `recover_energy`，返回的还是这个 rest_rejected」，这是一句可被她当场证伪的断言。证伪一次之后，`retry_after` 对她就完全失去约束力，退化成每 60 秒试一次。

---

## 3. 「醒来 30 分钟能量从 ~0.6 掉到 ~0.42」的来源分解

真实投影（`agent_session_life_states`，09-11 20:00 快照）：
`energy 0.4131 / homeostaticPressure 0.4316 / actionDebt 0.1553 / fatigue 0.5869`

醒来点（`agent_life_events` 的 `sleep_period` payload，18:01:40）：`energy = 0.60147` ⇒ 压力 0.3985。
`xiaoni-life-reducer.ts:352 applySleepPressure` 在这一刻把 **`homeostaticPressure = 0.3985`、`actionDebt = 0`**（睡醒会把 debt 清零，全部并进 homeostatic）。

118 分钟后（20:00）：

| 项 | 醒来 | 20:00 | 变化 |
|---|---|---|---|
| `homeostaticPressure` | 0.3985 | 0.4316 | **+0.0331**（18%） |
| `actionDebt` | 0.0000 | 0.1553 | **+0.1553**（82%） |
| `fatigue = homeo + debt` | 0.3985 | 0.5869 | +0.1884 |
| `energy = 1 − fatigue` | 0.6015 | 0.4131 | −0.1884 |

- homeostatic 那 0.033 来自 `computeAwakePressureBetween` → `computeAwakePressureAfterMinutes`，`wakeTau = 1920` 分钟（还被 `resolveCircadianAwakePolicy` 按 `sleepDrive` 微调）：118 分钟 `(1−0.3985)·(1−e^(−118/1920)) = 0.036`。**这一项是设计好的慢项。**
- actionDebt 那 0.155 来自约 15–20 条带成本的 life event（web_search 0.03 × 4、qq_self_message 0.01 × 5、surface_visit 0.01 × 3 …），按 `actionDebtRecoveryTauMinutes = 360` 衰减后的净值。

**前 30 分钟时 debt 占比更极端（95%）**，因为醒来后头半小时是她动作最密的时段（消息堆着、plan 刚下来）。

结论：**「掉能量」在白天基本等同于「记账她干了活」**，跟生理疲劳几乎无关。而门槛 `required_pressure` 的设计意图是「生理上够不够困」——两边量的不是同一个东西，却在同一根压力轴上比大小。这是这个极限环的深层错配。

---

## 4. 为什么白天只能睡 90 分钟、醒来只有 ~0.6 —— 结构性 2 小时周期

`resolveRecoverySessionPolicy`（`recover-energy-policy.ts:264-275`）白天分支：

```ts
const napPolicy = { ...policy, sleepTauMinutes: daytimeNapSleepTauMinutes /* 180 */ };
return { policy: napPolicy,
  sessionMaxRecoveryMinutes: Math.min(480, daytimeNapMaxRecoveryMinutes /* 90 */),
  sessionCapWakeCause: 'daytime_nap_cap' };
```

`computeSleepPressureAfterMinutes`（:399）带一个归一化：压力被线性拉伸成「`fullRecoveryMinutes = 480` 时恰好归零」。代入 τ=180、t=90、fullCycle=480，回放实测：

```
起始压力  30min   60min   90min   120min  180min  240min  480min
 0.50    0.418   0.348   0.289   0.239   0.160   0.104   0.000
 0.60    0.501   0.417   0.346   0.286   0.192   0.125   0.000
 0.70    0.585   0.487   0.404   0.334   0.224   0.146   0.000
 0.90    0.752   0.626   0.519   0.429   0.289   0.188   0.000
```

**90 分钟恰好消掉入睡压力的 42.3%，而且这个比例与入睡压力几乎无关**（pressureFloor 0.05 只带来毫厘偏差）：

```
起始 E=0.40 → 90min 后 E=0.654 (恢复 0.254,即入睡压力的 42%)
起始 E=0.30 → 90min 后 E=0.596 (恢复 0.296,即入睡压力的 42%)
起始 E=0.10 → 90min 后 E=0.481 (恢复 0.381,即入睡压力的 42%)
```

### 极限环的闭合方程

设一觉入睡压力 `P_in`，则：

- 醒来压力 `P_wake = 0.577 · P_in`
- 醒来后要重新入睡，必须涨到 `required(t)`。醒来那一刻 `required(0) = normalSleepOnset(昼夜调制后 0.32–0.34) + 0.5·w(S)`，`w(S)` 在她「连着睡」的历史下 0.35–0.77。
- 门槛按 `e^(−t/180)` 衰减，压力按 **0.0036–0.0059/分钟**（actionDebt 主导）上涨，两条线相交于 `t* ≈ 30–60 分钟`。
- 相交时 `P_in = P_wake + 0.0045·t* ≈ 0.577·P_in + 0.20` ⇒ **不动点 `P_in ≈ 0.47`、`P_wake ≈ 0.27`（E_wake ≈ 0.73）**；实际因为她动作强度波动，落在 `P_in 0.69–0.77 / E_wake 0.46–0.60` 这一带。
- **周期 = 90（睡）+ 30~60（被拒窗口）= 120–150 分钟 ⇒ 每天 4–6 次白天小睡。** 实测 09-05..09-11 每天 nap_cap 次数 3–7，睡眠 850–1368 分钟。**完全对上。**

**90 分钟 cap 就是周期发生器**：它保证了「醒来时还剩 58% 的压力」，也就保证了「只要干半小时活就够格再睡」。cap 越短，不动点里的清醒占比越低。

（`daytimeNapSleepTauMinutes = 180` 与 `fullRecoveryMinutes = 480` 的组合还有一个副作用：白天躺 480 分钟才归零，但 cap 只给 90 分钟，所以**白天永远不可能睡到 energy = 1**，白天的天花板是 `1 − 0.577·P_in`。她白天最高只见过 E=0.73。）

---

## 5. 这条极限环烧掉多少

- `recover_energy` 被拒 **52–103 次/天**（7 天 475 次），每次 = 一个完整主 loop 模型请求（工具结果回去还要再来一个）。
- 最近 3 天，**1243 / 2218 = 56% 的主 loop LLM 请求发生在「含至少一次 rest_rejected」的 run 里**。平均 `processing_time_ms ≈ 9.1 秒`。
- 重试节奏（`tool_executions` 最近 3 天，连续两次被拒的间隔）：
  - **同一个 run 内：121 次，中位 60 秒**（`REST_REJECTED_FRAME_YIELD_AFTER = 3` 在管，53 个 run 正好打满 3 次）。
  - **跨 run：105 次，中位 233 秒** —— 这条完全没人管。触发源全是 `<xiaoni_plan>` 自驱动 notify（`agent_queue_messages.source = 'system_reminder'`，105 个 run；QQ `phone_notification` 只有 44 个）。

所以 `REST_REJECTED_FRAME_YIELD_AFTER` 只压住了一半，另一半由 `maybeRunSubconsciousAgentFork`（`agent-loop-service.ts:7232`）→ `enqueueSubconsciousAgentNotify`（:12247）每 4 分钟重新点火。注意 `recordIdlePlanSettle`（:1102）**明确规定 rest_rejected 不算有效产出**，所以被拒的 run 既不归零空转计数、也不阻止下一次 fork。

---

## 6. 工程修法（可组合），含模拟预期

模拟器在 `replay.js` 的 `simulate()`：用真实动作强度 **0.00359 压力/分钟**（3 天清醒 1449 分钟 / 累计 5.20 actionCost）驱动真实 policy 函数跑 3 天，1 分钟步长。

```
  方案                                          小睡/天  整觉/天  被拒/天  睡眠min/天  清醒min/天
  baseline(现状)                                    5.0      2.0      153        959         481
  A 引擎级冷却(用现在的 retry 数)                        0.0      1.0        1        310        1130   ← 灾难
  B nap cap 90→180                                3.0      2.0      144       1004         436
  B2 nap cap 90→240                               3.0      2.0      138       1020         420
  C w(S) S0 160→320(刚醒惩罚更轻)                       6.0      2.7      130       1028         412   ← 方向错
  C2 P0 0.5→0.30                                  5.7      2.0      143        977         463   ← 方向错
  D actionCostScale 1→0.4                         4.0      2.0      219        776         664   ← 反而更糟
  D2 debtTau 360→120                              5.0      2.0      170        922         518   ← 反而更糟
  E retry 估算 debt-aware(只改数字,不加冷却)              5.0      2.0      153        959         481
  F 冷却 + debt-aware retry (A+E)                   5.0      2.0        7        955         485   ★
  G 收帧后 20min 不自触发                               5.0      2.0       25        931         509   ★
  H 白天睡到压力≤0.25(不用固定 cap)                       4.0      2.0      150        973         467
  F+B nap180 + 冷却 + debt-aware                    3.0      2.0        5       1001         439   ★★
  F+H 压力驱动 nap + 冷却 + debt-aware                  4.0      2.0        6        968         472   ★★
```

### 修法 ①（必做，核心）：`retry_after` 改成 debt-aware —— 否则任何冷却都会把她锁死

**改哪里**
- `modules/agent-service/src/services/recover-energy-policy.ts` :: `estimateVoluntaryRecoveryRetryAt`（:584）。
  - 新增可选入参 `homeostaticPressure` / `actionDebt`（拆开，不再只收一个合并的 `energy`）与 `actionCostRatePerMinute`。
  - 扫描时把压力也往前推，而不是冻结：
    - `debt(t) = ss + (debt₀ − ss)·e^(−t/τ_debt)`，`ss = rate · τ_debt`（`actionDebtRecoveryTauMinutes = 360`），这是现有 `computeDecayedActionDebt` + 恒定注入的闭式解；
    - `homeo(t) = computeAwakePressureAfterMinutes({ startPressure: homeo₀, awakeMinutes: t })`（已有函数）。
  - `rate` 从最近 60 分钟 `agent_life_events.action_cost` 求和 / 60 得到；拿不到时退回 0（= 现状行为，fail-safe 保守）。
- `modules/agent-service/src/services/agent-loop-service.ts` :: `case TOOL_NAMES.recoverEnergy`（:14670）把 `energyState` 的 homeo/debt 拆分和 rate 传下去。
- `agent-loop-service.ts` :: `renderRecoverEnergyRetryLine`（:2926）那句「到那之前再调 `recover_energy`，返回的还是这个 rest_rejected」**现在是假的**，得跟着新估算一起改成真话（配合 ② 的冷却就变成真的了）。

**定量影响**：单独做（方案 E）对被拒次数无影响（她本来就不信数字），但它是 ② 的**前置条件**。回放显示新估算把「醒来时 319 分钟」纠正到 53 分钟，与含 debt 的真实接受时刻**逐窗口误差 ≤ 25 分钟**（sid 447 55 vs 51、453 30 vs 29、454 50 vs 49、455 15 vs 13）。

**缓存影响**：`estimateVoluntaryRecoveryRetryAt` 是纯函数，结果在**执行时渲染一次**进 `function_call_output` 并冻结落栈（`agent-loop-service.ts:6821` 把 `toolResult.system_reminder` 直接当 output），replay 读存好的字节、不重算 —— 代码注释 :583 已明说这条契约。**改公式不影响任何历史 stack item 的逐字节重建。** 不得把 rate 或 cooldown 时间戳放进 system prompt / tools 定义 / 任何 cacheable 前缀。

### 修法 ②（必做，核心）：引擎级冷却 —— 被拒到 retry 之前不再发模型请求

**改哪里**
- `agent-loop-service.ts`：新增 per-session `restRejectedCooldownUntilMs`，在 `case TOOL_NAMES.recoverEnergy`（:14670）入口判断：`now < cooldownUntil` 且 gate 仍 reject ⇒ **原样返回冷却起点那次的 rest_rejected 结果**（同一份冻结字节），不重算 gate、不重算 retry。
- 把 `REST_REJECTED_FRAME_YIELD_AFTER`（:1008）从 **3 降到 1** —— 第一次被拒就收帧。retry 数字现在可信了，第二次调用本来就没有信息价值。

**定量影响（方案 F = ①+②）**：**被拒 153 → 7 次/天（−95%）**，睡眠 959 → 955 分钟/天、小睡 5.0/天 **完全不变**。也就是说它**只砍掉浪费的模型请求，不改她的睡眠结构**。按 56% 主 loop 请求落在含被拒 run 里推算，主 loop 请求量可降 20–30%。

**⚠️ 致命前置**：方案 A 证明，**用现在这个冻结压力的 retry 数字做冷却是灾难** —— 白天小睡 5.0 → **0**/天、睡眠 959 → **310** 分钟/天。因为冷却窗口按高估 6 倍的数字锁，她整个白天都够不到 `recover_energy`。**① 和 ② 必须同一个 PR 上线，不许拆。**

**缓存影响**：收帧路径不产生新 stack item（`buildLeaseReleaseRecord` 走既有 `runtime_frame_yielded`）→ **零影响**。返回冻结重复结果会产生新的 `function_call_output` item，但它遵守「执行时渲染一次、落栈、replay 读字节」的同一契约 → 安全。**不要**把 `cooldownUntil` 的绝对时间戳写进工具结果正文以外的任何地方。

### 修法 ③（建议）：白天 nap cap 由固定 90 分钟改为压力目标

**改哪里**
- `recover-energy-policy.ts` :: `resolveRecoverySessionPolicy`（:264-275）白天分支的
  `sessionMaxRecoveryMinutes: Math.min(fullRecoveryMinutes, daytimeNapMaxRecoveryMinutes)`
  改为「解出把压力降到 `daytimeNapTargetPressure`（新常量，建议 **0.25**）所需的分钟数」，以 `fullRecoveryMinutes = 480` 封顶、以现有 90 为下限。
  （解法直接复用 `estimateNaturalWakeAt`（:727）的二分结构，只把 `naturalWakePressure` 换成新目标。）
- 或者最省事的一刀：`DEFAULT_RECOVER_ENERGY_POLICY.daytimeNapMaxRecoveryMinutes` **90 → 180**。

**定量影响**：
- H（压力目标 0.25）：小睡 5.0 → **4.0**/天，睡眠 959 → 973 分钟；与 ①② 合并（F+H）被拒 **6**/天。
- B（cap 180）：小睡 5.0 → **3.0**/天，睡眠 959 → 1004 分钟；与 ①② 合并（F+B）被拒 **5**/天、睡眠 1001。
- 本质：把「一觉只还 42% 债」改成「一觉还清到指定水位」，周期从 2 小时拉到 3–4 小时，同时**不增加**总睡眠。

**缓存影响**：`sessionMaxRecoveryMinutes` 进的是 `recovery_policy_snapshot`（工具结果 JSON，执行时冻结落栈）。改常量只影响未来的 item，历史 replay 不变。**注意**：`recoverySessionPolicyFromSnapshot`（:296）对老快照有 fallback，新字段缺失时必须退回旧值，否则老 session 恢复会漂。

### 修法 ④（建议）：actionDebt 的扣分要「对齐」，不要「缩放」

**先说一个反直觉的实测结论：把成本调小会让情况更糟。**
- D（`actionCostScale` 1 → 0.4）：被拒 153 → **219**/天，睡眠 959 → **776** 分钟。
- D2（`actionDebtRecoveryTauMinutes` 360 → 120）：被拒 153 → **170**/天。
原因：压力涨得慢 ⇒ 她在门槛下待得更久 ⇒ 试探频率不变 ⇒ 被拒次数线性增加。**单独调 actionDebt 的量级是死路。**

真正该修的是**分布**：

**改哪里**
- `modules/agent-service/src/services/runtime-store.ts` :: `recordWebSearchResultLifeEvent`（:1784）的 fallback `0.03`，以及 `agent-loop-service.ts:1556 RUNTIME_TOOL_COSTS[webSearch] = 0.030` —— 一次搜索比一次发消息贵 3 倍没有依据，它一家占了 3 天总成本的 **53%**。建议降到 **0.01**（与回复/访问同量级）。
- `exec_command` 目前 **0 成本**（一天 497 次）。`RUNTIME_TOOL_COSTS[execCommand] = 0.002` 是**从未被读过的死配置**。要么删掉这行死配置（诚实），要么真的给它接上一条 life event（每次 0.002 ⇒ 497 次/天 ≈ 1.0 压力/天，与现有 1.7/天 同量级）。
  - 接的话要同改三处：`runtime-store.ts` 新写点、`xiaoni-life-reducer.ts` 的 `DEFAULT_ACTION_COST_BY_EVENT_KIND`（:109）、`applyEvent` switch（:372）新分支。
- **建议顺序：先只做「web_search 0.03 → 0.01」，不给 exec_command 加成本。** 总注入从 0.00359 降到约 0.0024/分钟，被拒窗口从 30–60 分钟拉到 50–90 分钟 —— 只有在 ①② 已经上线（被拒不再烧请求）之后做才安全，否则等同于方案 D 的恶化。

**缓存影响**：`action_cost` 只写 `agent_life_events`，energy 全程 runtime-internal（`recover-energy-policy.ts:328` 注释明说 "Energy is runtime-internal, so these NEVER touch the prompt cache"）。**零缓存影响**。唯一露到请求里的是 wake/reject reminder 里的数字，仍是执行时冻结。

### 修法 ⑤（建议，独立见效）：收帧后 N 分钟抑制自触发唤醒

**改哪里**
- `agent-loop-service.ts` :: `maybeRunSubconsciousAgentFork`（:7232）——在现有 `shouldDeferDeepIdleSubconsciousFork`（:1073）判断旁边加一条：若本 session 处于 rest-rejected 冷却期（②的 `restRejectedCooldownUntilMs`），**defer 并保留 seed**（照现有 deep-idle 限频的写法，`seed` 留着不 drop，下一 tick 再看）。
- 或不依赖 ②：把 `shouldDeferDeepIdleSubconsciousFork` 的触发条件从「`idleRounds ≥ 5`」扩到「上一 run 以 `rest_rejected_frame_yield` 收帧」，沿用 `SUBCONSCIOUS_FORK_DEEP_IDLE_MIN_GAP_MS`（:1071，30 分钟）。
- 真实 QQ 消息（`phone_notification`）**不受影响** —— 只挡自驱动 notify，和现有 deep-idle 限频同一条约定。

**定量影响（方案 G，把有效试探间隔从 3 分钟拉到 20 分钟）**：被拒 153 → **25**/天（−84%），睡眠 959 → 931 分钟，小睡 5.0/天不变。与 ①② 重叠但**互补**：①② 挡的是「同一段冷却期内的重复请求」，⑤ 挡的是「本来就不该在这个时候点火」。

**缓存影响**：少入队一条 notify = 未来少一个 run，**不改任何已落栈字节**，历史 replay 逐字节不变。注意 :7405 那段注释里的老坑：defer 时**必须保留 seed**，不能 drop，否则重启/去重撞上会让她永久哑掉。

### 不建议：刚醒惩罚 w(S) 参数（③ 候选方向）

- C（`freshWakeSleepSaturationMinutes` 160 → 320，惩罚更轻）：小睡 5.0 → **6.0**/天、整觉 2.0 → 2.7、睡眠 959 → **1028** 分钟。
- C2（`freshWakePenaltyPressure` 0.5 → 0.30）：小睡 5.0 → **5.7**/天、睡眠 959 → 977。

**两个方向都是加睡眠、加小睡次数。** 刚醒惩罚正是唯一在阻止她回睡的那道闸（memory 里 08-29 那次「引擎封顶叫醒一律免惩罚」就是把它拆掉，结果白天睡眠 3.8 → 8.0 小时/天）。**不要动它。** 它造成的被拒是**该有的**被拒；问题在于被拒**代价太高**（①②）和**周期太短**（③）。

---

## 7. 推荐组合与上线门

**第一步（一个 PR，不许拆）：① + ②**
`retry_after` 改 debt-aware ＋ 引擎级冷却 ＋ `REST_REJECTED_FRAME_YIELD_AFTER` 3→1。
预期：被拒 153 → **7**/天（−95%），睡眠/小睡结构**完全不变**，主 loop 请求量降 20–30%。

**第二步：⑤**（自触发抑制，独立可回滚）。预期在 ①② 之上把残余的跨 run 点火也清掉。

**第三步：③**（nap cap 压力目标 0.25 或 90→180）。预期小睡 5 → 3~4/天，周期 2h → 3~4h，总睡眠不增。

**第四步（谨慎）：④** 只做 `web_search` 0.03 → 0.01，观察一周。

**双缓存铁律执行清单（每一步都要）**
1. `npm --prefix modules/agent-service test` 全绿，尤其：
   - `src/__tests__/cache-replay-consistency.test.ts`
   - `src/__tests__/fork-cache-alignment.test.ts`
   - `packages/persistence/__tests__/agent-stack-event-id-dedup{,.realdb}.test.js`
2. PR 里显式写两条影响分析：
   - **fork 缓存**：本改动全部在工具执行侧 / 引擎内部数值，不碰 system prompt、不碰 tools 定义、不碰 `stableRuntimePrompt` 快照 ⇒ 四个 fork（潜意识 / 压缩 / 图像 / 心跳）的克隆前缀逐字节不变。
   - **下一次主 run 缓存**：所有新增/变更的字节都走「执行时渲染一次 → 冻结进 `function_call_output` → 落 `agent_stack_items`」这一条既有路径，replay 读存好的字节、不重算 ⇒ run 边界可逐字节重建。冷却分支若返回「同一份冻结结果」，必须是**原样字节**，不得重新 format 时间戳。
3. 上线后取相邻两 slice 的 `wire_request` 实测 `cache_read_input_tokens`，确认没有塌到裸 system+tools。

---

## 附：复现命令

```bash
# 编译真实 policy
cd /home/liahua/IdeaProject/qq_bot/modules/agent-service && \
  ./node_modules/.bin/tsc src/services/recover-energy-policy.ts \
  --outDir <scratchpad>/policy --module commonjs --target ES2022 --skipLibCheck

# 回放（DAYS 控制回放天数）
cd <scratchpad> && DAYS=3 node replay.js
```

数据快照：`scratchpad/sessions.json`（`agent_recovery_sessions` 9 天）、`scratchpad/recover.json`（`tool_executions` recover_energy 9 天）、`scratchpad/lifecosts.json`（`agent_life_events` action_cost>0 9 天）。
