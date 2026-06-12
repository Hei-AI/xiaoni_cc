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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader, PageHeaderBadge } from '@/components/console/PageHeader';
import { PageShell } from '@/components/console/PageShell';
import { StatusPill } from '@/components/console/StatusPill';
import { EmptyState } from '@/components/console/EmptyState';
import { ErrorState } from '@/components/console/ErrorState';
import { StructuredDataViewer } from '@/components/StructuredDataViewer';
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

interface CompressionForkEvent extends XiaoniActivityFeedItem {}

interface CompressionForkRun {
  id: string;
  forkRunId: string;
  source: string;
  kind: string;
  title: string;
  body: string | null;
  status: string | null;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  traceId: string | null;
  runId: string | null;
  conversationId?: string | null;
  readCutoffAfterConversationId?: string | null;
  previousReadCutoffAfterConversationId?: string | null;
  eventCount: number;
  events: CompressionForkEvent[];
  metadata: Record<string, unknown>;
}

interface CompressionForkTimeline {
  runs: CompressionForkRun[];
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
  compressionForkTimeline?: CompressionForkTimeline;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: string;
}

interface RawTraceTarget {
  eventId: string;
  spanId: string | null;
  title: string;
  subtitle?: string | null;
}

interface RawTraceExchangeSide {
  headers: Record<string, unknown> | null;
  body: string | null;
  bytes: number;
  body_format: string;
  body_source: string;
}

interface RawTraceRequestSide extends RawTraceExchangeSide {
  method: string;
  upstream_url: string | null;
}

interface RawTraceResponseSide extends RawTraceExchangeSide {
  status_code: number | null;
  status_text: string | null;
  error_message: string | null;
}

