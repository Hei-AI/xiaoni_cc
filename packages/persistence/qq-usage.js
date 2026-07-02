'use strict';

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

function normalizeRow(row) {
  if (!row || typeof row !== 'object') {
    return row;
  }
  const normalized = {};
  for (const [key, value] of Object.entries(row)) {
    if (typeof value === 'bigint') {
      normalized[key] = Number(value);
    } else if (value instanceof Date) {
      normalized[key] = value.toISOString();
    } else {
      normalized[key] = value;
    }
  }
  return normalized;
}

// 小腻自己发出去的消息落在 agent_outbound_messages（见 schema.prisma）。这张表是运行时
// 幂等自建的（和 agent_memory_* 一样），用 WeakSet 按 prisma client 记忆「本进程已建过」，
// 避免每次读会话窗口都跑一遍 CREATE TABLE IF NOT EXISTS。
const outboundSchemaReady = new WeakSet();

async function ensureQqUsageOutboundSchema(prisma) {
  if (!prisma || outboundSchemaReady.has(prisma)) {
    return;
  }
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS agent_outbound_messages (
      id BIGSERIAL PRIMARY KEY,
      chat_type VARCHAR(16) NOT NULL,
      session_key VARCHAR(191) NOT NULL,
      peer_id VARCHAR(191) NOT NULL,
      peer_name VARCHAR(255) NULL,
      account_id VARCHAR(191) NOT NULL,
      sender_id VARCHAR(191) NOT NULL,
      sender_name VARCHAR(255) NULL,
      delivery_message_id VARCHAR(191) NULL,
      content_kind VARCHAR(16) NOT NULL DEFAULT 'text',
      body_for_agent TEXT NOT NULL,
      raw_body TEXT NULL,
      reply_to_id VARCHAR(191) NULL,
      reply_to_body TEXT NULL,
      reply_to_sender VARCHAR(255) NULL,
      sent_at TIMESTAMPTZ(3) NOT NULL,
      trace_id VARCHAR(128) NULL,
      run_id VARCHAR(128) NULL,
      created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await prisma.$executeRawUnsafe(
    'CREATE INDEX IF NOT EXISTS idx_agent_outbound_messages_session_sent ON agent_outbound_messages (session_key, sent_at, id)'
  );
  outboundSchemaReady.add(prisma);
}

function normalizeOptionalString(value) {
  if (value === null || typeof value === 'undefined') return null;
  const text = String(value).trim();
  return text ? text : null;
}

// 把一行 outbound 记录整形成 renderMessage 认识的形状：sent_at 映射到
// message_timestamp/received_at，标记为已读、无 @，发送者是小腻自己。
function mapOutboundRow(row) {
  return {
    id: row.id,
    message_timestamp: row.sent_at,
    received_at: row.sent_at,
    chat_type: row.chat_type,
    session_key: row.session_key,
    peer_id: row.peer_id,
    peer_name: row.peer_name || null,
    account_id: row.account_id,
    sender_id: row.sender_id,
    sender_name: row.sender_name || '小腻',
    delivery_message_id: row.delivery_message_id || null,
    content_kind: row.content_kind || 'text',
    is_read: 1,
    was_mentioned: 0,
    body_for_agent: row.body_for_agent,
    raw_body: row.raw_body,
    reply_to_id: row.reply_to_id || null
  };
}

// 取会话窗口时间段内小腻自己的发言，只用于渲染并进时间线；绝不参与未读/anchor。
// 上界 upper 为 null 表示这是「最新窗口」，她在最后一条 inbound 之后的回复也要显示。
async function fetchOutboundWindowRows(prisma, threadKey, options = {}) {
  if (!prisma) return [];
  const limit = Math.max(1, Math.min(50, Number(options.limit) || 10));
  try {
    await ensureQqUsageOutboundSchema(prisma);
    const clauses = ['session_key = $1'];
    const params = [threadKey];
    if (options.lower) {
      params.push(options.lower);
      clauses.push(`sent_at >= $${params.length}`);
    }
    if (options.upper) {
      params.push(options.upper);
      clauses.push(`sent_at <= $${params.length}`);
    }
    params.push(Math.max(limit, 20));
    const sql = `
      SELECT id, chat_type, session_key, peer_id, peer_name, account_id, sender_id, sender_name,
             delivery_message_id, content_kind, body_for_agent, raw_body, reply_to_id, sent_at
      FROM agent_outbound_messages
      WHERE ${clauses.join(' AND ')}
      ORDER BY sent_at DESC, id DESC
      LIMIT $${params.length}
    `;
    const rows = await prisma.$queryRawUnsafe(sql, ...params);
    return Array.isArray(rows) ? rows.reverse() : [];
  } catch {
    return [];
  }
}

async function recordQqUsageOutboundMessage(input = {}, config = {}) {
  const prisma = input.prisma || config.prisma || input.getPrismaClient?.(config) || config.getPrismaClient?.(config);
  if (!prisma) {
    throw new Error('recordQqUsageOutboundMessage requires a Prisma client');
  }
  const sessionKey = typeof input.sessionKey === 'string' ? input.sessionKey.trim() : '';
  const body = String(input.bodyForAgent ?? input.body ?? '').trim();
  if (!sessionKey || !body) {
    return null;
  }
  await ensureQqUsageOutboundSchema(prisma);
  const chatType = input.chatType === 'group' ? 'group' : 'direct';
  const sentAt = input.sentAt ? new Date(input.sentAt) : new Date();
  const rows = await prisma.$queryRawUnsafe(
    `INSERT INTO agent_outbound_messages
       (chat_type, session_key, peer_id, peer_name, account_id, sender_id, sender_name,
        delivery_message_id, content_kind, body_for_agent, raw_body,
        reply_to_id, reply_to_body, reply_to_sender, sent_at, trace_id, run_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     RETURNING id`,
    chatType,
    sessionKey,
    String(input.peerId ?? ''),
    normalizeOptionalString(input.peerName),
    String(input.accountId ?? ''),
    String(input.senderId ?? input.accountId ?? ''),
    normalizeOptionalString(input.senderName) || '小腻',
    normalizeOptionalString(input.deliveryMessageId),
    input.contentKind === 'image' ? 'image' : 'text',
    body,
    normalizeOptionalString(input.rawBody) ?? body,
    normalizeOptionalString(input.replyToId),
    normalizeOptionalString(input.replyToBody),
    normalizeOptionalString(input.replyToSender),
    sentAt,
    normalizeOptionalString(input.traceId),
    normalizeOptionalString(input.runId)
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  return { id: row?.id === undefined ? null : Number(row.id) };
}

const GROUP_NOTIFICATION_MODES = new Set(['all', 'mentions_only']);

function normalizeGroupNotificationMode(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[-\s]+/g, '_');
  if (normalized === 'mentions' || normalized === 'mention_only' || normalized === 'mention-only') {
    return 'mentions_only';
  }
  return GROUP_NOTIFICATION_MODES.has(normalized) ? normalized : '';
}

async function ensureGroupNotificationModeColumn(prisma) {
  await prisma.$executeRawUnsafe("ALTER TABLE group_chat_settings ADD COLUMN IF NOT EXISTS notification_mode TEXT NOT NULL DEFAULT 'all'");
}

function normalizeChatType(value) {
  return value === 'group' || value === 'direct' ? value : null;
}

function normalizeSearchQuery(value) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 80) : '';
}

