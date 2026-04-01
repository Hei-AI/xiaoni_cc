# 小腻关系账本与可追溯记忆卡片

## Goal
- 让小腻的“关系感”从真实群聊里长出来，而不是靠硬编码亲密度或无限堆历史上下文。
- 第一版要同时满足三件事：
  - 关系素材来自真实互动
  - 运行时只读可追溯、可衰减的关系卡片
  - 后台能看清每条关系是怎么长出来的、为什么还在、为什么变淡

## Source Of Truth
- Product design source:
  - `~/.gstack/projects/liahua-qq_bot/liahua-refactor-runtime-gateway-design-20260331-224245.md`
- Prior design this extends:
  - `~/.gstack/projects/qq_bot/liahua-refactor/runtime-gateway-design-20260331-001918.md`
- Current adjacent active plans:
  - `docs/exec-plans/active/group-reply-relevance-gate.md`
  - `docs/exec-plans/active/transcript-snapshot-materialization.md`

## Problem
- Stage 2 解决的是“她该不该进主循环”，不是“她和谁更熟”。
- 现在仓库还没有一条可信的长期关系生长路径：
  - 没有关系事件真相层
  - 没有带来源和衰减的关系摘要层
  - 没有后台可追溯管理面
- 如果直接把关系记忆塞进 prompt 或长期摘要里，短期会看起来聪明，长期会变假：
  - 旧梗不会自然褪色
  - 无法解释为什么她突然对某个人更熟
  - 人工也无法判断某条关系是否该删

## Scope
- `packages/persistence`
- `modules/provider-service`
- `modules/admin-panel/backend`
- `modules/admin-panel/frontend`

## Non-Goals
- 在这条计划里重做 Stage 2 participation gate
- 在第一版做完整社交图谱或 fully proactive Stage 3
- 让运行时直接读取原始聊天记录做长期关系推理
- 做无来源的“运营备注直进运行时”捷径

## Product Constraints
- 关系必须从真实群聊生成，人工只能修剪、保留、降权、补少量说明
- 关系摘要必须能追溯到具体聊天记录
- 关系真实性和重要性必须有时间衰减
- 第一版先追求“能被用户感觉到”，不是“覆盖全部社交复杂度”
- 原始聊天记录才是无损真相。relationship memory 与 transcript summary 都是有损投影，不能反过来取代原始记录成为唯一依据

## Recommended Architecture

### 1. Truth Layer: Relationship Ledger
- 新增关系事件真相层，记录最小事件集合：
  - `shared_joke_formed`
  - `reply_chain_success`
  - `topic_reactivated`
  - `user_reengaged_xiaoni`
  - `relationship_cooled`
- 每条事件必须带：
  - `id`
  - `group_id`
  - `target_user_id`，群公共事件可为空
  - `session_key`
  - `event_type`
  - `confidence`
  - `event_weight`
  - `source_message_ids`
  - `source_excerpt`
  - `created_at`
  - `last_reinforced_at`

### 2. Projection Layer: Relationship Cards
- 从账本结算两类卡片：
  - `group_memory_card`
  - `person_relationship_card`
- 每张卡片必须带：
  - `summary_text`
  - `actors`
  - `context_before`
  - `trigger`
  - `interaction`
  - `outcome`
  - `importance_score`
  - `freshness_score`
  - `decayed_score`
  - `source_event_ids`
  - `source_message_ids`
  - `manual_state`，例如 `normal | pinned | downranked | archived`
  - `created_at`
  - `updated_at`
  - `last_hit_at`
- LLM 生成 relationship card 时，第一版严格限制为最小 7 字段 schema：
  - `actors`
  - `context_before`
  - `trigger`
  - `interaction`
  - `outcome`
  - `evidence_message_ids`
  - `summary_text`
- 其他字段例如分数、衰减、时间戳、人工状态，不由 LLM 生成，统一由系统层补齐

### 3. Runtime Consumption
- 运行时只消费卡片，不直接读账本流水。
- 第一版只允许在明确的入口消费关系卡片：
  - prompt assembly
  - Stage 2 之后、主循环之前的上下文拼装
- 运行时消费必须受预算控制：
  - 群公共卡片最多 N 条
  - 当前发言人关系卡片最多 M 条
  - 最近互动过的其他 1-2 人关系卡片最多 P 条
  - 优先按 `decayed_score` 和最近命中排序

### 3.5 Retrieval And RAG Orchestration
- 第一版检索形态固定为：
  - `BM25` 召回
  - `embedding` 召回
  - `RAG` 编排与上下文装配
- 不做第三套并列“RAG 索引”。RAG 负责：
  - 合并两路候选
  - 去重
  - 重排
  - 裁剪为最终 prompt budget 内的 top-K
- `BM25` 主要覆盖：
  - 名字、称呼、共享梗关键词、固定短语
  - `actors / trigger / outcome` 中可关键词命中的字段
- `embedding` 主要覆盖：
  - 语义近似
  - 续话
  - 相似场景
- 检索前先做硬过滤：
  - 当前群
  - 当前发言人
  - 最近互动 1-2 人
- relationship card 必须同时支持：
  - 文本索引
  - embedding 索引
  - 结构化追溯展示

### 4. Operator Surface
- admin/backend 提供：
  - ledger event list
  - relationship card list
  - card detail with traceability
  - manual actions: pin / downrank / archive
- admin/frontend 至少提供：
  - 某张卡片的来源消息引用
  - 当前衰减状态
  - 最近命中时间
  - 这张卡片是否已进入运行时

