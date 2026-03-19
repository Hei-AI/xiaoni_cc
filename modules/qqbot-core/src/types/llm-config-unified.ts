/**
 * 🔄 统一LLM配置系统 - P0重构
 * 整合所有配置接口，消除配置系统的历史包袱
 */

import {
  GenerationConfig,
  ThinkingConfig,
  SafetyConfig,
  FunctionCallingConfig,
  GoogleSearchConfig,
  UrlContextConfig,
  StructuredOutputConfig
} from './index';

// ============================================================================
// 🎯 核心统一配置接口
// ============================================================================

/**
 * 统一的LLM配置接口 - 替代所有legacy配置
 * 这是重构后的主要配置接口
 */
export interface UnifiedLLMConfig {
  // 📝 基础信息
  id: string;
  name: string;
  description?: string;
  category: LLMConfigCategory;

  // 🤖 模型配置
  model: ModelConfig;

  // ⚙️ 生成参数
  generation: GenerationConfig;

  // 🧠 思考模式 (可选)
  thinking?: ThinkingConfig;

  // 🛡️ 安全设置
  safety: SafetyConfig[];

  // 🔧 工具配置
  tools: UnifiedToolConfig;

  // 🌐 上下文配置
  context: ContextConfig;

  // 📊 性能配置
  performance: PerformanceConfig;

  // 🔄 版本控制
  version: ConfigVersion;
}

/**
 * 模型配置 - 统一模型相关设置
 */
export interface ModelConfig {
  // 模型名称 (如: gemini-2.5-flash, gemini-1.5-pro)
  name: string;

  // 供应商信息
  provider: 'google' | 'google-gemini-cli' | 'google-legacy' | 'openai' | 'codex' | 'anthropic' | 'custom';

  // 允许使用的Token ID列表 (绑定特定tokens)
  allowedTokenIds?: number[];

  // 模型特定参数
  providerSpecific?: Record<string, any>;

  // 降级模型 (当主模型不可用时)
  fallbackModels?: string[];
}

/**
 * 统一工具配置 - 整合所有工具相关功能
 */
export interface UnifiedToolConfig {
  // 函数调用
  functionCalling?: FunctionCallingConfig;

  // Google搜索
  googleSearch?: GoogleSearchConfig;

  // URL上下文
  urlContext?: UrlContextConfig;

  // 结构化输出
  structuredOutput?: StructuredOutputConfig;

  // 预定义工具集
  predefinedTools?: PredefinedToolsConfig;

  // 自定义工具
  customTools?: CustomToolConfig[];
}

/**
 * 上下文配置 - 统一上下文管理
 */
export interface ContextConfig {
  // 最大上下文长度
  maxContextLength?: number;

  // 历史消息窗口大小
  historyWindowSize?: number;

  // 上下文压缩策略
  compressionStrategy?: 'none' | 'summarize' | 'sliding_window' | 'smart';

  // 系统指令
  systemInstruction?: string;

  // 上下文变量
  variables?: Record<string, string>;

  // 角色设定
  roleDefinition?: RoleConfig;
}

/**
 * 性能配置 - 统一性能相关设置
 */
export interface PerformanceConfig {
  // 超时设置 (毫秒)
  timeout?: number;

  // 重试配置
  retry?: RetryConfig;

  // 缓存策略
  cache?: CacheConfig;

  // 并发控制
  concurrency?: ConcurrencyConfig;

  // 负载均衡
  loadBalancing?: LoadBalancingConfig;
}

/**
 * 版本控制 - 配置版本管理
 */
export interface ConfigVersion {
  // 版本号
  version: string;

  // 创建时间
  createdAt: Date;

  // 更新时间
  updatedAt: Date;

  // 创建者
  createdBy: string;

  // 更新者
  updatedBy?: string;

  // 变更说明
  changelog?: string;

  // 是否激活
  isActive: boolean;

  // 继承自哪个版本
  parentVersion?: string;
}

// ============================================================================
// 🏷️ 支持类型定义
// ============================================================================

export type LLMConfigCategory =
  | 'chat_bot'           // 聊天机器人
  | 'intent_analyzer'    // 意图分析
  | 'persona_chat'       // 人格化聊天
  | 'requirement_processor' // 需求处理
  | 'decision_engine'    // 决策引擎
  | 'custom';            // 自定义

export interface RoleConfig {
  // 角色名称
  name: string;

  // 角色描述
  description: string;

  // 人格特征
  personality?: PersonalityTraits;

  // 专业领域
  expertise?: string[];

  // 响应风格
  responseStyle?: ResponseStyleConfig;
}

export interface PersonalityTraits {
  // 友好程度 (0-1)
  friendliness?: number;

  // 专业程度 (0-1)
  professionalism?: number;

  // 创造性 (0-1)
  creativity?: number;

  // 幽默感 (0-1)
  humor?: number;

  // 同理心 (0-1)
  empathy?: number;
}

export interface ResponseStyleConfig {
  // 长度偏好
  lengthPreference: 'concise' | 'balanced' | 'detailed';

  // 语调
  tone: 'formal' | 'friendly' | 'professional' | 'casual';

  // 是否使用表情符号
  useEmojis?: boolean;

  // 语言风格
  languageStyle?: 'simple' | 'technical' | 'academic' | 'conversational';
}

export interface PredefinedToolsConfig {
  // 启用的工具列表
  enabledTools: string[];

  // 工具配置参数
  toolConfigs?: Record<string, any>;

  // 工具调用模式
  callingMode: 'AUTO' | 'MANUAL' | 'ON_DEMAND';
}

export interface CustomToolConfig {
  id: string;
  name: string;
  description: string;
  parameters: Record<string, any>;
  endpoint?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
}

export interface RetryConfig {
  // 最大重试次数
  maxRetries: number;

  // 重试间隔 (毫秒)
  retryDelayMs: number;

  // 指数退避
  exponentialBackoff?: boolean;

  // 可重试的错误类型
  retryableErrors?: string[];
}

export interface CacheConfig {
  // 是否启用缓存
  enabled: boolean;

  // 缓存TTL (秒)
  ttlSeconds?: number;

  // 缓存键策略
  keyStrategy?: 'prompt_hash' | 'full_context' | 'custom';

  // 缓存大小限制
  maxSize?: number;
}

export interface ConcurrencyConfig {
  // 最大并发数
  maxConcurrent: number;

  // 队列长度限制
  queueLimit?: number;

  // 超时时间 (毫秒)
  queueTimeoutMs?: number;
}

export interface LoadBalancingConfig {
  // 负载均衡策略
  strategy: 'round_robin' | 'random' | 'least_connections' | 'weighted';

  // 权重配置 (仅weighted策略)
  weights?: Record<string, number>;

  // 健康检查
  healthCheck?: boolean;
}

// ============================================================================
// 🔄 简化的配置验证接口
// ============================================================================

export interface ConfigValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  field: string;
  message: string;
  severity: 'error' | 'warning' | 'info';
}

export interface ValidationWarning {
  field: string;
  message: string;
  recommendation?: string;
}

