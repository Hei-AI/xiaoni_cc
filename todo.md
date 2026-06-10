# TODO

## 协同同步 - 2026-06-11

给正在处理本文件的 Codex 同事：

### 通信约定

- 这里是本轮多 Codex 协同黑板；写给对方看的状态、阻塞点和口径变更都放在本节，不散落到其他 todo 项里。
- 每次改 `modules/agent-service/src/services/agent-loop-service.ts` 前先读本节，避免两边同时改同一块。
- 如果你已经完成 runtime 代码 / 测试，请在本节补一条“已完成/还剩什么”，我会按这里继续审文档和契约，不抢同一块代码。

### 当前决议

- 用户最新确认：`exec_command` 也是固定消耗，`energy_cost=0.002`。不要保留旧的 `0.030`。
- 本地 skill 消耗先不用复杂识别；当前默认 / 兜底也按 `0.002` 处理。后续如果要精细到具体 skill，再单独做可识别的 skill execution 事件。
- prompt-facing 的 `<system_reminder>` 当前注入应使用 `developer` role。`<STATE>` 也按同一类 runtime reminder 处理，进入上下文时使用 `developer` role；标签可以仍是 `<STATE>`，内容只保留 `energy` / `max_energy`。
- 普通 JSON wrapped tool callback 可以继续统一回传 `energy_cost`、`energy`、`max_energy`；hosted `web_search` 和无法 JSON 包装的本地执行路径才需要 loop 侧追加干净 `<STATE>`。
- 不要恢复这些旧 prompt-facing 分支：`final_answer_turn_control`、`final_answer_idle`、`already_picked` / `runtime_event_snapshot`、`tool_loop_monitor`、`image_task_follow_up`、`turn_control`。
- 如果你正在改 `modules/agent-service/src/services/agent-loop-service.ts`，优先收完 runtime 代码和测试；我这边先不并行改同一块，避免冲突。我会负责继续审文档 / 契约口径。
- 2026-06-11 本轮已完成：runtime 清理代码、对应测试断言、`docs/remind.md` / OpenAI 请求约定 / Start Here / 主 prompt 文档同步；验证已跑 `npm --prefix modules/agent-service test`、`npm --prefix packages/persistence test`、`git diff --check`、`docker compose build agent-service`、`docker compose up -d agent-service`、`docker compose ps agent-service`、`docker compose logs --tail=160 agent-service`、`curl -fsS http://127.0.0.1:8092/health`。

## P0 - Xiaoni Runtime Cleanup

- [x] 拆分 prompt-facing reminder 与工程侧路由元数据。
  - Completed: 2026-06-11。
  - 不再把 `source`、`required_tool`、`context_session_key`、`read_cutoff_after_conversation_id`、`next_turn`、`max_turns` 等字段裸塞进 LLM context。
  - `core_memory_pressure` 是否强制 `compress_core_memory` 应由代码侧状态 / tool choice 控制，不要依赖 prompt 文本里的 XML 属性来检测。
  - trace、日志、DB 里可以继续保留这些字段用于排障，但模型看到的 `<system_reminder>` 只保留体感提醒。
  - 已将 `core_memory_pressure` 强制工具选择改为代码侧非枚举 marker；普通 `system_reminder`、`phone_notification`、`image_task_notification` 和 `<STATE>` 都不再暴露工程路由属性。

- [x] 删除 prompt-facing `final_answer_turn_control` / `final_answer_idle` 路径。
  - Completed: 2026-06-11。
  - `phase=final_answer` 后是否继续同一个 run、释放 execution lease、或创建下一次自主切片，是 runtime 调度问题，不应通过 `<system_reminder>` 让 LLM 自己纠偏。
  - 已删除同一 loop 内追加 `source="final_answer_turn_control"` 的分支；如果 final_answer 没有工具调用也没有可见 delivery，代码侧直接以 `no_visible_delivery_observed` settle / release。
  - `ResponseActionRouter` 不再生成 `enqueue_final_answer_idle_reminder` post action，`RuntimeStore` 不再暴露 final_answer idle enqueue 方法；历史 `reason=final_answer_idle` 只按普通内部 system reminder 兼容读取。

