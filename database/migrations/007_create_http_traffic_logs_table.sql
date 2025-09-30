-- Migration: Create HTTP Traffic Logs Tables
-- Description: Create tables for HTTP traffic monitoring module
-- Date: 2024-09-27
-- Author: Claude Code Assistant

-- =============================================================================
-- HTTP流量监控模块 - 数据库表结构
-- 从 modules/http-traffic-monitor/database-schema.sql 迁移而来
-- =============================================================================

-- 创建HTTP流量日志表
CREATE TABLE IF NOT EXISTS http_traffic_logs (
  -- 主键和基础信息
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '日志记录唯一ID',

  -- 关联信息
  trace_id VARCHAR(36) NULL COMMENT '追踪ID，关联现有系统的对话链路',
  container_name VARCHAR(50) DEFAULT 'qqbot-core' COMMENT '发起请求的容器名称',
  service_name VARCHAR(50) NULL COMMENT '服务名称标识',
  request_id VARCHAR(36) NOT NULL COMMENT '单次请求唯一标识',

  -- 请求基础信息
  method VARCHAR(10) NOT NULL COMMENT 'HTTP方法 (GET, POST, PUT, DELETE等)',
  url TEXT NOT NULL COMMENT '完整的请求URL',
  host VARCHAR(255) NOT NULL COMMENT '目标主机域名',
  path TEXT NOT NULL COMMENT 'URL路径部分',
  query_params JSON NULL COMMENT '查询参数JSON格式',

  -- 请求详情
  request_headers JSON NOT NULL COMMENT '请求头信息JSON格式',
  request_body LONGTEXT NULL COMMENT '请求体内容',
  request_content_type VARCHAR(100) NULL COMMENT '请求Content-Type',
  request_size INT UNSIGNED DEFAULT 0 COMMENT '请求大小(字节)',

  -- 响应信息
  response_status INT NULL COMMENT 'HTTP响应状态码',
  response_headers JSON NULL COMMENT '响应头信息JSON格式',
  response_body LONGTEXT NULL COMMENT '响应体内容',
  response_content_type VARCHAR(100) NULL COMMENT '响应Content-Type',
  response_size INT UNSIGNED DEFAULT 0 COMMENT '响应大小(字节)',

  -- 性能指标
  duration_ms INT UNSIGNED NULL COMMENT '请求总耗时(毫秒)',
  dns_lookup_ms INT UNSIGNED NULL COMMENT 'DNS解析耗时(毫秒)',
  tcp_connect_ms INT UNSIGNED NULL COMMENT 'TCP连接耗时(毫秒)',
  tls_handshake_ms INT UNSIGNED NULL COMMENT 'TLS握手耗时(毫秒)',
  server_processing_ms INT UNSIGNED NULL COMMENT '服务器处理耗时(毫秒)',

  -- 时间信息
  request_timestamp DATETIME(3) NOT NULL COMMENT '请求发起时间',
  response_timestamp DATETIME(3) NULL COMMENT '响应接收时间',
  created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) COMMENT '记录创建时间',

  -- 分类和标记
  is_ai_request BOOLEAN DEFAULT FALSE COMMENT '是否为AI API请求',
  api_type VARCHAR(50) NULL COMMENT 'API类型标识 (gemini, openai, claude等)',
  api_version VARCHAR(20) NULL COMMENT 'API版本信息',

  -- 网络和安全信息
  client_ip VARCHAR(45) NULL COMMENT '客户端IP地址',
  user_agent TEXT NULL COMMENT '用户代理字符串',
  referer TEXT NULL COMMENT '来源页面URL',

  -- 错误和调试信息
  error_message TEXT NULL COMMENT '错误信息详情',
  error_code VARCHAR(50) NULL COMMENT '错误代码',
  retry_count INT UNSIGNED DEFAULT 0 COMMENT '重试次数',
  is_cached_response BOOLEAN DEFAULT FALSE COMMENT '是否为缓存响应',

  -- 数据处理标记
  is_truncated BOOLEAN DEFAULT FALSE COMMENT '内容是否被截断',
  is_binary_data BOOLEAN DEFAULT FALSE COMMENT '是否为二进制数据',
  original_encoding VARCHAR(20) NULL COMMENT '原始编码格式',

  -- 业务相关
  conversation_id VARCHAR(36) NULL COMMENT '关联的对话ID',
  user_id VARCHAR(50) NULL COMMENT '发起请求的用户ID',
  session_id VARCHAR(100) NULL COMMENT '会话标识'

) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='HTTP流量监控日志表 - 记录容器出站HTTP请求的完整信息';

