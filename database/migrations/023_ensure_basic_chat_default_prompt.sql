INSERT INTO agent_prompts (
    id,
    agent_type,
    prompt_name,
    system_instructions,
    user_prompt_template,
    context_variables,
    model_config,
    advanced_config,
    config_version,
    last_config_update,
    is_active,
    version,
    description,
    created_by,
    created_at,
    updated_at,
    model_name,
    allowed_token_ids
)
SELECT
    UUID(),
    src.agent_type,
    'basic_chat',
    src.system_instructions,
    src.user_prompt_template,
    src.context_variables,
    src.model_config,
    src.advanced_config,
    src.config_version,
    CURRENT_TIMESTAMP,
    src.is_active,
    src.version,
    COALESCE(src.description, '默认聊天视图 prompt'),
    src.created_by,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    src.model_name,
    src.allowed_token_ids
FROM agent_prompts src
WHERE src.agent_type = 'chat_bot'
  AND src.prompt_name IN ('default_chat', '基础聊天机器人')
  AND NOT EXISTS (
    SELECT 1
    FROM agent_prompts dst
    WHERE dst.agent_type = 'chat_bot'
      AND dst.prompt_name = 'basic_chat'
  )
ORDER BY src.prompt_name = 'default_chat' DESC, src.version DESC
LIMIT 1;
