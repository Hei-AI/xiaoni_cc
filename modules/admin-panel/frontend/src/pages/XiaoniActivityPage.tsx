import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  Bot,
  Clock3,
  Eye,
  Image,
  Loader2,
  MessageCircle,
  Radio,
  RefreshCw,
  Search,
  Sparkles,
  Waypoints,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader, PageHeaderBadge } from '@/components/console/PageHeader';
import { PageShell } from '@/components/console/PageShell';
import { StatusPill } from '@/components/console/StatusPill';
import { EmptyState } from '@/components/console/EmptyState';
import { ErrorState } from '@/components/console/ErrorState';
import { cn, formatDateOnly, formatTimeOnly, formatTimestamp } from '@/lib/utils';

type ActivityTone = 'xiaoni' | 'success' | 'warning' | 'danger' | 'info' | 'neutral' | string;

interface XiaoniActivityFeedItem {
  id: string;
  source: string;
  kind: string;
  eventId?: string;
  eventKind?: string;
  title: string;
  body: string | null;
  status: string | null;
  actor: string | null;
  actorName: string | null;
  timestamp: string;
  occurredAt?: string;
  sessionKey: string | null;
  peerName: string | null;
  internalExecutionLeaseId?: string | null;
  traceId: string | null;
  traceTarget?: {
    internalExecutionLeaseId: string;
    traceId: string | null;
    spanId: string | null;
  } | null;
  tone: ActivityTone;
  metadata: Record<string, unknown>;
}

interface RuntimeSnapshot {
  live: boolean;
  status: string;
  service: string;
  workerBusy: boolean;
  taskWorkerBusy: boolean;
  presenceTickBusy: boolean;
  timestamp: string | null;
  url: string;
  healthStatusCode: number | null;
  errorMessage: string | null;
}

interface XiaoniActivityFeed {
  identityKey: string;
  generatedAt: string;
  current: {
    latestActivityAt: string | null;
    lifeState: Record<string, unknown> | null;
    queue: {
      pending: number;
      running: number;
      staleRunning: number;
      failed: number;
    };
    backgroundActions: {
      planned: number;
      running: number;
      settled: number;
      failed: number;
    };
    autonomy: {
      latestPresenceTickAt: string | null;
      latestPresenceTickStatus: string | null;
      latestProactiveImOpenAt: string | null;
      latestProactiveImOpenStatus: string | null;
      latestPresenceEvaluationAt: string | null;
      latestPresenceEvaluationReason: string | null;
      latestPresenceEvaluationEligible: boolean | null;
      liveSelfActionRunner: boolean;
      latestHistoricalDigitalActionAt: string | null;
      latestHistoricalDigitalActionStatus: string | null;
      latestHistoricalDigitalActionKind: string | null;
    };
    tasks: {
      pending: number;
      running: number;
      settled: number;
      failed: number;
    };
    runtime: RuntimeSnapshot;
  };
  items: XiaoniActivityFeedItem[];
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: string;
}

const toneClasses: Record<string, string> = {
  xiaoni: 'border-cyan-200/80 bg-cyan-50/70',
  success: 'border-emerald-200/80 bg-emerald-50/70',
  warning: 'border-amber-200/80 bg-amber-50/70',
  danger: 'border-red-200/80 bg-red-50/70',
  info: 'border-sky-200/80 bg-sky-50/70',
  neutral: 'border-border bg-card',
};

const iconClasses: Record<string, string> = {
  xiaoni: 'bg-cyan-100 text-cyan-700',
  success: 'bg-emerald-100 text-emerald-700',
  warning: 'bg-amber-100 text-amber-700',
  danger: 'bg-red-100 text-red-700',
  info: 'bg-sky-100 text-sky-700',
  neutral: 'bg-muted text-muted-foreground',
};

function statusTone(value?: string | null): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  if (!value) {
    return 'neutral';
  }
  if (['healthy', 'ok', 'observed', 'active_surface'].includes(value)) {
    return 'success';
  }
  if (['running', 'planned', 'pending', 'waiting', 'degraded', 'stale_processing'].includes(value)) {
    return 'warning';
  }
  if (['failed', 'offline', 'blocked'].includes(value)) {
    return 'danger';
  }
  return 'info';
}

function statusLabel(value?: string | null) {
  if (!value) {
    return null;
  }
  if (value === 'completed') {
    return 'ok';
  }
  if (value === 'processing') {
    return 'running';
  }
  if (value === 'pending' || value === 'planned') {
    return 'waiting';
  }
  return value;
}

