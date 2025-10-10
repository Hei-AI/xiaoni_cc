export interface OB11Segment {
  type: string;
  data: Record<string, any>;
}

export interface QQMessage {
  time: number;
  post_type: 'message' | 'message_sent';
  message_type: 'private' | 'group';
  sub_type: string;
  message_id: number;
  user_id: number;
  message: string | OB11Segment[];  // 支持消息段数组格式
  raw_message: string;
  font: number;
  sender: FriendSender | GroupSender;
  group_id?: number;  // 群消息时存在
  self_id: number;
  target_id?: number;  // 临时会话目标
  temp_source?: number;  // 临时会话来源
}

export interface FriendSender {
  user_id: number;
  nickname: string;
  sex: 'male' | 'female' | 'unknown';
  age?: number;
  group_id?: number;  // 群临时会话
}

export interface GroupSender {
  user_id: number;
  nickname: string;
  sex: 'male' | 'female' | 'unknown';
  card?: string;
  role: 'owner' | 'admin' | 'member';
  title?: string;
  level?: string;
}

export interface QQNotice {
  time: number;
  post_type: 'notice';
  self_id: number;
  notice_type: string;
  sub_type?: string;
  group_id?: number;
  user_id?: number;
  operator_id?: number;
  message_id?: number;  // 消息撤回等事件
  duration?: number;  // 禁言时长
  file?: {  // 文件上传
    id: string;
    name: string;
    size: number;
    busid: number;
  };
  card_new?: string;  // 群名片变更
  card_old?: string;
  likes?: Array<{  // 表情回应
    emoji_id: string;
    count: number;
  }>;
}

export interface QQRequest {
  time: number;
  post_type: 'request';
  self_id: number;
  request_type: 'friend' | 'group';
  sub_type?: string;  // group请求：'add'/'invite'
  user_id: number;
  comment: string;
  flag: string;
  group_id?: number;  // 群请求时存在
}

export interface WebSocketEvent {
  time: number;
  post_type: 'message' | 'notice' | 'request' | 'message_sent' | 'meta_event';
  self_id: number;
}

export interface QQMetaEvent extends WebSocketEvent {
  post_type: 'meta_event';
  meta_event_type: 'heartbeat' | 'lifecycle';
  sub_type?: string;
  status?: {
    online?: boolean;
    good: boolean;
  };
  interval?: number;  // 心跳间隔
}

export interface ConversationData {
  id: string;
  trace_id?: string; // 调用链追踪ID，关联websocket_logs
  user_id: number;
  user_message: string;
  ai_response?: string; // 改为可选，因为初始创建时可能为空
  timestamp: Date;
  response_time: number;
  model_name?: string; // 改为可选，因为初始创建时可能为空
  raw_request?: string;
  raw_response?: string;
  message_id?: number;
  reply_to_message_id?: number;
  reply_to_text?: string;
  session_id?: string;  // Session管理支持
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'filtered_receive_events' | 'filtered_disabled' | 'filtered_no_response' | 'filtered_empty_content'; // 扩展状态字段支持过滤状态
  error_reason?: string; // 新增错误原因字段
  group_id?: number; // 群聊ID，用于群聊消息记录
  batch_id?: string; // 关联的批次ID（用于批处理追踪）
  created_at: Date;
  updated_at: Date;
}

// 批次处理记录
export interface ConversationBatch {
  id: string; // UUID
  source_key: string; // user_123 或 group_456
  source_type: 'private' | 'group';
  trigger_type: 'direct' | 'scheduled' | 'manual';
  message_count: number;
  start_time: Date;
  end_time?: Date;
  processing_time?: number; // 毫秒
  status: 'processing' | 'completed' | 'failed';
  error_message?: string;
  metadata?: Record<string, any>; // JSON 元数据
  created_at: Date;
  updated_at: Date;
}

// LLM 调用追踪相关类型
export interface LLMCallTrace {
  id: string;
  session_id: string;
  conversation_id?: string;
  call_sequence: number;
  engine_type: 'decision' | 'context' | 'style' | 'persona' | 'main_chat' | 'requirement';
  model_name?: string;
  request?: string;
  response?: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  response_time: number;
  timestamp: Date;
  success: boolean;
  error_message?: string;
  created_at?: Date;
  gemini_request?: any;
  gemini_response?: any;
}

// Session LLM 分析结果
export interface SessionLLMAnalysis {
  session_id: string;
  total_calls: number;
  total_tokens: number;
  total_cost_estimate: number;
  average_response_time: number;
  engine_breakdown: Record<string, number>;
  call_timeline: LLMCallTrace[];
  success_rate: number;
}

