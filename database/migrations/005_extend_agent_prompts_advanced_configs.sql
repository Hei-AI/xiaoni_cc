-- 扩展agent_prompts表，添加Gemini高级配置支持
-- 每个Agent Prompt都有独立的完整参数配置

-- 为agent_prompts表添加高级配置字段
ALTER TABLE agent_prompts
ADD COLUMN advanced_config JSON COMMENT 'Gemini高级配置参数JSON' AFTER model_config,
ADD COLUMN config_version VARCHAR(20) DEFAULT 'v1.0' COMMENT '配置版本号' AFTER advanced_config,
ADD COLUMN last_config_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '配置最后更新时间' AFTER config_version;

-- 为高级配置字段添加索引
ALTER TABLE agent_prompts
ADD INDEX idx_advanced_config_version (config_version),
ADD INDEX idx_config_update_time (last_config_update);

-- 初始化现有记录的高级配置
UPDATE agent_prompts
SET advanced_config = JSON_OBJECT(
  'generationConfig', JSON_OBJECT(
    'temperature', COALESCE(JSON_UNQUOTE(JSON_EXTRACT(model_config, '$.temperature')), 0.7),
    'topP', COALESCE(JSON_UNQUOTE(JSON_EXTRACT(model_config, '$.topP')), 0.9),
    'topK', COALESCE(JSON_UNQUOTE(JSON_EXTRACT(model_config, '$.topK')), 40),
    'maxOutputTokens', COALESCE(JSON_UNQUOTE(JSON_EXTRACT(model_config, '$.maxOutputTokens')), 1000),
    'stopSequences', JSON_ARRAY(),
    'responseMimeType', 'text/plain'
  ),
  'thinkingConfig', JSON_OBJECT(
    'thinkingBudget', 0,
    'includeThoughts', false
  ),
  'safetySettings', JSON_ARRAY(
    JSON_OBJECT('category', 'HARM_CATEGORY_HARASSMENT', 'threshold', 'BLOCK_MEDIUM_AND_ABOVE'),
    JSON_OBJECT('category', 'HARM_CATEGORY_HATE_SPEECH', 'threshold', 'BLOCK_MEDIUM_AND_ABOVE'),
    JSON_OBJECT('category', 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'threshold', 'BLOCK_MEDIUM_AND_ABOVE'),
    JSON_OBJECT('category', 'HARM_CATEGORY_DANGEROUS_CONTENT', 'threshold', 'BLOCK_MEDIUM_AND_ABOVE')
  ),
  'toolsConfig', JSON_OBJECT(
    'enabled', false,
    'selectedTools', JSON_ARRAY(),
    'mode', 'NONE',
    'allowedTools', JSON_ARRAY()
  ),
  'googleSearchConfig', JSON_OBJECT(
    'enabled', false,
    'dynamicThreshold', false
  ),
  'urlContextConfig', JSON_OBJECT(
    'enabled', false,
    'maxUrls', 20,
    'maxSizePerUrl', 34
  ),
  'structuredOutputConfig', JSON_OBJECT(
    'enabled', false,
    'jsonSchema', JSON_OBJECT()
  ),
  'promptConfig', JSON_OBJECT(
    'promptPrefix', '',
    'promptSuffix', ''
  )
)
WHERE advanced_config IS NULL;

-- 插入一些高级配置示例

-- 决策引擎思考模式配置
INSERT INTO agent_prompts (
  id, agent_type, prompt_name, system_instructions, model_name, model_config, advanced_config,
  is_active, version, created_by, description
) VALUES
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

-- 意图分析结构化输出配置
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
      'tools', JSON_ARRAY(),
      'toolConfig', JSON_OBJECT('functionCallingConfig', JSON_OBJECT('mode', 'NONE'))
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

-- 聊天机器人Google搜索配置
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
      'tools', JSON_ARRAY(),
      'toolConfig', JSON_OBJECT('functionCallingConfig', JSON_OBJECT('mode', 'NONE'))
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

-- 为管理端添加配置更新触发器 (可选)
DELIMITER ;;
CREATE TRIGGER agent_prompts_config_update
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