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

function clampLimit(value, fallback = 80, max = 200) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.max(1, Math.min(parsed, max));
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

function extractCanonicalInputMessages(request) {
  const input = Array.isArray(request?.input) ? request.input : [];
  return input
    .map((item) => {
      const role = firstString(item?.role, item?.type) || 'item';
      const content = extractText(item?.content ?? item);
      return content ? `${role}: ${content}` : null;
    })
    .filter(Boolean);
}

function buildInContextSnapshot(canonicalRequest, contextSummary, inputPrompt) {
  const request = normalizeJsonObject(canonicalRequest, null);
  const messages = request ? extractCanonicalInputMessages(request) : [];
  const instructions = firstString(
    request?.effective_instructions,
    request?.instructions,
    request?.runtime_guidance
  );
  const tailMessages = messages.slice(-10);
  const parts = [
    contextSummary ? `context_summary: ${contextSummary}` : null,
    inputPrompt ? `input_prompt: ${inputPrompt}` : null,
    ...tailMessages,
    instructions ? `instructions: ${truncateText(instructions, 520)}` : null
  ].filter(Boolean);

  return {
    messageCount: messages.length,
    preview: truncateText(parts.join('\n\n'), 1200),
    messages: tailMessages.map((message) => truncateText(message, 360)).filter(Boolean)
  };
}

function eventTimestamp(value) {
  return normalizeDate(value) || new Date(0).toISOString();
}

