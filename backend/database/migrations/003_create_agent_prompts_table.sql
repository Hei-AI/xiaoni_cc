-- 创建Agent Prompts管理表
-- 支持多Agent协作的提示词管理系统

CREATE TABLE IF NOT EXISTS `agent_prompts` (
  `id` VARCHAR(36) PRIMARY KEY COMMENT 'UUID标识符',
  `agent_type` VARCHAR(50) NOT NULL COMMENT 'Agent类型(如intent_analyzer, requirement_processor)',
  `prompt_name` VARCHAR(100) NOT NULL COMMENT '提示词名称',
  `system_instructions` TEXT NOT NULL COMMENT '系统指令',
  `user_prompt_template` TEXT NULL COMMENT '用户提示词模板',
  `context_variables` JSON NULL COMMENT '上下文变量定义',
  `model_config` JSON NULL COMMENT '模型配置(温度、token限制等)',
  
  -- 状态管理
  `is_active` BOOLEAN NOT NULL DEFAULT TRUE COMMENT '是否激活',
  `version` INT NOT NULL DEFAULT 1 COMMENT '版本号',
  
  -- 元数据
  `description` TEXT NULL COMMENT '提示词描述',
  `created_by` VARCHAR(50) NOT NULL DEFAULT 'system' COMMENT '创建者',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  
  -- 索引
  UNIQUE KEY `unique_agent_prompt` (`agent_type`, `prompt_name`),
  INDEX `idx_agent_type` (`agent_type`),
  INDEX `idx_is_active` (`is_active`),
  INDEX `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Agent提示词管理表';

-- 插入默认的意图分析提示词
INSERT INTO `agent_prompts` (
  `id`, `agent_type`, `prompt_name`, `system_instructions`, `user_prompt_template`,
  `context_variables`, `model_config`, `description`, `created_by`
) VALUES (
  UUID(),
  'intent_analyzer',
  'requirement_analysis',
  '你是一个专业的需求分析师，负责分析用户消息是否包含开发需求或技术问题。

分析标准：
1. 开发需求：包含"实现"、"开发"、"修改"、"修复"、"优化"、"添加功能"等词汇
2. 技术问题：询问系统架构、代码逻辑、技术方案等
3. 复杂度评估：包含"系统"、"模块"、"架构"关键词或消息长度>100字符标记为复杂

请返回JSON格式：
{
  "is_requirement": boolean,
  "confidence": number (0-1),
  "complexity": "simple" | "medium" | "complex",
  "keywords": string[],
  "reasoning": string
}',
  '分析以下用户消息是否为开发需求：\n\n用户消息：{{user_message}}',
  JSON_OBJECT(
    'user_message', 'string'
  ),
  JSON_OBJECT(
    'temperature', 0.1,
    'max_tokens', 500
  ),
  '用于分析用户消息意图的默认提示词',
  'system'
) ON DUPLICATE KEY UPDATE
  `system_instructions` = VALUES(`system_instructions`),
  `updated_at` = CURRENT_TIMESTAMP;