export interface RequirementData {
  id: string;
  user_id: number;
  message: string;
  user_message: string;  // Alias for compatibility
  status: 'received' | 'analyzing' | 'processing' | 'completed' | 'failed' | 'cancelled';
  created_at: Date;
  updated_at: Date;
  claude_code_output?: string;
  completion_details?: string;
  error_message?: string;
  processing_start_time?: Date;
  processing_end_time?: Date;
  session_id?: string;  // Session管理支持
}

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  charset?: string;
  timezone?: string;
}

export interface WebSocketConfig {
  host: string;
  port: number;
  access_token: string;
  uri: string;
}

export interface HttpServerConfig {
  host: string;
  port: number;
}

export interface AIConfig {
  gemini_api_keys: string[];
  model_name: string;
  authorized_user_id: number;
  bot_qq_number: number;
}

export interface AppConfig {
  database: DatabaseConfig;
  websocket: WebSocketConfig;
  http_server: HttpServerConfig;
  ai: AIConfig;
  logging: {
    level: string;
    file_prefix: string;
  };
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  module: string;
  message: string;
  extra?: Record<string, any>;
}

export interface AgentPromptData {
  id: string;
  agent_type: 'chat_bot' | 'intent_analyzer' | 'requirement_processor' | 'persona_chat' | 'custom';
  prompt_name: string;
  system_instructions: string[];
  user_prompt_template?: string;
  context_variables?: Record<string, string>;
  model_name?: string;
  model_config?: {
    temperature?: number;
    topK?: number;
    topP?: number;
    maxOutputTokens?: number;
  };
  // 🆕 新增高级配置字段
  advanced_config?: AgentAdvancedConfig;
  config_version?: string;
  last_config_update?: Date;
  is_active: boolean;
  version: number;
  created_by: string;
  created_at: Date;
  updated_at: Date;
  description?: string;
  // 🆕 Token-Model绑定字段
  allowed_token_ids?: number[]; // 允许使用的Token ID列表
}

// 🆕 Agent高级配置接口
export interface AgentAdvancedConfig {
  generationConfig?: {
    temperature?: number;
    topP?: number;
    topK?: number;
    maxOutputTokens?: number;
    stopSequences?: string[];
    responseMimeType?: string;
  };
  thinkingConfig?: {
    thinkingBudget?: number; // -1为自动，0为禁用，正数为固定预算
    includeThoughts?: boolean;
  };
  safetySettings?: Array<{
    category: string;
    threshold: string;
  }>;
  toolsConfig?: {
    enabled?: boolean;
    selectedTools?: string[]; // 🆕 使用预定义工具的key
    mode?: 'AUTO' | 'ANY' | 'NONE';
    allowedTools?: string[]; // 可调用的工具限制
    functionCallingConfig?: FunctionCallingConfig;
  };
  googleSearchConfig?: {
    enabled: boolean;
    dynamicThreshold?: boolean | number;
  };
  urlContextConfig?: {
    enabled: boolean;
    maxUrls?: number;
    maxSizePerUrl?: number; // MB
  };
  structuredOutputConfig?: {
    enabled: boolean;
    jsonSchema?: any;
  };
  promptConfig?: {
    promptPrefix?: string;
    promptSuffix?: string;
  };
}

// Token管理相关类型定义
export interface ApiTokenData {
  id: number;
  token: string;
  project_name: string;
  project_id: string;
  is_active: boolean;
  is_healthy: boolean;
  daily_limit: number;
  daily_used: number;
  total_used: number;
  last_reset_date: Date;
  last_used?: Date;
  last_health_check?: Date;
  error_count: number;
  last_error?: string;
  last_error_time?: Date;
  priority: number;
  weight: number;
  blacklisted_until?: Date;
  blacklist_reason?: string;
  created_at: Date;
  updated_at: Date;
}

export interface TokenLogData {
  id: number;
  token_id: number;
  action: 'use' | 'success' | 'error' | 'health_check';
  result?: 'success' | 'error' | 'timeout' | 'quota_exceeded';
  error_message?: string;
  response_time_ms?: number;
  gemini_usage?: Record<string, any>;
  created_at: Date;
}

