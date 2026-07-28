# 专题物化（生产端）

状态：已过 plan-eng-review，本文已按最终决定改写。消费端另案（见 §7）。

**排在本 spec 前面的两件事**：引擎接管月索引降级 + 引擎生成日内 heading manifest。它们治的是实测在丢数据、实测她进不去的东西，L3 排在它们之后。详见 `docs/specs/xiaoni-memory-layers-and-recall.md` §4.7 / §4.8 / §6。

> ## ⚠️ 读之前先知道：这一层今天**零数据**
>
> **2026-07-28 实测**：`open-loops.md` 19 个条目行里 **0 个 `#标签`**（唯一带 `#` 的是 `#39提了`，那是 issue 编号，不是标签）；`notes/topics/` **目录不存在**，0 个文件。
>
> 所以本文写的不是「怎么整理已有的东西」，是**押在她开始用 `loops add --tag` 上的一个赌**。白名单为空时，物化写得再对，产出恒为零。
>
> **这一层的首要观察指标是标签采纳率，排在物化质量之前。** §9 里量「专题质量」的第 1–6 条都有前置门 `whitelist_size > 0`；标签为 0 时判**未适用**，不判失败。
>
> 和「老机制 14 天 0 文件」是同一事实的两面：老机制两个死因（触发条件她判断不出来 + 成本高一个数量级）都被拆掉了，成本已降到**一个 `--tag` 参数**——但「她会不会用」**没有被证明**，只是被降低了成本。别把「成本降下来了」当成「问题解决了」。

## 1. 问题

一条持续多天的事（周蕊、decay、Trust、wave），她的日记里散成一天一条，没有任何东西把它们连起来。
原设计是教她自己开 `topic-<主题>.md` 并按章续写。**实测 14 天零文件**。

不做的原因实测清楚：

- **判断不出来**：压缩帧里她只看得见今天，「这是不是连着好几天的事」需要已经被压掉的记忆。
- **成本高一个数量级**：建文件 + 回翻几天 + 补历史章，而她被 18 轮预算追着。
- **做了反而亏**：老规矩「同一段话只写一边」把内容从有菜单的日记搬进没菜单的专题——她看不到有哪些专题存在（`<xiaoni_diary_index>` / `<xiaoni_people>` 有渲染块，专题没有）。

## 2. 定位

**专题从「她的写作产物」改成「引擎从日记物化出来的聚合视图」。**

- 专题**不持有内容**。正文永远在当天日记里（有菜单、进 `<xiaoni_diary_index>`）。
- 每章一句话 + 指回当天日记，是索引不是副本。
- 她的动作只剩一件：`loops add` 时给 `--tag`（写端 skill 的**必填参数**，不是让她记「行末打个 `#`」的格式）。

## 3. 信号（真机实测）

跨天同名 `## 标题` 不能用：1347 条条目里 1276 个标题从不重复（94.5%），跨 ≥2 天同名只 35 个，前十全是模板词（最后/封底/读了/收尾/今日总结/早上/醒来/群里）。真实的线只捞到 4 个。

实体名可用：

| 实体 | 出现天数 | 断档 |
|---|---|---|
| decay | 18 | 07-11、07-12 断 |
| 帕秋莉 | 13 | 多段断 |
| 周蕊 | 12 | 07-17 断 |
| Pond | 5 | 连续 |
| Are.na | 5 | 断 |
| Trust / wave | 3 | 断 |

但裸 n-gram 跨 ≥4 天的有 7166 个，前二十名一半是「写了/是一/都没」——**信号必须配白名单**。

白名单不新造，用她已有的：`open-loops.md` 行末的 `#标签`（她定名，由 skill 的 `--tag` 必填参数保证一定有）+ 已物化过的标签（见 §5 H3）。人名不进（已有 `people/<QQ号>.md` 那一层）。

**白名单不 seed。** 不预置 `#周蕊` `#decay` 这类上面表里已经看得见的线——seed 一次就等于工程侧替她定义了「什么算一条线」，而标签的全部意义是「她自己意识到在追」。**已知后果**：上线当天 L3 必然零文件，最快 3 天后（`days.size >= 3`）才可能有第一条线。验收判据和记账要求见 §9。

