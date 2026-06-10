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
      rawPayload: parseJson(row.raw_payload, {}),
      inboundContext: parseJson(row.inbound_context, {})
    };
  });

  const latest = messages[messages.length - 1];
  const latestPayload = parseJson(input.rows[input.rows.length - 1]?.payload, {});
  const phoneNotifications = input.rows
    .map((row) => parseJson(row.payload, {}).phoneNotification)
    .filter(Boolean);
  const latestPhoneNotification = phoneNotifications[phoneNotifications.length - 1] || latestPayload.phoneNotification;
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

    try {
      const created = await prisma.agentQueueMessage.create({
        data: {
          trace_id: String(message.traceId || message.trace_id || ''),
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
        traceId: String(message.traceId || message.trace_id || ''),
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
        const candidates = await tx.query(
          `
            SELECT *
            FROM agent_queue_messages
            WHERE status = 'pending'
              AND available_at <= NOW()
            ORDER BY available_at ASC, id ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
          `
        );

        const candidate = candidates[0];
        if (!candidate) {
          return null;
        }

        const rows = await tx.query(
          `
            SELECT *
            FROM agent_queue_messages
            WHERE status = 'pending'
              AND session_key = ?
              AND available_at <= NOW()
            ORDER BY available_at ASC, id ASC
            FOR UPDATE
          `,
          [candidate.session_key]
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
              conversation_id = COALESCE(?, conversation_id),
              result = ?::jsonb,
              completed_at = NOW(),
              updated_at = NOW(),
              error_message = NULL
          WHERE run_id = ?
        `,
        [
          input.conversationId ?? input.conversation_id ?? null,
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
              conversation_id = COALESCE(?, conversation_id),
              completed_at = NOW(),
              updated_at = NOW()
          WHERE run_id = ?
        `,
        [
          String(input.errorMessage || input.error_message || ''),
          input.conversationId ?? input.conversation_id ?? null,
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
    settleAgentQueueMessages,
    failAgentQueueMessage
  };
}

module.exports = {
  createAgentQueuePersistence
};
