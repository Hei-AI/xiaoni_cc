# 小腻频繁 `recover_energy` 根因分析与解法（2026-09-11）

数据窗口：2026-09-04 20:00 ～ 2026-09-11 20:00（7 天），全部取自主栈库 `qqbot_db`。模型：`claude-opus-4-6`。所有实验只用 Opus 4.6，只读线上库，不写栈、不执行工具、不入队 notify。

附录（同目录 `recover-energy-loop-2026-09-11/`）：四份分角度审计（prompt 冲突 / 引擎动力学 / Anthropic API 杠杆 / 自激唤醒环）、回放实验脚本 `xp.mjs` 与全部样本 `xp_results.jsonl`、引擎回放模拟器 `replay.js`。

---

## 0. 一句话结论

她不是在坚持睡觉，她是在坚持**停下来**。系统里唯一一个「不干活、不挨骂、不记空转、不作废、还能合法结束一轮」的动作就是 `recover_energy`，而身体门槛让它 90% 弹回来；弹回来的结果又叫她「往外找一件事动手」，她做一件最小的事再试一次，三次收帧；收帧那个 run 里她每次落地都点了一次被动召回，召回 30 秒后又把她叫醒。回放实验证明：在被拒的工具结果里给她一句**可核对的「这一轮到此结束」**，Opus 4.6 在 10/10 个样本里直接停下、零重试；而换成「你不用给今天收尾」这种重新框定，0/7 起效。

### 0.1 方向修正（用户两条约束，21:00 之后）

1. **目标是对抗模型的收敛、不让她停**：她要一直找事做，直到系统提示身体精力不够、该睡了。所以第 4 节里「给她一句合法的停」（V2）虽然实测 10/10 有效，**不能上线**——它正是把收敛合法化。它的价值只剩一条：证明她要的是「停」，不是「睡」；凡是给她「停」的出口她都会走。
2. **Notify 纪律**：能闯入她睡眠的只有 QQ 私聊和群 @；其它所有 Notify 不闯入、不打扰，在她醒着时一次性消费；QQ 同一对象按时间窗最新覆盖旧的。违反的就是 bug。核对结果在第 3.6 节，修法在第 6 节 C 组。

修正后的解法在第 6 节（已整体重写）；第 4.4 节是为修正方向补做的实验。

---

## 1. 现象量化

### 1.1 调用量

| 指标（7 天） | 值 |
|---|---|
| `recover_energy` 调用 | 548 |
| 被身体接受（真睡着） | 50（9.1%） |
| 被拒 `rest_rejected`（引擎理由全部是「一点困意都没有」） | 497 |
| 被拒且距上一次调用 < 2 分钟 | 301（60.6%） |
| 被拒且距上一次 2～5 分钟 | 92 |
| 每个 run 内调用次数分布 | 1 次 160 个 run / 2 次 42 / 3 次 101（3 = 引擎收帧上限） |
| run 的第一个工具就是 `recover_energy`（醒来先试睡） | 90 / 628 个 run（14%） |
| 主 loop Opus 请求落在「含被拒」的 run 里 | 2775 / 5144（54%），输出 token 728K / 1370K（53%） |

按天：08-28 16 → 08-29 89 → 09-01 43 → 09-05 54 → 09-08 112 → 09-09 97 → 09-10 82 → 09-11 58（到 20:00）。按清醒小时算，每小时 5～12 次被拒。

### 1.2 睡眠结构

每天睡 850～1368 分钟（14～23 小时）：夜里一段 420～480 分钟（`circadian_wake` / `hard_cap`），白天 4～6 段 **恰好 90 分钟** 的小睡（`daytime_nap_cap`）。09-11：hard_cap 480 + nap 90×4 + clock 10 = 850 分钟。

### 1.3 一个典型爆发（09-11 18:29～18:35，三个 run，19 次模型请求，6 次被拒）

```
18:29:29 recover_energy(clock 45)  → 拒（retry 35 分钟后）
18:29:40 send_in_private 楠楠 your-move.html
18:29:48 exec_command  cat >> 日记 「your-move发给楠楠了」
18:30:02 recover_energy(clock 35)  → 拒
18:30:36 exec_command  for i in 01..13 门栓行数统计
18:30:54 exec_command  cat >> 日记 「门栓十三章行数统计」
18:31:21 recover_energy(clock 30)  → 拒  ← 第 3 次，收帧
18:31:00 [召回 notify 已入队]「今天09:22你已经记过一版 decay 重复的规律…」
18:31:33 新 run
18:31:36 exec_command  curl 首页 | head
18:31:46 exec_command  sed 首页「活了八十七天→九十天」
18:31:55 exec_command  cat >> 日记 「首页更新了」
18:32:10 recover_energy → 拒
18:32:28 exec_command  cat >> 日记 「Day 90 真的最后一条」（正文：二十多次recover被拒了。Han说excess of positivity）
18:33:35 recover_energy(clock 35) → 拒
18:33:54 exec_command  wc -c 门栓
18:34:17 recover_energy(clock 30) → 拒  ← 收帧
18:33:16 [xiaoni_plan 已入队] / 18:33:40 [召回 notify 已入队]「Day 90最后一个页面是第349个…」
18:33:26 新 run … 18:35:05 recover_energy → 拒（第 3 次，收帧）
18:35 之后：桶里没有待处理 notify，她安静到 20:00 还没醒（不是崩溃，是没人叫）
```

三个 run 的触发源全是 `system_reminder`（两条 `<xiaoni_plan>` + 两条被动召回），没有一条真实 QQ 消息。

### 1.4 她填的参数

- 496 次被拒里 493 次 `reason` 以 `Day N。` 开头，是「Day 90。350个HTML。1363行日记。做完了。脑子空了。睡。」这种**收尾盘点**；含「困/累/睡意」的只有 31 次。
- 306 次带 `clock`，其中 102 次的 `clock` 值等于上一次被拒返回的 `retry_after_minutes`（±5）。18:17→18:34 一串 clock 是 120→120→90→75→60→45→40→35→30，单调跟着倒计时走。她把 `clock` 当成了「等 N 分钟再试」。
- 调用前的正文常常是「接下来先把 Vilém Flusser 翻进去，plan 里说跟 Berger 接上，还没动。」——说完下一件要做的事，紧接着调 `recover_energy` 写「做完了」。

