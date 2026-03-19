-- Ensure llm_call_logs.input_prompt can store very large serialized payloads
USE qqbot_db;

SET @input_prompt_type := (
  SELECT DATA_TYPE
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'qqbot_db'
    AND TABLE_NAME = 'llm_call_logs'
    AND COLUMN_NAME = 'input_prompt'
  LIMIT 1
);

SET @sql_alter_input_prompt := IF(
  @input_prompt_type = 'longtext',
  'SELECT ''llm_call_logs.input_prompt already LONGTEXT'' AS message',
  'ALTER TABLE llm_call_logs MODIFY COLUMN input_prompt LONGTEXT NOT NULL COMMENT ''完整的输入prompt'''
);

PREPARE stmt FROM @sql_alter_input_prompt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
