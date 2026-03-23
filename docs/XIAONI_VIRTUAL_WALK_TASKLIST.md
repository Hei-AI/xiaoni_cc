# 小腻虚拟行走逐任务决策清单

## Summary

- 目标锁定为：把小腻做成一个会在 QQ 社交环境中持续“虚拟行走”的单代理，不是普通被动回复 bot，也不是只做认知后台展示。
- 核心闭环固定为：`观察 -> 关系/记忆/计划 -> 场域候选 -> 编译主动行为 -> 执行 -> 用户反馈 -> 下一轮修正`。
- 本文档是后续逐 task 落地与验收的单一事实源。

## 核心定义

- `用户反馈` 定义为：小腻行动之后，真实 IM 世界返回来的可观察结果，包括回复、无回复、接住话题、明确拒绝、承诺推进、admin 人工纠偏。
- `虚拟行走` 定义为：小腻持续观察私聊/群聊/工具信号，形成关系与记忆，决定当前更该看哪个场域，再判断该不该说话，并根据结果修正下一轮行为。
- 所有主动行为仍只允许通过 `followup_queue` 执行。
- 弱信号只参与排序与反思，不直接触发主动外呼。

## 任务清单

### T1. 关系快照主链收口

- [x] 未知关系对象默认 `先观察`，不进入主动链。
- [x] current snapshot 只接受强证据：`memory_type='relationship'`、明确关系型 `belief`、admin patch。
- [x] `preference`、`summary_insight`、`commitment` 只做辅助输入，不直接进入关系事实层。
- [x] 证据稀疏时不生成 current snapshot。
- [x] 上下文、candidate、compiler、followup gate 统一只读 current snapshot。
- [x] 旧 `UserRelationshipService` 不再参与主决策。

### T2. 虚拟行走候选层

- [x] candidate 是 compiler 的正式上游事实，不是只读解释页。
- [x] 候选排序以关系/计划优先，近期互动次之。
- [x] 私聊和群聊进入统一排序池。
- [x] 每个 candidate 物化 `field_key`、`priority_score`、`selected_reason`、`suppressed_reason`、`can_speak_now`、`compiler_inputs`。

### T3. 四类强触发统一 Compiler

- [x] `weekly_focus` / `day_plan` 只提供方向，具体目标用户来自 candidate。
- [x] relationship reopen 条件：`有新 observation/强证据 + cooldown 结束`。
- [x] 同一用户 24h 内命中多个强触发时，只保留 1 条 queued/active followup，解释链合并。
- [x] 强触发固定为：`weekly_focus`、`day_plan`、commitment 型 `belief/memory`、`relationship trigger`。
- [x] 每条 `followup_queue` 写完整来源链：`source_plan_id`、`plan_metadata_json`、trigger sources、dedupe key。

### T4. 正反馈 / 负反馈闭环

- [x] 主动消息发出后 48 小时无响应，视为负反馈候选。
- [x] 明确拒绝/明显冷淡时，边界自动收紧到 `observe_only`。
- [x] 正反馈只提升权重，不自动放宽边界。
- [x] 负反馈会取消未执行 followup、抑制 candidate、增加 cooldown 或收紧边界。
- [x] 正反馈会提升 relationship/candidate/commitment 权重。

### T5. 认知纠偏的派生重算

- [x] 派生重算范围只限当前 subject 及其直接相关 field/plan。
- [x] relationship patch 收紧边界后，立即取消 queued followup，阻止 active 后续继续扩展。
- [x] admin patch 优先，直到新强证据覆盖。
- [x] belief patch 后重评估 stable memory。
- [x] memory patch 后重筛 active/queued followup。
- [x] relationship patch 后重算 candidate/field score/followup。

### T6. Admin 最小可运营面

