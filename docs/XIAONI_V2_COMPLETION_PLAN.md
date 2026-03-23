# 小腻 V2 收口计划

## Summary

- 目标：把 V1 架构文档中已经承诺、但在代码里尚未完整闭环的能力收口到 V2。
- V2 不是推翻 V1；V2 只补完 4 类缺口：
  - 独立 `RelationshipMemory` 子系统
  - 管理端“查看与纠偏”从只读升级为可写闭环
  - “虚拟行走”从隐式 scope 机制升级为显式社交场域图谱
  - 主动行为从“只有 `followup_queue` 真执行”升级为“计划/关系/信念触发统一编译到执行层”
- 路演目标：用户能看到小腻不是“只会回消息”，而是“能解释自己为什么记住、为什么判断、为什么出现在某个场域、为什么主动联系某个人”。

## V1 缺口映射

| 原始设计承诺 | 当前实现状态 | V2 收口方式 |
| --- | --- | --- |
| `RelationshipMemory` 独立存在 | 只有表，缺少核心读写/API/UI/上下文接入 | 实现关系记忆写回、检索、纠偏、展示与触发 |
| 后台支持“记忆/信念查看与纠偏” | 目前 cognition 基本只读，只有 proactivity 可写 | 增加 belief/memory/relationship 的 patch、审核和审计链路 |
| “虚拟行走”是社交场域图谱 | 目前主要靠 `field_scope` / `target_field_scope` 隐式近似 | 增加显式 field node / edge / field score / walk candidate 模型 |
| 主动行为可来自 `followup_queue`、`weekly_focus`、明确 `belief/relationship trigger` | 当前真正执行的主要只有 `followup_queue` | 增加 trigger compiler，把战略计划和关系/信念触发统一编译成可执行 followup |

## V2 To Do

### 1. Relationship Memory 端到端落地

- 新增关系记忆写回链路：daily / weekly reflection 从记忆与 belief 中抽取关系结论，写入 `agent_relationship_memories`。
- 新增关系记忆读取链路：针对当前消息目标用户，向上下文注入关系摘要、互动风格和边界策略。
- 新增关系记忆管理接口：列表、详情、证据链、人工纠偏、禁用、重建。
- 新增关系记忆 UI：独立 tab，支持按用户、群、状态查看与修正。
- 新增 relationship-aware proactivity：followup 发送前必须读取 boundary / interaction_style。

### 2. Cognition 可写纠偏闭环

- 为 belief、memory、relationship 增加 patch API。
- 新增认知编辑审计表，记录 before/after、操作者、原因、影响范围。
- 增加“纠偏后重算”能力：
  - belief 修正后，相关 stable memory 重新评估
  - memory 禁用后，相关 followup_queue 重新筛选
  - relationship boundary 调整后，主动行为策略立即收敛
- 管理端增加“预览影响”与“确认提交”两段式交互。

### 3. 虚拟行走显式图谱化

- 新增社交场域节点模型：私聊、群聊、线程、工具入口。
- 新增场域边模型：信息流、关系入口、计划入口、工具入口。
- 新增场域优先级计算：近期互动、未完成承诺、关系强度、计划命中、主动冷却、人工限制。
- 新增 `walk candidate` 产出：每轮后台 tick 先决定“小腻该去看哪里”，再决定“要不要说话”。
- 管理端增加场域视图：看当前高优先级场域、入选原因、被抑制原因。

### 4. 主动行为编译层

- 保持 `weekly_focus` / `day_plan` 作为战略计划，不直接发送消息。
- 新增 trigger compiler：
  - 输入：`weekly_focus`、`day_plan`、relationship trigger、belief trigger
  - 输出：带来源解释的 `followup_queue`
- 为 `followup_queue` 增加来源元数据：来源计划、来源记忆、来源关系、触发理由。
- 为 `micro_intention` 增加回合闭环：消息处理完成后自动完成/取消旧 micro_intention，避免长期悬挂。

### 5. 路演版本硬化

- 增加一组可复现 demo 数据与种子脚本。
- 增加 3 条路演主线：
  - 关系纠偏后，主动行为立即收敛
  - 场域图谱驱动“为什么今天去这个群/这个私聊”
  - 战略计划如何被编译成真实 followup 并留下解释链
- 补充截图、只读 demo 模式、固定筛选参数与一键清空/重置脚本。

