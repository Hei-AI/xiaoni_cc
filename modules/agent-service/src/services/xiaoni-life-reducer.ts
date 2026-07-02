import type { AgentLifeEventProjection } from '@qq-bot/persistence';
import {
  deriveLifeState,
  type PresenceAnchors,
  type PresenceLifeState
} from './presence-context';
import {
  DEFAULT_RECOVER_ENERGY_POLICY,
  DEFAULT_ACTION_COST_SCALE,
  clampNumber,
  computeAwakePressureBetween,
  energyToPressure,
  type RecoverEnergyPolicy
} from './recover-energy-policy';

export const XIAONI_LIFE_PROJECTION_VERSION = 'xiaoni-life-v3-pressure-anchors';

type LifeProjectionAnchors = {
  serviceStartedAt: string | null;
  lastMeaningfulActivityAt: string | null;
  lastBoredomResetAt: string | null;
  lastRestAt: string | null;
  lastPresenceTickEnqueuedAt: string | null;
  pressureUpdatedAt: string | null;
};

export type XiaoniLifeStateProjection = {
  identityKey: string;
  version: string;
  generatedAt: string;
  reducedThroughEventId: string | null;
  reducedThroughOccurredAt: string | null;
  state: PresenceLifeState & {
    attention: number;
    rewardAttraction: number;
    restPressure: number;
    actionCost: number;
    homeostaticPressure: number;
    actionDebt: number;
  };
  anchors: LifeProjectionAnchors;
  counters: {
    eventCount: number;
    materialEventCount: number;
  };
};

export type XiaoniLifeStateExplanation = {
  version: string;
  summary: string;
  generatedAt: string;
  rebuiltFromEvents: boolean;
  eventCount: number;
  reducedThroughEventId: string | null;
  contributors: Array<{
    eventId: string | null;
    eventKind: string;
    occurredAt: string | null;
    effect: string;
  }>;
  meterDrivers: {
    boredom: string;
    fatigue: string;
    sharingDesire: string;
    attention: string;
  };
};

type ReducerInternalState = {
  serviceStartedAt: Date | null;
  lastMeaningfulActivityAt: Date | null;
  lastBoredomResetAt: Date | null;
  lastRestAt: Date | null;
  lastPresenceTickEnqueuedAt: Date | null;
  boredomOffset: number;
  rewardAttraction: number;
  attention: number;
  homeostaticPressure: number;
  actionDebt: number;
  pressureUpdatedAt: Date | null;
  materialEventCount: number;
  contributors: XiaoniLifeStateExplanation['contributors'];
  // Effective energy policy for this reduction (admin-configurable, resolved upstream in
  // runtime-store). Carried on state so the per-event helpers don't need an extra param.
  policy: RecoverEnergyPolicy;
  actionCostScale: number;
};

export type ReduceXiaoniLifeStateInput = {
  identityKey?: string;
  now: Date;
  events: AgentLifeEventProjection[];
  previousProjection?: Record<string, unknown> | XiaoniLifeStateProjection | null;
  legacyAnchors?: PresenceAnchors | null;
  cooldownMs?: number;
  startupGraceMs?: number;
  // Admin-configurable effective policy + action-cost multiplier. Default to code baseline when
  // absent so all existing callers/tests stay byte-identical.
  policy?: RecoverEnergyPolicy;
  actionCostScale?: number;
};

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

// Historical life events may predate explicit actionCost writes. New events
// should carry actionCost at the write site and use these values only as a
// compatibility fallback.
const DEFAULT_ACTION_COST_BY_EVENT_KIND: Record<string, number> = {
  surface_visit: 0.01,
  qq_message_seen: 0,
  qq_self_message: 0,
  send_in_group: 0.01,
  silence_decision: 0.005,
  web_search_result: 0,
  pending_share_created: 0,
  pending_share_consumed: 0.002,
  presence_tick_evaluated: 0
};

function clamp01(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function clampNonNegative(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, value);
}