export interface TokenHealthConfig {
  id: number;
  check_interval_minutes: number;
  max_error_count: number;
  blacklist_duration_minutes: number;
  health_check_timeout_ms: number;
  daily_reset_hour: number;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface TokenStats {
  total: number;
  active: number;
  healthy: number;
  blacklisted: number;
  over_daily_limit: number;
  tokens: Array<{
    id: number;
    project_name: string;
    project_id: string;
    is_healthy: boolean;
    daily_used: number;
    daily_limit: number;
    error_count: number;
    last_used?: string;
    blacklisted_until?: string;
  }>;
}

// Session API response interfaces (for dashboard UI compatibility)
export interface SessionApiResponse {
  session_id: string;
  user_id: number;
  session_type: 'chat' | 'requirement' | 'mixed';
  status: 'active' | 'completed' | 'expired';
  current_service: string;
  service_transitions: Array<{
    from_service: string;
    to_service: string;
    timestamp: Date;
    trigger: string;
    confidence: number;
  }>;
  message_count: number;
  created_at: Date;
  last_activity: Date;
}

export interface SessionsListResponse {
  success: boolean;
  data: SessionApiResponse[];
  total?: number;
}

// Token Management API Response Types
export interface TokenListResponse {
  success: boolean;
  data: Array<{
    id: number;
    project_name: string;
    project_id: string;
    is_active: boolean;
    is_healthy: boolean;
    daily_limit: number;
    daily_used: number;
    error_count: number;
    priority: number;
    weight: number;
    last_used?: string;
    last_health_check?: string;
    blacklisted_until?: string;
    blacklist_reason?: string;
    created_at: string;
  }>;
  total: number;
}

export interface TokenStatsResponse {
  success: boolean;
  data: {
    total: number;
    active: number;
    healthy: number;
    blacklisted: number;
    over_daily_limit: number;
    available: number;
    usage_rate: number;
    daily_summary: {
      total_requests: number;
      successful_requests: number;
      failed_requests: number;
      error_rate: number;
    };
  };
}

export interface TokenHealthCheckResponse {
  success: boolean;
  message: string;
  data?: {
    checked_tokens: number;
    healthy_tokens: number;
    unhealthy_tokens: number;
    duration_ms: number;
  };
}

export interface TokenResetResponse {
  success: boolean;
  message: string;
  data?: {
    token_id: number;
    previous_status: string;
    new_status: string;
  };
}

export interface TokenUsageHistoryResponse {
  success: boolean;
  data: {
    logs: Array<{
      id: number;
      token_id: number;
      project_name: string;
      action: string;
      result?: string;
      error_message?: string;
      response_time_ms?: number;
      created_at: string;
    }>;
    total: number;
    limit: number;
    offset: number;
    date_range?: {
      start_date: string;
      end_date: string;
    };
    summary?: {
      total_requests: number;
      successful_requests: number;
      failed_requests: number;
      average_response_time: number;
    };
  };
}

// Group Chat Management Types
export interface GroupChatSettings {
  id?: number;
  group_id: number;
  group_name?: string;
  is_enabled: boolean;
  auto_reply_enabled: boolean;
  receive_events: boolean;
  welcome_message?: string;
  admin_user_id?: number;
  agent_prompt_id?: string | null;
  created_at: Date;
  updated_at: Date;
  last_activity?: Date;
}

// Private chat settings interface (similar to group but without receive_events)
export interface PrivateChatSettings {
  id?: number;
  user_id: number;
  username?: string;
  is_enabled: boolean;
  auto_reply_enabled: boolean;
  welcome_message?: string;
  user_notes?: string;
  agent_prompt_id?: string | null;
  created_at: Date;
  updated_at: Date;
  last_activity?: Date;
}

export interface GroupChatStats {
  id?: number;
  group_id: number;
  date: string; // YYYY-MM-DD format
  message_count: number;
  active_users: number;
  ai_responses: number;
  created_at: Date;
  updated_at: Date;
}

export interface GroupChatActivity {
  id?: number;
  group_id: number;
  user_id: number;
  message_type: 'user_message' | 'ai_response' | 'notice' | 'join' | 'leave';
  content?: string;
  created_at: Date;
}

export interface GroupChatOverview {
  group_id: number;
  group_name?: string;
  is_enabled: boolean;
  auto_reply_enabled: boolean;
  last_activity?: Date;
  created_at: Date;
  total_messages: number;
  total_ai_responses: number;
  avg_active_users: number;
  days_since_last_activity?: number;
}

// Group Chat API Response Types
export interface GroupListResponse {
  success: boolean;
  data: Array<{
    group_id: number;
    group_name?: string;
    is_enabled: boolean;
    auto_reply_enabled: boolean;
    member_count?: number;
    last_activity?: string;
    total_messages: number;
    total_ai_responses: number;
    created_at: string;
  }>;
  total: number;
}

export interface GroupDetailResponse {
  success: boolean;
  data: {
    group_id: number;
    group_name?: string;
    is_enabled: boolean;
    auto_reply_enabled: boolean;
    welcome_message?: string;
    admin_user_id?: number;
    last_activity?: string;
    created_at: string;
    updated_at: string;
    stats: {
      total_messages: number;
      total_ai_responses: number;
      avg_active_users: number;
      recent_activity: Array<{
        date: string;
        message_count: number;
        ai_responses: number;
        active_users: number;
      }>;
    };
  };
}

export interface GroupStatsResponse {
  success: boolean;
  data: {
    total_groups: number;
    enabled_groups: number;
    disabled_groups: number;
    total_messages_today: number;
    total_ai_responses_today: number;
    most_active_groups: Array<{
      group_id: number;
      group_name?: string;
      message_count: number;
      ai_responses: number;
    }>;
  };
}

export interface GroupBulkOperationRequest {
  group_ids: number[];
  action: 'enable' | 'disable' | 'delete';
  settings?: Partial<GroupChatSettings>;
}

export interface GroupBulkOperationResponse {
  success: boolean;
  data: {
    processed: number;
    successful: number;
    failed: number;
    results: Array<{
      group_id: number;
      success: boolean;
      message?: string;
    }>;
  };
  message: string;
}

// Conversation API Types
export interface ConversationQueryParams {
  // 现有参数 (向后兼容)
  user_id?: number;          // 用户ID筛选
  limit?: number;            // 每页记录数，默认50，最大1000

