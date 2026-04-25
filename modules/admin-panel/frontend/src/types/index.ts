// Timeline Event Types
export interface TimelineEvent {
  event_type: string;
  event_name: string;
  event_phase: 'start' | 'end' | 'instant';
  event_time: string;
  duration_ms?: number;
  metadata?: any;
}

export interface AgentRunSessionSummary {
  session_key: string;
  peer_name?: string | null;
  chat_type: 'direct' | 'group';
  latest_run_id?: string | null;
  latest_status: string;
  last_termination_reason?: string | null;
  last_finish_reason?: string | null;
  last_finish_outcome?: string | null;
  last_no_reply: boolean;
  last_final_response?: string | null;
  latest_started_at?: string | null;
  latest_completed_at?: string | null;
  latest_input_message_count: number;
  latest_message_preview?: string | null;
  total_runs: number;
  failed_runs: number;
  no_reply_runs: number;
}

export interface AgentRunListItem {
  id: string;
  batch_id: string;
  trace_id: string;
  conversation_id?: number | null;
  session_key: string;
  chat_type: 'direct' | 'group';
  peer_id: string;
  peer_name?: string | null;
  status: string;
  termination_reason?: string | null;
  finish_reason?: string | null;
  finish_outcome?: string | null;
  no_reply: boolean;
  final_response?: string | null;
  total_turns: number;
  error_message?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  created_at: string;
  input_message_count: number;
  summary?: string | null;
  llm_calls_count: number;
  input_tokens_total: number;
  output_tokens_total: number;
  cached_input_tokens_total: number;
}

export interface RelationshipMemoryOverrideRecord {
  id: number;
  action_type?: string | null;
  manual_note?: string | null;
  created_by?: string | null;
  metadata?: Record<string, unknown>;
  created_at?: string | null;
}

export interface RelationshipMemoryEventEvidenceRecord {
  id: number;
  event_type?: string | null;
  session_key?: string | null;
  target_user_id?: number | null;
  source_message_ids: number[];
  source_excerpt?: string | null;
  event_weight: number;
  confidence?: string | null;
  created_at?: string | null;
  last_reinforced_at?: string | null;
  metadata?: Record<string, unknown>;
}

export interface RelationshipMemoryMessageEvidenceRecord {
  id: number;
  session_key?: string | null;
  role?: string | null;
  phase?: string | null;
  source?: string | null;
  trace_id?: string | null;
  run_id?: string | null;
  group_index: number;
  item_index: number;
  message_sid?: string | null;
  sender_id?: string | null;
  sender_name?: string | null;
  content?: string | null;
  created_at?: string | null;
}

export interface SessionConversationItemRecord {
  id: number;
  session_key?: string | null;
  role?: string | null;
  phase?: string | null;
  source?: string | null;
  trace_id?: string | null;
  run_id?: string | null;
  group_index: number;
  item_index: number;
  message_sid?: string | null;
  sender_id?: string | null;
  sender_name?: string | null;
  content?: string | null;
  created_at?: string | null;
}

export interface RelationshipMemoryCardRecord {
  id: number;
  card_type?: string | null;
  group_id?: number | null;
  target_user_id?: number | null;
  version: number;
  summary_text: string;
  actors: string[];
  context_before?: string | null;
  trigger?: string | null;
  interaction?: string | null;
  outcome?: string | null;
  source_event_ids: number[];
  source_message_ids: number[];
  importance_score: number;
  freshness_score: number;
  decayed_score: number;
  last_hit_at?: string | null;
  entered_runtime: boolean;
  metadata?: Record<string, unknown>;
  created_at?: string | null;
  updated_at?: string | null;
  overrides: RelationshipMemoryOverrideRecord[];
  evidence_events: RelationshipMemoryEventEvidenceRecord[];
  evidence_messages: RelationshipMemoryMessageEvidenceRecord[];
}