-- 创建索引以优化查询性能
ALTER TABLE http_traffic_logs ADD INDEX idx_trace_id (trace_id);
ALTER TABLE http_traffic_logs ADD INDEX idx_request_id (request_id);
ALTER TABLE http_traffic_logs ADD INDEX idx_timestamp (request_timestamp);
ALTER TABLE http_traffic_logs ADD INDEX idx_created_at (created_at);
ALTER TABLE http_traffic_logs ADD INDEX idx_ai_request (is_ai_request);
ALTER TABLE http_traffic_logs ADD INDEX idx_api_type (api_type);
ALTER TABLE http_traffic_logs ADD INDEX idx_host (host);
ALTER TABLE http_traffic_logs ADD INDEX idx_method_status (method, response_status);
ALTER TABLE http_traffic_logs ADD INDEX idx_duration (duration_ms);
ALTER TABLE http_traffic_logs ADD INDEX idx_container_service (container_name, service_name);
ALTER TABLE http_traffic_logs ADD INDEX idx_conversation (conversation_id);
ALTER TABLE http_traffic_logs ADD INDEX idx_user_session (user_id, session_id);

-- 复合索引优化常用查询
ALTER TABLE http_traffic_logs ADD INDEX idx_ai_api_time (is_ai_request, api_type, request_timestamp);
ALTER TABLE http_traffic_logs ADD INDEX idx_host_path_time (host, path(100), request_timestamp);
ALTER TABLE http_traffic_logs ADD INDEX idx_status_error (response_status, error_code);
ALTER TABLE http_traffic_logs ADD INDEX idx_trace_conversation (trace_id, conversation_id);

-- 全文搜索索引
ALTER TABLE http_traffic_logs ADD FULLTEXT INDEX idx_url_search (url);
ALTER TABLE http_traffic_logs ADD FULLTEXT INDEX idx_body_search (request_body, response_body);
ALTER TABLE http_traffic_logs ADD FULLTEXT INDEX idx_error_search (error_message);

-- =============================================================================
-- 创建HTTP流量统计表（用于快速查询统计信息）
-- =============================================================================

CREATE TABLE IF NOT EXISTS http_traffic_stats (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  stat_date DATE NOT NULL COMMENT '统计日期',
  hour INT NOT NULL COMMENT '小时 (0-23)',

  -- 基础统计
  total_requests INT UNSIGNED DEFAULT 0 COMMENT '总请求数',
  successful_requests INT UNSIGNED DEFAULT 0 COMMENT '成功请求数 (2xx)',
  failed_requests INT UNSIGNED DEFAULT 0 COMMENT '失败请求数 (4xx, 5xx)',

  -- AI API统计
  ai_requests INT UNSIGNED DEFAULT 0 COMMENT 'AI API请求数',
  gemini_requests INT UNSIGNED DEFAULT 0 COMMENT 'Gemini API请求数',
  openai_requests INT UNSIGNED DEFAULT 0 COMMENT 'OpenAI API请求数',

  -- 性能统计
  avg_duration_ms DECIMAL(10,2) DEFAULT 0 COMMENT '平均响应时间(毫秒)',
  min_duration_ms INT UNSIGNED DEFAULT 0 COMMENT '最小响应时间(毫秒)',
  max_duration_ms INT UNSIGNED DEFAULT 0 COMMENT '最大响应时间(毫秒)',

  -- 流量统计
  total_request_bytes BIGINT UNSIGNED DEFAULT 0 COMMENT '总请求字节数',
  total_response_bytes BIGINT UNSIGNED DEFAULT 0 COMMENT '总响应字节数',

  -- 错误统计
  error_4xx_count INT UNSIGNED DEFAULT 0 COMMENT '4xx错误数量',
  error_5xx_count INT UNSIGNED DEFAULT 0 COMMENT '5xx错误数量',
  timeout_count INT UNSIGNED DEFAULT 0 COMMENT '超时错误数量',

  created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  UNIQUE KEY idx_date_hour (stat_date, hour),
  INDEX idx_date (stat_date),
  INDEX idx_ai_stats (ai_requests, gemini_requests, openai_requests)

) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='HTTP流量统计表 - 按小时汇总的统计数据';

