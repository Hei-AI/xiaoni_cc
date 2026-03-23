-- 046_extend_virtual_walk_feedback_and_group_controls.sql
-- 小腻虚拟行走：群观察/主动白名单与反馈事件链

ALTER TABLE agent_proactivity_controls
    ADD COLUMN observed_group_ids JSON NULL AFTER allowed_user_ids,
    ADD COLUMN allowed_group_ids JSON NULL AFTER observed_group_ids;

UPDATE agent_proactivity_controls apc
LEFT JOIN (
    SELECT JSON_ARRAYAGG(CAST(group_id AS UNSIGNED)) AS allowed_group_ids_json
    FROM group_chat_settings
    WHERE is_enabled = 1
      AND auto_reply_enabled = 1
) seeded ON TRUE
SET apc.allowed_group_ids = COALESCE(seeded.allowed_group_ids_json, JSON_ARRAY())
WHERE apc.id = 1
  AND (apc.allowed_group_ids IS NULL OR JSON_LENGTH(apc.allowed_group_ids) = 0);

INSERT INTO agent_proactivity_controls (
    id,
    followup_enabled,
    is_paused,
    allowed_user_ids,
    observed_group_ids,
    allowed_group_ids
)
SELECT
    1,
    1,
    0,
    JSON_ARRAY(),
    JSON_ARRAY(),
    COALESCE((
        SELECT JSON_ARRAYAGG(CAST(group_id AS UNSIGNED))
        FROM group_chat_settings
        WHERE is_enabled = 1
          AND auto_reply_enabled = 1
    ), JSON_ARRAY())
WHERE NOT EXISTS (
    SELECT 1
    FROM agent_proactivity_controls
    WHERE id = 1
);

CREATE TABLE IF NOT EXISTS agent_feedback_events (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    field_key VARCHAR(191) NOT NULL,
    target_user_id BIGINT NULL,
    target_group_id BIGINT NULL,
    source_action_log_id BIGINT UNSIGNED NOT NULL,
    judgement ENUM('positive', 'neutral', 'negative') NOT NULL,
    reason_code VARCHAR(128) NOT NULL,
    explanation_json JSON NULL,
    llm_trace_id VARCHAR(128) NULL,
    occurred_at DATETIME(3) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_agent_feedback_events_action (source_action_log_id),
    INDEX idx_agent_feedback_events_field (field_key, occurred_at, id),
    INDEX idx_agent_feedback_events_user (target_user_id, occurred_at, id),
    INDEX idx_agent_feedback_events_group (target_group_id, occurred_at, id),
    INDEX idx_agent_feedback_events_judgement (judgement, occurred_at, id),
    CONSTRAINT fk_agent_feedback_events_action
      FOREIGN KEY (source_action_log_id) REFERENCES agent_action_logs(id)
      ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
