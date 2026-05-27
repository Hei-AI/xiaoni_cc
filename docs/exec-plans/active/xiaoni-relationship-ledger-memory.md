<!-- $autoplan restore point: /home/liahua/.gstack/projects/liahua-qq_bot/refactor-runtime-gateway-autoplan-restore-20260402-222441.md -->
# 小腻关系账本与可追溯记忆卡片

## Goal
- 继续沿当前已评审通过的 relationship memory 思路实现下去，不因为这轮 `$autoplan` 再把方向整体改窄或改轨。
- 让小腻的“关系感”继续从真实群聊里长出来，而不是靠硬编码亲密度或无限堆历史上下文。
- 在继续推进 ledger -> cards -> runtime -> admin 这条主线的同时，把群聊/私聊里的卡片结构和观察入口做得更一致、更少歧义。

## Source Of Truth
- Product design source:
  - `~/.gstack/projects/liahua-qq_bot/liahua-refactor-runtime-gateway-design-20260402-164452.md`
- Current adjacent active plans:
  - `docs/exec-plans/active/group-reply-relevance-gate.md`
  - `docs/exec-plans/active/transcript-snapshot-materialization.md`

## User Decision After $autoplan
- 用户明确选择：继续沿当前 relationship memory 的大方向实现下去。
- 这意味着：
  - 不把这份 plan 改写成纯 migration-only 计划
  - 不因为本轮 review 就放弃 ledger / cards / runtime / admin 这条主线
  - `$autoplan` 提出的 canonical home、旧入口退场、状态语义、UI contract 风险，作为实施护栏保留
- 简单说：
  - 主方向不变
  - 实施顺序和产品收口要吸收本轮 review 结论

## Current Reality
- 这不是 greenfield。
- 持久化层已经有：
  - `RelationshipLedgerEvent`
  - `RelationshipMemoryJob`
  - `RelationshipMemoryCard`
  - `RelationshipMemoryOverride`
  - `ChatSpaceTopic`
  - `TopicProjectionJob`
  - `TopicProjectionVersion`
- provider-service 已经挂接：
  - relationship ledger
  - relationship memory refresh
  - topic projection refresh
- admin/backend 已经有：
  - `topic-lab` workspace / detail / review / reprojection 路由
  - 旧 `run-routes` relationship-memory 路由
- admin/frontend 已经有：
  - `GroupChatDetailPage` / `PrivateChatDetailPage` 中的 `ChatSpaceTopicWorkspace`
  - `ConversationsPage` 中的旧 relationship memory cards 面板

## Problem
- Stage 2 解决的是“她该不该进主循环”，不是“她和谁更熟”。
- 当前主问题仍然成立：
  - 需要一条可信的长期关系生长路径
  - 需要带来源、可衰减、可人工修剪的关系投影
  - 需要后台能看清这些关系是怎么长出来的、为什么还在、为什么变淡
- 但当前仓库已经不再是空白地面：
  - schema、provider side pipeline、topic workspace、旧 run-detail memory 面板都已有部分实现
- 所以这次实现的真实难点是双重的：
  - 继续把 relationship memory 主线做完整
  - 避免新老入口、topic/workspace 与 relationship memory 之间继续长出歧义

## Scope
- `packages/persistence`
- `modules/provider-service`
- `modules/admin-panel/backend`
- `modules/admin-panel/frontend`
- 允许继续完善已有 relationship memory 和 topic projection 基础设施，但优先复用现有实现，不重复造第二套

## Non-Goals
- 在这条计划里重做 Stage 2 participation gate
- 新造第三个 memory 总入口
- 因为本轮 review 就整体放弃 relationship ledger / cards / runtime integration 路线
- 立即把 relationship memory 完全吞并进 topic workspace 成单一不可分领域
- 做完整移动端可编辑后台工作台

## Product Constraints
- 群聊和私聊必须共享同一套长期记忆观察模型。
- relationship memory 仍是一等业务对象，不因为 topic workspace 已存在就被降级成临时附属概念。
- `ChatSpaceTopicWorkspace` 和 relationship memory 必须能在 operator 视角下被解释清楚，不允许两套面板长期互相打架。
- 必须显式区分：
  - latest job status
  - current active version
  - runtime used evidence
  - manual override state
- 原始聊天记录仍是无损真相。任何 topic / relationship 投影都必须可追溯回消息与证据。
- 后台先按桌面优先设计；若不做完整响应式，必须明确小屏降级策略。

## Recommended Architecture
### 1. Primary Build Direction
- 继续完成 relationship memory 主线：
  - ledger events
  - memory jobs
  - relationship cards
  - runtime consumption
  - admin visibility
- 当前已有实现不视为“已经完成”，而视为 v1 路线的在途版本。

### 2. Relationship Between Topic And Relationship Memory
- topic workspace 回答：
  - 这个聊天空间最近在围绕什么转
  - 哪些主题是 current / historical
  - 证据和 projection 版本是什么
- relationship memory 回答：
  - 小腻和哪些人或群体形成了长期 social continuity
  - 哪些关系投影被 runtime 命中过
  - 哪些关系被人工 pin / downrank / archive
- 二者关系：
  - 同一个长期记忆 operator surface 体系
  - 互相链接
  - 不共享同一个列表主轴
  - 但也不应该被实现成两套互相无关的 operator truth

### 3. Operator Surface Direction
- 群聊详情和私聊详情是长期记忆观察的优先入口。
- `ConversationsPage` 的旧 relationship memory 面板短期允许继续存在，但目标是逐步收敛职责：
  - run 页重点解释“这次 run 用到了什么”
  - chat detail 重点解释“这个聊天空间长期沉淀了什么”
- 是否完全移除 run 页长期管理动作，放到后续实现阶段根据改造成本决定，但不再新增更多职责到 run 页。

### 4. Operator Screen Model
- chat detail 优先包含：
  - `Current Topics`
  - `Historical Topics`
  - `Relationship Memory`
  - `Projection / Job Status`
