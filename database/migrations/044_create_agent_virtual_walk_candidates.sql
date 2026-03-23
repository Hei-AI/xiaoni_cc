-- 044_create_agent_virtual_walk_candidates.sql
-- 小腻虚拟行走：显式 walk candidate 物化层

CREATE TABLE IF NOT EXISTS agent_walk_candidates (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    field_key VARCHAR(191) NOT NULL,
    field_scope ENUM('private_chat', 'group_chat', 'thread', 'tool_channel') NOT NULL,
    target_user_id BIGINT NULL,
    target_group_id BIGINT NULL,
    priority_score DECIMAL(8,4) NOT NULL DEFAULT 0.0000,
    selected_reason VARCHAR(255) NOT NULL,
    suppressed_reason VARCHAR(255) NULL,
    can_speak_now TINYINT(1) NOT NULL DEFAULT 0,
    source_relationship_id BIGINT UNSIGNED NULL,
    source_plan_ids_json JSON NULL,
    source_memory_ids_json JSON NULL,
    source_belief_ids_json JSON NULL,
    trigger_sources_json JSON NULL,
    compiler_inputs_json JSON NULL,
    computed_at DATETIME(3) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_agent_walk_candidates_field_time (field_key, computed_at),
    INDEX idx_agent_walk_candidates_priority (priority_score, computed_at, id),
    INDEX idx_agent_walk_candidates_user (target_user_id, computed_at, id),
    INDEX idx_agent_walk_candidates_group (target_group_id, computed_at, id),
    INDEX idx_agent_walk_candidates_speak (can_speak_now, computed_at, id),
    CONSTRAINT fk_agent_walk_candidates_relationship
      FOREIGN KEY (source_relationship_id) REFERENCES agent_relationship_memories(id)
      ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