function clampPressure(value: number) {
  return clampNumber(value, 0, DEFAULT_RECOVER_ENERGY_POLICY.hardPressureCeiling);
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIso(value: Date | string | null | undefined): string | null {
  const date = toDate(value);
  return date ? date.toISOString() : null;
}

function hoursBetween(left: Date, right: Date | null) {
  if (!right) {
    return 0;
  }
  return Math.max(0, (left.getTime() - right.getTime()) / HOUR_MS);
}

function eventIdBigInt(event: AgentLifeEventProjection): bigint {
  try {
    return BigInt(event.id || '0');
  } catch {
    return 0n;
  }
}

function sortEvents(events: AgentLifeEventProjection[]) {
  return [...events].sort((left, right) => {
    const leftAt = toDate(left.occurredAt)?.getTime() || 0;
    const rightAt = toDate(right.occurredAt)?.getTime() || 0;
    if (leftAt !== rightAt) {
      return leftAt - rightAt;
    }
    const leftId = eventIdBigInt(left);
    const rightId = eventIdBigInt(right);
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
  });
}

function numberValue(value: unknown, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function stateNumber(value: unknown, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function normalizeProjection(value: Record<string, unknown> | XiaoniLifeStateProjection | null | undefined): XiaoniLifeStateProjection | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  if ((value as XiaoniLifeStateProjection).version !== XIAONI_LIFE_PROJECTION_VERSION) {
    return null;
  }
  const projection = value as XiaoniLifeStateProjection;
  if (!projection.state || !projection.anchors) {
    return null;
  }
  return projection;
}

function initialState(input: ReduceXiaoniLifeStateInput): { state: ReducerInternalState; rebuiltFromEvents: boolean } {
  const policy = input.policy ?? DEFAULT_RECOVER_ENERGY_POLICY;
  const actionCostScale = clampNumber(
    Number.isFinite(Number(input.actionCostScale)) ? Number(input.actionCostScale) : DEFAULT_ACTION_COST_SCALE,
    0,
    1
  );
  const previous = normalizeProjection(input.previousProjection || null);
  if (previous) {
    return {
      rebuiltFromEvents: false,
      state: {
        policy,
        actionCostScale,
        serviceStartedAt: toDate(previous.anchors.serviceStartedAt),
        lastMeaningfulActivityAt: toDate(previous.anchors.lastMeaningfulActivityAt),
        lastBoredomResetAt: toDate(previous.anchors.lastBoredomResetAt),
        lastRestAt: toDate(previous.anchors.lastRestAt),
        lastPresenceTickEnqueuedAt: toDate(previous.anchors.lastPresenceTickEnqueuedAt),
        boredomOffset: 0,
        rewardAttraction: clamp01(previous.state.rewardAttraction),
        attention: clamp01(previous.state.attention),
        homeostaticPressure: clampNumber(
          stateNumber(previous.state.homeostaticPressure, Math.max(0, stateNumber(previous.state.sleepPressure, 0) - stateNumber(previous.state.actionCost, 0))),
          0,
          DEFAULT_RECOVER_ENERGY_POLICY.wakePressureCeiling
        ),
        actionDebt: clampPressure(stateNumber(previous.state.actionDebt, previous.state.actionCost)),
        pressureUpdatedAt: toDate(previous.anchors.pressureUpdatedAt) || toDate(previous.generatedAt),
        materialEventCount: previous.counters?.materialEventCount || 0,
        contributors: []
      }
    };
  }

  const anchors = input.legacyAnchors;
  const legacyState = anchors ? deriveLifeState(anchors, {
    cooldownMs: input.cooldownMs,
    startupGraceMs: input.startupGraceMs
  }) : null;
  const serviceStartedAt = toDate(anchors?.serviceStartedAt) || input.now;
  const lastBoredomResetAt = toDate(anchors?.lastBoredomResetAt) || toDate(anchors?.lastUserMessageAt) || serviceStartedAt;
  const lastMeaningfulActivityAt = toDate(anchors?.lastActiveAt) || serviceStartedAt;
  const lastRestAt = toDate(anchors?.lastSleepAt) || serviceStartedAt;

  return {
    rebuiltFromEvents: true,
    state: {
      policy,
      actionCostScale,
      serviceStartedAt,
      lastMeaningfulActivityAt,
      lastBoredomResetAt,
      lastRestAt,
      lastPresenceTickEnqueuedAt: toDate(anchors?.lastPresenceTickEnqueuedAt),
      boredomOffset: legacyState ? legacyState.boredom * 0.25 : 0,
      rewardAttraction: legacyState ? legacyState.sharingDesire * 0.35 : 0.25,
      attention: 0.25,
      homeostaticPressure: 0,
      actionDebt: 0,
      pressureUpdatedAt: lastRestAt,
      materialEventCount: 0,
      contributors: []
    }
  };
}

function rememberContributor(
  state: ReducerInternalState,
  event: AgentLifeEventProjection,
  effect: string
) {
  if (!effect) {
    return;
  }
  state.contributors.push({
    eventId: event.id || null,
    eventKind: event.eventKind,
    occurredAt: event.occurredAt || null,
    effect
  });
  if (state.contributors.length > 8) {
    state.contributors.shift();
  }
}

function formatCost(value: number) {
  return Number.isFinite(value) ? value.toFixed(2) : '0.00';
}

function actionCostText(cost: number) {
  return `行动成本 ${formatCost(cost)}`;
}

function resolveActionCost(eventKind: string, eventCost: number) {
  if (eventCost > 0) {
    return eventCost;
  }
  return DEFAULT_ACTION_COST_BY_EVENT_KIND[eventKind] ?? 0;
}

function applyActionCost(state: ReducerInternalState, eventKind: string, eventCost: number) {
  const resolvedCost = resolveActionCost(eventKind, eventCost);
  // actionCostScale (admin-configurable, 0..1) scales per-action energy debt. 0 = no action
  // drain (flat cost curve); 1 = normal. Keeps resolvedCost intact for the contributor text.
  const scaledCost = resolvedCost * state.actionCostScale;
  if (scaledCost > 0) {
    state.actionDebt = clampPressure(state.actionDebt + scaledCost);
  }
  return resolvedCost;
}

function computeDecayedActionDebt(actionDebt: number, elapsedMinutes: number) {
  const normalizedDebt = clampNonNegative(actionDebt);
  const normalizedElapsed = Math.max(0, elapsedMinutes);
  if (normalizedDebt <= 0 || normalizedElapsed <= 0) {
    return normalizedDebt;
  }
  const tau = Math.max(0.001, DEFAULT_RECOVER_ENERGY_POLICY.actionDebtRecoveryTauMinutes);
  return clampPressure(normalizedDebt * Math.exp(-normalizedElapsed / tau));
}

function advanceAwakePressure(state: ReducerInternalState, at: Date | null) {
  if (!at) {
    return;
  }
  if (!state.pressureUpdatedAt) {
    state.pressureUpdatedAt = at;
    return;
  }
  const awakeMinutes = Math.max(0, (at.getTime() - state.pressureUpdatedAt.getTime()) / MINUTE_MS);
  if (awakeMinutes <= 0) {
    return;
  }
  state.actionDebt = computeDecayedActionDebt(state.actionDebt, awakeMinutes);
  state.homeostaticPressure = clampNumber(
    computeAwakePressureBetween({
      startPressure: state.homeostaticPressure,
      startedAt: state.pressureUpdatedAt,
      endedAt: at,
      policy: state.policy
    }),
    0,
    DEFAULT_RECOVER_ENERGY_POLICY.wakePressureCeiling
  );
  state.pressureUpdatedAt = at;
}

function applySleepPressure(state: ReducerInternalState, pressure: number) {
  const normalizedPressure = clampPressure(pressure);
  state.homeostaticPressure = Math.min(normalizedPressure, DEFAULT_RECOVER_ENERGY_POLICY.wakePressureCeiling);
  state.actionDebt = Math.max(0, normalizedPressure - state.homeostaticPressure);
}

function totalPressure(state: ReducerInternalState) {
  return clampPressure(state.homeostaticPressure + state.actionDebt);
}

function applyEvent(state: ReducerInternalState, event: AgentLifeEventProjection) {
  const occurredAt = toDate(event.occurredAt);
  const payload = event.payload || {};
  const actionCost = Math.max(0, numberValue(event.actionCost, 0));
  const rewardDelta = numberValue(event.rewardDelta, 0);
  const boredomDelta = numberValue(event.boredomDelta, 0);
  const attentionDelta = numberValue(event.attentionDelta, 0);

  state.boredomOffset = clamp01(state.boredomOffset + boredomDelta);
  state.rewardAttraction = clamp01(state.rewardAttraction + rewardDelta);
  state.attention = clamp01(state.attention + attentionDelta);

  switch (event.eventKind) {
    case 'surface_visit':
      advanceAwakePressure(state, occurredAt);
      applyActionCost(state, event.eventKind, actionCost);
      state.attention = clamp01(state.attention + 0.18);
      state.boredomOffset = clamp01(state.boredomOffset - 0.2);
      state.lastBoredomResetAt = occurredAt || state.lastBoredomResetAt;
      state.lastMeaningfulActivityAt = occurredAt || state.lastMeaningfulActivityAt;
      state.materialEventCount += 1;
      rememberContributor(state, event, `打开或进入会话，${actionCostText(resolveActionCost(event.eventKind, actionCost))}`);
      break;
    case 'qq_message_seen':
      advanceAwakePressure(state, occurredAt);
      applyActionCost(state, event.eventKind, actionCost);
      state.attention = clamp01(state.attention + 0.12);
      state.boredomOffset = clamp01(state.boredomOffset - 0.12);
      state.lastBoredomResetAt = occurredAt || state.lastBoredomResetAt;
      state.materialEventCount += 1;
      rememberContributor(state, event, `看见真实消息，${actionCostText(resolveActionCost(event.eventKind, actionCost))}`);
      break;
    case 'qq_self_message':
    case 'send_in_group':
      advanceAwakePressure(state, occurredAt);
      applyActionCost(state, event.eventKind, actionCost);
      state.rewardAttraction = clamp01(state.rewardAttraction - 0.15);
      state.boredomOffset = clamp01(state.boredomOffset - 0.25);
      state.lastBoredomResetAt = occurredAt || state.lastBoredomResetAt;
      state.lastMeaningfulActivityAt = occurredAt || state.lastMeaningfulActivityAt;
      state.materialEventCount += 1;
      rememberContributor(state, event, `已经开口，${actionCostText(resolveActionCost(event.eventKind, actionCost))}`);
      break;
    case 'silence_decision':
      advanceAwakePressure(state, occurredAt);
      applyActionCost(state, event.eventKind, actionCost);
      state.attention = clamp01(state.attention - 0.04);
      rememberContributor(state, event, `看过但选择沉默，${actionCostText(resolveActionCost(event.eventKind, actionCost))}`);
      break;
    case 'web_search_result':
    case 'pending_share_created':
      advanceAwakePressure(state, occurredAt);
      applyActionCost(state, event.eventKind, actionCost);
      state.rewardAttraction = clamp01(state.rewardAttraction + 0.18);
      state.boredomOffset = clamp01(state.boredomOffset - 0.05);
      state.materialEventCount += 1;
      rememberContributor(state, event, `产生可分享材料，${actionCostText(resolveActionCost(event.eventKind, actionCost))}`);
      break;
    case 'pending_share_consumed':
      advanceAwakePressure(state, occurredAt);
      state.rewardAttraction = clamp01(state.rewardAttraction - 0.12);
      applyActionCost(state, event.eventKind, actionCost);
      rememberContributor(state, event, `用掉一条可分享材料，${actionCostText(resolveActionCost(event.eventKind, actionCost))}`);
      break;
    case 'presence_tick_evaluated':
      advanceAwakePressure(state, occurredAt);
      applyActionCost(state, event.eventKind, actionCost);
      if (payload.eligible === true && (payload.enqueued === true || payload.queue_id || payload.queueId)) {
        state.lastPresenceTickEnqueuedAt = occurredAt || state.lastPresenceTickEnqueuedAt;
      }
      rememberContributor(state, event, payload.eligible === true
        ? `空闲检查可以进入队列，${actionCostText(resolveActionCost(event.eventKind, actionCost))}`
        : `空闲检查被跳过，${actionCostText(resolveActionCost(event.eventKind, actionCost))}`);
      break;
    case 'rest_period':
      advanceAwakePressure(state, occurredAt);
      state.actionDebt = clampNonNegative(state.actionDebt - 0.1);
      if (state.actionDebt === 0) {
        state.homeostaticPressure = clampNonNegative(state.homeostaticPressure - 0.04);
      }
      state.attention = clamp01(state.attention - 0.08);
      state.lastRestAt = occurredAt || state.lastRestAt;
      state.pressureUpdatedAt = occurredAt || state.pressureUpdatedAt;
      rememberContributor(state, event, '刚才短暂休息了一会儿，行动成本恢复 0.10');
      break;
    case 'sleep_period':
      if (typeof payload.energy === 'number') {
        const maxEnergy = Math.max(0.001, numberValue(payload.max_energy, 1));
        applySleepPressure(state, energyToPressure(payload.energy, maxEnergy));
      } else {
        state.actionDebt = clampNonNegative(state.actionDebt - 0.2);
        state.homeostaticPressure = clampNonNegative(state.homeostaticPressure - 0.08);
      }
      state.attention = clamp01(state.attention - 0.12);
      state.lastRestAt = occurredAt || state.lastRestAt;
      state.lastMeaningfulActivityAt = occurredAt || state.lastMeaningfulActivityAt;
      state.pressureUpdatedAt = occurredAt || state.pressureUpdatedAt;
      rememberContributor(state, event, `刚才记录了一次休息恢复，恢复后疲劳压力=${formatCost(totalPressure(state))}`);
      break;
    default:
      advanceAwakePressure(state, occurredAt);
      applyActionCost(state, event.eventKind, actionCost);
      break;
  }
}

export function reduceXiaoniLifeState(input: ReduceXiaoniLifeStateInput): {
  projection: XiaoniLifeStateProjection;
  explanation: XiaoniLifeStateExplanation;
} {
  const { state, rebuiltFromEvents } = initialState(input);
  const orderedEvents = sortEvents(input.events || []);
  const firstEventAt = toDate(orderedEvents[0]?.occurredAt);
  if (rebuiltFromEvents && firstEventAt && (!state.pressureUpdatedAt || state.pressureUpdatedAt.getTime() > firstEventAt.getTime())) {
    state.pressureUpdatedAt = firstEventAt;
  }
  for (const event of orderedEvents) {
    applyEvent(state, event);
  }
  advanceAwakePressure(state, input.now);

  const reducedThroughEvent = orderedEvents[orderedEvents.length - 1] || null;
  const hoursSinceBoredomReset = hoursBetween(input.now, state.lastBoredomResetAt);
  const boredom = clamp01(state.boredomOffset + (hoursSinceBoredomReset / 3));
  const actionCost = clampNonNegative(state.actionDebt);
  const homeostaticPressure = clampNumber(state.homeostaticPressure, 0, DEFAULT_RECOVER_ENERGY_POLICY.wakePressureCeiling);
  const fatigue = totalPressure(state);
  const energy = 1 - fatigue;
  const rewardAttraction = clamp01(state.rewardAttraction);
  const sharingDesire = clamp01((boredom * 0.52) + (rewardAttraction * 0.28) + (energy * 0.2) - (fatigue * 0.08));
  const enqueuedAt = state.lastPresenceTickEnqueuedAt;
  const serviceStartedAt = state.serviceStartedAt;
  const cooldownActive = Boolean(enqueuedAt && input.now.getTime() - enqueuedAt.getTime() < (input.cooldownMs ?? 45 * 60 * 1000));
  const startupGraceActive = Boolean(serviceStartedAt && input.now.getTime() - serviceStartedAt.getTime() < (input.startupGraceMs ?? 5 * 60 * 1000));
  const projectedState = {
    boredom,
    fatigue,
    energy,
    sharingDesire,
    sleepPressure: fatigue,
    cooldownActive,
    startupGraceActive,
    attention: clamp01(state.attention),
    rewardAttraction,
    restPressure: fatigue,
    actionCost,
    homeostaticPressure,
    actionDebt: actionCost
  };

  const projection: XiaoniLifeStateProjection = {
    identityKey: input.identityKey || 'xiaoni',
    version: XIAONI_LIFE_PROJECTION_VERSION,
    generatedAt: input.now.toISOString(),
    reducedThroughEventId: reducedThroughEvent?.id || normalizeProjection(input.previousProjection || null)?.reducedThroughEventId || null,
    reducedThroughOccurredAt: reducedThroughEvent?.occurredAt || normalizeProjection(input.previousProjection || null)?.reducedThroughOccurredAt || null,
    state: projectedState,
    anchors: {
      serviceStartedAt: toIso(state.serviceStartedAt),
      lastMeaningfulActivityAt: toIso(state.lastMeaningfulActivityAt),
      lastBoredomResetAt: toIso(state.lastBoredomResetAt),
      lastRestAt: toIso(state.lastRestAt),
      lastPresenceTickEnqueuedAt: toIso(state.lastPresenceTickEnqueuedAt),
      pressureUpdatedAt: toIso(state.pressureUpdatedAt)
    },
    counters: {
      eventCount: (normalizeProjection(input.previousProjection || null)?.counters?.eventCount || 0) + orderedEvents.length,
      materialEventCount: state.materialEventCount
    }
  };

  const explanation: XiaoniLifeStateExplanation = {
    version: XIAONI_LIFE_PROJECTION_VERSION,
    summary: `当前精力=${energy.toFixed(2)}`,
    generatedAt: input.now.toISOString(),
    rebuiltFromEvents,
    eventCount: projection.counters.eventCount,
    reducedThroughEventId: projection.reducedThroughEventId,
    contributors: state.contributors.slice(-5).reverse(),
    meterDrivers: {
      boredom: `当前精力=${energy.toFixed(2)}`,
      fatigue: `当前精力=${energy.toFixed(2)}，自然疲劳=${projectedState.homeostaticPressure.toFixed(2)}，行动透支=${projectedState.actionDebt.toFixed(2)}`,
      sharingDesire: `当前精力=${energy.toFixed(2)}`,
      attention: `当前精力=${energy.toFixed(2)}`
    }
  };

  return { projection, explanation };
}
