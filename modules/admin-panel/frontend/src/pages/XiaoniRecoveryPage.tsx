import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AlarmClock, BatteryMedium, Bell, Calendar, Clock3, Moon, RefreshCw, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { cn, formatDateTimeCompact, formatTimestamp, parseTimestampValue } from '@/lib/utils';

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

type EnergyTimelinePoint = {
  key?: string;
  timestamp: string | null;
  timestampMs?: number | null;
  energy: number | null;
  actionCost?: number | null;
  source?: string | null;
  kind?: string | null;
  label?: string | null;
  recoverySessionId?: number | null;
  eventId?: string | null;
  restRejected?: boolean | null;
  rejectionReason?: string | null;
  requestedReason?: string | null;
  pressure?: number | null;
  requiredPressure?: number | null;
  toolExecutionId?: string | null;
  toolCallId?: string | null;
  traceId?: string | null;
};

type EnergyTimeline = {
  generatedAt: string | null;
  points: EnergyTimelinePoint[];
  summary?: {
    pointCount?: number | null;
    minEnergy?: number | null;
    maxEnergy?: number | null;
    latestEnergy?: number | null;
    latestTimestamp?: string | null;
  };
};

type RecoverEnergyRequest = {
  id: string | number | null;
  toolExecutionId: string | null;
  toolCallId: string | null;
  traceId: string | null;
  runId: string | null;
  status: string;
  restRejected: boolean;
  reason: string | null;
  requestedReason: string | null;
  xiaoniOs: string | null;
  energy: number | null;
  maxEnergy: number | null;
  pressure: number | null;
  requiredPressure: number | null;
  clockMinutes: number | null;
  startedAt: string | null;
  completedAt: string | null;
};

type RecoverEnergyRequestsPayload = {
  requests: RecoverEnergyRequest[];
  pagination?: {
    limit: number;
    offset: number;
    hasMore: boolean;
    nextOffset: number | null;
    previousOffset: number | null;
    sort?: string | null;
    filters?: {
      from?: string | null;
      to?: string | null;
    };
  };
  summary: {
    total: number;
    rejected: number;
    accepted: number;
    completed: number;
  };
};

type RecoverySessionsPayload = {
  identityKey: string;
  status: string;
  limit: number;
  active: RecoverySession | null;
  sessions: RecoverySession[];
  recoverEnergyRequests?: RecoverEnergyRequestsPayload;
  current?: CurrentRecoveryState;
  energyTimeline?: EnergyTimeline;
  runtime: RuntimeSnapshot;
};

const RECOVER_ENERGY_REQUEST_PAGE_SIZE = 20;

type RecoverEnergyRequestFilters = {
  offset: number;
  from: string;
  to: string;
};

