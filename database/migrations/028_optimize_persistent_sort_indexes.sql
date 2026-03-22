-- Reduce MySQL filesort pressure on persistent-layer hot paths.
-- Runtime startup guards also ensure these indexes in case migrations drift.

ALTER TABLE prompt_debug_sessions
  ADD INDEX idx_prompt_updated_at_id (prompt_id, updated_at, id);

ALTER TABLE llm_call_logs
  ADD INDEX idx_trace_timestamp_sequence_id (trace_id, timestamp, call_sequence, id),
  ADD INDEX idx_conversation_started_id (conversation_id, started_at, id),
  ADD INDEX idx_trace_started_id (trace_id, started_at, id),
  ADD INDEX idx_llm_call_started_id (llm_call_id, started_at, id);

ALTER TABLE websocket_logs
  ADD INDEX idx_trace_timestamp_id (trace_id, timestamp, id);

ALTER TABLE http_traffic_logs
  ADD INDEX idx_trace_request_time_id (trace_id, request_timestamp, id),
  ADD INDEX idx_conversation_request_time_id (conversation_id, request_timestamp, id);

ALTER TABLE llm_jobs
  ADD INDEX idx_trace_created_id (trace_id, created_at, id);

ALTER TABLE tool_execution_logs
  ADD INDEX idx_trace_started_completed_id (trace_id, started_at, completed_at, id);

ALTER TABLE traffic_replay_history
  ADD INDEX idx_original_log_replayed_at_id (original_log_id, replayed_at, id);

ALTER TABLE group_message_history
  ADD INDEX idx_group_history_id (group_id, id),
  ADD INDEX idx_group_message_id_lookup (group_id, message_id, id);

ALTER TABLE private_message_history
  ADD INDEX idx_user_history_id (user_id, id),
  ADD INDEX idx_private_message_id_lookup (user_id, message_id, id);

ALTER TABLE conversation_batches
  ADD INDEX idx_source_created_at_id (source_key, created_at, id);

ALTER TABLE conversations
  ADD INDEX idx_batch_created_at_id (batch_id, created_at, id);

ALTER TABLE llm_tools
  ADD INDEX idx_enabled_total_calls_success_calls_id (enabled, total_calls, success_calls, id);

ALTER TABLE api_tokens
  ADD INDEX idx_is_active_healthy (is_active, is_healthy),
  ADD INDEX idx_last_used (last_used),
  ADD INDEX idx_priority (priority),
  ADD INDEX idx_last_reset_date (last_reset_date),
  ADD INDEX idx_blacklisted_until (blacklisted_until),
  ADD INDEX idx_priority_last_used_weight (priority, last_used, weight);

ALTER TABLE agent_prompts
  ADD INDEX idx_agent_type_active_version (agent_type, is_active, version),
  ADD INDEX idx_agent_type_prompt_active_version (agent_type, prompt_name, is_active, version);
