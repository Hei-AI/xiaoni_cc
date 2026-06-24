import test from 'node:test';
import assert from 'node:assert/strict';
import type { AgentLifeEventProjection } from '@qq-bot/persistence';
import {
  reduceXiaoniLifeState,
  XIAONI_LIFE_PROJECTION_VERSION
} from '../services/xiaoni-life-reducer';
import { shouldAcceptVoluntaryRecovery } from '../services/recover-energy-policy';

function assertApprox(actual: number, expected: number, epsilon = 0.000001) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} !== ${expected}`);
}

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

function minutesAfter(date: Date, minutes: number) {
  return new Date(date.getTime() + (minutes * 60 * 1000)).toISOString();
}

function densePostWakeQqEvents(wakeAt: Date): AgentLifeEventProjection[] {
  const events: AgentLifeEventProjection[] = [
    event({
      id: 'incident-sleep',
      eventKind: 'sleep_period',
      occurredAt: wakeAt.toISOString(),
      payload: {
        energy: 0.8300980845774224,
        max_energy: 1,
        wake_cause: 'natural',
        sleep_minutes: 53
      }
    })
  ];
  let id = 1;
  for (let index = 0; index < 13; index += 1) {
    events.push(event({
      id: `incident-surface-${id++}`,
      eventKind: 'surface_visit',
      occurredAt: minutesAfter(wakeAt, 5 + (index * 1.4)),
      actionCost: 0.01,
      payload: { source: 'qq_usage', action: 'qq_usage.focus_private' }
    }));
    events.push(event({
      id: `incident-reply-${id++}`,
      eventKind: 'qq_self_message',
      occurredAt: minutesAfter(wakeAt, 5.3 + (index * 1.4)),
      actionCost: 0.01,
      payload: { tool_name: 'send_in_private', index: 0 }
    }));
  }
  events.push(event({
    id: `incident-reply-${id++}`,
    eventKind: 'qq_self_message',
    occurredAt: minutesAfter(wakeAt, 35),
    actionCost: 0.01,
    payload: { tool_name: 'send_in_private', index: 0 }
  }));
  return events;
}

test('reduceXiaoniLifeState is deterministic by occurred_at then id', () => {
  const now = new Date('2026-05-31T12:00:00.000Z');
  const events = [
    event({
      id: '2',
      eventKind: 'send_in_group',
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
        eventKind: 'no_visible_delivery_observed',
        occurredAt: '2026-05-31T11:55:00.000Z',
        payload: { lease_release: { reason: 'rest_started' } }
      })
    ]
  });

  assert.ok(result.projection.state.boredom > 0.9);
  assert.match(result.explanation.summary, /当前精力=/);
  assert.doesNotMatch(result.explanation.summary, /无聊=|疲劳=|分享欲=|困倦压力=/);
});

test('action debt contributes to fatigue while sleep event energy anchors recovery', () => {
  const now = new Date('2026-05-31T12:00:00.000Z');
  const tired = reduceXiaoniLifeState({
    now,
    events: [
      event({
        id: '4',
        eventKind: 'send_in_group',
        occurredAt: '2026-05-31T09:00:00.000Z',
        actionCost: 0.8
      })
    ]
  });
  const rested = reduceXiaoniLifeState({
    now,
    events: [
      event({
        id: '4',
        eventKind: 'send_in_group',
        occurredAt: '2026-05-31T09:00:00.000Z',
        actionCost: 0.8
      }),
      event({
        id: '5',
        eventKind: 'rest_period',
        occurredAt: '2026-05-31T10:00:00.000Z'
      })
    ]
  });
  const slept = reduceXiaoniLifeState({
    now,
    events: [
      event({
        id: '4',
        eventKind: 'send_in_group',
        occurredAt: '2026-05-31T09:00:00.000Z',
        actionCost: 0.8
      }),
      event({
        id: '6',
        eventKind: 'sleep_period',
        occurredAt: '2026-05-31T12:00:00.000Z',
        payload: {
          energy: 1,
          max_energy: 1
        }
      })
    ]
  });

  assert.ok(tired.projection.state.actionCost > 0.48);
  assert.ok(tired.projection.state.actionCost < 0.49);
  assert.ok(tired.projection.state.fatigue > tired.projection.state.actionCost);
  assert.equal(tired.projection.state.energy, 1 - tired.projection.state.fatigue);
  assert.ok(rested.projection.state.fatigue < tired.projection.state.fatigue);
  assert.equal(slept.projection.state.fatigue, 0);
  assert.equal(slept.projection.state.energy, 1);
});

test('awake homeostatic pressure accumulates from last sleep anchor', () => {
  const anchors = {
    now: new Date('2026-05-31T08:00:00.000Z'),
    serviceStartedAt: '2026-05-31T08:00:00.000Z',
    lastSleepAt: '2026-05-31T08:00:00.000Z',
    lastBoredomResetAt: '2026-05-31T08:00:00.000Z',
    lastActiveAt: '2026-05-31T08:00:00.000Z'
  };
  const twoHours = reduceXiaoniLifeState({
    now: new Date('2026-05-31T10:00:00.000Z'),
    legacyAnchors: anchors,
    events: []
  });
  const fourHours = reduceXiaoniLifeState({
    now: new Date('2026-05-31T12:00:00.000Z'),
    legacyAnchors: anchors,
    events: []
  });
  const eightHours = reduceXiaoniLifeState({
    now: new Date('2026-05-31T16:00:00.000Z'),
    legacyAnchors: anchors,
    events: []
  });

  assert.ok(twoHours.projection.state.homeostaticPressure > 0.06);
  assert.ok(twoHours.projection.state.homeostaticPressure < 0.11);
  assert.ok(fourHours.projection.state.homeostaticPressure > twoHours.projection.state.homeostaticPressure);
  assert.ok(eightHours.projection.state.homeostaticPressure > fourHours.projection.state.homeostaticPressure);
  assert.ok(twoHours.projection.state.energy > fourHours.projection.state.energy);
  assert.ok(fourHours.projection.state.energy > eightHours.projection.state.energy);
});

test('night awake pressure rises faster than daytime awake pressure', () => {
  const nightAnchors = {
    now: new Date('2026-06-12T18:00:00.000Z'),
    serviceStartedAt: '2026-06-12T18:00:00.000Z',
    lastSleepAt: '2026-06-12T18:00:00.000Z',
    lastBoredomResetAt: '2026-06-12T18:00:00.000Z',
    lastActiveAt: '2026-06-12T18:00:00.000Z'
  };
  const dayAnchors = {
    now: new Date('2026-06-13T06:00:00.000Z'),
    serviceStartedAt: '2026-06-13T06:00:00.000Z',
    lastSleepAt: '2026-06-13T06:00:00.000Z',
    lastBoredomResetAt: '2026-06-13T06:00:00.000Z',
    lastActiveAt: '2026-06-13T06:00:00.000Z'
  };

  const night = reduceXiaoniLifeState({
    now: new Date('2026-06-12T20:00:00.000Z'),
    legacyAnchors: nightAnchors,
    events: []
  });
  const day = reduceXiaoniLifeState({
    now: new Date('2026-06-13T08:00:00.000Z'),
    legacyAnchors: dayAnchors,
    events: []
  });

  assert.ok(night.projection.state.homeostaticPressure > day.projection.state.homeostaticPressure);
  assert.ok(night.projection.state.energy < day.projection.state.energy);
});

test('projection resume advances awake pressure once without double counting', () => {
  const anchors = {
    now: new Date('2026-05-31T08:00:00.000Z'),
    serviceStartedAt: '2026-05-31T08:00:00.000Z',
    lastSleepAt: '2026-05-31T08:00:00.000Z',
    lastBoredomResetAt: '2026-05-31T08:00:00.000Z',
    lastActiveAt: '2026-05-31T08:00:00.000Z'
  };
  const first = reduceXiaoniLifeState({
    now: new Date('2026-05-31T10:00:00.000Z'),
    legacyAnchors: anchors,
    events: []
  });
  const resumed = reduceXiaoniLifeState({
    now: new Date('2026-05-31T12:00:00.000Z'),
    previousProjection: first.projection,
    events: []
  });
  const rebuilt = reduceXiaoniLifeState({
    now: new Date('2026-05-31T12:00:00.000Z'),
    legacyAnchors: anchors,
    events: []
  });

  assertApprox(resumed.projection.state.homeostaticPressure, rebuilt.projection.state.homeostaticPressure);
  assertApprox(resumed.projection.state.energy, rebuilt.projection.state.energy);
});

test('legacy sleep event without explicit energy does not fake full recovery', () => {
  const result = reduceXiaoniLifeState({
    now: new Date('2026-05-31T10:00:00.000Z'),
    events: [
      event({
        id: 'legacy-action',
        eventKind: 'send_in_group',
        occurredAt: '2026-05-31T09:00:00.000Z',
        actionCost: 0.8
      }),
      event({
        id: 'legacy-sleep',
        eventKind: 'sleep_period',
        occurredAt: '2026-05-31T10:00:00.000Z'
      })
    ]
  });

  assert.ok(result.projection.state.fatigue > 0);
  assert.ok(result.projection.state.energy < 1);
});

test('default speech accounting does not exhaust all energy for one group reply', () => {
  const result = reduceXiaoniLifeState({
    now: new Date('2026-05-31T12:00:00.000Z'),
    events: [
      event({
        id: 'speech-1',
        eventKind: 'send_in_group',
        occurredAt: '2026-05-31T11:00:00.000Z'
      }),
      event({
        id: 'speech-2',
        eventKind: 'qq_self_message',
        occurredAt: '2026-05-31T11:00:01.000Z'
      })
    ]
  });

  assert.ok(result.projection.state.actionCost > 0.005);
  assert.ok(result.projection.state.actionCost < 0.009);
  assert.ok(result.projection.state.fatigue > result.projection.state.actionCost);
  assert.ok(result.projection.state.energy < 0.99);
  assert.ok(result.projection.state.energy > 0.7);
});

test('dense post-wake QQ exchange does not immediately reopen voluntary sleep gate', () => {
  const wakeAt = new Date('2026-06-14T12:58:38.879Z');
  const now = new Date('2026-06-14T13:34:01.332Z');
  const result = reduceXiaoniLifeState({
    now,
    events: densePostWakeQqEvents(wakeAt)
  });
  const recoveryGate = shouldAcceptVoluntaryRecovery({
    energy: result.projection.state.energy,
    maxEnergy: 1,
    lastWakeAt: result.projection.anchors.lastRestAt,
    now
  });

  assert.equal(recoveryGate.accepted, false);
  assert.ok(result.projection.state.energy > 0.5);
  assert.ok(result.projection.state.actionDebt < 0.27);
});

test('time-decayed action debt is stable across projection resume boundaries', () => {
  const wakeAt = new Date('2026-06-14T12:58:38.879Z');
  const now = new Date('2026-06-14T13:34:01.332Z');
  const events = densePostWakeQqEvents(wakeAt);
  const splitIndex = 15;
  const firstHalf = events.slice(0, splitIndex);
  const secondHalf = events.slice(splitIndex);
  const midNow = new Date(firstHalf[firstHalf.length - 1].occurredAt || wakeAt);
  const rebuilt = reduceXiaoniLifeState({ now, events });
  const first = reduceXiaoniLifeState({ now: midNow, events: firstHalf });
  const resumed = reduceXiaoniLifeState({
    now,
    previousProjection: first.projection,
    events: secondHalf
  });

  assertApprox(resumed.projection.state.energy, rebuilt.projection.state.energy);
  assertApprox(resumed.projection.state.actionDebt, rebuilt.projection.state.actionDebt);
  assertApprox(resumed.projection.state.homeostaticPressure, rebuilt.projection.state.homeostaticPressure);
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
        eventKind: 'send_in_group',
        occurredAt: '2026-05-31T11:30:00.000Z',
        actionCost: 0.1
      })
    ]
  });

  assert.equal(second.projection.reducedThroughEventId, '8');
  assert.equal(second.projection.counters.eventCount, 2);
  assert.ok(second.explanation.contributors.some((entry) => entry.eventKind === 'send_in_group'));
});
