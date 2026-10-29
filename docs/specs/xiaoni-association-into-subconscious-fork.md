# Spec: 联想腿并入自驱动 fork —— 空转时与上下文内线索一起精排,旧事写进 plan

状态: **草案 v2** · 作者对话拍板 2026-09-14 · Codex 交叉审已裁决(见文末) · 未实现
归档说明（2026-10-29）：从任务 worktree 收回的未实现草案；历史路径已移除。本文不代表现行运行契约，当前行为以 `docs/XIAONI_AGENT_STACK_LEDGER.md` 与 `docs/XIAONI_PASSIVE_RECALL_SURFACING.md` 为准。

**修订** `docs/adr/0005-recall-delivery-rides-the-notify-bucket.md` 修订 2026-08-28 段(「联想腿的候选仍从最近的 association_scan 行取」)与 `docs/adr/0006` 中「投递闸的选取由 LLM 做」在联想腿上的落点。

---

## 范围锁定(用户拍板)

- **自驱动 fork 的本意是给小腻找事做。** 上下文内的线索和上下文外的旧事,对它来说都是「找一件新事」。两者的区别只在材料来源,触发时机应当是同一个:她收口空转那一刻。
- 联想候选和上下文内的 plan 材料**混在一起,在 fork 里做一次精排**。是 n 选几,不是 n 选一。
- fork 挑中的旧事**写进 `<xiaoni_plan>` 正文**,并明确标出这是「闲下来时自己想起的旧事」,让她看看要不要捡起来。
- 事件精排(每次落地 / 消费 QQ 消息)**只判落地腿**。联想腿不再单独调 Sonnet 精排、不再走 `passive_recall_surface` notify。
- 扫描(备货)照旧 admin-backend 30 分钟一轮,只写 shadow;fork 启动时消费。(用户未明确选扫描时机;fork 启动时现扫要把六因子选材搬进 agent-service,改动大,先不做。)
- 不动落地腿、不动扫描算法、不动 fork 的克隆原则、不加新开关。

---

## Context(为什么)

### 两条腿是两件事

| | 自驱动 fork(潜意识) | 联想腿 |
|---|---|---|
| 触发 | 她 settle 在 final_answer(空转收口),深度空转限 30 min 一次 | 墙钟 30 min 扫描;投递挂在**落地事件**上 |
| 看什么 | 主请求逐字节克隆 = 她上下文里已有的一切 | 上下文**之外**的档案(日记按事发日期、专题线章节),在场的剔除 |
| 模型 / 每次 | opus-4-6,309K 输入(307K 缓存读),16 s | 算术选材 + Sonnet 2K token 精排 |
| 次数 / 天(14 天真库) | 127 | 扫描 48;被事件精排判 730 次 |
| 产出 | `<xiaoni_plan>` 一到三条方向,64 份/天 | 一句钩子指向旧事,106 条/天 |
| 能碰世界 | 不能(无工具,只能 post plan) | 只读档案 |

fork 是「在上下文里面想」,联想腿是「去上下文外面翻」。检索这一层合不了(fork 不许读文件;300K 的 opus 克隆也不该做 30 分钟一次的档案扫描)。**判断这一层可以合**,而且 fork 手里有全量上下文,比 Sonnet 看 800 字锚点 + 60 字 teaser 判得准。

### 现状的问题(真库 2026-08-31 → 09-14,`xiaoni_recall_shadow_log` query_ref=`delivery_judge` 的 `llm_work`)

| | 落地腿 | 联想腿 |
|---|---|---|
| 被判候选次数 | 10 020 | 91 204 |
| 单次挑中率 | 20.8% | 3.45% |
| 不同条目数 | 6 379 | 2 148 |
| 每条平均被判次数 | 1.6 | 42.5(中位 15,最多 524) |
| 条目最终被投比例 | 28.5% | **73.7%** |
| 14 天投出 notify | 1 645 | 1 478 |

- `xiaoni-recall-delivery.ts:472-486`:每次事件精排把最近 20 行 `association_scan` 的候选一起塞进同一次判官调用。同一条陈货对着几十个不相干的锚点反复判,判到一次「值得」就投。首次曝光就被挑中的只有 132/2148(6%)。精排对联想腿不是闸,是掷骰子。
- 每次判官调用 10 条候选里 9 条是联想陈货。
- 联想只在她**正在做事**时才有机会被投出去(投递挂在落地事件上);她真正空下来时没有事件,一条都不出。按「找事做」的定义,时机是反的。
- 合池是 `ba565f25`(2026-08-28 定时→事件驱动)删掉腿间轮转后的遗留,无 ADR / commit 论证;`xiaoni-recall-delivery.ts:44-47` 的「腿间轮转」注释是死文。

