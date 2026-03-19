-- Ensure session management tables support current session IDs and reply tracking

ALTER TABLE conversation_sessions
  MODIFY COLUMN session_id VARCHAR(128) NOT NULL;

CREATE TABLE IF NOT EXISTS message_reply_chain (
  id BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '自增主键',
  message_id VARCHAR(64) NOT NULL COMMENT 'OneBot消息ID',
  reply_to_message_id VARCHAR(64) NULL COMMENT '回复的消息ID',
  user_id BIGINT NOT NULL COMMENT '用户QQ号',
  session_id VARCHAR(128) NOT NULL COMMENT 'Session ID',
  depth INT DEFAULT 0 COMMENT '引用链深度',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',

  UNIQUE KEY uk_message (message_id),
  INDEX idx_reply_chain (reply_to_message_id, session_id),
  INDEX idx_session_depth (session_id, depth),
  INDEX idx_user_session (user_id, session_id),

  CONSTRAINT fk_reply_session
    FOREIGN KEY (session_id)
    REFERENCES conversation_sessions(session_id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='消息回复链追溯表';
