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

function normalizeJsonObject(value, fallback = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  return fallback;
}

function normalizeOptionalString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
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

function createAgentQueuePersistence({ getPrismaClient }) {
  function getClient(config) {
    return getPrismaClient(config);
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

  return {
    enqueueAgentQueueMessage
  };
}

module.exports = {
  createAgentQueuePersistence
};
