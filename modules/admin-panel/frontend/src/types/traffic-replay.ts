// HTTP流量重放相关类型定义

export interface TrafficLog {
  id: number;
  request_id?: string;
  trace_id?: string;
  container_name?: string;
  service_name?: string;
  method: string;
  url: string;
  host: string;
  path?: string;
  query_params?: Record<string, any>;
  request_headers?: Record<string, string>;
  request_body?: string;
  request_content_type?: string;
  request_size?: number;
  response_status?: number;
  response_headers?: Record<string, string>;
  response_body?: string;
  response_content_type?: string;
  response_size?: number;
  duration_ms?: number;
  dns_lookup_ms?: number;
  tcp_connect_ms?: number;
  tls_handshake_ms?: number;
  server_processing_ms?: number;
  request_timestamp?: string;
  response_timestamp?: string;
  is_ai_request: boolean;
  api_type?: string;
  api_version?: string;
  client_ip?: string;
  user_agent?: string;
  referer?: string;
  error_message?: string;
  error_code?: string;
  retry_count?: number;
  is_cached_response?: boolean;
  is_truncated?: boolean;
  is_binary_data?: boolean;
  conversation_id?: string;
  user_id?: string;
  session_id?: string;
}

export interface ReplayModifications {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: string;
  queryParams?: Record<string, string>;
}

export interface ReplayRequest {
  originalLogId: number;
  modifications?: ReplayModifications;
  timeout?: number;
  followRedirects?: boolean;
  validateSSL?: boolean;
}

export interface DiffNode {
  kind: 'N' | 'D' | 'E' | 'A'; // New/Deleted/Edited/Array
  path: string[];
  lhs?: any;
  rhs?: any;
}

export interface HeaderDiff {
  key: string;
  type: 'added' | 'removed' | 'changed';
  original?: string;
  replayed?: string;
}

export interface ComparisonResult {
  statusMatch: boolean;
  statusOriginal: number;
  statusReplayed: number;
  bodyMatch: boolean;
  bodyDiff: DiffNode[];
  bodyOriginal: any;
  bodyReplayed: any;
  bodySizeDiff: number;
  headersDiff: HeaderDiff[];
  durationOriginal: number;
  durationReplayed: number;
  durationDiff: number;
  durationDiffPercent: number;
  overallSimilarity: number;
}

export interface ReplayResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  duration: number;
  size?: number;
}

export interface ReplayResult {
  success: boolean;
  replayHistoryId: number;
  originalLog: TrafficLog;
  modifiedRequest: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body: string;
  };
  replayResponse: ReplayResponse;
  comparison: ComparisonResult;
  error?: string;
}

export interface ReplayHistory {
  id: number;
  original_log_id: number;
  replayed_at: string;
  replayed_by?: string;
  modified_method?: string;
  modified_url?: string;
  modified_headers?: Record<string, string>;
  modified_body?: string;
  modification_summary?: {
    fieldsModified: string[];
    modificationCount: number;
  };
  replay_response_status: number;
  replay_duration_ms: number;
  diff_summary?: {
    statusMatch: boolean;
    bodyDiffCount: number;
  };
  status_code_match: boolean;
  response_body_match: boolean;
  duration_diff_ms: number;
  success: boolean;
  error_message?: string;
  template_id?: number;
}

export interface ReplayTemplate {
  id: number;
  template_name: string;
  description?: string;
  target_api_type?: string;
  target_host_pattern?: string;
  target_path_pattern?: string;
  header_modifications?: {
    add?: Record<string, string>;
    remove?: string[];
    replace?: Record<string, string>;
  };
  body_modifications?: {
    set?: Record<string, any>;
    remove?: string[];
    replace_entire?: string;
  };
  query_modifications?: {
    add?: Record<string, string>;
    remove?: string[];
    replace?: Record<string, string>;
  };
  url_replacement_pattern?: string;
  url_replacement_value?: string;
  is_active: boolean;
  usage_count: number;
  created_by?: string;
  created_at: string;
  updated_at: string;
}

export interface BatchReplayResult {
  total: number;
  successful: number;
  failed: number;
  results: Array<{
    logId: number;
    success: boolean;
    replayHistoryId?: number;
    comparison?: Pick<ComparisonResult, 'statusMatch' | 'overallSimilarity'>;
    error?: string;
  }>;
  aggregateStats: {
    avgDurationDiff: number;
    statusMatchRate: number;
    bodyMatchRate: number;
    avgSimilarity: number;
  };
}
