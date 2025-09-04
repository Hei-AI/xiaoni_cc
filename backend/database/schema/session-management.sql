-- Session管理和消息引用回复系统数据库Schema
-- 基于企业级Session管理架构设计

-- 1. 对话Session管理表
CREATE TABLE IF NOT EXISTS conversation_sessions (
    session_id VARCHAR(100) PRIMARY KEY COMMENT 'Session唯一标识',
    user_id BIGINT NOT NULL COMMENT '用户QQ号',
    session_type ENUM('chat', 'requirement', 'mixed') NOT NULL DEFAULT 'chat' COMMENT 'Session类型',
    current_service VARCHAR(50) NOT NULL DEFAULT 'chat_service' COMMENT '当前活跃服务',
    status ENUM('active', 'paused', 'completed', 'expired') NOT NULL DEFAULT 'active' COMMENT 'Session状态',
    
    -- 时间管理
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后活动时间',
    expires_at TIMESTAMP NULL COMMENT '过期时间',
    completed_at TIMESTAMP NULL COMMENT '完成时间',
    
    -- 上下文数据
    conversation_context JSON COMMENT '对话上下文数据',
    business_context JSON COMMENT '业务上下文数据',
    user_preferences JSON COMMENT '用户偏好设置',
    
    -- 统计信息
    message_count INT DEFAULT 0 COMMENT '消息数量',
    service_transitions JSON COMMENT '服务切换历史',
    recent_messages JSON COMMENT '最近消息缓存',
    
    -- 索引
    INDEX idx_user_status (user_id, status),
    INDEX idx_user_activity (user_id, last_activity DESC),
    INDEX idx_status_created (status, created_at),
    INDEX idx_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='对话Session管理表';

-- 2. 消息回复链追溯表
CREATE TABLE IF NOT EXISTS message_reply_chain (
    id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '自增主键',
    message_id VARCHAR(50) NOT NULL COMMENT 'OneBot消息ID',
    reply_to_message_id VARCHAR(50) NULL COMMENT '回复的消息ID',
    user_id BIGINT NOT NULL COMMENT '用户QQ号',
    session_id VARCHAR(100) NOT NULL COMMENT 'Session ID',
    depth INT DEFAULT 0 COMMENT '引用链深度',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    
    -- 唯一约束和索引
    UNIQUE KEY uk_message (message_id),
    INDEX idx_reply_chain (reply_to_message_id, session_id),
    INDEX idx_session_depth (session_id, depth),
    INDEX idx_user_session (user_id, session_id),
    
    -- 外键约束
    FOREIGN KEY (session_id) REFERENCES conversation_sessions(session_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='消息回复链追溯表';

-- 3. Session事件审计表 (支持分区)
CREATE TABLE IF NOT EXISTS session_events (
    id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '自增主键',
    session_id VARCHAR(100) NOT NULL COMMENT 'Session ID',
    event_type VARCHAR(50) NOT NULL COMMENT '事件类型',
    event_data JSON COMMENT '事件详细数据',
    
    timestamp TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3) COMMENT '事件时间戳(精确到毫秒)',
    service VARCHAR(50) COMMENT '触发服务',
    trace_id VARCHAR(64) COMMENT '链路追踪ID',
    
    -- 索引
    INDEX idx_session_time (session_id, timestamp),
    INDEX idx_event_type (event_type, timestamp),
    INDEX idx_trace (trace_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Session事件审计表'
PARTITION BY RANGE (UNIX_TIMESTAMP(timestamp)) (
    PARTITION p_2025_01 VALUES LESS THAN (UNIX_TIMESTAMP('2025-02-01')),
    PARTITION p_2025_02 VALUES LESS THAN (UNIX_TIMESTAMP('2025-03-01')),
    PARTITION p_2025_03 VALUES LESS THAN (UNIX_TIMESTAMP('2025-04-01')),
    PARTITION p_future VALUES LESS THAN MAXVALUE
);

-- 4. LLM交互记录表 (支持分区)
CREATE TABLE IF NOT EXISTS llm_interactions (
    id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '自增主键',
    session_id VARCHAR(100) NOT NULL COMMENT 'Session ID',
    
    -- LLM调用信息
    model VARCHAR(50) NOT NULL COMMENT '使用的LLM模型',
    prompt_text LONGTEXT COMMENT '输入提示词',
    response_text LONGTEXT COMMENT '模型响应文本',
    
    -- Token统计
    prompt_tokens INT DEFAULT 0 COMMENT '提示词Token数',
    completion_tokens INT DEFAULT 0 COMMENT '完成Token数',
    total_tokens INT DEFAULT 0 COMMENT '总Token数',
    cost_usd DECIMAL(10,4) DEFAULT 0 COMMENT '成本(美元)',
    
    -- 性能指标
    duration_ms INT DEFAULT 0 COMMENT '调用耗时(毫秒)',
    timestamp TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3) COMMENT '调用时间戳',
    
    -- 索引
    INDEX idx_session_time (session_id, timestamp),
    INDEX idx_model_time (model, timestamp),
    INDEX idx_cost (cost_usd, timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='LLM交互记录表'
PARTITION BY RANGE (UNIX_TIMESTAMP(timestamp)) (
    PARTITION p_2025_01 VALUES LESS THAN (UNIX_TIMESTAMP('2025-02-01')),
    PARTITION p_2025_02 VALUES LESS THAN (UNIX_TIMESTAMP('2025-03-01')),
    PARTITION p_2025_03 VALUES LESS THAN (UNIX_TIMESTAMP('2025-04-01')),
    PARTITION p_future VALUES LESS THAN MAXVALUE
);

-- 5. 服务调用日志表
CREATE TABLE IF NOT EXISTS service_call_logs (
    id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '自增主键',
    session_id VARCHAR(100) NOT NULL COMMENT 'Session ID',
    
    -- 服务调用信息
    from_service VARCHAR(50) NOT NULL COMMENT '调用方服务',
    to_service VARCHAR(50) NOT NULL COMMENT '被调用服务',
    call_data JSON COMMENT '调用参数',
    response_data JSON COMMENT '响应数据',
    
    -- 性能信息
    duration_ms INT DEFAULT 0 COMMENT '调用耗时(毫秒)',
    status_code INT COMMENT 'HTTP状态码',
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '调用时间',
    
    -- 索引
    INDEX idx_session_time (session_id, timestamp),
    INDEX idx_service_call (from_service, to_service, timestamp),
    INDEX idx_status (status_code, timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='服务调用日志表';

-- 6. 用户确认记录表
CREATE TABLE IF NOT EXISTS user_confirmations (
    id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '自增主键',
    user_id BIGINT NOT NULL COMMENT '用户QQ号',
    confirmation_id VARCHAR(64) NOT NULL COMMENT '确认ID',
    
    -- 确认内容
    original_message LONGTEXT COMMENT '原始消息',
    intent_analysis JSON COMMENT '意图分析结果',
    user_response TEXT COMMENT '用户确认回复',
    final_decision VARCHAR(50) COMMENT '最终决策结果',
    
    -- 时间信息
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    responded_at TIMESTAMP NULL COMMENT '用户回复时间',
    expires_at TIMESTAMP NULL COMMENT '过期时间',
    
    -- 索引
    INDEX idx_user_time (user_id, created_at),
    INDEX idx_confirmation (confirmation_id),
    INDEX idx_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户确认记录表';

-- 7. 服务性能监控表
CREATE TABLE IF NOT EXISTS service_metrics (
    id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '自增主键',
    service_name VARCHAR(50) NOT NULL COMMENT '服务名称',
    metric_type VARCHAR(50) NOT NULL COMMENT '指标类型',
    metric_value DECIMAL(15,4) NOT NULL COMMENT '指标数值',
    
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '记录时间',
    tags JSON COMMENT '标签数据',
    
    -- 索引
    INDEX idx_service_metric_time (service_name, metric_type, timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='服务性能监控表';

-- 8. 扩展conversations表以支持消息引用
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS message_id VARCHAR(50) COMMENT 'OneBot消息ID';
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS reply_to_message_id VARCHAR(50) COMMENT '回复的消息ID';
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS session_id VARCHAR(100) COMMENT '关联的Session ID';
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS message_segments JSON COMMENT 'OneBot消息段数据';

-- 为conversations表添加索引
CREATE INDEX IF NOT EXISTS idx_conversations_message_id ON conversations (message_id);
CREATE INDEX IF NOT EXISTS idx_conversations_session ON conversations (session_id);
CREATE INDEX IF NOT EXISTS idx_conversations_reply ON conversations (reply_to_message_id);

-- 9. 扩展requirements表以支持status过滤
ALTER TABLE requirements ADD COLUMN IF NOT EXISTS priority ENUM('low', 'medium', 'high', 'critical') DEFAULT 'medium' COMMENT '需求优先级';
ALTER TABLE requirements ADD COLUMN IF NOT EXISTS tags JSON COMMENT '需求标签';
ALTER TABLE requirements ADD COLUMN IF NOT EXISTS estimated_hours DECIMAL(5,2) COMMENT '预估工时';

-- 为requirements表添加索引
CREATE INDEX IF NOT EXISTS idx_requirements_status ON requirements (status, created_at);
CREATE INDEX IF NOT EXISTS idx_requirements_user_status ON requirements (user_id, status, created_at);

-- 10. Session管理相关的视图
CREATE OR REPLACE VIEW v_active_sessions AS
SELECT 
    s.session_id,
    s.user_id,
    s.session_type,
    s.current_service,
    s.status,
    s.created_at,
    s.last_activity,
    s.message_count,
    COUNT(mrc.id) as reply_chain_length
FROM conversation_sessions s
LEFT JOIN message_reply_chain mrc ON s.session_id = mrc.session_id
WHERE s.status = 'active'
GROUP BY s.session_id
ORDER BY s.last_activity DESC;

-- 11. Session统计视图
CREATE OR REPLACE VIEW v_session_stats AS
SELECT 
    s.user_id,
    COUNT(*) as total_sessions,
    COUNT(CASE WHEN s.status = 'active' THEN 1 END) as active_sessions,
    COUNT(CASE WHEN s.status = 'completed' THEN 1 END) as completed_sessions,
    AVG(s.message_count) as avg_messages_per_session,
    MAX(s.last_activity) as last_activity,
    SUM(CASE WHEN s.status = 'active' THEN TIMESTAMPDIFF(HOUR, s.created_at, NOW()) ELSE 0 END) as total_active_hours
FROM conversation_sessions s
GROUP BY s.user_id;

-- 12. 创建定期清理过期Session的存储过程
DELIMITER $$
CREATE OR REPLACE PROCEDURE CleanupExpiredSessions()
BEGIN
    DECLARE cleaned_count INT DEFAULT 0;
    
    -- 更新过期的Session状态
    UPDATE conversation_sessions 
    SET status = 'expired', 
        completed_at = NOW()
    WHERE status = 'active' 
      AND expires_at IS NOT NULL 
      AND expires_at < NOW();
    
    SET cleaned_count = ROW_COUNT();
    
    -- 清理超过30天的过期确认记录
    DELETE FROM user_confirmations 
    WHERE expires_at IS NOT NULL 
      AND expires_at < DATE_SUB(NOW(), INTERVAL 30 DAY);
    
    -- 记录清理日志
    INSERT INTO service_metrics (service_name, metric_type, metric_value, tags)
    VALUES ('session_manager', 'cleanup_expired_sessions', cleaned_count, JSON_OBJECT('timestamp', NOW()));
    
    SELECT cleaned_count as sessions_cleaned;
END$$
DELIMITER ;

-- 13. 创建Session性能统计的存储过程
DELIMITER $$
CREATE OR REPLACE PROCEDURE GetSessionPerformanceStats(IN p_user_id BIGINT, IN p_days INT)
BEGIN
    SELECT 
        s.session_type,
        COUNT(*) as session_count,
        AVG(s.message_count) as avg_messages,
        AVG(CASE WHEN s.completed_at IS NOT NULL THEN 
            TIMESTAMPDIFF(MINUTE, s.created_at, s.completed_at) 
        END) as avg_duration_minutes,
        COUNT(CASE WHEN s.status = 'completed' THEN 1 END) as completed_count,
        COUNT(CASE WHEN s.status = 'active' THEN 1 END) as active_count
    FROM conversation_sessions s
    WHERE (p_user_id IS NULL OR s.user_id = p_user_id)
      AND s.created_at >= DATE_SUB(NOW(), INTERVAL p_days DAY)
    GROUP BY s.session_type
    ORDER BY session_count DESC;
END$$
DELIMITER ;

-- 创建索引优化查询性能
CREATE INDEX IF NOT EXISTS idx_conversations_created_user ON conversations (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_requirements_priority_status ON requirements (priority, status, created_at);
CREATE INDEX IF NOT EXISTS idx_session_events_type_time ON session_events (event_type, timestamp);