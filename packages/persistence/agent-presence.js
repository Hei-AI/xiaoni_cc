'use strict';

function normalizeDate(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return typeof value === 'string' ? value : String(value);
}

function normalizeJsonArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeJsonObject(value, fallback = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  return fallback;
}

function normalizeOptionalString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizeShareItem(row) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    identityKey: row.identity_key,
    content: row.content,
    sourceKind: row.source_kind,
    boundaryLabel: row.boundary_label,
    sourceWording: row.source_wording,
    effortCost: Number(row.effort_cost || 1),
    baseHeat: Number(row.base_heat || 1),
    createdAt: normalizeDate(row.created_at),
    metadata: row.metadata || {}
  };
}

function normalizeDigitalAction(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    identityKey: row.identity_key,
    actionType: row.action_type,
    surface: row.surface,
    motiveKind: row.motive_kind || null,
    motiveText: row.motive_text || null,
    query: row.query || null,
    status: row.status,
    sourceTrace: row.source_trace || {},
    resultSummary: row.result_summary || null,
    residueText: row.residue_text || null,
    residueKind: row.residue_kind || null,
    sourceWording: row.source_wording || null,
    budgetSnapshot: row.budget_snapshot || {},
    sourceQueueIds: normalizeJsonArray(row.source_queue_ids),
    sourceRunIds: normalizeJsonArray(row.source_run_ids),
    errorMessage: row.error_message || null,
    createdAt: normalizeDate(row.created_at),
    updatedAt: normalizeDate(row.updated_at),
    completedAt: normalizeDate(row.completed_at)
  };
}

