-- LLM 工具编排系统数据表
-- 创建时间: 2025-10-03
-- 用途: 支持 LLM 异步任务处理、工具注册和执行日志

-- 1. LLM 任务队列表
CREATE TABLE IF NOT EXISTS llm_jobs (
  id VARCHAR(36) PRIMARY KEY COMMENT '任务ID (UUID)',
  trace_id VARCHAR(100) NOT NULL COMMENT '链路追踪ID',
  source_key VARCHAR(50) NOT NULL COMMENT '来源标识 (user_xxx/group_xxx)',
  source_type ENUM('private', 'group') NOT NULL COMMENT '来源类型',

  -- 任务状态管理
  status ENUM('pending', 'calling', 'awaiting_tool', 'completed', 'failed') NOT NULL DEFAULT 'pending' COMMENT '任务状态',
  retry_count INT NOT NULL DEFAULT 0 COMMENT '重试次数',
  max_retries INT NOT NULL DEFAULT 3 COMMENT '最大重试次数',
  next_retry_at DATETIME NULL COMMENT '下次重试时间',

  -- 请求数据
  contents_json JSON NOT NULL COMMENT 'Gemini contents 数组',
  tools_json JSON NULL COMMENT '工具声明数组',
  config_json JSON NULL COMMENT 'LLM 配置参数',

  -- 执行状态
  pending_tool VARCHAR(100) NULL COMMENT '当前等待的工具名',
  current_turn INT NOT NULL DEFAULT 1 COMMENT '当前轮次',
  max_turns INT NOT NULL DEFAULT 10 COMMENT '最大轮次',

  -- 结果与错误
  final_response TEXT NULL COMMENT '最终响应文本',
  error_message TEXT NULL COMMENT '错误信息',

  -- 元数据
  metadata JSON NULL COMMENT '额外元数据',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  completed_at DATETIME NULL COMMENT '完成时间',

  INDEX idx_trace_id (trace_id),
  INDEX idx_source_key (source_key),
  INDEX idx_status (status),
  INDEX idx_next_retry (next_retry_at),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='LLM异步任务队列';

-- 2. 动态工具注册表
CREATE TABLE IF NOT EXISTS llm_tools (
  id INT AUTO_INCREMENT PRIMARY KEY,
  method_id VARCHAR(100) NOT NULL UNIQUE COMMENT '工具方法ID (唯一标识)',
  name VARCHAR(100) NOT NULL COMMENT '工具显示名称',
  description TEXT NOT NULL COMMENT '工具描述 (用于LLM理解)',

  -- 参数定义
  params_schema JSON NOT NULL COMMENT '参数JSON Schema',

  -- 分类与标签
  category VARCHAR(50) NULL COMMENT '工具分类 (system/user/external)',
  tags JSON NULL COMMENT '标签数组 (用于搜索)',

  -- 执行配置
  side_effect BOOLEAN NOT NULL DEFAULT FALSE COMMENT '是否有副作用',
  expect_response BOOLEAN NOT NULL DEFAULT TRUE COMMENT '是否期望返回值',
  timeout_ms INT NOT NULL DEFAULT 30000 COMMENT '超时时间(毫秒)',

  -- 权限与状态
  enabled BOOLEAN NOT NULL DEFAULT TRUE COMMENT '是否启用',
  required_permission VARCHAR(50) NULL COMMENT '所需权限',

  -- 版本与审计
  version VARCHAR(20) NOT NULL DEFAULT '1.0.0' COMMENT '工具版本',
  created_by VARCHAR(50) NULL COMMENT '创建者',
  updated_by VARCHAR(50) NULL COMMENT '更新者',

  -- 执行统计
  total_calls INT NOT NULL DEFAULT 0 COMMENT '总调用次数',
  success_calls INT NOT NULL DEFAULT 0 COMMENT '成功次数',
  failed_calls INT NOT NULL DEFAULT 0 COMMENT '失败次数',
  avg_duration_ms INT NULL COMMENT '平均执行时间',

  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_method_id (method_id),
  INDEX idx_category (category),
  INDEX idx_enabled (enabled),
  INDEX idx_side_effect (side_effect)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='动态工具注册表';

-- 3. 工具执行日志表
CREATE TABLE IF NOT EXISTS tool_execution_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,

  -- 关联
  trace_id VARCHAR(100) NOT NULL COMMENT '链路追踪ID',
  job_id VARCHAR(36) NULL COMMENT 'LLM任务ID',
  tool_type ENUM('static', 'dynamic') NOT NULL COMMENT '工具类型',
  tool_name VARCHAR(100) NOT NULL COMMENT '工具名称',
  method_id VARCHAR(100) NULL COMMENT '动态工具方法ID',

  -- 执行信息
  arguments JSON NOT NULL COMMENT '调用参数',
  result JSON NULL COMMENT '执行结果',

  -- 状态与性能
  status ENUM('success', 'failed', 'timeout') NOT NULL COMMENT '执行状态',
  error_message TEXT NULL COMMENT '错误信息',
  duration_ms INT NULL COMMENT '执行耗时(毫秒)',

  -- 执行模式
  execution_mode ENUM('returnable', 'fire-and-forget') NOT NULL COMMENT '执行模式',
  side_effect BOOLEAN NOT NULL DEFAULT FALSE COMMENT '是否有副作用',

  -- 时间戳
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '开始时间',
  completed_at DATETIME NULL COMMENT '完成时间',

  INDEX idx_trace_id (trace_id),
  INDEX idx_job_id (job_id),
  INDEX idx_tool_name (tool_name),
  INDEX idx_method_id (method_id),
  INDEX idx_status (status),
  INDEX idx_started_at (started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='工具执行日志';

-- 4. 扩展现有 llm_call_logs 表 (添加工具相关字段) - 兼容MySQL 5.7
-- 检查列是否存在，不存在才添加
SET @column_check = (SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'qqbot_db'
    AND TABLE_NAME = 'llm_call_logs'
    AND COLUMN_NAME = 'tool_name');

SET @sql_add_tool_name = IF(@column_check = 0,
    'ALTER TABLE llm_call_logs ADD COLUMN tool_name VARCHAR(100) NULL COMMENT ''调用的工具名'' AFTER processed_response',
    'SELECT ''Column tool_name already exists'' AS message');
PREPARE stmt FROM @sql_add_tool_name;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_check = (SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'qqbot_db'
    AND TABLE_NAME = 'llm_call_logs'
    AND COLUMN_NAME = 'method_id');

SET @sql_add_method_id = IF(@column_check = 0,
    'ALTER TABLE llm_call_logs ADD COLUMN method_id VARCHAR(100) NULL COMMENT ''动态工具方法ID'' AFTER tool_name',
    'SELECT ''Column method_id already exists'' AS message');
PREPARE stmt FROM @sql_add_method_id;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_check = (SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'qqbot_db'
    AND TABLE_NAME = 'llm_call_logs'
    AND COLUMN_NAME = 'execution_mode');

SET @sql_add_execution_mode = IF(@column_check = 0,
    'ALTER TABLE llm_call_logs ADD COLUMN execution_mode ENUM(''returnable'', ''fire-and-forget'') NULL COMMENT ''工具执行模式'' AFTER method_id',
    'SELECT ''Column execution_mode already exists'' AS message');
PREPARE stmt FROM @sql_add_execution_mode;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 添加索引（如果不存在）
SET @index_check = (SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = 'qqbot_db'
    AND TABLE_NAME = 'llm_call_logs'
    AND INDEX_NAME = 'idx_tool_name');

SET @sql_add_idx_tool = IF(@index_check = 0,
    'ALTER TABLE llm_call_logs ADD INDEX idx_tool_name (tool_name)',
    'SELECT ''Index idx_tool_name already exists'' AS message');
PREPARE stmt FROM @sql_add_idx_tool;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @index_check = (SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = 'qqbot_db'
    AND TABLE_NAME = 'llm_call_logs'
    AND INDEX_NAME = 'idx_method_id');

SET @sql_add_idx_method = IF(@index_check = 0,
    'ALTER TABLE llm_call_logs ADD INDEX idx_method_id (method_id)',
    'SELECT ''Index idx_method_id already exists'' AS message');
PREPARE stmt FROM @sql_add_idx_method;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 5. 扩展 timeline_events 表 (支持工具事件)
SET @column_check = (SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'qqbot_db'
    AND TABLE_NAME = 'timeline_events'
    AND COLUMN_NAME = 'tool_name');

SET @sql_add_tool_name_timeline = IF(@column_check = 0,
    'ALTER TABLE timeline_events ADD COLUMN tool_name VARCHAR(100) NULL COMMENT ''工具名称'' AFTER event_type',
    'SELECT ''Column tool_name already exists in timeline_events'' AS message');
PREPARE stmt FROM @sql_add_tool_name_timeline;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_check = (SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'qqbot_db'
    AND TABLE_NAME = 'timeline_events'
    AND COLUMN_NAME = 'method_id');

SET @sql_add_method_id_timeline = IF(@column_check = 0,
    'ALTER TABLE timeline_events ADD COLUMN method_id VARCHAR(100) NULL COMMENT ''工具方法ID'' AFTER tool_name',
    'SELECT ''Column method_id already exists in timeline_events'' AS message');
PREPARE stmt FROM @sql_add_method_id_timeline;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @index_check = (SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = 'qqbot_db'
    AND TABLE_NAME = 'timeline_events'
    AND INDEX_NAME = 'idx_tool_name');

SET @sql_add_idx_tool_timeline = IF(@index_check = 0,
    'ALTER TABLE timeline_events ADD INDEX idx_tool_name (tool_name)',
    'SELECT ''Index idx_tool_name already exists in timeline_events'' AS message');
PREPARE stmt FROM @sql_add_idx_tool_timeline;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
