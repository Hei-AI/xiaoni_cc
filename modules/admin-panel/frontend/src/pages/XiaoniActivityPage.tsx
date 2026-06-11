import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  Bot,
  Calendar,
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
import { Input } from '@/components/ui/input';
import { PageHeader, PageHeaderBadge } from '@/components/console/PageHeader';
import { PageShell } from '@/components/console/PageShell';
import { StatusPill } from '@/components/console/StatusPill';
import { EmptyState } from '@/components/console/EmptyState';
import { ErrorState } from '@/components/console/ErrorState';
import { cn, formatDateOnly, formatIsoOffset, formatTimeOnly, formatTimestamp } from '@/lib/utils';

type ActivityTone = 'xiaoni' | 'success' | 'warning' | 'danger' | 'info' | 'neutral' | string;
type TimeRange = '1h' | '6h' | '24h' | '7d' | '30d' | 'custom' | 'all';

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
    llmRequestSliceId?: string | null;
    toolCallId?: string | null;
    stackItemId?: string | null;
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
  filters?: {
    range?: string;
    startTime?: string | null;
    endTime?: string | null;
  };
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
      latestConsciousnessTickAt: string | null;
      latestConsciousnessTickStatus: string | null;
      latestPhoneNotificationAt: string | null;
      latestPhoneNotificationStatus: string | null;
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

const TIME_RANGE_OPTIONS: Array<{ value: TimeRange; label: string }> = [
  { value: '1h', label: '1h' },
  { value: '6h', label: '6h' },
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: 'all', label: '全部' },
  { value: 'custom', label: '自定义' },
];

const TIME_RANGE_DURATION_MS: Partial<Record<TimeRange, number>> = {
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

function coerceTimeRange(value: string | null): TimeRange {
  return TIME_RANGE_OPTIONS.some((option) => option.value === value)
    ? value as TimeRange
    : '24h';
}

function timeRangeLabel(value: TimeRange) {
  return TIME_RANGE_OPTIONS.find((option) => option.value === value)?.label || value;
}

function formatDateTimeLocal(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
  ].join('T');
}

function defaultCustomWindow(sourceRange: TimeRange) {
  const now = new Date();
  const durationMs = TIME_RANGE_DURATION_MS[sourceRange] ?? TIME_RANGE_DURATION_MS['24h'] ?? 24 * 60 * 60 * 1000;
  return {
    startTime: formatDateTimeLocal(new Date(now.getTime() - durationMs)),
    endTime: formatDateTimeLocal(now),
  };
}

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
  if (item.source === 'tool_execution') return <Waypoints className="h-4 w-4" />;
  if (item.source === 'llm_stack_item') return <Waypoints className="h-4 w-4" />;
  if (item.source === 'llm_request') return <Activity className="h-4 w-4" />;
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
    case 'tool_execution':
      return 'tool';
    case 'llm_request':
      return 'LLM';
    case 'llm_stack_item':
      return 'stack';
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

function formatPayloadSize(requestBytes: string | null, responseBytes: string | null) {
  if (requestBytes && responseBytes) {
    return `${requestBytes} -> ${responseBytes}`;
  }
  return requestBytes || responseBytes;
}

