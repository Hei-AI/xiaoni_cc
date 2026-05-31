import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPresenceAnchorsFromLife,
  rankFeedbackReflectionsForRecall,
  renderXiaoniLifeStateExplanation,
  resolvePresenceRecoveryEvent,
  RuntimeStore
} from '../services/runtime-store';
import { deriveLifeState } from '../services/presence-context';
import type { QueueMessagePayload } from '../types';

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

function createRuntimeStoreQueuePayload(overrides: Partial<QueueMessagePayload> = {}): QueueMessagePayload {
  return {
    traceId: 'trace-runtime-silence',
    runId: 'run-runtime-silence',
    batchId: 'batch-runtime-silence',
    source: 'presence_tick',
    chatType: 'group',
    sessionKey: 'qq:group:999',
    peerId: '999',
    peerName: 'Presence Group',
    senderId: '303',
    senderName: 'presence_tick',
    accountId: '303',
    bodyForAgent: 'presence_tick',
    rawBody: 'presence_tick',
    commandBody: 'presence_tick',
    wasMentioned: false,
    receivedAt: '2026-05-30T08:00:00.000Z',
    messageTimestamp: '2026-05-30T08:00:00.000Z',
    rawPayload: {},
    inboundContext: {
      Body: 'presence_tick',
      BodyForAgent: 'presence_tick',
      BodyForCommands: 'presence_tick',
      NativeChannelId: '999',
      CommandAuthorized: true,
      Surface: 'presence_tick'
    },
    messages: [{
      queueMessageId: 7001,
      traceId: 'trace-runtime-silence',
      source: 'presence_tick',
      messageId: 8001,
      messageSid: 'presence:sid:8001',
      chatType: 'group',
      sessionKey: 'qq:group:999',
      peerId: '999',
      peerName: 'Presence Group',
      senderId: '303',
      senderName: 'presence_tick',
      accountId: '303',
      bodyForAgent: 'presence_tick',
      rawBody: 'presence_tick',
      commandBody: 'presence_tick',
      wasMentioned: false,
      receivedAt: '2026-05-30T08:00:00.000Z',
      messageTimestamp: '2026-05-30T08:00:00.000Z',
      rawPayload: {},
      inboundContext: {
        Body: 'presence_tick',
        BodyForAgent: 'presence_tick',
        BodyForCommands: 'presence_tick',
        NativeChannelId: '999',
        CommandAuthorized: true,
        Surface: 'presence_tick'
      }
    }],
    presenceTick: {
      identityKey: 'xiaoni',
      targetSessionKey: 'qq:group:999',
      targetGroupId: 999,
      targetPeerId: '999',
      targetPeerName: 'Presence Group',
      targetChatType: 'group',
      targetAccountId: '303'
    },
    ...overrides
  };
}

test('buildPresenceAnchorsFromLife preserves recent activity for presence anchors', () => {
  const now = new Date('2026-05-30T04:00:00.000Z');
  const anchors = buildPresenceAnchorsFromLife({
    service_started_at: '2026-05-26T04:00:00.000Z',
    last_active_at: '2026-05-30T03:55:00.000Z',
    last_boredom_reset_at: '2026-05-30T03:55:00.000Z',
    last_sleep_at: null,
    last_presence_tick_enqueued_at: null,
    last_proactive_at: null,
    last_user_message_at: '2026-05-30T03:58:00.000Z',
    daily_proactive_count: 0
  }, now);

  const state = deriveLifeState(anchors);

  assert.equal(anchors.lastActiveAt, '2026-05-30T03:55:00.000Z');
  assert.equal(state.fatigue, 0);
  assert.equal(state.energy, 1);
});

test('buildPresenceAnchorsFromLife resets stale daily proactive count', () => {
  const anchors = buildPresenceAnchorsFromLife({
    service_started_at: '2026-05-26T04:00:00.000Z',
    last_active_at: '2026-05-30T01:00:00.000Z',
    last_boredom_reset_at: '2026-05-30T01:00:00.000Z',
    last_sleep_at: null,
    last_presence_tick_enqueued_at: null,
    last_proactive_at: '2026-05-26T21:05:00.000Z',
    last_user_message_at: null,
    daily_proactive_count: 6,
    daily_proactive_date: '2026-05-26T00:00:00.000Z'
  }, new Date('2026-05-30T04:00:00.000Z'));

  assert.equal(anchors.dailyProactiveCount, 0);
});

