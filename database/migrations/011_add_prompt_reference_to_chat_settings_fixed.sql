-- 011_add_prompt_reference_to_chat_settings.sql (修复版本 - 匹配字符集和排序规则)
-- 为私聊和群聊设置表增加 prompt 关联，允许自定义 Agent Prompt

ALTER TABLE private_chat_settings
  ADD COLUMN agent_prompt_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL
  COMMENT '指定的 agent_prompt ID，用于自定义私聊 Prompt' AFTER user_notes,
  ADD CONSTRAINT fk_private_chat_prompt
    FOREIGN KEY (agent_prompt_id) REFERENCES agent_prompts(id)
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX idx_private_chat_prompt_id ON private_chat_settings(agent_prompt_id);

ALTER TABLE group_chat_settings
  ADD COLUMN agent_prompt_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL
  COMMENT '指定的 agent_prompt ID，用于自定义群聊 Prompt' AFTER admin_user_id,
  ADD CONSTRAINT fk_group_chat_prompt
    FOREIGN KEY (agent_prompt_id) REFERENCES agent_prompts(id)
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX idx_group_chat_prompt_id ON group_chat_settings(agent_prompt_id);
