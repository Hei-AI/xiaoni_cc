export type RecoverEnergyPolicy = {
  pressureFloor: number;
  sleepTauMinutes: number;
  wakeTauMinutes: number;
  wakePressureCeiling: number;
  hardPressureCeiling: number;
  hardMaxRecoveryMinutes: number;
  fullRecoveryMinutes?: number;
  daytimeNapMaxRecoveryMinutes?: number;
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
  timeZone?: string;
  nightWindowStartMinute?: number;
  nightWindowEndMinute?: number;
  circadianSleepPeakMinute?: number;
  circadianSleepGateAmplitude?: number;
  circadianNaturalWakeAmplitude?: number;
  circadianWakeTauAmplitude?: number;
};

export const RECOVER_ENERGY_POLICY_VERSION = 'xiaoni-recover-energy-v2-8h-circadian';
export const LEGACY_RECOVER_ENERGY_POLICY_VERSION = 'xiaoni-recover-energy-v1-2h-compressed';
export const RECOVER_ENERGY_CLOCK_MAX_MINUTES = 120;

export const DEFAULT_RECOVER_ENERGY_POLICY: RecoverEnergyPolicy = {
  pressureFloor: 0.05,
  sleepTauMinutes: 252,
  wakeTauMinutes: 1920,
  wakePressureCeiling: 1,
  hardPressureCeiling: 1.6,
  hardMaxRecoveryMinutes: 480,
  fullRecoveryMinutes: 480,
  daytimeNapMaxRecoveryMinutes: 90,
  naturalWakePressure: 0.12,
  minimumWakeEnergy: 0,
  forcedSleepPressure: 1.3,
  normalSleepOnsetPressure: 0.3,
  freshWakePenaltyPressure: 0.5,
  restCooldownTauMinutes: 180,
  minWakeCalls: 3,
  wakeCallSpan: 9,
  wakeCallGamma: 2,
  actionDebtRecoveryTauMinutes: 360,
  timeZone: 'Asia/Shanghai',
  nightWindowStartMinute: 60,
  nightWindowEndMinute: 540,
  circadianSleepPeakMinute: 300,
  circadianSleepGateAmplitude: 0.18,
  circadianNaturalWakeAmplitude: 0.06,
  circadianWakeTauAmplitude: 0.1
};

export const LEGACY_RECOVER_ENERGY_POLICY: RecoverEnergyPolicy = {
  pressureFloor: 0.05,
  sleepTauMinutes: 63,
  wakeTauMinutes: 720,
  wakePressureCeiling: 1,
  hardPressureCeiling: 1.6,
  hardMaxRecoveryMinutes: 120,
  fullRecoveryMinutes: 120,
  daytimeNapMaxRecoveryMinutes: 120,
  naturalWakePressure: 0.12,
  minimumWakeEnergy: 0,
  forcedSleepPressure: 1.3,
  normalSleepOnsetPressure: 0.3,
  freshWakePenaltyPressure: 0.5,
  restCooldownTauMinutes: 45,
  minWakeCalls: 3,
  wakeCallSpan: 9,
  wakeCallGamma: 2,
  actionDebtRecoveryTauMinutes: 90,
  timeZone: 'Asia/Shanghai',
  nightWindowStartMinute: 60,
  nightWindowEndMinute: 540,
  circadianSleepPeakMinute: 300,
  circadianSleepGateAmplitude: 0,
  circadianNaturalWakeAmplitude: 0,
  circadianWakeTauAmplitude: 0
};

const MINUTE_MS = 60 * 1000;
const EPSILON = 1e-9;
const DAY_MINUTES = 24 * 60;
const TWO_PI = Math.PI * 2;

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

function normalizePolicy(policy: RecoverEnergyPolicy): RecoverEnergyPolicy {
  return {
    ...DEFAULT_RECOVER_ENERGY_POLICY,
    ...policy
  };
}

