import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, AlarmClock, BatteryMedium, Bell, Clock3, Moon, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PageHeader } from '@/components/console/PageHeader';
import { PageShell } from '@/components/console/PageShell';
import { MetricCard } from '@/components/console/MetricCard';
import { SectionPanel } from '@/components/console/SectionPanel';
import { StatusPill } from '@/components/console/StatusPill';
import { EmptyState } from '@/components/console/EmptyState';
import { ErrorState } from '@/components/console/ErrorState';
import { cn, formatTimestamp } from '@/lib/utils';

type ApiResponse<T> = {
  success: boolean;
  data: T;
  error?: string;
};

type RecoverySession = {
  id: number;
  identityKey: string;
  initiator: string;
  status: string;
  wakeCause: string | null;
  reason: string | null;
  xiaoniOs: string | null;
  clockMinutes: number | null;
  clockDueAt: string | null;
  clockFiredAt: string | null;
  clockDeferredAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  lastCheckedAt: string | null;
  traceId: string | null;
  runId: string | null;
  wakeCallCount: number;
  wakeRequiredCount: number | null;
  startPressure: number | null;
  currentPressure: number | null;
  startEnergy: number | null;
  currentEnergy: number | null;
  maxEnergy: number;
  plannedNaturalWakeAt: string | null;
  hardWakeAt: string | null;
  result: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: string | null;
  updatedAt: string | null;
};

type ExperienceItem = {
  id: string;
  source: string | null;
  kind: string | null;
  title: string | null;
  body: string | null;
  status?: string | null;
  timestamp: string | null;
  actorName?: string | null;
  peerName?: string | null;
  runId?: string | null;
  traceId?: string | null;
};

type RuntimeSnapshot = {
  live: boolean;
  status: string;
  workerBusy: boolean;
  taskWorkerBusy: boolean;
  runtimeEnabled: boolean;
  timestamp: string | null;
  errorMessage: string | null;
};

type LifeStateSnapshot = {
  projection?: {
    version?: string | null;
    generatedAt?: string | null;
    state?: {
      energy?: number | null;
      actionCost?: number | null;
    };
  };
  explanation?: {
    summary?: string | null;
    generatedAt?: string | null;
  };
  reducedThroughEventId?: string | null;
  reducedThroughOccurredAt?: string | null;
  projectionVersion?: string | null;
  projectionUpdatedAt?: string | null;
  updatedAt?: string | null;
};

type CurrentRecoveryState = {
  latestActivityAt: string | null;
  lifeState: LifeStateSnapshot | null;
  runtime?: RuntimeSnapshot;
};

type RecoverySessionsPayload = {
  identityKey: string;
  status: string;
  limit: number;
  active: RecoverySession | null;
  sessions: RecoverySession[];
  current?: CurrentRecoveryState;
  recentExperience?: ExperienceItem[];
  runtime: RuntimeSnapshot;
};

async function fetchRecoverySessions(): Promise<RecoverySessionsPayload> {
  const response = await fetch('/api/agent-runtime/recovery-sessions?limit=40');
  const payload = await response.json() as ApiResponse<RecoverySessionsPayload>;
  if (!response.ok || !payload.success) {
    throw new Error(payload.error || 'Failed to load recovery sessions');
  }
  return payload.data;
}

function formatNumber(value: number | null | undefined, digits = 3) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '-';
}

function formatEnergyValue(energy: number | null | undefined, maxEnergy: number | null | undefined = 1) {
  return `${formatNumber(energy)}/${formatNumber(maxEnergy || 1)}`;
}

function formatEnergy(session: RecoverySession | null | undefined) {
  if (!session) {
    return '-';
  }
  return formatEnergyValue(session.currentEnergy, session.maxEnergy);
}

