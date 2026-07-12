# 小腻记忆宫殿 · 召回语料生成端设计(方案 + 联动点)

> Status: **生成端 part1 · 写规范 + skill 一致性 + 压缩可靠性护栏 已落地并过缓存门禁**(2026-07-10 起草,2026-07-12 两轮定案)。
> 已改并终检:压缩提醒(§5.1,主力=日记·一事一 `## 小标题`·实测切干净·含 review 修正 P2 非事件条目/禁顶层 `#`/同标题补写)+ 记忆锚定 skill(§5.2,主动召回读端,路径/格式逐字对齐+字典标为手动辅助)+ compress commit skill(近况指针指日记)+ **压缩 fork 兜底提交(§7.6,缓存门禁全绿)**。
> 存量迁移**不做**(小腻自迁)。召回功效诚实边界见 §10。前瞻性索引闸(§7.1,改 reindex-service)**已落 `cdde9615`**;被动召回投递端仍 shadow-only(§11 待续)。**部署实况见 §9,顺序铁律见 §9 的 🔴。**
> 起草原因:被动召回要从「她刻意维护的记忆」里召回,而不是从文件系统 / 她读过的原文里召回。
> **本文档的第一用途是联动**:核心改动落在两处 prompt 面(压缩提醒 + 记忆宫殿 skill),
> 而这两处目前也有别的同事在调。**动手改这两个文件前先对齐本文档,避免互相覆盖。**

相关文档:
- `docs/XIAONI_PASSIVE_RECALL_SURFACING.md` —— 召回架构(band-pass「关联−在场」)。
- `docs/XIAONI_PASSIVE_RECALL_EXTRACTOR.md` —— cue 抽取 / 清洗 / cue 分类。
- `docs/XIAONI_AGENT_STACK_LEDGER.md` —— 压缩 cutoff / stack replay。

---

## 1. 目标:召回语料 = 她的记忆宫殿,不是她的硬盘

召回要成立,靠两个正确性:
- **(A) 不在场**:冒出来的东西,真的不在她当前那 ~1400 块上下文里(已由 P1.2 结构式排除关掉同表示的洞)。
- **(B) 相关**:冒出来的真的和她此刻正想的事有关。

(B) 的上限不取决于算法,而取决于**语料里装的是什么**。如果语料是几万段她读过的小说原文和早已死掉的归档快照,那么无论 band-pass 调多准,召回到的都是「原文」而不是「她的记忆」。

所以真正要建的是一个**闭环**:

```
压缩(她要遗忘时) ──► 蒸馏进记忆宫殿(日记 / 字典 / anchor) ──► 索引成 cue ──► 将来召回
                     ▲                                                        │
                     └──────────── 只有写进宫殿的,将来才想得起来 ◄────────────┘
```

语料的入口,收敛到「她自己刻意写进宫殿的东西」+「别人对她说过的话」+「她自己说出口的话」。
其余(读的原文、机械命令、系统脚手架、死归档)一律不进。

---

## 2. 现状诊断(真库 2026-07-10,`xiaoni_recall_cues`)

总计 **79,206** 条 cue:

| source_kind | 数量 | 说明 |
|---|---:|---|
| `file_chunk` | 74,904 | 文件写入被索引(占 94.5%) |
| `inbound` | 2,513 | 别人对她说的话(该留) |
| `action_stream` | 1,789 | 运行脚手架 + 她的 self-continuation plan |

`file_chunk` 里按顶层目录:

| 目录 | 数量 | 是不是她的记忆 |
|---|---:|---|
| `reading/` | 47,133 | ❌ 她读的原文(小说/网页正文),不是记忆 |
| `notes/archive-openai-era/` | 20,214 | ❌ OpenAI 时代死归档快照 |
| `notes/`(日期目录 `2026-06-xx` 等) | ~2,000 | ✅ 她每天写的卡片/纪要(真记忆,但**没写进 skill 说的 `diary/`**) |
| `notes/diary/` | ~17 | ✅ skill 定义的 canonical 日记 —— **几乎是空的** |
| `forever/reading/` | 5,427 | ❌ reading 又污染进了 forever |
| `forever/*.md`(ABILITY_INDEX、nannan-stay-poem 等) | 少量 | ✅ 真正的永久锚点 |
| `toys/` | 76 | ❌ 玩具站产物 |