function normalizeAggregationSeconds(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(86400, Math.floor(numeric)));
}

function buildThreadListWhere(input = {}) {
  const chatType = normalizeChatType(input.chatType || input.chat_type);
  const searchQuery = normalizeSearchQuery(input.searchQuery || input.search_query || input.query || input.q);
  return {
    ...(chatType ? { chat_type: chatType } : {}),
    ...(searchQuery ? {
      OR: [
        { peer_name: { contains: searchQuery, mode: 'insensitive' } },
        { peer_id: { contains: searchQuery } },
        { session_key: { contains: searchQuery } }
      ]
    } : {})
  };
}

function buildEffectiveUnreadWhere(threadState, extra = {}) {
  return {
    session_key: threadState.session_key,
    is_read: 0,
    ...(threadState.last_read_received_at ? { received_at: { gt: threadState.last_read_received_at } } : {}),
    ...extra
  };
}

function isEffectiveUnreadFromState(message, threadState) {
  if (Number(message?.is_read) !== 0) {
    return false;
  }
  if (!threadState?.last_read_received_at) {
    return true;
  }
  return new Date(message.received_at).getTime() > new Date(threadState.last_read_received_at).getTime();
}

async function getThreadState(prisma, threadKey) {
  if (!prisma.agentInboundThreadState) {
    return null;
  }
  return prisma.agentInboundThreadState.findUnique({ where: { session_key: threadKey } });
}