- relationship memory 工作区至少包含：
  - 左侧列表：按 `group` / `person` 或等价清晰分组
  - 右侧详情：summary、structure fields、traceability、runtime-hit、override state
  - 次级视图：ledger / evidence drilldown
- 必须明确定义状态：
  - empty
  - loading / generating
  - latest failed but active last-good
  - archived-only
  - no traceability available

### 5. Contract Semantics To Lock
- `entered_runtime` / `runtime_hit` 必须定义清楚是：
  - ever hit
  - latest run hit
  - accepted-version scoped hit
- `pin / downrank / archive` 必须定义：
  - 是否互斥
  - 是否可撤销
  - 是否立即影响 runtime
  - 是否要求 manual note
- `latest job status` 与 `current active version` 必须在 API 和 UI 中同时出现，不能互相覆盖。

## Data Flow
1. provider-service 继续生成和刷新 relationship memory / topic projection 产物
2. admin/backend 继续提供 relationship memory 与 topic workspace 相关 contract
3. chat detail 页面逐步成为长期观察主入口
4. run detail 保留 run-scoped evidence 解释能力，但不应继续无限长成第二套长期管理面
5. operator 能在同一产品体系内判断 topic、relationship、job status、runtime evidence 的关系

## Storage Boundaries
- 所有共享持久化逻辑收口到 `packages/persistence`
- 不新增第二套 relationship-memory schema
- 不新增与 `topic-lab` 平行的第三套长期记忆查询模型，除非现有 contract 明确无法表达

## Key Engineering Decisions To Lock In
- relationship memory 主线继续推进，不中途改轨
- 现有 relationship memory、topic projection、topic workspace 实现优先复用
- chat detail 是长期观察优先入口，但 run detail 的完全退场可以分阶段处理
- `topic-lab` 是重要主框架，relationship memory 是相邻一等工作区，不是要被立即吞并的次级概念
- 保留 `stable-last-good`
- 保留 relationship memory 与 topic projection 的既有 side effects，不重排主链路
- 新工作重点放在 route contract、UI state、旧 surface 退场顺序

## Risks
- review 之后如果过度收窄 scope，会打断之前长时间评审形成的主方向
- 继续保留双主入口，导致 operator 永远不知道去哪调试长期记忆
- 计划仍按伪 greenfield 执行，重复建设已存在的 schema / service / route
- `entered_runtime`、`archive`、`latest failed / active last-good` 语义不清，UI 标签会误导人
- topic 与 relationship memory 的边界不清，导致新的 chat detail 页面只是把旧歧义搬家
- 旧 run-detail override 动作没收干净，形成双写或双操作面

## Implementation Phases

### Phase 1: Core Relationship Memory Completion
- 继续补齐 relationship memory 主线中尚未稳定的部分
- 优先检查并完成：
  - relationship card structure fields
  - traceability detail
  - runtime-hit semantics
  - latest job / active version semantics
- 不重复建设已存在 schema / service，只补缺口

### Phase 2: Backend Contract Hardening
- 审核并补齐 `topic-lab` 与 relationship-memory 现有接口
- 对外锁定字段语义：
  - runtime hit semantics
  - latest job status
  - current active version
  - override state
  - evidence drilldown contract

### Phase 3: Frontend Structure Improvement
- 在群聊详情和私聊详情中继续完善长期记忆工作流
- relationship memory 工作区补齐：
  - list/detail model
  - provenance drilldown
  - failed-latest / active-last-good states
  - archived visibility
- `ConversationsPage` 按“run-scoped evidence”为主逐步收敛，不阻塞当前主线实现

### Phase 4: Semantics And State Polish
- 锁定 `pin / downrank / archive / manual note` 的交互语义
- 锁定 empty / loading / generating / failed / archived-only 状态
- 补充桌面优先或移动端降级说明
- 补充 accessibility 硬要求

### Phase 5: Operator Surface Convergence
- 尽量把群聊详情和私聊详情收敛成长期记忆优先入口
- 明确 run detail 的剩余职责
- 验证 topic 与 relationship memory 可以在一个 operator surface 体系内被清楚理解

### Phase 6: Verification
- 验证 relationship memory 主线能力继续向前，而不是只做迁移壳子
- 验证 runtime-hit、active version、job failure 三类状态不会互相混淆
- 验证新老入口不会继续扩大职责重叠

## Verification
### Required Tests
- backend:
  - `topic-lab` workspace / detail / failed-latest state
  - legacy run relationship-memory route contraction
  - runtime-hit / active-version / override semantics
- frontend:
  - group detail and private detail share the same chat-space workflow
  - run detail only shows memory-used references
  - relationship memory detail states are explicit
- manual QA:
  - archived-card discoverability
  - latest failed vs active last-good clarity
  - chat-detail jump from run detail
  - desktop-first behavior on narrow viewport

## Done Means
- relationship memory 主线继续落地，而不是被 review 中途改轨
- group detail 和 private detail 成为长期记忆优先入口
- `ConversationsPage` 至少不再继续扩张长期 relationship memory 管理职责
- relationship memory 与 topic workspace 的边界、术语、状态语义在 UI 上清楚可见
- latest job status、current active version、runtime-hit evidence 能被同页解释清楚
- 对应后端测试、前端测试、build 和必要的 compose 验证通过
  - 有 cards 时不会每次强行提旧梗
  - 当前聊天记录与 cards 冲突时，优先当前聊天记录
  - cards 缺失时，小腻仍能依赖原始聊天记录正常回复
- 人工验证：
  - 至少 3 个真实群聊样本
  - 至少 1 个旧梗自然衰减样本
  - 至少 1 个共享梗再次激活样本

## Open Questions For $plan-eng-review
- 第一版事件类型已经锁定为 3 类；评审重点改为这 3 类的判定边界和数据字段是否足够稳定
- 卡片进入运行时的最佳拼装点在哪一层
- 与现有 `group-reply-relevance-gate` 的最小耦合边界应该画在哪里
- compact 检查点附近的 relationship memory 独立触发条件具体阈值如何定，当前建议默认：
  - `min_new_turns = 6`
  - `min_new_ledger_events = 2`

