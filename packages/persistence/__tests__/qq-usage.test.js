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
    groupBy: [],
    findFirst: [],
    count: [],
    findMany: []
  };
  const prisma = {
    agentInboundMessage: {
      groupBy: async (query) => {
        calls.groupBy.push(query);
        if (query.where?.is_read === 1) {
          return [
            { session_key: 'qq:group:253631878', _max: { received_at: new Date('2026-06-18T11:00:00.000Z') } }
          ];
        }
        return [
          {
            session_key: 'qq:direct:1129974489:85178516',
            _max: { received_at: directLatest.received_at },
            _count: { _all: 442 }
          },
          {
            session_key: 'qq:group:253631878',
            _max: { received_at: groupLatest.received_at },
            _count: { _all: 12875 }
          },
          {
            session_key: 'qq:group:older',
            _max: { received_at: new Date('2026-06-18T10:00:00.000Z') },
            _count: { _all: 4 }
          }
        ];
      },
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
      count: async (query) => {
        calls.count.push(query);
        const sessionKey = query.where.session_key;
        const mentioned = query.where.was_mentioned === 1;
        if (sessionKey === 'qq:direct:1129974489:85178516') {
          return mentioned ? 0 : 3;
        }
        if (sessionKey === 'qq:group:253631878') {
          assert.deepEqual(query.where.received_at, { gt: new Date('2026-06-18T11:00:00.000Z') });
          return mentioned ? 2 : 94;
        }
        return 0;
      },
      findMany: async (query) => {
        calls.findMany.push(query);
        throw new Error('listQqUsageThreads should not load full message history');
      }
    }
  };
  const persistence = createQqUsagePersistence({ getPrismaClient: () => prisma });

  const result = await persistence.listQqUsageThreads({ limit: 2, offset: 0 });

  assert.equal(result.hasOlderThreads, true);
  assert.equal(result.threads.length, 2);
  assert.equal(result.threads[0].threadKey, 'qq:direct:1129974489:85178516');
  assert.equal(result.threads[0].unreadCount, 3);
  assert.equal(result.threads[0].totalMessages, 442);
  assert.equal(result.threads[0].latestMessage.id, 100);
  assert.equal(result.threads[1].threadKey, 'qq:group:253631878');
  assert.equal(result.threads[1].unreadCount, 94);
  assert.equal(result.threads[1].directMentions, 2);
  assert.equal(result.threads[1].totalMessages, 12875);
  assert.equal(calls.findMany.length, 0);
  assert.equal(calls.findFirst.length, 2);
  assert.equal(calls.count.length, 4);
});

test('searchQqUsageThreads filters visible chats by stored name or QQ id', async () => {
  const calls = {
    groupBy: [],
    findFirst: [],
    count: []
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
    agentInboundMessage: {
      groupBy: async (query) => {
        calls.groupBy.push(query);
        if (query.where?.is_read === 1) {
          return [];
        }
        assert.equal(query.where.chat_type, 'group');
        assert.deepEqual(query.where.OR, [
          { peer_name: { contains: '朋友', mode: 'insensitive' } },
          { peer_id: { contains: '朋友' } },
          { session_key: { contains: '朋友' } }
        ]);
        return [{
          session_key: 'qq:group:253631878',
          _max: { received_at: latest.received_at },
          _count: { _all: 12876 }
        }];
      },
      findFirst: async (query) => {
        calls.findFirst.push(query);
        assert.equal(query.where.session_key, 'qq:group:253631878');
        return latest;
      },
      count: async (query) => {
        calls.count.push(query);
        assert.equal(query.where.session_key, 'qq:group:253631878');
        return query.where.was_mentioned === 1 ? 0 : 94;
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
  assert.equal(calls.findFirst.length, 1);
  assert.equal(calls.count.length, 2);
});
