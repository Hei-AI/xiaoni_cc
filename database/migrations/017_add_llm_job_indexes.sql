-- Improve llm_jobs polling performance to avoid MySQL sort buffer exhaustion

SET @index_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = 'qqbot_db'
    AND TABLE_NAME = 'llm_jobs'
    AND INDEX_NAME = 'idx_status_retry_created'
);

SET @sql_create_index := IF(
  @index_exists = 0,
  'ALTER TABLE llm_jobs ADD INDEX idx_status_retry_created (status, next_retry_at, created_at)',
  'SELECT ''Index idx_status_retry_created already exists'' AS message'
);

PREPARE stmt FROM @sql_create_index;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
