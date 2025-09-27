-- 为llm_call_logs表添加call_start_time字段来记录LLM调用的实际开始时间
-- 这样可以在时间线中显示准确的LLM调用开始时间点

ALTER TABLE llm_call_logs
ADD COLUMN call_start_time TIMESTAMP NULL COMMENT 'LLM调用开始时间（实际发起API请求的时间）'
AFTER timestamp;

-- 为新字段添加索引，用于时间线查询优化
ALTER TABLE llm_call_logs
ADD INDEX idx_call_start_time (call_start_time);

-- 为现有记录回填call_start_time（设置为timestamp减去api_call_time_ms）
UPDATE llm_call_logs
SET call_start_time = DATE_SUB(timestamp, INTERVAL COALESCE(api_call_time_ms, 0) MICROSECOND * 1000)
WHERE call_start_time IS NULL;