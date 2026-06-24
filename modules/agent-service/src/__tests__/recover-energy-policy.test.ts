import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_RECOVER_ENERGY_POLICY,
  RECOVER_ENERGY_CLOCK_MAX_MINUTES,
  createRecoveryPolicySnapshot,
  computeAwakePressureBetween,
  computeSleepPressureAfterMinutes,
  computeAwakePressureAfterMinutes,
  computeRequiredSleepPressure,
  computeWakeRequiredCount,
  normalizeRecoverEnergyClock,
  projectRecoverySession,
  recoverEnergyFullRecoveryMinutes,
  recoverySessionPolicyFromSnapshot,
  resolveRecoverySessionPolicy,
  shouldAcceptVoluntaryRecovery
} from '../services/recover-energy-policy';

test('recover energy uses Xiaoni eight-hour two-process sleep cycle', () => {
  assert.equal(DEFAULT_RECOVER_ENERGY_POLICY.hardMaxRecoveryMinutes, 480);
  assert.equal(recoverEnergyFullRecoveryMinutes(), 480);
  assert.equal(DEFAULT_RECOVER_ENERGY_POLICY.sleepTauMinutes, 252);
  assert.equal(DEFAULT_RECOVER_ENERGY_POLICY.wakeTauMinutes, 1092);
  assert.equal(DEFAULT_RECOVER_ENERGY_POLICY.actionDebtRecoveryTauMinutes, 360);
  assert.equal(DEFAULT_RECOVER_ENERGY_POLICY.restCooldownTauMinutes, 180);
  assert.equal(DEFAULT_RECOVER_ENERGY_POLICY.circadianWakeTauAmplitude, 0.35);
  assert.equal(DEFAULT_RECOVER_ENERGY_POLICY.naturalWakePressure, 0.12);
});

test('sleep pressure follows normalized curve and reaches full recovery at eight hours', () => {
  const startPressure = 1.6;
  const start = computeSleepPressureAfterMinutes({ startPressure, elapsedMinutes: 0 });
  const middle = computeSleepPressureAfterMinutes({ startPressure, elapsedMinutes: 240 });
  const beforeFullCycle = computeSleepPressureAfterMinutes({ startPressure, elapsedMinutes: 479 });
  const fullCycle = computeSleepPressureAfterMinutes({ startPressure, elapsedMinutes: 480 });

  assert.equal(start, startPressure);
  assert.ok(middle > beforeFullCycle);
  assert.ok(middle > 0);
  assert.ok(beforeFullCycle > 0);
  assert.equal(fullCycle, 0);
});

test('sleep pressure keeps daytime nap partial instead of full recovery', () => {
  const startedAt = new Date('2026-06-13T06:00:00.000Z');
  const projected = projectRecoverySession({
    startEnergy: -0.6,
    maxEnergy: 1,
    startedAt,
    now: new Date(startedAt.getTime() + (90 * 60 * 1000)),
    sessionMaxRecoveryMinutes: 90,
    sessionCapWakeCause: 'daytime_nap_cap'
  });

  assert.equal(projected.shouldWake, true);
  assert.equal(projected.wakeCause, 'daytime_nap_cap');
  assert.ok(projected.energy < 0);
  assert.ok(projected.pressure > 1);
});

test('night session policy allows full eight-hour sleep window', () => {
  const startedAt = new Date('2026-06-12T17:00:00.000Z');
  const sessionPolicy = resolveRecoverySessionPolicy({ startedAt });

  assert.equal(sessionPolicy.circadian.phase, 'night');
  assert.equal(sessionPolicy.sessionMaxRecoveryMinutes, 480);
  assert.equal(sessionPolicy.sessionCapWakeCause, 'hard_cap');
  assert.ok(sessionPolicy.policy.normalSleepOnsetPressure < DEFAULT_RECOVER_ENERGY_POLICY.normalSleepOnsetPressure);
  assert.ok(sessionPolicy.policy.naturalWakePressure < DEFAULT_RECOVER_ENERGY_POLICY.naturalWakePressure);
});

test('day session policy caps recover_energy as a nap', () => {
  const startedAt = new Date('2026-06-13T06:00:00.000Z');
  const sessionPolicy = resolveRecoverySessionPolicy({ startedAt });

  assert.equal(sessionPolicy.circadian.phase, 'day');
  assert.equal(sessionPolicy.sessionMaxRecoveryMinutes, 90);
  assert.equal(sessionPolicy.sessionCapWakeCause, 'daytime_nap_cap');
  assert.ok(sessionPolicy.policy.normalSleepOnsetPressure > DEFAULT_RECOVER_ENERGY_POLICY.normalSleepOnsetPressure);
  assert.ok(sessionPolicy.policy.naturalWakePressure > DEFAULT_RECOVER_ENERGY_POLICY.naturalWakePressure);
});

test('night natural sleep waits for scheduled wake instead of energy threshold', () => {
  const startedAt = new Date('2026-06-12T17:00:00.000Z');
  const sessionPolicy = resolveRecoverySessionPolicy({ startedAt });
  const projected = projectRecoverySession({
    startEnergy: 0.2,
    maxEnergy: 1,
    startedAt,
    now: new Date(startedAt.getTime() + (360 * 60 * 1000)),
    policy: sessionPolicy.policy,
    sessionMaxRecoveryMinutes: sessionPolicy.sessionMaxRecoveryMinutes,
    sessionCapWakeCause: sessionPolicy.sessionCapWakeCause,
    suppressNaturalWakeBeforeSessionCap: true
  });

  assert.equal(projected.shouldWake, false);
  assert.equal(projected.wakeCause, 'active');
  assert.ok(projected.pressure <= sessionPolicy.policy.naturalWakePressure);
});