## Done Means
- Schema、repository、provider-service 事件生成、card projection、admin 可追溯管理面都落地
- 至少一条真实关系卡片能在后台点开看到来源消息
- 至少一个旧梗经过时间衰减后自然降权
- 至少一个旧话题因再次互动被重新激活
- 模块测试、build、compose 验证通过，且不回归当前主链路

## Implementation Checklist

### A. Persistence Schema
- [ ] 在 `packages/persistence/prisma/schema.prisma` 新增 relationship ledger / card / override / job 所需模型
- [ ] 模型拆分至少包含：
  - [ ] `RelationshipLedgerEvent`
  - [ ] `RelationshipMemoryCard`
  - [ ] `RelationshipMemoryOverride`
  - [ ] `RelationshipMemoryJob`
- [ ] `RelationshipLedgerEvent` 字段至少包含：
  - [ ] `group_id`
  - [ ] `target_user_id`
  - [ ] `session_key`
  - [ ] `event_type`
  - [ ] `event_weight`
  - [ ] `confidence`
  - [ ] `source_message_ids`
  - [ ] `source_excerpt`
  - [ ] `created_at`
  - [ ] `last_reinforced_at`
- [ ] `RelationshipMemoryCard` 字段至少包含：
  - [ ] `card_type`
  - [ ] `group_id`
  - [ ] `target_user_id`
  - [ ] `summary_text`
  - [ ] `actors`
  - [ ] `context_before`
  - [ ] `trigger`
  - [ ] `interaction`
  - [ ] `outcome`
  - [ ] `source_event_ids`
  - [ ] `source_message_ids`
  - [ ] `importance_score`
  - [ ] `freshness_score`
  - [ ] `decayed_score`
  - [ ] `last_hit_at`
  - [ ] `version`
- [ ] `RelationshipMemoryOverride` 字段至少包含：
  - [ ] `card_id`
  - [ ] `action_type`
  - [ ] `manual_note`
  - [ ] `created_by`
  - [ ] `created_at`
- [ ] `RelationshipMemoryJob` 字段至少包含：
  - [ ] `group_id`
  - [ ] `session_key`
  - [ ] `status`
  - [ ] `trigger_reason`
  - [ ] `turn_range`
  - [ ] `ledger_event_count`
  - [ ] `input_message_ids`
  - [ ] `output_card_version`
  - [ ] `error_message`
  - [ ] `started_at`
  - [ ] `finished_at`
- [ ] 为以下查询建索引：
  - [ ] group + target_user + decayed_score
  - [ ] job status + updated_at
  - [ ] source_message_ids 可追溯查询
- [ ] 生成并验证 Prisma client

### B. Persistence Access Layer
- [ ] 在 `packages/persistence` 新增 relationship memory repository / service API
- [ ] 收口以下操作：
  - [ ] append ledger event
  - [ ] reinforce existing ledger event
  - [ ] create job
  - [ ] mark job running/succeeded/failed
  - [ ] replace card version atomically
  - [ ] list cards with merged override view
  - [ ] record override action
- [ ] 保证 provider/backend 不直接散写原生 SQL

### C. Provider-Service Event Generation
- [ ] 在 `modules/provider-service` 中确定最小插入点，优先复用现有 transcript / inbound context 能力
- [ ] 第一版只实现 3 类事件提取：
  - [ ] `shared_joke_formed`
  - [ ] `reply_chain_success`
  - [ ] `topic_reactivated`
- [ ] 明确同一段互动的去重规则
- [ ] 明确 source message ids 如何从现有消息存储中取值
- [ ] 只把候选事实写入 ledger，不在这里直接生成 cards
- [ ] 为后续 TODO 留出扩展位：
  - [ ] `user_reengaged_xiaoni`
  - [ ] `relationship_cooled`

### D. Compact-Adjacent Trigger
- [ ] 在 `modules/provider-service/src/services/session-transcript-service.ts` 附近挂 relationship memory trigger check
- [ ] 保持：
  - [ ] 与 compact 共用检查时机
  - [ ] 独立 `enabled` 开关
  - [ ] 独立阈值
- [ ] 默认实现推荐值：
  - [ ] `min_new_turns = 6`
  - [ ] `min_new_ledger_events = 2`
- [ ] 明确 compact 未触发时 relationship memory 不主动跑

### E. Relationship Memory Job Pipeline
- [ ] 在 `modules/provider-service` 新增 relationship memory job service
- [ ] job 生命周期至少包含：
  - [ ] `pending`
  - [ ] `running`
  - [ ] `succeeded`
  - [ ] `failed`
- [ ] job 输入必须包含：
  - [ ] 最近新增 ledger events
  - [ ] 对应 source messages
  - [ ] 当前群上下文
  - [ ] 当前已有 cards 的上一成功版本摘要
- [ ] 失败策略实现为 `stable-last-good`
- [ ] 明确只有 job success 才切换 active card version

### F. LLM Card Projection
- [ ] 在 `modules/provider-service` 中实现 relationship card projection prompt / schema
- [ ] LLM 输出严格限制为最小 7 字段：
  - [ ] `actors`
  - [ ] `context_before`
  - [ ] `trigger`
  - [ ] `interaction`
  - [ ] `outcome`
  - [ ] `evidence_message_ids`
  - [ ] `summary_text`
- [ ] schema 解析失败时：
  - [ ] job 标记 failed
  - [ ] 不更新 active cards
- [ ] 系统层补齐：
  - [ ] scores
  - [ ] timestamps
  - [ ] version
  - [ ] source_event_ids
  - [ ] retrieval material

### G. Retrieval Layer
- [ ] 设计 `BM25` 检索材料：
  - [ ] `summary_text`
  - [ ] `actors`
  - [ ] `trigger`
  - [ ] `outcome`
  - [ ] 共享梗关键词 / 固定短语
