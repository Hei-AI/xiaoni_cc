# 行为事实源是 Xiaoni agent stack，不是 llm_call_logs 三表

2026-06 的评审曾定「action stream 以 `llm_call_logs` / `tool_execution_logs` 为产品数据源，
`xiaoni_replay_events` 只作 provider 证据与搜索」。**该结论已被推翻**：三张表现在都躺在
`packages/persistence/agent-runtime.js:7-9` 的 `DROP TABLE IF EXISTS` 列表里。

现行事实源是追加式的 Xiaoni agent stack —— `agent_stack_items`（连续可回放上下文）、
`llm_request_slices`（真实 LLM 请求 + provider wire payload）、`tool_executions`（工具执行）。
换掉日志表的理由不是审美：run 边界靠 stack replay **逐字节**重建上下文，日志表既承担不了 replay，
也表达不了「同一 run 内多次 LLM 请求」这个真实结构。细节看 `docs/XIAONI_AGENT_STACK_LEDGER.md`。

同期一批以 `conversation_id` 为键的决策一并作废——该列已从 schema 移除。