function formatTokenCount(value: number | null) {
  if (value === null || value < 0) {
    return null;
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return String(value);
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
  const latestTool = feed?.items.find((item) => item.source === 'tool_execution');
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
          stream <span className="font-medium text-foreground">{feed?.current.latestActivityAt ? formatTimestamp(feed.current.latestActivityAt) : '-'}</span>
        </span>
        <span className="text-muted-foreground">
          手机通知 <span className="font-medium text-foreground">{autonomy?.latestPhoneNotificationAt ? formatTimestamp(autonomy.latestPhoneNotificationAt) : '-'}</span>
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

function TimeRangeControls({
  range,
  startTime,
  endTime,
  onRangeChange,
  onCustomTimeChange,
}: {
  range: TimeRange;
  startTime: string;
  endTime: string;
  onRangeChange: (range: TimeRange) => void;
  onCustomTimeChange: (key: 'start_time' | 'end_time', value: string) => void;
}) {
  return (
    <section className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {TIME_RANGE_OPTIONS.map((option) => (
            <Button
              key={option.value}
              variant={range === option.value ? 'default' : 'outline'}
              size="sm"
              onClick={() => onRangeChange(option.value)}
              className="h-8 px-3"
            >
              {option.value === 'custom' ? <Calendar className="mr-2 h-4 w-4" /> : null}
              {option.label}
            </Button>
          ))}
        </div>
        {range === 'custom' ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              type="datetime-local"
              step="1"
              value={startTime}
              onChange={(event) => onCustomTimeChange('start_time', event.target.value)}
              className="sm:w-56"
            />
            <span className="text-sm text-muted-foreground">至</span>
            <Input
              type="datetime-local"
              step="1"
              value={endTime}
              onChange={(event) => onCustomTimeChange('end_time', event.target.value)}
              className="sm:w-56"
            />
          </div>
        ) : null}
      </div>
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
  const providerRequestBytes = formatBytes(metadataNumber(item.metadata, 'providerRequestBytes'));
  const providerResponseBytes = formatBytes(metadataNumber(item.metadata, 'providerResponseBytes'));
  const providerFormat = metadataText(item.metadata, 'providerFormat');
  const payloadSize = formatPayloadSize(providerRequestBytes, providerResponseBytes);
  const spanId = metadataText(item.metadata, 'spanId');
  const providerRequestSpanId = metadataText(item.metadata, 'providerRequestSpanId');
  const inputTokens = formatTokenCount(metadataNumber(item.metadata, 'inputTokens'));
  const cachedInputTokens = formatTokenCount(metadataNumber(item.metadata, 'cachedInputTokens'));
  const outputTokens = formatTokenCount(metadataNumber(item.metadata, 'outputTokens'));
  const actionTracePreview = metadataText(item.metadata, 'actionTracePreview');
  const budgetSnapshotPreview = metadataText(item.metadata, 'budgetSnapshotPreview');
  const payloadPreview = metadataText(item.metadata, 'payloadPreview');
  const interestCandidatesPreview = metadataText(item.metadata, 'interestCandidatesPreview');
  const decisionLlmCallId = metadataText(item.metadata, 'decisionLlmCallId');
  const searchLlmCallId = metadataText(item.metadata, 'searchLlmCallId');
  const sourceActionId = metadataText(item.metadata, 'sourceActionId') || metadataText(item.metadata, 'actionId');
  const traceTarget = item.traceTarget || null;
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
              {item.source === 'llm_request' && payloadSize ? <span>payload {payloadSize}</span> : null}
            </div>
          </div>

          {traceTarget?.internalExecutionLeaseId && (item.eventId || item.id) ? (
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => {
                const focusSpanId = providerRequestSpanId || traceTarget.spanId;
                navigate(`/xiaoni/action-stream/events/${encodeURIComponent(item.eventId || item.id)}/trace${focusSpanId ? `?spanId=${encodeURIComponent(focusSpanId)}` : ''}`);
              }}
            >
              <Waypoints className="mr-2 h-4 w-4" />
              Raw Trace
            </Button>
          ) : null}
        </div>

        {inputTokens || cachedInputTokens || outputTokens ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {inputTokens ? <StatusPill tone="neutral">Input {inputTokens}</StatusPill> : null}
            {cachedInputTokens ? <StatusPill tone={cachedInputTokens === '0' ? 'neutral' : 'success'}>Cache {cachedInputTokens}</StatusPill> : null}
            {outputTokens ? <StatusPill tone="neutral">Output {outputTokens}</StatusPill> : null}
          </div>
        ) : null}

        {item.body ? (
          <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-foreground/90">{item.body}</p>
        ) : null}

        {item.source === 'llm_request' && responsePreview ? (
          <section className="mt-4 border-t border-border/70 pt-3">
            <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              <Bot className="h-3.5 w-3.5" />
              <span>LLM response</span>
            </div>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background/80 p-3 font-mono text-xs leading-5 text-foreground/90">{responsePreview}</pre>
          </section>
        ) : null}

        {inContextPreview ? (
          <details className="mt-4 border-t border-border/70 pt-3">
            <summary className="flex cursor-pointer items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              <Bot className="h-3.5 w-3.5" />
              <span>{item.source === 'llm_request' ? 'LLM context' : '对应 LLM context'}</span>
            </summary>
            <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background/75 p-3 font-mono text-xs leading-5 text-foreground/80">{inContextPreview}</pre>
          </details>
        ) : null}

        {toolArgumentsPreview || toolResultPreview || (responsePreview && item.source !== 'llm_request') ? (
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
              {responsePreview && item.source !== 'llm_request' ? (
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
  const [searchParams, setSearchParams] = useSearchParams();
  const timeRange = coerceTimeRange(searchParams.get('range'));
  const startTime = searchParams.get('start_time') || '';
  const endTime = searchParams.get('end_time') || '';
  const {
    data: feed,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useQuery<XiaoniActivityFeed>({
    queryKey: ['xiaoni-action-stream', timeRange, startTime, endTime],
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: '80',
        range: timeRange,
      });
      if (timeRange === 'custom') {
        if (startTime) {
          params.set('start_time', formatIsoOffset(startTime, { fallback: startTime }));
        }
        if (endTime) {
          params.set('end_time', formatIsoOffset(endTime, { fallback: endTime }));
        }
      }
      const response = await fetch(`/api/xiaoni/action-stream?${params}`);
      const payload = await response.json() as ApiResponse<XiaoniActivityFeed>;
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Failed to load action stream');
      }
      return payload.data;
    },
    refetchInterval: 10000,
  });

  const groups = React.useMemo(() => timelineGroups(feed?.items || []), [feed?.items]);
  const rangeBadge = timeRange === 'custom'
    ? [startTime || '开始', endTime || '现在'].join(' - ')
    : timeRangeLabel(timeRange);

  const updateSearchParam = React.useCallback((mutator: (params: URLSearchParams) => void) => {
    const nextParams = new URLSearchParams(searchParams);
    mutator(nextParams);
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams]);

  const handleRangeChange = React.useCallback((nextRange: TimeRange) => {
    updateSearchParam((nextParams) => {
      nextParams.set('range', nextRange);
      if (nextRange === 'custom') {
        const defaults = defaultCustomWindow(timeRange);
        if (!nextParams.get('start_time')) {
          nextParams.set('start_time', defaults.startTime);
        }
        if (!nextParams.get('end_time')) {
          nextParams.set('end_time', defaults.endTime);
        }
      } else {
        nextParams.delete('start_time');
        nextParams.delete('end_time');
      }
    });
  }, [timeRange, updateSearchParam]);

  const handleCustomTimeChange = React.useCallback((key: 'start_time' | 'end_time', value: string) => {
    updateSearchParam((nextParams) => {
      nextParams.set('range', 'custom');
      if (value) {
        nextParams.set(key, value);
      } else {
        nextParams.delete(key);
      }
    });
  }, [updateSearchParam]);

  return (
    <PageShell className="max-w-4xl">
      <PageHeader
        eyebrow="Xiaoni Action Stream"
        title="小腻行动流"
        description="按时间线展示小腻看到的消息、调用的工具、发出的内容、休息状态和后台行动。"
        icon={<Activity className="h-5 w-5" />}
        badge={feed ? <PageHeaderBadge>{feed.items.length} Events · {rangeBadge}</PageHeaderBadge> : null}
        actions={
          <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw className={cn('mr-2 h-4 w-4', isFetching && 'animate-spin')} />
            刷新
          </Button>
        }
      />

      <RuntimeStrip feed={feed} isLoading={isLoading} />
      <TimeRangeControls
        range={timeRange}
        startTime={startTime}
        endTime={endTime}
        onRangeChange={handleRangeChange}
        onCustomTimeChange={handleCustomTimeChange}
      />

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
