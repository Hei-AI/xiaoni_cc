export type RecoverEnergyPolicy = {
  pressureFloor: number;
  sleepTauMinutes: number;
  wakeTauMinutes: number;
  wakePressureCeiling: number;
  hardPressureCeiling: number;
  hardMaxRecoveryMinutes: number;
  naturalWakePressure: number;
  minimumWakeEnergy: number;
  forcedSleepPressure: number;
  normalSleepOnsetPressure: number;
  freshWakePenaltyPressure: number;
  restCooldownTauMinutes: number;
  minWakeCalls: number;
  wakeCallSpan: number;
  wakeCallGamma: number;
  actionDebtRecoveryTauMinutes: number;
};

export const DEFAULT_RECOVER_ENERGY_POLICY: RecoverEnergyPolicy = {
  pressureFloor: 0.05,
  sleepTauMinutes: 63,
  wakeTauMinutes: 720,
  wakePressureCeiling: 1,
  hardPressureCeiling: 1.6,
  hardMaxRecoveryMinutes: 120,
  naturalWakePressure: 0.12,
  minimumWakeEnergy: 0,
  forcedSleepPressure: 1.3,
  normalSleepOnsetPressure: 0.3,
  freshWakePenaltyPressure: 0.5,
  restCooldownTauMinutes: 45,
  minWakeCalls: 3,
  wakeCallSpan: 9,
  wakeCallGamma: 2,
  actionDebtRecoveryTauMinutes: 90
};

const MINUTE_MS = 60 * 1000;
const EPSILON = 1e-9;

function finiteNumber(value: unknown, fallback: number) {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}

export function energyToPressure(energy: unknown, maxEnergy = 1, policy: RecoverEnergyPolicy = DEFAULT_RECOVER_ENERGY_POLICY) {
  const normalizedMax = Math.max(0.001, finiteNumber(maxEnergy, 1));
  const normalizedEnergy = finiteNumber(energy, normalizedMax);
  return clampNumber(1 - (normalizedEnergy / normalizedMax), 0, policy.hardPressureCeiling);
}

export function pressureToEnergy(pressure: unknown, maxEnergy = 1) {
  const normalizedMax = Math.max(0.001, finiteNumber(maxEnergy, 1));
  return (1 - finiteNumber(pressure, 0)) * normalizedMax;
}

