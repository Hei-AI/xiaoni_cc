// Timeline Event Types
export interface TimelineEvent {
  event_type: string;
  event_name: string;
  event_phase: 'start' | 'end' | 'instant';
  event_time: string;
  duration_ms?: number;
  metadata?: any;
}

// New MESSAGE_FLOW_API types
export interface LLMCallRecord {
  sequence: number;
  stage: string;
  agent_type: string;
  purpose: string;
  input: {
    model_name: string;
    model_provider: string;
    prompt_template: string;
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
    model_used: string;
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