### 已有资产(全部复用)

- fork 尾部追加段机制:`renderSubconsciousForkReminder`(`agent-loop-service.ts:4792`),空转升级段已是「运行时变化的内容追加在尾部 developer item、每 fork 只算一次」的先例(`docs/specs/xiaoni-fork-idle-escalation.md`)。
- fork 尾部 = `clone(main) + D + reminder`,`buildSubconsciousAgentForkRequest`(`:3232`)只在 cache_volatile 之后追加一个 developer item。
- 扫描产出:`scanAssociativeRecallToShadow`(`modules/admin-panel/backend/src/services/xiaoni-recall-reindex-service.ts:685`)写 `association_scan` 行:`queryText` = 扫描时落地文本(≤2000 字),`surfaced[]` = `{ kind:'association', identity, ref, lead:'<整句>', ageDays, bucket, score, factors }`。
- 候选解析:`leadsFromRow('association', row)`(`xiaoni-recall-delivery.ts:190`),已跳过 open-loops ref 与缺身份/缺 lead 的项。
- shadow 表读写:`persistence.listRecallShadowLog({ queryRef, limit, onlySurfaced })` / `insertRecallShadowLog({ queryRef, llmWork, … })`。
- 自反馈防线:`NON_LANDING_QUERY_REFS`(`xiaoni-recall-delivery.ts:74`),凡往 shadow 表写行的新 queryRef 都必须进这张表,否则被当落地候选喂回自己(2026-08-21 实测过循环)。

---

## Current State(已核实 2026-09-14)

| 机制 | 位置 | 现状 |
|---|---|---|
| 事件精排候选池 | `xiaoni-recall-delivery.ts:472-486` | 落地行 + 最近 20 行 `association_scan` |
| 联想扫描调度 | `admin-panel/backend/src/services/xiaoni-recall-scheduler.ts:68-86` | 30 min,env `XIAONI_RECALL_AUTO_REINDEX`,无运行时开关 |
| fork 触发 | `agent-loop-service.ts:7274` governing principle;`:7395` 取 seed;`:7435` 调 fork | settle on final_answer;深挖活着时让位(`:7328`) |
| fork 尾部 reminder | `agent-loop-service.ts:4792-4820`;调用 `:11914`(每 fork 算一次) | 续航提醒 + (skill 契约) + (升级段) |
| plan 入队 | `agent-loop-service.ts:12330-12375` | `subconscious_agent_notify.md` 包 `<xiaoni_plan>`;`stripPlanPacingClauses` |
| 冻结缓存用例 | `fork-cache-alignment.test.ts:102/274/348` | 尾部只许非 durable;< 20 块 |
| 管理端 | `XiaoniPassiveRecallPage.tsx:163-172` | queryRef → kind 映射,新 ref 默认落 `recall` |

---

## Proposed Change

### 1. 事件精排只判落地腿(`xiaoni-recall-delivery.ts`)

- 删 `:478-486` 的 `association_scan` 回捞;删 `SHADOW_LOOKBACK` / `options.lookback` / `DELIVERABLE_LEGS` / `passiveRecallDeliveryLegs`(grep 无外部消费者)。
- `NON_LANDING_QUERY_REFS` 加 `'association_fork_feed'`。
- 导出 `leadsFromRow`、`Lead`、`ShadowRow`;`ShadowRow` 扩 `id? / queryText? / llmWork?`。
- 文件头 `:44-58` 重写:落地腿 = 事件精排;联想腿 = 喂给自驱动 fork。

### 2. 候选取用与消费标记(新 `agent-service/src/services/xiaoni-recall-association-fork-feed.ts`)

