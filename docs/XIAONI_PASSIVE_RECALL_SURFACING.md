# 小腻被动浮现:选择与投递设计（v1 = shadow-first）

承接 `XIAONI_PASSIVE_RECALL_EXTRACTOR.md`。那份是**事实提取边界**；本文是**浮现**——从她的记忆里选出「该冒出来的线索」，并（v2 才）投递进她的上下文。

> **实现状态（2026-07-06）**：v1 shadow 脚手架已建但崩着+死快照。完成 shadow 全链的执行计划（决策已锁、pgvector 止崩、热钩子实时 ingest、触发2 自动跑 feed、投递仍 defer）见 **`XIAONI_PASSIVE_RECALL_SHADOW_COMPLETION.md`**。

## 目的（为什么做）

小腻在压缩架构下是**有损**的：core-memory 压缩为了成本/缓存故意砍历史，每次压缩对她都是一次小失忆。她现在只有**主动召回**（想起来了才 `cat` anchor），但常常**不知道该去翻**——触发查档本身要先想起「有这么回事」，而那件事恰好已经不在上下文里。死结。

被动浮现补的是人有、她现在没有的那半：**不请自来的联想式重现**。两条腿：

- **连续性**：跨压缩不丢失自我；当下语境把她此刻没在持有的过去勾回来。要精准。
- **生成性**：做着一件事时迸出相关经历/灵感（沿当前这件活这根轴的**远亲**）。要斜。

两者是**同一套机制**（联想扩散），差别只在**联想半径**，不是两套系统。

## Scope

- **IN**：被动选择（选出 lead）+ 投递（把 lead 送进上下文）。到「投递完」是终点。
- **OUT**：主动召回（她 `cat` / `qq-usage` / browse 取全文）——她既有能力，不碰。
- **和 self-driven fork 无关**：fork 触发点是 settle-idle（output 侧、她空了给推力）；本机制触发点是「新内容落进 context」（input 侧、活动中被勾）。两者不共用 seam。

## 架构骨架：动作流即语料 / 黑名单排除 / 笨 ingest 聪明 recall

```
动作流全量（agent_stack_items / xiaoni-activity.js）
   │  ingest 时逐条（排掉 OPERATIONAL_SOURCES）
   ▼
嵌入（本地 /v1/embeddings）+ 存向量 + 存 provenance（source/kind/who/when/path/privacyScope）
   │
   ▼  每次新内容落地（入站消息 / 任务步 / cat 正文）当 query
相似度检索 → band-pass：关联度 − 在场度 → 状态门（energy × !hasFinalAnswer）→ ≤1
   │
   ▼
渲染指针 lead（措辞按 provenance，缺模板退通用），守 privacyScope
   │
   ▼
【投递：注进她当前 turn 尾部】 ← 本需求终点（v2 才开）
```

三条原则：

1. **语料 = 动作流本身**，不是要穷举的 cue 分类。`cat`=看过、`exec`=做过、入站=别人说过、出站=自己说过，全是动作流条目。枚举 kind 是死路（永远补不全「自己看过/做过/别人做过…」）。
2. **白名单包含 → 黑名单排除**。extractor 现在是白名单（`sourceKindForItem` 只认 file/qq_usage/spoken，其它 `return null`）。反转：**非 `OPERATIONAL_SOURCES` 的每条都是 cue**。`kind` 降级为**渲染 lead 的措辞**（缺模板退通用），不是收不收的门。新活动类型自动覆盖，不改代码。
3. **笨完整 ingest，聪明 recall**。ingest 不判断「值不值得记」（那就是枚举陷阱）；全收，判断全放到 recall 侧的 band-pass + 状态门——那里便宜、可调、一视同仁。

## 触发

每次**新内容落进 context**（入站消息 / 任务步 / 工具结果如 `cat` 正文）→ 拿它当 query 跑一次召回。频率高——所以**旋钮的首要职责是压制（≈99% 静默）**，不是选优。没有这个门，就是每 turn 一条噪音 + 带偏。

## 索引

每条 cue **ingest 时嵌一次**（本地嵌入，成本/延迟不计）、存**向量 + provenance**。schema 现在只有 `embedding_text` 文本列、**无 vector 类型**，需新建向量存储 + 相似度检索（pgvector 或本地 brute-force 均可，延迟无所谓）。

