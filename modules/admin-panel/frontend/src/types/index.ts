// LLM Flow API Response Types
export interface LLMFlowResponse {
  conversation_id: string;
  websocket_input: OneBot11Message;
  websocket_output: {
    content: string;
    response_time_ms: number;
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
    engine_type: 'decision' | 'context' | 'persona' | 'main_chat';
    call_sequence: number;
    model_name: string;
    timestamp: string;
    gemini_request: GeminiRequest;
  };
  llm_raw_output: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    response_time_ms: number;
    success: boolean;
    gemini_response: GeminiResponse;
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
    prompt_tokens?: number;
    completion_tokens?: number;
    response_time_ms?: number;
    success?: boolean;
    cost?: number;
    confidence?: number;
  };
}

export interface ConversationTimelineData {
  conversation_id: string;
  websocket_input: OneBot11Message;
  websocket_output: {
    content: string;
    response_time_ms: number;
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
  'main_chat': 'MainChat回复生成'
};

// Status Colors
export const STATUS_COLORS: Record<string, string> = {
  'success': 'bg-green-500',
  'error': 'bg-red-500',
  'pending': 'bg-yellow-500'
};