// LLM Flow API Response Types
export interface LLMFlowResponse {
  conversation_id: string;
  websocket_input: OneBot11Message;
  websocket_output: {
    content: string;
    response_time_ms: string | number;
    model: string;
    timestamp: string;
  };
  llm_trace: LLMTrace[];
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

export interface LLMTrace {
  llm_raw_input: {
    agent_type: string;
    call_sequence: number;
    model_name: string;
    model_provider: string;
    timestamp: string;
    input_prompt: string;
    prompt_template?: string;
    model_config?: any;
    context_summary?: string;
  };
  llm_raw_output: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens: number;
    api_call_time_ms?: number;
    processing_time_ms?: number;
    status: string;
    error_message?: string;
    error_code?: string;
    cost_estimate?: number;
    raw_response?: string;
    processed_response?: string;
    token_usage?: any;
  };
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
  websocket_input: OneBot11Message;
  websocket_output: {
    content: string;
    response_time_ms: string | number;
    model: string;
    timestamp: string;
  };
  llm_traces: LLMTrace[];
  timeline_nodes: TimelineNode[];
  timeline_summary: {
    total_duration: number;
    total_cost: number;
    total_tokens: number;
    success_rate: number;
  };
}

// Engine Type Display Names
export const ENGINE_NAMES: Record<string, string> = {
  'decision': 'DecisionEngine分析',
  'context': 'ContextEngine上下文',
  'persona': 'PersonaEngine风格',
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