'use strict';

const { serializeTimestampForStorage } = require('./time');

function normalizeDate(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return typeof value === 'string' ? value : String(value);
}

function hasExplicitTimezone(value) {
  return /(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(value.trim());
}

function normalizeTimestampParam(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return serializeTimestampForStorage(value);
  }
  if (typeof value === 'string' && hasExplicitTimezone(value)) {
    return serializeTimestampForStorage(value);
  }
  return typeof value === 'string' ? value : String(value);
}

function normalizeJsonObject(value, fallback = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
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

function normalizeNumber(value, fallback = null) {
  if (value === null || typeof value === 'undefined') {
    return fallback;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeInteger(value, fallback = null) {
  const numeric = normalizeNumber(value, fallback);
  return numeric === null ? null : Math.round(numeric);
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

function parseDateMs(value) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(String(value));
  const ms = date.getTime();
  return Number.isFinite(ms) ? ms : null;
}

function normalizePositiveInteger(value, fallback) {
  const parsed = normalizeInteger(value, fallback);
  return parsed && parsed > 0 ? parsed : fallback;
}

function dateAfterMs(value, ms) {
  const baseMs = parseDateMs(value);
  if (baseMs === null) {
    return null;
  }
  return new Date(baseMs + ms).toISOString();
}

function cacheHeartbeatMetadataFrom(metadata) {
  return normalizeJsonObject(metadata.cache_heartbeat || metadata.cacheHeartbeat, {});
}

function cacheHeartbeatProjection(metadata = {}) {
  const heartbeat = cacheHeartbeatMetadataFrom(metadata);
  return {
    intervalMs: normalizeInteger(heartbeat.interval_ms ?? heartbeat.intervalMs),
    nextDueAt: normalizeDate(heartbeat.next_due_at ?? heartbeat.nextDueAt),
    lastClaimedAt: normalizeDate(heartbeat.last_claimed_at ?? heartbeat.lastClaimedAt),
    inFlightStartedAt: normalizeDate(heartbeat.in_flight_started_at ?? heartbeat.inFlightStartedAt),
    lastStartedAt: normalizeDate(heartbeat.last_started_at ?? heartbeat.lastStartedAt),
    lastCompletedAt: normalizeDate(heartbeat.last_completed_at ?? heartbeat.lastCompletedAt),
    lastStatus: firstString(heartbeat.last_status, heartbeat.lastStatus),
    lastEventId: firstString(heartbeat.last_event_id, heartbeat.lastEventId),
    lastLlmCallId: firstString(heartbeat.last_llm_call_id, heartbeat.lastLlmCallId),
    lastError: firstString(heartbeat.last_error, heartbeat.lastError),
    claimCount: normalizeInteger(heartbeat.claim_count ?? heartbeat.claimCount, 0) || 0
  };
}

function mergeCacheHeartbeatMetadata(metadata, patch) {
  const normalized = normalizeJsonObject(metadata, {});
  const current = cacheHeartbeatMetadataFrom(normalized);
  return {
    ...normalized,
    cache_heartbeat: {
      ...current,
      ...patch
    }
  };
}

function normalizeRecoverySessionRow(row) {
  if (!row) {
    return null;
  }
  const metadata = normalizeJsonObject(row.metadata, {});
  return {
    id: Number(row.id),
    identityKey: row.identity_key,
    initiator: row.initiator,
    status: row.status,
    wakeCause: row.wake_cause,
    reason: row.reason,
    xiaoniOs: row.xiaoni_os,
    clockMinutes: normalizeInteger(row.clock_minutes),
    clockDueAt: normalizeDate(row.clock_due_at),
    clockFiredAt: normalizeDate(row.clock_fired_at),
    clockDeferredAt: normalizeDate(row.clock_deferred_at),
    startedAt: normalizeDate(row.started_at),
    endedAt: normalizeDate(row.ended_at),
    lastCheckedAt: normalizeDate(row.last_checked_at),
    toolExecutionId: row.tool_execution_id,
    llmRequestSliceId: row.llm_request_slice_id,
    llmCallId: row.llm_call_id,
    toolCallId: row.tool_call_id,
    traceId: row.trace_id,
    runId: row.run_id,
    conversationId: row.conversation_id === null || typeof row.conversation_id === 'undefined' ? null : Number(row.conversation_id),
    queueMessageId: row.queue_message_id,
    wakeCountStartQueueMessageId: row.wake_count_start_queue_message_id === null || typeof row.wake_count_start_queue_message_id === 'undefined' ? null : Number(row.wake_count_start_queue_message_id),
    lastWakeCountedQueueMessageId: row.last_wake_counted_queue_message_id === null || typeof row.last_wake_counted_queue_message_id === 'undefined' ? null : Number(row.last_wake_counted_queue_message_id),
    wakeCallCount: normalizeInteger(row.wake_call_count, 0),
    wakeRequiredCount: normalizeInteger(row.wake_required_count),
    startPressure: normalizeNumber(row.start_pressure),
    currentPressure: normalizeNumber(row.current_pressure),
    startEnergy: normalizeNumber(row.start_energy),
    currentEnergy: normalizeNumber(row.current_energy),
    maxEnergy: normalizeNumber(row.max_energy, 1),
    plannedNaturalWakeAt: normalizeDate(row.planned_natural_wake_at),
    hardWakeAt: normalizeDate(row.hard_wake_at),
    result: normalizeJsonObject(row.result, {}),
    metadata,
    cacheHeartbeat: cacheHeartbeatProjection(metadata),
    createdAt: normalizeDate(row.created_at),
    updatedAt: normalizeDate(row.updated_at)
  };
}

function normalizeWakeNotificationRow(row) {
  const payload = normalizeJsonObject(row.payload, {});
  const rawPayload = normalizeJsonObject(row.raw_payload, {});
  const phoneNotification = normalizeJsonObject(payload.phoneNotification || payload.phone_notification, {});
  const directMentions = normalizeNumber(
    phoneNotification.directMentions ?? phoneNotification.direct_mentions ?? rawPayload.directMentions ?? rawPayload.direct_mentions,
    0
  ) || 0;
  const chatType = row.chat_type === 'group' ? 'group' : 'direct';
  return {
    id: Number(row.id),
    chatType,
    sessionKey: row.session_key,
    peerId: row.peer_id,
    createdAt: normalizeDate(row.created_at),
    payload,
    rawPayload,
    wakeCount: chatType === 'direct' ? 1 : Math.max(0, Math.floor(directMentions))
  };
}

function createAgentRecoverySessionPersistence({ createSqlAdapter, sqlAdapter } = {}) {
  let schemaEnsured = false;

  function createSql(input = {}, config = {}) {
    if (input?.sqlAdapter) {
      return { sql: input.sqlAdapter, shouldClose: false };
    }
    if (sqlAdapter) {
      return { sql: sqlAdapter, shouldClose: false };
    }
    if (typeof createSqlAdapter !== 'function') {
      throw new Error('agent recovery session SQL operations require createSqlAdapter');
    }
    return { sql: createSqlAdapter(config), shouldClose: true };
  }

  async function withSql(input, config, callback) {
    const { sql, shouldClose } = createSql(input, config);
    try {
      return await callback(sql);
    } finally {
      if (shouldClose) {
        await sql.close();
      }
    }
  }

  async function ensureAgentRecoverySessionSchema(input = {}, config = {}) {
    if (schemaEnsured) {
      return;
    }
    return withSql(input, config, async (sql) => {
      await sql.query("SELECT pg_advisory_lock(hashtext('qqbot_agent_recovery_sessions_schema'))");
      try {
        await sql.execute(`
          CREATE TABLE IF NOT EXISTS agent_recovery_sessions (
            id BIGSERIAL PRIMARY KEY,
            identity_key VARCHAR(191) NOT NULL DEFAULT 'xiaoni',
            initiator VARCHAR(32) NOT NULL,
            status VARCHAR(32) NOT NULL DEFAULT 'active',
            wake_cause VARCHAR(64),
            reason TEXT,
            xiaoni_os TEXT,
            clock_minutes INTEGER,
            clock_due_at TIMESTAMPTZ(3),
            clock_fired_at TIMESTAMPTZ(3),
            clock_deferred_at TIMESTAMPTZ(3),
            started_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            ended_at TIMESTAMPTZ(3),
            last_checked_at TIMESTAMPTZ(3),
            tool_execution_id VARCHAR(191),
            llm_request_slice_id VARCHAR(191),
            llm_call_id VARCHAR(128),
            tool_call_id VARCHAR(191),
            trace_id VARCHAR(128),
            run_id VARCHAR(128),
            conversation_id BIGINT,
            queue_message_id VARCHAR(128),
            wake_count_start_queue_message_id BIGINT,
            last_wake_counted_queue_message_id BIGINT,
            wake_call_count INTEGER NOT NULL DEFAULT 0,
            wake_required_count INTEGER,
            start_pressure DOUBLE PRECISION,
            current_pressure DOUBLE PRECISION,
            start_energy DOUBLE PRECISION,
            current_energy DOUBLE PRECISION,
            max_energy DOUBLE PRECISION NOT NULL DEFAULT 1,
            planned_natural_wake_at TIMESTAMPTZ(3),
            hard_wake_at TIMESTAMPTZ(3),
            result JSONB NOT NULL DEFAULT '{}'::jsonb,
            metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `);
        await sql.execute("CREATE UNIQUE INDEX IF NOT EXISTS uniq_agent_recovery_sessions_active_identity ON agent_recovery_sessions (identity_key) WHERE status = 'active'");
        await sql.execute("CREATE UNIQUE INDEX IF NOT EXISTS uniq_agent_recovery_sessions_tool_execution ON agent_recovery_sessions (tool_execution_id) WHERE tool_execution_id IS NOT NULL");
        await sql.execute("CREATE INDEX IF NOT EXISTS idx_agent_recovery_sessions_status_due ON agent_recovery_sessions (status, hard_wake_at, id)");
        await sql.execute("CREATE INDEX IF NOT EXISTS idx_agent_recovery_sessions_tool_call ON agent_recovery_sessions (tool_call_id) WHERE tool_call_id IS NOT NULL");
        await sql.execute("CREATE INDEX IF NOT EXISTS idx_agent_queue_phone_notification_source_id ON agent_queue_messages (source, id)");
        schemaEnsured = true;
      } finally {
        await sql.query("SELECT pg_advisory_unlock(hashtext('qqbot_agent_recovery_sessions_schema'))").catch(() => undefined);
      }
    });
  }

  async function getAgentRecoveryQueueHighWatermark(input = {}, config = {}) {
    await ensureAgentRecoverySessionSchema(input, config);
    return withSql(input, config, async (sql) => {
      const rows = await sql.query("SELECT COALESCE(MAX(id), 0) AS id FROM agent_queue_messages WHERE source = 'phone_notification'");
      return Number(rows[0]?.id || 0);
    });
  }

  async function createAgentRecoverySession(input = {}, config = {}) {
    await ensureAgentRecoverySessionSchema(input, config);
    return withSql(input, config, async (sql) => {
      const createWithExecutor = async (executor) => {
        const watermarkRows = await executor.query("SELECT COALESCE(MAX(id), 0) AS id FROM agent_queue_messages WHERE source = 'phone_notification'");
        const wakeStartId = normalizeBigIntId(input.wakeCountStartQueueMessageId ?? input.wake_count_start_queue_message_id ?? watermarkRows[0]?.id ?? 0);
        const startedAt = input.startedAt || input.started_at || new Date();
        const rows = await executor.query(
          `
            INSERT INTO agent_recovery_sessions (
              identity_key,
              initiator,
              status,
              reason,
              xiaoni_os,
              clock_minutes,
              clock_due_at,
              started_at,
              tool_execution_id,
              llm_request_slice_id,
              llm_call_id,
              tool_call_id,
              trace_id,
              run_id,
              conversation_id,
              queue_message_id,
              wake_count_start_queue_message_id,
              last_wake_counted_queue_message_id,
              wake_call_count,
              wake_required_count,
              start_pressure,
              current_pressure,
              start_energy,
              current_energy,
              max_energy,
              planned_natural_wake_at,
              hard_wake_at,
              metadata
            )
            VALUES (?, ?, 'active', ?, ?, ?, ?::timestamptz, ?::timestamptz, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::timestamptz, ?::timestamptz, ?::jsonb)
            RETURNING *
          `,
          [
            firstString(input.identityKey, input.identity_key, 'xiaoni'),
            firstString(input.initiator, 'recover_energy_tool'),
            firstString(input.reason),
            firstString(input.xiaoniOs, input.xiaoni_os),
            normalizeInteger(input.clockMinutes ?? input.clock_minutes),
            normalizeTimestampParam(input.clockDueAt || input.clock_due_at),
            normalizeTimestampParam(startedAt),
            firstString(input.toolExecutionId, input.tool_execution_id),
            firstString(input.llmRequestSliceId, input.llm_request_slice_id),
            firstString(input.llmCallId, input.llm_call_id),
            firstString(input.toolCallId, input.tool_call_id),
            firstString(input.traceId, input.trace_id),
            firstString(input.runId, input.run_id),
            normalizeBigIntId(input.conversationId ?? input.conversation_id),
            firstString(input.queueMessageId, input.queue_message_id),
            wakeStartId,
            wakeStartId,
            normalizeInteger(input.wakeCallCount ?? input.wake_call_count, 0),
            normalizeInteger(input.wakeRequiredCount ?? input.wake_required_count),
            normalizeNumber(input.startPressure ?? input.start_pressure),
            normalizeNumber(input.currentPressure ?? input.current_pressure ?? input.startPressure ?? input.start_pressure),
            normalizeNumber(input.startEnergy ?? input.start_energy),
            normalizeNumber(input.currentEnergy ?? input.current_energy ?? input.startEnergy ?? input.start_energy),
            normalizeNumber(input.maxEnergy ?? input.max_energy, 1),
            normalizeTimestampParam(input.plannedNaturalWakeAt || input.planned_natural_wake_at),
            normalizeTimestampParam(input.hardWakeAt || input.hard_wake_at),
            JSON.stringify(normalizeJsonObject(input.metadata, {}))
          ]
        );
        return normalizeRecoverySessionRow(rows[0]);
      };
      if (typeof sql.withTransaction === 'function') {
        return sql.withTransaction(createWithExecutor);
      }
      return createWithExecutor(sql);
    });
  }

  async function getActiveAgentRecoverySession(input = {}, config = {}) {
    await ensureAgentRecoverySessionSchema(input, config);
    return withSql(input, config, async (sql) => {
      const rows = await sql.query(
        `
          SELECT *
          FROM agent_recovery_sessions
          WHERE identity_key = ?
            AND status = 'active'
          ORDER BY started_at ASC, id ASC
          LIMIT 1
        `,
        [firstString(input.identityKey, input.identity_key, 'xiaoni')]
      );
      return normalizeRecoverySessionRow(rows[0]);
    });
  }

  async function listAgentRecoverySessions(input = {}, config = {}) {
    await ensureAgentRecoverySessionSchema(input, config);
    const identityKey = firstString(input.identityKey, input.identity_key, 'xiaoni');
    const status = firstString(input.status);
    const limit = Math.max(1, Math.min(normalizeInteger(input.limit, 30) || 30, 100));
    const where = ['identity_key = ?'];
    const params = [identityKey];
    if (status && status !== 'all') {
      where.push('status = ?');
      params.push(status);
    }
    params.push(limit);
    return withSql(input, config, async (sql) => {
      const rows = await sql.query(
        `
          SELECT *
          FROM agent_recovery_sessions
          WHERE ${where.join(' AND ')}
          ORDER BY started_at DESC, id DESC
          LIMIT ?
        `,
        params
      );
      return rows.map(normalizeRecoverySessionRow);
    });
  }

  async function listAgentRecoveryWakeNotifications(input = {}, config = {}) {
    await ensureAgentRecoverySessionSchema(input, config);
    const afterId = normalizeBigIntId(input.afterQueueMessageId ?? input.after_queue_message_id ?? 0) || 0n;
    const limit = Math.max(1, Math.min(normalizeInteger(input.limit, 100) || 100, 1000));
    return withSql(input, config, async (sql) => {
      const rows = await sql.query(
        `
          SELECT id, chat_type, session_key, peer_id, payload, raw_payload, created_at
          FROM agent_queue_messages
          WHERE source = 'phone_notification'
            AND id > ?
          ORDER BY id ASC
          LIMIT ?
        `,
        [afterId, limit]
      );
      return rows.map(normalizeWakeNotificationRow);
    });
  }

  async function updateAgentRecoverySessionProgress(input = {}, config = {}) {
    const id = normalizeBigIntId(input.id);
    if (!id) {
      return null;
    }
    await ensureAgentRecoverySessionSchema(input, config);
    return withSql(input, config, async (sql) => {
      const rows = await sql.query(
        `
          UPDATE agent_recovery_sessions
          SET wake_call_count = ?,
              wake_required_count = ?,
              last_wake_counted_queue_message_id = COALESCE(?, last_wake_counted_queue_message_id),
              current_pressure = ?,
              current_energy = ?,
              planned_natural_wake_at = COALESCE(?::timestamptz, planned_natural_wake_at),
              hard_wake_at = COALESCE(?::timestamptz, hard_wake_at),
              clock_deferred_at = COALESCE(clock_deferred_at, ?::timestamptz),
              last_checked_at = COALESCE(?::timestamptz, CURRENT_TIMESTAMP),
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
          RETURNING *
        `,
        [
          normalizeInteger(input.wakeCallCount ?? input.wake_call_count, 0),
          normalizeInteger(input.wakeRequiredCount ?? input.wake_required_count),
          normalizeBigIntId(input.lastWakeCountedQueueMessageId ?? input.last_wake_counted_queue_message_id),
          normalizeNumber(input.currentPressure ?? input.current_pressure),
          normalizeNumber(input.currentEnergy ?? input.current_energy),
          normalizeTimestampParam(input.plannedNaturalWakeAt || input.planned_natural_wake_at),
          normalizeTimestampParam(input.hardWakeAt || input.hard_wake_at),
          normalizeTimestampParam(input.clockDeferredAt || input.clock_deferred_at),
          normalizeTimestampParam(input.lastCheckedAt || input.last_checked_at),
          id
        ]
      );
      return normalizeRecoverySessionRow(rows[0]);
    });
  }

  async function claimAgentRecoveryCacheHeartbeat(input = {}, config = {}) {
    const id = normalizeBigIntId(input.id);
    if (!id) {
      return {
        claimed: false,
        reason: 'invalid_session_id',
        session: null,
        nextDueAt: null
      };
    }
    await ensureAgentRecoverySessionSchema(input, config);
    const intervalMs = Math.max(60_000, normalizePositiveInteger(input.intervalMs ?? input.interval_ms, 5 * 60_000));
    const inFlightStaleMs = Math.max(15_000, normalizePositiveInteger(input.inFlightStaleMs ?? input.in_flight_stale_ms, Math.min(intervalMs, 60_000)));
    const now = input.now || new Date();
    const nowMs = parseDateMs(now) || Date.now();
    const nowIso = new Date(nowMs).toISOString();
    return withSql(input, config, async (sql) => {
      const claimWithExecutor = async (executor) => {
        const rows = await executor.query(
          `
            SELECT *
            FROM agent_recovery_sessions
            WHERE id = ?
              AND status = 'active'
            FOR UPDATE
          `,
          [id]
        );
        const row = rows[0];
        if (!row) {
          return {
            claimed: false,
            reason: 'inactive_or_missing',
            session: null,
            nextDueAt: null
          };
        }

        const metadata = normalizeJsonObject(row.metadata, {});
        const heartbeat = cacheHeartbeatMetadataFrom(metadata);
        const nextDueAt = normalizeDate(heartbeat.next_due_at ?? heartbeat.nextDueAt);
        const nextDueMs = parseDateMs(nextDueAt);
        const inFlightStartedAt = normalizeDate(heartbeat.in_flight_started_at ?? heartbeat.inFlightStartedAt);
        const inFlightStartedMs = parseDateMs(inFlightStartedAt);
        if (inFlightStartedMs !== null && nowMs - inFlightStartedMs < inFlightStaleMs) {
          return {
            claimed: false,
            reason: 'in_flight',
            session: normalizeRecoverySessionRow(row),
            nextDueAt,
            inFlightStartedAt
          };
        }
        if (nextDueMs !== null && nowMs < nextDueMs) {
          return {
            claimed: false,
            reason: 'not_due',
            session: normalizeRecoverySessionRow(row),
            nextDueAt
          };
        }

        const nextMetadata = mergeCacheHeartbeatMetadata(metadata, {
          interval_ms: intervalMs,
          in_flight_started_at: nowIso,
          last_claimed_at: nowIso,
          claim_count: normalizeInteger(heartbeat.claim_count ?? heartbeat.claimCount, 0) + 1,
          last_claim_reason: inFlightStartedMs !== null ? 'stale_in_flight_reclaimed' : 'due'
        });
        const updatedRows = await executor.query(
          `
            UPDATE agent_recovery_sessions
            SET metadata = ?::jsonb,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND status = 'active'
            RETURNING *
          `,
          [JSON.stringify(nextMetadata), id]
        );
        const updated = normalizeRecoverySessionRow(updatedRows[0]);
        return {
          claimed: Boolean(updated),
          reason: updated ? 'claimed' : 'inactive_or_missing',
          session: updated,
          nextDueAt: updated?.cacheHeartbeat?.nextDueAt || null,
          inFlightStartedAt: nowIso
        };
      };
      if (typeof sql.withTransaction === 'function') {
        return sql.withTransaction(claimWithExecutor);
      }
      return claimWithExecutor(sql);
    });
  }

  async function completeAgentRecoveryCacheHeartbeat(input = {}, config = {}) {
    const id = normalizeBigIntId(input.id);
    if (!id) {
      return null;
    }
    await ensureAgentRecoverySessionSchema(input, config);
    const intervalMs = Math.max(60_000, normalizePositiveInteger(input.intervalMs ?? input.interval_ms, 5 * 60_000));
    const retryMs = Math.max(15_000, normalizePositiveInteger(input.retryMs ?? input.retry_ms, Math.min(intervalMs, 60_000)));
    const now = input.completedAt || input.completed_at || input.now || new Date();
    const nowMs = parseDateMs(now) || Date.now();
    const completedAt = new Date(nowMs).toISOString();
    const startedAt = normalizeDate(input.startedAt || input.started_at) || completedAt;
    const status = firstString(input.status, 'completed');
    const success = status === 'completed' || status === 'ok' || status === 'success';
    const nextDueAt = success
      ? dateAfterMs(startedAt, intervalMs)
      : new Date(nowMs + retryMs).toISOString();
    return withSql(input, config, async (sql) => {
      const completeWithExecutor = async (executor) => {
        const rows = await executor.query(
          `
            SELECT *
            FROM agent_recovery_sessions
            WHERE id = ?
              AND status = 'active'
            FOR UPDATE
          `,
          [id]
        );
        const row = rows[0];
        if (!row) {
          return null;
        }
        const metadata = normalizeJsonObject(row.metadata, {});
        const nextMetadata = mergeCacheHeartbeatMetadata(metadata, {
          interval_ms: intervalMs,
          in_flight_started_at: null,
          last_started_at: startedAt,
          last_completed_at: completedAt,
          last_status: status,
          last_event_id: firstString(input.eventId, input.event_id),
          last_llm_call_id: firstString(input.llmCallId, input.llm_call_id),
          last_trace_id: firstString(input.traceId, input.trace_id),
          last_run_id: firstString(input.runId, input.run_id),
          last_error: success ? null : firstString(input.error, input.errorMessage, input.error_message, 'unknown_error'),
          last_input_tokens: normalizeInteger(input.inputTokens ?? input.input_tokens),
          last_cached_input_tokens: normalizeInteger(input.cachedInputTokens ?? input.cached_input_tokens),
          last_output_tokens: normalizeInteger(input.outputTokens ?? input.output_tokens),
          last_processing_time_ms: normalizeInteger(input.processingTimeMs ?? input.processing_time_ms),
          next_due_at: nextDueAt
        });
        const updatedRows = await executor.query(
          `
            UPDATE agent_recovery_sessions
            SET metadata = ?::jsonb,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND status = 'active'
            RETURNING *
          `,
          [JSON.stringify(nextMetadata), id]
        );
        return normalizeRecoverySessionRow(updatedRows[0]);
      };
      if (typeof sql.withTransaction === 'function') {
        return sql.withTransaction(completeWithExecutor);
      }
      return completeWithExecutor(sql);
    });
  }

  async function clearAgentRecoveryCacheHeartbeatSchedule(input = {}, config = {}) {
    const id = normalizeBigIntId(input.id);
    if (!id) {
      return null;
    }
    await ensureAgentRecoverySessionSchema(input, config);
    const now = normalizeDate(input.now || new Date());
    return withSql(input, config, async (sql) => {
      const rows = await sql.query(
        `
          UPDATE agent_recovery_sessions
          SET metadata = jsonb_set(
                COALESCE(metadata, '{}'::jsonb),
                '{cache_heartbeat}',
                COALESCE(metadata->'cache_heartbeat', '{}'::jsonb)
                  || jsonb_build_object(
                    'in_flight_started_at', NULL,
                    'next_due_at', NULL,
                    'cancelled_at', ?::text,
                    'cancel_reason', ?::text
                  ),
                true
              ),
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
          RETURNING *
        `,
        [
          now,
          firstString(input.reason, 'recovery_settled'),
          id
        ]
      );
      return normalizeRecoverySessionRow(rows[0]);
    });
  }

  async function finalizeAgentRecoverySession(input = {}, config = {}) {
    const id = normalizeBigIntId(input.id);
    if (!id) {
      return null;
    }
    await ensureAgentRecoverySessionSchema(input, config);
    return withSql(input, config, async (sql) => {
      const rows = await sql.query(
        `
          UPDATE agent_recovery_sessions
          SET status = ?,
              wake_cause = ?,
              ended_at = COALESCE(?::timestamptz, CURRENT_TIMESTAMP),
              clock_fired_at = COALESCE(clock_fired_at, ?::timestamptz),
              wake_call_count = COALESCE(?, wake_call_count),
              wake_required_count = COALESCE(?, wake_required_count),
              last_wake_counted_queue_message_id = COALESCE(?, last_wake_counted_queue_message_id),
              current_pressure = COALESCE(?, current_pressure),
              current_energy = COALESCE(?, current_energy),
              result = ?::jsonb,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
            AND status = 'active'
          RETURNING *
        `,
        [
          firstString(input.status, 'completed'),
          firstString(input.wakeCause, input.wake_cause),
          normalizeTimestampParam(input.endedAt || input.ended_at),
          normalizeTimestampParam(input.clockFiredAt || input.clock_fired_at),
          normalizeInteger(input.wakeCallCount ?? input.wake_call_count),
          normalizeInteger(input.wakeRequiredCount ?? input.wake_required_count),
          normalizeBigIntId(input.lastWakeCountedQueueMessageId ?? input.last_wake_counted_queue_message_id),
          normalizeNumber(input.currentPressure ?? input.current_pressure),
          normalizeNumber(input.currentEnergy ?? input.current_energy),
          JSON.stringify(normalizeJsonObject(input.result, {})),
          id
        ]
      );
      return normalizeRecoverySessionRow(rows[0]);
    });
  }

  return {
    ensureAgentRecoverySessionSchema,
    getAgentRecoveryQueueHighWatermark,
    createAgentRecoverySession,
    getActiveAgentRecoverySession,
    listAgentRecoverySessions,
    listAgentRecoveryWakeNotifications,
    updateAgentRecoverySessionProgress,
    claimAgentRecoveryCacheHeartbeat,
    completeAgentRecoveryCacheHeartbeat,
    clearAgentRecoveryCacheHeartbeatSchedule,
    finalizeAgentRecoverySession
  };
}

module.exports = {
  createAgentRecoverySessionPersistence
};