- [ ] 设计 embedding 检索材料：
  - [ ] `summary_text`
  - [ ] 结构化字段拼装文本
- [ ] retrieval 先做硬过滤：
  - [ ] 当前群
  - [ ] 当前发言人
  - [ ] 最近互动 1-2 人
- [ ] 实现双召回合并：
  - [ ] dedupe
  - [ ] rerank
  - [ ] budget trim
- [ ] 明确 `RAG` 只做编排层，不单独维护第三套索引

### H. Runtime Prompt Integration
- [ ] 确定 runtime card read API 所在层
- [ ] 在主循环 prompt 拼装时接入 cards
- [ ] prompt 中补明确规则：
  - [ ] cards 是参考，不是绝对真相
  - [ ] 当前聊天记录与 cards 冲突时优先当前聊天记录
  - [ ] 不强行每次提旧梗
- [ ] 验证 cards 缺失时不影响主流程

### I. Admin Backend
- [ ] 在 `modules/admin-panel/backend` 新增 relationship memory 查询接口
- [ ] 暴露：
  - [ ] card list
  - [ ] card detail
  - [ ] source traceability
  - [ ] override actions
  - [ ] job status
- [ ] 后端响应必须同时区分：
  - [ ] latest job status
  - [ ] current active card version

### J. Admin Frontend
- [ ] 在 `modules/admin-panel/frontend` 增加 relationship memory 最小观察面
- [ ] 前端至少能看：
  - [ ] card summary
  - [ ] card structure fields
  - [ ] source message ids / excerpts
  - [ ] decayed state
  - [ ] last reinforced time
  - [ ] override state
  - [ ] latest job status
- [ ] 提供最小人工动作：
  - [ ] pin
  - [ ] downrank
  - [ ] archive
  - [ ] manual note

### K. Tests
- [ ] 单元测试：
  - [ ] ledger append / dedupe
  - [ ] decay calculation
  - [ ] card version switch
  - [ ] override merge
- [ ] LLM contract tests：
  - [ ] 最小 7 字段 schema 成功解析
  - [ ] 缺字段失败
  - [ ] 非法 JSON 失败
- [ ] 检索测试：
  - [ ] BM25 命中共享梗关键词
  - [ ] embedding 命中续话语义
  - [ ] RAG 去重与 budget 裁剪
- [ ] 集成测试：
  - [ ] ledger -> job -> cards -> runtime read
  - [ ] job failed -> stable-last-good
  - [ ] override 生效但不污染自动 cards
- [ ] prompt behavior checks：
  - [ ] 不会每次强行提旧梗
  - [ ] cards 与当前聊天冲突时优先当前聊天

### L. Verification And Rollout
- [ ] 跑对应模块测试
- [ ] 跑 `npm run build`
- [ ] 对触达服务执行 compose 验证
- [ ] 在至少 3 段真实群聊样本上做人工回看
- [ ] 确认后台能点开一张 card 看到来源消息
- [ ] 确认一次 job 失败后 runtime 仍读取上一版 stable cards

## $autoplan Intake

- Plan file: `docs/exec-plans/active/xiaoni-relationship-ledger-memory.md`
- Branch: `refactor/runtime-gateway`
- Base branch: `refactor/runtime-gateway` (current remote default)
- UI scope: yes
- Design doc found: `/home/liahua/.gstack/projects/liahua-qq_bot/liahua-refactor-runtime-gateway-design-20260402-164452.md`
- Review mode: `SELECTIVE_EXPANSION`

Plan summary:
- 这份计划原始写法把工作定义成 relationship memory v1 全量建设。
- 但仓库真实代码已经不是这个阶段。`packages/persistence/prisma/schema.prisma` 已有 relationship memory 与 topic projection 模型，`modules/provider-service/src/index.ts` 已同时挂了 relationship memory 与 topic projection side effects，`modules/admin-panel/frontend/src/pages/GroupChatDetailPage.tsx` 和 `modules/admin-panel/frontend/src/pages/PrivateChatDetailPage.tsx` 已嵌入 `ChatSpaceTopicWorkspace`。
- 当前未完成的核心不是“从 0 到 1 建整个关系记忆系统”，而是把群聊/私聊卡片结构迁移成统一的聊天空间观察工作台，并清理旧的 run-detail 记忆入口。

## Phase 1: CEO Review

### 0A. Premise Challenge

- Premise 1: “仓库还没有关系事件真相层、关系摘要层、后台可追溯管理面” 不再成立。实际代码已经有 `RelationshipLedgerEvent` / `RelationshipMemoryCard` / `RelationshipMemoryJob` / `RelationshipMemoryOverride` 模型，也有 topic workspace 路由和详情页工作区。这个 premise 必须改写。
- Premise 2: 真正未完成的问题是“群聊和私聊详情里的长期记忆主视图还没有完全 canonicalize，旧的 run detail 仍在并行承载关系记忆观察”。我接受这个 premise。这和你说的“调整群聊私聊卡片结构”一致。
- Premise 3: 主题工作台已经成为主观察模型，relationship memory 不应再作为第二套漂浮的 operator home。我接受。否则 6 个月后会保留两套半重叠管理面。
- Premise 4: 这份计划的价值不该再用“建了多少 schema / job / override”衡量，而该用“是否统一 operator workflow、是否让小腻的长期记忆调试更少歧义”衡量。我接受。

### 0B. What Already Exists

