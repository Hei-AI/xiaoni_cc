import type { AgentLifeEventProjection } from '@qq-bot/persistence';
import {
  deriveLifeState,
  type PresenceAnchors,
  type PresenceLifeState
} from './presence-context';

export const XIAONI_LIFE_PROJECTION_VERSION = 'xiaoni-life-v1';

type LifeProjectionAnchors = {
  serviceStartedAt: string | null;
  lastMeaningfulActivityAt: string | null;
  lastBoredomResetAt: string | null;
  lastRestAt: string | null;
  lastPresenceTickEnqueuedAt: string | null;
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
  actionCost: number;
  materialEventCount: number;
  contributors: XiaoniLifeStateExplanation['contributors'];
};

export type ReduceXiaoniLifeStateInput = {
  identityKey?: string;
  now: Date;
  events: AgentLifeEventProjection[];
  previousProjection?: Record<string, unknown> | XiaoniLifeStateProjection | null;
  legacyAnchors?: PresenceAnchors | null;
  cooldownMs?: number;
  startupGraceMs?: number;
};

const HOUR_MS = 60 * 60 * 1000;

// Historical life events may predate explicit actionCost writes. New events
// should carry actionCost at the write site and use these values only as a
// compatibility fallback.
const DEFAULT_ACTION_COST_BY_EVENT_KIND: Record<string, number> = {
  surface_visit: 0.01,
  qq_message_seen: 0,
  qq_self_message: 0,
  speak_in_group: 0.01,
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
  const previous = normalizeProjection(input.previousProjection || null);
  if (previous) {
    return {
      rebuiltFromEvents: false,
      state: {
        serviceStartedAt: toDate(previous.anchors.serviceStartedAt),
        lastMeaningfulActivityAt: toDate(previous.anchors.lastMeaningfulActivityAt),
        lastBoredomResetAt: toDate(previous.anchors.lastBoredomResetAt),
        lastRestAt: toDate(previous.anchors.lastRestAt),
        lastPresenceTickEnqueuedAt: toDate(previous.anchors.lastPresenceTickEnqueuedAt),
        boredomOffset: 0,
        rewardAttraction: clamp01(previous.state.rewardAttraction),
        attention: clamp01(previous.state.attention),
        actionCost: clamp01(previous.state.actionCost),
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
      serviceStartedAt,
      lastMeaningfulActivityAt,
      lastBoredomResetAt,
      lastRestAt,
      lastPresenceTickEnqueuedAt: toDate(anchors?.lastPresenceTickEnqueuedAt),
      boredomOffset: legacyState ? legacyState.boredom * 0.25 : 0,
      rewardAttraction: legacyState ? legacyState.sharingDesire * 0.35 : 0.25,
      attention: 0.25,
      actionCost: 0,
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
  if (resolvedCost > 0) {
    state.actionCost = clamp01(state.actionCost + resolvedCost);
  }
  return resolvedCost;
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
      applyActionCost(state, event.eventKind, actionCost);
      state.attention = clamp01(state.attention + 0.18);
      state.boredomOffset = clamp01(state.boredomOffset - 0.2);
      state.lastBoredomResetAt = occurredAt || state.lastBoredomResetAt;
      state.lastMeaningfulActivityAt = occurredAt || state.lastMeaningfulActivityAt;
      state.materialEventCount += 1;
      rememberContributor(state, event, `打开或进入会话，${actionCostText(resolveActionCost(event.eventKind, actionCost))}`);
      break;
    case 'qq_message_seen':
      applyActionCost(state, event.eventKind, actionCost);
      state.attention = clamp01(state.attention + 0.12);
      state.boredomOffset = clamp01(state.boredomOffset - 0.12);
      state.lastBoredomResetAt = occurredAt || state.lastBoredomResetAt;
      state.materialEventCount += 1;
      rememberContributor(state, event, `看见真实消息，${actionCostText(resolveActionCost(event.eventKind, actionCost))}`);
      break;
    case 'qq_self_message':
    case 'speak_in_group':
      applyActionCost(state, event.eventKind, actionCost);
      state.rewardAttraction = clamp01(state.rewardAttraction - 0.15);
      state.boredomOffset = clamp01(state.boredomOffset - 0.25);
      state.lastBoredomResetAt = occurredAt || state.lastBoredomResetAt;
      state.lastMeaningfulActivityAt = occurredAt || state.lastMeaningfulActivityAt;
      state.materialEventCount += 1;
      rememberContributor(state, event, `已经开口，${actionCostText(resolveActionCost(event.eventKind, actionCost))}`);
      break;
    case 'silence_decision':
      applyActionCost(state, event.eventKind, actionCost);
      state.attention = clamp01(state.attention - 0.04);
      rememberContributor(state, event, `看过但选择沉默，${actionCostText(resolveActionCost(event.eventKind, actionCost))}`);
      break;
    case 'web_search_result':
    case 'pending_share_created':
      applyActionCost(state, event.eventKind, actionCost);
      state.rewardAttraction = clamp01(state.rewardAttraction + 0.18);
      state.boredomOffset = clamp01(state.boredomOffset - 0.05);
      state.materialEventCount += 1;
      rememberContributor(state, event, `产生可分享材料，${actionCostText(resolveActionCost(event.eventKind, actionCost))}`);
      break;
    case 'pending_share_consumed':
      state.rewardAttraction = clamp01(state.rewardAttraction - 0.12);
      applyActionCost(state, event.eventKind, actionCost);
      rememberContributor(state, event, `用掉一条可分享材料，${actionCostText(resolveActionCost(event.eventKind, actionCost))}`);
      break;
    case 'presence_tick_evaluated':
      applyActionCost(state, event.eventKind, actionCost);
      if (payload.eligible === true && (payload.enqueued === true || payload.queue_id || payload.queueId)) {
        state.lastPresenceTickEnqueuedAt = occurredAt || state.lastPresenceTickEnqueuedAt;
      }
      rememberContributor(state, event, payload.eligible === true
        ? `空闲检查可以进入队列，${actionCostText(resolveActionCost(event.eventKind, actionCost))}`
        : `空闲检查被跳过，${actionCostText(resolveActionCost(event.eventKind, actionCost))}`);
      break;
    case 'rest_period':
      state.actionCost = clamp01(state.actionCost - 0.1);
      state.attention = clamp01(state.attention - 0.08);
      state.lastRestAt = occurredAt || state.lastRestAt;
      rememberContributor(state, event, '刚才短暂休息了一会儿，行动成本恢复 0.10');
      break;
    case 'sleep_period':
      state.actionCost = 0;
      state.attention = clamp01(state.attention - 0.12);
      state.lastRestAt = occurredAt || state.lastRestAt;
      state.lastMeaningfulActivityAt = occurredAt || state.lastMeaningfulActivityAt;
      rememberContributor(state, event, '刚才记录了一次休息恢复，恢复后累计行动成本重置为 0.00');
      break;
    default:
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
  for (const event of orderedEvents) {
    applyEvent(state, event);
  }

  const reducedThroughEvent = orderedEvents[orderedEvents.length - 1] || null;
  const hoursSinceBoredomReset = hoursBetween(input.now, state.lastBoredomResetAt);
  const boredom = clamp01(state.boredomOffset + (hoursSinceBoredomReset / 3));
  const actionCost = clamp01(state.actionCost);
  const fatigue = actionCost;
  const energy = clamp01(1 - fatigue);
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
    sleepPressure: actionCost,
    cooldownActive,
    startupGraceActive,
    attention: clamp01(state.attention),
    rewardAttraction,
    restPressure: actionCost,
    actionCost
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
      lastPresenceTickEnqueuedAt: toIso(state.lastPresenceTickEnqueuedAt)
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
      fatigue: `当前精力=${energy.toFixed(2)}，累计行动成本=${projectedState.actionCost.toFixed(2)}`,
      sharingDesire: `当前精力=${energy.toFixed(2)}`,
      attention: `当前精力=${energy.toFixed(2)}`
    }
  };

  return { projection, explanation };
}
