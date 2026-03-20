-- Remove retired llm_call_traces table.
USE qqbot_db;

SET @drop_llm_call_traces = IF(
  (SELECT COUNT(*)
   FROM INFORMATION_SCHEMA.TABLES
   WHERE TABLE_SCHEMA = 'qqbot_db'
     AND TABLE_NAME = 'llm_call_traces') > 0,
  'DROP TABLE llm_call_traces',
  'SELECT ''Table llm_call_traces already removed'' AS message'
);

PREPARE stmt FROM @drop_llm_call_traces;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
