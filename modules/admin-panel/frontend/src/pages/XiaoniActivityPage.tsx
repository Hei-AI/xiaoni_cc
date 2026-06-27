import React from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Bot,
  Calendar,
  ChevronsDown,
  Loader2,
  RefreshCw,
  Search,
  Tags,
  Waypoints,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeaderBadge } from '@/components/console/PageHeader';
import { PageShell } from '@/components/console/PageShell';
import { StatusPill } from '@/components/console/StatusPill';
import { EmptyState } from '@/components/console/EmptyState';
import { ErrorState } from '@/components/console/ErrorState';
import { StructuredDataViewer } from '@/components/StructuredDataViewer';
import { calculateUsageChartWheelWindow } from '@/lib/usage-chart-wheel';
import { cn, formatDateOnly, formatDateTimeCompact, formatIsoOffset, formatTimeOnly, formatTimestamp, parseTimestampValue } from '@/lib/utils';
import {
  ACTION_STREAM_REFRESH_OPTIONS,
  ActionStreamRefreshValue,
  coerceActionStreamRefresh,
  DEFAULT_ACTION_STREAM_REFRESH,
  getActionStreamRefreshInterval,
} from '@/lib/xiaoni-action-stream-refresh';
import {
  ActionStreamTagOption,
  mergeSelectedActionStreamTags,
  parseActionStreamTagParam,
  serializeActionStreamTags,
  toggleActionStreamTag,
} from '@/lib/xiaoni-action-stream-tags';

type ActivityTone = 'xiaoni' | 'success' | 'warning' | 'danger' | 'info' | 'neutral' | string;
type TimeRange = '1h' | '6h' | '24h' | '7d' | '30d' | 'custom' | 'all';
type UsageBucket = 'call' | 'hour' | 'day' | 'month';

const ACTION_STREAM_PAGE_SIZE = 80;

// CC 订阅账号额度（事实来自 /api/cc-usage/*，源头是 anthropic-ratelimit-unified-* 响应头）。
// 5h / 周窗口的实时条放在行动流顶层，utilization 折线图与 LLM Cost 共用同一时间轴。
interface CcQuotaWindow {
  utilization: number | null;
  remaining: number | null;
  status: string | null;
  resetEpoch: number | null;
  resetAt: string | null;
}

interface CcQuotaSnapshot {
  provider: string;
  capturedAt: string | null;
  modelName: string | null;
  status: string | null;
  windows: { fiveHour: CcQuotaWindow; weekly: CcQuotaWindow };
}

interface CcQuotaTimelinePoint {
  timestamp: string | null;
  util5h: number | null;
  util7d: number | null;
  status5h: string | null;
  status7d: string | null;
}

interface CcQuotaTimelineResult {
  provider: string;
  generatedAt: string;
  window: { startTime: string; endTime: string };
  limit: number;
  truncated: boolean;
  points: CcQuotaTimelinePoint[];
}

function ccStatusBarClass(status: string | null | undefined): string {
  if (status === 'rejected') {
    return 'bg-red-500';
  }
  if (status === 'allowed_warning') {
    return 'bg-amber-500';
  }
  return 'bg-primary';
}

// 行动流顶层那条「自动刷新」行里的额度水平条：标签 + 进度条 + 已用百分比。
function QuotaMiniBar({ label, win }: { label: string; win: CcQuotaWindow | undefined }) {
  const utilization = win?.utilization ?? null;
  const pct = utilization === null ? 0 : Math.round(utilization * 100);
  const barWidth = utilization === null ? 0 : Math.min(100, Math.max(pct, 2));
  const resetAt = win?.resetAt ?? null;
  return (
    <div
      className="flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs shadow-sm"
      title={`额度 ${label}${win?.status ? ` · ${win.status}` : ''}${resetAt ? ` · 重置 ${formatTimestamp(resetAt)}` : ''}`}
    >
      <span className="whitespace-nowrap font-medium text-muted-foreground">{label}</span>
      <div className="h-2 w-16 overflow-hidden rounded-full bg-muted sm:w-24">
        <div
          className={cn('h-full rounded-full transition-all', ccStatusBarClass(win?.status))}
          style={{ width: `${barWidth}%` }}
        />
      </div>
      <span className="tabular-nums text-foreground">{utilization === null ? '—' : `${pct}%`}</span>
      {resetAt ? (
        <span className="whitespace-nowrap text-muted-foreground">重置 {formatTimeOnly(resetAt)}</span>
      ) : null}
    </div>
  );
}

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
    sourceKind?: string | null;
    forkRunId?: string | null;
  } | null;
  tone: ActivityTone;
  metadata: Record<string, unknown>;
  tags?: ActionStreamTagOption[];
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
  tags?: ActionStreamTagOption[];
}

interface CompressionForkTimeline {
  runs: CompressionForkRun[];
}

type ForkAgentRun = CompressionForkRun & {
  forkKind?: string;
  agentLabel?: string;
};

type StreamLane = 'main' | 'fork';

interface StreamForkRef {
  runId: string;
  kind: string;
  label: string;
}

// A single atomic timeline event. Fork runs are flattened into one entry per
// internal step (plus a synthesized trigger entry) so a fork reads exactly like
// the main agent, interleaved by timestamp.
interface StreamEntry {
  id: string;
  lane: StreamLane;
  timestamp: string;
  item: XiaoniActivityFeedItem;
  fork: StreamForkRef | null;
}

interface ForkRosterEntry {
  runId: string;
  kind: string;
  label: string;
  count: number;
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
    tags?: string[];
  };
  availableTags?: ActionStreamTagOption[];
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
  pagination?: {
    limit: number;
    hasMore: boolean;
    nextCursor: string | null;
  };
  items: XiaoniActivityFeedItem[];
  compressionForkTimeline?: CompressionForkTimeline;
  subconsciousForkTimeline?: CompressionForkTimeline;
  cacheHeartbeatTimeline?: CompressionForkTimeline;
  imageVisionForkTimeline?: CompressionForkTimeline;
}

interface XiaoniLlmUsagePoint {
  key: string;
  timestamp: string;
  bucketStart: string | null;
  bucketEnd: string | null;
  callCount: number;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheRatio: number | null;
  sourceKind?: string | null;
  forkRunId?: string | null;
  anchorEventId: string | null;
  llmRequestSliceId: string | null;
  llmCallId: string | null;
  traceId: string | null;
  topEvent: {
    eventId: string;
    llmRequestSliceId: string;
    sourceKind?: string | null;
    forkRunId?: string | null;
    timestamp: string | null;
    inputTokens: number;
    cachedTokens: number;
    outputTokens: number;
  } | null;
}

interface XiaoniLlmUsagePeak {
  timestamp: string;
  label: string;
  severity: 'info' | 'warning' | string;
  anchorEventId: string | null;
  llmRequestSliceId: string | null;
  reason: string;
}

interface XiaoniLlmUsageSearchHit {
  timestamp: string;
  label: string;
  severity: 'info' | 'warning' | string;
  anchorEventId: string | null;
  llmRequestSliceId: string | null;
  llmCallId: string | null;
  traceId: string | null;
  sourceKind?: string | null;
  forkRunId?: string | null;
  field: string | null;
  query: string;
  snippet: string | null;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
}

interface XiaoniLlmUsageTimeline {
  identityKey: string;
  generatedAt: string;
  timezone: string;
  requestedBucket: UsageBucket;
  bucket: UsageBucket;
  maxPoints: number;
  downsampled: boolean;
  warnings: string[];
  window: {
    startTime: string | null;
    endTime: string | null;
  };
  dataBounds: {
    firstAt: string | null;
    lastAt: string | null;
  };
  summary: {
    callCount: number;
    inputTokens: number;
    cachedTokens: number;
    outputTokens: number;
    totalTokens: number;
    cacheRatio: number | null;
    peakInputTokens: number;
    peakOutputTokens: number;
  };
  points: XiaoniLlmUsagePoint[];
  peaks: XiaoniLlmUsagePeak[];
  overlays?: {
    eventDensity?: unknown[];
    toolDensity?: unknown[];
    runtimeBands?: unknown[];
    compressionForkBands?: unknown[];
    searchHits?: XiaoniLlmUsageSearchHit[];
  };
  filters?: {
    range?: string;
    startTime?: string | null;
    endTime?: string | null;
  };
}

interface UsageChartPoint extends XiaoniLlmUsagePoint {
  timestampMs: number;
  chartLabel: string;
}

