import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_RECOVER_ENERGY_POLICY,
  computeRequiredSleepPressure,
  computeWakeRequiredCount,
  projectRecoverySession,
  shouldAcceptVoluntaryRecovery
} from '../services/recover-energy-policy';

test('fresh wake penalty blocks high-energy repeated sleep but decays continuously', () => {
  const now = new Date('2026-06-13T10:00:00.000Z');
  const justWoke = computeRequiredSleepPressure({
    now,
    lastWakeAt: new Date('2026-06-13T09:59:00.000Z')
  });
  const later = computeRequiredSleepPressure({
    now,
    lastWakeAt: new Date('2026-06-13T08:00:00.000Z')
  });

  assert.ok(justWoke > later);
  assert.equal(shouldAcceptVoluntaryRecovery({
    energy: 0.8,
    maxEnergy: 1,
    now,
    lastWakeAt: new Date('2026-06-13T09:59:00.000Z')
  }).accepted, false);
  assert.equal(shouldAcceptVoluntaryRecovery({
    energy: 0.1,
    maxEnergy: 1,
    now,
    lastWakeAt: new Date('2026-06-13T09:59:00.000Z')
  }).accepted, true);
});

test('negative energy cannot be woken by clock or mentions before minimum wake line', () => {
  const startedAt = new Date('2026-06-13T10:00:00.000Z');
  const projected = projectRecoverySession({
    startEnergy: -0.35,
    maxEnergy: 1,
    startedAt,
    now: new Date('2026-06-13T10:01:00.000Z'),
    clockDueAt: new Date('2026-06-13T10:01:00.000Z'),
    wakeCallCount: 99
  });

  assert.equal(projected.shouldWake, false);
  assert.equal(projected.clockShouldDefer, true);
  assert.equal(projected.wakeRequiredCount, Number.POSITIVE_INFINITY);
});

test('hard cap wakes even when other wake causes are unavailable', () => {
  const startedAt = new Date('2026-06-13T10:00:00.000Z');
  const projected = projectRecoverySession({
    startEnergy: -0.6,
    maxEnergy: 1,
    startedAt,
    now: new Date(startedAt.getTime() + (DEFAULT_RECOVER_ENERGY_POLICY.hardMaxRecoveryMinutes * 60 * 1000)),
    wakeCallCount: 0
  });

  assert.equal(projected.shouldWake, true);
  assert.equal(projected.wakeCause, 'hard_cap');
});

test('wake threshold grows with sleep pressure', () => {
  assert.ok(
    computeWakeRequiredCount({ energy: 0.1, pressure: 0.9 })
      > computeWakeRequiredCount({ energy: 0.8, pressure: 0.2 })
  );
});
