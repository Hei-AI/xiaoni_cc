# 压缩(compress core memory)三点要求合规报告

- **日期:** 2026-06-28
- **范围:** `modules/agent-service/src/services/agent-loop-service.ts`
- **事故窗口:** 2026-06-28 20:35–20:51(15 分钟内压缩 4 次、cache 击穿 6 次)
- **数据源:** `core_memory_compression_fork_runs` / `core_memory_compression_fork_slices` / `llm_request_slices`(主栈 qqbot-postgres)
- **结论:** 三点要求全部不达标。根因同一处——压缩被实现成「挂在小腻每轮 loop 内、按 tiktoken 估算二分、后台并发跑 fork、即时提交 cutoff」。

---

## 说人话版

**要求(用户原话三点):**
1. 压缩什么时候发生由程序定,小腻自己说了不算。
2. 压缩完换新上下文那一下,得等小腻和所有后台任务都停下、没人在干活时再换。
3. 换进去的新上下文 = 压缩前最后 30 条对话 + 这之后新来的对话。

**现在代码实际:**
- **第 1 条没做到。** 压缩没有独立程序管,而是塞在小腻每说一句话的处理流程里,每轮重算一次"超没超",一超就触发 → 15 分钟触发 4 次。
- **第 2 条没做到。** 压缩后台偷偷起任务在跑,主流程没停还在并发发请求;换上下文也是任务一跑完就立刻换,不管小腻和别的后台任务还在跑 → 三个任务撞一起 → 缓存被打穿 6 次。
- **第 3 条没做到。** 手动压缩那条路对(真整段尾部 30)。但实际出事的自动压缩那条路,保留的是"算到刚好溢出那段的尾部 30",而且每次只往前挪一丁点 → 第 3、4 次压缩每次只砍 1 条,砍完还超,过两分钟又砍 1 条又崩一次。

**一句话:** 压缩本该是「程序决定 → 等没人干活 → 一次性把尾部 30 条 + 新对话换进去」,现在却是「跟着小腻每轮跑 → 后台并发偷偷压 → 算超一点就砍一点 → 立刻换」。

---

## 总览

| # | 要求 | 判定 | 违背落点(file:line) |
|---|---|---|---|
| 1 | compress 不能由小腻触发,必须工程触发 | ❌ 不达标 | `:6150-6157` 内联调度 + `:8078`/`:11787` 估算触发 |
| 2 | 替换必须在没有任何 fork/main agent 运行时 | ❌ 不达标 | `:9336` fork 后台起、`:8810` 即时提交,**全程无 quiescence 闸** |
| 3 | 回填 = 压缩前尾部 30 条 + 之后新增 | ❌ 不达标(仅 auto 路径) | `:11799-11807` 用「溢出前缀尾部 30」而非整段尾部 30 |

---

## REQ 1 — 工程触发,非小腻触发

| 项 | 内容 |
|---|---|
| 要求 | 触发由工程独立判定,小腻的 loop 不参与触发决策 |
| 现状 | 触发挂在**处理小腻每条消息的每轮帧内**;每轮用她当轮请求的 token 估算重判 |
| 落点 | `scheduleCoreMemoryCompressionFork` 调用在 `:6150-6157`(主 loop 帧内);判定 `estimate.inputTokens > contextWindowTokens` 在 `:8078`,二分在 `:11787` |
| 对的部分 | 小腻 tool 自调用已被 hard-reject(`:6421-6433`)——这条没问题 |
| 违背性质 | 触发寄生在小腻 loop 上、每轮重判,估算一过线就 fire 且反复 fire |
| 关键缺陷 | 判定用 tiktoken 估算(把图片 base64 当文字逐字符数,12 张图被数成 ~55 万,真实才十几万),而**不用 LLM 返回里现成的真实 `input_tokens`** |

---

## REQ 2 — 替换须在无 agent 运行时

| 项 | 内容 |
|---|---|
| 要求 | 近况替换(cutoff 提交 + 上下文换入)只在无 main/fork agent 运行时执行 |
| 现状 | fork 在 `:6151` 后台拉起,主 loop 在 `:6148` 之后继续并发构建请求;cutoff 在 fork 完成那刻即时提交 |
| 落点 | fork 运行 `:9336`;提交 `resolveCoreMemoryCompressionCommitCutoff` `:8731` + atomic commit `:8810`。**无任何 "有 agent 在跑就不替换" 检查** |
| 违背性质 | fork 与主 loop、fork 与 fork 并发重叠,替换在并发中发生 |
| 实证 | fork `8fd8f21e`(20:48:17–20:49:36)与主 loop conv 60673(20:48:39)重叠;`b652f0b8` 20:50:11 又起。每次重叠 = fork turn1 击穿 + 主 turn1 击穿 |

---

## REQ 3 — 回填 = 尾部 30 + 新增

| 路径 | 函数 | 落点 | 判定 |
|---|---|---|---|
| manual/forced | `planReadCutoffForForcedCompression` | `:11831`(整段 history,保留最后 30:`:11835`/`:11840-11842`) | ✅ 符合 |
| **auto(实际出事)** | `planReadCutoffFromFirstOverflow` | `:11799-11807` | ❌ **违背** |

auto 路径违背细节:
```ts
:11799  const sourceLength = Math.max(1, firstOverflowPrefixLength - 1);   // 二分"首个溢出点"
:11800  const summarySourceHistory = params.history.slice(0, sourceLength); // 只取溢出前缀,非整段
:11805  const overlapCount = Math.min(HISTORY_COMPACT_KEEP, ...);          // 保留的 30 = 溢出前缀的尾部 30
:11806  const readCutoffIndex = summarySourceHistory.length - overlapCount - 1;
```
保留的是**溢出前缀的尾部 30**,不是整段对话的尾部 30;cutoff 由 token 估算驱动、每次只挪到「刚好不溢出」→ 一条一条 nibble。

