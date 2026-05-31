import test from 'node:test';
import assert from 'node:assert/strict';
import type { AgentLifeEventProjection } from '@qq-bot/persistence';
import {
  reduceXiaoniLifeState,
  XIAONI_LIFE_PROJECTION_VERSION
} from '../services/xiaoni-life-reducer';

function event(overrides: Partial<AgentLifeEventProjection>): AgentLifeEventProjection {
  return {
    id: '1',
    identityKey: 'xiaoni',
    eventKind: 'qq_message_seen',
    occurredAt: '2026-05-31T00:00:00.000Z',
    surface: null,
    chatType: null,
    sessionKey: null,
    surfaceId: null,
    peerId: null,
    accountId: null,
    messageSid: null,
    messageId: null,
    batchId: null,
    conversationId: null,
    conversationItemId: null,
    queueMessageId: null,
    runId: null,
    traceId: null,
    llmCallId: null,
    sourceActionId: null,
    actorType: 'xiaoni',
    actorId: null,
    targetId: null,
    visibility: 'self_private',
    actionCost: 0,
    pressureDelta: 0,
    rewardDelta: 0,
    boredomDelta: 0,
    attentionDelta: 0,
    payload: {},
    dedupeKey: `event:${overrides.id || '1'}`,
    createdAt: '2026-05-31T00:00:00.000Z',
    ...overrides
  };
}

test('reduceXiaoniLifeState is deterministic by occurred_at then id', () => {
  const now = new Date('2026-05-31T12:00:00.000Z');
  const events = [
    event({
      id: '2',
      eventKind: 'speak_in_group',
      occurredAt: '2026-05-31T09:00:00.000Z',
      actionCost: 0.2
    }),
    event({
      id: '1',
      eventKind: 'web_search_result',
      occurredAt: '2026-05-31T09:00:00.000Z',
      rewardDelta: 0.1
    })
  ];

  const left = reduceXiaoniLifeState({ now, events });
  const right = reduceXiaoniLifeState({ now, events: [...events].reverse() });

  assert.deepEqual(left.projection.state, right.projection.state);
  assert.equal(left.projection.reducedThroughEventId, '2');
  assert.equal(left.projection.version, XIAONI_LIFE_PROJECTION_VERSION);
});

test('reduceXiaoniLifeState does not treat silence as boredom reset', () => {
  const result = reduceXiaoniLifeState({
    now: new Date('2026-05-31T12:00:00.000Z'),
    legacyAnchors: {
      now: new Date('2026-05-31T12:00:00.000Z'),
      serviceStartedAt: '2026-05-31T00:00:00.000Z',
      lastBoredomResetAt: '2026-05-31T00:00:00.000Z',
      lastActiveAt: '2026-05-31T00:00:00.000Z'
    },
    events: [
      event({
        id: '3',
        eventKind: 'silence_decision',
        occurredAt: '2026-05-31T11:55:00.000Z',
        payload: { reason: 'finish_no_reply' }
      })
    ]
  });

  assert.ok(result.projection.state.boredom > 0.9);
  assert.match(result.explanation.summary, /boredom=/);
});

test('rest and sleep events lower fatigue pressure', () => {
  const now = new Date('2026-05-31T12:00:00.000Z');
  const tired = reduceXiaoniLifeState({
    now,
    legacyAnchors: {
      now,
      serviceStartedAt: '2026-05-30T00:00:00.000Z',
      lastBoredomResetAt: '2026-05-30T00:00:00.000Z',
      lastActiveAt: '2026-05-30T00:00:00.000Z',
      lastSleepAt: '2026-05-30T00:00:00.000Z'
    },
    events: []
  });
  const rested = reduceXiaoniLifeState({
    now,
    legacyAnchors: {
      now,
      serviceStartedAt: '2026-05-30T00:00:00.000Z',
      lastBoredomResetAt: '2026-05-30T00:00:00.000Z',
      lastActiveAt: '2026-05-30T00:00:00.000Z',
      lastSleepAt: '2026-05-30T00:00:00.000Z'
    },
    events: [
      event({
        id: '4',
        eventKind: 'sleep_period',
        occurredAt: '2026-05-31T10:00:00.000Z'
      })
    ]
  });

  assert.ok(rested.projection.state.fatigue < tired.projection.state.fatigue);
  assert.ok(rested.projection.state.sleepPressure < tired.projection.state.sleepPressure);
});

test('presence tick evaluation event drives cooldown only when enqueued', () => {
  const now = new Date('2026-05-31T12:00:00.000Z');
  const skipped = reduceXiaoniLifeState({
    now,
    events: [
      event({
        id: '5',
        eventKind: 'presence_tick_evaluated',
        occurredAt: '2026-05-31T11:55:00.000Z',
        payload: { eligible: false, skip_reason: 'not_bored' }
      })
    ],
    cooldownMs: 45 * 60 * 1000
  });
  const enqueued = reduceXiaoniLifeState({
    now,
    events: [
      event({
        id: '6',
        eventKind: 'presence_tick_evaluated',
        occurredAt: '2026-05-31T11:55:00.000Z',
        payload: { eligible: true, enqueued: true, queue_id: '9' }
      })
    ],
    cooldownMs: 45 * 60 * 1000
  });

  assert.equal(skipped.projection.state.cooldownActive, false);
  assert.equal(enqueued.projection.state.cooldownActive, true);
});

test('projection can resume from previous reduced state', () => {
  const first = reduceXiaoniLifeState({
    now: new Date('2026-05-31T10:00:00.000Z'),
    events: [
      event({
        id: '7',
        eventKind: 'web_search_result',
        occurredAt: '2026-05-31T09:30:00.000Z',
        rewardDelta: 0.2
      })
    ]
  });
  const second = reduceXiaoniLifeState({
    now: new Date('2026-05-31T12:00:00.000Z'),
    previousProjection: first.projection,
    events: [
      event({
        id: '8',
        eventKind: 'speak_in_group',
        occurredAt: '2026-05-31T11:30:00.000Z',
        actionCost: 0.1
      })
    ]
  });

  assert.equal(second.projection.reducedThroughEventId, '8');
  assert.equal(second.projection.counters.eventCount, 2);
  assert.ok(second.explanation.contributors.some((entry) => entry.eventKind === 'speak_in_group'));
});