async function getThreadNotificationStates(prisma, threadStates) {
  const result = new Map();
  const groupIds = threadStates
    .filter((state) => state.chat_type === 'group')
    .map((state) => toBigIntOrNull(state.peer_id))
    .filter((id) => id !== null);
  const directUserIds = threadStates
    .filter((state) => state.chat_type !== 'group')
    .map((state) => toBigIntOrNull(state.peer_id))
    .filter((id) => id !== null);

  const [groupSettings, privateSettings] = await Promise.all([
    prisma.groupChatSetting && groupIds.length > 0
      ? prisma.groupChatSetting.findMany({
          where: { group_id: { in: groupIds } },
          select: { group_id: true, is_enabled: true, notification_aggregation_seconds: true }
        })
      : [],
    prisma.privateChatSetting && directUserIds.length > 0
      ? prisma.privateChatSetting.findMany({
          where: { user_id: { in: directUserIds } },
          select: { user_id: true, is_enabled: true }
        })
      : []
  ]);

  for (const row of groupSettings) {
    result.set(`group:${String(row.group_id)}`, {
      imReceiveEnabled: Number(row.is_enabled) === 1,
      notificationMuted: Number(row.is_enabled) !== 1,
      notificationAggregationSeconds: normalizeAggregationSeconds(row.notification_aggregation_seconds)
    });
  }
  for (const row of privateSettings) {
    result.set(`direct:${String(row.user_id)}`, {
      imReceiveEnabled: Number(row.is_enabled) === 1,
      notificationMuted: Number(row.is_enabled) !== 1,
      notificationAggregationSeconds: 0
    });
  }
  return result;
}

async function refreshThreadState(prisma, threadKey) {
  const latest = await prisma.agentInboundMessage.findFirst({
    where: { session_key: threadKey },
    orderBy: [{ received_at: 'desc' }, { id: 'desc' }]
  });
  if (!latest) {
    if (prisma.agentInboundThreadState) {
      await prisma.agentInboundThreadState.delete({ where: { session_key: threadKey } }).catch(() => undefined);
    }
    return null;
  }

  const lastRead = await prisma.agentInboundMessage.aggregate({
    where: { session_key: threadKey, is_read: 1 },
    _max: { received_at: true }
  });
  const threadState = {
    session_key: threadKey,
    last_read_received_at: lastRead._max.received_at || null
  };
  const effectiveUnreadWhere = buildEffectiveUnreadWhere(threadState);
  const [totalMessages, unreadCount, directMentions, latestUnread] = await Promise.all([
    prisma.agentInboundMessage.count({ where: { session_key: threadKey } }),
    prisma.agentInboundMessage.count({ where: effectiveUnreadWhere }),
    prisma.agentInboundMessage.count({ where: { ...effectiveUnreadWhere, was_mentioned: 1 } }),
    prisma.agentInboundMessage.aggregate({
      where: effectiveUnreadWhere,
      _max: { received_at: true }
    })
  ]);
  const data = {
    chat_type: latest.chat_type,
    peer_id: latest.peer_id,
    peer_name: latest.peer_name || null,
    account_id: latest.account_id,
    total_messages: Number(totalMessages || 0),
    unread_count: Number(unreadCount || 0),
    direct_mentions: Number(directMentions || 0),
    last_message_id: latest.id,
    last_received_at: latest.received_at,
    latest_unread_received_at: latestUnread._max.received_at || null,
    last_read_received_at: threadState.last_read_received_at
  };

  if (!prisma.agentInboundThreadState) {
    return { session_key: threadKey, ...data };
  }

  return prisma.agentInboundThreadState.upsert({
    where: { session_key: threadKey },
    create: { session_key: threadKey, ...data },
    update: data
  });
}