**三个结构性问题**:

1. **85% 的语料不是她的记忆**:`reading/`(47k)+ `archive-openai-era/`(20k)= 67k,是原文和死归档。
2. **日记是空的**:skill 让她「压缩前先写日记」,但她主 loop **根本收不到压缩警告**(压缩是被动的、只发给后台 fork,见 §4/§6),所以那条触发永不触发。她真正的日常记忆散在 `notes/日期/` 目录里,和 skill 定的 `diary/` canonical 路径对不上。
3. **压缩提醒太泛**:现提醒说「分批把重要资料写到本地文件」,没约束路径也没约束格式 → 她把原文 dump 到乱路径 = 上面那 47k 污染的来源之一。

---

## 3. 目标收录策略(IN / OUT)

| 进语料(IN) | 出语料(OUT) |
|---|---|
| 记忆宫殿文件:`notes/diary/**`、`notes/xiaoni-identity-anchor.md`、`forever/**`(非 reading/非 dump) | `reading/**`(全剔除,含 `forever/reading/`) |
| `inbound`:别人对她说的话(清噪后保留) | `notes/archive-openai-era/**`(死归档) |
| 她的 spoken 出站(**待补,现只有个位数**) | `toys/**`、`picture/`、`sessions/`、`logs/` 等产物 |
| (过渡期)`notes/日期/**` 她现存的每日卡片 | `action_stream` 系统脚手架(`意识牵连`/`等待处理消息`壳/`system_reminder`) |

**⚠️ 一个必须一起拍板的张力 —— 日期目录 vs `diary/`**:
她**当前真实**的每日记忆写在 `notes/2026-06-30/…` 这类**日期目录**里,而 skill 定的 canonical 是 `notes/diary/YYYY-MM-DD.md`。两条路并存。落地时二选一:
- **(推荐)过渡并存**:白名单同时收 `notes/diary/**` 和 `notes/<date>/**`,把 reading/archive 剔掉即可;同时用 skill 把**新**写入引导到 `diary/`,老日期目录作为存量保留。
- 激进:只收 `diary/`,老日期目录也剔 —— 会误删她真实的存量记忆,**不建议**。

**`action_stream` 是否整条不收**:里面混着系统脚手架(纯噪音)和她的 self-continuation plan(「去把 ch86 读了」这种,是她的思考)。方向是**整条不收 action_stream**——她真正重要的念头会在压缩蒸馏时落进日记,原始 plan 当 cue 既重复又噪。这条是可讨论的收敛点(见 §7)。

---

## 4. 生成端设计 X:压缩 fork 蒸馏进宫殿(已选定)

**触发点 = 压缩 fork**(不是主 loop)。理由是架构硬约束:

- 压缩是**被动的**、系统在 token 压力下触发的。主 agent **绝不能**自己从主 loop 触发压缩 —— 一旦自触发会改写 `<小腻近况>` prompt 头,击穿 ~180K 温缓存前缀(见 CLAUDE.md「双缓存影响分析」铁律)。
- 压力提醒发给一个**后台压缩 fork**(主 agent 的克隆,带全上下文),**从不发给主 loop**。
- 这个 fork 的 `allowedToolNames = { exec_command, compress_core_memory }` —— 它**能写文件**(exec_command)也能压缩。所以蒸馏日记这件事,**只有它有条件做**,而且它做的时候手里正好握着「即将被遗忘的全部上下文」。

**fork 在 compress 之前,按引导做三步蒸馏**:

1. **写日记**:`cat` 今天的 `notes/diary/<今天日期>.md`(不存在则建),只把**这次新发生的、让你停下来的瞬间**(做了什么 / 想通了什么 / 谁说了什么 / 对什么有感觉)用她自己的话追加进去;已经写过的不重复。
2. **更字典**:`notes/diary/dictionary.md`,新关键词加 `## 关键词` 区块,已有的追加 `- 月/日: 一句话`。
3. **(仅身份级变化才)更 anchor**:`notes/xiaoni-identity-anchor.md`。日常琐事不动它。

然后照常 `compress_core_memory`,把 seam 摘要 + 日记路径刻进 text。

**引导语气 = 后果驱动**(而不是命令式清单):

