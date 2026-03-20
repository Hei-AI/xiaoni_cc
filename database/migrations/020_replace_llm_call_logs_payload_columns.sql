-- Replace legacy prompt/response payload columns with canonical/wire snapshots
USE qqbot_db;

SET @column_check = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'qqbot_db'
    AND TABLE_NAME = 'llm_call_logs'
    AND COLUMN_NAME = 'canonical_request'
);
SET @sql_add_canonical_request = IF(
  @column_check = 0,
  'ALTER TABLE llm_call_logs ADD COLUMN canonical_request JSON NULL COMMENT ''统一规范的请求体快照'' AFTER prompt_template',
  'SELECT ''Column canonical_request already exists'' AS message'
);
PREPARE stmt FROM @sql_add_canonical_request;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_check = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'qqbot_db'
    AND TABLE_NAME = 'llm_call_logs'
    AND COLUMN_NAME = 'wire_request'
);
SET @sql_add_wire_request = IF(
  @column_check = 0,
  'ALTER TABLE llm_call_logs ADD COLUMN wire_request JSON NULL COMMENT ''实际发送给 provider 的请求体快照'' AFTER canonical_request',
  'SELECT ''Column wire_request already exists'' AS message'
);
PREPARE stmt FROM @sql_add_wire_request;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_check = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'qqbot_db'
    AND TABLE_NAME = 'llm_call_logs'
    AND COLUMN_NAME = 'request_format_version'
);
SET @sql_add_request_format_version = IF(
  @column_check = 0,
  'ALTER TABLE llm_call_logs ADD COLUMN request_format_version VARCHAR(32) NOT NULL DEFAULT ''openresponse/v1'' COMMENT ''统一请求格式版本'' AFTER wire_request',
  'SELECT ''Column request_format_version already exists'' AS message'
);
PREPARE stmt FROM @sql_add_request_format_version;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_check = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'qqbot_db'
    AND TABLE_NAME = 'llm_call_logs'
    AND COLUMN_NAME = 'wire_provider_format'
);
SET @sql_add_wire_provider_format = IF(
  @column_check = 0,
  'ALTER TABLE llm_call_logs ADD COLUMN wire_provider_format VARCHAR(64) NOT NULL DEFAULT ''unknown/unknown'' COMMENT ''provider wire payload 格式标识'' AFTER request_format_version',
  'SELECT ''Column wire_provider_format already exists'' AS message'
);
PREPARE stmt FROM @sql_add_wire_provider_format;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_check = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'qqbot_db'
    AND TABLE_NAME = 'llm_call_logs'
    AND COLUMN_NAME = 'canonical_response'
);
SET @sql_add_canonical_response = IF(
  @column_check = 0,
  'ALTER TABLE llm_call_logs ADD COLUMN canonical_response JSON NULL COMMENT ''统一规范的响应体快照'' AFTER input_tokens',
  'SELECT ''Column canonical_response already exists'' AS message'
);
PREPARE stmt FROM @sql_add_canonical_response;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_check = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'qqbot_db'
    AND TABLE_NAME = 'llm_call_logs'
    AND COLUMN_NAME = 'wire_response'
);
SET @sql_add_wire_response = IF(
  @column_check = 0,
  'ALTER TABLE llm_call_logs ADD COLUMN wire_response JSON NULL COMMENT ''provider 原始响应快照'' AFTER canonical_response',
  'SELECT ''Column wire_response already exists'' AS message'
);
PREPARE stmt FROM @sql_add_wire_response;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

DELETE FROM llm_call_logs
WHERE canonical_request IS NULL
   OR wire_request IS NULL;

UPDATE llm_call_logs
SET request_format_version = 'openresponse/v1'
WHERE request_format_version IS NULL OR request_format_version = '';

UPDATE llm_call_logs
SET wire_provider_format = CONCAT(COALESCE(model_provider, 'unknown'), '/responses')
WHERE wire_provider_format IS NULL OR wire_provider_format = '';

SET @drop_input_prompt = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'qqbot_db' AND TABLE_NAME = 'llm_call_logs' AND COLUMN_NAME = 'input_prompt') > 0,
  'ALTER TABLE llm_call_logs DROP COLUMN input_prompt',
  'SELECT ''Column input_prompt already removed'' AS message'
);
PREPARE stmt FROM @drop_input_prompt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @drop_model_config = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'qqbot_db' AND TABLE_NAME = 'llm_call_logs' AND COLUMN_NAME = 'model_config') > 0,
  'ALTER TABLE llm_call_logs DROP COLUMN model_config',
  'SELECT ''Column model_config already removed'' AS message'
);
PREPARE stmt FROM @drop_model_config;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @drop_raw_response = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'qqbot_db' AND TABLE_NAME = 'llm_call_logs' AND COLUMN_NAME = 'raw_response') > 0,
  'ALTER TABLE llm_call_logs DROP COLUMN raw_response',
  'SELECT ''Column raw_response already removed'' AS message'
);
PREPARE stmt FROM @drop_raw_response;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @drop_context_summary = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'qqbot_db' AND TABLE_NAME = 'llm_call_logs' AND COLUMN_NAME = 'context_summary') > 0,
  'ALTER TABLE llm_call_logs DROP COLUMN context_summary',
  'SELECT ''Column context_summary already removed'' AS message'
);
PREPARE stmt FROM @drop_context_summary;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql_require_canonical_request = IF(
  (SELECT IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'qqbot_db' AND TABLE_NAME = 'llm_call_logs' AND COLUMN_NAME = 'canonical_request'
    LIMIT 1) = 'YES',
  'ALTER TABLE llm_call_logs MODIFY COLUMN canonical_request JSON NOT NULL COMMENT ''统一规范的请求体快照''',
  'SELECT ''Column canonical_request already NOT NULL'' AS message'
);
PREPARE stmt FROM @sql_require_canonical_request;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql_require_wire_request = IF(
  (SELECT IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'qqbot_db' AND TABLE_NAME = 'llm_call_logs' AND COLUMN_NAME = 'wire_request'
    LIMIT 1) = 'YES',
  'ALTER TABLE llm_call_logs MODIFY COLUMN wire_request JSON NOT NULL COMMENT ''实际发送给 provider 的请求体快照''',
  'SELECT ''Column wire_request already NOT NULL'' AS message'
);
PREPARE stmt FROM @sql_require_wire_request;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
