-- 更新 basic_chat Prompt 的工具配置，注入 Gemini 函数调用工具
-- 该脚本将向 agent_prompts.advanced_config.toolsConfig 中写入消息发送工具定义

UPDATE agent_prompts
SET advanced_config = JSON_SET(
  COALESCE(advanced_config, JSON_OBJECT()),
  '$.toolsConfig', JSON_OBJECT(
    'functionCalling', JSON_OBJECT(
      'mode', 'AUTO',
      'allowedFunctionNames', JSON_ARRAY('send_private_chat_message', 'send_group_chat_message')
    ),
    'customTools', JSON_ARRAY(
      JSON_OBJECT(
        'id', 'send_private_chat_message',
        'name', 'send_private_chat_message',
        'description', '向指定QQ用户发送一条私聊消息。',
        'parameters', JSON_OBJECT(
          'type', 'object',
          'properties', JSON_OBJECT(
            'user_id', JSON_OBJECT(
              'type', 'integer',
              'description', '接收消息的QQ用户ID。'
            ),
            'message', JSON_OBJECT(
              'type', 'string',
              'description', '要发送的消息内容。'
            )
          ),
          'required', JSON_ARRAY('user_id', 'message')
        )
      ),
      JSON_OBJECT(
        'id', 'send_group_chat_message',
        'name', 'send_group_chat_message',
        'description', '向当前会话所属的QQ群发送消息，可选@指定成员。',
        'parameters', JSON_OBJECT(
          'type', 'object',
          'properties', JSON_OBJECT(
            'message', JSON_OBJECT(
              'type', 'string',
              'description', '要发送的消息内容。'
            ),
            'should_at', JSON_OBJECT(
              'type', 'boolean',
              'description', '是否需要@某个群成员。',
              'default', false
            ),
            'at_user_id', JSON_OBJECT(
              'type', 'integer',
              'description', '当should_at为true时，需要@的QQ号。'
            )
          ),
          'required', JSON_ARRAY('message')
        )
      )
    )
  )
)
WHERE prompt_name = 'basic_chat';

-- 如果不存在 basic_chat Prompt，此更新不会产生影响。
