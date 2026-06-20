'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createInboundInboxPersistence } = require('../inbound-inbox');

function createInboxRow(overrides = {}) {
  return {
    id: overrides.id || 1,
    trace_id: overrides.trace_id || 'trace-1',
    source: overrides.source || 'napcat',
    message_sid: overrides.message_sid || 'sid-1',
    dedupe_key: overrides.dedupe_key || 'napcat:sid-1',
    chat_type: overrides.chat_type || 'group',
    session_key: overrides.session_key || 'qq:group:42',
    peer_id: overrides.peer_id || '42',
    peer_name: overrides.peer_name || 'Test Group',
    sender_id: overrides.sender_id || '10001',
    sender_name: overrides.sender_name || 'Alice',
    account_id: overrides.account_id || '1129974489',
    is_read: overrides.is_read ?? 0,
    read_at: overrides.read_at ?? null,
    received_at: overrides.received_at || '2026-06-09 12:00:00.000',
    message_timestamp: overrides.message_timestamp || '2026-06-09 12:00:00.000',
    body_for_agent: overrides.body_for_agent || 'hello',
    raw_body: overrides.raw_body || 'hello',
    command_body: overrides.command_body || 'hello',
    was_mentioned: overrides.was_mentioned ?? 1,
    reply_to_id: overrides.reply_to_id || null,
    reply_to_body: overrides.reply_to_body || null,
    reply_to_sender: overrides.reply_to_sender || null,
    raw_payload: overrides.raw_payload || JSON.stringify({ raw: true }),
    inbound_context: overrides.inbound_context || JSON.stringify({
      ChatType: 'group',
      SessionKey: 'qq:group:42',
      BodyForAgent: overrides.body_for_agent || 'hello'
    }),
    ...(typeof overrides.inserted !== 'undefined' ? { inserted: overrides.inserted } : {})
  };
}

test('persistInboundMessage writes expected agent_inbound_messages fields', async () => {
  const executes = [];
  const queries = [];
  let insertParams = null;
  const sqlAdapter = {
    execute: async (sql, params = []) => {
      executes.push({ sql, params });
      return 1;
    },
    query: async (sql, params = []) => {
      queries.push({ sql, params });
      insertParams = params;
      return [createInboxRow({
        inserted: true,
        id: 42,
        trace_id: insertParams[0],
        source: insertParams[1],
        message_sid: insertParams[2],
        dedupe_key: insertParams[3],
        chat_type: insertParams[4],
        session_key: insertParams[5],
        peer_id: insertParams[6],
        peer_name: insertParams[7],
        sender_id: insertParams[8],
        sender_name: insertParams[9],
        account_id: insertParams[10],
        message_timestamp: insertParams[12],
        body_for_agent: insertParams[13],
        raw_body: insertParams[14],
        command_body: insertParams[15],
        was_mentioned: insertParams[16],
        reply_to_id: insertParams[17],
        reply_to_body: insertParams[18],
        reply_to_sender: insertParams[19],
        raw_payload: insertParams[20],
        inbound_context: insertParams[21]
      })];
    },
    withTransaction: async () => {
      throw new Error('persist should not open a transaction');
    },
    close: async () => undefined
  };
  const persistence = createInboundInboxPersistence({ sqlAdapter });

  const message = await persistence.persistInboundMessage({
    traceId: 'trace-42',
    source: 'napcat',
    rawPayload: { post_type: 'message' },
    inboundContext: {
      ChatType: 'group',
      SessionKey: 'qq:group:42',
      NativeChannelId: '42',
      GroupSubject: 'Test Group',
      SenderId: '10001',
      SenderName: 'Alice',
      AccountId: '1129974489',
      MessageSid: 'sid-42',
      Timestamp: Date.parse('2026-06-09T04:00:00.000Z'),
      Body: 'hello',
      BodyForAgent: 'hello',
      BodyForCommands: 'hello',
      RawBody: 'hello',
      CommandBody: 'hello',
      WasMentioned: true,
      ReplyToId: 'reply-1',
      ReplyToBody: 'previous',
      ReplyToSender: 'Bob',
      CommandAuthorized: false
    }
  });

  assert.equal(queries.length, 1);
  assert.ok(queries[0].sql.includes('INSERT INTO agent_inbound_messages'));
  assert.equal(queries[0].params[0], 'trace-42');
  assert.equal(queries[0].params[1], 'napcat');
  assert.equal(queries[0].params[2], 'sid-42');
  assert.equal(queries[0].params[3], 'napcat:sid-42');
  assert.equal(queries[0].params[4], 'group');
  assert.equal(queries[0].params[5], 'qq:group:42');
  assert.equal(queries[0].params[6], '42');
  assert.equal(queries[0].params[7], 'Test Group');
  assert.equal(queries[0].params[8], '10001');
  assert.equal(queries[0].params[9], 'Alice');
  assert.equal(queries[0].params[10], '1129974489');
  assert.equal(queries[0].params[13], 'hello');
  assert.equal(queries[0].params[16], 1);
  assert.deepEqual(JSON.parse(queries[0].params[20]), { post_type: 'message' });
  assert.equal(executes.length, 1);
  assert.ok(executes[0].sql.includes('INSERT INTO agent_inbound_thread_states'));
  assert.match(executes[0].sql, /GROUP BY lr\.last_read_received_at/);
  assert.deepEqual(executes[0].params, ['qq:group:42']);
  assert.equal(message.id, 42);
  assert.equal(message.messageSid, 'sid-42');
  assert.equal(message.rawBody, 'hello');
  assert.equal(message.wasMentioned, true);
});

