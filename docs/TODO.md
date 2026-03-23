# TODO

## Summary

- 本文档只记录当前项目里“实际未完成”的内容，不包含路演 / demo 硬化项。
- 判断标准以代码、测试、运行链和文档一致性为准，不以“已有方案文档打勾”为准。
- 完成规则：功能落地 + 验证完成 + 状态文档同步，才允许勾选。

## P0. 虚拟行走主链收口

### 1. 旧关系系统退场

- [x] 删除 `UserRelationshipService` / `user_relationships` 这套旧关系模型，避免与 `agent_relationship_memories` 形成潜在双源竞争。
- [x] 将关系事实源统一到 `agent_relationship_memories(is_current=1)`，不再保留会误导后续开发的旧主链实现。

验证：
- 运行代码中不再存在 `UserRelationshipService` / `user_relationships` 引用。
- `relationshipContext` 继续由 `agent_relationship_memories` 注入。

### 2. Admin 默认纠偏入口改为专用工作流

- [x] belief 纠偏默认走“置信度 / 状态”专用表单。
- [x] memory 纠偏默认走“启停状态”专用表单。
- [x] relationship 纠偏默认走“边界策略 / 备注”专用表单。
- [x] 默认运营入口不再直接暴露通用 JSON patch 按钮。

验证：
- `CognitionPage` 明面默认入口围绕“关系 -> 候选 -> 行动 -> 纠偏”组织。
- 常用纠偏无需直接编辑原始 JSON。

### 3. 状态文档与真实代码状态对齐

- [x] 新增本文件，作为“实际未完成项”追踪文档。
- [x] 在路线图中明确当前剩余收口项来自 `docs/TODO.md`，不再只引用“完成计划”。
- [x] 在虚拟行走任务文档中补充 post-launch cleanup 指向本文件。

验证：
- 后续审计时，`TODO.md` 与当前代码状态一致。

## P1. 项目级真实未完成项

### 4. Context Engine 占位实现替换为真实查询

- [x] 实现 `getCurrentMessage()` 的真实消息查询。
- [x] 实现 `getRecentMessages()` 的真实历史消息查询。
- [x] 实现 `buildUserInfo()` 的真实用户统计读取。
- [x] 实现 `buildGroupInfo()` 的真实群聊统计读取。

验证：
- `ContextEngine` 不再默认返回 `null`、空数组或纯占位昵称。

### 5. Decision Engine 统计接口不再返回纯模拟值

- [x] 实现 `getDecisionStats()` 的真实数据库统计。

验证：
- 统计结果来自 `conversations`，不再固定返回全 0 结构。

### 6. 针对本轮收口项补验证

- [x] 为 `ContextEngine` 补单元测试。
- [x] 为 `DecisionEngine.getDecisionStats()` 补单元测试。
- [x] 为前端专用纠偏入口补页面验证。

## Remaining

- [x] 虚拟行走主链的更完整端到端回归已补强：candidate 抑制原因、followup 收敛、多轮反馈事件链、群观察/主动白名单和 field detail 的 action/feedback 链路已落地。

验证：
- `database/migrations/046_extend_virtual_walk_feedback_and_group_controls.sql` 已应用。
- `modules/qqbot-core`: `npm run build`
- `modules/qqbot-core`: `npm test -- --runInBand src/services/__tests__/agent-memory-service.test.ts src/engines/__tests__/context-engine.test.ts src/engines/__tests__/decision-engine.test.ts`
- `modules/admin-panel/backend`: `npm run build`
- `modules/admin-panel/backend`: `npm test -- --runInBand src/routes/__tests__/cognition-routes.test.ts`
- `modules/admin-panel/frontend`: `npm run build`
- `modules/admin-panel/frontend`: `npm run test:e2e:cognition`
- 容器已重建并重启：`qqbot-core`、`admin-backend`、`admin-frontend`
- smoke：
  - `GET /api/cognition/proactivity` 返回 `observedGroupIds` / `allowedGroupIds`
  - `GET /api/cognition/fields/:fieldKey` 返回 `recent_action_logs` / `recent_feedback_events`
  - OpenClaw QQ 私聊自测发送到小腻 `1129974489` 返回 `ok=true`
