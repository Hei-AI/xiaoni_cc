import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, HeartPulse, Loader2, Power, RefreshCw, TimerReset } from 'lucide-react';
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

type RuntimeControlPatch = Partial<Pick<RuntimeControl, 'enabled' | 'cacheHeartbeatPaused' | 'postCompressionPauseArmed' | 'mainAgentPreModelYieldMs'>>;

type RuntimePromptReloadResult = {
  invalidated?: boolean;
  had_pending_reload?: boolean;
  reason?: string;
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

export const XiaoniRuntimeSettingsPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [yieldInput, setYieldInput] = React.useState('');
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
  React.useEffect(() => {
    if (!mutation.isPending && typeof control?.mainAgentPreModelYieldMs === 'number') {
      setYieldInput(String(control.mainAgentPreModelYieldMs));
    }
  }, [control?.mainAgentPreModelYieldMs, mutation.isPending]);
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
