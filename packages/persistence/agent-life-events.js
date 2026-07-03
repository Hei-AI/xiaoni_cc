'use strict';

const {
  formatEast8IsoOffset,
  parseStoredTimestamp,
  parseTimestampWithoutTimezone,
  prepareTimestampWithoutTimezoneForPrisma,
  serializeTimestampWithoutTimezoneForApi
} = require('./time');

const B1_EVENT_KINDS = new Set([
  'surface_visit',
  'phone_notification',
  'qq_message_seen',
  'qq_self_message',
  'send_in_group',
  'silence_decision',
  'surface_leave',
  'web_search_result',
  'pending_share_created',
  'pending_share_consumed',
  'state_snapshot',
  'terminal_action_committed',
  'terminal_action_blocked',
  'presence_tick_evaluated',
  'no_visible_delivery_observed',
  'visible_delivery_committed',
  'post_commit_side_effect_blocked',
  'rest_period',
  'sleep_period',
  // Admin-panel manual override: directly set Xiaoni's current energy/pressure. Payload carries
  // either { energy } or { homeostatic_pressure, action_debt }. Runtime-internal life state only —
  // never enters the model request prefix, so it has zero prompt-cache impact.
  'manual_energy_override'
]);

const LIFE_EVENT_VISIBILITIES = new Set([
  'active_surface',
  'public_residue',
  'self_private',
  'private_surface',
  'operator_only'
]);

function normalizeDate(value) {
  return serializeTimestampWithoutTimezoneForApi(value);
}

