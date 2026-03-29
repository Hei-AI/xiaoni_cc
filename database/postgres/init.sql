CREATE TABLE IF NOT EXISTS private_chat_settings (
  user_id BIGINT PRIMARY KEY,
  username VARCHAR(255),
  is_enabled INTEGER NOT NULL DEFAULT 1,
  auto_reply_enabled INTEGER NOT NULL DEFAULT 0,
  welcome_message TEXT,
  user_notes TEXT,
  agent_prompt_id VARCHAR(100),
  last_activity TIMESTAMP(3),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS group_chat_settings (
  group_id BIGINT PRIMARY KEY,
  group_name VARCHAR(255),
  is_enabled INTEGER NOT NULL DEFAULT 1,
  auto_reply_enabled INTEGER NOT NULL DEFAULT 0,
  welcome_message TEXT,
  admin_user_id BIGINT,
  agent_prompt_id VARCHAR(100),
  last_activity TIMESTAMP(3),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agent_prompts (
  id VARCHAR(100) PRIMARY KEY,
  agent_type VARCHAR(64) NOT NULL,
  prompt_name VARCHAR(255) NOT NULL,
  system_instructions JSONB NOT NULL,
  user_prompt_template TEXT,
  context_variables JSONB,
  model_name VARCHAR(100),
  model_config JSONB,
  advanced_config JSONB,
  is_active INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  created_by VARCHAR(100) NOT NULL DEFAULT 'system',
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  description TEXT
);

CREATE TABLE IF NOT EXISTS prompt_debug_sessions (
  id VARCHAR(100) PRIMARY KEY,
  prompt_id VARCHAR(100) NOT NULL,
  session_name VARCHAR(255) NOT NULL,
  messages JSONB NOT NULL DEFAULT '[]'::jsonb,
  input_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS conversations (
  id BIGSERIAL PRIMARY KEY,
  batch_id BIGINT,
  user_id BIGINT NOT NULL,
  group_id BIGINT,
  user_message TEXT NOT NULL,
  ai_response TEXT,
  timestamp TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  response_time INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(32),
  error_reason TEXT,
  model_name VARCHAR(100),
  raw_request JSONB,
  raw_response JSONB,
  message_id BIGINT,
  reply_to_message_id BIGINT,
  reply_to_text TEXT,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  trace_id VARCHAR(100)
);

CREATE TABLE IF NOT EXISTS chat_transcript_snapshots (
  session_id VARCHAR(191) PRIMARY KEY,
  chat_type VARCHAR(16) NOT NULL,
  private_user_id BIGINT,
  group_id BIGINT,
  summary_text TEXT NOT NULL,
  summary_format_version VARCHAR(32) NOT NULL,
  summarized_through_conversation_id BIGINT NOT NULL,
  summary_status VARCHAR(16) NOT NULL DEFAULT 'ready',
  summary_job_id VARCHAR(128),
  last_compacted_at TIMESTAMP(3),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS conversation_items (
  id BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT NOT NULL,
  session_key VARCHAR(191),
  role VARCHAR(16) NOT NULL,
  phase VARCHAR(32),
  content TEXT NOT NULL,
  group_index INTEGER NOT NULL DEFAULT 0,
  item_index INTEGER NOT NULL DEFAULT 0,
  source VARCHAR(32) NOT NULL,
  delivery_message_id BIGINT,
  run_id VARCHAR(128),
  trace_id VARCHAR(128),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_chat_transcript_snapshots_private_user
  ON chat_transcript_snapshots (private_user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_transcript_snapshots_group
  ON chat_transcript_snapshots (group_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_transcript_snapshots_status
  ON chat_transcript_snapshots (summary_status, updated_at DESC);

CREATE TABLE IF NOT EXISTS conversation_sessions (
  session_id VARCHAR(100) PRIMARY KEY,
  user_id BIGINT NOT NULL,
  session_type VARCHAR(32) NOT NULL,
  current_service VARCHAR(64),
  status VARCHAR(32) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_activity TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP(3),
  conversation_context JSONB,
  business_context JSONB,
  message_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS llm_call_logs (
  id BIGSERIAL PRIMARY KEY,
  llm_call_id VARCHAR(100),
  trace_id VARCHAR(100),
  conversation_id BIGINT,
  session_id VARCHAR(100),
  call_sequence INTEGER DEFAULT 1,
  agent_type VARCHAR(64),
  model_name VARCHAR(100),
  model_provider VARCHAR(64),
  prompt_template TEXT,
  input_prompt TEXT,
  canonical_request JSONB,
  request_format_version VARCHAR(32),
  wire_provider_format VARCHAR(64),
  raw_response TEXT,
  processed_response TEXT,
  status VARCHAR(32),
  error_message TEXT,
  error_code VARCHAR(64),
  started_at TIMESTAMP(3),
  completed_at TIMESTAMP(3),
  timestamp TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processing_time_ms INTEGER DEFAULT 0,
  api_call_time_ms INTEGER DEFAULT 0,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  token_usage JSONB,
  user_id BIGINT DEFAULT 0,
  context_summary TEXT
);

CREATE TABLE IF NOT EXISTS websocket_logs (
  id BIGSERIAL PRIMARY KEY,
  trace_id VARCHAR(100),
  level VARCHAR(32),
  event_type VARCHAR(64),
  direction VARCHAR(32),
  message TEXT,
  metadata JSONB,
  raw_message TEXT,
  parsed_data JSONB,
  user_id BIGINT,
  group_id BIGINT,
  message_id VARCHAR(100),
  timestamp TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS timeline_events (
  id BIGSERIAL PRIMARY KEY,
  trace_id VARCHAR(100),
  conversation_id BIGINT,
  event_type VARCHAR(64),
  event_name VARCHAR(128),
  event_phase VARCHAR(32),
  component VARCHAR(128),
  event_time TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  duration_ms INTEGER,
  metadata JSONB,
  performance_metrics JSONB
);

CREATE TABLE IF NOT EXISTS http_traffic_logs (
  id BIGSERIAL PRIMARY KEY,
  request_id VARCHAR(100),
  trace_id VARCHAR(100),
  conversation_id BIGINT,
  user_id VARCHAR(100),
  session_id VARCHAR(100),
  agent_turn INTEGER,
  llm_call_id VARCHAR(100),
  tool_call_id VARCHAR(100),
  container_name VARCHAR(100),
  service_name VARCHAR(100),
  method VARCHAR(16) NOT NULL,
  url TEXT NOT NULL,
  host VARCHAR(255) NOT NULL,
  path TEXT NOT NULL,
  query_params JSONB,
  request_headers JSONB NOT NULL DEFAULT '{}'::jsonb,
  request_body TEXT,
  request_content_type VARCHAR(255),
  request_size INTEGER,
  response_status INTEGER,
  response_headers JSONB,
  response_body TEXT,
  response_content_type VARCHAR(255),
  response_size INTEGER,
  duration_ms BIGINT,
  request_timestamp TIMESTAMP(3) NOT NULL,
  response_timestamp TIMESTAMP(3),
  is_ai_request BOOLEAN NOT NULL DEFAULT FALSE,
  api_type VARCHAR(64),
  api_version VARCHAR(32),
  client_ip VARCHAR(128),
  user_agent TEXT,
  error_message TEXT,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS log_import_state (
  file_path TEXT PRIMARY KEY,
  file_inode BIGINT NOT NULL DEFAULT 0,
  file_size BIGINT NOT NULL DEFAULT 0,
  last_position BIGINT NOT NULL DEFAULT 0,
  records_imported INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  import_started_at TIMESTAMP(3),
  last_import_time TIMESTAMP(3)
);

CREATE TABLE IF NOT EXISTS traffic_replay_history (
  id BIGSERIAL PRIMARY KEY,
  original_log_id BIGINT NOT NULL,
  replay_name VARCHAR(255),
  target_url TEXT,
  request_method VARCHAR(16),
  request_headers JSONB,
  request_body TEXT,
  response_status INTEGER,
  response_headers JSONB,
  response_body TEXT,
  duration_ms INTEGER,
  status VARCHAR(32) NOT NULL DEFAULT 'completed',
  error_message TEXT,
  replayed_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE llm_call_logs
  ADD COLUMN IF NOT EXISTS llm_call_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS agent_turn INTEGER,
  ADD COLUMN IF NOT EXISTS canonical_response JSONB,
  ADD COLUMN IF NOT EXISTS wire_request JSONB,
  ADD COLUMN IF NOT EXISTS wire_response JSONB,
  ADD COLUMN IF NOT EXISTS effective_unified_config JSONB,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS agent_queue_messages (
  id BIGSERIAL PRIMARY KEY,
  trace_id VARCHAR(128) NOT NULL,
  source VARCHAR(32) NOT NULL,
  message_sid VARCHAR(191) NOT NULL,
  dedupe_key VARCHAR(255) NOT NULL UNIQUE,
  chat_type VARCHAR(16) NOT NULL,
  session_key VARCHAR(191) NOT NULL,
  peer_id VARCHAR(191) NOT NULL,
  peer_name VARCHAR(255),
  sender_id VARCHAR(191) NOT NULL,
  sender_name VARCHAR(255),
  account_id VARCHAR(191) NOT NULL,
  body_for_agent TEXT NOT NULL,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  inbound_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  available_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_at TIMESTAMP(3),
  locked_by VARCHAR(128),
  processing_started_at TIMESTAMP(3),
  completed_at TIMESTAMP(3),
  conversation_id BIGINT,
  error_message TEXT,
  result JSONB,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_queue_pending_available
  ON agent_queue_messages (status, available_at, id);

CREATE INDEX IF NOT EXISTS idx_agent_queue_trace_created
  ON agent_queue_messages (trace_id, created_at, id);

CREATE TABLE IF NOT EXISTS llm_jobs (
  id BIGSERIAL PRIMARY KEY,
  job_id VARCHAR(128) NOT NULL UNIQUE,
  trace_id VARCHAR(128) NOT NULL,
  conversation_id BIGINT,
  session_id VARCHAR(191),
  agent_type VARCHAR(64),
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  final_response TEXT,
  error_message TEXT,
  total_turns INTEGER NOT NULL DEFAULT 0,
  metadata JSONB,
  started_at TIMESTAMP(3),
  completed_at TIMESTAMP(3),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tool_execution_logs (
  id BIGSERIAL PRIMARY KEY,
  tool_call_id VARCHAR(128),
  trace_id VARCHAR(128) NOT NULL,
  conversation_id BIGINT,
  job_id VARCHAR(128),
  agent_turn INTEGER,
  llm_call_id VARCHAR(128),
  tool_type VARCHAR(64),
  tool_name VARCHAR(128) NOT NULL,
  method_id VARCHAR(128),
  arguments JSONB,
  result JSONB,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  error_message TEXT,
  execution_mode VARCHAR(64),
  side_effect BOOLEAN NOT NULL DEFAULT FALSE,
  started_at TIMESTAMP(3),
  completed_at TIMESTAMP(3),
  duration_ms BIGINT
);
