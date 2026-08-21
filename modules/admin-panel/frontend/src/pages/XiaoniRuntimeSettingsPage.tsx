import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BatteryFull, Bot, Brain, EyeOff, Gauge, HeartPulse, Loader2, Power, RefreshCw, Shrink, Sparkles, TimerReset, Zap } from 'lucide-react';
import { PageShell } from '@/components/console/PageShell';
import { PageHeader } from '@/components/console/PageHeader';
import { SectionPanel } from '@/components/console/SectionPanel';
import { ErrorState } from '@/components/console/ErrorState';
import { StatusPill } from '@/components/console/StatusPill';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { formatTimestamp } from '@/lib/utils';

type ApiResponse<T> = {
  success: boolean;
  data: T;
  error?: string;
};

type RuntimeControl = {
  identityKey: string;
  enabled: boolean;
  cacheHeartbeatPaused: boolean;
  cacheHeartbeatPausedAt: string | null;
  postCompressionPauseArmed: boolean;
  postCompressionPauseArmedAt: string | null;
  postCompressionPauseTriggeredAt: string | null;
  postCompressionPauseReason: string | null;
  mainAgentPreModelYieldMs: number;
  debugCacheHeartbeatIntervalMs: number;
  compressionTriggerInputTokens: number;
  compressionTriggerWireBytes: number;
  stripXiaoniOsFromRequests: boolean;
  psychAssessmentGateEnabled: boolean;
  passiveRecallDeliveryEnabled: boolean;
  passiveRecallDeliveryDailyCap: number;
  energyPolicy: Record<string, number> | null;
  energyPolicyDefaults?: Record<string, number>;
  updatedAt: string | null;
};

type EnergyPolicyFieldSpec = {
  key: string;
  label: string;
  hint: string;
  step: number;
  min: number;
  max: number;
};

const ENERGY_POLICY_FIELDS: EnergyPolicyFieldSpec[] = [
  { key: 'wakeTauMinutes', label: '自然疲劳 tau（分钟）', hint: '越大，白天精力下滑越慢。默认 1920（32h）', step: 1, min: 1, max: 10_000_000 },
  { key: 'sleepTauMinutes', label: '睡眠恢复 tau（分钟）', hint: '越小恢复越快。默认 252（4.2h）', step: 1, min: 1, max: 10_000_000 },
  { key: 'actionCostScale', label: '行动消耗系数（0–1）', hint: '0 = 行动不再消耗精力；默认 1', step: 0.05, min: 0, max: 1 },
  { key: 'forcedSleepPressure', label: '强制入睡压力', hint: '压力达到即强制休息。默认 1.3', step: 0.05, min: 0.1, max: 1.6 },
  { key: 'normalSleepOnsetPressure', label: '自愿入睡门槛', hint: '低于此压力睡不着。默认 0.3', step: 0.05, min: 0.05, max: 1.6 },
  { key: 'fullRecoveryMinutes', label: '满恢复时长（分钟）', hint: '一觉睡满的目标时长。默认 480（8h）', step: 5, min: 5, max: 1440 }
];

const ENERGY_POLICY_FALLBACK_DEFAULTS: Record<string, number> = {
  wakeTauMinutes: 1920,
  sleepTauMinutes: 252,
  actionCostScale: 1,
  forcedSleepPressure: 1.3,
  normalSleepOnsetPressure: 0.3,
  fullRecoveryMinutes: 480
};

// "极缓" preset — near-flat decline: huge wake tau + zero action drain.
const ENERGY_POLICY_FLAT_PRESET: Record<string, number> = {
  wakeTauMinutes: 10_000_000,
  actionCostScale: 0
};

type RestoreFullResult = {
  finalizedSessionId: number | string | null;
  resetEventId: number | string | null;
  note: string;
};

async function fetchRuntimeControl(): Promise<RuntimeControl> {
  const response = await fetch('/api/agent-runtime/control');
  const payload = await response.json() as ApiResponse<RuntimeControl>;
  if (!response.ok || !payload.success) {
    throw new Error(payload.error || 'Failed to load runtime control');
  }
  return payload.data;
}

type RuntimeControlPatch = Partial<Pick<RuntimeControl, 'enabled' | 'cacheHeartbeatPaused' | 'postCompressionPauseArmed' | 'mainAgentPreModelYieldMs' | 'debugCacheHeartbeatIntervalMs' | 'compressionTriggerInputTokens' | 'compressionTriggerWireBytes' | 'stripXiaoniOsFromRequests' | 'psychAssessmentGateEnabled' | 'passiveRecallDeliveryEnabled' | 'passiveRecallDeliveryDailyCap'>>;

type CacheHeartbeatTriggerResult = {
  triggered?: boolean;
  reason?: string;
  model?: string;
  provider?: string;
  cachedInputTokens?: number;
  inputTokens?: number;
  runId?: string;
  traceId?: string;
};

type RuntimePromptReloadResult = {
  invalidated?: boolean;
  had_pending_reload?: boolean;
  reason?: string;
};

type RuntimeRecoverNowResult = {
  queue?: {
    queueId?: number;
    status?: string;
  };
  sourceInboundMessage?: {
    id?: number;
    sessionKey?: string;
    messageSid?: string;
    receivedAt?: string | null;
  };
  recovery?: {
    reason?: string;
  };
};

type ManualCompressionResult = {
  triggered: boolean;
  status: string;
  contextSessionKey?: string;
  traceId?: string;
  runId?: string;
  retainedHistoryTurns?: number;
  readCutoffAfterConversationId?: number | null;
  compressionCoveredEndConversationId?: number | null;
};

type CompressionForkStatus = {
  running: boolean;
  contextSessionKey?: string;
  compressionCoveredEndConversationId?: number;
  forkRunId?: string | null;
  runId?: string | null;
  startedAt?: string | null;
  status?: string | null;
};

const COMPRESSION_STATUS_LABELS: Record<string, string> = {
  scheduled: '已启动后台压缩 fork',
  already_running: '已有压缩 fork 在运行（沿用现有的）',
  already_running_durable: '已有压缩 fork 在运行（durable 去重）',
  already_covered: '当前 read cutoff 已覆盖该范围，无需重复压缩',
  nothing_to_compress: '历史不足，没有可压缩的旧内容',
  request_builder_unavailable: 'agent-service 运行存储未就绪'
};

async function updateRuntimeControl(patch: RuntimeControlPatch): Promise<RuntimeControl> {
  const response = await fetch('/api/agent-runtime/control', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch)
  });
  const payload = await response.json() as ApiResponse<RuntimeControl>;
  if (!response.ok || !payload.success) {
    throw new Error(payload.error || 'Failed to update runtime control');
  }
  return payload.data;
}

async function updateEnergyPolicy(input: { energyPolicy: Record<string, number> | null; reset?: boolean }): Promise<RuntimeControl> {
  const response = await fetch('/api/agent-runtime/energy-policy', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });
  const payload = await response.json() as ApiResponse<RuntimeControl>;
  if (!response.ok || !payload.success) {
    throw new Error(payload.error || 'Failed to update energy policy');
  }
  return payload.data;
}