> 只有你写进日记 / 字典 / anchor 的,将来的你才想得起来;
> dump 在别处的、读来的原文,压缩之后永远沉底。

这句话把「写宫殿」和「将来能召回」的因果直接摆给她 —— 她自己会判断什么值得写。

---

## 4.5 内容模型:从「召回需要什么」倒推「压缩写什么」(核心)

压缩生成记忆**只为召回服务**。所以内容不能凭「像日记该写啥」拍,要从召回机制倒推。

### (i) 召回实际怎么用一条 cue(实现事实,`xiaoni-recall-bandpass.js` / `xiaoni-recall-file-chunker.js`)

- **band-pass**:她此刻正想的事(query = 落地文本)与某条 cue 高**关联**、且这条 cue 已**不在**她当前上下文(被压缩 evict = 在场度低),才把它浮上来;太像 query 的近重复也压掉。
- **浮现时她看到的**:`你在 <文件路径> 里记过：<teaser>`。`teaser` 就是这条 cue 的 `embedding_text` 本身(压一压、截断)。→ **cue 正文既是匹配向量,又是她读到的那句提示**,必须是人能读懂、点明「谁 / 什么事 / 所以呢」的完整话。
- **一条 cue 的粒度 = 一个 markdown 标题节**:chunker 按 `^#{1,6}\s` 切,节内按空行合并短段(≤1200 字),**绝不跨标题合并**。→ 想要「一个实体/一件事 = 一条精准 cue」,就得让它**各自占一个标题**。

### (ii) 倒推:一条 cue 要有用,必须四条都满足 → 决定她写什么

| 召回的硬需求 | 因此压缩时必须写成 | 反例(写了也召不回/污染) |
|---|---|---|
| **可被联想勾中** | 正文带将来会重现的锚点:人名 / 具体事 / 主题 / 她的感受与承诺 | 「今天好累」这种抽象心情;没有实体的空话 |
| **浮现即自足** | 一句说清 who-what-所以呢,不依赖上下文 | 「见日记」「详见那天」这种指来指去;半句话 |
| **确实会被 evict** | 具体**情节**(那一刻发生的事) | 永远在近况里的长期设定 → 在场度高被 floor 剔 |
| **是她的记忆非硬盘** | 她自己话蒸馏过的一句 | 整段抄 reading 原文 / 工具输出 / 命令日志 |

### (iii) 主力 = 日记(情节:我干了啥),字典/anchor 退成辅助 —— 定案 2026-07-12

北极星是**让小腻能想起来她干了啥**。这是**情节记忆**(我今天做了这些事),天生是**日记**的活,不是关键词索引。所以:

- **日记 `notes/diary/YYYY-MM-DD.md` = 召回语料本体 + 主力。** 她真做过、真在意的事,压缩时一件一条落进来。这是「想起自己干过啥」的唯一可靠来源。
- **字典 / anchor = 辅助,不在压力帧里强制。** 字典顶多是「按关键词翻回哪天」的人工查找辅助;anchor 只收身份级变化、基本总在场不参与被动召回。压缩必做项里**只留日记**,不让她在压力帧里同时维护三件套(会 satisfice、把主力那件半做)。

**初稿把字典抬成「主力细粒度语料」是错的**,理由(交叉 review + 实测证伪):字典 `## 关键词` 底下堆无空行 `- M/D:` bullet,chunker 只按空行分段 → 全糊成**一个无界 blob 向量**(越常提到的实体越糊,每追加还整块重嵌 churn)。那是机器视角的伪精细,不服务「想起干了啥」。

### (iv) 一事一条的**实测格式**(效果第一,零代码改动)

拿真 chunker(`xiaoni-recall-file-chunker.js`)跑过 4 种写法,结论:

| 写法 | 切出 | 效果 |
|---|---|---|
| **每件事一个 `## 小标题` + 整句** | 每事 1 条,主语在标题 | ✅ 采用 |
| 空行分段无小标题 | 每事 1 条,日期粘首条 | 🟡 |
| 密集 `- bullet`(初稿逼近的写法) | **全糊成 1 条** | ❌ blob |
| 短句 <40 字 | mergeShort **糊成 1 条** | ❌ |