function itemIcon(item: XiaoniActivityFeedItem) {
  if (item.source === 'tool_call') return <Waypoints className="h-4 w-4" />;
  if (item.source === 'provider_call') return <Activity className="h-4 w-4" />;
  if (item.source === 'llm_call') return <Bot className="h-4 w-4" />;
  if (item.source === 'digital_action') return <Search className="h-4 w-4" />;
  if (item.source === 'task') return <Sparkles className="h-4 w-4" />;
  if (item.source === 'media_observation') return <Image className="h-4 w-4" />;
  if (item.source === 'queue_message') return <Clock3 className="h-4 w-4" />;
  if (item.kind === 'qq_message_seen') return <Eye className="h-4 w-4" />;
  if (['send_in_group', 'send_in_private', 'qq_self_message'].includes(item.kind)) return <MessageCircle className="h-4 w-4" />;
  if (item.kind === 'terminal_action_blocked') return <AlertTriangle className="h-4 w-4" />;
  return <Bot className="h-4 w-4" />;
}

function sourceLabel(source: string) {
  switch (source) {
    case 'life_event':
      return 'life';
    case 'tool_call':
      return 'tool';
    case 'provider_call':
      return 'provider';
    case 'llm_call':
      return 'LLM';
    case 'digital_action':
      return 'history';
    case 'media_observation':
      return 'media';
    case 'queue_message':
      return 'queue';
    default:
      return source.replace(/_/g, ' ');
  }
}

function runtimeBusyLabel(runtime: RuntimeSnapshot | undefined) {
  if (!runtime?.live) {
    return 'offline';
  }
  const busy = [
    runtime.workerBusy && 'action',
    runtime.taskWorkerBusy && 'task',
    runtime.presenceTickBusy && 'presence',
  ].filter(Boolean);
  return busy.length ? busy.join(' / ') : 'idle';
}

