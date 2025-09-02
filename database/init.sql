-- QQ Bot Database Initialize Script
-- 创建数据库和表结构

USE qqbot_db;

-- 创建对话历史表
CREATE TABLE IF NOT EXISTS conversations (
    id VARCHAR(50) PRIMARY KEY,
    user_id BIGINT NOT NULL,
    user_message TEXT NOT NULL,
    ai_response TEXT NOT NULL,
    timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    response_time DECIMAL(10,4) NOT NULL DEFAULT 0.0,
    model_name VARCHAR(100) DEFAULT 'gemini-2.5-flash',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_user_id (user_id),
    INDEX idx_timestamp (timestamp),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 创建需求管理表
CREATE TABLE IF NOT EXISTS requirements (
    id VARCHAR(50) PRIMARY KEY,
    user_id BIGINT NOT NULL,
    message TEXT NOT NULL,
    status ENUM('received', 'analyzing', 'processing', 'completed', 'failed', 'cancelled') NOT NULL DEFAULT 'received',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    claude_code_output LONGTEXT,
    completion_details TEXT,
    error_message TEXT,
    processing_start_time DATETIME,
    processing_end_time DATETIME,
    INDEX idx_user_id (user_id),
    INDEX idx_status (status),
    INDEX idx_created_at (created_at),
    INDEX idx_updated_at (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 创建系统日志表
CREATE TABLE IF NOT EXISTS system_logs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    log_level ENUM('DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL') NOT NULL,
    module_name VARCHAR(100) NOT NULL,
    message TEXT NOT NULL,
    extra_data JSON,
    timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_log_level (log_level),
    INDEX idx_module_name (module_name),
    INDEX idx_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 创建机器人状态监控表
CREATE TABLE IF NOT EXISTS bot_status (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    bot_id VARCHAR(50) NOT NULL,
    status ENUM('online', 'offline', 'error') NOT NULL,
    websocket_connected BOOLEAN DEFAULT FALSE,
    http_server_running BOOLEAN DEFAULT FALSE,
    last_heartbeat DATETIME,
    error_message TEXT,
    timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_bot_id (bot_id),
    INDEX idx_status (status),
    INDEX idx_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 插入初始数据
INSERT INTO bot_status (bot_id, status, websocket_connected, http_server_running, last_heartbeat) 
VALUES ('qqbot_1129974489', 'offline', FALSE, FALSE, NOW())
ON DUPLICATE KEY UPDATE 
status = 'offline', 
websocket_connected = FALSE, 
http_server_running = FALSE, 
timestamp = NOW();

-- 创建视图：最近24小时的对话统计
CREATE OR REPLACE VIEW conversation_stats_24h AS
SELECT 
    user_id,
    COUNT(*) as total_conversations,
    AVG(response_time) as avg_response_time,
    MIN(timestamp) as first_conversation,
    MAX(timestamp) as last_conversation
FROM conversations 
WHERE timestamp >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
GROUP BY user_id;

-- 创建视图：需求状态统计
CREATE OR REPLACE VIEW requirement_status_stats AS
SELECT 
    status,
    COUNT(*) as count,
    AVG(TIMESTAMPDIFF(SECOND, created_at, updated_at)) as avg_processing_time_seconds
FROM requirements 
GROUP BY status;

-- 添加更多有用的索引
ALTER TABLE conversations ADD INDEX idx_user_timestamp (user_id, timestamp);
ALTER TABLE requirements ADD INDEX idx_user_status (user_id, status);

-- 创建存储过程：清理旧数据
DELIMITER //
CREATE PROCEDURE CleanOldData(IN days_to_keep INT)
BEGIN
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;
    
    START TRANSACTION;
    
    -- 清理超过指定天数的对话记录
    DELETE FROM conversations 
    WHERE created_at < DATE_SUB(NOW(), INTERVAL days_to_keep DAY);
    
    -- 清理超过指定天数的系统日志
    DELETE FROM system_logs 
    WHERE timestamp < DATE_SUB(NOW(), INTERVAL days_to_keep DAY);
    
    -- 清理超过指定天数的机器人状态记录
    DELETE FROM bot_status 
    WHERE timestamp < DATE_SUB(NOW(), INTERVAL days_to_keep DAY)
    AND id NOT IN (
        SELECT id FROM (
            SELECT id FROM bot_status 
            ORDER BY timestamp DESC 
            LIMIT 100
        ) as recent_records
    );
    
    COMMIT;
END //
DELIMITER ;

-- 显示创建的表
SHOW TABLES;

-- 显示表结构
DESCRIBE conversations;
DESCRIBE requirements;
DESCRIBE system_logs;
DESCRIBE bot_status;