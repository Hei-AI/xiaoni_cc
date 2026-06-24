import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPresenceAnchorsFromLife,
  rankFeedbackReflectionsForRecall,
  renderXiaoniLifeStateExplanation,
  resolvePresenceRecoveryEvent,
  shouldDiscardLifeProjectionCursor,
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

test('buildPresenceAnchorsFromLife ignores future activity anchors', () => {
  const now = new Date('2026-06-14T10:00:00.000Z');
  const anchors = buildPresenceAnchorsFromLife({
    service_started_at: '2026-06-14T00:00:00.000Z',
    last_active_at: '2026-06-14T15:46:20.086Z',
    last_boredom_reset_at: '2026-06-14T15:44:16.284Z',
    last_sleep_at: '2026-06-14T09:05:40.000Z',
    last_presence_tick_enqueued_at: null,
    last_proactive_at: null,
    last_user_message_at: '2026-06-14T15:44:16.284Z',
    daily_proactive_count: 0
  }, now);

  assert.equal(anchors.lastActiveAt, null);
  assert.equal(anchors.lastBoredomResetAt, null);
  assert.equal(anchors.lastUserMessageAt, null);
  assert.equal(anchors.lastSleepAt, '2026-06-14T09:05:40.000Z');
});

test('shouldDiscardLifeProjectionCursor flags migrated future projection cursors', () => {
  const now = new Date('2026-06-14T10:00:00.000Z');

  assert.equal(shouldDiscardLifeProjectionCursor({
    reduced_through_occurred_at: '2026-06-14T15:46:20.086Z'
  }, null, now), true);
  assert.equal(shouldDiscardLifeProjectionCursor({
    reduced_through_occurred_at: '2026-06-14T09:46:20.086Z'
  }, {
    reducedThroughOccurredAt: '2026-06-14T15:46:20.086Z'
  }, now), true);
  assert.equal(shouldDiscardLifeProjectionCursor({
    reduced_through_occurred_at: '2026-06-14T09:46:20.086Z'
  }, null, now), false);
});

test('recoverStaleProcessingLeases releases committed runs and fails abandoned runs', async () => {
  const store = new RuntimeStore() as any;
  const queries: Array<{ sql: string; params?: unknown[] }> = [];
  const executes: Array<{ sql: string; params?: unknown[] }> = [];
  let queryCount = 0;
  store.sql = {
    withTransaction: async (callback: any) => callback({
      query: async (sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        queryCount += 1;
        if (queryCount === 1) {
          return [{ id: 'run_committed' }];
        }
        return [{ id: 'run_abandoned' }];
      },
      execute: async (sql: string, params?: unknown[]) => {
        executes.push({ sql, params });
        return 1;
      }
    }),
    close: async () => undefined
  };

  const result = await store.recoverStaleProcessingLeases({
    staleMs: 60_000,
    reason: 'test_startup_recovery'
  });

  assert.equal(result.settledRuns, 1);
  assert.equal(result.settledQueueMessages, 1);
  assert.equal(result.failedRuns, 1);
  assert.equal(result.failedQueueMessages, 2);
  assert.equal(result.orphanQueueMessages, 1);
  assert.equal(queries.length, 2);
  assert.equal(executes.some((call) => call.sql.includes("termination_reason = 'processing_recovery_visible_delivery_committed'")), true);
  assert.equal(executes.some((call) => call.sql.includes("termination_reason = 'processing_recovery_stale_processing'")), true);
  assert.equal(executes.some((call) => call.sql.includes("WHERE status = 'processing'") && call.sql.includes('locked_at IS NULL')), true);
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
    actionCost: 1,
    homeostaticPressure: 0,
    actionDebt: 1
  };

  assert.deepEqual(resolvePresenceRecoveryEvent(tiredState, new Date('2026-05-31T00:30:00.000Z')), {
    eventKind: 'sleep_period',
    reason: 'fatigue_sleep_window',
    bucketMs: 8 * 60 * 60 * 1000
  });
  assert.deepEqual(resolvePresenceRecoveryEvent(tiredState, new Date('2026-05-31T07:00:00.000Z')), {
    eventKind: 'rest_period',
    reason: 'fatigue_recovery',
    bucketMs: 60 * 60 * 1000
  });
  assert.deepEqual(resolvePresenceRecoveryEvent({ ...tiredState, fatigue: 0.75, energy: 0.25 }, new Date('2026-05-31T07:00:00.000Z')), {
    eventKind: 'rest_period',
    reason: 'fatigue_recovery',
    bucketMs: 60 * 60 * 1000
  });
  assert.equal(resolvePresenceRecoveryEvent({ ...tiredState, fatigue: 0.5 }, new Date('2026-05-31T07:00:00.000Z')), null);
});