-- =============================================================================
-- 创建API端点统计表
-- =============================================================================

CREATE TABLE IF NOT EXISTS api_endpoint_stats (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  host VARCHAR(255) NOT NULL COMMENT '主机域名',
  path_pattern VARCHAR(500) NOT NULL COMMENT '路径模式',
  method VARCHAR(10) NOT NULL COMMENT 'HTTP方法',

  -- 调用统计
  total_calls INT UNSIGNED DEFAULT 0 COMMENT '总调用次数',
  successful_calls INT UNSIGNED DEFAULT 0 COMMENT '成功调用次数',
  failed_calls INT UNSIGNED DEFAULT 0 COMMENT '失败调用次数',

  -- 性能统计
  avg_duration_ms DECIMAL(10,2) DEFAULT 0 COMMENT '平均响应时间',
  p95_duration_ms INT UNSIGNED DEFAULT 0 COMMENT '95%分位响应时间',
  p99_duration_ms INT UNSIGNED DEFAULT 0 COMMENT '99%分位响应时间',

  -- 数据量统计
  avg_request_size DECIMAL(10,2) DEFAULT 0 COMMENT '平均请求大小',
  avg_response_size DECIMAL(10,2) DEFAULT 0 COMMENT '平均响应大小',

  -- 时间信息
  first_seen DATETIME(3) NOT NULL COMMENT '首次调用时间',
  last_seen DATETIME(3) NOT NULL COMMENT '最后调用时间',
  updated_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  UNIQUE KEY idx_endpoint (host, path_pattern, method),
  INDEX idx_host (host),
  INDEX idx_calls (total_calls),
  INDEX idx_performance (avg_duration_ms, p95_duration_ms),
  INDEX idx_last_seen (last_seen)

) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='API端点统计表 - 各API端点的调用统计信息';

-- =============================================================================
-- 插入示例配置数据
-- =============================================================================

INSERT IGNORE INTO api_endpoint_stats (host, path_pattern, method, total_calls, first_seen, last_seen) VALUES
('generativelanguage.googleapis.com', '/v1beta/models/*/generateContent', 'POST', 0, NOW(), NOW()),
('api.openai.com', '/v1/chat/completions', 'POST', 0, NOW(), NOW()),
('api.anthropic.com', '/v1/messages', 'POST', 0, NOW(), NOW());

-- =============================================================================
-- 创建视图简化常用查询
-- =============================================================================

-- 创建最近流量视图
CREATE OR REPLACE VIEW v_recent_traffic AS
SELECT
  id,
  trace_id,
  request_id,
  method,
  host,
  path,
  response_status,
  duration_ms,
  is_ai_request,
  api_type,
  request_timestamp,
  CASE
    WHEN response_status BETWEEN 200 AND 299 THEN 'success'
    WHEN response_status BETWEEN 400 AND 499 THEN 'client_error'
    WHEN response_status BETWEEN 500 AND 599 THEN 'server_error'
    WHEN response_status IS NULL THEN 'timeout'
    ELSE 'unknown'
  END as status_category,
  CASE
    WHEN duration_ms < 1000 THEN 'fast'
    WHEN duration_ms < 5000 THEN 'normal'
    WHEN duration_ms < 10000 THEN 'slow'
    ELSE 'very_slow'
  END as performance_category
FROM http_traffic_logs
WHERE request_timestamp >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
ORDER BY request_timestamp DESC;

-- 创建AI API调用统计视图
CREATE OR REPLACE VIEW v_ai_api_stats AS
SELECT
  api_type,
  DATE(request_timestamp) as call_date,
  COUNT(*) as total_calls,
  COUNT(CASE WHEN response_status BETWEEN 200 AND 299 THEN 1 END) as successful_calls,
  COUNT(CASE WHEN response_status >= 400 THEN 1 END) as error_calls,
  AVG(duration_ms) as avg_duration,
  MIN(duration_ms) as min_duration,
  MAX(duration_ms) as max_duration,
  SUM(request_size) as total_request_bytes,
  SUM(response_size) as total_response_bytes