interface RawTraceData {
  span_id: string | null;
  trace_id: string | null;
  conversation_id: string | null;
  slice_id: string | null;
  llm_call_id: string | null;
  source: string;
  model_name: string | null;
  model_provider: string | null;
  request_format_version: string | null;
  wire_provider_format: string | null;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  request: RawTraceRequestSide;
  response: RawTraceResponseSide;
  action_event?: {
    event_id: string;
    focus_span_id: string | null;
    trace_id: string | null;
  };
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
    case 'compression_fork_llm_request':
      return 'fork LLM';
    case 'compression_fork_item':
      return 'fork stack';
    case 'compression_fork_tool_execution':
      return 'fork tool';
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

function formatRawTraceBytes(value: number | null | undefined) {
  return formatBytes(typeof value === 'number' ? value : null) || '0 B';
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

function formatDurationMs(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null;
  }
  if (value < 1000) {
    return `${value}ms`;
  }
  if (value < 60_000) {
    const seconds = value / 1000;
    return `${seconds < 10 ? seconds.toFixed(1) : seconds.toFixed(0)}s`;
  }
  const minutes = Math.floor(value / 60_000);
  const seconds = Math.round((value % 60_000) / 1000);
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
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

function CompressionForkEventRow({ event }: { event: CompressionForkEvent }) {
  const tone = toneClasses[event.tone] ? event.tone : 'neutral';
  const providerFormat = metadataText(event.metadata, 'providerFormat');
  const inputTokens = formatTokenCount(metadataNumber(event.metadata, 'inputTokens'));
  const cachedInputTokens = formatTokenCount(metadataNumber(event.metadata, 'cachedInputTokens'));
  const outputTokens = formatTokenCount(metadataNumber(event.metadata, 'outputTokens'));
  const toolArgumentsPreview = metadataText(event.metadata, 'toolArgumentsPreview') || metadataText(event.metadata, 'argumentsPreview');
  const toolResultPreview = metadataText(event.metadata, 'toolResultPreview');
  const providerResponsePreview = metadataText(event.metadata, 'providerResponsePreview');
  const payloadPreview = metadataText(event.metadata, 'payloadPreview');
  const previewEntries = [
    toolArgumentsPreview ? ['tool args', toolArgumentsPreview] as const : null,
    toolResultPreview ? ['tool result', toolResultPreview] as const : null,
    providerResponsePreview ? ['LLM response', providerResponsePreview] as const : null,
    payloadPreview ? ['payload', payloadPreview] as const : null,
  ].filter(Boolean) as Array<readonly [string, string]>;

  return (
    <div className="relative pl-9">
      <div
        className={cn(
          'absolute left-0 top-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-background',
          iconClasses[tone]
        )}
      >
        {event.source === 'compression_fork_llm_request' ? (
          <Activity className="h-3.5 w-3.5" />
        ) : (
          <Waypoints className="h-3.5 w-3.5" />
        )}
      </div>
      <div className="border-b border-cyan-100 pb-3 last:border-b-0">
        <div className="flex flex-wrap items-center gap-2">
          <time className="font-mono text-xs font-semibold text-foreground">{formatTimeOnly(event.timestamp)}</time>
          <StatusPill tone="neutral">{sourceLabel(event.source)}</StatusPill>
          {event.status ? <StatusPill tone={statusTone(event.status)}>{statusLabel(event.status)}</StatusPill> : null}
          {providerFormat ? <span className="text-xs text-muted-foreground">{providerFormat}</span> : null}
        </div>
        <div className="mt-1 min-w-0">
          <div className="break-words text-sm font-semibold leading-5 text-foreground">{event.title}</div>
          {event.body ? (
            <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-5 text-foreground/80">{event.body}</p>
          ) : null}
        </div>
        {inputTokens || cachedInputTokens || outputTokens ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {inputTokens ? <StatusPill tone="neutral">Input {inputTokens}</StatusPill> : null}
            {cachedInputTokens ? <StatusPill tone={cachedInputTokens === '0' ? 'neutral' : 'success'}>Cache {cachedInputTokens}</StatusPill> : null}
            {outputTokens ? <StatusPill tone="neutral">Output {outputTokens}</StatusPill> : null}
          </div>
        ) : null}
        {previewEntries.length ? (
          <div className="mt-3 grid gap-2 lg:grid-cols-2">
            {previewEntries.map(([label, value]) => (
              <details key={label} className="min-w-0">
                <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  {label}
                </summary>
                <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background/80 p-3 font-mono text-xs leading-5 text-foreground/80">{value}</pre>
              </details>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CompressionForkTimelineRail({ timeline }: { timeline?: CompressionForkTimeline }) {
  const runs = timeline?.runs || [];
  if (!runs.length) {
    return null;
  }

  return (
    <section className="rounded-lg border border-cyan-200 bg-cyan-50/40 px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-cyan-100 text-cyan-700">
            <Waypoints className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">Compress Fork</h2>
            <div className="text-xs text-muted-foreground">
              {runs[0]?.startedAt ? formatTimestamp(runs[0].startedAt) : '-'}
            </div>
          </div>
        </div>
        <StatusPill tone="info">{runs.length} Forks</StatusPill>
      </div>

      <div className="mt-4 space-y-4">
        {runs.map((run) => {
          const duration = formatDurationMs(run.durationMs);
          return (
            <article key={run.id} className="rounded-lg border border-cyan-200/80 bg-background/85 p-4 shadow-sm">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill tone={statusTone(run.status)}>{statusLabel(run.status) || 'fork'}</StatusPill>
                    {duration ? <StatusPill tone="neutral">{duration}</StatusPill> : null}
                    <StatusPill tone="neutral">{run.eventCount} steps</StatusPill>
                  </div>
                  <h3 className="mt-2 break-words text-base font-semibold leading-6 text-foreground">{run.title}</h3>
                  {run.body ? (
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-5 text-foreground/80">{run.body}</p>
                  ) : null}
                </div>
                <div className="shrink-0 text-left text-xs text-muted-foreground lg:text-right">
                  <div>
                    <span className="font-medium text-foreground">start</span> {formatTimestamp(run.startedAt)}
                  </div>
                  <div>
                    <span className="font-medium text-foreground">end</span> {run.completedAt ? formatTimestamp(run.completedAt) : 'running'}
                  </div>
                  {run.readCutoffAfterConversationId ? (
                    <div className="font-mono">cutoff {run.previousReadCutoffAfterConversationId || '-'} - {run.readCutoffAfterConversationId}</div>
                  ) : null}
                </div>
              </div>

              <div className="relative mt-4">
                <div className="absolute bottom-3 left-3 top-3 w-px bg-cyan-200" />
                <div className="space-y-3">
                  {run.events.length ? (
                    run.events.map((event) => (
                      <CompressionForkEventRow key={event.id} event={event} />
                    ))
                  ) : (
                    <div className="pl-9 text-sm text-muted-foreground">暂无 Fork 步骤记录</div>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

async function fetchRawTrace(target: RawTraceTarget): Promise<RawTraceData> {
  const params = new URLSearchParams();
  if (target.spanId) {
    params.set('spanId', target.spanId);
  }
  const query = params.toString();
  const response = await fetch(
    `/api/xiaoni/action-stream/events/${encodeURIComponent(target.eventId)}/raw-trace${query ? `?${query}` : ''}`
  );
  const payload = await response.json() as ApiResponse<RawTraceData>;
  if (!response.ok || !payload.success) {
    throw new Error(payload.error || 'Failed to load raw trace');
  }
  return payload.data;
}

function RawTraceExchangePane({
  kind,
  data,
}: {
  kind: 'request' | 'response';
  data: RawTraceRequestSide | RawTraceResponseSide;
}) {
  const isRequest = kind === 'request';
  const meta = [
    isRequest ? (data as RawTraceRequestSide).method : null,
    !isRequest && (data as RawTraceResponseSide).status_code !== null ? `HTTP ${(data as RawTraceResponseSide).status_code}` : null,
    !isRequest && (data as RawTraceResponseSide).status_text ? (data as RawTraceResponseSide).status_text : null,
    data.body_format,
    formatRawTraceBytes(data.bytes),
  ].filter(Boolean) as string[];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {meta.map((item) => (
          <StatusPill key={item} tone="neutral">{item}</StatusPill>
        ))}
        {isRequest && (data as RawTraceRequestSide).upstream_url ? (
          <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">{(data as RawTraceRequestSide).upstream_url}</span>
        ) : null}
        {!isRequest && (data as RawTraceResponseSide).error_message ? (
          <StatusPill tone="danger">{(data as RawTraceResponseSide).error_message}</StatusPill>
        ) : null}
      </div>

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)]">
        <StructuredDataViewer
          title={isRequest ? 'Request Headers' : 'Response Headers'}
          value={data.headers}
          emptyLabel={isRequest ? '无请求头' : '无响应头'}
          heightClassName="h-[18rem] xl:h-[calc(100vh-17rem)]"
        />
        <StructuredDataViewer
          title={isRequest ? 'Request Body' : 'Response Body'}
          value={data.body}
          emptyLabel={isRequest ? '无请求体' : '无响应体'}
          heightClassName="h-[calc(100vh-24rem)] min-h-[24rem] xl:h-[calc(100vh-17rem)]"
          rawText
          notice={<span className="font-mono">{data.body_source}</span>}
        />
      </div>
    </div>
  );
}

function RawTraceDialog({
  target,
  onOpenChange,
}: {
  target: RawTraceTarget | null;
  onOpenChange: (open: boolean) => void;
}) {
  const rawTraceQuery = useQuery<RawTraceData>({
    queryKey: ['xiaoni-action-stream-raw-trace', target?.eventId || null, target?.spanId || null],
    queryFn: () => {
      if (!target) {
        throw new Error('Missing raw trace target');
      }
      return fetchRawTrace(target);
    },
    enabled: Boolean(target),
    staleTime: 0,
  });

  const data = rawTraceQuery.data;
  const headerBadges = data
    ? [
        data.model_name,
        data.model_provider,
        data.wire_provider_format,
        data.request_format_version,
        data.llm_call_id ? `llm ${data.llm_call_id}` : null,
        data.slice_id ? `slice ${data.slice_id}` : null,
      ].filter(Boolean) as string[]
    : [];

  return (
    <Dialog open={Boolean(target)} onOpenChange={onOpenChange}>
      <DialogContent className="h-[calc(100vh-2rem)] max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-[96rem] gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-5 py-4 pr-12">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <DialogTitle className="truncate">{target?.title || 'Raw Trace'}</DialogTitle>
              <DialogDescription className="mt-2 break-all font-mono">
                {target?.spanId || data?.span_id || data?.action_event?.focus_span_id || 'provider exchange'}
              </DialogDescription>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              {headerBadges.map((item) => (
                <StatusPill key={item} tone="neutral">{item}</StatusPill>
              ))}
            </div>
          </div>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col px-5 py-4">
          {rawTraceQuery.isLoading ? (
            <div className="flex min-h-0 flex-1 items-center justify-center gap-3 text-sm text-muted-foreground">
              <Loader2 className="h-7 w-7 animate-spin text-primary" />
              加载 raw trace...
            </div>
          ) : null}

          {rawTraceQuery.error ? (
            <div className="flex min-h-0 flex-1 items-center justify-center">
              <ErrorState
                description={rawTraceQuery.error instanceof Error ? rawTraceQuery.error.message : '加载 raw trace 失败'}
                onRetry={() => void rawTraceQuery.refetch()}
              />
            </div>
          ) : null}

          {data ? (
            <Tabs defaultValue="request" className="flex min-h-0 flex-1 flex-col">
              <TabsList className="shrink-0">
                <TabsTrigger value="request">Request</TabsTrigger>
                <TabsTrigger value="response">Response</TabsTrigger>
              </TabsList>
              <TabsContent value="request" className="mt-4 flex min-h-0 flex-1 flex-col">
                <RawTraceExchangePane kind="request" data={data.request} />
              </TabsContent>
              <TabsContent value="response" className="mt-4 flex min-h-0 flex-1 flex-col">
                <RawTraceExchangePane kind="response" data={data.response} />
              </TabsContent>
            </Tabs>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TimelineEvent({
  item,
  isLatest,
  onOpenRawTrace,
}: {
  item: XiaoniActivityFeedItem;
  isLatest: boolean;
  onOpenRawTrace: (target: RawTraceTarget) => void;
}) {
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

          {traceTarget && (item.eventId || item.id) ? (
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => {
                onOpenRawTrace({
                  eventId: item.eventId || item.id,
                  spanId: providerRequestSpanId || traceTarget.spanId || spanId,
                  title: item.title,
                  subtitle: item.traceId,
                });
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
  const [rawTraceTarget, setRawTraceTarget] = React.useState<RawTraceTarget | null>(null);
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
  const forkCount = feed?.compressionForkTimeline?.runs.length || 0;
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

  const handleRawTraceOpenChange = React.useCallback((open: boolean) => {
    if (!open) {
      setRawTraceTarget(null);
    }
  }, []);

  return (
    <PageShell className="max-w-6xl">
      <PageHeader
        eyebrow="Xiaoni Action Stream"
        title="小腻行动流"
        description="按时间线展示小腻看到的消息、调用的工具、发出的内容、休息状态、后台行动和 Compress Fork。"
        icon={<Activity className="h-5 w-5" />}
        badge={feed ? <PageHeaderBadge>{feed.items.length} Events · {forkCount} Forks · {rangeBadge}</PageHeaderBadge> : null}
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

      {feed ? <CompressionForkTimelineRail timeline={feed.compressionForkTimeline} /> : null}

      {error ? (
        <ErrorState description={error instanceof Error ? error.message : '加载小腻行动流失败'} onRetry={() => void refetch()} />
      ) : null}

      {isLoading && !feed ? (
        <div className="flex h-64 items-center justify-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="h-7 w-7 animate-spin text-primary" />
          加载行动流...
        </div>
      ) : null}

      {feed && feed.items.length === 0 && forkCount === 0 ? (
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
                    onOpenRawTrace={setRawTraceTarget}
                  />
                ))}
              </section>
            ))}
          </div>
        </div>
      ) : null}

      <RawTraceDialog target={rawTraceTarget} onOpenChange={handleRawTraceOpenChange} />
    </PageShell>
  );
};
