# Span-First Trace Rebuild Plan

## 背景与目标

现有对话流 Trace 页面依赖专用的 `agent_turns + llm/tool/http + canvas` 聚合模型。它的问题不是视觉风格本身，而是数据模型已经把真实执行语义压扁了：

- `tool` 可能只是一个调用入口，真正执行可能进入另一个 agent 或 workflow
- `agent/http/tool` 被当作固定节点类型，无法自然表达深层嵌套
- `React Flow` 画布把阅读路径交给拖拽和连线，复盘成本高

本次改造直接采用 breaking change 策略，目标是统一成 `trace -> spans` 的通用 tracing 模型，并将 UI 改为标准 waterfall detail 页面。

成功标准：

- 主视图不再依赖 `React Flow`
- 前后端统一以 span-first DTO 工作
- 页面能自然表达嵌套 agent、tool-backed agent、workflow 和 HTTP
- 文档中的 checklist 逐项完成并打勾

## 目标架构

### Trace / Span

- `trace` 表示一次完整执行
- `span` 表示一个带时间范围的工作单元
- 结构由 `parent_span_id` 决定
- 非树关系通过 `links` 表示
- 关键时刻通过 `events` 表示
- 业务语义全部通过 `attributes` 表示

### UI 目标

- 顶部 `Trace Summary`
- 中间 `Span Waterfall`
- 右侧 `Span Detail`
- 顶部 breadcrumb 只显示当前选中 span 路径，不再承担主视图结构职责

## 数据模型

### 核心表

- `traces`
- `spans`
- `span_attributes`
- `span_events`
- `span_links`
- `trace_attributes`

### 关键字段

`traces`

- `trace_id`
- `root_span_id`
- `conversation_id`
- `status`
- `started_at`
- `ended_at`
- `duration_ms`
- `span_count`
- `error_count`

`spans`

- `span_id`
- `trace_id`
- `parent_span_id`
- `name`
- `kind`
- `status_code`
- `status_message`
- `started_at`
- `ended_at`
- `duration_ms`
- `depth`
- `sort_key`
- `service_name`
- `operation_name`
- `conversation_id`

### 业务语义 attributes

- `semantic.role`
- `semantic.actor`
- `semantic.capability`
- `semantic.display_name`
- `llm.model_name`
- `llm.model_provider`
- `tool.name`
- `tool.method_id`
- `http.method`
- `http.url`
- `http.host`
- `http.path`
- `http.status_code`
- `usage.input_tokens`
- `usage.output_tokens`
- `error.type`
- `error.code`

## 实施规则

- 以 OTel 核心概念对齐命名
- 业务类型只放 attributes，不参与树结构定义
- 前端只根据 `parent_span_id` 渲染层级
- tool、child agent、workflow 一律按 span 嵌套表达
- events 默认不升级为主视图节点，除非具有明确时间范围
- 若某条链路无法表达成 span，则补埋点，不在前端猜

## 验收场景

- 普通 agent 一轮 LLM + tool + http
- 一个 agent 多轮 tool
- tool 背后进入 child agent
- child agent 再调 tool，再进入另一个 agent
- 深层 HTTP 报错，错误路径自动展开
- 500+ spans 的 trace 仍可阅读

## 执行进度

### 1. 方案冻结

- [x] 冻结 span-first 数据模型
- [x] 冻结 OTel 对齐字段命名
- [x] 冻结前端 waterfall 交互规则
- [x] 冻结 breaking change 范围

### 2. 数据库

- [x] 新建 `traces` 表
- [x] 新建 `spans` 表
- [x] 新建 `span_attributes` 表
- [x] 新建 `span_events` 表
- [x] 新建 `span_links` 表
- [x] 新建 `trace_attributes` 表
- [x] 完成索引设计
- [x] 完成初始化脚本
- [x] 完成迁移脚本

### 3. qqbot-core 埋点

- [x] 实现 `startSpan`
- [x] 实现 `endSpan`
- [x] 实现 `setSpanAttributes`
- [x] 实现 `recordSpanEvent`
- [x] 实现 `recordSpanLink`
- [x] 接入 ingress span
- [x] 接入 queue/context/decision spans
- [x] 接入 LLM generation span
- [x] 接入 websocket message span

### 4. backend 接口

- [x] 定义 trace DTO
- [x] 定义 span DTO
- [x] 定义 attributes/events/links 输出结构
- [x] 实现新的 conversation trace 查询接口
- [x] 替换旧 `agent_turns/lifecycle_spans` 输出

### 5. frontend 页面

- [x] 删除 Trace Canvas 依赖
- [x] 建立 span view model builder
- [x] 实现 Trace Summary
- [x] 实现 Trace MiniMap
- [x] 实现 Waterfall Row
- [x] 实现树展开/收起
- [x] 实现共享时间轴
- [x] 实现搜索过滤
- [x] 实现错误高亮
- [x] 实现 breadcrumb path
- [x] 实现 detail panel
- [x] 替换原 ConversationTimelinePage

### 6. 测试

- [x] 数据层单元测试
- [x] trace tree 构建测试
- [x] child-agent 嵌套测试
- [x] backend API 构建检查
- [x] frontend 构建检查

### 7. 清理

- [x] 删除旧 trace-flow 专用模型
- [x] 删除 React Flow 相关 trace 组件
- [x] 更新相关开发文档
