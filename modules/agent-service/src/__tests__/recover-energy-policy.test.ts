import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_RECOVER_ENERGY_POLICY,
  computeSleepPressureAfterMinutes,
  computeAwakePressureAfterMinutes,
  computeRequiredSleepPressure,
  computeWakeRequiredCount,
  projectRecoverySession,
  shouldAcceptVoluntaryRecovery
} from '../services/recover-energy-policy';

test('recover energy uses Xiaoni two-hour compressed sleep cycle', () => {
  assert.equal(DEFAULT_RECOVER_ENERGY_POLICY.hardMaxRecoveryMinutes, 120);
  assert.equal(DEFAULT_RECOVER_ENERGY_POLICY.sleepTauMinutes, 63);
  assert.equal(DEFAULT_RECOVER_ENERGY_POLICY.wakeTauMinutes, 273);
});

test('sleep pressure follows normalized curve and reaches full recovery at two hours', () => {
  const startPressure = 1.6;
  const start = computeSleepPressureAfterMinutes({ startPressure, elapsedMinutes: 0 });
  const middle = computeSleepPressureAfterMinutes({ startPressure, elapsedMinutes: 60 });
  const beforeFullCycle = computeSleepPressureAfterMinutes({ startPressure, elapsedMinutes: 119 });
  const fullCycle = computeSleepPressureAfterMinutes({ startPressure, elapsedMinutes: 120 });

  assert.equal(start, startPressure);
  assert.ok(middle > beforeFullCycle);
  assert.ok(middle > 0);
  assert.ok(beforeFullCycle > 0);
  assert.equal(fullCycle, 0);
});

test('awake pressure uses compressed wake tau', () => {
  const twoHours = computeAwakePressureAfterMinutes({ startPressure: 0.17, awakeMinutes: 120 });
  const fourHours = computeAwakePressureAfterMinutes({ startPressure: 0.17, awakeMinutes: 240 });
  const eightHours = computeAwakePressureAfterMinutes({ startPressure: 0.17, awakeMinutes: 480 });

  assert.ok(twoHours > 0.4 && twoHours < 0.5);
  assert.ok(fourHours > twoHours);
  assert.ok(eightHours > fourHours);
});

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

test('hard cap wakes at full energy while earlier wake uses current curve value', () => {
  const startedAt = new Date('2026-06-13T10:00:00.000Z');
  const early = projectRecoverySession({
    startEnergy: -0.6,
    maxEnergy: 1,
    startedAt,
    now: new Date(startedAt.getTime() + (60 * 60 * 1000)),
    clockDueAt: new Date(startedAt.getTime() + (60 * 60 * 1000)),
    wakeCallCount: 0
  });
  const projected = projectRecoverySession({
    startEnergy: -0.6,
    maxEnergy: 1,
    startedAt,
    now: new Date(startedAt.getTime() + (DEFAULT_RECOVER_ENERGY_POLICY.hardMaxRecoveryMinutes * 60 * 1000)),
    wakeCallCount: 0
  });

  assert.equal(early.wakeCause, 'clock');
  assert.ok(early.energy > 0);
  assert.ok(early.energy < 1);
  assert.ok(early.pressure > 0);
  assert.equal(projected.shouldWake, true);
  assert.equal(projected.wakeCause, 'hard_cap');
  assert.equal(projected.energy, 1);
  assert.equal(projected.pressure, 0);
});

test('wake threshold grows with sleep pressure', () => {
  assert.ok(
    computeWakeRequiredCount({ energy: 0.1, pressure: 0.9 })
      > computeWakeRequiredCount({ energy: 0.8, pressure: 0.2 })
  );
});
