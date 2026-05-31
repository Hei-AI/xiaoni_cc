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
  title: string;
  body: string | null;
  status: string | null;
  actor: string | null;
  actorName: string | null;
  timestamp: string;
  sessionKey: string | null;
  peerName: string | null;
  runId: string | null;
  traceId: string | null;
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
  selfActionBusy: boolean;
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
      processing: number;
      staleProcessing: number;
      failed: number;
    };
    digitalActions: {
      planned: number;
      processing: number;
      completed: number;
      failed: number;
    };
    autonomy: {
      latestPresenceTickAt: string | null;
      latestPresenceTickStatus: string | null;
      latestProactiveImOpenAt: string | null;
      latestProactiveImOpenStatus: string | null;
      latestSelfActionAt: string | null;
      latestSelfActionStatus: string | null;
      latestSelfActionKind: string | null;
    };
    tasks: {
      pending: number;
      processing: number;
      completed: number;
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
  if (['healthy', 'completed', 'observed', 'active_surface'].includes(value)) {
    return 'success';
  }
  if (['processing', 'planned', 'pending', 'degraded', 'stale_processing'].includes(value)) {
    return 'warning';
  }
  if (['failed', 'offline', 'blocked'].includes(value)) {
    return 'danger';
  }
  return 'info';
}

function itemIcon(item: XiaoniActivityFeedItem) {
  if (item.source === 'tool_call') return <Waypoints className="h-4 w-4" />;
  if (item.source === 'llm_call') return <Bot className="h-4 w-4" />;
  if (item.source === 'digital_action') return <Search className="h-4 w-4" />;
  if (item.source === 'task') return <Sparkles className="h-4 w-4" />;
  if (item.source === 'media_observation') return <Image className="h-4 w-4" />;
  if (item.source === 'queue_message') return <Clock3 className="h-4 w-4" />;
  if (item.kind === 'qq_message_seen') return <Eye className="h-4 w-4" />;
  if (item.kind === 'speak_in_group' || item.kind === 'qq_self_message') return <MessageCircle className="h-4 w-4" />;
  if (item.kind === 'terminal_action_blocked') return <AlertTriangle className="h-4 w-4" />;
  return <Bot className="h-4 w-4" />;
}

function sourceLabel(source: string) {
  switch (source) {
    case 'life_event':
      return 'life';
    case 'tool_call':
      return 'tool';
    case 'llm_call':
      return 'LLM';
    case 'digital_action':
      return 'digital';
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
    runtime.workerBusy && 'run',
    runtime.taskWorkerBusy && 'task',
    runtime.presenceTickBusy && 'presence',
    runtime.selfActionBusy && 'self-action',
  ].filter(Boolean);
  return busy.length ? busy.join(' / ') : 'idle';
}

function metadataText(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
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
  const digital = feed?.current.digitalActions;
  const autonomy = feed?.current.autonomy;
  const latestTool = feed?.items.find((item) => item.source === 'tool_call');

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
          Agent {runtime?.timestamp ? formatTimestamp(runtime.timestamp) : runtime?.errorMessage || 'pending'}
        </span>
        <span className="text-muted-foreground">
          最近 tool <span className="font-medium text-foreground">{latestTool?.kind || '-'}</span>
        </span>
        <span className="text-muted-foreground">
          queue <span className="font-medium text-foreground">{(queue?.pending || 0) + (queue?.processing || 0)}</span>
          {queue?.staleProcessing ? <span className="ml-1 text-amber-700">stale {queue.staleProcessing}</span> : null}
        </span>
        <span className="text-muted-foreground">
          background <span className="font-medium text-foreground">{(tasks?.pending || 0) + (tasks?.processing || 0) + (digital?.planned || 0) + (digital?.processing || 0)}</span>
        </span>
        <span className="text-muted-foreground">
          自主 <span className="font-medium text-foreground">{autonomy?.latestPresenceTickAt ? formatTimestamp(autonomy.latestPresenceTickAt) : '-'}</span>
        </span>
        <span className="text-muted-foreground">
          主动 IM <span className="font-medium text-foreground">{autonomy?.latestProactiveImOpenAt ? formatTimestamp(autonomy.latestProactiveImOpenAt) : '-'}</span>
        </span>
      </div>
    </section>
  );
}

