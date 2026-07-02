'use strict';

function normalizeOptionalBigInt(value) {
  if (value === null || typeof value === 'undefined' || value === '') {
    return null;
  }
  if (typeof value === 'bigint') {
    return value;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return BigInt(Math.trunc(numeric));
}

function normalizeJsonArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === null || typeof value === 'undefined') {
    return [];
  }
  return [value];
}

function normalizeJsonObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  return {};
}

function normalizeDate(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeOptionalString(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeOptionalNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function buildScopeHash(input) {
  return [
    String(input.sessionKey || ''),
    input.groupId === null || typeof input.groupId === 'undefined' ? '' : String(input.groupId),
    String(input.scopeType || 'group_self'),
    String(input.learningKey || ''),
    String(input.learningScope || '')
  ].join('::');
}

function normalizeEpisodeRecord(record) {
  if (!record || typeof record !== 'object') {
    return record;
  }

  return {
    ...record,
    id: typeof record.id === 'bigint' ? Number(record.id) : record.id,
    group_id: typeof record.group_id === 'bigint' ? Number(record.group_id) : record.group_id,
    source_user_id: typeof record.source_user_id === 'bigint' ? Number(record.source_user_id) : record.source_user_id,
    source_conversation_id: typeof record.source_conversation_id === 'bigint'
      ? Number(record.source_conversation_id)
      : record.source_conversation_id
  };
}

function normalizeReflectionRecord(record) {
  if (!record || typeof record !== 'object') {
    return record;
  }

  return {
    ...record,
    id: typeof record.id === 'bigint' ? Number(record.id) : record.id,
    group_id: typeof record.group_id === 'bigint' ? Number(record.group_id) : record.group_id,
    source_user_id: typeof record.source_user_id === 'bigint' ? Number(record.source_user_id) : record.source_user_id,
    source_conversation_id: typeof record.source_conversation_id === 'bigint'
      ? Number(record.source_conversation_id)
      : record.source_conversation_id,
    supersedes_reflection_id: typeof record.supersedes_reflection_id === 'bigint'
      ? Number(record.supersedes_reflection_id)
      : record.supersedes_reflection_id
  };
}

function normalizeLearningStateRecord(record) {
  if (!record || typeof record !== 'object') {
    return record;
  }

  return {
    ...record,
    id: typeof record.id === 'bigint' ? Number(record.id) : record.id,
    group_id: typeof record.group_id === 'bigint' ? Number(record.group_id) : record.group_id,
    active_reflection_id: typeof record.active_reflection_id === 'bigint'
      ? Number(record.active_reflection_id)
      : record.active_reflection_id,
    latest_reflection_id: typeof record.latest_reflection_id === 'bigint'
      ? Number(record.latest_reflection_id)
      : record.latest_reflection_id
  };
}

function createFeedbackReflectionPersistence({ getPrismaClient, createSqlAdapter }) {
  function getClient(config) {
    return getPrismaClient(config);
  }

  async function ensureFeedbackReflectionSchema(config = {}) {
    const sql = createSqlAdapter(config);
    try {
      await sql.execute(
        `
          CREATE TABLE IF NOT EXISTS agent_feedback_episodes (
            id BIGSERIAL PRIMARY KEY,
            session_key VARCHAR(191) NOT NULL,
            group_id BIGINT NULL,
            source_user_id BIGINT NULL,
            source_user_name VARCHAR(255) NULL,
            scope_type VARCHAR(32) NOT NULL,
            event_kind VARCHAR(32) NOT NULL,
            excerpt_text TEXT NULL,
            source_message_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
            source_conversation_id BIGINT NULL,
            event_importance DOUBLE PRECISION NOT NULL DEFAULT 0,
            source_salience DOUBLE PRECISION NOT NULL DEFAULT 0,
            metadata JSONB NULL,
            created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `
      );
      await sql.execute(
        `
          CREATE TABLE IF NOT EXISTS agent_feedback_reflections (
            id BIGSERIAL PRIMARY KEY,
            session_key VARCHAR(191) NOT NULL,
            group_id BIGINT NULL,
            source_user_id BIGINT NULL,
            source_user_name VARCHAR(255) NULL,
            scope_type VARCHAR(32) NOT NULL,
            learning_key VARCHAR(191) NOT NULL DEFAULT 'feedback.general',
            learning_scope VARCHAR(191) NOT NULL DEFAULT 'group_self',
            reflection_type VARCHAR(32) NOT NULL DEFAULT 'social_lesson',
            feedback_kind VARCHAR(32) NOT NULL,
            confidence VARCHAR(16) NOT NULL DEFAULT 'medium',
            importance_score DOUBLE PRECISION NOT NULL DEFAULT 0,
            evidence_weight DOUBLE PRECISION NOT NULL DEFAULT 0,
            stability_score DOUBLE PRECISION NOT NULL DEFAULT 0,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            is_seed BOOLEAN NULL,
            summary_text TEXT NOT NULL,
            retrieval_text TEXT NULL,
            embedding_text TEXT NULL,
            source_message_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
            source_episode_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
            source_conversation_id BIGINT NULL,
            supersedes_reflection_id BIGINT NULL,
            conflict_group_key VARCHAR(191) NULL,
            metadata JSONB NULL,
            last_hit_at TIMESTAMPTZ(3) NULL,
            hit_count INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `
      );
      await sql.execute(
        `
          CREATE TABLE IF NOT EXISTS agent_feedback_learning_states (
            id BIGSERIAL PRIMARY KEY,
            session_key VARCHAR(191) NOT NULL,
            group_id BIGINT NULL,
            scope_type VARCHAR(32) NOT NULL,
            learning_key VARCHAR(191) NOT NULL,
            learning_scope VARCHAR(191) NOT NULL,
            scope_hash VARCHAR(191) NOT NULL UNIQUE,
            state_type VARCHAR(32) NOT NULL,
            active_reflection_id BIGINT NULL,
            latest_reflection_id BIGINT NULL,
            activation_weight DOUBLE PRECISION NOT NULL DEFAULT 0,
            recency_weight DOUBLE PRECISION NOT NULL DEFAULT 0,
            importance_weight DOUBLE PRECISION NOT NULL DEFAULT 0,
            source_weight DOUBLE PRECISION NOT NULL DEFAULT 0,
            conflict_penalty DOUBLE PRECISION NOT NULL DEFAULT 0,
            metadata JSONB NULL,
            created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `
      );

      await sql.execute('ALTER TABLE agent_feedback_reflections ADD COLUMN IF NOT EXISTS learning_key VARCHAR(191) NOT NULL DEFAULT \'feedback.general\'');
      await sql.execute('ALTER TABLE agent_feedback_reflections ADD COLUMN IF NOT EXISTS learning_scope VARCHAR(191) NOT NULL DEFAULT \'group_self\'');
      await sql.execute('ALTER TABLE agent_feedback_reflections ADD COLUMN IF NOT EXISTS reflection_type VARCHAR(32) NOT NULL DEFAULT \'social_lesson\'');
      await sql.execute('ALTER TABLE agent_feedback_reflections ADD COLUMN IF NOT EXISTS importance_score DOUBLE PRECISION NOT NULL DEFAULT 0');
      await sql.execute('ALTER TABLE agent_feedback_reflections ADD COLUMN IF NOT EXISTS evidence_weight DOUBLE PRECISION NOT NULL DEFAULT 0');
      await sql.execute('ALTER TABLE agent_feedback_reflections ADD COLUMN IF NOT EXISTS stability_score DOUBLE PRECISION NOT NULL DEFAULT 0');
      await sql.execute('ALTER TABLE agent_feedback_reflections ADD COLUMN IF NOT EXISTS embedding_text TEXT NULL');
      await sql.execute('ALTER TABLE agent_feedback_reflections ADD COLUMN IF NOT EXISTS source_episode_ids JSONB NOT NULL DEFAULT \'[]\'::jsonb');
      await sql.execute('ALTER TABLE agent_feedback_reflections ADD COLUMN IF NOT EXISTS supersedes_reflection_id BIGINT NULL');
      await sql.execute('ALTER TABLE agent_feedback_reflections ADD COLUMN IF NOT EXISTS conflict_group_key VARCHAR(191) NULL');
      await sql.execute('ALTER TABLE agent_feedback_reflections ADD COLUMN IF NOT EXISTS is_seed BOOLEAN NULL');
      await sql.execute('ALTER TABLE agent_feedback_reflections ADD COLUMN IF NOT EXISTS intimacy_level SMALLINT NULL');

      await sql.execute(
        'CREATE INDEX IF NOT EXISTS idx_agent_feedback_episodes_scope_updated ON agent_feedback_episodes (group_id, source_user_id, scope_type, updated_at DESC)'
      );
      await sql.execute(
        'CREATE INDEX IF NOT EXISTS idx_agent_feedback_episodes_session_updated ON agent_feedback_episodes (session_key, updated_at DESC)'
      );
      await sql.execute(
        'CREATE INDEX IF NOT EXISTS idx_agent_feedback_reflections_learning_active_updated ON agent_feedback_reflections (group_id, learning_key, learning_scope, is_active, updated_at DESC)'
      );
      await sql.execute(
        'CREATE INDEX IF NOT EXISTS idx_agent_feedback_reflections_session_active_updated ON agent_feedback_reflections (session_key, is_active, updated_at DESC)'
      );
      await sql.execute(
        'CREATE INDEX IF NOT EXISTS idx_agent_feedback_learning_states_scope_updated ON agent_feedback_learning_states (group_id, scope_type, updated_at DESC)'
      );
      await sql.execute(
        'CREATE INDEX IF NOT EXISTS idx_agent_feedback_learning_states_session_updated ON agent_feedback_learning_states (session_key, updated_at DESC)'
      );
    } finally {
      await sql.close();
    }
  }

  async function createFeedbackEpisode(input, config = {}) {
    const prisma = getClient(config);
    const created = await prisma.agentFeedbackEpisode.create({
      data: {
        session_key: String(input.sessionKey || ''),
        group_id: normalizeOptionalBigInt(input.groupId),
        source_user_id: normalizeOptionalBigInt(input.sourceUserId),
        source_user_name: normalizeOptionalString(input.sourceUserName),
        scope_type: String(input.scopeType || 'group_self'),
        event_kind: String(input.eventKind || 'feedback'),
        excerpt_text: normalizeOptionalString(input.excerptText),
        source_message_ids: normalizeJsonArray(input.sourceMessageIds),
        event_importance: normalizeOptionalNumber(input.eventImportance),
        source_salience: normalizeOptionalNumber(input.sourceSalience),
        metadata: normalizeJsonObject(input.metadata)
      }
    });
    return normalizeEpisodeRecord(created);
  }

  async function listFeedbackEpisodes(filters = {}, config = {}) {
    const prisma = getClient(config);
    const rows = await prisma.agentFeedbackEpisode.findMany({
      where: {
        session_key: typeof filters.sessionKey === 'string' ? filters.sessionKey : undefined,
        group_id: typeof filters.groupId !== 'undefined' ? normalizeOptionalBigInt(filters.groupId) : undefined,
        source_user_id: typeof filters.sourceUserId !== 'undefined' ? normalizeOptionalBigInt(filters.sourceUserId) : undefined,
        scope_type: typeof filters.scopeType === 'string' ? filters.scopeType : undefined,
        event_kind: typeof filters.eventKind === 'string' ? filters.eventKind : undefined
      },
      orderBy: [
        { updated_at: 'desc' },
        { id: 'desc' }
      ],
      take: Number.isFinite(filters.limit) ? Number(filters.limit) : 50
    });
    return rows.map(normalizeEpisodeRecord);
  }

  async function createFeedbackReflection(input, config = {}) {
    const prisma = getClient(config);
    const created = await prisma.agentFeedbackReflection.create({
      data: {
        session_key: String(input.sessionKey || ''),
        group_id: normalizeOptionalBigInt(input.groupId),
        source_user_id: normalizeOptionalBigInt(input.sourceUserId),
        source_user_name: normalizeOptionalString(input.sourceUserName),
        scope_type: String(input.scopeType || 'group_self'),
        learning_key: String(input.learningKey || 'feedback.general'),
        learning_scope: String(input.learningScope || input.scopeType || 'group_self'),
        reflection_type: String(input.reflectionType || 'social_lesson'),
        feedback_kind: String(input.feedbackKind || 'mixed'),
        confidence: String(input.confidence || 'medium'),
        importance_score: normalizeOptionalNumber(input.importanceScore),
        evidence_weight: normalizeOptionalNumber(input.evidenceWeight),
        stability_score: normalizeOptionalNumber(input.stabilityScore),
        is_active: input.isActive !== false,
        is_seed: typeof input.isSeed === 'boolean' ? input.isSeed : null,
        summary_text: String(input.summaryText || ''),
        retrieval_text: normalizeOptionalString(input.retrievalText),
        embedding_text: normalizeOptionalString(input.embeddingText),
        source_message_ids: normalizeJsonArray(input.sourceMessageIds),
        source_episode_ids: normalizeJsonArray(input.sourceEpisodeIds),
        supersedes_reflection_id: normalizeOptionalBigInt(input.supersedesReflectionId),
        conflict_group_key: normalizeOptionalString(input.conflictGroupKey),
        metadata: normalizeJsonObject(input.metadata),
        last_hit_at: normalizeDate(input.lastHitAt),
        hit_count: Number.isFinite(Number(input.hitCount)) ? Number(input.hitCount) : 0
      }
    });
    return normalizeReflectionRecord(created);
  }

  async function listFeedbackReflections(filters = {}, config = {}) {
    const prisma = getClient(config);
    const rows = await prisma.agentFeedbackReflection.findMany({
      where: {
        session_key: typeof filters.sessionKey === 'string' ? filters.sessionKey : undefined,
        group_id: typeof filters.groupId !== 'undefined' ? normalizeOptionalBigInt(filters.groupId) : undefined,
        source_user_id: typeof filters.sourceUserId !== 'undefined' ? normalizeOptionalBigInt(filters.sourceUserId) : undefined,
        scope_type: typeof filters.scopeType === 'string' ? filters.scopeType : undefined,
        learning_key: typeof filters.learningKey === 'string' ? filters.learningKey : undefined,
        learning_scope: typeof filters.learningScope === 'string' ? filters.learningScope : undefined,
        feedback_kind: typeof filters.feedbackKind === 'string' ? filters.feedbackKind : undefined,
        is_active: typeof filters.isActive === 'boolean' ? filters.isActive : undefined
      },
      orderBy: [
        { updated_at: 'desc' },
        { id: 'desc' }
      ],
      take: Number.isFinite(filters.limit) ? Number(filters.limit) : 50
    });
    return rows.map(normalizeReflectionRecord);
  }

  async function markFeedbackReflectionsHit(ids = [], params = {}, config = {}) {
    const normalizedIds = Array.isArray(ids)
      ? ids.map((value) => normalizeOptionalBigInt(value)).filter((value) => value !== null)
      : [];
    if (normalizedIds.length === 0) {
      return { count: 0, hit_at: null };
    }

    const prisma = getClient(config);
    const hitAt = normalizeDate(params.hitAt) || new Date();
    const result = await prisma.agentFeedbackReflection.updateMany({
      where: {
        id: {
          in: normalizedIds
        }
      },
      data: {
        last_hit_at: hitAt,
        hit_count: {
          increment: 1
        }
      }
    });

    return {
      count: Number(result.count || 0),
      hit_at: hitAt
    };
  }

  async function getFeedbackLearningState(filters = {}, config = {}) {
    const prisma = getClient(config);
    const scopeHash = typeof filters.scopeHash === 'string' && filters.scopeHash.trim()
      ? filters.scopeHash.trim()
      : buildScopeHash(filters);
    const row = await prisma.agentFeedbackLearningState.findFirst({
      where: {
        scope_hash: scopeHash
      }
    });
    return row ? normalizeLearningStateRecord(row) : null;
  }

  async function listFeedbackLearningStates(filters = {}, config = {}) {
    const prisma = getClient(config);
    const rows = await prisma.agentFeedbackLearningState.findMany({
      where: {
        session_key: typeof filters.sessionKey === 'string' ? filters.sessionKey : undefined,
        group_id: typeof filters.groupId !== 'undefined' ? normalizeOptionalBigInt(filters.groupId) : undefined,
        scope_type: typeof filters.scopeType === 'string' ? filters.scopeType : undefined,
        learning_key: typeof filters.learningKey === 'string' ? filters.learningKey : undefined,
        learning_scope: typeof filters.learningScope === 'string' ? filters.learningScope : undefined
      },
      orderBy: [
        { updated_at: 'desc' },
        { id: 'desc' }
      ],
      take: Number.isFinite(filters.limit) ? Number(filters.limit) : 50
    });
    return rows.map(normalizeLearningStateRecord);
  }

  async function upsertFeedbackLearningState(input, config = {}) {
    const prisma = getClient(config);
    const scopeHash = buildScopeHash(input);
    const payload = {
      session_key: String(input.sessionKey || ''),
      group_id: normalizeOptionalBigInt(input.groupId),
      scope_type: String(input.scopeType || 'group_self'),
      learning_key: String(input.learningKey || ''),
      learning_scope: String(input.learningScope || ''),
      scope_hash: scopeHash,
      state_type: String(input.stateType || 'reinforced'),
      active_reflection_id: normalizeOptionalBigInt(input.activeReflectionId),
      latest_reflection_id: normalizeOptionalBigInt(input.latestReflectionId),
      activation_weight: normalizeOptionalNumber(input.activationWeight),
      recency_weight: normalizeOptionalNumber(input.recencyWeight),
      importance_weight: normalizeOptionalNumber(input.importanceWeight),
      source_weight: normalizeOptionalNumber(input.sourceWeight),
      conflict_penalty: normalizeOptionalNumber(input.conflictPenalty),
      metadata: normalizeJsonObject(input.metadata)
    };

    const updated = await prisma.agentFeedbackLearningState.upsert({
      where: { scope_hash: scopeHash },
      update: payload,
      create: payload
    });
    return normalizeLearningStateRecord(updated);
  }

  return {
    ensureFeedbackReflectionSchema,
    createFeedbackEpisode,
    listFeedbackEpisodes,
    createFeedbackReflection,
    listFeedbackReflections,
    markFeedbackReflectionsHit,
    getFeedbackLearningState,
    listFeedbackLearningStates,
    upsertFeedbackLearningState
  };
}

module.exports = {
  createFeedbackReflectionPersistence
};
