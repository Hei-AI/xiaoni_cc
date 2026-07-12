# TODOS

## LLM runtime

### In-memory append context buffer (replace per-run stack re-read at scale)

**What:** 主 loop 现在每个 run 都从 DB 全量重放 `stack_index > floor` 的历史
(`loadStackHistoryBlocks` → `listAgentStackItems`)。改成:冷启动读一次全量建
in-memory append buffer,之后每个 run 只 append 本轮新落库的 item,不再全量重读。

**Why:** 重读量 ≈ 压缩阈值 / 每 item token 数。当前 500k → ~1.7k 行,便宜。但
未来把压缩阈值抬到 1M / 模型上到 2M context 时,每 run 会从 PG 拉几千到几万行、
且 content 带 base64 图 → 单 run 拉几十 MB、GC/DB load 每 run 重复。LLM prefill 仍
是大头,但 DB 带宽/内存/负载在高阈值下变成真实的次级成本,in-memory 能省掉。

**Context / 约束:**
- fork(潜意识/压缩/图像/心跳)已是主 request 的**内存 clone**
  (`buildMainAgentCanonicalRequest(..., budgetPlan.requestInput, ...)`,
  `fork-cache-alignment.test.ts` 逐字节断言),**不受此改动影响**——它们 clone 的是
  主 request 本身,不管它来自重读还是 buffer。
- 主 loop 是单 worker 顺序处理(`while(!stopping)` + 单 `workerId`),buffer 无并发 desync。
- 代价 = 放弃「request = 已提交栈状态的纯函数」这条无状态纯度(3am 可调试性:
  「重读永远对」vs「buffer 可能因漏 append / 压缩 trim 不一致 / 带外写 而 drift」)。
  buffer 必须与重启后的栈重放**逐字节等价**(重启 rebuild + 冷启动仍走重放)。
- 触发时机建议:**当压缩阈值抬到 1M+ 时再做**,别在 500k(重读本就便宜)时提前优化;
  且它是结构改动,别和行为改动同时上(Beck:make the change easy, then the easy change)。

**Effort:** L
**Priority:** P3（scale-gated:压缩阈值抬到 1M+ 前不启动）
**Depends on:** 先落地 `fix/stack-read-window-no-limit`(去 read LIMIT + floor 唯一边界 + overrun halt 阀)


对比这两个trace,我们已经发现了问题了, 要包含请求头, 请求体

```
source: LLM
event: model request slice
status: ok
2026-06-15 11:33:44
LLM 请求
小腻
runtrace_1781494416880_8a6cfc98
stack-slice:llm_1781494418191_5cfd9892
codex-local/responses
payload 2 B
Raw Trace
Input 41.3K
Cache 40.6K
Output 117
codex-local/responses · gpt-5.5 · turn 1 · 41272->117 tokens

source: LLM
event: model request slice
status: ok
2026-06-15 11:33:53
LLM 请求
小腻
runtrace_1781494425437_2f3e19c0
stack-slice:llm_1781494427537_4ac5f11e
codex-local/responses
payload 2 B
Raw Trace
Input 42.2K
Cache 2.7K
Output 234
codex-local/responses · gpt-5.5 · turn 1 · 42199->234 tokens


```


### Investigate fast energy/pressure drift causing frequent recover_energy attempts

**What:** Check the current Xiaoni energy and pressure projection system to explain
why she has recently tried to sleep so often, and why energy/pressure appears to
drop or accumulate unusually fast.

**Why:** The recovery page now shows rejected `recover_energy` attempts; the latest
7-day window had 29 recover_energy calls and 16 engineering rejections. Those
rejections were mostly because the anti-frequent-rest gate said she had not crossed
the sleep threshold yet, but the repeated attempts suggest the prompt-visible state,
life reducer, action costs, wake cooldown, or projection timing may be making her
feel tired too aggressively.

**Context:** Start from `agent_session_life_states.projection_json`,
`agent_life_events`, and `tool_executions` for `recover_energy`. Compare
homeostatic pressure, action debt, action-cost events, `last_wake_at`, and
`required_pressure` around the recent rejected calls. Confirm whether this is a
real reducer bug, cost calibration issue, prompt interpretation issue, or expected
behavior from recent high activity.

**Effort:** M
**Priority:** P2
**Depends on:** Recent recovery telemetry and life projection samples

### Investigate repeated isolated prompt-cache hit drops after heartbeat