test('recover_energy records rest recovery from the explicit recovery tool', async () => {
  const store = new RuntimeStore() as any;
  const lifeEvents: any[] = [];
  store.recordLifeEventSafe = async (input: any) => {
    lifeEvents.push(input);
  };
  store.refreshXiaoniLifeProjection = async () => undefined;

  await store.recordRecoverEnergyLifeEvent({
    queueMessage: createRuntimeStoreQueuePayload({
      source: 'presence_tick',
      chatType: 'direct',
      sessionKey: 'presence_tick:xiaoni',
      peerId: 'xiaoni',
      peerName: '小腻',
      bodyForAgent: '还没有打开任何具体会话',
      rawBody: 'presence_tick',
      commandBody: 'presence_tick',
      inboundContext: {
        Body: 'presence_tick',
        BodyForAgent: '还没有打开任何具体会话',
        BodyForCommands: 'presence_tick',
        NativeChannelId: 'presence_tick:xiaoni',
        CommandAuthorized: false,
        Surface: 'presence_tick'
      },
      messages: [],
      presenceTick: {
        identityKey: 'xiaoni'
      }
    }),
    runId: 'run-recover-energy',
    toolName: 'recover_energy',
    toolResult: {
      recovered: true,
      reason: '累了，先休息一下',
      duration_minutes: 45,
      duration_ms: 45 * 60 * 1000,
      xiaoni_os: '之后继续自己的事。'
    }
  });

  assert.equal(lifeEvents.length, 1);
  assert.equal(lifeEvents[0].eventKind, 'sleep_period');
  assert.equal(lifeEvents[0].surface, 'presence_tick');
  assert.equal(lifeEvents[0].actionCost, 0);
  assert.equal(lifeEvents[0].payload.tool_name, 'recover_energy');
  assert.equal(lifeEvents[0].payload.reason, '累了，先休息一下');
  assert.equal(lifeEvents[0].payload.duration_minutes, 45);
  assert.equal(lifeEvents[0].payload.duration_ms, 45 * 60 * 1000);
  assert.equal(lifeEvents[0].payload.xiaoni_os, '之后继续自己的事。');
  assert.equal(lifeEvents[0].payload.recovery_policy, 'recover_energy_tool_only');
  assert.equal('duration_label' in lifeEvents[0].payload, false);
});

test('recordQqUsageThreadSeen timestamps seen events at observation time with trace context', async () => {
  const store = new RuntimeStore() as any;
  const lifeEvents: any[] = [];
  store.recordLifeEventSafe = async (input: any) => {
    lifeEvents.push(input);
  };
  const before = Date.now();

  await store.recordQqUsageThreadSeen({
    threadKey: 'qq:group:253631878',
    unreadCount: 1,
    windowUnreadCount: 1,
    cursorAnchor: '1:1',
    latestMessageId: 12479,
    messages: [{
      id: 12479,
      message_sid: 'sid-seen-12479',
      chat_type: 'group',
      peer_id: '253631878',
      account_id: '1129974489',
      sender_id: '3994058476',
      sender_name: '小伊',
      peer_name: '群 253631878',
      body_for_agent: '历史消息正文',
      raw_body: '历史消息正文',
      message_timestamp: '2026-06-06T03:07:45.000Z',
      received_at: '2026-06-06T03:07:45.000Z',
      was_mentioned: 0
    }]
  }, 'qq_usage.focus_thread', {
    traceId: 'trace-qq-usage',
    runId: 'run-qq-usage',
    batchId: 'batch-qq-usage',
    toolCallId: 'call-exec',
    toolName: 'exec_command',
    sessionKey: 'xiaoni:test-global'
  });

  const seenEvent = lifeEvents.find((event) => event.eventKind === 'qq_message_seen');
  assert.ok(seenEvent);
  assert.ok(new Date(seenEvent.occurredAt).getTime() >= before);
  assert.equal(seenEvent.traceId, 'trace-qq-usage');
  assert.equal(seenEvent.runId, 'run-qq-usage');
  assert.equal(seenEvent.batchId, 'batch-qq-usage');
  assert.equal(seenEvent.payload.message_timestamp, '2026-06-06T03:07:45.000Z');
  assert.equal(seenEvent.payload.tool_call_id, 'call-exec');
  assert.equal(seenEvent.payload.source_session_key, 'xiaoni:test-global');
});

