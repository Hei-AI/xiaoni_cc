# 小腻 V1 实施进度

## Summary

- 目标：把“小腻 V1 认知架构（单代理虚拟行走）”从架构文档逐步落到仓库实现。
- 当前冻结原则：
  - `Observation 全量记录，Belief 持续修正，Long-term Memory 延迟升格`
  - 每回合固定上下文段落：`Self Model`、`Current Internal State`、`Active Plans`、`Retrieved Stable Memories`、`Recent Evidence`
  - 长期记忆只通过明确事实、明确承诺、重复信号、daily / weekly reflection 升格
  - compaction 前只 flush，不直接重写 stable memory
  - 主动行为只能来自 `followup_queue`、`weekly_focus` 或明确 `belief/relationship trigger`
  - embedding 不是 V1 起步前提，但 schema 和服务接线要预留
- 参考来源：
  - `Generative Agents`：认知骨架
  - `OpenClaw`：工程化记忆策略
  - 当前仓库：消息链、上下文链、调度链、OpenAI-compatible embedding 接口
- 更新规则：
  - 所有实现项都必须在本文档中体现
  - 完成即打勾
  - 未完成项不得口头略过

## Progress Checklist

### 0. 文档与旧方案清理

- [x] 新建 [docs/XIAONI_V1_COGNITIVE_ARCHITECTURE.md](/home/liahua/IdeaProject/qq_bot/docs/XIAONI_V1_COGNITIVE_ARCHITECTURE.md)
- [x] 新建 [docs/XIAONI_V1_IMPLEMENTATION_PROGRESS.md](/home/liahua/IdeaProject/qq_bot/docs/XIAONI_V1_IMPLEMENTATION_PROGRESS.md)
- [x] 删除 `docs/HUMAN_LIKE_PROCESSOR_FLOW.md`
- [x] 删除 `docs/HUMAN_LIKE_PROCESSOR_FLOW_LLM_TOOLS.md`
- [x] 更新 [docs/ROADMAP.md](/home/liahua/IdeaProject/qq_bot/docs/ROADMAP.md)
- [x] 更新 [modules/qqbot-core/CLAUDE.md](/home/liahua/IdeaProject/qq_bot/modules/qqbot-core/CLAUDE.md)
- [x] 清理仓库内对 `HUMAN_LIKE_PROCESSOR_FLOW*.md` 的直接设计依赖引用
- [x] 将新的认知架构文档设为后续 Phase 1 到 Phase 4 的单一事实源

### 1. 数据模型与迁移

- [x] 设计 `agent_observations` 表
- [x] 设计 `agent_beliefs` 表
- [x] 设计 `agent_relationship_memories` 表
- [x] 设计 `agent_self_model` 表
- [x] 设计 `agent_plans` 表
- [x] 设计 `agent_reflections` 表
- [x] 设计 `agent_action_logs` 表
- [x] 设计 `agent_memory_evidence` 表
- [x] 为 Phase 4 预留 embedding 相关字段或关联结构
- [x] 新增 Phase 1 migration（observations / beliefs）
- [x] 新增 Phase 1 hotfix migration（`trace_id` 扩展到 `VARCHAR(128)`）
- [x] 为 Phase 1 常用查询补索引策略

### 2. qqbot-core Observation / Belief

- [x] 在消息入站位置写 observation
- [x] 在消息出站位置写 observation
- [x] 在 reply 锚点解析处写 observation
- [x] 在 tool result 位置写 observation
- [x] 在 tick / scheduler 位置写 observation
- [x] 新增 belief update 基础逻辑
- [x] 实现 belief confidence 升降规则
- [x] 实现 belief 冲突降级为 `revised` / `stale`
- [x] 新增 `DatabaseManager` 的 observation / belief 读写接口

### 3. 上下文注入与 Retrieval

- [x] 扩展 `ContextManager` 以支持 5 段上下文结构
- [x] 注入 `Self Model`
- [x] 注入 `Current Internal State`
- [x] 注入 `Active Plans`
- [x] 注入 `Retrieved Stable Memories`
- [x] 注入 `Recent Evidence`
- [x] 保证 observation 不直接 dump 进 prompt
- [x] 保证 stable memory 默认控制在 4-8 条
- [x] 保证 recent evidence 默认控制在 2-4 条

### 4. Reflection 与 Stable Memory

- [x] 新增 daily reflection job
- [x] 新增 weekly reflection job
- [x] 实现 stable memory promotion
- [x] 实现 evidence 关联
- [x] 实现 reflection 结果落库
- [x] 明确 repeated signal 升格规则
- [x] 明确 explicit fact / commitment 升格规则
- [x] compaction 前仅 flush durable context，不直接改 stable memory