| Sub-problem | Existing code | Notes |
|---|---|---|
| 群聊详情里的聊天空间主题工作区 | `modules/admin-panel/frontend/src/pages/GroupChatDetailPage.tsx:516` | 已嵌入 `ChatSpaceTopicWorkspace` |
| 私聊详情里的聊天空间主题工作区 | `modules/admin-panel/frontend/src/pages/PrivateChatDetailPage.tsx:471` | 与群聊走同一组件，已证明“内核同构” |
| 旧 run detail 里的 relationship memory 卡片 | `modules/admin-panel/frontend/src/pages/ConversationsPage.tsx:557` | 仍然保留群卡 / 人际卡两桶展示和 override 动作 |
| topic workspace API | `modules/admin-panel/backend/src/routes/topic-lab-routes.ts:164` | 已有 workspace / topic detail / review / reprojection 路由 |
| relationship memory run API | `modules/admin-panel/backend/src/routes/run-routes.ts:726` | 仍按 `group_cards` / `person_cards` 返回旧模型 |
| relationship memory schema | `packages/persistence/prisma/schema.prisma:181` | 关系账本、job、card、override 都已经存在 |
| topic projection schema | `packages/persistence/prisma/schema.prisma:266` | 聊天空间 topic / projection version / evidence / relationship 都已经存在 |
| provider side side effects | `modules/provider-service/src/index.ts:44` | compact side effect 同时触发 transcript、relationship memory、topic projection |

### 0C. Dream State Diagram

```text
CURRENT
  group/private detail
  -> topic workspace 已出现
  run detail
  -> 仍有 relationship memory cards 管理与追溯
  operator 需要自己判断哪个才是长期记忆主入口

THIS PLAN
  group detail / private detail
  -> 统一成 chat space long-lived memory home
  -> topic workspace 是主框架
  -> relationship memory 成为相邻、交叉引用、可追溯的辅助工作区
  run detail
  -> 只展示“本次 run 命中了哪些 memory”，不再承担管理面

12-MONTH IDEAL
  一个 canonical chat-space memory model
  -> topic / relationship / evidence / runtime usage 全部从一个操作心智进入
  -> 没有并行漂浮的旧卡片管理面
```

### 0C-bis. Implementation Alternatives

| Approach | Effort | Risk | Pros | Cons |
|---|---|---|---|---|
| A. 继续把 relationship memory 当独立 v1 平台往前推 | High | High | 架构上整齐 | 与现有 topic workspace 并行，极易形成两套 operator truth |
| B. 以 chat detail 为 canonical home，收敛 run detail，补齐 topic workspace 与 relationship memory 的边界 | Medium | Low | 最符合“群聊私聊卡片结构调整”的当前任务 | 需要重写 plan，把 greenfield 叙述改成迁移和收敛 |
| C. 彻底把 relationship memory 吞进 topic workspace，完全不保留独立域 | Medium | Medium | 模型最单一 | 可能过度压扁“主题”和“人与小腻的长期关系”两个维度 |

### 0D. Mode-Specific Analysis

- `SELECTIVE_EXPANSION` 正确。
- 我批准把范围从“新建更多基础设施”改成“定义 canonical operator workflow、旧入口迁移、状态与语义收敛”。这是 blast radius 内且比继续造平台更完整。
- 我拒绝继续把 checklist 写成 greenfield。真实代码已经落地过半，这种写法会误导实现顺序和 Done Means。
- 我暂不批准把 relationship memory 完全吞进 topic workspace。这个方向有价值，但当前证据只够支持“同 home、强交叉引用、旧 run-detail 退场”，还不够直接合并语义层。

### 0E. Temporal Interrogation

- Hour 1: 如果不先定义 canonical home，前端会继续保留 run detail 和 chat detail 两套入口，任何新增字段都会加剧混乱。
- Hour 6: 如果只补 topic workspace，不处理旧 run detail 关系卡入口，operator 仍会在“这次 run 看到了什么”和“这个聊天空间长期沉淀了什么”之间来回跳。
- One week later: 如果不锁定 runtime-hit、failed-latest vs active-last-good、archive 语义，后台会出现状态标签很多但没人信任的情况。
- Six months later: 最愚蠢的结果不是技术没做完，而是做出两套部分重叠的长期记忆面板。

### 0F. Mode Selection Confirmation

- Confirmed mode: `SELECTIVE_EXPANSION`
- Why: 这不是砍 scope，而是把 scope 从错误的 greenfield 叙事拉回当前最值钱的收敛工作。

### CODEX SAYS (CEO — strategy challenge)

- Codex outside voice 明确指出这份计划 premise 已经过时。它不是“relationship memory v1 from zero”，而是“决定 canonical operator workflow 和迁移故事”的问题。
- Codex 认为最危险的遗漏是没有严肃比较另一条更便宜路径：把现有 topic/workspace 扩成长期记忆主模型，而不是再养出一套并行域。
- Codex 还指出 success criteria 过于 operational，没有度量“是否真的提高 social continuity / operator clarity”。

### CLAUDE SUBAGENT (CEO — strategic independence)

- 当前执行约束下未运行独立 Claude subagent，记为 unavailable。
- 主评审结论与 Codex outside voice 一致：这份计划必须先承认仓库已落地大量 relationship/topic 基础设施，再把任务重心收敛到群聊/私聊卡片结构和 operator workflow。

### CEO DUAL VOICES — CONSENSUS TABLE
═══════════════════════════════════════════════════════════════
  Dimension                           Claude  Codex  Consensus
  ──────────────────────────────────── ─────── ─────── ─────────
  1. Premises valid?                   Medium  No      DISAGREE
  2. Right problem to solve?           Yes     Yes     CONFIRMED
  3. Scope calibration correct?        Medium  No      DISAGREE
  4. Alternatives sufficiently explored?No     No      CONFIRMED
  5. Competitive/market risks covered? Medium  Medium  CONFIRMED
  6. 6-month trajectory sound?         Medium  No      DISAGREE
═══════════════════════════════════════════════════════════════

### Error & Rescue Registry

