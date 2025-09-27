-- 创建Prompt调试会话表
CREATE TABLE IF NOT EXISTS prompt_debug_sessions (
    id VARCHAR(36) PRIMARY KEY,
    prompt_id VARCHAR(36) NOT NULL,
    session_name VARCHAR(255) NOT NULL DEFAULT 'Debug Session',
    messages JSON NOT NULL,
    input_count INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_prompt_id (prompt_id),
    INDEX idx_created_at (created_at),
    FOREIGN KEY (prompt_id) REFERENCES agent_prompts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;