-- 更新 basic_chat Prompt 的工具配置，注入 Gemini 函数调用工具
-- 该脚本将向 agent_prompts.advanced_config.toolsConfig 中写入消息发送工具定义

UPDATE agent_prompts
SET advanced_config = JSON_SET(
  COALESCE(advanced_config, JSON_OBJECT()),
  '$.toolsConfig', JSON_OBJECT(
    'functionCalling', JSON_OBJECT(
      'mode', 'AUTO',
      'allowedFunctionNames', JSON_ARRAY(
        'send_private_chat_message',
        'send_qq_group_message',
        'send_meme_image',
        'save_meme_image'
      )
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
        'id', 'send_qq_group_message',
        'name', 'send_qq_group_message',
        'description', '向当前会话所属的QQ群发送文本消息，可选精准@指定成员。',
        'parameters', JSON_OBJECT(
          'type', 'object',
          'properties', JSON_OBJECT(
            'message', JSON_OBJECT(
              'type', 'string',
              'description', '要发送的群聊文本内容。'
            ),
            'at_user_ids', JSON_OBJECT(
              'type', 'array',
              'description', '需要被@的QQ号列表；缺省或空数组时不@任何人。',
              'items', JSON_OBJECT('type', 'integer')
            ),
            'user_perspectives', JSON_OBJECT(
              'type', 'array',
              'description', '当消息涉及评价/调侃时，提供依据以满足 persona 约束。',
              'items', JSON_OBJECT(
                'type', 'object',
                'properties', JSON_OBJECT(
                  'target_user_id', JSON_OBJECT('type', 'integer', 'description', '被评价的用户QQ号。'),
                  'based_on', JSON_OBJECT('type', 'string', 'description', '触发该评价的原始输入片段。'),
                  'comment', JSON_OBJECT('type', 'string', 'description', '面向目标用户的评价或结论。')
                ),
                'required', JSON_ARRAY('target_user_id', 'based_on', 'comment')
              )
            )
          ),
          'required', JSON_ARRAY('message')
        )
      ),
      JSON_OBJECT(
        'id', 'send_meme_image',
        'name', 'send_meme_image',
        'description', '按标签检索并发送匹配的表情包，支持必要的@与观点说明。',
        'parameters', JSON_OBJECT(
          'type', 'object',
          'properties', JSON_OBJECT(
            'tags', JSON_OBJECT(
              'type', 'array',
              'description', '用于检索表情包的语义标签（情绪/场景等，每个尽量2-4字）。',
              'items', JSON_OBJECT('type', 'string')
            ),
            'at_user_ids', JSON_OBJECT(
              'type', 'array',
              'description', '需要被@的成员QQ号列表；缺省表示不@任何人。',
              'items', JSON_OBJECT('type', 'integer')
            ),
            'user_perspectives', JSON_OBJECT(
              'type', 'array',
              'description', '若表情暗含评价/吐槽，请给出依据，保持 persona 约束一致。',
              'items', JSON_OBJECT(
                'type', 'object',
                'properties', JSON_OBJECT(
                  'target_user_id', JSON_OBJECT('type', 'integer', 'description', '被评价的用户QQ号。'),
                  'based_on', JSON_OBJECT('type', 'string', 'description', '触发该评价的原始输入片段。'),
                  'comment', JSON_OBJECT('type', 'string', 'description', '对目标用户的评价或结论。')
                ),
                'required', JSON_ARRAY('target_user_id', 'based_on', 'comment')
              )
            )
          ),
          'required', JSON_ARRAY('tags')
        )
      ),
      JSON_OBJECT(
        'id', 'save_meme_image',
        'name', 'save_meme_image',
        'description', '将新的表情图片入库以便后续按标签检索使用。',
        'parameters', JSON_OBJECT(
          'type', 'object',
          'properties', JSON_OBJECT(
            'image_base64', JSON_OBJECT(
              'type', 'string',
              'description', '表情图片的 Base64 编码内容；后端需解码保存。'
            ),
            'tags', JSON_OBJECT(
              'type', 'array',
              'description', '为表情打上的检索标签（每个尽量2-4字，覆盖情绪/场景）。',
              'items', JSON_OBJECT('type', 'string')
            )
          ),
          'required', JSON_ARRAY('image_base64', 'tags')
        )
      )
    )
  )
)
WHERE prompt_name = 'basic_chat';

-- 如果不存在 basic_chat Prompt，此更新不会产生影响。