test('resolvePresenceRecoveryEvent records visible rest or sleep facts for fatigue recovery', () => {
  const tiredState = {
    boredom: 0.6,
    fatigue: 0.9,
    energy: 0.1,
    sharingDesire: 0.4,
    sleepPressure: 1,
    cooldownActive: false,
    startupGraceActive: false,
    attention: 1,
    rewardAttraction: 0.3,
    restPressure: 1,
    actionCost: 1
  };

  assert.deepEqual(resolvePresenceRecoveryEvent(tiredState, new Date('2026-05-31T00:30:00.000Z')), {
    eventKind: 'sleep_period',
    reason: 'fatigue_sleep_window',
    bucketMs: 6 * 60 * 60 * 1000
  });
  assert.deepEqual(resolvePresenceRecoveryEvent(tiredState, new Date('2026-05-31T07:00:00.000Z')), {
    eventKind: 'rest_period',
    reason: 'fatigue_recovery',
    bucketMs: 60 * 60 * 1000
  });
  assert.equal(resolvePresenceRecoveryEvent({ ...tiredState, fatigue: 0.5 }, new Date('2026-05-31T07:00:00.000Z')), null);
});

test('fatigue recovery event tells Xiaoni only current energy for sleep', async () => {
  const store = new RuntimeStore() as any;
  const lifeEvents: any[] = [];
  store.recordLifeEventSafe = async (input: any) => {
    lifeEvents.push(input);
  };

  await store.recordPresenceRecoveryIfNeeded({
    now: new Date('2026-05-31T00:30:00.000Z'),
    projection: {
      state: {
        boredom: 0.6,
        fatigue: 0.9,
        energy: 0.1,
        sharingDesire: 0.38,
        sleepPressure: 1,
        cooldownActive: false,
        startupGraceActive: false,
        attention: 1,
        rewardAttraction: 0.34,
        restPressure: 1,
        actionCost: 1
      }
    },
    explanation: {
      meterDrivers: {
        fatigue: '当前精力=0.10，累计行动成本=1.00'
      },
      contributors: [{
        eventId: '2',
        eventKind: 'speak_in_group',
        occurredAt: '2026-05-31T06:30:00.000Z',
        effect: '已经开口，本次行动成本 1.00'
      }]
    },
    decision: { shouldEnqueue: false, reason: 'fatigue' }
  });

  assert.equal(lifeEvents.length, 1);
  assert.equal(lifeEvents[0].eventKind, 'sleep_period');
  assert.match(lifeEvents[0].payload.duration_label, /当前精力=0\.10/);
  assert.doesNotMatch(lifeEvents[0].payload.duration_label, /疲劳=|困倦压力=|行动负担=/);
  assert.match(lifeEvents[0].payload.duration_label, /睡眠恢复/);
  assert.equal(lifeEvents[0].payload.energy_note, '当前精力=0.10，累计行动成本=1.00');
  assert.equal(lifeEvents[0].payload.action_cost_sources[0].effect, '已经开口，本次行动成本 1.00');
  assert.equal('fatigue_driver' in lifeEvents[0].payload, false);
});