export interface RelationshipMemoryJobRecord {
  id: number;
  session_key?: string | null;
  group_id?: number | null;
  status?: string | null;
  trigger_reason?: string | null;
  turn_range_start?: number | null;
  turn_range_end?: number | null;
  ledger_event_count: number;
  input_message_ids: number[];
  output_card_version?: number | null;
  error_message?: string | null;
  metadata?: Record<string, unknown>;
  started_at?: string | null;
  finished_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface SessionRelationshipMemoryData {
  session_key: string;
  normalized_session_key: string;
  chat_type: 'group' | 'direct';
  group_id?: number | null;
  jobs: RelationshipMemoryJobRecord[];
  group_cards: RelationshipMemoryCardRecord[];
  person_cards: RelationshipMemoryCardRecord[];
}

export interface AgentRunInputMessage {
  position: number;
  queue_message_id: number;
  message_sid?: string | null;
  sender_id: string;
  sender_name?: string | null;
  body_for_agent: string;
  raw_payload?: any;
  inbound_context?: any;
  created_at?: string | null;
  processing_started_at?: string | null;
  completed_at?: string | null;
}

export interface AgentRunDetail {
  session: {
    session_key: string;
    peer_id: string;
    peer_name?: string | null;
    chat_type: 'direct' | 'group';
    account_id: string;
  };
  run: {
    id: string;
    batch_id: string;
    trace_id: string;
    conversation_id?: number | null;
    status: string;
    termination_reason?: string | null;
    finish_reason?: string | null;
    finish_outcome?: string | null;
    no_reply: boolean;
    final_response?: string | null;
    error_message?: string | null;
    total_turns: number;
    started_at?: string | null;
    completed_at?: string | null;
    reason_for_start?: string | null;
  };
  input_batch: {
    id: string;
    message_count: number;
    summary?: string | null;
    messages: AgentRunInputMessage[];
  };
  decision: {
    llm_calls_count: number;
    tool_calls_count: number;
    sent_messages_count: number;
    participation?: {
      attempts: number;
      latest?: {
        event_id: number;
        event_time?: string | null;
        decision?: string | null;
        reason?: string | null;
        confidence?: string | null;
        conservative_fallback: boolean;
        used_embeddings: boolean;
        used_llm_judge: boolean;
        llm_judge_model?: string | null;
        llm_judge_decision?: string | null;
        llm_judge_confidence?: string | null;
        llm_judge_reason?: string | null;
        llm_judge_error?: string | null;
        continuity_similarity?: number | null;
        interest_similarity?: number | null;
        scores?: {
          addressedness: number;
          continuity: number;
          social_position: number;
          interest: number;
          timing: number;
          value_add: number;
          final: number;
        };
        session_key?: string | null;
        recent_inbound_count?: number;
        recent_reply_count?: number;
        cooldown_remaining_ms?: number;
        path?: string | null;
        embedding_error?: string | null;
      } | null;
    };
    token_totals: {
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
      cached_input_tokens: number;
    };
    llm_calls: any[];
    tool_calls: any[];
    timeline: any[];
  };
  result: {
    final_response?: string | null;
    sent_messages: string[];
    no_reply: boolean;
    termination_reason?: string | null;
    finish_reason?: string | null;
    finish_outcome?: string | null;
    error_message?: string | null;
  };
  trace_summary: {
    trace_id: string;
    conversation_id?: number | null;
  };
}

// New MESSAGE_FLOW_API types
export interface LLMCallRecord {
  sequence: number;
  stage: string;
  agent_type?: string | null;
  purpose?: string | null;
  input: {
    model_name?: string | null;
    model_provider?: string | null;
    prompt_template?: string | null;
    canonical_request?: any;
    wire_request?: any;
    request_format_version?: string;
    wire_provider_format?: string;
    timestamp: string;
  };
  output: {
    status: 'SUCCESS' | 'ERROR' | 'TIMEOUT' | 'SKIPPED';
    canonical_response?: any;
    wire_response?: any;
    processed_response?: string;
    token_usage: {
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
    };
    usage_details?: {
      cached_input_tokens?: number;
      reasoning_tokens?: number;
      raw_usage?: any;
    };
    context_policy?: {
      model?: string;
      source?: string;
      context_window_tokens?: number;
      max_output_tokens?: number;
      default_reply_budget_tokens?: number;
      soft_trigger_ratio?: number;
      hard_buffer_ratio?: number;
      soft_trigger_tokens?: number;
      hard_ceiling_tokens?: number;
      reply_budget_tokens?: number;
    };
    performance: {
      api_call_time_ms: number;
      processing_time_ms: number;
      queue_wait_time_ms?: number;
    };
    cost_estimate?: number;
    error_info?: {
      error_message: string;
      error_code: string;
      retry_count: number;
    };
    timestamp: string;
  };
}

export interface ProcessingEvent {
  event_id: string;
  event_type: string;
  event_name: string;
  event_phase: 'start' | 'end' | 'instant';
  event_time: string;
  duration_ms?: number;
  metadata?: {
    component: string;
    details: any;
    performance_metrics?: any;
  };
}

export interface LLMFlowResponse {
  conversation_id: string;
  trace_id: string;

