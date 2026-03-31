import test from 'node:test';
import assert from 'node:assert/strict';
import { RuntimeStore } from '../services/runtime-store';

function createStoreWithQuery(query: (sql: string, params?: unknown[]) => Promise<unknown[]>) {
  const store = new RuntimeStore() as any;
  store.sql = {
    query,
    execute: async () => undefined,
    close: async () => undefined
  };
  return store as RuntimeStore;
}

function createStoreWithSql(overrides: Partial<Record<'query' | 'execute', any>>) {
  const store = new RuntimeStore() as any;
  store.sql = {
    query: async () => [],
    execute: async () => undefined,
    close: async () => undefined,
    ...overrides
  };
  return store as RuntimeStore;
}

test('listRecentTurns rebuilds historical user items from structured queue payloads', async () => {
  const store = createStoreWithQuery(async (sql) => {
    if (sql.includes('FROM conversations')) {
      return [{
        id: 1,
        batch_id: null,
        trace_id: 'trace-1',
        user_id: 202,
        group_id: 101,
        user_message: '#1 {Alice(@202)}: 旧格式',
        ai_response: '历史助手回复'
      }];
    }

    if (sql.includes('FROM conversation_items')) {
      return [{
        id: 11,
        conversation_id: 1,
        session_key: 'qq:group:101',
        role: 'assistant',
        phase: 'final_answer',
        content: '历史助手回复',
        group_index: 1,
        item_index: 0,
        source: 'delivery',
        delivery_message_id: 9001,
        run_id: 'run-1',
        trace_id: 'trace-1'
      }];
    }

    if (sql.includes('FROM agent_queue_messages q')) {
      return [{
        id: 21,
        trace_id: 'trace-1',
        run_id: 'run-1',
        conversation_id: 1,
        source: 'napcat',
        message_sid: 'sid-1',
        chat_type: 'group',
        session_key: 'qq:group:101',
        peer_id: '101',
        peer_name: 'Test Group',
        sender_id: '202',
        sender_name: 'Alice',
        account_id: '303',
        body_for_agent: '@Bob 嘿',
        raw_payload: '{}',
        inbound_context: JSON.stringify({
          MentionedUsers: [{
            userId: '404',
            label: 'Bob'
          }],
          CommandAuthorized: true
        }),
        payload: JSON.stringify({
          messageId: 11,
          bodyForAgent: '@Bob 嘿',
          rawBody: '@Bob 嘿',
          commandBody: '',
          wasMentioned: false,
          receivedAt: '2026-03-28T08:00:00.000Z'
        }),
        created_at: '2026-03-28T08:00:00.000Z'
      }];
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const turns = await store.listRecentTurns({
    userId: 202,
    groupId: 101
  });

  assert.equal(turns.length, 1);
  assert.equal(turns[0]?.items.length, 2);
  assert.match(String(turns[0]?.items[0]?.content), /Conversation info:/);
  assert.match(String(turns[0]?.items[0]?.content), /Sender:\n```text\n\{Alice\(@202\)\}\n```/);
  assert.match(String(turns[0]?.items[0]?.content), /Visible message text:\n```text\n@Bob 嘿\n```/);
  assert.match(String(turns[0]?.items[0]?.content), /"text": "嘿"/);
  assert.equal(turns[0]?.items[1]?.content, '历史助手回复');
});

test('listRecentTurns falls back to stored transcript content when structured queue payloads are unavailable', async () => {
  const store = createStoreWithQuery(async (sql) => {
    if (sql.includes('FROM conversations')) {
      return [{
        id: 1,
        batch_id: null,
        trace_id: 'trace-1',
        user_id: 202,
        group_id: 101,
        user_message: '#1 {Alice(@202)}: 旧格式',
        ai_response: '历史助手回复'
      }];
    }

    if (sql.includes('FROM conversation_items')) {
      return [{
        id: 10,
        conversation_id: 1,
        session_key: 'qq:group:101',
        role: 'user',
        phase: null,
        content: '#1 {Alice(@202)}: 旧格式',
        group_index: 0,
        item_index: 0,
        source: 'inbound_batch',
        delivery_message_id: null,
        run_id: 'run-1',
        trace_id: 'trace-1'
      }];
    }

    if (sql.includes('FROM agent_queue_messages q')) {
      return [];
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const turns = await store.listRecentTurns({
    userId: 202,
    groupId: 101
  });

  assert.equal(turns.length, 1);
  assert.equal(turns[0]?.items.length, 1);
  assert.equal(turns[0]?.items[0]?.content, '#1 {Alice(@202)}: 旧格式');
});

test('getRunDeliveryState returns normalized persisted delivery state', async () => {
  const store = createStoreWithSql({
    query: async () => [{
      delivery_phase: 'delivery_committed',
      delivery_commit_count: 1,
      blocked_delivery_attempt_count: 2,
      last_blocked_delivery_reason: 'Outbound delivery already committed earlier in this run.'
    }]
  });

  const state = await store.getRunDeliveryState('run-1');

  assert.deepEqual(state, {
    deliveryPhase: 'delivery_committed',
    deliveryCommitCount: 1,
    blockedDeliveryAttemptCount: 2,
    lastBlockedDeliveryReason: 'Outbound delivery already committed earlier in this run.'
  });
});

test('markRunDeliveryCommitted persists the single-commit invariant', async () => {
  const executeCalls: Array<{ sql: string; params?: unknown[] }> = [];
  const store = createStoreWithSql({
    execute: async (sql: string, params?: unknown[]) => {
      executeCalls.push({ sql, params });
    }
  });

  await store.markRunDeliveryCommitted('run-commit');

  assert.equal(executeCalls.length, 1);
  assert.match(executeCalls[0]?.sql || '', /delivery_phase = 'delivery_committed'/);
  assert.match(executeCalls[0]?.sql || '', /delivery_commit_count = CASE/);
  assert.deepEqual(executeCalls[0]?.params, ['run-commit']);
});

test('markRunDeliveryBlocked increments blocked attempt count and reason', async () => {
  const executeCalls: Array<{ sql: string; params?: unknown[] }> = [];
  const store = createStoreWithSql({
    execute: async (sql: string, params?: unknown[]) => {
      executeCalls.push({ sql, params });
    }
  });

  await store.markRunDeliveryBlocked('run-blocked', 'Outbound delivery already committed earlier in this run.');

  assert.equal(executeCalls.length, 1);
  assert.match(executeCalls[0]?.sql || '', /blocked_delivery_attempt_count = COALESCE\(blocked_delivery_attempt_count, 0\) \+ 1/);
  assert.match(executeCalls[0]?.sql || '', /last_blocked_delivery_reason = \?/);
  assert.deepEqual(executeCalls[0]?.params, ['Outbound delivery already committed earlier in this run.', 'run-blocked']);
});
