-- 015_create_message_history_tables.sql
-- 创建群聊与私聊消息历史表，用于构建上下文所需的完整消息链

CREATE TABLE IF NOT EXISTS group_message_history (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    conversation_id VARCHAR(36) NULL COMMENT '关联conversations.id，记录来源会话',
    message_id BIGINT NULL COMMENT 'OneBot消息ID，可用于去重与回溯',
    group_id BIGINT NOT NULL COMMENT '群聊ID',
    sender_id BIGINT NOT NULL COMMENT '发送者QQ号（机器人或用户）',
    sender_role ENUM('user', 'bot', 'system') DEFAULT 'user' COMMENT '发送者角色',
    content_type ENUM('text', 'image', 'audio', 'video') DEFAULT 'text' COMMENT '消息内容类型',
    content TEXT NOT NULL COMMENT '消息内容（文本或富媒体描述）',
    raw_payload JSON NULL COMMENT '原始OneBot消息载荷',
    sent_at DATETIME NOT NULL COMMENT '消息发送时间',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_group_sent_at (group_id, sent_at),
    INDEX idx_conversation (conversation_id),
    INDEX idx_sender (sender_id, sent_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS private_message_history (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    conversation_id VARCHAR(36) NULL COMMENT '关联conversations.id，记录来源会话',
    message_id BIGINT NULL COMMENT 'OneBot消息ID，可用于去重与回溯',
    user_id BIGINT NOT NULL COMMENT '私聊用户ID',
    sender_id BIGINT NOT NULL COMMENT '发送者QQ号（机器人或用户）',
    sender_role ENUM('user', 'bot', 'system') DEFAULT 'user' COMMENT '发送者角色',
    content_type ENUM('text', 'image', 'audio', 'video') DEFAULT 'text' COMMENT '消息内容类型',
    content TEXT NOT NULL COMMENT '消息内容（文本或富媒体描述）',
    raw_payload JSON NULL COMMENT '原始OneBot消息载荷',
    sent_at DATETIME NOT NULL COMMENT '消息发送时间',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_user_sent_at (user_id, sent_at),
    INDEX idx_conversation (conversation_id),
    INDEX idx_sender (sender_id, sent_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
