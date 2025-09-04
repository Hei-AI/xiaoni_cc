-- Agent Prompts Management Schema
-- 用于存储和管理AI Agent的系统指令和配置

CREATE TABLE IF NOT EXISTS agent_prompts (
    id VARCHAR(36) PRIMARY KEY,
    agent_type ENUM('chat_bot', 'intent_analyzer', 'requirement_processor', 'custom') NOT NULL,
    prompt_name VARCHAR(100) NOT NULL,
    system_instructions JSON NOT NULL COMMENT '系统指令数组，格式: ["instruction1", "instruction2", ...]',
    user_prompt_template TEXT NULL COMMENT '用户消息模板，支持变量替换',
    context_variables JSON NULL COMMENT '上下文变量，格式: {"var1": "value1", "var2": "value2"}',
    model_config JSON NULL COMMENT 'Gemini模型配置: {"temperature": 0.7, "topK": 40, "topP": 0.95, "maxOutputTokens": 4096}',
    is_active BOOLEAN DEFAULT TRUE COMMENT '是否激活使用',
    version INT NOT NULL DEFAULT 1 COMMENT '版本号，用于版本管理',
    created_by VARCHAR(50) NOT NULL COMMENT '创建者',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    description TEXT NULL COMMENT '描述信息',
    
    INDEX idx_agent_type (agent_type),
    INDEX idx_prompt_name (prompt_name),
    INDEX idx_is_active (is_active),
    INDEX idx_created_at (created_at),
    INDEX idx_updated_at (updated_at),
    UNIQUE KEY uk_agent_prompt_version (agent_type, prompt_name, version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='AI Agent系统指令和配置管理表';

-- 插入默认的Agent Prompts (如果不存在)
INSERT IGNORE INTO agent_prompts (
    id, agent_type, prompt_name, system_instructions, model_config, 
    is_active, version, created_by, description
) VALUES 
(
    UUID(),
    'chat_bot',
    'default_chat',
    JSON_ARRAY(
        '你是一个智能QQ机器人助手，基于Gemini AI技术。你的特点是：',
        '1. 友好、专业、有帮助',
        '2. 能够理解中文对话', 
        '3. 可以协助用户进行各种咨询和交流',
        '4. 对于技术问题能够提供有用的建议',
        '5. 保持对话的连贯性和相关性',
        '',
        '请用中文回复，语言要自然、亲切。如果用户提出开发需求，可以提供技术建议或引导用户提供更多详细信息。'
    ),
    JSON_OBJECT(
        'temperature', 0.7,
        'topK', 40,
        'topP', 0.95,
        'maxOutputTokens', 4096
    ),
    TRUE,
    1,
    'system',
    '默认聊天机器人系统指令'
),
(
    UUID(),
    'intent_analyzer', 
    'requirement_analysis',
    JSON_ARRAY(
        '你是一个需求分析专家。请分析用户消息是否是软件开发需求。',
        '',
        '判断标准：',
        '1. 包含开发相关关键词：实现、开发、修改、修复、优化、添加、创建、构建、重构、改进、升级、集成',
        '2. 描述技术功能或系统需求',
        '3. 要求代码修改或新功能开发',
        '',
        '请返回JSON格式：',
        '{',
        '  "isRequirement": true/false,',
        '  "confidence": 0-100,',
        '  "category": "功能开发/bug修复/性能优化/架构重构/其他",',
        '  "complexity": "简单/中等/复杂"',
        '}',
        '',
        '复杂度判断：',
        '- 简单：单个文件修改、配置调整、简单bug修复',
        '- 中等：多文件修改、新增功能模块',
        '- 复杂：包含"系统"、"模块"、"功能"关键词，或消息长度>100字符，或需要架构变更'
    ),
    JSON_OBJECT(
        'temperature', 0.3,
        'topK', 20,
        'topP', 0.8,
        'maxOutputTokens', 1024
    ),
    TRUE,
    1,
    'system',
    '需求意图分析器系统指令'
);

-- 查看当前的Agent Prompts
-- SELECT * FROM agent_prompts ORDER BY agent_type, prompt_name, version DESC;