async function getQqUsageUnreadSummary(input = {}, config = {}) {
  const prisma = input.prisma || config.prisma || input.getPrismaClient?.(config) || config.getPrismaClient?.(config);
  if (!prisma) {
    throw new Error('getQqUsageUnreadSummary requires a Prisma client');
  }
  const summary = await prisma.agentInboundThreadState.aggregate({
    _sum: { unread_count: true, direct_mentions: true }
  });
  return {
    unreadCount: Number(summary._sum.unread_count || 0),
    directMentions: Number(summary._sum.direct_mentions || 0)
  };
}

async function listQqUsageThreads(input = {}, config = {}) {
  const prisma = input.prisma || config.prisma || input.getPrismaClient?.(config) || config.getPrismaClient?.(config);
  if (!prisma) {
    throw new Error('listQqUsageThreads requires a Prisma client');
  }
  const limit = Math.max(1, Math.min(50, Number(input.limit) || 10));
  const offset = Math.max(0, Number(input.offset) || 0);
  const searchQuery = normalizeSearchQuery(input.searchQuery || input.search_query || input.query || input.q);
  const chatType = normalizeChatType(input.chatType || input.chat_type);
  const where = buildThreadListWhere(input);
  const states = await prisma.agentInboundThreadState.findMany({
    ...(Object.keys(where).length > 0 ? { where } : {}),
    orderBy: [{ last_received_at: 'desc' }, { session_key: 'asc' }],
    skip: offset,
    take: limit + 1
  });
  const page = states.slice(0, limit);
  const sessionKeys = page.map((row) => row.session_key);
  if (sessionKeys.length === 0) {
    return {
      offset,
      limit,
      searchQuery,
      chatType,
      hasOlderThreads: false,
      hasNewerThreads: offset > 0,
      threads: []
    };
  }

  const latestRows = await prisma.agentInboundMessage.findMany({
    where: { id: { in: page.map((row) => row.last_message_id).filter((id) => id !== null && typeof id !== 'undefined') } }
  });
  const latestById = new Map(latestRows.map((row) => [String(row.id), row]));
  const notificationStates = await getThreadNotificationStates(prisma, page);

  return {
    offset,
    limit,
    searchQuery,
    chatType,
    hasOlderThreads: states.length > limit,
    hasNewerThreads: offset > 0,
    threads: page.map((state) => {
      const latest = state.last_message_id ? latestById.get(String(state.last_message_id)) || null : null;
      const chatType = state.chat_type || latest?.chat_type || 'direct';
      const peerId = state.peer_id || latest?.peer_id || '';
      const notificationState = notificationStates.get(`${chatType === 'group' ? 'group' : 'direct'}:${peerId}`) || {
        imReceiveEnabled: true,
        notificationMuted: false,
        notificationAggregationSeconds: 0
      };
      return {
        threadKey: state.session_key,
        chatType,
        peerId,
        peerName: state.peer_name || latest?.peer_name || null,
        accountId: state.account_id || latest?.account_id || null,
        imReceiveEnabled: notificationState.imReceiveEnabled,
        notificationMuted: notificationState.notificationMuted,
        notificationAggregationSeconds: notificationState.notificationAggregationSeconds,
        unreadCount: Number(state.unread_count || 0),
        directMentions: Number(state.direct_mentions || 0),
        totalMessages: Number(state.total_messages || 0),
        lastReceivedAt: state.last_received_at || latest?.received_at || null,
        latestMessage: latest ? normalizeRow(latest) : null
      };
    })
  };
}

async function getMessageAnchor(prisma, id) {
  const messageId = toBigIntOrNull(id);
  if (messageId === null) {
    return null;
  }
  return prisma.agentInboundMessage.findUnique({ where: { id: messageId } });
}

function buildOlderWhere(threadKey, anchor) {
  if (!anchor) return { session_key: threadKey };
  return {
    session_key: threadKey,
    OR: [
      { received_at: { lt: anchor.received_at } },
      { received_at: anchor.received_at, id: { lt: anchor.id } }
    ]
  };
}

function buildNewerWhere(threadKey, anchor) {
  if (!anchor) return { session_key: threadKey };
  return {
    session_key: threadKey,
    OR: [
      { received_at: { gt: anchor.received_at } },
      { received_at: anchor.received_at, id: { gt: anchor.id } }
    ]
  };
}