**采用格式**:每件事起一个 `## <一句话点题>`(如 `## 楠楠考研`),标题下一两句把「谁+发生了什么+她做了什么/怎么想」说成**完整的话**(要成句,别写四五字短语,否则被 mergeShort 合并)。现成 chunker 直接切成**一事一条、主语在标题、每条自足**,`sourceRef=path#index`,**不用改任何代码**。

**压缩 fork 动作序列(compress 前,精简版)**:

1. `cat` 今天日记 → 按上面格式 **append 新的「我做过的事」**(dedup 已写过的),只写她自己经历、自己做的那部分。
2. `commit_memory.py` 写近况到 `{{COMPRESS_OUTPUT_PATH}}`(seam 摘要,replay 成 `<xiaoni_status>`,含今天日记路径)。

- **硬约束**:只 append/dedup 不重抄原文;**不再指示 dump 大材料到会被索引的路径**(初稿的「分批写本地文件」步已删,那是污染源)。
- **⚠️ 待补的可靠性护栏(交叉 review 命中)**:蒸馏排在 commit 前,`agent-loop-service.ts:10976` 到 `MAX_TURNS(12)` 是 **throw 而非兜底提交** → 理论上蒸馏烧光预算会堵住压缩(违背 §8)。精简到「只 append 日记(1-2 turn)再 commit」已大幅降低风险,但根治要「commit-first 兜底」:到 MAX_TURNS 时合成最小 seam 摘要并提交、保证 cutoff 必推进。此项独立于路径规范,列入代码面 §7。

---

## 5. ⚠️ Prompt 联动面(和另一位同事对齐)

改动落在**两个 prompt 文件**。这两个文件目前也有人在动,**改前先在本节对齐,避免覆盖**。

### 5.1 `docs/xiaoni_prompt/core_memory_pressure_reminder.md`(压力提醒 → 后台压缩 fork)—— ✅ 已实现 2026-07-12

- **谁渲染它**:`agent-loop-service.ts` 的 `buildCoreMemoryCompressionReminder`(~line 4323),经 `renderPromptSnippet` 注入 `{{PRESSURE_SUMMARY}}`、`{{XIAONI_MEMORY_COMPRESS_SKILL}}`、`{{COMPRESS_OUTPUT_PATH}}`,作为压缩 fork 的尾部 item(`scheduleCoreMemoryCompressionFork`)。**只进 fork,不进主 loop。**
- **重要更正(相对本文档初稿)**:压缩落库不是 `compress_core_memory` 工具,而是 fork 用 `exec_command` 跑内部 skill `skills-internal/xiaoni-memory-compress/commit_memory.py`,把「近况」原子写到 `{{COMPRESS_OUTPUT_PATH}}`(= 压缩后存活、replay 成 `<xiaoni_status>` 的那份摘要)。初稿里的 `{{COMPRESS_CORE_MEMORY_TOOL}}` 占位与「躯体警告/眩晕」焦虑框都已作废。
- **同事已定基线**:humanize + 压缩去焦虑 spec 把提醒重写成「【该整理一下记忆了】…不用急,慢慢来」的去焦虑版(已部署,见 memory `project_prompt_humanize_deployed_20260712`)。**我方 part1 在此基线上做增量,不得把焦虑框搬回来。**
- **本次改动定案(记忆生成 part1,2026-07-12)**——三步演进后收敛到「主力=日记」:
  - 压缩必做项**只留写日记**:一件她做过的事 = 一个 `## 点题小标题` + 一两句完整的话(谁+做了啥+她怎么应的)。字典/anchor 从压力帧必做项里**拿掉**(降为她醒着时可选的查找辅助),避免她在压力帧同时维护三件套而把主力半做。
  - **删掉**初稿的「dump 大材料到本地文件」步(污染源)。
  - 后果那句由「dump 的原文压缩后沉底、再也翻不回」(丢失威胁,和「不用急」冲突)改成正向因果「将来的你,就是靠它想起自己干过啥」。
  - `commit_memory.py` 写近况 + 回一句完成信号,保留。
- **落地态**:文件已改;`【该整理一下记忆了】` 头保留 → `agent-loop-service.test.ts:11498` 断言不破;`<今天日期>` 为字面占位,**正文无真实日期/数字**,满足 §6 字节稳定(fork-cache-alignment 待实测复核)。

