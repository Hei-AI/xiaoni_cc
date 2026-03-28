# Admin Panel Contract Cleanup

## Goal
- 清扫管理端页面与后端真实契约之间的断点，优先消除前端伪默认、伪兜底、伪推导。
- 保证页面显示值优先反映后端真实返回与持久层状态，而不是前端猜测。

## Scope
- `modules/admin-panel/frontend`
- `modules/admin-panel/backend`
- 与上述页面直接相关的共享 hooks/components/types

## Constraints
- 不为了适配前端去新增后端兼容假字段。
- 后端如需修改，只能回归真实契约，不能补造 UI 默认语义。
- 发现真实逻辑冲突时，先记录到 `Decision Log`，不拍脑袋改业务含义。

## Steps
- [x] 建立 execution plan 与首批审计矩阵
- [x] 修正群聊/私聊 Prompt 绑定页对 `agent_prompt_id = null` 的伪默认展示
- [x] 修正 Prompt Debug、Dashboard、Traffic 页面对缺失字段的伪默认展示
- [x] 修正 UnifiedTimeline 对缺失 `prompt_template` / `model_name` 的伪默认展示
- [x] 修正 debug trace backend 对 `unknown/default` 的伪默认返回
- [x] 继续审计 Conversations、Run Trace、Playground、Inbox/Queue 剩余断点
- [x] 汇总真实逻辑冲突并按“无默认模型、无伪值、显式输入”完成裁决与实现

## Audit Matrix
| 页面/组件 | 调用接口 | 后端契约字段 | 原问题 | 修复动作 |
| --- | --- | --- | --- | --- |
| GroupChatDetailPage | `/api/group-chats/:groupId` `/api/group-chats/:groupId/prompt` | `group_settings.agent_prompt_id` | `null` 被展示成“默认（xxx）” | 改为显式展示“未绑定”或“已绑定但模板不可用” |
| PrivateChatDetailPage | `/api/private-chats/:userId` `/api/private-chats/:userId/prompt` | `user_settings.agent_prompt_id` | `null` 被展示成“默认（xxx）” | 改为显式展示“未绑定”或“已绑定但模板不可用” |
| UnifiedTimeline | `/api/debug/conversation/:conversationId/llm-flow` | `prompt_template` `model_name` | 缺值时硬编码 `enhanced_chat` / `gemini-2.5-flash` | 改为仅显示后端返回值；缺值显示“后端未返回/未配置” |
| PromptDebugPage | `/api/prompts/:id` | `model_name` | 缺值时硬编码默认模型 | 改为显示“未配置” |
| DebugPromptModal | `/api/debug/prompt-v2` | `model` | 调试弹窗内置固定模型列表与默认值 | 改为模型 ID 手填；不再自动代填默认模型 |
| PromptEditPage | `/api/prompts` `/api/debug/prompt-v2` | `model_name` | 表单初值、保存、调试、配置预览会自动补默认模型 | 改为强制显式输入模型 ID；缺失直接阻止保存/调试 |
| DashboardPage | `/api/conversations` | `model_name` | 缺值时展示英文假默认 | 改为统一显示“未配置” |
| PromptManagementPage / PromptDetailPage | `/api/prompts` `/api/prompts/:id` | `model_name` | 缺值时展示“未指定模型/未指定” | 改为统一显示“未配置” |
| HttpTrafficMonitorPage / DetailPage | `/api/traffic/*` | `container_name` `api_type` | 缺值时硬编码 `provider-service` / `AI API` / `普通请求` | AI 请求缺字段显示“后端未返回”；非 AI 请求显示“非 AI 请求” |
| QueueManagementPage | `/api/inbox/*` | `peerName` `latestSenderName` `replyToSender` 等 | 缺值时用 `-` 吞掉真实缺失状态 | 改为统一显示“后端未返回” |
| PlaygroundPage | `/api/playground/*` | `providerConfig.model.name` `prompt.model_name` | 继承逻辑会把 provider 默认模型伪装成真实配置 | 改为仅保留显式 override 或 Prompt 自带模型；未配置时明确显示“未配置” |
| debug-routes llm-flow | `/api/debug/conversation/:conversationId/llm-flow` | `agent_type` `prompt_template` `model_name` `model_provider` | backend 返回 `unknown/default` 假值 | 改为 `null`，把缺失状态原样暴露给前端 |
| prompt-routes | `/api/prompts` `/api/prompts/:id` | `model_name` | create/update 时把缺失模型写成默认模型 | 改为真实落库 `null` |
| debug-routes prompt-v2 | `/api/debug/prompt-v2` | `model` | 执行期使用默认模型兜底 | 改为缺失模型直接报错 |
| traffic-log-watcher | 流量入库 | `container_name` | 入库时把缺失容器名写成 `provider-service` | 改为真实保留 `null` |
| provider-config / playground-run-service / playground-case-builder | Playground 共享配置与执行链 | `providerConfig.model.name` | 多处基于 provider 自动推默认模型 | 改为允许模型缺失；仅在执行前校验显式模型 |

## Progress Log
- 2026-03-28: 建立计划并完成首批“伪默认/伪推导”清扫，覆盖群聊/私聊 Prompt 绑定、UnifiedTimeline、PromptDebug、Dashboard、Traffic、debug trace backend。
- 2026-03-28: 完成第二批契约清扫，覆盖 Prompt 编辑/调试、Prompt 管理/详情、Playground 共享 provider config/执行链、Queue、Traffic Detail；去除 `Prompt.model_name` 与 Playground 执行的默认模型补值。
- 2026-03-28: 对 Conversations、Run Trace、GroupManagement、PrivateChatManagement 做剩余审计；当前未发现新的“前端伪默认 / 后端伪返回”断点。
- 2026-03-28: 复跑 `modules/admin-panel/frontend` 与 `modules/admin-panel/backend` 的 `npm run build`，通过；计划范围内未再发现待处理断点，转入 `completed/` 归档。

## Decision Log
- 2026-03-28: 前端缺失字段展示统一采用“未绑定 / 未配置 / 后端未返回”，不再把缺值映射成具体 Prompt、模型或容器名。
- 2026-03-28: debug trace backend 不再用 `unknown/default` 伪造业务值，直接返回 `null`。
- 2026-03-28: `Prompt.model_name` 不是业务默认字段；create/update/read 都不得自动补默认模型。
- 2026-03-28: Prompt 编辑页与调试页不存在“合法输入默认模型”；模型 ID 必须用户显式输入。
- 2026-03-28: `/api/debug/prompt-v2` 与 Playground 执行链不允许执行期默认模型；缺失模型时必须报错或保持未配置，而不是自动补值。
- 2026-03-28: MITM 流量监控必须保留真实缺失状态；`container_name` 等字段不允许入库时伪造 `provider-service`。
- 2026-03-28: Dashboard、Queue、Traffic Detail 等观测页不允许再用 `unknown`、`-`、`N/A` 等占位词吞掉后端缺失值。

## Verification
- 前端：`modules/admin-panel/frontend` 执行 `npm run build`
- 后端：`modules/admin-panel/backend` 执行 `npm run build`
- 回归重点：Prompt 绑定详情、Prompt 编辑/调试、Playground 样本执行、Traffic Detail、Queue 管理、对话 trace 详情页
