import {
  AgentTurnTrace,
  ConversationTraceData,
  TraceFlowEdge,
  TraceFlowInspectorSection,
  TraceFlowMetric,
  TraceFlowNode,
  TraceFlowViewModel,
  TraceHttpRequest,
  TraceLlmCall,
  TraceToolCall,
} from '@/types';

const PHASE_X = {
  ingress: 48,
  queue: 316,
  context: 584,
  decision: 852,
};

const TURN_GROUP_X = 128;
const TURN_GROUP_Y = 260;
const TURN_GROUP_GAP = 340;
const TURN_GROUP_WIDTH = 720;
const TURN_CHILD_WIDTH = 186;
const TURN_CHILD_GAP_X = 210;
const TURN_CHILD_GAP_Y = 126;
const TURN_CHILD_COLUMNS = 3;
const DELIVERY_X = 930;

function toMillis(value?: string | null): number | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.getTime();
}

function compareTraceTimes(
  leftStarted?: string | null,
  rightStarted?: string | null,
  leftFallback = 0,
  rightFallback = 0
) {
  const left = toMillis(leftStarted) ?? leftFallback;
  const right = toMillis(rightStarted) ?? rightFallback;
  return left - right;
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

function normalizeStatus(status?: string | null): string {
  const normalized = (status || '').toLowerCase();
  if (!normalized) {
    return 'unknown';
  }
  if (['success', 'sent', 'completed'].includes(normalized)) {
    return 'success';
  }
  if (['generated_not_sent', 'ended_no_reply', 'skipped'].includes(normalized)) {
    return 'warning';
  }
  if (['error', 'failed'].includes(normalized)) {
    return 'error';
  }
  return normalized;
}

function buildMetricTone(status: string): TraceFlowMetric['tone'] {
  if (status === 'success') {
    return 'success';
  }
  if (status === 'error') {
    return 'danger';
  }
  return 'warning';
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

function phaseTitle(type: string, rawTitle?: string | null): string {
  if (type === 'queue') return 'Queue';
  if (type === 'context') return 'Context Build';
  if (type === 'decision') return 'Decision Analyze';
  if (type === 'delivery') return 'Delivery';
  if (type === 'terminal_outcome') return 'Terminal Outcome';
  if (type === 'ingress') return 'Trigger Message';
  return rawTitle || type;
}

function describeDeliveryStatus(status: string, finalResponse: string | null): string {
  const normalized = (status || '').toLowerCase();
  if (normalized === 'sent') {
    return '最终响应已实际发往外部通道。';
  }
  if (normalized === 'generated_not_sent') {
    return finalResponse
      ? '最终响应已生成，但没有发送到外部通道。'
      : '链路已走到发送前，但没有可发送的最终响应。';
  }
  if (normalized === 'ended_no_reply') {
    return '链路正常结束，但决策结果是不发送回复。';
  }
  if (normalized === 'failed') {
    return '链路在发送阶段之前或之中失败。';
  }
  return finalResponse
    ? '最终响应已生成，但未确认发往外部通道。'
    : '未捕获到可发送的最终响应。';
}

function describeTerminalSummary(trace: ConversationTraceData): string {
  if (trace.overview.first_error?.summary) {
    return trace.overview.first_error.summary;
  }
  if (trace.overview.final_output) {
    return safePreview(trace.overview.final_output);
  }
  const status = (trace.overview.conversation_status || '').toLowerCase();
  if (status === 'generated_not_sent') {
    return '最终回复已生成，但没有完成发送。';
  }
  if (status === 'ended_no_reply') {
    return '流程正常结束，但没有生成需要发送的回复。';
  }
  return 'No terminal output';
}

function createInspectorSections(
  overview: any,
  input: any,
  output: any,
  evidence: any
): TraceFlowInspectorSection[] {
  return [
    { id: 'overview', label: 'Overview', value: overview, emptyLabel: 'No overview' },
    { id: 'input', label: 'Input', value: input, emptyLabel: 'No input captured' },
    { id: 'output', label: 'Output', value: output, emptyLabel: 'No output captured' },
    { id: 'evidence', label: 'Evidence', value: evidence, emptyLabel: 'No evidence captured' },
  ];
}

function buildIngressNode(trace: ConversationTraceData): TraceFlowNode {
  const inboundLog = (trace.raw_evidence.websocket_logs || []).find((item: any) => item.direction === 'IN');
  const conversation = trace.raw_evidence.conversation || {};
  const messageType = inboundLog?.message_type === 'group' || Boolean(conversation?.group_id) ? 'group' : 'private';
  const startedAt = inboundLog?.timestamp || trace.overview.started_at || null;
  const userMessage = conversation?.user_message || inboundLog?.raw_payload?.message || 'No inbound message';

  return {
    id: 'node-ingress',
    kind: 'ingress',
    title: '触发消息进入',
    subtitle: messageType,
    summary: safePreview(userMessage),
    status: 'success',
    startedAt,
    endedAt: startedAt,
    durationMs: 0,
    badges: [messageType],
    meta: [
      { label: '消息类型', value: messageType },
      { label: '时间', value: startedAt || 'n/a' },
    ],
    x: PHASE_X.ingress,
    y: 96,
    width: 196,
    height: 114,
    sourceRef: inboundLog?.id || null,
    inspector: {
      title: '触发消息进入',
      subtitle: messageType,
      sections: createInspectorSections(
        '用户消息进入系统，形成一次新的 trace 触发链路。',
        inboundLog?.raw_payload || conversation?.raw_request || conversation,
        { message_preview: userMessage },
        inboundLog || conversation
      ),
    },
  };
}

function buildPhaseNode(
  trace: ConversationTraceData,
  phaseType: 'queue' | 'context' | 'decision',
  x: number
): TraceFlowNode | null {
  const span = trace.lifecycle_spans.find((item) => item.type === phaseType);
  if (!span) {
    return null;
  }

  const startEvidence = span.evidence?.start || span.evidence || null;
  const endEvidence = span.evidence?.end || span.evidence || null;

  return {
    id: `node-${phaseType}`,
    kind: 'phase',
    title: phaseTitle(phaseType, span.title),
    subtitle: span.confidence,
    summary: span.summary || safePreview(endEvidence),
    status: normalizeStatus(span.status),
    startedAt: span.started_at,
    endedAt: span.ended_at,
    durationMs: span.duration_ms,
    badges: [span.confidence],
    meta: [
      { label: '状态', value: normalizeStatus(span.status) },
      { label: '耗时', value: formatDuration(span.duration_ms) },
    ],
    x,
    y: 96,
    width: 196,
    height: 120,
    sourceRef: span.id,
    inspector: {
      title: phaseTitle(phaseType, span.title),
      subtitle: span.confidence,
      sections: createInspectorSections(
        span.summary,
        startEvidence,
        endEvidence,
        span.evidence
      ),
    },
  };
}

type TurnEntry =
  | { kind: 'llm'; startedAt: string | null; fallback: number; call: TraceLlmCall }
  | { kind: 'tool'; startedAt: string | null; fallback: number; call: TraceToolCall }
  | { kind: 'http'; startedAt: string | null; fallback: number; call: TraceHttpRequest };

function buildTurnEntries(turn: AgentTurnTrace): TurnEntry[] {
  const entries: TurnEntry[] = [];

  turn.llm_calls.forEach((call, index) => {
    entries.push({
      kind: 'llm',
      startedAt: call.started_at || call.completed_at,
      fallback: index,
      call,
    });
    (call.http_requests || []).forEach((request, requestIndex) => {
      entries.push({
        kind: 'http',
        startedAt: request.request_timestamp || request.response_timestamp,
        fallback: index * 100 + requestIndex,
        call: request,
      });
    });
  });

  turn.tool_calls.forEach((call, index) => {
    entries.push({
      kind: 'tool',
      startedAt: call.started_at || call.completed_at,
      fallback: 1000 + index,
      call,
    });
    (call.http_requests || []).forEach((request, requestIndex) => {
      entries.push({
        kind: 'http',
        startedAt: request.request_timestamp || request.response_timestamp,
        fallback: 1000 + index * 100 + requestIndex,
        call: request,
      });
    });
  });

  turn.unattributed_http.forEach((request, index) => {
    entries.push({
      kind: 'http',
      startedAt: request.request_timestamp || request.response_timestamp,
      fallback: 2000 + index,
      call: request,
    });
  });

  return entries.sort((left, right) => compareTraceTimes(left.startedAt, right.startedAt, left.fallback, right.fallback));
}

function buildTurnGroupNode(turn: AgentTurnTrace, turnIndex: number, width: number, height: number): TraceFlowNode {
  return {
    id: `node-turn-${turn.turn}`,
    kind: 'turn',
    title: `Agent Turn ${turn.turn}`,
    subtitle: turn.outcome?.job_status || null,
    summary: turn.outcome?.final_response
      ? safePreview(turn.outcome.final_response)
      : `LLM ${turn.llm_calls.length} / Tool ${turn.tool_calls.length} / HTTP ${turn.unattributed_http.length}`,
    status: normalizeStatus(turn.outcome?.error_message ? 'failed' : 'success'),
    startedAt: turn.started_at,
    endedAt: turn.ended_at,
    durationMs: turn.duration_ms,
    badges: [],
    meta: [
      { label: 'LLM', value: String(turn.llm_calls.length) },
      { label: 'Tool', value: String(turn.tool_calls.length) },
      { label: 'HTTP', value: String(turn.unattributed_http.length) },
      { label: '耗时', value: formatDuration(turn.duration_ms) },
    ],
    x: TURN_GROUP_X,
    y: TURN_GROUP_Y + turnIndex * TURN_GROUP_GAP,
    width,
    height,
    sourceRef: turn.turn,
    inspector: {
      title: `Agent Turn ${turn.turn}`,
      subtitle: turn.outcome?.job_status || null,
      sections: createInspectorSections(
        `这一轮内部包含 ${turn.llm_calls.length} 个 LLM、${turn.tool_calls.length} 个 Tool 和 ${turn.unattributed_http.length} 个未归属 HTTP。`,
        {
          started_at: turn.started_at,
          ended_at: turn.ended_at,
          duration_ms: turn.duration_ms,
        },
        turn.outcome,
        {
          llm_calls: turn.llm_calls,
          tool_calls: turn.tool_calls,
          unattributed_http: turn.unattributed_http,
        }
      ),
    },
  };
}

function buildTurnEntryNode(
  turn: AgentTurnTrace,
  entry: TurnEntry,
  index: number,
  turnGroupId: string
): TraceFlowNode {
  const column = index % TURN_CHILD_COLUMNS;
  const row = Math.floor(index / TURN_CHILD_COLUMNS);
  const x = 24 + column * TURN_CHILD_GAP_X;
  const y = 76 + row * TURN_CHILD_GAP_Y;

  if (entry.kind === 'llm') {
    const call = entry.call;
    return {
      id: `node-turn-${turn.turn}-llm-${call.id}`,
      kind: 'llm',
      title: call.agent_type || 'LLM',
      subtitle: `${call.model_provider} / ${call.model_name}`,
      summary: safePreview(call.processed_response || call.canonical_response || call.wire_response),
      status: normalizeStatus(call.status),
      startedAt: call.started_at,
      endedAt: call.completed_at,
      durationMs: call.duration_ms,
      badges: [call.prompt_template || 'default'],
      meta: [
        { label: '模型', value: call.model_name },
        { label: '耗时', value: formatDuration(call.duration_ms) },
        { label: 'Tokens', value: `${call.input_tokens ?? 0}/${call.output_tokens ?? 0}` },
      ],
      parentId: turnGroupId,
      x,
      y,
      width: TURN_CHILD_WIDTH,
      height: 118,
      sourceRef: call.id,
      inspector: {
        title: call.agent_type || 'LLM',
        subtitle: `${call.model_provider} / ${call.model_name}`,
        sections: createInspectorSections(
          safePreview(call.processed_response || call.canonical_response || call.wire_response),
          {
            prompt_template: call.prompt_template,
            canonical_request: call.canonical_request,
            wire_request: call.wire_request,
          },
          {
            processed_response: call.processed_response,
            canonical_response: call.canonical_response,
            wire_response: call.wire_response,
            token_usage: call.token_usage,
          },
          call
        ),
      },
    };
  }

  if (entry.kind === 'tool') {
    const call = entry.call;
    return {
      id: `node-turn-${turn.turn}-tool-${call.id}`,
      kind: 'tool',
      title: call.tool_name,
      subtitle: call.method_id || call.tool_type,
      summary: safePreview(call.result || call.error_message),
      status: normalizeStatus(call.status),
      startedAt: call.started_at,
      endedAt: call.completed_at,
      durationMs: call.duration_ms,
      badges: [call.execution_mode || 'sync', call.side_effect ? 'side-effect' : 'returnable'],
      meta: [
        { label: '耗时', value: formatDuration(call.duration_ms) },
        { label: '执行模式', value: call.execution_mode || 'n/a' },
      ],
      parentId: turnGroupId,
      x,
      y,
      width: TURN_CHILD_WIDTH,
      height: 118,
      sourceRef: call.id,
      inspector: {
        title: call.tool_name,
        subtitle: call.method_id || call.tool_type,
        sections: createInspectorSections(
          safePreview(call.result || call.error_message || call.arguments),
          call.arguments,
          {
            result: call.result,
            error_message: call.error_message,
            execution_mode: call.execution_mode,
          },
          call
        ),
      },
    };
  }

  const request = entry.call;
  return {
    id: `node-turn-${turn.turn}-http-${request.id}`,
    kind: 'http',
    title: `${request.method} ${request.host}`,
    subtitle: request.path,
    summary: `${request.response_status || 'pending'} · ${request.attribution}`,
    status: normalizeStatus(request.status),
    startedAt: request.request_timestamp,
    endedAt: request.response_timestamp,
    durationMs: request.duration_ms,
    badges: [request.attribution],
    meta: [
      { label: '状态码', value: String(request.response_status || 'n/a') },
      { label: '耗时', value: formatDuration(request.duration_ms) },
    ],
    parentId: turnGroupId,
    x,
    y,
    width: TURN_CHILD_WIDTH,
    height: 110,
    sourceRef: request.id,
    inspector: {
      title: `${request.method} ${request.host}`,
      subtitle: request.path,
      sections: createInspectorSections(
        `HTTP 请求归因：${request.attribution}`,
        {
          request_headers: request.request_headers,
          request_body: request.request_body,
        },
        {
          response_status: request.response_status,
          response_headers: request.response_headers,
          response_body: request.response_body,
          error_message: request.error_message,
        },
        request
      ),
    },
  };
}

function buildDeliveryNode(trace: ConversationTraceData, y: number): TraceFlowNode {
  const deliveryOverview = describeDeliveryStatus(trace.delivery.status, trace.delivery.final_response);

  return {
    id: 'node-delivery',
    kind: 'delivery',
    title: 'Delivery',
    subtitle: trace.delivery.status,
    summary: trace.delivery.final_response
      ? safePreview(trace.delivery.final_response)
      : 'No final response emitted',
    status: normalizeStatus(trace.delivery.status),
    startedAt: trace.overview.ended_at,
    endedAt: trace.overview.ended_at,
    durationMs: null,
    badges: [],
    meta: [
      { label: '状态', value: trace.delivery.status },
      { label: '日志数', value: String(trace.delivery.websocket_logs.length) },
    ],
    x: DELIVERY_X,
    y,
    width: 220,
    height: 118,
    sourceRef: trace.trace_id,
    inspector: {
      title: 'Delivery',
      subtitle: trace.delivery.status,
      sections: createInspectorSections(
        deliveryOverview,
        {
          websocket_logs: trace.delivery.websocket_logs,
        },
        {
          final_response: trace.delivery.final_response,
          terminal_job_status: trace.delivery.terminal_job_status,
        },
        trace.delivery
      ),
    },
  };
}

function buildTerminalNode(trace: ConversationTraceData, y: number): TraceFlowNode {
  const failed = Boolean(trace.overview.first_error);
  const terminalSummary = describeTerminalSummary(trace);
  return {
    id: 'node-terminal',
    kind: 'terminal',
    title: 'Terminal Outcome',
    subtitle: trace.overview.conversation_status,
    summary: terminalSummary,
    status: failed ? 'error' : normalizeStatus(trace.overview.conversation_status),
    startedAt: trace.overview.ended_at,
    endedAt: trace.overview.ended_at,
    durationMs: trace.overview.total_duration_ms,
    badges: trace.batch_id ? [trace.batch_id] : [],
    meta: [
      { label: '会话状态', value: trace.overview.conversation_status },
      { label: '总耗时', value: formatDuration(trace.overview.total_duration_ms) },
    ],
    x: DELIVERY_X,
    y,
    width: 220,
    height: 124,
    sourceRef: trace.trace_id,
    inspector: {
      title: 'Terminal Outcome',
      subtitle: trace.overview.conversation_status,
      sections: createInspectorSections(
        failed ? trace.overview.first_error?.summary : terminalSummary,
        {
          started_at: trace.overview.started_at,
          ended_at: trace.overview.ended_at,
        },
        {
          final_output: trace.overview.final_output,
          first_error: trace.overview.first_error,
          bottleneck: trace.overview.bottleneck,
        },
        {
          overview: trace.overview,
          data_quality: trace.data_quality,
        }
      ),
    },
  };
}

function buildMetrics(trace: ConversationTraceData): TraceFlowMetric[] {
  return [
    {
      label: '总耗时',
      value: formatDuration(trace.overview.total_duration_ms),
      detail: `${trace.overview.started_at || 'n/a'} -> ${trace.overview.ended_at || 'n/a'}`,
    },
    {
      label: '最终状态',
      value: trace.delivery.status,
      detail: trace.overview.conversation_status,
      tone: buildMetricTone(normalizeStatus(trace.delivery.status)),
    },
    {
      label: 'Agent Turns',
      value: String(trace.overview.agent_turn_count),
      detail: `LLM ${trace.overview.llm_call_count} / Tool ${trace.overview.tool_call_count}`,
    },
    {
      label: 'HTTP',
      value: String(trace.overview.http_request_count),
      detail: `${trace.overview.models.length} model(s)`,
    },
    {
      label: '瓶颈',
      value: trace.overview.bottleneck?.title || 'n/a',
      detail: formatDuration(trace.overview.bottleneck?.duration_ms),
      tone: 'warning',
    },
    {
      label: '首个错误',
      value: trace.overview.first_error?.title || 'None',
      detail: trace.overview.first_error?.summary || '无错误',
      tone: trace.overview.first_error ? 'danger' : 'success',
    },
  ];
}

export function buildTraceFlowViewModel(trace: ConversationTraceData): TraceFlowViewModel {
  const nodes: TraceFlowNode[] = [];
  const edges: TraceFlowEdge[] = [];

  const ingressNode = buildIngressNode(trace);
  nodes.push(ingressNode);

  const queueNode = buildPhaseNode(trace, 'queue', PHASE_X.queue);
  const contextNode = buildPhaseNode(trace, 'context', PHASE_X.context);
  const decisionNode = buildPhaseNode(trace, 'decision', PHASE_X.decision);

  const phaseNodes = [queueNode, contextNode, decisionNode].filter(Boolean) as TraceFlowNode[];
  nodes.push(...phaseNodes);

  const topSequence = [ingressNode, ...phaseNodes];
  for (let index = 1; index < topSequence.length; index += 1) {
    const previous = topSequence[index - 1];
    const current = topSequence[index];
    edges.push({
      id: `edge-${previous.id}-${current.id}`,
      source: previous.id,
      target: current.id,
    });
  }

  const sortedTurns = [...trace.agent_turns].sort((left, right) => left.turn - right.turn);
  let previousAnchorId = decisionNode?.id || contextNode?.id || queueNode?.id || ingressNode.id;
  let currentDeliveryY = TURN_GROUP_Y + 24;

  sortedTurns.forEach((turn, turnIndex) => {
    const entries = buildTurnEntries(turn);
    const rows = Math.max(1, Math.ceil(entries.length / TURN_CHILD_COLUMNS));
    const groupHeight = 124 + rows * TURN_CHILD_GAP_Y;
    const turnGroupNode = buildTurnGroupNode(turn, turnIndex, TURN_GROUP_WIDTH, groupHeight);
    nodes.push(turnGroupNode);
    edges.push({
      id: `edge-${previousAnchorId}-${turnGroupNode.id}`,
      source: previousAnchorId,
      target: turnGroupNode.id,
      label: `Turn ${turn.turn}`,
    });

    let firstChildId: string | null = null;
    let lastChildId: string | null = null;

    entries.forEach((entry, index) => {
      const childNode = buildTurnEntryNode(turn, entry, index, turnGroupNode.id);
      nodes.push(childNode);
      if (!firstChildId) {
        firstChildId = childNode.id;
      }
      if (lastChildId) {
        edges.push({
          id: `edge-${lastChildId}-${childNode.id}`,
          source: lastChildId,
          target: childNode.id,
        });
      }
      lastChildId = childNode.id;
    });

    if (firstChildId) {
      edges.push({
        id: `edge-${turnGroupNode.id}-${firstChildId}`,
        source: turnGroupNode.id,
        target: firstChildId,
        label: 'start',
      });
      previousAnchorId = lastChildId || firstChildId;
    } else {
      previousAnchorId = turnGroupNode.id;
    }

    currentDeliveryY = turnGroupNode.y + Math.max(48, groupHeight / 2 - 40);
  });

  const deliveryNode = buildDeliveryNode(trace, currentDeliveryY);
  nodes.push(deliveryNode);
  edges.push({
    id: `edge-${previousAnchorId}-${deliveryNode.id}`,
    source: previousAnchorId,
    target: deliveryNode.id,
  });

  const terminalNode = buildTerminalNode(trace, currentDeliveryY + 182);
  nodes.push(terminalNode);
  edges.push({
    id: `edge-${deliveryNode.id}-${terminalNode.id}`,
    source: deliveryNode.id,
    target: terminalNode.id,
  });

  const errorNode = trace.overview.first_error
    ? nodes.find((item) => item.sourceRef === trace.overview.first_error?.span_id || item.id === trace.overview.first_error?.span_id)
    : null;
  const selectedNodeId = errorNode?.id || (sortedTurns[0] ? `node-turn-${sortedTurns[0].turn}` : null);

  return {
    nodes,
    edges,
    selectedNodeId: selectedNodeId || ingressNode.id,
    metrics: buildMetrics(trace),
    metadataBadges: [
      `trace_id: ${trace.trace_id}`,
      ...(trace.batch_id ? [`batch_id: ${trace.batch_id}`] : []),
      `data_quality: ${trace.data_quality.overall || 'partial'}`,
    ],
    rawEvidenceSections: [
      { id: 'conversation', label: 'conversation', value: trace.raw_evidence.conversation },
      { id: 'websocket_logs', label: 'websocket_logs', value: trace.raw_evidence.websocket_logs },
      { id: 'timeline_events', label: 'timeline_events', value: trace.raw_evidence.timeline_events },
      { id: 'llm_calls', label: 'llm_calls', value: trace.raw_evidence.llm_calls },
      { id: 'tool_calls', label: 'tool_calls', value: trace.raw_evidence.tool_calls },
      { id: 'http_logs', label: 'http_logs', value: trace.raw_evidence.http_logs },
      { id: 'llm_jobs', label: 'llm_jobs', value: trace.raw_evidence.llm_jobs },
      { id: 'data_quality', label: 'data_quality', value: trace.data_quality },
    ],
  };
}