- [x] 收口 `self_continuation` 的 current-processing 工程提醒。
  - Completed: 2026-06-11。
  - `buildCurrentProcessingReminder()` 对 `self_continuation` 不再追加“当前是小腻自己的连续生命切片，不是 QQ 正文...”这类工程说明。
  - 已删除实际 LLM context 中观测到的这类变体：`<system_reminder>当前连续生命切片已经进入上下文。后续轮次是在同一段自续行动中推进，不代表有新的 QQ 正文或新的通知。</system_reminder>`。
  - `self_continuation` 只保留一个 prompt-facing 模板；不要再额外追加“当前连续生命切片已经进入上下文 / 后续轮次是在同一段自续行动中推进 / 不代表有新的 QQ 正文或新的通知”。
  - 当前代码使用 `docs/remind.md` 中保留的“外界很安静...”模板；是否属于同一段自续行动、是否抑制当前 trigger，留在 `triggerInputMode` / queue 状态。

- [x] 收口 `phone_notification` 的双重渲染。
  - Completed: 2026-06-11。
  - 已删除 fresh notify 的 `<PHONE_NOTIFICATION ... />` 渲染和 `buildCurrentProcessingReminder()` 额外解释。
  - 当前实现合并成 `docs/remind.md` 中的 `phone_notification` 单一 prompt-facing 模板：`有新的未读qq消息...以下只展示有人明确喊你的信息...`。
  - 不再在 `<PHONE_NOTIFICATION>` 之外双写一条当前输入解释；工程属性和队列状态留在代码侧。

- [x] 收口 `image_task_notification` 的双重渲染。
  - Completed: 2026-06-11。
  - 已删除 fresh notify 的 `<IMAGE_TASK_NOTIFICATION ... />` 渲染和 `buildCurrentProcessingReminder()` 额外解释。
  - 当前实现合并成 `docs/remind.md` 中的 `image_task_notification` 单一 prompt-facing 模板：`图片生成任务:xxxx 已完成...`。
  - prompt-facing 只保留行动所需线索：`task_id`、任务类型、图片 ID、图片路径和目标描述；委托来源、原始 prompt、生成参数、trace/run、创建时间、图片 bytes 等排障细节留在 DB / trace。
  - 不再在 `<IMAGE_TASK_NOTIFICATION>` 之外双写一条当前输入解释。
  - 如小腻需要追溯“这个 task_id 是谁委托生成的 / 图片在哪 / 原始请求是什么”，新增或复用一个本地 skill 按 `task_id` 查询。

- [x] 删除 `buildCurrentProcessingReminder()` 的 fallback prompt-facing reminder。
  - Completed: 2026-06-11。
  - 已删除 fallback 追加的“当前输入来自内部调度切片，不代表 QQ 已经打开...”。
  - fallback 是工程兜底，不应进入 LLM context；未知内部切片应在代码侧归类为已有 trigger，或不渲染当前输入提醒。

- [x] 清理未触发的 `renderCurrentMediaPlaceholderContext()` 死代码。
  - Completed: 2026-06-11。
  - 当前 `isImmediateVisibleImWake()` 恒 false，生产上不会追加 `[当前媒体占位符]...不要猜图里有什么...`。
  - 已删除 `isImmediateVisibleImWake()`、`renderCurrentMediaPlaceholderContext()` 和对应调用。
  - 该项不是当前 system_reminder / prompt-facing 审核对象；如未来重新启用，按图片占位 / 视觉工具契约单独设计。

- [x] 移除 `<operator_warning>` prompt-facing 输出。
  - Completed: 2026-06-11。
  - 当前默认 skill cost 都是数字，生产默认不会触发；但 `buildCapabilitiesDeveloperBlock()` 在缺失 skill cost 时会把 `<operator_warning>skill ... omitted...</operator_warning>` 拼进 developer context。
  - skill cost 缺失是工程配置告警，应保留在函数返回的 `warnings`、日志或管理面，不进入小腻 LLM context。
  - `<CAPABILITIES>` 只保留实际可用的 tool / skill 能力与 cost。
  - 已更新 `modules/agent-service/skills/skill-creator/SKILL.md`，要求新建 / 更新 skill 时必须写 `## Runtime Cost` 和有限数值的 `energy_cost`，从源头减少缺失 cost。

- [x] 收口 `<STATE>` prompt-facing 字段。
  - Completed: 2026-06-11。
  - 当前 `buildTurnStateReminder()` 会把 developer block 里的 `<xiaoni_runtime_state>` / `<runtime_state>` 转成 `<STATE trigger="..." energy="..." max_energy="...">`，并把 `note=...` 写进正文。
  - `applyToolResultToLoopInput()` 等路径也会通过 `buildRuntimeStateBlock()` 追加带 `trigger` / `note` 的 `<STATE>`。
  - 设计边界：`<STATE>` 不是通用 reminder，也不是所有 tool 的回调协议；它只应该覆盖 runtime 不好包住普通 JSON callback 的消耗动作，主要是 hosted `web_search`、`exec_command` 和图片观察 XML 输出。
  - 目标：`<STATE>` 可以进入上下文，但只保留小腻能体感理解的 `energy` / `max_energy` 数值；`trigger`、`note`、`action_tool_threshold`、`web_search`、`low_energy_reminder`、`forced_full_recovery`、`rest_interrupted` 等工程事件名留在代码侧。
  - 当前 `<STATE>` body 只输出 `energy=...` 和 `max_energy=...`；读取侧兼容历史 attr 形态和新 body 形态。