test('visible group replies charge one bounded action cost without per-message double counting', async () => {
  const store = new RuntimeStore() as any;
  const lifeEvents: any[] = [];
  store.recordLifeEventSafe = async (input: any) => {
    lifeEvents.push(input);
  };

  await store.recordVisibleDeliveryLifeEvents({
    queueMessage: createRuntimeStoreQueuePayload({
      source: 'agent_queue',
      presenceTick: undefined
    }),
    runId: 'run-visible-cost',
    toolName: 'send_in_group',
    toolResult: {
      sent_messages: ['第一句', '第二句']
    }
  });

  assert.equal(lifeEvents.length, 3);
  assert.equal(lifeEvents[0].eventKind, 'send_in_group');
  assert.equal(lifeEvents[0].actionCost, 0.015);
  assert.equal(lifeEvents[1].eventKind, 'qq_self_message');
  assert.equal(lifeEvents[1].actionCost, 0);
  assert.equal(lifeEvents[2].eventKind, 'qq_self_message');
  assert.equal(lifeEvents[2].actionCost, 0);
});

test('visible group delivery from a direct run is attributed to the target group', async () => {
  const store = new RuntimeStore() as any;
  const lifeEvents: any[] = [];
  store.recordLifeEventSafe = async (input: any) => {
    lifeEvents.push(input);
  };

  await store.recordVisibleDeliveryLifeEvents({
    queueMessage: createRuntimeStoreQueuePayload({
      chatType: 'direct',
      sessionKey: 'qq:direct:303:202',
      peerId: '202',
      peerName: 'Alice',
      inboundContext: {
        Body: '帮我去群里说一句',
        BodyForAgent: '帮我去群里说一句',
        BodyForCommands: '帮我去群里说一句',
        NativeChannelId: '202',
        CommandAuthorized: true
      }
    }),
    runId: 'run-direct-to-group',
    toolName: 'send_in_group',
    toolResult: {
      message_type: 'group',
      target_group_id: 253631878,
      sent_messages: ['我去群里说一句']
    }
  });

  assert.equal(lifeEvents.length, 2);
  assert.equal(lifeEvents[0].eventKind, 'send_in_group');
  assert.equal(lifeEvents[0].chatType, 'group');
  assert.equal(lifeEvents[0].sessionKey, 'qq:group:253631878');
  assert.equal(lifeEvents[0].peerId, '253631878');
  assert.equal(lifeEvents[1].eventKind, 'qq_self_message');
  assert.equal(lifeEvents[1].chatType, 'group');
  assert.equal(lifeEvents[1].sessionKey, 'qq:group:253631878');
  assert.equal(lifeEvents[1].actionCost, 0);
});

test('renderXiaoniLifeStateExplanation tells current energy and recent action costs', () => {
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
        effect: '刚才记录了一次休息恢复，恢复后累计行动成本重置为 0.00'
      },
      {
        eventId: '2',
        eventKind: 'send_in_group',
        occurredAt: '2026-05-31T06:30:00.000Z',
        effect: '已经开口，行动成本 1.00'
      },
      {
        eventId: '1',
        eventKind: 'presence_tick_evaluated',
        occurredAt: '2026-05-31T06:00:00.000Z',
        effect: '空闲检查被跳过'
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
  assert.match(text, /最近行动消耗：已经开口，行动成本 1\.00/);
  assert.match(text, /刚才怎么恢复：刚才记录了一次休息恢复，恢复后累计行动成本重置为 0\.00/);
  assert.doesNotMatch(text, /无聊=|疲劳=|分享欲=|困倦压力=|疲劳怎么算|空闲检查被跳过/);
});

test('recordNoVisibleDeliveryLifeEvent records lurked action as self-private no-visible-delivery event', async () => {
  const store = createStoreWithSql({});
  const lifeEvents: any[] = [];
  (store as any).recordLifeEventSafe = async (input: any) => {
    lifeEvents.push(input);
  };

  const queueMessage = createRuntimeStoreQueuePayload();

  await store.recordNoVisibleDeliveryLifeEvent({
    queueMessage,
    outcome: 'lurked',
    presenceOutcome: 'lurked',
    leaseRelease: {
      reason: 'rest_started',
      detail: 'opened the group and stayed quiet',
      outcome: 'rest_started',
      noVisibleDelivery: true
    },
    modelRequestSlices: 1,
    conversationId: 42
  });

  assert.equal(lifeEvents.length, 1);
  const event = lifeEvents[0];
  assert.equal(event.eventKind, 'no_visible_delivery_observed');
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
  assert.equal(event.payload.lease_release.reason, 'rest_started');
  assert.equal(event.payload.lease_release.detail, 'opened the group and stayed quiet');
  assert.equal(event.payload.reason, 'opened the group and stayed quiet');
  assert.equal(event.payload.conversation_id, 42);
  assert.match(event.dedupeKey, /^no_visible_delivery:run-runtime-silence:qq:group:999$/);
});

