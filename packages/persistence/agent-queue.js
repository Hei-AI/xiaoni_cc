'use strict';

const { randomUUID } = require('crypto');

function normalizeDate(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return typeof value === 'string' ? value : String(value);
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

function parseJson(value, fallback) {
  if (value === null || typeof value === 'undefined') {
    return fallback;
  }
  if (value && typeof value === 'object') {
    return value;
  }
  if (typeof value !== 'string') {
    return fallback;
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function normalizeQueueRow(row, fallbackPayload = null) {
  if (!row) {
    return null;
  }
  return {
    queueId: Number(row.id || 0),
    traceId: row.trace_id,
    dedupeKey: row.dedupe_key,
    status: row.status,
    attempts: Number(row.attempts || 0),
    availableAt: normalizeDate(row.available_at),
    payload: row.payload || fallbackPayload || {}
  };
}

function buildBatchSummary(rows) {
  return rows.map((row, index) => `#${index + 1} ${row.sender_name || row.sender_id}: ${row.body_for_agent}`).join('\n');
}

function mapClaimedRun(input) {
  const messages = input.rows.map((row) => {
    const payload = parseJson(row.payload, {});
    const rawPayload = parseJson(row.raw_payload, {});
    return {
      queueMessageId: Number(row.id),
      traceId: input.traceId,
      source: row.source,
      messageId: payload.messageId ?? Number(row.id),
      messageSid: row.message_sid,
      chatType: row.chat_type === 'group' ? 'group' : 'direct',
      sessionKey: row.session_key,
      peerId: row.peer_id,
      peerName: row.peer_name || undefined,
      senderId: row.sender_id,
      senderName: row.sender_name || undefined,
      accountId: row.account_id,
      bodyForAgent: row.body_for_agent,
      rawBody: payload.rawBody || row.body_for_agent,
      commandBody: payload.commandBody || row.body_for_agent,
      wasMentioned: Boolean(payload.wasMentioned),
      receivedAt: payload.receivedAt || normalizeDate(row.created_at) || new Date().toISOString(),
      messageTimestamp: payload.messageTimestamp ?? null,
      rawPayload: {
        ...rawPayload,
        ...(payload.phoneNotification ? { phoneNotification: payload.phoneNotification } : {}),
        ...(payload.imageTaskNotification ? { imageTaskNotification: payload.imageTaskNotification } : {}),
        ...(payload.systemReminder ? { systemReminder: payload.systemReminder } : {})
      },
      inboundContext: parseJson(row.inbound_context, {})
    };
  });

  const latest = messages[messages.length - 1];
  const latestPayload = parseJson(input.rows[input.rows.length - 1]?.payload, {});
  const phoneNotifications = input.rows
    .map((row) => parseJson(row.payload, {}).phoneNotification)
    .filter(Boolean);
  const latestPhoneNotification = phoneNotifications[phoneNotifications.length - 1] || latestPayload.phoneNotification;
  const systemReminders = input.rows
    .map((row) => parseJson(row.payload, {}).systemReminder)
    .filter(Boolean);
  const latestSystemReminder = systemReminders[systemReminders.length - 1] || latestPayload.systemReminder;
  const phoneNotification = latestPhoneNotification
    ? {
        ...latestPhoneNotification,
        unreadDelta: phoneNotifications.reduce((sum, notification) => sum + Math.max(1, Number(notification.unreadDelta || 1)), 0) || Math.max(1, messages.length),
        directMentions: phoneNotifications.reduce((sum, notification) => sum + Math.max(0, Number(notification.directMentions || 0)), 0)
      }
    : undefined;
  const payload = {
    traceId: input.traceId,
    runId: input.runId,
    batchId: input.batchId,
    source: latest.source,
    chatType: latest.chatType,
    sessionKey: latest.sessionKey,
    peerId: latest.peerId,
    peerName: latest.peerName,
    senderId: latest.senderId,
    senderName: latest.senderName,
    accountId: latest.accountId,
    bodyForAgent: buildBatchSummary(input.rows),
    rawBody: messages.map((message) => message.rawBody).join('\n'),
    commandBody: messages.map((message) => message.commandBody).join('\n'),
    wasMentioned: messages.some((message) => message.wasMentioned),
    receivedAt: latest.receivedAt,
    messageTimestamp: latest.messageTimestamp,
    rawPayload: latest.rawPayload,
    inboundContext: latest.inboundContext,
    messages,
    ...(phoneNotification ? { phoneNotification } : {}),
    ...(latestSystemReminder ? { systemReminder: latestSystemReminder } : {}),
    ...(latestPayload.consciousnessTick ? { consciousnessTick: latestPayload.consciousnessTick } : {}),
    ...(latestPayload.presenceTick ? { presenceTick: latestPayload.presenceTick } : {}),
    ...(latestPayload.selfContinuation ? { selfContinuation: latestPayload.selfContinuation } : {})
  };

  return {
    id: input.runId,
    traceId: input.traceId,
    batchId: input.batchId,
    status: 'processing',
    attempts: Math.max(...input.rows.map((row) => Number(row.attempts || 0) + 1), 1),
    maxAttempts: Math.max(...input.rows.map((row) => Number(row.max_attempts || 3)), 1),
    createdAt: normalizeDate(input.rows[0]?.created_at) || new Date().toISOString(),
    processingStartedAt: new Date().toISOString(),
    completedAt: null,
    conversationId: null,
    errorMessage: null,
    queueMessageIds: input.rows.map((row) => Number(row.id)),
    payload
  };
}

function createAgentQueuePersistence({ getPrismaClient, createSqlAdapter }) {
  function getClient(config) {
    return getPrismaClient(config);
  }

  function createSql(input, config) {
    if (input?.sqlAdapter) {
      return {
        sql: input.sqlAdapter,
        shouldClose: false
      };
    }
    if (typeof createSqlAdapter !== 'function') {
      throw new Error('agent queue SQL operations require createSqlAdapter');
    }
    return {
      sql: createSqlAdapter(config),
      shouldClose: true
    };
  }

  async function enqueueAgentQueueMessage(input, config = {}) {
    const prisma = getClient(config);
    const message = input.message || input;
    const dedupeKey = normalizeOptionalString(message.dedupeKey || message.dedupe_key)
      || `${message.source}:${message.messageSid || message.message_sid}`;
    const payload = normalizeJsonObject(input.payload, message);
    const availableAt = input.availableAt || input.available_at || new Date();
    // Defense-in-depth (docs/CACHE_CONTRACT.md §3): a trace_id must never persist empty. The
    // stack runtime-input event_id keys on it (stack:<traceId>:runtime-input); an empty
    // trace_id collapses onto the runId fallback, and two such rows in one run then collide
    // under appendAgentStackItems' ON CONFLICT(event_id) — the second's content is dropped,
    // the next run's stack-replay rebuilds a shorter body, and the prompt cache breaks at the
    // run boundary. Production callers always supply a real trace_id (provider-service
    // createTraceId); this guards simulator / internal / replay callers that don't.
    const resolvedTraceId = normalizeOptionalString(message.traceId || message.trace_id)
      || `runtrace_${Date.now()}_${randomUUID().slice(0, 8)}`;

    try {
      const created = await prisma.agentQueueMessage.create({
        data: {
          trace_id: resolvedTraceId,
          source: String(message.source || 'provider'),
          message_sid: String(message.messageSid || message.message_sid || dedupeKey),
          dedupe_key: dedupeKey,
          chat_type: message.chatType === 'direct' ? 'direct' : 'group',
          session_key: String(message.sessionKey || message.session_key || ''),
          peer_id: String(message.peerId || message.peer_id || ''),
          peer_name: normalizeOptionalString(message.peerName || message.peer_name),
          sender_id: String(message.senderId || message.sender_id || ''),
          sender_name: normalizeOptionalString(message.senderName || message.sender_name),
          account_id: String(message.accountId || message.account_id || ''),
          body_for_agent: String(message.bodyForAgent || message.body_for_agent || ''),
          raw_payload: normalizeJsonObject(message.rawPayload || message.raw_payload),
          inbound_context: normalizeJsonObject(message.inboundContext || message.inbound_context),
          payload,
          status: 'pending',
          available_at: availableAt
        }
      });
      return normalizeQueueRow(created, payload);
    } catch (error) {
      if (error?.code !== 'P2002') {
        throw error;
      }
      const existing = await prisma.agentQueueMessage.findUnique({
        where: { dedupe_key: dedupeKey }
      });
      return normalizeQueueRow(existing, payload) || {
        queueId: 0,
        traceId: resolvedTraceId,
        dedupeKey,
        status: 'pending',
        attempts: 0,
        availableAt: normalizeDate(availableAt),
        payload
      };
    }
  }

  async function claimNextAgentQueueMessage(input = {}, config = {}) {
    const workerId = normalizeOptionalString(input.workerId || input.worker_id) || 'agent-worker';
    const { sql, shouldClose } = createSql(input, config);
    try {
      return await sql.withTransaction(async (tx) => {
        const rows = await tx.query(
          `
            SELECT *
            FROM agent_queue_messages
            WHERE status = 'pending'
              AND available_at <= NOW()
            ORDER BY available_at ASC, id ASC
            FOR UPDATE SKIP LOCKED
          `
        );

        if (rows.length === 0) {
          return null;
        }

        const id = randomUUID().slice(0, 8);
        const now = Date.now();
        const batchId = `batch_${now}_${id}`;
        const runId = `run_${now}_${randomUUID().slice(0, 8)}`;
        const traceId = `runtrace_${now}_${randomUUID().slice(0, 8)}`;
        const latest = rows[rows.length - 1];
        const placeholders = rows.map(() => '?').join(', ');
        const queueIds = rows.map((row) => Number(row.id));
        const chatType = latest.chat_type === 'group' ? 'group' : 'direct';

        await tx.insert(
          `
            INSERT INTO agent_message_batches (
              id,
              trace_id,
              session_key,
              chat_type,
              peer_id,
              peer_name,
              account_id,
              status,
              reason_for_start,
              input_message_count,
              summary,
              processing_started_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, 'processing', 'debounce_window_elapsed', ?, ?, NOW())
          `,
          [
            batchId,
            traceId,
            latest.session_key,
            chatType,
            latest.peer_id,
            latest.peer_name,
            latest.account_id,
            rows.length,
            buildBatchSummary(rows)
          ]
        );

        for (let index = 0; index < rows.length; index += 1) {
          const row = rows[index];
          await tx.insert(
            `
              INSERT INTO agent_message_batch_items (
                batch_id,
                queue_message_id,
                inbound_message_id,
                message_sid,
                position
              )
              VALUES (?, ?, ?, ?, ?)
            `,
            [batchId, row.id, row.id, row.message_sid, index + 1]
          );
        }

        await tx.insert(
          `
            INSERT INTO agent_runs (
              id,
              batch_id,
              trace_id,
              session_key,
              chat_type,
              peer_id,
              peer_name,
              account_id,
              status,
              delivery_phase,
              started_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'processing', 'reasoning_open', NOW())
          `,
          [
            runId,
            batchId,
            traceId,
            latest.session_key,
            chatType,
            latest.peer_id,
            latest.peer_name,
            latest.account_id
          ]
        );

        await tx.execute(
          `
            UPDATE agent_queue_messages
            SET status = 'consumed',
                attempts = attempts + 1,
                locked_at = NOW(),
                locked_by = ?,
                processing_started_at = COALESCE(processing_started_at, NOW()),
                batch_id = ?,
                run_id = ?,
                trace_id = ?,
                result = ?::jsonb,
                updated_at = NOW()
            WHERE id IN (${placeholders})
          `,
          [
            workerId,
            batchId,
            runId,
            traceId,
            JSON.stringify({
              doorbell_consumed: true,
              consumed_at: new Date(now).toISOString(),
              worker_id: workerId
            }),
            ...queueIds
          ]
        );

        return mapClaimedRun({
          runId,
          batchId,
          traceId,
          rows: rows.map((row) => ({
            ...row,
            batch_id: batchId,
            run_id: runId,
            trace_id: traceId
          }))
        });
      });
    } finally {
      if (shouldClose) {
        await sql.close();
      }
    }
  }

  // Fold any pending doorbell messages into an ALREADY-RUNNING parent run,
  // WITHOUT minting a new agent_runs / agent_message_batches row. This is the
  // non-blocking notify-append path: one execution consuming an extra notify,
  // not a second run. By keying the folded messages to the parent run_id, the
  // existing settle/fail/retry functions (all WHERE run_id = ?) cover them, so:
  //   * parent settles  -> folded messages settle (acked only on success)
  //   * parent retries   -> folded messages reset to pending (reprocessed, not lost)
  //   * parent fails     -> folded messages fail (recorded, not silently dropped)
  // The old path used claimNextAgentQueueMessage here, which minted a phantom
  // run/batch row (the "two runs on one conversation" artifact) AND acked the
  // message at fold time, so a transient parent failure dropped it forever.
  async function foldPendingNotifyMessagesIntoRun(input = {}, config = {}) {
    const workerId = normalizeOptionalString(input.workerId || input.worker_id) || 'agent-worker';
    const parentRunId = normalizeOptionalString(input.parentRunId || input.parent_run_id);
    const parentBatchId = normalizeOptionalString(input.parentBatchId || input.parent_batch_id);
    if (!parentRunId || !parentBatchId) {
      throw new Error('foldPendingNotifyMessagesIntoRun requires parentRunId and parentBatchId');
    }
    const { sql, shouldClose } = createSql(input, config);
    try {
      return await sql.withTransaction(async (tx) => {
        const rows = await tx.query(
          `
            SELECT *
            FROM agent_queue_messages
            WHERE status = 'pending'
              AND available_at <= NOW()
            ORDER BY available_at ASC, id ASC
            FOR UPDATE SKIP LOCKED
          `
        );

        if (rows.length === 0) {
          return null;
        }

        const now = Date.now();
        const placeholders = rows.map(() => '?').join(', ');
        const queueIds = rows.map((row) => Number(row.id));

        await tx.execute(
          `
            UPDATE agent_queue_messages
            SET status = 'consumed',
                attempts = attempts + 1,
                locked_at = NOW(),
                locked_by = ?,
                processing_started_at = COALESCE(processing_started_at, NOW()),
                batch_id = ?,
                run_id = ?,
                result = ?::jsonb,
                updated_at = NOW()
            WHERE id IN (${placeholders})
          `,
          [
            workerId,
            parentBatchId,
            parentRunId,
            JSON.stringify({
              folded_nonblocking_notify: true,
              parent_run_id: parentRunId,
              folded_at: new Date(now).toISOString(),
              worker_id: workerId
            }),
            ...queueIds
          ]
        );

        // Preserve each folded message's own trace_id (NOT overwritten above) for
        // archival lineage; key the returned record to the parent run/batch so the
        // caller settles/fails/retries it through the parent's lifecycle.
        return mapClaimedRun({
          runId: parentRunId,
          batchId: parentBatchId,
          traceId: rows[rows.length - 1].trace_id,
          rows: rows.map((row) => ({
            ...row,
            batch_id: parentBatchId,
            run_id: parentRunId
          }))
        });
      });
    } finally {
      if (shouldClose) {
        await sql.close();
      }
    }
  }

  async function settleAgentQueueMessages(input = {}, config = {}) {
    const runId = normalizeOptionalString(input.runId || input.run_id);
    if (!runId) {
      throw new Error('settleAgentQueueMessages requires runId');
    }
    const { sql, shouldClose } = createSql(input, config);
    try {
      await sql.execute(
        `
          UPDATE agent_queue_messages
          SET status = 'settled',
              result = ?::jsonb,
              completed_at = NOW(),
              updated_at = NOW(),
              error_message = NULL
          WHERE run_id = ?
        `,
        [
          JSON.stringify(normalizeJsonObject(input.result)),
          runId
        ]
      );
    } finally {
      if (shouldClose) {
        await sql.close();
      }
    }
  }

  async function failAgentQueueMessage(input = {}, config = {}) {
    const runId = normalizeOptionalString(input.runId || input.run_id);
    if (!runId) {
      throw new Error('failAgentQueueMessage requires runId');
    }
    const { sql, shouldClose } = createSql(input, config);
    try {
      await sql.execute(
        `
          UPDATE agent_queue_messages
          SET status = 'failed',
              error_message = ?,
              completed_at = NOW(),
              updated_at = NOW()
          WHERE run_id = ?
        `,
        [
          String(input.errorMessage || input.error_message || ''),
          runId
        ]
      );
    } finally {
      if (shouldClose) {
        await sql.close();
      }
    }
  }

  async function retryAgentQueueMessage(input = {}, config = {}) {
    const runId = normalizeOptionalString(input.runId || input.run_id);
    if (!runId) {
      throw new Error('retryAgentQueueMessage requires runId');
    }
    const retryDelayMs = Math.max(0, Number(input.retryDelayMs ?? input.retry_delay_ms ?? 0) || 0);
    const errorMessage = String(input.errorMessage || input.error_message || '');
    const { sql, shouldClose } = createSql(input, config);
    try {
      return await sql.execute(
        `
          UPDATE agent_queue_messages
          SET status = 'pending',
              available_at = NOW() + (? * INTERVAL '1 millisecond'),
              locked_at = NULL,
              locked_by = NULL,
              batch_id = NULL,
              run_id = NULL,
              completed_at = NULL,
              error_message = ?,
              result = ?::jsonb,
              updated_at = NOW()
          WHERE run_id = ?
            AND attempts < max_attempts
        `,
        [
          retryDelayMs,
          errorMessage,
          JSON.stringify({
            doorbell_retry_pending: true,
            failed_run_id: runId,
            retry_after_ms: retryDelayMs,
            error_message: errorMessage,
            retry_scheduled_at: new Date().toISOString()
          }),
          runId
        ]
      );
    } finally {
      if (shouldClose) {
        await sql.close();
      }
    }
  }

  return {
    enqueueAgentQueueMessage,
    claimNextAgentQueueMessage,
    foldPendingNotifyMessagesIntoRun,
    settleAgentQueueMessages,
    failAgentQueueMessage,
    retryAgentQueueMessage
  };
}

module.exports = {
  createAgentQueuePersistence
};
