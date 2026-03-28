import winston from 'winston';
import { listTraceTrafficLogs, parseInstantValue, serializeTimestampForApi } from '@qq-bot/persistence';
import { DatabaseManager } from './database';

type TraceConfidence = 'observed' | 'derived' | 'missing';

interface TraceSpanEventDto {
  id: string;
  name: string;
  timestamp: string | null;
  attributes: Record<string, unknown>;
}

interface TraceSpanLinkDto {
  id: string;
  linked_trace_id: string | null;
  linked_span_id: string | null;
  attributes: Record<string, unknown>;
}

interface TraceSpanDto {
  span_id: string;
  parent_span_id: string | null;
  trace_id: string;
  conversation_id: string | null;
  name: string;
  kind: 'internal' | 'client' | 'server' | 'producer' | 'consumer';
  status_code: 'unset' | 'ok' | 'error';
  status_message: string | null;
  started_at: string | null;
  ended_at: string | null;
  duration_ms: number | null;
  depth: number;
  sort_key: string;
  summary: string;
  attributes: Record<string, unknown>;
  input: unknown;
  output: unknown;
  evidence: unknown;
  events: TraceSpanEventDto[];
  links: TraceSpanLinkDto[];
  confidence: TraceConfidence;
  source_ref: string | number | null;
}

function parseJsonField<T>(value: any, fallback: T): T {
  if (value === null || value === undefined) {
    return fallback;
  }
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (_error) {
      return fallback;
    }
  }
  if (typeof value === 'object') {
    return value as T;
  }
  return fallback;
}

