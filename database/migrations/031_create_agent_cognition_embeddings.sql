-- 031_create_agent_cognition_embeddings.sql
-- Phase 2/4: dedicated embedding store for stable memory / evidence.
-- Tradeoff: keep vectors in a separate table with JSON payloads so MySQL remains the
-- source of truth while upper layers do filtered candidate reads and rerank in memory.

CREATE TABLE IF NOT EXISTS agent_cognition_embeddings (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    entity_type ENUM('memory', 'evidence') NOT NULL COMMENT 'Embedding target type',
    entity_id BIGINT UNSIGNED NOT NULL COMMENT 'Target entity id',
    scope_type ENUM('private_user', 'group_context', 'user_global', 'self_global', 'local_field') NOT NULL,
    scope_key VARCHAR(191) NOT NULL COMMENT 'Logical scope key, e.g. user:123 or group:456',
    content_hash CHAR(64) NOT NULL COMMENT 'SHA-256 hash of normalized text and model',
    source_text MEDIUMTEXT NOT NULL COMMENT 'Original text used to generate the embedding',
    normalized_text MEDIUMTEXT NOT NULL COMMENT 'Normalized text actually embedded',
    embedding_model VARCHAR(191) NOT NULL COMMENT 'OpenAI-compatible model id used for embedding',
    embedding_dimensions SMALLINT UNSIGNED NOT NULL DEFAULT 768,
    embedding_encoding ENUM('float') NOT NULL DEFAULT 'float',
    embedding_json JSON NOT NULL COMMENT 'Dense vector payload',
    metadata_json JSON NULL COMMENT 'Extra metadata for future rerank and audit',
    last_accessed_at DATETIME(3) NULL COMMENT 'Last time this row was used as a retrieval candidate',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_agent_embedding_entity (entity_type, entity_id),
    KEY idx_agent_embedding_hash (content_hash),
    KEY idx_agent_embedding_scope (scope_type, scope_key, entity_type, updated_at, id),
    KEY idx_agent_embedding_entity_scope (entity_type, entity_id, scope_type, updated_at, id),
    KEY idx_agent_embedding_model (embedding_model, embedding_dimensions, updated_at, id),
    KEY idx_agent_embedding_last_accessed (last_accessed_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
