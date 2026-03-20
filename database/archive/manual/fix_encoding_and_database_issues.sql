-- ============================================================================
-- QQ Bot Database Encoding and Field Mapping Fix
-- Created: 2025-01-09
-- Purpose: Fix UTF-8 encoding issues and field mapping problems
-- ============================================================================

USE qqbot_db;

-- 1. Fix database character set to UTF8MB4 for proper Chinese character support
ALTER DATABASE qqbot_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 2. Fix conversations table character encoding
ALTER TABLE conversations CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 3. Ensure llm_call_traces table exists and has proper structure
CREATE TABLE IF NOT EXISTS llm_call_traces (
  id VARCHAR(36) PRIMARY KEY COMMENT 'LLM调用ID',
  session_id VARCHAR(36) NOT NULL COMMENT '会话ID',
  conversation_id VARCHAR(36) NULL COMMENT '对话ID',
  call_sequence INT NOT NULL DEFAULT 1 COMMENT '调用序号',
  engine_type ENUM('decision', 'context', 'persona', 'main_chat', 'requirement') NOT NULL COMMENT '引擎类型',
  model_name VARCHAR(100) NULL COMMENT '模型名称',
  request TEXT NULL COMMENT '请求内容(JSON)',
  response TEXT NULL COMMENT '响应内容(JSON)',
  prompt_tokens INT DEFAULT 0 COMMENT 'Prompt token数量',
  completion_tokens INT DEFAULT 0 COMMENT '完成token数量',
  total_tokens INT DEFAULT 0 COMMENT '总token数量',
  response_time INT NOT NULL COMMENT '响应时间(ms)',
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '时间戳',
  success BOOLEAN DEFAULT TRUE COMMENT '是否成功',
  error_message TEXT NULL COMMENT '错误信息',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  
  INDEX idx_session_id (session_id),
  INDEX idx_conversation_id (conversation_id),
  INDEX idx_timestamp (timestamp),
  INDEX idx_engine_type (engine_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='LLM调用追踪表';

-- 4. Fix llm_call_traces table character encoding if it exists
ALTER TABLE llm_call_traces CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 5. Update all other tables to use proper UTF8MB4 encoding
ALTER TABLE api_tokens CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE requirements CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE system_logs CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE bot_status CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 6. Fix conversation_sessions table if it exists
ALTER TABLE conversation_sessions CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 7. Fix agent_prompts table if it exists
ALTER TABLE agent_prompts CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 8. Fix group_chat_settings and related tables if they exist
ALTER TABLE group_chat_settings CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 9. Verify character set fixes
SELECT 
  TABLE_NAME,
  TABLE_COLLATION
FROM INFORMATION_SCHEMA.TABLES 
WHERE TABLE_SCHEMA = 'qqbot_db'
AND TABLE_TYPE = 'BASE TABLE';

-- 10. Test UTF-8 support with sample data
SELECT 
  '测试中文UTF-8编码' as utf8_test,
  '🤖AI机器人测试' as emoji_test,
  CHARSET('测试中文UTF-8编码') as charset_name;

-- 11. Show current database encoding
SHOW VARIABLES LIKE 'character_set%';

-- 12. Display table structures for verification
SELECT 
  COLUMN_NAME,
  DATA_TYPE,
  CHARACTER_SET_NAME,
  COLLATION_NAME
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_SCHEMA = 'qqbot_db' 
  AND TABLE_NAME = 'conversations'
  AND CHARACTER_SET_NAME IS NOT NULL;

SELECT 'Database encoding fix completed successfully!' as status;