async function listQqUsageThreadWindow(input = {}, config = {}) {
  const prisma = input.prisma || config.prisma || input.getPrismaClient?.(config) || config.getPrismaClient?.(config);
  if (!prisma) {
    throw new Error('listQqUsageThreadWindow requires a Prisma client');
  }
  const threadKey = typeof input.threadKey === 'string' ? input.threadKey.trim() : '';
  if (!threadKey) {
    throw new Error('thread_key is required');
  }
  const limit = Math.max(1, Math.min(50, Number(input.limit) || 10));
  const mode = input.mode === 'older' || input.mode === 'newer' || input.mode === 'around' ? input.mode : 'latest';
  const anchor = mode === 'latest' ? null : await getMessageAnchor(prisma, input.anchorMessageId);
  const threadState = await getThreadState(prisma, threadKey) || await refreshThreadState(prisma, threadKey);

  // 'around': center a window on a specific message (e.g. the one a reply quotes).
  // If the anchor is unknown/pruned or belongs to another thread, there is no
  // reachable path — return anchorMissing so the caller renders an honest
  // "原消息已不在记录里" instead of a phantom window.
  if (mode === 'around' && (!anchor || anchor.session_key !== threadKey)) {
    return {
      threadKey,
      mode,
      windowSize: limit,
      cursorAnchor: null,
      hasOlderMessages: false,
      hasNewerMessages: false,
      newerAvailable: 0,
      unreadBeforeWindow: 0,
      unreadAfterWindow: 0,
      reachedReadHistory: false,
      unreadCount: Number(threadState?.unread_count || 0),
      directMentions: Number(threadState?.direct_mentions || 0),
      messages: [],
      latestMessageId: null,
      earliestMessageId: null,
      windowUnreadCount: 0,
      anchorMissing: true
    };
  }

  let rows;
  if (mode === 'around') {
    // Split the budget around the anchor: floor older + anchor + ceil newer.
    const olderHalf = Math.floor((limit - 1) / 2);
    const newerHalf = limit - 1 - olderHalf;
    const [olderRows, newerRows] = await Promise.all([
      olderHalf > 0
        ? prisma.agentInboundMessage.findMany({
            where: buildOlderWhere(threadKey, anchor),
            orderBy: [{ received_at: 'desc' }, { id: 'desc' }],
            take: olderHalf
          })
        : Promise.resolve([]),
      newerHalf > 0
        ? prisma.agentInboundMessage.findMany({
            where: buildNewerWhere(threadKey, anchor),
            orderBy: [{ received_at: 'asc' }, { id: 'asc' }],
            take: newerHalf
          })
        : Promise.resolve([])
    ]);
    rows = [...olderRows.reverse(), anchor, ...newerRows];
  } else if (mode === 'older') {
    rows = await prisma.agentInboundMessage.findMany({
      where: buildOlderWhere(threadKey, anchor),
      orderBy: [{ received_at: 'desc' }, { id: 'desc' }],
      take: limit
    });
    rows = rows.reverse();
  } else if (mode === 'newer') {
    rows = await prisma.agentInboundMessage.findMany({
      where: buildNewerWhere(threadKey, anchor),
      orderBy: [{ received_at: 'asc' }, { id: 'asc' }],
      take: limit
    });
  } else {
    if (Number(threadState?.unread_count || 0) >= limit) {
      rows = await prisma.agentInboundMessage.findMany({
        where: buildEffectiveUnreadWhere(threadState),
        orderBy: [{ received_at: 'desc' }, { id: 'desc' }],
        take: limit
      });
      rows = rows.reverse();
    } else {
      rows = (await prisma.agentInboundMessage.findMany({
        where: { session_key: threadKey },
        orderBy: [{ received_at: 'desc' }, { id: 'desc' }],
        take: limit
      })).reverse();
    }
  }

  const first = rows[0] || null;
  const last = rows[rows.length - 1] || null;
  const unreadCount = Number(threadState?.unread_count || 0);
  const directMentions = Number(threadState?.direct_mentions || 0);
  let unreadBeforeWindow = 0;
  let unreadAfterWindow = 0;
  if (unreadCount > 0 && first && last) {
    const [before, throughLast] = await Promise.all([
      prisma.agentInboundMessage.count({
        where: {
          ...buildEffectiveUnreadWhere(threadState),
          OR: [
            { received_at: { lt: first.received_at } },
            { received_at: first.received_at, id: { lt: first.id } }
          ]
        }
      }),
      prisma.agentInboundMessage.count({
        where: {
          ...buildEffectiveUnreadWhere(threadState),
          OR: [
            { received_at: { lt: last.received_at } },
            { received_at: last.received_at, id: { lte: last.id } }
          ]
        }
      })
    ]);
    unreadBeforeWindow = Number(before || 0);
    unreadAfterWindow = Math.max(0, unreadCount - Number(throughLast || 0));
  }

  const [olderCount, newerCount] = await Promise.all([
    first ? prisma.agentInboundMessage.count({ where: buildOlderWhere(threadKey, first) }) : Promise.resolve(0),
    last ? prisma.agentInboundMessage.count({ where: buildNewerWhere(threadKey, last) }) : Promise.resolve(0)
  ]);
  const windowUnread = rows.filter((message) => isEffectiveUnreadFromState(message, threadState));

  // 把小腻自己发的话按时间线并进这个窗口（仅渲染）。窗口的时间边界由 inbound 的
  // first/last 决定；newerCount===0 说明这是最新窗口，最后一条 inbound 之后的回复也要露出（无上界）。
  // 所有 anchor/未读/notify 计算全程只看 inbound rows，outbound 绝不参与——见铁律。
  const isNewestWindow = Number(newerCount) === 0;
  const outboundRows = await fetchOutboundWindowRows(prisma, threadKey, {
    lower: first ? first.received_at : null,
    upper: isNewestWindow ? null : (last ? last.received_at : null),
    limit
  });
  const merged = [
    ...rows.map((row) => ({
      sortTs: new Date(row.received_at).getTime(),
      dirRank: 0,
      id: row.id,
      message: { ...normalizeRow(row), direction: 'incoming' }
    })),
    ...outboundRows.map((row) => ({
      sortTs: new Date(row.sent_at).getTime(),
      dirRank: 1,
      id: row.id,
      message: { ...normalizeRow(mapOutboundRow(row)), direction: 'outgoing' }
    }))
  ].sort((a, b) => (a.sortTs - b.sortTs)
    || (a.dirRank - b.dirRank)
    || (Number(a.id) - Number(b.id)));

  return {
    threadKey,
    mode,
    windowSize: limit,
    cursorAnchor: first && last ? `${first.id}:${last.id}` : null,
    hasOlderMessages: olderCount > 0,
    hasNewerMessages: newerCount > 0,
    newerAvailable: newerCount,
    unreadBeforeWindow,
    unreadAfterWindow,
    reachedReadHistory: rows.some((message) => !isEffectiveUnreadFromState(message, threadState)),
    unreadCount,
    directMentions,
    messages: merged.map((entry) => entry.message),
    latestMessageId: last ? Number(last.id) : null,
    earliestMessageId: first ? Number(first.id) : null,
    windowUnreadCount: windowUnread.length
  };
}

