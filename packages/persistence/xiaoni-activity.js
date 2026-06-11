'use strict';

function normalizeDate(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return typeof value === 'string' ? value : String(value);
}

const QUEUE_ACTIVITY_SELECT = `
  SELECT
    id,
    trace_id,
    batch_id,
    run_id,
    source,
    message_sid,
    dedupe_key,
    chat_type,
    session_key,
    peer_id,
    peer_name,
    sender_id,
    sender_name,
    account_id,
    body_for_agent,
    raw_payload,
    inbound_context,
    payload,
    status,
    attempts,
    max_attempts,
    available_at,
    locked_at,
    locked_by,
    processing_started_at,
    completed_at,
    conversation_id,
    error_message,
    result,
    created_at,
    updated_at
  FROM agent_queue_messages
`;

function normalizeValue(value) {
  if (value === null || typeof value === 'undefined') {
    return value;
  }
  if (typeof value === 'bigint') {
    return String(value);
  }
  if (value instanceof Date) {
    return normalizeDate(value);
  }
  if (Array.isArray(value)) {
    return value.map(normalizeValue);
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, normalizeValue(entry)])
    );
  }
  return value;
}

function normalizeJsonObject(value, fallback = {}) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? normalizeValue(value)
    : fallback;
}

function parseJsonValue(value, fallback = null) {
  if (value === null || typeof value === 'undefined') {
    return fallback;
  }
  if (typeof value === 'object') {
    return normalizeValue(value);
  }
  if (typeof value !== 'string') {
    return fallback;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }
  try {
    return normalizeValue(JSON.parse(trimmed));
  } catch {
    return fallback;
  }
}

function clampLimit(value, fallback = 80, max = 200) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.max(1, Math.min(parsed, max));
}

function parseDateBoundary(value) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function resolveTimeWindow(input = {}) {
  const startTime = parseDateBoundary(
    input.startTime
    || input.start_time
    || input.since
    || input.from
  );
  const endTime = parseDateBoundary(
    input.endTime
    || input.end_time
    || input.until
    || input.to
  );
  return { startTime, endTime };
}

function hasTimeWindow(timeWindow) {
  return Boolean(timeWindow?.startTime || timeWindow?.endTime);
}

function prismaTimeFilter(timeWindow) {
  const filter = {};
  if (timeWindow.startTime) {
    filter.gte = timeWindow.startTime;
  }
  if (timeWindow.endTime) {
    filter.lte = timeWindow.endTime;
  }
  return Object.keys(filter).length ? filter : null;
}

function buildSqlTimePredicate(expressions, timeWindow) {
  if (!hasTimeWindow(timeWindow)) {
    return { clause: '', params: [] };
  }
  const clauses = [];
  const params = [];
  for (const expression of expressions) {
    const parts = [];
    if (timeWindow.startTime) {
      parts.push(`${expression} >= ?`);
      params.push(timeWindow.startTime);
    }
    if (timeWindow.endTime) {
      parts.push(`${expression} <= ?`);
      params.push(timeWindow.endTime);
    }
    if (parts.length) {
      clauses.push(`(${parts.join(' AND ')})`);
    }
  }
  return {
    clause: clauses.length ? `(${clauses.join(' OR ')})` : '',
    params
  };
}

function itemMatchesTimeWindow(item, timeWindow) {
  if (!hasTimeWindow(timeWindow)) {
    return true;
  }
  const timestampMs = new Date(item.timestamp).getTime();
  if (!Number.isFinite(timestampMs)) {
    return false;
  }
  if (timeWindow.startTime && timestampMs < timeWindow.startTime.getTime()) {
    return false;
  }
  if (timeWindow.endTime && timestampMs > timeWindow.endTime.getTime()) {
    return false;
  }
  return true;
}

