/**
 * 🔧 P2重构：统一错误处理系统
 * 标准化所有服务的错误处理、分类、日志记录和恢复机制
 */

import { logger } from './logger';

// ============================================================================
// 📋 错误类型定义
// ============================================================================

export enum ErrorType {
  // 配置相关错误
  CONFIG_NOT_FOUND = 'CONFIG_NOT_FOUND',
  CONFIG_INVALID = 'CONFIG_INVALID',
  CONFIG_CONVERSION_FAILED = 'CONFIG_CONVERSION_FAILED',

  // 数据库相关错误
  DATABASE_CONNECTION_FAILED = 'DATABASE_CONNECTION_FAILED',
  DATABASE_QUERY_FAILED = 'DATABASE_QUERY_FAILED',
  DATABASE_CONSTRAINT_VIOLATION = 'DATABASE_CONSTRAINT_VIOLATION',

  // LLM API相关错误
  LLM_API_UNAUTHORIZED = 'LLM_API_UNAUTHORIZED',
  LLM_API_QUOTA_EXCEEDED = 'LLM_API_QUOTA_EXCEEDED',
  LLM_API_TIMEOUT = 'LLM_API_TIMEOUT',
  LLM_API_INVALID_REQUEST = 'LLM_API_INVALID_REQUEST',
  LLM_API_SERVICE_UNAVAILABLE = 'LLM_API_SERVICE_UNAVAILABLE',

  // Token管理相关错误
  TOKEN_NOT_AVAILABLE = 'TOKEN_NOT_AVAILABLE',
  TOKEN_BLACKLISTED = 'TOKEN_BLACKLISTED',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',

  // 网络相关错误
  NETWORK_TIMEOUT = 'NETWORK_TIMEOUT',
  NETWORK_CONNECTION_FAILED = 'NETWORK_CONNECTION_FAILED',

  // 系统相关错误
  INSUFFICIENT_MEMORY = 'INSUFFICIENT_MEMORY',
  DISK_SPACE_FULL = 'DISK_SPACE_FULL',
  PERMISSION_DENIED = 'PERMISSION_DENIED',

  // 业务逻辑错误
  INVALID_INPUT = 'INVALID_INPUT',
  RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',
  OPERATION_NOT_ALLOWED = 'OPERATION_NOT_ALLOWED',

  // 未知错误
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

export enum ErrorSeverity {
  LOW = 'low',           // 不影响核心功能
  MEDIUM = 'medium',     // 影响部分功能
  HIGH = 'high',         // 影响核心功能
  CRITICAL = 'critical'  // 系统无法正常运行
}

export enum ErrorCategory {
  CONFIGURATION = 'configuration',
  DATABASE = 'database',
  API = 'api',
  NETWORK = 'network',
  SYSTEM = 'system',
  BUSINESS = 'business',
  UNKNOWN = 'unknown'
}

export interface ErrorContext {
  service: string;
  method?: string;
  traceId?: string;
  userId?: number;
  agentType?: string;
  modelName?: string;
  metadata?: Record<string, any>;
}

export interface ErrorDetails {
  type: ErrorType;
  category: ErrorCategory;
  severity: ErrorSeverity;
  message: string;
  originalError?: Error;
  context: ErrorContext;
  timestamp: Date;
  retryable: boolean;
  suggestedAction?: string;
}

// ============================================================================
// 🏗️ 标准化错误类
// ============================================================================

export class StandardizedError extends Error {
  public readonly type: ErrorType;
  public readonly category: ErrorCategory;
  public readonly severity: ErrorSeverity;
  public readonly context: ErrorContext;
  public readonly timestamp: Date;
  public readonly retryable: boolean;
  public readonly suggestedAction?: string;
  public readonly originalError?: Error;

