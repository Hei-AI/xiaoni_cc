CREATE TABLE IF NOT EXISTS message_attention_events (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    source_key VARCHAR(100) NOT NULL COMMENT '消息来源分区，如 user_123 / group_456',
    source_type ENUM('private', 'group') NOT NULL COMMENT '聊天来源类型',
    source_id BIGINT NOT NULL COMMENT 'user_id 或 group_id',
    message_history_table ENUM('private_message_history', 'group_message_history') NOT NULL COMMENT '关联的历史消息表',
    message_history_id BIGINT UNSIGNED NOT NULL COMMENT '历史消息记录 ID',
    attention_state ENUM('attended', 'referenced', 'acted') NOT NULL DEFAULT 'attended' COMMENT '消息被 bot 真正看到/引用/执行的状态',
    attention_reason VARCHAR(50) NOT NULL DEFAULT 'viewport_visible' COMMENT '进入注意力窗口的原因',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_attention_state (source_key, message_history_table, message_history_id, attention_state),
    INDEX idx_attention_lookup (message_history_table, message_history_id),
    INDEX idx_attention_source (source_key, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
