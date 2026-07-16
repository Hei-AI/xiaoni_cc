# Spec: 被动召回质量闸 —— 投递前的前置门槛

状态: 待实现 · 全程 shadow-only(不投递) · 零缓存风险 · 核实 2026-07-16(真库 `qqbot_db`)

范围锁定:
- **本 spec 不做投递。** 投递是另一件事,门槛见 §投递门槛。
- 只修「浮上来的东西是垃圾」这一件,全部改动在 `packages/persistence` / admin-backend 侧。

---

## Context(为什么)

被动召回三条腿(语义 band-pass / 承诺 open-loops / 日记 diary-events)已全部落地并 shadow 运行,
北极星是「让小腻想起自己干过啥」。但 **达成度 = 0**:agent-service 侧零注入
(`grep -rn "passive-recall\|passiveRecall" modules/agent-service/src` → 空),
所有产出只进 `xiaoni_recall_shadow_log` 和一个管理端页面。

用户已明确「先不做投递,观察一段」。**实测数据证明这个判断是对的** —— 今天投递等于投毒。
本 spec 的目的:把 shadow 期的观察变成**可验收的质量门槛**,让「什么时候能投」有客观答案,
而不是靠感觉。

## Current State(真库实测 2026-07-16,非推断)

| 指标 | 文档宣称 | 实测 | 判定 |
|---|---|---|---|
| 语义腿静默率 | ~85%(`XIAONI_PASSIVE_RECALL_SURFACING.md` §10 闸2) | **7/16 = 63% · 7/15 = 64% · 7/13 = 47.5%** | 🔴 噪音是宣称的 ~2.5 倍 |
| surfaced lead 构成(近 3 天) | 期望以宫殿(`file_chunk`)为主 | **`peer_message` 1,518 (71%)** / `file_chunk` 626 (29%) / spoken 5 | 🔴 七成是 QQ 碎片 |
| 极短 lead | 无门槛 | **hint < 12 字者 579 条 (27%)** | 🔴 |
| 承诺腿 leg-2 | 已落地 | `open-loops.md` **文件不存在**;`query_ref='open_loop_scan'` shadow 行 = **0** | 🔴 全死 |
| 专题腿 leg-3 | 已部署 | `topic-*` cue = **0**;`notes/diary/` 无任何 `topic-*.md` | 🔴 纯冷启动 |
| 日记腿语料 | doc §2 记 ~17 条 | **1,215 条** | ✅ 压缩→日记闭环真的活了 |
| 语料污染 | `reading/` 47,133 条 | 存量未 purge,但被 `RECALL_SCOPE_SQL` 围栏挡在召回外 | ✅ 顺序铁律执行正确 |

**噪音实例**(`xiaoni_recall_shadow_log` 原样):
- `"橙橙🍊 提过：写了"`
- `"橙橙🍊 提过：第二十三天 好"`

**自我回声(最严重)**:
- query = `"今天凌晨做了五件事：1. 跟小镜聊了穿鞋（decay ch87）…"`
- surfaced = `"## 做完了 停 今天凌晨做了三件事：1. 跟小镜聊了穿鞋（decay ch…"`
- → **她自己的日记回声给她自己。** `SURFACING.md:70` 声称「在场排除是 load-bearing」,实际没挡住。

## Root Cause

1. **ingest 侧零质量门。** `packages/persistence/xiaoni-recall-ingest.js` 无任何 `MIN_*` 常量;
   `xiaoni-passive-recall-extractor.js:112` `normalizeRecallText` 只做归一不做筛。
   → 「写了」两个字进语料就能当 lead 浮出来。
2. **近重复上限剔太松。** `CENTERED_NEARDUP_SUPPRESS = 0.95`(`xiaoni-recall-ingest.js:32`)
   在 centered 空间里,**改述级近重复穿得过去** → 自我回声。
