'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createQqUsagePersistence } = require('../qq-usage');

test('listQqUsageThreads summarizes visible threads without loading full message history', async () => {
  const groupLatest = {
    id: 200n,
    session_key: 'qq:group:253631878',
    chat_type: 'group',
    peer_id: '253631878',
    peer_name: 'Test Group',
    sender_id: '3994058476',
    sender_name: '小伊',
    account_id: '1129974489',
    is_read: 0,
    received_at: new Date('2026-06-18T12:17:21.679Z'),
    body_for_agent: 'latest group message',
    raw_body: 'latest group message',
    was_mentioned: 0,
    raw_payload: {}
  };
  const directLatest = {
    id: 100n,
    session_key: 'qq:direct:1129974489:85178516',
    chat_type: 'direct',
    peer_id: '85178516',
    peer_name: '李阿花',
    sender_id: '85178516',
    sender_name: '李阿花',
    account_id: '1129974489',
    is_read: 0,
    received_at: new Date('2026-06-18T12:23:29.924Z'),
    body_for_agent: 'latest private message',
    raw_body: 'latest private message',
    was_mentioned: 0,
    raw_payload: {}
  };
  const calls = {
    threadFindMany: [],
    findFirst: [],
    findMany: [],
    groupSettingFindMany: [],
    privateSettingFindMany: []
  };
  const prisma = {
    agentInboundThreadState: {
      findMany: async (query) => {
        calls.threadFindMany.push(query);
        return [
          {
            session_key: 'qq:direct:1129974489:85178516',
            chat_type: 'direct',
            peer_id: '85178516',
            peer_name: '李阿花',
            account_id: '1129974489',
            unread_count: 3,
            direct_mentions: 0,
            total_messages: 442,
            last_message_id: directLatest.id,
            last_received_at: directLatest.received_at
          },
          {
            session_key: 'qq:group:253631878',
            chat_type: 'group',
            peer_id: '253631878',
            peer_name: 'Test Group',
            account_id: '1129974489',
            unread_count: 94,
            direct_mentions: 2,
            total_messages: 12875,
            last_message_id: groupLatest.id,
            last_received_at: groupLatest.received_at
          },
          {
            session_key: 'qq:group:older',
            chat_type: 'group',
            peer_id: 'older',
            peer_name: 'Older Group',
            account_id: '1129974489',
            unread_count: 0,
            direct_mentions: 0,
            total_messages: 4,
            last_message_id: 50n,
            last_received_at: new Date('2026-06-18T10:00:00.000Z')
          }
        ];
      }
    },
    agentInboundMessage: {
      findFirst: async (query) => {
        calls.findFirst.push(query);
        if (query.where.session_key === 'qq:direct:1129974489:85178516') {
          return directLatest;
        }
        if (query.where.session_key === 'qq:group:253631878') {
          return groupLatest;
        }
        return null;
      },
      findMany: async (query) => {
        calls.findMany.push(query);
        assert.deepEqual(query.where.id.in, [directLatest.id, groupLatest.id]);
        return [directLatest, groupLatest];
      }
    },
    groupChatSetting: {
      findMany: async (query) => {
        calls.groupSettingFindMany.push(query);
        assert.deepEqual(query.where.group_id.in, [253631878n]);
        return [{
          group_id: 253631878n,
          is_enabled: 0,
          notification_aggregation_seconds: 30
        }];
      }
    },
    privateChatSetting: {
      findMany: async (query) => {
        calls.privateSettingFindMany.push(query);
        assert.deepEqual(query.where.user_id.in, [85178516n]);
        return [{
          user_id: 85178516n,
          is_enabled: 1
        }];
      }
    }
  };
  const persistence = createQqUsagePersistence({ getPrismaClient: () => prisma });

  const result = await persistence.listQqUsageThreads({ limit: 2, offset: 0 });

  assert.equal(result.hasOlderThreads, true);
  assert.equal(result.threads.length, 2);
  assert.equal(result.threads[0].threadKey, 'qq:direct:1129974489:85178516');
  assert.equal(result.threads[0].notificationMuted, false);
  assert.equal(result.threads[0].unreadCount, 3);
  assert.equal(result.threads[0].totalMessages, 442);
  assert.equal(result.threads[0].latestMessage.id, 100);
  assert.equal(result.threads[1].threadKey, 'qq:group:253631878');
  assert.equal(result.threads[1].notificationMuted, true);
  assert.equal(result.threads[1].notificationAggregationSeconds, 30);
  assert.equal(result.threads[1].unreadCount, 94);
  assert.equal(result.threads[1].directMentions, 2);
  assert.equal(result.threads[1].totalMessages, 12875);
  assert.equal(calls.threadFindMany.length, 1);
  assert.equal(calls.findMany.length, 1);
  assert.equal(calls.findFirst.length, 0);
  assert.equal(calls.groupSettingFindMany.length, 1);
  assert.equal(calls.privateSettingFindMany.length, 1);
});

