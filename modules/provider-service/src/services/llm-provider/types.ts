import { UnifiedLLMConfig } from '../../types';

export type LLMProviderId = 'google' | 'google-gemini-cli' | 'google-legacy' | 'openai' | 'codex';

export type OpenResponseMessageRole = 'system' | 'developer' | 'user' | 'assistant';

export type OpenResponseInputContentPart =
  | { type: 'input_text'; text: string }
  | { type: 'input_image'; image_url?: string; source?: Record<string, any>; [key: string]: any }
  | { type: 'input_file'; source: Record<string, any>; [key: string]: any };

export type OpenResponseOutputContentPart =
  | { type: 'output_text'; text: string; annotations?: Array<Record<string, any>>; [key: string]: any }
  | { type: 'refusal'; refusal: string; [key: string]: any };

export type OpenResponseInputItem =
  | {
      type: 'message';
      role: OpenResponseMessageRole;
      content: string | OpenResponseInputContentPart[];
      phase?: 'commentary' | 'final_answer';
    }
  | {
      type: 'function_call';
      id?: string;
      call_id?: string;
      name: string;
      arguments: string;
    }
  | {
      type: 'function_call_output';
      call_id: string;
      output: string;
    }
  | {
      type: 'reasoning';
      content?: string;
      summary?: string;
    }
  | {
      type: 'item_reference';
      id: string;
    };

export type OpenResponseToolDefinition = {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, any>;
  };
} | {
  type: 'web_search' | 'web_search_preview';
  user_location?: {
    type?: 'approximate';
    city?: string;
    region?: string;
    country?: string;
    timezone?: string;
  };
  filters?: {
    allowed_domains?: string[];
  };
  search_context_size?: 'low' | 'medium' | 'high';
  external_web_access?: boolean;
};

export type OpenResponseToolChoice =
  | 'auto'
  | 'none'
  | 'required'
  | {
      type: 'function';
      function: {
        name: string;
      };
    }
  | {
      type: 'allowed_tools';
      mode?: 'auto' | 'required';
      tools: Array<
        | {
            type: 'function';
            name: string;
          }
        | {
            type: 'web_search' | 'web_search_preview';
          }
      >;
    };

export type OpenResponseOutputItem =
  | {
      type: 'message';
      id?: string;
      role: 'assistant';
      content: OpenResponseOutputContentPart[];
      phase?: 'commentary' | 'final_answer';
      status?: 'in_progress' | 'completed';
    }
  | {
      type: 'function_call';
      id?: string;
      call_id?: string;
      name: string;
      arguments: string;
      status?: 'in_progress' | 'completed';
    }
  | {
      type: 'reasoning';
      id?: string;
      content?: string;
      summary?: string;
    }
  | {
      type: 'web_search_call';
      id?: string;
      status?: 'in_progress' | 'completed';
      action?: {
        type?: 'search' | 'open_page' | 'find_in_page';
        query?: string;
        queries?: string[];
        url?: string;
        pattern?: string;
      };
    };

export interface OpenResponseUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  input_tokens_details?: {
    cached_tokens?: number;
    [key: string]: any;
  };
  output_tokens_details?: {
    reasoning_tokens?: number;
    [key: string]: any;
  };
  [key: string]: any;
}

export interface OpenResponseResource {
  id?: string;
  object?: 'response';
  created_at?: number;
  status: 'in_progress' | 'completed' | 'failed' | 'cancelled' | 'incomplete';
  model: string;
  output: OpenResponseOutputItem[];
  output_text?: string;
  usage: OpenResponseUsage;
  error?: {
    code?: string;
    message?: string;
    [key: string]: any;
  };
  [key: string]: any;
}

export interface OpenResponseCreateRequest {
  model: string;
  input: string | OpenResponseInputItem[];
  instructions?: string;
  tools?: OpenResponseToolDefinition[];
  tool_choice?: OpenResponseToolChoice;
  stream?: boolean;
  max_output_tokens?: number;
  max_tool_calls?: number;
  temperature?: number;
  top_p?: number;
  metadata?: Record<string, string>;
  store?: boolean;
  previous_response_id?: string;
  reasoning?: {
    effort?: string;
    summary?: 'auto' | 'concise' | 'detailed' | string;
    [key: string]: any;
  };
  truncation?: 'auto' | 'disabled';
  stop?: string[];
  text?: Record<string, any>;
  include?: string[];
  parallel_tool_calls?: boolean;
  prompt_cache_key?: string;
  prompt_cache_retention?: string;
  [key: string]: any;
}

export interface LLMProviderUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  processingTimeMs: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
  rawUsage?: Record<string, any>;
}

export interface LLMProviderContext {
  traceId?: string;
  conversationId?: string;
  agentType?: string;
  promptName?: string;
  promptId?: string;
  agentTurn?: number;
  llmCallId?: string;
  toolCallId?: string;
  sessionId?: string;
  turnId?: string;
  sandbox?: string;
}

export interface LLMProviderTextRequest {
  prompt: string;
  config: UnifiedLLMConfig;
  context?: LLMProviderContext;
}

export interface LLMProviderContentRequest {
  request: OpenResponseCreateRequest;
  modelName: string;
  providerConfig?: UnifiedLLMConfig;
  context?: LLMProviderContext;
}

export interface LLMProviderTextResult {
  provider: LLMProviderId;
  modelName: string;
  text: string;
  rawResponse: any;
  canonicalRequest: OpenResponseCreateRequest;
  wireRequest: any;
  canonicalResponse: OpenResponseResource;
  wireResponse: any;
  requestFormatVersion: string;
  wireProviderFormat: string;
  usage: LLMProviderUsage;
}

export interface LLMProviderContentResult {
  provider: LLMProviderId;
  modelName: string;
  text: string;
  response: OpenResponseResource;
  rawResponse: any;
  canonicalRequest: OpenResponseCreateRequest;
  wireRequest: any;
  canonicalResponse: OpenResponseResource;
  wireResponse: any;
  requestFormatVersion: string;
  wireProviderFormat: string;
  usage: LLMProviderUsage;
}

export interface LLMProvider {
  readonly id: LLMProviderId;
  generateText(input: LLMProviderTextRequest): Promise<LLMProviderTextResult>;
  generateContent(input: LLMProviderContentRequest): Promise<LLMProviderContentResult>;
}
