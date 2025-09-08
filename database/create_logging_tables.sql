-- 创建日志系统数据库表结构
-- QQ Bot 日志系统数据库设计

-- WebSocket通信日志表
CREATE TABLE IF NOT EXISTS websocket_logs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  trace_id VARCHAR(36) NOT NULL COMMENT 'TraceID用于关联请求链',
  session_id VARCHAR(255) NOT NULL COMMENT 'WebSocket会话ID',
  direction ENUM('incoming', 'outgoing') NOT NULL COMMENT '消息方向',
  message_type VARCHAR(50) NOT NULL COMMENT '消息类型如message、notice、request等',
  event_priority ENUM('HIGH', 'MEDIUM', 'LOW') DEFAULT 'MEDIUM' COMMENT '事件优先级',
  raw_payload JSON NOT NULL COMMENT '原始消息载荷',
  user_id BIGINT NULL COMMENT '用户QQ号',
  group_id BIGINT NULL COMMENT '群号',
  message_id BIGINT NULL COMMENT '消息ID',
  status ENUM('SUCCESS', 'FAILED', 'PENDING') DEFAULT 'SUCCESS' COMMENT '处理状态',
  processing_time_ms INT DEFAULT 0 COMMENT '处理耗时',
  error_message TEXT NULL COMMENT '错误信息',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  INDEX idx_trace_id (trace_id),
  INDEX idx_session_id (session_id),
  INDEX idx_direction (direction),
  INDEX idx_message_type (message_type),
  INDEX idx_user_id (user_id),
  INDEX idx_group_id (group_id),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='WebSocket通信日志表';

-- LLM调用日志表
CREATE TABLE IF NOT EXISTS llm_call_logs (
  id VARCHAR(36) PRIMARY KEY COMMENT 'UUID主键',
  trace_id VARCHAR(36) NOT NULL COMMENT 'TraceID用于关联请求链',
  user_id BIGINT NULL COMMENT '触发请求的用户ID',
  call_sequence INT DEFAULT 1 COMMENT '同一trace内的调用顺序',
  model_name VARCHAR(100) NOT NULL COMMENT '模型名称如gemini-2.0-flash-exp',
  agent_type VARCHAR(50) NOT NULL COMMENT 'Agent类型如chat_bot、intent_analyzer等',
  prompt_name VARCHAR(100) DEFAULT 'default' COMMENT 'Prompt名称',
  input_prompt TEXT NOT NULL COMMENT '输入的prompt内容',
  system_instructions JSON NULL COMMENT '系统指令内容',
  model_parameters JSON NULL COMMENT '模型参数如temperature、max_tokens等',
  response_text TEXT NOT NULL COMMENT 'LLM返回的文本',
  input_token_count INT DEFAULT 0 COMMENT '输入token数量',
  output_token_count INT DEFAULT 0 COMMENT '输出token数量',
  response_time_ms INT NOT NULL COMMENT '响应时间毫秒',
  success BOOLEAN NOT NULL DEFAULT TRUE COMMENT '调用是否成功',
  error_code VARCHAR(50) NULL COMMENT '错误代码',
  error_message TEXT NULL COMMENT '错误信息',
  retry_count INT DEFAULT 0 COMMENT '重试次数',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  INDEX idx_trace_id (trace_id),
  INDEX idx_user_id (user_id),
  INDEX idx_agent_type (agent_type),
  INDEX idx_model_name (model_name),
  INDEX idx_success (success),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='LLM调用日志表';

-- 会话跟踪表
CREATE TABLE IF NOT EXISTS session_traces (
  id VARCHAR(36) PRIMARY KEY COMMENT 'UUID主键',
  trace_id VARCHAR(36) UNIQUE NOT NULL COMMENT 'TraceID',
  user_id BIGINT NOT NULL COMMENT '用户QQ号',
  session_id VARCHAR(255) NOT NULL COMMENT '会话标识',
  service_type ENUM('chat', 'requirement', 'reply_chain', 'mixed') DEFAULT 'chat' COMMENT '服务类型',
  status ENUM('STARTED', 'PROCESSING', 'COMPLETED', 'ERROR', 'TIMEOUT') DEFAULT 'STARTED' COMMENT '会话状态',
  llm_calls_count INT DEFAULT 0 COMMENT 'LLM调用次数',
  websocket_events_count INT DEFAULT 0 COMMENT 'WebSocket事件数量',
  total_processing_time_ms INT DEFAULT 0 COMMENT '总处理时间',
  business_context JSON NULL COMMENT '业务上下文信息',
  start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '开始时间',
  end_time TIMESTAMP NULL COMMENT '结束时间',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  INDEX idx_trace_id (trace_id),
  INDEX idx_user_id (user_id),
  INDEX idx_status (status),
  INDEX idx_service_type (service_type),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='会话跟踪表';

-- 创建触发器：自动更新session_traces的统计信息
DELIMITER //

-- WebSocket事件触发器
CREATE TRIGGER IF NOT EXISTS websocket_logs_after_insert
AFTER INSERT ON websocket_logs
FOR EACH ROW
BEGIN
  INSERT INTO session_traces (id, trace_id, user_id, session_id, websocket_events_count)
  VALUES (UUID(), NEW.trace_id, NEW.user_id, NEW.session_id, 1)
  ON DUPLICATE KEY UPDATE
    websocket_events_count = websocket_events_count + 1,
    updated_at = CURRENT_TIMESTAMP;
END//

-- LLM调用触发器
CREATE TRIGGER IF NOT EXISTS llm_call_logs_after_insert  
AFTER INSERT ON llm_call_logs
FOR EACH ROW
BEGIN
  INSERT INTO session_traces (id, trace_id, user_id, session_id, llm_calls_count, total_processing_time_ms)
  VALUES (UUID(), NEW.trace_id, IFNULL(NEW.user_id, 0), 'system', 1, NEW.response_time_ms)
  ON DUPLICATE KEY UPDATE
    llm_calls_count = llm_calls_count + 1,
    total_processing_time_ms = total_processing_time_ms + NEW.response_time_ms,
    updated_at = CURRENT_TIMESTAMP;
END//

DELIMITER ;

-- 插入初始数据用于测试
INSERT INTO websocket_logs (trace_id, session_id, direction, message_type, raw_payload, user_id, group_id, message_id) VALUES
('test-trace-001', 'ws-session-001', 'incoming', 'message', '{"type": "message", "content": "test"}', 12345, 67890, 1001),
('test-trace-002', 'ws-session-002', 'outgoing', 'message', '{"type": "message", "content": "response"}', 12345, NULL, 1002);

INSERT INTO llm_call_logs (id, trace_id, user_id, model_name, agent_type, input_prompt, response_text, response_time_ms) VALUES
(UUID(), 'test-trace-001', 12345, 'gemini-2.0-flash-exp', 'chat_bot', 'Hello, how are you?', 'I am doing well, thank you!', 1500),
(UUID(), 'test-trace-002', 12345, 'gemini-2.0-flash-exp', 'intent_analyzer', 'What is the weather?', 'This is a weather inquiry', 800);

-- 显示表结构确认
SHOW TABLES LIKE '%logs%';
SHOW TABLES LIKE '%traces%';

SELECT 'Database tables created successfully' as status;