function canonicalMetadata(row) {
  const request = normalizeJsonObject(row?.canonical_request, null);
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

const LIFE_EVENT_LABELS = {
  surface_visit: '打开会话',
  qq_message_seen: '看到消息',
  qq_self_message: '发出消息',
  speak_in_group: '在群里说话',
  silence_decision: '决定先不说',
  surface_leave: '离开会话',
  self_action_started: '开始后台行动',
  self_action_completed: '完成后台行动',
  web_search_result: '得到搜索结果',
  state_snapshot: '状态快照',
  terminal_action_committed: '行动已提交',
  terminal_action_blocked: '行动被阻止',
  presence_tick_evaluated: '抬头检查已评估',
  rest_period: '休息了一段时间',
  sleep_period: '睡了一段时间'
};

const AUTONOMOUS_QUEUE_SOURCES = ['life_loop', 'presence_tick', 'proactive_im_open'];

function isAutonomousQueueSource(source) {
  return AUTONOMOUS_QUEUE_SOURCES.includes(String(source || ''));
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
    tone: row.actor_type === 'human' ? 'neutral' : eventKind.includes('blocked') ? 'danger' : eventKind.includes('silence') ? 'warning' : 'xiaoni',
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

function summarizeToolCall(row) {
  const args = normalizeJsonObject(row.arguments);
  const result = normalizeJsonObject(row.result);
  const inContext = buildInContextSnapshot(row.canonical_request, row.context_summary, row.input_prompt);
  const operatorOnly = isSelfActionSearchLlm(row);
  const isBlockedTransition = Boolean(result.blocked_transition);
  const sentMessages = Array.isArray(result.sent_messages)
    ? result.sent_messages.filter((item) => typeof item === 'string' && item.trim()).join('\n')
    : null;
  const blockedMessages = Array.isArray(result.blocked_messages)
    ? result.blocked_messages.filter((item) => typeof item === 'string' && item.trim()).join('\n')
    : null;
  const title = `tool: ${row.tool_name || row.tool_type || 'unknown'}`;
  const body = firstString(
    isBlockedTransition ? result.reason : null,
    isBlockedTransition ? result.blocked_reason : null,
    isBlockedTransition ? blockedMessages : null,
    sentMessages,
    args.query,
    args.message,
    Array.isArray(args.messages) ? args.messages.join('\n') : null,
    args.reason,
    args.outcome,
    result.reason,
    result.outcome,
    args.xiaoni_os,
    row.error_message
  );

  return {
    id: `tool:${row.tool_call_id || row.id}`,
    source: 'tool_call',
    kind: row.tool_name || row.tool_type || 'tool',
    title,
    body: truncateText(body, 420),
    status: row.status || null,
    actor: 'xiaoni',
    actorName: '小腻',
    timestamp: eventTimestamp(row.started_at || row.completed_at),
    sessionKey: row.session_key || null,
    peerName: row.peer_name || null,
    runId: row.run_id || null,
    traceId: row.trace_id || null,
    tone: row.status === 'failed' ? 'danger' : isBlockedTransition ? 'warning' : row.status === 'completed' ? 'success' : 'warning',
    metadata: {
      toolCallId: row.tool_call_id || null,
      llmCallId: row.llm_call_id || null,
      spanId: row.tool_call_id ? `tool-call:${row.tool_call_id}` : `tool:${row.id}`,
      parentSpanId: row.llm_call_id ? `llm-call:${row.llm_call_id}` : null,
      agentTurn: Number(row.agent_turn || 0) || null,
      toolType: row.tool_type || null,
      executionMode: row.execution_mode || null,
      sideEffect: Boolean(row.side_effect),
      durationMs: row.duration_ms ? Number(row.duration_ms) : null,
      completedAt: normalizeDate(row.completed_at),
      errorMessage: row.error_message || null,
      llmAgentType: row.llm_agent_type || null,
      llmModelName: row.llm_model_name || null,
      inContextPreview: operatorOnly ? null : inContext.preview,
      inContextMessageCount: inContext.messageCount,
      toolArgumentsPreview: operatorOnly ? null : previewJson(args),
      toolResultPreview: operatorOnly ? null : previewJson(result)
    }
  };
}

function summarizeLlmCall(row) {
  const inContext = buildInContextSnapshot(row.canonical_request, row.context_summary, row.input_prompt);
  const operatorOnly = isSelfActionSearchLlm(row);
  const title = `LLM: ${row.agent_type || row.prompt_template || 'runtime'}`;
  const modelName = row.model_name || row.model_provider || 'LLM';
  const inputTokens = Number(row.input_tokens || 0);
  const outputTokens = Number(row.output_tokens || 0);
  const turnLabel = row.agent_turn ? `turn ${row.agent_turn}` : null;
  const tokenLabel = inputTokens || outputTokens ? `${inputTokens}->${outputTokens} tokens` : null;
  const body = row.error_message || [modelName, turnLabel, tokenLabel].filter(Boolean).join(' · ');

  return {
    id: `llm:${row.llm_call_id || row.id}`,
    source: 'llm_call',
    kind: row.agent_type || row.prompt_template || 'llm_call',
    title,
    body: truncateText(body, 420),
    status: row.status || null,
    actor: 'xiaoni',
    actorName: '小腻',
    timestamp: eventTimestamp(row.started_at || row.timestamp || row.completed_at),
    sessionKey: row.session_key || null,
    peerName: row.peer_name || null,
    runId: row.run_id || null,
    traceId: row.trace_id || null,
    tone: row.status === 'failed' ? 'danger' : row.status === 'completed' ? 'info' : 'warning',
    metadata: {
      llmCallId: row.llm_call_id || null,
      spanId: row.llm_call_id ? `llm-call:${row.llm_call_id}` : `llm:${row.id}`,
      agentTurn: Number(row.agent_turn || 0) || null,
      modelName: row.model_name || null,
      modelProvider: row.model_provider || null,
      promptTemplate: row.prompt_template || null,
      processingTimeMs: row.processing_time_ms ? Number(row.processing_time_ms) : null,
      apiCallTimeMs: row.api_call_time_ms ? Number(row.api_call_time_ms) : null,
      inputTokens,
      outputTokens,
      completedAt: normalizeDate(row.completed_at),
      errorMessage: row.error_message || null,
      inContextPreview: operatorOnly ? null : inContext.preview,
      inContextMessageCount: inContext.messageCount,
      responsePreview: operatorOnly ? null : truncateText(firstString(row.processed_response, row.raw_response), 520),
      tokenUsage: normalizeJsonObject(row.token_usage)
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
  const autonomousSource = isAutonomousQueueSource(row.source);
  const title = row.source === 'life_loop'
    ? '连续生活流'
    : row.source === 'presence_tick'
    ? '主动看一眼群'
    : row.source === 'proactive_im_open'
      ? '主动打开 IM'
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
    body: row.source === 'life_loop'
      ? '内部自运行 step；没有打开具体 QQ 会话。'
      : truncateText(row.body_for_agent, 360),
    status: row.status || null,
    actor: autonomousSource ? 'xiaoni' : 'system',
    actorName: autonomousSource ? '小腻' : firstString(row.sender_name, row.sender_id),
    timestamp: eventTimestamp(row.updated_at || row.created_at),
    sessionKey: row.session_key || null,
    peerName: row.peer_name || null,
    runId: row.run_id || null,
    traceId: row.trace_id || null,
    tone: isStaleProcessing ? 'warning' : row.status === 'failed' ? 'danger' : row.status === 'processing' ? 'warning' : autonomousSource ? 'xiaoni' : 'info',
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
    .sort((left, right) => new Date(eventTimestamp(right.updated_at || right.created_at || right.occurred_at)).getTime()
      - new Date(eventTimestamp(left.updated_at || left.created_at || left.occurred_at)).getTime())[0] || null;
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

function createXiaoniActivityPersistence({ getPrismaClient, createSqlAdapter }) {
  function getClient(config) {
    return getPrismaClient(config);
  }

  async function getXiaoniActivityFeed(input = {}, config = {}) {
    const prisma = getClient(config);
    const identityKey = String(input.identityKey || input.identity_key || 'xiaoni');
    const limit = clampLimit(input.limit, 80, 200);
    const perSourceLimit = Math.max(30, limit);
    const staleProcessingMs = Math.max(60_000, Number(input.staleProcessingMs || input.stale_processing_ms || 5 * 60_000));
    const processingStaleBefore = new Date(Date.now() - staleProcessingMs);
    const sql = createSqlAdapter(config);

    try {
      const [
        lifeState,
        lifeEvents,
        digitalActions,
        tasks,
        mediaAssets,
        queueItems,
        autonomousQueueItems,
        traceToolRows,
        traceLlmRows,
        queueStats,
        digitalStats,
        taskStats
      ] = await Promise.all([
        prisma.agentSessionLifeState.findUnique({
          where: { identity_key: identityKey }
        }),
        prisma.agentLifeEvent.findMany({
          where: {
            identity_key: identityKey,
            event_kind: { notIn: ['pending_share_created', 'pending_share_consumed'] }
          },
          orderBy: [{ occurred_at: 'desc' }, { id: 'desc' }],
          take: perSourceLimit
        }),
        prisma.agentDigitalAction.findMany({
          where: { identity_key: identityKey },
          orderBy: [{ created_at: 'desc' }],
          take: perSourceLimit
        }),
        prisma.agentTask.findMany({
          orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
          take: perSourceLimit,
          include: {
            artifacts: {
              orderBy: [{ created_at: 'desc' }, { id: 'desc' }]
            }
          }
        }),
        prisma.agentMediaAsset.findMany({
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
          ORDER BY updated_at DESC, id DESC
          LIMIT ?
        `, [perSourceLimit]),
        sql.query(`
          ${QUEUE_ACTIVITY_SELECT}
          WHERE source IN ('life_loop', 'presence_tick', 'proactive_im_open')
          ORDER BY updated_at DESC, id DESC
          LIMIT ?
        `, [perSourceLimit]),
        sql.query(`
          SELECT
            t.*,
            r.id AS run_id,
            r.session_key,
            r.peer_name,
            r.chat_type,
            l.agent_type AS llm_agent_type,
            l.model_name AS llm_model_name,
            l.canonical_request,
            l.input_prompt,
            l.context_summary,
            l.status AS llm_status,
            l.started_at AS llm_started_at,
            l.completed_at AS llm_completed_at
          FROM tool_execution_logs t
          LEFT JOIN llm_call_logs l ON l.llm_call_id = t.llm_call_id
          LEFT JOIN agent_runs r ON r.trace_id = t.trace_id
          ORDER BY COALESCE(t.started_at, t.completed_at) DESC NULLS LAST, t.id DESC
          LIMIT ?
        `, [perSourceLimit]),
        sql.query(`
          SELECT
            l.*,
            r.id AS run_id,
            r.session_key,
            r.peer_name,
            r.chat_type
          FROM llm_call_logs l
          LEFT JOIN agent_runs r ON r.trace_id = l.trace_id
          ORDER BY COALESCE(l.started_at, l.timestamp, l.completed_at) DESC NULLS LAST, l.id DESC
          LIMIT ?
        `, [perSourceLimit]),
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

      const latestLifeLoopQueue = latestByTimestamp(autonomousQueueItems.filter((row) => row.source === 'life_loop'));
      const latestPresenceQueue = latestByTimestamp(autonomousQueueItems.filter((row) => row.source === 'presence_tick'));
      const latestProactiveImQueue = latestByTimestamp(autonomousQueueItems.filter((row) => row.source === 'proactive_im_open'));
      const latestPresenceEvaluation = latestByTimestamp(lifeEvents.filter((row) => row.event_kind === 'presence_tick_evaluated'));
      const latestPresenceEvaluationPayload = normalizeJsonObject(latestPresenceEvaluation?.payload, {});
      const latestDigitalAction = latestByTimestamp(digitalActions);

      const items = dedupeFeedItems([
        ...traceToolRows.filter((row) => !isSelfActionSearchLlm(row)).map(summarizeToolCall),
        ...traceLlmRows.filter((row) => !isSelfActionSearchLlm(row)).map(summarizeLlmCall),
        ...lifeEvents.map(summarizeLifeEvent),
        ...digitalActions.map(summarizeDigitalAction),
        ...tasks.map(summarizeTask),
        ...mediaAssets.map(summarizeMedia),
        ...queueItems.map((row) => summarizeQueueMessage(row, staleProcessingMs)),
        ...autonomousQueueItems.map((row) => summarizeQueueMessage(row, staleProcessingMs))
      ])
        .filter((item) => item.timestamp)
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, limit);

      return {
        identityKey,
        generatedAt: new Date().toISOString(),
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
            latestLifeLoopAt: normalizeDate(latestLifeLoopQueue?.updated_at || latestLifeLoopQueue?.created_at),
            latestLifeLoopStatus: latestLifeLoopQueue?.status || null,
            latestPresenceTickAt: normalizeDate(
              latestPresenceQueue?.updated_at
              || latestPresenceQueue?.created_at
              || latestLifeLoopQueue?.updated_at
              || latestLifeLoopQueue?.created_at
            ),
            latestPresenceTickStatus: latestPresenceQueue?.status || latestLifeLoopQueue?.status || null,
            latestProactiveImOpenAt: normalizeDate(latestProactiveImQueue?.updated_at || latestProactiveImQueue?.created_at),
            latestProactiveImOpenStatus: latestProactiveImQueue?.status || null,
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

  return {
    getXiaoniActivityFeed
  };
}

module.exports = {
  createXiaoniActivityPersistence
};
