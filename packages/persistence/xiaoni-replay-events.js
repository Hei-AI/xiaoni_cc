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

function normalizeValue(value) {
  if (value === null || typeof value === 'undefined') {
    return value;
  }
  if (typeof value === 'bigint') {
    return String(value);
  }
  if (value instanceof Date) {
    return normalizeDate(value);
  }
  if (Array.isArray(value)) {
    return value.map(normalizeValue);
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, normalizeValue(entry)])
    );
  }
  return value;
}

function normalizeJsonObject(value, fallback = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return normalizeValue(value);
  }
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? normalizeValue(parsed)
        : fallback;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function normalizeBigIntId(value) {
  if (value === null || typeof value === 'undefined' || value === '') {
    return null;
  }
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function normalizeReplayEventRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id === null || typeof row.id === 'undefined' ? null : String(row.id),
    eventId: row.event_id,
    identityKey: row.identity_key,
    eventKind: row.event_kind,
    source: row.source,
    occurredAt: normalizeDate(row.occurred_at),
    traceId: row.trace_id || null,
    conversationId: row.conversation_id === null || typeof row.conversation_id === 'undefined'
      ? null
      : String(row.conversation_id),
    internalExecutionLeaseId: row.internal_execution_lease_id || null,
    providerCallId: row.provider_call_id || null,
    toolCallId: row.tool_call_id || null,
    modelName: row.model_name || null,
    modelProvider: row.model_provider || null,
    status: row.status || null,
    replayable: Boolean(row.replayable),
    replayPayload: normalizeJsonObject(row.replay_payload, {}),
    wireRequest: normalizeJsonObject(row.wire_request, null),
    wireResponse: normalizeJsonObject(row.wire_response, null),
    metadata: normalizeJsonObject(row.metadata, {}),
    sourceTable: row.source_table || null,
    sourceId: row.source_id || null,
    createdAt: normalizeDate(row.created_at),
    updatedAt: normalizeDate(row.updated_at)
  };
}