async function fetchRecoverySessions(filters: RecoverEnergyRequestFilters): Promise<RecoverySessionsPayload> {
  const params = new URLSearchParams({
    limit: '40',
    request_limit: String(RECOVER_ENERGY_REQUEST_PAGE_SIZE),
    request_offset: String(filters.offset)
  });
  if (filters.from.trim()) {
    params.set('request_from', filters.from.trim());
  }
  if (filters.to.trim()) {
    params.set('request_to', filters.to.trim());
  }
  const response = await fetch(`/api/agent-runtime/recovery-sessions?${params.toString()}`);
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

function formatDurationMinutes(minutes: number) {
  const normalized = Math.max(0, Math.round(minutes));
  if (normalized < 60) {
    return `${normalized}m`;
  }
  const hours = Math.floor(normalized / 60);
  const rest = normalized % 60;
  return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`;
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
  return formatDurationMinutes(minutes);
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

function requestStatusTone(request: RecoverEnergyRequest): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  if (request.restRejected || request.status === 'rejected') {
    return 'danger';
  }
  if (request.status === 'accepted') {
    return 'warning';
  }
  if (request.status === 'completed') {
    return 'success';
  }
  return statusTone(request.status);
}

function requestStatusLabel(request: RecoverEnergyRequest) {
  if (request.restRejected || request.status === 'rejected') {
    return '被拒绝';
  }
  if (request.status === 'accepted') {
    return '已入睡';
  }
  if (request.status === 'completed') {
    return '已恢复';
  }
  return request.status || '-';
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

type EnergyChartPoint = EnergyTimelinePoint & {
  key: string;
  timestamp: string;
  timestampMs: number;
  energy: number;
  actionCost: number | null;
  chartLabel: string;
};

function normalizeEnergyPoint(point: EnergyTimelinePoint, index: number): EnergyChartPoint | null {
  const parsed = parseTimestampValue(point.timestamp);
  const timestampMs = typeof point.timestampMs === 'number' && Number.isFinite(point.timestampMs)
    ? point.timestampMs
    : parsed?.getTime();
  const energy = typeof point.energy === 'number' && Number.isFinite(point.energy)
    ? Math.max(0, Math.min(1, point.energy))
    : null;
  if (!timestampMs || energy === null) {
    return null;
  }
  const timestamp = parsed?.toISOString() || new Date(timestampMs).toISOString();
  return {
    ...point,
    key: point.key || `${timestampMs}:${point.source || 'energy'}:${index}`,
    timestamp,
    timestampMs,
    energy,
    actionCost: typeof point.actionCost === 'number' && Number.isFinite(point.actionCost)
      ? Math.max(0, Math.min(1, point.actionCost))
      : null,
    chartLabel: formatDateTimeCompact(timestamp)
  };
}

function buildFallbackEnergyPoints({
  sessions,
  currentEnergy,
  projectionUpdatedAt
}: {
  sessions: RecoverySession[];
  currentEnergy: number | null;
  projectionUpdatedAt: string | null;
}): EnergyTimelinePoint[] {
  const points: EnergyTimelinePoint[] = [];
  [...sessions].reverse().forEach((session) => {
    if (typeof session.startEnergy === 'number' && session.startedAt) {
      const energy = session.maxEnergy ? session.startEnergy / session.maxEnergy : session.startEnergy;
      points.push({
        timestamp: session.startedAt,
        energy,
        actionCost: 1 - energy,
        source: 'recovery_session',
        kind: 'session_start',
        label: '开始休息',
        recoverySessionId: session.id
      });
    }
    const currentAt = session.endedAt || session.lastCheckedAt || session.updatedAt;
    if (typeof session.currentEnergy === 'number' && currentAt) {
      const energy = session.maxEnergy ? session.currentEnergy / session.maxEnergy : session.currentEnergy;
      points.push({
        timestamp: currentAt,
        energy,
        actionCost: 1 - energy,
        source: 'recovery_session',
        kind: session.status === 'active' ? 'session_progress' : 'session_end',
        label: session.status === 'active' ? '休息中' : '醒来',
        recoverySessionId: session.id
      });
    }
  });
  if (typeof currentEnergy === 'number' && projectionUpdatedAt) {
    points.push({
      timestamp: projectionUpdatedAt,
      energy: currentEnergy,
      actionCost: 1 - currentEnergy,
      source: 'life_projection',
      kind: 'current_projection',
      label: '当前投影'
    });
  }
  return points;
}

function formatPercent(value: number | null | undefined, digits = 1) {
  return typeof value === 'number' && Number.isFinite(value) ? `${(value * 100).toFixed(digits)}%` : '-';
}

function formatEnergyAxis(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatEnergyTick(value: number) {
  return formatDateTimeCompact(value);
}

function EnergyTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ payload?: EnergyChartPoint }>; label?: number | string }) {
  if (!active) {
    return null;
  }
  const point = payload?.[0]?.payload;
  if (!point) {
    return null;
  }
  const labelText = typeof label === 'number'
    ? formatDateTimeCompact(label)
    : point.chartLabel;
  return (
    <div className="max-w-72 rounded-lg border border-border bg-background/95 p-3 text-xs shadow-lg">
      <div className="font-mono font-semibold text-foreground">{labelText}</div>
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
        <span className="text-muted-foreground">精力</span>
        <span className="text-right font-medium text-sky-700">{formatPercent(point.energy)}</span>
        <span className="text-muted-foreground">行动负荷</span>
        <span className="text-right font-medium text-amber-700">{formatPercent(point.actionCost)}</span>
        <span className="text-muted-foreground">来源</span>
        <span className="truncate text-right font-medium text-foreground">{point.label || point.kind || point.source || '-'}</span>
        {point.restRejected ? (
          <>
            <span className="text-muted-foreground">门槛</span>
            <span className="text-right font-medium text-rose-700">
              {formatPercent(point.pressure)} / {formatPercent(point.requiredPressure)}
            </span>
          </>
        ) : null}
      </div>
      {point.restRejected ? (
        <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-rose-900">
          {point.rejectionReason || '这次 recover_energy 被工程拒绝。'}
        </div>
      ) : null}
      {point.recoverySessionId || point.eventId ? (
        <div className="mt-2 truncate font-mono text-[11px] text-muted-foreground">
          {point.recoverySessionId ? `recovery #${point.recoverySessionId}` : point.eventId}
        </div>
      ) : null}
    </div>
  );
}