function normalizeTimestampInput(value) {
  return prepareTimestampWithoutTimezoneForPrisma(value);
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

function normalizeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeBigIntString(value) {
  if (value === null || typeof value === 'undefined') {
    return null;
  }
  return String(value);
}

function normalizeBigIntInput(value) {
  if (value === null || typeof value === 'undefined' || value === '') {
    return null;
  }
  return BigInt(value);
}

function normalizeEventKind(value) {
  const eventKind = String(value || '').trim();
  if (!B1_EVENT_KINDS.has(eventKind)) {
    throw new Error(`Unsupported agent life event kind: ${eventKind || '(empty)'}`);
  }
  return eventKind;
}

function normalizeVisibility(value) {
  const visibility = String(value || '').trim();
  if (!visibility) {
    throw new Error('Agent life event visibility is required');
  }
  if (!LIFE_EVENT_VISIBILITIES.has(visibility)) {
    throw new Error(`Unsupported agent life event visibility: ${visibility || '(empty)'}`);
  }
  return visibility;
}

function normalizeDedupeKey(value) {
  const dedupeKey = String(value || '').trim();
  if (!dedupeKey) {
    throw new Error('Agent life event dedupeKey is required');
  }
  if (dedupeKey.length > 255) {
    throw new Error('Agent life event dedupeKey must be 255 characters or fewer');
  }
  return dedupeKey;
}

function normalizeLifeEvent(row) {
  if (!row) {
    return null;
  }
  return {
    id: normalizeBigIntString(row.id),
    identityKey: row.identity_key,
    eventKind: row.event_kind,
    occurredAt: normalizeDate(row.occurred_at),
    surface: row.surface || null,
    chatType: row.chat_type || null,
    sessionKey: row.session_key || null,
    surfaceId: row.surface_id || null,
    peerId: row.peer_id || null,
    accountId: row.account_id || null,
    messageSid: row.message_sid || null,
    messageId: row.message_id || null,
    batchId: row.batch_id || null,
    conversationId: normalizeBigIntString(row.conversation_id),
    conversationItemId: normalizeBigIntString(row.conversation_item_id),
    queueMessageId: normalizeBigIntString(row.queue_message_id),
    runId: row.run_id || null,
    traceId: row.trace_id || null,
    llmCallId: row.llm_call_id || null,
    sourceActionId: row.source_action_id || null,
    actorType: row.actor_type || 'xiaoni',
    actorId: row.actor_id || null,
    targetId: row.target_id || null,
    visibility: row.visibility,
    actionCost: normalizeNumber(row.action_cost),
    pressureDelta: normalizeNumber(row.pressure_delta),
    rewardDelta: normalizeNumber(row.reward_delta),
    boredomDelta: normalizeNumber(row.boredom_delta),
    attentionDelta: normalizeNumber(row.attention_delta),
    payload: normalizeJsonObject(row.payload),
    dedupeKey: row.dedupe_key,
    createdAt: normalizeDate(row.created_at)
  };
}

function toInstantDate(value) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toStoredTimestampDate(value) {
  return parseStoredTimestamp(value);
}

function normalizeRecoveryDurationMs(payload) {
  const normalizedPayload = normalizeJsonObject(payload, {});
  const explicitDurationMs = Number(normalizedPayload.duration_ms);
  if (Number.isFinite(explicitDurationMs) && explicitDurationMs > 0) {
    return explicitDurationMs;
  }
  const durationMinutes = Number(normalizedPayload.duration_minutes);
  if (Number.isFinite(durationMinutes) && durationMinutes > 0) {
    return durationMinutes * 60 * 1000;
  }
  return 0;
}

function normalizeActiveRecoveryWindow(row, now) {
  const recoveryWindow = normalizeRecoveryWindow(row, now);
  return recoveryWindow?.active ? recoveryWindow : null;
}

function normalizeRecoveryWindow(row, now) {
  const occurredAt = toStoredTimestampDate(row?.occurred_at);
  const nowDate = toInstantDate(now) || new Date();
  const durationMs = normalizeRecoveryDurationMs(row?.payload);
  if (!occurredAt || durationMs <= 0) {
    return null;
  }
  const recoverUntil = new Date(occurredAt.getTime() + durationMs);
  const remainingMs = recoverUntil.getTime() - nowDate.getTime();
  const payload = normalizeJsonObject(row.payload, {});
  const eventId = normalizeBigIntString(row.id);
  return {
    active: remainingMs > 0,
    identityKey: row.identity_key,
    eventId,
    eventKind: row.event_kind,
    occurredAt: formatEast8IsoOffset(occurredAt),
    recoverUntil: formatEast8IsoOffset(recoverUntil),
    remainingMs: Math.max(0, remainingMs),
    durationMs,
    reason: normalizeOptionalString(payload.reason),
    traceId: row.trace_id || null,
    runId: row.run_id || null,
    continuationDedupeKey: eventId ? `self_continuation:recovery:${eventId}` : null
  };
}

function createAgentLifeEventPersistence({ getPrismaClient, createSqlAdapter }) {
  function getClient(config) {
    return getPrismaClient(config);
  }

  async function ensureAgentLifeEventSchema(config = {}) {
    const sql = createSqlAdapter(config);
    try {
      await sql.query("SELECT pg_advisory_lock(hashtext('qqbot_agent_life_events_schema'))");
      await sql.execute(`
        CREATE TABLE IF NOT EXISTS agent_life_events (
          id BIGSERIAL PRIMARY KEY,
          identity_key VARCHAR(191) NOT NULL,
          event_kind VARCHAR(64) NOT NULL,
          occurred_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          surface VARCHAR(64) NULL,
          chat_type VARCHAR(16) NULL,
          session_key VARCHAR(191) NULL,
          surface_id VARCHAR(191) NULL,
          peer_id VARCHAR(191) NULL,
          account_id VARCHAR(191) NULL,
          message_sid VARCHAR(191) NULL,
          message_id VARCHAR(128) NULL,
          batch_id VARCHAR(128) NULL,
          conversation_item_id BIGINT NULL,
          queue_message_id BIGINT NULL,
          run_id VARCHAR(128) NULL,
          trace_id VARCHAR(128) NULL,
          llm_call_id VARCHAR(128) NULL,
          source_action_id VARCHAR(128) NULL,
          actor_type VARCHAR(32) NOT NULL DEFAULT 'xiaoni',
          actor_id VARCHAR(191) NULL,
          target_id VARCHAR(191) NULL,
          visibility VARCHAR(32) NOT NULL,
          action_cost DOUBLE PRECISION NOT NULL DEFAULT 0,
          pressure_delta DOUBLE PRECISION NOT NULL DEFAULT 0,
          reward_delta DOUBLE PRECISION NOT NULL DEFAULT 0,
          boredom_delta DOUBLE PRECISION NOT NULL DEFAULT 0,
          attention_delta DOUBLE PRECISION NOT NULL DEFAULT 0,
          payload JSONB NOT NULL DEFAULT '{}'::jsonb,
          dedupe_key VARCHAR(255) NOT NULL UNIQUE,
          created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await sql.execute('ALTER TABLE agent_life_events ALTER COLUMN visibility DROP DEFAULT');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_agent_life_events_identity_time ON agent_life_events (identity_key, occurred_at DESC)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_agent_life_events_identity_time_id ON agent_life_events (identity_key, occurred_at DESC, id DESC)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_agent_life_events_session_time ON agent_life_events (session_key, occurred_at DESC)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_agent_life_events_peer_time ON agent_life_events (chat_type, peer_id, occurred_at DESC)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_agent_life_events_message_sid ON agent_life_events (message_sid)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_agent_life_events_run ON agent_life_events (run_id)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_agent_life_events_trace ON agent_life_events (trace_id)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_agent_life_events_kind_time ON agent_life_events (event_kind, occurred_at DESC)');
    } finally {
      await sql.query("SELECT pg_advisory_unlock(hashtext('qqbot_agent_life_events_schema'))").catch(() => undefined);
      await sql.close();
    }
  }

  async function findAgentLifeEventByDedupeKey(dedupeKey, config = {}) {
    const prisma = getClient(config);
    const normalizedDedupeKey = normalizeDedupeKey(dedupeKey);
    return normalizeLifeEvent(await prisma.agentLifeEvent.findUnique({
      where: { dedupe_key: normalizedDedupeKey }
    }));
  }

  async function recordAgentLifeEvent(input, config = {}) {
    const prisma = getClient(config);
    const dedupeKey = normalizeDedupeKey(input.dedupeKey || input.dedupe_key);
    const data = {
      identity_key: String(input.identityKey || input.identity_key || 'xiaoni'),
      event_kind: normalizeEventKind(input.eventKind || input.event_kind),
      occurred_at: normalizeTimestampInput(input.occurredAt || input.occurred_at || new Date()),
      surface: normalizeOptionalString(input.surface),
      chat_type: normalizeOptionalString(input.chatType || input.chat_type),
      session_key: normalizeOptionalString(input.sessionKey || input.session_key),
      surface_id: normalizeOptionalString(input.surfaceId || input.surface_id),
      peer_id: normalizeOptionalString(input.peerId || input.peer_id),
      account_id: normalizeOptionalString(input.accountId || input.account_id),
      message_sid: normalizeOptionalString(input.messageSid || input.message_sid),
      message_id: normalizeOptionalString(input.messageId || input.message_id),
      batch_id: normalizeOptionalString(input.batchId || input.batch_id),
      conversation_item_id: normalizeBigIntInput(input.conversationItemId || input.conversation_item_id),
      queue_message_id: normalizeBigIntInput(input.queueMessageId || input.queue_message_id),
      run_id: normalizeOptionalString(input.runId || input.run_id),
      trace_id: normalizeOptionalString(input.traceId || input.trace_id),
      llm_call_id: normalizeOptionalString(input.llmCallId || input.llm_call_id),
      source_action_id: normalizeOptionalString(input.sourceActionId || input.source_action_id),
      actor_type: normalizeOptionalString(input.actorType || input.actor_type) || 'xiaoni',
      actor_id: normalizeOptionalString(input.actorId || input.actor_id),
      target_id: normalizeOptionalString(input.targetId || input.target_id),
      visibility: normalizeVisibility(input.visibility),
      action_cost: normalizeNumber(input.actionCost || input.action_cost),
      pressure_delta: normalizeNumber(input.pressureDelta || input.pressure_delta),
      reward_delta: normalizeNumber(input.rewardDelta || input.reward_delta),
      boredom_delta: normalizeNumber(input.boredomDelta || input.boredom_delta),
      attention_delta: normalizeNumber(input.attentionDelta || input.attention_delta),
      payload: normalizeJsonObject(input.payload),
      dedupe_key: dedupeKey
    };

    try {
      return normalizeLifeEvent(await prisma.agentLifeEvent.create({ data }));
    } catch (error) {
      if (error?.code !== 'P2002') {
        throw error;
      }
      return findAgentLifeEventByDedupeKey(dedupeKey, config);
    }
  }

  async function listAgentLifeEvents(input = {}, config = {}) {
    const prisma = getClient(config);
    const where = {
      identity_key: String(input.identityKey || input.identity_key || 'xiaoni')
    };
    const sessionKey = normalizeOptionalString(input.sessionKey || input.session_key);
    const runId = normalizeOptionalString(input.runId || input.run_id);
    const traceId = normalizeOptionalString(input.traceId || input.trace_id);
    const eventKind = normalizeOptionalString(input.eventKind || input.event_kind);
    const visibility = normalizeOptionalString(input.visibility);
    if (sessionKey) where.session_key = sessionKey;
    if (runId) where.run_id = runId;
    if (traceId) where.trace_id = traceId;
    if (eventKind) where.event_kind = eventKind;
    if (visibility) where.visibility = visibility;
    const occurredAfter = normalizeTimestampInput(input.occurredAfter || input.occurred_after);
    const occurredBefore = normalizeTimestampInput(input.occurredBefore || input.occurred_before);
    const afterEventId = normalizeBigIntInput(input.afterEventId || input.after_event_id);
    if (occurredAfter && afterEventId) {
      const seekFilter = {
        OR: [
          { occurred_at: { gt: occurredAfter } },
          {
            occurred_at: occurredAfter,
            id: { gt: afterEventId }
          }
        ]
      };
      if (occurredBefore) {
        where.AND = [
          seekFilter,
          { occurred_at: { lte: occurredBefore } }
        ];
      } else {
        where.OR = seekFilter.OR;
      }
    } else if (occurredAfter || occurredBefore) {
      where.occurred_at = {};
      if (occurredAfter) {
        where.occurred_at.gte = occurredAfter;
      }
      if (occurredBefore) {
        where.occurred_at.lte = occurredBefore;
      }
    }
    const chronological = input.chronological === true || input.order === 'asc';
    const rows = await prisma.agentLifeEvent.findMany({
      where,
      orderBy: chronological
        ? [{ occurred_at: 'asc' }, { id: 'asc' }]
        : [{ occurred_at: 'desc' }, { id: 'desc' }],
      take: Math.max(1, Math.min(Number(input.limit || 100), 1000))
    });
    const normalized = rows.map(normalizeLifeEvent).filter(Boolean);
    return chronological ? normalized : normalized.reverse();
  }

  async function listAgentLifeEventsForPrompt(input = {}, config = {}) {
    const prisma = getClient(config);
    const identityKey = String(input.identityKey || input.identity_key || 'xiaoni');
    const activeSessionKey = normalizeOptionalString(input.activeSessionKey || input.active_session_key || input.sessionKey || input.session_key);
    const limit = Math.max(1, Math.min(Number(input.limit || 320), 1000));
    const globalVisibilities = ['public_residue', 'self_private'];
    const activeSurfaceVisibilities = ['active_surface', 'private_surface', 'public_residue', 'self_private'];
    const where = {
      identity_key: identityKey,
      visibility: { not: 'operator_only' }
    };
    if (activeSessionKey) {
      where.OR = [
        {
          session_key: activeSessionKey,
          visibility: { in: activeSurfaceVisibilities }
        },
        {
          visibility: { in: globalVisibilities }
        }
      ];
    } else {
      where.visibility = { in: globalVisibilities };
    }
    const rows = await prisma.agentLifeEvent.findMany({
      where,
      orderBy: [{ occurred_at: 'desc' }, { id: 'desc' }],
      take: limit
    });
    return rows.map(normalizeLifeEvent).filter(Boolean).reverse();
  }

  async function getActiveAgentRecoveryWindow(input = {}, config = {}) {
    const prisma = getClient(config);
    const identityKey = String(input.identityKey || input.identity_key || 'xiaoni');
    const now = toInstantDate(input.now) || new Date();
    const rows = await prisma.agentLifeEvent.findMany({
      where: {
        identity_key: identityKey,
        event_kind: { in: ['rest_period', 'sleep_period'] }
      },
      orderBy: [{ occurred_at: 'desc' }, { id: 'desc' }],
      take: Math.max(1, Math.min(Number(input.limit || 20), 100))
    });
    for (const row of rows) {
      const activeWindow = normalizeActiveRecoveryWindow(row, now);
      if (activeWindow) {
        return activeWindow;
      }
    }
    return null;
  }

  async function getLatestAgentRecoveryWindow(input = {}, config = {}) {
    const prisma = getClient(config);
    const identityKey = String(input.identityKey || input.identity_key || 'xiaoni');
    const now = toInstantDate(input.now) || new Date();
    const rows = await prisma.agentLifeEvent.findMany({
      where: {
        identity_key: identityKey,
        event_kind: { in: ['rest_period', 'sleep_period'] }
      },
      orderBy: [{ occurred_at: 'desc' }, { id: 'desc' }],
      take: Math.max(1, Math.min(Number(input.limit || 20), 100))
    });
    for (const row of rows) {
      const recoveryWindow = normalizeRecoveryWindow(row, now);
      if (!recoveryWindow) {
        continue;
      }
      let continuationQueued = false;
      if (recoveryWindow.continuationDedupeKey && prisma.agentQueueMessage?.findUnique) {
        const existingQueueMessage = await prisma.agentQueueMessage.findUnique({
          where: { dedupe_key: recoveryWindow.continuationDedupeKey },
          select: { id: true, status: true }
        });
        continuationQueued = Boolean(existingQueueMessage);
      }
      return {
        ...recoveryWindow,
        continuationQueued
      };
    }
    return null;
  }

  return {
    ensureAgentLifeEventSchema,
    recordAgentLifeEvent,
    listAgentLifeEvents,
    listAgentLifeEventsForPrompt,
    getActiveAgentRecoveryWindow,
    getLatestAgentRecoveryWindow,
    findAgentLifeEventByDedupeKey
  };
}

module.exports = {
  B1_EVENT_KINDS,
  LIFE_EVENT_VISIBILITIES,
  createAgentLifeEventPersistence
};
