-- 创建API Token管理表
-- 将原有的token.properties文件迁移到数据库存储

CREATE TABLE IF NOT EXISTS `api_tokens` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `token` VARCHAR(255) NOT NULL UNIQUE COMMENT 'Gemini API Token',
  `project_name` VARCHAR(100) NOT NULL COMMENT '项目名称标识符',
  `project_id` VARCHAR(50) NOT NULL COMMENT '项目ID',
  
  -- 使用状态管理
  `is_active` BOOLEAN NOT NULL DEFAULT TRUE COMMENT '是否启用',
  `is_healthy` BOOLEAN NOT NULL DEFAULT TRUE COMMENT '是否健康（通过健康检查）',
  
  -- 使用限制和统计
  `daily_limit` INT NOT NULL DEFAULT 1000 COMMENT '每日最大使用次数',
  `daily_used` INT NOT NULL DEFAULT 0 COMMENT '今日已使用次数',
  `total_used` INT NOT NULL DEFAULT 0 COMMENT '总使用次数',
  `last_reset_date` DATE NOT NULL DEFAULT (CURDATE()) COMMENT '上次重置日期',
  
  -- 健康状态管理
  `last_used` DATETIME NULL COMMENT '最后使用时间',
  `last_health_check` DATETIME NULL COMMENT '最后健康检查时间',
  `error_count` INT NOT NULL DEFAULT 0 COMMENT '连续错误次数',
  `last_error` TEXT NULL COMMENT '最后错误信息',
  `last_error_time` DATETIME NULL COMMENT '最后错误时间',
  
  -- 优先级和权重
  `priority` INT NOT NULL DEFAULT 1 COMMENT '优先级（1=最高优先级）',
  `weight` DECIMAL(3,2) NOT NULL DEFAULT 1.00 COMMENT '使用权重',
  
  -- 黑名单管理
  `blacklisted_until` DATETIME NULL COMMENT '黑名单截止时间',
  `blacklist_reason` VARCHAR(500) NULL COMMENT '黑名单原因',
  
  -- 记录时间戳
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  
  -- 索引
  INDEX `idx_is_active_healthy` (`is_active`, `is_healthy`),
  INDEX `idx_last_used` (`last_used`),
  INDEX `idx_priority` (`priority`),
  INDEX `idx_daily_used_limit` (`daily_used`, `daily_limit`),
  INDEX `idx_last_reset_date` (`last_reset_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='API Token管理表';

-- 创建Token使用日志表
CREATE TABLE IF NOT EXISTS `api_token_logs` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `token_id` INT NOT NULL COMMENT 'Token ID',
  `action` ENUM('use', 'success', 'error', 'health_check') NOT NULL COMMENT '操作类型',
  `result` ENUM('success', 'error', 'timeout', 'quota_exceeded') NULL COMMENT '结果状态',
  `error_message` TEXT NULL COMMENT '错误信息',
  `response_time_ms` INT NULL COMMENT '响应时间（毫秒）',
  `gemini_usage` JSON NULL COMMENT 'Gemini API使用统计',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '记录时间',
  
  FOREIGN KEY (`token_id`) REFERENCES `api_tokens`(`id`) ON DELETE CASCADE,
  INDEX `idx_token_action` (`token_id`, `action`),
  INDEX `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='API Token使用日志';

-- 创建Token健康检查配置表
CREATE TABLE IF NOT EXISTS `api_token_health_config` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `check_interval_minutes` INT NOT NULL DEFAULT 30 COMMENT '健康检查间隔（分钟）',
  `max_error_count` INT NOT NULL DEFAULT 3 COMMENT '最大连续错误次数',
  `blacklist_duration_minutes` INT NOT NULL DEFAULT 300 COMMENT '黑名单持续时间（分钟）',
  `health_check_timeout_ms` INT NOT NULL DEFAULT 10000 COMMENT '健康检查超时（毫秒）',
  `daily_reset_hour` INT NOT NULL DEFAULT 0 COMMENT '每日使用次数重置小时（0-23）',
  `enabled` BOOLEAN NOT NULL DEFAULT TRUE COMMENT '是否启用健康检查',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Token健康检查配置';

-- 插入默认配置
INSERT INTO `api_token_health_config` 
(`check_interval_minutes`, `max_error_count`, `blacklist_duration_minutes`) 
VALUES (30, 3, 300) 
ON DUPLICATE KEY UPDATE `updated_at` = CURRENT_TIMESTAMP;