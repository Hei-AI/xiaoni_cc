-- 016_backfill_message_history.sql
-- 从 conversations 表迁移旧的聊天记录数据到新的消息历史表

-- 私聊用户消息（用户 -> 机器人）
INSERT INTO private_message_history (
    conversation_id,
    message_id,
    user_id,
    sender_id,
    sender_role,
    content_type,
    content,
    raw_payload,
    sent_at
)
SELECT
    c.id,
    c.message_id,
    c.user_id,
    c.user_id,
    'user',
    'text',
    c.user_message,
    CASE
      WHEN JSON_VALID(c.raw_request) THEN CAST(c.raw_request AS JSON)
      ELSE NULL
    END,
    c.timestamp
FROM conversations c
WHERE (c.group_id IS NULL OR c.group_id = 0)
  AND NOT EXISTS (
    SELECT 1
    FROM private_message_history pmh
    WHERE pmh.conversation_id = c.id
      AND pmh.sender_role = 'user'
  );

-- 私聊机器人回复（机器人 -> 用户）
INSERT INTO private_message_history (
    conversation_id,
    message_id,
    user_id,
    sender_id,
    sender_role,
    content_type,
    content,
    raw_payload,
    sent_at
)
SELECT
    c.id,
    NULL,
    c.user_id,
    COALESCE(
      CASE
        WHEN JSON_VALID(c.raw_response)
        THEN NULLIF(CAST(JSON_UNQUOTE(JSON_EXTRACT(c.raw_response, '$.self_id')) AS SIGNED), 0)
        ELSE NULL
      END,
      CASE
        WHEN JSON_VALID(c.raw_request)
        THEN NULLIF(CAST(JSON_UNQUOTE(JSON_EXTRACT(c.raw_request, '$.self_id')) AS SIGNED), 0)
        ELSE NULL
      END,
      0
    ),
    'bot',
    'text',
    c.ai_response,
    CASE
      WHEN JSON_VALID(c.raw_response) THEN CAST(c.raw_response AS JSON)
      ELSE NULL
    END,
    COALESCE(c.updated_at, c.timestamp)
FROM conversations c
WHERE (c.group_id IS NULL OR c.group_id = 0)
  AND c.ai_response IS NOT NULL
  AND TRIM(c.ai_response) <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM private_message_history pmh
    WHERE pmh.conversation_id = c.id
      AND pmh.sender_role = 'bot'
  );

-- 群聊用户消息（用户 -> 群聊）
INSERT INTO group_message_history (
    conversation_id,
    message_id,
    group_id,
    sender_id,
    sender_role,
    content_type,
    content,
    raw_payload,
    sent_at
)
SELECT
    c.id,
    c.message_id,
    c.group_id,
    c.user_id,
    'user',
    'text',
    c.user_message,
    CASE
      WHEN JSON_VALID(c.raw_request) THEN CAST(c.raw_request AS JSON)
      ELSE NULL
    END,
    c.timestamp
FROM conversations c
WHERE c.group_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM group_message_history gmh
    WHERE gmh.conversation_id = c.id
      AND gmh.sender_role = 'user'
  );

-- 群聊机器人回复（机器人 -> 群聊）
INSERT INTO group_message_history (
    conversation_id,
    message_id,
    group_id,
    sender_id,
    sender_role,
    content_type,
    content,
    raw_payload,
    sent_at
)
SELECT
    c.id,
    NULL,
    c.group_id,
    COALESCE(
      CASE
        WHEN JSON_VALID(c.raw_response)
        THEN NULLIF(CAST(JSON_UNQUOTE(JSON_EXTRACT(c.raw_response, '$.self_id')) AS SIGNED), 0)
        ELSE NULL
      END,
      CASE
        WHEN JSON_VALID(c.raw_request)
        THEN NULLIF(CAST(JSON_UNQUOTE(JSON_EXTRACT(c.raw_request, '$.self_id')) AS SIGNED), 0)
        ELSE NULL
      END,
      0
    ),
    'bot',
    'text',
    c.ai_response,
    CASE
      WHEN JSON_VALID(c.raw_response) THEN CAST(c.raw_response AS JSON)
      ELSE NULL
    END,
    COALESCE(c.updated_at, c.timestamp)
FROM conversations c
WHERE c.group_id IS NOT NULL
  AND c.ai_response IS NOT NULL
  AND TRIM(c.ai_response) <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM group_message_history gmh
    WHERE gmh.conversation_id = c.id
      AND gmh.sender_role = 'bot'
  );