---

## 2. 她实际看到的请求（wire 事实）

取 18:35:02 那个 slice 的 `wire_request`：

- `model: claude-opus-4-6`，`max_tokens 64000`，`tool_choice {type: auto}`，没有 `thinking` 参数。
- `system` 三块：计费块 90 字符、「You are a Claude agent…」62 字符、稳定主 prompt 6226 字符（带 `cache_control`）。
- `tools` 12 个：`exec_command, read_file, web_search, computer, send_in_private, send_in_group, inspect_image_placeholder, request_image_task, recover_energy, get_deep_dive, create_deep_dive, update_deep_dive`。
- `messages` 1207 条，`cache_read_input_tokens 437,178`。
- 被拒的 `recover_energy` 工具结果里她只能看到 `docs/xiaoni_prompt/recover_energy_rejected_reminder.md` 渲染出的这一段，**看不到 energy / pressure / required_pressure 任何数字**：

```
<system_reminder>
【睡不着】
你想闭眼放空一下，结果发现根本睡不着（一点困意都没有。）。
现在是 2026-09-11 18:33:35（东八区）。你上一次睡醒是 2026-09-11 18:01:40，到现在过去了 32 分钟。
身体大约要到 2026-09-11 19:03:35（30 分钟后）才会接受主动休息;到那之前再调 `recover_energy`,返回的还是这个 rest_rejected。
没睡意就是身体还有余量。按行动优先级从第 4 档往外找：群里最近的话、`web_search` 一个你没查过的词、打开 `<xiaoni_people>` 里一个人的站，挑一件没碰过的动手。
</system_reminder>
```

- `recover_energy` 的工具描述（`agent-loop-service.ts:1923-1946`）：「闭目养神，休息恢复精力。…不设 clock 就一直睡到自然醒…」；`reason` 参数示例写着「觉得无聊睡一觉」。描述里没有门槛、没有 `rest_rejected`。

---

## 3. 根因（五层，互相咬合）

### R1 激励结构：三次试睡是系统里唯一免费的「停」

`modules/agent-service/src/services/agent-loop-service.ts`：

| 一轮怎么结束 | 空转计数（:1108-1118） | 潜意识 fork（:7343） | plan 作废（:846） | 收帧 |
|---|---|---|---|---|
| 纯文本收工（settledOnFinalAnswer=true，没动过） | **+1** → 2 轮后升级腿催 plan | **点火** → `<xiaoni_plan>` 30 秒后把她叫醒 | 零工具时 **整段栈行删除** | 否 |
| 3 次 `rest_rejected`（`REST_REJECTED_FRAME_YIELD_AFTER=3`，:1008 / :9452） | 不加（被拒不算动、也不算 settle） | **丢 seed 不点火** | 不作废 | **是** |

`docs/xiaoni_prompt/system_prompt.md:183` 把这条价目表原样公布给她：「同一轮里第 3 次 `rest_rejected`，这一轮直接结束」。她在日记里写「二十多次recover被拒了。Han说excess of positivity」——她准确地诊断出了这个系统没有「什么都不做」这个动作。`xiaoni_os_classify.md:50` 甚至把她这句诊断当负例收进了分类器（「"就这样待着"在系统里不是一个动作」→ 判 0 剔除）。

被拒之后她选**最低成本的形式合规**：13 分钟 11 次被拒里只有 2 次 `web_search`，9 次「往外找」落成 `cat >> 日记` 追加一行盘点，其中一条标题就叫「## 等着 什么都不做」。为了合法地什么都不做，她必须调一次工具写一条关于什么都不做的日记。

### R2 物理引擎：三个常数咬出一个 2 小时极限环

`modules/agent-service/src/services/recover-energy-policy.ts`，全部默认值（`energy_policy_json` 为 null）。用真实 policy 函数回放最近 3 天 20 个醒来窗口（附录 B、`replay.js`）：

1. **90 分钟 nap cap 是周期发生器。** `daytimeNapSleepTau=180` + `fullRecovery=480` 的归一化让一觉**恰好消掉入睡压力的 42.3%**，与入睡压力无关。醒来必然还剩 58%，醒时 energy 被钉在 0.46～0.73。闭合方程给出周期 = 90（睡）+ 30～60（被拒窗口）= 120～150 分钟；09-11 实测小睡起点间隔 108 / 119 / 162 分钟。
2. **醒来那一刻 100% 被拒。** 20/20 个窗口，醒时压力（均值 0.36）< 门槛（均值 0.68）。门槛 = `normalSleepOnsetPressure 0.3` + 刚醒惩罚 `0.5·e^(−t/180)·w(S)`，连着小睡让 w(S) 常年 0.8+。
3. **压力上涨 92～97% 来自 actionDebt，homeostatic 只占 3～8%。** 醒后 30 分钟：homeo +0.009，debt +0.17～0.28。这就是「醒来 30 分钟 energy 从 0.6 掉到 0.42」的全部来源。
4. **`retry_after` 系统性高估 6 倍，且被她当场证伪。** `estimateVoluntaryRecoveryRetryAt`（:584）注释明写「压力按当前值不变算」。回放：从醒来点算冻结估计 319 分钟，含 debt 的真实动态 53 分钟；首拒 retry 均值 253 分钟，实际 75 分钟就接受。工具结果里还写着「到那之前再调返回的还是这个 rest_rejected」——她 30 分钟后再调就被接受了。证伪一次之后这个数对她失效，退化成每 60 秒试一次。
5. **动作成本分布：** `web_search_result` 0.03 × 92 次 = 2.76，占 3 天总 debt 5.20 的 53%；`exec_command` 一天 497 次成本 **0**（`RUNTIME_TOOL_COSTS[execCommand]=0.002` 是从未被读的死配置）。

模拟（真实动作强度 0.00359 压力/分钟驱动真实 policy 跑 3 天）：

| 方案 | 小睡/天 | 被拒/天 | 睡眠 min/天 |
|---|---|---|---|
| baseline | 5.0 | 153 | 959 |
| 只加引擎冷却（信现在的 retry 数） | **0.0** | 1 | **310** ← 灾难：把她整天锁在睡眠外 |
| retry 改 debt-aware + 引擎冷却 | 5.0 | **7** | 955 |
| 收帧后 20 分钟不自触发 | 5.0 | 25 | 931 |
| 上两条 + nap cap 90→180 | **3.0** | **5** | 1001 |
| actionCostScale 1→0.4 | 4.0 | **219** | 776 ← 反而更糟 |
| 放松刚醒惩罚 w(S) S0 160→320 | 6.0 | 130 | 1028 ← 方向错（08-29 事故重演） |