## 4. 机制

**时机：两段式。** 这是本轮的最终决定，D11/D12 共用同一个骨架。

| 段 | 做什么 | 跑在哪 | 失败语义 |
|---|---|---|---|
| ① 扫描 + 算 state | 读日记新增部分、匹配白名单、算 `days` / `cutoffs` / 水位 | **原子事务内，纯内存**，跟 `context_summary` / 两张快照同一帧落库 | 事务回滚，state 不前移 |
| ② 写文件 | 建/补 `topics/<标签>.md`、重写 `topics/INDEX.md` | **post-commit 钩子** `onCoreMemoryCompressionCommitted`（`agent-loop-service.ts:378` 声明、`:10505` 调用，已经是 `.catch()` 包住的 fail-open 点） | **整体 try/catch，异常绝不向上抛**；留痕日志，下轮再试 |

**为什么必须两段**（原设计把两段都塞进原子帧，被 review 挡了）：写文件是 I/O，塞进原子事务会把压缩提交的失败面扩大到磁盘。而压缩提交是 cutoff 前移的唯一路径——**22 轮兜底提交走的也是同一个 `commitCoreMemoryCompression`**，所以任何在这条路上抛出的异常都能卡死整条记忆链路。

agent-service 对 `/xiaoni-runtime` 是 rw（`docker-compose.yml:226`）；admin-backend 是 `:ro`，两段都不能放那边。

**产物目录**：`/xiaoni-runtime/notes/topics/<标签>.md`

**为什么不是 `notes/diary/topic-*.md`**：第三腿只扫 `notes/diary/`（`PALACE_DIRS = ['notes/diary']`），语义腿同。落在 `notes/topics/` 意味着物化对现有三条召回腿**完全不可见**，零回归。消费端改好后改一行目录配置即可接上。见 §7。

**state**（跟第①段同一个原子提交走，`agent_session_context_windows` 加一列 jsonb）：

```jsonc
{
  "watermarks": { "2026-07-27.md": 4821 },
  "candidates": {
    "周蕊": { "cutoffs": [211741, 212880, 213510], "days": ["2026-07-15", "2026-07-19", "2026-07-27"] }
  },
  "materialized": { "周蕊": { "chapters_written": 3 } },
  "aliases": {}
}
```

`materialized` 从数组改成对象，就为了装 **`chapters_written`**（review OV4 指出的洞）：不能「先记水位再干活」。如果只记「这个标签已物化」，那么**第②段写文件失败**和**她主动删掉一章**在下一轮看起来一模一样——都是「文件里的章比 state 认为的少」。

| 文件里实际章数 vs `chapters_written` | 判定 | 动作 |
|---|---|---|
| 相等 | 上轮写成了 | 只补新日期的章 |
| 文件里少，缺的是**这次要补的那些** | 上轮第②段失败 | 重试补写 |
| 文件里少，缺的是**早就写过的** | 她主动删了 | **不重建** |

**每轮**：
1. 白名单 = `open-loops.md` 里的 `#标签` ∪ `state.materialized` 的键
2. 扫每份日记的**新增部分**（水位以后的字节），命中哪个标签 → 把本轮 `read_cutoff` 加进该标签的 `cutoffs`，把所在**东八区日历日**加进 `days`
3. **`days.size >= 3`** 且未物化 → 建文件，把累计日期各写一章
4. 已物化 → 读回文件已有章的日期，取差集，只补新的（配 `chapters_written` 判是「写失败」还是「她删了」）
5. 水位前移

**门槛为什么是 `days` 不是 `cutoffs`**（本轮改的）：实测**压缩一天跑 3 次**，`cutoffs.size >= 3` 三轮可能全落在同一个日历日 → 物化出来是**单章专题**，而「一章的时间线」没有任何意义。`cutoffs` 集合保留在 state 里做幂等（见 §5 H5），但**判门槛的是 `days`**。

