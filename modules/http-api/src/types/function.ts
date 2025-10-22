export type FunctionInvokeMethod = 'HTTP' | 'GRPC' | 'INTERNAL';
export type FunctionAuthType = 'NONE' | 'SERVICE_TOKEN' | 'BASIC' | 'CUSTOM';
export type FunctionCallingMode = 'AUTO' | 'ANY' | 'NONE';
export type FunctionExecutionStatus = 'success' | 'failed' | 'timeout';

export interface FunctionDefinitionRecord {
  id: string;
  name: string;
  display_name: string;
  description: string | null;
  parameters_schema: any;
  side_effect: number;
  expect_response: number;
  category: string | null;
  tags: any;
  invoke_method: FunctionInvokeMethod;
  invoke_url: string | null;
  http_method: string | null;
  auth_type: FunctionAuthType;
  timeout_ms: number;
  retry_policy: any;
  execution_adapter: string | null;
  managed_by_system: number;
  enabled: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface FunctionDefinition {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  parametersSchema: any;
  sideEffect: boolean;
  expectResponse: boolean;
  category?: string;
  tags?: string[];
  invokeMethod: FunctionInvokeMethod;
  invokeUrl?: string;
  httpMethod?: string;
  authType: FunctionAuthType;
  timeoutMs: number;
  retryPolicy?: any;
  executionAdapter?: string;
  managedBySystem: boolean;
  enabled: boolean;
  createdBy?: string;
  updatedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PromptFunctionBindingRecord {
  id: number;
  prompt_id: string;
  function_id: string;
  calling_mode: FunctionCallingMode;
  priority: number | null;
  metadata: any;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PromptFunctionBinding {
  id: number;
  promptId: string;
  functionId: string;
  callingMode?: FunctionCallingMode;
  priority?: number;
  metadata?: Record<string, unknown>;
  createdBy?: string;
  updatedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PromptFunctionAggregate {
  promptId: string;
  functions: FunctionDefinition[];
}

export interface FunctionInvokeRequest {
  traceId?: string;
  jobId?: string;
  arguments: Record<string, unknown>;
  context?: Record<string, unknown>;
  requestMode?: FunctionCallingMode;
}

export interface FunctionInvokeResult {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
  suppressAutoReply?: boolean;
  durationMs?: number;
}