  constructor(details: ErrorDetails) {
    super(details.message);
    this.name = 'StandardizedError';
    this.type = details.type;
    this.category = details.category;
    this.severity = details.severity;
    this.context = details.context;
    this.timestamp = details.timestamp;
    this.retryable = details.retryable;
    this.suggestedAction = details.suggestedAction;
    this.originalError = details.originalError;

    // 保持错误堆栈追踪
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, StandardizedError);
    }
  }

  /**
   * 获取错误的完整信息
   */
  public getDetails(): ErrorDetails {
    return {
      type: this.type,
      category: this.category,
      severity: this.severity,
      message: this.message,
      originalError: this.originalError,
      context: this.context,
      timestamp: this.timestamp,
      retryable: this.retryable,
      suggestedAction: this.suggestedAction
    };
  }

  /**
   * 转换为JSON格式（用于日志记录）
   */
  public toJSON(): Record<string, any> {
    return {
      name: this.name,
      type: this.type,
      category: this.category,
      severity: this.severity,
      message: this.message,
      context: this.context,
      timestamp: this.timestamp.toISOString(),
      retryable: this.retryable,
      suggestedAction: this.suggestedAction,
      originalError: this.originalError ? {
        name: this.originalError.name,
        message: this.originalError.message,
        stack: this.originalError.stack
      } : undefined
    };
  }
}

// ============================================================================
// 🛠️ 错误处理器
// ============================================================================

export class ErrorHandler {
  private static instance: ErrorHandler;
  private moduleLogger = logger.createModuleLogger('error-handler');

  // 错误统计
  private errorStats: Map<ErrorType, number> = new Map();
  private categoryCounts: Map<ErrorCategory, number> = new Map();
  private severityCounts: Map<ErrorSeverity, number> = new Map();

  private constructor() {
    this.moduleLogger.info('Error Handler initialized');
  }

  public static getInstance(): ErrorHandler {
    if (!ErrorHandler.instance) {
      ErrorHandler.instance = new ErrorHandler();
    }
    return ErrorHandler.instance;
  }

  // ============================================================================
  // 🔍 错误分类和创建
  // ============================================================================

  /**
   * 从原始错误创建标准化错误
   */
  public createStandardizedError(
    originalError: Error | any,
    context: ErrorContext,
    customType?: ErrorType
  ): StandardizedError {
    const errorType = customType || this.classifyError(originalError);
    const category = this.getErrorCategory(errorType);
    const severity = this.getErrorSeverity(errorType);
    const retryable = this.isRetryable(errorType);
    const suggestedAction = this.getSuggestedAction(errorType);

    const details: ErrorDetails = {
      type: errorType,
      category,
      severity,
      message: this.formatErrorMessage(originalError, errorType),
      originalError: originalError instanceof Error ? originalError : undefined,
      context,
      timestamp: new Date(),
      retryable,
      suggestedAction
    };

    return new StandardizedError(details);
  }

  /**
   * 创建配置错误
   */
  public createConfigError(
    message: string,
    context: ErrorContext,
    type: ErrorType = ErrorType.CONFIG_INVALID
  ): StandardizedError {
    return this.createStandardizedError(new Error(message), context, type);
  }

  /**
   * 创建数据库错误
   */
  public createDatabaseError(
    originalError: Error,
    context: ErrorContext,
    operation?: string
  ): StandardizedError {
    const enhancedContext = { ...context, operation };
    return this.createStandardizedError(originalError, enhancedContext, ErrorType.DATABASE_QUERY_FAILED);
  }

  /**
   * 创建LLM API错误
   */
  public createLLMAPIError(
    originalError: any,
    context: ErrorContext
  ): StandardizedError {
    let errorType = ErrorType.LLM_API_SERVICE_UNAVAILABLE;

    if (originalError.status) {
      switch (originalError.status) {
        case 401:
        case 403:
          errorType = ErrorType.LLM_API_UNAUTHORIZED;
          break;
        case 429:
          errorType = ErrorType.LLM_API_QUOTA_EXCEEDED;
          break;
        case 400:
          errorType = ErrorType.LLM_API_INVALID_REQUEST;
          break;
        case 504:
        case 408:
          errorType = ErrorType.LLM_API_TIMEOUT;
          break;
      }
    }

    return this.createStandardizedError(originalError, context, errorType);
  }

  // ============================================================================
  // 📊 错误分类逻辑
  // ============================================================================

