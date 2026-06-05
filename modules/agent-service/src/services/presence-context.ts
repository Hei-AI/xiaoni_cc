export type PresenceAnchors = {
  now: Date;
  lastActiveAt?: Date | string | null;
  serviceStartedAt?: Date | string | null;
  lastBoredomResetAt?: Date | string | null;
  lastSleepAt?: Date | string | null;
  lastPresenceTickEnqueuedAt?: Date | string | null;
  lastProactiveAt?: Date | string | null;
  lastUserMessageAt?: Date | string | null;
  dailyProactiveCount?: number | null;
};

export type PresenceLifeState = {
  boredom: number;
  fatigue: number;
  energy: number;
  sharingDesire: number;
  sleepPressure: number;
  cooldownActive: boolean;
  startupGraceActive: boolean;
};

export type PresenceTickDecision = {
  shouldEnqueue: boolean;
  reason: string;
};

export type PresenceSharePoolItem = {
  id: number;
  content: string;
  sourceKind: string;
  boundaryLabel: string;
  sourceWording: string;
  effortCost: number;
  baseHeat: number;
  createdAt: string | Date | null;
};

const HOUR_MS = 60 * 60 * 1000;
export const PRESENCE_FATIGUE_RECOVERY_THRESHOLD = 0.65;

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function hoursBetween(left: Date, right: Date) {
  return Math.max(0, (left.getTime() - right.getTime()) / HOUR_MS);
}

export function deriveLifeState(anchors: PresenceAnchors, options: {
  cooldownMs?: number;
  startupGraceMs?: number;
} = {}): PresenceLifeState {
  const now = anchors.now;
  const boredomAnchor = toDate(anchors.lastBoredomResetAt) || toDate(anchors.lastUserMessageAt) || toDate(anchors.serviceStartedAt) || now;
  const enqueuedAt = toDate(anchors.lastPresenceTickEnqueuedAt);
  const serviceStartedAt = toDate(anchors.serviceStartedAt);
  const hoursSinceBoredomReset = hoursBetween(now, boredomAnchor);
  const sleepPressure = 0;
  const fatigue = 0;
  const boredom = clamp01(hoursSinceBoredomReset / 3);
  const energy = 1;
  const sharingDesire = clamp01((boredom * 0.7) + (energy * 0.3));
  const cooldownActive = Boolean(enqueuedAt && now.getTime() - enqueuedAt.getTime() < (options.cooldownMs ?? 45 * 60 * 1000));
  const startupGraceActive = Boolean(serviceStartedAt && now.getTime() - serviceStartedAt.getTime() < (options.startupGraceMs ?? 5 * 60 * 1000));

  return {
    boredom,
    fatigue,
    energy,
    sharingDesire,
    sleepPressure,
    cooldownActive,
    startupGraceActive
  };
}

export function shouldFirePresenceTick(state: PresenceLifeState): PresenceTickDecision {
  if (state.fatigue > PRESENCE_FATIGUE_RECOVERY_THRESHOLD) {
    return { shouldEnqueue: false, reason: 'fatigue' };
  }
  return { shouldEnqueue: true, reason: 'eligible' };
}

export function scoreSharePoolItem(item: PresenceSharePoolItem, now: Date) {
  const createdAt = toDate(item.createdAt) || now;
  const ageHours = hoursBetween(now, createdAt);
  const decay = Math.exp(-ageHours / 48);
  const boundaryPenalty = item.boundaryLabel === 'reframe' ? 0.15 : item.boundaryLabel === 'blocked' ? 1 : 0;
  const effortPenalty = Math.max(0, Math.min(0.35, (Number(item.effortCost || 1) - 1) * 0.04));
  const finalScore = Math.max(0, (Number(item.baseHeat || 1) * decay) - boundaryPenalty - effortPenalty);
  return {
    itemId: item.id,
    baseHeat: Number(item.baseHeat || 1),
    decay,
    boundaryPenalty,
    effortPenalty,
    finalScore
  };
}