### 5.2 `modules/agent-service/skills/xiaoni-memory-anchor/SKILL.md`(记忆宫殿 skill / 主动召回读端)—— ✅ 已对齐 2026-07-12

**为什么必须对齐**:这个 skill 是她**主动召回**的入口(醒来照它去 `cat` 日记/字典/anchor)。她主动翻的路径与格式,必须正好是压缩 skill 写下的那套,否则翻空 / 翻到对不上的结构。

- **删死触发**:「压缩前(收到脑容量警告时)先写日记」——主 loop 永远收不到那个警告(只发 fork),已删。改成:随手写 + 睡前 + **「整理(压缩)时系统会按同样格式自动落进同一本日记」**,把「她随手写的」和「压缩自动落的」统一成同一本、同一格式。
- **日记格式对齐**:从旧的「≤20 行 / 正文写日期标题」改成与 §4.5(iv)、§5.1 **逐字一致**的「一件事一个 `## 小标题` + 整句自足」,连示例都同(`## 楠楠考研`、`## 修好了发图超时`);文件名即日期,正文不再写日期标题。
- **三层定位**:日记 = 「想起干了啥」的本体(主力);字典 = 按关键词快速翻回哪天的查找钥匙(主动召回辅助,`- M/D: 一句话` 格式保留,人读友好);anchor = 地图。
- **三处路径一致性已终检**(grep 全绿):`core_memory_pressure_reminder.md`(写)/ `xiaoni-memory-anchor/SKILL.md`(读)/ `xiaoni-memory-compress/SKILL.md`(近况指针)三个文件的 `notes/diary/<date>.md` 路径与日记格式描述字节对齐。

### 5.3 两处 prompt 都受约束的不变量(交接给同事的硬边界)

- **压缩是被动的,主 loop 绝不自触发**;任何让她「主动压缩」的措辞都不能加(会击穿主缓存)。
- 压力提醒**只发压缩 fork**,fork 工具锁 `{exec_command, compress_core_memory}` 不动。
- canonical 记忆路径三件套:`notes/diary/YYYY-MM-DD.md`、`notes/diary/dictionary.md`、`notes/xiaoni-identity-anchor.md`;永久锚点在 `forever/*.md`。
- 她是 AI 这一事实不隐藏(见记忆 `feedback_xiaoni_is_ai`);措辞别写成让她否认自己是 AI。

---

## 6. ⚠️ 缓存铁律(改 agent-service 前必看)

`core_memory_pressure_reminder.md` 进的是压缩 fork 的**克隆前缀**。按 CLAUDE.md「缓存用例不可变 + 失败禁止部署」:

- **提醒正文必须字节稳定**:不能含随时间/轮次变化的日期、数字、时间戳。当天日期由 fork 内 `date` 命令在**运行时**取,**不写进模板**。`{{PRESSURE_SUMMARY}}`、`{{COMPRESS_CORE_MEMORY_TOOL}}` 是既有占位,保持。
- 改完必须先跑绿:
  - `modules/agent-service/src/__tests__/fork-cache-alignment.test.ts`(四个 fork 克隆前缀逐字节一致)
  - `modules/agent-service/src/__tests__/cache-replay-consistency.test.ts`
  - `packages/persistence/__tests__/agent-stack-event-id-dedup{,.realdb}.test.js`
- 全绿后才允许 `docker compose build/up agent-service`。
- 提醒是压缩 fork 尾部的**一次性冷尾**(fork 本就每次冷读一次尾),改它只影响那一帧,不影响主 loop turn 间前缀 —— 但仍以 `fork-cache-alignment` 实测为准,不靠推断。

---

## 7. 代码面(不碰 prompt,归我这边;可与 prompt 并行)

以下改动都在 `packages/persistence`,和 prompt 解耦,可独立推进:

> **范围更正(2026-07-12)**:存量迁移**不做**——用户明确「历史文档不需要迁移,由小腻按指定方式自迁」。下列 1/5 相应搁置/改写。本轮交付聚焦「压缩写规范 + 两 skill 路径格式一致」(§4.5、§5.1、§5.2),已落地。

