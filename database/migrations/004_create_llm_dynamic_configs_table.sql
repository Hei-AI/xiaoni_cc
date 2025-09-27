-- 创建LLM动态配置表
-- 支持实时调整Gemini各种高级参数

CREATE TABLE llm_dynamic_configs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    config_name VARCHAR(100) NOT NULL COMMENT '配置名称 (如: chat_bot_advanced, decision_engine_v2)',
    agent_type VARCHAR(50) NOT NULL COMMENT 'Agent类型 (chat_bot, decision_maker, persona_analyzer等)',
    model_name VARCHAR(100) NOT NULL DEFAULT 'gemini-2.5-flash' COMMENT '模型名称',
    description TEXT COMMENT '配置描述',

    -- 基础生成配置
    generation_config JSON COMMENT '基础生成参数: temperature, topP, topK, maxOutputTokens, stopSequences等',

    -- 思考模式配置
    thinking_config JSON COMMENT '思考模式: thinkingBudget(-1自动|固定数字), includeThoughts(true|false)',

    -- 安全设置配置
    safety_settings JSON COMMENT '安全设置数组: [{category, threshold}]',

    -- 函数调用配置
    tools_config JSON COMMENT '函数工具配置: tools数组和toolConfig',

    -- Google搜索配置
    google_search_config JSON COMMENT 'Google搜索: {enabled: true, dynamicThreshold: false}',

    -- URL上下文配置
    url_context_config JSON COMMENT 'URL处理: {enabled: true, maxUrls: 20, maxSizePerUrl: 34MB}',

    -- 结构化输出配置
    structured_output_config JSON COMMENT '结构化输出: {enabled: true, jsonSchema: {}}',

    -- 提示词配置
    prompt_config JSON COMMENT '提示词配置: {systemInstruction, promptPrefix, promptSuffix}',

    -- 状态管理
    is_active BOOLEAN DEFAULT true COMMENT '是否启用',
    priority INT DEFAULT 100 COMMENT '优先级 (数字越小优先级越高)',

    -- 元数据
    created_by VARCHAR(100) DEFAULT 'system' COMMENT '创建者',
    updated_by VARCHAR(100) DEFAULT 'system' COMMENT '更新者',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    -- 索引
    INDEX idx_agent_type (agent_type),
    INDEX idx_model_name (model_name),
    INDEX idx_config_name (config_name),
    INDEX idx_active_priority (is_active, priority),
    UNIQUE KEY uk_config_name (config_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='LLM动态配置表 - 支持实时调整Gemini高级参数';

-- 插入默认配置示例
INSERT INTO llm_dynamic_configs (
    config_name, agent_type, model_name, description,
    generation_config, thinking_config, safety_settings, prompt_config
) VALUES
-- 聊天机器人基础配置
('chat_bot_basic', 'chat_bot', 'gemini-2.5-flash', '聊天机器人基础配置',
 JSON_OBJECT(
   'temperature', 0.7,
   'topP', 0.9,
   'topK', 40,
   'maxOutputTokens', 1000
 ),
 JSON_OBJECT(
   'thinkingBudget', 0,
   'includeThoughts', false
 ),
 JSON_ARRAY(
   JSON_OBJECT('category', 'HARM_CATEGORY_HARASSMENT', 'threshold', 'BLOCK_MEDIUM_AND_ABOVE'),
   JSON_OBJECT('category', 'HARM_CATEGORY_HATE_SPEECH', 'threshold', 'BLOCK_MEDIUM_AND_ABOVE')
 ),
 JSON_OBJECT(
   'systemInstruction', '你是一个友好的AI助手，请用中文回复。',
   'promptPrefix', '',
   'promptSuffix', ''
 )
),

-- 决策引擎高精度配置
('decision_engine_precise', 'decision_maker', 'gemini-2.5-flash', '决策引擎高精度分析配置',
 JSON_OBJECT(
   'temperature', 0.2,
   'topP', 0.8,
   'topK', 20,
   'maxOutputTokens', 500
 ),
 JSON_OBJECT(
   'thinkingBudget', 800,
   'includeThoughts', true
 ),
 JSON_ARRAY(
   JSON_OBJECT('category', 'HARM_CATEGORY_HARASSMENT', 'threshold', 'BLOCK_MEDIUM_AND_ABOVE')
 ),
 JSON_OBJECT(
   'systemInstruction', '你是一个逻辑分析专家，需要准确判断是否应该回复消息。',
   'promptPrefix', '[决策分析开始]',
   'promptSuffix', '[决策分析结束]'
 )
),

-- 人格分析创意配置
('persona_analyzer_creative', 'persona_analyzer', 'gemini-2.5-flash', '人格分析创意响应配置',
 JSON_OBJECT(
   'temperature', 0.9,
   'topP', 0.95,
   'topK', 60,
   'maxOutputTokens', 1500
 ),
 JSON_OBJECT(
   'thinkingBudget', -1,
   'includeThoughts', false
 ),
 JSON_ARRAY(
   JSON_OBJECT('category', 'HARM_CATEGORY_HARASSMENT', 'threshold', 'BLOCK_LOW_AND_ABOVE')
 ),
 JSON_OBJECT(
   'systemInstruction', '你是一个善解人意的AI，能够适应不同的对话风格。',
   'promptPrefix', '',
   'promptSuffix', ''
 )
),

-- 结构化输出配置示例
('intent_analyzer_structured', 'intent_analyzer', 'gemini-2.5-flash', '意图分析结构化输出配置',
 JSON_OBJECT(
   'temperature', 0.1,
   'topP', 0.7,
   'topK', 10,
   'maxOutputTokens', 300,
   'responseMimeType', 'application/json'
 ),
 NULL,
 JSON_ARRAY(
   JSON_OBJECT('category', 'HARM_CATEGORY_HARASSMENT', 'threshold', 'BLOCK_MEDIUM_AND_ABOVE')
 ),
 JSON_OBJECT(
   'systemInstruction', '分析用户意图并返回JSON格式结果。'
 )
);

-- 插入结构化输出配置
UPDATE llm_dynamic_configs
SET structured_output_config = JSON_OBJECT(
  'enabled', true,
  'jsonSchema', JSON_OBJECT(
    'type', 'object',
    'properties', JSON_OBJECT(
      'intent', JSON_OBJECT('type', 'string'),
      'confidence', JSON_OBJECT('type', 'number'),
      'shouldReply', JSON_OBJECT('type', 'boolean')
    ),
    'required', JSON_ARRAY('intent', 'confidence', 'shouldReply')
  )
)
WHERE config_name = 'intent_analyzer_structured';