function truncateText(value, maxLength = 240) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength - 1).trimEnd()}…`;
}

function previewJson(value, maxLength = 520) {
  if (value === null || typeof value === 'undefined') {
    return null;
  }
  if (typeof value === 'string') {
    return truncateText(value, maxLength);
  }
  try {
    return truncateText(JSON.stringify(normalizeValue(value)), maxLength);
  } catch {
    return truncateText(String(value), maxLength);
  }
}

function rawJsonText(value, fallback = null) {
  if (typeof value === 'string') {
    return value;
  }
  if (value === null || typeof value === 'undefined') {
    return fallback;
  }
  try {
    return JSON.stringify(normalizeValue(value));
  } catch {
    return String(value);
  }
}

function estimateJsonBytes(value) {
  if (value === null || typeof value === 'undefined') {
    return 0;
  }
  if (typeof value === 'string') {
    return Buffer.byteLength(value, 'utf8');
  }
  try {
    return Buffer.byteLength(JSON.stringify(normalizeValue(value)), 'utf8');
  } catch {
    return Buffer.byteLength(String(value), 'utf8');
  }
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function extractText(value) {
  if (value === null || typeof value === 'undefined') {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(extractText).filter(Boolean).join('\n');
  }
  if (typeof value === 'object') {
    if (typeof value.text === 'string') return value.text;
    if (typeof value.content === 'string') return value.content;
    if (Array.isArray(value.content)) return extractText(value.content);
    if (typeof value.input_text === 'string') return value.input_text;
    if (typeof value.output_text === 'string') return value.output_text;
  }
  return null;
}

function previewResponseItemText(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }
  if (item.type === 'function_call') {
    return firstString(item.arguments, previewJson(item.arguments));
  }
  if (item.type === 'function_call_output') {
    return firstString(item.output, previewJson(item.output));
  }
  return extractText(item.content ?? item.summary ?? item);
}

function eventTimestamp(value) {
  return normalizeDate(value) || new Date(0).toISOString();
}

function queueDisplayTimestamp(row) {
  if (!row) {
    return null;
  }
  if (isMainLoopQueueSource(row?.source)) {
    return normalizeDate(row.processing_started_at || row.locked_at || row.available_at || row.created_at);
  }
  return normalizeDate(row.updated_at || row.processing_started_at || row.locked_at || row.created_at);
}

function canonicalMetadata(row) {
  const request = normalizeJsonObject(row?.canonical_request ?? row?.canonicalRequest, null);
  return normalizeJsonObject(request?.metadata, {});
}

function isSelfActionSearchLlm(row) {
  const metadata = canonicalMetadata(row);
  return row?.agent_type === 'self_action_search'
    || row?.llm_agent_type === 'self_action_search'
    || row?.prompt_template === 'self_action_search:web_search'
    || row?.prompt_name === 'self_action_search:web_search'
    || metadata.action_type === 'self_action_search'
    || metadata.session_id === 'self_action:xiaoni';
}

function isCodexProviderLlm(row) {
  const provider = firstString(row?.model_provider, row?.wire_provider_format);
  const config = normalizeJsonObject(row?.effective_unified_config, {});
  const configProvider = firstString(config?.model?.provider, config?.provider);
  return [provider, configProvider]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes('codex'));
}

const LIFE_EVENT_LABELS = {
  surface_visit: '打开会话',
  qq_message_seen: '看到消息',
  qq_self_message: '发出消息',
  send_in_group: '在群里发言',
  send_in_private: '发出私聊消息',
  silence_decision: '决定先不说',
  surface_leave: '离开会话',
  self_action_started: '开始后台行动',
  self_action_completed: '后台行动记录',
  web_search_result: '得到搜索结果',
  state_snapshot: '状态快照',
  visible_delivery_committed: '可见投递已提交',
  post_commit_side_effect_blocked: '后续副作用被阻止',
  no_visible_delivery_observed: '没有可见发言',
  phone_notification: '手机 QQ 通知',
  presence_tick_evaluated: '抬头检查已评估',
  rest_period: '休息了一段时间',
  sleep_period: '睡了一段时间'
};

const MAIN_LOOP_QUEUE_SOURCES = ['phone_notification'];

function isMainLoopQueueSource(source) {
  return MAIN_LOOP_QUEUE_SOURCES.includes(String(source || ''));
}

function lifeEventTitle(eventKind, payload) {
  if (eventKind === 'self_action_started') {
    if (payload.action_type === 'web_search') return '开始查一点资料';
    if (payload.action_type === 'read') return '翻了点材料';
    if (payload.action_type === 'reflect') return '整理刚才的念头';
    if (payload.action_type === 'idle_restore') return '离开刺激源';
  }
  if (eventKind === 'self_action_completed') {
    if (payload.action_type === 'web_search') return '记下一条搜索残留';
    if (payload.action_type === 'read') return '留下一个阅读念头';
    if (payload.action_type === 'reflect') return '把念头先放一放';
    if (payload.action_type === 'idle_restore') return '短暂休息';
  }
  if (eventKind === 'surface_visit') {
    if (payload.wake_kind === 'proactive_use_im') {
      return '主动打开 IM';
    }
    if (payload.wake_kind === 'explicit_mention') {
      return '被 @ 打开会话';
    }
  }
  if (eventKind === 'qq_message_seen' && payload.wake_kind === 'proactive_use_im') {
    return '主动看见未读';
  }
  if (eventKind === 'presence_tick_evaluated') {
    return payload.eligible ? '准备抬头看一眼' : '空闲检查记录';
  }
  if (eventKind === 'rest_period') {
    return '短暂休息';
  }
  if (eventKind === 'sleep_period') {
    return '睡了一段时间';
  }
  return LIFE_EVENT_LABELS[eventKind] || eventKind || '小腻行动';
}

function lifeEventBody(row, payload) {
  if (row.event_kind === 'surface_visit') {
    const peerName = firstString(payload.peer_name, row.session_key);
    const batchSize = Number(payload.unread_batch_size || 0);
    const countText = batchSize > 0 ? `${batchSize} 条未读` : '当前会话';
    if (payload.wake_kind === 'proactive_use_im') {
      return [peerName ? `打开 ${peerName}` : '主动打开 IM', `看到 ${countText}`].join('，');
    }
    if (payload.wake_kind === 'explicit_mention') {
      return [peerName ? `进入 ${peerName}` : '打开会话', `@ 触发，看到 ${countText}`].join('，');
    }
  }

  if (row.event_kind === 'qq_message_seen' && payload.wake_kind === 'proactive_use_im') {
    const senderName = firstString(payload.sender_name, payload.sender_id);
    const body = firstString(payload.body_for_agent, payload.raw_body);
    return [senderName ? `${senderName}:` : null, body].filter(Boolean).join(' ');
  }

  if (row.event_kind === 'self_action_completed') {
    return firstString(
      payload.residue_text,
      payload.action_type === 'web_search' ? payload.result_summary : null,
      payload.motive_text
    );
  }
  if (row.event_kind === 'presence_tick_evaluated') {
    if (payload.eligible) {
      return `空闲检查已放行；${payload.queue_id ? `queue ${payload.queue_id}` : '等待入队'}`;
    }
    const skipReason = firstString(payload.skip_reason, payload.reason);
    if (skipReason === 'fatigue') {
      return '精力不足，暂不主动看群；恢复按休息或睡眠节奏记录。';
    }
    return skipReason ? `空闲检查未入队；原因：${skipReason}` : '空闲检查未入队。';
  }
  if (row.event_kind === 'no_visible_delivery_observed') {
    return '这一轮没有对外发言。';
  }
  if (row.event_kind === 'rest_period' || row.event_kind === 'sleep_period') {
    return firstString(payload.reason, payload.duration_label, payload.bucket);
  }

  return null;
}

function summarizeLifeEvent(row) {
  const payload = normalizeJsonObject(row.payload);
  const feedPayload = sanitizeLifeEventPayloadForFeed(row.event_kind, payload);
  const eventKind = String(row.event_kind || '');
  const sentMessages = Array.isArray(payload.sent_messages)
    ? payload.sent_messages.filter((item) => typeof item === 'string').join('\n')
    : null;
  const body = firstString(
    lifeEventBody(row, payload),
    payload.content,
    sentMessages,
    payload.body_for_agent,
    payload.raw_body,
    payload.result_summary,
    payload.residue_text,
    payload.reason,
    payload.delivery_phase,
    payload.wake_kind
  );
  const actorName = firstString(payload.sender_name, payload.actor_name, row.actor_id, row.actor_type);

  return {
    id: `life:${row.id}`,
    source: 'life_event',
    kind: eventKind,
    title: lifeEventTitle(eventKind, payload),
    body: truncateText(body, 360),
    status: row.visibility || null,
    actor: row.actor_type || null,
    actorName,
    timestamp: eventTimestamp(row.occurred_at),
    sessionKey: row.session_key || null,
    peerName: firstString(payload.peer_name, row.session_key),
    runId: row.run_id || null,
    traceId: row.trace_id || null,
    tone: row.actor_type === 'human'
      ? 'neutral'
      : eventKind.includes('blocked')
        ? 'danger'
        : eventKind.includes('no_visible')
          ? 'warning'
          : 'xiaoni',
    metadata: {
      sourceActionId: row.source_action_id || payload.action_id || null,
      surface: row.surface || null,
      chatType: row.chat_type || null,
      peerId: row.peer_id || null,
      actionCost: Number(row.action_cost || 0),
      pressureDelta: Number(row.pressure_delta || 0),
      rewardDelta: Number(row.reward_delta || 0),
      boredomDelta: Number(row.boredom_delta || 0),
      attentionDelta: Number(row.attention_delta || 0),
      payloadPreview: previewJson(feedPayload),
      payload: feedPayload
    }
  };
}

const LIFE_EVENT_FEED_NOISE_KEYS = new Set([
  'account_id',
  'batch_id',
  'claimed_message_sids',
  'conversation_id',
  'llm_call_id',
  'message_sid',
  'message_sids',
  'request_id',
  'run_id',
  'session_key',
  'source',
  'trace_id'
]);

function omitLifeEventFeedNoise(value) {
  if (Array.isArray(value)) {
    return value.map(omitLifeEventFeedNoise);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !LIFE_EVENT_FEED_NOISE_KEYS.has(key))
      .map(([key, entry]) => [key, omitLifeEventFeedNoise(entry)])
  );
}

function sanitizeLifeEventPayloadForFeed(eventKind, payload) {
  if (eventKind !== 'presence_tick_evaluated') {
    return omitLifeEventFeedNoise(payload);
  }
  const snapshot = normalizeJsonObject(payload.snapshot, {});
  const energy = Number(snapshot.energy);
  const actionCost = Number(snapshot.action_cost ?? snapshot.actionCost);
  return {
    eligible: typeof payload.eligible === 'boolean' ? payload.eligible : null,
    enqueued: typeof payload.enqueued === 'boolean' ? payload.enqueued : null,
    reason: firstString(payload.reason),
    skip_reason: firstString(payload.skip_reason),
    queue_id: payload.queue_id ? String(payload.queue_id) : null,
    queue_status: firstString(payload.queue_status),
    snapshot: {
      energy: Number.isFinite(energy) ? energy : null,
      action_cost: Number.isFinite(actionCost) ? actionCost : null
    }
  };
}

function summarizeDigitalAction(row) {
  const sourceTrace = normalizeJsonObject(row.source_trace);
  const budgetSnapshot = normalizeJsonObject(row.budget_snapshot);
  const decisionLlmCallId = firstString(
    sourceTrace.decision_llm_call_id,
    sourceTrace.planner_llm_call_id,
    sourceTrace.planner?.llm_call_id
  );
  const searchLlmCallId = firstString(
    sourceTrace.search_llm_call_id,
    sourceTrace.llm_call_id
  );
  const interestCandidates = Array.isArray(sourceTrace.interest_candidates)
    ? sourceTrace.interest_candidates
    : Array.isArray(sourceTrace.interests)
      ? sourceTrace.interests
      : null;
  const body = row.error_message
    ? row.error_message
    : row.action_type === 'web_search'
      ? firstString(row.result_summary, row.residue_text, row.motive_text, row.query)
      : firstString(row.residue_text, row.result_summary, row.motive_text, row.query);
  const titleByAction = {
    web_search: '历史记录：查过公开资料',
    read: '历史记录：翻过材料',
    reflect: '历史记录：整理过念头',
    idle_restore: '历史记录：休息记录'
  };
  return {
    id: `digital:${row.id}`,
    source: 'digital_action',
    kind: row.action_type || 'digital_action',
    title: titleByAction[row.action_type] || '历史数字行动记录',
    body: truncateText(body, 360),
    status: row.status || null,
    actor: 'xiaoni',
    actorName: '历史记录',
    timestamp: eventTimestamp(row.created_at),
    sessionKey: null,
    peerName: null,
    runId: null,
    traceId: null,
    tone: row.status === 'failed' ? 'danger' : row.status === 'completed' ? 'success' : 'info',
    metadata: {
      actionId: row.id,
      historicalOnly: true,
      surface: row.surface || null,
      motiveKind: row.motive_kind || null,
      motiveText: row.motive_text || null,
      query: row.query || null,
      resultSummary: row.result_summary || null,
      residueText: row.residue_text || null,
      sourceWording: row.source_wording || null,
      completedAt: normalizeDate(row.completed_at),
      updatedAt: normalizeDate(row.updated_at),
      decisionLlmCallId,
      searchLlmCallId,
      actionTracePreview: previewJson(sourceTrace),
      budgetSnapshotPreview: previewJson(budgetSnapshot),
      interestCandidatesPreview: interestCandidates ? previewJson(interestCandidates) : null,
      sourceTrace,
      budgetSnapshot
    }
  };
}

function summarizeAgentStackItem(row) {
  const content = normalizeJsonObject(row.content, {});
  const metadata = normalizeJsonObject(row.metadata, {});
  const itemKind = row.itemKind || row.item_kind || 'stack_item';
  const toolName = firstString(content.name, metadata.tool_name);
  const toolCallId = firstString(row.toolCallId, row.tool_call_id, content.call_id);
  const llmSliceId = firstString(row.llmRequestSliceId, row.llm_request_slice_id);
  const isToolCall = itemKind === 'function_call';
  const isToolOutput = itemKind === 'function_call_output';
  const isRuntimeInput = itemKind === 'runtime_input';
  const isAssistantOutput = itemKind === 'assistant_output';
  const body = isToolCall
    ? firstString(content.arguments, previewJson(content.arguments), metadata.argumentsPreview)
    : isToolOutput
      ? firstString(content.output, previewJson(content.output))
      : isRuntimeInput
        ? firstString(content.system_reminder, content.source, previewJson(content.input_items))
        : previewResponseItemText(content);
  const spanId = isToolCall && toolCallId
    ? `tool-call:${toolCallId}`
    : isToolOutput && toolCallId
      ? `tool-output:${toolCallId}`
      : llmSliceId
        ? `stack-slice:${llmSliceId}`
        : `stack:${row.id || row.eventId || row.event_id}`;

  return {
    id: `stack:${row.id || row.eventId || row.event_id}`,
    source: isRuntimeInput ? 'runtime_input' : 'llm_stack_item',
    kind: isToolCall
      ? 'function_call'
      : isToolOutput
        ? 'function_call_output'
        : isAssistantOutput
          ? firstString(row.phase, content.phase, 'assistant_message')
          : itemKind,
    title: isToolCall
      ? `请求工具: ${toolName || 'tool'}`
      : isToolOutput
        ? `工具结果: ${toolName || toolCallId || 'tool'}`
        : isRuntimeInput
          ? '当前输入'
          : row.phase === 'final_answer' || content.phase === 'final_answer'
            ? '模型输出: final_answer'
            : '模型输出',
    body: truncateText(body, 420),
    status: null,
    actor: isRuntimeInput ? 'system' : 'xiaoni',
    actorName: isRuntimeInput ? 'Runtime' : '小腻',
    timestamp: eventTimestamp(row.createdAt || row.created_at),
    sessionKey: firstString(content.session_key, metadata.session_key),
    peerName: firstString(content.peer_name, metadata.peer_name),
    runId: row.runId || row.run_id || null,
    traceId: row.traceId || row.trace_id || null,
    tone: isToolOutput ? 'success' : isToolCall ? 'xiaoni' : isRuntimeInput ? 'info' : 'info',
    metadata: {
      stackItemId: row.id || null,
      stackEventId: row.eventId || row.event_id || null,
      stackIndex: Number(row.stackIndex || row.stack_index || 0) || null,
      stackSource: 'agent_stack_items',
      llmRequestSliceId: llmSliceId,
      llmCallId: firstString(metadata.llm_call_id, metadata.llmCallId),
      spanId,
      parentSpanId: llmSliceId ? `stack-slice:${llmSliceId}` : null,
      outputItemType: firstString(content.type, itemKind),
      outputItemIndex: Number(metadata.output_item_index ?? 0) || null,
      toolCallId,
      toolName,
      messagePhase: firstString(row.phase, content.phase),
      argumentsPreview: isToolCall ? truncateText(firstString(content.arguments, previewJson(content.arguments)), 1200) : null,
      toolResultPreview: isToolOutput ? previewJson(content.output) : null,
      payloadPreview: isRuntimeInput ? previewJson(content) : null
    }
  };
}

function normalizeStackRowForActivity(row) {
  if (!row || typeof row !== 'object') {
    return null;
  }
  return {
    ...row,
    id: row.id === null || typeof row.id === 'undefined' ? null : String(row.id),
    eventId: row.eventId || row.event_id || null,
    itemKind: row.itemKind || row.item_kind || null,
    toolCallId: row.toolCallId || row.tool_call_id || null,
    llmRequestSliceId: row.llmRequestSliceId || row.llm_request_slice_id || null,
    content: normalizeJsonObject(row.content, {}),
    metadata: normalizeJsonObject(row.metadata, {}),
    traceId: row.traceId || row.trace_id || null,
    runId: row.runId || row.run_id || null,
    conversationId: row.conversationId || row.conversation_id || null,
    createdAt: row.createdAt || row.created_at || null
  };
}

function summarizeAgentStackToolExecution(row) {
  const args = normalizeJsonObject(row.arguments);
  const result = normalizeJsonObject(row.result);
  const body = firstString(
    result.status_text,
    result.output_xml,
    result.text,
    Array.isArray(result.sent_messages) ? result.sent_messages.join('\n') : null,
    result.reason,
    result.outcome,
    args.query,
    args.message,
    row.errorMessage,
    row.error_message
  );
  const toolCallId = firstString(row.toolCallId, row.tool_call_id);
  const llmSliceId = firstString(row.llmRequestSliceId, row.llm_request_slice_id);
  const executionId = firstString(row.executionId, row.execution_id) || String(row.id || '');
  return {
    id: `tool-exec:${executionId}`,
    source: 'tool_execution',
    kind: firstString(row.toolName, row.tool_name, 'tool'),
    title: `tool: ${firstString(row.toolName, row.tool_name, 'tool')}`,
    body: truncateText(body, 420),
    status: row.status || null,
    actor: 'xiaoni',
    actorName: '小腻',
    timestamp: eventTimestamp(row.startedAt || row.started_at || row.createdAt || row.created_at),
    sessionKey: firstString(row.metadata?.session_key, row.metadata?.sessionKey),
    peerName: firstString(row.metadata?.peer_name, row.metadata?.peerName),
    runId: row.runId || row.run_id || null,
    traceId: row.traceId || row.trace_id || null,
    tone: row.status === 'failed' ? 'danger' : row.status === 'completed' ? 'success' : 'warning',
    metadata: {
      executionId: row.executionId || row.execution_id || null,
      toolCallId,
      llmRequestSliceId: llmSliceId,
      spanId: toolCallId ? `tool-call:${toolCallId}` : `tool-exec:${row.id}`,
      parentSpanId: llmSliceId ? `stack-slice:${llmSliceId}` : null,
      agentTurn: Number(row.agentTurn || row.agent_turn || 0) || null,
      toolArgumentsPreview: previewJson(args),
      toolResultPreview: previewJson(result),
      errorMessage: row.errorMessage || row.error_message || null,
      sideEffect: Boolean(row.sideEffect ?? row.side_effect)
    }
  };
}

function summarizeLlmRequestSlice(row) {
  const tokenUsage = normalizeJsonObject(row.tokenUsage ?? row.token_usage, {});
  const canonicalRequest = normalizeJsonObject(row.canonicalRequest ?? row.canonical_request, {});
  const wireRequest = normalizeJsonObject(row.wireRequest ?? row.wire_request, null);
  const canonicalResponse = normalizeJsonObject(row.canonicalResponse ?? row.canonical_response, null);
  const wireResponse = normalizeJsonObject(row.wireResponse ?? row.wire_response, null);
  const outputItems = Array.isArray(row.outputItems)
    ? row.outputItems
    : normalizeJsonObject(row.output_items, []);
  const inputTokens = Number(
    tokenUsage.input_tokens
    || tokenUsage.inputTokens
    || tokenUsage.prompt_tokens
    || tokenUsage.promptTokens
    || 0
  );
  const outputTokens = Number(
    tokenUsage.output_tokens
    || tokenUsage.outputTokens
    || tokenUsage.completion_tokens
    || tokenUsage.completionTokens
    || 0
  );
  const sliceId = firstString(row.sliceId, row.slice_id, row.llmCallId, row.llm_call_id, row.id);
  const llmCallId = firstString(row.llmCallId, row.llm_call_id);
  const provider = firstString(row.wireProviderFormat, row.wire_provider_format, row.modelProvider, row.model_provider, 'provider');
  const modelName = firstString(row.modelName, row.model_name, 'model');
  const tokenLabel = inputTokens || outputTokens ? `${inputTokens}->${outputTokens} tokens` : null;
  const outputCount = Array.isArray(outputItems) ? outputItems.length : 0;
  const body = [
    provider,
    modelName,
    row.agentTurn || row.agent_turn ? `turn ${row.agentTurn || row.agent_turn}` : null,
    tokenLabel,
    outputCount ? `${outputCount} output item(s)` : null
  ].filter(Boolean).join(' · ');
  const requestPayload = wireRequest || canonicalRequest;
  const responsePayload = wireResponse || canonicalResponse || row.rawResponse || row.raw_response;

  return {
    id: `llm-slice:${sliceId || row.id}`,
    source: 'llm_request',
    kind: 'llm_request_slice',
    title: 'LLM 请求',
    body: truncateText(row.errorMessage || row.error_message || body, 420),
    status: row.status || null,
    actor: 'xiaoni',
    actorName: '小腻',
    timestamp: eventTimestamp(row.createdAt || row.created_at || row.completedAt || row.completed_at),
    sessionKey: firstString(row.metadata?.session_key, row.metadata?.sessionKey),
    peerName: firstString(row.metadata?.peer_name, row.metadata?.peerName),
    runId: row.runId || row.run_id || null,
    traceId: row.traceId || row.trace_id || null,
    tone: row.status === 'failed' ? 'danger' : 'info',
    metadata: {
      llmRequestSliceId: sliceId || null,
      llmCallId,
      spanId: sliceId ? `stack-slice:${sliceId}` : `llm-slice:${row.id}`,
      agentTurn: Number(row.agentTurn || row.agent_turn || 0) || null,
      modelName,
      modelProvider: row.modelProvider || row.model_provider || null,
      providerFormat: row.wireProviderFormat || row.wire_provider_format || null,
      requestFormatVersion: row.requestFormatVersion || row.request_format_version || null,
      processingTimeMs: Number(row.processingTimeMs || row.processing_time_ms || 0) || null,
      inputTokens,
      outputTokens,
      completedAt: normalizeDate(row.completedAt || row.completed_at),
      errorMessage: row.errorMessage || row.error_message || null,
      providerRequestPreview: truncateText(rawJsonText(requestPayload) || '', 1200),
      providerResponsePreview: truncateText(rawJsonText(responsePayload) || '', 1200),
      providerRequestBytes: estimateJsonBytes(requestPayload),
      providerResponseBytes: estimateJsonBytes(responsePayload),
      wirePayloadSource: 'llm_request_slices'
    }
  };
}

function summarizeTask(row) {
  const artifactCount = Array.isArray(row.artifacts) ? row.artifacts.length : 0;
  const body = row.error_message
    ? row.error_message
    : firstString(row.target_description, row.prompt, artifactCount ? `${artifactCount} artifact(s)` : null);
  return {
    id: `task:${row.id}`,
    source: 'task',
    kind: row.task_type || 'task',
    title: row.task_type === 'image_edit' ? '处理图片任务' : row.task_type === 'image_generate' ? '生成图片任务' : '后台任务',
    body: truncateText(body, 360),
    status: row.status || null,
    actor: 'xiaoni',
    actorName: '小腻',
    timestamp: eventTimestamp(row.created_at),
    sessionKey: row.session_key || null,
    peerName: row.peer_name || null,
    runId: row.source_run_id || null,
    traceId: row.source_trace_id || null,
    tone: row.status === 'failed' ? 'danger' : row.status === 'completed' ? 'success' : row.status === 'processing' ? 'warning' : 'info',
    metadata: {
      taskId: row.id,
      requester: firstString(row.requester_sender_name, row.requester_sender_id),
      attempts: Number(row.attempts || 0),
      completedAt: normalizeDate(row.completed_at),
      claimedAt: normalizeDate(row.claimed_at),
      artifactCount
    }
  };
}

function summarizeMedia(row) {
  const observations = Array.isArray(row.observations) ? row.observations : [];
  const latestObservation = observations[0] || null;
  return {
    id: `media:${row.id}`,
    source: 'media_observation',
    kind: row.media_type || 'media',
    title: latestObservation ? '看了一张图' : '收到媒体',
    body: truncateText(latestObservation?.description || row.placeholder || row.source_locator, 360),
    status: latestObservation ? 'observed' : 'received',
    actor: latestObservation ? latestObservation.observer || 'xiaoni' : 'human',
    actorName: latestObservation ? latestObservation.observer || '小腻' : firstString(row.sender_name, row.sender_id),
    timestamp: eventTimestamp(latestObservation?.created_at || row.created_at),
    sessionKey: row.session_key || null,
    peerName: row.peer_name || null,
    runId: latestObservation?.metadata?.trace_id || null,
    traceId: row.trace_id || latestObservation?.metadata?.trace_id || null,
    tone: latestObservation ? 'info' : 'neutral',
    metadata: {
      mediaId: row.id,
      mediaTag: row.media_tag || null,
      sender: firstString(row.sender_name, row.sender_id),
      observationCount: observations.length,
      sourceModel: latestObservation?.source_model || null
    }
  };
}

function summarizeQueueMessage(row, staleCutoffMs) {
  const lockedAt = row.locked_at instanceof Date ? row.locked_at.getTime() : row.locked_at ? new Date(row.locked_at).getTime() : 0;
  const isStaleProcessing = row.status === 'processing' && lockedAt > 0 && Date.now() - lockedAt > staleCutoffMs;
  const mainLoopSource = isMainLoopQueueSource(row.source);
  const legacyConsciousnessTick = row.source === 'consciousness_tick';
  const title = legacyConsciousnessTick
    ? '历史连续意识切片'
    : row.source === 'phone_notification'
      ? '手机 QQ 通知'
      : isStaleProcessing
        ? '旧处理锁残留'
        : row.status === 'pending'
          ? '等待处理消息'
          : row.status === 'processing'
            ? '正在处理消息'
            : '队列消息';
  return {
    id: `queue:${row.id}`,
    source: 'queue_message',
    kind: isStaleProcessing ? 'stale_processing' : row.source || row.status || 'queue',
    title,
    body: truncateText(row.body_for_agent, 360),
    status: row.status || null,
    actor: 'system',
    actorName: row.source === 'phone_notification' ? '手机状态栏' : firstString(row.sender_name, row.sender_id),
    timestamp: eventTimestamp(queueDisplayTimestamp(row)),
    sessionKey: row.session_key || null,
    peerName: row.peer_name || null,
    runId: row.run_id || null,
    traceId: row.trace_id || null,
    tone: isStaleProcessing ? 'warning' : row.status === 'failed' ? 'danger' : row.status === 'processing' ? 'warning' : mainLoopSource ? 'xiaoni' : 'info',
    metadata: {
      queueId: String(row.id),
      source: row.source || null,
      attempts: Number(row.attempts || 0),
      lockedAt: normalizeDate(row.locked_at),
      lockedBy: row.locked_by || null,
      availableAt: normalizeDate(row.available_at),
      completedAt: normalizeDate(row.completed_at),
      errorMessage: row.error_message || null,
      staleProcessing: isStaleProcessing
    }
  };
}

function normalizeLifeState(row) {
  if (!row) {
    return null;
  }
  const projection = normalizeJsonObject(row.projection_json, {});
  const projectedState = normalizeJsonObject(projection.state, {});
  const explanation = normalizeJsonObject(row.explanation_json, {});
  const contributors = Array.isArray(explanation.contributors)
    ? explanation.contributors.filter((item) => item?.eventKind !== 'presence_tick_evaluated')
    : [];
  const energy = Number(projectedState.energy);
  const actionCost = Number(projectedState.actionCost);
  return {
    identityKey: row.identity_key,
    projection: {
      version: projection.version || null,
      generatedAt: normalizeDate(projection.generatedAt),
      state: {
        energy: Number.isFinite(energy) ? energy : null,
        actionCost: Number.isFinite(actionCost) ? actionCost : null
      }
    },
    explanation: {
      summary: typeof explanation.summary === 'string' ? explanation.summary : null,
      generatedAt: normalizeDate(explanation.generatedAt),
      contributors: normalizeValue(contributors.slice(-5))
    },
    reducedThroughEventId: row.reduced_through_event_id === null || typeof row.reduced_through_event_id === 'undefined'
      ? null
      : String(row.reduced_through_event_id),
    reducedThroughOccurredAt: normalizeDate(row.reduced_through_occurred_at),
    projectionVersion: row.projection_version || null,
    projectionUpdatedAt: normalizeDate(row.projection_updated_at),
    updatedAt: normalizeDate(row.updated_at)
  };
}

function latestByTimestamp(items) {
  return items
    .filter(Boolean)
    .sort((left, right) => new Date(eventTimestamp(queueDisplayTimestamp(right) || right.updated_at || right.created_at || right.occurred_at)).getTime()
      - new Date(eventTimestamp(queueDisplayTimestamp(left) || left.updated_at || left.created_at || left.occurred_at)).getTime())[0] || null;
}

function dedupeFeedItems(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item?.id || seen.has(item.id)) {
      return false;
    }
    seen.add(item.id);
    return true;
  });
}

function normalizeActionStreamStatus(status) {
  switch (status) {
    case 'settled':
    case 'completed':
      return 'ok';
    case 'processing':
      return 'running';
    case 'pending':
    case 'planned':
      return 'waiting';
    default:
      return status || null;
  }
}

function normalizeActionStreamEventKind(item) {
  if (item.source === 'runtime_input') {
    return 'runtime_input';
  }
  if (item.source === 'tool_execution') {
    return 'tool_executed';
  }
  if (item.source === 'llm_request') {
    return 'model_request_slice';
  }
  if (item.source === 'llm_stack_item') {
    if (item.kind === 'function_call') {
      return 'model_tool_request';
    }
    if (item.kind === 'function_call_output') {
      return 'tool_result_callback';
    }
    return 'model_output';
  }
  if (item.source === 'task') {
    return 'task_queued';
  }
  if (item.source === 'media_observation') {
    return 'media_observed';
  }
  if (item.source === 'queue_message') {
    return item.status === 'processing' ? 'queue_claimed' : 'queue_event';
  }
  if (item.kind === 'send_in_group' || item.kind === 'send_in_private' || item.kind === 'qq_self_message') {
    return 'visible_delivery_committed';
  }
  if (item.kind === 'recover_energy' || item.kind === 'rest_period' || item.kind === 'sleep_period') {
    return 'rest_started';
  }
  if (item.kind === 'qq_message_seen') {
    return 'qq_message_seen';
  }
  if (item.kind === 'state_snapshot') {
    return 'state_changed';
  }
  if (item.source === 'digital_action') {
    return 'historical_action_record';
  }
  return item.kind || item.source || 'runtime_event';
}

const ACTION_STREAM_EXCLUDED_LIFE_KINDS = new Set([
  'no_visible_delivery_observed',
  'presence_tick_evaluated',
  'surface_visit'
]);

function isPrimaryActionStreamItem(item) {
  if (!item) {
    return false;
  }
  if (item.source === 'life_event' && ACTION_STREAM_EXCLUDED_LIFE_KINDS.has(item.kind)) {
    return false;
  }
  if (item.source === 'llm_stack_item' && item.kind !== 'function_call' && item.kind !== 'function_call_output') {
    return false;
  }
  if (item.source === 'queue_message' && item.kind === 'phone_notification') {
    return false;
  }
  return true;
}

function inferActionStreamTraceTarget(item, explicitTraceTarget) {
  if (explicitTraceTarget) {
    return explicitTraceTarget;
  }
  const spanId = typeof item.metadata?.spanId === 'string' && item.metadata.spanId.trim()
    ? item.metadata.spanId.trim()
    : null;
  const llmRequestSliceId = firstString(item.metadata?.llmRequestSliceId, item.metadata?.llm_request_slice_id);
  const toolCallId = firstString(item.metadata?.toolCallId, item.metadata?.tool_call_id);
  const stackItemId = item.source === 'llm_stack_item' && typeof item.id === 'string' && item.id.startsWith('stack:')
    ? item.id.slice('stack:'.length)
    : firstString(item.metadata?.stackItemId, item.metadata?.stack_item_id);
  const traceId = firstString(item.traceId);
  const internalExecutionLeaseId = firstString(item.runId, traceId);
  if (!traceId && !internalExecutionLeaseId && !spanId && !llmRequestSliceId && !toolCallId && !stackItemId) {
    return null;
  }
  return {
    internalExecutionLeaseId,
    traceId,
    spanId,
    llmRequestSliceId,
    toolCallId,
    stackItemId
  };
}

function normalizeActionStreamItem(item) {
  const spanId = typeof item.metadata?.spanId === 'string' ? item.metadata.spanId : null;
  const internalExecutionLeaseId = item.runId || item.traceId || null;
  const explicitTraceTarget = item.traceTarget && typeof item.traceTarget === 'object'
    ? item.traceTarget
    : null;
  const traceTarget = inferActionStreamTraceTarget(item, explicitTraceTarget);
  const metadata = normalizeValue({
    ...item.metadata,
    internalExecutionLeaseId,
    spanId
  });
  if (Object.prototype.hasOwnProperty.call(metadata, 'completedAt')) {
    metadata.endedAt = metadata.completedAt;
    delete metadata.completedAt;
  }
  if (Object.prototype.hasOwnProperty.call(metadata, 'staleProcessing')) {
    metadata.staleRunning = metadata.staleProcessing;
    delete metadata.staleProcessing;
  }
  return {
    ...item,
    runId: null,
    status: normalizeActionStreamStatus(item.status),
    eventId: item.id,
    eventKind: normalizeActionStreamEventKind(item),
    occurredAt: item.timestamp,
    internalExecutionLeaseId,
    traceTarget: traceTarget ? normalizeValue(traceTarget) : null,
    metadata
  };
}

function normalizeActionStreamCurrent(current) {
  return {
    lifeState: current.lifeState,
    latestActivityAt: current.latestActivityAt,
    queue: {
      pending: current.queue.pending,
      running: current.queue.processing,
      staleRunning: current.queue.staleProcessing,
      failed: current.queue.failed
    },
    backgroundActions: {
      planned: current.digitalActions.planned,
      running: current.digitalActions.processing,
      settled: current.digitalActions.completed,
      failed: current.digitalActions.failed
    },
    autonomy: {
      ...current.autonomy,
      latestConsciousnessTickStatus: normalizeActionStreamStatus(current.autonomy.latestConsciousnessTickStatus),
      latestPhoneNotificationStatus: normalizeActionStreamStatus(current.autonomy.latestPhoneNotificationStatus),
      latestHistoricalDigitalActionStatus: normalizeActionStreamStatus(current.autonomy.latestHistoricalDigitalActionStatus)
    },
    tasks: {
      pending: current.tasks.pending,
      running: current.tasks.processing,
      settled: current.tasks.completed,
      failed: current.tasks.failed
    }
  };
}

function normalizeBigIntLookupId(value) {
  if (value === null || typeof value === 'undefined' || value === '') {
    return null;
  }
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function parseActionEventId(eventId) {
  if (typeof eventId !== 'string' || !eventId.trim()) {
    return null;
  }
  const [prefix, ...rest] = eventId.trim().split(':');
  const key = rest.join(':');
  return key ? { prefix, key } : null;
}

function normalizeTraceTarget(input = {}) {
  const traceId = firstString(input.traceId, input.trace_id);
  const runId = firstString(input.runId, input.run_id, input.internalExecutionLeaseId, input.internal_execution_lease_id);
  const spanId = firstString(input.spanId, input.span_id);
  const llmRequestSliceId = firstString(input.llmRequestSliceId, input.llm_request_slice_id, input.sliceId, input.slice_id);
  const toolCallId = firstString(input.toolCallId, input.tool_call_id);
  const stackItemId = firstString(input.stackItemId, input.stack_item_id);
  const conversationId = input.conversationId === null || typeof input.conversationId === 'undefined'
    ? firstString(input.conversation_id)
    : String(input.conversationId);
  if (!conversationId && !traceId && !runId && !spanId && !llmRequestSliceId && !toolCallId && !stackItemId) {
    return null;
  }
  return normalizeValue({
    conversationId: conversationId || null,
    traceId: traceId || null,
    spanId: spanId || null,
    internalExecutionLeaseId: runId || traceId || null,
    llmRequestSliceId: llmRequestSliceId || null,
    toolCallId: toolCallId || null,
    stackItemId: stackItemId || null
  });
}

function createXiaoniActivityPersistence({
  getPrismaClient,
  createSqlAdapter,
  listAgentStackItems,
  listLlmRequestSlices,
  listToolExecutions,
  findAgentStackItemByEventId
}) {
  function getClient(config) {
    return getPrismaClient(config);
  }

  async function resolveConversationIdFromTarget(target, config = {}) {
    if (!target || target.conversationId) {
      return target?.conversationId || null;
    }
    const sql = createSqlAdapter(config);
    try {
      if (target.internalExecutionLeaseId) {
        const runRows = await sql.query(
          'SELECT conversation_id FROM agent_runs WHERE id = ? LIMIT 1',
          [target.internalExecutionLeaseId]
        );
        const conversationId = runRows[0]?.conversation_id;
        if (conversationId) {
          return String(conversationId);
        }
      }

      if (target.traceId) {
        const conversationRows = await sql.query(
          'SELECT id FROM conversations WHERE trace_id = ? ORDER BY id DESC LIMIT 1',
          [target.traceId]
        );
        const conversationId = conversationRows[0]?.id;
        if (conversationId) {
          return String(conversationId);
        }
      }
    } finally {
      await sql.close();
    }
    return null;
  }

  async function enrichTraceTarget(target, config = {}) {
    if (!target) {
      return null;
    }
    const conversationId = await resolveConversationIdFromTarget(target, config);
    return normalizeTraceTarget({
      ...target,
      conversationId
    });
  }

  async function resolveToolActionTraceTarget(key, config = {}) {
    if (typeof listToolExecutions !== 'function') {
      return null;
    }
    let rows = await listToolExecutions({
      identityKey: 'xiaoni',
      executionId: key,
      limit: 1
    }, config);
    if (!rows[0]) {
      rows = await listToolExecutions({
        identityKey: 'xiaoni',
        toolCallId: key,
        limit: 1
      }, config);
    }
    const row = rows[0] || null;
    if (!row) {
      return null;
    }
    return normalizeTraceTarget({
      conversationId: row.conversationId,
      traceId: row.traceId,
      runId: row.runId,
      spanId: row.toolCallId ? `tool-call:${row.toolCallId}` : `tool-exec:${row.id || row.executionId}`,
      toolCallId: row.toolCallId,
      llmRequestSliceId: row.llmRequestSliceId
    });
  }

  async function resolveLlmActionTraceTarget(key, config = {}) {
    if (typeof listLlmRequestSlices !== 'function') {
      return null;
    }
    let rows = await listLlmRequestSlices({
      identityKey: 'xiaoni',
      sliceId: key,
      limit: 1
    }, config);
    if (!rows[0]) {
      rows = await listLlmRequestSlices({
        identityKey: 'xiaoni',
        llmCallId: key,
        limit: 1
      }, config);
    }
    const row = rows[0] || null;
    if (!row) {
      return null;
    }
    return normalizeTraceTarget({
      conversationId: row.conversationId,
      traceId: row.traceId,
      runId: row.runId,
      spanId: row.sliceId ? `stack-slice:${row.sliceId}` : `llm-slice:${row.id}`,
      llmRequestSliceId: row.sliceId
    });
  }

  async function resolveStackActionTraceTarget(key, config = {}) {
    let row = null;
    const sql = createSqlAdapter(config);
    try {
      const rows = await sql.query(
        `
          SELECT *
          FROM agent_stack_items
          WHERE id::text = ? OR event_id = ?
          ORDER BY id DESC
          LIMIT 1
        `,
        [key, key]
      );
      row = rows[0] ? normalizeStackRowForActivity(rows[0]) : null;
    } catch {
      row = null;
    } finally {
      await sql.close();
    }
    if (typeof findAgentStackItemByEventId === 'function') {
      row = row || await findAgentStackItemByEventId(key, config);
    }
    if (!row && typeof listAgentStackItems === 'function') {
      const rows = await listAgentStackItems({
        identityKey: 'xiaoni',
        eventId: key,
        limit: 1
      }, config);
      row = rows[0] || null;
    }
    if (!row) {
      return null;
    }
    const metadata = normalizeJsonObject(row.metadata);
    const toolCallId = firstString(row.toolCallId, metadata.toolCallId, metadata.tool_call_id);
    const sliceId = firstString(row.llmRequestSliceId, metadata.llmRequestSliceId, metadata.llm_request_slice_id);
    return normalizeTraceTarget({
      conversationId: row.conversationId,
      traceId: row.traceId,
      runId: row.runId,
      stackItemId: row.id || key,
      toolCallId,
      llmRequestSliceId: sliceId,
      spanId: toolCallId
        ? `tool-call:${toolCallId}`
        : sliceId
          ? `stack-slice:${sliceId}`
          : `stack:${row.id || row.eventId}`
    });
  }

  async function resolveToolExecutionActionTraceTarget(key, config = {}) {
    if (typeof listToolExecutions !== 'function') {
      return null;
    }
    const rows = await listToolExecutions({
      identityKey: 'xiaoni',
      executionId: key,
      limit: 1
    }, config);
    const row = rows[0] || null;
    if (!row) {
      return null;
    }
    return normalizeTraceTarget({
      conversationId: row.conversationId,
      traceId: row.traceId,
      runId: row.runId,
      spanId: row.toolCallId ? `tool-call:${row.toolCallId}` : `tool-exec:${row.id || row.executionId}`
    });
  }

  async function findXiaoniActionEventTraceTarget(eventId, config = {}) {
    const parsed = parseActionEventId(eventId);
    if (!parsed) {
      return null;
    }

    const prisma = getClient(config);
    if (parsed.prefix === 'life') {
      const id = normalizeBigIntLookupId(parsed.key);
      if (id === null) {
        return null;
      }
      const row = await prisma.agentLifeEvent.findUnique({ where: { id } });
      if (!row) {
        return null;
      }
      return enrichTraceTarget(normalizeTraceTarget({
        conversationId: row.conversation_id,
        traceId: row.trace_id,
        runId: row.run_id,
        spanId: row.llm_call_id ? `llm-call:${row.llm_call_id}` : null
      }), config);
    }

    if (parsed.prefix === 'queue') {
      const id = normalizeBigIntLookupId(parsed.key);
      if (id === null) {
        return null;
      }
      const row = await prisma.agentQueueMessage.findUnique({ where: { id } });
      if (!row) {
        return null;
      }
      return enrichTraceTarget(normalizeTraceTarget({
        conversationId: row.conversation_id,
        traceId: row.trace_id,
        runId: row.run_id,
        spanId: `queue:${row.id}`
      }), config);
    }

    if (parsed.prefix === 'task') {
      const row = await prisma.agentTask.findUnique({ where: { id: parsed.key } });
      if (!row) {
        return null;
      }
      return enrichTraceTarget(normalizeTraceTarget({
        traceId: row.source_trace_id,
        runId: row.source_run_id,
        spanId: `task:${row.id}`
      }), config);
    }

    if (parsed.prefix === 'media') {
      const row = await prisma.agentMediaAsset.findUnique({ where: { id: parsed.key } });
      if (!row) {
        return null;
      }
      return enrichTraceTarget(normalizeTraceTarget({
        traceId: row.trace_id,
        spanId: `media:${row.id}`
      }), config);
    }

    if (parsed.prefix === 'tool') {
      return enrichTraceTarget(await resolveToolActionTraceTarget(parsed.key, config), config);
    }

    if (parsed.prefix === 'llm') {
      return enrichTraceTarget(await resolveLlmActionTraceTarget(parsed.key, config), config);
    }

    if (parsed.prefix === 'llm-slice' || parsed.prefix === 'llm-stack') {
      const llmCallId = parsed.key.split(':')[0];
      return enrichTraceTarget(await resolveLlmActionTraceTarget(llmCallId, config), config);
    }

    if (parsed.prefix === 'stack') {
      return enrichTraceTarget(await resolveStackActionTraceTarget(parsed.key, config), config);
    }

    if (parsed.prefix === 'tool-exec') {
      return enrichTraceTarget(await resolveToolExecutionActionTraceTarget(parsed.key, config), config);
    }

    return null;
  }

  async function getXiaoniActivityFeed(input = {}, config = {}) {
    const prisma = getClient(config);
    const identityKey = String(input.identityKey || input.identity_key || 'xiaoni');
    const actionStreamProjection = input.actionStreamProjection === true || input.action_stream_projection === true;
    const limit = clampLimit(input.limit, 80, 200);
    const scanLimit = actionStreamProjection
      ? clampLimit(input.scanLimit || input.scan_limit || Math.max(limit * 2, 120), 120, 300)
      : limit;
    const perSourceLimit = Math.max(30, scanLimit);
    const timeWindow = resolveTimeWindow(input);
    const timeFilter = prismaTimeFilter(timeWindow);
    const staleProcessingMs = Math.max(60_000, Number(input.staleProcessingMs || input.stale_processing_ms || 5 * 60_000));
    const processingStaleBefore = new Date(Date.now() - staleProcessingMs);
    const sql = createSqlAdapter(config);
    const queueTimePredicate = buildSqlTimePredicate([
      'COALESCE(processing_started_at, locked_at, updated_at, available_at, created_at)'
    ], timeWindow);
    const phoneQueueTimePredicate = buildSqlTimePredicate([
      'COALESCE(processing_started_at, locked_at, available_at, created_at)'
    ], timeWindow);
    const lifeEventWhere = {
      identity_key: identityKey,
      event_kind: { notIn: ['pending_share_created', 'pending_share_consumed'] },
      ...(timeFilter ? { occurred_at: timeFilter } : {})
    };
    const digitalActionWhere = {
      identity_key: identityKey,
      ...(timeFilter ? { created_at: timeFilter } : {})
    };
    const taskWhere = timeFilter ? { created_at: timeFilter } : {};
    const mediaWhere = timeFilter ? {
      OR: [
        { created_at: timeFilter },
        { observations: { some: { created_at: timeFilter } } }
      ]
    } : {};

    try {
      const [
        lifeState,
        lifeEvents,
        digitalActions,
        tasks,
        mediaAssets,
        queueItems,
        autonomousQueueItems,
        llmRequestSliceRows,
        agentStackRows,
        agentStackToolRows,
        queueStats,
        digitalStats,
        taskStats
      ] = await Promise.all([
        prisma.agentSessionLifeState.findUnique({
          where: { identity_key: identityKey }
        }),
        prisma.agentLifeEvent.findMany({
          where: lifeEventWhere,
          orderBy: [{ occurred_at: 'desc' }, { id: 'desc' }],
          take: perSourceLimit
        }),
        prisma.agentDigitalAction.findMany({
          where: digitalActionWhere,
          orderBy: [{ created_at: 'desc' }],
          take: perSourceLimit
        }),
        prisma.agentTask.findMany({
          where: taskWhere,
          orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
          take: perSourceLimit,
          include: {
            artifacts: {
              orderBy: [{ created_at: 'desc' }, { id: 'desc' }]
            }
          }
        }),
        prisma.agentMediaAsset.findMany({
          where: mediaWhere,
          orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
          take: perSourceLimit,
          include: {
            observations: {
              orderBy: [{ created_at: 'desc' }]
            }
          }
        }),
        sql.query(`
          ${QUEUE_ACTIVITY_SELECT}
          WHERE status IN ('pending', 'processing', 'failed')
          ${queueTimePredicate.clause ? `AND ${queueTimePredicate.clause}` : ''}
          ORDER BY updated_at DESC, id DESC
          LIMIT ?
        `, [...queueTimePredicate.params, perSourceLimit]),
        sql.query(`
          ${QUEUE_ACTIVITY_SELECT}
          WHERE source IN ('phone_notification')
          ${phoneQueueTimePredicate.clause ? `AND ${phoneQueueTimePredicate.clause}` : ''}
          ORDER BY updated_at DESC, id DESC
          LIMIT ?
        `, [...phoneQueueTimePredicate.params, perSourceLimit]),
        typeof listLlmRequestSlices === 'function'
          ? listLlmRequestSlices({
            identityKey,
            limit: perSourceLimit,
            summaryOnly: actionStreamProjection,
            startTime: timeWindow.startTime,
            endTime: timeWindow.endTime
          }, config).catch(() => [])
          : [],
        typeof listAgentStackItems === 'function'
          ? (actionStreamProjection
            ? Promise.all(['runtime_input', 'function_call', 'function_call_output'].map((itemKind) => listAgentStackItems({
              identityKey,
              itemKind,
              limit: perSourceLimit,
              startTime: timeWindow.startTime,
              endTime: timeWindow.endTime
            }, config))).then((rows) => rows.flat()).catch(() => [])
            : listAgentStackItems({
              identityKey,
              limit: perSourceLimit,
              startTime: timeWindow.startTime,
              endTime: timeWindow.endTime
            }, config).catch(() => []))
          : [],
        typeof listToolExecutions === 'function'
          ? listToolExecutions({
            identityKey,
            limit: perSourceLimit,
            startTime: timeWindow.startTime,
            endTime: timeWindow.endTime
          }, config).catch(() => [])
          : [],
        Promise.all([
          prisma.agentQueueMessage.count({ where: { status: 'pending' } }),
          prisma.agentQueueMessage.count({ where: { status: 'processing' } }),
          prisma.agentQueueMessage.count({
            where: {
              status: 'processing',
              locked_at: { lt: processingStaleBefore }
            }
          }),
          prisma.agentQueueMessage.count({ where: { status: 'failed' } })
        ]),
        Promise.all([
          prisma.agentDigitalAction.count({ where: { identity_key: identityKey, status: 'planned' } }),
          prisma.agentDigitalAction.count({ where: { identity_key: identityKey, status: 'processing' } }),
          prisma.agentDigitalAction.count({ where: { identity_key: identityKey, status: 'completed' } }),
          prisma.agentDigitalAction.count({ where: { identity_key: identityKey, status: 'failed' } })
        ]),
        Promise.all([
          prisma.agentTask.count({ where: { status: 'pending' } }),
          prisma.agentTask.count({ where: { status: 'processing' } }),
          prisma.agentTask.count({ where: { status: 'completed' } }),
          prisma.agentTask.count({ where: { status: 'failed' } })
        ])
      ]);

      const latestPhoneNotificationQueue = latestByTimestamp(autonomousQueueItems.filter((row) => row.source === 'phone_notification'));
      const latestPresenceEvaluation = latestByTimestamp(lifeEvents.filter((row) => row.event_kind === 'presence_tick_evaluated'));
      const latestPresenceEvaluationPayload = normalizeJsonObject(latestPresenceEvaluation?.payload, {});
      const latestDigitalAction = latestByTimestamp(digitalActions);
      const normalizedAgentStackRows = Array.isArray(agentStackRows)
        ? agentStackRows.map(normalizeStackRowForActivity).filter(Boolean)
        : [];
      const normalizedAgentStackToolRows = Array.isArray(agentStackToolRows)
        ? agentStackToolRows
        : [];
      const normalizedLlmRequestSliceRows = Array.isArray(llmRequestSliceRows)
        ? llmRequestSliceRows
        : [];

      const projectedItems = dedupeFeedItems([
        ...normalizedLlmRequestSliceRows.filter((row) => !isSelfActionSearchLlm(row)).map(summarizeLlmRequestSlice),
        ...normalizedAgentStackRows.map(summarizeAgentStackItem),
        ...normalizedAgentStackToolRows.map(summarizeAgentStackToolExecution),
        ...lifeEvents.map(summarizeLifeEvent),
        ...digitalActions.map(summarizeDigitalAction),
        ...tasks.map(summarizeTask),
        ...mediaAssets.map(summarizeMedia),
        ...queueItems.map((row) => summarizeQueueMessage(row, staleProcessingMs)),
        ...autonomousQueueItems.map((row) => summarizeQueueMessage(row, staleProcessingMs))
      ])
        .filter((item) => item.timestamp)
        .filter((item) => itemMatchesTimeWindow(item, timeWindow));
      const items = (actionStreamProjection
        ? projectedItems.filter(isPrimaryActionStreamItem)
        : projectedItems)
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, limit);

      return {
        identityKey,
        generatedAt: new Date().toISOString(),
        filters: {
          startTime: normalizeDate(timeWindow.startTime),
          endTime: normalizeDate(timeWindow.endTime)
        },
        current: {
          lifeState: normalizeLifeState(lifeState),
          latestActivityAt: items[0]?.timestamp || null,
          queue: {
            pending: queueStats[0],
            processing: queueStats[1],
            staleProcessing: queueStats[2],
            failed: queueStats[3]
          },
          digitalActions: {
            planned: digitalStats[0],
            processing: digitalStats[1],
            completed: digitalStats[2],
            failed: digitalStats[3]
          },
          autonomy: {
            latestConsciousnessTickAt: null,
            latestConsciousnessTickStatus: null,
            latestPhoneNotificationAt: queueDisplayTimestamp(latestPhoneNotificationQueue),
            latestPhoneNotificationStatus: latestPhoneNotificationQueue?.status || null,
            latestPresenceEvaluationAt: normalizeDate(latestPresenceEvaluation?.occurred_at),
            latestPresenceEvaluationReason: latestPresenceEvaluationPayload.eligible === false
              ? firstString(latestPresenceEvaluationPayload.skip_reason, latestPresenceEvaluationPayload.reason, 'skipped')
              : firstString(latestPresenceEvaluationPayload.reason),
            latestPresenceEvaluationEligible: typeof latestPresenceEvaluationPayload.eligible === 'boolean'
              ? latestPresenceEvaluationPayload.eligible
              : null,
            liveSelfActionRunner: false,
            latestHistoricalDigitalActionAt: normalizeDate(latestDigitalAction?.updated_at || latestDigitalAction?.created_at),
            latestHistoricalDigitalActionStatus: latestDigitalAction?.status || null,
            latestHistoricalDigitalActionKind: latestDigitalAction?.action_type || null
          },
          tasks: {
            pending: taskStats[0],
            processing: taskStats[1],
            completed: taskStats[2],
            failed: taskStats[3]
          }
        },
        items: normalizeValue(items)
      };
    } finally {
      await sql.close();
    }
  }

  async function getXiaoniActionStream(input = {}, config = {}) {
    const timeWindow = resolveTimeWindow(input);
    const limit = clampLimit(input.limit, 80, 200);
    const feed = await getXiaoniActivityFeed({
      ...input,
      limit,
      actionStreamProjection: true
    }, config);
    const feedActionItems = feed.items.filter(isPrimaryActionStreamItem);
    const items = dedupeFeedItems(feedActionItems)
      .filter((item) => item.timestamp)
      .filter((item) => itemMatchesTimeWindow(item, timeWindow))
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);

    return {
      identityKey: feed.identityKey,
      generatedAt: feed.generatedAt,
      streamKind: 'xiaoni_action_stream',
      filters: feed.filters,
      current: {
        ...normalizeActionStreamCurrent(feed.current),
        latestActivityAt: items[0]?.timestamp || null
      },
      items: items.map(normalizeActionStreamItem)
    };
  }

  return {
      getXiaoniActivityFeed,
    getXiaoniActionStream,
    findXiaoniActionEventTraceTarget
  };
}

module.exports = {
  createXiaoniActivityPersistence
};
