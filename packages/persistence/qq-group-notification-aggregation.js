'use strict';

const DEFAULT_IDENTITY_KEY = 'xiaoni';

function normalizeString(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function normalizeOptionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizePositiveInteger(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.floor(numeric));
}

function normalizeJsonObject(value, fallback = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  return fallback;
}

function parseJson(value, fallback = {}) {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function toBigIntOrNull(value) {
  try {
    if (value === null || typeof value === 'undefined' || String(value).trim() === '') {
      return null;
    }
    return BigInt(value);
  } catch {
    return null;
  }
}

function addSeconds(date, seconds) {
  return new Date(date.getTime() + Math.max(0, Number(seconds) || 0) * 1000);
}

function createSql(deps, input, config) {
  if (input?.sqlAdapter) {
    return {
      sql: input.sqlAdapter,
      shouldClose: false
    };
  }
  if (typeof deps.createSqlAdapter !== 'function') {
    throw new Error('QQ group notification aggregation SQL operations require createSqlAdapter');
  }
  return {
    sql: deps.createSqlAdapter(config),
    shouldClose: true
  };
}

async function ensureQqGroupNotificationAggregationSchemaWithSql(sql) {
  await sql.execute(`ALTER TABLE group_chat_settings
    ADD COLUMN IF NOT EXISTS notification_aggregation_seconds INTEGER NOT NULL DEFAULT 0`);
  await sql.execute(`
    CREATE TABLE IF NOT EXISTS agent_qq_group_notification_aggregations (
      session_key VARCHAR(191) PRIMARY KEY,
      peer_id VARCHAR(191) NOT NULL,
      peer_name VARCHAR(255),
      account_id VARCHAR(191) NOT NULL,
      unread_delta INTEGER NOT NULL DEFAULT 1,
      direct_mentions INTEGER NOT NULL DEFAULT 0,
      latest_message_id BIGINT,
      latest_message_sid VARCHAR(191) NOT NULL,
      message_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      due_at TIMESTAMPTZ(3) NOT NULL,
      created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await sql.execute('CREATE INDEX IF NOT EXISTS idx_agent_qq_group_notification_aggregations_due ON agent_qq_group_notification_aggregations (due_at)');
  await sql.execute(`
    CREATE TABLE IF NOT EXISTS agent_qq_usage_surface_state (
      identity_key VARCHAR(191) PRIMARY KEY DEFAULT 'xiaoni',
      active_thread_key VARCHAR(191),
      active_chat_type VARCHAR(16),
      active_peer_id VARCHAR(191),
      account_id VARCHAR(191),
      opened_at TIMESTAMPTZ(3),
      updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await sql.execute('CREATE INDEX IF NOT EXISTS idx_agent_qq_usage_surface_state_active_thread ON agent_qq_usage_surface_state (active_thread_key)');
}

function normalizeAggregationSeconds(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(86400, Math.floor(numeric)));
}

function buildAggregatedMessage(row) {
  const message = normalizeJsonObject(parseJson(row.message_payload, {}));
  const unreadDelta = Math.max(1, normalizePositiveInteger(row.unread_delta, 1));
  const directMentions = normalizePositiveInteger(row.direct_mentions, 0);
  const peerName = normalizeOptionalString(row.peer_name) || normalizeOptionalString(message.peerName) || `群 ${row.peer_id}`;
  const summary = `${peerName} 有 ${unreadDelta} 条新 QQ 消息。`;
  const latestSid = normalizeString(row.latest_message_sid, String(row.latest_message_id || Date.now()));
  const rawPayload = {
    ...normalizeJsonObject(message.rawPayload),
    unread_delta: unreadDelta,
    direct_mentions: directMentions,
    aggregation: {
      kind: 'ordinary_group_notification',
      unread_delta: unreadDelta,
      due_at: row.due_at,
      flushed_at: new Date().toISOString()
    }
  };
  const phoneNotification = {
    ...normalizeJsonObject(message.phoneNotification),
    unreadDelta,
    directMentions
  };
  return {
    ...message,
    messageSid: `phone-group-aggregation:${latestSid}`,
    dedupeKey: `phone_group_aggregation:${row.session_key}:${latestSid}`,
    bodyForAgent: summary,
    rawBody: summary,
    commandBody: '',
    rawPayload,
    inboundContext: {
      ...normalizeJsonObject(message.inboundContext),
      Body: summary,
      BodyForAgent: summary,
      BodyForCommands: '',
      RawBody: summary,
      CommandBody: '',
      Surface: 'phone_notification',
      MessageSid: `phone-group-aggregation:${latestSid}`,
      WasMentioned: false,
      CommandAuthorized: false
    },
    phoneNotification
  };
}

function createQqGroupNotificationAggregationPersistence(deps) {
  function getClient(config) {
    return deps.getPrismaClient(config);
  }

  async function ensureQqGroupNotificationAggregationSchema(input = {}, config = {}) {
    const { sql, shouldClose } = createSql(deps, input, config);
    try {
      await ensureQqGroupNotificationAggregationSchemaWithSql(sql);
    } finally {
      if (shouldClose) {
        await sql.close();
      }
    }
  }

  async function setQqUsageActiveSurface(input = {}, config = {}) {
    const prisma = getClient(config);
    const identityKey = normalizeString(input.identityKey || input.identity_key, DEFAULT_IDENTITY_KEY);
    const threadKey = normalizeString(input.threadKey || input.thread_key);
    if (!threadKey) {
      throw new Error('threadKey is required');
    }
    const chatType = input.chatType === 'group' || input.chat_type === 'group' ? 'group' : 'direct';
    const peerId = normalizeOptionalString(input.peerId || input.peer_id);
    const accountId = normalizeOptionalString(input.accountId || input.account_id);
    const now = new Date();
    await prisma.agentQqUsageSurfaceState.upsert({
      where: { identity_key: identityKey },
      create: {
        identity_key: identityKey,
        active_thread_key: threadKey,
        active_chat_type: chatType,
        active_peer_id: peerId,
        account_id: accountId,
        opened_at: now
      },
      update: {
        active_thread_key: threadKey,
        active_chat_type: chatType,
        active_peer_id: peerId,
        account_id: accountId,
        opened_at: now
      }
    });
    if (chatType === 'group') {
      await prisma.agentQqGroupNotificationAggregation.deleteMany({
        where: { session_key: threadKey }
      });
    }
    return { identityKey, threadKey, chatType };
  }

  async function clearQqUsageActiveSurface(input = {}, config = {}) {
    const prisma = getClient(config);
    const identityKey = normalizeString(input.identityKey || input.identity_key, DEFAULT_IDENTITY_KEY);
    const threadKey = normalizeOptionalString(input.threadKey || input.thread_key);
    const current = await prisma.agentQqUsageSurfaceState.findUnique({
      where: { identity_key: identityKey }
    });
    if (!current || (threadKey && current.active_thread_key !== threadKey)) {
      return { cleared: false };
    }
    await prisma.agentQqUsageSurfaceState.upsert({
      where: { identity_key: identityKey },
      create: {
        identity_key: identityKey,
        active_thread_key: null,
        active_chat_type: null,
        active_peer_id: null,
        account_id: null,
        opened_at: null
      },
      update: {
        active_thread_key: null,
        active_chat_type: null,
        active_peer_id: null,
        account_id: null,
        opened_at: null
      }
    });
    return { cleared: true, previousThreadKey: current.active_thread_key || null };
  }

  async function scheduleQqGroupNotificationAggregation(input = {}, config = {}) {
    const prisma = getClient(config);
    const message = normalizeJsonObject(input.message || input);
    const sessionKey = normalizeString(message.sessionKey || message.session_key);
    if (!sessionKey) {
      throw new Error('sessionKey is required');
    }
    if (message.chatType !== 'group' && message.chat_type !== 'group') {
      return { scheduled: false, reason: 'not_group' };
    }
    if (message.wasMentioned === true || message.was_mentioned === true) {
      return { scheduled: false, reason: 'mentioned' };
    }
    const active = await prisma.agentQqUsageSurfaceState.findUnique({
      where: { identity_key: normalizeString(input.identityKey || input.identity_key, DEFAULT_IDENTITY_KEY) }
    });
    if (active?.active_thread_key === sessionKey && active?.active_chat_type === 'group') {
      await prisma.agentQqGroupNotificationAggregation.deleteMany({
        where: { session_key: sessionKey }
      });
      return { scheduled: false, reason: 'active_surface' };
    }
    const dueAt = input.dueAt || input.due_at || addSeconds(new Date(), normalizeAggregationSeconds(input.seconds ?? input.aggregationSeconds ?? input.notificationAggregationSeconds));
    const unreadDelta = Math.max(
      1,
      normalizePositiveInteger(message.rawPayload?.unread_delta ?? message.phoneNotification?.unreadDelta ?? 1, 1)
    );
    const directMentions = normalizePositiveInteger(message.rawPayload?.direct_mentions ?? message.phoneNotification?.directMentions ?? 0, 0);
    const latestMessageId = toBigIntOrNull(message.rawPayload?.source_message_id ?? message.messageId ?? message.message_id);
    const latestMessageSid = normalizeString(message.rawPayload?.source_message_sid || message.messageSid || message.message_sid || latestMessageId || Date.now());
    const row = await prisma.agentQqGroupNotificationAggregation.upsert({
      where: { session_key: sessionKey },
      create: {
        session_key: sessionKey,
        peer_id: normalizeString(message.peerId || message.peer_id),
        peer_name: normalizeOptionalString(message.peerName || message.peer_name),
        account_id: normalizeString(message.accountId || message.account_id),
        unread_delta: unreadDelta,
        direct_mentions: directMentions,
        latest_message_id: latestMessageId,
        latest_message_sid: latestMessageSid,
        message_payload: message,
        due_at: dueAt
      },
      update: {
        peer_id: normalizeString(message.peerId || message.peer_id),
        peer_name: normalizeOptionalString(message.peerName || message.peer_name),
        account_id: normalizeString(message.accountId || message.account_id),
        unread_delta: { increment: unreadDelta },
        direct_mentions: { increment: directMentions },
        latest_message_id: latestMessageId,
        latest_message_sid: latestMessageSid,
        message_payload: message
      }
    });
    return {
      scheduled: true,
      sessionKey,
      dueAt: row.due_at,
      unreadDelta: Number(row.unread_delta || unreadDelta)
    };
  }

  async function cancelQqGroupNotificationAggregation(input = {}, config = {}) {
    const prisma = getClient(config);
    const threadKey = normalizeString(input.threadKey || input.thread_key || input.sessionKey || input.session_key);
    if (!threadKey) {
      return { cancelledCount: 0 };
    }
    const result = await prisma.agentQqGroupNotificationAggregation.deleteMany({
      where: { session_key: threadKey }
    });
    return { cancelledCount: Number(result.count || 0) };
  }

  async function claimDueQqGroupNotificationAggregations(input = {}, config = {}) {
    const limit = Math.max(1, Math.min(50, Number(input.limit) || 20));
    const identityKey = normalizeString(input.identityKey || input.identity_key, DEFAULT_IDENTITY_KEY);
    const { sql, shouldClose } = createSql(deps, input, config);
    try {
      const rows = await sql.withTransaction(async (tx) => {
        await tx.execute(
          `
            DELETE FROM agent_qq_group_notification_aggregations pending
            USING agent_qq_usage_surface_state surface
            WHERE surface.identity_key = ?
              AND surface.active_chat_type = 'group'
              AND surface.active_thread_key = pending.session_key
          `,
          [identityKey]
        );
        return tx.query(
          `
            SELECT pending.*
            FROM agent_qq_group_notification_aggregations pending
            WHERE pending.due_at <= NOW()
            ORDER BY pending.due_at ASC, pending.session_key ASC
            LIMIT ?
            FOR UPDATE SKIP LOCKED
          `,
          [limit]
        );
      });
      return rows.map((row) => ({
        sessionKey: row.session_key,
        dueAt: row.due_at,
        unreadDelta: Number(row.unread_delta || 0),
        message: buildAggregatedMessage(row)
      }));
    } finally {
      if (shouldClose) {
        await sql.close();
      }
    }
  }

  return {
    ensureQqGroupNotificationAggregationSchema,
    scheduleQqGroupNotificationAggregation,
    claimDueQqGroupNotificationAggregations,
    cancelQqGroupNotificationAggregation,
    setQqUsageActiveSurface,
    clearQqUsageActiveSurface
  };
}

module.exports = {
  createQqGroupNotificationAggregationPersistence
};
