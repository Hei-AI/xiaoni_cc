-- Add correlation fields for end-to-end SRE trace views.

-- llm_call_logs
SET @column_check = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'llm_call_logs'
    AND COLUMN_NAME = 'llm_call_id'
);
SET @sql_add_llm_call_id = IF(
  @column_check = 0,
  'ALTER TABLE llm_call_logs ADD COLUMN llm_call_id VARCHAR(36) NULL COMMENT ''Stable LLM call correlation ID'' AFTER trace_id',
  'SELECT ''Column llm_call_id already exists'' AS message'
);
PREPARE stmt FROM @sql_add_llm_call_id;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_check = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'llm_call_logs'
    AND COLUMN_NAME = 'agent_turn'
);
SET @sql_add_llm_agent_turn = IF(
  @column_check = 0,
  'ALTER TABLE llm_call_logs ADD COLUMN agent_turn INT NULL COMMENT ''Agent turn index'' AFTER call_sequence',
  'SELECT ''Column agent_turn already exists'' AS message'
);
PREPARE stmt FROM @sql_add_llm_agent_turn;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_check = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'llm_call_logs'
    AND COLUMN_NAME = 'started_at'
);
SET @sql_add_llm_started_at = IF(
  @column_check = 0,
  'ALTER TABLE llm_call_logs ADD COLUMN started_at DATETIME(3) NULL COMMENT ''LLM call started at'' AFTER timestamp',
  'SELECT ''Column started_at already exists'' AS message'
);
PREPARE stmt FROM @sql_add_llm_started_at;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_check = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'llm_call_logs'
    AND COLUMN_NAME = 'completed_at'
);
SET @sql_add_llm_completed_at = IF(
  @column_check = 0,
  'ALTER TABLE llm_call_logs ADD COLUMN completed_at DATETIME(3) NULL COMMENT ''LLM call completed at'' AFTER started_at',
  'SELECT ''Column completed_at already exists'' AS message'
);
PREPARE stmt FROM @sql_add_llm_completed_at;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- tool_execution_logs
SET @column_check = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'tool_execution_logs'
    AND COLUMN_NAME = 'tool_call_id'
);
SET @sql_add_tool_call_id = IF(
  @column_check = 0,
  'ALTER TABLE tool_execution_logs ADD COLUMN tool_call_id VARCHAR(36) NULL COMMENT ''Stable tool call correlation ID'' AFTER trace_id',
  'SELECT ''Column tool_call_id already exists'' AS message'
);
PREPARE stmt FROM @sql_add_tool_call_id;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_check = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'tool_execution_logs'
    AND COLUMN_NAME = 'conversation_id'
);
SET @sql_add_tool_conversation_id = IF(
  @column_check = 0,
  'ALTER TABLE tool_execution_logs ADD COLUMN conversation_id VARCHAR(36) NULL COMMENT ''Conversation correlation ID'' AFTER job_id',
  'SELECT ''Column conversation_id already exists'' AS message'
);
PREPARE stmt FROM @sql_add_tool_conversation_id;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_check = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'tool_execution_logs'
    AND COLUMN_NAME = 'agent_turn'
);
SET @sql_add_tool_agent_turn = IF(
  @column_check = 0,
  'ALTER TABLE tool_execution_logs ADD COLUMN agent_turn INT NULL COMMENT ''Agent turn index'' AFTER conversation_id',
  'SELECT ''Column agent_turn already exists'' AS message'
);
PREPARE stmt FROM @sql_add_tool_agent_turn;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_check = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'tool_execution_logs'
    AND COLUMN_NAME = 'llm_call_id'
);
SET @sql_add_tool_llm_call_id = IF(
  @column_check = 0,
  'ALTER TABLE tool_execution_logs ADD COLUMN llm_call_id VARCHAR(36) NULL COMMENT ''Parent LLM call correlation ID'' AFTER agent_turn',
  'SELECT ''Column llm_call_id already exists'' AS message'
);
PREPARE stmt FROM @sql_add_tool_llm_call_id;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- http_traffic_logs
SET @column_check = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'http_traffic_logs'
    AND COLUMN_NAME = 'agent_turn'
);
SET @sql_add_http_agent_turn = IF(
  @column_check = 0,
  'ALTER TABLE http_traffic_logs ADD COLUMN agent_turn INT NULL COMMENT ''Agent turn index'' AFTER trace_id',
  'SELECT ''Column agent_turn already exists'' AS message'
);
PREPARE stmt FROM @sql_add_http_agent_turn;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_check = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'http_traffic_logs'
    AND COLUMN_NAME = 'llm_call_id'
);
SET @sql_add_http_llm_call_id = IF(
  @column_check = 0,
  'ALTER TABLE http_traffic_logs ADD COLUMN llm_call_id VARCHAR(36) NULL COMMENT ''LLM call correlation ID'' AFTER conversation_id',
  'SELECT ''Column llm_call_id already exists'' AS message'
);
PREPARE stmt FROM @sql_add_http_llm_call_id;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_check = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'http_traffic_logs'
    AND COLUMN_NAME = 'tool_call_id'
);
SET @sql_add_http_tool_call_id = IF(
  @column_check = 0,
  'ALTER TABLE http_traffic_logs ADD COLUMN tool_call_id VARCHAR(36) NULL COMMENT ''Tool call correlation ID'' AFTER llm_call_id',
  'SELECT ''Column tool_call_id already exists'' AS message'
);
PREPARE stmt FROM @sql_add_http_tool_call_id;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @index_check = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'llm_call_logs'
    AND INDEX_NAME = 'idx_llm_call_id'
);
SET @sql_add_idx_llm_call_id = IF(
  @index_check = 0,
  'ALTER TABLE llm_call_logs ADD INDEX idx_llm_call_id (llm_call_id)',
  'SELECT ''Index idx_llm_call_id already exists'' AS message'
);
PREPARE stmt FROM @sql_add_idx_llm_call_id;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @index_check = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'tool_execution_logs'
    AND INDEX_NAME = 'idx_tool_call_id'
);
SET @sql_add_idx_tool_call_id = IF(
  @index_check = 0,
  'ALTER TABLE tool_execution_logs ADD INDEX idx_tool_call_id (tool_call_id)',
  'SELECT ''Index idx_tool_call_id already exists'' AS message'
);
PREPARE stmt FROM @sql_add_idx_tool_call_id;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @index_check = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'http_traffic_logs'
    AND INDEX_NAME = 'idx_http_trace_turn'
);
SET @sql_add_idx_http_trace_turn = IF(
  @index_check = 0,
  'ALTER TABLE http_traffic_logs ADD INDEX idx_http_trace_turn (trace_id, agent_turn)',
  'SELECT ''Index idx_http_trace_turn already exists'' AS message'
);
PREPARE stmt FROM @sql_add_idx_http_trace_turn;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