- `take()`:列最近 `association_scan` 行(`onlySurfaced`,limit 6)与最近 `association_fork_feed` 标记行(limit 20);**所有**未被标记(`sourceShadowLogId` 不在标记集合里)且 `occurredAt` 距今 ≤ 2h 的扫描行,**最旧优先**,候选按 `identity` 去重,总量封顶 6 条。返回 `{ sourceShadowLogIds, anchorText: 最新那行的 queryText, leads }`;没有可喂的或任何异常 → `null`(fail-open,fork 照跑不带候选)。id 是字符串形态的 bigint,不做数值比较,只做集合成员判断。
- `markClaimed(feed, forkRunId)`:每个 `sourceShadowLogId` 各写一行 shadow,`queryRef:'association_fork_feed'`,`occurredAt: now`,`silent: false`,`surfaced` = 该行被喂进去的候选,`llmWork:{ kind:'fork_feed', source:'association_scan', sourceShadowLogId, forkRunId, scanAgeMs }`。失败吞掉并 warn。
- `renderCandidateLines(leads)`:确定性渲染,每条 `[n] N 天前 · <lead 单行化、≤120 字> · 指针 <ref>`(ageDays 缺省不写天数)。lead 来自她自己的日记,与上下文里其余她的字同一信任级;只做换行压平与截断。
- **标记在 fork 启动时写(claim 即消费),不等 plan 入队。** 写在 `runSubconsciousAgentFork` 里 `forkRunId` 生成之后、第一次模型调用之前 —— forkRunId 只在那里有。fork 中途失败(infra)时这批候选作废,不随 seed 重试再喂:下一轮扫描 ≤30 min 就有新货,而「同一批候选被喂多次」正是本 spec 要消灭的东西。标记写失败 → 下次 fork 会再喂一次,被 2h 过期兜住。

### 3. fork 尾部第三段(`agent-loop-service.ts`)

- `renderSubconsciousForkReminder` 加参 `associationCandidates: string | null`。**现有的提前返回条件 `!escalating && !IDLE_PLAN_SKILL_SUBMISSION_ENABLED` 必须改成再加 `&& !associationCandidates`**,否则候选段永远不会渲染(Codex 抓出)。非空时 `sections.push(renderPromptSnippet('subconscious_fork_association_candidates.md', { CANDIDATES }))`,与升级段同在一个 developer item 里。三段都不追加时仍返回主 agent 那份续航提醒,逐字节零变化(`fork-idle-escalation.test.ts:97` 不变量)。
- `maybeRunSubconsciousAgentFork`:在深挖让位的 `return` 之后、取到 seed 之后、调 fork 之前 `feed = await takeAssociationForkFeed().catch(() => null)`;把 `feed` 整个传进 `runSubconsciousAgentFork`。fork 内 `forkRunId` 生成后立刻 `markClaimed(feed, forkRunId)`,再算 `renderSubconsciousForkReminder({ …, associationCandidates: renderCandidateLines(feed.leads) })`(每 fork 一次,多 turn 共用)。
- 候选**不写进** seed 的 canonicalRequest、不写主 stack;seed 的消费仍走 `consumeSubconsciousAgentForkSeed` 的 identity 比较,不动。
- 深挖活着时 fork 让位,候选顺延;2h 过期自然作废。她睡着不 settle,不 fork,不喂。

### 4. 提示词 `docs/xiaoni_prompt/subconscious_fork_association_candidates.md`

占位符只有 `{{CANDIDATES}}`。按 CC 四铁律写(`##` 标题、编号、禁「不是X而是Y」、禁宽松许可、祈使句挂字面宾语、禁止/必须单独成块)。要点:

1. 这几条是**档案扫描**提供的、她此刻上下文之外的候选。它们不是 fork 的记忆,也不是她此刻记得的事;「闲下来想起的旧事」只是写进 plan 时给她看的标签(Codex 纠正:fork 自己先不能把候选当回忆)。
2. 挑中的写进 plan 时,该行固定形状:`闲下来想起的旧事:<lead 原句或前 30 字> → <ref>`,ref 形如 `notes/diary/2026-08-11.md#3`。这一行放宽到 ≤80 字(固定前缀 + 指针本身就占 40 字左右);其余方向仍 ≤50 字。
3. **禁止**写成她记得 / 看过 / 做过;**禁止**在 lead 之外补内容、编标题或日期;**禁止**改写 ref。
4. 一条都不挑是正常结果。
5. 与上下文内方向合计仍遵守 `self_continuation_reminder.md` 的「一到三条」。
6. `stripPlanPacingClauses` 加白名单:以「闲下来想起的旧事:」开头的行原样保留(lead 原句里可能有「不碰」「守住」这类她自己的话,剥了指针就没了),并加回归测试。

### 5. 管理端与文档