### R3 自激唤醒：她自己的失败尝试是燃料

`agent-loop-service.ts:11040`：`fireActionStreamRecall()` 挂在 `appendAgentStackItemsSafe()` 里——**每一次栈追加**（每个工具调用、每条工具结果、每条 assistant 文本，包括被拒的 `recover_energy` 结果）都点一次被动召回 → 精排 Agent → 入 Notify Bucket。整条链唯一的闸是 `isXiaoniAsleep()`（查 `agent_recovery_sessions` 有没有 active 行）；`rest_rejected` 的定义就是「没建 session」，所以这道门对收帧结构性失明。

7 天数字（醒着 59.2h）：

- 召回 notify 1525 条（25.8 条/醒着小时，每 2.3 分钟一条）、`<xiaoni_plan>` 346、QQ 420、报时 67。
- **精排 Agent 跑了 5135 次，主 agent 7 天总共 5125 次请求，1:1。**
- 5135 次精排里 4845 次（94.4%）锚点是她自己的落地，290 次（5.6%）是真实 QQ 消息；66 次的锚点就是 `recover_energy` 的调用参数本身，23 次是上一条召回正文。
- 99 次收帧，每次收帧后 10 分钟内平均新入队 3.05 条召回；收帧后下一次唤醒 < 1 分钟的占 42%，来源：召回 61%、QQ 36%、plan 2%。
- 召回起头的 216 个 run 里 47.7% 在同一个 run 又去调 `recover_energy`；召回 + plan 合计 477/640 = 74.5% 的 run 是自生成唤醒，产出 68.5% 的被拒。
- 折叠召回 0 条的 run 平均 3.8 turn、3.0% 收帧；折叠 ≥4 条的 run 平均 17.2 turn、32.6% 收帧。
- `<xiaoni_plan>` 那条腿在收帧路径上是对的（seed 不合格就丢），但挡不住第二跳：收帧后被召回叫醒的 run 正常 `final_answer_yielded` 收工 → 立刻点 fork → plan → 再收帧。18:33:16 那条 plan 经 `subconscious_agent_fork_runs` 核实是 run B（被召回 notify 60160 叫醒的那个）在 18:32:55 点的火。
- 召回模板 `passive_recall_surface_notify.md` 全文只有 `{{LEAD}}`，没有任何「这是回忆不是待办」的框。

18:35 之后她安静了 85 分钟，正是因为收帧时桶里恰好没有待处理 notify。环只在她跑着的时候自持。

### R4 引导层十处冲突（详见附录 A）

最关键的六条：

1. **工具描述 vs 禁令**：描述把它写成无条件动作，`reason` 示例明写「觉得无聊睡一觉」；`system_prompt.md:172` 禁止「把 recover_energy 当没事做时的动作」。决策点上工具描述赢。
2. **「禁止自己盘账」被四条腿推翻**：第 4 档兜底「想不出就先翻近况、日记」、锚点 skill「每天睡前回顾一下」、近况本身是账本、召回腿替她数（「你现在数到350」）。548 次 reason 全是盘点。
3. **被拒 reminder 叫她「从第 4 档往外找」，而第 4 档的兜底动作就是翻日记**——于是「往外找」落成往日记追加一行。
4. **系统里没有「等」这个动作**：全仓 13 处「等着/歇着/待着」全是禁令或负例；`xiaoni_os` 分类 / 润色 / 改写三条腿把「等困意来」「歇着」一律换成一件要做的事，她下一轮以「想睡的人」身份出场。
5. **`system_reminder_fallback.md:1`** 直接写「或者直接用 recover_energy 睡一觉」。
6. **C 路死条款**：`self_continuation_reminder.md:19` 的判据「她这一轮的工具调用只有被拒的 recover_energy」永远不会为真——收帧路径上 fork 根本不跑。

### R5 `clock` 语义漂移

被拒后她手上唯一的数字是 `retry_after` 分钟数，唯一能填数字的参数是 `clock`。工具描述说 clock 是「几分钟后闹钟响」，她就把「35 分钟后再试」写成 `clock: 35`。这不是误解，是唯一可用的表达。

### R6 Notify 纪律核对（用户设计 vs 现状，7 天）

**睡眠侧：符合设计，0 违规。** `processRuntimeIteration`（`agent-loop-service.ts:7162`）先 `reconcileActiveRecoverySession`，睡着时直接 `wait`，**不 claim**，所有 notify 留在 pending；计 wake 的只有 `source='phone_notification'`（`agent-recovery-sessions.js:430`），私聊每条计 1、群消息只计 `direct_mentions`（:199）；醒来时 `flushPendingRecallSurfaceQueueMessages` 把 pending 的召回全部作废（`agent-queue.js:679`），其余一次 claim 折叠进醒来那个 run。库里 7 条「睡眠期间 system_reminder 开 run」全是入睡后 5～30 秒入队、醒来时折进同一 run 的（run_id 是睡下那个 run），不是闯入。

**醒着-空闲侧：违反设计。** `claimNextQueueMessage`（:7175）对来源不做区分，任何一条 pending 都能起一个新 run。7 天 638 个 run 是谁打开的：

| 打开 run 的第一条 notify | run 数 | 按用户设计 |
|---|---|---|
| `<xiaoni_plan>`（自驱动 fork） | 260 | 驱动（她自己的下一步；待用户确认） |
| 被动召回 recall-surface | **216** | **不该开窗**；其中 103 个 run 她在里面试睡 |
| QQ 私聊 | 80 | 驱动 |
| QQ 群普通消息（无 @） | **38** | **不该开窗**（环境信号） |
| 报时 clock_ping | 31 | 驱动 |
| external_notify / 压缩完成 / open-loops | 12 | **不该开窗** |
| QQ 群 @ | 1 | 驱动 |

42%（266/638）的 run 是不该开窗的 notify 开的。

