-- Migration: Create HTTP Traffic Replay Tables
-- Description: Create tables for traffic replay and template management
-- Date: 2025-10-01
-- Author: Claude Code Assistant
-- Dependencies: 007_create_http_traffic_logs_table.sql

-- =============================================================================
-- HTTP流量重放模块 - 数据库表结构
-- =============================================================================

-- 创建重放历史记录表
CREATE TABLE IF NOT EXISTS traffic_replay_history (
  -- 主键
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '重放历史记录ID',

  -- 关联信息
  original_log_id BIGINT NOT NULL COMMENT '原始流量记录ID',

  -- 重放执行信息
  replayed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '重放执行时间',
  replayed_by VARCHAR(50) DEFAULT 'system' COMMENT '重放操作者',

  -- 修改后的请求参数
  modified_method VARCHAR(10) NULL COMMENT '修改后的HTTP方法',
  modified_url TEXT NULL COMMENT '修改后的URL',
  modified_headers JSON NULL COMMENT '修改后的请求头',
  modified_body LONGTEXT NULL COMMENT '修改后的请求体',
  modification_summary JSON NULL COMMENT '修改汇总信息',

  -- 实际发送的请求
  replay_request_headers JSON NULL COMMENT '实际发送的请求头',
  replay_request_body LONGTEXT NULL COMMENT '实际发送的请求体',

  -- 重放响应信息
  replay_response_status INT NULL COMMENT '重放响应状态码',
  replay_duration_ms INT UNSIGNED NULL COMMENT '重放请求耗时(毫秒)',
  replay_response_headers JSON NULL COMMENT '重放响应头',
  replay_response_body LONGTEXT NULL COMMENT '重放响应体',
  replay_response_size INT UNSIGNED DEFAULT 0 COMMENT '重放响应大小(字节)',

  -- 差异对比结果
  diff_summary JSON NULL COMMENT '差异汇总(JSON Diff结果)',
  status_code_match BOOLEAN DEFAULT FALSE COMMENT '状态码是否匹配',
  response_body_match BOOLEAN DEFAULT FALSE COMMENT '响应体是否匹配',
  duration_diff_ms INT NULL COMMENT '耗时差异(毫秒)',
  body_size_diff INT NULL COMMENT '响应体大小差异(字节)',

  -- 执行结果
  success BOOLEAN DEFAULT FALSE COMMENT '重放是否成功',
  error_message TEXT NULL COMMENT '错误信息',
  timeout INT UNSIGNED DEFAULT 30000 COMMENT '超时设置(毫秒)',

  -- 模板关联
  template_id INT NULL COMMENT '使用的模板ID',

  -- 时间戳
  created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) COMMENT '记录创建时间',

  -- 外键约束
  FOREIGN KEY (original_log_id) REFERENCES http_traffic_logs(id) ON DELETE CASCADE,

  -- 索引
  INDEX idx_original_log (original_log_id),
  INDEX idx_replayed_at (replayed_at),
  INDEX idx_replayed_by (replayed_by),
  INDEX idx_success (success),
  INDEX idx_template_id (template_id)

) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='HTTP流量重放历史记录表 - 记录每次重放的配置和结果';

-- 创建重放模板表
CREATE TABLE IF NOT EXISTS traffic_replay_templates (
  -- 主键
  id INT PRIMARY KEY AUTO_INCREMENT COMMENT '模板ID',

  -- 基本信息
  template_name VARCHAR(100) NOT NULL COMMENT '模板名称',
  description TEXT NULL COMMENT '模板描述',

  -- 目标匹配规则
  target_api_type VARCHAR(50) NULL COMMENT '目标API类型(gemini/openai/claude等)',
  target_host_pattern VARCHAR(255) NULL COMMENT '目标主机匹配模式(支持通配符)',
  target_path_pattern VARCHAR(255) NULL COMMENT '目标路径匹配模式(支持通配符)',

  -- 修改规则
  header_modifications JSON NULL COMMENT 'Header修改规则',
  body_modifications JSON NULL COMMENT 'Body修改规则(支持JSONPath)',
  query_modifications JSON NULL COMMENT 'Query参数修改规则',

  -- URL替换规则
  url_replacement_pattern VARCHAR(500) NULL COMMENT 'URL替换模式(正则表达式)',
  url_replacement_value VARCHAR(500) NULL COMMENT 'URL替换值',

  -- 状态和统计
  is_active BOOLEAN DEFAULT TRUE COMMENT '是否启用',
  usage_count INT UNSIGNED DEFAULT 0 COMMENT '使用次数',

  -- 创建者信息
  created_by VARCHAR(50) DEFAULT 'admin' COMMENT '创建者',
  created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  updated_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',

  -- 唯一约束
  UNIQUE KEY uk_template_name (template_name),

  -- 索引
  INDEX idx_target_api_type (target_api_type),
  INDEX idx_is_active (is_active),
  INDEX idx_usage_count (usage_count),
  INDEX idx_created_at (created_at)

) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='HTTP流量重放模板表 - 保存常用的参数修改模板';

