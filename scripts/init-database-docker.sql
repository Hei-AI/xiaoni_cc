-- Docker环境数据库初始化脚本
-- 包含实时LLM配置系统的完整数据库结构

-- 设置字符集
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- 创建数据库（如果不存在）
CREATE DATABASE IF NOT EXISTS qqbot_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE qqbot_db;

-- 创建用户和权限（如果不存在）
CREATE USER IF NOT EXISTS 'qqbot_user'@'%' IDENTIFIED BY 'qqbot_password';
GRANT ALL PRIVILEGES ON qqbot_db.* TO 'qqbot_user'@'%';
FLUSH PRIVILEGES;

-- ============================================
-- 基础表结构 (如果不存在则创建)
-- ============================================

-- API Tokens表
CREATE TABLE IF NOT EXISTS api_tokens (
    id INT PRIMARY KEY AUTO_INCREMENT,
    token VARCHAR(255) NOT NULL,
    project_name VARCHAR(100) NOT NULL,
    project_id VARCHAR(100) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    is_healthy BOOLEAN DEFAULT true,
    health_check_count INT DEFAULT 0,
    last_health_check TIMESTAMP NULL,
    last_used_at TIMESTAMP NULL,
    error_count INT DEFAULT 0,
    last_error_message TEXT,
    last_error_at TIMESTAMP NULL,
    daily_usage_count INT DEFAULT 0,
    daily_usage_date DATE,
    total_usage_count BIGINT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    notes TEXT,
    -- 🆕 新增字段
    model_blacklist JSON COMMENT '按模型存储的黑名单状态',

    INDEX idx_active_healthy (is_active, is_healthy),
    INDEX idx_last_used (last_used_at),
    INDEX idx_daily_usage (daily_usage_date, daily_usage_count),
    UNIQUE KEY uk_token (token)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Agent Prompts表 (扩展版本)
CREATE TABLE IF NOT EXISTS agent_prompts (
    id VARCHAR(100) PRIMARY KEY,
    agent_type ENUM('chat_bot', 'intent_analyzer', 'requirement_processor', 'persona_chat', 'custom') NOT NULL,
    prompt_name VARCHAR(200) NOT NULL,
    system_instructions JSON NOT NULL COMMENT '系统指令数组',
    user_prompt_template TEXT,
    context_variables JSON COMMENT '上下文变量',
    model_name VARCHAR(100) DEFAULT 'gemini-2.5-flash',
    model_config JSON COMMENT '基础模型配置',
    -- 🆕 高级配置字段
    advanced_config JSON COMMENT 'Gemini高级配置参数JSON',
    config_version VARCHAR(20) DEFAULT 'v1.0' COMMENT '配置版本号',
    last_config_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '配置最后更新时间',

    is_active BOOLEAN DEFAULT true,
    version INT DEFAULT 1,
    created_by VARCHAR(100) DEFAULT 'system',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    description TEXT,

    -- 🆕 新增字段
    model_name_binding VARCHAR(100) COMMENT '绑定的模型名称',
    allowed_token_ids JSON COMMENT '允许使用的Token ID数组',

    INDEX idx_agent_type (agent_type),
    INDEX idx_model_name (model_name),
    INDEX idx_active (is_active),
    INDEX idx_advanced_config_version (config_version),
    INDEX idx_config_update_time (last_config_update)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Conversations表
CREATE TABLE IF NOT EXISTS conversations (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL,
    group_id BIGINT,
    message_id VARCHAR(50),
    user_message TEXT NOT NULL,
    bot_response TEXT,
    message_type ENUM('private', 'group', 'system') DEFAULT 'private',
    context_summary TEXT,
    session_id VARCHAR(100),
    conversation_window_id INT,
    agent_type VARCHAR(50) DEFAULT 'chat_bot',
    model_used VARCHAR(100),
    processing_time_ms INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    -- 🆕 追踪字段
    trace_id VARCHAR(100) COMMENT '调用链追踪ID',

    INDEX idx_user_id (user_id),
    INDEX idx_group_id (group_id),
    INDEX idx_session_id (session_id),
    INDEX idx_conversation_window (conversation_window_id),
    INDEX idx_message_type (message_type),
    INDEX idx_created_at (created_at),
    INDEX idx_trace_id (trace_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- WebSocket日志表
CREATE TABLE IF NOT EXISTS websocket_logs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    trace_id VARCHAR(100) NOT NULL COMMENT '追踪ID',
    event_type VARCHAR(50) NOT NULL,
    direction ENUM('inbound', 'outbound') NOT NULL,
    raw_message TEXT,
    parsed_data JSON,
    user_id BIGINT,
    group_id BIGINT,
    message_id VARCHAR(50),
    processing_status ENUM('received', 'processing', 'completed', 'error') DEFAULT 'received',
    error_message TEXT,
    processing_time_ms INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_trace_id (trace_id),
    INDEX idx_event_type (event_type),
    INDEX idx_user_id (user_id),
    INDEX idx_group_id (group_id),
    INDEX idx_created_at (created_at),
    INDEX idx_processing_status (processing_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- LLM调用日志表
CREATE TABLE IF NOT EXISTS llm_call_logs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    trace_id VARCHAR(100) NOT NULL,
    session_id VARCHAR(100),
    call_sequence INT DEFAULT 1,
    agent_type VARCHAR(50),
    model_name VARCHAR(100),
    model_provider VARCHAR(50) DEFAULT 'gemini',
    prompt_template TEXT,
    input_prompt LONGTEXT,
    input_tokens INT DEFAULT 0,
    model_config JSON,
    raw_response TEXT,
    processed_response TEXT,
    output_tokens INT DEFAULT 0,
    api_call_time_ms INT DEFAULT 0,
    processing_time_ms INT DEFAULT 0,
    status ENUM('SUCCESS', 'ERROR', 'TIMEOUT') DEFAULT 'SUCCESS',
    error_message TEXT,
    error_code VARCHAR(50),
    cost_estimate DECIMAL(10,6) DEFAULT 0.000000,
    token_usage JSON,
    user_id BIGINT DEFAULT 0,
    context_summary TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_trace_id (trace_id),
    INDEX idx_session_id (session_id),
    INDEX idx_agent_type (agent_type),
    INDEX idx_model_name (model_name),
    INDEX idx_status (status),
    INDEX idx_created_at (created_at),
    INDEX idx_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 群聊设置表
CREATE TABLE IF NOT EXISTS group_chat_settings (
    id INT PRIMARY KEY AUTO_INCREMENT,
    group_id BIGINT NOT NULL UNIQUE,
    group_name VARCHAR(200),
    is_enabled BOOLEAN DEFAULT true COMMENT '是否启用群聊功能',
    auto_reply_enabled BOOLEAN DEFAULT true COMMENT '是否启用自动回复',
    response_probability DECIMAL(3,2) DEFAULT 0.30 COMMENT '回复概率',
    allowed_users JSON COMMENT '允许的用户ID列表',
    blocked_users JSON COMMENT '屏蔽的用户ID列表',
    custom_prompts JSON COMMENT '自定义提示词',
    last_activity TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_group_id (group_id),
    INDEX idx_enabled (is_enabled),
    INDEX idx_auto_reply (auto_reply_enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 初始化基础数据
-- ============================================

-- 插入默认Agent Prompts（包含高级配置）
INSERT IGNORE INTO agent_prompts (
    id, agent_type, prompt_name, system_instructions, model_name, model_config, advanced_config,
    is_active, version, created_by, description
) VALUES
-- 基础聊天机器人
(
    'chat_bot_basic',
    'chat_bot',
    '基础聊天机器人',
    '["你是一个友好的AI助手，请用中文回复。", "保持对话自然、有帮助。"]',
    'gemini-2.5-flash',
    JSON_OBJECT(
        'temperature', 0.7,
        'topP', 0.9,
        'topK', 40,
        'maxOutputTokens', 1000
    ),
    JSON_OBJECT(
        'generationConfig', JSON_OBJECT(
            'temperature', 0.7,
            'topP', 0.9,
            'topK', 40,
            'maxOutputTokens', 1000
        ),
        'thinkingConfig', JSON_OBJECT(
            'thinkingBudget', 0,
            'includeThoughts', false
        ),
        'safetySettings', JSON_ARRAY(
            JSON_OBJECT('category', 'HARM_CATEGORY_HARASSMENT', 'threshold', 'BLOCK_MEDIUM_AND_ABOVE'),
            JSON_OBJECT('category', 'HARM_CATEGORY_HATE_SPEECH', 'threshold', 'BLOCK_MEDIUM_AND_ABOVE')
        ),
        'toolsConfig', JSON_OBJECT(
            'enabled', false,
            'selectedTools', JSON_ARRAY(),
            'mode', 'NONE'
        ),
        'googleSearchConfig', JSON_OBJECT('enabled', false),
        'urlContextConfig', JSON_OBJECT('enabled', false),
        'structuredOutputConfig', JSON_OBJECT('enabled', false),
        'promptConfig', JSON_OBJECT('promptPrefix', '', 'promptSuffix', '')
    ),
    true,
    1,
    'system',
    '基础聊天机器人配置'
),

-- 决策引擎（思考模式）
(
    'decision_engine_thinking',
    'intent_analyzer',
    '决策引擎思考模式',
    '["你是一个逻辑分析专家，需要展示完整的思考过程来判断是否应该回复消息。", "请仔细分析消息内容、上下文和用户意图。"]',
    'gemini-2.5-flash',
    JSON_OBJECT(
        'temperature', 0.3,
        'topP', 0.8,
        'topK', 20,
        'maxOutputTokens', 800
    ),
    JSON_OBJECT(
        'generationConfig', JSON_OBJECT(
            'temperature', 0.3,
            'topP', 0.8,
            'topK', 20,
            'maxOutputTokens', 800,
            'stopSequences', JSON_ARRAY('结论:', '决策:')
        ),
        'thinkingConfig', JSON_OBJECT(
            'thinkingBudget', 1000,
            'includeThoughts', true
        ),
        'safetySettings', JSON_ARRAY(
            JSON_OBJECT('category', 'HARM_CATEGORY_HARASSMENT', 'threshold', 'BLOCK_MEDIUM_AND_ABOVE')
        ),
        'toolsConfig', JSON_OBJECT(
            'enabled', true,
            'selectedTools', JSON_ARRAY('sentiment_analysis', 'keyword_extraction'),
            'mode', 'AUTO',
            'allowedTools', JSON_ARRAY('sentiment_analysis', 'keyword_extraction')
        ),
        'googleSearchConfig', JSON_OBJECT('enabled', false),
        'urlContextConfig', JSON_OBJECT('enabled', false),
        'structuredOutputConfig', JSON_OBJECT('enabled', false),
        'promptConfig', JSON_OBJECT(
            'promptPrefix', '[思考分析开始]',
            'promptSuffix', '[分析结束，请给出最终决策]'
        )
    ),
    true,
    1,
    'system',
    '决策引擎的思考模式配置，启用思考过程显示和情感分析工具'
),

-- 意图分析器（结构化输出）
(
    'intent_analyzer_structured',
    'intent_analyzer',
    '意图分析结构化输出',
    '["你是一个意图分析专家，需要返回结构化的JSON分析结果。", "分析用户的真实意图和情感状态。"]',
    'gemini-2.5-flash',
    JSON_OBJECT(
        'temperature', 0.1,
        'topP', 0.7,
        'topK', 10,
        'maxOutputTokens', 400
    ),
    JSON_OBJECT(
        'generationConfig', JSON_OBJECT(
            'temperature', 0.1,
            'topP', 0.7,
            'topK', 10,
            'maxOutputTokens', 400,
            'responseMimeType', 'application/json'
        ),
        'thinkingConfig', JSON_OBJECT(
            'thinkingBudget', 0,
            'includeThoughts', false
        ),
        'safetySettings', JSON_ARRAY(
            JSON_OBJECT('category', 'HARM_CATEGORY_HARASSMENT', 'threshold', 'BLOCK_LOW_AND_ABOVE')
        ),
        'toolsConfig', JSON_OBJECT(
            'enabled', false,
            'selectedTools', JSON_ARRAY(),
            'mode', 'NONE'
        ),
        'googleSearchConfig', JSON_OBJECT('enabled', false),
        'urlContextConfig', JSON_OBJECT('enabled', false),
        'structuredOutputConfig', JSON_OBJECT(
            'enabled', true,
            'jsonSchema', JSON_OBJECT(
                'type', 'object',
                'properties', JSON_OBJECT(
                    'intent', JSON_OBJECT('type', 'string', 'description', '用户意图类别'),
                    'confidence', JSON_OBJECT('type', 'number', 'minimum', 0, 'maximum', 1, 'description', '置信度'),
                    'emotion', JSON_OBJECT('type', 'string', 'description', '情感状态'),
                    'shouldReply', JSON_OBJECT('type', 'boolean', 'description', '是否应该回复'),
                    'priority', JSON_OBJECT('type', 'string', 'enum', JSON_ARRAY('low', 'normal', 'high', 'urgent'))
                ),
                'required', JSON_ARRAY('intent', 'confidence', 'shouldReply')
            )
        ),
        'promptConfig', JSON_OBJECT(
            'promptPrefix', '请分析以下消息：',
            'promptSuffix', '请返回JSON格式的分析结果。'
        )
    ),
    true,
    1,
    'system',
    '意图分析的结构化输出配置，返回JSON格式结果'
),

-- 搜索增强聊天机器人
(
    'chat_bot_search_enabled',
    'chat_bot',
    '聊天机器人搜索增强',
    '["你是一个智能助手，可以使用Google搜索获取最新信息。", "当用户询问实时信息或最新事件时，主动搜索相关内容。"]',
    'gemini-2.5-flash',
    JSON_OBJECT(
        'temperature', 0.6,
        'topP', 0.9,
        'topK', 40,
        'maxOutputTokens', 1200
    ),
    JSON_OBJECT(
        'generationConfig', JSON_OBJECT(
            'temperature', 0.6,
            'topP', 0.9,
            'topK', 40,
            'maxOutputTokens', 1200
        ),
        'thinkingConfig', JSON_OBJECT(
            'thinkingBudget', -1,
            'includeThoughts', false
        ),
        'safetySettings', JSON_ARRAY(
            JSON_OBJECT('category', 'HARM_CATEGORY_HARASSMENT', 'threshold', 'BLOCK_MEDIUM_AND_ABOVE'),
            JSON_OBJECT('category', 'HARM_CATEGORY_HATE_SPEECH', 'threshold', 'BLOCK_MEDIUM_AND_ABOVE')
        ),
        'toolsConfig', JSON_OBJECT(
            'enabled', true,
            'selectedTools', JSON_ARRAY('web_search', 'weather_query'),
            'mode', 'AUTO',
            'allowedTools', JSON_ARRAY('web_search', 'weather_query')
        ),
        'googleSearchConfig', JSON_OBJECT(
            'enabled', true,
            'dynamicThreshold', true
        ),
        'urlContextConfig', JSON_OBJECT(
            'enabled', true,
            'maxUrls', 10,
            'maxSizePerUrl', 20
        ),
        'structuredOutputConfig', JSON_OBJECT('enabled', false),
        'promptConfig', JSON_OBJECT(
            'promptPrefix', '',
            'promptSuffix', '如果需要最新信息，请主动搜索。回答要准确、有帮助。'
        )
    ),
    true,
    1,
    'system',
    '聊天机器人的搜索增强配置，支持实时信息查询'
);

-- 创建配置更新触发器
DELIMITER ;;
CREATE TRIGGER IF NOT EXISTS agent_prompts_config_update
    BEFORE UPDATE ON agent_prompts
    FOR EACH ROW
BEGIN
    -- 如果advanced_config被修改，更新配置版本和时间
    IF OLD.advanced_config != NEW.advanced_config THEN
        SET NEW.last_config_update = CURRENT_TIMESTAMP;
        SET NEW.config_version = CONCAT('v', DATE_FORMAT(NOW(), '%Y%m%d_%H%i%s'));
    END IF;
END;;
DELIMITER ;

-- 插入示例API Token（请在生产环境中替换）
INSERT IGNORE INTO api_tokens (
    token, project_name, project_id, is_active, is_healthy,
    model_blacklist, notes
) VALUES
(
    'your_gemini_api_token_here',
    'QQ Bot Project',
    'qqbot-001',
    true,
    true,
    JSON_OBJECT(),
    'Docker环境测试Token - 请替换为真实Token'
);

-- 插入默认群聊设置
INSERT IGNORE INTO group_chat_settings (
    group_id, group_name, is_enabled, auto_reply_enabled, response_probability
) VALUES
(
    123456789,
    '测试群聊',
    true,
    true,
    0.30
);

SET FOREIGN_KEY_CHECKS = 1;

-- 显示初始化完成信息
SELECT 'QQ Bot数据库初始化完成!' as message;
SELECT '实时LLM配置系统已就绪!' as llm_config_status;
SELECT COUNT(*) as agent_prompts_count FROM agent_prompts WHERE is_active = true;
SELECT COUNT(*) as api_tokens_count FROM api_tokens WHERE is_active = true;