| Failure mode | User-visible effect | Current rescue | Remaining gap |
|---|---|---|---|
| 长期记忆主入口漂浮在 run detail 和 chat detail 之间 | operator 无法稳定判断去哪调试 | topic workspace 已嵌入 chat detail | 缺 deprecation / migration plan |
| 旧关系卡 API 继续按 group/person 两桶返回 | UI 继续绕着旧卡片模型长 | run detail 还能看证据 | 需要把 run detail 改成 memory-used reference，不再做管理面 |
| 计划仍按 greenfield checklist 推进 | 团队按错误顺序做事，重复建设 | 已有代码可复用 | 需要重写 plan 的 What already exists / Done Means / checklist |

### Failure Modes Registry

| Failure mode | Severity | Status | Comment |
|---|---|---|---|
| 双入口长期并存 | Critical | Open | run detail 与 chat detail 都像“主视图” |
| relationship memory 与 topic workspace 语义冲突 | High | Open | operator 不知道 topic 和 relationship 谁是第一页 |
| 过度 greenfield 叙事导致重复建设 | High | Open | 实际代码已存在大量基础设施 |
| success criteria 停留在“能点开来源消息” | High | Open | 缺 operator clarity / behavior lift 指标 |

### NOT in Scope

- 重做 Stage 2 participation gate
- 重写 topic projection 数据模型
- 立即把 relationship memory 完全并入 topic workspace 成一个不可分域
- 新增第三套独立 memory 总入口

### Dream State Delta

- 仓库今天已经有 memory/topic 能力，但没有唯一的 operator 入口。
- 这份计划真正应该交付的是“主入口收敛 + 旧入口退场 + 状态语义明确”，不是再把已存在的基础设施假装建一遍。

### Completion Summary

| Area | Verdict | Why |
|---|---|---|
| Problem selection | Pass with concern | 用户要的是卡片结构和观察工作台，不是再做一遍 greenfield v1 |
| Scope | Needs rewrite | 现有 checklist 与仓库真实状态不符 |
| Alternatives | Fail | 没有严肃比较“收敛到 topic workspace”这条更便宜路径 |
| Recommendation | Rewrite before implementation | 先锁 canonical home、迁移故事、成功标准 |

**Phase 1 complete.** Codex: 8 strategic issues. Claude subagent: unavailable. Consensus: 3/6 confirmed, 3 disagreements. Passing to Phase 2.

## Phase 2: Design Review

### 0. Design Scope

- Completeness score: `5/10`
- UI scope 明确存在，因为这次工作本质上是在改群聊/私聊详情里的卡片结构与长期记忆主视图。
- 已有可复用模式：
  - `ChatSpaceTopicWorkspace` 已在群聊和私聊详情落位
  - `ConversationsPage` 仍保留旧的 relationship memory cards + override 动作
- 设计上最大的风险不是组件缺失，而是 workflow 缺失。实现者很容易继续把旧卡片面板保留下来。

### 0.5 Dual Voices

#### CODEX SAYS (design — UX challenge)

- Codex 认为当前计划服务的是开发者，而不是 operator。
- 它明确指出缺少 canonical home、screen model、empty/loading/failed-latest states、responsive posture、accessibility 要求，以及对旧 run-detail surface 的 deprecation。
- 它建议把 chat detail 定义为唯一长期记忆入口，而 run detail 只保留“本次命中的 memory reference”。

#### CLAUDE SUBAGENT (design — independent review)

- 未运行独立 Claude subagent，记为 unavailable。
- 主评审结论与 Codex 一致：如果不把 UI contract 锁死，前端实现会现场发明产品。

### Design Litmus Scorecard

| Dimension | Score | Why it is not a 10 |
|---|---|---|
| Information hierarchy | 4/10 | 计划按存储层和检索层展开，不按 operator 任务流展开 |
| Canonical navigation | 3/10 | 没写清 run detail、group detail、private detail 之间谁是主入口 |
| Interaction states | 4/10 | 缺 empty / generating / failed-latest / archived-only / no-traceability 设计 |
| Terminology & model clarity | 5/10 | topic 与 relationship 是相邻域还是主从域，没有写死 |
| Responsive strategy | 2/10 | 没写桌面优先还是响应式降级 |
| Accessibility | 2/10 | 没有键盘、focus、语义标签、颜色依赖约束 |
| Migration clarity | 3/10 | 没有旧 surface 的 keep / redirect / remove 策略 |

### Design Findings

- 当前 hierarchy 先讲 ledger、cards、retrieval，再讲 operator surface。这是开发视角，不是运营调试视角。
- `entered_runtime`、`pin/downrank/archive`、`latest job status vs current active version` 都有字段要求，但没有屏幕级交互定义。
- 如果不规定“桌面优先 + 小屏降级为只读 summary”或其他明确 responsive posture，这类高密度运维面板在移动端会变成事故。
- 需要明确：
  - chat detail > Topic Workspace 是主框架
  - Relationship Memory 是同页相邻工作区或 tab，不得新开第三入口
  - run detail 仅显示 memory used references，跳回 chat detail

### Design Completion Summary

| Area | Verdict | Why |
|---|---|---|
| UX direction | Pass with concern | 方向大致正确，但产品 contract 不完整 |
| Screen specificity | Fail | 还停留在“card list / detail / actions”占位层 |
| States | Fail | 缺关键调试状态定义 |
| Accessibility / responsive | Fail | 没有硬要求 |

**Phase 2 complete.** Codex: 6 design concerns. Claude subagent: unavailable. Consensus: single-model design pass, no independent second voice. Passing to Phase 3.

## Phase 3: Eng Review

### 0. Scope Challenge

- 我检查了真实代码，结论很直接：
  - `packages/persistence/prisma/schema.prisma:181` 起，relationship memory 数据模型已存在
  - `modules/provider-service/src/index.ts:44` 起，relationship ledger / memory / topic projection side effects 都已接到主链路
  - `modules/provider-service/src/services/relationship-memory-executor-service.ts:319` 起，relationship card executor 已跑 JSON schema-first 生成
  - `modules/admin-panel/backend/src/routes/topic-lab-routes.ts:164` 起，chat-space workspace / topic detail 已经可用