  // 新增参数
  page?: number;             // 页码，从1开始，默认1
  start_date?: string;       // 开始日期，格式: YYYY-MM-DD
  end_date?: string;         // 结束日期，格式: YYYY-MM-DD
  search?: string;           // 搜索关键词（匹配用户消息或AI回复）
  model_name?: string;       // 模型筛选
  sort_order?: 'desc' | 'asc'; // 时间排序，默认desc（最新在前）
  include_raw?: boolean;     // 是否包含原始请求/响应数据，默认false
}

export interface ConversationPagination {
  current_page: number;
  total_pages: number;
  per_page: number;
  total_count: number;
  has_next: boolean;
  has_previous: boolean;
}

export interface ConversationFilters {
  user_id?: number;
  date_range?: {
    start_date: string;
    end_date: string;
  };
  search?: string;
  model_name?: string;
  sort_order?: 'desc' | 'asc';
}

export interface ConversationListResponse {
  success: boolean;
  data: {
    conversations: ConversationData[];
    pagination: ConversationPagination;
    filters?: ConversationFilters;
  };
  message?: string;
}

export interface ConversationErrorResponse {
  success: false;
  error: string;
  message: string;
  code?: string;
}

export interface ConversationSearchResult extends ConversationData {
  match_score?: number;      // 搜索匹配度评分
  match_field?: 'user_message' | 'ai_response' | 'both'; // 匹配字段
}

// =============================================================================
// MVP Core Tables Type Definitions
// =============================================================================

// 1. 对话窗口管理相关类型
export interface ConversationWindow {
  id?: number;
  user_id: number;
  window_name: string;
  window_size: number;
  window_type: 'fixed' | 'sliding' | 'semantic';
  context_retention_strategy: 'simple' | 'summary' | 'keyword';
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface WindowMessage {
  id?: number;
  window_id: number;
  conversation_id: string;
  user_id: number;
  sequence_number: number;
  message_role: 'user' | 'assistant' | 'system';
  message_content: string;
  token_count: number;
  importance_score: number;
  is_pinned: boolean;
  created_at: Date;
}

export interface WindowManagementParams {
  window_id: number;
  conversation_id: string;
  user_id: number;
  message_role: 'user' | 'assistant' | 'system';
  message_content: string;
  token_count?: number;
}

// 2. 用户画像系统相关类型
export interface UserProfile {
  id?: number;
  user_id: number;
  nickname?: string;
  preferred_language: string;
  interaction_style: 'formal' | 'casual' | 'technical' | 'friendly';
  response_length_preference: 'brief' | 'detailed' | 'adaptive';
  topic_preferences?: Record<string, number>;
  communication_patterns?: Record<string, any>;
  skill_level: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  last_interaction?: Date;
  interaction_count: number;
  created_at: Date;
  updated_at: Date;
}

export interface UserContext {
  id?: number;
  user_id: number;
  context_key: string;
  context_value: string;
  context_type: 'preference' | 'memory' | 'state' | 'history';
  priority: number;
  expires_at?: Date;
  is_persistent: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface UserProfileSummary {
  user_id: number;
  nickname?: string;
  interaction_style: 'formal' | 'casual' | 'technical' | 'friendly';
  skill_level: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  interaction_count: number;
  last_interaction?: Date;
  context_count: number;
  window_count: number;
  avg_message_importance?: number;
}

// 3. Prompt热加载管理相关类型
export interface PromptTemplate {
  id: string;
  template_name: string;
  category: 'system' | 'conversation' | 'analysis' | 'generation' | 'custom';
  template_content: string;
  variables?: Record<string, any>;
  usage_instructions?: string;
  version: string;
  is_active: boolean;
  is_default: boolean;
  author: string;
  tags?: string;
  created_at: Date;
  updated_at: Date;
}

export interface PromptConfig {
  id?: number;
  config_name: string;
  prompt_template_id: string;
  user_id?: number;
  group_id?: number;
  config_scope: 'global' | 'user' | 'group' | 'session';
  config_parameters: Record<string, any>;
  priority: number;
  is_enabled: boolean;
  effective_from?: Date;
  effective_until?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface PromptUsageStats {
  template_id: string;
  template_name: string;
  category: string;
  usage_count: number;
  unique_users: number;
  avg_processing_time?: number;
  last_used?: Date;
}

export interface PromptRenderContext {
  user_profile?: UserProfile;
  user_context?: UserContext[];
  conversation_history?: WindowMessage[];
  custom_variables?: Record<string, any>;
}

// 4. 调试和追踪相关类型
export interface MessageChain {
  id?: number;
  chain_id: string;
  user_id: number;
  session_id?: string;
  message_id: string;
  parent_message_id?: string;
  chain_depth: number;
  chain_position: number;
  processing_steps?: Record<string, any>;
  timing_info?: Record<string, any>;
  context_used?: Record<string, any>;
  prompt_template_used?: string;
  model_params?: Record<string, any>;
  created_at: Date;
}

export interface DebugLog {
  id?: number;
  trace_id: string;
  debug_level: 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  component: string;
  operation: string;
  debug_data?: Record<string, any>;
  execution_time_ms?: number;
  memory_usage_mb?: number;
  error_details?: string;
  stack_trace?: string;
  created_at: Date;
}

export interface ProcessingContext {
  trace_id: string;
  chain_id: string;
  user_profile?: UserProfile;
  active_window?: ConversationWindow;
  applied_prompts: PromptConfig[];
  debug_info: DebugLog[];
}

// 5. API响应类型扩展
export interface WindowManagementResponse {
  success: boolean;
  data?: {
    window: ConversationWindow;
    message_count: number;
    messages?: WindowMessage[];
  };
  message?: string;
  error?: string;
}

export interface UserProfileResponse {
  success: boolean;
  data?: {
    profile: UserProfile;
    context: UserContext[];
    active_windows: ConversationWindow[];
    summary: UserProfileSummary;
  };
  message?: string;
  error?: string;
}

export interface PromptManagementResponse {
  success: boolean;
  data?: {
    templates: PromptTemplate[];
    configs: PromptConfig[];
    usage_stats: PromptUsageStats[];
  };
  total?: number;
  message?: string;
  error?: string;
}

export interface DebugTraceResponse {
  success: boolean;
  data?: {
    message_chains: MessageChain[];
    debug_logs: DebugLog[];
    processing_summary: {
      total_chains: number;
      avg_processing_time: number;
      error_rate: number;
    };
  };
  message?: string;
  error?: string;
}

// 6. 数据库操作参数类型
export interface WindowQueryParams {
  user_id?: number;
  window_type?: 'fixed' | 'sliding' | 'semantic';
  is_active?: boolean;
  limit?: number;
}

export interface ContextQueryParams {
  user_id: number;
  context_type?: 'preference' | 'memory' | 'state' | 'history';
  include_expired?: boolean;
  priority_min?: number;
}

export interface PromptQueryParams {
  category?: 'system' | 'conversation' | 'analysis' | 'generation' | 'custom';
  is_active?: boolean;
  config_scope?: 'global' | 'user' | 'group' | 'session';
  user_id?: number;
  group_id?: number;
}

export interface TraceQueryParams {
  user_id?: number;
  chain_id?: string;
  session_id?: string;
  date_range?: {
    start_date: string;
    end_date: string;
  };
  debug_level?: 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  component?: string;
}

// 7. 业务逻辑辅助类型
export interface ConversationContextBuilder {
  user_profile: UserProfile;
  active_window: ConversationWindow;
  recent_messages: WindowMessage[];
  user_context: UserContext[];
  prompt_template: PromptTemplate;
  build(): string;
}

export interface PromptRenderer {
  template: PromptTemplate;
  context: PromptRenderContext;
  render(): string;
  validate(): boolean;
}

export interface WindowManager {
  getActiveWindow(user_id: number, window_name?: string): Promise<ConversationWindow | null>;
  addMessage(params: WindowManagementParams): Promise<boolean>;
  getWindowMessages(window_id: number, limit?: number): Promise<WindowMessage[]>;
  updateWindowConfig(window_id: number, updates: Partial<ConversationWindow>): Promise<boolean>;
}

export interface ProfileManager {
  getProfile(user_id: number): Promise<UserProfile | null>;
  updateProfile(user_id: number, updates: Partial<UserProfile>): Promise<boolean>;
  getContext(params: ContextQueryParams): Promise<UserContext[]>;
  setContext(user_id: number, key: string, value: string, options?: Partial<UserContext>): Promise<boolean>;
  cleanupExpiredContext(): Promise<number>;
}

export interface PromptManager {
  getTemplate(template_id: string): Promise<PromptTemplate | null>;
  getActiveConfigs(params: PromptQueryParams): Promise<PromptConfig[]>;
  renderPrompt(template_id: string, context: PromptRenderContext): Promise<string>;
  createTemplate(template: PromptTemplate): Promise<boolean>;
  updateConfig(config_id: number, updates: Partial<PromptConfig>): Promise<boolean>;
}

export interface DebugTracer {
  startTrace(trace_id: string, user_id: number): ProcessingContext;
  addStep(context: ProcessingContext, step: string, data?: any): void;
  recordTiming(context: ProcessingContext, operation: string, duration_ms: number): void;
  logError(context: ProcessingContext, error: Error, component: string): void;
  finishTrace(context: ProcessingContext): Promise<boolean>;
}

// =============================================================================
// Stage 1 Engine Type Definitions
// =============================================================================

// DecisionEngine types
export interface DecisionResult {
  shouldRespond: boolean;
  confidence: number;
  reason: string;
  suggestedService: 'chat' | 'requirement' | 'ignore';
  metadata?: {
    isDirectMention?: boolean;
    containsQuestionWords?: boolean;
    isFromAuthorizedUser?: boolean;
    hasKeywords?: boolean;
    contextualScore?: number;
  };
}

// ContextManager types - unified MessageContext interface
export interface MessageContext {
  currentMessage: QQMessage;
  historyMessages: ConversationData[];
  contextSummary: string;
  userInfo?: {
    user_id: number;
    nickname: string;
    message_count: number;
  };
  groupInfo?: {
    group_id: number;
    message_count: number;
  };
}

export interface UserInfo {
  user_id: number;
  nickname: string;
  recent_interaction_count: number;
  last_interaction?: Date;
  is_frequent_user: boolean;
}

export interface GroupInfo {
  group_id: number;
  recent_activity_level: 'low' | 'medium' | 'high';
  participant_count: number;
  current_topic_hint?: string;
}

// 🔥 新增：可配置LLM参数系统 - 支持所有Gemini高级功能

// 基础生成配置参数
export interface GenerationConfig {
  // 温度控制：0.0-2.0，控制创造性和随机性
  temperature?: number;
  // Top-P核采样：0.0-1.0，控制词汇选择的多样性
  topP?: number;
  // Top-K采样：正整数，限制每步的候选词汇数量
  topK?: number;
  // 最大输出令牌数：控制响应长度
  maxOutputTokens?: number;
  // 停止序列：遇到这些序列时停止生成
  stopSequences?: string[];
  // 响应MIME类型 - 更宽松的类型定义
  responseMimeType?: string;
  // 响应JSON模式 (用于结构化输出)
  responseSchema?: any;
}

// 思考模式配置
export interface ThinkingConfig {
  // 思考预算：-1为动态，0为禁用，正数为具体令牌数
  thinkingBudget?: number;
  // 是否包含思考摘要
  includeThoughts?: boolean;
}

// 安全设置配置 - 更宽松的类型定义
export interface SafetyConfig {
  category: string;
  threshold: string;
}

// 函数调用模式
export type FunctionCallingMode = 'AUTO' | 'ANY' | 'NONE';

// 函数参数定义
export interface FunctionParameter {
  type: 'string' | 'integer' | 'number' | 'boolean' | 'array' | 'object';
  description?: string;
  enum?: string[];
  format?: string;
  nullable?: boolean;
  properties?: Record<string, FunctionParameter>;
  required?: string[];
  minItems?: number;
  maxItems?: number;
}

// 函数声明
export interface FunctionDeclaration {
  name: string;
  description: string;
  parameters: FunctionParameter;
}

// 函数调用配置
export interface FunctionCallingConfig {
  mode: FunctionCallingMode;
  allowedFunctionNames?: string[];
}

// 工具配置 (包含函数调用)
export interface ToolConfig {
  functionCallingConfig?: FunctionCallingConfig;
}

// Google搜索配置
export interface GoogleSearchConfig {
  // 启用Google搜索
  enabled: boolean;
  // 动态阈值 (仅适用于Gemini 1.5模型) - 支持数字和布尔值
  dynamicThreshold?: number | boolean;
}

// URL上下文配置
export interface UrlContextConfig {
  // 启用URL上下文处理
  enabled: boolean;
  // 最大URL数量 (限制20个)
  maxUrls?: number;
  // 支持的内容类型
  supportedContentTypes?: string[];
}

// 结构化输出配置
export interface StructuredOutputConfig {
  // 启用结构化输出
  enabled: boolean;
  // JSON模式
  jsonSchema?: any;
  // 枚举值选择
  enumValues?: string[];
  // 属性排序
  propertyOrdering?: string[];
}

// 完整的LLM调用配置
export interface LLMCallConfig {
  // 模型名称
  modelName: string;
  // 系统指令
  systemInstruction?: string;
  // 基础生成配置
  generationConfig?: GenerationConfig;
  // 思考模式配置
  thinkingConfig?: ThinkingConfig;
  // 安全设置
  safetySettings?: SafetyConfig[];
  // 函数/工具配置
  tools?: FunctionDeclaration[];
  toolConfig?: ToolConfig;
  toolsConfig?: {
    functionCallingConfig?: FunctionCallingConfig;
  };
  // Google搜索配置
  googleSearch?: GoogleSearchConfig;
  googleSearchConfig?: GoogleSearchConfig;
  // URL上下文配置
  urlContext?: UrlContextConfig;
  urlContextConfig?: UrlContextConfig;
  // 结构化输出配置
  structuredOutput?: StructuredOutputConfig;
  structuredOutputConfig?: StructuredOutputConfig;
  // 允许使用的Token ID列表
  allowedTokenIds?: number[];
  // 上下文窗口大小
  contextWindow?: number;
  // 上下文变量
  contextVariables?: Record<string, string>;
  // 自定义提示词前缀和后缀
  promptPrefix?: string;
  promptSuffix?: string;
}

// LLM调用响应
export interface LLMCallResponse {
  // 响应内容
  content: string;
  // 原始响应对象
  rawResponse?: any;
  // 使用的配置
  usedConfig: LLMCallConfig;
  // 思考过程 (如果启用)
  thoughts?: string;
  // 函数调用结果 (如果有)
  functionCalls?: Array<{
    name: string;
    args: any;
    result?: any;
  }>;
  // 搜索查询和结果 (如果启用Google搜索)
  searchQueries?: string[];
  groundingChunks?: Array<{
    title: string;
    uri: string;
  }>;
  // 性能指标
  metrics: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    processingTimeMs: number;
    apiCallTimeMs: number;
  };
  // 错误信息 (如果有)
  error?: {
    message: string;
    code?: string;
    details?: any;
  };
}

// Agent提示词配置 (扩展现有的AgentPromptData)
export interface EnhancedAgentPromptData extends Omit<AgentPromptData, 'model_config'> {
  // 使用新的LLM调用配置替代简单的model_config
  llmConfig?: LLMCallConfig;
  // 允许使用的Token ID列表
  allowedTokenIds?: number[];
}

// 可配置的LLM服务接口
export interface ConfigurableLLMService {
  // 使用配置调用LLM
  callWithConfig(
    prompt: string,
    config: LLMCallConfig,
    traceId?: string,
    userId?: number
  ): Promise<LLMCallResponse>;

