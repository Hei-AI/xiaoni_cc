-- 029_create_agent_cognition_phase1_tables.sql
-- 小腻 V1 Phase 1: observation + belief 底座

CREATE TABLE IF NOT EXISTS agent_observations (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    trace_id VARCHAR(128) NULL COMMENT '关联 trace_id',
    conversation_id VARCHAR(36) NULL COMMENT '关联 conversations.id',
    source_type ENUM('incoming_message', 'outgoing_message', 'reply_anchor', 'tool_result', 'tick') NOT NULL,
    field_scope ENUM('private_chat', 'group_chat', 'thread', 'tool_channel') NOT NULL,
    message_type ENUM('private', 'group') NULL COMMENT '原始 IM 消息类型',
    user_id BIGINT NULL COMMENT '当前消息对应的 user_id',
    group_id BIGINT NULL COMMENT '当前消息对应的 group_id',
    subject_user_id BIGINT NULL COMMENT '被观察主体用户，常用于 reply/tool 场景',
    counterparty_ids JSON NULL COMMENT '相关用户 ID 列表',
    content TEXT NOT NULL COMMENT '可读 observation 文本',
    tool_payload_ref VARCHAR(255) NULL COMMENT '工具调用或回包引用',
    raw_payload JSON NULL COMMENT '原始载荷或补充上下文',
    occurred_at DATETIME(3) NOT NULL COMMENT '事件发生时间',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX idx_observation_scope_time (field_scope, occurred_at, id),
    INDEX idx_observation_source_time (source_type, occurred_at, id),
    INDEX idx_observation_user_time (user_id, occurred_at, id),
    INDEX idx_observation_group_time (group_id, occurred_at, id),
    INDEX idx_observation_conversation_time (conversation_id, occurred_at, id),
    INDEX idx_observation_subject_time (subject_user_id, occurred_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agent_beliefs (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    subject_type ENUM('user', 'group', 'self', 'conversation') NOT NULL,
    subject_id VARCHAR(64) NOT NULL,
    belief_type ENUM('identity_fact', 'preference', 'commitment') NOT NULL,
    belief_key VARCHAR(191) NOT NULL COMMENT '用于 Phase 1 轻量去重与冲突更新',
    claim TEXT NOT NULL COMMENT '自然语言信念内容',
    normalized_claim VARCHAR(255) NOT NULL COMMENT '用于精确比较的归一化文本',
    polarity ENUM('positive', 'negative', 'neutral') NOT NULL DEFAULT 'neutral',
    confidence DECIMAL(5,4) NOT NULL DEFAULT 0.6000,
    status ENUM('active', 'revised', 'stale') NOT NULL DEFAULT 'active',
    observation_count INT UNSIGNED NOT NULL DEFAULT 1,
    last_evidence_id BIGINT UNSIGNED NULL COMMENT '最近证据 observation ID',
    first_observed_at DATETIME(3) NOT NULL,
    last_observed_at DATETIME(3) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    INDEX idx_belief_subject_status (subject_type, subject_id, status, last_observed_at, id),
    INDEX idx_belief_type_status (belief_type, status, last_observed_at, id),
    INDEX idx_belief_key_status (belief_key, status, last_observed_at, id),
    INDEX idx_belief_evidence (last_evidence_id),
    CONSTRAINT fk_agent_beliefs_last_evidence
      FOREIGN KEY (last_evidence_id) REFERENCES agent_observations(id)
      ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