## Detailed Design

### A. 数据模型

#### A1. `agent_relationship_memories` 扩展

- 保留现有表，追加以下字段：
  - `source_reflection_id BIGINT UNSIGNED NULL`
  - `last_evidence_id BIGINT UNSIGNED NULL`
  - `last_observed_at DATETIME(3) NOT NULL`
  - `is_current TINYINT(1) NOT NULL DEFAULT 1`
  - `boundary_strategy VARCHAR(64) NULL`
  - `notes_json JSON NULL`
- 约束与索引：
  - `(target_user_id, group_id, is_current, updated_at)` 组合索引
  - `source_reflection_id`、`last_evidence_id` 外键
- 语义规则：
  - 同一 `(target_user_id, group_id)` 只允许 1 条 `is_current=1`
  - 新快照写入时，旧快照自动置为 `is_current=0`

#### A2. 新增 `agent_cognition_edits`

- 字段：
  - `id`
  - `entity_type ENUM('belief','memory','relationship')`
  - `entity_id`
  - `action_type ENUM('patch','disable','promote','rebuild')`
  - `reason TEXT NOT NULL`
  - `before_json JSON NOT NULL`
  - `after_json JSON NOT NULL`
  - `impact_json JSON NULL`
  - `operator_id VARCHAR(64) NOT NULL`
  - `created_at DATETIME(3) NOT NULL`
- 用途：
  - 审计认知纠偏
  - 支撑管理端 diff
  - 为回滚和回放提供事实基础

#### A3. 新增场域图谱表

- `agent_social_fields`
  - 一个节点一行
  - 字段：`field_key`, `field_scope`, `user_id`, `group_id`, `thread_key`, `title`, `status`, `last_active_at`
- `agent_social_edges`
  - 一条关系边一行
  - 字段：`source_field_key`, `target_field_key`, `edge_type`, `weight`, `last_observed_at`
- `agent_field_scores`
  - 当前优先级快照
  - 字段：`field_key`, `priority_score`, `inbound_score`, `relationship_score`, `plan_score`, `cooldown_penalty`, `suppression_reason`, `computed_at`

### B. qqbot-core 设计

#### B1. Relationship memory pipeline

- 在 `AgentMemoryService` 新增：
  - `syncRelationshipMemories(reflectionId, kind, now)`
  - `getRelationshipContextForMessage(message)`
  - `patchRelationshipMemory(input)`
- 反思写回规则：
  - 只从 `memory_type='relationship'` 或高置信度 user belief 中生成
  - 若缺少明确证据，不生成 current snapshot
  - 若关系判断冲突，保留旧快照为历史，写入新快照并标记原因
- 上下文注入规则：
  - 对私聊：最多注入当前用户 1 条 current relationship snapshot
  - 对群聊：优先注入当前发言用户在该群的 local relationship snapshot；缺失时回退 user-global

#### B2. Cognition correction pipeline

- `DatabaseManager` 增加：
  - `patchBelief`
  - `patchMemory`
  - `patchRelationshipMemory`
  - `insertCognitionEdit`
- patch 语义：
  - belief patch 不原地覆盖旧事实；旧记录改 `status='revised'`，新记录插入
  - memory disable 只改状态，不删历史
  - relationship patch 生成新 snapshot，不覆盖历史
- patch 后派生更新：
  - relationship / memory / belief 更新后，异步触发 `recomputeDerivedPlansForSubject`
  - 若影响当前 `followup_queue`，只取消未执行项，不回滚已执行 action log

#### B3. Virtual walk planner

- 新增 `VirtualWalkService`
  - `refreshFieldGraph(now)`
  - `computeFieldScores(now)`
  - `listWalkCandidates(limit)`
  - `materializeTriggers(now)`
- 评分公式固定为加权和：
  - `priority_score = inbound + relationship + plan + novelty - cooldown - boundary_penalty`
- 输入来源：
  - 近 72 小时 observations
  - active plans
  - current relationship memories
  - recent action logs
- 输出用途：
  - 仅产出候选与解释，不直接发消息
  - 由 trigger compiler 决定是否转为 `followup_queue`

#### B4. Trigger compiler

- 新增 `ProactivityCompilerService`
  - `compileStrategicPlansToFollowups`
  - `compileRelationshipTriggersToFollowups`
  - `compileBeliefTriggersToFollowups`