## Data Flow
1. 新消息进入系统
2. provider-service 在异步或准异步路径上识别是否形成关系事件
3. 事件写入 ledger
4. 当主 AGENT 即将触发 compact 时，检查 relationship memory 是否满足独立触发条件
   - relationship memory 与 transcript compact 共用检查时机
   - 但保留独立 `enabled` 开关和独立最小触发条件
   - 例如最少新增 turns、最少新增 ledger events
   - 主控制节奏仍以 compact 为主，独立阈值只负责避免每次 compact 检查都重算
5. relationship memory job 基于 ledger 事件与来源消息生成结构化 cards
6. cards 建立 `BM25` 与 `embedding` 检索材料
7. 运行时按预算执行双召回，再由 RAG 层做合并与装配
8. admin 面板允许查看、追溯、修剪 cards

## Storage Boundaries
- 所有共享持久化逻辑收口到 `packages/persistence`
- provider-service 只调用 persistence API，不自己散落 SQL
- admin/backend 只通过 persistence 或明确服务接口读写

## Key Engineering Decisions To Lock In
- 事件表和卡片表是否拆开，建议拆开，不要混成一张“又是事实又是摘要”的表
- `source_message_ids` 是否允许多条，建议允许数组，否则共享梗无法表达“反复发生”
- 衰减是否写死在存储层，建议保留原始权重和时间戳，把衰减结果做成可重算字段
- 人工 pin 是否绕过衰减，建议不绕过，只提高下限，避免“永不褪色的人工设定”
- 群公共卡片和单人关系卡片冲突时，建议运行时先单人后群公共
- retrieval 形态是否三套并列，已锁定为否。第一版固定是 `BM25 + embedding` 双召回，`RAG` 只做编排层
- 摘要结算位置已锁定：不在主消息链路同步生成，而是在 compact 检查点附近异步生成
- compact 与 relationship memory 已锁定为“同触发点，不同任务”
- relationship memory 的刷新节奏已锁定为“主要受 compact 控制，独立阈值只做去噪”，不发展成独立主时间线
- 表里如一约束已锁定：relationship memory 必须有独立 job 表，cards 只是结果，不充当执行状态
- 人工管理已锁定为独立 override 层，不直接覆盖自动 cards
- 失败策略已锁定为 `stable-last-good`

## Risks
- 过早抽象，第一版事件类型太多，结果没有一条真正稳定
- 卡片摘要过于文学化，最后像人设文本，不像可验证关系
- 追溯链不完整，运营看到卡片却找不到来源消息
- 衰减策略过弱，旧梗永远不死
- 衰减策略过强，关系刚形成就消失
- Stage 2 和长期关系系统混线，最后谁负责“该不该说”都说不清

## Implementation Phases

### Phase 1: Schema And Persistence
- 定义 ledger event schema
- 定义 relationship card schema
- 提供 persistence repository / service API
- 为追溯字段和人工状态建好索引与枚举

### Phase 2: Event Generation
- 在 provider-service 中实现最小事件识别器
- 第一版只做 3 个高价值事件：
  - `shared_joke_formed`
  - `reply_chain_success`
  - `topic_reactivated`
- 明确 defer 到后续 TODO 的事件：
  - `user_reengaged_xiaoni`
  - `relationship_cooled`
- 加最小测试集，确保同一互动不会被重复记账

### Phase 3: Card Projection
- 实现从 ledger 到 cards 的结算逻辑
- 实现衰减、重复强化、最近命中更新
- 卡片输出必须是“结构化字段 + 短摘要文案”的双层格式，而不是纯散文摘要
- LLM 输出必须严格 schema-first；解析失败视为 job failure，不接受自由文本兜底
- 增加 regression tests，覆盖旧梗降权和再次激活

### Phase 4: Runtime Integration
- 明确 runtime card read API
- 加上下文预算、双召回和排序规则
- 验证卡片引用不会把 prompt 拼装炸成垃圾上下文
- 固定 runtime 读取边界：
  - 当前群公共 cards
  - 当前发言人 cards
  - 最近互动 1-2 人 cards
- 在 prompt 层补最小强化约束：
  - 关系卡片是参考，不是绝对真相
  - 若当前真实聊天记录与 cards 冲突，优先信任当前聊天记录
  - 只有当 cards 能帮助轻轻提旧梗、续旧话、体现偏心时才使用，不强行每次提及

### Phase 5: Admin Visibility
- 后台暴露 event/card 查询和人工动作
- 前台做卡片详情和来源追溯
- 明确哪些人工动作会立刻影响运行时，哪些只影响下一次结算
- relationship memory job 状态必须在后台可见，并明确区分：
  - 最新 job 状态
  - 当前 runtime 正在使用的 cards 版本

## Verification
- 单元测试：
  - 事件提取
  - 账本去重
  - 卡片结算
  - 衰减
  - 再激活
- LLM contract tests：
  - 最小 7 字段 schema 完整性
  - `evidence_message_ids` 可解析且非空
  - 非法 JSON / 缺字段时 job 正确失败
- 集成测试：
  - 真实群聊样本生成 ledger -> cards -> runtime read
  - pinned/downranked/archived 对运行时可见性影响
- 检索测试：
  - `BM25` 命中关键词 / 称呼 / 共享梗
  - `embedding` 命中语义续话 / 相似场景
  - RAG 编排后的去重、排序、budget 裁剪
- 失败回退测试：
  - relationship memory job failed 时继续读取上一版 stable cards
  - 后台明确显示最新 job failed 但当前 cards 仍来自上次成功版本
- prompt behavior checks：
  - 有 cards 时不会每次强行提旧梗
  - 当前聊天记录与 cards 冲突时，优先当前聊天记录
  - cards 缺失时，小腻仍能依赖原始聊天记录正常回复
- 人工验证：
  - 至少 3 个真实群聊样本
  - 至少 1 个旧梗自然衰减样本
  - 至少 1 个共享梗再次激活样本

## Open Questions For /plan-eng-review
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