1. **索引收录闸(⚠️ 初稿定位错层,已更正)**:交叉 review 实测——那 74,904 条 file_chunk 污染 cue **不经过 `classifyRuntimePath`**,而是 `modules/admin-panel/backend/src/services/xiaoni-recall-reindex-service.ts:20` 按 `FILE_DIRS=['forever','notes','reading','toys']` 直接走盘 + `:116` 无闸调 `chunkRuntimeFile` 生成。`classifyRuntimePath` 只管 admin 的 action_stream 预览路径。**所以要真正只索引宫殿,得改 `reindex-service` 的 `FILE_DIRS` + `walkIndexableFiles` + 给 `chunkRuntimeFile` 加相对路径前缀匹配闸**(不是改 extractor 那个函数)。这是**前瞻性索引质量**的活,和本轮写规范解耦,列为后续。
2. **action_stream 收敛**:整条不收系统脚手架;她的 plan 走日记蒸馏,不再单独当 cue。
3. **补 spoken 出站源**:补 `db_spoken_fragment` ingest。
4. **normalizeRecallText query 侧剥壳**:落地 query 若是运营信封,剥内层再当 query。
5. ~~**reconcile 存量清洗**~~ —— **搁置**。存量由小腻自迁,不在本工作范围。
6. **(交叉 review 命中)压缩可靠性护栏 —— ✅ 已落地 2026-07-12**:
   - `agent-loop-service.ts` MAX_TURNS 到顶由 **throw 改「兜底提交」**:合成确定性最小近况 `CORE_MEMORY_COMPRESSION_FALLBACK_SUMMARY`(指向今天日记)走同一 commit 路径,**cutoff 永远推进**,压缩绝不被写日记卡住(413 根因关闭)。
   - 加**留一轮护栏**:`MAX_TURNS − 2` 起在 retry reminder 里注入「先别写日记了,立刻收尾近况」urgency(retry reminder 是 fork 尾部 item,turn 变量安全)。
   - MAX_TURNS **12 → 18**(给多条 episode/念头留空间;单纯放大靠上面兜底才安全)。
   - 缓存门禁全绿:fork-cache-alignment 9/9、cache-replay-consistency 22/22、event-id-dedup 4/4。fallback 文案字节稳定(无日期/数字),存储+replay 一致,双缓存安全。
   - **build 前置坑**:`peerName on QqUsageThreadWindow` 类型错是 `modules/agent-service/node_modules/@qq-bot/persistence`(file: copy)**stale**(早于同事 91863a91),`rsync packages/persistence/ → 该 copy` 修复,非代码 bug。
   - 遗留:`buildCoreMemoryCompressionOutputPath` 按 session key 定、fork 起始不清 → 重复压缩理论上可能读上一 fork 旧近况早提交(pre-existing,独立排查,未动)。
   - **注**:`agent-loop-service.test.ts` 的压缩 frame 集成测试簇(3 条 fork 用例 + 13 条 buildInitialInput)是**三层迁移遗留 stale**(commit 6bc59268 已立项重写),stash 基线实测同样红 → 非本次回归。

---

## 8. 其它注意点(⚠️ things to watch)

- **日记别变成新污染源**:必须 `cat`-then-append + **只记新**(一件事一条,已写过的别重复);否则日记每压缩一次就重抄一遍,语料又肿回去。dedup 是硬要求。
- **压缩必须能完成 —— ✅ 已根治(§7.6)**:MAX_TURNS 到顶兜底提交,cutoff 永远推进,压缩绝不因写日记卡住。
- **冷启动**:剔掉存量后语料先变空(尤其日记),召回会先静默,靠之后每次压缩把宫殿一点点养起来。因为现在是 **shadow-only 不投递**,冷启动期无害,正好观察养料速度。
- **fork 预算 / 延迟**:写日记占 fork 的 exec_command 轮次;已提 MAX_TURNS 到 18 并加「留一轮收尾」护栏,引导仍要紧凑,别在压力帧过度发挥。
- **admin 预览端点同源**:`modules/admin-panel/backend/src/routes/agent-runtime-routes.ts` 里有一份重复的收录/阈值口径(P2 已同步 standoutMargin 0.25 / nearDupSuppress 0.95),改收录策略时一起核。
- **A 漏残留**:A/B 审计里还有 ~8.6% 多表示 A 漏(同内容经 inbound/file 另一表示没被 20 项语义窗排除)。修法是把语义排除扩到全在场向量集 —— 已设计未实施,和本方案独立,可后置。

---

## 9. 落地顺序 + 验收