- 编译规则：
  - `weekly_focus` / `day_plan` 是上游策略，不直接执行
  - 编译结果统一写 `agent_plans(plan_type='followup_queue')`
  - 每条 followup 必须有 `trigger_condition`，内容包含来源摘要
- 去重规则：
  - 同一用户 24 小时内最多保留 1 条 queued `followup_queue`
  - 若已有 active/queued item，仅提升理由与优先级，不重复插入
- 边界规则：
  - relationship memory 的 `boundary_strategy` 为 hard gate
  - 任何 boundary deny 都禁止编译出可执行 followup

#### B5. Micro intention lifecycle

- 保留 `micro_intention` 为回合内计划，不做后台执行器。
- 在消息主链中：
  - 入站开始时 upsert
  - 回复完成后标记 `completed`
  - 被过滤、跳过或超时则标记 `cancelled`
- 管理端只展示最近 24 小时的 micro intentions，防止列表污染

### C. Admin Backend 设计

- 新增接口：
  - `GET /api/cognition/relationships`
  - `PATCH /api/cognition/relationships/:id`
  - `PATCH /api/cognition/beliefs/:id`
  - `PATCH /api/cognition/memories/:id`
  - `GET /api/cognition/edits`
  - `GET /api/cognition/fields`
  - `GET /api/cognition/fields/:fieldKey`
- patch API 统一请求结构：
  - `reason`
  - `patch`
  - `preview_only`
- preview 返回：
  - `before`
  - `after`
  - `impact_summary`
  - `affected_plan_ids`

### D. Admin Frontend 设计

- `CognitionPage` 拆分为 3 个主工作流：
  - `Memory & Belief`
  - `Relationships & Fields`
  - `Plans & Proactivity`
- 新增关系 tab：
  - 左侧列表：当前关系快照
  - 右侧详情：summary / style / boundary / evidence / edit history
- 新增 field tab：
  - 列表展示而非复杂画布起步
  - 每个场域显示 `priority_score`、最近活动、命中计划、抑制原因
- 新增纠偏对话框：
  - 原值
  - 修改值
  - 影响预览
  - 提交理由

### E. 路演设计

#### E1. 路演主线 1：关系纠偏闭环

- 初始状态：某用户被系统判断为可主动跟进
- 操作：在 admin 中把该用户 `boundary_strategy` 改为 `observe_only`
- 结果：
  - 新 followup 不再生成
  - 当前 queued followup 被取消
  - 页面能展示“为什么取消”

#### E2. 路演主线 2：虚拟行走解释性

- 初始状态：私聊 A、群聊 B、群聊 C 同时存在
- 操作：打开 field 视图
- 结果：
  - 系统能说明为什么今天优先看群聊 B
  - 解释项包括：近 24h 新消息、关系强度、计划命中、冷却状态

#### E3. 路演主线 3：战略计划到真实执行

- 初始状态：weekly reflection 生成 `weekly_focus`
- 过程：
  - trigger compiler 把战略计划编译为 `followup_queue`
  - proactivity executor 消费
  - action log 留痕
- 结果：
  - 用户能看到完整链路：`weekly_focus -> followup_queue -> action_log`

## Implementation Order

1. 数据库迁移：`relationship` 扩展、`cognition_edits`、`social_fields`、`field_scores`
2. qqbot-core：relationship pipeline、patch pipeline、trigger compiler
3. qqbot-core：virtual walk planner 与 field score materialization
4. admin backend：新增 relationships / edits / fields / patch routes
5. admin frontend：relationships tab、field tab、patch preview dialog
6. 路演硬化：demo seed、只读 demo 模式、固定脚本与截图

## Acceptance Criteria

- 存在真实可读的 `RelationshipMemory` current snapshot，且会进入上下文
- belief / memory / relationship 可在 admin 中纠偏，并留下 edit audit
- 系统能列出当前 top 场域及其解释
- `weekly_focus` / `day_plan` / relationship trigger / belief trigger 都能被编译成可解释的 `followup_queue`
- `followup_queue` 的每条记录都能追溯来源
- 路演脚本能在本地和部署环境稳定重放

## Non-Goals

- 不引入多代理社会仿真
- 不引入地理地图或物理位置系统
- 不引入新的对外产品形态；仍保持 `NapCat -> qqbot-core -> admin-panel`
