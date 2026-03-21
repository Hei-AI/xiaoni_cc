# Playground 重构实施进度

## Summary
- 目标：将当前 `/playground` 重构为 Prompt 编辑优先的调试台，主画布默认只保留长 Prompt 编辑和输出观察。
- 已确认：`User Input`、`Params & Tools`、`Compare Nodes` 都改成按需打开的浮窗或抽屉；`Current Output` 按通用 provider 支持 `Text Response`、`Tool Call`、`Raw Provider Response` 三类结果；`Tools` 采用逐项折叠 JSON 编辑，不再使用总 `tools JSON`。
- 规则：每完成一项，就更新对应复选框。

## Progress Checklist

### 0. 方案与约束确认
- [x] 新建本进度文档
- [x] 冻结产品目标：Prompt 编辑优先，不再默认三栏常驻
- [x] 冻结默认布局：主画布 + 底部输出 + 按需浮窗
- [x] 冻结输出模型：`Current Output` / `Compare Nodes`
- [x] 冻结输出子视图：`Text Response` / `Tool Call` / `Raw Provider Response`
- [x] 冻结参数策略：常用参数控件化，高级参数后置
- [x] 冻结 tools 策略：每个 tool 单独折叠编辑 JSON

### 1. 页面骨架与工作区状态
- [x] 拆除当前 playground 固定三栏桌面布局
- [x] 建立页面级 workspace shell 与 dock/floating state
- [x] 保留现有顶部操作：刷新、保存、运行
- [x] 保留现有 query bootstrap：`promptId / trafficId / conversationId`

### 2. Prompt 主编辑区
- [x] 重构 Prompt 主编辑区，默认只突出长 Prompt 编辑
- [x] 将 Prompt 绑定、模式切换收敛到轻量头部控件
- [x] 将 `Rendered Preview` 作为次级视图而不是独立常驻区域

### 3. 辅助面板与浮窗
- [x] 建立 `User Input` 浮窗或抽屉
- [x] 建立 `Params & Tools` 浮窗
- [x] 建立 `Compare Nodes` 停靠与拖出能力
- [x] 让桌面端浮窗支持移动与关闭
- [x] 让窄屏端统一降级为 `Sheet`

### 4. 输出工作区
- [x] 重构底部输出区，仅保留 `Current Output` / `Compare Nodes`
- [x] 移除默认 `Diff vs Previous`
- [x] 实现 `Text Response` 视图
- [x] 实现 `Tool Call` 视图
- [x] 实现 `Raw Provider Response` 视图
- [x] 为结果缺失字段做安全降级和空态

### 5. Params 与 Tools
- [x] 将 `Common Params` 改成滑杆/轻控件
- [x] 保留 provider 选择与 prompt mode 切换能力
- [x] 将 `Tools` 改成逐项折叠 JSON 编辑
- [x] 默认同一时间只展开一个 tool

### 6. 数据归一与结果适配
- [x] 将现有 run 数据归一到新的输出视图模型
- [x] 从 `metadata/rawResponse/canonicalResponse/wireResponse` 推断 tool call 结果
- [x] 兼容普通文本输出
- [x] 兼容 tool/function call 输出

### 7. 验证与回归
- [ ] 验证 `promptId` 入口
- [ ] 验证 `trafficId` 入口
- [ ] 验证 `conversationId` 入口
- [ ] 验证 `Save Case`
- [ ] 验证 `Run`
- [ ] 验证 `Clone Run`
- [ ] 验证桌面端默认工作流
- [ ] 验证移动端降级体验
- [x] `modules/admin-panel/frontend` 下 `npm run build` 通过

## Verification Note
- 本文档用于实施过程跟踪；未勾选项代表尚未做实际交互验收。
- 自动验证已完成：`modules/admin-panel/frontend` 下执行 `npm install` 后，`npm run build` 通过。