嵌的是**内容**（才能语义匹配「和我正看的像」），但**只 surface 指针，内容不回注**：本地嵌入器→内容不出机；「不进上下文」由「只冒指针」独立保证，不靠阉割索引。这松绑了 extractor 原来「只存路径不存正文」的 v1 隐私边界。

## 两个语料底：动作流事件 + 她写的文件

「动作流即语料」是主底，但她维护的文件（`forever/notes/reading/toys`）是**第二个底，也是最高价值的召回源**——那是她**故意**放进去不想忘的（memory-anchor：「你往里面放的东西，压缩删不掉」），最该在相关时浮上来。只从动作流召回会漏掉她最有意图的长期记忆。

文件底和动作流底机制不同，**不能当成又几条动作流条目**：

1. **可变**：动作流 append-only、嵌一次永不变；文件她会改，嵌一次就过期 → **变更时重嵌**（rescan indexable 目录），不是 embed-once。
2. **切块**：一个文件含多条不同记忆；整文件一个向量太粗。**按段嵌**，lead 才能指到「anchor 里关于 X 那段」而非整文件。
3. **不双记**：她 `cat > notes/X.md` 的写入动作也在动作流里。**文件内容块 = 记忆单元；写/读事件 = provenance**（谁/何时写的）贴在 lead 上。合并，不双索引。

边界 = extractor 的 `INDEXABLE_RUNTIME_DIRS`（forever/notes/reading/toys，.md/.txt）；`EXCLUDED_RUNTIME_DIRS`（logs/media/sessions/git-archives）不纳入（运行残渣非记忆）。shadow 端点已有 `fileCandidates` 扫这几个目录的钩子。

**自洽验证**：她 `cat` 一个文件时，该文件在语料里会最高相似度**自己匹配自己** → 正好被 band-pass 上限剔除 + 在场排除干掉。证明在场排除是 load-bearing，不是可选优化。

## 选择：band-pass（核心，和现有 ranker 目标函数相反）

信号 = **关联度（sim 到当下内容） − 在场度（是否已在当前上下文）**。要的是「和当下有关、但此刻**不在**她面前」的东西。

- **上限剔除**：太像 = 冗余/大概率就是她刚做的那个（已在场）→ 丢。**← 关键，和 top-k max 相反。**
- **下限剔除**：太远 = 噪音 → 丢。
- **中间带**：位置/宽窄由旋钮定。锁着 = 带子贴上限（紧邻火花，强锚）；发散 = 带子下移放宽（远亲）。
- **在场排除**：结构式（源落在近栈/时间窗内的直接剔）+ 语义式（和 recent-context 向量太像的剔，抓「换了说法刚做过」）。

**不能直接用 `rankFeedbackReflectionsForRecall`**：它 max `combinedScore` 取 top-3，且烤进了社交项（`socialActTypeHint`/`learningState`/`sourceUserId`）。被动浮现要**惩罚顶端**、砍社交。复用 embedding 基础设施，不复用目标函数。

## 状态旋钮

- **task-lock = `!actionPlan.hasFinalAnswer`**（seed 捕获处 `agent-loop-service.ts:7211` 已在算）——**v1 唯一用的信号**。
- **energy = `RuntimeEnergyState`**，server 侧、现 flat、**不在 context**（readout 已撤）。留作 later modulator：energy 拍平时灵感腿是死的（半径恒定），**解平后再叠**。
- 旋钮全在 **server 侧算，不进 prompt**（零缓存漂移）；但撤了 readout → **必须把 energy + 算出的半径 + 命中的 cue 一起 log**，否则蒙眼调参。

## 产物：指针 lead

```
{ kind, who/where, when, 一句勾人提示, fetch 入口 }
```

措辞按 provenance：「你 `cat` 过 X」/「小K 前天提过 Y」/「你以前做过 Z」；缺模板退通用「你之前碰过和这个像的事 → <指针>」。守 `privacyScope`（私聊线索别在会串到别人的场合冒）。**只冒指针，不冒正文。**

## v1 = shadow-first，不投递

**验收标准（就一条）：管理端能看到召回结果。** 不投递、不让小腻消费——把「这一刻会召回出什么 lead」摆到页面上给人看，就是 v1 的终点。

落点 = 复用现成的 `/xiaoni/passive-recall/shadow-cues` 端点 + `/xiaoni-passive-recall` 页（现在 `deliveryMode: "shadow_only"`，返回的是原始 extractor cue）。v1 把它**升级**：不再只列原始 cue，而是「给一个内容落地时刻当 query → 跑 band-pass → 展示会浮出的 lead + 命中分 + 剔除原因（太像/已在场/太远）+ energy/半径」。