  // 验证配置有效性
  validateConfig(config: LLMCallConfig): Promise<{
    valid: boolean;
    errors: string[];
  }>;

  // 获取模型支持的功能
  getModelCapabilities(modelName: string): Promise<{
    supportsFunctionCalling: boolean;
    supportsThinking: boolean;
    supportsGoogleSearch: boolean;
    supportsUrlContext: boolean;
    supportsStructuredOutput: boolean;
    maxInputTokens: number;
    maxOutputTokens: number;
  }>;
}

// 配置预设模板
export interface LLMConfigTemplate {
  id: string;
  name: string;
  description: string;
  config: LLMCallConfig;
  category: 'chat' | 'analysis' | 'code' | 'creative' | 'reasoning' | 'search';
  createdAt: Date;
  updatedAt: Date;
}

// Re-export from llm-config-unified for convenience
export type {
  UnifiedLLMConfig,
  LLMConfigCategory,
  ModelConfig,
  UnifiedToolConfig,
  ContextConfig,
  PerformanceConfig,
  ConfigVersion
} from './llm-config-unified';

// ============================================================================
// 🧠 人类化消息处理系统类型定义
// ============================================================================

/**
 * 队列中的消息项
 */
export interface QueuedMessage {
  id: string;
  message: QQMessage;
  eventData?: any;
  arrivalTime: Date;
  sourceKey: string;
  traceId: string;
  status: 'queued' | 'aggregated' | 'consumed';
  metadata?: {
    isAggregated?: boolean;
    totalBatchSize?: number;
    messageIndexInBatch?: number;
  };
}

/**
 * 聚合窗口定义
 */
export interface AggregationWindow {
  sourceKey: string;
  messages: QueuedMessage[];
  firstMessageTime: Date;
  status: 'aggregating' | 'ready_for_consumption' | 'consumed';
  windowTimer: ReturnType<typeof setTimeout> | null;
  windowId?: string;
}

/**
 * 消息聚合管理器配置
 */
// ============================================================================
// 🛠️ LLM 工具编排系统类型定义
// ============================================================================

/**
 * LLM 任务状态
 */
export type LLMJobStatus =
  | 'pending'        // 等待处理
  | 'calling'        // 正在调用LLM
  | 'awaiting_tool'  // 等待工具执行
  | 'completed'      // 已完成
  | 'failed';        // 失败

/**
 * LLM 任务
 */
export interface LLMJob {
  id: string; // UUID
  trace_id: string;
  source_key: string; // user_xxx / group_xxx
  source_type: 'private' | 'group';

