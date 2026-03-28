# Playground Unified Provider Config

## Goal
- 让 Trace 导入到 Playground 的参数，以及 Playground 调试执行时使用的参数，统一使用服务端内部通用 Provider 参数契约。
- 消除 Playground 自己维护的定制化参数形状，避免导入参数和执行参数语义漂移。

## Scope
- `modules/admin-panel/backend`
- `modules/admin-panel/frontend`
- 必要时对齐 `modules/provider-service` 的通用参数契约

## Constraints
- 不能引入第二套 Provider 参数模型。
- Trace 导入和 Playground 运行必须共用同一套配置结构。
- 现有 Playground 页面功能不能因参数结构切换而失效。

## Steps
- [x] 梳理 Playground 当前参数模型与 provider-service 通用参数模型差异
- [x] 后端切换到统一 Provider 参数结构
- [x] 前端 Playground 状态与编辑器切换到统一 Provider 参数结构
- [x] 验证 Trace 导入、Playground 运行、构建与关键路径

## Progress Log
- 2026-03-28: 创建 execution plan，开始统一 Playground 与 Trace 的 Provider 参数契约。
- 2026-03-28: backend `playground-case-builder` 和 `playground-run-service` 已切到 unified provider config；非 span run 改为直接向 provider-service 发送 `configOverride`。
- 2026-03-28: frontend `PlaygroundPage`、`ProviderSettingsPanel`、Prompt 相关页面已切到新 shape helper，清除旧 `provider` / `providerSpecific` 根字段读写。
- 2026-03-28: Playground 首屏增加 `need_case / importing / import_failed / draft_only / ready` 的分层呈现；不再在无 case 时先展示完整空工作台。
- 2026-03-28: `ConversationsPage` 改成左侧选择栈 + 右侧单主工作区；`RunTracePage` 改成固定右侧 inspector；对话流与 Trace 的会话导入入口改为先创建 case，失败后落到 Playground 恢复态，而不是直接盲跳失败页。
- 2026-03-28: 新增 Playground 导入 resolver，按 `exact span > traffic > conversation > none` 解析最佳来源；前端主入口统一先解析再创建 case。
- 2026-03-28: 修复 PostgreSQL 下 Playground 导入 resolver 的参数类型推断问题，`findExactImportableSpan` / `findTrafficFallback` 改为按实参动态拼装条件，不再使用 `(? IS NOT NULL AND ...)`。
- 2026-03-28: 修复 `resolveLlmCallTableName` 在 PostgreSQL 驱动下读取 `information_schema.tables` 结果的列名兼容问题，恢复 `llm_call_logs` 自动发现。
- 2026-03-28: 清理历史 `playground_cases` / `playground_runs` 以及旧联调样本数据，重新生成新的 run trace `runtrace_1774659921910_5d863c96`，验证 Conversations -> Playground 导入成功并能创建 Playground run。
- 2026-03-28: 对话流页面取消内嵌 `Run Workspace`，改成 `/runs/:runId` 独立二级页；`RunTracePage` 的 span 导入增加会话级 fallback，避免 `from-span` 失败时直接把用户留在错误态。
- 2026-03-28: 复跑 `modules/admin-panel/frontend` 与 `modules/admin-panel/backend` 的 `npm run build`，通过；计划范围内的统一参数契约切换已完成，转入 `completed/` 归档。

## Decision Log
- 2026-03-28: 本任务以服务端内部通用 Provider 参数契约为标准，不再让 Playground 保持独立参数形状。

## Verification
- `modules/admin-panel/frontend` `npm run build`
- `modules/admin-panel/backend` `npm run build`
- Trace 导入到 Playground 后参数与后端统一参数一致
- Playground 发起测试运行时直接使用同一套 Provider 参数
