export interface QQMessage {
  message_type: 'private' | 'group';
  sub_type: string;
  message_id: number;
  user_id: number;
  message: string;
  raw_message: string;
  font: number;
  sender: {
    user_id: number;
    nickname: string;
    card?: string;
    role?: 'owner' | 'admin' | 'member';
  };
  group_id?: number;
  time: number;
}

export interface QQNotice {
  notice_type: string;
  sub_type: string;
  group_id?: number;
  user_id?: number;
  operator_id?: number;
  time: number;
}

export interface QQRequest {
  request_type: 'friend' | 'group';
  sub_type: string;
  user_id: number;
  comment: string;
  flag: string;
  time: number;
  group_id?: number;
}

export interface WebSocketEvent {
  post_type: 'message' | 'notice' | 'request' | 'message_sent';
  time: number;
  self_id: number;
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
}

export interface RequirementData {
  id: string;
  user_id: number;
  message: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  created_at: Date;
  updated_at: Date;
  claude_code_output?: string;
  completion_details?: string;
  error_message?: string;
  processing_start_time?: Date;
  processing_end_time?: Date;
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