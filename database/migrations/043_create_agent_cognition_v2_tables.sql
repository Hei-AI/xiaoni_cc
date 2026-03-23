-- 043_create_agent_cognition_v2_tables.sql
-- 小腻 V2: relationship snapshots, cognition edit audit, virtual walk field graph, plan compiler metadata

ALTER TABLE agent_relationship_memories
    ADD COLUMN source_reflection_id BIGINT UNSIGNED NULL AFTER status,
    ADD COLUMN last_evidence_id BIGINT UNSIGNED NULL AFTER source_reflection_id,
    ADD COLUMN last_observed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) AFTER last_evidence_id,
    ADD COLUMN is_current TINYINT(1) NOT NULL DEFAULT 1 AFTER last_observed_at,
    ADD COLUMN boundary_strategy ENUM('allow_proactive', 'observe_only', 'do_not_contact') NULL AFTER is_current,
    ADD COLUMN notes_json JSON NULL AFTER boundary_strategy;

ALTER TABLE agent_relationship_memories
    ADD INDEX idx_agent_relationship_current (target_user_id, group_id, is_current, updated_at, id),
    ADD INDEX idx_agent_relationship_boundary (boundary_strategy, status, updated_at, id),
    ADD CONSTRAINT fk_agent_relationship_reflection
      FOREIGN KEY (source_reflection_id) REFERENCES agent_reflections(id)
      ON DELETE SET NULL,
    ADD CONSTRAINT fk_agent_relationship_evidence
      FOREIGN KEY (last_evidence_id) REFERENCES agent_observations(id)
      ON DELETE SET NULL;

ALTER TABLE agent_plans
    ADD COLUMN source_plan_id BIGINT UNSIGNED NULL AFTER source_reflection_id,
    ADD COLUMN plan_metadata_json JSON NULL AFTER source_plan_id;

ALTER TABLE agent_plans
    ADD INDEX idx_agent_plans_source_plan (source_plan_id, status, updated_at, id),
    ADD CONSTRAINT fk_agent_plans_source_plan
      FOREIGN KEY (source_plan_id) REFERENCES agent_plans(id)
      ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS agent_cognition_edits (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    entity_type ENUM('belief', 'memory', 'relationship') NOT NULL,
    entity_id BIGINT UNSIGNED NOT NULL,
    action_type ENUM('patch', 'disable', 'promote', 'rebuild') NOT NULL,
    reason TEXT NOT NULL,
    before_json JSON NOT NULL,
    after_json JSON NOT NULL,
    impact_json JSON NULL,
    operator_id VARCHAR(64) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX idx_agent_cognition_edits_entity (entity_type, entity_id, created_at, id),
    INDEX idx_agent_cognition_edits_operator (operator_id, created_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agent_social_fields (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    field_key VARCHAR(191) NOT NULL,
    field_scope ENUM('private_chat', 'group_chat', 'thread', 'tool_channel') NOT NULL,
    user_id BIGINT NULL,
    group_id BIGINT NULL,
    thread_key VARCHAR(191) NULL,
    title VARCHAR(255) NOT NULL,
    status ENUM('active', 'suppressed', 'archived') NOT NULL DEFAULT 'active',
    last_active_at DATETIME(3) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_agent_social_fields_key (field_key),
    INDEX idx_agent_social_fields_scope (field_scope, status, last_active_at, id),
    INDEX idx_agent_social_fields_user (user_id, status, last_active_at, id),
    INDEX idx_agent_social_fields_group (group_id, status, last_active_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agent_social_edges (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    source_field_key VARCHAR(191) NOT NULL,
    target_field_key VARCHAR(191) NOT NULL,
    edge_type ENUM('user_bridge', 'plan_entry', 'tool_entry') NOT NULL,
    weight DECIMAL(8,4) NOT NULL DEFAULT 0.0000,
    last_observed_at DATETIME(3) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_agent_social_edges (source_field_key, target_field_key, edge_type),
    INDEX idx_agent_social_edges_source (source_field_key, edge_type, updated_at, id),
    INDEX idx_agent_social_edges_target (target_field_key, edge_type, updated_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agent_field_scores (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    field_key VARCHAR(191) NOT NULL,
    priority_score DECIMAL(8,4) NOT NULL DEFAULT 0.0000,
    inbound_score DECIMAL(8,4) NOT NULL DEFAULT 0.0000,
    relationship_score DECIMAL(8,4) NOT NULL DEFAULT 0.0000,
    plan_score DECIMAL(8,4) NOT NULL DEFAULT 0.0000,
    novelty_score DECIMAL(8,4) NOT NULL DEFAULT 0.0000,
    cooldown_penalty DECIMAL(8,4) NOT NULL DEFAULT 0.0000,
    boundary_penalty DECIMAL(8,4) NOT NULL DEFAULT 0.0000,
    suppression_reason VARCHAR(255) NULL,
    explanation_json JSON NULL,
    computed_at DATETIME(3) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_agent_field_scores_field_time (field_key, computed_at),
    INDEX idx_agent_field_scores_priority (priority_score, computed_at, id),
    INDEX idx_agent_field_scores_computed (computed_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