  // 状态管理
  status: LLMJobStatus;
  retry_count: number;
  max_retries: number;
  next_retry_at?: Date;

  // 请求数据
  contents_json: any[]; // Gemini contents 数组
  tools_json?: any[]; // 工具声明数组
  config_json?: any; // LLM 配置参数

  // 执行状态
  pending_tool?: string; // 当前等待的工具名
  current_turn: number;
  max_turns: number;

  // 结果与错误
  final_response?: string;
  error_message?: string;

  // 元数据
  metadata?: Record<string, any>;
  created_at: Date;
  updated_at: Date;
  completed_at?: Date;
}

/**
 * 工具执行模式
 */
export type ToolExecutionMode = 'returnable' | 'fire-and-forget';

/**
 * 工具类型
 */
export type ToolType = 'static' | 'dynamic';

/**
 * 动态工具定义
 */
export interface LLMTool {
  id: number;
  method_id: string; // 唯一标识符
  name: string;
  description: string;

  // 参数定义
  params_schema: any; // JSON Schema

  // 分类与标签
  category?: string; // system/user/external
  tags?: string[]; // 标签数组

  // 执行配置
  side_effect: boolean;
  expect_response: boolean;
  timeout_ms: number;

  // 权限与状态
  enabled: boolean;
  required_permission?: string;