test('renderXiaoniLifeStateExplanation tells the next wake energy and recent action costs', () => {
  const text = renderXiaoniLifeStateExplanation({
    version: 'xiaoni-life-v1',
    summary: '当前精力=0.10',
    generatedAt: '2026-05-31T08:00:00.000Z',
    rebuiltFromEvents: false,
    eventCount: 3,
    reducedThroughEventId: '3',
    contributors: [
      {
        eventId: '3',
        eventKind: 'sleep_period',
        occurredAt: '2026-05-31T07:30:00.000Z',
        effect: '刚才记录了一次睡眠恢复，醒来后累计行动成本重置为 0.00'
      },
      {
        eventId: '2',
        eventKind: 'speak_in_group',
        occurredAt: '2026-05-31T06:30:00.000Z',
        effect: '已经开口，本次行动成本 1.00'
      },
      {
        eventId: '1',
        eventKind: 'presence_tick_evaluated',
        occurredAt: '2026-05-31T06:00:00.000Z',
        effect: '这次空闲检查被跳过'
      }
    ],
    meterDrivers: {
      boredom: '当前精力=0.10',
      fatigue: '当前精力=0.10，累计行动成本=1.00',
      sharingDesire: '当前精力=0.10',
      attention: '当前精力=0.10'
    }
  });

  assert.match(text, /现在的精力：当前精力=0\.10/);
  assert.match(text, /最近行动消耗：已经开口，本次行动成本 1\.00/);
  assert.match(text, /刚才怎么恢复：刚才记录了一次睡眠恢复，醒来后累计行动成本重置为 0\.00/);
  assert.doesNotMatch(text, /无聊=|疲劳=|分享欲=|困倦压力=|疲劳怎么算|空闲检查被跳过/);
});

test('recordSilenceDecisionLifeEvent records lurked run as self-private silence decision', async () => {
  const store = createStoreWithSql({});
  const lifeEvents: any[] = [];
  (store as any).recordLifeEventSafe = async (input: any) => {
    lifeEvents.push(input);
  };

  const queueMessage = createRuntimeStoreQueuePayload();

  await store.recordSilenceDecisionLifeEvent({
    queueMessage,
    outcome: 'lurked',
    presenceOutcome: 'lurked',
    termination: {
      terminationReason: 'finish_no_reply',
      finishReason: 'opened the group and stayed quiet',
      finishOutcome: 'complete',
      noReply: true
    },
    totalTurns: 1,
    conversationId: 42
  });

  assert.equal(lifeEvents.length, 1);
  const event = lifeEvents[0];
  assert.equal(event.eventKind, 'silence_decision');
  assert.equal(event.visibility, 'self_private');
  assert.equal(event.chatType, 'group');
  assert.equal(event.sessionKey, 'qq:group:999');
  assert.equal(event.peerId, '999');
  assert.equal(event.runId, 'run-runtime-silence');
  assert.equal(event.traceId, 'trace-runtime-silence');
  assert.equal(event.messageSid, 'presence:sid:8001');
  assert.equal(event.queueMessageId, 7001);
  assert.equal(event.payload.outcome, 'lurked');
  assert.equal(event.payload.presence_outcome, 'lurked');
  assert.equal(event.payload.termination.reason, 'finish_no_reply');
  assert.equal(event.payload.termination.finish_reason, 'opened the group and stayed quiet');
  assert.equal(event.payload.reason, 'opened the group and stayed quiet');
  assert.equal(event.payload.conversation_id, 42);
  assert.match(event.dedupeKey, /^silence_decision:run-runtime-silence:qq:group:999$/);
});

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