function createXiaoniReplayEventPersistence({ createSqlAdapter }) {
  async function ensureXiaoniReplayEventSchema(config = {}) {
    const sql = createSqlAdapter(config);
    const statements = [
      `
        CREATE TABLE IF NOT EXISTS xiaoni_replay_events (
          id BIGSERIAL PRIMARY KEY,
          event_id VARCHAR(191) NOT NULL UNIQUE,
          identity_key VARCHAR(191) NOT NULL DEFAULT 'xiaoni',
          event_kind VARCHAR(64) NOT NULL,
          source VARCHAR(64) NOT NULL,
          occurred_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          trace_id VARCHAR(128),
          conversation_id BIGINT,
          internal_execution_lease_id VARCHAR(128),
          provider_call_id VARCHAR(128),
          tool_call_id VARCHAR(128),
          model_name VARCHAR(191),
          model_provider VARCHAR(64),
          status VARCHAR(32),
          replayable BOOLEAN NOT NULL DEFAULT FALSE,
          replay_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
          wire_request JSONB,
          wire_response JSONB,
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          source_table VARCHAR(128),
          source_id VARCHAR(191),
          created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `,
      'CREATE INDEX IF NOT EXISTS idx_xiaoni_replay_events_identity_time ON xiaoni_replay_events (identity_key, occurred_at DESC, id DESC)',
      'CREATE INDEX IF NOT EXISTS idx_xiaoni_replay_events_trace ON xiaoni_replay_events (trace_id)',
      'CREATE INDEX IF NOT EXISTS idx_xiaoni_replay_events_conversation ON xiaoni_replay_events (conversation_id)',
      'CREATE INDEX IF NOT EXISTS idx_xiaoni_replay_events_provider_call ON xiaoni_replay_events (provider_call_id)',
      'CREATE INDEX IF NOT EXISTS idx_xiaoni_replay_events_lease ON xiaoni_replay_events (internal_execution_lease_id)',
      'CREATE UNIQUE INDEX IF NOT EXISTS uniq_xiaoni_replay_events_source_ref ON xiaoni_replay_events (source_table, source_id) WHERE source_table IS NOT NULL AND source_id IS NOT NULL'
    ];
    try {
      for (const statement of statements) {
        await sql.execute(statement);
      }
    } finally {
      await sql.close();
    }
  }

  async function recordXiaoniReplayEvent(input = {}, config = {}) {
    const eventId = firstString(input.eventId, input.event_id);
    const eventKind = firstString(input.eventKind, input.event_kind);
    const source = firstString(input.source);
    if (!eventId || !eventKind || !source) {
      throw new Error('recordXiaoniReplayEvent requires eventId, eventKind, and source');
    }

    await ensureXiaoniReplayEventSchema(config);
    const sql = createSqlAdapter(config);
    try {
      const rows = await sql.query(
        `
          INSERT INTO xiaoni_replay_events (
            event_id,
            identity_key,
            event_kind,
            source,
            occurred_at,
            trace_id,
            conversation_id,
            internal_execution_lease_id,
            provider_call_id,
            tool_call_id,
            model_name,
            model_provider,
            status,
            replayable,
            replay_payload,
            wire_request,
            wire_response,
            metadata,
            source_table,
            source_id
          )
          VALUES (?, ?, ?, ?, COALESCE(?::timestamp, CURRENT_TIMESTAMP), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?::jsonb, ?::jsonb, ?::jsonb, ?, ?)
          ON CONFLICT (event_id) DO UPDATE SET
            identity_key = EXCLUDED.identity_key,
            event_kind = EXCLUDED.event_kind,
            source = EXCLUDED.source,
            occurred_at = EXCLUDED.occurred_at,
            trace_id = EXCLUDED.trace_id,
            conversation_id = EXCLUDED.conversation_id,
            internal_execution_lease_id = EXCLUDED.internal_execution_lease_id,
            provider_call_id = EXCLUDED.provider_call_id,
            tool_call_id = EXCLUDED.tool_call_id,
            model_name = EXCLUDED.model_name,
            model_provider = EXCLUDED.model_provider,
            status = EXCLUDED.status,
            replayable = EXCLUDED.replayable,
            replay_payload = EXCLUDED.replay_payload,
            wire_request = EXCLUDED.wire_request,
            wire_response = EXCLUDED.wire_response,
            metadata = EXCLUDED.metadata,
            source_table = EXCLUDED.source_table,
            source_id = EXCLUDED.source_id,
            updated_at = CURRENT_TIMESTAMP
          RETURNING *
        `,
        [
          eventId,
          firstString(input.identityKey, input.identity_key, 'xiaoni'),
          eventKind,
          source,
          normalizeDate(input.occurredAt || input.occurred_at),
          firstString(input.traceId, input.trace_id),
          normalizeBigIntId(input.conversationId ?? input.conversation_id),
          firstString(input.internalExecutionLeaseId, input.internal_execution_lease_id, input.runId, input.run_id),
          firstString(input.providerCallId, input.provider_call_id),
          firstString(input.toolCallId, input.tool_call_id),
          firstString(input.modelName, input.model_name),
          firstString(input.modelProvider, input.model_provider),
          firstString(input.status),
          Boolean(input.replayable),
          JSON.stringify(normalizeJsonObject(input.replayPayload ?? input.replay_payload, {})),
          input.wireRequest || input.wire_request ? JSON.stringify(normalizeValue(input.wireRequest ?? input.wire_request)) : null,
          input.wireResponse || input.wire_response ? JSON.stringify(normalizeValue(input.wireResponse ?? input.wire_response)) : null,
          JSON.stringify(normalizeJsonObject(input.metadata, {})),
          firstString(input.sourceTable, input.source_table),
          firstString(input.sourceId, input.source_id)
        ]
      );
      return normalizeReplayEventRow(rows[0]);
    } finally {
      await sql.close();
    }
  }

  async function listXiaoniReplayEvents(input = {}, config = {}) {
    await ensureXiaoniReplayEventSchema(config);
    const sql = createSqlAdapter(config);
    const identityKey = firstString(input.identityKey, input.identity_key, 'xiaoni');
    const limit = Math.max(1, Math.min(Number.parseInt(String(input.limit || 80), 10) || 80, 500));
    const replayableOnly = input.replayableOnly ?? input.replayable_only;
    const eventKind = firstString(input.eventKind, input.event_kind);
    const source = firstString(input.source);
    const conversationId = normalizeBigIntId(input.conversationId ?? input.conversation_id);
    const traceId = firstString(input.traceId, input.trace_id);
    const providerCallId = firstString(input.providerCallId, input.provider_call_id);
    const clauses = ['identity_key = ?'];
    const params = [identityKey];
    if (typeof replayableOnly === 'boolean') {
      clauses.push('replayable = ?');
      params.push(replayableOnly);
    }
    if (eventKind) {
      clauses.push('event_kind = ?');
      params.push(eventKind);
    }
    if (source) {
      clauses.push('source = ?');
      params.push(source);
    }
    if (conversationId !== null) {
      clauses.push('conversation_id = ?');
      params.push(conversationId);
    }
    if (traceId) {
      clauses.push('trace_id = ?');
      params.push(traceId);
    }
    if (providerCallId) {
      clauses.push('provider_call_id = ?');
      params.push(providerCallId);
    }
    params.push(limit);

    try {
      const rows = await sql.query(
        `
          SELECT *
          FROM xiaoni_replay_events
          WHERE ${clauses.join(' AND ')}
          ORDER BY occurred_at DESC, id DESC
          LIMIT ?
        `,
        params
      );
      return rows.map(normalizeReplayEventRow).filter(Boolean);
    } finally {
      await sql.close();
    }
  }

  async function findXiaoniReplayEventByEventId(eventId, config = {}) {
    if (typeof eventId !== 'string' || !eventId.trim()) {
      return null;
    }
    await ensureXiaoniReplayEventSchema(config);
    const sql = createSqlAdapter(config);
    try {
      const rows = await sql.query(
        'SELECT * FROM xiaoni_replay_events WHERE event_id = ? LIMIT 1',
        [eventId.trim()]
      );
      return normalizeReplayEventRow(rows[0]);
    } finally {
      await sql.close();
    }
  }

  async function attachConversationIdToXiaoniReplayEventsByTrace(input = {}, config = {}) {
    const traceId = firstString(input.traceId, input.trace_id);
    const conversationId = normalizeBigIntId(input.conversationId ?? input.conversation_id);
    if (!traceId || conversationId === null) {
      return 0;
    }

    await ensureXiaoniReplayEventSchema(config);
    const sql = createSqlAdapter(config);
    try {
      const rows = await sql.query(
        `
          UPDATE xiaoni_replay_events
          SET conversation_id = ?
          WHERE trace_id = ? AND conversation_id IS NULL
          RETURNING id
        `,
        [conversationId, traceId]
      );
      return rows.length;
    } finally {
      await sql.close();
    }
  }

  return {
    ensureXiaoniReplayEventSchema,
    recordXiaoniReplayEvent,
    listXiaoniReplayEvents,
    findXiaoniReplayEventByEventId,
    attachConversationIdToXiaoniReplayEventsByTrace
  };
}

module.exports = {
  createXiaoniReplayEventPersistence
};