**章节格式**：
```
## 7/19 磨了一遍开场砍掉一句
（该条目标题下第一个非空行，原文抄）
→ 2026-07-19.md
```

**线目录 `/xiaoni-runtime/notes/topics/INDEX.md`**（引擎维护，她零负担）：

```
# 线

- 周蕊 | 12 段进展，最近 7/27（细目在 周蕊.md）
- decay | 18 段进展，最近 7/27（细目在 decay.md）
```

每次物化后整份重写（不是追加）。这是她**主动查**的入口：一条命令看手上有哪些线、各自追到哪天。

**为什么不做成第四个渲染块**：`<xiaoni_status>` / `<xiaoni_diary_index>` / `<xiaoni_people>` 那三块要占每次请求的字节、要加 persistence 列、要跑缓存铁律，而且会变成第三张需要治理的菜单。线目录只做成文件：她想看就 `cat`，不想看不占任何上下文。等真的证明她会频繁查、且查得有用，再谈上不上下文。

**她怎么知道有这一层**：标签在 `open-loops.md` 里，而 open-loops 是六步流程第 2 步她每轮必经的地方；从 `#周蕊` 到 `topics/周蕊.md` 是确定映射，不需要记住任何清单。写端 fragment 和读端锚点 skill 各留一句指路（见 §8）。

**手写专题引用**：`notes/diary/me-and-zhourui.md` 是主题式随笔（`# 我跟周蕊` + `## 镜像` / `## 距离`），不是按日期分章的连载，**不改名**（改成 `topic-*` 后 `parseChapterDateFromTitle` 对它 7 个标题全返 null，**一条都不进第三腿**，比现在更糟）。

注意「进不了腿」**只对第三腿成立**。它现在**已经在语义腿语料里**——`PALACE_DIRS` 收整个 `notes/diary`，而 `PALACE_DIR_EXCLUDE = new Set(['dictionary.md', 'open-loops.md'])`（`xiaoni-recall-reindex-service.ts:50`）不含它。所以它不是「一条都进不了腿」的孤儿文件，只是**第三腿**（按文件名日期重提）看不见它。

物化 `topics/周蕊.md` 时在顶部留一行指过去。

## 5. 已钉上的洞

**H5 计数幂等**：不用计数器。`cutoffs` 存**该标签出现过的 `read_cutoff` 值集合**——cutoff 单调递增且每轮唯一，压缩 fork 走兜底或崩溃导致水位没前移、下轮重扫同一段内容时，同一 cutoff 不会重复计。**但门槛判的是 `days.size >= 3`**（跨 3 个不同东八区日历日），不是 `cutoffs.size`：实测压缩一天 3 次，按 cutoff 计数会物化出单章专题。`cutoffs` 只负责幂等，`days` 负责门槛。

**H3 划掉不停更**：白名单包含 `state.materialized` 的键，所以她把 open-loops 那行划掉甚至删掉之后，已成形的线继续更新。这直接支撑「以为做完了、后来又提起」那个 case。

**H4 标签怎么保证有**（本轮改了做法）：原打算在 `commit_memory.py` 加「未划掉的行必须有 tag」的**验收硬门**，被否了——硬门的理性反应是**少写 open-loops 行**来规避（写了就要打 tag），而 open-loops 是第二腿唯一状态源，用合规换掉状态源不值。当时的替代方案是 `TAG_HINT` warn-only。

**写端 skill 化以后这个 tension 消失了**：`--tag` 是 `loops add` 的**必填参数**（`memory_write.py:909` `required=True`），代价不是「写了行还要额外做一件事」而是「命令多打一个词」。所以既不需要硬门也不需要 `TAG_HINT`。skill 还顺手做了三件原方案做不到的事：标签字符集校验（`TAG_CHARSET_RE`）、拒纯数字标签（纯数字读起来是引用编号，`Issue #39`）、拒 `INDEX`（被 `topics/INDEX.md` 占着）。