-- 创建导入状态表
CREATE TABLE IF NOT EXISTS log_import_state (
  -- 主键
  id INT PRIMARY KEY AUTO_INCREMENT COMMENT '状态记录ID',

  -- 文件信息
  file_path VARCHAR(255) NOT NULL COMMENT 'JSONL文件路径',
  file_inode BIGINT NULL COMMENT '文件inode(防止文件重命名)',
  file_size BIGINT UNSIGNED DEFAULT 0 COMMENT '文件大小(字节)',

  -- 导入进度
  last_position BIGINT UNSIGNED DEFAULT 0 COMMENT '上次读取到的位置(字节偏移)',
  last_import_time DATETIME(3) NULL COMMENT '上次导入时间',

  -- 统计信息
  records_imported INT UNSIGNED DEFAULT 0 COMMENT '已导入记录数',
  records_failed INT UNSIGNED DEFAULT 0 COMMENT '导入失败记录数',

  -- 状态信息
  status ENUM('active', 'completed', 'error', 'paused') DEFAULT 'active' COMMENT '导入状态',
  error_message TEXT NULL COMMENT '错误信息',

  -- 时间戳
  import_started_at DATETIME(3) NULL COMMENT '首次导入时间',
  created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) COMMENT '记录创建时间',
  updated_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '记录更新时间',

  -- 唯一约束
  UNIQUE KEY uk_file_path (file_path),

  -- 索引
  INDEX idx_status (status),
  INDEX idx_last_import_time (last_import_time),
  INDEX idx_file_inode (file_inode)

) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='JSONL导入状态表 - 追踪文件导入进度';

-- =============================================================================
-- 插入示例模板数据
-- =============================================================================

INSERT IGNORE INTO traffic_replay_templates (
  template_name,
  description,
  target_api_type,
  target_host_pattern,
  header_modifications,
  is_active
) VALUES
(
  'Gemini Token刷新',
  '替换Gemini API的Authorization token为测试token',
  'gemini',
  '*googleapis.com',
  JSON_OBJECT(
    'replace', JSON_OBJECT(
      'Authorization', 'Bearer TEST_TOKEN_12345'
    )
  ),
  TRUE
),
(
  '测试环境URL替换',
  '将生产环境URL替换为测试环境',
  'all',
  'api.example.com',
  JSON_OBJECT(
    'add', JSON_OBJECT(
      'X-Test-Mode', 'true'
    )
  ),
  TRUE
);

-- =============================================================================
-- 创建视图简化常用查询
-- =============================================================================

-- 创建重放成功率统计视图
CREATE OR REPLACE VIEW v_replay_success_rate AS
SELECT
  DATE(replayed_at) as replay_date,
  COUNT(*) as total_replays,
  SUM(CASE WHEN success = TRUE THEN 1 ELSE 0 END) as successful_replays,
  SUM(CASE WHEN success = FALSE THEN 1 ELSE 0 END) as failed_replays,
  ROUND(
    (SUM(CASE WHEN success = TRUE THEN 1 ELSE 0 END) / COUNT(*)) * 100,
    2
  ) as success_rate,
  AVG(replay_duration_ms) as avg_duration_ms,
  AVG(ABS(duration_diff_ms)) as avg_duration_diff_ms
