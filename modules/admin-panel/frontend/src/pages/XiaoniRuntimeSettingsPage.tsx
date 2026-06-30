import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, HeartPulse, Loader2, Power, RefreshCw, Shrink, TimerReset } from 'lucide-react';
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
  updatedAt: string | null;
};

async function fetchRuntimeControl(): Promise<RuntimeControl> {
  const response = await fetch('/api/agent-runtime/control');
  const payload = await response.json() as ApiResponse<RuntimeControl>;
  if (!response.ok || !payload.success) {
    throw new Error(payload.error || 'Failed to load runtime control');
  }
  return payload.data;
}

type RuntimeControlPatch = Partial<Pick<RuntimeControl, 'enabled' | 'cacheHeartbeatPaused' | 'postCompressionPauseArmed' | 'mainAgentPreModelYieldMs' | 'debugCacheHeartbeatIntervalMs' | 'compressionTriggerInputTokens'>>;

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
  const currentYieldMs = typeof pendingPatch?.mainAgentPreModelYieldMs === 'number'
    ? pendingPatch.mainAgentPreModelYieldMs
    : control?.mainAgentPreModelYieldMs ?? 5000;
  const currentDebugHeartbeatIntervalMs = typeof pendingPatch?.debugCacheHeartbeatIntervalMs === 'number'
    ? pendingPatch.debugCacheHeartbeatIntervalMs
    : control?.debugCacheHeartbeatIntervalMs ?? 0;
  const currentCompressionTriggerInputTokens = typeof pendingPatch?.compressionTriggerInputTokens === 'number'
    ? pendingPatch.compressionTriggerInputTokens
    : control?.compressionTriggerInputTokens ?? 80000;
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