interface UsageTooltipProps {
  active?: boolean;
  label?: string | number;
  payload?: Array<{
    payload?: UsageChartPoint;
  }>;
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

function rawTraceSpanIdForSource(
  source: string | null | undefined,
  providerRawTraceAvailable: boolean,
  providerRequestSpanId: string | null,
  traceTargetSpanId: string | null | undefined,
  spanId: string | null
): string | null {
  if (!providerRawTraceAvailable) {
    return null;
  }
  if (
    source !== 'llm_request'
    && source !== 'compression_fork_llm_request'
    && source !== 'subconscious_fork_llm_request'
    && source !== 'image_vision_fork_llm_request'
    && source !== 'cache_heartbeat'
    && source !== 'task'
  ) {
    return null;
  }
  return providerRequestSpanId || traceTargetSpanId || spanId || null;
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

const TIME_RANGE_OPTIONS: Array<{ value: TimeRange; label: string }> = [
  { value: '1h', label: '1h' },
  { value: '6h', label: '6h' },
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: 'all', label: '全部' },
  { value: 'custom', label: '自定义' },
];

const USAGE_BUCKET_OPTIONS: Array<{ value: UsageBucket; label: string }> = [
  { value: 'call', label: '每次' },
  { value: 'hour', label: '小时' },
  { value: 'day', label: '天' },
  { value: 'month', label: '月' },
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

function coerceUsageBucket(value: string | null): UsageBucket {
  return USAGE_BUCKET_OPTIONS.some((option) => option.value === value)
    ? value as UsageBucket
    : 'call';
}

function timeRangeLabel(value: TimeRange) {
  return TIME_RANGE_OPTIONS.find((option) => option.value === value)?.label || value;
}

function usageBucketLabel(value: UsageBucket) {
  return USAGE_BUCKET_OPTIONS.find((option) => option.value === value)?.label || value;
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

function localInputFromIso(value?: string | null) {
  if (!value) {
    return '';
  }
  const formatted = formatIsoOffset(value, { fallback: '' });
  if (!formatted) {
    return '';
  }
  return formatted.slice(0, 19);
}

function formatUsageAxis(value: string | number) {
  return formatDateTimeCompact(value, { fallback: String(value) }).slice(5, 16);
}

function formatTokenAxis(value: number) {
  return formatTokenCount(Number.isFinite(value) ? value : 0) || '0';
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
    case 'image_vision_fork_llm_request':
      return 'fork LLM';
    case 'compression_fork_item':
      return 'fork stack';
    case 'compression_fork_tool_execution':
      return 'fork tool';
    case 'image_vision_fork':
      return 'vision fork';
    case 'image_vision_fork_observation':
      return 'vision step';
    case 'cache_heartbeat':
      return 'heartbeat';
    default:
      return source.replace(/_/g, ' ');
  }
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

function metadataBoolean(metadata: Record<string, unknown>, key: string): boolean {
  const value = metadata[key];
  return value === true || value === 'true';
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

function parseTimestampMs(value?: string | null) {
  if (!value) {
    return null;
  }
  const parsed = parseTimestampValue(value)?.getTime();
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null;
}

function readUsageChartPoint(state: unknown): UsageChartPoint | null {
  if (!state || typeof state !== 'object') {
    return null;
  }
  const payload = (state as { activePayload?: Array<{ payload?: UsageChartPoint }> }).activePayload;
  return payload?.[0]?.payload || null;
}

function readUsageChartTimestampMs(state: unknown): number | null {
  const point = readUsageChartPoint(state);
  if (point) {
    return point.timestampMs;
  }
  if (!state || typeof state !== 'object') {
    return null;
  }
  const activeLabel = (state as { activeLabel?: string | number }).activeLabel;
  const parsed = typeof activeLabel === 'number' ? activeLabel : Number(activeLabel);
  return Number.isFinite(parsed) ? parsed : null;
}

function readUsageChartPointerRatio(state: unknown): number | null {
  if (!state || typeof state !== 'object') {
    return null;
  }
  const payload = state as {
    activeCoordinate?: { x?: number };
    chartX?: number;
    offset?: { left?: number; width?: number };
  };
  const offsetLeft = typeof payload.offset?.left === 'number' ? payload.offset.left : 0;
  const offsetWidth = typeof payload.offset?.width === 'number' ? payload.offset.width : null;
  if (!offsetWidth || offsetWidth <= 0) {
    return null;
  }
  const x = typeof payload.chartX === 'number'
    ? payload.chartX
    : typeof payload.activeCoordinate?.x === 'number'
      ? payload.activeCoordinate.x
      : null;
  if (x === null) {
    return null;
  }
  return clampTimestamp((x - offsetLeft) / offsetWidth, 0, 1);
}

function readUsageChartSelectionPoint(state: unknown, domain: [number, number]) {
  const ratio = readUsageChartPointerRatio(state);
  if (ratio !== null) {
    return {
      timestampMs: domain[0] + (domain[1] - domain[0]) * ratio,
      isAtNowEdge: ratio >= 0.985,
    };
  }
  const timestampMs = readUsageChartTimestampMs(state);
  if (timestampMs === null) {
    return null;
  }
  const span = Math.max(1, domain[1] - domain[0]);
  return {
    timestampMs,
    isAtNowEdge: timestampMs >= domain[1] - span * 0.015,
  };
}

function clampTimestamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function eventElementId(eventId: string) {
  return `xiaoni-event-${encodeURIComponent(eventId)}`;
}

function isImageVisionForkMainItem(item: XiaoniActivityFeedItem) {
  return item.source === 'media_observation' && item.metadata?.forkKind === 'image_vision';
}

function forkKindForRun(run: CompressionForkRun) {
  const metadataKind = typeof run.metadata?.forkKind === 'string' ? run.metadata.forkKind : null;
  if (metadataKind) {
    return metadataKind;
  }
  if (run.source === 'cache_heartbeat') {
    return 'cache_heartbeat';
  }
  if (run.source === 'subconscious_agent_fork') {
    return 'subconscious_agent';
  }
  return run.source === 'image_vision_fork' ? 'image_vision' : 'compression_memory';
}

function forkAgentLabel(forkKind: string) {
  if (forkKind === 'image_vision') {
    return 'Image Vision Fork';
  }
  if (forkKind === 'cache_heartbeat') {
    return 'Cache Heartbeat Fork';
  }
  if (forkKind === 'subconscious_agent') {
    return '潜意识 Agent';
  }
  return 'Memory Compress Fork';
}

function buildForkAgentRuns(feed?: XiaoniActivityFeed): ForkAgentRun[] {
  const compressionRuns = (feed?.compressionForkTimeline?.runs || []).map((run) => {
    const forkKind = forkKindForRun(run);
    return {
      ...run,
      forkKind,
      agentLabel: forkAgentLabel(forkKind),
    };
  });
  const subconsciousRuns = (feed?.subconsciousForkTimeline?.runs || []).map((run) => {
    const forkKind = forkKindForRun(run);
    return {
      ...run,
      forkKind,
      agentLabel: forkAgentLabel(forkKind),
    };
  });
  const imageVisionRuns = (feed?.imageVisionForkTimeline?.runs || []).map((run) => {
    const forkKind = forkKindForRun(run);
    return {
      ...run,
      forkKind,
      agentLabel: forkAgentLabel(forkKind),
    };
  });
  const cacheHeartbeatRuns = (feed?.cacheHeartbeatTimeline?.runs || []).map((run) => {
    const forkKind = forkKindForRun(run);
    return {
      ...run,
      forkKind,
      agentLabel: forkAgentLabel(forkKind),
    };
  });
  return [...compressionRuns, ...subconsciousRuns, ...imageVisionRuns, ...cacheHeartbeatRuns]
    .sort((left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime());
}

function shortForkRunId(forkRunId: string | null | undefined): string {
  if (!forkRunId) {
    return '';
  }
  const tail = forkRunId.replace(/[^a-zA-Z0-9]/g, '');
  return tail.length > 6 ? tail.slice(-6) : tail;
}

function forkLabelForRun(run: ForkAgentRun): string {
  const base = run.agentLabel || forkAgentLabel(run.forkKind || forkKindForRun(run));
  const short = shortForkRunId(run.forkRunId);
  return short ? `${base}·${short}` : base;
}

function forkChipClass(kind: string): string {
  switch (kind) {
    case 'subconscious_agent':
      return 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700';
    case 'image_vision':
      return 'border-sky-200 bg-sky-50 text-sky-700';
    case 'cache_heartbeat':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    case 'compression_memory':
      return 'border-violet-200 bg-violet-50 text-violet-700';
    default:
      return 'border-border bg-muted text-muted-foreground';
  }
}

// Synthesize a "trigger" event from the fork run's metadata so the timeline
// shows WHY 小腻 entered this fork (notify doorbell / read-cutoff / media / timer).
function buildForkTriggerItem(run: ForkAgentRun): XiaoniActivityFeedItem | null {
  const forkKind = run.forkKind || forkKindForRun(run);
  let body: string | null = null;
  if (forkKind === 'subconscious_agent') {
    const notifyId = metadataText(run.metadata, 'notifyQueueMessageId')
      ?? (metadataNumber(run.metadata, 'notifyQueueMessageId') !== null
        ? String(metadataNumber(run.metadata, 'notifyQueueMessageId'))
        : null);
    const sessionKey = metadataText(run.metadata, 'contextSessionKey');
    body = notifyId
      ? `由 Notify Bucket #${notifyId} (phone_notification) 唤醒`
      : '潜意识自主触发';
    if (sessionKey) {
      body += ` · ${sessionKey}`;
    }
  } else if (forkKind === 'compression_memory') {
    const to = run.readCutoffAfterConversationId;
    const from = run.previousReadCutoffAfterConversationId;
    body = to ? `核心记忆压缩 · read-cutoff ${from || '-'} → ${to}` : '核心记忆压缩触发';
  } else if (forkKind === 'image_vision') {
    body = '收到图片 → 触发图像视觉 fork';
  } else if (forkKind === 'cache_heartbeat') {
    body = '缓存心跳定时触发 · 续 cache TTL';
  } else {
    body = 'fork 触发';
  }
  return {
    id: `forktrig:${run.id}`,
    source: 'fork_trigger',
    kind: 'fork_trigger',
    title: '触发',
    body,
    status: run.status || null,
    actor: 'system',
    actorName: run.agentLabel || null,
    timestamp: run.startedAt,
    occurredAt: run.startedAt,
    sessionKey: null,
    peerName: null,
    traceId: run.traceId,
    traceTarget: null,
    tone: 'info',
    metadata: {
      forkKind,
      forkRunId: run.forkRunId,
      notifyQueueMessageId: run.metadata?.notifyQueueMessageId ?? null,
    },
    tags: [],
  };
}

// Flatten main items + every fork run's internal events into one time-sorted
// stream. Fork events carry a StreamForkRef so the UI can prefix + filter them.
// Logical position of an event within its LLM turn. Wall-clock can't be trusted
// for intra-turn order (the slice row is persisted after its own output items,
// and several items share a millisecond), so order by phase, not by timestamp.
function streamPhaseRank(entry: StreamEntry): number {
  const item = entry.item;
  const kind = (typeof item.metadata?.itemKind === 'string' ? item.metadata.itemKind : null) || item.kind;
  if (item.source === 'fork_trigger' || kind === 'runtime_input') {
    return 0; // 触发 / 本 turn 追加进来的输入
  }
  if (item.source === 'llm_request' || item.source.endsWith('fork_llm_request') || item.source === 'cache_heartbeat') {
    return 1; // 模型请求
  }
  if (kind === 'function_call') {
    return 3; // 请求工具
  }
  if (kind === 'function_call_output' || item.source === 'tool_execution' || item.source.endsWith('fork_tool_execution')) {
    return 4; // 工具结果
  }
  return 2; // 小腻输出 (assistant text / reasoning / final_answer)
}

function streamTurnKey(entry: StreamEntry): string {
  const slice = typeof entry.item.metadata?.llmRequestSliceId === 'string' ? entry.item.metadata.llmRequestSliceId : null;
  return slice ? `${entry.lane}:slice:${slice}` : `${entry.lane}:solo:${entry.id}`;
}

// Real append-ledger position of an event: stack_index (main) / item_index
// (fork), assigned at creation. This is the ground-truth creation order — used
// to break intra-phase ties instead of arbitrary id comparison.
function streamOrderKey(entry: StreamEntry): number {
  const meta = entry.item.metadata || {};
  const raw = meta.stackIndex ?? meta.itemIndex;
  const num = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(num) ? num : Number.NaN;
}

function buildStreamEntries(
  mainItems: XiaoniActivityFeedItem[],
  forkRuns: ForkAgentRun[]
): StreamEntry[] {
  const entries: StreamEntry[] = mainItems.map((item) => ({
    id: `main:${item.eventId || item.id}`,
    lane: 'main' as const,
    timestamp: item.occurredAt || item.timestamp,
    item,
    fork: null,
  }));

  for (const run of forkRuns) {
    const forkKind = run.forkKind || forkKindForRun(run);
    const ref: StreamForkRef = { runId: run.forkRunId, kind: forkKind, label: forkLabelForRun(run) };
    const trigger = buildForkTriggerItem(run);
    if (trigger) {
      entries.push({ id: trigger.id, lane: 'fork', timestamp: run.startedAt, item: trigger, fork: ref });
    }
    for (const event of run.events || []) {
      entries.push({
        id: `fork:${run.forkRunId}:${event.id}`,
        lane: 'fork',
        timestamp: event.occurredAt || event.timestamp,
        item: event,
        fork: ref,
      });
    }
  }

  // Group events by LLM turn (slice), order turns newest-first by the turn's
  // earliest event, and within a turn order by phase (触发 → 模型请求 → 小腻输出
  // → 请求工具 → 工具结果). This keeps each turn a contiguous, causally-ordered
  // block instead of jumbling cause/effect by unreliable sub-second timestamps.
  const groups = new Map<string, { anchor: number; entries: StreamEntry[] }>();
  for (const entry of entries) {
    const key = streamTurnKey(entry);
    const ms = parseTimestampMs(entry.timestamp) || 0;
    const group = groups.get(key);
    if (group) {
      group.entries.push(entry);
      if (ms < group.anchor) {
        group.anchor = ms;
      }
    } else {
      groups.set(key, { anchor: ms, entries: [entry] });
    }
  }
  const result: StreamEntry[] = [];
  for (const group of Array.from(groups.values()).sort((a, b) => b.anchor - a.anchor)) {
    group.entries.sort((left, right) => {
      const phase = streamPhaseRank(left) - streamPhaseRank(right);
      if (phase !== 0) {
        return phase;
      }
      // Within a phase, order by the real append index (ground truth) when both
      // events have one; fall back to wall-clock then id only when they don't.
      const leftKey = streamOrderKey(left);
      const rightKey = streamOrderKey(right);
      if (Number.isFinite(leftKey) && Number.isFinite(rightKey) && leftKey !== rightKey) {
        return leftKey - rightKey;
      }
      const leftMs = parseTimestampMs(left.timestamp) || 0;
      const rightMs = parseTimestampMs(right.timestamp) || 0;
      if (leftMs !== rightMs) {
        return leftMs - rightMs;
      }
      return left.id.localeCompare(right.id);
    });
    result.push(...group.entries);
  }
  return result;
}

function buildForkRoster(forkRuns: ForkAgentRun[]): ForkRosterEntry[] {
  return forkRuns
    .map((run) => ({
      runId: run.forkRunId,
      kind: run.forkKind || forkKindForRun(run),
      label: forkLabelForRun(run),
      count: (run.events?.length || 0) + 1,
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function mergeActionStreamPages(pages: XiaoniActivityFeed[]): XiaoniActivityFeed | undefined {
  const firstPage = pages[0];
  if (!firstPage) {
    return undefined;
  }
  const itemsById = new Map<string, XiaoniActivityFeedItem>();
  const compressionRunsById = new Map<string, CompressionForkRun>();
  const subconsciousRunsById = new Map<string, CompressionForkRun>();
  const imageVisionRunsById = new Map<string, CompressionForkRun>();
  const cacheHeartbeatRunsById = new Map<string, CompressionForkRun>();

  pages.forEach((page) => {
    (page.items || []).forEach((item) => {
      if (!itemsById.has(item.id)) {
        itemsById.set(item.id, item);
      }
    });
    (page.compressionForkTimeline?.runs || []).forEach((run) => {
      if (!compressionRunsById.has(run.id)) {
        compressionRunsById.set(run.id, run);
      }
    });
    (page.subconsciousForkTimeline?.runs || []).forEach((run) => {
      if (!subconsciousRunsById.has(run.id)) {
        subconsciousRunsById.set(run.id, run);
      }
    });
    (page.imageVisionForkTimeline?.runs || []).forEach((run) => {
      if (!imageVisionRunsById.has(run.id)) {
        imageVisionRunsById.set(run.id, run);
      }
    });
    (page.cacheHeartbeatTimeline?.runs || []).forEach((run) => {
      if (!cacheHeartbeatRunsById.has(run.id)) {
        cacheHeartbeatRunsById.set(run.id, run);
      }
    });
  });

  const lastPage = pages[pages.length - 1] || firstPage;
  return {
    ...firstPage,
    generatedAt: lastPage.generatedAt || firstPage.generatedAt,
    pagination: lastPage.pagination,
    items: Array.from(itemsById.values()),
    compressionForkTimeline: {
      ...(firstPage.compressionForkTimeline || {}),
      runs: Array.from(compressionRunsById.values()),
    },
    subconsciousForkTimeline: {
      ...(firstPage.subconsciousForkTimeline || {}),
      runs: Array.from(subconsciousRunsById.values()),
    },
    cacheHeartbeatTimeline: {
      ...(firstPage.cacheHeartbeatTimeline || {}),
      runs: Array.from(cacheHeartbeatRunsById.values()),
    },
    imageVisionForkTimeline: {
      ...(firstPage.imageVisionForkTimeline || {}),
      runs: Array.from(imageVisionRunsById.values()),
    },
  };
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

function ActionStreamTagFilterControls({
  availableTags,
  selectedTags,
  onToggleTag,
  onClearTags,
}: {
  availableTags: ActionStreamTagOption[];
  selectedTags: string[];
  onToggleTag: (key: string) => void;
  onClearTags: () => void;
}) {
  const tagOptions = React.useMemo(
    () => mergeSelectedActionStreamTags(availableTags, selectedTags),
    [availableTags, selectedTags]
  );
  if (!tagOptions.length) {
    return null;
  }
  const selectedSet = new Set(selectedTags);

  return (
    <section className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Tags className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold text-foreground">标签</span>
          {selectedTags.length ? <StatusPill tone="info">已选 {selectedTags.length}</StatusPill> : null}
        </div>
        {selectedTags.length ? (
          <Button variant="ghost" size="sm" className="h-8 self-start px-2 text-xs" onClick={onClearTags}>
            <X className="mr-1.5 h-3.5 w-3.5" />
            清除
          </Button>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {tagOptions.map((tag) => {
          const selected = selectedSet.has(tag.key);
          return (
            <Button
              key={tag.key}
              type="button"
              variant={selected ? 'default' : 'outline'}
              size="sm"
              aria-pressed={selected}
              title={tag.key}
              className="h-8 max-w-full px-2.5 text-xs"
              onClick={() => onToggleTag(tag.key)}
            >
              <span className="truncate">{tag.label}</span>
              {typeof tag.count === 'number' ? (
                <span className={cn('ml-1.5 font-mono text-[10px]', selected ? 'text-primary-foreground/80' : 'text-muted-foreground')}>
                  {tag.count}
                </span>
              ) : null}
            </Button>
          );
        })}
      </div>
    </section>
  );
}

function UsageTooltip({ active, payload, label }: UsageTooltipProps) {
  if (!active) {
    return null;
  }
  const point = payload?.[0]?.payload;
  if (!point) {
    return null;
  }
  const labelText = typeof label === 'number'
    ? formatDateTimeCompact(label)
    : formatDateTimeCompact(point.timestamp, { fallback: String(label || '-') });

  return (
    <div className="max-w-72 rounded-lg border border-border bg-background/95 p-3 text-xs shadow-lg">
      <div className="font-mono font-semibold text-foreground">{labelText}</div>
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
        <span className="text-muted-foreground">Input</span>
        <span className="text-right font-medium text-sky-700">{formatTokenCount(point.inputTokens) || '0'}</span>
        <span className="text-muted-foreground">Cached</span>
        <span className="text-right font-medium text-emerald-700">{formatTokenCount(point.cachedTokens) || '0'}</span>
        <span className="text-muted-foreground">Output</span>
        <span className="text-right font-medium text-violet-700">{formatTokenCount(point.outputTokens) || '0'}</span>
        <span className="text-muted-foreground">Calls</span>
        <span className="text-right font-medium text-foreground">{point.callCount}</span>
      </div>
      {point.anchorEventId ? (
        <div className="mt-2 truncate font-mono text-[11px] text-muted-foreground">{point.anchorEventId}</div>
      ) : null}
    </div>
  );
}

// LLM Cost 与额度折线图共用 hover 同步：syncId 让一图的 tooltip/竖线同步到另一图。
// 两图数据点时间戳不同，所以用最近邻按 timestampMs 对齐，而不是 recharts 默认的按 index。
const USAGE_CHART_SYNC_ID = 'xiaoni-usage-x';

function usageChartSyncMethod(
  ticks: Array<{ value?: number | string }>,
  data: { activeLabel?: number | string }
): number | undefined {
  const target = Number(data?.activeLabel);
  if (!Array.isArray(ticks) || ticks.length === 0 || !Number.isFinite(target)) {
    return undefined;
  }
  let bestIndex = 0;
  let bestDelta = Infinity;
  for (let index = 0; index < ticks.length; index += 1) {
    const value = Number(ticks[index]?.value);
    if (!Number.isFinite(value)) {
      continue;
    }
    const delta = Math.abs(value - target);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function XiaoniUsageObservatory({
  timeline,
  quotaTimeline,
  isQuotaLoading,
  bucket,
  searchQuery,
  isLoading,
  isFetching,
  onBucketChange,
  onSearchQueryChange,
  onSelectWindow,
  onFocusPoint,
}: {
  timeline: XiaoniLlmUsageTimeline | undefined;
  quotaTimeline: CcQuotaTimelineResult | null;
  isQuotaLoading: boolean;
  bucket: UsageBucket;
  searchQuery: string;
  isLoading: boolean;
  isFetching: boolean;
  onBucketChange: (bucket: UsageBucket) => void;
  onSearchQueryChange: (query: string) => void;
  onSelectWindow: (startTime: Date, endTime: Date, options?: { endIsNow?: boolean }) => void;
  onFocusPoint: (point: XiaoniLlmUsagePoint) => void;
}) {
  const [selectionStartMs, setSelectionStartMs] = React.useState<number | null>(null);
  const [selectionEndMs, setSelectionEndMs] = React.useState<number | null>(null);
  const [selectionStartIsNow, setSelectionStartIsNow] = React.useState(false);
  const [selectionEndIsNow, setSelectionEndIsNow] = React.useState(false);
  const [transientWindowMs, setTransientWindowMs] = React.useState<[number, number] | null>(null);
  const [searchDraft, setSearchDraft] = React.useState(searchQuery);
  const [wheelZoomActive, setWheelZoomActive] = React.useState(false);
  const chartShellRef = React.useRef<HTMLDivElement | null>(null);
  const quotaShellRef = React.useRef<HTMLDivElement | null>(null);
  const suppressNextClickRef = React.useRef(false);
  const wheelCommitTimerRef = React.useRef<number | null>(null);
  const pendingWheelWindowRef = React.useRef<[number, number] | null>(null);
  const chartPoints = React.useMemo<UsageChartPoint[]>(() => (
    (timeline?.points || [])
      .map((point) => {
        const timestampMs = parseTimestampMs(point.timestamp);
        return timestampMs === null
          ? null
          : {
              ...point,
              timestampMs,
              chartLabel: formatDateTimeCompact(point.timestamp),
            };
      })
      .filter((point): point is UsageChartPoint => point !== null)
  ), [timeline?.points]);
  const maxTotalTokens = React.useMemo(() => Math.max(1, ...chartPoints.map((point) => point.totalTokens)), [chartPoints]);
  const quotaChartPoints = React.useMemo(() => (
    (quotaTimeline?.points || [])
      .map((point) => {
        const timestampMs = parseTimestampMs(point.timestamp);
        return timestampMs === null
          ? null
          : { timestampMs, util5h: point.util5h, util7d: point.util7d };
      })
      .filter((point): point is { timestampMs: number; util5h: number | null; util7d: number | null } => point !== null)
  ), [quotaTimeline?.points]);
  const miniMapPoints = React.useMemo(() => {
    if (chartPoints.length <= 160) {
      return chartPoints;
    }
    const stride = Math.ceil(chartPoints.length / 160);
    return chartPoints.filter((_point, index) => index % stride === 0);
  }, [chartPoints]);
  const resolvedWindowStartMs = parseTimestampMs(timeline?.window.startTime);
  const resolvedWindowEndMs = parseTimestampMs(timeline?.window.endTime);
  const domainStartMs = resolvedWindowStartMs || chartPoints[0]?.timestampMs || Date.now() - TIME_RANGE_DURATION_MS['24h']!;
  const domainEndMs = resolvedWindowEndMs || Date.now();
  const chartDomain: [number, number] = domainStartMs === domainEndMs
    ? [domainStartMs - 60_000, domainEndMs + 60_000]
    : transientWindowMs || [domainStartMs, domainEndMs];
  const fullStartMs = parseTimestampMs(timeline?.dataBounds.firstAt) || chartDomain[0];
  const fullEndMs = Math.max(parseTimestampMs(timeline?.dataBounds.lastAt) || chartDomain[1], domainEndMs);
  const windowStartMs = resolvedWindowStartMs || chartDomain[0];
  const windowEndMs = resolvedWindowEndMs || chartDomain[1];
  const visibleStartMs = transientWindowMs?.[0] || windowStartMs;
  const visibleEndMs = transientWindowMs?.[1] || windowEndMs;
  const visibleWarnings = (timeline?.warnings || []).filter((warning) => !warning.endsWith('_not_enabled'));
  const activeSelectionStart = selectionStartMs !== null && selectionEndMs !== null
    ? Math.min(selectionStartMs, selectionEndMs)
    : null;
  const activeSelectionEnd = selectionStartMs !== null && selectionEndMs !== null
    ? Math.max(selectionStartMs, selectionEndMs)
    : null;
  const peakDots = React.useMemo(() => (
    (timeline?.peaks || [])
      .map((peak) => {
        const timestampMs = parseTimestampMs(peak.timestamp);
        if (timestampMs === null) {
          return null;
        }
        const point = chartPoints.find((entry) => entry.anchorEventId === peak.anchorEventId || entry.llmRequestSliceId === peak.llmRequestSliceId)
          || chartPoints.reduce<UsageChartPoint | null>((best, entry) => {
            if (!best) {
              return entry;
            }
            return Math.abs(entry.timestampMs - timestampMs) < Math.abs(best.timestampMs - timestampMs) ? entry : best;
          }, null);
        if (!point) {
          return null;
        }
        return {
          peak,
          x: point.timestampMs,
          y: peak.reason.includes('output') ? point.outputTokens : point.inputTokens,
          point,
        };
      })
      .filter((entry): entry is { peak: XiaoniLlmUsagePeak; x: number; y: number; point: UsageChartPoint } => entry !== null)
  ), [chartPoints, timeline?.peaks]);
  const searchHitDots = React.useMemo(() => (
    (timeline?.overlays?.searchHits || [])
      .map((hit) => {
        const timestampMs = parseTimestampMs(hit.timestamp);
        if (timestampMs === null) {
          return null;
        }
        const point = chartPoints.find((entry) => entry.anchorEventId === hit.anchorEventId || entry.llmRequestSliceId === hit.llmRequestSliceId)
          || chartPoints.reduce<UsageChartPoint | null>((best, entry) => {
            if (!best) {
              return entry;
            }
            return Math.abs(entry.timestampMs - timestampMs) < Math.abs(best.timestampMs - timestampMs) ? entry : best;
          }, null);
        if (!point) {
          return null;
        }
        return {
          hit,
          x: point.timestampMs,
          y: Math.max(1, hit.inputTokens || point.inputTokens, hit.cachedTokens || point.cachedTokens, hit.outputTokens || point.outputTokens),
          point,
        };
      })
      .filter((entry): entry is { hit: XiaoniLlmUsageSearchHit; x: number; y: number; point: UsageChartPoint } => entry !== null)
  ), [chartPoints, timeline?.overlays?.searchHits]);

  React.useEffect(() => {
    setSearchDraft(searchQuery);
  }, [searchQuery]);

  React.useEffect(() => {
    setTransientWindowMs(null);
  }, [timeline?.window.startTime, timeline?.window.endTime]);

  React.useEffect(() => () => {
    if (wheelCommitTimerRef.current !== null) {
      window.clearTimeout(wheelCommitTimerRef.current);
    }
  }, []);

  const commitWheelWindow = React.useCallback((nextStart: number, nextEnd: number, endIsNow = false) => {
    pendingWheelWindowRef.current = [nextStart, nextEnd];
    if (wheelCommitTimerRef.current !== null) {
      window.clearTimeout(wheelCommitTimerRef.current);
    }
    wheelCommitTimerRef.current = window.setTimeout(() => {
      const pending = pendingWheelWindowRef.current;
      wheelCommitTimerRef.current = null;
      pendingWheelWindowRef.current = null;
      if (pending) {
        onSelectWindow(new Date(pending[0]), new Date(pending[1]), { endIsNow });
      }
    }, 260);
  }, [onSelectWindow]);

  const submitSearch = React.useCallback(() => {
    onSearchQueryChange(searchDraft.trim());
  }, [onSearchQueryChange, searchDraft]);

  const handleMouseDown = React.useCallback((state: unknown) => {
    const selectionPoint = readUsageChartSelectionPoint(state, chartDomain);
    if (!selectionPoint) {
      return;
    }
    setSelectionStartMs(selectionPoint.timestampMs);
    setSelectionEndMs(selectionPoint.timestampMs);
    setSelectionStartIsNow(selectionPoint.isAtNowEdge);
    setSelectionEndIsNow(selectionPoint.isAtNowEdge);
  }, [chartDomain]);

  const handleMouseMove = React.useCallback((state: unknown) => {
    if (selectionStartMs === null) {
      return;
    }
    const selectionPoint = readUsageChartSelectionPoint(state, chartDomain);
    if (selectionPoint) {
      setSelectionEndMs(selectionPoint.timestampMs);
      setSelectionEndIsNow(selectionPoint.isAtNowEdge);
    }
  }, [chartDomain, selectionStartMs]);

  const clearSelection = React.useCallback(() => {
    setSelectionStartMs(null);
    setSelectionEndMs(null);
    setSelectionStartIsNow(false);
    setSelectionEndIsNow(false);
  }, []);

  const handleMouseUp = React.useCallback(() => {
    if (selectionStartMs === null || selectionEndMs === null) {
      clearSelection();
      return;
    }
    const startMs = Math.min(selectionStartMs, selectionEndMs);
    const endMs = Math.max(selectionStartMs, selectionEndMs);
    clearSelection();
    if (endMs - startMs < 1000) {
      return;
    }
    const endIsNow = selectionStartMs >= selectionEndMs ? selectionStartIsNow : selectionEndIsNow;
    suppressNextClickRef.current = true;
    window.setTimeout(() => {
      suppressNextClickRef.current = false;
    }, 0);
    onSelectWindow(new Date(startMs), new Date(endMs), { endIsNow });
  }, [clearSelection, onSelectWindow, selectionEndIsNow, selectionEndMs, selectionStartIsNow, selectionStartMs]);

  const handleClick = React.useCallback((state: unknown) => {
    if (suppressNextClickRef.current) {
      return;
    }
    const point = readUsageChartPoint(state);
    if (point?.anchorEventId) {
      onFocusPoint(point);
    }
  }, [onFocusPoint]);

  const handleChartShellClick = React.useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || suppressNextClickRef.current) {
      return;
    }
    chartShellRef.current?.focus({ preventScroll: true });
    setWheelZoomActive(true);
  }, []);

  const handleQuotaShellClick = React.useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || suppressNextClickRef.current) {
      return;
    }
    quotaShellRef.current?.focus({ preventScroll: true });
    setWheelZoomActive(true);
  }, []);

  const performWheel = React.useCallback((event: React.WheelEvent<HTMLDivElement>, shellEl: HTMLDivElement | null) => {
    if (!timeline || fullEndMs <= fullStartMs) {
      return;
    }
    const rect = shellEl?.getBoundingClientRect();
    const ratio = rect && rect.width > 0
      ? clampTimestamp((event.clientX - rect.left) / rect.width, 0, 1)
      : 0.5;
    const nextWindow = calculateUsageChartWheelWindow({
      isActive: wheelZoomActive,
      deltaY: event.deltaY,
      pointerRatio: ratio,
      domainEndMs,
      fullStartMs,
      fullEndMs,
      visibleStartMs,
      visibleEndMs,
    });

    if (!nextWindow) {
      return;
    }

    event.preventDefault();
    setTransientWindowMs([nextWindow.startMs, nextWindow.endMs]);
    commitWheelWindow(nextWindow.startMs, nextWindow.endMs, nextWindow.endIsNow);
  }, [commitWheelWindow, domainEndMs, fullEndMs, fullStartMs, timeline, visibleEndMs, visibleStartMs, wheelZoomActive]);

  const empty = !isLoading && chartPoints.length === 0;

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">LLM Cost</h2>
          <div className="mt-1 text-xs text-muted-foreground">
            {timeline?.bucket ? `${usageBucketLabel(timeline.bucket)} 汇聚` : usageBucketLabel(bucket)}
            {timeline?.downsampled ? ' · 自动降采样' : ''}
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          {USAGE_BUCKET_OPTIONS.map((option) => (
            <Button
              key={option.value}
              variant={bucket === option.value ? 'default' : 'outline'}
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => onBucketChange(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <div className="rounded-md border border-border bg-background p-2">
          <div className="text-[11px] text-muted-foreground">Input</div>
          <div className="mt-1 truncate text-sm font-semibold text-sky-700">{formatTokenCount(timeline?.summary.inputTokens ?? 0) || '0'}</div>
        </div>
        <div className="rounded-md border border-border bg-background p-2">
          <div className="text-[11px] text-muted-foreground">Cached</div>
          <div className="mt-1 truncate text-sm font-semibold text-emerald-700">{formatTokenCount(timeline?.summary.cachedTokens ?? 0) || '0'}</div>
        </div>
        <div className="rounded-md border border-border bg-background p-2">
          <div className="text-[11px] text-muted-foreground">Output</div>
          <div className="mt-1 truncate text-sm font-semibold text-violet-700">{formatTokenCount(timeline?.summary.outputTokens ?? 0) || '0'}</div>
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                submitSearch();
              }
            }}
            placeholder="搜索 request / response"
            className="h-8 pl-8 text-xs"
          />
        </div>
        <Button size="sm" variant="outline" className="h-8 px-2 text-xs" onClick={submitSearch}>
          叠层
        </Button>
        {searchQuery ? (
          <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => onSearchQueryChange('')}>
            清除
          </Button>
        ) : null}
      </div>

      <div
        ref={chartShellRef}
        tabIndex={0}
        role="region"
        aria-label="LLM Cost chart"
        className={cn(
          'mt-4 h-[320px] rounded-md border border-border bg-background p-2 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/25',
          wheelZoomActive && 'border-primary/50 ring-2 ring-primary/15'
        )}
        onClickCapture={handleChartShellClick}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            setWheelZoomActive(false);
          }
        }}
        onWheel={(event) => performWheel(event, chartShellRef.current)}
      >
        {isLoading && !timeline ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            加载 usage...
          </div>
        ) : empty ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">暂无 LLM token 记录</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={chartPoints}
              margin={{ top: 22, right: 12, bottom: 6, left: 0 }}
              syncId={USAGE_CHART_SYNC_ID}
              syncMethod={usageChartSyncMethod}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onClick={handleClick}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="timestampMs"
                type="number"
                domain={chartDomain}
                tickFormatter={formatUsageAxis}
                tick={{ fontSize: 11 }}
                stroke="hsl(var(--muted-foreground))"
              />
              <YAxis
                tickFormatter={formatTokenAxis}
                tick={{ fontSize: 11 }}
                width={42}
                stroke="hsl(var(--muted-foreground))"
              />
              <ChartTooltip content={(props) => <UsageTooltip {...(props as UsageTooltipProps)} />} />
              {activeSelectionStart !== null && activeSelectionEnd !== null ? (
                <ReferenceArea x1={activeSelectionStart} x2={activeSelectionEnd} strokeOpacity={0.35} fill="#38bdf8" fillOpacity={0.12} />
              ) : null}
              <Line type="monotone" dataKey="inputTokens" name="Input" stroke="#0284c7" strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
              <Line type="monotone" dataKey="cachedTokens" name="Cached" stroke="#059669" strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
              <Line type="monotone" dataKey="outputTokens" name="Output" stroke="#7c3aed" strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
              {peakDots.map(({ peak, x, y }) => (
                <ReferenceDot
                  key={`${peak.reason}:${x}`}
                  x={x}
                  y={y}
                  r={4}
                  fill={peak.severity === 'warning' ? '#d97706' : '#0ea5e9'}
                  stroke="white"
                  label={{ value: peak.label, position: 'top', fontSize: 11, fill: '#334155' }}
                />
              ))}
              {searchHitDots.map(({ hit, x, y }) => (
                <ReferenceDot
                  key={`search:${hit.llmRequestSliceId || hit.anchorEventId || hit.timestamp}`}
                  x={x}
                  y={y}
                  r={3}
                  fill="#f59e0b"
                  stroke="white"
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="mt-4">
        <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>账号额度 utilization（与 LLM Cost 共用时间轴）</span>
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: '#0284c7' }} />5h
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: '#7c3aed' }} />周
            </span>
          </span>
        </div>
        <div
          ref={quotaShellRef}
          tabIndex={0}
          role="region"
          aria-label="账号额度 chart"
          className={cn(
            'h-72 rounded-md border border-border bg-background p-2 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/25',
            wheelZoomActive && 'border-primary/50 ring-2 ring-primary/15'
          )}
          onClickCapture={handleQuotaShellClick}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) {
              setWheelZoomActive(false);
            }
          }}
          onWheel={(event) => performWheel(event, quotaShellRef.current)}
        >
          {isQuotaLoading && !quotaTimeline ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              加载额度...
            </div>
          ) : quotaChartPoints.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">该区间暂无额度记录</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={quotaChartPoints}
                margin={{ top: 8, right: 12, bottom: 6, left: 0 }}
                syncId={USAGE_CHART_SYNC_ID}
                syncMethod={usageChartSyncMethod}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="timestampMs"
                  type="number"
                  domain={chartDomain}
                  allowDataOverflow
                  tickFormatter={formatUsageAxis}
                  tick={{ fontSize: 11 }}
                  stroke="hsl(var(--muted-foreground))"
                />
                <YAxis
                  domain={[0, 1]}
                  tickFormatter={(value: number) => `${Math.round(value * 100)}%`}
                  tick={{ fontSize: 11 }}
                  width={42}
                  stroke="hsl(var(--muted-foreground))"
                />
                <ChartTooltip
                  formatter={(value) => [typeof value === 'number' ? `${(value * 100).toFixed(1)}%` : String(value), '']}
                  labelFormatter={(label) => formatUsageAxis(label as number)}
                  contentStyle={{ fontSize: 12 }}
                  labelStyle={{ fontSize: 12 }}
                />
                {activeSelectionStart !== null && activeSelectionEnd !== null ? (
                  <ReferenceArea x1={activeSelectionStart} x2={activeSelectionEnd} strokeOpacity={0.35} fill="#38bdf8" fillOpacity={0.12} />
                ) : null}
                <Line type="monotone" dataKey="util5h" name="5h" stroke="#0284c7" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                <Line type="monotone" dataKey="util7d" name="周" stroke="#7c3aed" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>mini-map</span>
          <span>{timeline?.summary.callCount ?? 0} calls{searchHitDots.length ? ` · ${searchHitDots.length} hits` : ''}</span>
        </div>
        <div className="flex h-10 items-end gap-px rounded-md border border-border bg-background px-1 py-1">
          {miniMapPoints.length ? miniMapPoints.map((point) => (
            <button
              key={`mini-${point.key}`}
              type="button"
              aria-label={point.chartLabel}
              className={cn(
                'min-w-[2px] flex-1 rounded-t transition-colors hover:bg-sky-600',
                searchHitDots.some(({ point: hitPoint }) => hitPoint.key === point.key)
                  ? 'bg-amber-500/80'
                  : 'bg-sky-400/70'
              )}
              style={{ height: `${Math.max(8, Math.round((point.totalTokens / maxTotalTokens) * 100))}%` }}
              onClick={() => onFocusPoint(point)}
            />
          )) : (
            <div className="h-full flex-1" />
          )}
        </div>
      </div>

      {peakDots.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {peakDots.map(({ peak, point }) => (
            <button
              key={`peak-${peak.reason}-${peak.timestamp}`}
              type="button"
              className="rounded-full border border-border bg-background px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => onFocusPoint(point)}
            >
              {peak.label}
            </button>
          ))}
        </div>
      ) : null}