  private classifyError(error: Error | any): ErrorType {
    const message = error.message?.toLowerCase() || '';
    const code = error.code?.toLowerCase() || '';

    // 数据库错误
    if (code.includes('econnrefused') || message.includes('connection')) {
      return ErrorType.DATABASE_CONNECTION_FAILED;
    }

    // 网络错误
    if (code === 'enotfound' || code === 'econnreset') {
      return ErrorType.NETWORK_CONNECTION_FAILED;
    }
    if (code === 'etimedout' || message.includes('timeout')) {
      return ErrorType.NETWORK_TIMEOUT;
    }

    // API错误
    if (error.status) {
      switch (error.status) {
        case 401:
        case 403:
          return ErrorType.LLM_API_UNAUTHORIZED;
        case 429:
          return ErrorType.LLM_API_QUOTA_EXCEEDED;
        case 400:
          return ErrorType.LLM_API_INVALID_REQUEST;
        default:
          return ErrorType.LLM_API_SERVICE_UNAVAILABLE;
      }
    }

    // 配置错误
    if (message.includes('config') || message.includes('configuration')) {
      return ErrorType.CONFIG_INVALID;
    }

    // 系统错误
    if (message.includes('permission') || code === 'eacces') {
      return ErrorType.PERMISSION_DENIED;
    }
    if (message.includes('memory') || message.includes('heap')) {
      return ErrorType.INSUFFICIENT_MEMORY;
    }

    return ErrorType.UNKNOWN_ERROR;
  }

  private getErrorCategory(type: ErrorType): ErrorCategory {
    const categoryMap: Record<ErrorType, ErrorCategory> = {
      [ErrorType.CONFIG_NOT_FOUND]: ErrorCategory.CONFIGURATION,
      [ErrorType.CONFIG_INVALID]: ErrorCategory.CONFIGURATION,
      [ErrorType.CONFIG_CONVERSION_FAILED]: ErrorCategory.CONFIGURATION,

      [ErrorType.DATABASE_CONNECTION_FAILED]: ErrorCategory.DATABASE,
      [ErrorType.DATABASE_QUERY_FAILED]: ErrorCategory.DATABASE,
      [ErrorType.DATABASE_CONSTRAINT_VIOLATION]: ErrorCategory.DATABASE,

      [ErrorType.LLM_API_UNAUTHORIZED]: ErrorCategory.API,
      [ErrorType.LLM_API_QUOTA_EXCEEDED]: ErrorCategory.API,
      [ErrorType.LLM_API_TIMEOUT]: ErrorCategory.API,
      [ErrorType.LLM_API_INVALID_REQUEST]: ErrorCategory.API,
      [ErrorType.LLM_API_SERVICE_UNAVAILABLE]: ErrorCategory.API,

      [ErrorType.TOKEN_NOT_AVAILABLE]: ErrorCategory.API,
      [ErrorType.TOKEN_BLACKLISTED]: ErrorCategory.API,
      [ErrorType.TOKEN_EXPIRED]: ErrorCategory.API,

      [ErrorType.NETWORK_TIMEOUT]: ErrorCategory.NETWORK,
      [ErrorType.NETWORK_CONNECTION_FAILED]: ErrorCategory.NETWORK,

      [ErrorType.INSUFFICIENT_MEMORY]: ErrorCategory.SYSTEM,
      [ErrorType.DISK_SPACE_FULL]: ErrorCategory.SYSTEM,
      [ErrorType.PERMISSION_DENIED]: ErrorCategory.SYSTEM,

      [ErrorType.INVALID_INPUT]: ErrorCategory.BUSINESS,
      [ErrorType.RESOURCE_NOT_FOUND]: ErrorCategory.BUSINESS,
      [ErrorType.OPERATION_NOT_ALLOWED]: ErrorCategory.BUSINESS,

      [ErrorType.UNKNOWN_ERROR]: ErrorCategory.UNKNOWN
    };

    return categoryMap[type] || ErrorCategory.UNKNOWN;
  }

