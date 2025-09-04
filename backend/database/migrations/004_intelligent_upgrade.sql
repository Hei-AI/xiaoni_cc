-- QQ机器人智能化升级数据库架构扩展
-- 文件: 004_intelligent_upgrade.sql
-- 作者: System Architect Designer
-- 日期: 2025-09-04
-- 版本: 1.0
-- 目的: 为对话追踪、Prompt热加载管理、分析指标提供完整数据库支持

-- 使用数据库
USE qqbot_db;

-- =====================================
-- 1. 对话追踪系统数据模型
-- =====================================

-- 1.1 对话追踪主表
CREATE TABLE IF NOT EXISTS `conversation_traces` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '追踪记录唯一ID',
  `trace_id` VARCHAR(64) NOT NULL UNIQUE COMMENT '分布式追踪ID',
  `conversation_id` VARCHAR(50) NOT NULL COMMENT '关联conversations表的ID',
  `user_id` BIGINT NOT NULL COMMENT '用户ID',
  `session_id` VARCHAR(100) NULL COMMENT 'Session会话ID',
  
  -- 追踪状态信息
  `status` ENUM('started', 'processing', 'completed', 'failed', 'timeout') NOT NULL DEFAULT 'started' COMMENT '追踪状态',
  `trace_type` ENUM('user_message', 'ai_response', 'requirement_analysis', 'intent_detection', 'error_handling') NOT NULL COMMENT '追踪类型',
  
  -- 性能指标
  `start_time` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '开始时间',
  `end_time` TIMESTAMP NULL COMMENT '结束时间',
  `duration_ms` INT UNSIGNED NULL COMMENT '总耗时（毫秒）',
  `ai_processing_ms` INT UNSIGNED NULL COMMENT 'AI处理耗时（毫秒）',
  `db_query_ms` INT UNSIGNED NULL COMMENT '数据库查询耗时（毫秒）',
  
  -- 上下文信息
  `parent_trace_id` VARCHAR(64) NULL COMMENT '父追踪ID（用于嵌套追踪）',
  `depth_level` TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '追踪深度级别',
  `span_count` SMALLINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '子span数量',
  
  -- 元数据
  `metadata` JSON NULL COMMENT '追踪元数据（API调用信息、模型参数等）',
  `tags` JSON NULL COMMENT '标签信息（用于分类和搜索）',
  `annotations` JSON NULL COMMENT '注释信息（调试信息、警告等）',
  
  -- 时间戳
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  
  -- 索引设计
  INDEX `idx_trace_id` (`trace_id`),
  INDEX `idx_conversation_id` (`conversation_id`),
  INDEX `idx_user_id_time` (`user_id`, `start_time` DESC),
  INDEX `idx_status_type` (`status`, `trace_type`),
  INDEX `idx_session_time` (`session_id`, `start_time` DESC),
  INDEX `idx_parent_trace` (`parent_trace_id`, `depth_level`),
  INDEX `idx_duration_performance` (`duration_ms`, `ai_processing_ms`),
  INDEX `idx_created_time_range` (`created_at` DESC),
  
  -- 外键约束
  FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON DELETE CASCADE,
  
  -- 分区键（按月分区优化查询性能）
  PARTITION BY RANGE (YEAR(created_at) * 100 + MONTH(created_at)) (
    PARTITION p202509 VALUES LESS THAN (202510),
    PARTITION p202510 VALUES LESS THAN (202511),
    PARTITION p202511 VALUES LESS THAN (202512),
    PARTITION p202512 VALUES LESS THAN (202601),
    PARTITION p202601 VALUES LESS THAN (202602),
    PARTITION p_future VALUES LESS THAN MAXVALUE
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='对话追踪主表';

-- 1.2 处理步骤详细表
CREATE TABLE IF NOT EXISTS `processing_steps` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '步骤记录ID',
  `trace_id` VARCHAR(64) NOT NULL COMMENT '关联追踪ID',
  `step_order` SMALLINT UNSIGNED NOT NULL COMMENT '步骤顺序',
  `step_name` VARCHAR(100) NOT NULL COMMENT '步骤名称',
  `step_type` ENUM('initialization', 'preprocessing', 'ai_inference', 'postprocessing', 'validation', 'storage', 'response') NOT NULL COMMENT '步骤类型',
  
  -- 步骤状态
  `status` ENUM('pending', 'running', 'completed', 'failed', 'skipped') NOT NULL DEFAULT 'pending' COMMENT '步骤状态',
  `start_time` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '步骤开始时间',
  `end_time` TIMESTAMP NULL COMMENT '步骤结束时间',
  `duration_ms` INT UNSIGNED NULL COMMENT '步骤耗时（毫秒）',
  
  -- 步骤详情
  `input_data` JSON NULL COMMENT '输入数据',
  `output_data` JSON NULL COMMENT '输出数据',
  `parameters` JSON NULL COMMENT '步骤参数',
  `metrics` JSON NULL COMMENT '步骤性能指标',
  
  -- 错误处理
  `error_code` VARCHAR(50) NULL COMMENT '错误代码',
  `error_message` TEXT NULL COMMENT '错误详细信息',
  `retry_count` TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '重试次数',
  `is_critical` BOOLEAN NOT NULL DEFAULT FALSE COMMENT '是否关键步骤',
  
  -- 时间戳
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  
  -- 索引设计
  INDEX `idx_trace_order` (`trace_id`, `step_order`),
  INDEX `idx_step_name_type` (`step_name`, `step_type`),
  INDEX `idx_status_time` (`status`, `start_time` DESC),
  INDEX `idx_duration_critical` (`duration_ms`, `is_critical`),
  INDEX `idx_error_retry` (`error_code`, `retry_count`),
  
  -- 外键约束
  FOREIGN KEY (`trace_id`) REFERENCES `conversation_traces`(`trace_id`) ON DELETE CASCADE,
  
  -- 唯一约束
  UNIQUE KEY `uk_trace_step_order` (`trace_id`, `step_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='处理步骤详细表';

-- 1.3 错误追踪表
CREATE TABLE IF NOT EXISTS `error_traces` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '错误记录ID',
  `trace_id` VARCHAR(64) NOT NULL COMMENT '关联追踪ID',
  `error_id` VARCHAR(64) NOT NULL UNIQUE COMMENT '错误唯一标识',
  `conversation_id` VARCHAR(50) NULL COMMENT '关联对话ID',
  `user_id` BIGINT NULL COMMENT '用户ID',
  
  -- 错误信息
  `error_type` ENUM('system_error', 'ai_error', 'network_error', 'validation_error', 'timeout_error', 'quota_error', 'business_error') NOT NULL COMMENT '错误类型',
  `error_level` ENUM('debug', 'info', 'warning', 'error', 'critical') NOT NULL DEFAULT 'error' COMMENT '错误级别',
  `error_code` VARCHAR(50) NULL COMMENT '错误代码',
  `error_message` TEXT NOT NULL COMMENT '错误消息',
  `error_details` JSON NULL COMMENT '错误详细信息',
  
  -- 上下文信息
  `stack_trace` TEXT NULL COMMENT '错误堆栈信息',
  `request_context` JSON NULL COMMENT '请求上下文',
  `system_state` JSON NULL COMMENT '系统状态快照',
  `ai_model_info` JSON NULL COMMENT 'AI模型相关信息',
  
  -- 影响分析
  `affected_services` JSON NULL COMMENT '受影响的服务',
  `user_impact` ENUM('none', 'minimal', 'moderate', 'high', 'critical') NOT NULL DEFAULT 'minimal' COMMENT '用户影响程度',
  `business_impact` TEXT NULL COMMENT '业务影响描述',
  
  -- 解决状态
  `resolution_status` ENUM('open', 'investigating', 'resolved', 'closed', 'reopened') NOT NULL DEFAULT 'open' COMMENT '解决状态',
  `resolution_time` TIMESTAMP NULL COMMENT '解决时间',
  `resolution_notes` TEXT NULL COMMENT '解决方案说明',
  `resolved_by` VARCHAR(100) NULL COMMENT '解决人员',
  
  -- 统计信息
  `occurrence_count` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '发生次数',
  `first_occurrence` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '首次发生时间',
  `last_occurrence` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '最后发生时间',
  
  -- 时间戳
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  
  -- 索引设计
  INDEX `idx_trace_id` (`trace_id`),
  INDEX `idx_error_type_level` (`error_type`, `error_level`),
  INDEX `idx_error_code` (`error_code`),
  INDEX `idx_user_time` (`user_id`, `first_occurrence` DESC),
  INDEX `idx_resolution_status` (`resolution_status`),
  INDEX `idx_impact_level` (`user_impact`, `business_impact`(100)),
  INDEX `idx_occurrence_time` (`occurrence_count`, `last_occurrence` DESC),
  INDEX `idx_created_time` (`created_at` DESC),
  
  -- 外键约束
  FOREIGN KEY (`trace_id`) REFERENCES `conversation_traces`(`trace_id`) ON DELETE CASCADE,
  FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='错误追踪表';

-- 1.4 实时事件表
CREATE TABLE IF NOT EXISTS `real_time_events` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '事件记录ID',
  `event_id` VARCHAR(64) NOT NULL UNIQUE COMMENT '事件唯一标识',
  `trace_id` VARCHAR(64) NULL COMMENT '关联追踪ID',
  `user_id` BIGINT NULL COMMENT '用户ID',
  `session_id` VARCHAR(100) NULL COMMENT 'Session ID',
  
  -- 事件信息
  `event_type` ENUM('user_action', 'system_event', 'ai_response', 'error_event', 'performance_event', 'business_event') NOT NULL COMMENT '事件类型',
  `event_name` VARCHAR(100) NOT NULL COMMENT '事件名称',
  `event_category` VARCHAR(50) NULL COMMENT '事件分类',
  `event_source` VARCHAR(100) NOT NULL COMMENT '事件来源',
  
  -- 事件数据
  `event_data` JSON NOT NULL COMMENT '事件数据内容',
  `event_properties` JSON NULL COMMENT '事件属性',
  `event_metrics` JSON NULL COMMENT '事件指标数据',
  
  -- 上下文信息
  `context_info` JSON NULL COMMENT '上下文信息',
  `correlation_id` VARCHAR(64) NULL COMMENT '关联ID（用于事件关联）',
  `parent_event_id` VARCHAR(64) NULL COMMENT '父事件ID',
  
  -- 优先级和标签
  `priority` TINYINT UNSIGNED NOT NULL DEFAULT 3 COMMENT '事件优先级（1=最高，5=最低）',
  `tags` JSON NULL COMMENT '事件标签',
  `flags` JSON NULL COMMENT '事件标志（紧急、重要等）',
  
  -- 处理状态
  `processing_status` ENUM('pending', 'processing', 'processed', 'failed', 'ignored') NOT NULL DEFAULT 'pending' COMMENT '处理状态',
  `processed_at` TIMESTAMP NULL COMMENT '处理时间',
  `processor_info` JSON NULL COMMENT '处理器信息',
  
  -- 时间戳
  `event_timestamp` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '事件发生时间（毫秒精度）',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  
  -- 索引设计
  INDEX `idx_event_type_time` (`event_type`, `event_timestamp` DESC),
  INDEX `idx_user_time` (`user_id`, `event_timestamp` DESC),
  INDEX `idx_session_time` (`session_id`, `event_timestamp` DESC),
  INDEX `idx_trace_correlation` (`trace_id`, `correlation_id`),
  INDEX `idx_priority_status` (`priority`, `processing_status`),
  INDEX `idx_event_source_name` (`event_source`, `event_name`),
  INDEX `idx_parent_child` (`parent_event_id`, `event_id`),
  INDEX `idx_timestamp_range` (`event_timestamp` DESC),
  
  -- 外键约束
  FOREIGN KEY (`trace_id`) REFERENCES `conversation_traces`(`trace_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='实时事件表';

-- =====================================
-- 2. Prompt热加载管理数据模型
-- =====================================

-- 2.1 动态Prompt模板表
CREATE TABLE IF NOT EXISTS `dynamic_prompt_templates` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '模板ID',
  `template_id` VARCHAR(100) NOT NULL UNIQUE COMMENT '模板唯一标识',
  `template_name` VARCHAR(200) NOT NULL COMMENT '模板名称',
  `template_category` VARCHAR(100) NOT NULL COMMENT '模板分类',
  `template_type` ENUM('system_prompt', 'user_prompt', 'context_prompt', 'instruction_prompt', 'example_prompt') NOT NULL COMMENT '模板类型',
  
  -- 模板内容
  `template_content` LONGTEXT NOT NULL COMMENT '模板内容',
  `template_variables` JSON NULL COMMENT '模板变量定义',
  `template_schema` JSON NULL COMMENT '模板结构定义',
  `validation_rules` JSON NULL COMMENT '验证规则',
  
  -- 适用范围
  `applicable_models` JSON NULL COMMENT '适用的AI模型',
  `applicable_scenarios` JSON NULL COMMENT '适用场景',
  `applicable_users` JSON NULL COMMENT '适用用户（用户ID列表或规则）',
  `applicable_groups` JSON NULL COMMENT '适用群组（群ID列表或规则）',
  
  -- 版本管理
  `version` VARCHAR(20) NOT NULL DEFAULT '1.0.0' COMMENT '模板版本',
  `parent_template_id` VARCHAR(100) NULL COMMENT '父模板ID（用于版本继承）',
  `version_notes` TEXT NULL COMMENT '版本说明',
  `is_draft` BOOLEAN NOT NULL DEFAULT FALSE COMMENT '是否为草稿',
  
  -- 状态管理
  `status` ENUM('active', 'inactive', 'deprecated', 'testing', 'archived') NOT NULL DEFAULT 'active' COMMENT '模板状态',
  `activation_time` TIMESTAMP NULL COMMENT '激活时间',
  `expiration_time` TIMESTAMP NULL COMMENT '过期时间',
  `deactivation_reason` TEXT NULL COMMENT '停用原因',
  
  -- 性能配置
  `priority` TINYINT UNSIGNED NOT NULL DEFAULT 5 COMMENT '优先级（1=最高，10=最低）',
  `weight` DECIMAL(5,2) NOT NULL DEFAULT 1.00 COMMENT '权重（用于A/B测试）',
  `cache_ttl_seconds` INT UNSIGNED NULL COMMENT '缓存TTL（秒）',
  `max_concurrent_usage` INT UNSIGNED NULL COMMENT '最大并发使用数',
  
  -- 使用统计
  `usage_count` BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '使用次数',
  `success_count` BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '成功次数',
  `failure_count` BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '失败次数',
  `avg_response_time_ms` DECIMAL(8,2) NULL COMMENT '平均响应时间',
  `last_used_at` TIMESTAMP NULL COMMENT '最后使用时间',
  
  -- 元数据
  `metadata` JSON NULL COMMENT '模板元数据',
  `tags` JSON NULL COMMENT '标签',
  `description` TEXT NULL COMMENT '模板描述',
  `usage_instructions` TEXT NULL COMMENT '使用说明',
  `examples` JSON NULL COMMENT '使用示例',
  
  -- 审核信息
  `created_by` VARCHAR(100) NOT NULL COMMENT '创建者',
  `updated_by` VARCHAR(100) NULL COMMENT '更新者',
  `reviewed_by` VARCHAR(100) NULL COMMENT '审核者',
  `review_status` ENUM('pending', 'approved', 'rejected', 'needs_revision') NULL COMMENT '审核状态',
  `review_notes` TEXT NULL COMMENT '审核意见',
  `review_time` TIMESTAMP NULL COMMENT '审核时间',
  
  -- 时间戳
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  
  -- 索引设计
  INDEX `idx_template_category_type` (`template_category`, `template_type`),
  INDEX `idx_status_priority` (`status`, `priority`),
  INDEX `idx_version_parent` (`parent_template_id`, `version`),
  INDEX `idx_activation_expiration` (`activation_time`, `expiration_time`),
  INDEX `idx_usage_stats` (`usage_count` DESC, `success_count` DESC),
  INDEX `idx_created_by_time` (`created_by`, `created_at` DESC),
  INDEX `idx_review_status` (`review_status`, `review_time`),
  INDEX `idx_last_used` (`last_used_at` DESC),
  INDEX `idx_weight_priority` (`weight`, `priority`),
  
  -- 全文索引（用于内容搜索）
  FULLTEXT INDEX `ft_content_search` (`template_content`, `description`, `usage_instructions`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='动态Prompt模板表';

-- 2.2 Prompt使用历史表
CREATE TABLE IF NOT EXISTS `prompt_usage_history` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '使用记录ID',
  `usage_id` VARCHAR(64) NOT NULL UNIQUE COMMENT '使用记录唯一标识',
  `template_id` VARCHAR(100) NOT NULL COMMENT '模板ID',
  `trace_id` VARCHAR(64) NULL COMMENT '关联追踪ID',
  `conversation_id` VARCHAR(50) NULL COMMENT '对话ID',
  `user_id` BIGINT NULL COMMENT '用户ID',
  `session_id` VARCHAR(100) NULL COMMENT 'Session ID',
  
  -- 使用环境
  `usage_context` ENUM('user_chat', 'group_chat', 'requirement_analysis', 'intent_detection', 'error_handling', 'system_task') NOT NULL COMMENT '使用上下文',
  `ai_model_name` VARCHAR(100) NULL COMMENT '使用的AI模型',
  `model_parameters` JSON NULL COMMENT '模型参数',
  `api_endpoint` VARCHAR(200) NULL COMMENT 'API端点',
  
  -- 模板实例化
  `template_version` VARCHAR(20) NOT NULL COMMENT '使用的模板版本',
  `rendered_prompt` LONGTEXT NOT NULL COMMENT '渲染后的完整prompt',
  `variable_values` JSON NULL COMMENT '变量值',
  `rendering_time_ms` INT UNSIGNED NULL COMMENT '渲染耗时（毫秒）',
  
  -- 执行结果
  `execution_status` ENUM('success', 'partial_success', 'failed', 'timeout', 'cancelled') NOT NULL COMMENT '执行状态',
  `response_content` LONGTEXT NULL COMMENT 'AI响应内容',
  `response_metadata` JSON NULL COMMENT '响应元数据',
  `execution_time_ms` INT UNSIGNED NULL COMMENT '执行耗时（毫秒）',
  `total_time_ms` INT UNSIGNED NULL COMMENT '总耗时（毫秒）',
  
  -- 质量评估
  `response_quality_score` DECIMAL(3,2) NULL COMMENT '响应质量评分（0-5.0）',
  `relevance_score` DECIMAL(3,2) NULL COMMENT '相关性评分（0-5.0）',
  `coherence_score` DECIMAL(3,2) NULL COMMENT '连贯性评分（0-5.0）',
  `user_feedback` ENUM('positive', 'neutral', 'negative') NULL COMMENT '用户反馈',
  `quality_notes` TEXT NULL COMMENT '质量评估备注',
  
  -- 错误信息
  `error_code` VARCHAR(50) NULL COMMENT '错误代码',
  `error_message` TEXT NULL COMMENT '错误消息',
  `error_details` JSON NULL COMMENT '错误详情',
  `retry_count` TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '重试次数',
  
  -- 性能指标
  `token_usage` JSON NULL COMMENT 'Token使用情况',
  `api_cost` DECIMAL(10,4) NULL COMMENT 'API调用成本',
  `cache_hit` BOOLEAN NOT NULL DEFAULT FALSE COMMENT '是否命中缓存',
  `cache_key` VARCHAR(255) NULL COMMENT '缓存键',
  
  -- 时间戳
  `started_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '开始时间',
  `completed_at` TIMESTAMP NULL COMMENT '完成时间',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  
  -- 索引设计
  INDEX `idx_template_time` (`template_id`, `started_at` DESC),
  INDEX `idx_user_context` (`user_id`, `usage_context`),
  INDEX `idx_trace_conversation` (`trace_id`, `conversation_id`),
  INDEX `idx_execution_status` (`execution_status`, `total_time_ms`),
  INDEX `idx_quality_scores` (`response_quality_score`, `user_feedback`),
  INDEX `idx_model_performance` (`ai_model_name`, `execution_time_ms`),
  INDEX `idx_cache_cost` (`cache_hit`, `api_cost`),
  INDEX `idx_error_retry` (`error_code`, `retry_count`),
  INDEX `idx_started_time` (`started_at` DESC),
  
  -- 外键约束
  FOREIGN KEY (`template_id`) REFERENCES `dynamic_prompt_templates`(`template_id`) ON DELETE CASCADE,
  FOREIGN KEY (`trace_id`) REFERENCES `conversation_traces`(`trace_id`) ON DELETE SET NULL,
  FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Prompt使用历史表';

-- 2.3 Prompt实时缓存表
CREATE TABLE IF NOT EXISTS `prompt_cache` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '缓存记录ID',
  `cache_key` VARCHAR(255) NOT NULL UNIQUE COMMENT '缓存键',
  `template_id` VARCHAR(100) NOT NULL COMMENT '模板ID',
  `cache_type` ENUM('rendered_prompt', 'api_response', 'computed_result', 'metadata_cache') NOT NULL COMMENT '缓存类型',
  
  -- 缓存内容
  `cache_data` LONGTEXT NOT NULL COMMENT '缓存数据',
  `cache_metadata` JSON NULL COMMENT '缓存元数据',
  `compression_type` ENUM('none', 'gzip', 'lz4') NOT NULL DEFAULT 'none' COMMENT '压缩类型',
  `data_size_bytes` INT UNSIGNED NULL COMMENT '数据大小（字节）',
  
  -- 缓存配置
  `ttl_seconds` INT UNSIGNED NOT NULL COMMENT '生存时间（秒）',
  `max_access_count` INT UNSIGNED NULL COMMENT '最大访问次数',
  `priority` TINYINT UNSIGNED NOT NULL DEFAULT 5 COMMENT '缓存优先级',
  
  -- 使用统计
  `access_count` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '访问次数',
  `hit_count` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '命中次数',
  `last_accessed_at` TIMESTAMP NULL COMMENT '最后访问时间',
  `first_created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '首次创建时间',
  
  -- 缓存状态
  `status` ENUM('active', 'expired', 'invalidated', 'evicted') NOT NULL DEFAULT 'active' COMMENT '缓存状态',
  `expires_at` TIMESTAMP NOT NULL COMMENT '过期时间',
  `invalidation_reason` TEXT NULL COMMENT '失效原因',
  `eviction_reason` TEXT NULL COMMENT '驱逐原因',
  
  -- 版本控制
  `version` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '缓存版本',
  `checksum` VARCHAR(64) NULL COMMENT '数据校验和',
  `dependency_keys` JSON NULL COMMENT '依赖的缓存键',
  
  -- 时间戳
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  
  -- 索引设计
  INDEX `idx_template_type` (`template_id`, `cache_type`),
  INDEX `idx_status_expires` (`status`, `expires_at`),
  INDEX `idx_priority_access` (`priority`, `access_count` DESC),
  INDEX `idx_last_accessed` (`last_accessed_at` DESC),
  INDEX `idx_size_priority` (`data_size_bytes`, `priority`),
  INDEX `idx_hit_ratio` (`hit_count`, `access_count`),
  INDEX `idx_expires_time` (`expires_at`),
  
  -- 外键约束
  FOREIGN KEY (`template_id`) REFERENCES `dynamic_prompt_templates`(`template_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Prompt实时缓存表';

-- =====================================
-- 3. 分析指标数据模型
-- =====================================

-- 3.1 分析指标表
CREATE TABLE IF NOT EXISTS `analytics_metrics` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '指标记录ID',
  `metric_id` VARCHAR(100) NOT NULL COMMENT '指标唯一标识',
  `metric_name` VARCHAR(200) NOT NULL COMMENT '指标名称',
  `metric_type` ENUM('counter', 'gauge', 'histogram', 'timer', 'rate', 'percentage') NOT NULL COMMENT '指标类型',
  `metric_category` VARCHAR(100) NOT NULL COMMENT '指标分类',
  `metric_subcategory` VARCHAR(100) NULL COMMENT '指标子分类',
  
  -- 指标数据
  `metric_value` DECIMAL(20,6) NOT NULL COMMENT '指标值',
  `metric_unit` VARCHAR(50) NULL COMMENT '指标单位',
  `value_type` ENUM('integer', 'decimal', 'percentage', 'duration', 'count', 'bytes', 'currency') NOT NULL DEFAULT 'decimal' COMMENT '值类型',
  
  -- 维度标签
  `dimensions` JSON NOT NULL COMMENT '指标维度（用户ID、群组、模型等）',
  `tags` JSON NULL COMMENT '标签信息',
  `labels` JSON NULL COMMENT '标签映射',
  
  -- 时间维度
  `time_bucket` ENUM('minute', 'hour', 'day', 'week', 'month') NOT NULL COMMENT '时间粒度',
  `bucket_start_time` TIMESTAMP NOT NULL COMMENT '时间桶开始时间',
  `bucket_end_time` TIMESTAMP NOT NULL COMMENT '时间桶结束时间',
  
  -- 聚合信息
  `aggregation_type` ENUM('sum', 'avg', 'min', 'max', 'count', 'distinct', 'percentile') NOT NULL COMMENT '聚合类型',
  `sample_count` BIGINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '样本数量',
  `raw_values` JSON NULL COMMENT '原始值列表（用于percentile计算）',
  
  -- 统计扩展
  `min_value` DECIMAL(20,6) NULL COMMENT '最小值',
  `max_value` DECIMAL(20,6) NULL COMMENT '最大值',
  `std_deviation` DECIMAL(20,6) NULL COMMENT '标准差',
  `percentile_50` DECIMAL(20,6) NULL COMMENT '50分位数',
  `percentile_95` DECIMAL(20,6) NULL COMMENT '95分位数',
  `percentile_99` DECIMAL(20,6) NULL COMMENT '99分位数',
  
  -- 质量控制
  `data_quality_score` DECIMAL(3,2) NULL COMMENT '数据质量评分（0-5.0）',
  `anomaly_score` DECIMAL(3,2) NULL COMMENT '异常评分（0-1.0）',
  `is_anomaly` BOOLEAN NOT NULL DEFAULT FALSE COMMENT '是否为异常值',
  `confidence_level` DECIMAL(3,2) NULL COMMENT '置信度（0-1.0）',
  
  -- 关联信息
  `related_conversation_id` VARCHAR(50) NULL COMMENT '关联对话ID',
  `related_trace_id` VARCHAR(64) NULL COMMENT '关联追踪ID',
  `related_user_id` BIGINT NULL COMMENT '关联用户ID',
  `related_session_id` VARCHAR(100) NULL COMMENT '关联会话ID',
  
  -- 时间戳
  `recorded_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '记录时间',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  
  -- 索引设计
  INDEX `idx_metric_category_type` (`metric_category`, `metric_type`),
  INDEX `idx_metric_id_bucket` (`metric_id`, `time_bucket`, `bucket_start_time`),
  INDEX `idx_bucket_time_range` (`bucket_start_time`, `bucket_end_time`),
  INDEX `idx_dimensions_tags` ((CAST(dimensions AS CHAR(255))), (CAST(tags AS CHAR(100)))),
  INDEX `idx_value_anomaly` (`metric_value`, `is_anomaly`),
  INDEX `idx_quality_confidence` (`data_quality_score`, `confidence_level`),
  INDEX `idx_related_entities` (`related_conversation_id`, `related_trace_id`, `related_user_id`),
  INDEX `idx_recorded_time` (`recorded_at` DESC),
  INDEX `idx_aggregation_sample` (`aggregation_type`, `sample_count`),
  
  -- 复合索引优化查询
  INDEX `idx_metric_time_value` (`metric_id`, `bucket_start_time` DESC, `metric_value`),
  INDEX `idx_category_time_dimensions` (`metric_category`, `bucket_start_time`, (CAST(dimensions AS CHAR(100)))),
  
  -- 外键约束
  FOREIGN KEY (`related_conversation_id`) REFERENCES `conversations`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`related_trace_id`) REFERENCES `conversation_traces`(`trace_id`) ON DELETE SET NULL,
  
  -- 分区键（按时间分区）
  PARTITION BY RANGE (YEAR(bucket_start_time) * 100 + MONTH(bucket_start_time)) (
    PARTITION p202509 VALUES LESS THAN (202510),
    PARTITION p202510 VALUES LESS THAN (202511),
    PARTITION p202511 VALUES LESS THAN (202512),
    PARTITION p202512 VALUES LESS THAN (202601),
    PARTITION p202601 VALUES LESS THAN (202602),
    PARTITION p_future VALUES LESS THAN MAXVALUE
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='分析指标表';

-- 3.2 图表配置表
CREATE TABLE IF NOT EXISTS `dashboard_charts` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '图表ID',
  `chart_id` VARCHAR(100) NOT NULL UNIQUE COMMENT '图表唯一标识',
  `chart_name` VARCHAR(200) NOT NULL COMMENT '图表名称',
  `chart_title` VARCHAR(300) NOT NULL COMMENT '图表标题',
  `chart_type` ENUM('line', 'bar', 'pie', 'scatter', 'heatmap', 'gauge', 'table', 'metric_card') NOT NULL COMMENT '图表类型',
  `chart_category` VARCHAR(100) NOT NULL COMMENT '图表分类',
  
  -- 数据查询配置
  `data_source` VARCHAR(200) NOT NULL COMMENT '数据源',
  `query_config` JSON NOT NULL COMMENT '查询配置',
  `metrics_config` JSON NOT NULL COMMENT '指标配置',
  `filters_config` JSON NULL COMMENT '过滤器配置',
  `groupby_config` JSON NULL COMMENT '分组配置',
  
  -- 图表显示配置
  `display_config` JSON NOT NULL COMMENT '显示配置',
  `layout_config` JSON NULL COMMENT '布局配置',
  `style_config` JSON NULL COMMENT '样式配置',
  `interaction_config` JSON NULL COMMENT '交互配置',
  
  -- 时间配置
  `time_range_config` JSON NOT NULL COMMENT '时间范围配置',
  `refresh_interval_seconds` INT UNSIGNED NULL COMMENT '刷新间隔（秒）',
  `auto_refresh` BOOLEAN NOT NULL DEFAULT FALSE COMMENT '是否自动刷新',
  `cache_duration_seconds` INT UNSIGNED NULL COMMENT '缓存时长（秒）',
  
  -- 权限和可见性
  `visibility` ENUM('public', 'private', 'restricted') NOT NULL DEFAULT 'public' COMMENT '可见性',
  `allowed_users` JSON NULL COMMENT '允许访问的用户',
  `allowed_roles` JSON NULL COMMENT '允许访问的角色',
  `access_level` ENUM('read', 'write', 'admin') NOT NULL DEFAULT 'read' COMMENT '访问级别',
  
  -- 状态管理
  `status` ENUM('active', 'inactive', 'deprecated', 'draft') NOT NULL DEFAULT 'active' COMMENT '图表状态',
  `is_featured` BOOLEAN NOT NULL DEFAULT FALSE COMMENT '是否为特色图表',
  `display_order` INT UNSIGNED NULL COMMENT '显示顺序',
  `dashboard_group` VARCHAR(100) NULL COMMENT '仪表板分组',
  
  -- 使用统计
  `view_count` BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '查看次数',
  `last_viewed_at` TIMESTAMP NULL COMMENT '最后查看时间',
  `last_updated_data_at` TIMESTAMP NULL COMMENT '数据最后更新时间',
  `update_frequency` JSON NULL COMMENT '更新频率统计',
  
  -- 性能指标
  `avg_load_time_ms` DECIMAL(8,2) NULL COMMENT '平均加载时间（毫秒）',
  `avg_query_time_ms` DECIMAL(8,2) NULL COMMENT '平均查询时间（毫秒）',
  `data_size_bytes` BIGINT UNSIGNED NULL COMMENT '数据大小（字节）',
  `error_count` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '错误次数',
  `last_error_message` TEXT NULL COMMENT '最后错误信息',
  
  -- 版本控制
  `version` VARCHAR(20) NOT NULL DEFAULT '1.0.0' COMMENT '图表版本',
  `change_log` JSON NULL COMMENT '变更日志',
  `backup_config` JSON NULL COMMENT '备份配置',
  
  -- 元数据
  `description` TEXT NULL COMMENT '图表描述',
  `tags` JSON NULL COMMENT '标签',
  `metadata` JSON NULL COMMENT '元数据',
  `usage_notes` TEXT NULL COMMENT '使用说明',
  
  -- 审核信息
  `created_by` VARCHAR(100) NOT NULL COMMENT '创建者',
  `updated_by` VARCHAR(100) NULL COMMENT '更新者',
  `owner` VARCHAR(100) NOT NULL COMMENT '负责人',
  
  -- 时间戳
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  
  -- 索引设计
  INDEX `idx_chart_category_type` (`chart_category`, `chart_type`),
  INDEX `idx_status_featured` (`status`, `is_featured`),
  INDEX `idx_visibility_access` (`visibility`, `access_level`),
  INDEX `idx_display_order` (`dashboard_group`, `display_order`),
  INDEX `idx_owner_created` (`owner`, `created_at` DESC),
  INDEX `idx_view_stats` (`view_count` DESC, `last_viewed_at` DESC),
  INDEX `idx_performance` (`avg_load_time_ms`, `avg_query_time_ms`),
  INDEX `idx_error_tracking` (`error_count`, `last_error_message`(100)),
  INDEX `idx_refresh_cache` (`auto_refresh`, `cache_duration_seconds`),
  
  -- 全文索引
  FULLTEXT INDEX `ft_chart_search` (`chart_name`, `chart_title`, `description`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='图表配置表';

-- =====================================
-- 4. 创建视图和存储过程
-- =====================================

-- 4.1 对话追踪统计视图
CREATE OR REPLACE VIEW `conversation_trace_stats` AS
SELECT 
    DATE(start_time) as trace_date,
    trace_type,
    status,
    COUNT(*) as trace_count,
    AVG(duration_ms) as avg_duration_ms,
    MIN(duration_ms) as min_duration_ms,
    MAX(duration_ms) as max_duration_ms,
    AVG(ai_processing_ms) as avg_ai_processing_ms,
    AVG(db_query_ms) as avg_db_query_ms,
    COUNT(DISTINCT user_id) as unique_users,
    COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_traces,
    COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_traces,
    (COUNT(CASE WHEN status = 'completed' THEN 1 END) * 100.0 / COUNT(*)) as success_rate
FROM conversation_traces
WHERE start_time >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
GROUP BY DATE(start_time), trace_type, status
ORDER BY trace_date DESC, trace_type, status;

-- 4.2 Prompt使用效果统计视图
CREATE OR REPLACE VIEW `prompt_effectiveness_stats` AS
SELECT 
    template_id,
    template_category,
    template_type,
    COUNT(*) as total_usage,
    COUNT(CASE WHEN execution_status = 'success' THEN 1 END) as successful_usage,
    COUNT(CASE WHEN execution_status = 'failed' THEN 1 END) as failed_usage,
    (COUNT(CASE WHEN execution_status = 'success' THEN 1 END) * 100.0 / COUNT(*)) as success_rate,
    AVG(execution_time_ms) as avg_execution_time_ms,
    AVG(response_quality_score) as avg_quality_score,
    AVG(relevance_score) as avg_relevance_score,
    AVG(coherence_score) as avg_coherence_score,
    COUNT(CASE WHEN user_feedback = 'positive' THEN 1 END) as positive_feedback,
    COUNT(CASE WHEN user_feedback = 'negative' THEN 1 END) as negative_feedback,
    SUM(api_cost) as total_api_cost,
    AVG(api_cost) as avg_api_cost,
    COUNT(CASE WHEN cache_hit = TRUE THEN 1 END) as cache_hits,
    (COUNT(CASE WHEN cache_hit = TRUE THEN 1 END) * 100.0 / COUNT(*)) as cache_hit_rate
FROM prompt_usage_history puh
JOIN dynamic_prompt_templates dpt ON puh.template_id = dpt.template_id
WHERE puh.started_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
GROUP BY template_id, template_category, template_type
ORDER BY success_rate DESC, avg_quality_score DESC;

-- 4.3 系统性能指标视图
CREATE OR REPLACE VIEW `system_performance_metrics` AS
SELECT 
    DATE(bucket_start_time) as metric_date,
    metric_category,
    metric_name,
    AVG(metric_value) as avg_value,
    MIN(metric_value) as min_value,
    MAX(metric_value) as max_value,
    STDDEV(metric_value) as std_deviation,
    COUNT(*) as sample_count,
    SUM(CASE WHEN is_anomaly = TRUE THEN 1 ELSE 0 END) as anomaly_count,
    AVG(data_quality_score) as avg_quality_score
FROM analytics_metrics
WHERE bucket_start_time >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
GROUP BY DATE(bucket_start_time), metric_category, metric_name
ORDER BY metric_date DESC, metric_category, metric_name;

-- 4.4 错误分析视图
CREATE OR REPLACE VIEW `error_analysis_summary` AS
SELECT 
    DATE(first_occurrence) as error_date,
    error_type,
    error_level,
    error_code,
    COUNT(*) as error_instances,
    SUM(occurrence_count) as total_occurrences,
    COUNT(DISTINCT user_id) as affected_users,
    AVG(CASE WHEN resolution_time IS NOT NULL 
        THEN TIMESTAMPDIFF(MINUTE, first_occurrence, resolution_time) 
        END) as avg_resolution_time_minutes,
    COUNT(CASE WHEN resolution_status = 'resolved' THEN 1 END) as resolved_errors,
    COUNT(CASE WHEN user_impact IN ('high', 'critical') THEN 1 END) as high_impact_errors
FROM error_traces
WHERE first_occurrence >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
GROUP BY DATE(first_occurrence), error_type, error_level, error_code
ORDER BY error_date DESC, total_occurrences DESC;

-- =====================================
-- 5. 存储过程
-- =====================================

-- 5.1 清理过期数据的存储过程
DELIMITER //

CREATE PROCEDURE `CleanupIntelligentUpgradeData`(
    IN days_to_keep INT,
    IN batch_size INT DEFAULT 1000
)
BEGIN
    DECLARE total_deleted INT DEFAULT 0;
    DECLARE batch_deleted INT;
    DECLARE done INT DEFAULT FALSE;
    
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;
    
    START TRANSACTION;
    
    -- 清理过期的实时事件
    REPEAT
        DELETE FROM real_time_events 
        WHERE event_timestamp < DATE_SUB(NOW(), INTERVAL days_to_keep DAY)
        LIMIT batch_size;
        
        SET batch_deleted = ROW_COUNT();
        SET total_deleted = total_deleted + batch_deleted;
    UNTIL batch_deleted < batch_size END REPEAT;
    
    -- 清理过期的错误追踪记录
    DELETE FROM error_traces 
    WHERE first_occurrence < DATE_SUB(NOW(), INTERVAL days_to_keep DAY)
    AND resolution_status = 'resolved';
    
    -- 清理过期的处理步骤记录
    DELETE ps FROM processing_steps ps
    JOIN conversation_traces ct ON ps.trace_id = ct.trace_id
    WHERE ct.start_time < DATE_SUB(NOW(), INTERVAL days_to_keep DAY);
    
    -- 清理过期的对话追踪记录
    DELETE FROM conversation_traces 
    WHERE start_time < DATE_SUB(NOW(), INTERVAL days_to_keep DAY);
    
    -- 清理过期的Prompt使用历史
    DELETE FROM prompt_usage_history 
    WHERE started_at < DATE_SUB(NOW(), INTERVAL days_to_keep DAY);
    
    -- 清理过期的分析指标（保留更长时间的聚合数据）
    DELETE FROM analytics_metrics 
    WHERE bucket_start_time < DATE_SUB(NOW(), INTERVAL days_to_keep DAY)
    AND time_bucket IN ('minute', 'hour');
    
    -- 清理过期的缓存
    DELETE FROM prompt_cache 
    WHERE status IN ('expired', 'evicted') 
    OR expires_at < NOW();
    
    COMMIT;
    
    -- 返回清理统计信息
    SELECT 
        total_deleted as total_events_deleted,
        days_to_keep as retention_days,
        NOW() as cleanup_time;
        
    -- 优化表
    ANALYZE TABLE conversation_traces;
    ANALYZE TABLE processing_steps;
    ANALYZE TABLE error_traces;
    ANALYZE TABLE real_time_events;
    ANALYZE TABLE prompt_usage_history;
    ANALYZE TABLE analytics_metrics;
END //

DELIMITER ;

-- 5.2 生成性能报告的存储过程
DELIMITER //

CREATE PROCEDURE `GeneratePerformanceReport`(
    IN report_start_date DATE,
    IN report_end_date DATE
)
BEGIN
    -- 对话追踪性能报告
    SELECT 'Conversation Trace Performance' as report_section;
    SELECT 
        trace_type,
        COUNT(*) as total_traces,
        AVG(duration_ms) as avg_duration_ms,
        AVG(ai_processing_ms) as avg_ai_processing_ms,
        AVG(db_query_ms) as avg_db_query_ms,
        MIN(duration_ms) as min_duration_ms,
        MAX(duration_ms) as max_duration_ms,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_traces,
        (COUNT(CASE WHEN status = 'completed' THEN 1 END) * 100.0 / COUNT(*)) as success_rate
    FROM conversation_traces
    WHERE DATE(start_time) BETWEEN report_start_date AND report_end_date
    GROUP BY trace_type
    ORDER BY avg_duration_ms DESC;
    
    -- Prompt使用效果报告
    SELECT 'Prompt Usage Effectiveness' as report_section;
    SELECT 
        dpt.template_category,
        dpt.template_name,
        COUNT(*) as total_usage,
        AVG(puh.execution_time_ms) as avg_execution_time_ms,
        AVG(puh.response_quality_score) as avg_quality_score,
        AVG(puh.relevance_score) as avg_relevance_score,
        COUNT(CASE WHEN puh.execution_status = 'success' THEN 1 END) as successful_executions,
        (COUNT(CASE WHEN puh.execution_status = 'success' THEN 1 END) * 100.0 / COUNT(*)) as success_rate,
        SUM(puh.api_cost) as total_api_cost,
        COUNT(CASE WHEN puh.cache_hit = TRUE THEN 1 END) as cache_hits,
        (COUNT(CASE WHEN puh.cache_hit = TRUE THEN 1 END) * 100.0 / COUNT(*)) as cache_hit_rate
    FROM prompt_usage_history puh
    JOIN dynamic_prompt_templates dpt ON puh.template_id = dpt.template_id
    WHERE DATE(puh.started_at) BETWEEN report_start_date AND report_end_date
    GROUP BY dpt.template_category, dpt.template_name
    ORDER BY success_rate DESC, avg_quality_score DESC;
    
    -- 系统错误分析报告
    SELECT 'Error Analysis' as report_section;
    SELECT 
        error_type,
        error_level,
        COUNT(*) as error_instances,
        SUM(occurrence_count) as total_occurrences,
        COUNT(DISTINCT user_id) as affected_users,
        COUNT(CASE WHEN user_impact IN ('high', 'critical') THEN 1 END) as high_impact_errors,
        AVG(CASE WHEN resolution_time IS NOT NULL 
            THEN TIMESTAMPDIFF(MINUTE, first_occurrence, resolution_time) 
            END) as avg_resolution_time_minutes
    FROM error_traces
    WHERE DATE(first_occurrence) BETWEEN report_start_date AND report_end_date
    GROUP BY error_type, error_level
    ORDER BY total_occurrences DESC;
END //

DELIMITER ;

-- =====================================
-- 6. 触发器（自动更新统计信息）
-- =====================================

-- 6.1 对话追踪完成时自动更新统计
DELIMITER //

CREATE TRIGGER `tr_conversation_traces_update_stats`
AFTER UPDATE ON `conversation_traces`
FOR EACH ROW
BEGIN
    -- 当追踪状态变为完成时，更新相关统计
    IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
        -- 更新模板使用统计（如果有关联）
        UPDATE dynamic_prompt_templates dpt
        JOIN prompt_usage_history puh ON dpt.template_id = puh.template_id
        SET dpt.usage_count = dpt.usage_count + 1,
            dpt.success_count = dpt.success_count + 1,
            dpt.avg_response_time_ms = (
                (dpt.avg_response_time_ms * dpt.usage_count + NEW.duration_ms) / (dpt.usage_count + 1)
            ),
            dpt.last_used_at = NOW()
        WHERE puh.trace_id = NEW.trace_id;
    END IF;
    
    -- 当追踪失败时，更新错误统计
    IF NEW.status = 'failed' AND OLD.status != 'failed' THEN
        UPDATE dynamic_prompt_templates dpt
        JOIN prompt_usage_history puh ON dpt.template_id = puh.template_id
        SET dpt.failure_count = dpt.failure_count + 1
        WHERE puh.trace_id = NEW.trace_id;
    END IF;
END //

DELIMITER ;

-- 6.2 Prompt使用时自动清理过期缓存
DELIMITER //

CREATE TRIGGER `tr_prompt_cache_cleanup`
AFTER INSERT ON `prompt_usage_history`
FOR EACH ROW
BEGIN
    -- 清理过期的缓存记录
    UPDATE prompt_cache 
    SET status = 'expired'
    WHERE template_id = (
        SELECT template_id FROM dynamic_prompt_templates dpt
        WHERE dpt.template_id = NEW.template_id
    ) AND expires_at < NOW() AND status = 'active';
END //

DELIMITER ;

-- =====================================
-- 7. 初始化数据和配置
-- =====================================

-- 7.1 插入默认的动态Prompt模板
INSERT INTO `dynamic_prompt_templates` (
    `template_id`, `template_name`, `template_category`, `template_type`,
    `template_content`, `template_variables`, `applicable_models`,
    `version`, `status`, `priority`, `created_by`, `description`
) VALUES 
(
    'system_chat_default_v1', 
    '默认聊天系统提示', 
    'chat', 
    'system_prompt',
    '你是一个智能的QQ聊天机器人助手。请以友好、准确、有帮助的方式回复用户的问题。保持对话自然流畅，并根据上下文提供相关信息。',
    '{}',
    '["gemini-2.5-flash", "gemini-1.5-pro"]',
    '1.0.0',
    'active',
    1,
    'system',
    '默认的聊天机器人系统提示模板'
),
(
    'intent_analysis_v1',
    '意图分析提示模板',
    'intent',
    'system_prompt', 
    '请分析用户消息的意图。判断是否为开发需求、功能请求、问题咨询、闲聊等类型。返回JSON格式：{"intent": "类型", "confidence": 0.95, "details": "详细说明"}',
    '{"user_message": "用户消息内容"}',
    '["gemini-2.5-flash"]',
    '1.0.0',
    'active',
    2,
    'system',
    '用于分析用户消息意图的模板'
),
(
    'requirement_processing_v1',
    '需求处理提示模板',
    'requirement',
    'system_prompt',
    '你是一个专业的需求分析师。请详细分析用户的开发需求，提供实现方案和技术建议。格式化回复包含：需求理解、技术方案、实现步骤、注意事项。',
    '{"requirement": "需求内容", "context": "上下文信息"}',
    '["gemini-2.5-flash", "gemini-1.5-pro"]',
    '1.0.0',
    'active',
    3,
    'system',
    '用于处理开发需求的专业模板'
) ON DUPLICATE KEY UPDATE 
    `updated_at` = CURRENT_TIMESTAMP;

-- 7.2 插入默认的仪表板图表配置
INSERT INTO `dashboard_charts` (
    `chart_id`, `chart_name`, `chart_title`, `chart_type`, `chart_category`,
    `data_source`, `query_config`, `metrics_config`, `display_config`,
    `time_range_config`, `auto_refresh`, `refresh_interval_seconds`,
    `created_by`, `owner`, `description`
) VALUES 
(
    'conversation_traces_overview',
    '对话追踪概览',
    '对话追踪性能概览',
    'line',
    'performance',
    'conversation_traces',
    '{"table": "conversation_traces", "groupBy": "trace_type", "timeField": "start_time"}',
    '{"metrics": ["count", "avg_duration_ms", "success_rate"]}',
    '{"showLegend": true, "showTooltip": true, "theme": "default"}',
    '{"default": "last_7_days", "options": ["last_24_hours", "last_7_days", "last_30_days"]}',
    true,
    300,
    'system',
    'system',
    '显示对话追踪的整体性能指标和趋势'
),
(
    'prompt_usage_stats',
    'Prompt使用统计',
    'Prompt模板使用效果分析',
    'bar',
    'ai_analysis',
    'prompt_usage_history',
    '{"table": "prompt_usage_history", "joins": [{"table": "dynamic_prompt_templates", "on": "template_id"}]}',
    '{"metrics": ["usage_count", "success_rate", "avg_quality_score", "cache_hit_rate"]}',
    '{"orientation": "vertical", "showValues": true, "colorScheme": "blue"}',
    '{"default": "last_30_days", "options": ["last_7_days", "last_30_days", "last_90_days"]}',
    true,
    600,
    'system',
    'system',
    '分析各个Prompt模板的使用情况和效果'
),
(
    'error_tracking_dashboard',
    '错误追踪仪表板',
    '系统错误分析和监控',
    'heatmap',
    'monitoring',
    'error_traces',
    '{"table": "error_traces", "groupBy": ["error_type", "error_level"]}',
    '{"metrics": ["error_count", "affected_users", "avg_resolution_time"]}',
    '{"colorScale": "red", "showAnnotations": true}',
    '{"default": "last_7_days", "options": ["last_24_hours", "last_7_days", "last_30_days"]}',
    true,
    180,
    'system',
    'system',
    '实时监控系统错误和异常情况'
) ON DUPLICATE KEY UPDATE 
    `updated_at` = CURRENT_TIMESTAMP;

-- =====================================
-- 8. 权限和安全配置
-- =====================================

-- 创建专用数据库用户（生产环境建议）
-- CREATE USER 'qqbot_analytics'@'localhost' IDENTIFIED BY 'complex_password_here';
-- GRANT SELECT, INSERT, UPDATE, DELETE ON qqbot_db.conversation_traces TO 'qqbot_analytics'@'localhost';
-- GRANT SELECT, INSERT, UPDATE, DELETE ON qqbot_db.processing_steps TO 'qqbot_analytics'@'localhost';
-- GRANT SELECT, INSERT, UPDATE, DELETE ON qqbot_db.error_traces TO 'qqbot_analytics'@'localhost';
-- GRANT SELECT, INSERT, UPDATE, DELETE ON qqbot_db.real_time_events TO 'qqbot_analytics'@'localhost';
-- GRANT SELECT, INSERT, UPDATE, DELETE ON qqbot_db.dynamic_prompt_templates TO 'qqbot_analytics'@'localhost';
-- GRANT SELECT, INSERT, UPDATE, DELETE ON qqbot_db.prompt_usage_history TO 'qqbot_analytics'@'localhost';
-- GRANT SELECT, INSERT, UPDATE, DELETE ON qqbot_db.prompt_cache TO 'qqbot_analytics'@'localhost';
-- GRANT SELECT, INSERT, UPDATE, DELETE ON qqbot_db.analytics_metrics TO 'qqbot_analytics'@'localhost';
-- GRANT SELECT, INSERT, UPDATE, DELETE ON qqbot_db.dashboard_charts TO 'qqbot_analytics'@'localhost';
-- FLUSH PRIVILEGES;

-- =====================================
-- 9. 创建索引和优化
-- =====================================

-- 额外的性能优化索引
CREATE INDEX IF NOT EXISTS `idx_traces_user_session_time` ON `conversation_traces` (`user_id`, `session_id`, `start_time` DESC);
CREATE INDEX IF NOT EXISTS `idx_steps_trace_status_time` ON `processing_steps` (`trace_id`, `status`, `start_time`);
CREATE INDEX IF NOT EXISTS `idx_events_type_priority_time` ON `real_time_events` (`event_type`, `priority`, `event_timestamp` DESC);
CREATE INDEX IF NOT EXISTS `idx_metrics_category_bucket_time` ON `analytics_metrics` (`metric_category`, `time_bucket`, `bucket_start_time` DESC);
CREATE INDEX IF NOT EXISTS `idx_prompt_template_status_priority` ON `dynamic_prompt_templates` (`status`, `priority`, `usage_count` DESC);
CREATE INDEX IF NOT EXISTS `idx_usage_template_execution_time` ON `prompt_usage_history` (`template_id`, `execution_status`, `started_at` DESC);

-- =====================================
-- 10. 数据完整性检查
-- =====================================

-- 检查新创建的表
SHOW TABLES LIKE '%conversation_traces%';
SHOW TABLES LIKE '%processing_steps%';
SHOW TABLES LIKE '%error_traces%';
SHOW TABLES LIKE '%real_time_events%';
SHOW TABLES LIKE '%dynamic_prompt_templates%';
SHOW TABLES LIKE '%prompt_usage_history%';
SHOW TABLES LIKE '%prompt_cache%';
SHOW TABLES LIKE '%analytics_metrics%';
SHOW TABLES LIKE '%dashboard_charts%';

-- 显示表结构（用于验证）
DESCRIBE conversation_traces;
DESCRIBE processing_steps;
DESCRIBE error_traces;
DESCRIBE real_time_events;
DESCRIBE dynamic_prompt_templates;
DESCRIBE prompt_usage_history;
DESCRIBE prompt_cache;
DESCRIBE analytics_metrics;
DESCRIBE dashboard_charts;

-- =====================================
-- 完成提示信息
-- =====================================

SELECT 'QQ机器人智能化升级数据库架构扩展完成!' as message,
       '新增9个核心表' as tables_added,
       '4个统计视图' as views_created,
       '2个存储过程' as procedures_created,
       '2个触发器' as triggers_created,
       '完整的索引优化' as optimization_applied,
       '分区表设计' as partitioning_enabled,
       '现在可以开始使用智能化功能' as status;

-- 迁移完成时间戳
INSERT INTO system_logs (log_level, module_name, message, extra_data)
VALUES ('INFO', 'database_migration', 'Intelligent upgrade database migration completed', 
        JSON_OBJECT(
            'migration_file', '004_intelligent_upgrade.sql',
            'tables_created', 9,
            'views_created', 4,
            'procedures_created', 2,
            'completion_time', NOW()
        ));