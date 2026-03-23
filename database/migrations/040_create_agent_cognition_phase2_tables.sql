-- 040_create_agent_cognition_phase2_tables.sql
-- 小腻 V1 Phase 2+: stable memory / reflection / self model / plans / action logs

CREATE TABLE IF NOT EXISTS agent_memories (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    memory_scope ENUM('local_field', 'person_global', 'self_global') NOT NULL,
    memory_type ENUM('identity_fact', 'preference', 'relationship', 'commitment', 'summary_insight') NOT NULL,
    subject_type ENUM('user', 'group', 'self', 'conversation') NOT NULL,
    subject_id VARCHAR(64) NOT NULL,
    field_scope ENUM('private_chat', 'group_chat', 'thread', 'tool_channel') NULL,
    user_id BIGINT NULL,
    group_id BIGINT NULL,
    target_user_id BIGINT NULL,
    conversation_id VARCHAR(36) NULL,
    title VARCHAR(191) NOT NULL,
    content TEXT NOT NULL,
    normalized_content VARCHAR(255) NOT NULL,
    confidence DECIMAL(5,4) NOT NULL DEFAULT 0.7000,
    salience DECIMAL(5,4) NOT NULL DEFAULT 0.7000,
    status ENUM('active', 'superseded', 'disabled') NOT NULL DEFAULT 'active',
    source_kind ENUM('explicit_fact', 'explicit_commitment', 'repeated_signal', 'daily_reflection', 'weekly_reflection') NOT NULL,
    promoted_from_belief_id BIGINT UNSIGNED NULL,
    last_recalled_at DATETIME(3) NULL,
    last_observed_at DATETIME(3) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    INDEX idx_agent_memories_subject_status (subject_type, subject_id, status, last_observed_at, id),
    INDEX idx_agent_memories_scope_status (memory_scope, status, last_observed_at, id),
    INDEX idx_agent_memories_type_status (memory_type, status, salience, id),
    INDEX idx_agent_memories_user_status (user_id, status, last_observed_at, id),
    INDEX idx_agent_memories_group_status (group_id, status, last_observed_at, id),
    CONSTRAINT fk_agent_memories_belief
      FOREIGN KEY (promoted_from_belief_id) REFERENCES agent_beliefs(id)
      ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agent_memory_evidence (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    memory_id BIGINT UNSIGNED NOT NULL,
    observation_id BIGINT UNSIGNED NULL,
    belief_id BIGINT UNSIGNED NULL,
    evidence_kind ENUM('observation', 'belief', 'manual') NOT NULL,
    quote TEXT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX idx_agent_memory_evidence_memory (memory_id, created_at, id),
    INDEX idx_agent_memory_evidence_observation (observation_id),
    INDEX idx_agent_memory_evidence_belief (belief_id),
    CONSTRAINT fk_agent_memory_evidence_memory
      FOREIGN KEY (memory_id) REFERENCES agent_memories(id)
      ON DELETE CASCADE,
    CONSTRAINT fk_agent_memory_evidence_observation
      FOREIGN KEY (observation_id) REFERENCES agent_observations(id)
      ON DELETE SET NULL,
    CONSTRAINT fk_agent_memory_evidence_belief
      FOREIGN KEY (belief_id) REFERENCES agent_beliefs(id)
      ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agent_reflections (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    reflection_kind ENUM('daily', 'weekly', 'promotion') NOT NULL,
    reflection_key VARCHAR(191) NOT NULL,
    status ENUM('completed', 'failed') NOT NULL DEFAULT 'completed',
    summary TEXT NULL,
    source_belief_ids JSON NULL,
    source_observation_ids JSON NULL,
    promoted_memory_ids JSON NULL,
    started_at DATETIME(3) NOT NULL,
    completed_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uniq_agent_reflection_key (reflection_key),
    INDEX idx_agent_reflections_kind_started (reflection_kind, started_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agent_relationship_memories (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    target_user_id BIGINT NOT NULL,
    field_scope ENUM('private_chat', 'group_chat', 'thread', 'tool_channel') NULL,
    group_id BIGINT NULL,
    relationship_summary TEXT NOT NULL,
    interaction_style TEXT NULL,
    boundary_notes TEXT NULL,
    confidence DECIMAL(5,4) NOT NULL DEFAULT 0.6500,
    status ENUM('active', 'superseded', 'disabled') NOT NULL DEFAULT 'active',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    INDEX idx_agent_relationship_target_status (target_user_id, status, updated_at, id),
    INDEX idx_agent_relationship_group_status (group_id, status, updated_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agent_self_model (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    identity_summary TEXT NULL,
    core_traits JSON NULL,
    long_term_goals JSON NULL,
    current_concerns JSON NULL,
    availability VARCHAR(64) NULL,
    energy VARCHAR(64) NULL,
    source_reflection_id BIGINT UNSIGNED NULL,
    is_current TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    INDEX idx_agent_self_model_current (is_current, updated_at, id),
    CONSTRAINT fk_agent_self_model_reflection
      FOREIGN KEY (source_reflection_id) REFERENCES agent_reflections(id)
      ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agent_plans (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    plan_type ENUM('weekly_focus', 'day_plan', 'followup_queue', 'micro_intention') NOT NULL,
    target_field_scope ENUM('private_chat', 'group_chat', 'thread', 'tool_channel') NULL,
    target_user_id BIGINT NULL,
    target_group_id BIGINT NULL,
    goal TEXT NOT NULL,
    trigger_condition TEXT NULL,
    status ENUM('queued', 'active', 'completed', 'cancelled') NOT NULL DEFAULT 'queued',
    scheduled_start_at DATETIME(3) NULL,
    scheduled_end_at DATETIME(3) NULL,
    source_reflection_id BIGINT UNSIGNED NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    INDEX idx_agent_plans_status_type (status, plan_type, updated_at, id),
    INDEX idx_agent_plans_user_status (target_user_id, status, updated_at, id),
    INDEX idx_agent_plans_group_status (target_group_id, status, updated_at, id),
    CONSTRAINT fk_agent_plans_reflection
      FOREIGN KEY (source_reflection_id) REFERENCES agent_reflections(id)
      ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agent_action_logs (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    action_type VARCHAR(64) NOT NULL,
    trigger_kind VARCHAR(64) NULL,
    source_plan_id BIGINT UNSIGNED NULL,
    target_user_id BIGINT NULL,
    target_group_id BIGINT NULL,
    payload_json JSON NULL,
    status VARCHAR(64) NOT NULL DEFAULT 'completed',
    occurred_at DATETIME(3) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX idx_agent_action_logs_time (occurred_at, id),
    INDEX idx_agent_action_logs_user_time (target_user_id, occurred_at, id),
    INDEX idx_agent_action_logs_group_time (target_group_id, occurred_at, id),
    CONSTRAINT fk_agent_action_logs_plan
      FOREIGN KEY (source_plan_id) REFERENCES agent_plans(id)
      ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
