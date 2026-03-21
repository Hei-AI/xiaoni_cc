-- 创建私聊管理设置表
-- Migration: 003_create_private_chat_settings_table  
-- Author: Claude Business Developer
-- Date: 2025-09-13

USE qqbot_db;

-- 创建私聊设置表
CREATE TABLE IF NOT EXISTS private_chat_settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNIQUE NOT NULL COMMENT '用户QQ号',
    username VARCHAR(255) COMMENT '用户昵称',
    is_enabled BOOLEAN DEFAULT TRUE COMMENT '是否接收私聊消息',
    auto_reply_enabled BOOLEAN DEFAULT FALSE COMMENT '是否自动回复私聊',
    welcome_message TEXT COMMENT '首次对话欢迎消息',
    user_notes TEXT COMMENT '用户备注信息',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    last_activity TIMESTAMP NULL COMMENT '最后活跃时间',
    
    -- 索引
    INDEX idx_user_id (user_id),
    INDEX idx_is_enabled (is_enabled),
    INDEX idx_auto_reply_enabled (auto_reply_enabled),
    INDEX idx_last_activity (last_activity),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='私聊管理设置表';

-- 创建私聊消息统计表
CREATE TABLE IF NOT EXISTS private_chat_stats (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL COMMENT '用户QQ号',
    date DATE NOT NULL COMMENT '统计日期',
    message_count INT DEFAULT 0 COMMENT '私聊消息数量',
    ai_responses INT DEFAULT 0 COMMENT 'AI回复数量',
    conversation_sessions INT DEFAULT 0 COMMENT '对话会话数',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- 索引和约束
    UNIQUE KEY unique_user_date (user_id, date),
    INDEX idx_user_id (user_id),
    INDEX idx_date (date),
    INDEX idx_message_count (message_count),
    
    -- 外键约束
    FOREIGN KEY (user_id) REFERENCES private_chat_settings(user_id) 
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='私聊消息统计表';

-- 创建私聊活动日志表
CREATE TABLE IF NOT EXISTS private_chat_activity (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL COMMENT '用户QQ号',
    message_type ENUM('user_message', 'ai_response', 'session_start', 'session_end') NOT NULL COMMENT '消息类型',
    content TEXT COMMENT '消息内容',
    session_id VARCHAR(36) COMMENT '关联会话ID',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- 索引
    INDEX idx_user_id (user_id),
    INDEX idx_message_type (message_type),
    INDEX idx_session_id (session_id),
    INDEX idx_created_at (created_at),
    
    -- 外键约束
    FOREIGN KEY (user_id) REFERENCES private_chat_settings(user_id) 
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='私聊活动日志表';

-- 插入一些测试私聊数据
INSERT IGNORE INTO private_chat_settings (user_id, username, is_enabled, auto_reply_enabled, welcome_message, user_notes)
VALUES 
(85178516, '测试用户1', TRUE, TRUE, '你好！我是智能助手，有什么可以帮您的吗？', '测试用户'),
(123456789, '测试用户2', FALSE, TRUE, null, '已禁用的测试用户');

-- 创建视图：私聊统计概览
CREATE OR REPLACE VIEW private_chat_overview AS
SELECT 
    pcs.user_id,
    pcs.username,
    pcs.is_enabled,
    pcs.auto_reply_enabled,
    pcs.last_activity,
    pcs.created_at,
    COALESCE(SUM(pst.message_count), 0) as total_messages,
    COALESCE(SUM(pst.ai_responses), 0) as total_ai_responses,
    COALESCE(SUM(pst.conversation_sessions), 0) as total_sessions,
    DATEDIFF(NOW(), pcs.last_activity) as days_since_last_activity
FROM private_chat_settings pcs
LEFT JOIN private_chat_stats pst ON pcs.user_id = pst.user_id
GROUP BY pcs.user_id, pcs.username, pcs.is_enabled, pcs.auto_reply_enabled, 
         pcs.last_activity, pcs.created_at;

-- 创建视图：全局Bot控制设置概览
CREATE OR REPLACE VIEW bot_control_overview AS
SELECT 
    'groups' as type,
    COUNT(*) as total_count,
    SUM(CASE WHEN is_enabled = TRUE THEN 1 ELSE 0 END) as enabled_count,
    SUM(CASE WHEN auto_reply_enabled = TRUE THEN 1 ELSE 0 END) as auto_reply_count,
    SUM(CASE WHEN is_enabled = TRUE THEN 1 ELSE 0 END) as receive_enabled_count,
    SUM(CASE WHEN last_activity >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) as active_last_week
FROM group_chat_settings
UNION ALL
SELECT 
    'private_chats' as type,
    COUNT(*) as total_count,
    SUM(CASE WHEN is_enabled = TRUE THEN 1 ELSE 0 END) as enabled_count,
    SUM(CASE WHEN auto_reply_enabled = TRUE THEN 1 ELSE 0 END) as auto_reply_count,
    SUM(CASE WHEN is_enabled = TRUE THEN 1 ELSE 0 END) as receive_enabled_count,
    SUM(CASE WHEN last_activity >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) as active_last_week
FROM private_chat_settings;

-- 创建存储过程：更新私聊活跃度
DELIMITER //
CREATE PROCEDURE UpdatePrivateChatActivity(
    IN p_user_id BIGINT,
    IN p_message_count INT,
    IN p_ai_response_count INT,
    IN p_session_count INT
)
BEGIN
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;
    
    START TRANSACTION;
    
    -- 更新私聊设置的最后活跃时间
    UPDATE private_chat_settings 
    SET last_activity = CURRENT_TIMESTAMP 
    WHERE user_id = p_user_id;
    
    -- 如果用户不存在，自动创建记录
    INSERT IGNORE INTO private_chat_settings (user_id, is_enabled, auto_reply_enabled)
    VALUES (p_user_id, TRUE, FALSE);
    
    -- 更新或插入今日统计
    INSERT INTO private_chat_stats (user_id, date, message_count, ai_responses, conversation_sessions)
    VALUES (p_user_id, CURDATE(), p_message_count, p_ai_response_count, p_session_count)
    ON DUPLICATE KEY UPDATE
        message_count = message_count + VALUES(message_count),
        ai_responses = ai_responses + VALUES(ai_responses),
        conversation_sessions = conversation_sessions + VALUES(conversation_sessions),
        updated_at = CURRENT_TIMESTAMP;
    
    COMMIT;
END //
DELIMITER ;

-- 创建存储过程：批量更新控制设置
DELIMITER //
CREATE PROCEDURE BatchUpdateChatSettings(
    IN p_type ENUM('group', 'private'),
    IN p_ids JSON,
    IN p_is_enabled BOOLEAN,
    IN p_auto_reply_enabled BOOLEAN
)
BEGIN
    DECLARE i INT DEFAULT 0;
    DECLARE id_count INT;
    DECLARE current_id BIGINT;
    
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;
    
    START TRANSACTION;
    
    SET id_count = JSON_LENGTH(p_ids);
    
    -- 根据类型批量更新
    IF p_type = 'group' THEN
        WHILE i < id_count DO
            SET current_id = CAST(JSON_UNQUOTE(JSON_EXTRACT(p_ids, CONCAT('$[', i, ']'))) AS UNSIGNED);
            
            UPDATE group_chat_settings 
            SET 
                is_enabled = COALESCE(p_is_enabled, is_enabled),
                auto_reply_enabled = COALESCE(p_auto_reply_enabled, auto_reply_enabled),
                updated_at = CURRENT_TIMESTAMP
            WHERE group_id = current_id;
            
            SET i = i + 1;
        END WHILE;
    ELSEIF p_type = 'private' THEN
        WHILE i < id_count DO
            SET current_id = CAST(JSON_UNQUOTE(JSON_EXTRACT(p_ids, CONCAT('$[', i, ']'))) AS UNSIGNED);
            
            UPDATE private_chat_settings 
            SET 
                is_enabled = COALESCE(p_is_enabled, is_enabled),
                auto_reply_enabled = COALESCE(p_auto_reply_enabled, auto_reply_enabled),
                updated_at = CURRENT_TIMESTAMP
            WHERE user_id = current_id;
            
            SET i = i + 1;
        END WHILE;
    END IF;
    
    COMMIT;
    
    SELECT 'success' as result, id_count as updated_count;
END //
DELIMITER ;

-- 创建存储过程：事件控制数据清理
DELIMITER //
CREATE PROCEDURE CleanupChatControlData(IN days_to_keep INT)
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
    
    -- 清理旧的私聊活动日志
    DELETE FROM private_chat_activity 
    WHERE created_at < DATE_SUB(NOW(), INTERVAL days_to_keep DAY);
    
    -- 清理旧的统计数据 (保留更长时间，比如90天)
    DELETE FROM group_chat_stats 
    WHERE date < DATE_SUB(CURDATE(), INTERVAL (days_to_keep * 3) DAY);
    
    DELETE FROM private_chat_stats 
    WHERE date < DATE_SUB(CURDATE(), INTERVAL (days_to_keep * 3) DAY);
    
    COMMIT;
    
    SELECT 'Cleanup completed successfully' as result;
END //
DELIMITER ;

-- 创建触发器：私聊设置变更记录
DELIMITER //
CREATE TRIGGER private_chat_settings_update_trigger
    AFTER UPDATE ON private_chat_settings
    FOR EACH ROW
BEGIN
    -- 如果私聊状态发生变化，记录到活动日志
    IF OLD.is_enabled != NEW.is_enabled THEN
        INSERT INTO private_chat_activity (user_id, message_type, content)
        VALUES (NEW.user_id, 'session_start', 
                CONCAT('私聊AI回复状态变更: ', 
                       CASE WHEN NEW.is_enabled THEN '启用' ELSE '禁用' END));
    END IF;
    
    -- 如果自动回复状态发生变化
    IF OLD.auto_reply_enabled != NEW.auto_reply_enabled THEN
        INSERT INTO private_chat_activity (user_id, message_type, content)
        VALUES (NEW.user_id, 'session_start', 
                CONCAT('自动回复状态变更: ', 
                       CASE WHEN NEW.auto_reply_enabled THEN '启用' ELSE '禁用' END));
    END IF;
END //
DELIMITER ;

-- 显示创建的表和视图
SHOW TABLES LIKE '%chat%';
SELECT 'Migration 003 completed successfully' as status;
