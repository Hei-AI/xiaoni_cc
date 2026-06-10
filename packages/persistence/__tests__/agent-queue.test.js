'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAgentQueuePersistence } = require('../agent-queue');

function createQueueRow(overrides = {}) {
  return {
    id: overrides.id || 1,
    trace_id: overrides.trace_id || 'trace-original',
    batch_id: null,
    run_id: null,
    source: overrides.source || 'phone_notification',
    message_sid: overrides.message_sid || `sid-${overrides.id || 1}`,
    chat_type: overrides.chat_type || 'group',
    session_key: overrides.session_key || 'qq:group:100',
    peer_id: overrides.peer_id || '100',
    peer_name: overrides.peer_name || 'Test Group',
    sender_id: overrides.sender_id || 'qq',
    sender_name: overrides.sender_name || 'QQ',
    account_id: overrides.account_id || '1129974489',
    body_for_agent: overrides.body_for_agent || '群里有 1 条新消息。',
    raw_payload: overrides.raw_payload || '{}',
    inbound_context: overrides.inbound_context || JSON.stringify({
      BodyForAgent: overrides.body_for_agent || '群里有 1 条新消息。',
      CommandAuthorized: false,
      Surface: 'phone_notification'
    }),
    status: 'pending',
    attempts: overrides.attempts || 0,
    created_at: overrides.created_at || '2026-06-09T00:00:00.000Z',
    processing_started_at: null,
    completed_at: null,
    conversation_id: null,
    error_message: null,
    payload: overrides.payload || JSON.stringify({
      messageId: overrides.messageId || overrides.id || 1,
      rawBody: overrides.rawBody || overrides.body_for_agent || '群里有 1 条新消息。',
      commandBody: '',
      wasMentioned: overrides.wasMentioned || false,
      receivedAt: overrides.receivedAt || '2026-06-09T00:00:00.000Z',
      phoneNotification: {
        app: 'qq',
        notificationId: overrides.message_sid || `sid-${overrides.id || 1}`,
        sessionKey: overrides.session_key || 'qq:group:100',
        chatType: 'group',
        peerId: overrides.peer_id || '100',
        unreadDelta: overrides.unreadDelta || 1,
        directMentions: overrides.directMentions || 0
      }
    })
  };
}

test('claimNextAgentQueueMessage batches pending messages for one session', async () => {
  const inserts = [];
  const executes = [];
  const rows = [
    createQueueRow({ id: 10, message_sid: 'sid-10', body_for_agent: '第一条', unreadDelta: 1 }),
    createQueueRow({ id: 11, message_sid: 'sid-11', body_for_agent: '第二条', unreadDelta: 2, directMentions: 1 })
  ];
  const tx = {
    query: async (sql, params = []) => {
      if (sql.includes('LIMIT 1') && sql.includes('SKIP LOCKED')) {
        return [rows[0]];
      }
      if (sql.includes('session_key = ?')) {
        assert.deepEqual(params, ['qq:group:100']);
        return rows;
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    insert: async (sql, params = []) => {
      inserts.push({ sql, params });
      return { insertId: 1, affectedRows: 1 };
    },
    execute: async (sql, params = []) => {
      executes.push({ sql, params });
      return 2;
    }
  };
  const persistence = createAgentQueuePersistence({
    getPrismaClient: () => {
      throw new Error('Prisma should not be used for claim');
    },
    createSqlAdapter: () => ({
      withTransaction: async (callback) => callback(tx),
      close: async () => undefined
    })
  });

  const claimed = await persistence.claimNextAgentQueueMessage({ workerId: 'worker-1' });

  assert.ok(claimed);
  assert.equal(claimed.status, 'processing');
  assert.equal(claimed.queueMessageIds.length, 2);
  assert.equal(claimed.payload.messages.length, 2);
  assert.match(claimed.batchId, /^batch_/);
  assert.match(claimed.id, /^run_/);
  assert.match(claimed.traceId, /^runtrace_/);
  assert.equal(claimed.payload.bodyForAgent, '#1 QQ: 第一条\n#2 QQ: 第二条');
  assert.equal(claimed.payload.phoneNotification.unreadDelta, 3);
  assert.equal(claimed.payload.phoneNotification.directMentions, 1);
  assert.equal(inserts.length, 4);
  assert.equal(executes.length, 1);
  assert.ok(executes[0].sql.includes('UPDATE agent_queue_messages'));
  assert.ok(executes[0].sql.includes("status = 'consumed'"));
  assert.ok(executes[0].sql.includes('result = ?::jsonb'));
  assert.equal(executes[0].params[0], 'worker-1');
  const consumedResult = JSON.parse(executes[0].params[4]);
  assert.equal(consumedResult.doorbell_consumed, true);
  assert.equal(consumedResult.worker_id, 'worker-1');
  assert.equal(typeof consumedResult.consumed_at, 'string');
  assert.deepEqual(executes[0].params.slice(-2), [10, 11]);
});
