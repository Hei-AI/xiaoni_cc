-- 创建时间线事件表，用于记录对话处理过程中的关键时间节点
-- 这样可以在时间线页面显示每个处理阶段的准确开始时间

CREATE TABLE IF NOT EXISTS timeline_events (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '事件ID',

  -- 关联信息
  trace_id VARCHAR(64) NOT NULL COMMENT 'TraceID，关联conversation和其他日志',
  conversation_id VARCHAR(36) NULL COMMENT '对话ID，关联conversations表',

  -- 事件信息
  event_type VARCHAR(50) NOT NULL COMMENT '事件类型：websocket, processing, llm, engine等',
  event_name VARCHAR(100) NOT NULL COMMENT '事件名称：message_received, decision_engine_start等',
  event_phase ENUM('start', 'end', 'instant') DEFAULT 'instant' COMMENT '事件阶段',

  -- 时间信息
  event_time TIMESTAMP(3) NOT NULL COMMENT '事件发生时间（毫秒精度）',
  duration_ms INT NULL COMMENT '事件耗时（毫秒，仅end阶段有值）',

  -- 元数据
  metadata JSON NULL COMMENT '事件相关的元数据信息',

  -- 索引
  INDEX idx_trace_id (trace_id),
  INDEX idx_conversation_id (conversation_id),
  INDEX idx_event_time (event_time),
  INDEX idx_trace_event (trace_id, event_type, event_name),
  INDEX idx_timeline_query (trace_id, event_time),

  -- 时间戳
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '记录创建时间'
) COMMENT='时间线事件表，记录对话处理的关键时间节点';

-- 视图将在数据库层级单独创建，避免字符集冲突