cutoff 推进实证:

| fork | cutoff | 砍掉条数 |
|---|---|---|
| `a0d4141a` | 60617→60624 | 7 |
| `fae26e91` | 60624→60640 | 16 |
| `8fd8f21e` | 60640→60641 | **1** |
| `b652f0b8` | 60641→60642 | **1** |

---

## 后果实证 — 15 分钟 6 次 cache 击穿(命中均仅 12,249 = 裸 system 头)

| # | 时间 | 流 | slice | in | 命中 | 重写 |
|---|---|---|---|---|---|---|
| 1 | 20:36:18 | FORK a0d4141a | `…3bdc62c5` | 197K | 12,249 | 184,262 |
| 2 | 20:38:11 | MAIN 60667 | `…536c2e39` | 233K | 12,249 | 220,976 |
| 3 | 20:48:39 | MAIN 60673 | `…233cd4ce` | 135K | 12,249 | 122,227 |
| 4 | 20:49:03 | FORK 8fd8f21e | `…70e7281d` | 117K | 12,249 | 104,291 |
| 5 | 20:50:22 | MAIN | `…3e226266` | 137K | 12,249 | 124,682 |
| 6 | 20:51:04 | FORK b652f0b8 | `…f3ced6ec` | 116K | 12,249 | 103,544 |

合计约 **86 万 token** 被无谓重写进 cache。

### 旁证:为什么估算虚高

- conv 60672/60673 的 canonical request:**12 张图、2.2–2.6 MB**。
- tiktoken(o200k_base)数这 2.2MB ≈ **55 万 token**;Anthropic 对这 12 张图每张只算 ~1.5K = 约 1.8 万。
- 估算虚高 4–6 倍且随截图剧烈波动。
- 内存里的自校准 EMA 救不了:地板钳在 0.5(有效窗口最多 1.2M),且 agent-service 20:32:43 刚重启把校准清回 1.2 种子(fork 20:35,重启后才 2.5 分钟),所以第 1 次有效窗口正好 500K。

---

## 修复方案(已锁定 spec)

### REQ 1 — 触发只看模型返回的真实 input,彻底删掉 tiktoken
- 触发判据 = **模型返回的真实 `input_tokens`**(不是估算)。**tiktoken 整套删除**,不做触发、不做砍点、不做辅助。
- **反应式 + 去抖窗口(N=2):**
  - 每轮主 agent 返回 → 读真实 `input_tokens`。
  - 内存里维护 per-`contextSessionKey` 的「连续 >500k」计数器:`>500k` 则 +1,任一轮 ≤500k 则清零。
  - 计数器 **≥ 2** → 标记该压 → 下个 STW 窗口换。
  - 滤掉单轮尖峰(一次性大 tool result / 图片 burst 顶高一轮但不进保留历史)。
- **信号只放内存,重启清零(feature 不是 bug):**
  - 绝不持久化「该压」flag,也不靠重读历史 slice 推断当前大小(那要 tiktoken,已删)。
  - 重启后计数器=0 → 不预压。重启后第一轮按当前真实上下文跑(100k 就 100k,501k 就 501k),返回真实 `input_tokens` 再判 → 不会用过期数字误压。
  - 代价 = 已接受的「差一轮」:跨过 500k 那轮 + 重启后首轮不设防地跑一次,真实、罕见、500k 软线下有余量。
- 落点:删 `:6150-6157` 的内联估算调度、`:8078`/`:11787` 的 tiktoken 触发条件、`:11695-11726` 的 `tokenizerCalibration` 整套、`estimateLoopInputTokens`/`estimateRequestTokens` 在压缩路径上的调用;触发改为内存计数器(在主 turn usage 回填处更新,约 `:5535`)。

### REQ 2 — 压缩完成后 STW 原子替换
- fork 慢慢算那 1-2 分钟**不停世界**;只有最后"换近况 + 重组上下文"那一下进 STW。
- **静默定义(已锁):**
  - **小腻主 agent:当前 turn(当前 model slice)跑完即可**——不切 turn 中间,当前 turn 一返回就是安全点。
  - **fork agent:整个 fork(全部 4-5 turn)跑完**——fork 跨多轮须看同一份上下文,中途换会自相矛盾 + 前缀打穿。
- **STW 闸流程:** compression 压完待提交那一刻**封顶**(挡新 main turn / 新 fork 启动)→ 等「当前在跑的 main turn 收尾 + 在跑的 fork 整段跑完」drain 清空 → **原子换** → 解封。drain 集合只减不增,冻结时长有上界(= 在跑 fork 的剩余时间)。
- **换近况与重组上下文是同一个原子动作**:写入新近况(fork 压出的摘要)的同时把上下文重组成 `[system][新近况][尾部30][新增]`,不能只换其一(否则前缀对不上照样打穿)。
- 落点:fork 完成回调 → STW 闸,包住 `resolveCoreMemoryCompressionCommitCutoff` `:8731` + commit `:8810`,按 `identity_key` 判静默(`agent_runs` 无 running + 各 `*_fork_runs` 无 running)。

### REQ 3 — 新上下文 = 整段尾部 30 + 之后新增
- 固定保留整段对话的最后 30 条 + 压缩期间新进来的,删掉 token 二分。
- 落点:auto 路径用 `:11831`(`planReadCutoffForForcedCompression`)的整段尾部 30 语义,替换 `:11744`(`planReadCutoffFromFirstOverflow`)。

**实施顺序:REQ3 → REQ2 → REQ1**(先把砍法和换的时机修对止血,再解耦触发)。
