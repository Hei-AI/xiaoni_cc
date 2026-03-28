import {
  ConversationTraceData,
  TraceInspectorSection,
  TraceMetric,
  TraceSpanRecord,
  TraceWaterfallMeta,
  TraceWaterfallRow,
  TraceWaterfallViewModel,
} from '@/types';
import { formatTimestamp } from '@/lib/utils';

function toMillis(value?: string | null): number {
  if (!value) {
    return 0;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function formatDuration(value?: number | null): string {
  if (value === null || value === undefined) {
    return 'n/a';
  }
  if (value < 1000) {
    return `${value}ms`;
  }
  return `${(value / 1000).toFixed(1)}s`;
}

function safePreview(value: any, maxLength = 120): string {
  if (value === null || value === undefined || value === '') {
    return 'No summary available';
  }

  const raw =
    typeof value === 'string'
      ? value
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);

  const compact = raw.replace(/\s+/g, ' ').trim();
  if (!compact) {
    return 'No summary available';
  }
  return compact.length > maxLength ? `${compact.slice(0, maxLength)}...` : compact;
}

function buildMetricTone(value: string): TraceMetric['tone'] {
  if (value === 'ok' || value === 'success') {
    return 'success';
  }
  if (value === 'error') {
    return 'danger';
  }
  return 'warning';
}

function semanticRole(record: TraceSpanRecord): string {
  return String(record.attributes['semantic.role'] || record.kind);
}

function evidenceValue(record: TraceSpanRecord, key: string): string | null {
  const value = record.evidence?.[key];
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return String(value);
}

function playgroundCapability(record: TraceSpanRecord): 'exact' | 'partial' | 'unsupported' {
  const explicit = record.playground_capability
    || record.evidence?.playground_capability
    || record.attributes['playground.capability'];
  if (explicit === 'exact' || explicit === 'partial') {
    return explicit;
  }
  return 'unsupported';
}

function displayName(record: TraceSpanRecord): string {
  return String(record.attributes['semantic.display_name'] || record.name);
}

function buildSubtitle(record: TraceSpanRecord): string | null {
  const semantic = semanticRole(record);
  if (semantic === 'generation') {
    return [record.attributes['llm.model_provider'], record.attributes['llm.model_name']].filter(Boolean).join(' / ') || null;
  }
  if (semantic === 'provider_exchange') {
    const count = record.attributes['provider.request_count'];
    const hosts = Array.isArray(record.attributes['provider.hosts'])
      ? (record.attributes['provider.hosts'] as unknown[]).join(', ')
      : String(record.attributes['provider.hosts'] || '');
    return [count ? `${count} request(s)` : null, hosts || null].filter(Boolean).join(' / ') || null;
  }
  if (semantic === 'provider_request') {
    return [record.attributes['provider.api_type'], record.attributes['http.host'], record.attributes['http.path']]
      .filter(Boolean)
      .join(' / ') || null;
  }
  if (semantic === 'external_http') {
    return String(record.attributes['http.path'] || record.attributes['http.url'] || '') || null;
  }
  if (semantic === 'invocation') {
    return String(record.attributes['tool.method_id'] || record.attributes['semantic.capability'] || '') || null;
  }
  return null;
}

function buildBadges(record: TraceSpanRecord): string[] {
  const badges = [
    record.kind,
    semanticRole(record),
    record.attributes['llm.model_name'],
    record.attributes['tool.name'],
    record.attributes['http.method'],
  ].filter((item): item is string => Boolean(item && typeof item === 'string'));

  return Array.from(new Set(badges)).slice(0, 4);
}

function buildMeta(record: TraceSpanRecord): TraceWaterfallMeta[] {
  const items: TraceWaterfallMeta[] = [
    { label: 'Status', value: record.status_code },
    { label: 'Duration', value: formatDuration(record.duration_ms) },
  ];

  if (record.attributes['usage.input_tokens'] || record.attributes['usage.output_tokens']) {
    items.push({
      label: 'Tokens',
      value: `${record.attributes['usage.input_tokens'] ?? 0}/${record.attributes['usage.output_tokens'] ?? 0}`,
    });
  }

  if (record.attributes['http.status_code']) {
    items.push({
      label: 'HTTP',
      value: String(record.attributes['http.status_code']),
    });
  }

  if (record.attributes['tool.execution_mode']) {
    items.push({
      label: 'Mode',
      value: String(record.attributes['tool.execution_mode']),
    });
  }

  if (record.attributes['provider.request_count']) {
    items.push({
      label: 'Provider',
      value: `${record.attributes['provider.request_count']} request(s)`,
    });
  }

  const providerStatuses = Array.isArray(record.attributes['provider.statuses'])
    ? (record.attributes['provider.statuses'] as unknown[]).join(', ')
    : null;
  if (providerStatuses) {
    items.push({
      label: 'Provider Status',
      value: providerStatuses,
    });
  }

  return items.slice(0, 4);
}

function createInspectorSections(record: TraceSpanRecord): TraceInspectorSection[] {
  return [
    { id: 'input', label: 'Input', value: record.input, emptyLabel: 'No input captured' },
    { id: 'output', label: 'Output', value: record.output, emptyLabel: 'No output captured' },
    { id: 'evidence', label: 'Evidence', value: record.evidence, emptyLabel: 'No evidence captured' },
  ];
}

function subtreeErrorCount(rowId: string, byParent: Map<string, TraceSpanRecord[]>): number {
  const children = byParent.get(rowId) || [];
  return children.reduce((sum, child) => {
    const self = child.status_code === 'error' ? 1 : 0;
    return sum + self + subtreeErrorCount(child.span_id, byParent);
  }, 0);
}

function buildRows(trace: ConversationTraceData): TraceWaterfallRow[] {
  const rows = [...trace.spans].sort((left, right) => left.sort_key.localeCompare(right.sort_key));
  const byParent = new Map<string, TraceSpanRecord[]>();
  const byId = new Map(rows.map((row) => [row.span_id, row]));
  rows.forEach((row) => {
    const key = row.parent_span_id || '__root__';
    const bucket = byParent.get(key) || [];
    bucket.push(row);
    byParent.set(key, bucket);
  });

  const traceStartMs = toMillis(trace.trace.started_at);
  const totalDuration = Math.max(trace.trace.duration_ms || 0, 1);

  return rows.map((record) => {
    const title = displayName(record);
    const subtitle = buildSubtitle(record);
    const pathTokens: string[] = [];
    let cursor: TraceSpanRecord | undefined = record;

    while (cursor) {
      pathTokens.unshift(displayName(cursor));
      cursor = cursor.parent_span_id ? byId.get(cursor.parent_span_id) : undefined;
    }

    const timelineOffsetMs = Math.max(0, toMillis(record.started_at) - traceStartMs);
    const timelineWidthRatio = Math.max((record.duration_ms || 0) / totalDuration, 0.015);
    const children = byParent.get(record.span_id) || [];
    const role = semanticRole(record);
    const providerRequestChild = role === 'generation'
      ? children.find((child) => semanticRole(child) === 'provider_request')
      : null;
    const providerExchangeChild = role === 'generation'
      ? children.find((child) => semanticRole(child) === 'provider_exchange')
      : null;
    const legacyProviderRequestChild = providerExchangeChild
      ? (byParent.get(providerExchangeChild.span_id) || []).find((child) => semanticRole(child) === 'provider_request')
      : null;
    const llmCallId = String(
      record.attributes['trace.llm_call_id']
      || evidenceValue(record, 'llm_call_id')
      || ''
    ) || null;
    const trafficLogId = record.evidence?.traffic_log_id ?? null;

    return {
      id: record.span_id,
      parentId: record.parent_span_id,
      spanId: record.span_id,
      depth: record.depth,
      pathTokens,
      title,
      subtitle,
      summary: safePreview(record.summary),
      status: record.status_code,
      kind: record.kind,
      semanticRole: role,
      startedAt: record.started_at,
      endedAt: record.ended_at,
      durationMs: record.duration_ms,
      timelineOffsetMs,
      timelineWidthRatio,
      hasChildren: children.length > 0,
      defaultExpanded: record.depth < 2
        || record.status_code === 'error'
        || role === 'turn'
        || role === 'provider_exchange'
        || Boolean(providerRequestChild)
        || Boolean(providerExchangeChild),
      errorCountInSubtree: subtreeErrorCount(record.span_id, byParent),
      badges: buildBadges(record),
      meta: buildMeta(record),
      sourceRef: record.source_ref,
      playgroundCapability: playgroundCapability(record),
      providerRequestSpanId: providerRequestChild?.span_id || legacyProviderRequestChild?.span_id || null,
      trafficLogId,
      llmCallId,
      inspector: {
        title,
        subtitle,
        sections: createInspectorSections(record),
      },
    };
  });
}

function buildMetrics(trace: ConversationTraceData): TraceMetric[] {
  const roleCounts = trace.spans.reduce<Record<string, number>>((acc, span) => {
    const role = semanticRole(span);
    acc[role] = (acc[role] || 0) + 1;
    return acc;
  }, {});

  return [
    {
      label: '总耗时',
      value: formatDuration(trace.trace.duration_ms),
      detail: `${formatTimestamp(trace.trace.started_at, { fallback: 'n/a' })} -> ${formatTimestamp(trace.trace.ended_at, { fallback: 'n/a' })}`,
    },
    {
      label: '状态',
      value: trace.trace.status,
      detail: trace.trace.summary,
      tone: buildMetricTone(trace.trace.first_error ? 'error' : 'ok'),
    },
    {
      label: 'Span 数',
      value: String(trace.trace.span_count),
      detail: `Error ${trace.trace.error_count}`,
      tone: trace.trace.error_count > 0 ? 'danger' : 'success',
    },
    {
      label: 'Turns',
      value: String(roleCounts.turn || 0),
      detail: `LLM ${roleCounts.generation || 0} / Tool ${roleCounts.invocation || 0}`,
    },
    {
      label: 'HTTP',
      value: String((roleCounts.external_http || 0) + (roleCounts.provider_request || 0)),
      detail: `Provider ${roleCounts.provider_request || 0} / Delivery ${roleCounts.delivery || 0}`,
    },
    {
      label: '瓶颈',
      value: trace.trace.bottleneck?.title || 'n/a',
      detail: formatDuration(trace.trace.bottleneck?.duration_ms),
      tone: 'warning',
    },
  ];
}

export function buildTraceFlowViewModel(trace: ConversationTraceData): TraceWaterfallViewModel {
  const rows = buildRows(trace);
  const selectedSpanId = trace.trace.first_error?.span_id || rows.find((row) => row.semanticRole === 'turn')?.spanId || trace.trace.root_span_id;

  return {
    rows,
    selectedSpanId,
    traceStartMs: toMillis(trace.trace.started_at),
    traceDurationMs: Math.max(trace.trace.duration_ms || 1, 1),
    metrics: buildMetrics(trace),
    metadataBadges: [
      `trace_id: ${trace.trace.trace_id}`,
      ...(trace.batch_id ? [`batch_id: ${trace.batch_id}`] : []),
      `status: ${trace.trace.status}`,
      `data_quality: ${trace.data_quality.overall || 'partial'}`,
    ],
  };
}
