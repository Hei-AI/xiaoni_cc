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