FROM traffic_replay_history
WHERE replayed_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY DATE(replayed_at)
ORDER BY replay_date DESC;

-- 创建模板使用统计视图
CREATE OR REPLACE VIEW v_template_usage_stats AS
SELECT
  t.id as template_id,
  t.template_name,
  t.target_api_type,
  t.usage_count as total_usage,
  COUNT(h.id) as recent_usage,
  SUM(CASE WHEN h.success = TRUE THEN 1 ELSE 0 END) as successful_replays,
  ROUND(
    (SUM(CASE WHEN h.success = TRUE THEN 1 ELSE 0 END) / COUNT(h.id)) * 100,
    2
  ) as success_rate,
  MAX(h.replayed_at) as last_used
FROM traffic_replay_templates t
LEFT JOIN traffic_replay_history h ON t.id = h.template_id
  AND h.replayed_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
WHERE t.is_active = TRUE
GROUP BY t.id, t.template_name, t.target_api_type, t.usage_count
ORDER BY recent_usage DESC;

-- 创建导入进度汇总视图
CREATE OR REPLACE VIEW v_import_progress_summary AS
SELECT
  status,
  COUNT(*) as file_count,
  SUM(records_imported) as total_records_imported,
  SUM(records_failed) as total_records_failed,
  AVG(records_imported) as avg_records_per_file,
  MAX(last_import_time) as latest_import_time
FROM log_import_state
GROUP BY status;

-- =============================================================================
-- 创建存储过程
-- =============================================================================

-- 获取重放历史详情的存储过程
DELIMITER $$

CREATE PROCEDURE GetReplayHistory(IN log_id BIGINT)
BEGIN
  SELECT
    h.id as replay_id,
    h.original_log_id,
    h.replayed_at,
    h.replayed_by,
    h.modified_method,
    h.modified_url,
    h.replay_response_status,
    h.replay_duration_ms,
    h.status_code_match,
    h.response_body_match,
    h.duration_diff_ms,
    h.success,
    h.error_message,
    t.template_name,
    l.method as original_method,
    l.url as original_url,
    l.response_status as original_status,
    l.duration_ms as original_duration
  FROM traffic_replay_history h
  LEFT JOIN traffic_replay_templates t ON h.template_id = t.id
  LEFT JOIN http_traffic_logs l ON h.original_log_id = l.id
  WHERE h.original_log_id = log_id
  ORDER BY h.replayed_at DESC;
END$$

DELIMITER ;

-- 清理旧的重放历史记录的存储过程
DELIMITER $$

CREATE PROCEDURE CleanupOldReplayHistory(IN days_to_keep INT)
BEGIN
  DECLARE deleted_count INT DEFAULT 0;

  START TRANSACTION;

  -- 删除指定天数之前的重放历史
  DELETE FROM traffic_replay_history
  WHERE replayed_at < DATE_SUB(NOW(), INTERVAL days_to_keep DAY);

  SET deleted_count = ROW_COUNT();

  COMMIT;

  -- 优化表
  OPTIMIZE TABLE traffic_replay_history;

  SELECT deleted_count as records_deleted, NOW() as cleanup_time;
END$$

DELIMITER ;

-- 更新模板使用次数的存储过程
DELIMITER $$

CREATE PROCEDURE IncrementTemplateUsage(IN template_id_param INT)
BEGIN
  UPDATE traffic_replay_templates
  SET usage_count = usage_count + 1,
      updated_at = NOW()
  WHERE id = template_id_param;
END$$

DELIMITER ;

-- =============================================================================
-- 验证表创建
-- =============================================================================

SELECT 'traffic_replay_history table created successfully' as status;
SHOW CREATE TABLE traffic_replay_history;

SELECT 'traffic_replay_templates table created successfully' as status;
SHOW CREATE TABLE traffic_replay_templates;

SELECT 'log_import_state table created successfully' as status;
SHOW CREATE TABLE log_import_state;

-- 验证索引创建
SELECT 'Checking indexes' as status;
SHOW INDEX FROM traffic_replay_history;
SHOW INDEX FROM traffic_replay_templates;
SHOW INDEX FROM log_import_state;

-- 统计记录
SELECT 'Migration 008 completed successfully' as status,
       NOW() as completed_at;