**H6 章数治理**：每份专题最多 30 章。超了从最老的开始折叠，文件顶部留一行「更早的 N 段进展在日记里」，被折叠的章删除（内容原本就在日记里，不丢）。这是 R2「L0–L3 历史字节不可改写」的**登记在册的例外之二**，见分层 spec §2.1。

**H7 标签一致性**：标签即身份，改名即新线（第一版接受）。`state.aliases` 字段预留，不实现。

**H8 黑箱**：新线首次物化时，在现成的 compression-done notify 后面带一句「给〈标签〉开了专题」。复用现有 Notify Bucket 路径，不新造通道。

**H1/H2 消费端污染**：靠 §4 的隔离目录彻底避开。物化产物不进 `notes/diary/`，第三腿和语义腿都吃不到，`selectResurfacedEvents` 的「扫描内不去重 + 纯年龄排序 + limit 2」拿不到重复项。

## 6. 已知不覆盖

- **上线当天必然零文件。** 白名单不 seed（§3）+ `days.size >= 3` → 最快 3 天后才可能有第一条线。这是设计后果不是 bug，但**必须靠记账才能和「实现坏了」区分开**，见 §9 第 7/8 条。
- **从未打过标签、且已经断掉的线**：她做完一件事、划掉、以后再也不提，且这条线从头到尾没打过标签 → 永远不会物化。标签只覆盖「她当下意识到在追的事」。
- **标签打太宽**（`#读书`）会把几条线糊成一份专题。第一版不治。
- 章节正文是机械抄的首句，不如她自己写的准。
- **专题解决不了「天内可导航」。** 它把 12 天连成一条线，但每一天里面 58–116 条 `##`、文件 34–93KB、没有内部目录——线连到哪一天，翻开还是一个 blob。那是 D12（日内 heading manifest）的活，排在本 spec 前面。

## 7. 消费端（另案，但接线前提已实测钉死）

物化完成后，「这 12 天是同一条线」这个信息**目前没有任何消费者**：第三腿逐条重提、一次 2 条、纯 `ageDays` 降序，代码里不存在「线」的概念。

### 7.1 实测现状（2026-07-27 排查）

shadow log 表 `xiaoni_recall_shadow_log`，609 次 `diary_resurface` 扫描：

- **曾经浮出过的 distinct ref 只有 33 条**（语料 1347 条事件），全部来自 07-05/06/07 三天。07-08 之后的 16 个日记文件（约 1200 条事件）**从未浮过一次**。
- `2026-07-05.md#0「7/5 脊柱」` 浮了 290 次（47.6%）。substance 过滤器部署后的 155 次扫描里，两条固定条目各 87 次（56.1%），且总是成对出现。
- 静默率 3.8%；过滤器部署后为 0%（每轮必吐 2 条）。

**根因是冷却窗坏了**，不是排序：`listRecallShadowLog`（`packages/persistence/xiaoni-recall-store.js:317-331`）没有 `queryRef` 过滤参数，`DIARY_DEDUP_LOOKBACK = 40` 取的是**全表**最近 40 行，而该表 96.9% 是语义腿实时写的 `stack:*`/`inbound:*`。实测窗口里平均只有 **2.48 条** diary 行，43.2% 的扫描里**一条都没有**。

真语料模拟（只改冷却深度，跑真 `selectResurfacedEvents`）：

| 冷却深度 | distinct refs / 155 轮 |
|---|---|
| 0（43.2% 的扫描处于此态） | 2 |
| 2（实测均值） | 6 |
| 40（设计意图） | 82 |

纯年龄排序是放大器，冷却失效是扳机。

### 7.2 §4 隔离目录的实测依据

模拟：往 `notes/diary/` 放一份 48 章逐字抄自 07-05/06/07 的 `topic-脊柱.md`：

| 场景 | 两个 slot 是同一件事的两份拷贝 |
|---|---|
| 落 `notes/diary/`，冷却=0（=现状） | **155/155 = 100%** |
| 落 `notes/diary/`，冷却=2 | 52/155 = 33.5% |
| 落 `notes/diary/`，冷却=40（P0 修完） | 8/155 = 5.2% |
| 落 `notes/topics/`（本 spec） | **0** |