function formatDuration(startedAt: string | null, endedAt: string | null) {
  if (!startedAt) {
    return '-';
  }
  const started = new Date(startedAt).getTime();
  const ended = endedAt ? new Date(endedAt).getTime() : Date.now();
  if (!Number.isFinite(started) || !Number.isFinite(ended)) {
    return '-';
  }
  const minutes = Math.max(0, Math.round((ended - started) / 60000));
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`;
}

function statusTone(status: string): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  if (status === 'active') {
    return 'warning';
  }
  if (status === 'completed') {
    return 'success';
  }
  if (status === 'failed' || status === 'cancelled') {
    return 'danger';
  }
  return 'neutral';
}

const wakeCauseLabels: Record<string, string> = {
  natural: '自然醒',
  clock: '闹钟醒',
  clock_deferred: '闹钟延后',
  hard_cap: '最长休眠',
  private_or_mention_threshold: '被喊醒',
};

function wakeCauseLabel(value: string | null | undefined) {
  return value ? wakeCauseLabels[value] || value : '-';
}

function clockLabel(session: RecoverySession | null | undefined) {
  if (!session?.clockMinutes) {
    return '自然醒';
  }
  if (session.clockDeferredAt && session.status === 'active') {
    return `${session.clockMinutes}m 已延后`;
  }
  return `${session.clockMinutes}m`;
}

function experienceSourceLabel(item: ExperienceItem) {
  if (item.source === 'tool_execution') {
    return 'tool';
  }
  if (item.source === 'llm_request') {
    return 'llm';
  }
  if (item.source === 'queue_message') {
    return 'queue';
  }
  if (item.source === 'life_event') {
    return 'life';
  }
  if (item.source === 'llm_stack_item') {
    return 'stack';
  }
  return item.source || item.kind || 'event';
}

function experienceTone(item: ExperienceItem): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  if (item.status === 'failed' || item.kind?.includes('failed')) {
    return 'danger';
  }
  if (item.status === 'processing' || item.status === 'running') {
    return 'warning';
  }
  if (item.source === 'tool_execution' || item.source === 'llm_request') {
    return 'info';
  }
  return 'neutral';
}

function SessionDetail({ session }: { session: RecoverySession }) {
  const details = [
    ['开始', formatTimestamp(session.startedAt, { fallback: '-' })],
    ['计划自然醒', formatTimestamp(session.plannedNaturalWakeAt, { fallback: '-' })],
    ['硬上限', formatTimestamp(session.hardWakeAt, { fallback: '-' })],
    ['clock 到点', formatTimestamp(session.clockDueAt, { fallback: '-' })],
    ['最近检查', formatTimestamp(session.lastCheckedAt, { fallback: '-' })],
    ['trace', session.traceId || '-'],
    ['run', session.runId || '-'],
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
      <div className="space-y-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Reason</div>
          <p className="mt-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm leading-6 text-foreground">
            {session.reason || '未记录'}
          </p>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Xiaoni OS</div>
          <p className="mt-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm leading-6 text-foreground">
            {session.xiaoniOs || '未记录'}
          </p>
        </div>
      </div>
      <div className="grid gap-2 rounded-lg border border-border bg-muted/30 p-3">
        {details.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[88px_1fr] gap-3 text-sm">
            <span className="text-muted-foreground">{label}</span>
            <span className="min-w-0 truncate font-medium text-foreground" title={value}>{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export const XiaoniRecoveryPage: React.FC = () => {
  const query = useQuery({
    queryKey: ['xiaoni-recovery-sessions'],
    queryFn: fetchRecoverySessions,
    refetchInterval: 5000
  });

  const payload = query.data;
  const active = payload?.active || null;
  const sessions = payload?.sessions || [];
  const recentExperience = payload?.recentExperience || [];
  const current = payload?.current || null;
  const runtime = current?.runtime || payload?.runtime;
  const runtimeLive = runtime?.live;
  const lifeState = current?.lifeState || null;
  const projectedState = lifeState?.projection?.state || {};
  const projectedEnergy = typeof projectedState.energy === 'number' && Number.isFinite(projectedState.energy)
    ? projectedState.energy
    : null;
  const projectedActionCost = typeof projectedState.actionCost === 'number' && Number.isFinite(projectedState.actionCost)
    ? projectedState.actionCost
    : null;
  const currentEnergy = typeof active?.currentEnergy === 'number' && Number.isFinite(active.currentEnergy)
    ? active.currentEnergy
    : projectedEnergy;
  const currentMaxEnergy = active?.maxEnergy || 1;
  const stateSummary = lifeState?.explanation?.summary || null;
  const projectionUpdatedAt = lifeState?.projectionUpdatedAt || lifeState?.projection?.generatedAt || lifeState?.updatedAt || null;

  return (
    <PageShell>
      <PageHeader
        eyebrow="Recover Energy"
        title="小腻休息"
        description="查看小腻当前精力投影、recover_energy 休眠会话、醒来原因、闹钟状态和被喊醒计数。"
        icon={<Moon className="h-5 w-5" />}
        badge={
          <StatusPill tone={active ? 'warning' : runtimeLive ? 'success' : 'danger'}>
            {active ? '休息中' : runtimeLive ? '清醒' : 'runtime offline'}
          </StatusPill>
        }
        actions={
          <Button variant="outline" size="sm" onClick={() => void query.refetch()} disabled={query.isFetching}>
            <RefreshCw className={cn('mr-2 h-4 w-4', query.isFetching && 'animate-spin')} />
            刷新
          </Button>
        }
      />

      {query.error ? (
        <ErrorState
          description={query.error instanceof Error ? query.error.message : '加载休息状态失败'}
          onRetry={() => void query.refetch()}
        />
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          label="当前状态"
          value={active ? '休息中' : '清醒'}
          detail={active ? `已休息 ${formatDuration(active.startedAt, null)}` : `最近活动 ${formatTimestamp(current?.latestActivityAt, { fallback: '-' })}`}
          icon={<Moon className="h-4 w-4" />}
          tone={active ? 'warning' : 'success'}
        />
        <MetricCard
          label="当前精力"
          value={formatEnergyValue(currentEnergy, currentMaxEnergy)}
          detail={active ? `起始 ${formatNumber(active.startEnergy)}` : `投影 ${formatTimestamp(projectionUpdatedAt, { fallback: '-' })}`}
          icon={<BatteryMedium className="h-4 w-4" />}
          tone={(currentEnergy ?? 1) < 0 ? 'danger' : 'default'}
        />
        <MetricCard
          label="行动负荷"
          value={formatNumber(projectedActionCost)}
          detail={stateSummary || lifeState?.projectionVersion || lifeState?.projection?.version || '生命状态投影'}
          icon={<Clock3 className="h-4 w-4" />}
          tone={(projectedActionCost ?? 0) > 0.8 ? 'warning' : 'default'}
        />
        <MetricCard
          label="Clock"
          value={clockLabel(active)}
          detail={active?.clockDueAt ? formatTimestamp(active.clockDueAt, { fallback: '-' }) : '未设置闹钟'}
          icon={<AlarmClock className="h-4 w-4" />}
          tone={active?.clockDeferredAt ? 'warning' : 'default'}
        />
        <MetricCard
          label="被喊醒计数"
          value={active ? active.wakeCallCount : 0}
          detail={active?.wakeRequiredCount ? `阈值 ${active.wakeRequiredCount}` : '无 active 阈值'}
          icon={<Bell className="h-4 w-4" />}
          tone={active && active.wakeRequiredCount && active.wakeCallCount >= active.wakeRequiredCount ? 'danger' : 'default'}
        />
      </div>

      <SectionPanel
        title="当前生命状态"
        description="来自 agent_session_life_states 的投影；没有 active sleep 时，当前精力仍然从这里读取。"
        icon={<BatteryMedium className="h-4 w-4 text-primary" />}
      >
        {lifeState ? (
          <div className="grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-4">
            <div>
              <div className="text-muted-foreground">精力</div>
              <div className="mt-1 font-medium text-foreground">{formatEnergyValue(projectedEnergy, 1)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">行动负荷</div>
              <div className="mt-1 font-medium text-foreground">{formatNumber(projectedActionCost)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">投影版本</div>
              <div className="mt-1 truncate font-medium text-foreground" title={lifeState.projectionVersion || lifeState.projection?.version || undefined}>
                {lifeState.projectionVersion || lifeState.projection?.version || '-'}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">更新时间</div>
              <div className="mt-1 font-medium text-foreground">{formatTimestamp(projectionUpdatedAt, { fallback: '-' })}</div>
            </div>
            {stateSummary ? (
              <div className="md:col-span-2 xl:col-span-4">
                <div className="text-muted-foreground">摘要</div>
                <div className="mt-1 rounded-lg border border-border bg-muted/40 px-3 py-2 text-foreground">{stateSummary}</div>
              </div>
            ) : null}
          </div>
        ) : (
          <EmptyState
            icon={<BatteryMedium className="h-8 w-8" />}
            title="暂无生命状态投影"
            description="agent_session_life_states 还没有返回小腻的当前精力。"
          />
        )}
      </SectionPanel>

      <SectionPanel
        title="小腻的经历"
        description="最近 action stream 事件，帮助判断她醒着时正在处理什么。"
        icon={<Activity className="h-4 w-4 text-primary" />}
      >
        {recentExperience.length > 0 ? (
          <div className="divide-y divide-border">
            {recentExperience.map((item) => (
              <div key={item.id} className="grid gap-2 py-3 md:grid-cols-[11rem_1fr]">
                <div className="text-xs text-muted-foreground">
                  {formatTimestamp(item.timestamp, { fallback: '-' })}
                </div>
                <div className="min-w-0 space-y-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <StatusPill tone={experienceTone(item)}>{experienceSourceLabel(item)}</StatusPill>
                    <span className="min-w-0 truncate font-medium text-foreground" title={item.title || item.kind || undefined}>
                      {item.title || item.kind || item.id}
                    </span>
                  </div>
                  {item.body ? (
                    <div className="line-clamp-2 text-sm leading-6 text-muted-foreground" title={item.body}>
                      {item.body}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<Activity className="h-8 w-8" />}
            title="暂无经历事件"
            description="action stream 还没有返回小腻最近的经历。"
          />
        )}
      </SectionPanel>

      <SectionPanel
        title="当前休息会话"
        description="active session 来自 agent_recovery_sessions；服务重启后 runtime 会继续结算这一行。"
        icon={<Clock3 className="h-4 w-4 text-primary" />}
      >
        {active ? (
          <SessionDetail session={active} />
        ) : (
          <EmptyState
            icon={<Moon className="h-8 w-8" />}
            title="当前没有休息会话"
            description="小腻没有处在 recover_energy 的持久化休眠状态。"
          />
        )}
      </SectionPanel>

      <SectionPanel
        title="最近休息记录"
        description="按 started_at 倒序展示最近 40 条 recovery session。"
        icon={<Moon className="h-4 w-4 text-primary" />}
        contentClassName="pt-0"
      >
        {sessions.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>状态</TableHead>
                <TableHead>开始</TableHead>
                <TableHead>时长</TableHead>
                <TableHead>精力</TableHead>
                <TableHead>clock</TableHead>
                <TableHead>喊醒</TableHead>
                <TableHead>醒来原因</TableHead>
                <TableHead>原因</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.map((session) => (
                <TableRow key={session.id}>
                  <TableCell>
                    <StatusPill tone={statusTone(session.status)}>{session.status}</StatusPill>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatTimestamp(session.startedAt, { fallback: '-' })}
                  </TableCell>
                  <TableCell>{formatDuration(session.startedAt, session.endedAt)}</TableCell>
                  <TableCell>{formatEnergy(session)}</TableCell>
                  <TableCell>{clockLabel(session)}</TableCell>
                  <TableCell>{session.wakeCallCount}/{session.wakeRequiredCount ?? '-'}</TableCell>
                  <TableCell>{wakeCauseLabel(session.wakeCause)}</TableCell>
                  <TableCell className="max-w-[260px] truncate" title={session.reason || ''}>
                    {session.reason || '-'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState
            icon={<Moon className="h-8 w-8" />}
            title="还没有休息记录"
            description="等小腻调用 recover_energy 后，这里会展示持久化会话。"
          />
        )}
      </SectionPanel>
    </PageShell>
  );
};