- `XiaoniPassiveRecallPage.tsx:163-172`:`association_fork_feed` → 新 kind `fork_feed` + pill「已喂 fork」(不映射的话会落成 `recall` 被当落地行展示);`LlmWork` 联合类型加 `{ kind:'fork_feed'; source; sourceShadowLogId; forkRunId; scanAgeMs }` 变体;联想腿说明改「空转时喂给自驱动 fork 精排」。标记行 `silent:false`、`occurredAt: now`,否则流水里排不了序。
- `xiaoni-recall-store.js:476-500` 健康度注释:`delivery_judge` 只覆盖落地腿。
- ADR-0005 / ADR-0006 追加修订;`xiaoni-fork-idle-escalation.md` 加「尾部第三段」;`XIAONI_PASSIVE_RECALL_SURFACING.md` §v2 加实现状态;`CONTEXT.md` 腿一节一句。

---

## 双缓存影响分析(铁律)

### ① fork 缓存

- 候选段只进 fork 尾部那个 developer item(非 durable,在 `recentNarrationItems` 的 cache_volatile 之后)。fork 前缀仍是 `seed.canonicalRequest` 逐字节克隆,断点仍落在共享热历史上。
- 每次 fork 只算一次(`:11914` 已有「算一次、多 turn 共用」),同 fork 内 turn-2 起前缀不漂。
- 候选段与升级段在同一个 developer item 内,不新增块;`fork-cache-alignment.test.ts:274`(尾部只许非 durable)、`:348`(< 20 块)照常成立。
- 其它 fork(压缩 / 图像 / 心跳 / 心理评估)不受影响:它们各自克隆主请求,尾部各自追加。

### ② 下一次主 agent run 缓存

- fork 请求 `no_persist`、`store=false`,不写 `agent_stack_items`,不进主 run replay。主 agent 请求零字节变化。
- 她看到的仍只是 `<xiaoni_plan>` notify,与现在同一条通道、同一模板;plan 正文入队时冻结进 `payload.systemReminder`,replay 逐字节读回。
- 事件精排侧删掉联想候选只影响那条独立小请求(Sonnet 2K),与主请求无关。

### 验证要求(不能只推断)

- `subconscious_agent_fork_slices` 部署前后 `token_usage->>'cached_input_tokens'` 均值同量级(~307K);`input_tokens - cached_input_tokens` 只多候选段几百 token。
- 均值不够(Codex 指出):取部署后**带候选的**一次 fork,与它之前那次主 agent slice 对比 `wire_request` 的可缓存前缀 SHA256(见 `docs/CACHE_CONTRACT.md` 的诊断法),必须一致;该 fork 若多 turn,turn-2 的 `cache_read_input_tokens` 必须 ≥ turn-1。
- 冻结用例 `cache-replay-consistency` / `fork-cache-alignment` / `agent-stack-event-id-dedup{,.realdb}` 全绿后才允许 `docker compose build/up agent-service`。

---

## Acceptance Criteria

1. 部署后 `delivery_judge` 行 `llm_work->'candidates'` 里 `leg='association'` 计数 = 0。
2. `agent_queue_messages` 里 `recall-surface:association:%` 部署后新增 = 0。
3. 每条 `association_scan` 行至多一条 `association_fork_feed` 标记;fork 启动即写(claim 即消费),标记行带 `forkRunId`,能接回 `subconscious_agent_fork_slices`。
4. plan notify(`reason='subconscious_agent'`)/天与部署前同量级(~64),不放量。
5. 有候选的 fork,其 plan 正文出现「闲下来想起的旧事:」行的比例可观测;指针可 `cat`。
6. 无候选 / 未升级 / skill 开关 OFF 时,fork reminder 与主 agent 续航提醒逐字节一致(既有测试不变量)。
7. fork 缓存读均值不塌。

---

## Testing Plan

- `passive-recall-delivery.test.ts`:事件精排不回捞任何 shadow 行;联想行在库里也不进判官 prompt。
- `fork-idle-escalation.test.ts`:候选段有 → 进 fork reminder 且同入参同字节;无 → 与主 agent 那份逐字节一致;主 agent 那份永远不含候选段。
- 新 `association-fork-feed.test.ts`:无扫描行 / 全已标记 / 全 >2h → null;多行未标记 → 最旧优先、按 identity 去重、封顶 6 条、anchorText 取最新行;跳 open-loops、缺 lead;markClaimed 每个 source 一行、形状正确;读挂 → null 不抛;渲染确定性;lead 含换行 / 超长被压平截断。
- `stripPlanPacingClauses`:「闲下来想起的旧事:」开头且 lead 含「守住」的行原样保留;其余行剥法不变。
- 冻结用例照跑,不改。
- worktree 里跑测试一律 `DB_NAME=qqbot_cache_test`。

## Rollback