**What:** If 小腻在 active recovery cache heartbeat 启用后仍出现单个
`codex-local/responses` slice 的 `cached_tokens` 比例从约 98%-99% 突然跌到低位、
下一轮又恢复，继续排查 provider/backend cache 行为并收集更多样本。

**Why:** `runtrace_1781350585451_bc8018f8` /
`llm_1781350586397_00729fb8` 出现过 `Input 57.2K / Cache 6.8K / Output 93`
的孤立抖动。已排除本地 request prefix 漂移、compress、tool_choice 变化和附近
生图任务，但还没有足够证据证明是 provider 侧 cache eviction / TTL / best-effort
miss 的哪一种。

**Context:** 该 slice 前后相邻请求维持同一 `model_provider=codex-local`、
`model_name=gpt-5.5`、`wire_provider_format=codex-local/responses`、
`prompt_cache_key=xiaoni:global`，`instructions` / `tools` / `tool_choice` /
`reasoning` / `include` 均稳定；`wire_request - input` 哈希也稳定。官方
`/v1/responses` 文档支持 `prompt_cache_retention: "24h"`，但当前小腻实际走的
ChatGPT/Codex backend `backend-api/codex/responses` 直接返回
`Unsupported parameter: prompt_cache_retention`；2026-06-14 手动 heartbeat curl 也确认
该 backend 拒绝 `max_output_tokens`，所以当前路径只能依赖
`prompt_cache_key`、sleeping cache heartbeat 和 backend best-effort cache。下次复现时
优先对比更多连续 slice 的 wire payload、cached_tokens、时间间隔、同 key 并发情况和
`cache_heartbeat_no_persist` 用量事件，再决定是否需要改 provider 路径或继续增加观测。

**Effort:** M
**Priority:** P3
**Depends on:** 再次出现可复现或高频样本

### 重写压缩 frame 集成测试簇(对齐三层已迁移机制)

**What:** `modules/agent-service/src/__tests__/agent-loop-service.test.ts` 里一簇 frame 级压缩
集成测试当前 red,需重写对齐当前运行时。已知涉及(可能不止):
- `core memory compression runs in an isolated background fork alongside the main agent request`
- `runtime frame does not schedule compression from turn count alone`
- `core memory compression fork retries final_answer without tool call and then commits`

**Why:** 这些测试的 mock/断言停在三次迁移之前,不是运行时 bug(生产压缩确凿正常:真库
cutoff 前移;缓存关键路径已由 ironclad `cache-replay-consistency.test.ts` 的「压缩 fork
dispatch」+「REQ2 STW 一次冷读」覆盖且绿)。但 red 会污染 CI 信号、且遮住真回归。

**Context / 三层根因(已诊断实证):**
1. **stack-native 历史加载**:mock 的 store 走已删的 `listRecentTurns`,而 frame 现在走
   `loadStackHistoryBlocks → store.listAgentStackItems`(`agent-loop-service.ts:6348`)。
   不补 `listAgentStackItems`+`getAgentStackHead` → frame 加载 0 blocks →
   `initialRetainedHistory.length===0` → 压缩不 plan(`:9125` 门)→ fork 不 schedule。
   正确范式见同文件 `buildManualCompressionStore`(`:12008`,把 turns 转 stack blocks)。
2. **去 conversation 概念**:测试断言 `conversations[0].rawRequest/rawResponse` 记录,但
   `createConversation` 源码**零调用**(迁移已移除),`conversations` 恒空 →
   `assert.equal(conversations.length, 1)` 必挂。这些断言要么删、要么改断当前真实持久化
   (timeline event `core_memory_compression_applied_midrun` 的 metadata、stack items)。
3. **Spec B fork-commit 机制**:测试模拟 fork 模型调 `compress_core_memory` 提交(turn-2
   返回 compress function_call),但真实 fork `allowedToolNames = {exec_command}`
   (`:10592`)——compress 已非 wire 工具,fork 走 exec_command 跑 `commit_memory.py` 写文件
   → 引擎读回合成 commit。要按新 commit 路径重写 fork 模拟 + `forkTools`/`summaryText`/
   `context_summary_written` 断言(参考已存在的新机制测试 `retries final_answer then commits`,
   它同样 red,一并重写)。

**已做的相邻工作(commit 5847acaa,别重复):** 两个**单元级**压缩预算测试
(`buildContextBudgetPlan keeps append-only` / `plans a tail-30 compression cutoff`)已修绿——
断言 compress 不在 tools/allowed_tools、pressure 标记 `当前压力:`→`当前状态:`。本条只剩 frame
级集成测试。