      {searchHitDots.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {searchHitDots.slice(0, 8).map(({ hit, point }) => (
            <button
              key={`hit-${hit.llmRequestSliceId || hit.timestamp}`}
              type="button"
              className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800 hover:bg-amber-100"
              onClick={() => onFocusPoint(point)}
              title={hit.snippet || hit.field || undefined}
            >
              {hit.field || 'search'} · {formatDateTimeCompact(hit.timestamp).slice(5, 16)}
            </button>
          ))}
        </div>
      ) : null}

      {visibleWarnings.length ? (
        <div className="mt-3 space-y-1 text-xs text-amber-700">
          {visibleWarnings.slice(0, 3).map((warning) => (
            <div key={warning}>{warning.replace(/_/g, ' ')}</div>
          ))}
        </div>
      ) : null}

      {isFetching && timeline ? (
        <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          更新中
        </div>
      ) : null}
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

type StreamRowTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

function streamTypeTag(item: XiaoniActivityFeedItem): { label: string; tone: StreamRowTone } {
  const stackKind = (typeof item.metadata?.itemKind === 'string' ? item.metadata.itemKind : null) || item.kind;
  // Check runtime_input by KIND (fork runtime_input rows have source
  // *_fork_item, not 'runtime_input') so they aren't mislabeled as 小腻输出.
  if (item.source === 'fork_trigger' || item.source === 'runtime_input' || stackKind === 'runtime_input') {
    return { label: '触发', tone: 'info' };
  }
  if (
    item.source === 'llm_request'
    || item.source === 'compression_fork_llm_request'
    || item.source === 'subconscious_fork_llm_request'
    || item.source === 'image_vision_fork_llm_request'
    || item.source === 'cache_heartbeat'
  ) {
    return { label: '模型请求', tone: 'info' };
  }
  if (stackKind === 'function_call') {
    return { label: '请求工具', tone: 'neutral' };
  }
  if (
    stackKind === 'function_call_output'
    || item.source === 'tool_execution'
    || item.source === 'compression_fork_tool_execution'
    || item.source === 'subconscious_fork_tool_execution'
    || item.source === 'image_vision_fork_tool_execution'
  ) {
    return { label: '工具结果', tone: 'success' };
  }
  if (
    stackKind === 'assistant_output'
    || item.source === 'llm_stack_item'
    || item.source === 'compression_fork_item'
    || item.source === 'subconscious_fork_item'
    || item.source === 'image_vision_fork_item'
  ) {
    return { label: '小腻输出', tone: 'info' };
  }
  return { label: sourceLabel(item.source), tone: 'neutral' };
}

