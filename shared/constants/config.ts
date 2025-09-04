// 共享配置常量
export const API_ENDPOINTS = {
  SEND_PRIVATE: '/api/send_private',
  SEND_GROUP: '/api/send_group',
  STATUS: '/api/status',
  CONVERSATIONS: '/api/conversations',
  REQUIREMENTS: '/api/requirements',
  HEALTH: '/health'
} as const;

export const MESSAGE_TYPES = {
  PRIVATE: 'private',
  GROUP: 'group'
} as const;

export const REQUIREMENT_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing', 
  COMPLETED: 'completed',
  FAILED: 'failed'
} as const;

export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500
} as const;