function EnergyTrendChart({ points, isLoading }: { points: EnergyChartPoint[]; isLoading: boolean }) {
  const chartDomain = React.useMemo<[number, number]>(() => {
    const first = points[0]?.timestampMs;
    const last = points[points.length - 1]?.timestampMs;
    if (!first || !last) {
      const now = Date.now();
      return [now - 60 * 60 * 1000, now];
    }
    if (first === last) {
      return [first - 30 * 60 * 1000, last + 30 * 60 * 1000];
    }
    const padding = Math.max(5 * 60 * 1000, Math.round((last - first) * 0.04));
    return [first - padding, last + padding];
  }, [points]);
  const latestPoint = points[points.length - 1] || null;

  return (
    <div className="h-[320px] rounded-md border border-border bg-background p-2">
      {isLoading ? (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">加载精力...</div>
      ) : points.length === 0 ? (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">暂无精力点</div>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 22, right: 16, bottom: 6, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              dataKey="timestampMs"
              type="number"
              domain={chartDomain}
              tickFormatter={formatEnergyTick}
              tick={{ fontSize: 11 }}
              stroke="hsl(var(--muted-foreground))"
            />
            <YAxis
              domain={[0, 1]}
              ticks={[0, 0.25, 0.5, 0.75, 1]}
              tickFormatter={formatEnergyAxis}
              tick={{ fontSize: 11 }}
              width={42}
              stroke="hsl(var(--muted-foreground))"
            />
            <ChartTooltip content={(props) => <EnergyTooltip {...(props as any)} />} />
            <Line
              type="monotone"
              dataKey="energy"
              name="精力"
              stroke="#0284c7"
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
              isAnimationActive={false}
            />
            {latestPoint ? (
              <ReferenceDot
                x={latestPoint.timestampMs}
                y={latestPoint.energy}
                r={4}
                fill="#0ea5e9"
                stroke="white"
                label={{ value: '当前', position: 'top', fontSize: 11, fill: '#334155' }}
              />
            ) : null}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

export const XiaoniRecoveryPage: React.FC = () => {
  const [requestOffset, setRequestOffset] = React.useState(0);
  const [requestFrom, setRequestFrom] = React.useState('');
  const [requestTo, setRequestTo] = React.useState('');
  const requestFilters = React.useMemo<RecoverEnergyRequestFilters>(() => ({
    offset: requestOffset,
    from: requestFrom,
    to: requestTo
  }), [requestFrom, requestOffset, requestTo]);
  const query = useQuery({
    queryKey: ['xiaoni-recovery-sessions', requestFilters],
    queryFn: () => fetchRecoverySessions(requestFilters),
    refetchInterval: 5000
  });

  const payload = query.data;
  const active = payload?.active || null;
  const sessions = payload?.sessions || [];
  const recoverEnergyRequests = payload?.recoverEnergyRequests?.requests || [];
  const recoverEnergyRequestSummary = payload?.recoverEnergyRequests?.summary || {
    total: recoverEnergyRequests.length,
    rejected: recoverEnergyRequests.filter((request) => request.restRejected).length,
    accepted: recoverEnergyRequests.filter((request) => request.status === 'accepted').length,
    completed: recoverEnergyRequests.filter((request) => request.status === 'completed').length
  };
  const recoverEnergyRequestPagination = payload?.recoverEnergyRequests?.pagination || null;
  const requestPage = Math.floor(requestOffset / RECOVER_ENERGY_REQUEST_PAGE_SIZE) + 1;
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
  const energyTimelinePoints = React.useMemo(() => {
    const sourcePoints = payload?.energyTimeline?.points?.length
      ? payload.energyTimeline.points
      : buildFallbackEnergyPoints({ sessions, currentEnergy, projectionUpdatedAt });
    return sourcePoints
      .map(normalizeEnergyPoint)
      .filter((point): point is EnergyChartPoint => Boolean(point))
      .sort((left, right) => left.timestampMs - right.timestampMs);
  }, [currentEnergy, payload?.energyTimeline?.points, projectionUpdatedAt, sessions]);
  const minChartEnergy = energyTimelinePoints.length
    ? Math.min(...energyTimelinePoints.map((point) => point.energy))
    : null;
  const maxChartEnergy = energyTimelinePoints.length
    ? Math.max(...energyTimelinePoints.map((point) => point.energy))
    : null;

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

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
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
        <MetricCard
          label="休息请求"
          value={recoverEnergyRequestSummary.total}
          detail={`拒绝 ${recoverEnergyRequestSummary.rejected} / 入睡 ${recoverEnergyRequestSummary.accepted}`}
          icon={<XCircle className="h-4 w-4" />}
          tone={recoverEnergyRequestSummary.rejected > 0 ? 'danger' : 'default'}
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
        title="精力趋势"
        description="单独使用 0% 到 100% 的精力轴；活动流和 token usage 仍在隔壁页面看。"
        icon={<BatteryMedium className="h-4 w-4 text-primary" />}
      >
        <div className="space-y-3">
          <EnergyTrendChart points={energyTimelinePoints} isLoading={query.isLoading} />
          <div className="grid gap-2 text-sm md:grid-cols-3">
            <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
              <div className="text-muted-foreground">当前</div>
              <div className="mt-1 font-medium text-foreground">{formatPercent(currentEnergy)}</div>
            </div>
            <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
              <div className="text-muted-foreground">最低</div>
              <div className="mt-1 font-medium text-foreground">{formatPercent(minChartEnergy)}</div>
            </div>
            <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
              <div className="text-muted-foreground">最高</div>
              <div className="mt-1 font-medium text-foreground">{formatPercent(maxChartEnergy)}</div>
            </div>
          </div>
        </div>
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
        title="最近 recover_energy 请求"
        description="包含已入睡和被工程拒绝的 recover_energy tool call；拒绝不会生成 recovery session。"
        icon={<XCircle className="h-4 w-4 text-primary" />}
        contentClassName="pt-0"
      >
        <div className="mb-4 flex flex-col gap-3 border-b border-border pb-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Calendar className="h-3.5 w-3.5" />
                开始时间
              </div>
              <Input
                type="datetime-local"
                step="1"
                value={requestFrom}
                onChange={(event) => {
                  setRequestFrom(event.target.value);
                  setRequestOffset(0);
                }}
                className="w-full lg:w-56"
              />
            </div>
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">结束时间</div>
              <Input
                type="datetime-local"
                step="1"
                value={requestTo}
                onChange={(event) => {
                  setRequestTo(event.target.value);
                  setRequestOffset(0);
                }}
                className="w-full lg:w-56"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setRequestFrom('');
                setRequestTo('');
                setRequestOffset(0);
              }}
              disabled={!requestFrom && !requestTo && requestOffset === 0}
            >
              清空
            </Button>
          </div>
          <div className="text-sm text-muted-foreground">
            按开始时间倒序，每页 {RECOVER_ENERGY_REQUEST_PAGE_SIZE} 条
          </div>
        </div>
        {recoverEnergyRequests.length > 0 ? (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>结果</TableHead>
                  <TableHead>时间</TableHead>
                  <TableHead>精力</TableHead>
                  <TableHead>压力/门槛</TableHead>
                  <TableHead>clock</TableHead>
                  <TableHead>原因</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recoverEnergyRequests.map((request, index) => (
                  <TableRow key={request.toolExecutionId || request.id || index}>
                    <TableCell>
                      <StatusPill tone={requestStatusTone(request)}>{requestStatusLabel(request)}</StatusPill>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatTimestamp(request.startedAt, { fallback: '-' })}
                    </TableCell>
                    <TableCell>{formatEnergyValue(request.energy, request.maxEnergy || 1)}</TableCell>
                    <TableCell>
                      {formatNumber(request.pressure)} / {formatNumber(request.requiredPressure)}
                    </TableCell>
                    <TableCell>{request.clockMinutes ? `${request.clockMinutes}m` : '-'}</TableCell>
                    <TableCell className="max-w-[520px]">
                      <div className="line-clamp-2 text-sm text-foreground" title={request.reason || request.requestedReason || ''}>
                        {request.reason || request.requestedReason || '-'}
                      </div>
                      {request.restRejected && request.requestedReason && request.requestedReason !== request.reason ? (
                        <div className="mt-1 line-clamp-1 text-xs text-muted-foreground" title={request.requestedReason}>
                          请求理由：{request.requestedReason}
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-muted-foreground">
                第 {requestPage} 页，本页 {recoverEnergyRequests.length} 条
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRequestOffset(recoverEnergyRequestPagination?.previousOffset ?? Math.max(0, requestOffset - RECOVER_ENERGY_REQUEST_PAGE_SIZE))}
                  disabled={requestOffset <= 0 || query.isFetching}
                >
                  上一页
                </Button>
                <StatusPill tone="info">offset {requestOffset}</StatusPill>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRequestOffset(recoverEnergyRequestPagination?.nextOffset ?? requestOffset + RECOVER_ENERGY_REQUEST_PAGE_SIZE)}
                  disabled={!recoverEnergyRequestPagination?.hasMore || query.isFetching}
                >
                  下一页
                </Button>
              </div>
            </div>
          </>
        ) : (
          <EmptyState
            icon={<XCircle className="h-8 w-8" />}
            title="还没有 recover_energy 请求"
            description="小腻调用 recover_energy 后，这里会显示成功入睡或被拒绝的记录。"
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