FROM http_traffic_logs
WHERE is_ai_request = TRUE
  AND request_timestamp >= DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY api_type, DATE(request_timestamp)
ORDER BY call_date DESC, api_type;

-- =============================================================================
-- 创建存储过程用于数据维护
-- =============================================================================

-- 定期清理历史数据的存储过程
DELIMITER $$

CREATE PROCEDURE CleanupHttpTrafficLogs()
BEGIN
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;

  START TRANSACTION;

  -- 删除90天前的详细日志（保留AI请求）
  DELETE FROM http_traffic_logs
  WHERE request_timestamp < DATE_SUB(NOW(), INTERVAL 90 DAY)
    AND is_ai_request = FALSE;

  -- 删除180天前的所有日志
  DELETE FROM http_traffic_logs
  WHERE request_timestamp < DATE_SUB(NOW(), INTERVAL 180 DAY);

  -- 删除90天前的小时统计数据
  DELETE FROM http_traffic_stats
  WHERE stat_date < DATE_SUB(NOW(), INTERVAL 90 DAY);

  COMMIT;

  -- 优化表
  OPTIMIZE TABLE http_traffic_logs;
  OPTIMIZE TABLE http_traffic_stats;

END$$

DELIMITER ;

-- 自动统计数据聚合的存储过程
DELIMITER $$

CREATE PROCEDURE AggregateTrafficStats(IN target_date DATE, IN target_hour INT)
BEGIN
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;

  START TRANSACTION;

  -- 删除现有统计数据
  DELETE FROM http_traffic_stats
  WHERE stat_date = target_date AND hour = target_hour;

  -- 插入新的统计数据
  INSERT INTO http_traffic_stats (
    stat_date, hour, total_requests, successful_requests, failed_requests,
    ai_requests, gemini_requests, openai_requests,
    avg_duration_ms, min_duration_ms, max_duration_ms,
    total_request_bytes, total_response_bytes,
    error_4xx_count, error_5xx_count, timeout_count
  )
  SELECT
    target_date,
    target_hour,
    COUNT(*) as total_requests,
    COUNT(CASE WHEN response_status BETWEEN 200 AND 299 THEN 1 END) as successful_requests,
    COUNT(CASE WHEN response_status >= 400 THEN 1 END) as failed_requests,
    COUNT(CASE WHEN is_ai_request = TRUE THEN 1 END) as ai_requests,
    COUNT(CASE WHEN api_type = 'gemini' THEN 1 END) as gemini_requests,
    COUNT(CASE WHEN api_type = 'openai' THEN 1 END) as openai_requests,
    AVG(duration_ms) as avg_duration_ms,
    MIN(duration_ms) as min_duration_ms,
    MAX(duration_ms) as max_duration_ms,
    SUM(request_size) as total_request_bytes,
    SUM(response_size) as total_response_bytes,
    COUNT(CASE WHEN response_status BETWEEN 400 AND 499 THEN 1 END) as error_4xx_count,
    COUNT(CASE WHEN response_status BETWEEN 500 AND 599 THEN 1 END) as error_5xx_count,
    COUNT(CASE WHEN response_status IS NULL THEN 1 END) as timeout_count
  FROM http_traffic_logs
  WHERE DATE(request_timestamp) = target_date
    AND HOUR(request_timestamp) = target_hour;

  COMMIT;
END$$

DELIMITER ;

-- =============================================================================
-- 验证表创建
-- =============================================================================

-- 显示创建的表结构信息
SELECT 'http_traffic_logs table created successfully' as status;
SHOW CREATE TABLE http_traffic_logs;

SELECT 'http_traffic_stats table created successfully' as status;
SHOW CREATE TABLE http_traffic_stats;

SELECT 'api_endpoint_stats table created successfully' as status;
SHOW CREATE TABLE api_endpoint_stats;

-- 验证索引创建
SELECT 'Checking indexes for http_traffic_logs' as status;
SHOW INDEX FROM http_traffic_logs;

-- 统计记录
SELECT 'Migration completed successfully' as status,
       NOW() as completed_at;