- [x] 补齐 JSON tool callback 的精力回传能力。
  - Completed: 2026-06-11。
  - 普通结构化 wrapped tool（如 `send_in_group`、`send_in_private`、`request_image_task`、`compress_core_memory` 等）由 runtime 统一结算，并在 `function_call_output.output` 的 JSON 中回传 `energy_cost`、`energy`、`max_energy`；后续同一 run 会从上一条 JSON tool output 继续读取最新 `energy`。
  - hosted `web_search`、`exec_command` 和 `inspect_image_placeholder` 这类不能安全包 JSON 的路径保留原始输出契约，并由 loop 额外追加 developer role、body-only 的 `<STATE>` 回传剩余精力。
  - `exec_command` 固定基础消耗是 `energy_cost=0.002`；本地 skill 当前默认 / 兜底也按 `0.002` 展示，若未来需要细粒度 skill 级精力结算，应先把 skill execution 从命令输出里拆成可识别事件。

- [x] 清理 legacy `emit_unread_meaning` / `turn_control` 分支。
  - Completed: 2026-06-11。
  - 已确认当前 main loop 的 `tools` 和 `tool_choice` 不暴露 `emit_unread_meaning`，小腻当前链路不会调用它。
  - 已删除 `buildTurnControlReminder()`、`deriveTurnControlState()` 和 `applyToolResultToLoopInput()` 中的 `unreadMeaning` prompt-facing 追加分支。
  - 旧 `emit_unread_meaning` 执行解析兼容保留为历史 replay / 旧响应兼容；行为判断由当前主 prompt、可用工具和模型自然决策承担。

- [x] 清理残留 `tool_loop_monitor` helper / 测试。
  - Completed: 2026-06-11。
  - 已确认当前生产链路没有调用 `buildToolLoopMonitorReminder()`；该 helper 和对应测试已删除。
  - 该 helper 监控的是底层工具名（`exec_command`、`web_search`、`inspect_image_placeholder`、`compress_core_memory`、legacy `emit_unread_meaning`），不是 `$qq-usage` 这类 skill 名。
  - 若仍需要防内耗，应改为代码侧限流 / 状态机 / run policy，不再作为 prompt-facing `<system_reminder>` 追加进 LLM context。

- [x] 删除 `request_image_task` 后追加的 prompt-facing `system_reminder`。
  - Completed: 2026-06-11。
  - 当前 tool output 已经返回 `queued`、`task_id`、`task_type`、`status_text`，其中 `status_text` 会说明任务正在进行、完成后会以 notify 通知。
  - 已删除 `applyToolResultToLoopInput()` 对 `request_image_task` 的额外 `<system_reminder>` 追加；是否补充发言由当前对话策略和发言工具自然决定。
  - 如仍需防止图片任务吞掉可见回复，应通过 tool description、run policy 或 visible-delivery 判定处理，不塞进 LLM context。

- [x] 将 `picked_snapshot` / `already_picked` 改为纯工程侧防重放模式。
  - Completed: 2026-06-11。
  - 后续 turn 不重放 fresh trigger，但不再把 `<runtime_event_snapshot status="already_picked">` 追加进 LLM context。
  - 代码侧改为 `suppress_current_trigger` 模式，只抑制当前触发输入，不生成 prompt-facing snapshot。
  - trace/log 可继续记录 picked 状态用于排障。

- [x] 删除 legacy `consciousness_tick` / `presence_tick` 分支。
  - Completed: 2026-06-10。
  - DB 安全检查结果：`agent_queue_messages` 中没有 pending/processing 的 `source in ('consciousness_tick', 'presence_tick')` 或 `session_key='presence_tick:xiaoni'` 老行。
  - 已确认非测试代码里没有当前 enqueue 生产方；剩余都是识别、渲染、状态展示、历史字段或旧事件兼容。
  - 已删除 `agent-loop-service.ts` 里的旧 tick 识别、当前输入渲染、picked snapshot 和专用 outcome 分支。
  - 已清理 agent loop 相关 legacy 测试；当前内部生命切片契约改由 `self_continuation` 覆盖。
  - `system_reminder` 模板文档已收口到当前真实 `self_continuation` / notify / reminder 状态。