export function normalizeRecoverEnergyClock(value: unknown) {
  if (value === null || typeof value === 'undefined' || value === '') {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return clampNumber(Math.round(numeric), 5, 120);
}

export function computeSleepPressureAfterMinutes(input: {
  startPressure: number;
  elapsedMinutes: number;
  policy?: RecoverEnergyPolicy;
}) {
  const policy = input.policy ?? DEFAULT_RECOVER_ENERGY_POLICY;
  const startPressure = clampNumber(input.startPressure, 0, policy.hardPressureCeiling);
  const elapsedMinutes = Math.max(0, finiteNumber(input.elapsedMinutes, 0));
  const fullCycleMinutes = Math.max(0.001, policy.hardMaxRecoveryMinutes);
  const cappedElapsedMinutes = Math.min(elapsedMinutes, fullCycleMinutes);
  if (cappedElapsedMinutes >= fullCycleMinutes || startPressure <= 0) {
    return 0;
  }

  const rawPressure = policy.pressureFloor + ((startPressure - policy.pressureFloor) * Math.exp(-cappedElapsedMinutes / policy.sleepTauMinutes));
  const rawPressureAtFullCycle = policy.pressureFloor + ((startPressure - policy.pressureFloor) * Math.exp(-fullCycleMinutes / policy.sleepTauMinutes));
  const denominator = startPressure - rawPressureAtFullCycle;
  if (Math.abs(denominator) < EPSILON) {
    return clampNumber(startPressure * (1 - (cappedElapsedMinutes / fullCycleMinutes)), 0, startPressure);
  }
  const pressure = startPressure * ((rawPressure - rawPressureAtFullCycle) / denominator);
  return clampNumber(pressure, 0, startPressure);
}

export function computeAwakePressureAfterMinutes(input: {
  startPressure: number;
  awakeMinutes: number;
  policy?: RecoverEnergyPolicy;
}) {
  const policy = input.policy ?? DEFAULT_RECOVER_ENERGY_POLICY;
  const startPressure = clampNumber(input.startPressure, 0, policy.hardPressureCeiling);
  const awakeMinutes = Math.max(0, finiteNumber(input.awakeMinutes, 0));
  return policy.wakePressureCeiling - ((policy.wakePressureCeiling - startPressure) * Math.exp(-awakeMinutes / policy.wakeTauMinutes));
}

export function computeRequiredSleepPressure(input: {
  lastWakeAt?: Date | string | null;
  now?: Date;
  policy?: RecoverEnergyPolicy;
}) {
  const policy = input.policy ?? DEFAULT_RECOVER_ENERGY_POLICY;
  const now = input.now ?? new Date();
  const lastWakeAt = input.lastWakeAt ? new Date(input.lastWakeAt) : null;
  const minutesSinceLastWake = lastWakeAt && !Number.isNaN(lastWakeAt.getTime())
    ? Math.max(0, (now.getTime() - lastWakeAt.getTime()) / MINUTE_MS)
    : Number.POSITIVE_INFINITY;
  const penalty = Number.isFinite(minutesSinceLastWake)
    ? policy.freshWakePenaltyPressure * Math.exp(-minutesSinceLastWake / policy.restCooldownTauMinutes)
    : 0;
  return policy.normalSleepOnsetPressure + penalty;
}

export function shouldAcceptVoluntaryRecovery(input: {
  energy: number;
  maxEnergy?: number;
  lastWakeAt?: Date | string | null;
  now?: Date;
  policy?: RecoverEnergyPolicy;
}) {
  const policy = input.policy ?? DEFAULT_RECOVER_ENERGY_POLICY;
  const pressure = energyToPressure(input.energy, input.maxEnergy ?? 1, policy);
  const requiredPressure = computeRequiredSleepPressure({
    lastWakeAt: input.lastWakeAt ?? null,
    now: input.now,
    policy
  });
  return {
    accepted: pressure >= requiredPressure,
    forced: pressure >= policy.forcedSleepPressure,
    pressure,
    requiredPressure
  };
}

export function computeWakeRequiredCount(input: {
  energy: number;
  pressure: number;
  policy?: RecoverEnergyPolicy;
}) {
  const policy = input.policy ?? DEFAULT_RECOVER_ENERGY_POLICY;
  if (finiteNumber(input.energy, 0) < policy.minimumWakeEnergy) {
    return Number.POSITIVE_INFINITY;
  }
  const pressure = clampNumber(input.pressure, 0, 1);
  return Math.ceil(policy.minWakeCalls + (policy.wakeCallSpan * Math.pow(pressure, policy.wakeCallGamma)));
}

export type RecoveryWakeCause =
  | 'active'
  | 'natural'
  | 'clock'
  | 'clock_deferred'
  | 'private_or_mention_threshold'
  | 'hard_cap';

export function projectRecoverySession(input: {
  startEnergy: number;
  maxEnergy?: number;
  startedAt: Date | string;
  now?: Date;
  clockDueAt?: Date | string | null;
  clockDeferredAt?: Date | string | null;
  wakeCallCount?: number;
  policy?: RecoverEnergyPolicy;
}) {
  const policy = input.policy ?? DEFAULT_RECOVER_ENERGY_POLICY;
  const maxEnergy = Math.max(0.001, finiteNumber(input.maxEnergy, 1));
  const startedAt = new Date(input.startedAt);
  const now = input.now ?? new Date();
  const elapsedMinutes = Math.max(0, (now.getTime() - startedAt.getTime()) / MINUTE_MS);
  const cappedElapsedMinutes = Math.min(elapsedMinutes, policy.hardMaxRecoveryMinutes);
  const startPressure = energyToPressure(input.startEnergy, maxEnergy, policy);
  const pressure = computeSleepPressureAfterMinutes({
    startPressure,
    elapsedMinutes: cappedElapsedMinutes,
    policy
  });
  const energy = pressureToEnergy(pressure, maxEnergy);
  const wakeRequiredCount = computeWakeRequiredCount({ energy, pressure, policy });
  const wakeCallCount = Math.max(0, Math.floor(finiteNumber(input.wakeCallCount, 0)));
  const clockDueAt = input.clockDueAt ? new Date(input.clockDueAt) : null;
  const clockDue = Boolean(clockDueAt && !Number.isNaN(clockDueAt.getTime()) && now.getTime() >= clockDueAt.getTime());
  const belowMinimumWake = energy < policy.minimumWakeEnergy;
  let wakeCause: RecoveryWakeCause = 'active';

  if (elapsedMinutes >= policy.hardMaxRecoveryMinutes) {
    wakeCause = 'hard_cap';
  } else if (belowMinimumWake) {
    wakeCause = 'active';
  } else if (wakeCallCount >= wakeRequiredCount) {
    wakeCause = 'private_or_mention_threshold';
  } else if (clockDue) {
    wakeCause = input.clockDeferredAt ? 'clock_deferred' : 'clock';
  } else if (pressure <= policy.naturalWakePressure) {
    wakeCause = 'natural';
  }

  return {
    startPressure,
    pressure,
    energy,
    elapsedMinutes,
    cappedElapsedMinutes,
    wakeRequiredCount,
    wakeCallCount,
    clockDue,
    clockShouldDefer: clockDue && belowMinimumWake,
    wakeCause,
    shouldWake: wakeCause !== 'active'
  };
}

export function estimateNaturalWakeAt(input: {
  startEnergy: number;
  maxEnergy?: number;
  startedAt: Date;
  policy?: RecoverEnergyPolicy;
}) {
  const policy = input.policy ?? DEFAULT_RECOVER_ENERGY_POLICY;
  const maxEnergy = Math.max(0.001, finiteNumber(input.maxEnergy, 1));
  const startPressure = energyToPressure(input.startEnergy, maxEnergy, policy);
  if (startPressure <= policy.naturalWakePressure) {
    return input.startedAt;
  }
  let low = 0;
  let high = policy.hardMaxRecoveryMinutes;
  for (let i = 0; i < 40; i += 1) {
    const mid = (low + high) / 2;
    const pressure = computeSleepPressureAfterMinutes({
      startPressure,
      elapsedMinutes: mid,
      policy
    });
    if (pressure <= policy.naturalWakePressure) {
      high = mid;
    } else {
      low = mid;
    }
  }
  return new Date(input.startedAt.getTime() + (high * MINUTE_MS));
}

export function estimateHardWakeAt(startedAt: Date, policy: RecoverEnergyPolicy = DEFAULT_RECOVER_ENERGY_POLICY) {
  return new Date(startedAt.getTime() + (policy.hardMaxRecoveryMinutes * MINUTE_MS));
}