function metadataText(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function metadataNumber(metadata: Record<string, unknown>, key: string): number | null {
  const value = metadata[key];
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatBytes(value: number | null) {
  if (!value || value <= 0) {
    return null;
  }
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

function timelineGroups(items: XiaoniActivityFeedItem[]) {
  const groups: Array<{ day: string; items: XiaoniActivityFeedItem[] }> = [];
  for (const item of items) {
    const day = formatDateOnly(item.timestamp);
    const last = groups[groups.length - 1];
    if (last?.day === day) {
      last.items.push(item);
    } else {
      groups.push({ day, items: [item] });
    }
  }
  return groups;
}

function RuntimeStrip({
  feed,
  isLoading,
}: {
  feed: XiaoniActivityFeed | undefined;
  isLoading: boolean;
}) {
  const runtime = feed?.current.runtime;
  const busyLabel = runtimeBusyLabel(runtime);
  const queue = feed?.current.queue;
  const tasks = feed?.current.tasks;
  const backgroundActions = feed?.current.backgroundActions;
  const autonomy = feed?.current.autonomy;
  const latestTool = feed?.items.find((item) => item.source === 'tool_call');
  const activeBackground = (tasks?.pending || 0) + (tasks?.running || 0);
  const historicalBackground = (backgroundActions?.settled || 0) + (backgroundActions?.failed || 0) + (backgroundActions?.planned || 0) + (backgroundActions?.running || 0);
  const lifeState = feed?.current.lifeState as {
    explanation?: { summary?: unknown };
    projection?: { state?: Record<string, unknown> };
  } | null | undefined;
  const stateSummary = typeof lifeState?.explanation?.summary === 'string' ? lifeState.explanation.summary : null;

  return (
    <section className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <div className="flex items-center gap-2">
          <Radio className="h-4 w-4 text-primary" />
          <span className="text-muted-foreground">当前</span>
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            <StatusPill tone={runtime?.live && busyLabel === 'idle' ? 'success' : runtime?.live ? 'warning' : 'danger'}>
              {busyLabel}
            </StatusPill>
          )}
        </div>
        <span className="text-muted-foreground">
          小腻服务 {runtime?.timestamp ? formatTimestamp(runtime.timestamp) : runtime?.errorMessage || 'pending'}
        </span>
        <span className="text-muted-foreground">
          最近 tool <span className="font-medium text-foreground">{latestTool?.kind || '-'}</span>
        </span>
        <span className="text-muted-foreground">
          queue <span className="font-medium text-foreground">{(queue?.pending || 0) + (queue?.running || 0)}</span>
          {queue?.staleRunning ? <span className="ml-1 text-amber-700">stale {queue.staleRunning}</span> : null}
        </span>
        <span className="text-muted-foreground">
          background <span className="font-medium text-foreground">{activeBackground}</span>
        </span>
        <span className="text-muted-foreground">
          presence <span className="font-medium text-foreground">{autonomy?.latestPresenceTickAt ? formatTimestamp(autonomy.latestPresenceTickAt) : '-'}</span>
        </span>
        <span className="text-muted-foreground">
          主动 IM <span className="font-medium text-foreground">{autonomy?.latestProactiveImOpenAt ? formatTimestamp(autonomy.latestProactiveImOpenAt) : '-'}</span>
        </span>
        <span className="text-muted-foreground">
          history <span className="font-medium text-foreground">{historicalBackground}</span>
        </span>
        <span className="text-muted-foreground">
          runner <span className="font-medium text-foreground">{autonomy?.liveSelfActionRunner ? 'live' : 'off'}</span>
        </span>
      </div>
      {stateSummary ? (
        <div className="mt-2 truncate text-xs text-muted-foreground">
          state <span className="font-medium text-foreground">{stateSummary}</span>
        </div>
      ) : null}
    </section>
  );
}

function TimelineEvent({ item, isLatest }: { item: XiaoniActivityFeedItem; isLatest: boolean }) {
  const navigate = useNavigate();
  const tone = toneClasses[item.tone] ? item.tone : 'neutral';
  const eventKind = item.eventKind || item.kind;
  const occurredAt = item.occurredAt || item.timestamp;
  const inContextPreview = metadataText(item.metadata, 'inContextPreview');
  const toolArgumentsPreview = metadataText(item.metadata, 'toolArgumentsPreview');
  const toolResultPreview = metadataText(item.metadata, 'toolResultPreview');
  const responsePreview = metadataText(item.metadata, 'responsePreview');
  const providerRequestPreview = metadataText(item.metadata, 'providerRequestPreview');
  const providerResponsePreview = metadataText(item.metadata, 'providerResponsePreview');
  const providerRequestBytes = formatBytes(metadataNumber(item.metadata, 'providerRequestBytes'));
  const providerResponseBytes = formatBytes(metadataNumber(item.metadata, 'providerResponseBytes'));
  const providerFormat = metadataText(item.metadata, 'providerFormat');
  const spanId = metadataText(item.metadata, 'spanId');
  const actionTracePreview = metadataText(item.metadata, 'actionTracePreview');
  const budgetSnapshotPreview = metadataText(item.metadata, 'budgetSnapshotPreview');
  const payloadPreview = metadataText(item.metadata, 'payloadPreview');
  const interestCandidatesPreview = metadataText(item.metadata, 'interestCandidatesPreview');
  const decisionLlmCallId = metadataText(item.metadata, 'decisionLlmCallId');
  const searchLlmCallId = metadataText(item.metadata, 'searchLlmCallId');
  const sourceActionId = metadataText(item.metadata, 'sourceActionId') || metadataText(item.metadata, 'actionId');
  const traceTarget = item.traceTarget || (item.internalExecutionLeaseId ? {
    internalExecutionLeaseId: item.internalExecutionLeaseId,
    traceId: item.traceId,
    spanId
  } : null);
  const hasActionTrace = Boolean(actionTracePreview || budgetSnapshotPreview || payloadPreview || interestCandidatesPreview || decisionLlmCallId || searchLlmCallId || sourceActionId);

  return (
    <div className="relative md:grid md:grid-cols-[7rem_minmax(0,1fr)] md:gap-6">
      <div className="hidden pt-4 text-right md:block">
        <time className="block font-mono text-sm font-semibold text-foreground">{formatTimeOnly(occurredAt)}</time>
        <div className="mt-1 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{sourceLabel(item.source)}</div>
      </div>

      <div
        className={cn(
          'absolute left-3 top-5 z-10 flex h-7 w-7 items-center justify-center rounded-full border-2 border-background md:left-[7.875rem]',
          iconClasses[tone]
        )}
      >
        {itemIcon(item)}
      </div>

      <article className={cn('ml-12 rounded-lg border p-4 shadow-sm md:ml-0', toneClasses[tone])}>
        <div className="flex flex-wrap items-center gap-2">
          {isLatest ? <StatusPill tone="info">latest</StatusPill> : null}
          <StatusPill tone="neutral">{sourceLabel(item.source)}</StatusPill>
          <StatusPill tone="neutral">{eventKind.replace(/_/g, ' ')}</StatusPill>
          {item.status ? <StatusPill tone={statusTone(item.status)}>{statusLabel(item.status)}</StatusPill> : null}
          <time className="text-xs text-muted-foreground md:hidden">{formatTimestamp(occurredAt)}</time>
        </div>

        <div className="mt-3 flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h2 className="break-words text-base font-semibold leading-6 text-foreground">{item.title}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {item.peerName ? <span>{item.peerName}</span> : null}
              {item.actorName ? <span>{item.actorName}</span> : null}
              {item.traceId ? <span className="font-mono">{item.traceId}</span> : null}
              {spanId ? <span className="font-mono">{spanId}</span> : null}
              {providerFormat ? <span>{providerFormat}</span> : null}
            </div>
          </div>

          {traceTarget?.internalExecutionLeaseId && (item.eventId || item.id) ? (
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => navigate(`/xiaoni/action-stream/events/${encodeURIComponent(item.eventId || item.id)}/trace${traceTarget.spanId ? `?spanId=${encodeURIComponent(traceTarget.spanId)}` : ''}`)}
            >
              <Waypoints className="mr-2 h-4 w-4" />
              Raw Trace
            </Button>
          ) : null}
        </div>

        {item.body ? (
          <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-foreground/90">{item.body}</p>
        ) : null}

        {providerRequestPreview || providerResponsePreview ? (
          <section className="mt-4 border-t border-border/70 pt-3">
            <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              <span className="inline-flex items-center gap-2">
                <Activity className="h-3.5 w-3.5" />
                <span>Codex Provider trace</span>
              </span>
              {providerRequestBytes ? <span>request {providerRequestBytes}</span> : null}
              {providerResponseBytes ? <span>response {providerResponseBytes}</span> : null}
            </div>
            <div className="grid gap-3 xl:grid-cols-2">
              {providerRequestPreview ? (
                <div className="min-w-0">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">request preview</div>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background/80 p-3 font-mono text-xs leading-5 text-foreground/85">{providerRequestPreview}</pre>
                </div>
              ) : null}
              {providerResponsePreview ? (
                <div className="min-w-0">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">response preview</div>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background/80 p-3 font-mono text-xs leading-5 text-foreground/85">{providerResponsePreview}</pre>
                </div>
              ) : null}
            </div>
            {traceTarget?.internalExecutionLeaseId ? (
              <div className="mt-3 text-xs text-muted-foreground">
                完整原文在 raw trace 的 provider span 中按需加载。
              </div>
            ) : null}
          </section>
        ) : null}

        {inContextPreview ? (
          <section className="mt-4 border-t border-border/70 pt-3">
            <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              <Bot className="h-3.5 w-3.5" />
              <span>{item.source === 'llm_call' ? 'LLM in_context' : '对应 LLM in_context'}</span>
            </div>
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background/75 p-3 font-mono text-xs leading-5 text-foreground/80">{inContextPreview}</pre>
          </section>
        ) : null}

        {toolArgumentsPreview || toolResultPreview || responsePreview ? (
          <section className="mt-4 border-t border-border/70 pt-3">
            <div className="grid gap-3 lg:grid-cols-2">
              {toolArgumentsPreview ? (
                <div className="min-w-0">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">tool args</div>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background/75 p-3 font-mono text-xs leading-5 text-foreground/80">{toolArgumentsPreview}</pre>
                </div>
              ) : null}
              {toolResultPreview ? (
                <div className="min-w-0">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">tool result</div>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background/75 p-3 font-mono text-xs leading-5 text-foreground/80">{toolResultPreview}</pre>
                </div>
              ) : null}
              {responsePreview ? (
                <details className="min-w-0 lg:col-span-2">
                  <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    LLM response
                  </summary>
                  <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background/75 p-3 font-mono text-xs leading-5 text-foreground/80">{responsePreview}</pre>
                </details>
              ) : null}
            </div>
          </section>
        ) : null}

        {hasActionTrace ? (
          <section className="mt-4 border-t border-border/70 pt-3">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              <Waypoints className="h-3.5 w-3.5" />
              <span>action trace</span>
              {sourceActionId ? <span className="font-mono normal-case tracking-normal">{sourceActionId}</span> : null}
            </div>
            {decisionLlmCallId || searchLlmCallId ? (
              <div className="mb-3 flex flex-wrap gap-2">
                {decisionLlmCallId ? (
                  <Button variant="outline" size="sm" onClick={() => navigate(`/traffic?llm_call_id=${encodeURIComponent(decisionLlmCallId)}`)}>
                    <Waypoints className="mr-2 h-4 w-4" />
                    decision traffic
                  </Button>
                ) : null}
                {searchLlmCallId ? (
                  <Button variant="outline" size="sm" onClick={() => navigate(`/traffic?llm_call_id=${encodeURIComponent(searchLlmCallId)}`)}>
                    <Search className="mr-2 h-4 w-4" />
                    search traffic
                  </Button>
                ) : null}
              </div>
            ) : null}
            <div className="grid gap-3 lg:grid-cols-2">
              {interestCandidatesPreview ? (
                <div className="min-w-0">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">interest candidates</div>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background/75 p-3 font-mono text-xs leading-5 text-foreground/80">{interestCandidatesPreview}</pre>
                </div>
              ) : null}
              {actionTracePreview ? (
                <div className="min-w-0">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">source trace</div>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background/75 p-3 font-mono text-xs leading-5 text-foreground/80">{actionTracePreview}</pre>
                </div>
              ) : null}
              {budgetSnapshotPreview ? (
                <div className="min-w-0">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">budget</div>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background/75 p-3 font-mono text-xs leading-5 text-foreground/80">{budgetSnapshotPreview}</pre>
                </div>
              ) : null}
              {payloadPreview ? (
                <div className="min-w-0">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">event payload</div>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background/75 p-3 font-mono text-xs leading-5 text-foreground/80">{payloadPreview}</pre>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}
      </article>
    </div>
  );
}

export const XiaoniActivityPage: React.FC = () => {
  const {
    data: feed,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useQuery<XiaoniActivityFeed>({
    queryKey: ['xiaoni-action-stream'],
    queryFn: async () => {
      const response = await fetch('/api/xiaoni/action-stream?limit=80');
      const payload = await response.json() as ApiResponse<XiaoniActivityFeed>;
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Failed to load action stream');
      }
      return payload.data;
    },
    refetchInterval: 10000,
  });

  const groups = React.useMemo(() => timelineGroups(feed?.items || []), [feed?.items]);

  return (
    <PageShell className="max-w-6xl">
      <PageHeader
        eyebrow="Xiaoni Action Stream"
        title="小腻行动流"
        description="按时间线展示小腻经过的消息、模型、provider、tool 和后台行动。"
        icon={<Activity className="h-5 w-5" />}
        badge={feed ? <PageHeaderBadge>{feed.items.length} Events</PageHeaderBadge> : null}
        actions={
          <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw className={cn('mr-2 h-4 w-4', isFetching && 'animate-spin')} />
            刷新
          </Button>
        }
      />

      <RuntimeStrip feed={feed} isLoading={isLoading} />

      {error ? (
        <ErrorState description={error instanceof Error ? error.message : '加载小腻行动流失败'} onRetry={() => void refetch()} />
      ) : null}

      {isLoading && !feed ? (
        <div className="flex h-64 items-center justify-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="h-7 w-7 animate-spin text-primary" />
          加载行动流...
        </div>
      ) : null}

      {feed && feed.items.length === 0 ? (
        <EmptyState icon={<Bot className="h-10 w-10" />} title="暂无行动事件" description="还没有小腻行动流记录。" />
      ) : null}

      {feed && feed.items.length > 0 ? (
        <div className="relative">
          <div className="absolute bottom-0 left-6 top-0 w-px bg-border md:left-[7.875rem]" />
          <div className="space-y-6">
            {groups.map((group, groupIndex) => (
              <section key={group.day} className="relative space-y-4">
                <div className="sticky top-0 z-20 ml-12 flex md:ml-[9.5rem]">
                  <div className="rounded-full border border-border bg-background/95 px-3 py-1 text-xs font-semibold text-muted-foreground shadow-sm backdrop-blur">
                    {group.day}
                  </div>
                </div>
                {group.items.map((item, itemIndex) => (
                  <TimelineEvent
                    key={item.id}
                    item={item}
                    isLatest={groupIndex === 0 && itemIndex === 0}
                  />
                ))}
              </section>
            ))}
          </div>
        </div>
      ) : null}
    </PageShell>
  );
};
