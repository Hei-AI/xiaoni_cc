'use strict';

const DEFAULT_IDENTITY_KEY = 'xiaoni';
const DEFAULT_SURFACE = 'qq';
const DEFAULT_HALF_LIFE_SECONDS = 480;
const DEFAULT_THRESHOLD = 0.35;
const DEFAULT_COOLDOWN_SECONDS = 120;
const DEFAULT_MAX_TTL_SECONDS = 1800;
const DEFAULT_MAX_REMINDERS = 3;

function normalizeDate(value) {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

function normalizeString(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function normalizeJsonObject(value, fallback = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
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

function secondsBetween(now, then) {
  const date = normalizeDate(then);
  if (!date) return 0;
  return Math.max(0, (now.getTime() - date.getTime()) / 1000);
}

function decayedScore(score, updatedAt, halfLifeSeconds, now) {
  const elapsed = secondsBetween(now, updatedAt);
  const tau = Math.max(1, Number(halfLifeSeconds) || DEFAULT_HALF_LIFE_SECONDS);
  return Math.max(0, Math.min(1, Number(score || 0) * Math.exp(-elapsed / tau)));
}

function addSeconds(date, seconds) {
  return new Date(date.getTime() + (seconds * 1000));
}

function chatLabel(row) {
  const name = normalizeString(row.peer_name, null);
  const id = normalizeString(row.peer_id, 'unknown');
  const label = name && name !== id ? `${name}(${id})` : id;
  return row.chat_type === 'direct' ? `私聊 ${label}` : `群 ${label}`;
}

function focusTargetLine(row) {
  return row.chat_type === 'direct'
    ? `- 查看目标: focus_private ${row.peer_id}`
    : `- 查看目标: focus_group ${row.peer_id}`;
}

function renderAttentionReminder(params) {
  const lines = [
    `- 新未读 ${params.unreadDelta} 条`,
    params.directMentions > 0
      ? `- 状态栏显示私聊/@你 ${params.directMentions} 次`
      : '- 没有明确喊你的信息',
    focusTargetLine(params.inbound)
  ];
  return [
    `chat_label=${chatLabel(params.inbound)}`,
    `unread_delta=${params.unreadDelta}`,
    lines.join('\n')
  ].join('\n');
}

async function ensureQqAttentionLeaseSchemaWithSql(sql) {
  await sql.execute(`
    CREATE TABLE IF NOT EXISTS agent_qq_attention_leases (
      id BIGSERIAL PRIMARY KEY,
      identity_key VARCHAR(191) NOT NULL DEFAULT 'xiaoni',
      surface VARCHAR(32) NOT NULL DEFAULT 'qq',
      session_key VARCHAR(191) NOT NULL,
      chat_type VARCHAR(16) NOT NULL,
      peer_id VARCHAR(191) NOT NULL,
      peer_name VARCHAR(255),
      account_id VARCHAR(191) NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'active',
      score DOUBLE PRECISION NOT NULL DEFAULT 0,
      score_updated_at TIMESTAMPTZ(3) NOT NULL,
      half_life_seconds INTEGER NOT NULL DEFAULT 480,
      last_focused_at TIMESTAMPTZ(3) NOT NULL,
      last_seen_inbound_id BIGINT,
      latest_window_inbound_id BIGINT,
      last_reminder_at TIMESTAMPTZ(3),
      last_reminder_inbound_id BIGINT,
      reminder_count INTEGER NOT NULL DEFAULT 0,
      expires_at TIMESTAMPTZ(3) NOT NULL,
      closed_at TIMESTAMPTZ(3),
      close_reason VARCHAR(64),
      trace_id VARCHAR(128),
      run_id VARCHAR(128),
      batch_id VARCHAR(128),
      tool_call_id VARCHAR(191),
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
      CONSTRAINT uniq_agent_qq_attention_leases_identity_surface_session UNIQUE (identity_key, surface, session_key)
    )
  `);
  await sql.execute('CREATE INDEX IF NOT EXISTS idx_agent_qq_attention_leases_active_expiry ON agent_qq_attention_leases (identity_key, status, expires_at, score_updated_at, id)');
  await sql.execute('CREATE INDEX IF NOT EXISTS idx_agent_qq_attention_leases_session_status ON agent_qq_attention_leases (session_key, status, expires_at)');
  await sql.execute('CREATE INDEX IF NOT EXISTS idx_agent_qq_attention_leases_trace ON agent_qq_attention_leases (trace_id)');

  await sql.execute(`
    CREATE TABLE IF NOT EXISTS agent_qq_attention_reminders (
      id BIGSERIAL PRIMARY KEY,
      identity_key VARCHAR(191) NOT NULL DEFAULT 'xiaoni',
      session_key VARCHAR(191) NOT NULL,
      inbound_message_id BIGINT NOT NULL,
      queue_message_id BIGINT,
      dedupe_key VARCHAR(255) NOT NULL UNIQUE,
      attention_score DOUBLE PRECISION NOT NULL,
      reason VARCHAR(64) NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
      CONSTRAINT uniq_agent_qq_attention_reminders_identity_session_inbound UNIQUE (identity_key, session_key, inbound_message_id)
    )
  `);
  await sql.execute('CREATE INDEX IF NOT EXISTS idx_agent_qq_attention_reminders_session_created ON agent_qq_attention_reminders (session_key, created_at, id)');
}

function createQqAttentionLeasePersistence({ getPrismaClient, createSqlAdapter }) {
  function getClient(config) {
    return getPrismaClient(config);
  }

  async function ensureQqAttentionLeaseSchema(input = {}, config = {}) {
    const sql = input.sqlAdapter || createSqlAdapter(config);
    const shouldClose = !input.sqlAdapter;
    try {
      await ensureQqAttentionLeaseSchemaWithSql(sql);
    } finally {
      if (shouldClose && sql?.close) {
        await sql.close();
      }
    }
  }

  async function renewQqAttentionLease(input = {}, config = {}) {
    const prisma = getClient(config);
    const threadKey = normalizeString(input.threadKey || input.thread_key);
    if (!threadKey) return null;
    const now = normalizeDate(input.now) || new Date();
    const halfLifeSeconds = Math.max(1, Number(input.halfLifeSeconds || input.half_life_seconds) || DEFAULT_HALF_LIFE_SECONDS);
    const maxTtlSeconds = Math.max(1, Number(input.maxTtlSeconds || input.max_ttl_seconds) || DEFAULT_MAX_TTL_SECONDS);
    const latestMessageId = toBigIntOrNull(input.latestMessageId || input.latest_message_id);
    const existing = await prisma.agentQqAttentionLease.findUnique({
      where: {
        identity_key_surface_session_key: {
          identity_key: normalizeString(input.identityKey || input.identity_key, DEFAULT_IDENTITY_KEY),
          surface: DEFAULT_SURFACE,
          session_key: threadKey
        }
      }
    });
    const currentScore = existing
      ? decayedScore(existing.score, existing.score_updated_at, existing.half_life_seconds, now)
      : 0;
    const score = Math.min(1, currentScore + 1);
    const data = {
      identity_key: normalizeString(input.identityKey || input.identity_key, DEFAULT_IDENTITY_KEY),
      surface: DEFAULT_SURFACE,
      session_key: threadKey,
      chat_type: input.chatType === 'direct' || input.chat_type === 'direct' ? 'direct' : 'group',
      peer_id: normalizeString(input.peerId || input.peer_id),
      peer_name: normalizeString(input.peerName || input.peer_name, null),
      account_id: normalizeString(input.accountId || input.account_id, '1129974489'),
      status: 'active',
      score,
      score_updated_at: now,
      half_life_seconds: halfLifeSeconds,
      last_focused_at: now,
      last_seen_inbound_id: latestMessageId,
      latest_window_inbound_id: latestMessageId,
      reminder_count: 0,
      expires_at: addSeconds(now, maxTtlSeconds),
      closed_at: null,
      close_reason: null,
      trace_id: normalizeString(input.traceId || input.trace_id, null),
      run_id: normalizeString(input.runId || input.run_id, null),
      batch_id: normalizeString(input.batchId || input.batch_id, null),
      tool_call_id: normalizeString(input.toolCallId || input.tool_call_id, null),
      metadata: normalizeJsonObject(input.metadata, {})
    };
    return prisma.agentQqAttentionLease.upsert({
      where: {
        identity_key_surface_session_key: {
          identity_key: data.identity_key,
          surface: data.surface,
          session_key: data.session_key
        }
      },
      create: data,
      update: data
    });
  }

  async function closeQqAttentionLease(input = {}, config = {}) {
    const prisma = getClient(config);
    const threadKey = normalizeString(input.threadKey || input.thread_key);
    if (!threadKey) return { closedCount: 0 };
    const now = normalizeDate(input.now) || new Date();
    const result = await prisma.agentQqAttentionLease.updateMany({
      where: {
        identity_key: normalizeString(input.identityKey || input.identity_key, DEFAULT_IDENTITY_KEY),
        surface: DEFAULT_SURFACE,
        session_key: threadKey,
        status: 'active',
        closed_at: null
      },
      data: {
        status: 'closed',
        closed_at: now,
        close_reason: normalizeString(input.reason || input.closeReason || input.close_reason, 'put_away')
      }
    });
    return { closedCount: Number(result.count || 0) };
  }

  async function maybeCreateQqAttentionReminder(input = {}, config = {}) {
    if (input.policyState && input.policyState.isEnabled === false) {
      return { shouldEnqueue: false, reason: 'disabled_policy' };
    }
    const prisma = getClient(config);
    const inboundId = toBigIntOrNull(input.inboundMessageId || input.inbound_message_id);
    if (inboundId === null) return { shouldEnqueue: false, reason: 'invalid_inbound_id' };
    const now = normalizeDate(input.now) || new Date();
    const identityKey = normalizeString(input.identityKey || input.identity_key, DEFAULT_IDENTITY_KEY);
    const inbound = await prisma.agentInboundMessage.findUnique({ where: { id: inboundId } });
    if (!inbound) return { shouldEnqueue: false, reason: 'inbound_not_found' };
    const lease = await prisma.agentQqAttentionLease.findUnique({
      where: {
        identity_key_surface_session_key: {
          identity_key: identityKey,
          surface: DEFAULT_SURFACE,
          session_key: inbound.session_key
        }
      }
    });
    if (!lease || lease.status !== 'active' || lease.closed_at) {
      return { shouldEnqueue: false, reason: 'no_active_lease' };
    }
    if (normalizeDate(lease.expires_at).getTime() <= now.getTime()) {
      return { shouldEnqueue: false, reason: 'lease_expired' };
    }
    const score = decayedScore(lease.score, lease.score_updated_at, lease.half_life_seconds, now);
    const threshold = Number(input.threshold ?? DEFAULT_THRESHOLD);
    if (score < threshold) {
      return { shouldEnqueue: false, reason: 'below_threshold', score };
    }
    const cooldownSeconds = Number(input.cooldownSeconds || input.cooldown_seconds || DEFAULT_COOLDOWN_SECONDS);
    if (lease.last_reminder_at && secondsBetween(now, lease.last_reminder_at) < cooldownSeconds) {
      return { shouldEnqueue: false, reason: 'cooldown', score };
    }
    const maxReminders = Number(input.maxReminders || input.max_reminders || DEFAULT_MAX_REMINDERS);
    if (Number(lease.reminder_count || 0) >= maxReminders) {
      return { shouldEnqueue: false, reason: 'max_reminders', score };
    }
    const watermark = lease.last_reminder_inbound_id || lease.last_seen_inbound_id || 0n;
    if (inbound.id <= watermark) {
      return { shouldEnqueue: false, reason: 'no_new_inbound', score };
    }
    const where = {
      session_key: inbound.session_key,
      is_read: 0,
      id: { gt: watermark }
    };
    const [unreadDelta, directMentions] = await Promise.all([
      prisma.agentInboundMessage.count({ where }),
      prisma.agentInboundMessage.count({ where: { ...where, was_mentioned: 1 } })
    ]);
    if (unreadDelta <= 0) {
      return { shouldEnqueue: false, reason: 'no_unread_delta', score };
    }
    const dedupeKey = `attention_lease:${identityKey}:${inbound.session_key}:${lease.id}:${inbound.id}`;
    let reminder;
    try {
      reminder = await prisma.agentQqAttentionReminder.create({
        data: {
          identity_key: identityKey,
          session_key: inbound.session_key,
          inbound_message_id: inbound.id,
          dedupe_key: dedupeKey,
          attention_score: score,
          reason: 'attention_lease',
          metadata: {
            unread_delta: unreadDelta,
            direct_mentions: directMentions,
            lease_id: Number(lease.id),
            threshold,
            cooldown_seconds: cooldownSeconds,
            max_reminders: maxReminders
          }
        }
      });
    } catch (error) {
      if (error?.code !== 'P2002') throw error;
      reminder = await prisma.agentQqAttentionReminder.findUnique({ where: { dedupe_key: dedupeKey } });
      if (reminder?.queue_message_id) {
        return { shouldEnqueue: false, reason: 'already_enqueued', score };
      }
    }

    const rendered = renderAttentionReminder({ inbound, unreadDelta, directMentions });
    const notificationId = `attention:${inbound.message_sid || inbound.id}`;
    return {
      shouldEnqueue: true,
      reason: 'attention_lease',
      reminderId: Number(reminder.id),
      leaseId: Number(lease.id),
      score,
      message: {
        traceId: inbound.trace_id,
        source: 'system_reminder',
        messageId: Number(inbound.id),
        messageSid: notificationId,
        dedupeKey,
        chatType: inbound.chat_type === 'direct' ? 'direct' : 'group',
        sessionKey: inbound.session_key,
        peerId: inbound.peer_id,
        peerName: inbound.peer_name,
        senderId: 'qq',
        senderName: 'QQ',
        accountId: inbound.account_id,
        bodyForAgent: rendered,
        rawBody: rendered,
        commandBody: '',
        wasMentioned: Number(inbound.was_mentioned || 0) === 1,
        receivedAt: inbound.received_at,
        messageTimestamp: inbound.message_timestamp,
        rawPayload: {
          kind: 'attention_lease_reminder',
          reason: 'attention_lease',
          source_message_id: Number(inbound.id),
          source_message_sid: inbound.message_sid,
          session_key: inbound.session_key,
          chat_type: inbound.chat_type,
          peer_id: inbound.peer_id,
          peer_name: inbound.peer_name || null,
          unread_delta: unreadDelta,
          direct_mentions: directMentions,
          attention_score: score,
          lease_id: Number(lease.id),
          reminder_id: Number(reminder.id)
        },
        inboundContext: {
          Body: '',
          BodyForAgent: rendered,
          BodyForCommands: '',
          RawBody: '',
          CommandBody: '',
          Surface: 'system_reminder',
          MessageSid: notificationId,
          WasMentioned: Number(inbound.was_mentioned || 0) === 1,
          CommandAuthorized: false,
          ChatType: inbound.chat_type,
          SessionKey: inbound.session_key,
          AccountId: inbound.account_id,
          NativeChannelId: inbound.peer_id,
          ConversationLabel: inbound.peer_name || inbound.peer_id
        },
        systemReminder: {
          reminder: rendered,
          reason: 'attention_lease',
          createdAt: now.toISOString()
        }
      }
    };
  }

  async function markQqAttentionReminderQueued(input = {}, config = {}) {
    const prisma = getClient(config);
    const reminderId = toBigIntOrNull(input.reminderId || input.reminder_id);
    const queueMessageId = toBigIntOrNull(input.queueMessageId || input.queue_message_id);
    if (reminderId === null) return null;
    const now = normalizeDate(input.now) || new Date();
    const reminder = await prisma.agentQqAttentionReminder.update({
      where: { id: reminderId },
      data: { queue_message_id: queueMessageId, updated_at: now }
    });
    await prisma.agentQqAttentionLease.updateMany({
      where: {
        identity_key: reminder.identity_key,
        surface: DEFAULT_SURFACE,
        session_key: reminder.session_key,
        status: 'active'
      },
      data: {
        last_reminder_at: now,
        last_reminder_inbound_id: reminder.inbound_message_id,
        reminder_count: { increment: 1 }
      }
    });
    return reminder;
  }

  return {
    ensureQqAttentionLeaseSchema,
    renewQqAttentionLease,
    closeQqAttentionLease,
    maybeCreateQqAttentionReminder,
    markQqAttentionReminderQueued
  };
}

module.exports = {
  createQqAttentionLeasePersistence
};