test('setQqUsageGroupNotificationAggregationSeconds stores ordinary group aggregation delay', async () => {
  const calls = {
    execute: [],
    query: []
  };
  const prisma = {
    $executeRawUnsafe: async (...args) => {
      calls.execute.push(args);
    },
    $queryRawUnsafe: async (...args) => {
      calls.query.push(args);
      return [{
        group_id: 253631878n,
        notification_aggregation_seconds: 45
      }];
    }
  };
  const persistence = createQqUsagePersistence({ getPrismaClient: () => prisma });

  const result = await persistence.setQqUsageGroupNotificationAggregationSeconds({
    groupId: '253631878',
    seconds: '45'
  });

  assert.equal(result.groupId, 253631878);
  assert.equal(result.notificationAggregationSeconds, 45);
  assert.equal(calls.execute.length, 2);
  assert.match(calls.execute[1][0], /notification_aggregation_seconds/);
  assert.equal(calls.query.length, 1);
  assert.equal(calls.query[0][1], 253631878n);
  assert.equal(calls.query[0][2], 45);
});

test('searchQqUsageThreads filters visible chats by stored name or QQ id', async () => {
  const calls = {
    threadFindMany: [],
    findMany: []
  };
  const latest = {
    id: 300n,
    session_key: 'qq:group:253631878',
    chat_type: 'group',
    peer_id: '253631878',
    peer_name: '朋友群',
    sender_id: '3994058476',
    sender_name: '小伊',
    account_id: '1129974489',
    is_read: 0,
    received_at: new Date('2026-06-18T12:34:04.345Z'),
    body_for_agent: 'latest searchable message',
    raw_body: 'latest searchable message',
    was_mentioned: 0,
    raw_payload: {}
  };
  const prisma = {
    agentInboundThreadState: {
      findMany: async (query) => {
        calls.threadFindMany.push(query);
        assert.equal(query.where.chat_type, 'group');
        assert.deepEqual(query.where.OR, [
          { peer_name: { contains: '朋友', mode: 'insensitive' } },
          { peer_id: { contains: '朋友' } },
          { session_key: { contains: '朋友' } }
        ]);
        return [{
          session_key: 'qq:group:253631878',
          chat_type: 'group',
          peer_id: '253631878',
          peer_name: '朋友群',
          account_id: '1129974489',
          unread_count: 94,
          direct_mentions: 0,
          total_messages: 12876,
          last_message_id: latest.id,
          last_received_at: latest.received_at
        }];
      }
    },
    agentInboundMessage: {
      findMany: async (query) => {
        calls.findMany.push(query);
        assert.deepEqual(query.where.id.in, [latest.id]);
        return [latest];
      }
    }
  };
  const persistence = createQqUsagePersistence({ getPrismaClient: () => prisma });

  const result = await persistence.searchQqUsageThreads({ query: '朋友', chatType: 'group', limit: 10 });

  assert.equal(result.searchQuery, '朋友');
  assert.equal(result.chatType, 'group');
  assert.equal(result.threads.length, 1);
  assert.equal(result.threads[0].peerName, '朋友群');
  assert.equal(result.threads[0].unreadCount, 94);
  assert.equal(calls.threadFindMany.length, 1);
  assert.equal(calls.findMany.length, 1);
});