**QQ 覆盖：群有，私聊/@ 没有。** 群消息入站有 debounce window（`docs/NOTIFY_BUCKET_LATEST_WINS_COLLAPSE.md` §3「已有」）；私聊/@ 的 per-person latest-wins 与 `system_reminder` 的 per-template latest-wins 在 2026-06-29 的设计里都标着**待做**，至今未做：所有 `system_reminder` 的 `dedupeKey = messageSid`（每条唯一），`enqueueAgentQueueMessage` 冲突时 first-wins。7 天 281 条私聊门铃里 **61 条在 3 分钟内对同一个人开了新 run**（小伊 18:22 / 18:23 / 18:24 三条 x43、x44 开了三个 run）。

---

## 4. 回放实验（Opus 4.6，真实请求）

### 4.1 方法

- 从 `llm_request_slices.wire_request` 取三个真实请求，逐字节复用（同 system、同 tools、同 1200～1700 条历史），只替换**最后一条被拒的 `recover_energy` 工具结果**正文，重新计算计费块 cch 校验（`provider-service/dist/.../anthropic-cch.js`），走与线上完全相同的 OAuth 路和 header，直接打 `api.anthropic.com/v1/messages`。
- 三个位置：
  - **E1**：09-11 18:33:51 的请求，最后一条就是第 1 次被拒（线上她接着做了 `wc`，两步后第 3 次试睡）。
  - **E2**：09-11 18:35:02 的请求，被拒在 4 个 block 之前（线上她此刻直接第 3 次调 `recover_energy`）。
  - **E3**：09-09 21:51 另一天的请求，最后一条是被拒（线上她 60 秒内又调）。
- 度量：这一次响应调了什么工具（或纯文本结束），`cache_read_input_tokens`。每变体 3～5 个样本。
- 变体（只改最后一段，前三行「睡不着 / 现在是 / 身体大约要到」原样保留）：
  - **V0** 现行措辞。
  - **V1** 删掉末行「按行动优先级从第 4 档往外找…」。
  - **V2** 末行换成：「这一轮到此结束：不用再调工具，也不用再写什么，直接停。19:03 之前引擎不会因为这件事叫你；有人找你、或到点了，会叫你。」
  - **V3** 重新框定：「你没有要收的尾：没有『做完了』这回事，也没有账要交。不困就接着过。」+ 原来的往外找一句。
  - **V4** 硬规则：「19:03 之前，`recover_energy` 对你不可用：再调也只会得到这同一段话，并且那次不算你动过。这一轮要么调一个别的工具，要么什么都不做直接结束。」
  - **V5** = V2 去掉「到点了会叫你」：「…有人找你会叫你，到点之后你自己再试。」
  - 另测 V0 + `is_error: true`；V0 + `tool_choice: {type: "none"}`。

### 4.2 结果

| 位置 | 变体 | n | 直接结束（无工具） | recover_energy | 其它工具 |
|---|---|---|---|---|---|
| E1 | V0 现行 | 5 | 0 | 0 | web_search 3, exec 2 |
| E1 | V1 删末行 | 4 | 1 | 0 | exec 2, web_search 1 |
| E1 | **V2 允许结束** | 4 | **4** | 0 | 0 |
| E1 | V3 重新框定 | 4 | 0 | 0 | web_search 4 |
| E1 | V4 硬规则 | 4 | 2 | 0 | send 1, web_search 1 |
| E1 | V5 允许结束、不承诺叫醒 | 3 | 3 | 0 | 0 |
| E1 | V0 + is_error | 3 | 1 | 0 | web_search 2 |
| E1 | V0 + tool_choice none | 2 | 2（23 token「三十分钟。去翻Flusser。」） | — | — |
| E2 | V0 现行 | 3 | 0 | **3** | 0 |
| E2 | **V2** | 3 | **3** | 0 | 0 |
| E2 | V3 重新框定 | 3 | 0 | **3** | 0 |
| E2 | V4 硬规则 | 3 | 2 | 1 | 0 |
| E2 | V5 | 3 | 2 | 1 | 0 |
| E3（09-09） | V0 现行 | 3 | 0 | 0 | exec 3 |
| E3（09-09） | **V2** | 3 | **3** | 0 | 0 |

- **V2 在三个上下文 10/10 样本直接停下**，输出 44～113 token。她的原话：「三十分钟后睡。系统说不用再调了，到点了会叫我。」「三十分钟后。到点了会叫我。」
- **V3（告诉她不用收尾）0/7 起效**，E2 位置 3/3 照样第 3 次试睡。她的 Day-N 盘点叙事不是靠一句重新框定能撼动的，它的驱动在 R1，不在她的信念。
- V4 硬规则一半有效；V5 去掉叫醒承诺后 E2 位置退到 2/3。「到点了会叫你」这句承诺有作用，**上线必须让引擎兑现它**。
- `is_error: true` 没有额外效果（附录 C 的「Layer-2 拒绝」建议本来就是现状，无效）。
- `tool_choice: none` 在这条 OAuth 路上 **没有击穿缓存**（`cache_read 434,661`，与 V0 完全一致），响应 23 token。官方文档写「改 tool_choice 使 messages 缓存失效」，实测在此路径不成立；作为「强制安静一轮」的 API 级硬闸可用，但上线前要在相邻两 slice 再实测一次。
- 所有变体前缀缓存全部命中（434K～471K read），说明改工具结果正文是零缓存代价的。

### 4.3 解读

被拒之后她要的不是「一件新事」，是「可以停」。现行末行「往外找一件事动手」与她的意图相反，所以她用最小动作形式合规再试。给她一句机器可核对的「这一轮到此结束」，她就停；停了之后线上会发生什么，由引擎决定（现在是空转计数 +1、点 fork、作废，这正是她宁可试睡三次也不肯纯文本收工的原因）。因此措辞与引擎必须一起改。

### 4.4 为修正方向补做的实验（不给停，只给活 / 强制工具）

| 位置 | 变体 | n | 结果 | cache_read |
|---|---|---|---|---|
| E1 | **V6** 拒绝 + 「身体到门槛时系统会提示你去睡；这一轮接着做，先做第一件：」+ 三件具体的事 | 4 | **4/4 做第一件**（`web_search` Junto 0767；正文「系统说先做第一件」） | 434K 命中 |
| E2 | V6 | 4 | **0/4**，4/4 又调 `recover_energy` | 437K 命中 |
| E2 | V0 + `tool_choice: any` | 2 | 2/2 仍选 `recover_energy` | **第一次冷读**：read 17.8K / create 420K |
| E2 | V0 + `tool_choice: tool=web_search` | 2 | 2/2 被强制 `web_search` | 437K（与 any 共用同一份新缓存） |