function streamSnippet(item: XiaoniActivityFeedItem): string {
  const body = typeof item.body === 'string' ? item.body.trim() : '';
  return (body || item.title || '').replace(/\s+/g, ' ').trim();
}

function rawTraceTargetForItem(item: XiaoniActivityFeedItem): RawTraceTarget | null {
  const providerRawTraceAvailable = metadataBoolean(item.metadata, 'providerRawTraceAvailable');
  const spanId = metadataText(item.metadata, 'spanId');
  const providerRequestSpanId = metadataText(item.metadata, 'providerRequestSpanId');
  const rawSpan = rawTraceSpanIdForSource(
    item.source,
    providerRawTraceAvailable,
    providerRequestSpanId,
    item.traceTarget?.spanId,
    spanId
  );
  const eventId = item.eventId || item.id;
  if (!rawSpan || !eventId) {
    return null;
  }
  return { eventId, spanId: rawSpan, title: item.title, subtitle: item.traceId };
}

function StreamPreviewBlock({ label, value }: { label: string; value: string }) {
  return (
    <details className="min-w-0" open>
      <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</summary>
      <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 p-2 font-mono text-[11px] leading-5 text-foreground/80">{value}</pre>
    </details>
  );
}

// Inline, fixed-height + scrollable detail: full content, tool previews, and the
// lazily-fetched raw provider request/response for the event's slice.
function StreamRowDetail({ item }: { item: XiaoniActivityFeedItem }) {
  const target = rawTraceTargetForItem(item);
  const body = typeof item.body === 'string' && item.body.trim() ? item.body : null;
  const toolArgs = metadataText(item.metadata, 'toolArgumentsPreview') || metadataText(item.metadata, 'argumentsPreview');
  const toolResult = metadataText(item.metadata, 'toolResultPreview');
  const responsePreview = metadataText(item.metadata, 'responsePreview') || metadataText(item.metadata, 'providerResponsePreview');
  const payloadPreview = metadataText(item.metadata, 'payloadPreview');
  const processingTime = formatDurationMs(metadataNumber(item.metadata, 'processingTimeMs'));
  const payloadSize = formatPayloadSize(
    formatBytes(metadataNumber(item.metadata, 'providerRequestBytes')),
    formatBytes(metadataNumber(item.metadata, 'providerResponseBytes'))
  );
  const rawQuery = useQuery<RawTraceData>({
    queryKey: ['stream-raw-trace', target?.eventId || null, target?.spanId || null],
    queryFn: () => fetchRawTrace(target as RawTraceTarget),
    enabled: Boolean(target),
    staleTime: 0,
  });

  return (
    <div className="mb-2 ml-2 overflow-hidden rounded-lg border border-border bg-card">
      <div className="h-[260px] space-y-3 overflow-auto p-3">
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          {item.traceId ? <span className="font-mono">{item.traceId}</span> : null}
          {payloadSize ? <span>payload {payloadSize}</span> : null}
          {processingTime ? <span>· {processingTime}</span> : null}
        </div>
        {body ? (
          <pre className="whitespace-pre-wrap break-words rounded-md bg-muted/40 p-2 text-[12px] leading-5 text-foreground/90">{body}</pre>
        ) : null}
        {toolArgs ? <StreamPreviewBlock label="tool args" value={toolArgs} /> : null}
        {toolResult ? <StreamPreviewBlock label="tool result" value={toolResult} /> : null}
        {responsePreview ? <StreamPreviewBlock label="LLM response" value={responsePreview} /> : null}
        {payloadPreview && !body ? <StreamPreviewBlock label="payload" value={payloadPreview} /> : null}

        {target ? (
          rawQuery.isLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              加载原始 LLM 请求…
            </div>
          ) : rawQuery.error ? (
            <ErrorState
              description={rawQuery.error instanceof Error ? rawQuery.error.message : '加载 raw trace 失败'}
              onRetry={() => void rawQuery.refetch()}
            />
          ) : rawQuery.data ? (
            <div className="border-t border-border pt-2">
              <div className="mb-2 flex flex-wrap gap-1.5">
                {[
                  rawQuery.data.model_name,
                  rawQuery.data.wire_provider_format,
                  rawQuery.data.slice_id ? `slice ${rawQuery.data.slice_id}` : null,
                ].filter(Boolean).map((badge) => (
                  <StatusPill key={badge as string} tone="neutral">{badge}</StatusPill>
                ))}
              </div>
              <Tabs defaultValue="request">
                <TabsList className="h-8">
                  <TabsTrigger value="request" className="text-xs">原始 LLM 请求</TabsTrigger>
                  <TabsTrigger value="response" className="text-xs">响应</TabsTrigger>
                </TabsList>
                <TabsContent value="request" className="mt-2 grid gap-2 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
                  <StructuredDataViewer title="Request Headers" value={rawQuery.data.request.headers} emptyLabel="无请求头" heightClassName="h-40" />
                  <StructuredDataViewer title="Request Body" value={rawQuery.data.request.body} emptyLabel="无请求体" heightClassName="h-40" />
                </TabsContent>
                <TabsContent value="response" className="mt-2 grid gap-2 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
                  <StructuredDataViewer title="Response Headers" value={rawQuery.data.response.headers} emptyLabel="无响应头" heightClassName="h-40" />
                  <StructuredDataViewer title="Response Body" value={rawQuery.data.response.body} emptyLabel="无响应体" heightClassName="h-40" />
                </TabsContent>
              </Tabs>
            </div>
          ) : null
        ) : (
          <div className="text-xs text-muted-foreground">此事件不对应 provider 调用，无原始 LLM 请求。</div>
        )}
      </div>
    </div>
  );
}