  private getErrorSeverity(type: ErrorType): ErrorSeverity {
    const severityMap: Record<ErrorType, ErrorSeverity> = {
      [ErrorType.CONFIG_NOT_FOUND]: ErrorSeverity.HIGH,
      [ErrorType.CONFIG_INVALID]: ErrorSeverity.HIGH,
      [ErrorType.CONFIG_CONVERSION_FAILED]: ErrorSeverity.MEDIUM,

      [ErrorType.DATABASE_CONNECTION_FAILED]: ErrorSeverity.CRITICAL,
      [ErrorType.DATABASE_QUERY_FAILED]: ErrorSeverity.HIGH,
      [ErrorType.DATABASE_CONSTRAINT_VIOLATION]: ErrorSeverity.MEDIUM,

      [ErrorType.LLM_API_UNAUTHORIZED]: ErrorSeverity.HIGH,
      [ErrorType.LLM_API_QUOTA_EXCEEDED]: ErrorSeverity.HIGH,
      [ErrorType.LLM_API_TIMEOUT]: ErrorSeverity.MEDIUM,
      [ErrorType.LLM_API_INVALID_REQUEST]: ErrorSeverity.MEDIUM,
      [ErrorType.LLM_API_SERVICE_UNAVAILABLE]: ErrorSeverity.HIGH,

      [ErrorType.TOKEN_NOT_AVAILABLE]: ErrorSeverity.HIGH,
      [ErrorType.TOKEN_BLACKLISTED]: ErrorSeverity.MEDIUM,
      [ErrorType.TOKEN_EXPIRED]: ErrorSeverity.MEDIUM,

      [ErrorType.NETWORK_TIMEOUT]: ErrorSeverity.MEDIUM,
      [ErrorType.NETWORK_CONNECTION_FAILED]: ErrorSeverity.HIGH,

      [ErrorType.INSUFFICIENT_MEMORY]: ErrorSeverity.CRITICAL,
      [ErrorType.DISK_SPACE_FULL]: ErrorSeverity.HIGH,
      [ErrorType.PERMISSION_DENIED]: ErrorSeverity.HIGH,

      [ErrorType.INVALID_INPUT]: ErrorSeverity.LOW,
      [ErrorType.RESOURCE_NOT_FOUND]: ErrorSeverity.MEDIUM,
      [ErrorType.OPERATION_NOT_ALLOWED]: ErrorSeverity.MEDIUM,

      [ErrorType.UNKNOWN_ERROR]: ErrorSeverity.MEDIUM
    };

    return severityMap[type] || ErrorSeverity.MEDIUM;
  }

  private isRetryable(type: ErrorType): boolean {
    const retryableErrors = [
      ErrorType.LLM_API_TIMEOUT,
      ErrorType.LLM_API_SERVICE_UNAVAILABLE,
      ErrorType.NETWORK_TIMEOUT,
      ErrorType.NETWORK_CONNECTION_FAILED,
      ErrorType.DATABASE_CONNECTION_FAILED
    ];

    return retryableErrors.includes(type);
  }