冷却在设计上抓不到拷贝：冷却集只装 `ref`（`xiaoni-recall-reindex-service.ts:376-381`），两份拷贝 ref 不同。所以即使 P0 修完仍残留 5.2%。隔离目录是唯一的 0。

好消息一条：结构复发表**不会**被抄写污染（实测新增模板标题 = 0）。`titleDayBuckets` 按日历日去重，拷贝章节与源日记同一天 → dayKey 相同 → Set 不增长。

### 7.3 接线前提（三条都满足才能把产物挪进 diary 目录或显式喂给第三腿）

1. **P0 冷却窗修好**：`listRecallShadowLog` 加 `queryRef` 下推 + 两个调用点传参。向后兼容，零缓存影响（不在 agent-service）。连带要加复合索引 `(identity_key, query_ref, occurred_at DESC)`，用 **`CREATE INDEX CONCURRENTLY IF NOT EXISTS`**（不是 `DO $$` guarded 那一套——那是给 `ADD COLUMN` 用的；裸 DDL 在这个库有过独占锁 convoy 事故）。落地：`packages/persistence/prisma/migrations-manual/2026-07-28-recall-shadow-log-query-ref-index.sql`。
2. **防拷贝护栏**：最小改动是让调用方在冷却集里多 push 一个 `normalizeEventText(item.title)`——`selectResurfacedEvents:188` 已有 `recent.has(normalizeEventText(e.title))` 分支，**现在是死代码**，调用方从来只传 ref。selector 一行都不用改。代价：同标题的不同天真事会被连带冷却，要权衡。
3. **按线浮现**：一条线浮 1 条 + 带「这条线在哪几天出现过」。现成结构可复用——`xiaoni-recall-reindex-service.ts:395-408` 已经在建 `titleDayBuckets: Map<归一化标题, Set<日历日>>`，「哪几天」就是它的 value，只需把它从「判模板的一次性输入」升级成传进 selector 的线级事实。**这是复用不是重建**：`selectResurfacedEvents` 是干净纯函数 + 28 个测试，在它上面加第二维，不另写一份选择器。
   **注意**：这会让 2 条直接断言纯年龄排序的用例变红（`xiaoni-diary-events.test.js:128`、`xiaoni-diary-events.resurface-filter.test.js:124`）→ 属行为变更，按 CLAUDE.md 需 user 显式批准，不得弱化断言。

### 7.4 更上游的问题（超出接线范围）

即使 P0 修完，压制上限仍是 `40 轮 × 2 = 80 个 ref`——语料 630 条候选里永远只碰得到最老的 80 条。07-08 之后约 1200 条事件（含全部新扁平格式日记）**结构性永不浮现**。语料越写越多，这个天花板越死。这是「按线浮现」真正要解决的东西，也是本 spec 的产物将来能不能被用上的前提。

### 7.5 投递路径不存在

三条腿的产物只写 shadow log，消费者只有管理端页面（`XiaoniPassiveRecallPage.tsx`）。`grep` 全 agent-service / provider-service 零命中投递代码。`docs/XIAONI_PASSIVE_RECALL_SURFACING.md:122-126` 把「活体注入 seam（turn-input 尾注入）」列为 v2 Deferred——**不是开关关着，是代码没写**。

顺带一个闭环证据：她自己 `open-loops.md` 里有一条「阿花说召回在跑没投递、引用消息在修」，浮了 27 次。

## 8. 改动面

