ALTER TABLE http_traffic_logs
  MODIFY COLUMN trace_id VARCHAR(64) NULL COMMENT '追踪ID，关联现有系统的对话链路';
