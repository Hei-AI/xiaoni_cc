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

export type PresenceDigitalAction = {
  id: string;
  actionType: string;
  surface: string;
  motiveKind: string | null;
  motiveText: string | null;
  query: string | null;
  status: string;
  resultSummary: string | null;
  residueText: string | null;
  residueKind: string | null;
  sourceWording: string | null;
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

function hoursBetween(left: Date, right: Date) {
  return Math.max(0, (left.getTime() - right.getTime()) / HOUR_MS);
}

export function deriveLifeState(anchors: PresenceAnchors, options: {
  cooldownMs?: number;
  startupGraceMs?: number;
} = {}): PresenceLifeState {
  const now = anchors.now;
  const boredomAnchor = toDate(anchors.lastBoredomResetAt) || toDate(anchors.lastUserMessageAt) || toDate(anchors.serviceStartedAt) || now;
  const activeAnchor = toDate(anchors.lastActiveAt) || toDate(anchors.serviceStartedAt) || now;
  const sleepAnchor = toDate(anchors.lastSleepAt);
  const enqueuedAt = toDate(anchors.lastPresenceTickEnqueuedAt);
  const serviceStartedAt = toDate(anchors.serviceStartedAt);
  const hoursSinceBoredomReset = hoursBetween(now, boredomAnchor);
  const hoursSinceActive = hoursBetween(now, activeAnchor);
  const sleepPressure = clamp01(hoursSinceActive / 16);
  const recentSleepRestore = sleepAnchor ? clamp01(1 - hoursBetween(now, sleepAnchor) / 8) : 0;
  const fatigue = clamp01((sleepPressure * 0.75) + (hoursSinceActive > 20 ? 0.25 : 0) - (recentSleepRestore * 0.4));
  const boredom = clamp01(hoursSinceBoredomReset / 3);
  const energy = clamp01(1 - fatigue);
  const sharingDesire = clamp01((boredom * 0.65) + (energy * 0.25) - ((anchors.dailyProactiveCount || 0) * 0.08));
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
  recentDigitalActions?: PresenceDigitalAction[];
  isPresenceTick: boolean;
}) {
  const stateLabel = params.state.fatigue > 0.75 ? '疲劳偏高'
    : params.state.boredom > 0.65 ? '有点无聊'
      : '平稳';
  const topItems = params.items.slice(0, 3);
  const recentActions = (params.recentDigitalActions || [])
    .filter((action) => action.status === 'completed' && action.actionType === 'web_search')
    .slice(0, 3);
  const latestRealSearch = recentActions.find((action) => action.sourceWording === 'real_web_search' && action.residueText);
  const currentResidue = latestRealSearch
    ? `最近一次真实 web_search 残留：${latestRealSearch.residueText}（query: ${latestRealSearch.query || '未记录'}；来源措辞：${latestRealSearch.sourceWording}）。`
    : '没有真实浏览器证据；mock/constructed 材料不能说成刚看到、刚刷到或我查到。';
  const actionTrace = recentActions.length > 0
    ? recentActions
      .map((action) => `- ${action.createdAt ? new Date(action.createdAt).toISOString() : 'unknown_time'} ${action.surface}/${action.motiveKind || 'unknown'}: ${action.query || '未记录 query'}`)
      .join('\n')
    : '- 暂无已完成的自主数字行动';
  const material = topItems.length > 0
    ? topItems.map((item) => `- ${item.content}（来源类型：${item.sourceKind}，边界：${item.boundaryLabel}，措辞：${item.sourceWording}）`).join('\n')
    : '- 暂无可用分享材料';
  return [
    '<小腻当前状态>',
    `recent_action_trace: ${params.isPresenceTick ? '本轮由 presence_tick 触发；小腻主动打开目标群查看。' : '本轮由群友消息触发。'}`,
    `recent_digital_actions:\n${actionTrace}`,
    `current_residue: ${currentResidue}`,
    `current_state: ${stateLabel}；boredom=${params.state.boredom.toFixed(2)}；fatigue=${params.state.fatigue.toFixed(2)}；energy=${params.state.energy.toFixed(2)}；sharing_desire=${params.state.sharingDesire.toFixed(2)}。`,
    `available_material:\n${material}`,
    `action_cost: 低成本可潜水或短句；中成本可主动分享一句；高疲劳时不适合长篇展开。`,
    `source_boundary: 只能表达自己的想法、印象或整理出来的话题；只有 source_wording=real_web_search 的材料能说成我查到，其他材料不能伪装成实时来源。`,
    '</小腻当前状态>'
  ].join('\n');
}
