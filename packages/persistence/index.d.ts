import type { PrismaClient } from './generated/client';

export type DatabaseUrlConfig = {
  databaseUrl?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  connectionLimit?: number;
  applicationName?: string;
};

export type SqlTransaction = {
  query<T = Record<string, unknown>>(query: string, params?: any[]): Promise<T[]>;
  execute(query: string, params?: any[]): Promise<number>;
  insert(query: string, params?: any[]): Promise<{ insertId: number; affectedRows: number }>;
};

export type SqlAdapter = SqlTransaction & {
  testConnection(): Promise<boolean>;
  withTransaction<T>(callback: (tx: SqlTransaction) => Promise<T>): Promise<T>;
  close(): Promise<void>;
};

export type TrafficLogFilters = {
  startTime?: string | Date;
  endTime?: string | Date;
  method?: string;
  host?: string;
  status?: number | string;
  isAiRequest?: boolean;
  apiType?: string;
  containerName?: string;
  traceId?: string;
  llmCallId?: string;
  search?: string;
};

export type TrafficLogListParams = {
  page?: number;
  limit?: number;
  filters?: TrafficLogFilters;
};

export type TrafficStatsParams = {
  startTime?: string | Date;
  endTime?: string | Date;
};

export type TrafficEndpointParams = {
  limit?: number;
  sortBy?: 'request_count' | 'avg_duration' | 'error_rate';
};

export type TrafficExportParams = {
  startTime?: string | Date;
  endTime?: string | Date;
  includeBody?: boolean;
  limit?: number;
};

export type TrafficTraceParams = {
  traceId?: string;
  conversationId?: number | bigint | string;
};

export type TrafficLogBatchInput = {
  request_id?: string | null;
  trace_id?: string | null;
  conversation_id?: number | bigint | string | null;
  user_id?: string | null;
  session_id?: string | null;
  agent_turn?: number | null;
  llm_call_id?: string | null;
  tool_call_id?: string | null;
  container_name?: string | null;
  service_name?: string | null;
  method: string;
  url: string;
  host: string;
  path: string;
  query_params?: Record<string, unknown> | string | null;
  request_headers?: Record<string, unknown> | string | null;
  request_body?: string | null;
  request_content_type?: string | null;
  request_size?: number | null;
  response_status?: number | null;
  response_headers?: Record<string, unknown> | string | null;
  response_body?: string | null;
  response_content_type?: string | null;
  response_size?: number | null;
  duration_ms?: number | bigint | null;
  request_timestamp: string | Date;
  response_timestamp?: string | Date | null;
  is_ai_request?: boolean;
  api_type?: string | null;
  api_version?: string | null;
  client_ip?: string | null;
  user_agent?: string | null;
  error_message?: string | null;
};

export type TrafficReplayHistoryInput = {
  original_log_id: number | bigint;
  replay_name?: string | null;
  target_url?: string | null;
  request_method?: string | null;
  request_headers?: Record<string, unknown> | null;
  request_body?: string | null;
  response_status?: number | null;
  response_headers?: Record<string, unknown> | null;
  response_body?: string | null;
  duration_ms?: number | null;
  status?: string | null;
  error_message?: string | null;
  replayed_by?: string | null;
  modified_method?: string | null;
  modified_url?: string | null;
  modified_headers?: Record<string, unknown> | null;
  modified_body?: string | null;
  modification_summary?: Record<string, unknown> | null;
  replay_request_headers?: Record<string, unknown> | null;
  replay_request_body?: string | null;
  replay_response_status?: number | null;
  replay_duration_ms?: number | null;
  replay_response_headers?: Record<string, unknown> | null;
  replay_response_body?: string | null;
  replay_response_size?: number | null;
  diff_summary?: Record<string, unknown> | null;
  status_code_match?: boolean;
  response_body_match?: boolean;
  duration_diff_ms?: number | null;
  body_size_diff?: number | null;
  success?: boolean;
  template_id?: number | null;
};

export type ChatPromptBindingSource = 'group' | 'private';

export type ResolvedChatAgentPrompt = {
  bindingSource: ChatPromptBindingSource;
  bindingPromptId: string;
  prompt: {
    id: string;
    promptName: string;
    agentType: string;
    systemInstruction: string;
    userPromptTemplate: string | null;
    contextVariables: Record<string, unknown>;
    modelName: string | null;
    modelConfig: Record<string, unknown>;
    advancedConfig: Record<string, unknown>;
  } | null;
};

export const Prisma: unknown;
export const STORAGE_TIMEZONE: string;
export const STORAGE_OFFSET: string;
export function buildDatabaseUrl(config?: DatabaseUrlConfig): string;
export function resolveDatabaseUrl(config?: DatabaseUrlConfig): string;
export function createSqlAdapter(config?: DatabaseUrlConfig): SqlAdapter;
export function getPrismaClient(config?: DatabaseUrlConfig): PrismaClient;
export function closePrismaClient(): Promise<void>;
export function resolveChatAgentPrompt(
  params: { chatType: 'direct' | 'group'; userId?: number | string | null; groupId?: number | string | null },
  config?: DatabaseUrlConfig
): Promise<ResolvedChatAgentPrompt | null>;
export function parseInstantValue(value: string | Date | null | undefined): Date | null;
export function parseStoredTimestamp(value: string | Date | null | undefined): Date | null;
export function serializeTimestampForStorage(value: string | Date | null | undefined): string | null;
export function serializeTimestampForApi(value: string | Date | null | undefined): string | null;
export function normalizeTimestampField(fieldName: string, value: unknown): unknown;
export function normalizeRowTimestampFields<T>(record: T): T;
export function prepareSqlParameter(value: unknown): unknown;
export function getEast8StartOfDay(value?: string | Date): Date;
export function formatEast8IsoOffset(value: string | Date): string;
export function formatEast8WallClock(value: string | Date): string;
export function listTrafficLogs(params?: TrafficLogListParams): Promise<{ data: any[]; total: number; page: number; limit: number }>;
export function getTrafficLogById(id: number | bigint | string): Promise<any | null>;
export function listTraceTrafficLogs(params?: TrafficTraceParams): Promise<any[]>;
export function getTrafficStats(params?: TrafficStatsParams): Promise<any>;
export function getTrafficEndpoints(params?: TrafficEndpointParams): Promise<any[]>;
export function searchTrafficLogs(params: { query: string; limit?: number }): Promise<any[]>;
export function exportTrafficLogs(params?: TrafficExportParams): Promise<any[]>;
export function ensureReplayHistorySchema(): Promise<void>;
export function listTrafficReplayHistory(originalLogId: number | bigint | string): Promise<any[]>;
export function createTrafficReplayHistory(data: TrafficReplayHistoryInput): Promise<any>;
export function listAiTrafficSamples(params?: { search?: string; limit?: number }): Promise<any[]>;
export function createTrafficLogBatch(records: TrafficLogBatchInput[]): Promise<{ count: number }>;