test('markQqUsageThreadRead refreshes latest unread timestamp with unread cursor', async () => {
  const latestReceivedAt = new Date('2026-06-19T02:13:06.110Z');
  const calls = {
    updateMany: [],
    counts: [],
    aggregates: [],
    upserts: []
  };
  const prisma = {
    agentInboundMessage: {
      updateMany: async (query) => {
        calls.updateMany.push(query);
        assert.deepEqual(query.where, {
          session_key: 'qq:direct:1129974489:85178516',
          is_read: 0
        });
        return { count: 9 };
      },
      findFirst: async (query) => {
        assert.deepEqual(query.where, { session_key: 'qq:direct:1129974489:85178516' });
        assert.deepEqual(query.orderBy, [{ received_at: 'desc' }, { id: 'desc' }]);
        return {
          id: 18521n,
          session_key: 'qq:direct:1129974489:85178516',
          chat_type: 'direct',
          peer_id: '85178516',
          peer_name: '李阿花',
          account_id: '1129974489',
          received_at: latestReceivedAt
        };
      },
      aggregate: async (query) => {
        calls.aggregates.push(query);
        if (query.where.is_read === 1) {
          return { _max: { received_at: latestReceivedAt } };
        }
        assert.deepEqual(query.where, {
          session_key: 'qq:direct:1129974489:85178516',
          is_read: 0,
          received_at: { gt: latestReceivedAt }
        });
        return { _max: { received_at: null } };
      },
      count: async (query) => {
        calls.counts.push(query);
        if (query.where.is_read === 0) {
          assert.deepEqual(query.where.received_at, { gt: latestReceivedAt });
          return 0;
        }
        return 448;
      }
    },
    agentInboundThreadState: {
      upsert: async (query) => {
        calls.upserts.push(query);
        return query.update;
      }
    }
  };
  const persistence = createQqUsagePersistence({ getPrismaClient: () => prisma });

  const result = await persistence.markQqUsageThreadRead({
    threadKey: 'qq:direct:1129974489:85178516'
  });

  assert.deepEqual(result, {
    threadKey: 'qq:direct:1129974489:85178516',
    clearedCount: 9
  });
  assert.equal(calls.aggregates.length, 2);
  assert.equal(calls.upserts.length, 1);
  assert.equal(calls.upserts[0].update.unread_count, 0);
  assert.equal(calls.upserts[0].update.direct_mentions, 0);
  assert.equal(calls.upserts[0].update.latest_unread_received_at, null);
  assert.equal(calls.upserts[0].update.last_read_received_at, latestReceivedAt);
});

test('recordQqUsageOutboundMessage persists a self-sent message into agent_outbound_messages', async () => {
  const calls = { execute: [], query: [] };
  const prisma = {
    $executeRawUnsafe: async (...args) => { calls.execute.push(args); },
    $queryRawUnsafe: async (...args) => {
      calls.query.push(args);
      return [{ id: 7n }];
    }
  };
  const persistence = createQqUsagePersistence({ getPrismaClient: () => prisma });

  const result = await persistence.recordQqUsageOutboundMessage({
    sessionKey: 'qq:direct:1129974489:85178516',
    chatType: 'direct',
    peerId: '85178516',
    peerName: '李阿花',
    accountId: '1129974489',
    senderId: '1129974489',
    deliveryMessageId: '9001',
    bodyForAgent: '在的，怎么啦',
    sentAt: '2026-06-19T02:00:00.000Z',
    traceId: 'trace-1',
    runId: 'run-1'
  });

  assert.deepEqual(result, { id: 7 });
  // ensure schema ran (CREATE TABLE + index), then a single INSERT ... RETURNING id
  assert.ok(calls.execute.length >= 1);
  assert.match(calls.execute[0][0], /CREATE TABLE IF NOT EXISTS agent_outbound_messages/);
  assert.equal(calls.query.length, 1);
  assert.match(calls.query[0][0], /INSERT INTO agent_outbound_messages/);
  assert.equal(calls.query[0][2], 'qq:direct:1129974489:85178516'); // $2 session_key
  assert.equal(calls.query[0][7], '小腻'); // $7 sender_name (defaulted)
  assert.equal(calls.query[0][8], '9001'); // $8 delivery_message_id
  assert.equal(calls.query[0][10], '在的，怎么啦'); // $10 body_for_agent
});

