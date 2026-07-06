# 小腻被动浮现:shadow 完成实现计划

承接 `XIAONI_PASSIVE_RECALL_SURFACING.md`(设计定案）与 `XIAONI_PASSIVE_RECALL_EXTRACTOR.md`(事实提取边界）。
那两份是**设计**；本文是**把 v1 shadow 全链跑活的执行计划** —— 决策已锁、按相位落地、投递（v2）明确排除。

> 分支：`feat/passive-recall-shadow-complete`（worktree `qq_bot-passiverecall-shadow`，基 `refactor/runtime-gateway` @ e967bd5b）
> DB 铁律：worktree 一律连**主栈 DB**（`qqbot-postgres`），不建 worktree 私有库。

## 0. 现状（为什么要这份计划）

shadow 脚手架搭齐了，但它**死着、还崩着**：

| 事实 | 证据 |
|---|---|
| 语料池扫描击穿 napi | `listRecallCandidates`（`xiaoni-recall-store.js:79`）一次拉 76k 行 × 16KB Json embedding，`findMany` 抛 `Failed to convert rust String into napi string`（实测 30k 行↔512MB 崩点） |
| 语料是冻结快照 | `reindexXiaoniRecall` 是手动按钮；`xiaoni_recall_cues` 76336 行里 `action_stream` 只 6 条、`file_chunk` 76330 条 |
| 投递给她 = 0 | `grep passive-recall modules/agent-service/src` 空；v2 注入 seam 未建 |
| 「别人说过」空腿 | `leadTemplate='peer_message'` 分支存在，但 `agent_inbound_messages`（30754 行）从未进语料源 |

v1 验收标准（设计 §97）就一条：**管理端能看到召回结果**。现在这条是红的。本计划把它做绿，并升级成"每次落地自动跑、按腿分解的浮现流水 feed"。

## 1. 决策（eng review 已锁）

| # | 决策 | 选定 | 备注 |
|---|---|---|---|
| ① 止崩 | **pgvector**，换主栈镜像 | ✅ | `postgres:16 → pgvector/pgvector:pg16`，`vector(768)`，HNSW，band-pass 吃 top-K |
| ② 自动 ingest | **热路径钩子**（实时） | ✅ | 入站→provider-service，动作流→agent-service，护栏见 §3 |
| ③ 入站 cue 源 | **纳入** | ✅ | `agent_inbound_messages` → 复用同一 cue builder，补"别人说过" |
| ④ 语义式在场排除 | **纳入** | ✅ | band-pass 里补"和 recent-context 向量太像也剔" |
| ⑤ energy 旋钮 | **defer** | ⏸ | 现 flat，接了灵感腿也死；只保 task-lock |
| ⑥ 观测 | **必做** | ✅ | energy + 半径 + 命中 cue 一起 log（设计 §85 硬要求） |
| E 触发2 shadow 自动跑 | **纳入** | ✅ | 每次落地自动召回、落库、feed 展示；**不投递** |
| 对账器 | **纳入**（安全网） | ✅ | `reindexXiaoniRecall` 降格为周期性对账，补热钩子 embed 失败的漏记（见 §6 critical gap） |
| ⑧ 投递给她 | **OUT** | ❌ | v2，唯一碰缓存的部分 |

## 2. 缓存立场（重要澄清）

**shadow 阶段对双缓存零影响。** 双缓存只在改动**主 agent LLM 请求的 cacheable 前缀**（system / tools / message history 字节）时会碎。本计划里：

- ① pgvector：全在 admin-backend + persistence + postgres 镜像，碰不到任何 LLM 请求。
- ② ingest / E recall：是**只往 recall 表写 / 只往日志表写的副作用**（`READS agent_stack_items|agent_inbound_messages → WRITES xiaoni_recall_cues / shadow log`）。不改请求体、不 append 进栈 → fork 克隆不受影响、下个 run replay 不受影响。
- 就算钩子放进 agent-service 热路径，ingest-only + fire-and-forget 也不碰缓存；顶多是延迟（性能），不是缓存。

**缓存只在 v2 投递、往 turn 尾注 lead 那一刻才上桌**（届时按 `cache_volatile` 纪律，同潜意识 fork 尾注入）。本计划不含那步。

## 3. 架构与数据流

两个**独立触发**，都挂在"新内容落地"：

```
                      新内容落地（入站消息 / 动作流步 / cat 正文）
                                    │
              ┌─────────────────────┴─────────────────────┐
              ▼                                            ▼
     触发1  INGEST（入库）                        触发2  RECALL（检索, shadow）
     把这条内容嵌入+存进语料库                    拿这条内容当 query 查库，
     → 成为将来能被召回的 cue                      翻出"相关但此刻不在场"的别的记忆
              │                                            │
     provider(入站) / agent-service(动作流)       先查后存（避免自匹配）
     钩子 fire-and-forget，过 buildRecall-        pgvector top-K → band-pass(JS)
     CueFromActionStreamItem 单一 builder           → 渲染 lead
              │                                            │
              ▼                                            ▼
        xiaoni_recall_cues                        xiaoni_recall_shadow_log（新表）
        (embedding_vec vector(768))                 每次落地一条：query / surfaced /
                                                    dropped(太像·在场·太远) / band / provenance
                                                            │
                                                            ▼
                                                    管理端 feed（按语料底分组 + 标 cos/band）
                                                    【不投递给小腻】
```

**pgvector 查询路径**（替代 76k 全量拉取）：

```
listRecallCandidates(queryVector, {excludeSourceRefs, k=300})
  └─ $queryRaw:  SELECT source_ref, provenance, embedding_text,
                        embedding_vec,                       -- ④ 语义在场排除要候选向量
                        1 - (embedding_vec <=> $query) AS cos -- SQL 里算余弦
                 FROM xiaoni_recall_cues
                 WHERE identity_key=$id AND source_ref <> ALL($exclude)
                 ORDER BY embedding_vec <=> $query            -- HNSW 加速最近邻
                 LIMIT $k
  → 返回 top-K（几百行，~1.5MB），不返 76k。band-pass 在 JS 侧吃这 K 条。
```

**为什么 top-K 对 band-pass 语义正确**：band-pass 要"中间带"（剔太像/在场 + 剔太远）。太远的下限剔本就不该 fetch；中间带都落在最近邻里。所以 top-K 最近邻**天然包含**要浮现的带子，`ORDER BY <=> LIMIT K` 拿的正是需要的邻域。

## 4. 数据模型

`XiaoniRecallCue`（`schema.prisma:1800`）加一列：

```prisma
embedding_vec Unsupported("vector(768)")?   // pgvector；Json embedding 列保留当回填源+兜底
```

+ 迁移 SQL：`CREATE EXTENSION IF NOT EXISTS vector;` / `ALTER TABLE ... ADD COLUMN embedding_vec vector(768);` /
回填 `UPDATE ... SET embedding_vec = embedding::text::vector;` / `CREATE INDEX ... USING hnsw (embedding_vec vector_cosine_ops);`

新表 `xiaoni_recall_shadow_log`（触发2 留痕，纯 shadow）：

```
id / identity_key / occurred_at / query_ref / query_text /
band_floor / band_ceiling / silent(bool) / corpus_count /
surfaced JSONB[]  -- [{lead, cos, sourceRef, provenance}]
dropped_counts JSONB  -- {drop_too_similar, drop_too_far, drop_in_context}
```

vector 操作 ORM 表达不了 → `$queryRaw`，但**必须收口在 `packages/persistence`**（CLAUDE.md 硬规），不漏进路由。

## 5. 相位与并行

```
P0  pgvector 止崩          persistence + 主栈DB镜像 + store查询 + 预览路由    ← 阻塞一切
    │
    ├─ Lane A: ② ingest 钩子（agent-service 动作流 + provider 入站）+ 对账器
    ├─ Lane B: ③ 入站适配（provider，agent_inbound_messages → cue）  ‖ 与 A 同过 builder，同 lane 顺序做
    ├─ Lane C: ⑥ E 触发2：shadow_log 表 + 落地接线 + feed（admin-backend + frontend）
    └─ Lane D: ④ 语义在场排除（bandpassRecall 纯函数）  ← 依赖 P0 的 top-K 带向量
```

A+B 都过 `buildRecallCueFromActionStreamItem`，同模块建议同 lane。C/D 独立可并。

## 6. Failure modes

| 路径 | 失败方式 | 兜底 |
|---|---|---|
| pgvector 迁移（共享主栈 DB） | `CREATE EXTENSION`/回填半路挂 → postgres 起不来 | **先 worktree 连主栈 DB 验回滚** + 协调重启，别 `--remove-orphans` |
| **热钩子 embed 失败（critical gap）** | 落地那刻 embed 500 → 该 item **永不进库**（热路径无重试） | **对账器**：`reindexXiaoniRecall` 周期性 cursor 补漏（不驱动主链，纯安全网） |
| band-pass top-K 全被剔 | feed 空 | ⑥观测 log band/K 区分"真静默"vs bug |
| 触发2 自匹配 | query 内容自己匹配自己 | 先查后存 + 上限剔除/在场排除兜（设计 §68） |

## 7. Test plan

- **回归（钉死已知崩）**：`listRecallCandidates` 在 76k 语料下返回 ≤K 行、恒不炸 napi。
- **回归（缓存保险）**：动作流钩子加进 agent-service 后，`cache-replay-consistency.test.ts` + `fork-cache-alignment.test.ts` 保持全绿，实测相邻 slice `cache_read` 不变。
- **单元**：band-pass 上限剔/下限剔/中间带 + 结构&语义在场排除（合成向量）；pgvector top-K cos 降序 + exclude 生效；入站行→`peer_message` cue；ingest 幂等（同 item 两次→contentHash 去重）。
- **E2E**：embed 500 → turn 不受影响（fire-and-forget 不 await/吞异常）；落地→触发2 跑→shadow_log 写一条。
- **迁移**：可回滚；空/缺 embedding 行不炸。

## 8. NOT in scope

- **⑧ 投递**（把 lead 注进她 turn）—— v2，唯一碰缓存。
- **触发2 结果的投递** —— shadow 只记录+展示。
- **⑤ energy 接线** —— flat，接了也死。
- **语义在场排除高级版**（设计 §123）—— v1 只做基础向量相似剔。

## 9. What already exists（复用，不重建）

`reindexXiaoniRecall`（`xiaoni-recall-reindex-service.ts:150`）· `buildRecallCueFromActionStreamItem`（`xiaoni-passive-recall-extractor.js:448`）· `chunkRuntimeFile` · `embedTexts`（已含逐条降级）· `bandpassRecall` · `renderRecallLead` · shadow 端点 `/xiaoni/passive-recall/*`（`agent-runtime-routes.ts:1097`）+ 页 `XiaoniPassiveRecallPage.tsx` · `/v1/embeddings`。

**净新建**：pgvector 列/索引/回填、ingest 钩子、入站适配、`xiaoni_recall_shadow_log` 表 + 触发2 接线 + feed、band-pass 语义在场排除、对账器降格。
