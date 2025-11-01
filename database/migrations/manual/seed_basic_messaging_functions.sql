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

INSERT INTO llm_function_definitions (
  id, name, display_name, description,
  parameters_schema, side_effect, expect_response, category, tags,
  invoke_method, invoke_url, http_method, auth_type, timeout_ms,
  managed_by_system, enabled, created_by, updated_by
)
SELECT
  '66666666-7777-8888-9999-aaaaaaaaaaaa',
  'send_group_chat_message',
  'Send Group Chat Message',
  '向当前会话所属的QQ群发送消息，可选@指定成员。',
  JSON_OBJECT(
    'type', 'object',
    'properties', JSON_OBJECT(
      'message', JSON_OBJECT('type', 'string', 'description', '要发送的消息内容。'),
      'should_at', JSON_OBJECT('type', 'boolean', 'description', '是否需要@某个群成员。', 'default', false),
      'at_user_id', JSON_OBJECT('type', 'integer', 'description', '当should_at为true时，需要@的QQ号。')
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
  SELECT 1 FROM llm_function_definitions WHERE name = 'send_group_chat_message'
);

-- 3. 注册 end 函数
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

-- 4. 为 basic_chat Prompt 建立函数绑定
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
JOIN llm_function_definitions f ON f.name = 'send_group_chat_message'
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
JOIN llm_function_definitions f ON f.name = 'end'
WHERE ap.prompt_name = 'basic_chat'
  AND NOT EXISTS (
    SELECT 1 FROM prompt_function_bindings
    WHERE prompt_id = ap.id AND function_id = f.id
  );
