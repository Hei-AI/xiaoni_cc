-- 将基础消息发送函数注册到函数调用中心，并为 basic_chat Prompt 建立绑定
-- 执行前提：012_create_llm_function_registry_tables.sql 已执行

-- 1. 注册 send_private_chat_message 函数
INSERT INTO llm_function_definitions (
  id, name, display_name, description,
  parameters_schema, side_effect, expect_response, category, tags,
  invoke_method, invoke_url, http_method, auth_type, timeout_ms,
  managed_by_system, enabled, created_by, updated_by
)
SELECT
  '11111111-2222-3333-4444-555555555555',
  'send_private_chat_message',
  'Send Private Chat Message',
  '向指定QQ用户发送一条私聊消息。',
  JSON_OBJECT(
    'type', 'object',
    'properties', JSON_OBJECT(
      'user_id', JSON_OBJECT('type', 'integer', 'description', '接收消息的QQ用户ID。'),
      'message', JSON_OBJECT('type', 'string', 'description', '要发送的消息内容。')
    ),
    'required', JSON_ARRAY('user_id', 'message')
  ),
  1,
  0,
  'messaging',
  JSON_ARRAY('qq', 'private'),
  'INTERNAL',
  NULL,
  NULL,
  'NONE',
  10000,
  1,
  1,
  'system',
  'system'
WHERE NOT EXISTS (
  SELECT 1 FROM llm_function_definitions WHERE name = 'send_private_chat_message'
);

