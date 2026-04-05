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

function normalizeSelfEvolutionRecord(record) {
  if (!record || typeof record !== 'object') {
    return record;
  }

  return {
    ...record,
    id: typeof record.id === 'bigint' ? Number(record.id) : record.id,
    group_id: typeof record.group_id === 'bigint' ? Number(record.group_id) : record.group_id,
    target_user_id: typeof record.target_user_id === 'bigint' ? Number(record.target_user_id) : record.target_user_id,
    turn_range_start: typeof record.turn_range_start === 'bigint' ? Number(record.turn_range_start) : record.turn_range_start,
    turn_range_end: typeof record.turn_range_end === 'bigint' ? Number(record.turn_range_end) : record.turn_range_end
  };
}

function createSelfEvolutionPersistence({ getPrismaClient, createSqlAdapter }) {
  function getClient(config) {
    return getPrismaClient(config);
  }

  async function ensureSelfEvolutionSchema(config = {}) {
    const sql = createSqlAdapter(config);
    try {
      await sql.execute(
        `
          CREATE TABLE IF NOT EXISTS self_evolution_jobs (
            id BIGSERIAL PRIMARY KEY,
            group_id BIGINT NULL,
            target_user_id BIGINT NULL,
            session_key VARCHAR(191) NOT NULL,
            status VARCHAR(16) NOT NULL,
            trigger_reason VARCHAR(64) NOT NULL,
            turn_range_start BIGINT NULL,
            turn_range_end BIGINT NULL,
            source_event_count INTEGER NOT NULL DEFAULT 0,
            input_message_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
            output_state_version INTEGER NULL,
            error_message TEXT NULL,
            metadata JSONB NULL,
            started_at TIMESTAMP(3) NULL,
            finished_at TIMESTAMP(3) NULL,
            created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `
      );
      await sql.execute(
        `
          CREATE TABLE IF NOT EXISTS self_evolution_states (
            id BIGSERIAL PRIMARY KEY,
            session_key VARCHAR(191) NOT NULL,
            group_id BIGINT NULL,
            target_user_id BIGINT NULL,
            scope_type VARCHAR(32) NOT NULL,
            version INTEGER NOT NULL DEFAULT 1,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            social_presence_baseline VARCHAR(32) NOT NULL,
            entry_preference VARCHAR(32) NOT NULL,
            warmth_bias VARCHAR(32) NOT NULL,
            familiarity_ceiling VARCHAR(32) NOT NULL,
            topic_resonance JSONB NOT NULL DEFAULT '[]'::jsonb,
            boundary_tendencies JSONB NOT NULL DEFAULT '{}'::jsonb,
            reinforced_modes JSONB NOT NULL DEFAULT '[]'::jsonb,
            suppressed_modes JSONB NOT NULL DEFAULT '[]'::jsonb,
            summary_text TEXT NOT NULL,
            source_event_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
            source_message_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
            metadata JSONB NULL,
            created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `
      );
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_self_evolution_jobs_group_status_updated ON self_evolution_jobs (group_id, status, updated_at DESC)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_self_evolution_jobs_session_updated ON self_evolution_jobs (session_key, updated_at DESC)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_self_evolution_states_scope_active_updated ON self_evolution_states (group_id, target_user_id, scope_type, is_active, updated_at DESC)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_self_evolution_states_session_active_updated ON self_evolution_states (session_key, is_active, updated_at DESC)');
    } finally {
      await sql.close();
    }
  }

  async function createSelfEvolutionJob(input, config = {}) {
    const prisma = getClient(config);
    const created = await prisma.selfEvolutionJob.create({
      data: {
        group_id: normalizeOptionalBigInt(input.groupId),
        target_user_id: normalizeOptionalBigInt(input.targetUserId),
        session_key: String(input.sessionKey || ''),
        status: String(input.status || 'pending'),
        trigger_reason: String(input.triggerReason || 'compact_checkpoint'),
        turn_range_start: normalizeOptionalBigInt(input.turnRangeStart),
        turn_range_end: normalizeOptionalBigInt(input.turnRangeEnd),
        source_event_count: Number(input.sourceEventCount || 0),
        input_message_ids: normalizeJsonArray(input.inputMessageIds),
        output_state_version: typeof input.outputStateVersion === 'number' ? input.outputStateVersion : null,
        error_message: input.errorMessage ? String(input.errorMessage) : null,
        metadata: normalizeJsonObject(input.metadata),
        started_at: normalizeDate(input.startedAt),
        finished_at: normalizeDate(input.finishedAt)
      }
    });
    return normalizeSelfEvolutionRecord(created);
  }

  async function updateSelfEvolutionJob(id, updates = {}, config = {}) {
    const prisma = getClient(config);
    const updated = await prisma.selfEvolutionJob.update({
      where: { id: BigInt(id) },
      data: {
        status: typeof updates.status === 'string' ? updates.status : undefined,
        trigger_reason: typeof updates.triggerReason === 'string' ? updates.triggerReason : undefined,
        turn_range_start: typeof updates.turnRangeStart !== 'undefined' ? normalizeOptionalBigInt(updates.turnRangeStart) : undefined,
        turn_range_end: typeof updates.turnRangeEnd !== 'undefined' ? normalizeOptionalBigInt(updates.turnRangeEnd) : undefined,
        source_event_count: typeof updates.sourceEventCount === 'number' ? updates.sourceEventCount : undefined,
        input_message_ids: Array.isArray(updates.inputMessageIds) ? updates.inputMessageIds : undefined,
        output_state_version: typeof updates.outputStateVersion === 'number' ? updates.outputStateVersion : undefined,
        error_message: typeof updates.errorMessage === 'string' ? updates.errorMessage : updates.errorMessage === null ? null : undefined,
        metadata: updates.metadata && typeof updates.metadata === 'object' ? updates.metadata : undefined,
        started_at: typeof updates.startedAt !== 'undefined' ? normalizeDate(updates.startedAt) : undefined,
        finished_at: typeof updates.finishedAt !== 'undefined' ? normalizeDate(updates.finishedAt) : undefined
      }
    });
    return normalizeSelfEvolutionRecord(updated);
  }

  async function listSelfEvolutionJobs(filters = {}, config = {}) {
    const prisma = getClient(config);
    const rows = await prisma.selfEvolutionJob.findMany({
      where: {
        group_id: typeof filters.groupId !== 'undefined' ? normalizeOptionalBigInt(filters.groupId) : undefined,
        target_user_id: typeof filters.targetUserId !== 'undefined' ? normalizeOptionalBigInt(filters.targetUserId) : undefined,
        session_key: typeof filters.sessionKey === 'string' ? filters.sessionKey : undefined,
        status: typeof filters.status === 'string' ? filters.status : undefined
      },
      orderBy: [
        { updated_at: 'desc' },
        { id: 'desc' }
      ],
      take: Number.isFinite(filters.limit) ? Number(filters.limit) : 50
    });
    return rows.map(normalizeSelfEvolutionRecord);
  }

  async function replaceSelfEvolutionStates(input, config = {}) {
    const prisma = getClient(config);
    const groupId = normalizeOptionalBigInt(input.groupId);
    const targetUserId = typeof input.targetUserId !== 'undefined'
      ? normalizeOptionalBigInt(input.targetUserId)
      : undefined;
    const sessionKey = String(input.sessionKey || '');
    const scopeType = String(input.scopeType || '');
    const version = Number(input.version || 1);
    const states = Array.isArray(input.states) ? input.states : [];

    return prisma.$transaction(async (tx) => {
      await tx.selfEvolutionState.updateMany({
        where: {
          session_key: sessionKey,
          group_id: groupId,
          target_user_id: targetUserId,
          scope_type: scopeType,
          is_active: true
        },
        data: {
          is_active: false
        }
      });

      const created = [];
      for (const state of states) {
        const row = await tx.selfEvolutionState.create({
          data: {
            session_key: sessionKey,
            group_id: groupId,
            target_user_id: targetUserId ?? null,
            scope_type: scopeType,
            version,
            is_active: state.isActive !== false,
            social_presence_baseline: String(state.socialPresenceBaseline || ''),
            entry_preference: String(state.entryPreference || ''),
            warmth_bias: String(state.warmthBias || ''),
            familiarity_ceiling: String(state.familiarityCeiling || ''),
            topic_resonance: normalizeJsonArray(state.topicResonance),
            boundary_tendencies: normalizeJsonObject(state.boundaryTendencies),
            reinforced_modes: normalizeJsonArray(state.reinforcedModes),
            suppressed_modes: normalizeJsonArray(state.suppressedModes),
            summary_text: String(state.summaryText || ''),
            source_event_ids: normalizeJsonArray(state.sourceEventIds),
            source_message_ids: normalizeJsonArray(state.sourceMessageIds),
            metadata: normalizeJsonObject(state.metadata)
          }
        });
        created.push(normalizeSelfEvolutionRecord(row));
      }

      return created;
    });
  }

  async function listSelfEvolutionStates(filters = {}, config = {}) {
    const prisma = getClient(config);
    const rows = await prisma.selfEvolutionState.findMany({
      where: {
        session_key: typeof filters.sessionKey === 'string' ? filters.sessionKey : undefined,
        group_id: typeof filters.groupId !== 'undefined' ? normalizeOptionalBigInt(filters.groupId) : undefined,
        target_user_id: typeof filters.targetUserId !== 'undefined' ? normalizeOptionalBigInt(filters.targetUserId) : undefined,
        scope_type: typeof filters.scopeType === 'string' ? filters.scopeType : undefined,
        is_active: typeof filters.isActive === 'boolean' ? filters.isActive : undefined
      },
      orderBy: [
        { updated_at: 'desc' },
        { id: 'desc' }
      ],
      take: Number.isFinite(filters.limit) ? Number(filters.limit) : 100
    });
    return rows.map(normalizeSelfEvolutionRecord);
  }

  return {
    ensureSelfEvolutionSchema,
    createSelfEvolutionJob,
    updateSelfEvolutionJob,
    listSelfEvolutionJobs,
    replaceSelfEvolutionStates,
    listSelfEvolutionStates
  };
}

module.exports = {
  createSelfEvolutionPersistence
};