function toNumber(value: any): number | null {
  const numericValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function toIsoString(value: any): string | null {
  return serializeTimestampForApi(value) as string | null;
}

function toMillis(value: any): number | null {
  const parsed = parseInstantValue(value);
  return parsed ? parsed.getTime() : null;
}

function getDurationMs(startAt?: any, endAt?: any, fallback?: any): number | null {
  const start = toMillis(startAt);
  const end = toMillis(endAt);
  if (start !== null && end !== null) {
    return Math.max(0, end - start);
  }
  const fallbackValue = toNumber(fallback);
  return fallbackValue !== null ? Math.max(0, fallbackValue) : null;
}

function compareTimes(left: any, right: any, leftFallback = 0, rightFallback = 0): number {
  const leftTime = toMillis(left) ?? leftFallback;
  const rightTime = toMillis(right) ?? rightFallback;
  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  return 0;
}

function safePreview(value: unknown, maxLength = 140): string {
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

function normalizeStatusCode(value: any): 'unset' | 'ok' | 'error' {
  const normalized = (value ?? '').toString().trim().toLowerCase();
  if (!normalized) {
    return 'unset';
  }
  if (['success', 'completed', 'sent', 'ok'].includes(normalized)) {
    return 'ok';
  }
  if (['failed', 'error', 'timeout', 'cancelled'].includes(normalized)) {
    return 'error';
  }
  return 'unset';
}

function normalizeLlmCall(call: any) {
  const tokenUsage = parseJsonField<any>(call.token_usage, {});
  const effectiveUnifiedConfig = parseJsonField<any>(call.effective_unified_config, null);
  return {
    id: call.id,
    llm_call_id: call.llm_call_id || null,
    trace_id: call.trace_id,
    conversation_id: call.conversation_id || null,
    agent_turn: toNumber(call.agent_turn),
    call_sequence: toNumber(call.call_sequence) || 0,
    started_at: toIsoString(call.started_at || (call.timestamp && call.api_call_time_ms
      ? new Date(new Date(call.timestamp).getTime() - Number(call.api_call_time_ms))
      : null) || call.timestamp),
    completed_at: toIsoString(call.completed_at || call.timestamp),
    duration_ms: getDurationMs(call.started_at, call.completed_at || call.timestamp, call.api_call_time_ms || call.processing_time_ms),
    status: normalizeStatusCode(call.status),
    model_name: call.model_name,
    model_provider: call.model_provider,
    agent_type: call.agent_type,
    prompt_template: call.prompt_template,
    canonical_request: parseJsonField<any>(call.canonical_request, null),
    wire_request: parseJsonField<any>(call.wire_request, null),
    canonical_response: parseJsonField<any>(call.canonical_response, null),
    wire_response: parseJsonField<any>(call.wire_response, null),
    effective_unified_config: effectiveUnifiedConfig,
    processed_response: call.processed_response || null,
    input_tokens: toNumber(call.input_tokens),
    output_tokens: toNumber(call.output_tokens),
    token_usage: tokenUsage,
    api_call_time_ms: toNumber(call.api_call_time_ms),
    processing_time_ms: toNumber(call.processing_time_ms),
    error_message: call.error_message || null,
    error_code: call.error_code || null,
    request_format_version: call.request_format_version || null,
    wire_provider_format: call.wire_provider_format || null,
    http_requests: [] as any[],
    provider_requests: [] as any[]
  };
}

function buildPlaygroundCapability(call: any): 'exact' | 'unsupported' {
  return call.canonical_request && call.effective_unified_config ? 'exact' : 'unsupported';
}

function buildPlaygroundSnapshot(call: any, spanId: string) {
  return {
    traceId: call.trace_id || null,
    conversationId: call.conversation_id || null,
    llmCallId: call.llm_call_id || null,
    spanId,
    agentTurn: call.agent_turn ?? null,
    provider: call.model_provider || null,
    modelName: call.model_name || null,
    canonicalRequest: call.canonical_request,
    canonicalResponse: call.canonical_response,
    wireRequest: call.wire_request,
    wireResponse: call.wire_response,
    requestFormatVersion: call.request_format_version || null,
    wireProviderFormat: call.wire_provider_format || null,
    effectiveUnifiedConfig: call.effective_unified_config || null
  };
}

function normalizeToolCall(call: any) {
  return {
    id: call.id,
    tool_call_id: call.tool_call_id || null,
    trace_id: call.trace_id,
    conversation_id: call.conversation_id || null,
    job_id: call.job_id || null,
    agent_turn: toNumber(call.agent_turn),
    llm_call_id: call.llm_call_id || null,
    tool_type: call.tool_type,
    tool_name: call.tool_name,
    method_id: call.method_id || null,
    arguments: parseJsonField<any>(call.arguments, null),
    result: parseJsonField<any>(call.result, null),
    status: normalizeStatusCode(call.status),
    error_message: call.error_message || null,
    execution_mode: call.execution_mode || null,
    side_effect: Boolean(call.side_effect),
    started_at: toIsoString(call.started_at),
    completed_at: toIsoString(call.completed_at || call.started_at),
    duration_ms: getDurationMs(call.started_at, call.completed_at, call.duration_ms),
    http_requests: [] as any[]
  };
}

function normalizeHttpLog(log: any) {
  const statusCode = toNumber(log.response_status);
  return {
    id: log.id,
    trace_id: log.trace_id || null,
    conversation_id: log.conversation_id || null,
    user_id: log.user_id || null,
    session_id: log.session_id || null,
    agent_turn: toNumber(log.agent_turn),
    llm_call_id: log.llm_call_id || null,
    tool_call_id: log.tool_call_id || null,
    request_id: log.request_id || null,
    method: log.method,
    url: log.url,
    host: log.host,
    path: log.path,
    status: statusCode !== null && statusCode < 400 ? 'ok' : (log.error_message ? 'error' : 'unset'),
    response_status: statusCode,
    request_timestamp: toIsoString(log.request_timestamp),
    response_timestamp: toIsoString(log.response_timestamp || log.request_timestamp),
    duration_ms: getDurationMs(log.request_timestamp, log.response_timestamp, log.duration_ms),
    request_headers: parseJsonField<any>(log.request_headers, {}),
    response_headers: parseJsonField<any>(log.response_headers, {}),
    request_body: log.request_body || null,
    response_body: log.response_body || null,
    is_ai_request: Boolean(log.is_ai_request),
    api_type: log.api_type || null,
    api_version: log.api_version || null,
    error_message: log.error_message || null,
    attribution: 'unattributed' as 'tool_call_id' | 'llm_call_id' | 'time_window' | 'unattributed'
  };
}

function summarizeProviderStatuses(logs: any[]): number[] {
  return Array.from(
    new Set(
      logs
        .map((log) => toNumber(log.response_status))
        .filter((value): value is number => value !== null)
    )
  ).sort((left, right) => left - right);
}

function summarizeProviderHosts(logs: any[]): string[] {
  return Array.from(
    new Set(
      logs
        .map((log) => (typeof log.host === 'string' ? log.host.trim() : ''))
        .filter(Boolean)
    )
  ).sort((left, right) => left.localeCompare(right));
}

function normalizeQueueMessage(row: any) {
  return {
    id: row.id,
    trace_id: row.trace_id,
    source: row.source || null,
    message_sid: row.message_sid || null,
    chat_type: row.chat_type || null,
    session_key: row.session_key || null,
    status: row.status || null,
    sender_id: row.sender_id || null,
    sender_name: row.sender_name || null,
    peer_id: row.peer_id || null,
    peer_name: row.peer_name || null,
    body_for_agent: row.body_for_agent || null,
    raw_payload: parseJsonField<any>(row.raw_payload, {}),
    inbound_context: parseJsonField<any>(row.inbound_context, {}),
    payload: parseJsonField<any>(row.payload, {}),
    created_at: toIsoString(row.created_at),
    processing_started_at: toIsoString(row.processing_started_at),
    completed_at: toIsoString(row.completed_at),
    conversation_id: row.conversation_id || null,
    error_message: row.error_message || null,
    result: parseJsonField<any>(row.result, {})
  };
}

function attachHttpLogs(toolCalls: any[], llmCalls: any[], httpLogs: any[]) {
  const toolById = new Map(toolCalls.filter((item) => item.tool_call_id).map((item) => [item.tool_call_id, item]));
  const llmById = new Map(llmCalls.filter((item) => item.llm_call_id).map((item) => [item.llm_call_id, item]));
  const unattributed: any[] = [];

  for (const httpLog of httpLogs) {
    if (httpLog.tool_call_id && toolById.has(httpLog.tool_call_id)) {
      httpLog.attribution = 'tool_call_id';
      toolById.get(httpLog.tool_call_id)!.http_requests.push(httpLog);
      continue;
    }

    if (httpLog.llm_call_id && llmById.has(httpLog.llm_call_id)) {
      httpLog.attribution = 'llm_call_id';
      const llmCall = llmById.get(httpLog.llm_call_id)!;
      if (httpLog.is_ai_request) {
        llmCall.provider_requests.push(httpLog);
      } else {
        llmCall.http_requests.push(httpLog);
      }
      continue;
    }

    const requestTime = toMillis(httpLog.request_timestamp);
    const matchingTool = toolCalls.find((toolCall) => {
      const start = toMillis(toolCall.started_at);
      const end = toMillis(toolCall.completed_at || toolCall.started_at);
      return requestTime !== null && start !== null && end !== null && requestTime >= start && requestTime <= end;
    });

    if (matchingTool) {
      httpLog.attribution = 'time_window';
      matchingTool.http_requests.push(httpLog);
      continue;
    }

    unattributed.push(httpLog);
  }

  return unattributed;
}

function pairTimelineEvents(events: any[]) {
  const startMap = new Map<string, any[]>();
  const spans: Array<{
    id: string;
    type: string;
    started_at: string | null;
    ended_at: string | null;
    duration_ms: number | null;
    status: 'unset' | 'ok' | 'error';
    title: string;
    summary: string;
    evidence: any;
    events: TraceSpanEventDto[];
    confidence: TraceConfidence;
  }> = [];

  const buildLifecycleType = (eventType: string, eventName: string) => {
    const combined = `${eventType}.${eventName}`.toLowerCase();
    if (combined.includes('queue')) return 'queue';
    if (combined.includes('context')) return 'context';
    if (combined.includes('decision')) return 'decision';
    if (combined.includes('delivery')) return 'delivery';
    if (combined.includes('trace')) return 'terminal';
    return eventType || 'trace';
  };

  for (const event of events) {
    const key = `${event.event_type}:${event.event_name}`;
    const eventDto: TraceSpanEventDto = {
      id: `timeline-event-${event.id}`,
      name: `${event.event_type}.${event.event_name}.${event.event_phase || 'instant'}`,
      timestamp: toIsoString(event.event_time),
      attributes: {
        event_type: event.event_type,
        event_name: event.event_name,
        event_phase: event.event_phase,
        metadata: parseJsonField<any>(event.metadata, {})
      }
    };

    if (event.event_phase === 'start') {
      const bucket = startMap.get(key) || [];
      bucket.push(event);
      startMap.set(key, bucket);
      continue;
    }

    if (event.event_phase === 'end') {
      const bucket = startMap.get(key) || [];
      const startEvent = bucket.shift();
      if (bucket.length === 0) {
        startMap.delete(key);
      } else {
        startMap.set(key, bucket);
      }

      spans.push({
        id: `timeline-${event.id}`,
        type: buildLifecycleType(event.event_type, event.event_name),
        started_at: toIsoString(startEvent?.event_time) || toIsoString(event.event_time),
        ended_at: toIsoString(event.event_time),
        duration_ms: getDurationMs(startEvent?.event_time, event.event_time, event.duration_ms),
        status: 'ok',
        title: `${event.event_type}.${event.event_name}`,
        summary: `${event.event_type} / ${event.event_name} / ${event.event_phase}`,
        evidence: {
          start: startEvent || null,
          end: event
        },
        events: startEvent ? [
          {
            id: `timeline-event-${startEvent.id}`,
            name: `${startEvent.event_type}.${startEvent.event_name}.start`,
            timestamp: toIsoString(startEvent.event_time),
            attributes: {
              metadata: parseJsonField<any>(startEvent.metadata, {})
            }
          },
          eventDto
        ] : [eventDto],
        confidence: startEvent ? 'observed' : 'derived'
      });
      continue;
    }

    spans.push({
      id: `timeline-${event.id}`,
      type: buildLifecycleType(event.event_type, event.event_name),
      started_at: toIsoString(event.event_time),
      ended_at: toIsoString(event.event_time),
      duration_ms: event.duration_ms ?? null,
      status: normalizeStatusCode(event.event_name),
      title: `${event.event_type}.${event.event_name}`,
      summary: `${event.event_type} / ${event.event_name} / ${event.event_phase || 'instant'}`,
      evidence: event,
      events: [eventDto],
      confidence: 'observed'
    });
  }

  return spans.filter((span) => ['queue', 'context', 'decision'].includes(span.type));
}

function buildSyntheticTurns(llmCalls: any[], toolCalls: any[], unattributedHttp: any[], conversation: any, latestJob: any) {
  const explicitTurns = new Set<number>();
  llmCalls.forEach((call) => {
    if (call.agent_turn !== null) explicitTurns.add(call.agent_turn);
  });
  toolCalls.forEach((call) => {
    if (call.agent_turn !== null) explicitTurns.add(call.agent_turn);
  });
  unattributedHttp.forEach((call) => {
    if (call.agent_turn !== null) explicitTurns.add(call.agent_turn);
  });

  const turnValues = explicitTurns.size > 0 ? Array.from(explicitTurns).sort((a, b) => a - b) : [1];
  return turnValues.map((turn) => {
    const turnLlmCalls = llmCalls.filter((call) => (call.agent_turn ?? 1) === turn);
    const turnToolCalls = toolCalls.filter((call) => (call.agent_turn ?? 1) === turn);
    const turnHttp = unattributedHttp.filter((log) => (log.agent_turn ?? turn) === turn);
    const turnStartCandidates = [
      ...turnLlmCalls.map((call) => call.started_at),
      ...turnToolCalls.map((call) => call.started_at),
      ...turnHttp.map((call) => call.request_timestamp)
    ].filter(Boolean);
    const turnEndCandidates = [
      ...turnLlmCalls.map((call) => call.completed_at),
      ...turnToolCalls.map((call) => call.completed_at),
      ...turnHttp.map((call) => call.response_timestamp)
    ].filter(Boolean);

    return {
      turn,
      started_at: turnStartCandidates.sort()[0] || null,
      ended_at: turnEndCandidates.sort().slice(-1)[0] || turnStartCandidates.sort().slice(-1)[0] || null,
      duration_ms: getDurationMs(turnStartCandidates.sort()[0], turnEndCandidates.sort().slice(-1)[0]),
      llm_calls: turnLlmCalls,
      tool_calls: turnToolCalls,
      unattributed_http: turnHttp,
      outcome: turn === turnValues[turnValues.length - 1]
        ? {
            conversation_status: conversation.status,
            job_status: latestJob?.status || null,
            final_response: conversation.ai_response || latestJob?.final_response || null,
            error_message: conversation.error_reason || latestJob?.error_message || null
          }
        : null
    };
  });
}

function createSpan(params: Omit<TraceSpanDto, 'depth' | 'sort_key'>): TraceSpanDto {
  return {
    ...params,
    depth: 0,
    sort_key: ''
  };
}

function assignTreeMetadata(spans: TraceSpanDto[], rootSpanId: string) {
  const byId = new Map(spans.map((span) => [span.span_id, span]));
  const children = new Map<string, TraceSpanDto[]>();

  spans.forEach((span) => {
    if (span.span_id === rootSpanId) {
      return;
    }
    const parentId = span.parent_span_id && byId.has(span.parent_span_id) ? span.parent_span_id : rootSpanId;
    span.parent_span_id = parentId;
    const bucket = children.get(parentId) || [];
    bucket.push(span);
    children.set(parentId, bucket);
  });

  children.forEach((bucket) => {
    bucket.sort((left, right) => {
      const timeOrder = compareTimes(left.started_at, right.started_at);
      if (timeOrder !== 0) {
        return timeOrder;
      }
      return left.span_id.localeCompare(right.span_id);
    });
  });

  const visit = (spanId: string, depth: number, prefix: string) => {
    const bucket = children.get(spanId) || [];
    bucket.forEach((child, index) => {
      child.depth = depth;
      child.sort_key = `${prefix}.${String(index + 1).padStart(3, '0')}`;
      visit(child.span_id, depth + 1, child.sort_key);
    });
  };

  const root = byId.get(rootSpanId);
  if (root) {
    root.depth = 0;
    root.sort_key = '000';
    visit(rootSpanId, 1, '000');
  }
}

export async function buildConversationTracePayload(
  database: DatabaseManager,
  logger: winston.Logger,
  conversationId: string
) {
  const conversations = await database.executeQuery(
    `SELECT id, trace_id, batch_id, user_id, group_id, user_message, ai_response, status,
            error_reason, response_time, model_name, raw_request, timestamp
     FROM conversations
     WHERE id = ?`,
    [conversationId]
  );

  if (!conversations || conversations.length === 0) {
    return null;
  }

  const conversation = conversations[0] as any;
  const traceId = conversation.trace_id || `conversation-${conversationId}`;

  const safeQuery = async (sql: string, params: any[] = [], label: string) => {
    try {
      return await database.executeQuery(sql, params);
    } catch (error) {
      logger.warn(`Trace query failed: ${label}`, {
        error: error instanceof Error ? error.message : String(error),
        conversationId,
        traceId
      });
      return [];
    }
  };

  const llmCallQuery = `
    SELECT l.*
    FROM llm_call_logs l
    INNER JOIN (
      SELECT id, timestamp, call_sequence
      FROM llm_call_logs
      WHERE trace_id = ?
      UNION DISTINCT
      SELECT id, timestamp, call_sequence
      FROM llm_call_logs
      WHERE conversation_id = ?
    ) matched ON matched.id = l.id
    ORDER BY matched.timestamp ASC, matched.call_sequence ASC, matched.id ASC
  `;

  const toolCallQuery = `
    SELECT t.*
    FROM tool_execution_logs t
    INNER JOIN (
      SELECT id, COALESCE(started_at, completed_at) AS sort_time
      FROM tool_execution_logs
      WHERE trace_id = ?
    ) matched ON matched.id = t.id
    ORDER BY matched.sort_time ASC, matched.id ASC
  `;

  const queueQuery = `
    SELECT q.*
    FROM agent_queue_messages q
    INNER JOIN (
      SELECT id, created_at
      FROM agent_queue_messages
      WHERE trace_id = ?
      UNION DISTINCT
      SELECT id, created_at
      FROM agent_queue_messages
      WHERE conversation_id = ?
    ) matched ON matched.id = q.id
    ORDER BY matched.created_at ASC, matched.id ASC
  `;

  const safeTrafficQuery = async () => {
    try {
      return await listTraceTrafficLogs({
        traceId,
        conversationId
      });
    } catch (error) {
      logger.warn('Trace query failed: traffic persistence', {
        error: error instanceof Error ? error.message : String(error),
        conversationId,
        traceId
      });
      return [];
    }
  };

  const [llmCallRows, toolCallRows, httpRows, websocketRows, timelineRows, llmJobRows, queueRows] = await Promise.all([
    safeQuery(
      llmCallQuery,
      [traceId, conversationId],
      'llm_call_logs'
    ),
    safeQuery(
      toolCallQuery,
      [traceId],
      'tool_execution_logs'
    ),
    safeTrafficQuery(),
    safeQuery(
      `SELECT * FROM websocket_logs
       WHERE trace_id = ?
       ORDER BY timestamp ASC, id ASC`,
      [traceId],
      'websocket_logs'
    ),
    safeQuery(
      `SELECT * FROM timeline_events
       WHERE trace_id = ?
       ORDER BY event_time ASC, id ASC`,
      [traceId],
      'timeline_events'
    ),
    safeQuery(
      `SELECT * FROM llm_jobs
       WHERE trace_id = ?
       ORDER BY created_at ASC, id ASC`,
      [traceId],
      'llm_jobs'
    ),
    safeQuery(
      queueQuery,
      [traceId, conversationId],
      'agent_queue_messages'
    )
  ]);

  const llmCalls = (llmCallRows as any[])
    .map(normalizeLlmCall)
    .sort((left, right) => {
      const timeComparison = compareTimes(
        left.started_at || left.completed_at,
        right.started_at || right.completed_at
      );
      if (timeComparison !== 0) {
        return timeComparison;
      }
      if (left.call_sequence !== right.call_sequence) {
        return left.call_sequence - right.call_sequence;
      }
      return left.id - right.id;
    });
  const toolCalls = (toolCallRows as any[]).map(normalizeToolCall);
  const httpLogs = (httpRows as any[]).map(normalizeHttpLog);
  const queueMessages = (queueRows as any[]).map(normalizeQueueMessage);
  const unattributedHttp = attachHttpLogs(toolCalls, llmCalls, httpLogs);
  const lifecycleSpans = pairTimelineEvents(timelineRows as any[]);
  const latestJob = (llmJobRows as any[]).length > 0 ? (llmJobRows as any[])[(llmJobRows as any[]).length - 1] : null;
  const turnSpans = buildSyntheticTurns(llmCalls, toolCalls, unattributedHttp, conversation, latestJob);

  const spanRecords: TraceSpanDto[] = [];
  const rootSpanId = `trace-root:${traceId}`;

  const rootStartedAt = [
    ...lifecycleSpans.map((span) => span.started_at),
    ...llmCalls.map((call) => call.started_at),
    ...toolCalls.map((call) => call.started_at),
    ...httpLogs.map((log) => log.request_timestamp),
    ...queueMessages.map((message) => message.created_at),
    ...(websocketRows as any[]).map((row) => toIsoString(row.timestamp)),
    toIsoString(conversation.timestamp)
  ].filter(Boolean).sort()[0] || null;

  const rootEndedAt = [
    ...lifecycleSpans.map((span) => span.ended_at),
    ...llmCalls.map((call) => call.completed_at),
    ...toolCalls.map((call) => call.completed_at),
    ...httpLogs.map((log) => log.response_timestamp),
    ...queueMessages.map((message) => message.completed_at || message.processing_started_at || message.created_at),
    ...(websocketRows as any[]).map((row) => toIsoString(row.timestamp)),
    latestJob?.completed_at,
    toIsoString(conversation.timestamp)
  ].filter(Boolean).sort().slice(-1)[0] || null;

  spanRecords.push(createSpan({
    span_id: rootSpanId,
    parent_span_id: null,
    trace_id: traceId,
    conversation_id: conversationId,
    name: 'conversation.trace',
    kind: 'internal',
    status_code: normalizeStatusCode(conversation.status),
    status_message: conversation.error_reason || null,
    started_at: rootStartedAt,
    ended_at: rootEndedAt,
    duration_ms: getDurationMs(rootStartedAt, rootEndedAt, conversation.response_time),
    summary: safePreview(conversation.ai_response || conversation.user_message || conversationId),
    attributes: {
      'semantic.role': 'trace_root',
      'semantic.display_name': 'Conversation Trace',
      'conversation.id': conversationId,
      'conversation.status': conversation.status,
      'conversation.batch_id': conversation.batch_id || null
    },
    input: parseJsonField<any>(conversation.raw_request, conversation.raw_request),
    output: {
      final_response: conversation.ai_response || null,
      response_time_ms: toNumber(conversation.response_time),
      error_reason: conversation.error_reason || null
    },
    evidence: conversation,
    events: [],
    links: [],
    confidence: 'observed',
    source_ref: conversationId
  }));

  const firstInboundRow = (websocketRows as any[]).find((row) => row.direction === 'IN');
  if (firstInboundRow) {
    const rawPayload = parseJsonField<any>(firstInboundRow.raw_payload, firstInboundRow.raw_payload);
    spanRecords.push(createSpan({
      span_id: `websocket-in:${firstInboundRow.id}`,
      parent_span_id: rootSpanId,
      trace_id: traceId,
      conversation_id: conversationId,
      name: 'ingress.message',
      kind: 'server',
      status_code: normalizeStatusCode(firstInboundRow.status),
      status_message: firstInboundRow.error_message || null,
      started_at: toIsoString(firstInboundRow.timestamp),
      ended_at: toIsoString(firstInboundRow.timestamp),
      duration_ms: toNumber(firstInboundRow.processing_time_ms),
      summary: safePreview(rawPayload?.message || rawPayload?.raw_message || conversation.user_message),
      attributes: {
        'semantic.role': 'ingress',
        'message.type': firstInboundRow.message_type,
        'message.direction': firstInboundRow.direction
      },
      input: rawPayload,
      output: parseJsonField<any>(firstInboundRow.processed_payload, null),
      evidence: {
        ...firstInboundRow,
        raw_payload: rawPayload,
        processed_payload: parseJsonField<any>(firstInboundRow.processed_payload, null),
        metadata: parseJsonField<any>(firstInboundRow.metadata, null)
      },
      events: [],
      links: [],
      confidence: 'observed',
      source_ref: firstInboundRow.id
    }));
  } else if (queueMessages.length > 0) {
    const firstQueuedMessage = queueMessages[0];
    spanRecords.push(createSpan({
      span_id: `queue-ingress:${firstQueuedMessage.id}`,
      parent_span_id: rootSpanId,
      trace_id: traceId,
      conversation_id: conversationId,
      name: 'ingress.message',
      kind: 'server',
      status_code: firstQueuedMessage.error_message ? 'error' : 'ok',
      status_message: firstQueuedMessage.error_message,
      started_at: firstQueuedMessage.created_at,
      ended_at: firstQueuedMessage.created_at,
      duration_ms: null,
      summary: safePreview(firstQueuedMessage.body_for_agent || firstQueuedMessage.raw_payload?.raw_message),
      attributes: {
        'semantic.role': 'ingress',
        'message.type': firstQueuedMessage.chat_type,
        'message.source': firstQueuedMessage.source
      },
      input: firstQueuedMessage.raw_payload,
      output: firstQueuedMessage.inbound_context,
      evidence: firstQueuedMessage,
      events: [],
      links: [],
      confidence: 'observed',
      source_ref: firstQueuedMessage.id
    }));
  }

  lifecycleSpans.forEach((span) => {
    spanRecords.push(createSpan({
      span_id: span.id,
      parent_span_id: rootSpanId,
      trace_id: traceId,
      conversation_id: conversationId,
      name: `phase.${span.type}`,
      kind: 'internal',
      status_code: span.status,
      status_message: null,
      started_at: span.started_at,
      ended_at: span.ended_at,
      duration_ms: span.duration_ms,
      summary: safePreview(span.summary),
      attributes: {
        'semantic.role': span.type,
        'semantic.display_name': span.title
      },
      input: span.evidence?.start || null,
      output: span.evidence?.end || span.evidence || null,
      evidence: span.evidence,
      events: span.events,
      links: [],
      confidence: span.confidence,
      source_ref: span.id
    }));
  });

  const turnSpanIdByTurn = new Map<number, string>();
  turnSpans.forEach((turn) => {
    const turnSpanId = `turn:${traceId}:${turn.turn}`;
    turnSpanIdByTurn.set(turn.turn, turnSpanId);
    spanRecords.push(createSpan({
      span_id: turnSpanId,
      parent_span_id: rootSpanId,
      trace_id: traceId,
      conversation_id: conversationId,
      name: `turn.${turn.turn}`,
      kind: 'internal',
      status_code: normalizeStatusCode(turn.outcome?.error_message ? 'error' : 'success'),
      status_message: turn.outcome?.error_message || null,
      started_at: turn.started_at,
      ended_at: turn.ended_at,
      duration_ms: turn.duration_ms,
      summary: safePreview(turn.outcome?.final_response || `LLM ${turn.llm_calls.length} / Tool ${turn.tool_calls.length} / HTTP ${turn.unattributed_http.length}`),
      attributes: {
        'semantic.role': 'turn',
        'turn.index': turn.turn,
        'turn.llm_count': turn.llm_calls.length,
        'turn.tool_count': turn.tool_calls.length,
        'turn.http_count': turn.unattributed_http.length
      },
      input: {
        started_at: turn.started_at,
        ended_at: turn.ended_at
      },
      output: turn.outcome,
      evidence: {
        llm_calls: turn.llm_calls,
        tool_calls: turn.tool_calls,
        unattributed_http: turn.unattributed_http
      },
      events: [],
      links: [],
      confidence: 'derived',
      source_ref: turn.turn
    }));
  });

  const llmSpanIdByCallId = new Map<string, string>();
  llmCalls.forEach((call) => {
    const spanId = call.llm_call_id ? `llm-call:${call.llm_call_id}` : `llm:${call.id}`;
    const playgroundCapability = buildPlaygroundCapability(call);
    const playgroundSnapshot = buildPlaygroundSnapshot(call, spanId);
    const providerStatuses = summarizeProviderStatuses(call.provider_requests);
    const providerHosts = summarizeProviderHosts(call.provider_requests);
    if (call.llm_call_id) {
      llmSpanIdByCallId.set(call.llm_call_id, spanId);
    }
    spanRecords.push(createSpan({
      span_id: spanId,
      parent_span_id: turnSpanIdByTurn.get(call.agent_turn ?? 1) || rootSpanId,
      trace_id: traceId,
      conversation_id: call.conversation_id || conversationId,
      name: 'llm.generation',
      kind: 'client',
      status_code: call.status,
      status_message: call.error_message || null,
      started_at: call.started_at,
      ended_at: call.completed_at,
      duration_ms: call.duration_ms,
      summary: safePreview(call.processed_response || call.canonical_response || call.wire_response),
      attributes: {
        'semantic.role': 'generation',
        'semantic.actor': call.agent_type,
        'semantic.display_name': `${call.model_provider || 'model'} / ${call.model_name}`,
        'llm.model_name': call.model_name,
        'llm.model_provider': call.model_provider,
        'llm.prompt_template': call.prompt_template,
        'usage.input_tokens': call.input_tokens,
        'usage.output_tokens': call.output_tokens,
        'trace.agent_turn': call.agent_turn,
        'provider.request_count': call.provider_requests.length,
        'provider.hosts': providerHosts,
        'provider.statuses': providerStatuses,
        'playground.capability': playgroundCapability
      },
      input: {
        prompt_template: call.prompt_template,
        canonical_request: call.canonical_request,
        wire_request: call.wire_request,
        effective_unified_config: call.effective_unified_config
      },
      output: {
        processed_response: call.processed_response,
        canonical_response: call.canonical_response,
        wire_response: call.wire_response,
        token_usage: call.token_usage,
        error_message: call.error_message,
        error_code: call.error_code
      },
      evidence: {
        ...call,
        provider_requests: call.provider_requests.map((log: any) => ({
          traffic_log_id: log.id,
          request_id: log.request_id,
          method: log.method,
          host: log.host,
          path: log.path,
          response_status: log.response_status,
          duration_ms: log.duration_ms,
          api_type: log.api_type
        })),
        playground_capability: playgroundCapability,
        playground_source_snapshot: playgroundSnapshot
      },
      events: [],
      links: [],
      confidence: call.started_at && call.completed_at ? 'observed' : 'derived',
      source_ref: call.id
    }));

    if (call.provider_requests.length === 0) {
      return;
    }

    call.provider_requests.forEach((log: any) => {
      spanRecords.push(createSpan({
        span_id: `provider-request:${log.id}`,
        parent_span_id: spanId,
        trace_id: traceId,
        conversation_id: log.conversation_id || conversationId,
        name: 'provider.request',
        kind: 'client',
        status_code: log.status as 'unset' | 'ok' | 'error',
        status_message: log.error_message || null,
        started_at: log.request_timestamp,
        ended_at: log.response_timestamp,
        duration_ms: log.duration_ms,
        summary: `${log.method} ${log.host}${log.path || ''} -> ${log.response_status || 'pending'}`,
        attributes: {
          'semantic.role': 'provider_request',
          'semantic.display_name': `${log.method} ${log.host}`,
          'http.method': log.method,
          'http.url': log.url,
          'http.host': log.host,
          'http.path': log.path,
          'http.status_code': log.response_status,
          'trace.llm_call_id': log.llm_call_id,
          'trace.agent_turn': log.agent_turn,
          'provider.api_type': log.api_type,
          'provider.traffic_log_id': log.id
        },
        input: {
          headers: log.request_headers,
          body: log.request_body
        },
        output: {
          status_code: log.response_status,
          headers: log.response_headers,
          body: log.response_body,
          error_message: log.error_message
        },
        evidence: {
          traffic_log_id: log.id,
          request_id: log.request_id,
          llm_call_id: log.llm_call_id,
          method: log.method,
          host: log.host,
          path: log.path,
          url: log.url,
          request_headers: log.request_headers,
          request_body: log.request_body,
          response_status: log.response_status,
          response_headers: log.response_headers,
          response_body: log.response_body,
          duration_ms: log.duration_ms,
          request_timestamp: log.request_timestamp,
          response_timestamp: log.response_timestamp,
          api_type: log.api_type
        },
        events: [],
        links: [],
        confidence: 'observed',
        source_ref: log.id
      }));
    });
  });

  const toolSpanIdByCallId = new Map<string, string>();
  toolCalls.forEach((call) => {
    const spanId = call.tool_call_id ? `tool-call:${call.tool_call_id}` : `tool:${call.id}`;
    if (call.tool_call_id) {
      toolSpanIdByCallId.set(call.tool_call_id, spanId);
    }
    spanRecords.push(createSpan({
      span_id: spanId,
      parent_span_id: (call.llm_call_id && llmSpanIdByCallId.get(call.llm_call_id))
        || turnSpanIdByTurn.get(call.agent_turn ?? 1)
        || rootSpanId,
      trace_id: traceId,
      conversation_id: call.conversation_id || conversationId,
      name: 'tool.invocation',
      kind: 'internal',
      status_code: call.status,
      status_message: call.error_message || null,
      started_at: call.started_at,
      ended_at: call.completed_at,
      duration_ms: call.duration_ms,
      summary: safePreview(call.result || call.error_message || call.arguments),
      attributes: {
        'semantic.role': 'invocation',
        'semantic.capability': call.method_id || call.tool_name,
        'semantic.display_name': call.tool_name,
        'tool.name': call.tool_name,
        'tool.method_id': call.method_id,
        'tool.execution_mode': call.execution_mode,
        'tool.side_effect': call.side_effect,
        'trace.agent_turn': call.agent_turn
      },
      input: call.arguments,
      output: {
        result: call.result,
        error_message: call.error_message
      },
      evidence: call,
      events: [],
      links: [],
      confidence: call.tool_call_id ? 'observed' : 'derived',
      source_ref: call.id
    }));
  });

  const providerTrafficLogIds = new Set(
    llmCalls.flatMap((call) => call.provider_requests.map((log: any) => String(log.id)))
  );

  httpLogs.forEach((log) => {
    if (providerTrafficLogIds.has(String(log.id))) {
      return;
    }
    spanRecords.push(createSpan({
      span_id: `http:${log.id}`,
      parent_span_id: (log.tool_call_id && toolSpanIdByCallId.get(log.tool_call_id))
        || (log.llm_call_id && llmSpanIdByCallId.get(log.llm_call_id))
        || turnSpanIdByTurn.get(log.agent_turn ?? 1)
        || rootSpanId,
      trace_id: traceId,
      conversation_id: log.conversation_id || conversationId,
      name: 'http.request',
      kind: 'client',
      status_code: log.status as 'unset' | 'ok' | 'error',
      status_message: log.error_message || null,
      started_at: log.request_timestamp,
      ended_at: log.response_timestamp,
      duration_ms: log.duration_ms,
      summary: `${log.response_status || 'pending'} ${log.path}`,
      attributes: {
        'semantic.role': 'external_http',
        'semantic.display_name': `${log.method} ${log.host}`,
        'http.method': log.method,
        'http.url': log.url,
        'http.host': log.host,
        'http.path': log.path,
        'http.status_code': log.response_status,
        'trace.agent_turn': log.agent_turn,
        'trace.attribution': log.attribution
      },
      input: {
        headers: log.request_headers,
        body: log.request_body
      },
      output: {
        status_code: log.response_status,
        headers: log.response_headers,
        body: log.response_body,
        error_message: log.error_message
      },
      evidence: log,
      events: [],
      links: [],
      confidence: log.attribution === 'time_window' ? 'derived' : log.attribution === 'unattributed' ? 'missing' : 'observed',
      source_ref: log.id
    }));
  });

  const deliveryLogs = (websocketRows as any[]).filter((row) => row.direction === 'OUT');
  if (deliveryLogs.length > 0 || conversation.ai_response) {
    const lastDeliveryLog = deliveryLogs[deliveryLogs.length - 1];
    spanRecords.push(createSpan({
      span_id: `delivery:${traceId}`,
      parent_span_id: rootSpanId,
      trace_id: traceId,
      conversation_id: conversationId,
      name: 'delivery.output',
      kind: 'producer',
      status_code: deliveryLogs.length > 0 ? 'ok' : 'unset',
      status_message: null,
      started_at: toIsoString(lastDeliveryLog?.timestamp) || rootEndedAt,
      ended_at: toIsoString(lastDeliveryLog?.timestamp) || rootEndedAt,
      duration_ms: null,
      summary: safePreview(conversation.ai_response || latestJob?.final_response || 'No final response emitted'),
      attributes: {
        'semantic.role': 'delivery',
        'delivery.status': deliveryLogs.length > 0 ? 'sent' : 'generated_not_sent',
        'delivery.websocket_count': deliveryLogs.length
      },
      input: deliveryLogs,
      output: {
        final_response: conversation.ai_response || latestJob?.final_response || null,
        terminal_job_status: latestJob?.status || null
      },
      evidence: deliveryLogs,
      events: [],
      links: [],
      confidence: deliveryLogs.length > 0 ? 'observed' : 'derived',
      source_ref: traceId
    }));
  }

  spanRecords.push(createSpan({
    span_id: `terminal:${traceId}`,
    parent_span_id: rootSpanId,
    trace_id: traceId,
    conversation_id: conversationId,
    name: 'terminal.outcome',
    kind: 'consumer',
    status_code: normalizeStatusCode(conversation.status),
    status_message: conversation.error_reason || null,
    started_at: rootEndedAt,
    ended_at: rootEndedAt,
    duration_ms: getDurationMs(rootStartedAt, rootEndedAt, conversation.response_time),
    summary: safePreview(conversation.error_reason || conversation.ai_response || conversation.status),
    attributes: {
      'semantic.role': 'terminal',
      'conversation.status': conversation.status,
      'conversation.model_name': conversation.model_name || null
    },
    input: {
      started_at: rootStartedAt,
      ended_at: rootEndedAt
    },
    output: {
      final_output: conversation.ai_response || latestJob?.final_response || null,
      error_reason: conversation.error_reason || null
    },
    evidence: conversation,
    events: [],
    links: [],
    confidence: 'derived',
    source_ref: traceId
  }));

  assignTreeMetadata(spanRecords, rootSpanId);

  const orderedSpans = [...spanRecords].sort((left, right) => left.sort_key.localeCompare(right.sort_key));
  const firstErrorSpan = orderedSpans.find((span) => span.status_code === 'error') || null;
  const bottleneckSpan = [...orderedSpans]
    .filter((span) => typeof span.duration_ms === 'number')
    .sort((left, right) => (right.duration_ms || 0) - (left.duration_ms || 0))[0] || null;

  const dataQuality = {
    trace_headers_propagated: httpLogs.some((log) => log.llm_call_id || log.tool_call_id || log.agent_turn !== null || log.conversation_id) ? 'complete' : (httpLogs.length > 0 ? 'partial' : 'missing'),
    llm_logs_complete: llmCalls.length === 0 ? 'missing' : (llmCalls.every((call) => call.started_at && call.completed_at) ? 'complete' : 'partial'),
    tool_logs_complete: toolCalls.length === 0 ? 'missing' : (toolCalls.every((call) => call.started_at) ? 'complete' : 'partial'),
    http_logs_complete: httpLogs.length === 0 ? 'missing' : (httpLogs.every((log) => log.request_timestamp && log.response_timestamp) ? 'complete' : 'partial'),
    timeline_complete: timelineRows.length > 0 ? 'complete' : 'partial'
  };

  return {
    conversation_id: conversationId,
    batch_id: conversation.batch_id || null,
    trace: {
      trace_id: traceId,
      root_span_id: rootSpanId,
      status: conversation.status,
      started_at: rootStartedAt,
      ended_at: rootEndedAt,
      duration_ms: getDurationMs(rootStartedAt, rootEndedAt, conversation.response_time),
      span_count: orderedSpans.length,
      error_count: orderedSpans.filter((span) => span.status_code === 'error').length,
      summary: safePreview(conversation.ai_response || conversation.user_message),
      first_error: firstErrorSpan ? {
        span_id: firstErrorSpan.span_id,
        title: firstErrorSpan.name,
        summary: firstErrorSpan.summary
      } : null,
      bottleneck: bottleneckSpan ? {
        span_id: bottleneckSpan.span_id,
        title: bottleneckSpan.name,
        duration_ms: bottleneckSpan.duration_ms
      } : null
    },
    spans: orderedSpans,
    raw_evidence: {
      conversation,
      websocket_logs: websocketRows,
      timeline_events: timelineRows,
      llm_calls: llmCallRows,
      tool_calls: toolCallRows,
      http_logs: httpRows,
      llm_jobs: llmJobRows,
      queue_messages: queueRows
    },
    data_quality: {
      ...dataQuality,
      overall: Object.values(dataQuality).every((value) => value === 'complete') ? 'complete' : 'partial'
    }
  };
}