  // 版本与审计
  version: string;
  created_by?: string;
  updated_by?: string;

  // 执行统计
  total_calls: number;
  success_calls: number;
  failed_calls: number;
  avg_duration_ms?: number;

  created_at: Date;
  updated_at: Date;
}

/**
 * 工具执行上下文
 */
export interface ToolContext {
  trace_id: string;
  job_id?: string;
  user_id?: number;
  group_id?: number;
  source_key: string;
  arguments: any;
  metadata?: Record<string, any>;
}

/**
 * 工具执行结果
 */
export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
  duration_ms?: number;
  side_effects?: string[]; // 副作用描述
}

/**
 * 静态工具定义
 */
export interface StaticTool {
  name: string;
  description: string;
  parameters: any; // JSON Schema
  mode: ToolExecutionMode;
  handler: (ctx: ToolContext) => Promise<ToolResult>;
}

/**
 * 工具执行日志
 */
export interface ToolExecutionLog {
  id: number;

  // 关联
  trace_id: string;
  job_id?: string;
  tool_type: ToolType;
  tool_name: string;
  method_id?: string;

  // 执行信息
  arguments: any;
  result?: any;

  // 状态与性能
  status: 'success' | 'failed' | 'timeout';
  error_message?: string;
  duration_ms?: number;