- 所以工程问题不是“怎么把这些系统造出来”，而是“怎么避免旧 run-routes 关系卡 API 和新 topic-lab 体系并行漂移”。
- 最大隐藏复杂度在 migration：数据模型、provider side pipeline、admin routes、frontend pages 都有现成部分，任何继续 greenfield 的计划都会导致双写或双查。

### 0.5 Dual Voices

#### CODEX SAYS (eng — architecture challenge)

- Codex 明确指出：计划假设空白地面，但仓库实际上已经有 relationship-memory 持久化、provider 流程和 topic-lab 模型。
- 它认为最危险的架构问题是继续把 relationship memory 和 topic workspace 当成两条并列主线推进，形成重复状态机、重复 operator surface、重复 runtime 契约。
- 它还指出一些具体复杂度：
  - `replaceRelationshipMemoryCards` 按 scope bucket 替换 active cards，会和 topic-based 观察面天然张力
  - relationship executor 当前硬限制 `2` 张群卡 / `3` 张人卡，是旧模型假设，不应在新 plan 里静默继承
  - compact-adjacent refresh 与 topic projection 同时存在，迁移时必须写清触发边界和 UI 消费边界

#### CLAUDE SUBAGENT (eng — independent review)

- 未运行独立 Claude subagent，记为 unavailable。
- 主评审同样认为工程上最该锁的不是更多 schema，而是旧 API / 旧页面的退场顺序。

### ENG DUAL VOICES — CONSENSUS TABLE
═══════════════════════════════════════════════════════════════
  Dimension                           Claude  Codex  Consensus
  ──────────────────────────────────── ─────── ─────── ─────────
  1. Architecture sound?               Medium  No      DISAGREE
  2. Test coverage sufficient?         No      No      CONFIRMED
  3. Performance risks addressed?      Medium  Medium  CONFIRMED
  4. Security threats covered?         Medium  Medium  CONFIRMED
  5. Error paths handled?              No      No      CONFIRMED
  6. Deployment risk manageable?       Medium  No      DISAGREE
═══════════════════════════════════════════════════════════════

### 1. Architecture

```text
NapCat
  -> provider-service
       -> RelationshipLedgerService
       -> RelationshipMemoryService
       -> TopicProjectionService
       -> TopicReviewMaterializationService
  -> packages/persistence
       -> relationship_ledger_events
       -> relationship_memory_jobs/cards/overrides
       -> chat_space_topics
       -> topic_projection_jobs/versions/evidence/relationships
  -> admin-panel/backend
       -> /api/runs/.../relationship-memory      (legacy run-scoped view)
       -> /api/topic-lab/chat-spaces/...         (new chat-space view)
  -> admin-panel/frontend
       -> ConversationsPage run detail           (legacy cards management surface)
       -> GroupChatDetailPage / PrivateChatDetailPage
            -> ChatSpaceTopicWorkspace           (new canonical chat-space surface candidate)
```

- 当前最大的架构缺口是缺 migration boundary，不是缺模块。
- 我建议把计划重写成三段：
  - `Phase A: Canonical home + route contract`
  - `Phase B: Legacy run-detail contraction`
  - `Phase C: Runtime-hit / override / failed-latest semantics hardening`
- 不建议继续把 persistence / provider 基础设施列为未完成主项。

### 2. Code Quality / Complexity

- 当前 plan 的 checklist 会让人重复实现已存在的 schema、service、executor、route。
- 真正应该改的是把 checklist 从“新增 relationship memory repository / job / frontend”换成：
  - 复用哪些现有接口
  - 删除或只读化哪些旧接口
  - 哪些字段语义需要补 contract tests
- 如果不这么改，最常见的结果是写出第二版 list API，而不是收敛旧 API。

### 3. Test Review

#### Test Diagram

| Flow / branch | Expected coverage | Status |
|---|---|---|
| Group detail loads topic workspace | frontend integration | Required |
| Private detail mirrors same workspace model | frontend integration | Required |
| Run detail only shows memory-used references | frontend integration | Required |
| Topic detail returns accepted/candidate/failed + evidence + relationships | backend route tests | Required |
| Latest failed job with active last-good data | backend + frontend state test | Required |
| Override action feedback and reversibility | frontend integration | Required |
| Archived-card discoverability | frontend state + backend filter tests | Required |
| Runtime-hit badge semantics | contract test | Required |
| Legacy run relationship-memory API deprecation path | backend route tests | Required |

#### Test Plan Artifact

- Wrote artifact: `/home/liahua/.gstack/projects/liahua-qq_bot/liahua-refactor-runtime-gateway-eng-review-test-plan-20260402-223012.md`

### 4. Performance

- 性能不是主风险。
- 真风险是 data duplication 和 UI ambiguity。相比之下，topic workspace 和 relationship card detail 这种后台工作台就算多查几次也不是当前主瓶颈。
- 但如果继续让 run detail 和 chat detail 各自 hydrate 一整套 evidence、override、job 状态，查询成本和前端复杂度都会无谓翻倍。

### 5. Reliability / Failure Handling

- 计划已经写了 `stable-last-good`，这是对的。
- 但没有把它翻译成 operator-facing contract：
  - 当 latest job failed 时，谁来显示当前 runtime 仍在使用哪一版？
  - run detail 是否还会读到旧 relationship-memory route 并呈现相互矛盾的状态？
- 还缺 migration failure path：
  - 如果 chat detail 新工作区未就绪，旧 run detail 是否允许只读 fallback
  - 什么时候删掉旧 override 动作，避免双写

### Cross-Phase Themes

- Theme: 计划 premise 过时，必须先承认已有 relationship/topic 基础设施。
- Theme: canonical operator home 未锁，导致 CEO、Design、Eng 三个 phase 都把它当第一风险。
- Theme: 真正待做的是迁移与收敛，不是再造平台。

### Eng Completion Summary