async function markQqUsageThreadRead(input = {}, config = {}) {
  const prisma = input.prisma || config.prisma || input.getPrismaClient?.(config) || config.getPrismaClient?.(config);
  if (!prisma) {
    throw new Error('markQqUsageThreadRead requires a Prisma client');
  }
  const threadKey = typeof input.threadKey === 'string' ? input.threadKey.trim() : '';
  if (!threadKey) {
    return { threadKey: null, clearedCount: 0 };
  }
  const result = await prisma.agentInboundMessage.updateMany({
    where: { session_key: threadKey, is_read: 0 },
    data: { is_read: 1, read_at: new Date() }
  });
  await refreshThreadState(prisma, threadKey);
  return { threadKey, clearedCount: Number(result.count || 0) };
}

async function setQqUsageGroupNotificationMode(input = {}, config = {}) {
  const prisma = input.prisma || config.prisma || input.getPrismaClient?.(config) || config.getPrismaClient?.(config);
  if (!prisma) {
    throw new Error('setQqUsageGroupNotificationMode requires a Prisma client');
  }
  const groupId = toBigIntOrNull(input.groupId || input.group_id || input.peerId || input.peer_id);
  if (groupId === null || groupId <= 0n) {
    throw new Error('group_id is required');
  }
  const mode = normalizeGroupNotificationMode(input.mode || input.notificationMode || input.notification_mode);
  if (!mode) {
    throw new Error('mode must be all or mentions_only');
  }
  await ensureGroupNotificationModeColumn(prisma);
  const rows = await prisma.$queryRawUnsafe(
    `INSERT INTO group_chat_settings (group_id, is_enabled, continuous_learning_enabled, auto_reply_enabled, notification_mode, last_activity)
     VALUES ($1, 1, 0, 1, $2, NOW())
     ON CONFLICT (group_id) DO UPDATE
       SET notification_mode = EXCLUDED.notification_mode,
           last_activity = NOW()
     RETURNING group_id, notification_mode`,
    groupId,
    mode
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  return {
    groupId: row?.group_id === undefined ? Number(groupId) : Number(row.group_id),
    notificationMode: normalizeGroupNotificationMode(row?.notification_mode) || mode
  };
}

async function setQqUsageGroupNotificationAggregationSeconds(input = {}, config = {}) {
  const prisma = input.prisma || config.prisma || input.getPrismaClient?.(config) || config.getPrismaClient?.(config);
  if (!prisma) {
    throw new Error('setQqUsageGroupNotificationAggregationSeconds requires a Prisma client');
  }
  const groupId = toBigIntOrNull(input.groupId || input.group_id || input.peerId || input.peer_id);
  if (groupId === null || groupId <= 0n) {
    throw new Error('group_id is required');
  }
  const seconds = normalizeAggregationSeconds(input.seconds ?? input.notificationAggregationSeconds ?? input.notification_aggregation_seconds);
  await ensureGroupNotificationModeColumn(prisma);
  await prisma.$executeRawUnsafe(
    "ALTER TABLE group_chat_settings ADD COLUMN IF NOT EXISTS notification_aggregation_seconds INTEGER NOT NULL DEFAULT 0"
  );
  const rows = await prisma.$queryRawUnsafe(
    `INSERT INTO group_chat_settings (group_id, is_enabled, continuous_learning_enabled, auto_reply_enabled, notification_mode, notification_aggregation_seconds, last_activity)
     VALUES ($1, 1, 0, 1, 'all', $2, NOW())
     ON CONFLICT (group_id) DO UPDATE
       SET notification_aggregation_seconds = EXCLUDED.notification_aggregation_seconds,
           last_activity = NOW()
     RETURNING group_id, notification_aggregation_seconds`,
    groupId,
    seconds
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  return {
    groupId: row?.group_id === undefined ? Number(groupId) : Number(row.group_id),
    notificationAggregationSeconds: normalizeAggregationSeconds(row?.notification_aggregation_seconds ?? seconds)
  };
}

function createQqUsagePersistence(deps) {
  return {
    getQqUsageUnreadSummary(input = {}, config = {}) {
      return getQqUsageUnreadSummary({ ...input, getPrismaClient: deps.getPrismaClient }, config);
    },
    listQqUsageThreads(input = {}, config = {}) {
      return listQqUsageThreads({ ...input, getPrismaClient: deps.getPrismaClient }, config);
    },
    searchQqUsageThreads(input = {}, config = {}) {
      return listQqUsageThreads({ ...input, getPrismaClient: deps.getPrismaClient }, config);
    },
    listQqUsageThreadWindow(input = {}, config = {}) {
      return listQqUsageThreadWindow({ ...input, getPrismaClient: deps.getPrismaClient }, config);
    },
    markQqUsageThreadRead(input = {}, config = {}) {
      return markQqUsageThreadRead({ ...input, getPrismaClient: deps.getPrismaClient }, config);
    },
    setQqUsageGroupNotificationMode(input = {}, config = {}) {
      return setQqUsageGroupNotificationMode({ ...input, getPrismaClient: deps.getPrismaClient }, config);
    },
    setQqUsageGroupNotificationAggregationSeconds(input = {}, config = {}) {
      return setQqUsageGroupNotificationAggregationSeconds({ ...input, getPrismaClient: deps.getPrismaClient }, config);
    },
    recordQqUsageOutboundMessage(input = {}, config = {}) {
      return recordQqUsageOutboundMessage({ ...input, getPrismaClient: deps.getPrismaClient }, config);
    }
  };
}

module.exports = {
  createQqUsagePersistence
};
