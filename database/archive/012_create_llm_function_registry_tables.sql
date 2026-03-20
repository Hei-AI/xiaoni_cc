-- LLM 函数调用注册中心基础表
-- 创建时间: 2025-10-05
-- 目的: 支撑 http-api 注册中心、Prompt 绑定与统一调用

CREATE TABLE IF NOT EXISTS llm_function_definitions (
  id CHAR(36) NOT NULL PRIMARY KEY COMMENT '函数ID (UUID)',
  name VARCHAR(128) NOT NULL UNIQUE COMMENT '对 LLM 暴露的唯一名称',
  display_name VARCHAR(128) NOT NULL COMMENT '管理端展示名称',
  description TEXT NULL COMMENT '函数描述',

  parameters_schema JSON NOT NULL COMMENT '参数 JSON Schema',
  side_effect TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否存在副作用',
  expect_response TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否期望同步响应',
  category VARCHAR(64) NULL COMMENT '函数分类',
  tags JSON NULL COMMENT '标签数组',

  invoke_method ENUM('HTTP', 'GRPC', 'INTERNAL') NOT NULL DEFAULT 'HTTP' COMMENT '调用方式',
  invoke_url VARCHAR(512) NULL COMMENT 'HTTP/GRPC 调用地址',
  http_method VARCHAR(16) NULL COMMENT 'HTTP 方法',
  auth_type ENUM('NONE', 'SERVICE_TOKEN', 'BASIC', 'CUSTOM') NOT NULL DEFAULT 'NONE' COMMENT '调用鉴权类型',
  timeout_ms INT NOT NULL DEFAULT 30000 COMMENT '调用超时时间 (毫秒)',
  retry_policy JSON NULL COMMENT '重试策略配置',
  execution_adapter VARCHAR(64) NULL COMMENT '执行适配器 (内部函数用)',

  managed_by_system TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否系统内置',
  enabled TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否启用',

  created_by VARCHAR(64) NULL COMMENT '创建者',
  updated_by VARCHAR(64) NULL COMMENT '更新者',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_category (category),
  INDEX idx_enabled (enabled),
  INDEX idx_side_effect (side_effect)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='LLM 函数定义';

CREATE TABLE IF NOT EXISTS prompt_function_bindings (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  prompt_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '关联 agent_prompts.id',
  function_id CHAR(36) NOT NULL COMMENT '关联 llm_function_definitions.id',
  calling_mode ENUM('AUTO', 'ANY', 'NONE') NOT NULL DEFAULT 'AUTO' COMMENT '调用模式',
  priority INT NULL COMMENT '执行优先级',
  metadata JSON NULL COMMENT '额外绑定信息',

  created_by VARCHAR(64) NULL COMMENT '创建者',
  updated_by VARCHAR(64) NULL COMMENT '更新者',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT uk_prompt_function UNIQUE (prompt_id, function_id),
  CONSTRAINT fk_prompt_function_prompt FOREIGN KEY (prompt_id)
    REFERENCES agent_prompts(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_prompt_function_definition FOREIGN KEY (function_id)
    REFERENCES llm_function_definitions(id)
    ON DELETE CASCADE,

  INDEX idx_prompt_id (prompt_id),
  INDEX idx_function_id (function_id),
  INDEX idx_calling_mode (calling_mode)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Prompt 与函数绑定关系';

-- 可选：函数执行日志 (若已存在 tool_execution_logs 则跳过)
CREATE TABLE IF NOT EXISTS function_execution_logs (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  trace_id VARCHAR(100) NOT NULL COMMENT '链路追踪 ID',
  function_id CHAR(36) NULL COMMENT '函数 ID',
  prompt_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL COMMENT 'Prompt ID',
  job_id VARCHAR(36) NULL COMMENT 'LLM 任务 ID',
  source_key VARCHAR(100) NULL COMMENT '调用来源',

  request_arguments JSON NOT NULL COMMENT '请求参数',
  request_context JSON NULL COMMENT '上下文',
  response_data JSON NULL COMMENT '返回数据',
  error_message TEXT NULL COMMENT '错误信息',

  status ENUM('success', 'failed', 'timeout') NOT NULL COMMENT '执行状态',
  duration_ms INT NULL COMMENT '耗时 (毫秒)',
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '开始时间',
  completed_at DATETIME NULL COMMENT '完成时间',

  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_trace_id (trace_id),
  INDEX idx_function_id (function_id),
  INDEX idx_status (status),
  INDEX idx_started_at (started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='函数执行日志';
