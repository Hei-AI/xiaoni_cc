// 共享API类型定义
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

// OneBot消息类型
export interface QQMessage {
  message_type: 'private' | 'group';
  user_id: number;
  group_id?: number;
  message: string | MessageSegment[];
  message_id: number;
  time: number;
}

export interface MessageSegment {
  type: string;
  data: any;
}

// 数据库实体类型
export interface Conversation {
  id: number;
  user_id: number;
  message_type: 'private' | 'group';
  group_id?: number;
  user_message: string;
  ai_response: string;
  created_at: Date;
}

export interface Requirement {
  id: number;
  user_id: number;
  original_message: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  created_at: Date;
  processing_start_time?: Date;
  processing_end_time?: Date;
}

// API端点类型
export interface SendMessageRequest {
  user_id: number;
  message: string;
}

export interface SendGroupMessageRequest {
  group_id: number;
  message: string;
}

export interface SystemStatus {
  websocket_connected: boolean;
  database_connected: boolean;
  uptime: number;
  memory_usage: any;
}