  message_input: {
    user_id: number;
    message: string;
    message_type: 'private' | 'group';
    group_id?: number;
    message_id?: number;
    source: 'queue' | 'api_simulation' | 'test';
    queued_at: string;
    processed_at: string;
    partition_key: string;
    priority: 'HIGH' | 'MEDIUM' | 'LOW';
    batch_info?: {
      batch_id: string;
      batch_index: number;
      batch_size: number;
    };
  };

  message_output: {
    content: string;
    response_time_ms: number;
    model_used: string | null;
    delivery_method: 'http_api';
    delivery_status: 'sent' | 'failed' | 'pending';
    timestamp: string;
    character_count: number;
    delivery_latency_ms?: number;
  };

  llm_call_chain: LLMCallRecord[];

  processing_events: ProcessingEvent[];

  flow_summary: {
    total_processing_time_ms: number;
    queue_wait_time_ms: number;
    llm_processing_time_ms: number;
    total_llm_calls: number;
    successful_calls: number;
    failed_calls: number;
    skipped_calls: number;
    total_tokens_used: number;
    total_cost_estimate: number;
    success_rate: number;
    bottleneck_stage?: string;
    efficiency_score: number;
  };

  debug_info: {
    data_completeness: {
      conversation_record: 'complete' | 'partial' | 'missing';
      llm_call_logs: 'complete' | 'partial' | 'missing';
      queue_logs: 'complete' | 'partial' | 'missing';
      processing_events: 'complete' | 'partial' | 'missing';
    };
    missing_data_reasons: string[];
    architecture_notes: string[];
    performance_warnings: string[];
    recommendations: string[];
  };
}

export interface OneBot11Message {
  user_id: number;
  group_id?: number;
  message: string;
  raw_message: string;
  message_id: number;
  message_type: 'private' | 'group';
  [key: string]: any;
}

export interface GeminiRequest {
  contents: Array<{
    role: string;
    parts: Array<{ text: string }>;
  }>;
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
  };
}

export interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{ text: string }>;
      role: string;
    };
    finishReason: string;
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

// Timeline Component Types
export interface TimelineNode {
  id: string;
  timestamp: Date;
  type: 'websocket_in' | 'llm_call' | 'websocket_out' | 'error';
  title: string;
  duration_ms?: number;
  status: 'success' | 'error' | 'pending';
  summary: string;
  data: {
    input: any;
    output: any;
    model_name?: string;
    agent_type?: string;
    prompt_tokens?: number;
    completion_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    cached_input_tokens?: number;
    reasoning_tokens?: number;
    context_policy?: LLMCallRecord['output']['context_policy'];
    processing_time_ms?: number;
    api_call_time_ms?: number;
    response_time_ms?: number;
    success?: boolean;
    status?: string;
    error_message?: string;
    cost?: number;
    confidence?: number;
  };
}

export interface ConversationTimelineData {
  conversation_id: string;
  trace_id?: string;

  message_input: LLMFlowResponse['message_input'];
  message_output: LLMFlowResponse['message_output'];
  llm_call_chain: LLMCallRecord[];
  processing_events: ProcessingEvent[];
  flow_summary: LLMFlowResponse['flow_summary'];
  debug_info: LLMFlowResponse['debug_info'];