  private getSuggestedAction(type: ErrorType): string | undefined {
    const actionMap: Record<ErrorType, string> = {
      // 配置相关错误
      [ErrorType.CONFIG_NOT_FOUND]: '检查配置文件是否存在，或创建默认配置',
      [ErrorType.CONFIG_INVALID]: '验证配置格式，修复无效字段',
      [ErrorType.CONFIG_CONVERSION_FAILED]: '检查配置转换逻辑和数据格式',

      // 数据库相关错误
      [ErrorType.DATABASE_CONNECTION_FAILED]: '检查数据库服务状态和连接参数',
      [ErrorType.DATABASE_QUERY_FAILED]: '检查SQL语法和数据完整性',
      [ErrorType.DATABASE_CONSTRAINT_VIOLATION]: '检查数据约束和唯一性要求',

      // LLM API相关错误
      [ErrorType.LLM_API_UNAUTHORIZED]: '检查API密钥是否有效和权限设置',
      [ErrorType.LLM_API_QUOTA_EXCEEDED]: '等待配额重置或切换到其他Token',
      [ErrorType.LLM_API_TIMEOUT]: '增加API超时时间或检查网络连接',
      [ErrorType.LLM_API_INVALID_REQUEST]: '检查API请求格式和参数',
      [ErrorType.LLM_API_SERVICE_UNAVAILABLE]: '等待服务恢复或使用备用API',

      // Token管理相关错误
      [ErrorType.TOKEN_NOT_AVAILABLE]: '添加新的API Token或等待现有Token恢复',
      [ErrorType.TOKEN_BLACKLISTED]: '等待黑名单到期或使用其他Token',
      [ErrorType.TOKEN_EXPIRED]: '更新过期的Token',

      // 网络相关错误
      [ErrorType.NETWORK_TIMEOUT]: '检查网络连接，增加超时时间',
      [ErrorType.NETWORK_CONNECTION_FAILED]: '检查网络配置和防火墙设置',

      // 系统相关错误
      [ErrorType.INSUFFICIENT_MEMORY]: '增加系统内存或优化内存使用',
      [ErrorType.DISK_SPACE_FULL]: '清理磁盘空间或扩展存储',
      [ErrorType.PERMISSION_DENIED]: '检查文件/目录权限设置',

      // 业务逻辑错误
      [ErrorType.INVALID_INPUT]: '检查输入参数格式和有效性',
      [ErrorType.RESOURCE_NOT_FOUND]: '确认资源是否存在或创建所需资源',
      [ErrorType.OPERATION_NOT_ALLOWED]: '检查操作权限和业务规则',

      // 未知错误
      [ErrorType.UNKNOWN_ERROR]: '检查日志详情，联系技术支持'
    };

    return actionMap[type];
  }

  private formatErrorMessage(error: Error | any, type: ErrorType): string {
    const originalMessage = error.message || error.toString() || 'Unknown error';
    const typeDescription = type.replace(/_/g, ' ').toLowerCase();

    return `${typeDescription}: ${originalMessage}`;
  }

  // ============================================================================
  // 📝 错误处理和记录
  // ============================================================================

  /**
   * 处理错误（记录日志和统计）
   */
  public handleError(error: StandardizedError): void {
    // 更新统计
    this.updateErrorStats(error);

    // 记录日志
    this.logError(error);

    // 特殊处理高严重性错误
    if (error.severity === ErrorSeverity.CRITICAL) {
      this.handleCriticalError(error);
    }
  }

  /**
   * 安全地执行操作并处理错误
   */
  public async safeExecute<T>(
    operation: () => Promise<T>,
    context: ErrorContext,
    defaultValue?: T
  ): Promise<T | undefined> {
    try {
      return await operation();
    } catch (error) {
      const standardizedError = this.createStandardizedError(error, context);
      this.handleError(standardizedError);

      if (defaultValue !== undefined) {
        return defaultValue;
      }

      // 如果错误可重试，可以在这里实现重试逻辑
      if (standardizedError.retryable) {
        this.moduleLogger.warn('Operation failed but is retryable', {
          errorType: standardizedError.type,
          context: standardizedError.context
        });
      }

      return undefined;
    }
  }