test('listQqUsageThreadWindow interleaves self-sent messages by timestamp without touching anchors/unread', async () => {
  const threadKey = 'qq:direct:1129974489:85178516';
  const inbound1 = {
    id: 100n, session_key: threadKey, chat_type: 'direct', peer_id: '85178516', peer_name: '李阿花',
    sender_id: '85178516', sender_name: '李阿花', account_id: '1129974489', is_read: 1,
    received_at: new Date('2026-06-19T02:00:00.000Z'), body_for_agent: '在吗', raw_body: '在吗',
    was_mentioned: 0, raw_payload: {}, inbound_context: {}
  };
  const inbound2 = {
    id: 101n, session_key: threadKey, chat_type: 'direct', peer_id: '85178516', peer_name: '李阿花',
    sender_id: '85178516', sender_name: '李阿花', account_id: '1129974489', is_read: 1,
    received_at: new Date('2026-06-19T02:00:20.000Z'), body_for_agent: '在干嘛', raw_body: '在干嘛',
    was_mentioned: 0, raw_payload: {}, inbound_context: {}
  };
  const prisma = {
    agentInboundThreadState: {
      findUnique: async () => ({
        session_key: threadKey, chat_type: 'direct', peer_id: '85178516', account_id: '1129974489',
        unread_count: 0, direct_mentions: 0, last_read_received_at: null
      })
    },
    agentInboundMessage: {
      findMany: async () => [inbound2, inbound1], // desc; service reverses to asc
      count: async () => 0,
      aggregate: async () => ({ _max: { received_at: null } })
    },
    $executeRawUnsafe: async () => {},
    $queryRawUnsafe: async () => ([
      // one self-sent message between the two inbound messages (desc order; service reverses)
      {
        id: 500n, chat_type: 'direct', session_key: threadKey, peer_id: '85178516', peer_name: '李阿花',
        account_id: '1129974489', sender_id: '1129974489', sender_name: '小腻',
        delivery_message_id: '9001', content_kind: 'text',
        body_for_agent: '在的，刚在看书', raw_body: '在的，刚在看书', reply_to_id: null,
        sent_at: new Date('2026-06-19T02:00:10.000Z')
      }
    ])
  };
  const persistence = createQqUsagePersistence({ getPrismaClient: () => prisma });

  const window = await persistence.listQqUsageThreadWindow({ threadKey, mode: 'latest', limit: 10 });

  // merged, timestamp-ordered: inbound(在吗) -> outbound(在的...) -> inbound(在干嘛)
  assert.equal(window.messages.length, 3);
  assert.equal(window.messages[0].direction, 'incoming');
  assert.equal(window.messages[0].body_for_agent, '在吗');
  assert.equal(window.messages[1].direction, 'outgoing');
  assert.equal(window.messages[1].body_for_agent, '在的，刚在看书');
  assert.equal(window.messages[1].sender_name, '小腻');
  assert.equal(window.messages[2].direction, 'incoming');
  assert.equal(window.messages[2].body_for_agent, '在干嘛');
  // anchors + latest/earliest stay inbound-only (never an outbound id)
  assert.equal(window.earliestMessageId, 100);
  assert.equal(window.latestMessageId, 101);
  assert.equal(window.cursorAnchor, '100:101');
  assert.equal(window.unreadCount, 0);
});

test('listQqUsageThreadWindow mode=around centers on the anchor and seeds scroll cursors', async () => {
  const threadKey = 'qq:direct:1129974489:85178516';
  // message_sid = the OneBot id (what 小腻 sees + passes to focus). Anchor now
  // resolves by message_sid, not the internal autoincrement id.
  const mk = (id, ts, body) => ({
    id: BigInt(id), message_sid: String(700000000 + id), session_key: threadKey, chat_type: 'direct',
    peer_id: '85178516', peer_name: '李阿花',
    sender_id: '85178516', sender_name: '李阿花', account_id: '1129974489', is_read: 1,
    received_at: new Date(ts), body_for_agent: body, raw_body: body,
    was_mentioned: 0, raw_payload: {}, inbound_context: {}
  });
  const anchorRow = mk(200, '2026-07-02T01:27:31.000Z', '话说 你现在用qqusage');
  const older = [mk(199, '2026-07-02T01:26:00.000Z', 'older-a'), mk(198, '2026-07-02T01:25:00.000Z', 'older-b')]; // desc
  const newer = [mk(201, '2026-07-02T01:31:50.000Z', '这个你看看')]; // asc
  const prisma = {
    agentInboundThreadState: {
      findUnique: async () => ({
        session_key: threadKey, chat_type: 'direct', peer_id: '85178516', account_id: '1129974489',
        unread_count: 0, direct_mentions: 0, last_read_received_at: null
      })
    },
    agentInboundMessage: {
      findFirst: async ({ where }) => (String(where.message_sid) === anchorRow.message_sid ? anchorRow : null),
      findMany: async (q) => {
        const dir = Array.isArray(q.orderBy) ? q.orderBy[0].received_at : q.orderBy.received_at;
        return dir === 'desc' ? older.slice(0, q.take) : newer.slice(0, q.take);
      },
      count: async () => 0,
      aggregate: async () => ({ _max: { received_at: null } })
    },
    $executeRawUnsafe: async () => {},
    $queryRawUnsafe: async () => ([])
  };
  const persistence = createQqUsagePersistence({ getPrismaClient: () => prisma });

  const window = await persistence.listQqUsageThreadWindow({ threadKey, mode: 'around', anchorMessageId: anchorRow.message_sid, limit: 10 });

  // older (reversed to asc) + anchor + newer, ascending, anchor in the middle
  assert.equal(window.anchorMissing, undefined);
  assert.deepEqual(window.messages.map((m) => m.body_for_agent), ['older-b', 'older-a', '话说 你现在用qqusage', '这个你看看']);
  // cursors seed from the window edges so scroll_private older/newer continues from here
  assert.equal(window.earliestMessageId, 198);
  assert.equal(window.latestMessageId, 201);
});