### 5. Self Model / State / Plans

- [x] 新增 self model 数据结构
- [x] 新增 internal state 数据结构
- [x] 新增 `weekly_focus`
- [x] 新增 `day_plan`
- [x] 新增 `followup_queue`
- [x] 新增 `micro_intention`
- [x] 将 reflection 结果接入 self model / plans 更新

### 6. 主动行为与调度

- [x] 在 `ScheduleDispatcher` 上挂 tick
- [x] 在 `ScheduleDispatcher` 上挂 followup 调度
- [x] 实现主动私聊/跟进的触发逻辑
- [x] 限制主动行为只来自 `followup_queue`、`weekly_focus` 或明确 trigger
- [x] 支持暂停开关
- [x] 支持限流规则
- [x] 支持 action log 审计
- [x] 新增 `agent_proactivity_controls` 持久化 runtime 控制表

### 7. Admin Backend API

- [x] 新增 observation 查询接口
- [x] 新增 belief 查询接口
- [x] 新增 stable memory 查询接口
- [x] 新增 evidence 查询接口
- [x] 新增 reflection 查询接口
- [x] 新增 self model / state 查询接口
- [x] 新增 plan / followup 查询接口
- [x] 新增 proactivity pause / resume / rate limit 接口
- [x] Phase 1 先提供只读接口

### 8. Admin Frontend 页面

- [x] 新增 memory / belief 页面入口
- [x] 新增 memory / belief 列表页
- [x] 新增 memory / belief 详情面板
- [x] 新增 evidence 查看区域
- [x] 新增 reflection / plan 查看页
- [x] 新增 self model / internal state 查看页
- [x] 新增 proactivity 控制入口
- [x] Phase 1 先提供只读页面

### 9. Embedding / Hybrid Retrieval 预留

- [x] 确认现有 [embedding-service.ts](/home/liahua/IdeaProject/qq_bot/modules/qqbot-core/src/services/embedding-service.ts) 已采用 OpenAI-compatible `/v1/embeddings`
- [x] 为 stable memory / evidence 检索预留 embedding 接线
- [x] 设计 hybrid retrieval 入口
- [x] 设计 rerank 接口
- [x] 设计 temporal decay 接口
- [x] 保持 Phase 4 之前默认未启用

### 10. 验证与回归

- [x] 验证仓库内不再存在对 `HUMAN_LIKE_PROCESSOR_FLOW*.md` 的直接设计依赖引用
- [x] 验证新文档成为唯一认知架构事实源
- [x] 将 Phase 1 migrations 应用到运行中 MySQL
- [x] 重建并重新部署 `qqbot-core` / `admin-backend` / `admin-frontend`
- [x] 使用真实 QQ 私聊自测 observation / belief 链路
- [x] 验证 `/api/cognition/overview` / `observations` / `beliefs` 返回实际数据
- [x] 验证 `/api/cognition/memories` / `evidence` / `reflections` / `self-model` / `plans` 返回实际数据或空态
- [x] 验证 `followup_queue` 能被后台任务消费，并安全写入 `agent_action_logs`
- [x] 验证 `/api/cognition/proactivity` 可读取和更新 runtime 生效控制项
- [x] 验证 Phase 1 不破坏现有消息处理主链
- [x] 为 belief 提取增加单元测试
- [x] 为 observation / belief 增加单元测试
- [x] 为 context 注入增加单元测试
- [x] 为 reflection / stable memory 增加单元测试
- [x] 为 admin cognition API 增加后端测试
- [x] 为 admin cognition 页面增加构建与交互验证
- [x] `modules/qqbot-core` / `modules/admin-panel/backend` / `modules/admin-panel/frontend` 下 `npm run build` 通过

## Verification Note

- 本文档用于实施过程跟踪；未勾选项代表尚未完成实现或验证。
- 当前已完成的是 Phase 0 文档与引用清理、Phase 1 的 observation / belief 底座、`trace_id` 热修正、stable memory / evidence / reflection 基础链路、5 段上下文注入、reflection 写回 current self model 与 `followup_queue`、`day_plan / weekly_focus / micro_intention` 的计划生成与注入、基于 `ScheduleDispatcher` 后台任务的 followup 消费与 `agent_action_logs` 审计、从环境级护栏升级到 `agent_proactivity_controls` + internal/admin API + Cognition Plans 控制卡的在线 pause/allowlist/rate-limit 控制、运行库迁移与容器重部署、compaction 前 `silent flush` durable context、stable memory / evidence 的 embedding 接线与 hybrid retrieval + rerank + temporal decay、本地与容器构建验证，以及 Cognition 页面 Playwright 交互验证。