**Effort:** L（集成测试重写,要吃透 Spec B 文件往返 commit 路径 + 新持久化形状)
**Priority:** P3（非运行时 bug;运行时正常 + ironclad 有覆盖。价值=恢复 CI 信号、防遮真回归)
**Depends on:** 无(独立;建议顺带确认「去 conversation 概念」迁移 P1-P5 当前落点)

## Xiaoni browser

### Zero-restart-ever extension persistence (kill the one auto-relaunch)

**What:** 让补丁 Playwright 扩展在操作者的 Chrome 里**持久加载**,这样任何 Chrome 启动
(操作者手动开、重启、自动更新拉起)都自动带上扩展,`attach` 永远能连上,连一次
自动重启 Chrome 都不需要。

**Why:** 当前自愈方案(commit `2ad72e05`)已经让小腻 `goto` 直接可用、跨 Chrome 重启
自愈,但机制是「检测到扩展没加载 → 自动用 `--load-extension` 重新拉起 Chrome」。残留代价:
操作者手动重启 Chrome 后,小腻的**第一条**浏览器命令会触发一次自动 Chrome 重启
(`--restore-last-session` 恢复标签页)。根因是 `--load-extension` 是一次性启动参数,
不跨正常重启存活。持久加载能消掉这最后一次重启。

**Context / 约束:**
- 路线:Chrome 策略强制安装 —— 写
  `HKCU\Software\Policies\Google\Chrome\ExtensionInstallForcelist`(HKCU 不需要管理员),
  指向本地自托管的 CRX + update manifest(`file:///`)。
- 需要生成一对签名密钥,把补丁扩展打包成 CRX,使其 id 与桥里 `EXTENSION_ID`
  (由 `EXTENSION_KEY` 推导)一致;force-install 绕过 Web Store 校验并防止被禁用。
  Web Store 原版不能用(必须是打了 Xiaoni-only connector 补丁的版本)。
- 风险:往操作者的 Chrome 用户策略里写东西,是真实机器改动;且「跨真实重启仍加载」
  没法在不重启/重启系统的情况下验证。**做之前先要操作者点头。**
- 现状足够:小腻现在永远能用网页,这条只是消掉那一次自动重启的体验优化。

**Effort:** M
**Priority:** P3（体验优化,非阻塞;当前自愈已闭环）
**Depends on:** 操作者同意写 Chrome 策略 + 一次真实重启验证窗口

## Xiaoni executor

### Session lifecycle hardening (evict sessions map + serialize snapshot writes) — ✅ RESOLVED 2026-07-03

**已修复**(refactor/runtime-gateway,commits `e8ea0f0f` + `50d80062`,已 build+up 主栈 executor 并真机验证):
- ② persistSession 改单飞 coalescing + temp/rename 原子写(writer state 挂在 RuntimeSession 上,随 eviction 回收);close 最终快照恒为最后落盘(running:false + 真 exit_code)。
- ① 新增 `closedAt` + `setInterval(unref)` sweeper `pruneClosedSessions`,只 evict closed 且超 10min TTL 的 session;running 永不 evict(保住 killSession handle + pollSession 重启孤儿推断)。顺带用 closedAt 冻结 duration_ms。
- 21 个 executor 测试全绿;真机跑 exec_command 验证 running=false/exit_code=0/无 .tmp-* 残留。executor 在主 agent LLM 链路之外,零 prompt/缓存影响。
- 未 push(refactor/runtime-gateway 仍本地累积)。

<details><summary>原始记录</summary>

**What:** 两个 pre-existing 问题,exec_command spill 截断改动
(`modules/xiaoni-executor/src/index.ts`, commit `310051e5`)时由 review 暴露但**未在该 PR 修**:
1. **`sessions` Map 从不 evict** —— 每次 exec_command 留一个 `RuntimeSession`(现在带两个
   `StreamCapture`,head/tail 串 + StringDecoder,比旧的 capped-string 略重)在内存里,直到容器
   生命周期结束。长跑 executor 内存随累计命令数线性涨(当前实测 8 天累计 183 个 running:true
   快照)。修法:closed session 过 TTL 后从 map 删掉,晚到的 poll 落到 JSON 快照分支(现已能正确
   处理:重启孤儿报 running:false + caveat)。