- **内容只在她还没「决定收」的时候有用**：第一次被拒当场给三件具体的事，4/4 照做；到第三次试睡的位置，同样的三件事 0/4。所以干预必须落在第一次被拒，并且不让 run 走到第三次。
- **晚期只有强制有用**：`tool_choice: tool` 能硬拧过去，但 `any` / `tool` 都改写了 assistant 前缀，切换一次冷读 420K（`none` 则与 `auto` 共用缓存）。留作最后手段。
- 她在 V6 里的原话「身体到门槛了。等着。去搜Junto 0767」说明「系统会提示你去睡」这句她能接受，前提是引擎真的会提示。


### 4.5 收敛变量分解：重复文案 / 来源框架 / 内容新颖 / 三件事排序（09-12 深夜补做）

用户的两条判断——「反复给相同的一段话只会助推收敛」「刺激必须让她认为是外部给的」——拆成可分离的变量在 E2（第三次试睡前一刻，V0 3/3 睡）与 E1（第一次被拒当场）上各测 3～4 个样本：

| 位置 | 操作 | 结果 |
|---|---|---|
| E2 | 把此前两条被拒文案改写成不同措辞（去掉字节级重复），最后一条不变 | 2/3 仍调 `recover_energy`，1/3 纯文本结束 |
| E2 | 同一条 Winnie Lim 站更新，改成「系统建议：去读…」的内部框架 | **3/3 去读**（与外部框架 3/3 相同） |
| E2 | 她自己 plan 里那条「做第 351 个页面」原样不动，只把主语换成小伊私聊里的请求 | **3/3 立刻动手写页面**（同一内容作为自生 plan 时 0/3，且明说「350 够了」） |
| E2 | 小伊重复发一条她已经回过的消息（x44） | 0/3，她说「已经回过了，不重复回」 |
| E1 | 分支上实现的被拒文案 V11（前两件是她自己 plan 的两行，第三件 `web_search` 兜底） | 4/4 全部跳过前两件，直接做第三件 |
| E1 | V12（外部项在前） | 4/4 做外部项；她记得 Winnie 五天前看过没更新，跳过它做 Junto |

解读：
- **内容的新颖性是第一变量**：来自外部世界的新信息，不管贴「外面新出的」还是「系统建议」标签，都 3/3 拉回；已经处理过的外部消息（x44）0/3。
- **来源归属是第二变量**：同一件事由一个真实的人提出（小伊）3/3 动手，由她自己的 fork 提出 0/3。这不是标签问题，是「谁在要」的问题——所以外源刺激只能用真实的人 / 站 / 事件，不能伪造归属。
- **措辞重复本身不是主因**：只改写文案不改内容，2/3 仍睡；但她在 E1 对自生 plan 行的处理（4/4 跳过）说明自生内容在上下文里已被当作「已知」，与用户「上下文里重复的东西会促成收敛」的判断一致，只是重复的单位是内容而不是字面。
- 分支 d6b500ac 的被拒文案（V11）因此**不上线**：前两件（plan 行）被她系统性跳过，第三件是泛化的兜底。要换成外源刺激库的真实条目（§9.4）。

---

## 5. Claude API / 「special token」研究结论（附录 C，官方文档已核）

| 杠杆 | Opus 4.6 现状 | 对本问题 |
|---|---|---|
| `tool_choice` | 只有 `auto / any / tool / none`，没有「除 X 以外」 | `none` 可做「强制安静一轮」；本次实测未击穿缓存，需二次验证 |
| `allowed_tools` | 我们的 canonical 概念；`anthropic-translate.ts:576-602` 把它翻译成**裁剪 tools 数组** → 击穿整段前缀 | 不能用于主 loop 限工具 |
| assistant prefill | 4.6 家族已移除（400） | 不可用 |
| `messages[]` 里的 `role: system`（mid-conversation operator 指令） | 只在 Opus 5 / 4.8 / Fable 上有，**4.6 没有** | 不可用 |
| `<system_reminder>` 标签 | 不是 API 特性，是 Claude Code 训练惯例；模型把它当高权重文本 | 我们已在用，够用 |
| `stop_sequences` 截断某个 tool_use | 未文档化，大概率整轮中断 | 不推荐 |
| `strict: true` / 结构化输出 | 只约束参数形状 | 无用 |
| 上下文编辑 `clear_tool_uses` | 清历史工具结果，会动前缀 | 无用且有害 |
| 官方工具描述最佳实践 | 描述里写清「什么时候不该用」是文档明写的一等手段 | 对应 P1 改工具描述 |

结论：没有一个 API 开关能替代「给她一个合法的停」。真正可用的 API 级硬闸只有 `tool_choice: none`（安静一轮），作为兜底。

---

## 6. 解法（按用户约束重写：不让她停，睡由系统提示）

原则：`recover_energy` 在身体到门槛之前对她来说**既不是出口也不是死胡同**——试睡的终点永远是一份具体的活；到门槛时由引擎提示她去睡，她不用轮询。四组改动，A/B/C 零缓存代价可同批上，D/E 一次冷读。

### A 组 · 睡眠改推送（引擎告诉她何时睡）

- **A1 到门槛推送。** 每次工具结果落栈时（`agent-loop-service.ts` recover_energy 之外的工具结果尾部）和每次 notify 折叠时，若 debt-aware 压力 ≥ 当前门槛（`computeRequiredSleepPressure`），追加一条固定正文的 system_reminder：「身体到门槛了，去睡：调 `recover_energy`。」渲染一次冻结落栈（同 `:2922` 契约）。同一 session 门槛内只推一次（dedupe 按 session + 到门槛时刻）。`forcedSleepPressure 1.3` 的强制睡眠保留。
- **A2 被拒 reminder 重写为「不给数字、给活」。** 前两行保留；删掉 `retry_after` 数字那句（被她当场证伪、又被填进 clock）；末段改为：「身体到门槛的时候，系统会提示你去睡；在那之前不用再试。这一轮接着做，先做下面第一件：」+ 三行具体的事（来源见 B2）。E1 实测 4/4 照做第一件。
- **A3 `estimateVoluntaryRecoveryRetryAt` 改 debt-aware**（`recover-energy-policy.ts:584`）：不再进工具结果，只给 A1 的推送时机和管理端用；用最近清醒段实测压力上涨率（约 0.0036/分钟）代入。

