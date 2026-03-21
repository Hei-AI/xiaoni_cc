# 对话时间线 Trace Canvas 实施进度

## Summary
- 目标：将当前 `/conversation/:conversationId/timeline` 重构为 Dify 风格的 Trace Canvas 页面，用有向连线卡片承载一次真实执行过程。
- 已确认：采用 `@xyflow/react` 作为画布内核；页面壳子和 inspector 复用现有 `console/*` 与 `ui/*` 组件；节点拖动仅本次会话生效，不做本地或服务端持久化。
- 规则：每完成一项，就更新对应复选框。

## Progress Checklist

### 0. 方案与约束确认
- [x] 明确产品目标：页面用于排障，不是工作流编排器
- [x] 明确表现形态：Dify 风格画布，卡片可拖动，连线有方向
- [x] 明确数据范围：v1 仅使用现有 `/api/debug/conversation/:conversationId/trace`
- [x] 明确交互边界：拖动位置仅本次会话有效，不做持久化
- [x] 明确实现策略：画布内核用 `@xyflow/react`，不复用旧时间线组件
- [x] 明确对比结论：固定布局有向图优先，但实现保留卡片拖动能力

### 1. 依赖与页面骨架
- [x] 在 `modules/admin-panel/frontend` 引入 `@xyflow/react`
- [x] 为 Trace Canvas 页面建立新的组件结构，不在旧页面里继续堆 if/else
- [x] 保留现有页面路由 `/conversation/:conversationId/timeline`
- [x] 复用现有页面壳：`PageShell` / `SectionPanel` / `MetricCard`
- [x] 保留顶部操作：返回、自动刷新、刷新、调试 Prompt
- [x] 将页面拆成三块：摘要头、画布区、右侧 inspector

### 2. 视图模型与数据归一
- [x] 新增展示类型：`TraceFlowNodeKind`
- [x] 新增展示类型：`TraceFlowNode`
- [x] 新增展示类型：`TraceFlowInspectorSection`
- [x] 新增展示类型：`TraceFlowViewModel`
- [x] 实现 `buildTraceFlowViewModel(trace)`
- [x] 实现稳定排序规则：优先 `started_at`，回退 `completed_at`、序号、原始顺序
- [x] 将 `lifecycle_spans` 归一为主阶段节点
- [x] 将 `agent_turns` 归一为 Turn 容器节点
- [x] 将 `llm_calls` 归一为 LLM 子节点
- [x] 将 `tool_calls` 归一为 Tool 子节点
- [x] 将 `http_requests` 归一为 HTTP 子节点
- [x] 将 `delivery + final outcome` 归一为末尾结果节点
- [x] 处理 `unattributed_http` 挂载到所属 Turn
- [x] 处理缺失字段时的安全降级，确保页面不崩

### 3. 画布布局与连线
- [x] 建立 XYFlow 画布容器
- [x] 支持平移、缩放、Fit View
- [x] 支持卡片拖动
- [x] 关闭节点位置持久化
- [x] 定义主阶段节点初始布局：Ingress → Queue → Context → Decision → Turn → Delivery → Terminal
- [x] 定义 Turn 容器内部子图布局
- [x] 定义 LLM → Tool → HTTP 的有向边规则
- [x] 为边增加箭头，明确执行方向
- [x] 支持 Minimap 和基础缩放控件
- [x] 保证节点拖动后边连线正常跟随

### 4. 节点卡片设计
- [x] 实现 Phase 节点卡片
- [x] 实现 Turn 容器卡片
- [x] 实现 LLM 节点卡片
- [x] 实现 Tool 节点卡片
- [x] 实现 HTTP 节点卡片
- [x] 实现 Delivery 节点卡片
- [x] 实现 Terminal / Outcome 节点卡片
- [x] 为不同节点类型配置统一的颜色、图标、摘要字段
- [x] 节点正文只保留高价值摘要，不默认铺原始 JSON
- [x] 当前选中节点具备高亮状态

### 5. Inspector 详情面板
- [x] 点击节点时同步更新 inspector
- [x] inspector 展示标题、状态、耗时、摘要
- [x] inspector 提供 `Overview` 视图
- [x] inspector 提供 `Input` 视图
- [x] inspector 提供 `Output` 视图
- [x] inspector 提供 `Evidence` 视图
- [x] 对 JSON / 文本内容做安全展示与滚动容器处理
- [x] 为缺失 input/output/evidence 的节点提供空态说明

### 6. 页面摘要与异常态
- [x] 顶部摘要展示：总耗时
- [x] 顶部摘要展示：最终状态
- [x] 顶部摘要展示：Agent Turns 数
- [x] 顶部摘要展示：LLM / Tool / HTTP 数
- [x] 顶部摘要展示：瓶颈
- [x] 顶部摘要展示：首个错误
- [x] 处理加载中状态
- [x] 处理接口失败状态
- [x] 处理 trace 数据为空状态
- [x] 处理 `generated_not_sent`
- [x] 处理 `ended_no_reply`
- [x] 处理 `failed`

### 7. Raw Evidence 与辅助信息
- [x] 将页面级 `Raw Evidence` 改为折叠区或辅助区，不占主视觉
- [x] 保留完整原始证据访问能力
- [x] 暴露 data quality 信息但降级展示，不干扰主阅读路径
- [x] 保留 trace_id / batch_id 等关键调试标识

### 8. 移动端与响应式
- [x] 桌面端采用“画布 + 右侧 inspector”
- [x] 窄屏时 inspector 降级为底部抽屉或 Sheet
- [x] 保证顶部摘要在平板/移动端不炸布局
- [x] 保证节点卡片在窄屏下仍可读
- [x] 保证画布在移动端可横向查看或缩放浏览

### 9. 验证与验收
- [x] `npm run build` 通过
- [ ] 验证简单链路：单 Turn、单 LLM、无 Tool
- [ ] 验证完整链路：LLM → Tool → HTTP → LLM → terminal tool
- [ ] 验证 `generated_not_sent`
- [ ] 验证 `ended_no_reply`
- [ ] 验证 `failed`
- [ ] 验证时间戳缺失/异常情况下排序稳定
- [ ] 验证 `unattributed_http` 未丢失
- [ ] 验证点击节点后 inspector 正确切换
- [ ] 验证拖动节点后边连线跟随正常
- [ ] 验证刷新后布局回到默认状态
- [ ] 验证移动端降级体验可用

## Verification Note
- 按当前指示，以上剩余项均属于手工验收，暂时跳过，不作为本轮实施阻塞项。
- 本轮已完成的自动验证仅包括：`modules/admin-panel/frontend` 下的 `npm run build`。