async function restoreFullEnergy(): Promise<RestoreFullResult> {
  const response = await fetch('/api/agent-runtime/energy/restore-full', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  const payload = await response.json() as ApiResponse<RestoreFullResult>;
  if (!response.ok || !payload.success) {
    throw new Error(payload.error || 'Failed to restore energy');
  }
  return payload.data;
}

type EnergyStateData = {
  energy: number | null;
  pressure: number | null;
  homeostaticPressure: number | null;
  actionDebt: number | null;
  sleepOnsetThreshold: number;
  forcedSleepPressure: number;
  canSleepApprox: boolean;
  projectionUpdatedAt: string | null;
  note: string;
};

type EnergySetResult = {
  eventId: number | string | null;
  appliedFields: string[];
  target: { energy: number | null; pressure: number | null; exact: boolean };
  note: string;
};

async function fetchEnergyState(): Promise<EnergyStateData> {
  const response = await fetch('/api/agent-runtime/energy/state');
  const payload = await response.json() as ApiResponse<EnergyStateData>;
  if (!response.ok || !payload.success) {
    throw new Error(payload.error || 'Failed to read energy state');
  }
  return payload.data;
}

async function setCurrentEnergy(
  input: { energy: number } | { homeostaticPressure: number; actionDebt: number }
): Promise<EnergySetResult> {
  const response = await fetch('/api/agent-runtime/energy/set', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });
  const payload = await response.json() as ApiResponse<EnergySetResult>;
  if (!response.ok || !payload.success) {
    throw new Error(payload.error || 'Failed to set current energy');
  }
  return payload.data;
}