  // 执行模式
  execution_mode: ToolExecutionMode;
  side_effect: boolean;

  // 时间戳
  started_at: Date;
  completed_at?: Date;
}

/**
 * 工具搜索参数
 */
export interface ToolSearchParams {
  query: string;
  tags?: string[];
  side_effect?: boolean;
  max_results?: number;
  category?: string;
}

/**
 * 工具搜索结果
 */
export interface ToolSearchResult {
  tools: Array<{
    method_id: string;
    name: string;
    description: string;
    params_schema: any;
    side_effect: boolean;
    expect_response: boolean;
  }>;
  total: number;
}

/**
 * Gemini 函数调用
 */
export interface GeminiFunctionCall {
  name: string;
  args: any;
}

/**
 * Gemini 函数响应
 */
export interface GeminiFunctionResponse {
  name: string;
  response: {
    name: string;
    content: any;
  };
}

/**
 * 批处理触发类型
 */
export type TriggerType = 'direct' | 'scheduled' | 'manual';

/**
 * 批处理Handler接口
 */
export interface BatchHandler {
  handlePrivateMessageBatch(
    sourceKey: string,
    messages: DrainedMessage[],
    triggerType: TriggerType
  ): Promise<void>;

  handleGroupMessageBatch(
    sourceKey: string,
    messages: DrainedMessage[],
    triggerType: TriggerType
  ): Promise<void>;
}

/**
 * 已消费的消息
 */
export interface DrainedMessage {
  id: string;
  message: QQMessage;
  eventData?: any;
  arrivalTime: Date;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  traceId: string;
}