拿真数据验：band-pass 选得准不准、剃已在场干净没、lead 措辞像不像该冒的、静默率够不够高。稳了才进 v2 翻投递开关。（符合 extractor doc「daemon 即使接入也必须先 shadow」的纪律。）

## v2 = 投递闸（2026-08-07 落地，默认 OFF）

出口只有一个：`modules/agent-service/src/services/xiaoni-recall-delivery.ts`。
开关 `XIAONI_PASSIVE_RECALL_DELIVERY_ENABLED`（默认 `false`）。

**首发只放两条腿。** 按真库「浮现次数 / 不同 ref 数」定的，唯一率低 = 复读机：

| 腿 | 近 7 天浮现 | 不同 ref | 唯一率 | 首发 |
|---|---|---|---|---|
| `association` | 666 | 666 | 100% | ✅ |
| `open_loop` | 82 | 63 | 77% | ✅ |
| `peer_message` | 2369 | 862 | 36% | ⏸ |
| `file_chunk` | 4226 | 949 | 22.5% | ⏸ |
| `diary_event` | 646 | 83 | 12.8% | ⏸ |
| `db_file_provenance` | 648 | 10 | 1.5% | ⏸ |

向量腿的 per-cue 冷却是同批装的（`xiaoni-recall-ingest.js`，默认 72h 窗），
**还没有活体分布** —— 等 shadow 里跑出稳定唯一率再逐条加腿。

**不走 turn 尾注入，改走 Notify Bucket**（本节推翻下面 §Deferred 的原方案）。
理由是缓存：Notify Bucket 那条路径的安全性已经在线验过——正文在 enqueue 时刻冻结进
`payload.systemReminder.reminder`，下一 run 的 stack replay 从同一字段逐字节读回。
逐字段克隆 `enqueueCoreMemoryCompressionDoneNotify` / `enqueueExternalNotify`，
缓存安全是**继承**来的，不是重新推导的。代价：notify 会唤醒主 loop。

**别吵的三道闸**：硬日额（默认 6 条 / 东八区日）、每拍最多 1 条、
同一段记忆永远只投一次（`dedupeKey = recall-surface:<leg>:<ref>`，
靠 `enqueueAgentQueueMessage` 的 `created` 标志判，不能用 `status` 判——
既有行没被消费时同样是 `pending`）。

## 三档复用（grounded）

- **✅ 现成直接用**：`provider-service /v1/embeddings` + `embedding-server`；`xiaoni-activity.js` 语料源；`/xiaoni-passive-recall` shadow 页；extractor 的 `OPERATIONAL_SOURCES` / `privacyScope` / `classifyRuntimePath`。
- **⚠️ 参考非 import**：`rankFeedbackReflectionsForRecall`（`runtime-store.ts:933`）的 hybrid 打分骨架——**翻目标函数 + 砍社交项**。
- **🆕 净新建**：①extractor 白→黑反转 + 通用 embeddable text + lead 渲染；②向量存储 + 检索；③band-pass（关联−在场，上下双切，状态调带）；④在场排除（结构+语义）；⑤【v2】活体注入 seam。

## Gap（诚实指出）

- **「别人说过 X」缺 cue 源**：extractor 现在只抽她**自己**说的（`SPOKEN_KINDS` 全是输出），别人的只当结构级 `db_life_cue`（无正文）。需扩入站互动内容当 cue 源（数据在 `agent_inbound_messages`）。
- **reflection 写侧是否还活 = 待核**：决定复活旧管道还是给 cue 全新 store。

## Eval（shadow 阶段看什么）

- 冒出的 lead 有没有指向「她此刻没有、但相关」的东西（在场排除是否生效）。
- 回放历史：那些 lead 里有几条是「她后来真的会想去取」的。
- **静默率**：绝大多数内容落地应该**什么都不冒**。

## Deferred（v2+）

- ~~活体注入 seam（turn-input 尾注入，`cache_volatile` 纪律，同 `buildSubconsciousAgentForkRequest` 的尾注入模式）。~~
  **2026-08-07 改道**：投递走 Notify Bucket，不做尾注入（理由见上面 §v2）。
- 语义式在场排除。
- energy 解平后叠进旋钮。