2. **`persistSession` 每 chunk 无序 `writeFile('w')`** —— `void persistSession(session)` 在每个
   data chunk fire-and-forget 写同一个 `sessions/<id>.json`。并发写可交错 → `pollSession` 的
   `JSON.parse` 抛 → 对一个活 session 返回 404「session not found」;且一个滞后 chunk 写在 close
   写之后完成会把最终快照 clobber 回 `running:true` + 陈旧 exit_code(即那 183 个 running:true 快照
   的一个成因)。修法:单飞 + dirty flag,或 write-temp+rename 原子替换。

**Why:** 都是 pre-existing(旧的 capped-string 版也这样),不是 spill 改动引入的,所以按「right-sized
diff / 不扩散 scope」当时没修。①是缓慢内存泄漏(长跑容器才显),②是罕见快照损坏/误报(并发 exec +
poll 才触发)。spill 改动只是让①每条 session 略重、并让②的 running:true clobber 后果稍微更误导
(现由 pollSession 重启 caveat 缓解)。

**Context / 约束:**
- ①的 eviction 若只删 **closed** session,则「不在 map + running:true 快照 ⟹ 重启孤儿」这条判断仍成立
  (pollSession 的 caveat 逻辑不破)。别删 running 的。
- ②改原子写要保证 close 的最终快照永远是最后落盘的那份(exit_code/running:false 不被滞后 chunk 覆盖)。
- 两者可一起做(都在 executor session 生命周期这一块),也可分开。executor 是自包含 ~700 行服务。
- 动 executor = 主栈共享容器,重建重启会杀掉容器内小腻在跑的进程(如 http.server 3458),部署前先看
  `docker exec … ps` 有没有活进程 + 事后重拉起。

**Effort:** M
**Priority:** P3（pre-existing,非阻塞;长跑内存 + 罕见并发损坏,当前未见实际故障)
**Depends on:** 无(独立于 spill 改动)

</details>

## Completed

### Enrich System Reminder group notification previews

**What:** System Reminder 的 QQ 状态栏提醒现在可以展示群号/群名、最新发言人和
最新消息前 20 个字的短 preview；仍不替代 `$qq-usage` 的完整 inbox/thread window。

**Completed in:** `feature/xiaoni-group-notification-mode`

### Add self-service group notification threshold

**What:** `$qq-usage` 新增 `set_group_notification_mode group_id mentions_only|all`，
让小腻可以把普通群消息收进 QQ inbox 但不敲状态栏；群 @ 仍会提醒。

**Completed in:** `feature/xiaoni-group-notification-mode`

## Passive recall (被动浮现 shadow v1)

### 按真实嵌入分布重标 band-pass 阈值（FLOOR / CEILING）

**What:** 在 `/xiaoni-passive-recall` 页拿几个真实「当下内容」时刻做 query，眼调
`xiaoni-recall-bandpass.js` 的 `DEFAULT_FLOOR`(现 0.35) / `TASK_LOCK_FLOOR`(现 0.60) /
`DEFAULT_CEILING`(现 0.92)。

**Why:** shadow v1 live 部署后实测(2026-07-03，语料 1628+ 时)：一次召回 `drop_too_far=0`
——1600+ 条候选没一条被判「太远」，浮现的全贴着 0.90 逼近 ceiling。说明这个**本地
embedding-server 的余弦分布很挤**(无关文本也 ~0.8+)，保守默认 `FLOOR 0.35` 形同虚设，
band-pass 退化成「取最像的 top-k」——正是「关联−在场」要避免的。八成要把 FLOOR 大幅抬到
~0.85+、CEILING 收一点，让中段真的只留「相关但不在场」。

**Context / 约束:**
- 常量在 `packages/persistence/xiaoni-recall-bandpass.js` 顶部，标了「待真数据调」。
- 改完要重建 admin-backend 才生效(或先把阈值做成 `/recall` 的 query 参数，页面即调即看免重建——可一并做)。
- 判据 = 手标几个时刻「该浮现什么 / 哪些是已在场噪音」，对着页面 surfaced + droppedCounts 调。
- 设计与验收见 `docs/XIAONI_PASSIVE_RECALL_SURFACING.md`。

**Effort:** S（纯调参 + 可选把阈值提成 query 参数）
**Priority:** P2（v1 已部署可看，但没调准前召回质量≈top-k，价值打折）
**Deployed:** shadow v1 已合入 `refactor/runtime-gateway` 并部署主栈 admin-backend/frontend
（表 `xiaoni_recall_cues` 已在 qqbot_db，语料后台增量灌中）。仅 shadow，不投递给小腻。