test('listRecentTurns restores prompt-visible items only from conversation_items ledger', async () => {
  const queries: string[] = [];
  const store = createStoreWithQuery(async (sql) => {
    queries.push(sql);
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
      return [
        {
          id: 10,
          conversation_id: 1,
          session_key: 'qq:group:101',
          role: 'user',
          phase: null,
          content: '<INPUT_MESSAGE>ledger 原文</INPUT_MESSAGE>',
          group_index: 0,
          item_index: 0,
          source: 'inbound_batch',
          delivery_message_id: null,
          run_id: 'run-1',
          trace_id: 'trace-1'
        },
        {
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
        }
      ];
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

    if (sql.includes('legacy_llm_audit_table')) {
      return [];
    }

    if (sql.includes('legacy_tool_audit_table')) {
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
  assert.equal(turns[0]?.items[0]?.content, '<INPUT_MESSAGE>ledger 原文</INPUT_MESSAGE>');
  assert.equal(turns[0]?.items[1]?.content, '历史助手回复');
  assert.equal(queries.some((sql) => sql.includes('FROM agent_queue_messages q')), false);
  assert.equal(queries.some((sql) => sql.includes('FROM agent_inbound_messages m')), false);
  assert.equal(queries.some((sql) => sql.includes('legacy_llm_audit_table')), false);
  assert.equal(queries.some((sql) => sql.includes('legacy_tool_audit_table')), false);
});

test('listRecentTurns reads stored transcript ledger content when queue payloads are unavailable', async () => {
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

    if (sql.includes('legacy_llm_audit_table')) {
      return [];
    }

    if (sql.includes('legacy_tool_audit_table')) {
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

test('listRecentTurns does not synthesize missing user items from inbound messages', async () => {
  const queries: string[] = [];
  const store = createStoreWithQuery(async (sql) => {
    queries.push(sql);
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

    if (sql.includes('legacy_llm_audit_table')) {
      return [];
    }

    if (sql.includes('legacy_tool_audit_table')) {
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
  assert.equal(turns[0]?.items[0]?.role, 'assistant');
  assert.equal(turns[0]?.items[0]?.content, '历史助手回复');
  assert.equal(queries.some((sql) => sql.includes('FROM agent_inbound_messages m')), false);
});

test('listRecentTurns preserves raw response replay snapshot without recovering from logs', async () => {
  const queries: string[] = [];
  const store = createStoreWithQuery(async (sql) => {
    queries.push(sql);
    if (sql.includes('FROM conversations')) {
      return [{
        id: 1,
        batch_id: null,
        trace_id: 'trace-1',
        user_id: 202,
        group_id: 101,
        user_message: '上一轮消息',
        ai_response: '上一轮回复',
        raw_response: JSON.stringify({
          responses_replay_items: [{
            type: 'reasoning',
            id: 'rs_1',
            summary: [{
              type: 'summary_text',
              text: '看了一眼消息列表。'
            }],
            content: []
          }, {
            type: 'function_call',
            call_id: 'call-exec-1',
            name: 'exec_command',
            arguments: '{"cmd":"python3 /app/modules/agent-service/skills/qq-usage/scripts/qq_usage.py open_inbox"}'
          }]
        })
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

    if (sql.includes('legacy_llm_audit_table')) {
      return [{
        id: 67,
        trace_id: 'trace-1',
        agent_turn: 2,
        canonical_response: JSON.stringify({
          id: 'resp-1',
          output: [{
            type: 'message',
            role: 'assistant',
            phase: 'commentary',
            content: [{
              type: 'output_text',
              text: '我先打开列表看一下。'
            }]
          }, {
            type: 'function_call',
            call_id: 'call-exec-1',
            name: 'exec_command',
            arguments: '{"cmd":"python3 /app/modules/agent-service/skills/qq-usage/scripts/qq_usage.py open_inbox"}'
          }]
        }),
        started_at: '2026-03-28T08:00:00.500Z'
      }];
    }

    if (sql.includes('legacy_tool_audit_table')) {
      return [{
        id: 77,
        trace_id: 'trace-1',
        agent_turn: 2,
        tool_call_id: 'call-exec-1',
        tool_name: 'exec_command',
        arguments: {
          cmd: 'python3 /app/modules/agent-service/skills/qq-usage/scripts/qq_usage.py open_inbox'
        },
        result: {
          codex_output: 'Chunk ID: abc\nOutput:\n<IM_INBOX_WINDOW mode="thread_list"></IM_INBOX_WINDOW>',
          stdout: '<IM_INBOX_WINDOW mode="thread_list"></IM_INBOX_WINDOW>'
        },
        started_at: '2026-03-28T08:00:01.000Z'
      }];
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const turns = await store.listRecentTurns({
    userId: 202,
    groupId: 101
  });

  assert.equal(turns.length, 1);
  const firstTurn = turns[0];
  assert.ok(firstTurn);
  const replayItems = (firstTurn.rawResponse?.responses_replay_items || []) as Array<Record<string, unknown>>;
  assert.equal(replayItems.length, 2);
  assert.ok(replayItems.some((item) => item.type === 'reasoning' && item.id === 'rs_1'));
  assert.ok(replayItems.some((item) => (
    item.type === 'function_call'
    && item.call_id === 'call-exec-1'
    && item.name === 'exec_command'
    && String(item.arguments).includes('open_inbox')
  )));
  assert.equal(replayItems.filter((item) => item.type === 'function_call' && item.call_id === 'call-exec-1').length, 1);
  assert.equal(replayItems.some((item) => item.type === 'message'), false);
  assert.equal(replayItems.some((item) => item.type === 'function_call_output'), false);
  assert.equal(queries.some((sql) => sql.includes('legacy_llm_audit_table')), false);
  assert.equal(queries.some((sql) => sql.includes('legacy_tool_audit_table')), false);
});

test('listRecentTurns can read the global append stream for runtime loop frames', async () => {
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

    if (sql.includes('legacy_llm_audit_table')) {
      return [];
    }

    if (sql.includes('legacy_tool_audit_table')) {
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

test('getExecutionLeaseDeliveryState returns normalized persisted delivery state', async () => {
  const store = createStoreWithSql({
    query: async () => [{
      delivery_phase: 'delivery_committed',
      delivery_commit_count: 1,
      blocked_delivery_attempt_count: 2,
      last_blocked_delivery_reason: 'Outbound delivery already committed earlier in this run.'
    }]
  });

  const state = await store.getExecutionLeaseDeliveryState('run-1');

  assert.deepEqual(state, {
    deliveryPhase: 'delivery_committed',
    deliveryCommitCount: 1,
    blockedDeliveryAttemptCount: 2,
    lastBlockedDeliveryReason: 'Outbound delivery already committed earlier in this run.'
  });
});

test('markLeaseVisibleDeliveryCommitted increments visible delivery commit count', async () => {
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

  await store.markLeaseVisibleDeliveryCommitted('run-commit');

  assert.equal(executeCalls.length, 1);
  assert.match(executeCalls[0]?.sql || '', /delivery_phase = 'delivery_committed'/);
  assert.match(executeCalls[0]?.sql || '', /delivery_commit_count = COALESCE\(delivery_commit_count, 0\) \+ 1/);
  assert.deepEqual(executeCalls[0]?.params, ['run-commit']);
  assert.equal(lifeEvents[0]?.eventKind, 'visible_delivery_committed');
  assert.equal(lifeEvents[0]?.visibility, 'operator_only');
});

test('markLeaseDeliveryBlocked increments blocked attempt count and reason', async () => {
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

  await store.markLeaseDeliveryBlocked('run-blocked', 'Outbound delivery already committed earlier in this run.');

  assert.equal(executeCalls.length, 1);
  assert.match(executeCalls[0]?.sql || '', /blocked_delivery_attempt_count = COALESCE\(blocked_delivery_attempt_count, 0\) \+ 1/);
  assert.match(executeCalls[0]?.sql || '', /last_blocked_delivery_reason = \?/);
  assert.deepEqual(executeCalls[0]?.params, ['Outbound delivery already committed earlier in this run.', 'run-blocked']);
  assert.equal(lifeEvents[0]?.eventKind, 'post_commit_side_effect_blocked');
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