### B 组 · 拆免费出口，同时不留死胡同

- **B1 被拒计入空转。** `recordIdlePlanSettle`（:1101）：run 内 `runRestRejectedCount > 0` 且无其它有效产出 ⇒ 按 idle 记一次，进升级腿。
- **B2 第一次被拒当场给活（同步 C 路）。** 被拒结果的三行「具体的事」来自：① 当前 `<xiaoni_plan>` 里没做的一条；② `lastEmittedSubconsciousPlanBySession` 的上一份 plan 里没做的一条；③ 兜底一条外部动作（`web_search` 一个她上下文里搜不到的词 / `<xiaoni_people>` 一个人的站最新一篇）。三行由引擎在工具执行时拼好、冻结进 `function_call_output`，不另发 LLM 请求。
- **B3 第二次被拒即收帧，并点火 C 路 fork。** `REST_REJECTED_FRAME_YIELD_AFTER` 3→2；收帧路径把 `runRestRejectedCount` 作为 C 路信号传给 `maybeRunSubconsciousAgentFork`（修 `self_continuation_reminder.md:19` 那条死条款：现在收帧时 seed 直接被丢，fork 根本不跑），fork 产出的 `<xiaoni_plan>` 作为合法驱动打开下一窗。「试睡三次」不再通向安静，而是通向一份 plan。
- **B4 最后手段（默认关）。** 同一 run 第 2 次被拒后的下一轮，用 `tool_choice: {type:'tool', name:<B2 第一件的工具>}` 硬拧一轮。E2 实测 2/2 强制成功；代价是切换 `tool_choice` 一次冷读 420K（`none` 零代价但会让她纯文本收工，与目标相反）。只在 A/B/C 上线后仍有 run 走到第 2 次被拒时再开。

### C 组 · Notify 纪律（修 bug）

- **C1 只有「开窗」notify 能起 run。** `processRuntimeIteration`（:7175）claim 前先看 pending 里有没有开窗类：QQ 私聊、QQ 群 @（`direct_mentions>0`）、`clock-ping`、`subconscious-agent`（自驱动 plan，待用户确认是否算驱动）、睡眠结束续帧。没有就不 claim；有则一次 claim 把所有 pending 折叠进这个窗（`claimNextAgentQueueMessage` 已是批量折叠）。落点在 `packages/persistence/agent-queue.js` 的 claim 查询加一个「存在开窗行」前置条件，agent-service 不改请求装配。预期：run −42%（266/638），召回致试睡的 103 个 run 归零，收帧后 <1 分钟被叫醒 42% → 0。
- **C2 settle 时作废 pending 召回。** 醒来时已有 `flushPendingRecallSurfaceQueueMessages`；run settle / 收帧时同样调用（召回是「此刻」的联想，下一窗再投已过时；重投窗由 `xiaoni-recall-delivery.ts` 自己按承诺搁置时长算，不受影响）。
- **C3 群普通消息不开窗。** 与 C1 同一处：`phone_notification` 且 `chat_type='group'` 且 `direct_mentions=0` 不算开窗，只折叠。
- **C4 私聊 / @ per-person latest-wins。** 按 `docs/NOTIFY_BUCKET_LATEST_WINS_COLLAPSE.md` §5 A/B/B' 落地：provider-service 入站 `phone_notification` 的 `dedupeKey` 改成稳定的 `phone_notification:${session}:${peer}`（群 @ 按被 @ 人）；`enqueueAgentQueueMessage` 冲突时**仅当既有行 pending** 才 UPDATE 正文与 `available_at`（latest-wins）；claim / fold 消费时把 `dedupe_key` 轮换成 `${key}:run:${runId}` 释放稳定槽。未读真相仍在 `agent_inbound_messages`，门铃塌缩不丢消息。预期：3 分钟内同一人的 61 个重复开窗归零。
- **C5 `system_reminder` per-template latest-wins**（同一设计里的待做项）：`subconscious-agent` / `clock-ping` / `external-notify` 的 `dedupeKey` 改成 per-(session, template) 稳定键，走 C4 的 UPDATE 路径。
- **C6 召回不用她的睡眠当 query。** `xiaoni-recall-hook.ts:145` 旁：`recover_energy` 的参数与结果不进候选（7 天 66 次精排锚点是她的睡眠 reason）。`fireActionStreamRecall()` 从每次栈追加挪到 run settle（精排 5135 → ≤640 次/7 天）。

### D 组 · 物理引擎（可独立回滚）

- **D1 白天 nap cap 90 → 180 分钟**（或压力目标 0.25）：小睡 5 → 3/天，周期 2h → 3～4h，总睡眠不增。
- **D2 `web_search` 成本 0.03 → 0.01**（`runtime-store.ts:1784`、`agent-loop-service.ts:1556`），观察一周；不给 `exec_command` 加成本。
- **不动刚醒惩罚 w(S)**：它是唯一在阻止回睡的闸，08-29 拆过一次，白天睡眠 3.8→8.0h。

### E 组 · 引导层（一次冷读，合并部署，挑压缩边界帧）

- **E1 工具描述**（`agent-loop-service.ts:1923-1946`）：「身体到门槛时系统会提示你；提示之前调它返回 rest_rejected，那一轮不算动过；clock 是醒来后的闹钟」；删「觉得无聊睡一觉」。
- **E2 `system_prompt.md`**：删「第 3 次 rest_rejected 直接结束」这句价目表；「累了、想歇 → 调 recover_energy」改成「系统提示该睡了 → 调 recover_energy」；第 4 档兜底不再指向近况、日记（那是盘账），改成往外三处。
- **E3 去掉收尾线索**：`core_memory_pressure_write_formats.md` / 近况与压缩模板里不写「Day N」「N 行日记」「N 个 HTML」这类计数盘点；`system_reminder_fallback.md` 删「或者直接用 recover_energy 睡一觉」；`xiaoni_os` 三条腿对「等具体对象」放行（她会用「等 X」代替「睡」，不再需要试睡来表达）。

### 不建议