| Area | Verdict | Why |
|---|---|---|
| Architecture | Pass with concern | 模块存在，但迁移边界没锁 |
| Tests | Fail | 缺针对 canonical-home / legacy-contraction / status semantics 的测试计划 |
| Performance | Pass | 非主风险 |
| Reliability | Pass with concern | `stable-last-good` 有写法，没写 operator contract |

**Phase 3 complete.** Codex: 6 engineering concerns. Claude subagent: unavailable. Consensus: 4/6 confirmed, 2 disagreements. Ready for final approval gate.

## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|-------|----------|----------------|-----------|-----------|----------|
| 1 | CEO | 把计划从 greenfield v1 改写为 canonical-home migration | Taste | P1, P2 | 真实代码已落地大量基础设施，继续按 greenfield 推进会重复建设 | 继续照旧 checklist 执行 |
| 2 | CEO | 认定 chat detail 是长期记忆主入口候选 | Taste | P1, P5 | 群聊和私聊详情已嵌入同一工作区，最接近统一 operator workflow | 让 run detail 和 chat detail 长期并存 |
| 3 | CEO | 不把 relationship memory 立即完全并入 topic workspace | Taste | P3 | 当前证据只够支持同 home、强交叉引用，还不够直接合并语义层 | 立刻做域合并 |
| 4 | Design | 要求 run detail 收敛成 memory-used references | Mechanical | P5 | 旧 run detail 继续承担管理面只会增加认知歧义 | 继续在 run 页做 pin/downrank/archive |
| 5 | Design | 把 empty/loading/failed-latest/archived-only 设为必写状态 | Mechanical | P1 | 这是调试工作台，不是静态展示页 | 只列字段，不写状态 |
| 6 | Design | 明确桌面优先或响应式降级策略必须写进 plan | Mechanical | P5 | 高密度管理面没有 posture 就会做坏 | 让实现者现场决定 |
| 7 | ENG | 复用现有 topic-lab 和 relationship-memory 基础设施，不再把 schema/service 当主 checklist | Mechanical | P4, P5 | 已有实现存在，计划应收敛而非复制 | 再列一次“新增 schema / 新增 service” |
| 8 | ENG | 新增 migration/deprecation checklist 替换旧 greenfield checklist | Mechanical | P1, P2 | 这才覆盖真实 blast radius | 只加更多新接口 |
| 9 | ENG | 测试重点改成 canonical-home、legacy contraction、status semantics | Mechanical | P1 | 当前最大风险来自语义和迁移，不是单纯 CRUD | 只测 schema / JSON parse |

## $autoplan Final Approval Gate

### Plan Summary

- 这份计划不能再按“relationship memory v1 从 0 开始”执行了。仓库里已经有 relationship ledger、memory cards、topic workspace、chat detail 工作区和 provider side pipeline。
- 当前未完成任务是你说的“调整群聊私聊卡片结构”：把群聊和私聊详情收敛成统一的聊天空间长期记忆入口，并把旧 run-detail 关系卡管理面退成引用面。

### Decisions Made: 9 total (6 auto-decided, 3 taste choices, 1 user challenge)

### User Challenges

**Challenge 1: Rewrite the plan from greenfield build-out to migration-and-canonicalization** (from CEO + Eng)

You said:
- 继续这份 `xiaoni-relationship-ledger-memory` plan，并补完“群聊私聊卡片结构调整”这个未完成任务

Both models recommend:
- 不再把这份 plan 当作 relationship memory 平台从 0 到 1 建设
- 改成“chat detail canonical home + old run-detail contraction + status semantics hardening”的迁移计划

Why:
- 真实代码已经有 schema、provider side pipeline、topic workspace、topic-lab routes
- 现在最大的风险是双入口和双语义，而不是缺基础设施

What we might be missing:
- 你可能仍然希望保留 relationship memory 作为与 topic workspace 并列的一等域，而不是仅仅做同 home 收敛

If we're wrong, the cost is:
- 会把计划改窄，延后一部分你原本希望继续扩展的独立 relationship-memory 能力

Your call. 原始方向默认仍成立，除非你明确接受这次改写。

### Your Choices

**Choice 1: relationship memory 与 topic workspace 的关系** (from CEO)
我推荐“同一 chat-detail home、强交叉引用、暂不彻底合并”。
但“完全合并为单一 topic 域”也可行：
  代价是本轮 scope 会更大，而且要更早锁定 topic 与 person-salience 的统一 ontology。

**Choice 2: run detail 是否彻底退场为只读引用面** (from Design)
我推荐“是”。
但“保留部分 override/追溯能力在 run detail”也可行：
  代价是 operator 会继续在两套面板里做判断，长期难以收敛。

**Choice 3: 是否显式声明桌面优先后台工作台** (from Design)
我推荐“是”。
但“同时承诺完整响应式”也可行：
  代价是本轮 UI 设计和测试工作量明显增加。

### Auto-Decided: 6 decisions

- See `Decision Audit Trail` above.

### Review Scores

- CEO: Pass with concern. 问题选得对，但 plan premise 和 scope 需要重写。
- CEO Voices: Codex 8 issues, Claude subagent unavailable, Consensus 3/6 confirmed.
- Design: Fail. UI contract、状态、迁移、responsive、accessibility 都不够具体。
- Design Voices: Codex 6 issues, Claude subagent unavailable, Consensus single-model only.
- Eng: Pass with concern. 架构存在，但迁移边界和测试重点没锁。
- Eng Voices: Codex 6 issues, Claude subagent unavailable, Consensus 4/6 confirmed.

### Cross-Phase Themes

- Theme: canonical operator home 未锁，是三阶段共同最高风险。
- Theme: 计划 premise 过时，真实工作是迁移收敛而不是 greenfield 建设。
- Theme: 旧 run-detail surface 的去留必须明确，否则 topic workspace 无法成为真正主入口。

### Deferred to TODOS.md

- 是否最终把 relationship memory 完全并入 topic workspace，延后到 canonical-home migration 落地并观察后再决定。
- 若要支持完整移动端可操作后台工作台，延后到桌面优先版本稳定后再评估。