function TimelineEvent({ item, isLatest }: { item: XiaoniActivityFeedItem; isLatest: boolean }) {
  const navigate = useNavigate();
  const tone = toneClasses[item.tone] ? item.tone : 'neutral';
  const inContextPreview = metadataText(item.metadata, 'inContextPreview');
  const toolArgumentsPreview = metadataText(item.metadata, 'toolArgumentsPreview');
  const toolResultPreview = metadataText(item.metadata, 'toolResultPreview');
  const responsePreview = metadataText(item.metadata, 'responsePreview');
  const spanId = metadataText(item.metadata, 'spanId');
  const actionTracePreview = metadataText(item.metadata, 'actionTracePreview');
  const budgetSnapshotPreview = metadataText(item.metadata, 'budgetSnapshotPreview');
  const payloadPreview = metadataText(item.metadata, 'payloadPreview');
  const interestCandidatesPreview = metadataText(item.metadata, 'interestCandidatesPreview');
  const decisionLlmCallId = metadataText(item.metadata, 'decisionLlmCallId');
  const searchLlmCallId = metadataText(item.metadata, 'searchLlmCallId');
  const sourceActionId = metadataText(item.metadata, 'sourceActionId') || metadataText(item.metadata, 'actionId');
  const hasActionTrace = Boolean(actionTracePreview || budgetSnapshotPreview || payloadPreview || interestCandidatesPreview || decisionLlmCallId || searchLlmCallId || sourceActionId);

  return (
    <div className="relative md:grid md:grid-cols-[7rem_minmax(0,1fr)] md:gap-6">
      <div className="hidden pt-4 text-right md:block">
        <time className="block font-mono text-sm font-semibold text-foreground">{formatTimeOnly(item.timestamp)}</time>
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
          {item.status ? <StatusPill tone={statusTone(item.status)}>{item.status}</StatusPill> : null}
          <time className="text-xs text-muted-foreground md:hidden">{formatTimestamp(item.timestamp)}</time>
        </div>

        <div className="mt-3 flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h2 className="break-words text-base font-semibold leading-6 text-foreground">{item.title}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {item.peerName ? <span>{item.peerName}</span> : null}
              {item.actorName ? <span>{item.actorName}</span> : null}
              {item.runId ? <span className="font-mono">{item.runId}</span> : null}
              {spanId ? <span className="font-mono">{spanId}</span> : null}
            </div>
          </div>

          {item.runId ? (
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => navigate(`/runs/${item.runId}/trace${spanId ? `?spanId=${encodeURIComponent(spanId)}` : ''}`)}
            >
              <Waypoints className="mr-2 h-4 w-4" />
              Trace
            </Button>
          ) : null}
        </div>

        {item.body ? (
          <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-foreground/90">{item.body}</p>
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
    queryKey: ['xiaoni-activity-feed'],
    queryFn: async () => {
      const response = await fetch('/api/agent-runtime/activity-feed?limit=80');
      const payload = await response.json() as ApiResponse<XiaoniActivityFeed>;
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Failed to load activity feed');
      }
      return payload.data;
    },
    refetchInterval: 10000,
  });

  const groups = React.useMemo(() => timelineGroups(feed?.items || []), [feed?.items]);

  return (
    <PageShell className="max-w-6xl">
      <PageHeader
        eyebrow="Xiaoni Runtime"
        title="小腻在干嘛"
        description="按时间线串起真实 trace：LLM in_context、action/tool、结果和跳转。"
        icon={<Activity className="h-5 w-5" />}
        badge={feed ? <PageHeaderBadge>{feed.items.length} Items</PageHeaderBadge> : null}
        actions={
          <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw className={cn('mr-2 h-4 w-4', isFetching && 'animate-spin')} />
            刷新
          </Button>
        }
      />

      <RuntimeStrip feed={feed} isLoading={isLoading} />

      {error ? (
        <ErrorState description={error instanceof Error ? error.message : '加载小腻活动失败'} onRetry={() => void refetch()} />
      ) : null}

      {isLoading && !feed ? (
        <div className="flex h-64 items-center justify-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="h-7 w-7 animate-spin text-primary" />
          加载活动流...
        </div>
      ) : null}

      {feed && feed.items.length === 0 ? (
        <EmptyState icon={<Bot className="h-10 w-10" />} title="暂无活动" description="还没有小腻活动记录。" />
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