test('listRecentTurns can read the global append stream for life-only presence ticks', async () => {
  const conversationQueries: Array<{ sql: string; params?: unknown[] }> = [];
  const store = createStoreWithQuery(async (sql, params) => {
    if (sql.includes('FROM conversations')) {
      conversationQueries.push({ sql, params });
      return [{
        id: 2,
        batch_id: null,
        trace_id: null,
        user_id: 303,
        group_id: null,
        user_message: '私聊建议：闲着可以看一本文学书',
        ai_response: null,
        raw_response: '{}'
      }, {
        id: 1,
        batch_id: null,
        trace_id: null,
        user_id: 202,
        group_id: 101,
        user_message: '群聊里有人提到一个新的兴趣点',
        ai_response: null,
        raw_response: '{}'
      }];
    }

    if (sql.includes('FROM conversation_items')) {
      return [];
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
    userId: 1129974489,
    groupId: null,
    scope: 'global',
    limit: 160
  });

  assert.equal(turns.length, 2);
  assert.equal(turns[0]?.groupId, 101);
  assert.equal(turns[1]?.groupId, null);
  assert.equal(turns[1]?.userMessage, '私聊建议：闲着可以看一本文学书');
  assert.match(conversationQueries[0]?.sql || '', /WHERE TRUE/);
  assert.doesNotMatch(conversationQueries[0]?.sql || '', /group_id = \?|user_id = \?|group_id IS NULL/);
  assert.deepEqual(conversationQueries[0]?.params, []);
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
  const lifeEvents: Array<Record<string, unknown>> = [];
  const store = createStoreWithSql({
    execute: async (sql: string, params?: unknown[]) => {
      executeCalls.push({ sql, params });
    }
  });
  (store as any).recordLifeEventSafe = async (input: Record<string, unknown>) => {
    lifeEvents.push(input);
  };

  await store.markRunDeliveryCommitted('run-commit');

  assert.equal(executeCalls.length, 1);
  assert.match(executeCalls[0]?.sql || '', /delivery_phase = 'delivery_committed'/);
  assert.match(executeCalls[0]?.sql || '', /delivery_commit_count = CASE/);
  assert.deepEqual(executeCalls[0]?.params, ['run-commit']);
  assert.equal(lifeEvents[0]?.eventKind, 'terminal_action_committed');
  assert.equal(lifeEvents[0]?.visibility, 'operator_only');
});

test('markRunDeliveryBlocked increments blocked attempt count and reason', async () => {
  const executeCalls: Array<{ sql: string; params?: unknown[] }> = [];
  const lifeEvents: Array<Record<string, unknown>> = [];
  const store = createStoreWithSql({
    execute: async (sql: string, params?: unknown[]) => {
      executeCalls.push({ sql, params });
    }
  });
  (store as any).recordLifeEventSafe = async (input: Record<string, unknown>) => {
    lifeEvents.push(input);
  };

  await store.markRunDeliveryBlocked('run-blocked', 'Outbound delivery already committed earlier in this run.');

  assert.equal(executeCalls.length, 1);
  assert.match(executeCalls[0]?.sql || '', /blocked_delivery_attempt_count = COALESCE\(blocked_delivery_attempt_count, 0\) \+ 1/);
  assert.match(executeCalls[0]?.sql || '', /last_blocked_delivery_reason = \?/);
  assert.deepEqual(executeCalls[0]?.params, ['Outbound delivery already committed earlier in this run.', 'run-blocked']);
  assert.equal(lifeEvents[0]?.eventKind, 'terminal_action_blocked');
  assert.equal(lifeEvents[0]?.visibility, 'operator_only');
});

test('rankFeedbackReflectionsForRecall does not recall unrelated memories just because the sender matches', () => {
  const ranked = rankFeedbackReflectionsForRecall({
    reflections: [{
      id: 1,
      sessionKey: 'qq:group:101',
      groupId: 101,
      sourceUserId: 202,
      sourceUserName: 'Alice',
      scopeType: 'group_self',
      learningKey: 'topic.cooking',
      learningScope: 'group_self',
      reflectionType: 'social_lesson',
      feedbackKind: 'mixed',
      confidence: 'high',
      importanceScore: 0.9,
      evidenceWeight: 0.9,
      stabilityScore: 0.9,
      summaryText: 'Alice 喜欢聊做饭',
      retrievalText: '做饭 菜谱 厨房',
      embeddingText: '做饭 菜谱 厨房',
      sourceMessageIds: [],
      sourceEpisodeIds: [],
      sourceConversationId: null,
      supersedesReflectionId: null,
      conflictGroupKey: null,
      metadata: {},
      lastHitAt: null,
      hitCount: 0,
      updatedAt: '2026-03-31T08:00:00.000Z'
    }, {
      id: 2,
      sessionKey: 'qq:group:101',
      groupId: 101,
      sourceUserId: 303,
      sourceUserName: 'Bob',
      scopeType: 'group_self',
      learningKey: 'feedback.low_value_reply',
      learningScope: 'group_self',
      reflectionType: 'social_lesson',
      feedbackKind: 'negative',
      confidence: 'high',
      importanceScore: 0.7,
      evidenceWeight: 0.8,
      stabilityScore: 0.6,
      summaryText: '不要发没有营养的话，要先有真实思考',
      retrievalText: '不要发没有营养的话 真实思考 小腻',
      embeddingText: '没有营养 真实思考 先思考再说',
      sourceMessageIds: [],
      sourceEpisodeIds: [],
      sourceConversationId: null,
      supersedesReflectionId: null,
      conflictGroupKey: null,
      metadata: {},
      lastHitAt: null,
      hitCount: 0,
      updatedAt: '2026-03-31T08:00:00.000Z'
    }],
    learningStates: [],
    queryText: '小腻不要发没有营养的话，要先思考',
    currentUserId: 202,
    recentUserIds: [],
    embeddingScores: new Map(),
    limit: 3
  });

  assert.deepEqual(ranked.map((item) => item.reflection.id), [2]);
});

test('rankFeedbackReflectionsForRecall dedupes the same learning key and scope', () => {
  const base = {
    sessionKey: 'qq:group:101',
    groupId: 101,
    sourceUserId: 202,
    sourceUserName: 'Alice',
    scopeType: 'group_self',
    reflectionType: 'social_lesson',
    feedbackKind: 'negative',
    confidence: 'high',
    importanceScore: 0.6,
    evidenceWeight: 0.6,
    stabilityScore: 0.6,
    sourceMessageIds: [],
    sourceEpisodeIds: [],
    sourceConversationId: null,
    supersedesReflectionId: null,
    conflictGroupKey: null,
    metadata: {},
    lastHitAt: null,
    hitCount: 0,
    updatedAt: '2026-03-31T08:00:00.000Z'
  };
  const ranked = rankFeedbackReflectionsForRecall({
    reflections: [{
      ...base,
      id: 11,
      learningKey: 'feedback.low_value_reply',
      learningScope: 'group_self',
      summaryText: '旧结论：少接空话',
      retrievalText: '没有营养 先思考',
      embeddingText: '没有营养 先思考'
    }, {
      ...base,
      id: 12,
      learningKey: 'feedback.low_value_reply',
      learningScope: 'group_self',
      summaryText: '新结论：必须先有真实思考再决定说不说',
      retrievalText: '没有营养 真实思考 先思考再说',
      embeddingText: '真实思考 先思考再说'
    }],
    learningStates: [{
      id: 1,
      sessionKey: 'qq:group:101',
      groupId: 101,
      scopeType: 'group_self',
      learningKey: 'feedback.low_value_reply',
      learningScope: 'group_self',
      scopeHash: 'hash',
      stateType: 'reinforced',
      activeReflectionId: 12,
      latestReflectionId: 12,
      activationWeight: 1,
      recencyWeight: 1,
      importanceWeight: 1,
      sourceWeight: 1,
      conflictPenalty: 0,
      metadata: {},
      updatedAt: '2026-03-31T08:00:00.000Z'
    }],
    queryText: '没有营养 真实思考',
    currentUserId: 202,
    recentUserIds: [],
    embeddingScores: new Map([
      [11, 0.8],
      [12, 0.95]
    ]),
    limit: 3
  });

  assert.deepEqual(ranked.map((item) => item.reflection.id), [12]);
});

test('rankFeedbackReflectionsForRecall boosts self_model_update with invitation_curiosity hint', () => {
  const base = {
    sessionKey: 'qq:group:101',
    groupId: 101,
    sourceUserId: 999,
    sourceUserName: 'Other',
    scopeType: 'group_self' as const,
    learningScope: 'group_self',
    feedbackKind: 'neutral',
    confidence: 'medium' as const,
    importanceScore: 0.5,
    evidenceWeight: 0.5,
    stabilityScore: 0.5,
    summaryText: 'test',
    retrievalText: '',
    embeddingText: '',
    sourceMessageIds: [],
    sourceEpisodeIds: [],
    sourceConversationId: null,
    supersedesReflectionId: null,
    conflictGroupKey: null,
    metadata: {},
    lastHitAt: null,
    hitCount: 0,
    updatedAt: null
  };

  const selfModelReflection = { ...base, id: 1, learningKey: 'self.a', reflectionType: 'self_model_update' as const };
  const socialLessonReflection = { ...base, id: 2, learningKey: 'social.b', reflectionType: 'social_lesson' as const };
  const reflections = [selfModelReflection, socialLessonReflection];
  const embeddingScores = new Map([[1, 0.5], [2, 0.5]]);
  const sharedParams = { reflections, learningStates: [], queryText: '', currentUserId: 100, recentUserIds: [], embeddingScores, limit: 5 };

  const withHint = rankFeedbackReflectionsForRecall({ ...sharedParams, socialActTypeHint: 'invitation_curiosity' });
  assert.equal(withHint[0]?.reflection.id, 1, 'self_model_update ranks first with invitation_curiosity hint');

  const withoutHint = rankFeedbackReflectionsForRecall({ ...sharedParams, socialActTypeHint: null });
  assert.equal(withoutHint[0]?.reflection.id, 2, 'without hint, id tiebreaker puts id=2 first');
});

test('rankFeedbackReflectionsForRecall boosts social_lesson with relationship_probe hint', () => {
  const base = {
    sessionKey: 'qq:group:101',
    groupId: 101,
    sourceUserId: 999,
    sourceUserName: 'Other',
    scopeType: 'group_self' as const,
    learningScope: 'group_self',
    feedbackKind: 'neutral',
    confidence: 'medium' as const,
    importanceScore: 0.5,
    evidenceWeight: 0.5,
    stabilityScore: 0.5,
    summaryText: 'test',
    retrievalText: '',
    embeddingText: '',
    sourceMessageIds: [],
    sourceEpisodeIds: [],
    sourceConversationId: null,
    supersedesReflectionId: null,
    conflictGroupKey: null,
    metadata: {},
    lastHitAt: null,
    hitCount: 0,
    updatedAt: null
  };

  const socialLessonReflection = { ...base, id: 3, learningKey: 'social.c', reflectionType: 'social_lesson' as const };
  const selfModelReflection = { ...base, id: 4, learningKey: 'self.d', reflectionType: 'self_model_update' as const };
  const reflections = [socialLessonReflection, selfModelReflection];
  const embeddingScores = new Map([[3, 0.5], [4, 0.5]]);
  const sharedParams = { reflections, learningStates: [], queryText: '', currentUserId: 100, recentUserIds: [], embeddingScores, limit: 5 };

  const withHint = rankFeedbackReflectionsForRecall({ ...sharedParams, socialActTypeHint: 'relationship_probe' });
  assert.equal(withHint[0]?.reflection.id, 3, 'social_lesson ranks first with relationship_probe hint');

  const withoutHint = rankFeedbackReflectionsForRecall({ ...sharedParams, socialActTypeHint: null });
  assert.equal(withoutHint[0]?.reflection.id, 4, 'without hint, id tiebreaker puts id=4 first');
});

test('rankFeedbackReflectionsForRecall hint boost only applies to eligible reflections', () => {
  const base = {
    sessionKey: 'qq:group:101',
    groupId: 101,
    sourceUserId: 999,
    sourceUserName: 'Other',
    scopeType: 'group_self' as const,
    learningScope: 'group_self',
    feedbackKind: 'neutral',
    confidence: 'medium' as const,
    importanceScore: 0.5,
    evidenceWeight: 0.5,
    stabilityScore: 0.5,
    summaryText: 'test',
    retrievalText: '',
    embeddingText: '',
    sourceMessageIds: [],
    sourceEpisodeIds: [],
    sourceConversationId: null,
    supersedesReflectionId: null,
    conflictGroupKey: null,
    metadata: {},
    lastHitAt: null,
    hitCount: 0,
    updatedAt: null
  };

  // id=5 has embedding 0.08 — after normalization (0.08/0.5 = 0.16) stays below 0.2 threshold
  // id=6 has embedding 0.5 — above threshold
  const ineligible = { ...base, id: 5, learningKey: 'self.e', reflectionType: 'self_model_update' as const };
  const eligible = { ...base, id: 6, learningKey: 'social.f', reflectionType: 'social_lesson' as const };
  const embeddingScores = new Map([[5, 0.08], [6, 0.5]]);

  const ranked = rankFeedbackReflectionsForRecall({
    reflections: [ineligible, eligible],
    learningStates: [],
    queryText: '',
    currentUserId: 100,
    recentUserIds: [],
    embeddingScores,
    limit: 5,
    socialActTypeHint: 'invitation_curiosity'
  });

  assert.equal(ranked.length, 1, 'ineligible reflection filtered out even with hint');
  assert.equal(ranked[0]?.reflection.id, 6);
});
