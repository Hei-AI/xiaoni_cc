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

function normalizeChatType(value) {
  return value === 'group' || value === 'direct' ? value : null;
}

function normalizeSearchQuery(value) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 80) : '';
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
          select: { group_id: true, is_enabled: true }
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
      notificationMuted: Number(row.is_enabled) !== 1
    });
  }
  for (const row of privateSettings) {
    result.set(`direct:${String(row.user_id)}`, {
      imReceiveEnabled: Number(row.is_enabled) === 1,
      notificationMuted: Number(row.is_enabled) !== 1
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
  const [totalMessages, unreadCount, directMentions] = await Promise.all([
    prisma.agentInboundMessage.count({ where: { session_key: threadKey } }),
    prisma.agentInboundMessage.count({ where: buildEffectiveUnreadWhere(threadState) }),
    prisma.agentInboundMessage.count({ where: buildEffectiveUnreadWhere(threadState, { was_mentioned: 1 }) })
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
        notificationMuted: false
      };
      return {
        threadKey: state.session_key,
        chatType,
        peerId,
        peerName: state.peer_name || latest?.peer_name || null,
        accountId: state.account_id || latest?.account_id || null,
        imReceiveEnabled: notificationState.imReceiveEnabled,
        notificationMuted: notificationState.notificationMuted,
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
  const mode = input.mode === 'older' || input.mode === 'newer' ? input.mode : 'latest';
  const anchor = mode === 'latest' ? null : await getMessageAnchor(prisma, input.anchorMessageId);
  const threadState = await getThreadState(prisma, threadKey) || await refreshThreadState(prisma, threadKey);

  let rows;
  if (mode === 'older') {
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
    messages: rows.map(normalizeRow),
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
    }
  };
}

module.exports = {
  createQqUsagePersistence
};