async function recoverRuntimeNow(): Promise<RuntimeRecoverNowResult> {
  const response = await fetch('/api/agent-runtime/recover-now', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  const payload = await response.json() as ApiResponse<RuntimeRecoverNowResult>;
  if (!response.ok || !payload.success) {
    throw new Error(payload.error || 'Failed to recover Xiaoni runtime');
  }
  return payload.data;
}

async function forceLoadRuntimePrompt(): Promise<RuntimePromptReloadResult> {
  const response = await fetch('/api/agent-runtime/prompt/reload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  const payload = await response.json() as ApiResponse<RuntimePromptReloadResult>;
  if (!response.ok || !payload.success) {
    throw new Error(payload.error || 'Failed to force-load runtime prompt');
  }
  return payload.data;
}

async function triggerCacheHeartbeat(): Promise<CacheHeartbeatTriggerResult> {
  const response = await fetch('/api/agent-runtime/cache-heartbeat/trigger', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  const payload = await response.json() as ApiResponse<CacheHeartbeatTriggerResult>;
  if (!response.ok || !payload.success) {
    throw new Error(payload.error || 'Failed to trigger cache heartbeat');
  }
  return payload.data;
}

async function triggerCoreMemoryCompression(): Promise<ManualCompressionResult> {
  const response = await fetch('/api/agent-runtime/core-memory-compression/trigger', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  const payload = await response.json() as ApiResponse<ManualCompressionResult>;
  if (!response.ok || !payload.success) {
    throw new Error(payload.error || 'Failed to trigger core memory compression');
  }
  return payload.data;
}

async function fetchCompressionForkStatus(coveredEnd: number): Promise<CompressionForkStatus> {
  const response = await fetch(
    `/api/agent-runtime/core-memory-compression/status?compression_covered_end_conversation_id=${encodeURIComponent(String(coveredEnd))}`
  );
  const payload = await response.json() as ApiResponse<CompressionForkStatus>;
  if (!response.ok || !payload.success) {
    throw new Error(payload.error || 'Failed to read compression status');
  }
  return payload.data;
}

export const XiaoniRuntimeSettingsPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [yieldInput, setYieldInput] = React.useState('');
  const [debugHeartbeatSecondsInput, setDebugHeartbeatSecondsInput] = React.useState('');
  const [compressionTriggerInput, setCompressionTriggerInput] = React.useState('');
  const [compressionWireMiBInput, setCompressionWireMiBInput] = React.useState('');
  const [recallDeliveryCapInput, setRecallDeliveryCapInput] = React.useState('');
  const controlQuery = useQuery({
    queryKey: ['xiaoni-runtime-control'],
    queryFn: fetchRuntimeControl,
    refetchInterval: 10000
  });
  const mutation = useMutation({
    mutationFn: updateRuntimeControl,
    onSuccess: (data) => {
      queryClient.setQueryData(['xiaoni-runtime-control'], data);
      void queryClient.invalidateQueries({ queryKey: ['runtimeStatus'] });
      void queryClient.invalidateQueries({ queryKey: ['xiaoni-action-stream'] });
    }
  });
  const forceLoadMutation = useMutation({
    mutationFn: forceLoadRuntimePrompt,
    onSuccess: () => {
      void controlQuery.refetch();
      void queryClient.invalidateQueries({ queryKey: ['runtimeStatus'] });
      void queryClient.invalidateQueries({ queryKey: ['xiaoni-action-stream'] });
    }
  });
  const recoverMutation = useMutation({
    mutationFn: recoverRuntimeNow,
    onSuccess: () => {
      void controlQuery.refetch();
      void queryClient.invalidateQueries({ queryKey: ['runtimeStatus'] });
      void queryClient.invalidateQueries({ queryKey: ['xiaoni-action-stream'] });
    }
  });
  const heartbeatMutation = useMutation({
    mutationFn: triggerCacheHeartbeat,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['xiaoni-action-stream'] });
    }
  });
  const [energyForm, setEnergyForm] = React.useState<Record<string, string>>({});
  const energyMutation = useMutation({
    mutationFn: updateEnergyPolicy,
    onSuccess: (data) => {
      queryClient.setQueryData(['xiaoni-runtime-control'], data);
    }
  });
  const restoreFullMutation = useMutation({
    mutationFn: restoreFullEnergy,
    onSuccess: () => {
      void controlQuery.refetch();
      void queryClient.invalidateQueries({ queryKey: ['xiaoni-action-stream'] });
      void energyStateQuery.refetch();
    }
  });
  const [energySetInput, setEnergySetInput] = React.useState('');
  const energyStateQuery = useQuery({
    queryKey: ['xiaoni-energy-state'],
    queryFn: fetchEnergyState,
    refetchInterval: 5000
  });
  const setEnergyMutation = useMutation({
    mutationFn: setCurrentEnergy,
    onSuccess: () => {
      void controlQuery.refetch();
      void queryClient.invalidateQueries({ queryKey: ['xiaoni-action-stream'] });
      // Give agent-service a beat to refresh the projection, then re-read.
      window.setTimeout(() => { void energyStateQuery.refetch(); }, 1500);
    }
  });
  const [trackedCoveredEnd, setTrackedCoveredEnd] = React.useState<number | null>(null);
  const compressionMutation = useMutation({
    mutationFn: triggerCoreMemoryCompression,
    onSuccess: (data) => {
      const forkScheduled = typeof data.compressionCoveredEndConversationId === 'number'
        && (data.status === 'scheduled' || data.status === 'already_running' || data.status === 'already_running_durable');
      setTrackedCoveredEnd(forkScheduled ? (data.compressionCoveredEndConversationId as number) : null);
      void queryClient.invalidateQueries({ queryKey: ['xiaoni-action-stream'] });
    }
  });
  const compressionStatusQuery = useQuery({
    queryKey: ['xiaoni-compression-fork-status', trackedCoveredEnd],
    queryFn: () => fetchCompressionForkStatus(trackedCoveredEnd as number),
    enabled: trackedCoveredEnd !== null,
    refetchInterval: (query) => (query.state.data?.running === false ? false : 4000)
  });

  const control = controlQuery.data;
  const pendingPatch = mutation.isPending ? mutation.variables : null;
  const enabled = typeof pendingPatch?.enabled === 'boolean' ? pendingPatch.enabled : control?.enabled ?? true;
  const cacheHeartbeatPaused = typeof pendingPatch?.cacheHeartbeatPaused === 'boolean'
    ? pendingPatch.cacheHeartbeatPaused
    : control?.cacheHeartbeatPaused ?? false;
  const postCompressionPauseArmed = typeof pendingPatch?.postCompressionPauseArmed === 'boolean'
    ? pendingPatch.postCompressionPauseArmed
    : control?.postCompressionPauseArmed ?? false;
  const stripXiaoniOsFromRequests = typeof pendingPatch?.stripXiaoniOsFromRequests === 'boolean'
    ? pendingPatch.stripXiaoniOsFromRequests
    : control?.stripXiaoniOsFromRequests ?? false;
  const psychAssessmentGateEnabled = typeof pendingPatch?.psychAssessmentGateEnabled === 'boolean'
    ? pendingPatch.psychAssessmentGateEnabled
    : control?.psychAssessmentGateEnabled ?? false;
  const currentYieldMs = typeof pendingPatch?.mainAgentPreModelYieldMs === 'number'
    ? pendingPatch.mainAgentPreModelYieldMs
    : control?.mainAgentPreModelYieldMs ?? 5000;
  const currentDebugHeartbeatIntervalMs = typeof pendingPatch?.debugCacheHeartbeatIntervalMs === 'number'
    ? pendingPatch.debugCacheHeartbeatIntervalMs
    : control?.debugCacheHeartbeatIntervalMs ?? 0;
  const currentCompressionTriggerInputTokens = typeof pendingPatch?.compressionTriggerInputTokens === 'number'
    ? pendingPatch.compressionTriggerInputTokens
    : control?.compressionTriggerInputTokens ?? 80000;
  const currentCompressionTriggerWireBytes = typeof pendingPatch?.compressionTriggerWireBytes === 'number'
    ? pendingPatch.compressionTriggerWireBytes
    : control?.compressionTriggerWireBytes ?? 25165824;
  React.useEffect(() => {
    if (!mutation.isPending && typeof control?.mainAgentPreModelYieldMs === 'number') {
      setYieldInput(String(control.mainAgentPreModelYieldMs));
    }
  }, [control?.mainAgentPreModelYieldMs, mutation.isPending]);
  React.useEffect(() => {
    if (!mutation.isPending && typeof control?.debugCacheHeartbeatIntervalMs === 'number') {
      setDebugHeartbeatSecondsInput(String(Math.round(control.debugCacheHeartbeatIntervalMs / 1000)));
    }
  }, [control?.debugCacheHeartbeatIntervalMs, mutation.isPending]);
  React.useEffect(() => {
    if (!mutation.isPending && typeof control?.compressionTriggerInputTokens === 'number') {
      setCompressionTriggerInput(String(control.compressionTriggerInputTokens));
    }
  }, [control?.compressionTriggerInputTokens, mutation.isPending]);
  React.useEffect(() => {
    if (!mutation.isPending && typeof control?.compressionTriggerWireBytes === 'number') {
      setCompressionWireMiBInput(String(Math.round(control.compressionTriggerWireBytes / (1024 * 1024))));
    }
  }, [control?.compressionTriggerWireBytes, mutation.isPending]);
  const passiveRecallDeliveryEnabled = typeof pendingPatch?.passiveRecallDeliveryEnabled === 'boolean'
    ? pendingPatch.passiveRecallDeliveryEnabled
    : control?.passiveRecallDeliveryEnabled ?? false;
  const currentRecallDeliveryDailyCap = typeof pendingPatch?.passiveRecallDeliveryDailyCap === 'number'
    ? pendingPatch.passiveRecallDeliveryDailyCap
    : control?.passiveRecallDeliveryDailyCap ?? 25;
  React.useEffect(() => {
    if (!mutation.isPending && typeof control?.passiveRecallDeliveryDailyCap === 'number') {
      setRecallDeliveryCapInput(String(control.passiveRecallDeliveryDailyCap));
    }
  }, [control?.passiveRecallDeliveryDailyCap, mutation.isPending]);
  const parsedRecallDeliveryCap = /^\d+$/.test(recallDeliveryCapInput.trim())
    ? Number.parseInt(recallDeliveryCapInput.trim(), 10)
    : null;
  // 后端是 non-negative 整数(0 = 等同关闭),这里同界。
  const recallDeliveryCapValid = parsedRecallDeliveryCap !== null && Number.isSafeInteger(parsedRecallDeliveryCap);
  const recallDeliveryCapDirty = recallDeliveryCapValid && parsedRecallDeliveryCap !== currentRecallDeliveryDailyCap;
  const handleRecallDeliveryCapSubmit = React.useCallback((event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!recallDeliveryCapValid || parsedRecallDeliveryCap === null) {
      return;
    }
    mutation.mutate({ passiveRecallDeliveryDailyCap: parsedRecallDeliveryCap });
  }, [mutation, parsedRecallDeliveryCap, recallDeliveryCapValid]);
  const parsedYieldMs = /^\d+$/.test(yieldInput.trim())
    ? Number.parseInt(yieldInput.trim(), 10)
    : null;
  const yieldInputValid = parsedYieldMs !== null && Number.isSafeInteger(parsedYieldMs);
  const yieldInputDirty = yieldInputValid && parsedYieldMs !== currentYieldMs;
  const updatedAt = control?.updatedAt ? formatTimestamp(control.updatedAt, { fallback: control.updatedAt }) : '默认开启';
  const cacheHeartbeatPausedAt = control?.cacheHeartbeatPausedAt
    ? formatTimestamp(control.cacheHeartbeatPausedAt, { fallback: control.cacheHeartbeatPausedAt })
    : '未暂停';
  const armedAt = control?.postCompressionPauseArmedAt
    ? formatTimestamp(control.postCompressionPauseArmedAt, { fallback: control.postCompressionPauseArmedAt })
    : '未设置';
  const triggeredAt = control?.postCompressionPauseTriggeredAt
    ? formatTimestamp(control.postCompressionPauseTriggeredAt, { fallback: control.postCompressionPauseTriggeredAt })
    : '尚未触发';
  const runtimeStatusLabel = !enabled
    ? '已暂停'
    : postCompressionPauseArmed ? '运行中 · 已设闸' : '运行中';
  const handleYieldSubmit = React.useCallback((event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!yieldInputValid || parsedYieldMs === null) {
      return;
    }
    mutation.mutate({ mainAgentPreModelYieldMs: parsedYieldMs });
  }, [mutation, parsedYieldMs, yieldInputValid]);
  const parsedDebugHeartbeatSeconds = /^\d+$/.test(debugHeartbeatSecondsInput.trim())
    ? Number.parseInt(debugHeartbeatSecondsInput.trim(), 10)
    : null;
  // 0 disables; below the ~10s supervisor tick is meaningless, so require >= 10s when on.
  const debugHeartbeatInputValid = parsedDebugHeartbeatSeconds !== null
    && Number.isSafeInteger(parsedDebugHeartbeatSeconds)
    && (parsedDebugHeartbeatSeconds === 0 || parsedDebugHeartbeatSeconds >= 10);
  const targetDebugHeartbeatMs = parsedDebugHeartbeatSeconds === null ? null : parsedDebugHeartbeatSeconds * 1000;
  const debugHeartbeatInputDirty = debugHeartbeatInputValid && targetDebugHeartbeatMs !== currentDebugHeartbeatIntervalMs;
  const handleDebugHeartbeatSubmit = React.useCallback((event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!debugHeartbeatInputValid || targetDebugHeartbeatMs === null) {
      return;
    }
    mutation.mutate({ debugCacheHeartbeatIntervalMs: targetDebugHeartbeatMs });
  }, [mutation, debugHeartbeatInputValid, targetDebugHeartbeatMs]);
  const parsedCompressionTrigger = /^\d+$/.test(compressionTriggerInput.trim())
    ? Number.parseInt(compressionTriggerInput.trim(), 10)
    : null;
  // Mirror the backend bounds (10000..1000000).
  const compressionTriggerInputValid = parsedCompressionTrigger !== null
    && Number.isSafeInteger(parsedCompressionTrigger)
    && parsedCompressionTrigger >= 10000
    && parsedCompressionTrigger <= 1000000;
  const compressionTriggerInputDirty = compressionTriggerInputValid
    && parsedCompressionTrigger !== currentCompressionTriggerInputTokens;
  const handleCompressionTriggerSubmit = React.useCallback((event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!compressionTriggerInputValid || parsedCompressionTrigger === null) {
      return;
    }
    mutation.mutate({ compressionTriggerInputTokens: parsedCompressionTrigger });
  }, [mutation, compressionTriggerInputValid, parsedCompressionTrigger]);
  const parsedCompressionWireMiB = /^\d+$/.test(compressionWireMiBInput.trim())
    ? Number.parseInt(compressionWireMiBInput.trim(), 10)
    : null;
  // Input is MiB for readability; store bytes. Mirror the backend bounds (1..30 MiB).
  const compressionWireInputValid = parsedCompressionWireMiB !== null
    && Number.isSafeInteger(parsedCompressionWireMiB)
    && parsedCompressionWireMiB >= 1
    && parsedCompressionWireMiB <= 30;
  const targetCompressionWireBytes = parsedCompressionWireMiB === null ? null : parsedCompressionWireMiB * 1024 * 1024;
  const compressionWireInputDirty = compressionWireInputValid
    && targetCompressionWireBytes !== currentCompressionTriggerWireBytes;
  const handleCompressionWireSubmit = React.useCallback((event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!compressionWireInputValid || targetCompressionWireBytes === null) {
      return;
    }
    mutation.mutate({ compressionTriggerWireBytes: targetCompressionWireBytes });
  }, [mutation, compressionWireInputValid, targetCompressionWireBytes]);

  const energyDefaults = control?.energyPolicyDefaults ?? ENERGY_POLICY_FALLBACK_DEFAULTS;
  const energyOverrides = control?.energyPolicy ?? null;
  React.useEffect(() => {
    if (energyMutation.isPending) {
      return;
    }
    const next: Record<string, string> = {};
    for (const spec of ENERGY_POLICY_FIELDS) {
      const override = energyOverrides ? energyOverrides[spec.key] : undefined;
      next[spec.key] = override === undefined || override === null ? '' : String(override);
    }
    setEnergyForm(next);
  }, [energyOverrides, energyMutation.isPending]);
  const buildEnergyOverridesFromForm = React.useCallback((): { overrides: Record<string, number>; error: string | null } => {
    const overrides: Record<string, number> = {};
    for (const spec of ENERGY_POLICY_FIELDS) {
      const raw = (energyForm[spec.key] ?? '').trim();
      if (raw === '') {
        continue; // empty → falls back to default
      }
      const numeric = Number(raw);
      if (!Number.isFinite(numeric) || numeric < spec.min || numeric > spec.max) {
        return { overrides, error: `${spec.label} 必须在 ${spec.min} 到 ${spec.max} 之间` };
      }
      overrides[spec.key] = numeric;
    }
    return { overrides, error: null };
  }, [energyForm]);
  const energyFormError = buildEnergyOverridesFromForm().error;
  const handleEnergySave = React.useCallback((event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const { overrides, error } = buildEnergyOverridesFromForm();
    if (error) {
      return;
    }
    energyMutation.mutate({ energyPolicy: Object.keys(overrides).length > 0 ? overrides : null });
  }, [buildEnergyOverridesFromForm, energyMutation]);
  const applyEnergyPreset = React.useCallback((preset: Record<string, number> | null) => {
    if (preset === null) {
      energyMutation.mutate({ energyPolicy: null, reset: true });
      return;
    }
    energyMutation.mutate({ energyPolicy: preset });
  }, [energyMutation]);
  const parsedSetEnergy = energySetInput.trim() === '' ? null : Number(energySetInput.trim());
  const setEnergyValid = parsedSetEnergy !== null && Number.isFinite(parsedSetEnergy) && parsedSetEnergy >= 0 && parsedSetEnergy <= 1;
  const handleSetEnergySubmit = React.useCallback((event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!setEnergyValid || parsedSetEnergy === null) {
      return;
    }
    setEnergyMutation.mutate({ energy: parsedSetEnergy });
  }, [setEnergyValid, parsedSetEnergy, setEnergyMutation]);
  const applyEnergyLevel = React.useCallback((energy: number) => {
    setEnergySetInput(String(energy));
    setEnergyMutation.mutate({ energy });
  }, [setEnergyMutation]);
  const energyState = energyStateQuery.data;
  const formatMeter = (value: number | null | undefined) => (typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '—');

  return (
    <PageShell className="max-w-4xl">
      <PageHeader
        eyebrow="Runtime Settings"
        title="小腻运行配置"
        description="控制小腻主循环是否继续消费队列和调用模型。"
        icon={<Power className="h-5 w-5" />}
        badge={<StatusPill tone={enabled ? 'success' : 'warning'}>{runtimeStatusLabel}</StatusPill>}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="default"
              size="sm"
              onClick={() => restoreFullMutation.mutate()}
              disabled={restoreFullMutation.isPending}
            >
              {restoreFullMutation.isPending
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <BatteryFull className="mr-2 h-4 w-4" />}
              立即恢复满
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => recoverMutation.mutate()}
              disabled={recoverMutation.isPending}
            >
              {recoverMutation.isPending
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <HeartPulse className="mr-2 h-4 w-4" />}
              手动恢复
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => compressionMutation.mutate()}
              disabled={compressionMutation.isPending}
            >
              {compressionMutation.isPending
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <Shrink className="mr-2 h-4 w-4" />}
              立即压缩记忆
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => forceLoadMutation.mutate()}
              disabled={forceLoadMutation.isPending}
            >
              {forceLoadMutation.isPending
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <RefreshCw className="mr-2 h-4 w-4" />}
              强制加载
            </Button>
            <Button variant="outline" size="sm" onClick={() => void controlQuery.refetch()} disabled={controlQuery.isFetching}>
              <RefreshCw className={controlQuery.isFetching ? 'mr-2 h-4 w-4 animate-spin' : 'mr-2 h-4 w-4'} />
              刷新
            </Button>
          </div>
        }
      />

      {controlQuery.error ? (
        <ErrorState
          description={controlQuery.error instanceof Error ? controlQuery.error.message : '加载运行配置失败'}
          onRetry={() => void controlQuery.refetch()}
        />
      ) : null}

      {forceLoadMutation.error ? (
        <ErrorState
          description={forceLoadMutation.error instanceof Error ? forceLoadMutation.error.message : '强制加载运行 prompt 失败'}
          onRetry={() => forceLoadMutation.mutate()}
        />
      ) : null}

      {recoverMutation.error ? (
        <ErrorState
          description={recoverMutation.error instanceof Error ? recoverMutation.error.message : '手动恢复小腻失败'}
          onRetry={() => recoverMutation.mutate()}
        />
      ) : null}

      {recoverMutation.data ? (
        <SectionPanel
          title="手动恢复已触发"
          description="已把最新未读 QQ inbox 转成 phone_notification 门铃，agent-service 会按主循环正常 claim。"
          icon={<HeartPulse className="h-4 w-4 text-primary" />}
        >
          <div className="grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <div className="text-xs text-muted-foreground">Queue</div>
              <div className="font-medium text-foreground">
                #{recoverMutation.data.queue?.queueId ?? 'unknown'} · {recoverMutation.data.queue?.status ?? 'pending'}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Inbox</div>
              <div className="font-medium text-foreground">
                #{recoverMutation.data.sourceInboundMessage?.id ?? 'unknown'}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Session</div>
              <div className="font-medium text-foreground">
                {recoverMutation.data.sourceInboundMessage?.sessionKey ?? 'unknown'}
              </div>
            </div>
          </div>
        </SectionPanel>
      ) : null}

      {compressionMutation.error ? (
        <ErrorState
          description={compressionMutation.error instanceof Error ? compressionMutation.error.message : '触发核心记忆压缩失败'}
          onRetry={() => compressionMutation.mutate()}
        />
      ) : null}

      {heartbeatMutation.error ? (
        <ErrorState
          description={heartbeatMutation.error instanceof Error ? heartbeatMutation.error.message : '触发 cache heartbeat 失败'}
          onRetry={() => heartbeatMutation.mutate()}
        />
      ) : null}

      {compressionMutation.data ? (
        <SectionPanel
          title="核心记忆压缩"
          description="主动触发：把最近 30 轮之前的历史压进 xiaoni_近况 并推进 read cutoff。常用于上线打穿前缀缓存的改动前，提前压一次以省一次缓存重建。fork 在后台运行，可能 >5 分钟。"
          icon={<Shrink className="h-4 w-4 text-primary" />}
        >
          <div className="grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <div className="text-xs text-muted-foreground">结果</div>
              <div className="font-medium text-foreground">
                {COMPRESSION_STATUS_LABELS[compressionMutation.data.status] ?? compressionMutation.data.status}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">压缩覆盖至 conversation</div>
              <div className="font-medium text-foreground">
                {compressionMutation.data.compressionCoveredEndConversationId ?? '—'}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">新 read cutoff</div>
              <div className="font-medium text-foreground">
                {compressionMutation.data.readCutoffAfterConversationId ?? '—'}
              </div>
            </div>
          </div>
          {trackedCoveredEnd !== null ? (
            <div className="mt-4 flex items-center gap-2 text-sm">
              {compressionStatusQuery.data?.running === false ? (
                <StatusPill tone="success">fork 已结束</StatusPill>
              ) : (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  <StatusPill tone="warning">fork 运行中</StatusPill>
                </>
              )}
              <span className="text-xs text-muted-foreground">
                fork run: {compressionStatusQuery.data?.forkRunId ?? compressionMutation.data.runId ?? '—'}
              </span>
            </div>
          ) : null}
        </SectionPanel>
      ) : null}

      <SectionPanel
        title="主循环"
        description="关闭后 agent-service 不再 claim 队列，不再发起新的模型请求；再次打开后继续从队列恢复。"
        icon={<Bot className="h-4 w-4 text-primary" />}
      >
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <div className="text-sm font-medium text-foreground">小腻运行循环</div>
            <div className="text-sm text-muted-foreground">
              {enabled ? '开启时会持续处理小腻 runtime 队列。' : '关闭时只保留服务健康检查和配置 API。'}
            </div>
            <div className="text-xs text-muted-foreground">最后更新：{updatedAt}</div>
          </div>
          <div className="flex items-center gap-3">
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
            <Switch
              checked={enabled}
              disabled={controlQuery.isLoading || mutation.isPending}
              onCheckedChange={(checked) => mutation.mutate({ enabled: Boolean(checked) })}
              aria-label="小腻运行循环"
            />
          </div>
        </div>
      </SectionPanel>

      {restoreFullMutation.error ? (
        <ErrorState
          description={restoreFullMutation.error instanceof Error ? restoreFullMutation.error.message : '恢复满精力失败'}
          onRetry={() => restoreFullMutation.mutate()}
        />
      ) : null}
      {energyMutation.error ? (
        <ErrorState
          description={energyMutation.error instanceof Error ? energyMutation.error.message : '更新精力策略失败'}
          onRetry={handleEnergySave as unknown as () => void}
        />
      ) : null}
      {setEnergyMutation.error ? (
        <ErrorState
          description={setEnergyMutation.error instanceof Error ? setEnergyMutation.error.message : '设定当前精力失败'}
          onRetry={() => energyStateQuery.refetch()}
        />
      ) : null}

      <SectionPanel
        title="当前精力 / 压力（立即设定）"
        description="直接改写小腻此刻的精力与疲劳压力（写入一条 manual_energy_override life 事件），下一次投影刷新（≤数秒）后生效。压力 = 1 − 精力（总疲劳）；压力 ≥ 自愿入睡门槛她才睡得着。运行时内部状态，不进入模型请求前缀，零缓存影响。"
        icon={<HeartPulse className="h-4 w-4 text-primary" />}
      >
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: '当前精力', value: formatMeter(energyState?.energy) },
            { label: '总压力', value: formatMeter(energyState?.pressure) },
            { label: '自然疲劳', value: formatMeter(energyState?.homeostaticPressure) },
            { label: '行动透支', value: formatMeter(energyState?.actionDebt) }
          ].map((tile) => (
            <div key={tile.label} className="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
              <div className="text-xs text-muted-foreground">{tile.label}</div>
              <div className="text-lg font-semibold tabular-nums text-foreground">{tile.value}</div>
            </div>
          ))}
        </div>
        <div className="mb-4 text-xs text-muted-foreground">
          自愿入睡门槛：<span className="font-medium text-foreground">{formatMeter(energyState?.sleepOnsetThreshold)}</span>
          {' · '}强制入睡压力：<span className="font-medium text-foreground">{formatMeter(energyState?.forcedSleepPressure)}</span>
          {energyState ? (
            <span className={energyState.canSleepApprox ? 'ml-2 text-emerald-600 dark:text-emerald-400' : 'ml-2 text-amber-600 dark:text-amber-400'}>
              {energyState.canSleepApprox ? '· 当前压力已过门槛，可入睡' : '· 当前压力低于门槛，睡不着'}
            </span>
          ) : null}
          {energyState?.projectionUpdatedAt ? (
            <span className="ml-2">· 投影更新：{formatTimestamp(energyState.projectionUpdatedAt, { fallback: energyState.projectionUpdatedAt })}</span>
          ) : null}
        </div>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Button variant="default" size="sm" onClick={() => applyEnergyLevel(0.05)} disabled={setEnergyMutation.isPending}>
            {setEnergyMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <TimerReset className="mr-2 h-4 w-4" />}
            让她能睡（精力 0.05）
          </Button>
          <Button variant="outline" size="sm" onClick={() => applyEnergyLevel(0.4)} disabled={setEnergyMutation.isPending}>
            半困（0.40）
          </Button>
          <Button variant="outline" size="sm" onClick={() => applyEnergyLevel(0.85)} disabled={setEnergyMutation.isPending}>
            清醒（0.85）
          </Button>
        </div>
        <form onSubmit={handleSetEnergySubmit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="space-y-1.5">
            <div className="text-sm font-medium text-foreground">设定当前精力（0–1）</div>
            <Input
              type="number"
              step={0.05}
              min={0}
              max={1}
              inputMode="decimal"
              placeholder="例如 0.1"
              value={energySetInput}
              disabled={setEnergyMutation.isPending}
              onChange={(event) => setEnergySetInput(event.target.value)}
              aria-label="设定当前精力"
              className="w-40"
            />
            <div className="text-xs text-muted-foreground">
              {parsedSetEnergy !== null && setEnergyValid
                ? `→ 压力 ${(1 - parsedSetEnergy).toFixed(2)}`
                : '压力 = 1 − 精力'}
            </div>
          </div>
          <Button type="submit" size="sm" disabled={setEnergyMutation.isPending || !setEnergyValid}>
            {setEnergyMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            设定
          </Button>
        </form>
        {setEnergyMutation.data ? (
          <div className="mt-4 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            {setEnergyMutation.data.note}
            {setEnergyMutation.data.eventId ? ` · 事件 #${setEnergyMutation.data.eventId}` : ''}
            {typeof setEnergyMutation.data.target.energy === 'number'
              ? ` · 目标精力 ${setEnergyMutation.data.target.energy.toFixed(2)}${setEnergyMutation.data.target.exact ? '' : '（近似）'}`
              : ''}
          </div>
        ) : null}
      </SectionPanel>

      <SectionPanel
        title="精力策略"
        description="调节小腻精力的消耗与恢复曲线。热加载下发：保存后 agent-service 会在数秒内自动生效，无需重启。精力是运行时内部状态，不进入模型请求前缀，改动对 prompt 缓存零影响。"
        icon={<Gauge className="h-4 w-4 text-primary" />}
      >
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => applyEnergyPreset(null)}
            disabled={energyMutation.isPending}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            正常（默认曲线）
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => applyEnergyPreset(ENERGY_POLICY_FLAT_PRESET)}
            disabled={energyMutation.isPending}
          >
            <Zap className="mr-2 h-4 w-4" />
            极缓（几乎不下滑）
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={() => restoreFullMutation.mutate()}
            disabled={restoreFullMutation.isPending}
          >
            {restoreFullMutation.isPending
              ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              : <BatteryFull className="mr-2 h-4 w-4" />}
            立即恢复满
          </Button>
          {energyMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
          <span className="text-xs text-muted-foreground">
            {energyOverrides && Object.keys(energyOverrides).length > 0 ? '当前：自定义覆盖生效中' : '当前：全部使用默认'}
          </span>
        </div>
        {restoreFullMutation.data ? (
          <div className="mb-4 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            {restoreFullMutation.data.note}
            {restoreFullMutation.data.finalizedSessionId ? ` · 结束恢复会话 #${restoreFullMutation.data.finalizedSessionId}` : ''}
            {restoreFullMutation.data.resetEventId ? ` · 复位事件 #${restoreFullMutation.data.resetEventId}` : ''}
          </div>
        ) : null}
        <form onSubmit={handleEnergySave} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {ENERGY_POLICY_FIELDS.map((spec) => (
              <div key={spec.key} className="space-y-1.5">
                <div className="text-sm font-medium text-foreground">{spec.label}</div>
                <Input
                  type="number"
                  step={spec.step}
                  min={spec.min}
                  max={spec.max}
                  inputMode="decimal"
                  placeholder={`默认 ${energyDefaults[spec.key] ?? ENERGY_POLICY_FALLBACK_DEFAULTS[spec.key]}`}
                  value={energyForm[spec.key] ?? ''}
                  disabled={controlQuery.isLoading || energyMutation.isPending}
                  onChange={(event) => setEnergyForm((prev) => ({ ...prev, [spec.key]: event.target.value }))}
                  aria-label={spec.label}
                />
                <div className="text-xs text-muted-foreground">{spec.hint}（留空=默认）</div>
              </div>
            ))}
          </div>
          {energyFormError ? (
            <div className="text-xs text-destructive">{energyFormError}</div>
          ) : null}
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={controlQuery.isLoading || energyMutation.isPending || Boolean(energyFormError)}>
              {energyMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              保存精力策略
            </Button>
          </div>
        </form>
      </SectionPanel>

      <SectionPanel
        title="主模型 Yield"
        description="主 agent 每次发起模型 slice 前的等待时间。"
        icon={<TimerReset className="h-4 w-4 text-primary" />}
      >
        <form className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between" onSubmit={handleYieldSubmit}>
          <div className="space-y-2">
            <div className="text-sm font-medium text-foreground">模型前等待</div>
            <div className="text-sm text-muted-foreground">当前值：{currentYieldMs} ms</div>
            <div className="text-xs text-muted-foreground">单位：毫秒</div>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-56">
            <Input
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={yieldInput}
              disabled={controlQuery.isLoading || mutation.isPending}
              onChange={(event) => setYieldInput(event.target.value)}
              aria-label="模型前等待毫秒"
            />
            <Button
              type="submit"
              size="sm"
              disabled={controlQuery.isLoading || mutation.isPending || !yieldInputValid || !yieldInputDirty}
            >
              {mutation.isPending && typeof pendingPatch?.mainAgentPreModelYieldMs === 'number'
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : null}
              保存
            </Button>
          </div>
        </form>
      </SectionPanel>

      <SectionPanel
        title="压缩触发阈值"
        description="小腻的核心记忆压缩触发线：当模型返回的真实 input_tokens 连续若干轮超过该值时，后台压缩 fork 会启动。仅影响压缩时机，不进入可缓存请求前缀；改后无需重启，下一轮主循环即生效。"
        icon={<Shrink className="h-4 w-4 text-primary" />}
      >
        <form className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between" onSubmit={handleCompressionTriggerSubmit}>
          <div className="space-y-2">
            <div className="text-sm font-medium text-foreground">压缩触发阈值 (input tokens)</div>
            <div className="text-sm text-muted-foreground">当前值：{currentCompressionTriggerInputTokens.toLocaleString()} tokens</div>
            <div className="text-xs text-muted-foreground">范围：10000 – 1000000；默认 80000。</div>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-56">
            <Input
              type="number"
              min={10000}
              max={1000000}
              step={1000}
              inputMode="numeric"
              value={compressionTriggerInput}
              disabled={controlQuery.isLoading || mutation.isPending}
              onChange={(event) => setCompressionTriggerInput(event.target.value)}
              aria-label="压缩触发阈值 input tokens"
            />
            <Button
              type="submit"
              size="sm"
              disabled={controlQuery.isLoading || mutation.isPending || !compressionTriggerInputValid || !compressionTriggerInputDirty}
            >
              {mutation.isPending && typeof pendingPatch?.compressionTriggerInputTokens === 'number'
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : null}
              保存
            </Button>
          </div>
        </form>
      </SectionPanel>

      <SectionPanel
        title="压缩触发阈值（字节）"
        description="图片字节压缩触发线：图片 token 便宜但字节巨大，token 触发线对图密集的 run 是盲区。当组装的请求 wire 字节连续若干轮超过该软线时，后台压缩 fork 也会启动，把老图折叠出读取窗口，避免撞 Anthropic 32MB 单请求硬上限。硬停机线 = 软线 + 6 MiB：超硬线会在发送前 halt 停机（关行动开关、保 heartbeat 温暖）等人工压缩/恢复。仅影响压缩时机，不进可缓存前缀；改后无需重启。"
        icon={<Shrink className="h-4 w-4 text-primary" />}
      >
        <form className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between" onSubmit={handleCompressionWireSubmit}>
          <div className="space-y-2">
            <div className="text-sm font-medium text-foreground">压缩触发软线 (MiB)</div>
            <div className="text-sm text-muted-foreground">当前值：{(currentCompressionTriggerWireBytes / (1024 * 1024)).toFixed(0)} MiB（{currentCompressionTriggerWireBytes.toLocaleString()} 字节）</div>
            <div className="text-xs text-muted-foreground">范围：1 – 30 MiB；默认 24 MiB。硬停机线 = 软线 + 6 MiB，建议软线 ≤ 26 MiB。</div>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-56">
            <Input
              type="number"
              min={1}
              max={30}
              step={1}
              inputMode="numeric"
              value={compressionWireMiBInput}
              disabled={controlQuery.isLoading || mutation.isPending}
              onChange={(event) => setCompressionWireMiBInput(event.target.value)}
              aria-label="压缩触发软线 MiB"
            />
            <Button
              type="submit"
              size="sm"
              disabled={controlQuery.isLoading || mutation.isPending || !compressionWireInputValid || !compressionWireInputDirty}
            >
              {mutation.isPending && typeof pendingPatch?.compressionTriggerWireBytes === 'number'
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : null}
              保存
            </Button>
          </div>
        </form>
      </SectionPanel>

      <SectionPanel
        title="睡眠 heartbeat"
        description="暂停后，小腻睡眠恢复期间不会自动发送 provider cache heartbeat；手动调试入口仍可用。"
        icon={<HeartPulse className="h-4 w-4 text-primary" />}
      >
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <div className="text-sm font-medium text-foreground">暂停睡眠保温 heartbeat</div>
            <div className="text-sm text-muted-foreground">
              {cacheHeartbeatPaused
                ? '已暂停，睡眠中不会按 5 分钟节奏自动续约 prompt cache。'
                : '开启自动 heartbeat，睡眠中会按恢复会话 schedule 保温。'}
            </div>
            <div className="text-xs text-muted-foreground">暂停时间：{cacheHeartbeatPausedAt}</div>
          </div>
          <div className="flex items-center gap-3">
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
            <Switch
              checked={cacheHeartbeatPaused}
              disabled={controlQuery.isLoading || mutation.isPending}
              onCheckedChange={(checked) => mutation.mutate({ cacheHeartbeatPaused: Boolean(checked) })}
              aria-label="暂停睡眠保温 heartbeat"
            />
          </div>
        </div>
      </SectionPanel>

      <SectionPanel
        title="xiaoni_os 请求隔离"
        description="打开后，回灌给模型的请求里会清空 xiaoni_os（工具调用参数、工具结果回显，以及睡醒提醒里的睡前备注）；小腻本人读不到自己写的 os 备注，但备注照常持久化（含 recovery session），管理端照常可见，只作运维观察。"
        icon={<EyeOff className="h-4 w-4 text-primary" />}
      >
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <div className="text-sm font-medium text-foreground">从模型请求中隔离 xiaoni_os</div>
            <div className="text-sm text-muted-foreground">
              {stripXiaoniOsFromRequests
                ? '已隔离：新产生的工具 os 备注会被冻结标记，之后回放/请求里一律不回灌给模型。'
                : '未隔离：和现在一样，os 备注会随工具调用回灌回她的上下文。'}
            </div>
            <div className="text-xs text-muted-foreground">
              历史按发出时的开关状态冻结，拨开关只影响之后新产生的内容，不改写历史、不击穿前缀缓存。
            </div>
          </div>
          <div className="flex items-center gap-3">
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
            <Switch
              checked={stripXiaoniOsFromRequests}
              disabled={controlQuery.isLoading || mutation.isPending}
              onCheckedChange={(checked) => mutation.mutate({ stripXiaoniOsFromRequests: Boolean(checked) })}
              aria-label="从模型请求中隔离 xiaoni_os"
            />
          </div>
        </div>
      </SectionPanel>

      <SectionPanel
        title="心理评估门控"
        description="打开后，小腻每产出一段 assistant 文本（她的 xiaoni_os OS 通道），都会同步跑一个心理评估 fork 判 KEEP/EVICT；判为消极/怠工/摸鱼的那一 turn，其 xiaoni_os 不会进入下一次上下文（防污染，fail-closed）。fork 骑主热前缀，判定与请求全量落 psych_assessment_fork_slices，管理端可见。"
        icon={<Brain className="h-4 w-4 text-primary" />}
      >
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <div className="text-sm font-medium text-foreground">对 assistant 文本跑心理评估门控</div>
            <div className="text-sm text-muted-foreground">
              {psychAssessmentGateEnabled
                ? '已开启：每次文本产出跑心理评估 fork，消极的那一 turn 的 xiaoni_os 不进下一上下文。'
                : '已关闭：不跑心理评估 fork，文本产出的 xiaoni_os 照常进入下一上下文（当前默认）。'}
            </div>
            <div className="text-xs text-muted-foreground">
              开启会给每个有文本产出的 turn 加一次同步 fork 请求（多一份 cache_read 计费）；翻 ON 前建议先在活动流确认 fork 的 cache_read 暖读正常。历史按发出时的开关状态冻结，不改写历史、不击穿前缀缓存。
            </div>
          </div>
          <div className="flex items-center gap-3">
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
            <Switch
              checked={psychAssessmentGateEnabled}
              disabled={controlQuery.isLoading || mutation.isPending}
              onCheckedChange={(checked) => mutation.mutate({ psychAssessmentGateEnabled: Boolean(checked) })}
              aria-label="对 assistant 文本跑心理评估门控"
            />
          </div>
        </div>
      </SectionPanel>

      <SectionPanel
        title="被动浮现投递"
        description="打开后，小腻的两条召回腿（还没了的事 / 旧事重提）会把翻出来的记忆经 Notify Bucket 投给她；在此之前整条召回链只写 shadow 日志、不投递。agent-service 每 10 分钟一拍现读本开关，翻开关无需重启。"
        icon={<Sparkles className="h-4 w-4 text-primary" />}
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-2">
              <div className="text-sm font-medium text-foreground">把召回的记忆投给她</div>
              <div className="text-sm text-muted-foreground">
                {passiveRecallDeliveryEnabled
                  ? '已开启：open_loop / association 两条腿的 lead 会作为 system_reminder 进 Notify Bucket（会唤醒主循环）。'
                  : '已关闭：召回照常跑、照常写 shadow 日志，但一条都不投给她（当前默认）。'}
              </div>
              <div className="text-xs text-muted-foreground">
                同一段记忆永远只投一次（dedupe 锚在记忆本身的 ref 上），每拍最多 1 条。首发只放这两条腿是因为它们在 shadow 里的唯一率最高（100% / 77%）；其余腿唯一率低（最低 1.5%），投了等于复读。
              </div>
            </div>
            <div className="flex items-center gap-3">
              {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
              <Switch
                checked={passiveRecallDeliveryEnabled}
                disabled={controlQuery.isLoading || mutation.isPending}
                onCheckedChange={(checked) => mutation.mutate({ passiveRecallDeliveryEnabled: Boolean(checked) })}
                aria-label="把召回的记忆投给她"
              />
            </div>
          </div>
          <form className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between" onSubmit={handleRecallDeliveryCapSubmit}>
            <div className="space-y-1">
              <div className="text-sm font-medium text-foreground">每日兜底上限</div>
              <div className="text-sm text-muted-foreground">
                当前：{currentRecallDeliveryDailyCap} 条 / 东八区自然日。
              </div>
              <div className="text-xs text-muted-foreground">
                这不是节奏旋钮。决定投不投的是判官（Haiku），它可以说「一条都不值得」，而且多数时候就该这么说；这个数只在判官失灵、把量放飞时拦一下，拦到了会打 warn 日志——那是异常信号，该去查而不是调这个数。0 = 等同关闭。
              </div>
            </div>
            <div className="flex w-full flex-col gap-2 sm:w-56">
              <Input
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={recallDeliveryCapInput}
                disabled={controlQuery.isLoading || mutation.isPending}
                onChange={(event) => setRecallDeliveryCapInput(event.target.value)}
                aria-label="被动浮现投递每日上限"
              />
              <Button
                type="submit"
                size="sm"
                disabled={controlQuery.isLoading || mutation.isPending || !recallDeliveryCapValid || !recallDeliveryCapDirty}
              >
                {mutation.isPending && typeof pendingPatch?.passiveRecallDeliveryDailyCap === 'number'
                  ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  : null}
                保存
              </Button>
            </div>
          </form>
        </div>
      </SectionPanel>

      <SectionPanel
        title="调试保温 heartbeat"
        description="停机 debug 期间手动保温 provider prompt cache。一次性按钮立刻打一发；设定间隔后由 agent-service 独立定时器周期触发，不受主循环开关和上面的睡眠暂停影响（0 = 关闭）。"
        icon={<HeartPulse className="h-4 w-4 text-primary" />}
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <div className="text-sm font-medium text-foreground">立即执行一次</div>
              <div className="text-sm text-muted-foreground">绕过停机/暂停闸，立刻发起一次 cache heartbeat（需等待一轮模型返回）。</div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => heartbeatMutation.mutate()}
              disabled={heartbeatMutation.isPending}
            >
              {heartbeatMutation.isPending
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <HeartPulse className="mr-2 h-4 w-4" />}
              立即执行一次 heartbeat
            </Button>
          </div>

          {heartbeatMutation.data ? (
            <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              最近一次：{heartbeatMutation.data.triggered === false
                ? `未触发（${heartbeatMutation.data.reason ?? 'unknown'}）`
                : '已完成'}
              {typeof heartbeatMutation.data.cachedInputTokens === 'number' ? ` · cache_read ${heartbeatMutation.data.cachedInputTokens}` : ''}
              {heartbeatMutation.data.runId ? ` · run ${heartbeatMutation.data.runId}` : ''}
            </div>
          ) : null}

          <form
            className="flex flex-col gap-3 border-t border-border/50 pt-4 sm:flex-row sm:items-center sm:justify-between"
            onSubmit={handleDebugHeartbeatSubmit}
          >
            <div className="space-y-1">
              <div className="text-sm font-medium text-foreground">周期触发间隔</div>
              <div className="text-sm text-muted-foreground">
                {currentDebugHeartbeatIntervalMs > 0
                  ? `当前：每 ${Math.round(currentDebugHeartbeatIntervalMs / 1000)} 秒自动保温一次（停机也生效）。`
                  : '当前：已关闭（仅靠一次性按钮）。'}
              </div>
              <div className="text-xs text-muted-foreground">单位：秒；0 = 关闭；调度精度约 10 秒，建议 ≥ 60 秒。</div>
            </div>
            <div className="flex w-full flex-col gap-2 sm:w-56">
              <Input
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={debugHeartbeatSecondsInput}
                disabled={controlQuery.isLoading || mutation.isPending}
                onChange={(event) => setDebugHeartbeatSecondsInput(event.target.value)}
                aria-label="调试保温 heartbeat 间隔秒数"
              />
              <Button
                type="submit"
                size="sm"
                disabled={controlQuery.isLoading || mutation.isPending || !debugHeartbeatInputValid || !debugHeartbeatInputDirty}
              >
                {mutation.isPending && typeof pendingPatch?.debugCacheHeartbeatIntervalMs === 'number'
                  ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  : null}
                保存
              </Button>
            </div>
          </form>
        </div>
      </SectionPanel>

      <SectionPanel
        title="切换闸门"
        description="打开后小腻会继续运行；下一次 Compress Memory 成功写入后，自动暂停主循环。"
        icon={<TimerReset className="h-4 w-4 text-primary" />}
      >
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <div className="text-sm font-medium text-foreground">下次压缩后暂停</div>
            <div className="text-sm text-muted-foreground">
              {postCompressionPauseArmed
                ? enabled ? '已设闸，等待下一次核心记忆压缩完成。' : '已设闸；恢复运行后等待下一次核心记忆压缩完成。'
                : '关闭时不会在压缩后自动暂停。'}
            </div>
            <div className="flex flex-col gap-1 text-xs text-muted-foreground sm:flex-row sm:gap-4">
              <span>设闸时间：{armedAt}</span>
              <span>触发时间：{triggeredAt}</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
            <Switch
              checked={postCompressionPauseArmed}
              disabled={controlQuery.isLoading || mutation.isPending}
              onCheckedChange={(checked) => mutation.mutate({ postCompressionPauseArmed: Boolean(checked) })}
              aria-label="下次压缩后暂停"
            />
          </div>
        </div>
      </SectionPanel>
    </PageShell>
  );
};
