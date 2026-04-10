import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRelationshipRagSelection,
  rankRelationshipCardsForPrompt,
  selectCardsInRankOrder,
  RuntimeStore
} from '../services/runtime-store';

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

    if (sql.includes('FROM agent_inbound_messages m')) {
      return [];
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const turns = await store.listRecentTurns({
    userId: 202,
    groupId: 101
  });

  assert.equal(turns.length, 1);
  assert.equal(turns[0]?.items.length, 2);
  assert.match(String(turns[0]?.items[0]?.content), /2026-03-28 08:00 \{Alice\(@202\)\}/);
  assert.match(String(turns[0]?.items[0]?.content), /@\{Bob\(@404\)\} 嘿/);
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

    if (sql.includes('FROM agent_inbound_messages m')) {
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

test('listRecentTurns rebuilds historical user items from inbound messages when queue replay rows are unavailable', async () => {
  const store = createStoreWithQuery(async (sql) => {
    if (sql.includes('FROM conversations')) {
      return [{
        id: 1,
        batch_id: null,
        trace_id: 'trace-1',
        user_id: 202,
        group_id: 101,
        user_message: '旧裸文本',
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
      return [];
    }

    if (sql.includes('FROM agent_inbound_messages m')) {
      return [{
        id: 31,
        trace_id: 'trace-1',
        source: 'napcat',
        message_sid: 'sid-legacy-1',
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
          Body: '@Bob 嘿',
          BodyForAgent: '@Bob 嘿',
          BodyForCommands: '@Bob 嘿',
          SenderName: 'Alice',
          SenderId: '202',
          MentionedUsers: [{
            userId: '404',
            label: 'Bob'
          }],
          CommandAuthorized: false
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
  assert.match(String(turns[0]?.items[0]?.content), /2026-03-28 08:00 \{Alice\(@202\)\}/);
  assert.match(String(turns[0]?.items[0]?.content), /@\{Bob\(@404\)\} 嘿/);
  assert.equal(turns[0]?.items[1]?.content, '历史助手回复');
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

test('rankRelationshipCardsForPrompt prioritizes lexical and embedding relevance over stale decay ordering', () => {
  const ranked = rankRelationshipCardsForPrompt({
    cards: [{
      id: 1,
      cardType: 'person',
      groupId: 101,
      targetUserId: 202,
      summaryText: '经常聊做饭',
      actors: ['Alice'],
      contextBefore: null,
      trigger: null,
      interaction: null,
      outcome: null,
      sourceEventIds: [],
      sourceMessageIds: [],
      decayedScore: 0.95,
      retrievalText: '做饭 菜谱 厨房',
      embeddingText: '做饭 菜谱 厨房',
      lastHitAt: null,
      metadata: {}
    }, {
      id: 2,
      cardType: 'person',
      groupId: 101,
      targetUserId: 202,
      summaryText: '最近一直在接梗讲猫',
      actors: ['Alice'],
      contextBefore: null,
      trigger: null,
      interaction: null,
      outcome: null,
      sourceEventIds: [],
      sourceMessageIds: [],
      decayedScore: 0.1,
      retrievalText: '猫咪 接梗 表情包',
      embeddingText: '猫咪 接梗 表情包',
      lastHitAt: '2026-03-31T08:00:00.000Z',
      metadata: {}
    }],
    queryText: '今天又在讲猫咪表情包',
    embeddingScores: new Map([
      [1, 0.05],
      [2, 0.98]
    ]),
    limit: 1
  });

  assert.equal(ranked.length, 1);
  assert.equal(ranked[0]?.card.id, 2);
  assert.ok((ranked[0]?.bm25Score || 0) > 0);
  assert.ok((ranked[0]?.embeddingScore || 0) > 0.9);
});

test('rankRelationshipCardsForPrompt falls back to decayed score when retrieval query is empty', () => {
  const ranked = rankRelationshipCardsForPrompt({
    cards: [{
      id: 7,
      cardType: 'group',
      groupId: 101,
      targetUserId: null,
      summaryText: '旧高权重卡片',
      actors: [],
      contextBefore: null,
      trigger: null,
      interaction: null,
      outcome: null,
      sourceEventIds: [],
      sourceMessageIds: [],
      decayedScore: 0.9,
      retrievalText: null,
      embeddingText: null,
      lastHitAt: null,
      metadata: {}
    }, {
      id: 8,
      cardType: 'group',
      groupId: 101,
      targetUserId: null,
      summaryText: '新低权重卡片',
      actors: [],
      contextBefore: null,
      trigger: null,
      interaction: null,
      outcome: null,
      sourceEventIds: [],
      sourceMessageIds: [],
      decayedScore: 0.2,
      retrievalText: null,
      embeddingText: null,
      lastHitAt: null,
      metadata: {}
    }],
    queryText: '',
    limit: 2
  });

  assert.deepEqual(ranked.map((item) => item.card.id), [7, 8]);
});

test('parseRelationshipRagSelection keeps only allowed card ids per scope', () => {
  const selection = parseRelationshipRagSelection({
    text: JSON.stringify({
      group_card_ids: [11, 99, 11],
      current_user_card_ids: [21],
      recent_user_card_ids: [31, '32']
    }),
    candidateIdsByScope: {
      group: [11, 12],
      current_user: [21, 22],
      recent_users: [31]
    },
    limits: {
      group: 2,
      current_user: 3,
      recent_users: 2
    }
  });

  assert.deepEqual(selection, {
    groupCardIds: [11],
    currentUserCardIds: [21],
    recentUserCardIds: [31]
  });
});

test('parseRelationshipRagSelection returns null for unusable payloads', () => {
  const selection = parseRelationshipRagSelection({
    text: '{"summary":"not a selector payload"}',
    candidateIdsByScope: {
      group: [11],
      current_user: [21],
      recent_users: [31]
    },
    limits: {
      group: 2,
      current_user: 3,
      recent_users: 2
    }
  });

  assert.equal(selection, null);
});

test('parseRelationshipRagSelection preserves an explicit empty selection', () => {
  const selection = parseRelationshipRagSelection({
    text: '{"group_card_ids":[],"current_user_card_ids":[],"recent_user_card_ids":[]}',
    candidateIdsByScope: {
      group: [11],
      current_user: [21],
      recent_users: [31]
    },
    limits: {
      group: 2,
      current_user: 3,
      recent_users: 2
    }
  });

  assert.deepEqual(selection, {
    groupCardIds: [],
    currentUserCardIds: [],
    recentUserCardIds: []
  });
});

test('selectCardsInRankOrder respects an explicit empty model selection', () => {
  const ranked = rankRelationshipCardsForPrompt({
    cards: [{
      id: 7,
      cardType: 'group',
      groupId: 101,
      targetUserId: null,
      summaryText: '旧高权重卡片',
      actors: [],
      contextBefore: null,
      trigger: null,
      interaction: null,
      outcome: null,
      sourceEventIds: [],
      sourceMessageIds: [],
      decayedScore: 0.9,
      retrievalText: '旧高权重卡片',
      embeddingText: '旧高权重卡片',
      lastHitAt: null,
      metadata: {}
    }],
    queryText: '完全无关的话题',
    limit: 1
  });

  assert.deepEqual(selectCardsInRankOrder(ranked, [], 1), []);
  assert.equal(selectCardsInRankOrder(ranked, null, 1).length, 1);
});