function StreamRow({
  entry,
  expanded,
  isFocused,
  density,
  onToggle,
}: {
  entry: StreamEntry;
  expanded: boolean;
  isFocused: boolean;
  density: 'compact' | 'comfortable';
  onToggle: () => void;
}) {
  const { item, fork } = entry;
  const tag = streamTypeTag(item);
  const snippet = streamSnippet(item);
  const who = item.source === 'function_call' || (typeof item.metadata?.toolName === 'string' && item.metadata.toolName)
    ? (item.metadata?.toolName as string)
    : null;
  const isModelRequest = tag.label === '模型请求';
  const modelName = metadataText(item.metadata, 'modelName');
  const inputTokens = formatTokenCount(metadataNumber(item.metadata, 'inputTokens'));
  const cachedTokens = formatTokenCount(metadataNumber(item.metadata, 'cachedInputTokens'));
  const outputTokens = formatTokenCount(metadataNumber(item.metadata, 'outputTokens'));
  return (
    <button
      type="button"
      onClick={onToggle}
      id={eventElementId(item.eventId || item.id)}
      data-event-id={item.eventId || item.id}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 text-left hover:bg-muted/50',
        density === 'compact' ? 'py-0.5' : 'py-1.5',
        expanded && 'bg-muted/50',
        isFocused && 'ring-2 ring-sky-500 ring-offset-1 ring-offset-background'
      )}
    >
      <time className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">{formatTimeOnly(entry.timestamp)}</time>
      {fork ? (
        <span className={cn('shrink-0 rounded border px-1.5 text-[10px] font-bold', forkChipClass(fork.kind))}>{fork.label}</span>
      ) : null}
      <StatusPill tone={tag.tone}>{tag.label}</StatusPill>
      {who ? <span className="shrink-0 font-mono text-[11px] text-foreground/80">{who}</span> : null}
      {isModelRequest ? (
        <span className="flex min-w-0 flex-1 items-center gap-2.5 text-[11px]">
          {modelName ? <span className="hidden shrink truncate text-muted-foreground sm:inline">{modelName}</span> : null}
          <span className="shrink-0 font-mono"><span className="text-muted-foreground">in</span> <span className="text-sky-700">{inputTokens ?? '—'}</span></span>
          <span className="shrink-0 font-mono"><span className="text-muted-foreground">cached</span> <span className="text-emerald-700">{cachedTokens ?? '0'}</span></span>
          <span className="shrink-0 font-mono"><span className="text-muted-foreground">out</span> <span className="text-violet-700">{outputTokens ?? '—'}</span></span>
        </span>
      ) : (
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-foreground/90">{snippet || '—'}</span>
      )}
      <span className="shrink-0 text-xs text-muted-foreground">{expanded ? '▾' : '▸'}</span>
    </button>
  );
}