function createAgentPresencePersistence({ getPrismaClient, createSqlAdapter }) {
  function getClient(config) {
    return getPrismaClient(config);
  }

  async function ensureAgentPresenceSchema(config = {}) {
    const sql = createSqlAdapter(config);
    try {
      await sql.query("SELECT pg_advisory_lock(hashtext('qqbot_agent_presence_schema'))");
      await sql.execute(`
        CREATE TABLE IF NOT EXISTS agent_session_life_states (
          identity_key VARCHAR(191) PRIMARY KEY,
          last_active_at TIMESTAMP(3) NULL,
          last_boredom_reset_at TIMESTAMP(3) NULL,
          last_sleep_at TIMESTAMP(3) NULL,
          service_started_at TIMESTAMP(3) NULL,
          last_presence_tick_enqueued_at TIMESTAMP(3) NULL,
          last_proactive_at TIMESTAMP(3) NULL,
          last_user_message_at TIMESTAMP(3) NULL,
          daily_proactive_count INTEGER NOT NULL DEFAULT 0,
          daily_proactive_date TIMESTAMP(3) NULL,
          updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await sql.execute(`
        CREATE TABLE IF NOT EXISTS agent_session_group_states (
          session_key VARCHAR(191) PRIMARY KEY,
          identity_key VARCHAR(191) NOT NULL REFERENCES agent_session_life_states(identity_key) ON DELETE CASCADE,
          last_spoke_at TIMESTAMP(3) NULL,
          last_user_message_at TIMESTAMP(3) NULL,
          updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await sql.execute(`
        CREATE TABLE IF NOT EXISTS agent_share_pool_items (
          id SERIAL PRIMARY KEY,
          identity_key VARCHAR(191) NOT NULL,
          content TEXT NOT NULL,
          source_kind VARCHAR(32) NOT NULL,
          boundary_label VARCHAR(32) NOT NULL DEFAULT 'safe',
          source_wording VARCHAR(32) NOT NULL,
          effort_cost INTEGER NOT NULL,
          base_heat DOUBLE PRECISION NOT NULL DEFAULT 1.0,
          created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb
        )
      `);
      await sql.execute(`
        CREATE TABLE IF NOT EXISTS agent_share_item_usages (
          id SERIAL PRIMARY KEY,
          item_id INTEGER NOT NULL REFERENCES agent_share_pool_items(id) ON DELETE CASCADE,
          identity_key VARCHAR(191) NOT NULL,
          target_session_key VARCHAR(191) NOT NULL,
          target_group_id BIGINT NULL,
          run_id VARCHAR(128) NULL,
          trace_id VARCHAR(128) NULL,
          used_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          outcome VARCHAR(32) NULL,
          CONSTRAINT uniq_agent_share_item_usage_item_session UNIQUE (item_id, target_session_key)
        )
      `);
      await sql.execute(`
        CREATE TABLE IF NOT EXISTS agent_presence_state_sidecars (
          id SERIAL PRIMARY KEY,
          run_id VARCHAR(128) NOT NULL,
          trace_id VARCHAR(128) NULL,
          identity_key VARCHAR(191) NOT NULL,
          target_session_key VARCHAR(191) NULL,
          source_items JSONB NOT NULL,
          recall_scores JSONB NOT NULL,
          boundary_judgments JSONB NOT NULL,
          compression_mapping JSONB NOT NULL,
          final_context_block TEXT NOT NULL,
          model_action_outcome VARCHAR(32) NULL,
          created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await sql.execute(`
        CREATE TABLE IF NOT EXISTS agent_digital_actions (
          id VARCHAR(128) PRIMARY KEY,
          identity_key VARCHAR(191) NOT NULL,
          action_type VARCHAR(64) NOT NULL,
          surface VARCHAR(64) NOT NULL,
          motive_kind VARCHAR(64) NULL,
          motive_text TEXT NULL,
          query TEXT NULL,
          status VARCHAR(32) NOT NULL DEFAULT 'planned',
          source_trace JSONB NOT NULL DEFAULT '{}'::jsonb,
          result_summary TEXT NULL,
          residue_text TEXT NULL,
          residue_kind VARCHAR(64) NULL,
          source_wording VARCHAR(64) NULL,
          budget_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
          source_queue_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
          source_run_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
          error_message TEXT NULL,
          created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          completed_at TIMESTAMP(3) NULL
        )
      `);
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_agent_session_group_states_identity ON agent_session_group_states (identity_key)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_agent_share_pool_identity_created ON agent_share_pool_items (identity_key, created_at DESC, id DESC)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_agent_share_item_usage_identity_session ON agent_share_item_usages (identity_key, target_session_key)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_agent_presence_sidecars_run ON agent_presence_state_sidecars (run_id)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_agent_presence_sidecars_identity_created ON agent_presence_state_sidecars (identity_key, created_at DESC)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_agent_digital_actions_identity_created ON agent_digital_actions (identity_key, created_at DESC)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_agent_digital_actions_status_created ON agent_digital_actions (status, created_at DESC)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_agent_digital_actions_surface_created ON agent_digital_actions (surface, created_at DESC)');
    } finally {
      await sql.query("SELECT pg_advisory_unlock(hashtext('qqbot_agent_presence_schema'))").catch(() => undefined);
      await sql.close();
    }
  }

  async function ensureAgentLifeState(identityKey, config = {}) {
    const prisma = getClient(config);
    return prisma.agentSessionLifeState.upsert({
      where: { identity_key: String(identityKey || 'xiaoni') },
      create: {
        identity_key: String(identityKey || 'xiaoni'),
        service_started_at: new Date(),
        last_boredom_reset_at: new Date()
      },
      update: {}
    });
  }

  async function getAgentLifeState(identityKey, config = {}) {
    const prisma = getClient(config);
    return prisma.agentSessionLifeState.findUnique({
      where: { identity_key: String(identityKey || 'xiaoni') }
    });
  }

  async function updateAgentLifeState(identityKey, data, config = {}) {
    const prisma = getClient(config);
    await ensureAgentLifeState(identityKey, config);
    return prisma.agentSessionLifeState.update({
      where: { identity_key: String(identityKey || 'xiaoni') },
      data
    });
  }

  async function upsertAgentGroupPresenceState(input, config = {}) {
    const prisma = getClient(config);
    const identityKey = String(input.identityKey || input.identity_key || 'xiaoni');
    const sessionKey = String(input.sessionKey || input.session_key || '');
    await ensureAgentLifeState(identityKey, config);
    return prisma.agentSessionGroupState.upsert({
      where: { session_key: sessionKey },
      create: {
        session_key: sessionKey,
        identity_key: identityKey,
        last_spoke_at: input.lastSpokeAt || input.last_spoke_at || null,
        last_user_message_at: input.lastUserMessageAt || input.last_user_message_at || null
      },
      update: {
        ...(Object.prototype.hasOwnProperty.call(input, 'lastSpokeAt') || Object.prototype.hasOwnProperty.call(input, 'last_spoke_at')
          ? { last_spoke_at: input.lastSpokeAt || input.last_spoke_at || null }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(input, 'lastUserMessageAt') || Object.prototype.hasOwnProperty.call(input, 'last_user_message_at')
          ? { last_user_message_at: input.lastUserMessageAt || input.last_user_message_at || null }
          : {})
      }
    });
  }

  async function listAgentSharePoolItems(input = {}, config = {}) {
    const prisma = getClient(config);
    const identityKey = String(input.identityKey || input.identity_key || 'xiaoni');
    const targetSessionKey = normalizeOptionalString(input.targetSessionKey || input.target_session_key);
    const where = {
      identity_key: identityKey,
      boundary_label: { not: 'blocked' }
    };
    if (targetSessionKey) {
      where.usages = { none: { target_session_key: targetSessionKey } };
    }
    const rows = await prisma.agentSharePoolItem.findMany({
      where,
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: Math.max(1, Math.min(Number(input.limit || 8), 50))
    });
    return rows.map(normalizeShareItem).filter(Boolean);
  }

  async function createAgentSharePoolItem(input, config = {}) {
    const prisma = getClient(config);
    return normalizeShareItem(await prisma.agentSharePoolItem.create({
      data: {
        identity_key: String(input.identityKey || input.identity_key || 'xiaoni'),
        content: String(input.content || '').trim(),
        source_kind: String(input.sourceKind || input.source_kind || 'web_search'),
        boundary_label: String(input.boundaryLabel || input.boundary_label || 'safe'),
        source_wording: String(input.sourceWording || input.source_wording || 'real_web_search'),
        effort_cost: Math.max(1, Number(input.effortCost || input.effort_cost || 1)),
        base_heat: Number.isFinite(Number(input.baseHeat || input.base_heat)) ? Number(input.baseHeat || input.base_heat) : 1,
        metadata: normalizeJsonObject(input.metadata)
      }
    }));
  }

  async function createAgentShareItemUsage(input, config = {}) {
    const prisma = getClient(config);
    try {
      return await prisma.agentShareItemUsage.create({
        data: {
          item_id: Number(input.itemId || input.item_id),
          identity_key: String(input.identityKey || input.identity_key || 'xiaoni'),
          target_session_key: String(input.targetSessionKey || input.target_session_key || ''),
          target_group_id: input.targetGroupId || input.target_group_id ? BigInt(input.targetGroupId || input.target_group_id) : null,
          run_id: normalizeOptionalString(input.runId || input.run_id),
          trace_id: normalizeOptionalString(input.traceId || input.trace_id),
          outcome: normalizeOptionalString(input.outcome)
        }
      });
    } catch (error) {
      if (error?.code !== 'P2002') {
        throw error;
      }
      return prisma.agentShareItemUsage.findFirst({
        where: {
          item_id: Number(input.itemId || input.item_id),
          target_session_key: String(input.targetSessionKey || input.target_session_key || '')
        }
      });
    }
  }

  async function createAgentPresenceStateSidecar(input, config = {}) {
    const prisma = getClient(config);
    return prisma.agentPresenceStateSidecar.create({
      data: {
        run_id: String(input.runId || input.run_id || ''),
        trace_id: normalizeOptionalString(input.traceId || input.trace_id),
        identity_key: String(input.identityKey || input.identity_key || 'xiaoni'),
        target_session_key: normalizeOptionalString(input.targetSessionKey || input.target_session_key),
        source_items: normalizeJsonArray(input.sourceItems || input.source_items),
        recall_scores: normalizeJsonArray(input.recallScores || input.recall_scores),
        boundary_judgments: normalizeJsonArray(input.boundaryJudgments || input.boundary_judgments),
        compression_mapping: normalizeJsonObject(input.compressionMapping || input.compression_mapping),
        final_context_block: String(input.finalContextBlock || input.final_context_block || ''),
        model_action_outcome: normalizeOptionalString(input.modelActionOutcome || input.model_action_outcome)
      }
    });
  }

  async function createAgentDigitalAction(input, config = {}) {
    const prisma = getClient(config);
    const id = String(input.id || input.actionId || input.action_id || '');
    if (!id) {
      throw new Error('Agent digital action id is required');
    }
    return normalizeDigitalAction(await prisma.agentDigitalAction.create({
      data: {
        id,
        identity_key: String(input.identityKey || input.identity_key || 'xiaoni'),
        action_type: String(input.actionType || input.action_type || 'web_search'),
        surface: String(input.surface || 'background'),
        motive_kind: normalizeOptionalString(input.motiveKind || input.motive_kind),
        motive_text: normalizeOptionalString(input.motiveText || input.motive_text),
        query: normalizeOptionalString(input.query),
        status: String(input.status || 'planned'),
        source_trace: normalizeJsonObject(input.sourceTrace || input.source_trace),
        result_summary: normalizeOptionalString(input.resultSummary || input.result_summary),
        residue_text: normalizeOptionalString(input.residueText || input.residue_text),
        residue_kind: normalizeOptionalString(input.residueKind || input.residue_kind),
        source_wording: normalizeOptionalString(input.sourceWording || input.source_wording),
        budget_snapshot: normalizeJsonObject(input.budgetSnapshot || input.budget_snapshot),
        source_queue_ids: normalizeJsonArray(input.sourceQueueIds || input.source_queue_ids),
        source_run_ids: normalizeJsonArray(input.sourceRunIds || input.source_run_ids),
        error_message: normalizeOptionalString(input.errorMessage || input.error_message),
        completed_at: input.completedAt || input.completed_at || null
      }
    }));
  }

  async function updateAgentDigitalAction(id, data, config = {}) {
    const prisma = getClient(config);
    const update = {};
    const stringFields = [
      ['motiveKind', 'motive_kind'],
      ['motiveText', 'motive_text'],
      ['query', 'query'],
      ['status', 'status'],
      ['resultSummary', 'result_summary'],
      ['residueText', 'residue_text'],
      ['residueKind', 'residue_kind'],
      ['sourceWording', 'source_wording'],
      ['errorMessage', 'error_message']
    ];
    for (const [camel, snake] of stringFields) {
      if (Object.prototype.hasOwnProperty.call(data, camel) || Object.prototype.hasOwnProperty.call(data, snake)) {
        update[snake] = normalizeOptionalString(data[camel] || data[snake]);
      }
    }
    if (Object.prototype.hasOwnProperty.call(data, 'sourceTrace') || Object.prototype.hasOwnProperty.call(data, 'source_trace')) {
      update.source_trace = normalizeJsonObject(data.sourceTrace || data.source_trace);
    }
    if (Object.prototype.hasOwnProperty.call(data, 'budgetSnapshot') || Object.prototype.hasOwnProperty.call(data, 'budget_snapshot')) {
      update.budget_snapshot = normalizeJsonObject(data.budgetSnapshot || data.budget_snapshot);
    }
    if (Object.prototype.hasOwnProperty.call(data, 'sourceQueueIds') || Object.prototype.hasOwnProperty.call(data, 'source_queue_ids')) {
      update.source_queue_ids = normalizeJsonArray(data.sourceQueueIds || data.source_queue_ids);
    }
    if (Object.prototype.hasOwnProperty.call(data, 'sourceRunIds') || Object.prototype.hasOwnProperty.call(data, 'source_run_ids')) {
      update.source_run_ids = normalizeJsonArray(data.sourceRunIds || data.source_run_ids);
    }
    if (Object.prototype.hasOwnProperty.call(data, 'completedAt') || Object.prototype.hasOwnProperty.call(data, 'completed_at')) {
      update.completed_at = data.completedAt || data.completed_at || null;
    }
    return normalizeDigitalAction(await prisma.agentDigitalAction.update({
      where: { id: String(id) },
      data: update
    }));
  }

  async function listAgentDigitalActions(input = {}, config = {}) {
    const prisma = getClient(config);
    const identityKey = String(input.identityKey || input.identity_key || 'xiaoni');
    const where = { identity_key: identityKey };
    const status = normalizeOptionalString(input.status);
    const surface = normalizeOptionalString(input.surface);
    const actionType = normalizeOptionalString(input.actionType || input.action_type);
    if (status) {
      where.status = status;
    }
    if (surface) {
      where.surface = surface;
    }
    if (actionType) {
      where.action_type = actionType;
    }
    if (input.createdAfter || input.created_after) {
      where.created_at = { gte: input.createdAfter || input.created_after };
    }
    const rows = await prisma.agentDigitalAction.findMany({
      where,
      orderBy: [{ created_at: 'desc' }],
      take: Math.max(1, Math.min(Number(input.limit || 8), 100))
    });
    return rows.map(normalizeDigitalAction).filter(Boolean);
  }

  async function countAgentDigitalActions(input = {}, config = {}) {
    const prisma = getClient(config);
    const identityKey = String(input.identityKey || input.identity_key || 'xiaoni');
    const where = { identity_key: identityKey };
    const status = normalizeOptionalString(input.status);
    const surface = normalizeOptionalString(input.surface);
    const actionType = normalizeOptionalString(input.actionType || input.action_type);
    if (status) {
      where.status = status;
    }
    if (surface) {
      where.surface = surface;
    }
    if (actionType) {
      where.action_type = actionType;
    }
    if (input.createdAfter || input.created_after) {
      where.created_at = { gte: input.createdAfter || input.created_after };
    }
    return prisma.agentDigitalAction.count({ where });
  }

  return {
    ensureAgentPresenceSchema,
    ensureAgentLifeState,
    getAgentLifeState,
    updateAgentLifeState,
    upsertAgentGroupPresenceState,
    listAgentSharePoolItems,
    createAgentSharePoolItem,
    createAgentShareItemUsage,
    createAgentPresenceStateSidecar,
    createAgentDigitalAction,
    updateAgentDigitalAction,
    listAgentDigitalActions,
    countAgentDigitalActions
  };
}

module.exports = {
  createAgentPresencePersistence
};