- 三个 commit 各自可 revert。revert commit 1 即回到事件精排合池;扫描与 shadow 表无 schema 变更。
- `association_fork_feed` 行留在 shadow 表里无害(只是观察面;`NON_LANDING_QUERY_REFS` 若被一并 revert,老标记行会被当落地候选 —— 所以 revert 时保留这一行,或先清掉标记行)。

## Files Reference

| 文件 | 改动 |
|---|---|
| `modules/agent-service/src/services/xiaoni-recall-delivery.ts` | 删联想回捞;导出 `leadsFromRow` 等;`NON_LANDING_QUERY_REFS` |
| `modules/agent-service/src/services/xiaoni-recall-association-fork-feed.ts` | 新:take / markConsumed / renderCandidateLines |
| `modules/agent-service/src/services/agent-loop-service.ts` | reminder 第三段;fork 前取候选;入队后标记 |
| `docs/xiaoni_prompt/subconscious_fork_association_candidates.md` | 新提示词 |
| `modules/agent-service/src/__tests__/{passive-recall-delivery,fork-idle-escalation,association-fork-feed}.test.ts` | 测试 |
| `modules/admin-panel/frontend/src/pages/XiaoniPassiveRecallPage.tsx` | 新 queryRef 映射 |
| `packages/persistence/xiaoni-recall-store.js` | 注释 |
| `docs/adr/0005`, `docs/adr/0006`, `docs/specs/xiaoni-fork-idle-escalation.md`, `docs/XIAONI_PASSIVE_RECALL_SURFACING.md`, `CONTEXT.md` | 修订 |

## Out of Scope

- 落地腿及其 Sonnet 精排。
- 扫描算法(六因子、分桶、覆盖优先)与调度周期。
- fork 启动时现扫(把选材搬进 agent-service)。
- plan 通道本身的「自生声音没有权威」问题。

## Codex 交叉审裁决(2026-09-14,`codex exec` 只读评审)

| # | Codex 判决 | 裁决 | 落点 |
|---|---|---|---|
| 1 | 触发时机成立;「只取最新一行」会跳过之前未消费行 | **采纳**:取所有未标记且 ≤2h 的行,最旧优先,identity 去重,封顶 6 条 | §2 `take()` |
| 2 | 只在 plan 入队后标记 → 无 plan / 异常会重复喂;标记写失败永久重喂;建议 claim 状态 | **采纳更简的形态**:fork 启动即 claim 即消费,写在 fork 内(forkRunId 只在那里有);infra 失败不重喂,靠 30 min 新货 + 2h 过期兜底。不做 claimed/delivered 双状态 —— 「同一批被喂多次」正是要消灭的,重试也不该喂 | §2、§3 |
| 3 | reminder 现有提前返回条件会让候选段永远不渲染;候选必须留在同一 developer item;要实测相邻 slice | **采纳全部**:提前返回条件加 `&& !associationCandidates`;不新增 item;验证改为对比可缓存前缀 SHA256 + 多 turn cache_read 单调 | §3、双缓存验证 |
| 4 | 候选不是她的记忆,「闲下来想起」只能是 plan 标签;固定前缀 + 指针会超 50 字;stripper 不能凭名字保证安全 | **采纳**:提示词改口径;旧事行放宽到 ≤80 字;`stripPlanPacingClauses` 加前缀白名单 + 回归测试 | §4 |
| 5 | health 不会读错;UI 未映射会落成 `recall`;标记行要 `silent:false、occurredAt:now` | **采纳** | §5 |
| 6.1 | 不要盲加「失败 N 次作废」 | **采纳**(被 #2 的 claim 即消费覆盖) | — |
| 6.2 | 2h 先保留,记录候选实际年龄再调 | **采纳**:标记行 `llmWork.scanAgeMs` | §2 |
| 6.3 | 只传天数和 ref,不传 bucket | **采纳**;line 桶的 lead 原句已带「你在追的这条线(X)」,不再加标签 | §2 |
| 6.4 | 保留固定前缀并测试;主 prompt 不改 | **采纳** | §4 |
| 7 | forkRunId 只在 fork 内生成,调用方拿不到;seed 用 identity 比较;bigint 比较;候选不得进 seed / 主 stack | **采纳**:标记写在 fork 内;不做数值比较只做集合判断;候选只进尾部 developer item。「队列返回已有行」「stale ticket」与本 spec 无关,不动 | §2、§3 |

Codex 未提但保留的判断:扫描仍在 admin-backend,fork 不现扫;不加新开关;落地腿与 Sonnet 精排不动。