function StreamTimeline({
  entries,
  focusEventId,
  density,
  splitPct,
  onSplitChange,
  expandedId,
  onToggleExpand,
}: {
  entries: StreamEntry[];
  focusEventId?: string;
  density: 'compact' | 'comfortable';
  splitPct: number;
  onSplitChange: (pct: number) => void;
  expandedId: string | null;
  onToggleExpand: (id: string) => void;
}) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const gridStyle: React.CSSProperties = {
    gridTemplateColumns: `minmax(0, ${splitPct}fr) minmax(0, ${100 - splitPct}fr)`,
  };

  const beginDrag = React.useCallback((event: React.PointerEvent) => {
    event.preventDefault();
    const move = (ev: PointerEvent) => {
      const node = containerRef.current;
      if (!node) {
        return;
      }
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0) {
        return;
      }
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      onSplitChange(Math.max(22, Math.min(72, Math.round(pct))));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [onSplitChange]);

  if (!entries.length) {
    return null;
  }

  return (
    <div ref={containerRef} className="relative rounded-lg border border-border bg-card px-2 py-2">
      <div
        className="absolute inset-y-0 z-20 -ml-2 flex w-4 cursor-col-resize touch-none items-stretch justify-center"
        style={{ left: `${splitPct}%` }}
        onPointerDown={beginDrag}
        role="separator"
        aria-orientation="vertical"
        title="拖动调整左右栏宽度"
      >
        <div className="w-px bg-border transition-colors hover:bg-sky-400" />
      </div>
      <div className={cn(density === 'compact' ? 'space-y-px' : 'space-y-1')}>
        {entries.map((entry, index) => {
          const day = formatDateOnly(entry.timestamp);
          const previousDay = index > 0 ? formatDateOnly(entries[index - 1].timestamp) : null;
          const showDay = day !== previousDay;
          const eventId = entry.item.eventId || entry.item.id;
          const isFocused = Boolean(focusEventId && eventId === focusEventId);
          const expanded = expandedId === entry.id;
          return (
            <React.Fragment key={entry.id}>
              {showDay ? (
                <div className="flex justify-center py-1">
                  <span className="rounded-full border border-border bg-background/90 px-3 py-0.5 text-[11px] font-semibold text-muted-foreground">{day}</span>
                </div>
              ) : null}
              <div className="grid items-start gap-0" style={gridStyle}>
                <div className="min-w-0 pr-3">
                  {entry.lane === 'fork' ? (
                    <StreamRow entry={entry} expanded={expanded} isFocused={isFocused} density={density} onToggle={() => onToggleExpand(entry.id)} />
                  ) : null}
                </div>
                <div className="min-w-0 border-l border-border pl-3">
                  {entry.lane === 'main' ? (
                    <StreamRow entry={entry} expanded={expanded} isFocused={isFocused} density={density} onToggle={() => onToggleExpand(entry.id)} />
                  ) : null}
                </div>
                {expanded ? (
                  <div className="col-span-2">
                    <StreamRowDetail item={entry.item} />
                  </div>
                ) : null}
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

function ForkFilterControls({
  roster,
  selected,
  onToggle,
  onShowAll,
}: {
  roster: ForkRosterEntry[];
  selected: string[];
  onToggle: (runId: string) => void;
  onShowAll: () => void;
}) {
  if (!roster.length) {
    return null;
  }
  const showAll = selected.length === 0;
  return (
    <section className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Waypoints className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-semibold text-foreground">Fork 筛选</span>
        <Button variant={showAll ? 'default' : 'outline'} size="sm" className="h-7 px-2.5 text-xs" onClick={onShowAll}>全部</Button>
        {roster.map((fork) => {
          const on = showAll || selected.includes(fork.runId);
          return (
            <Button
              key={fork.runId}
              variant={on ? 'default' : 'outline'}
              size="sm"
              aria-pressed={on}
              className="h-7 px-2.5 text-xs"
              onClick={() => onToggle(fork.runId)}
            >
              <span className={cn('mr-1.5 inline-block h-2 w-2 rounded-full border', forkChipClass(fork.kind))} />
              <span className="truncate">{fork.label}</span>
              <span className={cn('ml-1.5 font-mono text-[10px]', on ? 'text-primary-foreground/80' : 'text-muted-foreground')}>{fork.count}</span>
            </Button>
          );
        })}
      </div>
    </section>
  );
}

export const XiaoniActivityPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const timeRange = coerceTimeRange(searchParams.get('range'));
  const usageBucket = coerceUsageBucket(searchParams.get('bucket'));
  const usageSearch = searchParams.get('usage_search') || '';
  const actionTagParam = searchParams.get('tags') || '';
  const refreshValue = coerceActionStreamRefresh(searchParams.get('refresh'));
  const refreshInterval = getActionStreamRefreshInterval(refreshValue);
  const selectedActionTags = React.useMemo(() => parseActionStreamTagParam(actionTagParam), [actionTagParam]);
  const selectedActionTagParam = React.useMemo(() => serializeActionStreamTags(selectedActionTags), [selectedActionTags]);
  const focusEvent = searchParams.get('focus_event') || '';
  const focusSlice = searchParams.get('focus_slice') || '';
  const startTime = searchParams.get('start_time') || '';
  const endTime = searchParams.get('end_time') || '';
  const density: 'compact' | 'comfortable' = searchParams.get('density') === 'comfortable' ? 'comfortable' : 'compact';
  const splitPct = (() => {
    const raw = Number.parseInt(searchParams.get('split') || '', 10);
    return Number.isFinite(raw) ? Math.max(22, Math.min(72, raw)) : 35;
  })();
  const forkSelected = React.useMemo(
    () => (searchParams.get('fork') || '').split(',').map((value) => value.trim()).filter(Boolean),
    [searchParams]
  );
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const loadMoreRef = React.useRef<HTMLDivElement | null>(null);
  const {
    data: feedPages,
    isLoading,
    isFetching,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    error: feedError,
    refetch: refetchFeed,
  } = useInfiniteQuery<XiaoniActivityFeed>({
    queryKey: ['xiaoni-action-stream', timeRange, startTime, endTime, focusEvent, focusSlice, selectedActionTagParam],
    initialPageParam: null,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({
        limit: String(ACTION_STREAM_PAGE_SIZE),
        range: timeRange,
      });
      if (typeof pageParam === 'string' && pageParam) {
        params.set('before_time', pageParam);
      }
      if (timeRange === 'custom') {
        if (startTime) {
          params.set('start_time', formatIsoOffset(startTime, { fallback: startTime }));
        }
        if (endTime) {
          params.set('end_time', formatIsoOffset(endTime, { fallback: endTime }));
        }
      }
      if (focusEvent) {
        params.set('focus_event', focusEvent);
      }
      if (focusSlice) {
        params.set('focus_slice', focusSlice);
      }
      if (selectedActionTagParam) {
        params.set('tags', selectedActionTagParam);
      }
      const response = await fetch(`/api/xiaoni/action-stream?${params}`);
      const payload = await response.json() as ApiResponse<XiaoniActivityFeed>;
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Failed to load action stream');
      }
      return payload.data;
    },
    getNextPageParam: (lastPage) => (
      lastPage.pagination?.hasMore && lastPage.pagination.nextCursor
        ? lastPage.pagination.nextCursor
        : undefined
    ),
    refetchInterval: refreshInterval,
  });
  const feed = React.useMemo(() => mergeActionStreamPages(feedPages?.pages || []), [feedPages?.pages]);
  const {
    data: usageTimeline,
    isLoading: isUsageLoading,
    isFetching: isUsageFetching,
    error: usageError,
    refetch: refetchUsage,
  } = useQuery<XiaoniLlmUsageTimeline>({
    queryKey: ['xiaoni-llm-usage', timeRange, startTime, endTime, usageBucket, usageSearch],
    queryFn: async () => {
      const params = new URLSearchParams({
        range: timeRange,
        bucket: usageBucket,
        max_points: '1200',
        include_peaks: '1',
        include_minimap: '1',
      });
      if (timeRange === 'custom') {
        if (startTime) {
          params.set('start_time', formatIsoOffset(startTime, { fallback: startTime }));
        }
        if (endTime) {
          params.set('end_time', formatIsoOffset(endTime, { fallback: endTime }));
        }
      }
      if (usageSearch.trim()) {
        params.set('include_overlays', 'search');
        params.set('search_q', usageSearch.trim());
      }
      const response = await fetch(`/api/xiaoni/action-stream/llm-usage?${params}`);
      const payload = await response.json() as ApiResponse<XiaoniLlmUsageTimeline>;
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Failed to load LLM usage');
      }
      return payload.data;
    },
    refetchInterval: usageSearch.trim() ? false : refreshInterval,
  });
  const { data: ccQuotaResp } = useQuery<{ success: boolean; data: CcQuotaSnapshot | null }>({
    queryKey: ['cc-usage-quota'],
    queryFn: async () => {
      const response = await fetch('/api/cc-usage/quota');
      if (!response.ok) {
        throw new Error(`quota request failed: ${response.status}`);
      }
      return await response.json() as { success: boolean; data: CcQuotaSnapshot | null };
    },
    refetchInterval: refreshInterval,
  });
  const ccQuotaSnapshot = ccQuotaResp?.data ?? null;
  const { data: ccTimelineResp, isLoading: isCcTimelineLoading } = useQuery<{ success: boolean; data: CcQuotaTimelineResult }>({
    queryKey: ['cc-usage-timeline', timeRange, startTime, endTime],
    queryFn: async () => {
      const params = new URLSearchParams({ range: timeRange });
      if (timeRange === 'custom') {
        if (startTime) {
          params.set('start_time', formatIsoOffset(startTime, { fallback: startTime }));
        }
        if (endTime) {
          params.set('end_time', formatIsoOffset(endTime, { fallback: endTime }));
        }
      }
      const response = await fetch(`/api/cc-usage/timeline?${params}`);
      if (!response.ok) {
        throw new Error(`cc timeline request failed: ${response.status}`);
      }
      return await response.json() as { success: boolean; data: CcQuotaTimelineResult };
    },
    refetchInterval: refreshInterval,
  });
  const ccQuotaTimeline = ccTimelineResp?.data ?? null;

  const mainItems = React.useMemo(() => (feed?.items || []).filter((item) => !isImageVisionForkMainItem(item)), [feed?.items]);
  const forkRuns = React.useMemo(() => buildForkAgentRuns(feed), [feed]);
  const forkRoster = React.useMemo(() => buildForkRoster(forkRuns), [forkRuns]);
  const streamEntries = React.useMemo(() => buildStreamEntries(mainItems, forkRuns), [mainItems, forkRuns]);
  const visibleEntries = React.useMemo(() => {
    if (!forkSelected.length) {
      return streamEntries;
    }
    const visible = new Set(forkSelected);
    return streamEntries.filter((entry) => entry.lane === 'main' || (entry.fork && visible.has(entry.fork.runId)));
  }, [streamEntries, forkSelected]);
  const forkCount = forkRuns.length;
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

  const handleToggleExpand = React.useCallback((id: string) => {
    setExpandedId((current) => (current === id ? null : id));
  }, []);

  const handleDensityChange = React.useCallback((next: 'compact' | 'comfortable') => {
    updateSearchParam((nextParams) => {
      if (next === 'compact') {
        nextParams.delete('density');
      } else {
        nextParams.set('density', next);
      }
    });
  }, [updateSearchParam]);

  const handleSplitChange = React.useCallback((pct: number) => {
    updateSearchParam((nextParams) => {
      if (pct === 35) {
        nextParams.delete('split');
      } else {
        nextParams.set('split', String(pct));
      }
    });
  }, [updateSearchParam]);

  const handleForkShowAll = React.useCallback(() => {
    updateSearchParam((nextParams) => {
      nextParams.delete('fork');
    });
  }, [updateSearchParam]);

  const handleForkToggle = React.useCallback((runId: string) => {
    const allIds = forkRoster.map((fork) => fork.runId);
    const current = forkSelected.length ? forkSelected : allIds;
    const next = current.includes(runId)
      ? current.filter((id) => id !== runId)
      : [...current, runId];
    updateSearchParam((nextParams) => {
      if (!next.length || next.length === allIds.length) {
        nextParams.delete('fork');
      } else {
        nextParams.set('fork', next.join(','));
      }
    });
  }, [forkRoster, forkSelected, updateSearchParam]);

  const handleUsageBucketChange = React.useCallback((nextBucket: UsageBucket) => {
    updateSearchParam((nextParams) => {
      nextParams.set('bucket', nextBucket);
    });
  }, [updateSearchParam]);

  const handleUsageSearchChange = React.useCallback((nextQuery: string) => {
    updateSearchParam((nextParams) => {
      const trimmed = nextQuery.trim();
      if (trimmed) {
        nextParams.set('usage_search', trimmed);
      } else {
        nextParams.delete('usage_search');
      }
    });
  }, [updateSearchParam]);

  const handleRefreshEnabledChange = React.useCallback((enabled: boolean) => {
    updateSearchParam((nextParams) => {
      if (enabled) {
        nextParams.set('refresh', DEFAULT_ACTION_STREAM_REFRESH);
      } else {
        nextParams.set('refresh', 'off');
      }
    });
  }, [updateSearchParam]);

  const handleRefreshIntervalChange = React.useCallback((nextValue: ActionStreamRefreshValue) => {
    updateSearchParam((nextParams) => {
      nextParams.set('refresh', nextValue);
    });
  }, [updateSearchParam]);

  const handleActionTagToggle = React.useCallback((tagKey: string) => {
    updateSearchParam((nextParams) => {
      const nextTags = serializeActionStreamTags(toggleActionStreamTag(selectedActionTags, tagKey));
      if (nextTags) {
        nextParams.set('tags', nextTags);
      } else {
        nextParams.delete('tags');
      }
      nextParams.delete('focus_event');
      nextParams.delete('focus_slice');
    });
  }, [selectedActionTags, updateSearchParam]);

  const handleActionTagsClear = React.useCallback(() => {
    updateSearchParam((nextParams) => {
      nextParams.delete('tags');
      nextParams.delete('focus_event');
      nextParams.delete('focus_slice');
    });
  }, [updateSearchParam]);

  const handleUsageWindowSelect = React.useCallback((nextStartTime: Date, nextEndTime: Date, options?: { endIsNow?: boolean }) => {
    updateSearchParam((nextParams) => {
      nextParams.set('range', 'custom');
      nextParams.set('start_time', localInputFromIso(nextStartTime.toISOString()));
      if (options?.endIsNow) {
        nextParams.delete('end_time');
      } else {
        nextParams.set('end_time', localInputFromIso(nextEndTime.toISOString()));
      }
      nextParams.delete('focus_event');
      nextParams.delete('focus_slice');
    });
  }, [updateSearchParam]);

  const handleUsagePointFocus = React.useCallback((point: XiaoniLlmUsagePoint) => {
    updateSearchParam((nextParams) => {
      if (point.anchorEventId) {
        nextParams.set('focus_event', point.anchorEventId);
      }
      if (point.llmRequestSliceId && point.sourceKind !== 'compression_fork' && point.sourceKind !== 'subconscious_agent_fork' && point.sourceKind !== 'image_vision_fork' && point.sourceKind !== 'cache_heartbeat') {
        nextParams.set('focus_slice', point.llmRequestSliceId);
      } else {
        nextParams.delete('focus_slice');
      }
    });
  }, [updateSearchParam]);

  React.useEffect(() => {
    const node = loadMoreRef.current;
    if (!node || !hasNextPage) {
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting) && !isFetchingNextPage) {
        void fetchNextPage();
      }
    }, { rootMargin: '720px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, visibleEntries.length]);

  React.useEffect(() => {
    if (!focusEvent || !feed) {
      return;
    }
    const handle = window.setTimeout(() => {
      document.getElementById(eventElementId(focusEvent))?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }, 80);
    return () => window.clearTimeout(handle);
  }, [feed, focusEvent]);

  return (
    <PageShell className="w-full max-w-none space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {feed ? <PageHeaderBadge>{mainItems.length} Main · {forkCount} Forks · {rangeBadge}</PageHeaderBadge> : null}
          {isLoading ? <StatusPill tone="neutral">loading</StatusPill> : null}
          {feed?.current.runtime ? (
            <StatusPill tone={feed.current.runtime.live ? 'success' : 'warning'}>
              runtime {feed.current.runtime.status || 'unknown'}
            </StatusPill>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {ccQuotaSnapshot ? (
            <>
              <QuotaMiniBar label="5h" win={ccQuotaSnapshot.windows?.fiveHour} />
              <QuotaMiniBar label="周" win={ccQuotaSnapshot.windows?.weekly} />
            </>
          ) : null}
          <div className="flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm shadow-sm">
            <Switch
              checked={refreshValue !== 'off'}
              onCheckedChange={handleRefreshEnabledChange}
              aria-label="自动刷新"
            />
            <span className="whitespace-nowrap text-muted-foreground">自动刷新</span>
            <Select
              value={refreshValue === 'off' ? DEFAULT_ACTION_STREAM_REFRESH : refreshValue}
              onValueChange={(value) => handleRefreshIntervalChange(value as ActionStreamRefreshValue)}
              disabled={refreshValue === 'off'}
            >
              <SelectTrigger className="h-7 w-[82px] border-border bg-background px-2 py-1 text-xs shadow-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACTION_STREAM_REFRESH_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void refetchFeed();
              void refetchUsage();
            }}
            disabled={isFetching || isUsageFetching}
          >
            <RefreshCw className={cn('mr-2 h-4 w-4', (isFetching || isUsageFetching) && 'animate-spin')} />
            刷新
          </Button>
        </div>
      </div>

      <TimeRangeControls
        range={timeRange}
        startTime={startTime}
        endTime={endTime}
        onRangeChange={handleRangeChange}
        onCustomTimeChange={handleCustomTimeChange}
      />

      <ActionStreamTagFilterControls
        availableTags={feed?.availableTags || []}
        selectedTags={selectedActionTags}
        onToggleTag={handleActionTagToggle}
        onClearTags={handleActionTagsClear}
      />

      <XiaoniUsageObservatory
        timeline={usageTimeline}
        quotaTimeline={ccQuotaTimeline}
        isQuotaLoading={isCcTimelineLoading}
        bucket={usageBucket}
        searchQuery={usageSearch}
        isLoading={isUsageLoading}
        isFetching={isUsageFetching}
        onBucketChange={handleUsageBucketChange}
        onSearchQueryChange={handleUsageSearchChange}
        onSelectWindow={handleUsageWindowSelect}
        onFocusPoint={handleUsagePointFocus}
      />
      {usageError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {usageError instanceof Error ? usageError.message : '加载 LLM usage 失败'}
        </div>
      ) : null}

      <main className="min-w-0">
        {feedError ? (
          <ErrorState description={feedError instanceof Error ? feedError.message : '加载小腻行动流失败'} onRetry={() => void refetchFeed()} />
        ) : null}

        {isLoading && !feed ? (
          <div className="flex h-64 items-center justify-center gap-3 text-sm text-muted-foreground">
            <Loader2 className="h-7 w-7 animate-spin text-primary" />
            加载行动流...
          </div>
        ) : null}

        {feed && mainItems.length === 0 && forkCount === 0 ? (
          <EmptyState icon={<Bot className="h-10 w-10" />} title="暂无行动事件" description="还没有小腻行动流记录。" />
        ) : null}

        {feed && (mainItems.length > 0 || forkCount > 0) ? (
          <div className="space-y-3">
            <ForkFilterControls
              roster={forkRoster}
              selected={forkSelected}
              onToggle={handleForkToggle}
              onShowAll={handleForkShowAll}
            />
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">密度</span>
              <div className="inline-flex overflow-hidden rounded-md border border-border">
                <button
                  type="button"
                  className={cn('px-2.5 py-1', density === 'compact' ? 'bg-primary text-primary-foreground' : 'bg-background')}
                  onClick={() => handleDensityChange('compact')}
                >
                  紧凑
                </button>
                <button
                  type="button"
                  className={cn('px-2.5 py-1', density === 'comfortable' ? 'bg-primary text-primary-foreground' : 'bg-background')}
                  onClick={() => handleDensityChange('comfortable')}
                >
                  舒适
                </button>
              </div>
              <span className="ml-auto font-mono">左 {splitPct}% / 右 {100 - splitPct}% · 拖动中线调整</span>
            </div>
            <StreamTimeline
              entries={visibleEntries}
              focusEventId={focusEvent || undefined}
              density={density}
              splitPct={splitPct}
              onSplitChange={handleSplitChange}
              expandedId={expandedId}
              onToggleExpand={handleToggleExpand}
            />
            {hasNextPage ? (
              <div className="flex justify-center border-t border-border pt-4">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void fetchNextPage()}
                  disabled={isFetchingNextPage}
                >
                  <ChevronsDown className={cn('mr-2 h-4 w-4', isFetchingNextPage && 'animate-bounce')} />
                  {isFetchingNextPage ? '加载中' : '加载更多'}
                </Button>
                <div ref={loadMoreRef} className="h-px w-px" aria-hidden="true" />
              </div>
            ) : null}
          </div>
        ) : null}
      </main>
    </PageShell>
  );
};
