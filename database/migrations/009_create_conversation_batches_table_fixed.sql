-- Migration: 009_create_conversation_batches_table.sql (Fixed for MySQL 8.0)
-- Description: 创建批次处理记录表,用于追踪消息批处理过程
-- Created: 2025-10-02
-- Fixed: 2025-10-04 - MySQL 8.0 compatibility

CREATE TABLE IF NOT EXISTS conversation_batches (
  id VARCHAR(36) PRIMARY KEY COMMENT '批次ID (UUID)',
  source_key VARCHAR(50) NOT NULL COMMENT '源标识符 (user_123 或 group_456)',
  source_type ENUM('private', 'group') NOT NULL COMMENT '消息来源类型',

  trigger_type ENUM('direct', 'scheduled', 'manual') NOT NULL COMMENT '触发方式',

  message_count INT NOT NULL DEFAULT 0 COMMENT '批次中消息数量',
  start_time DATETIME NOT NULL COMMENT '批次处理开始时间',
  end_time DATETIME COMMENT '批次处理结束时间',
  processing_time INT COMMENT '处理耗时(毫秒)',

  status ENUM('processing', 'completed', 'failed') NOT NULL DEFAULT 'processing' COMMENT '批次状态',
  error_message TEXT COMMENT '错误信息(如果失败)',

  -- 批次元数据
  metadata JSON COMMENT '批次元数据(如优先级、trace IDs等)',

  created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

  INDEX idx_source_key (source_key),
  INDEX idx_source_type (source_type),
  INDEX idx_trigger_type (trigger_type),
  INDEX idx_status (status),
  INDEX idx_start_time (start_time),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='消息批处理记录表';

-- 为 conversations 表添加 batch_id 字段(如果不存在) - MySQL 8.0 兼容方式
SET @column_check = (SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'qqbot_db'
    AND TABLE_NAME = 'conversations'
    AND COLUMN_NAME = 'batch_id');

SET @sql_add_batch_id = IF(@column_check = 0,
    'ALTER TABLE conversations ADD COLUMN batch_id VARCHAR(36) COMMENT ''关联的批次ID'', ADD INDEX idx_batch_id (batch_id)',
    'SELECT ''Column batch_id already exists in conversations'' AS message');
PREPARE stmt FROM @sql_add_batch_id;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