test('listQqUsageThreadWindow mode=around returns anchorMissing when the quoted message is gone', async () => {
  const threadKey = 'qq:direct:1129974489:85178516';
  const prisma = {
    agentInboundThreadState: {
      findUnique: async () => ({
        session_key: threadKey, chat_type: 'direct', peer_id: '85178516', account_id: '1129974489',
        unread_count: 0, direct_mentions: 0, last_read_received_at: null
      })
    },
    agentInboundMessage: {
      findFirst: async () => null, // pruned / unknown id → no inbound anchor by message_sid
      findUnique: async () => null, // and no inbound anchor by internal-id fallback either
      findMany: async () => [],
      count: async () => 0,
      aggregate: async () => ({ _max: { received_at: null } })
    },
    $executeRawUnsafe: async () => {},
    $queryRawUnsafe: async () => ([]) // no outbound match either → anchorMissing
  };
  const persistence = createQqUsagePersistence({ getPrismaClient: () => prisma });

  const window = await persistence.listQqUsageThreadWindow({ threadKey, mode: 'around', anchorMessageId: '999999', limit: 10 });

  assert.equal(window.anchorMissing, true);
  assert.equal(window.messages.length, 0);
  assert.equal(window.earliestMessageId, null);
  assert.equal(window.latestMessageId, null);
});

test('mode=around resolves a scroll cursor by internal id when message_sid does not match (regression)', async () => {
  // scroll_private/scroll_group feed back the window's earliest/latest, which are the
  // INTERNAL inbound row id — not a QQ message_sid. getMessageAnchor must fall back to
  // an internal-id lookup or pagination breaks (the OneBot-id-handle switch regressed this).
  const threadKey = 'qq:direct:1129974489:85178516';
  const mk = (id, ts, body) => ({
    id: BigInt(id), message_sid: String(700000000 + id), session_key: threadKey, chat_type: 'direct',
    peer_id: '85178516', peer_name: '李阿花', sender_id: '85178516', sender_name: '李阿花',
    account_id: '1129974489', is_read: 1, received_at: new Date(ts), body_for_agent: body, raw_body: body,
    was_mentioned: 0, raw_payload: {}, inbound_context: {}
  });
  const anchorRow = mk(201, '2026-07-02T01:27:31.000Z', 'anchor');
  const older = [mk(200, '2026-07-02T01:26:00.000Z', 'older')];
  const prisma = {
    agentInboundThreadState: {
      findUnique: async () => ({ session_key: threadKey, chat_type: 'direct', peer_id: '85178516', account_id: '1129974489', unread_count: 0, direct_mentions: 0, last_read_received_at: null })
    },
    agentInboundMessage: {
      findFirst: async () => null, // cursor 201 is an internal id, not a QQ message_sid → no match
      findUnique: async ({ where }) => (String(where.id) === '201' ? anchorRow : null), // internal-id fallback resolves it
      findMany: async (q) => {
        const dir = Array.isArray(q.orderBy) ? q.orderBy[0].received_at : q.orderBy.received_at;
        return dir === 'desc' ? older.slice(0, q.take) : [];
      },
      count: async () => 0,
      aggregate: async () => ({ _max: { received_at: null } })
    },
    $executeRawUnsafe: async () => {},
    $queryRawUnsafe: async () => ([])
  };
  const persistence = createQqUsagePersistence({ getPrismaClient: () => prisma });
  const window = await persistence.listQqUsageThreadWindow({ threadKey, mode: 'around', anchorMessageId: 201, limit: 10 });
  assert.equal(window.anchorMissing, undefined);
  assert.deepEqual(window.messages.map((m) => m.body_for_agent), ['older', 'anchor']);
});

