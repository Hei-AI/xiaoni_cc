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
  pressureOffset: number;
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
        pressureOffset: 0,
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
      pressureOffset: legacyState ? legacyState.sleepPressure * 0.2 : 0,
      rewardAttraction: legacyState ? legacyState.sharingDesire * 0.35 : 0.25,
      attention: 0.25,
      actionCost: legacyState ? legacyState.fatigue * 0.15 : 0,
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

function applyEvent(state: ReducerInternalState, event: AgentLifeEventProjection) {
  const occurredAt = toDate(event.occurredAt);
  const payload = event.payload || {};
  const actionCost = Math.max(0, numberValue(event.actionCost, 0));
  const pressureDelta = numberValue(event.pressureDelta, 0);
  const rewardDelta = numberValue(event.rewardDelta, 0);
  const boredomDelta = numberValue(event.boredomDelta, 0);
  const attentionDelta = numberValue(event.attentionDelta, 0);

  state.boredomOffset = clamp01(state.boredomOffset + boredomDelta);
  state.pressureOffset = clamp01(state.pressureOffset + pressureDelta);
  state.rewardAttraction = clamp01(state.rewardAttraction + rewardDelta);
  state.attention = clamp01(state.attention + attentionDelta);
  state.actionCost = clamp01(state.actionCost + actionCost);

  switch (event.eventKind) {
    case 'surface_visit':
      state.attention = clamp01(state.attention + 0.18);
      state.boredomOffset = clamp01(state.boredomOffset - 0.2);
      state.lastBoredomResetAt = occurredAt || state.lastBoredomResetAt;
      state.lastMeaningfulActivityAt = occurredAt || state.lastMeaningfulActivityAt;
      state.materialEventCount += 1;
      rememberContributor(state, event, '打开或进入会话，注意力上升，无聊感被打断');
      break;
    case 'qq_message_seen':
      state.attention = clamp01(state.attention + 0.12);
      state.boredomOffset = clamp01(state.boredomOffset - 0.12);
      state.lastBoredomResetAt = occurredAt || state.lastBoredomResetAt;
      state.materialEventCount += 1;
      rememberContributor(state, event, '看见真实消息，注意力上升');
      break;
    case 'qq_self_message':
    case 'speak_in_group':
      state.actionCost = clamp01(state.actionCost + 0.12);
      state.rewardAttraction = clamp01(state.rewardAttraction - 0.15);
      state.boredomOffset = clamp01(state.boredomOffset - 0.25);
      state.lastBoredomResetAt = occurredAt || state.lastBoredomResetAt;
      state.lastMeaningfulActivityAt = occurredAt || state.lastMeaningfulActivityAt;
      state.materialEventCount += 1;
      rememberContributor(state, event, '已经开口，分享欲下降且行动成本上升');
      break;
    case 'silence_decision':
      state.actionCost = clamp01(state.actionCost + 0.02);
      state.attention = clamp01(state.attention - 0.04);
      rememberContributor(state, event, '看过但选择沉默，不重置无聊时钟');
      break;
    case 'web_search_result':
    case 'pending_share_created':
      state.rewardAttraction = clamp01(state.rewardAttraction + 0.18);
      state.boredomOffset = clamp01(state.boredomOffset - 0.05);
      state.materialEventCount += 1;
      rememberContributor(state, event, '产生可分享材料，分享吸引力上升');
      break;
    case 'pending_share_consumed':
      state.rewardAttraction = clamp01(state.rewardAttraction - 0.12);
      state.actionCost = clamp01(state.actionCost + 0.04);
      rememberContributor(state, event, '可分享材料被消费，分享冲动回落');
      break;
    case 'presence_tick_evaluated':
      if (payload.eligible === true && (payload.enqueued === true || payload.queue_id || payload.queueId)) {
        state.lastPresenceTickEnqueuedAt = occurredAt || state.lastPresenceTickEnqueuedAt;
      }
      rememberContributor(state, event, payload.eligible === true ? 'presence tick 评估为可入队' : 'presence tick 被跳过');
      break;
    case 'rest_period':
      state.actionCost = clamp01(state.actionCost - 0.25);
      state.pressureOffset = clamp01(state.pressureOffset - 0.2);
      state.attention = clamp01(state.attention - 0.08);
      state.lastRestAt = occurredAt || state.lastRestAt;
      rememberContributor(state, event, '休息降低行动成本和疲劳压力');
      break;
    case 'sleep_period':
      state.actionCost = 0;
      state.pressureOffset = clamp01(state.pressureOffset - 0.5);
      state.attention = clamp01(state.attention - 0.12);
      state.lastRestAt = occurredAt || state.lastRestAt;
      state.lastMeaningfulActivityAt = occurredAt || state.lastMeaningfulActivityAt;
      rememberContributor(state, event, '睡眠重置主要疲劳成本');
      break;
    default:
      break;
  }
}

function stateLabel(state: XiaoniLifeStateProjection['state']) {
  if (state.fatigue > 0.75) return '疲劳偏高';
  if (state.boredom > 0.65) return '有点无聊';
  if (state.sharingDesire > 0.65) return '有分享冲动';
  return '平稳';
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
  const hoursSinceRest = hoursBetween(input.now, state.lastRestAt || state.serviceStartedAt);
  const boredom = clamp01(state.boredomOffset + (hoursSinceBoredomReset / 3));
  const restPressure = clamp01((hoursSinceRest / 16) + state.pressureOffset + (state.actionCost * 0.12));
  const fatigue = clamp01((restPressure * 0.72) + (state.actionCost * 0.18));
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
    sleepPressure: restPressure,
    cooldownActive,
    startupGraceActive,
    attention: clamp01(state.attention),
    rewardAttraction,
    restPressure,
    actionCost: clamp01(state.actionCost)
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
    summary: `${stateLabel(projectedState)}；boredom=${boredom.toFixed(2)} fatigue=${fatigue.toFixed(2)} sharing_desire=${sharingDesire.toFixed(2)}`,
    generatedAt: input.now.toISOString(),
    rebuiltFromEvents,
    eventCount: projection.counters.eventCount,
    reducedThroughEventId: projection.reducedThroughEventId,
    contributors: state.contributors.slice(-5).reverse(),
    meterDrivers: {
      boredom: `${hoursSinceBoredomReset.toFixed(1)}h since boredom reset plus event offsets`,
      fatigue: `${hoursSinceRest.toFixed(1)}h since rest plus action cost ${projectedState.actionCost.toFixed(2)}`,
      sharingDesire: `boredom ${boredom.toFixed(2)}, reward ${rewardAttraction.toFixed(2)}, energy ${energy.toFixed(2)}`,
      attention: `recent surface/message events set attention ${projectedState.attention.toFixed(2)}`
    }
  };

  return { projection, explanation };
}
