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
        // 20,21 = reply_to_message_id resolve subquery params (message_sid, session_key)
        napcat_msg_id: insertParams[22],
        reply_to_native_id: insertParams[23],
        raw_payload: insertParams[24],
        inbound_context: insertParams[25]
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
  assert.equal(queries[0].params[17], 'reply-1');
  assert.equal(queries[0].params[19], 'Bob');
  // reply_to_message_id resolves the quoted QQ message_sid → internal id via subquery
  assert.ok(queries[0].sql.includes('reply_to_message_id'));
  assert.match(queries[0].sql, /SELECT m\.id FROM agent_inbound_messages m WHERE m\.message_sid = \? AND m\.session_key = \?/);
  assert.equal(queries[0].params[20], 'reply-1');
  assert.equal(queries[0].params[21], 'qq:group:42');
  // 22 = napcat_msg_id (NativeMsgId), 23 = reply_to_native_id (NativeReplyMsgId)
  assert.equal(queries[0].params[22], null);
  assert.equal(queries[0].params[23], null);
  assert.deepEqual(JSON.parse(queries[0].params[24]), { post_type: 'message' });
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

// findQuotedMessage:引用正文的单一真理源是库,不是 30 分钟内存缓存(事故行 37923:
// 引用 15 小时前小腻的 outbound,缓存必 miss → reply_to_body 落空,渲染成「(非文字消息)」)。
test('findQuotedMessage resolves quoted body from the inbound table by OneBot id', async () => {
  const queries = [];
  const sqlAdapter = {
    query: async (sql, params = []) => {
      queries.push({ sql, params });
      if (/FROM agent_inbound_messages/.test(sql)) {
        return [createInboxRow({
          message_sid: '9001',
          sender_id: '85178516',
          sender_name: '李阿花',
          raw_body: '原消息内容',
          body_for_agent: '原消息内容'
        })];
      }
      throw new Error(`unexpected query: ${sql}`);
    },
    execute: async () => { throw new Error('lookup should not execute writes'); },
    withTransaction: async () => { throw new Error('lookup should not open a transaction'); },
    close: async () => undefined
  };
  const persistence = createInboundInboxPersistence({ sqlAdapter });

  const quoted = await persistence.findQuotedMessage({ oneBotId: '9001' });

  assert.deepEqual(quoted, {
    oneBotId: '9001',
    body: '原消息内容',
    senderId: '85178516',
    senderName: '李阿花',
    isBot: false,
    direction: 'incoming'
  });
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0].params, ['9001']);
});

test('findQuotedMessage falls back to the outbound table for 小腻 self-quotes (37923 shape)', async () => {
  const sqlAdapter = {
    query: async (sql, params = []) => {
      if (/FROM agent_inbound_messages/.test(sql)) {
        return [];
      }
      if (/to_regclass/.test(sql)) {
        return [{ table_name: 'agent_outbound_messages' }];
      }
      if (/FROM agent_outbound_messages/.test(sql)) {
        assert.deepEqual(params, ['1652226028']);
        return [{
          delivery_message_id: '1652226028',
          sender_id: '1129974489',
          sender_name: '小腻',
          raw_body: null,
          body_for_agent: '建议在压缩指令里加一条硬规则'
        }];
      }
      throw new Error(`unexpected query: ${sql}`);
    },
    execute: async () => { throw new Error('lookup should not execute writes'); },
    withTransaction: async () => { throw new Error('lookup should not open a transaction'); },
    close: async () => undefined
  };
  const persistence = createInboundInboxPersistence({ sqlAdapter });

  const quoted = await persistence.findQuotedMessage({ oneBotId: '1652226028' });

  assert.deepEqual(quoted, {
    oneBotId: '1652226028',
    body: '建议在压缩指令里加一条硬规则',
    senderId: '1129974489',
    senderName: '小腻',
    isBot: true,
    direction: 'outgoing'
  });
});

test('findQuotedMessage returns null when both ids are absent or nothing matches', async () => {
  const sqlAdapter = {
    query: async (sql) => {
      if (/to_regclass/.test(sql)) {
        return [{ table_name: 'agent_outbound_messages' }];
      }
      return [];
    },
    execute: async () => { throw new Error('lookup should not execute writes'); },
    withTransaction: async () => { throw new Error('lookup should not open a transaction'); },
    close: async () => undefined
  };
  const persistence = createInboundInboxPersistence({ sqlAdapter });

  assert.equal(await persistence.findQuotedMessage({}), null);
  assert.equal(await persistence.findQuotedMessage({ oneBotId: 'no-such-id' }), null);
});

test('findQuotedMessage resolves by NTQQ native id when the OneBot id is absent', async () => {
  const sqlAdapter = {
    query: async (sql, params = []) => {
      if (/FROM agent_inbound_messages/.test(sql)) {
        assert.match(sql, /napcat_msg_id = \?/);
        assert.deepEqual(params, ['7659245918938143286']);
        return [createInboxRow({
          message_sid: '30611',
          sender_id: '1129974489',
          sender_name: '小腻',
          account_id: '1129974489',
          raw_body: '找到了',
          body_for_agent: '找到了'
        })];
      }
      throw new Error(`unexpected query: ${sql}`);
    },
    execute: async () => { throw new Error('lookup should not execute writes'); },
    withTransaction: async () => { throw new Error('lookup should not open a transaction'); },
    close: async () => undefined
  };
  const persistence = createInboundInboxPersistence({ sqlAdapter });

  const quoted = await persistence.findQuotedMessage({ nativeMsgId: '7659245918938143286' });

  assert.equal(quoted.oneBotId, '30611');
  assert.equal(quoted.body, '找到了');
  assert.equal(quoted.isBot, true);
});

test('findQuotedMessage prefers same-session rows when sessionKey is given (id-reuse guard)', async () => {
  const sqlAdapter = {
    query: async (sql, params = []) => {
      if (/FROM agent_inbound_messages/.test(sql)) {
        assert.match(sql, /ORDER BY CASE WHEN session_key = \? THEN 0 ELSE 1 END/);
        assert.deepEqual(params, ['9001', 'qq:direct:1129974489:85178516']);
        return [createInboxRow({
          message_sid: '9001',
          session_key: 'qq:direct:1129974489:85178516',
          sender_id: '85178516',
          sender_name: '李阿花',
          raw_body: '同会话的那条',
          body_for_agent: '同会话的那条'
        })];
      }
      throw new Error(`unexpected query: ${sql}`);
    },
    execute: async () => { throw new Error('lookup should not execute writes'); },
    withTransaction: async () => { throw new Error('lookup should not open a transaction'); },
    close: async () => undefined
  };
  const persistence = createInboundInboxPersistence({ sqlAdapter });

  const quoted = await persistence.findQuotedMessage({
    oneBotId: '9001',
    sessionKey: 'qq:direct:1129974489:85178516'
  });

  assert.equal(quoted.body, '同会话的那条');
});
