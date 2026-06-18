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

function buildEffectiveUnreadFilter(lastReadBySession) {
  return (message) => {
    if (Number(message.is_read) !== 0) {
      return false;
    }
    const lastReadAt = lastReadBySession.get(message.session_key);
    if (!lastReadAt) {
      return true;
    }
    return new Date(message.received_at).getTime() > new Date(lastReadAt).getTime();
  };
}

async function loadLastReadBySession(prisma, sessionKeys = null) {
  const rows = await prisma.agentInboundMessage.groupBy({
    by: ['session_key'],
    where: {
      is_read: 1,
      ...(Array.isArray(sessionKeys) && sessionKeys.length > 0 ? { session_key: { in: sessionKeys } } : {})
    },
    _max: { received_at: true }
  });
  return new Map(rows.map((row) => [row.session_key, row._max.received_at]));
}

function countDirectMentions(messages) {
  return messages.reduce((sum, message) => sum + (Number(message.was_mentioned) === 1 ? 1 : 0), 0);
}

function buildEffectiveUnreadWhere(sessionKey, lastReadAt, extra = {}) {
  return {
    session_key: sessionKey,
    is_read: 0,
    ...(lastReadAt ? { received_at: { gt: lastReadAt } } : {}),
    ...extra
  };
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

async function getQqUsageUnreadSummary(input = {}, config = {}) {
  const prisma = input.prisma || config.prisma || input.getPrismaClient?.(config) || config.getPrismaClient?.(config);
  if (!prisma) {
    throw new Error('getQqUsageUnreadSummary requires a Prisma client');
  }
  const lastReadBySession = await loadLastReadBySession(prisma);
  const unreadCandidates = await prisma.agentInboundMessage.findMany({
    where: { is_read: 0 },
    orderBy: [{ received_at: 'asc' }, { id: 'asc' }]
  });
  const effectiveUnread = unreadCandidates.filter(buildEffectiveUnreadFilter(lastReadBySession));
  return {
    unreadCount: effectiveUnread.length,
    directMentions: countDirectMentions(effectiveUnread)
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
  const grouped = await prisma.agentInboundMessage.groupBy({
    by: ['session_key'],
    ...(Object.keys(where).length > 0 ? { where } : {}),
    _max: { received_at: true },
    _count: { _all: true },
    orderBy: { _max: { received_at: 'desc' } },
    skip: offset,
    take: limit + 1
  });
  const page = grouped.slice(0, limit);
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

  const lastReadBySession = await loadLastReadBySession(prisma, sessionKeys);
  const totalBySession = new Map(page.map((row) => [row.session_key, row._count._all]));
  const threadDetails = await Promise.all(sessionKeys.map(async (sessionKey) => {
    const lastReadAt = lastReadBySession.get(sessionKey);
    const unreadWhere = buildEffectiveUnreadWhere(sessionKey, lastReadAt);
    const [latest, unreadCount, directMentions] = await Promise.all([
      prisma.agentInboundMessage.findFirst({
        where: { session_key: sessionKey },
        orderBy: [{ received_at: 'desc' }, { id: 'desc' }]
      }),
      prisma.agentInboundMessage.count({ where: unreadWhere }),
      prisma.agentInboundMessage.count({
        where: buildEffectiveUnreadWhere(sessionKey, lastReadAt, { was_mentioned: 1 })
      })
    ]);
    return {
      sessionKey,
      latest,
      unreadCount,
      directMentions
    };
  }));
  const detailsBySession = new Map(threadDetails.map((detail) => [detail.sessionKey, detail]));

  return {
    offset,
    limit,
    searchQuery,
    chatType,
    hasOlderThreads: grouped.length > limit,
    hasNewerThreads: offset > 0,
    threads: sessionKeys.map((sessionKey) => {
      const detail = detailsBySession.get(sessionKey) || {};
      const latest = detail.latest || null;
      return {
        threadKey: sessionKey,
        chatType: latest?.chat_type || 'direct',
        peerId: latest?.peer_id || '',
        peerName: latest?.peer_name || null,
        accountId: latest?.account_id || null,
        unreadCount: Number(detail.unreadCount || 0),
        directMentions: Number(detail.directMentions || 0),
        totalMessages: Number(totalBySession.get(sessionKey) || 0),
        lastReceivedAt: latest?.received_at || null,
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
  const lastReadBySession = await loadLastReadBySession(prisma, [threadKey]);
  const isEffectiveUnread = buildEffectiveUnreadFilter(lastReadBySession);

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
    const unreadRows = await prisma.agentInboundMessage.findMany({
      where: { session_key: threadKey, is_read: 0 },
      orderBy: [{ received_at: 'desc' }, { id: 'desc' }]
    });
    const effectiveUnread = unreadRows.filter(isEffectiveUnread);
    if (effectiveUnread.length >= limit) {
      rows = effectiveUnread.slice(0, limit).reverse();
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
  const [olderCount, newerCount, allUnread] = await Promise.all([
    first ? prisma.agentInboundMessage.count({ where: buildOlderWhere(threadKey, first) }) : Promise.resolve(0),
    last ? prisma.agentInboundMessage.count({ where: buildNewerWhere(threadKey, last) }) : Promise.resolve(0),
    prisma.agentInboundMessage.findMany({
      where: { session_key: threadKey, is_read: 0 },
      orderBy: [{ received_at: 'asc' }, { id: 'asc' }]
    })
  ]);
  const effectiveUnread = allUnread.filter(isEffectiveUnread);
  const windowUnread = rows.filter(isEffectiveUnread);
  const firstUnreadIndex = effectiveUnread.findIndex((message) => first && message.id === first.id);
  const lastUnreadIndex = effectiveUnread.findIndex((message) => last && message.id === last.id);
  const unreadBeforeWindow = firstUnreadIndex > 0 ? firstUnreadIndex : 0;
  const unreadAfterWindow = lastUnreadIndex >= 0 ? Math.max(0, effectiveUnread.length - lastUnreadIndex - 1) : 0;

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
    reachedReadHistory: rows.some((message) => !isEffectiveUnread(message)),
    unreadCount: effectiveUnread.length,
    directMentions: countDirectMentions(effectiveUnread),
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
