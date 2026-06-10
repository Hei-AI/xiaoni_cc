# TODO

## P0 - Xiaoni Runtime Cleanup

- [ ] 拆分 prompt-facing reminder 与工程侧路由元数据。
  - 不再把 `source`、`required_tool`、`context_session_key`、`read_cutoff_after_conversation_id`、`next_turn`、`max_turns` 等字段裸塞进 LLM context。
  - `core_memory_pressure` 是否强制 `compress_core_memory` 应由代码侧状态 / tool choice 控制，不要依赖 prompt 文本里的 XML 属性来检测。
  - trace、日志、DB 里可以继续保留这些字段用于排障，但模型看到的 `<system_reminder>` 只保留体感提醒。

- [ ] 修正 `final_answer_turn_control` 追加条件。
  - 目标规则：只有当前模型输出包含 `phase=final_answer`，且下一轮无法从 Notify Bucket pick 到新的当前事件时，才追加 `final_answer_turn_control`。
  - 如果能 pick 到 `phone_notification`、`image_task_notification`、`system_reminder` 或其他真实 notify，应优先处理新 notify，不追加复读机拦截。
  - 当前实现问题：只要 active loop 中出现 final_answer 就追加，条件过宽。

- [x] 删除 legacy `consciousness_tick` / `presence_tick` 分支。
  - Completed: 2026-06-10。
  - DB 安全检查结果：`agent_queue_messages` 中没有 pending/processing 的 `source in ('consciousness_tick', 'presence_tick')` 或 `session_key='presence_tick:xiaoni'` 老行。
  - 已确认非测试代码里没有当前 enqueue 生产方；剩余都是识别、渲染、状态展示、历史字段或旧事件兼容。
  - 已删除 `agent-loop-service.ts` 里的旧 tick 识别、当前输入渲染、picked snapshot 和专用 outcome 分支。
  - 已清理 agent loop 相关 legacy 测试；当前内部生命切片契约改由 `self_continuation` 覆盖。
  - `system_reminder` 模板文档已收口到当前真实 `self_continuation` / notify / reminder 状态。
