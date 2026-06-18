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
    findMany: []
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
  assert.equal(calls.threadFindMany.length, 1);
  assert.equal(calls.findMany.length, 1);
  assert.equal(calls.findFirst.length, 0);
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