3. **在场排除只比近窗。** `SEMANTIC_CONTEXT_WINDOW = 20`(`:45`)只与最近 20 项比,
   即 doc §8 自认的「~8.6% A 漏」。日记回声正是漏在这里。
4. **承诺腿靠纯 prompt 引导、无护栏。** `core_memory_pressure_reminder.md:14` 明确教了写
   `open-loops.md`,压力帧下她 satisfice 掉了,文件从未存在。
   → doc §10 闸1 自己预警过「最大变量不在路径规范,在 fork 写不写得实」,现在是实锤。

## Proposed Change

### R1 · ingest 最小质量闸(最高性价比)
- `packages/persistence/xiaoni-recall-ingest.js`:新增 `MIN_CUE_CHARS`(建议 12,可 env 调
  `XIAONI_RECALL_MIN_CUE_CHARS`),ingest 时低于门槛直接不入库。
- `packages/persistence/xiaoni-passive-recall-extractor.js:112` `normalizeRecallText`:
  剥运营信封(即 doc §7.4 未做项)。
- 存量需一次 reindex 重扫(复用现成 `xiaoni-recall-reindex-service.ts`)。

### R2 · 收紧近重复 + 补全在场排除
- `xiaoni-recall-ingest.js:32` `CENTERED_NEARDUP_SUPPRESS` 0.95 → **0.85~0.88**
  (env `XIAONI_RECALL_NEARDUP_SUPPRESS`)。
- `xiaoni-recall-ingest.js:45` `SEMANTIC_CONTEXT_WINDOW` 20 → **全在场向量集**
  (在场 = 压缩 cutoff 之上,对齐已落地的 P1.2 定义)。
- **不许拍脑袋定阈值**:用 `xiaoni_recall_shadow_log` 历史做回放校准,报告调参前后的
  静默率/构成/自我回声命中数三条曲线。

### R3 · 承诺腿(leg-2)作出取舍 —— 修或停,别挂着
- 选项 a:压缩 fork 在 commit 前对缺失的 `open-loops.md` **建种子**(碰 fork 尾部 item →
  **必须先跑绿 `fork-cache-alignment.test.ts`**;提醒正文须字节稳定,日期走运行时 `date +%F` 取)。
- 选项 b:承认「语义腿之外的承诺腿靠 prompt 立不起来」,**停掉省维护**,把 leg-2 从文档和
  管理端观察面摘掉。
- **推荐 b 先行**:这与空转是同一个病(教了不做),在 anti-idle 的 D1 定调之前,
  给承诺腿单独造护栏是重复投资。

### R4 · 专题腿(leg-3)不动
- 纯冷启动、零产出,但它依赖日记语料积累(现已 1,215 条,在长)。
- **本轮不投入**,R1/R2 落地后重测。

## 投递门槛(建议写死为验收条件,而非本 spec 的实现内容)

三条**同时**满足,才允许启动投递(且只投宫殿腿):
1. 语义腿静默率 **≥ 85%**(现 63%)
2. surfaced 中 `file_chunk`(宫殿)占比 **> 50%**(现 29%)
3. **零** hint < 12 字的 lead(现 27%)

> 投递本身是唯一碰缓存的一步:lead 随时间/条目变化,若进持久 stack 会在 run 边界 replay 不一致
> → 击穿主 + fork 双缓存。必须走一次性、可从 replay 剥除的 non-durable 通道(同 `xiaoni_plan`
> D-strip 模式),并用相邻 slice `wire_request` 实测 `cache_read_input_tokens` 验证,不能推断。
> —— 这些属于投递 spec,不在本 spec 范围。

## 双缓存影响分析(铁律)

