-- 创建群聊管理设置表
-- Migration: 002_create_group_chat_settings_table
-- Author: Claude Business Developer
-- Date: 2025-01-01

USE qqbot_db;

-- 创建群聊设置表
CREATE TABLE IF NOT EXISTS group_chat_settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    group_id BIGINT UNIQUE NOT NULL COMMENT '群号',
    group_name VARCHAR(255) COMMENT '群名称',
    is_enabled BOOLEAN DEFAULT true COMMENT '是否启用群聊AI回复',
    auto_reply_enabled BOOLEAN DEFAULT true COMMENT '是否自动回复',
    welcome_message TEXT COMMENT '欢迎消息',
    admin_user_id BIGINT COMMENT '管理员用户ID',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    last_activity TIMESTAMP NULL COMMENT '最后活跃时间',
    
    -- 索引
    INDEX idx_group_id (group_id),
    INDEX idx_is_enabled (is_enabled),
    INDEX idx_admin_user_id (admin_user_id),
    INDEX idx_last_activity (last_activity),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='群聊管理设置表';

-- 创建群聊消息统计表
CREATE TABLE IF NOT EXISTS group_chat_stats (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    group_id BIGINT NOT NULL COMMENT '群号',
    date DATE NOT NULL COMMENT '统计日期',
    message_count INT DEFAULT 0 COMMENT '消息数量',
    active_users INT DEFAULT 0 COMMENT '活跃用户数',
    ai_responses INT DEFAULT 0 COMMENT 'AI回复数量',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- 索引和约束
    UNIQUE KEY unique_group_date (group_id, date),
    INDEX idx_group_id (group_id),
    INDEX idx_date (date),
    INDEX idx_message_count (message_count),
    
    -- 外键约束
    FOREIGN KEY (group_id) REFERENCES group_chat_settings(group_id) 
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='群聊消息统计表';

-- 创建群聊活动日志表 (可选，用于详细记录)
CREATE TABLE IF NOT EXISTS group_chat_activity (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    group_id BIGINT NOT NULL COMMENT '群号',
    user_id BIGINT NOT NULL COMMENT '用户ID',
    message_type ENUM('user_message', 'ai_response', 'notice', 'join', 'leave') NOT NULL COMMENT '消息类型',
    content TEXT COMMENT '消息内容',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- 索引
    INDEX idx_group_id (group_id),
    INDEX idx_user_id (user_id),
    INDEX idx_message_type (message_type),
    INDEX idx_created_at (created_at),
    INDEX idx_group_user (group_id, user_id),
    
    -- 外键约束
    FOREIGN KEY (group_id) REFERENCES group_chat_settings(group_id) 
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='群聊活动日志表';

-- 插入一些测试数据 (可选)
INSERT IGNORE INTO group_chat_settings (group_id, group_name, is_enabled, auto_reply_enabled, welcome_message, admin_user_id)
VALUES 
(123456789, '测试群聊1', true, true, '欢迎加入群聊！我是智能助手，有问题可以@我', 85178516),
(987654321, '测试群聊2', false, true, null, 85178516);

-- 创建视图：群聊统计概览
CREATE OR REPLACE VIEW group_chat_overview AS
SELECT 
    gcs.group_id,
    gcs.group_name,
    gcs.is_enabled,
    gcs.auto_reply_enabled,
    gcs.last_activity,
    gcs.created_at,
    COALESCE(SUM(gst.message_count), 0) as total_messages,
    COALESCE(SUM(gst.ai_responses), 0) as total_ai_responses,
    COALESCE(AVG(gst.active_users), 0) as avg_active_users,
    DATEDIFF(NOW(), gcs.last_activity) as days_since_last_activity
FROM group_chat_settings gcs
LEFT JOIN group_chat_stats gst ON gcs.group_id = gst.group_id
GROUP BY gcs.group_id, gcs.group_name, gcs.is_enabled, gcs.auto_reply_enabled, 
         gcs.last_activity, gcs.created_at;

-- 创建存储过程：更新群聊活跃度
DELIMITER //
CREATE PROCEDURE UpdateGroupActivity(
    IN p_group_id BIGINT,
    IN p_message_count INT DEFAULT 1,
    IN p_ai_response_count INT DEFAULT 0
)
BEGIN
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;
    
    START TRANSACTION;
    
    -- 更新群聊设置的最后活跃时间
    UPDATE group_chat_settings 
    SET last_activity = CURRENT_TIMESTAMP 
    WHERE group_id = p_group_id;
    
    -- 更新或插入今日统计
    INSERT INTO group_chat_stats (group_id, date, message_count, ai_responses)
    VALUES (p_group_id, CURDATE(), p_message_count, p_ai_response_count)
    ON DUPLICATE KEY UPDATE
        message_count = message_count + VALUES(message_count),
        ai_responses = ai_responses + VALUES(ai_responses),
        updated_at = CURRENT_TIMESTAMP;
    
    COMMIT;
END //
DELIMITER ;

-- 创建存储过程：群聊数据清理
DELIMITER //
CREATE PROCEDURE CleanupGroupChatData(IN days_to_keep INT DEFAULT 30)
BEGIN
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;
    
    START TRANSACTION;
    
    -- 清理旧的群聊活动日志
    DELETE FROM group_chat_activity 
    WHERE created_at < DATE_SUB(NOW(), INTERVAL days_to_keep DAY);
    
    -- 清理旧的群聊统计数据 (保留更长时间，比如90天)
    DELETE FROM group_chat_stats 
    WHERE date < DATE_SUB(CURDATE(), INTERVAL (days_to_keep * 3) DAY);
    
    COMMIT;
END //
DELIMITER ;

-- 创建触发器：自动记录群聊设置变更
DELIMITER //
CREATE TRIGGER group_settings_update_trigger
    AFTER UPDATE ON group_chat_settings
    FOR EACH ROW
BEGIN
    -- 如果群聊状态发生变化，记录到活动日志
    IF OLD.is_enabled != NEW.is_enabled THEN
        INSERT INTO group_chat_activity (group_id, user_id, message_type, content)
        VALUES (NEW.group_id, NEW.admin_user_id, 'notice', 
                CONCAT('群聊AI回复状态变更: ', 
                       CASE WHEN NEW.is_enabled THEN '启用' ELSE '禁用' END));
    END IF;
END //
DELIMITER ;

-- 显示创建的表和视图
SHOW TABLES LIKE 'group_chat%';
SELECT 'Migration 002 completed successfully' as status;