  /**
   * 带重试的安全执行
   */
  public async safeExecuteWithRetry<T>(
    operation: () => Promise<T>,
    context: ErrorContext,
    maxRetries: number = 3,
    defaultValue?: T
  ): Promise<T | undefined> {
    let lastError: StandardizedError | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = this.createStandardizedError(error, {
          ...context,
          metadata: { ...context.metadata, attempt, maxRetries }
        });

        if (!lastError.retryable || attempt === maxRetries) {
          this.handleError(lastError);
          break;
        }

        this.moduleLogger.warn(`Operation failed, retrying (${attempt}/${maxRetries})`, {
          errorType: lastError.type,
          context: lastError.context
        });

        // 指数退避
        await this.delay(Math.pow(2, attempt) * 1000);
      }
    }

    return defaultValue;
  }

  // ============================================================================
  // 📊 统计和监控
  // ============================================================================

  private updateErrorStats(error: StandardizedError): void {
    // 更新错误类型统计
    const currentCount = this.errorStats.get(error.type) || 0;
    this.errorStats.set(error.type, currentCount + 1);

    // 更新类别统计
    const categoryCount = this.categoryCounts.get(error.category) || 0;
    this.categoryCounts.set(error.category, categoryCount + 1);

    // 更新严重性统计
    const severityCount = this.severityCounts.get(error.severity) || 0;
    this.severityCounts.set(error.severity, severityCount + 1);
  }

  private logError(error: StandardizedError): void {
    const logLevel = this.getLogLevel(error.severity);
    const logData = {
      errorType: error.type,
      category: error.category,
      severity: error.severity,
      context: error.context,
      retryable: error.retryable,
      suggestedAction: error.suggestedAction,
      originalError: error.originalError ? {
        name: error.originalError.name,
        message: error.originalError.message
      } : undefined
    };

    switch (logLevel) {
      case 'error':
        this.moduleLogger.error(error.message, logData);
        break;
      case 'warn':
        this.moduleLogger.warn(error.message, logData);
        break;
      default:
        this.moduleLogger.info(error.message, logData);
    }
  }

  private getLogLevel(severity: ErrorSeverity): 'error' | 'warn' | 'info' {
    switch (severity) {
      case ErrorSeverity.CRITICAL:
      case ErrorSeverity.HIGH:
        return 'error';
      case ErrorSeverity.MEDIUM:
        return 'warn';
      default:
        return 'info';
    }
  }

  private handleCriticalError(error: StandardizedError): void {
    this.moduleLogger.error('CRITICAL ERROR DETECTED - Immediate attention required', {
      errorDetails: error.getDetails(),
      systemStatus: 'degraded'
    });

    // 这里可以添加更多的关键错误处理逻辑，比如：
    // - 发送告警通知
    // - 自动重启服务
    // - 激活降级模式
  }

  /**
   * 获取错误统计
   */
  public getErrorStats(): {
    byType: Record<string, number>;
    byCategory: Record<string, number>;
    bySeverity: Record<string, number>;
    total: number;
  } {
    const byType: Record<string, number> = {};
    this.errorStats.forEach((count, type) => {
      byType[type] = count;
    });

    const byCategory: Record<string, number> = {};
    this.categoryCounts.forEach((count, category) => {
      byCategory[category] = count;
    });

    const bySeverity: Record<string, number> = {};
    this.severityCounts.forEach((count, severity) => {
      bySeverity[severity] = count;
    });

    const total = Array.from(this.errorStats.values()).reduce((sum, count) => sum + count, 0);

    return { byType, byCategory, bySeverity, total };
  }

  /**
   * 清理错误统计
   */
  public clearStats(): void {
    this.errorStats.clear();
    this.categoryCounts.clear();
    this.severityCounts.clear();
    this.moduleLogger.info('Error statistics cleared');
  }

  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================================
// 🎯 导出便捷函数
// ============================================================================

export const errorHandler = ErrorHandler.getInstance();

export function createStandardizedError(
  originalError: Error | any,
  context: ErrorContext,
  customType?: ErrorType
): StandardizedError {
  return errorHandler.createStandardizedError(originalError, context, customType);
}

export function createConfigError(
  message: string,
  context: ErrorContext
): StandardizedError {
  return errorHandler.createConfigError(message, context);
}

export function createDatabaseError(
  originalError: Error,
  context: ErrorContext,
  operation?: string
): StandardizedError {
  return errorHandler.createDatabaseError(originalError, context, operation);
}

export function createLLMAPIError(
  originalError: any,
  context: ErrorContext
): StandardizedError {
  return errorHandler.createLLMAPIError(originalError, context);
}

export async function safeExecute<T>(
  operation: () => Promise<T>,
  context: ErrorContext,
  defaultValue?: T
): Promise<T | undefined> {
  return errorHandler.safeExecute(operation, context, defaultValue);
}

export async function safeExecuteWithRetry<T>(
  operation: () => Promise<T>,
  context: ErrorContext,
  maxRetries: number = 3,
  defaultValue?: T
): Promise<T | undefined> {
  return errorHandler.safeExecuteWithRetry(operation, context, maxRetries, defaultValue);
}

export default ErrorHandler;