// 读取侧引用正文回填:入站时 reply_to_body 可能没解析到(历史上只查 30 分钟内存
// 缓存,引用旧消息必 miss)。attachReplyJumpHandles 既然为跳转句柄摸到了原消息行,
// 就地回填正文/发送者。复刻真实事故:inbound 37923 引用小腻 outbound 3532,
// reply_to_body=NULL → 曾渲染成「(非文字消息)」。
test('listQqUsageThreadWindow backfills reply_to_body from the quoted outbound row (37923 shape)', async () => {
  const threadKey = 'qq:direct:1129974489:85178516';
  const replyRow = {
    id: 37923n, message_sid: '858375072', session_key: threadKey, chat_type: 'direct',
    peer_id: '85178516', peer_name: '李阿花',
    sender_id: '85178516', sender_name: '李阿花', account_id: '1129974489', is_read: 1,
    received_at: new Date('2026-07-23T01:46:52.625Z'),
    body_for_agent: '可是 这样的话 你不就变成了聊天bot了么',
    raw_body: '可是 这样的话 你不就变成了聊天bot了么',
    reply_to_id: '1652226028', reply_to_body: null, reply_to_sender: null,
    was_mentioned: 0, raw_payload: {}, inbound_context: {}
  };
  const prisma = {
    agentInboundThreadState: {
      findUnique: async () => ({
        session_key: threadKey, chat_type: 'direct', peer_id: '85178516', account_id: '1129974489',
        unread_count: 0, direct_mentions: 0, last_read_received_at: null
      })
    },
    agentInboundMessage: {
      findMany: async () => [replyRow],
      count: async () => 0,
      aggregate: async () => ({ _max: { received_at: null } })
    },
    $executeRawUnsafe: async () => {},
    $queryRawUnsafe: async (sql) => {
      if (/= ANY\(\$1::text\[\]\)/.test(sql)) {
        // reply resolution query (both tables UNIONed): quoted row is 小腻's outbound
        return [{
          id: '1652226028', sender_id: '1129974489', sender_name: '小腻',
          raw_body: null, body_for_agent: '建议在压缩指令里加一条硬规则'
        }];
      }
      // outbound window merge: no self-sent messages in this window
      return [];
    }
  };
  const persistence = createQqUsagePersistence({ getPrismaClient: () => prisma });

  const window = await persistence.listQqUsageThreadWindow({ threadKey, mode: 'latest', limit: 10 });

  assert.equal(window.messages.length, 1);
  const message = window.messages[0];
  assert.equal(message.reply_to_handle, '1652226028');
  assert.equal(message.reply_to_body, '建议在压缩指令里加一条硬规则');
  assert.equal(message.reply_to_sender, '小腻');
});

test('listQqUsageThreadWindow keeps ingest-time reply_to_body over the read-time backfill', async () => {
  const threadKey = 'qq:direct:1129974489:85178516';
  const replyRow = {
    id: 100n, message_sid: '700000100', session_key: threadKey, chat_type: 'direct',
    peer_id: '85178516', peer_name: '李阿花',
    sender_id: '85178516', sender_name: '李阿花', account_id: '1129974489', is_read: 1,
    received_at: new Date('2026-07-23T02:00:00.000Z'),
    body_for_agent: '收到', raw_body: '收到',
    reply_to_id: '9001', reply_to_body: '入站时已解析的正文', reply_to_sender: '李阿花',
    was_mentioned: 0, raw_payload: {}, inbound_context: {}
  };
  const prisma = {
    agentInboundThreadState: {
      findUnique: async () => ({
        session_key: threadKey, chat_type: 'direct', peer_id: '85178516', account_id: '1129974489',
        unread_count: 0, direct_mentions: 0, last_read_received_at: null
      })
    },
    agentInboundMessage: {
      findMany: async () => [replyRow],
      count: async () => 0,
      aggregate: async () => ({ _max: { received_at: null } })
    },
    $executeRawUnsafe: async () => {},
    $queryRawUnsafe: async (sql) => {
      if (/= ANY\(\$1::text\[\]\)/.test(sql)) {
        return [{
          id: '9001', sender_id: '85178516', sender_name: '别人',
          raw_body: '库里的另一个正文', body_for_agent: '库里的另一个正文'
        }];
      }
      return [];
    }
  };
  const persistence = createQqUsagePersistence({ getPrismaClient: () => prisma });

  const window = await persistence.listQqUsageThreadWindow({ threadKey, mode: 'latest', limit: 10 });

  const message = window.messages[0];
  assert.equal(message.reply_to_handle, '9001');
  assert.equal(message.reply_to_body, '入站时已解析的正文');
  assert.equal(message.reply_to_sender, '李阿花');
});