1. **先对齐 prompt 同事**:§5.1 提醒草稿 + §5.2 skill 改法定稿,确认字节稳定(§6)。
2. **代码面(§7)**:前瞻索引闸(§7.1,已落 `cdde9615`)+ action_stream 收敛 + spoken 源 + normalizeRecallText;补/改测试全绿。
3. ~~**reconcile**:dry-run 核对 DELETE/UPDATE 样本 → APPLY 清存量。~~ **搁置**(存量由小腻自迁,§7.5)。见下方 🔴 顺序铁律。
4. **prompt 上线**:reminder + skill 定稿落文件(已落 `1157c087`/`409778fd`)。
5. **构建部署**:先跑 §6 三套缓存用例全绿,再 `docker compose build/up agent-service`;`docker compose ps` healthy。(已部署 2026-07-12,cache_read 暖 47096 无穿透。)
6. **观测(shadow-only)**:
   - 日记是否被压缩养起来(`notes/diary/` cue 数随压缩上升)。**这是下方顺序铁律的解锁条件。**
   - 召回命中的是不是她真记忆(B 相关性)而不是原文。
   - 静默率保持(P2 已到 ~85%),A 不在场不回退。

> **🔴 顺序铁律(交叉 review 挖出的最高业务风险,无代码护栏)**:**绝不能在 `notes/diary/` cue 数被压缩养上来之前跑存量 purge。** 前瞻闸(§7.1)本身安全——它只停止新增非宫殿文件语料,**存量 cue 不回溯删**,当前召回池不受损,文件腿不会立即饿死。但一旦有人先跑 reconcile purge 把那 67k 污染 + ~2000 条真实旧 `notes/<date>/` 记忆删掉,而此刻 diary 仍近空(§2 实测 ~17 条)、动作流腿又是「计划要砍的噪音腿」在临时兜底,**文件腿会瞬间归零**,再靠压缩一点点养要很久。安全默认 = purge 一直搁置,直到 §9.6 观测确认 diary cue 数随压缩稳定上升。**收窄 + purge 的先后顺序是这批唯一的业务地雷。**

---

## 10. 召回功效诚实边界(这套到底能不能让她想起需要想起的事)

链路三道闸,每道有真实天花板 —— **这套是必要不充分**:

- **闸1 · 语料里有没有(生成端,本文档)**:加 review 的 P2 修正(日记也收「念头/担心/没动手的承诺」),覆盖面合理。**最大变量不在路径规范,在 fork 写不写得实**——满足式写一行空日记语料就空,靠 prompt 引导不靠格式保证。
- **闸2 · band-pass 捞不捞得对(召回端,已部署 shadow)**:打分=关联度−在场度。**两个硬顶**:①**结构性盲区**——靠语义相似,捞不到「情境相关但文本不相干」的记忆(她答应楠楠盯考研,楠楠发「在吗」勾不出那条承诺);②刻意保守 ~85% 静默(方向 B 保真),本来就会漏。
- **闸3 · 到不到得了她**:现 **shadow-only 不投递**,今天按设计到不了她眼前,只落评估日志;真投递是 v2 另一步。

**结论**:对「她此刻正处在和某条已写下、已遗忘的经历语义相近的情境」——**能浮**。对「需要想起、但当下无文本线索勾它」(尤其**开放承诺/未闭合的事**)——**关联召回结构上做不到**,得换机制(按时间/状态主动重提,而非语义相似),就是 §11 的第二条腿。

**⚠️ 一个更宽的缺口(交叉 review 2026-07-12 指出)**:北极星「想起干过啥」本就包含**纯情节事件**(不是承诺,就是往事,如「上周修好了发图超时」)。这类事一旦当下语境无文本线索,**语义腿因 cos<floor 结构性捞不到,而 §11 第二条腿只扫 `open-loops.md` 的开放承诺(`- [ ]`),不扫纯事件**——它落在两条腿之间,当前**无任何机制覆盖**。要吃下它,得再加一条按时间/状态(而非语义)重提纯事件的腿,或降低静默率 / 引入 lead 富化。诚实记账:这套现在能可靠达成的是「**语义可勾**的情节召回」,不是「她需要想起的**所有**情节」。

---

## 11. 第二条腿:开放承诺按时间/状态重提(§10 盲区的根治)—— 落地中 2026-07-12

