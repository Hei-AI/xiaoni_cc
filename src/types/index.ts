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
  user_id: number;
  user_message: string;
  ai_response: string;
  timestamp: Date;
  response_time: number;
  model_name: string;
  raw_request?: string;
  raw_response?: string;
  message_id?: number;
  reply_to_message_id?: number;
  reply_to_text?: string;
  session_id?: string;  // Session管理支持
}

export interface RequirementData {
  id: string;
  user_id: number;
  message: string;
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
  agent_type: 'chat_bot' | 'intent_analyzer' | 'requirement_processor' | 'custom';
  prompt_name: string;
  system_instructions: string[];
  user_prompt_template?: string;
  context_variables?: Record<string, string>;
  model_config?: {
    temperature?: number;
    topK?: number;
    topP?: number;
    maxOutputTokens?: number;
  };
  is_active: boolean;
  version: number;
  created_by: string;
  created_at: Date;
  updated_at: Date;
  description?: string;
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