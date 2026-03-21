-- 统一群聊/私聊开关模型，移除 receive_events
-- Migration: 024_unify_group_chat_switches
-- Date: 2026-03-21

USE qqbot_db;

-- 兼容老库：如果仍存在 receive_events，保留既有行为
SET @receive_events_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'group_chat_settings'
    AND COLUMN_NAME = 'receive_events'
);

SET @receive_events_backfill_sql = IF(
  @receive_events_exists > 0,
  'UPDATE group_chat_settings SET is_enabled = FALSE WHERE receive_events = FALSE',
  'SELECT 1'
);
PREPARE stmt FROM @receive_events_backfill_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE group_chat_settings
SET is_enabled = TRUE
WHERE is_enabled IS NULL;

UPDATE group_chat_settings
SET auto_reply_enabled = FALSE
WHERE auto_reply_enabled IS NULL;

UPDATE private_chat_settings
SET is_enabled = TRUE
WHERE is_enabled IS NULL;

UPDATE private_chat_settings
SET auto_reply_enabled = FALSE
WHERE auto_reply_enabled IS NULL;

-- 清理历史状态名，避免旧值阻塞后续枚举收敛
UPDATE conversations
SET status = 'filtered_disabled'
WHERE status = 'filtered_receive_events';

-- 统一字段语义和默认值
ALTER TABLE group_chat_settings
  MODIFY COLUMN is_enabled BOOLEAN DEFAULT TRUE COMMENT '是否接收群聊消息',
  MODIFY COLUMN auto_reply_enabled BOOLEAN DEFAULT FALSE COMMENT '是否自动回复群聊消息';

ALTER TABLE private_chat_settings
  MODIFY COLUMN is_enabled BOOLEAN DEFAULT TRUE COMMENT '是否接收私聊消息',
  MODIFY COLUMN auto_reply_enabled BOOLEAN DEFAULT FALSE COMMENT '是否自动回复私聊';

-- Conversation 过滤状态已经在运行时使用，这里同步扩展数据库枚举，避免过滤消息写库失败
ALTER TABLE conversations
  MODIFY COLUMN status ENUM(
    'pending',
    'processing',
    'completed',
    'failed',
    'filtered_disabled',
    'filtered_no_response',
    'filtered_empty_content'
  ) NOT NULL DEFAULT 'pending';

-- 群聊与私聊统一为两层开关后，删除群聊独有的 receive_events
SET @drop_receive_events_sql = IF(
  @receive_events_exists > 0,
  'ALTER TABLE group_chat_settings DROP COLUMN receive_events',
  'SELECT 1'
);
PREPARE stmt FROM @drop_receive_events_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 统一控制概览视图，收敛为接收/自动回复两层模型
DROP VIEW IF EXISTS bot_control_overview;
CREATE VIEW bot_control_overview AS
SELECT
  'groups' AS type,
  COUNT(*) AS total_count,
  SUM(CASE WHEN is_enabled = TRUE THEN 1 ELSE 0 END) AS enabled_count,
  SUM(CASE WHEN auto_reply_enabled = TRUE THEN 1 ELSE 0 END) AS auto_reply_count,
  SUM(CASE WHEN is_enabled = TRUE THEN 1 ELSE 0 END) AS receive_enabled_count,
  SUM(CASE WHEN last_activity >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) AS active_last_week
FROM group_chat_settings
UNION ALL
SELECT
  'private_chats' AS type,
  COUNT(*) AS total_count,
  SUM(CASE WHEN is_enabled = TRUE THEN 1 ELSE 0 END) AS enabled_count,
  SUM(CASE WHEN auto_reply_enabled = TRUE THEN 1 ELSE 0 END) AS auto_reply_count,
  SUM(CASE WHEN is_enabled = TRUE THEN 1 ELSE 0 END) AS receive_enabled_count,
  SUM(CASE WHEN last_activity >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) AS active_last_week
FROM private_chat_settings;

-- 私聊自动建档默认改为“接收开、回复关”
DROP PROCEDURE IF EXISTS UpdatePrivateChatActivity;
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

    UPDATE private_chat_settings
    SET last_activity = CURRENT_TIMESTAMP
    WHERE user_id = p_user_id;

    INSERT IGNORE INTO private_chat_settings (user_id, is_enabled, auto_reply_enabled)
    VALUES (p_user_id, TRUE, FALSE);

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

-- 批量设置过程去掉群聊独有的 receive_events 参数，保持群聊/私聊一致
DROP PROCEDURE IF EXISTS BatchUpdateChatSettings;
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

    SELECT 'success' AS result, id_count AS updated_count;
END //
DELIMITER ;
