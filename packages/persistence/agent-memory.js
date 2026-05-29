'use strict';

function normalizeOptionalBigInt(value) {
  if (value === null || typeof value === 'undefined' || value === '') return null;
  if (typeof value === 'bigint') return value;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? BigInt(Math.trunc(numeric)) : null;
}

function normalizeJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || typeof value === 'undefined') return [];
  return [value];
}

function normalizeJsonObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeOptionalString(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeOptionalDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeRecord(record) {
  if (!record || typeof record !== 'object') return record;
  const normalized = { ...record };
  for (const key of ['id', 'group_id', 'source_conversation_id']) {
    if (typeof normalized[key] === 'bigint') normalized[key] = Number(normalized[key]);
  }
  return normalized;
}

function createAgentMemoryPersistence({ getPrismaClient, createSqlAdapter }) {
  function getClient(config) {
    return getPrismaClient(config);
  }

  async function ensureAgentMemorySchema(config = {}) {
    const sql = createSqlAdapter(config);
    try {
      await sql.execute(`
        CREATE TABLE IF NOT EXISTS agent_memory_observations (
          id BIGSERIAL PRIMARY KEY,
          session_key VARCHAR(191) NOT NULL,
          group_id BIGINT NULL,
          source_conversation_id BIGINT NULL,
          source_turn_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
          source_message_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
          topic VARCHAR(191) NOT NULL,
          text TEXT NOT NULL,
          poignancy INTEGER NOT NULL DEFAULT 1,
          participants JSONB NOT NULL DEFAULT '[]'::jsonb,
          xiaoni_role VARCHAR(32) NOT NULL,
          source_trace_id VARCHAR(128) NULL,
          source_run_id VARCHAR(128) NULL,
          writer_model VARCHAR(128) NULL,
          metadata JSONB NULL,
          created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await sql.execute(`
        CREATE TABLE IF NOT EXISTS agent_memory_assertions (
          id BIGSERIAL PRIMARY KEY,
          session_key VARCHAR(191) NOT NULL,
          group_id BIGINT NULL,
          source_conversation_id BIGINT NULL,
          source_turn_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
          source_message_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
          text TEXT NOT NULL,
          fact_type VARCHAR(32) NOT NULL,
          entities JSONB NOT NULL DEFAULT '[]'::jsonb,
          participants JSONB NOT NULL DEFAULT '[]'::jsonb,
          source_trace_id VARCHAR(128) NULL,
          source_run_id VARCHAR(128) NULL,
          writer_model VARCHAR(128) NULL,
          metadata JSONB NULL,
          created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await sql.execute(`
        CREATE TABLE IF NOT EXISTS agent_memory_reflections (
          id BIGSERIAL PRIMARY KEY,
          session_key VARCHAR(191) NOT NULL,
          group_id BIGINT NULL,
          source_conversation_id BIGINT NULL,
          text TEXT NOT NULL,
          kind VARCHAR(32) NOT NULL,
          subjects JSONB NOT NULL DEFAULT '[]'::jsonb,
          evidence_basis VARCHAR(32) NOT NULL,
          evidence_time_start TIMESTAMP(3) NULL,
          evidence_time_end TIMESTAMP(3) NULL,
          poignancy INTEGER NOT NULL DEFAULT 1,
          source_observation_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
          source_message_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
          source_trace_id VARCHAR(128) NULL,
          source_run_id VARCHAR(128) NULL,
          writer_model VARCHAR(128) NULL,
          metadata JSONB NULL,
          created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_agent_memory_obs_session_created ON agent_memory_observations (session_key, created_at DESC, id DESC)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_agent_memory_obs_group_created ON agent_memory_observations (group_id, created_at DESC, id DESC)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_agent_memory_assert_session_created ON agent_memory_assertions (session_key, created_at DESC, id DESC)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_agent_memory_assert_group_fact ON agent_memory_assertions (group_id, fact_type, created_at DESC)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_agent_memory_refl_session_created ON agent_memory_reflections (session_key, created_at DESC, id DESC)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_agent_memory_refl_group_kind ON agent_memory_reflections (group_id, kind, created_at DESC)');
    } finally {
      await sql.close();
    }
  }

  async function createAgentMemoryObservation(input, config = {}) {
    const prisma = getClient(config);
    return normalizeRecord(await prisma.agentMemoryObservation.create({
      data: {
        session_key: String(input.sessionKey || ''),
        group_id: normalizeOptionalBigInt(input.groupId),
        source_conversation_id: normalizeOptionalBigInt(input.sourceConversationId),
        source_turn_ids: normalizeJsonArray(input.sourceTurnIds),
        source_message_ids: normalizeJsonArray(input.sourceMessageIds),
        topic: String(input.topic || ''),
        text: String(input.text || ''),
        poignancy: Number.isFinite(Number(input.poignancy)) ? Math.trunc(Number(input.poignancy)) : 1,
        participants: normalizeJsonArray(input.participants),
        xiaoni_role: String(input.xiaoniRole || 'not_involved'),
        source_trace_id: normalizeOptionalString(input.sourceTraceId),
        source_run_id: normalizeOptionalString(input.sourceRunId),
        writer_model: normalizeOptionalString(input.writerModel),
        metadata: normalizeJsonObject(input.metadata)
      }
    }));
  }

  async function createAgentMemoryAssertion(input, config = {}) {
    const prisma = getClient(config);
    return normalizeRecord(await prisma.agentMemoryAssertion.create({
      data: {
        session_key: String(input.sessionKey || ''),
        group_id: normalizeOptionalBigInt(input.groupId),
        source_conversation_id: normalizeOptionalBigInt(input.sourceConversationId),
        source_turn_ids: normalizeJsonArray(input.sourceTurnIds),
        source_message_ids: normalizeJsonArray(input.sourceMessageIds),
        text: String(input.text || ''),
        fact_type: String(input.factType || 'claim'),
        entities: normalizeJsonArray(input.entities),
        participants: normalizeJsonArray(input.participants),
        source_trace_id: normalizeOptionalString(input.sourceTraceId),
        source_run_id: normalizeOptionalString(input.sourceRunId),
        writer_model: normalizeOptionalString(input.writerModel),
        metadata: normalizeJsonObject(input.metadata)
      }
    }));
  }

  async function createAgentMemoryReflection(input, config = {}) {
    const prisma = getClient(config);
    return normalizeRecord(await prisma.agentMemoryReflection.create({
      data: {
        session_key: String(input.sessionKey || ''),
        group_id: normalizeOptionalBigInt(input.groupId),
        source_conversation_id: normalizeOptionalBigInt(input.sourceConversationId),
        text: String(input.text || ''),
        kind: String(input.kind || 'group_pattern'),
        subjects: normalizeJsonArray(input.subjects),
        evidence_basis: String(input.evidenceBasis || 'group_pattern'),
        evidence_time_start: normalizeOptionalDate(input.evidenceTimeStart),
        evidence_time_end: normalizeOptionalDate(input.evidenceTimeEnd),
        poignancy: Number.isFinite(Number(input.poignancy)) ? Math.trunc(Number(input.poignancy)) : 1,
        source_observation_ids: normalizeJsonArray(input.sourceObservationIds),
        source_message_ids: normalizeJsonArray(input.sourceMessageIds),
        source_trace_id: normalizeOptionalString(input.sourceTraceId),
        source_run_id: normalizeOptionalString(input.sourceRunId),
        writer_model: normalizeOptionalString(input.writerModel),
        metadata: normalizeJsonObject(input.metadata)
      }
    }));
  }

  async function listAgentMemoryObservations(filters = {}, config = {}) {
    const prisma = getClient(config);
    const rows = await prisma.agentMemoryObservation.findMany({
      where: {
        session_key: typeof filters.sessionKey === 'string' ? filters.sessionKey : undefined,
        group_id: typeof filters.groupId !== 'undefined' ? normalizeOptionalBigInt(filters.groupId) : undefined
      },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: Number.isFinite(filters.limit) ? Number(filters.limit) : 50
    });
    return rows.map(normalizeRecord);
  }

  return {
    ensureAgentMemorySchema,
    createAgentMemoryObservation,
    createAgentMemoryAssertion,
    createAgentMemoryReflection,
    listAgentMemoryObservations
  };
}

module.exports = {
  createAgentMemoryPersistence
};