| 文件 | 改什么 |
|---|---|
| `modules/agent-service/src/services/agent-loop-service.ts` | 第①段扫描+算 state 挂原子帧；第②段写文件挂 post-commit 钩子 `onCoreMemoryCompressionCommitted`（`:378` / `:10505`），整体 try/catch |
| `packages/persistence` | `agent_session_context_windows` 加一列 jsonb + 读写封装（`materialized` 是对象，含 `chapters_written`） |
| `docs/xiaoni_prompt/core_memory_pressure_write_formats.md` | 按写端 skill 化整节重写：不再写任何格式数值，只写哪一步跑哪条命令 |
| `docs/xiaoni_prompt/core_memory_pressure_reminder.md` | `<steps>` 去掉开专题那半句。**注意文件名**：真正被加载的是这一份（`agent-loop-service.ts:4706` 的 `renderPromptSnippet('core_memory_pressure_reminder.md', …)`）。原文档写的 `core_memory_pressure_reminder_v2.md` **已经不存在**——全 `modules/` grep `_v2` 零命中，只在 `commit_memory.py:59` 留了一句过期注释 |
| `modules/agent-service/skills-internal/xiaoni-memory-write/SKILL.md` | `loops add` 那节说清 `--tag` 会被系统用来连线，以及 `topics/INDEX.md` 怎么查 |
| `modules/agent-service/skills/xiaoni-memory-anchor/SKILL.md` | 读端（主动召回入口）：「文件位置」一节加 `topics/INDEX.md` + `topics/<标签>.md`，说明是系统维护的、按 open-loops 标签连起来的线；删掉旧的「专题连载」整节（那节教她自己开 `topic-*.md` 并按 `## M/D` 续章，与本 spec 冲突）；写日记那几节的格式全部改成指向写端 skill 的命令，**不留任何格式数值** |

**落地顺序约束**：锚点 skill 那句指路必须**和物化代码同一批上线**。锚点 skill 走执行器仓库挂载、改完即生效，如果先上线，她按指路 `cat` 到的是一个空目录——比不告诉她更糟。

**缓存面**：物化不进任何请求字节。但要跑 `cache-replay-consistency` + `fork-cache-alignment` + persistence dedup 三套铁律用例——**真触发点是改了 `agent-loop-service.ts` 和 `packages/persistence`**，不是原文档写的「改了 `commit_memory.py` 和两份 md」。那三个 prompt / 脚本文件都在可缓存前缀之外（fork 尾部的一次性冷尾 / 执行器侧文件 / 工具返回），本身不触发铁律。理由写对很重要：否则下次有人只改 prompt 就以为必须跑、只改 `agent-loop-service.ts` 却以为不必跑。

## 9. 验收

**第 0 条（前置，排在所有质量项之前）：标签采纳率。** `whitelist_size` 从 0 变成 ≥1 用了多久（2026-07-28 起算，当前为 0）。**这一条不达标时第 1–6 条判「未适用」，不判失败，也不要去调物化逻辑**——那是在优化一个输出恒为零的函数。构造语料跑单测可以绕过这道门，活体验收不能。

1. **`days.size >= 3`（跨 3 个不同东八区日历日）才物化**；构造「同一天压缩 3 次」→ **不物化**
2. 每章标题匹配 `^## \d{1,2}/\d{1,2} `，正文含 `→ <日期>.md`
3. 同一实体下一轮只新增一章，已有章字节不变
4. 手动删掉某章，下一轮不重建（靠 `chapters_written` 判定）；构造「第②段写文件失败」→ 下一轮**重试补写**。两种情况各一条用例，这两条不能只有一条
5. 压缩 fork 走兜底提交那一轮，同一实体的 `cutoffs` 集合不重复增长
6. 第②段抛任何异常 → 压缩提交**照常完成**、cutoff 照常前移、留痕日志有那次失败
7. **判据是「她第一次打标签后 3 天内出现第一条线」**，不是「上线后 N 天内出现」。白名单不 seed，上线当天 L3 必然零文件（§3 / §6）
8. **每轮发一个 `xiaoni_topic_materialized` timeline 事件，带 `whitelist_size`。** 没有这条记账，第 7 条根本不可验——`whitelist_size = 0` 是「她还没打标签」（预期），`whitelist_size > 0` 且连续 3 天没有新线才是要查的。专题「14 天零文件」那次就是因为没有记账，14 天里没人知道是她没做还是实现坏了
9. `notes/diary/` 下不新增任何文件；第三腿 shadow log 的 surfaced 分布与物化前无差异