test('night natural sleep is easiest to wake near sleep edges', () => {
  const startedAt = new Date('2026-06-12T17:00:00.000Z');
  const sessionPolicy = resolveRecoverySessionPolicy({ startedAt });
  const early = projectRecoverySession({
    startEnergy: 0.2,
    maxEnergy: 1,
    startedAt,
    now: new Date(startedAt.getTime() + (60 * 60 * 1000)),
    policy: sessionPolicy.policy,
    sessionMaxRecoveryMinutes: sessionPolicy.sessionMaxRecoveryMinutes,
    sessionCapWakeCause: sessionPolicy.sessionCapWakeCause,
    suppressNaturalWakeBeforeSessionCap: true,
    shapeWakeCallsBySessionProgress: true,
    wakeCallCount: 3
  });
  const middle = projectRecoverySession({
    startEnergy: 0.2,
    maxEnergy: 1,
    startedAt,
    now: new Date(startedAt.getTime() + (240 * 60 * 1000)),
    policy: sessionPolicy.policy,
    sessionMaxRecoveryMinutes: sessionPolicy.sessionMaxRecoveryMinutes,
    sessionCapWakeCause: sessionPolicy.sessionCapWakeCause,
    suppressNaturalWakeBeforeSessionCap: true,
    shapeWakeCallsBySessionProgress: true,
    wakeCallCount: 3
  });
  const nearWake = projectRecoverySession({
    startEnergy: 0.2,
    maxEnergy: 1,
    startedAt,
    now: new Date(startedAt.getTime() + (450 * 60 * 1000)),
    policy: sessionPolicy.policy,
    sessionMaxRecoveryMinutes: sessionPolicy.sessionMaxRecoveryMinutes,
    sessionCapWakeCause: sessionPolicy.sessionCapWakeCause,
    suppressNaturalWakeBeforeSessionCap: true,
    shapeWakeCallsBySessionProgress: true,
    wakeCallCount: 3
  });

  assert.equal(early.shouldWake, false);
  assert.equal(middle.shouldWake, false);
  assert.equal(nearWake.shouldWake, true);
  assert.equal(nearWake.wakeCause, 'private_or_mention_threshold');
  assert.ok(early.wakeRequiredCount < middle.wakeRequiredCount);
  assert.ok(nearWake.wakeRequiredCount < middle.wakeRequiredCount);
});

test('recovery policy snapshot is stable for active sessions', () => {
  const snapshot = createRecoveryPolicySnapshot(new Date('2026-06-12T17:00:00.000Z'));
  const sessionPolicy = recoverySessionPolicyFromSnapshot(snapshot);

  assert.ok(sessionPolicy);
  assert.equal(sessionPolicy.version, snapshot.version);
  assert.equal(sessionPolicy.sessionMaxRecoveryMinutes, 480);
  assert.equal(sessionPolicy.policy.sleepTauMinutes, 252);
});

test('recover_energy clock remains a short wake-attempt maximum', () => {
  assert.equal(RECOVER_ENERGY_CLOCK_MAX_MINUTES, 120);
  assert.equal(normalizeRecoverEnergyClock(999), 120);
});

test('awake pressure uses paper-scale wake tau', () => {
  const thirtyFiveMinutes = computeAwakePressureAfterMinutes({ startPressure: 0.12, awakeMinutes: 35 });
  const twoHours = computeAwakePressureAfterMinutes({ startPressure: 0.12, awakeMinutes: 120 });
  const fourHours = computeAwakePressureAfterMinutes({ startPressure: 0.12, awakeMinutes: 240 });
  const eightHours = computeAwakePressureAfterMinutes({ startPressure: 0.12, awakeMinutes: 480 });

  assert.ok(thirtyFiveMinutes > 0.14 && thirtyFiveMinutes < 0.16);
  assert.ok(twoHours > 0.20 && twoHours < 0.23);
  assert.ok(fourHours > twoHours);
  assert.ok(eightHours > fourHours);
});

test('circadian process C makes awake pressure rise faster at night', () => {
  const night = computeAwakePressureBetween({
    startPressure: 0.12,
    startedAt: new Date('2026-06-12T18:00:00.000Z'),
    endedAt: new Date('2026-06-12T20:00:00.000Z')
  });
  const day = computeAwakePressureBetween({
    startPressure: 0.12,
    startedAt: new Date('2026-06-13T06:00:00.000Z'),
    endedAt: new Date('2026-06-13T08:00:00.000Z')
  });

  assert.ok(night > day);
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
    now: new Date(startedAt.getTime() + (120 * 60 * 1000)),
    clockDueAt: new Date(startedAt.getTime() + (120 * 60 * 1000)),
    wakeCallCount: 0
  });
  const projected = projectRecoverySession({
    startEnergy: -0.6,
    maxEnergy: 1,
    startedAt,
    now: new Date(startedAt.getTime() + (recoverEnergyFullRecoveryMinutes() * 60 * 1000)),
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