test('claimInboundMessages selects effective unread messages and marks them read', async () => {
  const queryCalls = [];
  const executeCalls = [];
  const tx = {
    query: async (sql, params = []) => {
      queryCalls.push({ sql, params });
      if (sql.includes('SELECT m.id')) {
        assert.ok(sql.includes('m.is_read = 0 AND m.received_at > COALESCE'));
        assert.deepEqual(params, ['qq:group:42', 2]);
        return [{ id: 2 }];
      }
      if (sql.includes('SELECT id') && sql.includes('id IN (?)')) {
        assert.deepEqual(params, [5, 'qq:group:42']);
        return [{ id: 5 }];
      }
      if (sql.includes('SELECT *')) {
        assert.deepEqual(params, [2, 5]);
        return [
          createInboxRow({ id: 2, message_sid: 'sid-2', dedupe_key: 'napcat:sid-2', body_for_agent: 'older' }),
          createInboxRow({ id: 5, message_sid: 'sid-5', dedupe_key: 'napcat:sid-5', body_for_agent: 'included' })
        ];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    execute: async (sql, params = []) => {
      executeCalls.push({ sql, params });
      return 2;
    }
  };
  const persistence = createInboundInboxPersistence({
    sqlAdapter: {
      withTransaction: async (callback) => callback(tx),
      close: async () => undefined
    }
  });

  const claimed = await persistence.claimInboundMessages({
    sessionKey: 'qq:group:42',
    limit: 2,
    order: 'oldest',
    includeMessageIds: [5]
  });

  assert.equal(claimed.length, 2);
  assert.deepEqual(claimed.map((message) => message.id), [2, 5]);
  assert.equal(executeCalls.length, 2);
  assert.ok(executeCalls[0].sql.includes('SET is_read = 1, read_at = NOW()'));
  assert.deepEqual(executeCalls[0].params, [2, 5]);
  assert.ok(executeCalls[1].sql.includes('INSERT INTO agent_inbound_thread_states'));
  assert.deepEqual(executeCalls[1].params, ['qq:group:42']);
});

test('listInboundInboxConversations preserves summary shape', async () => {
  const sqlAdapter = {
    query: async (sql, params = []) => {
      assert.ok(sql.includes('FROM agent_inbound_thread_states s'));
      assert.deepEqual(params, [25, 10]);
      return [{
        session_key: 'qq:group:42',
        chat_type: 'group',
        peer_id: '42',
        peer_name: 'Test Group',
        account_id: '1129974489',
        unread_count: 3,
        total_messages: 9,
        last_received_at: '2026-06-09 12:03:00.000',
        latest_unread_received_at: '2026-06-09 12:02:00.000',
        latest_body_for_agent: 'latest',
        latest_sender_id: '10001',
        latest_sender_name: 'Alice'
      }];
    },
    execute: async () => {
      throw new Error('list should not execute writes');
    },
    withTransaction: async () => {
      throw new Error('list should not open a transaction');
    },
    close: async () => undefined
  };
  const persistence = createInboundInboxPersistence({ sqlAdapter });

  const summaries = await persistence.listInboundInboxConversations({ limit: 25, offset: 10 });

  assert.deepEqual(summaries, [{
    sessionKey: 'qq:group:42',
    chatType: 'group',
    peerId: '42',
    peerName: 'Test Group',
    accountId: '1129974489',
    unreadCount: 3,
    totalMessages: 9,
    lastReceivedAt: '2026-06-09T12:03:00.000+08:00',
    latestUnreadReceivedAt: '2026-06-09T12:02:00.000+08:00',
    latestBodyForAgent: 'latest',
    latestSenderId: '10001',
    latestSenderName: 'Alice'
  }]);
});