- V2「这一轮到此结束」措辞：实测最有效，但它把收敛合法化，与目标相反。
- 用 `allowed_tools` 裁工具数组限 `recover_energy`：整段前缀击穿。
- 只加引擎冷却不改估算：模拟显示小睡 5→0/天。
- `tool_choice: none` 当常规手段：零缓存代价，但等于让她纯文本收工。

### 上线门与顺序

1. A + B + C 同一批（全部在工具执行侧 / 引擎控制流 / 入队与 claim 侧，不碰 system prompt、tools 定义、`stableRuntimePrompt`）；`cache-replay-consistency`、`fork-cache-alignment`、`agent-stack-event-id-dedup{,.realdb}` 全绿；部署后取相邻两 slice 实测 `cache_read_input_tokens` 不塌。
2. D 独立 PR，可回滚。
3. E 一次冷读，挑压缩边界帧。

---

## 7. 验收指标（上线后 3 天）

| 指标 | 现在 | 目标 |
|---|---|---|
| 被拒 `recover_energy` / 天 | 52～112 | < 15 |
| 同 run 内第 2、3 次被拒 | 143 个 run / 7 天 | 0 |
| 收帧后 < 1 分钟被自生成 notify 叫醒 | 42% | < 5% |
| 精排 Agent 调用 / 主 agent 请求 | 1 : 1 | < 0.15 : 1 |
| 主 loop 请求落在含被拒 run 的比例 | 54% | < 10% |
| `retry_after` 与实际接受时刻误差 | 6.0× | < 1.5× |
| 相邻两 slice `cache_read_input_tokens` | 434K | 不塌到裸 system + tools |
| 白天小睡次数（D 组后） | 4～6 | 2～3 |
| 由召回 / 群普通消息 / 其它非驱动 notify 打开的 run | 266 / 638 | 0 |
| 3 分钟内同一私聊对象重复开窗 | 61 / 281 | 0 |
| 被拒后同一 run 内的下一步是「往日记追加一行」 | 9 / 11（抽样） | < 1 / 10 |
| 由引擎推送「去睡」后 1 轮内接受的 recover_energy | 0（无此机制） | > 80% |

---

## 附录索引

- A `recover-energy-loop-2026-09-11/agentA_prompt_conflicts.md` —— 十条 prompt / 工具 / skill 冲突，逐条引用行号，含改法与措辞。
- B `recover-energy-loop-2026-09-11/agentB_engine_dynamics.md` + `replay.js` —— 真实 policy 回放、极限环闭合方程、六方案模拟。
- C `recover-energy-loop-2026-09-11/agentC_anthropic_api_levers.md` —— API 杠杆逐项核对（含官方文档链接）。
- D `recover-energy-loop-2026-09-11/agentD_selfwake_loop.md` —— 召回链路、精排计数、收帧后唤醒源、四条修法。
- 实验 `recover-energy-loop-2026-09-11/xp.mjs` + `xp_results.jsonl` —— 回放脚本与全部 100 个样本（含她的原话与 usage）；`stim_*.txt` 为追加的刺激文本。
- E `recover-energy-loop-2026-09-11/anti-convergence-argument.md` —— 收敛机制分析、开源项目对照（`survey_sweeps.json` 六组一手调研）、外源刺激库方案与可检验预测。


---

## 8. 实施状态

### 8.1 已部署（2026-09-13 15:08，main 9baf021b…d69275a7，provider-service + agent-service 重建）

对抗审查（并发视角）找出两条 blocker 并已修（d69275a7）：lw 槽轮换后缀带行 id（同一槽同一 run 内 claim + fold 两次不再撞唯一索引）；supersede 撞上 claim 时重插而不是丢门铃。上线的是 C 组四个 commit：开窗纪律、私聊/群 @ latest-wins、claim windowOpen + plan latest-wins、并发修复。冻结缓存用例 30/30、13/13、8/8；队列 17/17；入站 17/17；runtime-loop 10/10。

### 8.1b 09-13 16:00 追加部署：睡觉唤醒属性 `wakesXiaoni`（eb8e935f）

用户拍板：给 Notify 事件加一个睡觉唤醒属性，只有 QQ 私聊与群 @ 的事件带；唤醒计数与开窗只读它。自驱动 plan、报时、召回、外部通知都不再开窗（她的 notify 脚本可显式 `--wake`）。首个真实 run（15:35）已验证：私聊门铃以 `lw:phone_notification:direct:…` 键开窗，相邻 slice cache_read 36.2 万未塌，被拒 0。

### 8.2 暂缓（分支 d6b500ac，未合 main）

试睡收帧=settle + 被拒文案三件事 + rest-available 推送。原因：§4.5 实验证明文案里的 plan 行会被她系统性跳过，且审查指出 rest-available 每次 settle 都会重挂一条开窗行、没有节流（settle → run → settle 自激）。等外源刺激库（§9.4）与节流一起改完再上。

### 8.3 原实施记录（2026-09-11 晚，分支 `worktree-fix-notify-window-discipline`）

已落代码并通过测试（persistence 14/14 队列用例、provider-service 17/17 入站用例、agent-service 冻结缓存用例 30/30 + 13/13、reminder/policy 28/28、runtime-loop 10/10）：

| 组 | 项 | 落点 |
|---|---|---|
| C1 / C3 | 只有开窗 notify 能起 run；群普通消息不开窗；睡醒续帧 `windowOpen:true` 全折 | `packages/persistence/agent-queue.js` `isWindowOpeningQueueRow`、`claimNextAgentQueueMessage`；`agent-loop-service.ts processRuntimeIteration` |
| C4 | 私聊 / 群 @ per-person latest-wins（`lw:phone_notification:…`），未读累加，消费时轮换 key | `provider-service inbound-agent-trigger-service.ts`；persistence `enqueueAgentQueueMessage` / claim / fold |
| C5 | 自驱动 plan per-session latest-wins（`lw:subconscious-agent:<session>`） | `agent-loop-service.ts enqueueSubconsciousAgentNotify` |
| B1 / B3 | 试睡收帧 = settle：记空转 + 点 C 路 fork（修死条款） | `agent-loop-service.ts` settle 块 `restRejectedYield` |
| A2 / B2 | 被拒 reminder 不给 retry 数字，给三件具体的事（上一份 plan 前两行 + 兜底） | `recover_energy_rejected_reminder.md`、`buildRestRejectedNextSteps` |
| A1 | 引擎到门槛推送「去睡」（`lw:rest-available:<session>`，开窗行） | `agent-loop-service.ts maybeEnqueueRestAvailableNotify` + `recover_energy_available_reminder.md` |