export function recoverEnergyFullRecoveryMinutes(policy: RecoverEnergyPolicy = DEFAULT_RECOVER_ENERGY_POLICY) {
  const normalizedPolicy = normalizePolicy(policy);
  return Math.max(0.001, finiteNumber(
    normalizedPolicy.fullRecoveryMinutes,
    normalizedPolicy.hardMaxRecoveryMinutes
  ));
}

function positivePolicyMinutes(value: unknown, fallback: number) {
  return Math.max(0.001, finiteNumber(value, fallback));
}

function localMinutesOfDay(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return (now.getHours() * 60) + now.getMinutes();
  }
  return (hour * 60) + minute;
}

function minuteDistanceForward(fromMinute: number, toMinute: number) {
  const from = ((Math.round(fromMinute) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  const to = ((Math.round(toMinute) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  return (to - from + DAY_MINUTES) % DAY_MINUTES;
}

function isMinuteInWindow(minute: number, start: number, end: number) {
  const normalizedMinute = ((Math.round(minute) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  const normalizedStart = ((Math.round(start) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  const normalizedEnd = ((Math.round(end) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  if (normalizedStart === normalizedEnd) {
    return true;
  }
  if (normalizedStart < normalizedEnd) {
    return normalizedMinute >= normalizedStart && normalizedMinute < normalizedEnd;
  }
  return normalizedMinute >= normalizedStart || normalizedMinute < normalizedEnd;
}

export type RecoveryCircadianPhase = 'night' | 'day';

export type RecoveryCircadianState = {
  timeZone: string;
  localMinutes: number;
  phase: RecoveryCircadianPhase;
  sleepDrive: number;
  nightWindowStartMinute: number;
  nightWindowEndMinute: number;
  sleepPeakMinute: number;
  minutesUntilNightWindowEnd: number | null;
};

export type RecoverySessionCapWakeCause = 'hard_cap' | 'daytime_nap_cap' | 'circadian_wake';

export type RecoverySessionPolicy = {
  version: string;
  policy: RecoverEnergyPolicy;
  circadian: RecoveryCircadianState;
  fullRecoveryMinutes: number;
  sessionMaxRecoveryMinutes: number;
  sessionCapWakeCause: RecoverySessionCapWakeCause;
};

export type RecoveryPolicySnapshot = RecoverySessionPolicy & {
  createdAt: string;
};

export function resolveRecoveryCircadianState(now: Date = new Date(), policy: RecoverEnergyPolicy = DEFAULT_RECOVER_ENERGY_POLICY): RecoveryCircadianState {
  const normalizedPolicy = normalizePolicy(policy);
  const timeZone = normalizedPolicy.timeZone || 'Asia/Shanghai';
  const localMinutes = localMinutesOfDay(now, timeZone);
  const nightWindowStartMinute = positivePolicyMinutes(normalizedPolicy.nightWindowStartMinute, 60);
  const nightWindowEndMinute = positivePolicyMinutes(normalizedPolicy.nightWindowEndMinute, 540);
  const sleepPeakMinute = positivePolicyMinutes(normalizedPolicy.circadianSleepPeakMinute, 300);
  const phase: RecoveryCircadianPhase = isMinuteInWindow(localMinutes, nightWindowStartMinute, nightWindowEndMinute)
    ? 'night'
    : 'day';
  const sleepDrive = Math.cos(TWO_PI * ((localMinutes - sleepPeakMinute) / DAY_MINUTES));
  return {
    timeZone,
    localMinutes,
    phase,
    sleepDrive: clampNumber(sleepDrive, -1, 1),
    nightWindowStartMinute,
    nightWindowEndMinute,
    sleepPeakMinute,
    minutesUntilNightWindowEnd: phase === 'night'
      ? minuteDistanceForward(localMinutes, nightWindowEndMinute)
      : null
  };
}

export function resolveRecoverySessionPolicy(input: {
  startedAt?: Date;
  policy?: RecoverEnergyPolicy;
} = {}): RecoverySessionPolicy {
  const basePolicy = normalizePolicy(input.policy ?? DEFAULT_RECOVER_ENERGY_POLICY);
  const startedAt = input.startedAt ?? new Date();
  const circadian = resolveRecoveryCircadianState(startedAt, basePolicy);
  const fullRecoveryMinutes = recoverEnergyFullRecoveryMinutes(basePolicy);
  const sleepGateAmplitude = Math.max(0, finiteNumber(basePolicy.circadianSleepGateAmplitude, 0));
  const naturalWakeAmplitude = Math.max(0, finiteNumber(basePolicy.circadianNaturalWakeAmplitude, 0));
  const policy: RecoverEnergyPolicy = {
    ...basePolicy,
    normalSleepOnsetPressure: clampNumber(
      basePolicy.normalSleepOnsetPressure - (circadian.sleepDrive * sleepGateAmplitude),
      0.05,
      basePolicy.forcedSleepPressure
    ),
    naturalWakePressure: clampNumber(
      basePolicy.naturalWakePressure - (circadian.sleepDrive * naturalWakeAmplitude),
      0.04,
      0.24
    ),
    fullRecoveryMinutes,
    hardMaxRecoveryMinutes: fullRecoveryMinutes
  };
  if (circadian.phase === 'night') {
    const minutesUntilEnd = Math.max(0, circadian.minutesUntilNightWindowEnd ?? fullRecoveryMinutes);
    const sessionMaxRecoveryMinutes = Math.max(5, Math.min(fullRecoveryMinutes, minutesUntilEnd || fullRecoveryMinutes));
    return {
      version: RECOVER_ENERGY_POLICY_VERSION,
      policy,
      circadian,
      fullRecoveryMinutes,
      sessionMaxRecoveryMinutes,
      sessionCapWakeCause: sessionMaxRecoveryMinutes >= fullRecoveryMinutes ? 'hard_cap' : 'circadian_wake'
    };
  }
  return {
    version: RECOVER_ENERGY_POLICY_VERSION,
    policy,
    circadian,
    fullRecoveryMinutes,
    sessionMaxRecoveryMinutes: Math.min(fullRecoveryMinutes, positivePolicyMinutes(basePolicy.daytimeNapMaxRecoveryMinutes, 90)),
    sessionCapWakeCause: 'daytime_nap_cap'
  };
}

export function createRecoveryPolicySnapshot(startedAt: Date = new Date(), policy: RecoverEnergyPolicy = DEFAULT_RECOVER_ENERGY_POLICY): RecoveryPolicySnapshot {
  return {
    ...resolveRecoverySessionPolicy({ startedAt, policy }),
    createdAt: startedAt.toISOString()
  };
}

function policyFromUnknown(value: unknown, fallback: RecoverEnergyPolicy): RecoverEnergyPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fallback;
  }
  const record = value as Record<string, unknown>;
  return normalizePolicy({
    ...fallback,
    ...record
  } as RecoverEnergyPolicy);
}

export function recoverySessionPolicyFromSnapshot(value: unknown): RecoverySessionPolicy | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const policy = policyFromUnknown(record.policy, DEFAULT_RECOVER_ENERGY_POLICY);
  const circadian = record.circadian && typeof record.circadian === 'object' && !Array.isArray(record.circadian)
    ? record.circadian as RecoveryCircadianState
    : resolveRecoveryCircadianState(new Date(), policy);
  const fullRecoveryMinutes = positivePolicyMinutes(record.fullRecoveryMinutes, recoverEnergyFullRecoveryMinutes(policy));
  const sessionMaxRecoveryMinutes = positivePolicyMinutes(record.sessionMaxRecoveryMinutes, fullRecoveryMinutes);
  const sessionCapWakeCause = record.sessionCapWakeCause === 'daytime_nap_cap' || record.sessionCapWakeCause === 'circadian_wake'
    ? record.sessionCapWakeCause
    : 'hard_cap';
  return {
    version: typeof record.version === 'string' ? record.version : RECOVER_ENERGY_POLICY_VERSION,
    policy: {
      ...policy,
      fullRecoveryMinutes,
      hardMaxRecoveryMinutes: fullRecoveryMinutes
    },
    circadian,
    fullRecoveryMinutes,
    sessionMaxRecoveryMinutes,
    sessionCapWakeCause
  };
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
  return clampNumber(Math.round(numeric), 5, RECOVER_ENERGY_CLOCK_MAX_MINUTES);
}

export function computeSleepPressureAfterMinutes(input: {
  startPressure: number;
  elapsedMinutes: number;
  policy?: RecoverEnergyPolicy;
}) {
  const policy = input.policy ?? DEFAULT_RECOVER_ENERGY_POLICY;
  const startPressure = clampNumber(input.startPressure, 0, policy.hardPressureCeiling);
  const elapsedMinutes = Math.max(0, finiteNumber(input.elapsedMinutes, 0));
  const fullCycleMinutes = recoverEnergyFullRecoveryMinutes(policy);
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

export function resolveCircadianAwakePolicy(at: Date = new Date(), policy: RecoverEnergyPolicy = DEFAULT_RECOVER_ENERGY_POLICY): RecoverEnergyPolicy {
  const basePolicy = normalizePolicy(policy);
  const circadian = resolveRecoveryCircadianState(at, basePolicy);
  const amplitude = Math.max(0, finiteNumber(basePolicy.circadianWakeTauAmplitude, 0));
  const tauScale = clampNumber(1 + (circadian.sleepDrive * amplitude), 0.25, 2);
  return {
    ...basePolicy,
    wakeTauMinutes: basePolicy.wakeTauMinutes / tauScale
  };
}

export function computeAwakePressureBetween(input: {
  startPressure: number;
  startedAt: Date | string;
  endedAt: Date | string;
  policy?: RecoverEnergyPolicy;
  segmentMinutes?: number;
}) {
  const policy = input.policy ?? DEFAULT_RECOVER_ENERGY_POLICY;
  const startedAt = new Date(input.startedAt);
  const endedAt = new Date(input.endedAt);
  if (Number.isNaN(startedAt.getTime()) || Number.isNaN(endedAt.getTime()) || endedAt.getTime() <= startedAt.getTime()) {
    return clampNumber(input.startPressure, 0, policy.hardPressureCeiling);
  }
  const segmentMs = Math.max(1, finiteNumber(input.segmentMinutes, 30)) * MINUTE_MS;
  let pressure = clampNumber(input.startPressure, 0, policy.hardPressureCeiling);
  let cursorMs = startedAt.getTime();
  const endMs = endedAt.getTime();
  while (cursorMs < endMs - EPSILON) {
    const nextMs = Math.min(endMs, cursorMs + segmentMs);
    const midpoint = new Date(cursorMs + ((nextMs - cursorMs) / 2));
    pressure = computeAwakePressureAfterMinutes({
      startPressure: pressure,
      awakeMinutes: (nextMs - cursorMs) / MINUTE_MS,
      policy: resolveCircadianAwakePolicy(midpoint, policy)
    });
    cursorMs = nextMs;
  }
  return pressure;
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
  sessionProgress?: number;
  shapeBySessionProgress?: boolean;
}) {
  const policy = input.policy ?? DEFAULT_RECOVER_ENERGY_POLICY;
  if (finiteNumber(input.energy, 0) < policy.minimumWakeEnergy) {
    return Number.POSITIVE_INFINITY;
  }
  const pressure = clampNumber(input.pressure, 0, 1);
  const baseCount = policy.minWakeCalls + (policy.wakeCallSpan * Math.pow(pressure, policy.wakeCallGamma));
  if (!input.shapeBySessionProgress) {
    return Math.ceil(baseCount);
  }
  const progress = clampNumber(finiteNumber(input.sessionProgress, 0), 0, 1);
  if (progress >= 0.85 && pressure <= policy.naturalWakePressure) {
    return policy.minWakeCalls;
  }
  const pressureDepth = Math.pow(pressure, policy.wakeCallGamma);
  const sleepStageDepth = Math.pow(Math.sin(Math.PI * progress), 0.75);
  const combinedDepth = clampNumber((sleepStageDepth * 0.75) + (pressureDepth * 0.25), 0, 1);
  return Math.ceil(policy.minWakeCalls + (policy.wakeCallSpan * combinedDepth));
}

export type RecoveryWakeCause =
  | 'active'
  | 'natural'
  | 'clock'
  | 'clock_deferred'
  | 'private_or_mention_threshold'
  | 'daytime_nap_cap'
  | 'circadian_wake'
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
  sessionMaxRecoveryMinutes?: number;
  sessionCapWakeCause?: RecoverySessionCapWakeCause;
  suppressNaturalWakeBeforeSessionCap?: boolean;
  shapeWakeCallsBySessionProgress?: boolean;
}) {
  const policy = input.policy ?? DEFAULT_RECOVER_ENERGY_POLICY;
  const maxEnergy = Math.max(0.001, finiteNumber(input.maxEnergy, 1));
  const startedAt = new Date(input.startedAt);
  const now = input.now ?? new Date();
  const elapsedMinutes = Math.max(0, (now.getTime() - startedAt.getTime()) / MINUTE_MS);
  const fullRecoveryMinutes = recoverEnergyFullRecoveryMinutes(policy);
  const sessionMaxRecoveryMinutes = Math.max(0.001, finiteNumber(input.sessionMaxRecoveryMinutes, policy.hardMaxRecoveryMinutes));
  const cappedElapsedMinutes = Math.min(elapsedMinutes, fullRecoveryMinutes);
  const startPressure = energyToPressure(input.startEnergy, maxEnergy, policy);
  const pressure = computeSleepPressureAfterMinutes({
    startPressure,
    elapsedMinutes: cappedElapsedMinutes,
    policy
  });
  const energy = pressureToEnergy(pressure, maxEnergy);
  const sessionProgress = clampNumber(elapsedMinutes / sessionMaxRecoveryMinutes, 0, 1);
  const wakeRequiredCount = computeWakeRequiredCount({
    energy,
    pressure,
    policy,
    sessionProgress,
    shapeBySessionProgress: Boolean(input.shapeWakeCallsBySessionProgress)
  });
  const wakeCallCount = Math.max(0, Math.floor(finiteNumber(input.wakeCallCount, 0)));
  const clockDueAt = input.clockDueAt ? new Date(input.clockDueAt) : null;
  const clockDue = Boolean(clockDueAt && !Number.isNaN(clockDueAt.getTime()) && now.getTime() >= clockDueAt.getTime());
  const belowMinimumWake = energy < policy.minimumWakeEnergy;
  let wakeCause: RecoveryWakeCause = 'active';

  if (elapsedMinutes >= fullRecoveryMinutes) {
    wakeCause = 'hard_cap';
  } else if (elapsedMinutes >= sessionMaxRecoveryMinutes) {
    wakeCause = input.sessionCapWakeCause && input.sessionCapWakeCause !== 'hard_cap'
      ? input.sessionCapWakeCause
      : 'circadian_wake';
  } else if (belowMinimumWake) {
    wakeCause = 'active';
  } else if (wakeCallCount >= wakeRequiredCount) {
    wakeCause = 'private_or_mention_threshold';
  } else if (clockDue) {
    wakeCause = input.clockDeferredAt ? 'clock_deferred' : 'clock';
  } else if (!input.suppressNaturalWakeBeforeSessionCap && pressure <= policy.naturalWakePressure) {
    wakeCause = 'natural';
  }

  return {
    startPressure,
    pressure,
    energy,
    elapsedMinutes,
    cappedElapsedMinutes,
    fullRecoveryMinutes,
    sessionMaxRecoveryMinutes,
    sessionProgress,
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
  let high = recoverEnergyFullRecoveryMinutes(policy);
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
  return new Date(startedAt.getTime() + (recoverEnergyFullRecoveryMinutes(policy) * MINUTE_MS));
}

export function estimateSessionWakeAt(startedAt: Date, sessionPolicy: RecoverySessionPolicy) {
  return new Date(startedAt.getTime() + (sessionPolicy.sessionMaxRecoveryMinutes * MINUTE_MS));
}
