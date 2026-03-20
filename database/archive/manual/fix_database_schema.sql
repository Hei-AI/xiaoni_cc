USE qqbot_db;

-- Ensure conversation_sessions table exists
CREATE TABLE IF NOT EXISTS conversation_sessions (
    session_id VARCHAR(36) PRIMARY KEY,
    user_id BIGINT NOT NULL,
    session_type ENUM('chat', 'requirement', 'mixed') DEFAULT 'chat',
    current_service VARCHAR(50) DEFAULT 'chat',
    status ENUM('active', 'paused', 'completed', 'expired') DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_activity DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    expires_at DATETIME,
    conversation_context JSON,
    business_context JSON,
    message_count INT DEFAULT 0,
    service_transitions JSON,
    recent_messages JSON,
    
    INDEX idx_user_id (user_id),
    INDEX idx_status (status),
    INDEX idx_expires_at (expires_at),
    INDEX idx_last_activity (last_activity)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Ensure raw_request and raw_response columns exist in conversations table
ALTER TABLE conversations
ADD COLUMN IF NOT EXISTS raw_request TEXT,
ADD COLUMN IF NOT EXISTS raw_response TEXT;

-- Ensure message_id, reply_to_message_id, reply_to_text columns exist
ALTER TABLE conversations
ADD COLUMN IF NOT EXISTS message_id BIGINT,
ADD COLUMN IF NOT EXISTS reply_to_message_id BIGINT,
ADD COLUMN IF NOT EXISTS reply_to_text TEXT;

-- Ensure session_id column exists for session management support  
ALTER TABLE conversations
ADD COLUMN IF NOT EXISTS session_id VARCHAR(36);

-- Add foreign key index for session management if not exists
-- Note: We don't add the actual foreign key constraint as it might fail if there are existing records
CREATE INDEX IF NOT EXISTS idx_session_id ON conversations(session_id);

-- Show confirmation
SELECT 'Database schema fix completed' as status;
SELECT COUNT(*) as conversation_sessions_count FROM conversation_sessions;
DESCRIBE conversations;