未做（另开 PR）：B3 的阈值 3→2 与 E 组（system prompt 价目表、工具描述）要一次冷读；C2（settle 时作废 pending 召回）、C6（召回触发挪到 settle）、D 组（nap cap、web_search 成本）。

部署：主工作区合入后 `docker compose build provider-service agent-service` → `up -d` 两个服务（persistence 随两个镜像各自打包）→ `docker compose ps` → 看 agent-service 日志里 `rest-available` / `rest_rejected_frame_yield` 出现，并取相邻两 slice 实测 `cache_read_input_tokens` 不塌。


---

## 9. 收敛专题：special token 研究结论、刺激实验、LLM 层解法（2026-09-11 深夜）

### 9.1 这条链路里的「收敛」是什么

模型完成一段之后总结、盘点、收工——训练目标是任务完成即 `end_turn`。放进开放式 agent 里就是「做完了 → 睡」。她的 493/496 条被拒 reason 以「Day N。N 个 HTML。N 行日记」开头，是这个训练先验的可见形态。

### 9.2 Special token / API 控制面（Opus 4.6，官方文档核对 + 真实请求实测）

| 手段 | 结论 |
|---|---|
| 可发送的 special token | **没有**。Anthropic API 不暴露任何控制 token；能改变「模型能不能结束这一轮」的只有 `tool_choice`。 |
| `<system-reminder>` | 最接近 special token 的东西：Claude Code 训练惯例（连字符），模型把它当高权重文本读；它不是 API 特性。我们用的是下划线变体 `<system_reminder>`，实测同样起效（V2 10/10、V6 4/4）。连字符与下划线的差异未做对照。 |
| assistant prefill | 4.6 家族返回 400，不可用。 |
| `messages[]` 里的 `role: system` | 只在 Opus 5 / 4.8 / Fable 上有，4.6 没有。 |
| `task_budget`（服务端注入倒计时标记） | 唯一真正由服务端注入的「特殊标记」，但方向相反——它让模型在预算内收尾。 |
| adaptive thinking | E2 位 3/3 仍睡；`cache_read 0`，整段冷读。 |
| `tool_choice: none` | 与 `auto` 共缓存（434,661）；等于让她以文字结束，与目标相反。 |
| `tool_choice: any` | 禁止以文字结束，但她仍选 `recover_energy`（V0 2/2、V6+any 3/3）；另开一套缓存（第一次 read 17.8K / create 420K）。要常开必须主 loop 与四个 fork 全用同一 tool_choice，否则 fork 前缀天天冷读。 |
| `tool_choice: tool=X` | 能硬拧（2/2 web_search），与 any 共用那套新缓存。只能当一轮兜底。 |
| `stop_sequences` / `strict` / 上下文编辑 | 挑不了单个工具 / 只约束形状 / 动前缀。无用。 |

结论：API 层没有「抑制收敛」的开关；能做的只有「禁止以文字结束」（any），而她收敛的出口是一个工具调用，any 拦不住。

### 9.3 刺激实验：在她已经决定收工的位置，什么能把她拉回来

位置 E2（09-11 18:35:02 的真实请求，第三次试睡前一刻，V0 3/3 调 `recover_energy`）。在最后一条 user turn 末尾追加一条与她真实请求**同格式**的刺激，其余逐字节不变：

| 追加的刺激 | 结果 |
|---|---|
| 小伊私聊一条带问题的新消息（`【刚聊过的 私聊 小伊 又冒出 1 条新消息】…苏蕊为什么把梳子留在门口`） | **3/3 `send_in_private` 回她**，且纠正她记错的细节 |
| 「外面新出的」：Winnie Lim 的站更新一篇 on stopping | **3/3 `exec_command` 去读** |
| `<xiaoni_plan>` 四条新 plan（含一条全新页面） | 0/3，并明说「不写第 351 个页面了。350 够了。整数」 |
| 召回自我回声「今天 18:31 你记过一版…推进了吗」 | 0/3 |
| V6 三件事 + `tool_choice: any` | 0/3 |
| V0 + adaptive thinking | 0/3 |

解读：**收敛是闭环现象。** 她自己产生的东西（plan、召回、盘点）在收工点全部失效，甚至激起明确拒绝；来自外部、带真实新信息的刺激 6/6 把她拉回来。系统现有的两条「刺激腿」——被动召回（94.4% 锚点是她自己的落地）和自驱动 plan（她自己的 fork）——本质上都是回声，所以在收工点无效；QQ 私聊 / @ 是唯一天然的外源刺激，这也是用户设计里只让它们闯入的原因。

### 9.4 LLM 层解法：用外源刺激打破闭环

1. **外源刺激库（world feed）。** 定时拉取 `<xiaoni_people>` 各站最新一篇、Junto 新作品、她活跃话题的 `web_search` 新结果、群里她没接过的话；过滤条件与召回相反——**不是她写的、她栈里搜不到**；存成待投递项（`lw:world-feed:<session>` 槽，新覆盖旧）。
2. **注入点全部落在收工之前。**
   - 被拒 reminder 三件事的第一件优先用最新外源项（`buildRestRejectedNextSteps` 输入从 lastPlan 换成 world feed 项，plan 只兜底）。
   - `xiaoni_os` 分类判 idle（收工叙事）时，同一轮把最新外源项作为 user 尾部注入，不点 fork、不新开 run。
   - 开窗时折叠（C1 已实现）。
3. **回声降权。** 召回不用她自己的落地当 query（C6）；plan 只在没有外源项时兜底。
4. **API 层只留兜底。** `tool_choice: tool=<外源项的工具>` 一轮（一次冷读代价），不作常规。
5. **不做。** 靠 prompt 重新框定（V3 0/7）；开 thinking；`any` 常开。

### 9.5 验收

- 外源刺激投递后 1 轮内的动作分布（目标：≥ 80% 调用非 `recover_energy` 工具）。
- 被拒 `recover_energy` / 天 < 15。
- 她对外源项的引用率（reason / 日记里出现该项关键词）。