-- 2. 注册 send_qq_group_message 函数
INSERT INTO llm_function_definitions (
  id, name, display_name, description,
  parameters_schema, side_effect, expect_response, category, tags,
  invoke_method, invoke_url, http_method, auth_type, timeout_ms,
  managed_by_system, enabled, created_by, updated_by
)
SELECT
  '66666666-7777-8888-9999-aaaaaaaaaaaa',
  'send_qq_group_message',
  'Send QQ Group Message',
  '向当前会话所属的QQ群发送文本消息，可选精准@指定成员。',
  JSON_OBJECT(
    'type', 'object',
    'properties', JSON_OBJECT(
      'message', JSON_OBJECT('type', 'string', 'description', '要发送的群聊文本内容。'),
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
  ),
  1,
  0,
  'messaging',
  JSON_ARRAY('qq', 'group'),
  'INTERNAL',
  NULL,
  NULL,
  'NONE',
  10000,
  1,
  1,
  'system',
  'system'
WHERE NOT EXISTS (
  SELECT 1 FROM llm_function_definitions WHERE name = 'send_qq_group_message'
);

-- 3. 注册 send_meme_image 函数
INSERT INTO llm_function_definitions (
  id, name, display_name, description,
  parameters_schema, side_effect, expect_response, category, tags,
  invoke_method, invoke_url, http_method, auth_type, timeout_ms,
  managed_by_system, enabled, created_by, updated_by
)
SELECT
  'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  'send_meme_image',
  'Send Meme Image',
  '按标签检索并发送匹配的表情包，支持必要的@与观点说明。',
  JSON_OBJECT(
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
  ),
  1,
  0,
  'messaging',
  JSON_ARRAY('qq', 'meme', 'image'),
  'INTERNAL',
  NULL,
  NULL,
  'NONE',
  10000,
  1,
  1,
  'system',
  'system'
WHERE NOT EXISTS (
  SELECT 1 FROM llm_function_definitions WHERE name = 'send_meme_image'
);

-- 4. 注册 save_meme_image 函数
INSERT INTO llm_function_definitions (
  id, name, display_name, description,
  parameters_schema, side_effect, expect_response, category, tags,
  invoke_method, invoke_url, http_method, auth_type, timeout_ms,
  managed_by_system, enabled, created_by, updated_by
)
SELECT
  'eeeeeeee-ffff-1111-2222-333333333333',
  'save_meme_image',
  'Save Meme Image',
  '将新的表情图片入库以便后续按标签检索使用。',
  JSON_OBJECT(
    'type', 'object',
    'properties', JSON_OBJECT(
      'image_base64', JSON_OBJECT('type', 'string', 'description', '表情图片的 Base64 编码内容；后端需解码保存。'),
      'tags', JSON_OBJECT(
        'type', 'array',
        'description', '为表情打上的检索标签（每个尽量2-4字，覆盖情绪/场景）。',
        'items', JSON_OBJECT('type', 'string')
      )
    ),
    'required', JSON_ARRAY('image_base64', 'tags')
  ),
  1,
  0,
  'messaging',
  JSON_ARRAY('qq', 'meme', 'storage'),
  'INTERNAL',
  NULL,
  NULL,
  'NONE',
  10000,
  1,
  1,
  'system',
  'system'
WHERE NOT EXISTS (
  SELECT 1 FROM llm_function_definitions WHERE name = 'save_meme_image'
);

-- 5. 注册 end 函数
INSERT INTO llm_function_definitions (
  id, name, display_name, description,
  parameters_schema, side_effect, expect_response, category, tags,
  invoke_method, invoke_url, http_method, auth_type, timeout_ms,
  managed_by_system, enabled, created_by, updated_by
)
SELECT
  'bbbbbbbb-cccc-dddd-eeee-ffffffffffff',
  'end',
  'End Conversation',
  '当无需回复或执行任何操作时使用，表示当前会话结束。',
  JSON_OBJECT(
    'type', 'object',
    'properties', JSON_OBJECT(),
    'required', JSON_ARRAY()
  ),
  0,
  0,
  'messaging',
  JSON_ARRAY('system', 'control'),
  'INTERNAL',
  NULL,
  NULL,
  'NONE',
  5000,
  1,
  1,
  'system',
  'system'
WHERE NOT EXISTS (
  SELECT 1 FROM llm_function_definitions WHERE name = 'end'
);

-- 6. 为 basic_chat Prompt 建立函数绑定
INSERT INTO prompt_function_bindings (
  prompt_id, function_id, calling_mode, priority, metadata, created_by, updated_by
)
SELECT
  ap.id,
  f.id,
  'AUTO',
  0,
  NULL,
  'system',
  'system'
FROM agent_prompts ap
JOIN llm_function_definitions f ON f.name = 'send_private_chat_message'
WHERE ap.prompt_name = 'basic_chat'
  AND NOT EXISTS (
    SELECT 1 FROM prompt_function_bindings
    WHERE prompt_id = ap.id AND function_id = f.id
  );

INSERT INTO prompt_function_bindings (
  prompt_id, function_id, calling_mode, priority, metadata, created_by, updated_by
)
SELECT
  ap.id,
  f.id,
  'AUTO',
  1,
  NULL,
  'system',
  'system'
FROM agent_prompts ap
JOIN llm_function_definitions f ON f.name = 'send_qq_group_message'
WHERE ap.prompt_name = 'basic_chat'
  AND NOT EXISTS (
    SELECT 1 FROM prompt_function_bindings
    WHERE prompt_id = ap.id AND function_id = f.id
  );

INSERT INTO prompt_function_bindings (
  prompt_id, function_id, calling_mode, priority, metadata, created_by, updated_by
)
SELECT
  ap.id,
  f.id,
  'AUTO',
  2,
  NULL,
  'system',
  'system'
FROM agent_prompts ap
JOIN llm_function_definitions f ON f.name = 'send_meme_image'
WHERE ap.prompt_name = 'basic_chat'
  AND NOT EXISTS (
    SELECT 1 FROM prompt_function_bindings
    WHERE prompt_id = ap.id AND function_id = f.id
  );

INSERT INTO prompt_function_bindings (
  prompt_id, function_id, calling_mode, priority, metadata, created_by, updated_by
)
SELECT
  ap.id,
  f.id,
  'AUTO',
  3,
  NULL,
  'system',
  'system'
FROM agent_prompts ap
JOIN llm_function_definitions f ON f.name = 'save_meme_image'
WHERE ap.prompt_name = 'basic_chat'
  AND NOT EXISTS (
    SELECT 1 FROM prompt_function_bindings
    WHERE prompt_id = ap.id AND function_id = f.id
  );

INSERT INTO prompt_function_bindings (
  prompt_id, function_id, calling_mode, priority, metadata, created_by, updated_by
)
SELECT
  ap.id,
  f.id,
  'AUTO',
  4,
  NULL,
  'system',
  'system'
FROM agent_prompts ap
JOIN llm_function_definitions f ON f.name = 'end'
WHERE ap.prompt_name = 'basic_chat'
  AND NOT EXISTS (
    SELECT 1 FROM prompt_function_bindings
    WHERE prompt_id = ap.id AND function_id = f.id
  );
