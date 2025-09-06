-- QQ Bot MVP Core Tables Migration
-- 对话窗口管理、用户画像、Prompt热加载管理
-- 执行时间: 2025-09-04
-- 版本: v1.0.0

USE qqbot_db;

-- =============================================================================
-- 1. 对话窗口管理表
-- =============================================================================

-- 对话窗口配置表
CREATE TABLE IF NOT EXISTS conversation_windows (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    window_name VARCHAR(100) NOT NULL DEFAULT 'default',
    window_size INT NOT NULL DEFAULT 10,
    window_type ENUM('fixed', 'sliding', 'semantic') NOT NULL DEFAULT 'sliding',
    context_retention_strategy ENUM('simple', 'summary', 'keyword') DEFAULT 'simple',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_user_id (user_id),
    INDEX idx_window_type (window_type),
    INDEX idx_is_active (is_active),
    UNIQUE KEY unique_user_window (user_id, window_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 窗口消息存储表
CREATE TABLE IF NOT EXISTS window_messages (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    window_id BIGINT NOT NULL,
    conversation_id VARCHAR(50) NOT NULL,
    user_id BIGINT NOT NULL,
    sequence_number INT NOT NULL,
    message_role ENUM('user', 'assistant', 'system') NOT NULL,
    message_content TEXT NOT NULL,
    token_count INT DEFAULT 0,
    importance_score FLOAT DEFAULT 0.0,
    is_pinned BOOLEAN DEFAULT FALSE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_window_id (window_id),
    INDEX idx_conversation_id (conversation_id),
    INDEX idx_sequence (sequence_number),
    INDEX idx_importance (importance_score DESC),
    FOREIGN KEY (window_id) REFERENCES conversation_windows(id) ON DELETE CASCADE,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 2. 用户画像系统表
-- =============================================================================

-- 用户基础画像表
CREATE TABLE IF NOT EXISTS user_profiles (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNIQUE NOT NULL,
    nickname VARCHAR(200),
    preferred_language VARCHAR(10) DEFAULT 'zh-CN',
    interaction_style ENUM('formal', 'casual', 'technical', 'friendly') DEFAULT 'casual',
    response_length_preference ENUM('brief', 'detailed', 'adaptive') DEFAULT 'adaptive',
    topic_preferences JSON,
    communication_patterns JSON,
    skill_level ENUM('beginner', 'intermediate', 'advanced', 'expert') DEFAULT 'intermediate',
    last_interaction DATETIME,
    interaction_count INT DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_user_id (user_id),
    INDEX idx_last_interaction (last_interaction),
    INDEX idx_interaction_style (interaction_style),
    INDEX idx_skill_level (skill_level)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 用户上下文记录表
CREATE TABLE IF NOT EXISTS user_context (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    context_key VARCHAR(100) NOT NULL,
    context_value TEXT NOT NULL,
    context_type ENUM('preference', 'memory', 'state', 'history') DEFAULT 'memory',
    priority INT DEFAULT 5,
    expires_at DATETIME,
    is_persistent BOOLEAN DEFAULT FALSE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_user_id (user_id),
    INDEX idx_context_key (context_key),
    INDEX idx_context_type (context_type),
    INDEX idx_priority (priority DESC),
    INDEX idx_expires_at (expires_at),
    UNIQUE KEY unique_user_context (user_id, context_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 3. Prompt热加载管理表
-- =============================================================================

-- Prompt模板表
CREATE TABLE IF NOT EXISTS prompt_templates (
    id VARCHAR(50) PRIMARY KEY,
    template_name VARCHAR(100) NOT NULL,
    category ENUM('system', 'conversation', 'analysis', 'generation', 'custom') NOT NULL DEFAULT 'conversation',
    template_content TEXT NOT NULL,
    variables JSON,
    usage_instructions TEXT,
    version VARCHAR(20) NOT NULL DEFAULT '1.0.0',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_default BOOLEAN DEFAULT FALSE,
    author VARCHAR(100) DEFAULT 'system',
    tags VARCHAR(500),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_category (category),
    INDEX idx_is_active (is_active),
    INDEX idx_is_default (is_default),
    INDEX idx_version (version),
    UNIQUE KEY unique_template_name (template_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Prompt动态配置表
CREATE TABLE IF NOT EXISTS prompt_configs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    config_name VARCHAR(100) NOT NULL,
    prompt_template_id VARCHAR(50) NOT NULL,
    user_id BIGINT,
    group_id BIGINT,
    config_scope ENUM('global', 'user', 'group', 'session') NOT NULL DEFAULT 'global',
    config_parameters JSON NOT NULL,
    priority INT DEFAULT 5,
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    effective_from DATETIME DEFAULT CURRENT_TIMESTAMP,
    effective_until DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_config_scope (config_scope),
    INDEX idx_user_id (user_id),
    INDEX idx_group_id (group_id),
    INDEX idx_priority (priority DESC),
    INDEX idx_is_enabled (is_enabled),
    INDEX idx_effective_time (effective_from, effective_until),
    FOREIGN KEY (prompt_template_id) REFERENCES prompt_templates(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 4. 调试和追踪表
-- =============================================================================

-- 消息链路追踪表
CREATE TABLE IF NOT EXISTS message_chains (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    chain_id VARCHAR(50) NOT NULL,
    user_id BIGINT NOT NULL,
    session_id VARCHAR(50),
    message_id VARCHAR(50) NOT NULL,
    parent_message_id VARCHAR(50),
    chain_depth INT DEFAULT 0,
    chain_position INT DEFAULT 0,
    processing_steps JSON,
    timing_info JSON,
    context_used JSON,
    prompt_template_used VARCHAR(50),
    model_params JSON,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_chain_id (chain_id),
    INDEX idx_user_id (user_id),
    INDEX idx_session_id (session_id),
    INDEX idx_message_id (message_id),
    INDEX idx_chain_depth (chain_depth),
    FOREIGN KEY (prompt_template_used) REFERENCES prompt_templates(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 调试信息表
CREATE TABLE IF NOT EXISTS debug_logs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    trace_id VARCHAR(50) NOT NULL,
    debug_level ENUM('TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR') NOT NULL DEFAULT 'INFO',
    component VARCHAR(100) NOT NULL,
    operation VARCHAR(100) NOT NULL,
    debug_data JSON,
    execution_time_ms INT,
    memory_usage_mb FLOAT,
    error_details TEXT,
    stack_trace TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_trace_id (trace_id),
    INDEX idx_debug_level (debug_level),
    INDEX idx_component (component),
    INDEX idx_operation (operation),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 5. 插入初始数据
-- =============================================================================

-- 插入默认Prompt模板
INSERT INTO prompt_templates (id, template_name, category, template_content, variables, version, is_active, is_default, author) VALUES 
('chat_default', '默认对话模板', 'conversation', 
'你是一个智能QQ机器人助手。请根据用户的消息进行回复。\n\n用户信息：\n- 昵称：{{user_nickname}}\n- 交互风格：{{interaction_style}}\n- 技能水平：{{skill_level}}\n\n请用{{response_style}}的风格回复用户的消息：{{user_message}}', 
'{"user_nickname": "用户", "interaction_style": "casual", "skill_level": "intermediate", "response_style": "友好", "user_message": ""}', 
'1.0.0', TRUE, TRUE, 'system'),

('intent_analysis', '意图分析模板', 'analysis', 
'分析以下用户消息的意图，并返回JSON格式结果：\n\n用户消息：{{user_message}}\n\n请分析：\n1. 主要意图类型\n2. 情感倾向\n3. 优先级\n4. 建议的处理方式\n\n返回格式：{"intent": "", "emotion": "", "priority": "", "action": ""}', 
'{"user_message": ""}', 
'1.0.0', TRUE, FALSE, 'system'),

('code_assistant', '代码助手模板', 'generation', 
'你是一个专业的编程助手。请根据用户的技术需求提供准确的代码解决方案。\n\n用户技能等级：{{skill_level}}\n编程语言偏好：{{preferred_language}}\n\n用户问题：{{user_message}}\n\n请提供：\n1. 清晰的代码示例\n2. 必要的解释说明\n3. 最佳实践建议', 
'{"skill_level": "intermediate", "preferred_language": "JavaScript", "user_message": ""}', 
'1.0.0', TRUE, FALSE, 'system'),

('summary_context', '上下文总结模板', 'system', 
'总结以下对话历史，提取关键信息用于上下文保持：\n\n对话历史：\n{{conversation_history}}\n\n请总结：\n1. 主要话题\n2. 用户需求\n3. 重要细节\n4. 待处理事项', 
'{"conversation_history": ""}', 
'1.0.0', TRUE, FALSE, 'system');

-- 插入默认用户画像（系统用户）
INSERT INTO user_profiles (user_id, nickname, interaction_style, response_length_preference, topic_preferences, skill_level) VALUES 
(85178516, 'CodeMaster', 'technical', 'detailed', '{"programming": 0.9, "ai": 0.8, "system_design": 0.9}', 'expert');

-- 插入默认对话窗口配置
INSERT INTO conversation_windows (user_id, window_name, window_size, window_type, context_retention_strategy) VALUES 
(85178516, 'main', 20, 'sliding', 'summary'),
(0, 'global_default', 10, 'sliding', 'simple'); -- 全局默认窗口配置

-- =============================================================================
-- 6. 创建视图和存储过程
-- =============================================================================

-- 用户画像汇总视图
CREATE OR REPLACE VIEW user_profile_summary AS
SELECT 
    up.user_id,
    up.nickname,
    up.interaction_style,
    up.skill_level,
    up.interaction_count,
    up.last_interaction,
    COUNT(DISTINCT uc.id) as context_count,
    COUNT(DISTINCT cw.id) as window_count,
    AVG(wm.importance_score) as avg_message_importance
FROM user_profiles up
LEFT JOIN user_context uc ON up.user_id = uc.user_id AND uc.expires_at > NOW()
LEFT JOIN conversation_windows cw ON up.user_id = cw.user_id AND cw.is_active = TRUE
LEFT JOIN window_messages wm ON cw.id = wm.window_id
GROUP BY up.user_id, up.nickname, up.interaction_style, up.skill_level, up.interaction_count, up.last_interaction;

-- Prompt使用统计视图
CREATE OR REPLACE VIEW prompt_usage_stats AS
SELECT 
    pt.id as template_id,
    pt.template_name,
    pt.category,
    COUNT(DISTINCT mc.chain_id) as usage_count,
    COUNT(DISTINCT mc.user_id) as unique_users,
    AVG(JSON_EXTRACT(mc.timing_info, '$.total_ms')) as avg_processing_time,
    MAX(mc.created_at) as last_used
FROM prompt_templates pt
LEFT JOIN message_chains mc ON pt.id = mc.prompt_template_used
WHERE pt.is_active = TRUE
GROUP BY pt.id, pt.template_name, pt.category;

-- 窗口消息管理存储过程
DELIMITER //
CREATE PROCEDURE ManageWindowMessages(
    IN p_window_id BIGINT,
    IN p_conversation_id VARCHAR(50),
    IN p_user_id BIGINT,
    IN p_message_role VARCHAR(20),
    IN p_message_content TEXT,
    IN p_token_count INT
)
BEGIN
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;
    
    DECLARE current_window_size INT DEFAULT 10;
    DECLARE current_sequence INT DEFAULT 0;
    DECLARE messages_count INT DEFAULT 0;
    
    START TRANSACTION;
    
    -- 获取窗口大小配置
    SELECT window_size INTO current_window_size 
    FROM conversation_windows 
    WHERE id = p_window_id;
    
    -- 获取当前序号
    SELECT COALESCE(MAX(sequence_number), 0) + 1 INTO current_sequence
    FROM window_messages 
    WHERE window_id = p_window_id;
    
    -- 插入新消息
    INSERT INTO window_messages (
        window_id, conversation_id, user_id, sequence_number,
        message_role, message_content, token_count
    ) VALUES (
        p_window_id, p_conversation_id, p_user_id, current_sequence,
        p_message_role, p_message_content, p_token_count
    );
    
    -- 检查是否超出窗口大小
    SELECT COUNT(*) INTO messages_count 
    FROM window_messages 
    WHERE window_id = p_window_id;
    
    -- 如果超出窗口大小，删除最旧的消息（保留置顶消息）
    IF messages_count > current_window_size THEN
        DELETE FROM window_messages 
        WHERE window_id = p_window_id 
        AND is_pinned = FALSE
        ORDER BY sequence_number ASC 
        LIMIT (messages_count - current_window_size);
    END IF;
    
    COMMIT;
END //
DELIMITER ;

-- 用户画像更新存储过程
DELIMITER //
CREATE PROCEDURE UpdateUserProfile(
    IN p_user_id BIGINT,
    IN p_nickname VARCHAR(200),
    IN p_interaction_data JSON
)
BEGIN
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;
    
    START TRANSACTION;
    
    -- 更新或插入用户画像
    INSERT INTO user_profiles (user_id, nickname, last_interaction, interaction_count)
    VALUES (p_user_id, p_nickname, NOW(), 1)
    ON DUPLICATE KEY UPDATE
        nickname = COALESCE(VALUES(nickname), nickname),
        last_interaction = NOW(),
        interaction_count = interaction_count + 1,
        updated_at = CURRENT_TIMESTAMP;
    
    -- 如果提供了交互数据，更新相关上下文
    IF p_interaction_data IS NOT NULL THEN
        INSERT INTO user_context (user_id, context_key, context_value, context_type)
        VALUES (p_user_id, 'last_interaction_data', p_interaction_data, 'history')
        ON DUPLICATE KEY UPDATE
            context_value = VALUES(context_value),
            updated_at = CURRENT_TIMESTAMP;
    END IF;
    
    COMMIT;
END //
DELIMITER ;

-- 过期上下文清理存储过程
DELIMITER //
CREATE PROCEDURE CleanupExpiredContext()
BEGIN
    DECLARE cleaned_count INT DEFAULT 0;
    
    -- 删除过期的非持久化上下文
    DELETE FROM user_context 
    WHERE expires_at IS NOT NULL 
    AND expires_at < NOW() 
    AND is_persistent = FALSE;
    
    SET cleaned_count = ROW_COUNT();
    
    -- 记录清理日志
    INSERT INTO system_logs (log_level, module_name, message, extra_data)
    VALUES ('INFO', 'context_cleanup', 'Cleaned up expired user context', 
            JSON_OBJECT('cleaned_count', cleaned_count));
END //
DELIMITER ;

-- =============================================================================
-- 7. 索引优化
-- =============================================================================

-- 为频繁查询添加组合索引
ALTER TABLE conversation_windows ADD INDEX idx_user_active (user_id, is_active);
ALTER TABLE window_messages ADD INDEX idx_window_sequence (window_id, sequence_number);
ALTER TABLE user_context ADD INDEX idx_user_type_expires (user_id, context_type, expires_at);
ALTER TABLE prompt_configs ADD INDEX idx_scope_enabled_priority (config_scope, is_enabled, priority DESC);
ALTER TABLE message_chains ADD INDEX idx_user_session_depth (user_id, session_id, chain_depth);

-- =============================================================================
-- 8. 数据完整性约束
-- =============================================================================

-- 确保窗口大小合理
ALTER TABLE conversation_windows ADD CONSTRAINT chk_window_size 
CHECK (window_size > 0 AND window_size <= 100);

-- 确保优先级范围合理
ALTER TABLE user_context ADD CONSTRAINT chk_priority 
CHECK (priority >= 1 AND priority <= 10);

ALTER TABLE prompt_configs ADD CONSTRAINT chk_config_priority 
CHECK (priority >= 1 AND priority <= 10);

-- 确保链路深度合理
ALTER TABLE message_chains ADD CONSTRAINT chk_chain_depth 
CHECK (chain_depth >= 0 AND chain_depth <= 50);

-- =============================================================================
-- 显示创建结果
-- =============================================================================

SHOW TABLES LIKE '%window%';
SHOW TABLES LIKE '%profile%';
SHOW TABLES LIKE '%prompt%';
SHOW TABLES LIKE '%chain%';
SHOW TABLES LIKE '%debug%';

-- 显示视图
SHOW FULL TABLES WHERE Table_type = 'VIEW';

-- 显示存储过程
SHOW PROCEDURE STATUS WHERE Db = 'qqbot_db';

SELECT 'MVP Core Tables Migration Completed Successfully!' as status;