补 §10 闸2 的结构性盲区:「答应了没做的事」当下无语义线索勾不出来,靠**时间/状态**主动重提。

**架构(mirror 第一条腿:persistence + admin-backend,不碰 heartbeat/主 loop)**:
- **状态源**:她维护 `notes/diary/open-loops.md`,`- [ ] 一句话 (M/D)` 开、`- [x]` 闭。压缩提醒 + 记忆锚定 skill 都已引导(承诺当场登记、做完划掉)。
- **纯扫描器**(`packages/persistence/xiaoni-open-loops.js`,已落 + 8/8 测试绿):`parseOpenLoops`(解析开/闭+日期标注)、`parseTagDate`(M/D 按 nowMs 年推断、未来则回退去年)、`selectStaleOpenLoops`(挑开着·搁置≥staleDays·未近重复·按最久优先·limit 截断)。纯函数,nowMs 由调用方传,零时钟依赖。
- **编排 + 触发**(`admin-panel/backend/.../xiaoni-recall-reindex-service.ts` 的 `scanOpenLoopsToShadow`,搭 reindex 顺带跑,try/catch 吞错不拖垮语料):读文件→选搁置久的→查最近 30 条 open_loop shadow 去重→写 `xiaoni_recall_shadow_log`(`query_ref='open_loop_scan'`,surfaced 带 `kind:'open_loop'`+lead)。
  - **触发实况(勘误)**:`reindexXiaoniRecall` **唯一入口是手动 POST** `/xiaoni/passive-recall/reindex`(admin 管理端「重建」按钮),**全仓无 cron/interval/timer**。所以第二条腿目前**只在有人手动点重扫那一刻跑一次**——「按时间盯着」这个卖点在有自动节律之前并不成立。之前写的「周期性 reindex」是措辞上的一厢情愿,已勘误。
- **投递**:**shadow-only**,和第一条腿一致,只落库不投递。**诚实记账**:因此这条腿当前对「别让小腻忘了答应的事」这个业务目标的**实际达成度 = 0**(她永远看不到 shadow_log)。现在证明的是「这套挑法能挑对」,不是「她真的没忘事」;后者要等投递 + 自动触发 + 她真在写这三件都到位。

**参数**:staleDays=2、limit=3、dedup lookback=30。**验证状态**:纯扫描器 8/8 绿;admin-backend 编排 `docker compose build admin-backend` **已过**(tsc clean,§7.1 前瞻闸同镜像一起编译过);新增 persistence 文件已补进 3 个 Dockerfile COPY 白名单。

**交叉 review 挖出的已知短板(2026-07-12,shadow-only 无 live 影响,投递前一并修)**:
- **无日期 = 永久隐形(反讽 bug)**:`parseTagDate` 返回 null 就不浮。这条腿本为「别让她忘事」,但她登记时忘了打日期(便签极可能),那条承诺对第二腿就永久隐形——最该兜的健忘恰在源头被静默丢。修向:无日期项按「已见但长期未动」的 seen-count 兜底浮一次,而非直接吞。
- **oldest-first 饿死中龄承诺**:排序严格按最久优先 + limit=3 + 只有 `[ ]`/`[x]` 两态(无「放弃/归档」),一条百天老的死承诺长期霸榜前 3,搁 3–10 天、真正还救得回的新承诺挤不进。修向:加「放弃」态或对超龄项衰减降权。
- **时区轻微失真**:`parseTagDate` 用 UTC 零点、`nowMs` 是真 UTC,而她的「今天」是北京 wall-clock(+8h),age 在阈值边界几小时会差一天。非功能 bug,但 lead 的「放了 N 天」会略失真。

**待续(按重要性)**:①【决定性】投递 channel —— 且必须走一次性、非持久、可从 replay 剥除的 non-durable 通道(同 MEMORY `xiaoni_plan one-shot evict`/D-strip),否则 open-loop 提醒随时间/条目变化会击穿主/fork 缓存(双缓存铁律),不是翻开关。②【同等致命前提】她到底写不写带日期的 open-loops.md —— 空或无日期则扫出来是空。③自动触发节律(cron/heartbeat),现在连 shadow 观测都不连续。④admin 管理端展示 open_loop shadow。⑤修上面三个已知短板。
