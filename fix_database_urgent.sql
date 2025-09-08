-- 紧急修复数据库架构 - 修复单聊回归问题
-- 执行时间: 2025-09-07

USE qqbot_db;

-- 1. 修复conversations表 - 添加缺失的字段
ALTER TABLE conversations 
ADD COLUMN raw_request TEXT NULL COMMENT 'AI请求原始数据',
ADD COLUMN raw_response TEXT NULL COMMENT 'AI响应原始数据';

-- 2. 创建conversation_sessions表 - 会话管理
CREATE TABLE IF NOT EXISTS conversation_sessions (
  session_id VARCHAR(255) PRIMARY KEY COMMENT '会话ID',
  user_id BIGINT NOT NULL COMMENT '用户ID',
  session_type ENUM('chat', 'requirement', 'mixed') NOT NULL DEFAULT 'chat' COMMENT '会话类型',
  current_service VARCHAR(100) NOT NULL DEFAULT 'chat' COMMENT '当前服务',
  status ENUM('active', 'paused', 'completed', 'expired') NOT NULL DEFAULT 'active' COMMENT '会话状态',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后活跃时间',
  expires_at TIMESTAMP NULL COMMENT '过期时间',
  conversation_context JSON COMMENT '对话上下文',
  business_context JSON COMMENT '业务上下文',
  message_count INT DEFAULT 0 COMMENT '消息计数',
  service_transitions JSON COMMENT '服务切换历史',
  recent_messages JSON COMMENT '最近消息记录',
  
  INDEX idx_user_id (user_id),
  INDEX idx_status (status),
  INDEX idx_last_activity (last_activity),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='会话管理表';

-- 3. 检查修复结果
SELECT 'conversations表字段检查' as check_type, COLUMN_NAME, DATA_TYPE, IS_NULLABLE 
FROM information_schema.COLUMNS 
WHERE TABLE_SCHEMA = 'qqbot_db' AND TABLE_NAME = 'conversations' 
AND COLUMN_NAME IN ('raw_request', 'raw_response');

SELECT 'conversation_sessions表检查' as check_type, COUNT(*) as table_exists
FROM information_schema.TABLES 
WHERE TABLE_SCHEMA = 'qqbot_db' AND TABLE_NAME = 'conversation_sessions';