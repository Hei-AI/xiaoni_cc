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

function renderMaterialSource(item: PresenceSharePoolItem) {
  if (item.sourceWording === 'real_web_search') {
    return '真实网页搜索材料，可以说是查到或看到的资料';
  }
  if (item.sourceWording === 'mock_only') {
    return '模拟材料，只能当作内部假设';
  }
  if (item.sourceWording === 'constructed_only') {
    return '整理出来的材料，不能说成刚查到';
  }
  return `${item.sourceKind} 材料，使用前注意来源边界`;
}

function renderBoundaryLabel(boundaryLabel: string) {
  if (boundaryLabel === 'safe') return '可以使用';
  if (boundaryLabel === 'reframe') return '需要换个说法';
  if (boundaryLabel === 'blocked') return '不要使用';
  return boundaryLabel;
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

export function shouldFirePresenceTick(state: PresenceLifeState, options: {
  minBoredom?: number;
  minSharingDesire?: number;
  maxFatigue?: number;
} = {}): PresenceTickDecision {
  if (state.startupGraceActive) {
    return { shouldEnqueue: false, reason: 'startup_grace' };
  }
  if (state.cooldownActive) {
    return { shouldEnqueue: false, reason: 'cooldown' };
  }
  if (state.fatigue > (options.maxFatigue ?? 0.82)) {
    return { shouldEnqueue: false, reason: 'fatigue' };
  }
  if (state.boredom < (options.minBoredom ?? 0.45)) {
    return { shouldEnqueue: false, reason: 'not_bored' };
  }
  if (state.sharingDesire < (options.minSharingDesire ?? 0.35)) {
    return { shouldEnqueue: false, reason: 'low_sharing_desire' };
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

export function buildPresenceContextBlock(params: {
  state: PresenceLifeState;
  items: PresenceSharePoolItem[];
  scores: ReturnType<typeof scoreSharePoolItem>[];
  stateExplanation?: string | null;
  isPresenceTick: boolean;
}) {
  const topItems = params.items.slice(0, 3);
  const hasRealWebSearchMaterial = topItems.some((item) => item.sourceWording === 'real_web_search');
  const currentResidue = hasRealWebSearchMaterial
    ? '可用材料里有真实网页搜索留下的内容；只能基于这些材料表达，不能补造没有记录的实时来源。'
    : '没有真实浏览器证据；模拟或整理出来的材料不能说成刚看到、刚刷到或我查到。';
  const material = topItems.length > 0
    ? topItems.map((item) => `- ${item.content}（来源：${renderMaterialSource(item)}；边界：${renderBoundaryLabel(item.boundaryLabel)}）`).join('\n')
    : '- 暂无可用分享材料';
  return [
    '<小腻当前状态>',
    `本轮动作：${params.isPresenceTick ? '小腻从自己的生活里检查了一下消息列表。' : '本轮由群友消息触发。'}`,
    `材料边界：${currentResidue}`,
    `当前状态：当前精力=${params.state.energy.toFixed(2)}。`,
    params.stateExplanation ? `状态说明：${params.stateExplanation}` : null,
    `可用材料：\n${material}`,
    `行动成本：状态说明里会列最近动作的成本；精力低时更适合潜水或短句。`,
    `来源边界：只能表达自己的想法、印象或整理出来的话题；只有明确标成真实网页搜索的材料，才能说成我查到；其他材料不能伪装成实时来源。`,
    '</小腻当前状态>'
  ].filter(Boolean).join('\n');
}