**本 spec 全部改动零缓存风险,理由是结构性的,不是「我觉得」**:
- R1/R2/R4 全在 `packages/persistence` 与 admin-backend 侧。
- agent-service 侧**不存在**召回注入 seam(已实测 `grep passive-recall modules/agent-service/src` = 空)。
- 因此召回产物**根本不进任何 agent 请求**,既不进 cacheable 前缀,也不进 stack replay。
- R3 选项 a **是唯一例外**(碰 fork 尾部),故推荐选项 b;若选 a,按铁律走完整双缓存分析 + 实测。

## Acceptance Criteria

1. R1 后:新入库 cue 中 hint < `MIN_CUE_CHARS` 者 = **0**;reindex 后存量同样为 0。
2. R2 后:在 `xiaoni_recall_shadow_log` 历史回放上,§Current State 里那条日记自我回声
   **不再 surfaced**;并给出调参前后三条曲线。
3. 语义腿静默率 ≥ 85%(以 R1+R2 后连续 3 天真实 shadow 数据为准,不是回放)。
4. surfaced 中 `file_chunk` 占比 > 50%。
5. 三套缓存铁律用例**未被触碰**且仍全绿(本 spec 不应产生任何需要改断言的理由)。
6. R3 结论落文档:leg-2 要么有护栏并产出 > 0,要么被显式停用并从观察面摘除。

## Testing Plan

| 层 | 测什么 | 数 |
|---|---|---|
| Unit | `MIN_CUE_CHARS` 边界(11/12/13 字);`normalizeRecallText` 剥信封 | +4 |
| Unit | nearDup 阈值判定(0.84/0.86/0.96 三点);在场集合扩到全量后的排除正确性 | +3 |
| 回放 | `xiaoni_recall_shadow_log` 历史重放,输出静默率/构成/回声命中三曲线 | 脚本 |
| 真实 shadow | R1+R2 上线后连续 3 天真实数据达门槛 | 手验 |

## Rollback

- R1/R2 全部走 env(`XIAONI_RECALL_MIN_CUE_CHARS` / `XIAONI_RECALL_NEARDUP_SUPPRESS`),改回原值即回退。
- 存量 reindex 是幂等重扫,回退阈值后再扫一次即恢复。
- 零缓存 → 回退不涉及任何 agent 重启或缓存回暖。

## Files Reference

| 文件 | 改动 |
|---|---|
| `packages/persistence/xiaoni-recall-ingest.js:23-32` | `MIN_CUE_CHARS` 门 + `CENTERED_NEARDUP_SUPPRESS` 0.95→0.85~0.88 |
| `packages/persistence/xiaoni-recall-ingest.js:45` | `SEMANTIC_CONTEXT_WINDOW` 20 → 全在场集 |
| `packages/persistence/xiaoni-passive-recall-extractor.js:112` | `normalizeRecallText` 剥运营信封 |
| `modules/admin-panel/backend`(reindex 触发) | 存量重扫入口(复用 `xiaoni-recall-reindex-service.ts`) |
| `docs/XIAONI_PASSIVE_RECALL_SURFACING.md` | 更正 §10 的静默率宣称(85% → 实测 63%),补投递门槛 |

## Out of Scope

- 投递(v2)。见 §投递门槛。
- 专题腿 leg-3(R4:本轮不动)。
- 存量 `reading/` 47,133 条的 purge(已被围栏挡住,不构成召回噪音;purge 有 🔴 顺序铁律,单独做)。
- 压缩腿(实测健康,fresh-file handshake 已闭掉旧近况窗口)。

## Related

- `docs/XIAONI_PASSIVE_RECALL_SURFACING.md` §8/§10/§11(达成度 0 的自认)
- `docs/XIAONI_PASSIVE_RECALL_SHADOW_COMPLETION.md:17`(shadow-only 确认)
- `docs/XIAONI_MEMORY_PALACE_GENERATION.md`(生成端)
- `docs/specs/xiaoni-anti-idle-external-authority.md` —— **同一个病**:教了她做(`open-loops.md`),
  无护栏无记账,她就是不做。R3 的取舍应与 anti-idle 的 D1 一起看。