- [x] 页面定位为运营工作台。
- [x] 第一版专用 patch 表单优先支持：关系边界、belief 置信/状态、memory 启停。
- [x] field/candidate 详情显式展示“为什么现在没说话”的决策链。
- [x] 页面围绕 `关系 -> 候选 -> 行动 -> 纠偏` 组织。

### T7. 路演硬化

- [x] demo 数据风格优先真实聊天轨迹。
- [x] read-only demo mode 允许 preview，禁止 commit。
- [x] 默认主故事线是：`为什么今天看这里`。
- [x] 提供 demo seed / reset / clear 能力。

### T8. 验证与文档回写

- [x] 每个 task 完成即回写文档状态。
- [x] 真实 QQ 自测是必选项。
- [x] 每个 task 都要求部署环境 smoke。
- [x] 本文档状态与代码状态同步更新。

## Test Plan

- T1：验证 current snapshot 单源、生效上下文、boundary gate。
- T2：验证 candidate 列表、统一排序池、suppression reason。
- T3：验证 4 类强触发都能产出单条可追溯 followup。
- T4：验证 48h 无响应、显式拒绝、正反馈提权。
- T5：验证 patch 后的 subject 级派生重算与 queued 收敛。
- T6：验证运营工作台的“查看-追因-纠偏”闭环。
- T7：验证 demo mode 的 preview-only 与三条主线重放。
- T8：验证每个 task 的真实 QQ 自测、部署 smoke 和文档回写。

## Assumptions

- 业务目标优先级高于“把所有认知表都做成可视化”。
- 弱信号永不直接触发主动外呼。
- boundary 是边界语义，热度/正反馈不能自动放宽 boundary。
- 本文档作为后续虚拟行走实现与验收的唯一事实源。

## Validation Notes

- 2026-03-23 已落地：relationship 强证据收口、`agent_walk_candidates` 物化、统一 followup compiler、subject 级 cognition recompute、candidate/admin workbench、demo read-only guard、demo seed/reset/clear 脚本。
- 2026-03-24 已补强：`agent_feedback_events`、群观察/主动白名单、group followup 执行分支、field detail 的 `candidate -> action -> feedback -> suppress` 链路，以及对应 core/backend/frontend 回归。
- 关键实现文件：
  - `modules/qqbot-core/src/services/agent-memory-service.ts`
  - `modules/admin-panel/backend/src/routes/cognition-routes.ts`
  - `modules/admin-panel/frontend/src/pages/CognitionPage.tsx`
  - `modules/admin-panel/frontend/src/lib/cognitionApi.ts`
  - `database/migrations/044_create_agent_virtual_walk_candidates.sql`
  - `database/migrations/045_extend_agent_beliefs_relationship_type.sql`
  - `database/migrations/046_extend_virtual_walk_feedback_and_group_controls.sql`
  - `scripts/demo/seed_virtual_walk_demo.sh`
- 已验证：
  - `modules/qqbot-core`: `npm run build`
  - `modules/qqbot-core`: `npm test -- --runInBand src/services/__tests__/agent-memory-service.test.ts`
  - `modules/admin-panel/backend`: `npm run build`
  - `modules/admin-panel/backend`: `npm test -- --runInBand src/routes/__tests__/cognition-routes.test.ts`
  - `modules/admin-panel/frontend`: `npm run build`
  - `modules/admin-panel/frontend`: `npm run test:e2e:cognition`
  - `curl http://127.0.0.1:9080/api/cognition/proactivity`
  - `curl http://127.0.0.1:9080/api/cognition/fields/:fieldKey`
  - `python3 /home/liahua/.codex/skills/openclaw-send-qq-dm/scripts/send_qq_dm.py --qq 1129974489 --message \"[codex qq dm ...] 虚拟行走链路自测，收到请回1\" --json`
- Post-launch cleanup 与项目级真实未完成项改由 [TODO.md](/home/liahua/IdeaProject/qq_bot/docs/TODO.md) 跟踪，避免把“虚拟行走主链已落地”和“仓库已彻底收口”混写成同一个状态。
