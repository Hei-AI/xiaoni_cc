-- 为核心 Agent 类型补充默认 Prompt 配置，避免启动时缺少配置的告警
-- Migration: 014_seed_core_agent_prompts
-- Date: 2025-02-15

USE qqbot_db;

-- 默认聊天机器人 Prompt（候选列表：echance_chat / enhanced_chat / default_chat）
INSERT INTO agent_prompts (
  id,
  agent_type,
  prompt_name,
  system_instructions,
  user_prompt_template,
  context_variables,
  model_name,
  model_config,
  advanced_config,
  is_active,
  version,
  created_by,
  description
) VALUES
(
  UUID(),
  'chat_bot',
  'default_chat',
  JSON_ARRAY(
    '你是一个友好的 QQ 智能助手，需要结合上下文快速回应用户的消息。',
    '保持语气自然、简洁，尽量在 80 字以内完成回答。'
  ),
  '以下是最近的对话：\n{{conversation_history}}\n\n请回答最新用户消息：{{user_message}}',
  JSON_OBJECT(
    'conversation_history', 'string',
    'user_message', 'string'
  ),
  'gemini-2.5-flash',
  JSON_OBJECT(
    'temperature', 0.6,
    'topP', 0.9,
    'topK', 40,
    'maxOutputTokens', 900
  ),
  JSON_OBJECT(
    'generationConfig', JSON_OBJECT(
      'temperature', 0.6,
      'topP', 0.9,
      'topK', 40,
      'maxOutputTokens', 900
    ),
    'thinkingConfig', JSON_OBJECT(
      'thinkingBudget', 0,
      'includeThoughts', false
    ),
    'safetySettings', JSON_ARRAY(
      JSON_OBJECT('category', 'HARM_CATEGORY_HARASSMENT', 'threshold', 'BLOCK_MEDIUM_AND_ABOVE'),
      JSON_OBJECT('category', 'HARM_CATEGORY_HATE_SPEECH', 'threshold', 'BLOCK_MEDIUM_AND_ABOVE')
    )
  ),
  TRUE,
  1,
  'system',
  '默认聊天机器人提示词，用于常规闲聊和问答场景。'
),
(
  UUID(),
  'chat_bot',
  'enhanced_chat',
  JSON_ARRAY(
    '你是增强型 QQ 智能助手，需要主动结合上下文给出更详细的解释与建议。',
    '确保回答包含关键事实或步骤，同时保持礼貌。'
  ),
  '上下文：\n{{conversation_history}}\n---\n用户：{{user_message}}\n请根据上下文给出专业且有温度的回答。',
  JSON_OBJECT(
    'conversation_history', 'string',
    'user_message', 'string'
  ),
  'gemini-1.5-pro',
  JSON_OBJECT(
    'temperature', 0.55,
    'topP', 0.85,
    'topK', 32,
    'maxOutputTokens', 1100
  ),
  JSON_OBJECT(
    'generationConfig', JSON_OBJECT(
      'temperature', 0.55,
      'topP', 0.85,
      'topK', 32,
      'maxOutputTokens', 1100
    ),
    'thinkingConfig', JSON_OBJECT(
      'thinkingBudget', 200,
      'includeThoughts', false
    ),
    'googleSearchConfig', JSON_OBJECT(
      'enabled', true,
      'dynamicThreshold', true
    )
  ),
  TRUE,
  1,
  'system',
  '增强型聊天 Prompt，适合需要更多背景信息和细节解释的场景。'
),
(
  UUID(),
  'chat_bot',
  'echance_chat',
  JSON_ARRAY(
    '你是 Echance 内部使用的 QQ 智能助手，需要在技术语境下准确回答问题。',
    '当问题涉及代码或配置时，请给出步骤化回答，并可附上关键命令。'
  ),
  '对话上下文：{{conversation_history}}\n用户问题：{{user_message}}\n请输出详尽答案，如需操作步骤请列点说明。',
  JSON_OBJECT(
    'conversation_history', 'string',
    'user_message', 'string'
  ),
  'gemini-2.5-flash',
  JSON_OBJECT(
    'temperature', 0.45,
    'topP', 0.8,
    'topK', 32,
    'maxOutputTokens', 1000
  ),
  JSON_OBJECT(
    'generationConfig', JSON_OBJECT(
      'temperature', 0.45,
      'topP', 0.8,
      'topK', 32,
      'maxOutputTokens', 1000
    ),
    'structuredOutputConfig', JSON_OBJECT(
      'enabled', false
    )
  ),
  TRUE,
  1,
  'system',
  'Echance 内部增强 Prompt，偏向技术问答与操作指导。'
)
ON DUPLICATE KEY UPDATE
  system_instructions = VALUES(system_instructions),
  user_prompt_template = VALUES(user_prompt_template),
  context_variables = VALUES(context_variables),
  model_name = VALUES(model_name),
  model_config = VALUES(model_config),
  advanced_config = VALUES(advanced_config),
  description = VALUES(description),
  updated_at = CURRENT_TIMESTAMP;

-- 决策引擎默认 Prompt（预热时使用）
INSERT INTO agent_prompts (
  id,
  agent_type,
  prompt_name,
  system_instructions,
  user_prompt_template,
  context_variables,
  model_name,
  model_config,
  advanced_config,
  is_active,
  version,
  created_by,
  description
) VALUES (
  UUID(),
  'decision_engine',
  'default_decision',
  JSON_ARRAY(
    '你是对话决策引擎，需要判断机器人是否应该回复消息，并说明原因。',
    '分析上下文、用户言辞以及机器人状态，输出明确的决策。'
  ),
  '消息上下文：\n{{conversation_history}}\n---\n最新消息：{{user_message}}\n请判断是否需要机器人回复，并给出简要理由。',
  JSON_OBJECT(
    'conversation_history', 'string',
    'user_message', 'string'
  ),
  'gemini-2.5-flash',
  JSON_OBJECT(
    'temperature', 0.3,
    'topP', 0.7,
    'topK', 16,
    'maxOutputTokens', 600
  ),
  JSON_OBJECT(
    'generationConfig', JSON_OBJECT(
      'temperature', 0.3,
      'topP', 0.7,
      'topK', 16,
      'maxOutputTokens', 600,
      'responseMimeType', 'application/json'
    ),
    'structuredOutputConfig', JSON_OBJECT(
      'enabled', true,
      'jsonSchema', JSON_OBJECT(
        'type', 'object',
        'required', JSON_ARRAY('shouldReply', 'confidence', 'reason'),
        'properties', JSON_OBJECT(
          'shouldReply', JSON_OBJECT('type', 'boolean'),
          'confidence', JSON_OBJECT('type', 'number', 'minimum', 0, 'maximum', 1),
          'reason', JSON_OBJECT('type', 'string', 'maxLength', 200)
        )
      )
    )
  ),
  TRUE,
  1,
  'system',
  '默认决策引擎提示词，用于判断是否需要机器人回复。'
)
ON DUPLICATE KEY UPDATE
  system_instructions = VALUES(system_instructions),
  user_prompt_template = VALUES(user_prompt_template),
  context_variables = VALUES(context_variables),
  model_name = VALUES(model_name),
  model_config = VALUES(model_config),
  advanced_config = VALUES(advanced_config),
  description = VALUES(description),
  updated_at = CURRENT_TIMESTAMP;
