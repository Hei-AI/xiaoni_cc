import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveLifeState,
  scoreSharePoolItem,
  shouldFirePresenceTick
} from '../services/presence-context';

test('shouldFirePresenceTick still ignores cooldown when energy is available', () => {
  const now = new Date('2026-05-26T12:00:00.000Z');
  const state = deriveLifeState({
    now,
    serviceStartedAt: '2026-05-26T06:00:00.000Z',
    lastBoredomResetAt: '2026-05-26T09:00:00.000Z',
    lastActiveAt: '2026-05-26T06:00:00.000Z',
    lastPresenceTickEnqueuedAt: '2026-05-26T11:30:00.000Z'
  }, {
    cooldownMs: 45 * 60 * 1000,
    startupGraceMs: 5 * 60 * 1000
  });

  assert.ok(state.boredom >= 0.9);
  assert.ok(state.energy > 0.5);
  assert.equal(state.cooldownActive, true);
  assert.equal(shouldFirePresenceTick(state).reason, 'eligible');
});

test('shouldFirePresenceTick blocks presence checks when fatigue exhausts energy', () => {
  assert.deepEqual(shouldFirePresenceTick({
    boredom: 1,
    fatigue: 0.95,
    energy: 0.05,
    sharingDesire: 0.4,
    sleepPressure: 0.95,
    cooldownActive: false,
    startupGraceActive: false
  }), { shouldEnqueue: false, reason: 'fatigue' });
  assert.deepEqual(shouldFirePresenceTick({
    boredom: 0.4,
    fatigue: 0.75,
    energy: 0.25,
    sharingDesire: 0.2,
    sleepPressure: 0.75,
    cooldownActive: false,
    startupGraceActive: false
  }), { shouldEnqueue: false, reason: 'fatigue' });
});

test('shouldFirePresenceTick also allows checks during startup grace', () => {
  const state = deriveLifeState({
    now: new Date('2026-05-26T12:00:00.000Z'),
    serviceStartedAt: '2026-05-26T06:00:00.000Z',
    lastBoredomResetAt: '2026-05-26T08:00:00.000Z',
    lastActiveAt: '2026-05-26T08:00:00.000Z',
    lastPresenceTickEnqueuedAt: '2026-05-26T10:00:00.000Z'
  }, {
    cooldownMs: 45 * 60 * 1000,
    startupGraceMs: 5 * 60 * 1000
  });

  assert.deepEqual(shouldFirePresenceTick({
    ...state,
    startupGraceActive: true
  }), { shouldEnqueue: true, reason: 'eligible' });
});

test('presence decision does not depend on sharing desire or previous proactive count', () => {
  const state = deriveLifeState({
    now: new Date('2026-05-26T12:00:00.000Z'),
    serviceStartedAt: '2026-05-26T06:00:00.000Z',
    lastBoredomResetAt: '2026-05-26T08:00:00.000Z',
    lastActiveAt: '2026-05-26T08:00:00.000Z',
    lastPresenceTickEnqueuedAt: '2026-05-26T10:00:00.000Z',
    dailyProactiveCount: 12
  }, {
    cooldownMs: 45 * 60 * 1000,
    startupGraceMs: 5 * 60 * 1000
  });

  assert.ok(state.sharingDesire > 0.35);
  assert.equal(shouldFirePresenceTick(state).reason, 'eligible');
});

test('scoreSharePoolItem boosts fresh safe material over stale reframe material', () => {
  const now = new Date('2026-05-26T12:00:00.000Z');
  const fresh = scoreSharePoolItem({
    id: 1,
    content: '一个关于游戏 UI 的短吐槽',
    sourceKind: 'mock',
    boundaryLabel: 'safe',
    sourceWording: 'mock_only',
    effortCost: 1,
    baseHeat: 1,
    createdAt: '2026-05-26T11:30:00.000Z'
  }, now);
  const stale = scoreSharePoolItem({
    id: 2,
    content: '需要改写掉本地细节的话题',
    sourceKind: 'group_residue',
    boundaryLabel: 'reframe',
    sourceWording: 'mock_only',
    effortCost: 4,
    baseHeat: 1,
    createdAt: '2026-05-23T12:00:00.000Z'
  }, now);

  assert.ok(fresh.finalScore > stale.finalScore);
});
