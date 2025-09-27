-- ============================================
-- 统一时间戳精度迁移脚本
-- 将所有时间字段统一为TIMESTAMP(3)毫秒精度
-- ============================================

-- 1. llm_call_logs 表 - 统一时间戳精度
ALTER TABLE llm_call_logs
MODIFY COLUMN timestamp TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3);

-- 2. conversations 表 - 统一时间戳精度
ALTER TABLE conversations
MODIFY COLUMN timestamp TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3),
MODIFY COLUMN created_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3),
MODIFY COLUMN updated_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3);

-- 3. websocket_logs 表 - 统一时间戳精度
ALTER TABLE websocket_logs
MODIFY COLUMN timestamp TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3);

-- 4. api_tokens 表 - 统一时间戳精度
ALTER TABLE api_tokens
MODIFY COLUMN created_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3),
MODIFY COLUMN updated_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
MODIFY COLUMN last_used_at TIMESTAMP(3) NULL,
MODIFY COLUMN last_error_time TIMESTAMP(3) NULL,
MODIFY COLUMN blacklisted_until TIMESTAMP(3) NULL;

-- 5. session_traces 表 - 统一时间戳精度 (如果存在)
ALTER TABLE session_traces
MODIFY COLUMN start_time TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3),
MODIFY COLUMN end_time TIMESTAMP(3) NULL;

-- 6. debug_logs 表 - 统一时间戳精度 (如果存在)
ALTER TABLE debug_logs
MODIFY COLUMN timestamp TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3);

-- 验证修改结果
SELECT
    TABLE_NAME,
    COLUMN_NAME,
    COLUMN_TYPE,
    IS_NULLABLE,
    COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'qqbot_db'
    AND COLUMN_NAME IN ('timestamp', 'created_at', 'updated_at', 'start_time', 'end_time', 'last_used_at', 'last_error_time', 'blacklisted_until')
    AND TABLE_NAME IN ('llm_call_logs', 'conversations', 'websocket_logs', 'api_tokens', 'session_traces', 'debug_logs', 'timeline_events')
ORDER BY TABLE_NAME, COLUMN_NAME;