  websocket_input: OneBot11Message;
  websocket_output: {
    content: string;
    response_time_ms: string | number;
    model: string;
    timestamp: string;
  };
  timeline_nodes: TimelineNode[];
  timeline_events: TimelineEvent[];
  timeline_summary: {
    total_duration: number;
    total_cost: number;
    total_tokens: number;
    success_rate: number;
    efficiency_score?: number;
    queue_wait_time?: number;
    bottleneck_stage?: string;
  };
}

// Engine Type Display Names
export const ENGINE_NAMES: Record<string, string> = {
  'decision': 'DecisionEngine分析',
  'context': 'ContextEngine上下文',
  'persona': '风格处理(历史)',
  'main_chat': 'MainChat回复生成',
  'user_relationship_analyzer': '用户关系分析',
  'chat_bot': '智能对话生成',
  'attention_analyzer': '注意力分析算法'
};

// Status Colors
export const STATUS_COLORS: Record<string, string> = {
  'success': 'bg-green-500',
  'error': 'bg-red-500',
  'pending': 'bg-yellow-500'
};

export interface TraceSummary {
  trace_id: string;
  root_span_id: string;
  status: string;
  started_at: string | null;
  ended_at: string | null;
  duration_ms: number | null;
  span_count: number;
  error_count: number;
  summary: string;
  first_error: {
    span_id: string;
    title: string;
    summary: string;
  } | null;
  bottleneck: {
    span_id: string;
    title: string;
    duration_ms: number | null;
  } | null;
  token_summary: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    cached_input_tokens: number;
  };
}

export interface TraceSpanEvent {
  id: string;
  name: string;
  timestamp: string | null;
  attributes: Record<string, unknown>;
}

export interface TraceSpanLink {
  id: string;
  linked_trace_id: string | null;
  linked_span_id: string | null;
  attributes: Record<string, unknown>;
}

export interface TraceSpanRecord {
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
  input: any;
  output: any;
  evidence: any;
  events: TraceSpanEvent[];
  links: TraceSpanLink[];
  confidence: 'observed' | 'derived' | 'missing';
  source_ref: string | number | null;
  playground_capability?: 'exact' | 'partial' | 'unsupported';
}

export interface ConversationTraceData {
  conversation_id: string;
  batch_id: string | null;
  trace: TraceSummary;
  spans: TraceSpanRecord[];
  raw_evidence: {
    conversation: any;
    websocket_logs: any[];
    timeline_events: any[];
    llm_calls: any[];
    tool_calls: any[];
    http_logs: any[];
    llm_jobs: any[];
  };
  data_quality: Record<string, string>;
}

export interface TraceInspectorSection {
  id: 'input' | 'output' | 'evidence';
  label: string;
  value: any;
  emptyLabel?: string;
}

export interface TraceSpanDetailData {
  input: any;
  output: any;
  evidence: any;
}

export interface TraceWaterfallMeta {
  label: string;
  value: string;
}

export interface TraceWaterfallRow {
  id: string;
  parentId: string | null;
  spanId: string;
  depth: number;
  pathTokens: string[];
  title: string;
  subtitle?: string | null;
  summary: string;
  status: 'unset' | 'ok' | 'error';
  kind: TraceSpanRecord['kind'];
  semanticRole: string;
  startedAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
  timelineOffsetMs: number;
  timelineWidthRatio: number;
  hasChildren: boolean;
  defaultExpanded: boolean;
  errorCountInSubtree: number;
  badges: string[];
  meta: TraceWaterfallMeta[];
  sourceRef?: string | number | null;
  playgroundCapability?: 'exact' | 'partial' | 'unsupported';
  providerRequestSpanId?: string | null;
  trafficLogId?: string | number | null;
  llmCallId?: string | null;
  inspector: {
    title?: string;
    subtitle?: string | null;
    sections: TraceInspectorSection[];
  };
}

export interface TraceMetric {
  label: string;
  value: string;
  detail?: string;
  tone?: 'default' | 'success' | 'warning' | 'danger';
}

export interface TraceWaterfallViewModel {
  rows: TraceWaterfallRow[];
  selectedSpanId: string | null;
  traceStartMs: number;
  traceDurationMs: number;
  metrics: TraceMetric[];
  metadataBadges: string[];
}
