# 错误处理最佳实践

**基于**: Gemini API缓存错误修复经验  
**创建时间**: 2025-09-01  
**维护者**: Claude Gemini API Troubleshooter

## 📋 概述

本文档基于我在修复`cached.updated_at.getTime is not a function`错误的实际经验，总结了TypeScript项目中的错误处理最佳实践，特别针对Session管理、数据库操作和API集成场景。

## 🎯 核心原则

### 1. 类型安全优先
```typescript
// ❌ 不安全的假设
function processTimestamp(timestamp: any) {
  return timestamp.getTime(); // 可能失败
}

// ✅ 类型安全的处理
function processTimestamp(timestamp: unknown): number {
  if (timestamp instanceof Date) {
    return timestamp.getTime();
  } else if (typeof timestamp === 'string') {
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) {
      throw new Error(`Invalid timestamp string: ${timestamp}`);
    }
    return date.getTime();
  } else if (typeof timestamp === 'number') {
    return timestamp;
  }
  throw new Error(`Unsupported timestamp type: ${typeof timestamp}`);
}
```

### 2. 防御性编程
```typescript
// Session管理中的防御性检查
async function updateSessionActivity(sessionId: string, messageCount?: number): Promise<boolean> {
  // 输入验证
  if (!sessionId?.trim()) {
    this.moduleLogger.error('Invalid session ID provided', { sessionId });
    return false;
  }

  // 数据库存在性检查
  const session = await this.getSessionById(sessionId);
  if (!session) {
    this.moduleLogger.warn('Session not found for activity update', { sessionId });
    return false;
  }

  // 类型安全的字段更新
  const updateData: any = { last_activity: new Date() };
  if (typeof messageCount === 'number' && messageCount >= 0) {
    updateData.message_count = messageCount;
  }

  return await this.executeUpdate('conversation_sessions', updateData, { session_id: sessionId });
}
```

## 🛠️ 错误分类和处理策略

### 数据库错误处理
```typescript
export enum DatabaseErrorType {
  CONNECTION_FAILED = 'CONNECTION_FAILED',
  QUERY_FAILED = 'QUERY_FAILED',
  CONSTRAINT_VIOLATION = 'CONSTRAINT_VIOLATION',
  TIMEOUT = 'TIMEOUT',
  DATA_INTEGRITY = 'DATA_INTEGRITY'
}

class DatabaseError extends Error {
  constructor(
    public type: DatabaseErrorType,
    message: string,
    public originalError?: Error,
    public query?: string,
    public params?: any[]
  ) {
    super(message);
    this.name = 'DatabaseError';
  }
}

// 使用示例
async function createSession(sessionData: SessionData): Promise<boolean> {
  try {
    const result = await this.connection.execute(
      'INSERT INTO conversation_sessions SET ?', 
      [sessionData]
    );
    return true;
  } catch (error: any) {
    // 约束违反处理
    if (error.code === 'ER_DUP_ENTRY') {
      throw new DatabaseError(
        DatabaseErrorType.CONSTRAINT_VIOLATION,
        `Session ${sessionData.session_id} already exists`,
        error
      );
    }
    
    // 连接错误处理
    if (error.code === 'ECONNREFUSED') {
      throw new DatabaseError(
        DatabaseErrorType.CONNECTION_FAILED,
        'Database connection refused',
        error
      );
    }
    
    // 通用查询错误
    throw new DatabaseError(
      DatabaseErrorType.QUERY_FAILED,
      `Session creation failed: ${error.message}`,
      error,
      'INSERT INTO conversation_sessions SET ?',
      [sessionData]
    );
  }
}
```

### API错误重试机制
```typescript
interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffFactor: number;
  retryableErrors: string[];
}

class APIService {
  private retryConfig: RetryConfig = {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 10000,
    backoffFactor: 2,
    retryableErrors: ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED']
  };

  async callWithRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
    customConfig?: Partial<RetryConfig>
  ): Promise<T> {
    const config = { ...this.retryConfig, ...customConfig };
    let lastError: Error;
    
    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error: any) {
        lastError = error;
        
        // 最后一次尝试失败
        if (attempt === config.maxRetries) {
          this.moduleLogger.error(`${operationName} failed after ${config.maxRetries + 1} attempts`, {
            error: error.message,
            attempts: attempt + 1
          });
          break;
        }
        
        // 检查是否为可重试错误
        if (!config.retryableErrors.some(code => error.message?.includes(code) || error.code === code)) {
          this.moduleLogger.warn(`${operationName} failed with non-retryable error`, {
            error: error.message,
            code: error.code
          });
          throw error;
        }
        
        // 计算延迟时间
        const delay = Math.min(
          config.baseDelay * Math.pow(config.backoffFactor, attempt),
          config.maxDelay
        );
        
        this.moduleLogger.warn(`${operationName} failed, retrying in ${delay}ms`, {
          attempt: attempt + 1,
          maxRetries: config.maxRetries,
          error: error.message,
          delay
        });
        
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    throw lastError!;
  }
}
```

## 🔧 Session管理特定错误模式

### Session状态一致性保障
```typescript
async function ensureSessionConsistency(sessionId: string): Promise<SessionData | null> {
  try {
    // 1. 从数据库获取权威状态
    const dbSession = await this.getSessionFromDatabase(sessionId);
    
    // 2. 从内存缓存获取快速状态
    const memorySession = this.getSessionFromMemory(sessionId);
    
    // 3. 状态比较和一致性修复
    if (dbSession && memorySession) {
      const dbTime = this.ensureTimestamp(dbSession.updated_at);
      const memoryTime = this.ensureTimestamp(memorySession.updated_at);
      
      // 基于时间戳的冲突解决
      if (dbTime !== memoryTime) {
        this.moduleLogger.info('Session state inconsistency detected', {
          sessionId,
          dbTime: new Date(dbTime).toISOString(),
          memoryTime: new Date(memoryTime).toISOString()
        });
        
        // 使用最新的状态
        const latestSession = dbTime > memoryTime ? dbSession : memorySession;
        
        // 更新落后的状态
        if (dbTime > memoryTime) {
          this.updateSessionInMemory(sessionId, dbSession);
        } else {
          await this.updateSessionInDatabase(sessionId, memorySession);
        }
        
        return latestSession;
      }
    }
    
    // 4. 缺失状态的修复
    if (dbSession && !memorySession) {
      this.updateSessionInMemory(sessionId, dbSession);
      return dbSession;
    }
    
    if (!dbSession && memorySession) {
      await this.saveSessionToDatabase(sessionId, memorySession);
      return memorySession;
    }
    
    return dbSession;
    
  } catch (error: any) {
    this.moduleLogger.error('Failed to ensure session consistency', {
      sessionId,
      error: error.message
    });
    
    // 降级到只读模式
    return await this.getSessionFromDatabase(sessionId);
  }
}

// 辅助函数：时间戳类型安全转换
private ensureTimestamp(timestamp: unknown): number {
  if (timestamp instanceof Date) {
    return timestamp.getTime();
  } else if (typeof timestamp === 'string') {
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) {
      throw new Error(`Invalid timestamp string: ${timestamp}`);
    }
    return date.getTime();
  } else if (typeof timestamp === 'number') {
    return timestamp;
  }
  
  this.moduleLogger.warn('Invalid timestamp type, using current time', { 
    timestamp, 
    type: typeof timestamp 
  });
  return Date.now();
}
```

### 并发Session操作保护
```typescript
class SessionConcurrencyManager {
  private operationLocks = new Map<string, Promise<any>>();
  
  async withLock<T>(sessionId: string, operation: () => Promise<T>, operationName: string): Promise<T> {
    // 检查是否已有进行中的操作
    const existingOperation = this.operationLocks.get(sessionId);
    if (existingOperation) {
      this.moduleLogger.debug(`Waiting for concurrent operation to complete`, { 
        sessionId, 
        operationName 
      });
      
      try {
        await existingOperation;
      } catch (error) {
        // 忽略其他操作的错误，继续执行当前操作
        this.moduleLogger.debug(`Previous operation failed, proceeding with current`, { 
          sessionId, 
          operationName,
          previousError: error
        });
      }
    }
    
    // 创建新的操作Promise
    const operationPromise = this.executeWithTimeout(operation, operationName, 30000);
    this.operationLocks.set(sessionId, operationPromise);
    
    try {
      const result = await operationPromise;
      this.operationLocks.delete(sessionId);
      return result;
    } catch (error: any) {
      this.operationLocks.delete(sessionId);
      this.moduleLogger.error(`Session operation failed`, { 
        sessionId, 
        operationName, 
        error: error.message 
      });
      throw error;
    }
  }
  
  private async executeWithTimeout<T>(
    operation: () => Promise<T>, 
    operationName: string, 
    timeoutMs: number
  ): Promise<T> {
    return Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Operation ${operationName} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      })
    ]);
  }
}
```

## 📊 错误监控和告警

### 结构化错误日志
```typescript
interface ErrorContext {
  operation: string;
  sessionId?: string;
  userId?: number;
  requestId?: string;
  timestamp: string;
  duration?: number;
  stackTrace?: string;
  additionalData?: Record<string, any>;
}

class ErrorLogger {
  logError(error: Error, context: ErrorContext): void {
    const errorData = {
      level: 'error',
      message: error.message,
      errorName: error.name,
      context: {
        ...context,
        timestamp: new Date().toISOString(),
        stackTrace: error.stack
      }
    };
    
    // 根据错误严重程度决定日志处理
    if (this.isCriticalError(error)) {
      this.sendToAlertSystem(errorData);
    }
    
    this.moduleLogger.error(errorData.message, errorData.context);
  }
  
  private isCriticalError(error: Error): boolean {
    const criticalPatterns = [
      /database.*connection.*failed/i,
      /session.*creation.*failed/i,
      /token.*expired.*all.*keys/i,
      /websocket.*connection.*lost/i
    ];
    
    return criticalPatterns.some(pattern => pattern.test(error.message));
  }
  
  private sendToAlertSystem(errorData: any): void {
    // 集成告警系统（如PagerDuty、Slack等）
    // 这里是模拟实现
    console.error('🚨 CRITICAL ERROR ALERT:', errorData);
  }
}
```

### 健康检查集成
```typescript
export interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: Record<string, {
    status: 'pass' | 'warn' | 'fail';
    message?: string;
    responseTime?: number;
    lastError?: string;
  }>;
  timestamp: string;
}

class SessionHealthChecker {
  async performHealthCheck(): Promise<HealthCheckResult> {
    const checks: HealthCheckResult['checks'] = {};
    
    // 数据库连接检查
    try {
      const start = Date.now();
      const isConnected = await this.databaseManager.testConnection();
      checks.database = {
        status: isConnected ? 'pass' : 'fail',
        responseTime: Date.now() - start,
        message: isConnected ? 'Database connection OK' : 'Database connection failed'
      };
    } catch (error: any) {
      checks.database = {
        status: 'fail',
        message: 'Database check failed',
        lastError: error.message
      };
    }
    
    // Session操作检查
    try {
      const start = Date.now();
      const testSessionId = `health-check-${Date.now()}`;
      const testSession = createMockSession({ session_id: testSessionId });
      
      await this.createSession(testSession);
      await this.getSessionById(testSessionId);
      await this.cleanupTestSession(testSessionId);
      
      checks.sessionOperations = {
        status: 'pass',
        responseTime: Date.now() - start,
        message: 'Session CRUD operations OK'
      };
    } catch (error: any) {
      checks.sessionOperations = {
        status: 'fail',
        message: 'Session operations failed',
        lastError: error.message
      };
    }
    
    // 缓存一致性检查
    const cacheCheck = await this.checkCacheConsistency();
    checks.cacheConsistency = cacheCheck;
    
    // 整体状态评估
    const failedChecks = Object.values(checks).filter(check => check.status === 'fail').length;
    const warnChecks = Object.values(checks).filter(check => check.status === 'warn').length;
    
    let overallStatus: HealthCheckResult['status'];
    if (failedChecks > 0) {
      overallStatus = 'unhealthy';
    } else if (warnChecks > 0) {
      overallStatus = 'degraded';
    } else {
      overallStatus = 'healthy';
    }
    
    return {
      status: overallStatus,
      checks,
      timestamp: new Date().toISOString()
    };
  }
}
```

## 🚀 集成最佳实践

### 1. 与现有错误处理系统整合
```typescript
// 在现有的QQBot类中集成
class QQBot {
  private errorLogger = new ErrorLogger();
  private sessionConcurrency = new SessionConcurrencyManager();
  private healthChecker = new SessionHealthChecker();
  
  async handlePrivateMessage(message: QQMessage): Promise<void> {
    const operationContext: ErrorContext = {
      operation: 'handlePrivateMessage',
      userId: message.user_id,
      requestId: `msg-${message.message_id}`,
      timestamp: new Date().toISOString()
    };
    
    try {
      await this.sessionConcurrency.withLock(
        `user-${message.user_id}`,
        async () => await this.processMessage(message),
        'processMessage'
      );
    } catch (error: any) {
      this.errorLogger.logError(error, operationContext);
      
      // 发送用户友好的错误响应
      await this.sendErrorResponse(message.user_id, error);
    }
  }
}
```

### 2. 测试中的错误场景覆盖
```typescript
// tests/error-handling.test.ts
describe('Error Handling Scenarios', () => {
  test('should handle database connection failure gracefully', async () => {
    const mockDb = createMockDatabaseManager();
    mockDb.testConnection.mockRejectedValue(new Error('Connection refused'));
    
    const sessionManager = new SessionManager(mockDb);
    const result = await sessionManager.createSession(createMockSession());
    
    // 应该降级到内存模式
    expect(result).toBe(false);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Database unavailable')
    );
  });
  
  test('should handle timestamp type errors', () => {
    const invalidTimestamp = '2025-13-45T25:70:80.000Z'; // 无效日期
    
    expect(() => {
      processTimestamp(invalidTimestamp);
    }).toThrow('Invalid timestamp string');
  });
});
```

## 📋 实施清单

### 立即行动项
- [ ] 在所有数据库操作中添加类型安全检查
- [ ] 实现Session并发操作保护
- [ ] 部署健康检查端点
- [ ] 配置错误监控告警

### 中期改进项
- [ ] 完善重试机制配置
- [ ] 实现分布式Session状态同步
- [ ] 建立错误指标Dashboard
- [ ] 完善错误恢复自动化

### 长期优化项
- [ ] 集成分布式追踪系统
- [ ] 实现智能错误预测
- [ ] 建立故障演练体系
- [ ] 完善监控告警升级机制

---

**基于经验**: 此文档基于修复 `cached.updated_at.getTime is not a function` 的实际案例，提供了经过验证的错误处理模式。  
**最后更新**: 2025-09-01  
**适用版本**: TypeScript 4.5+, Node.js 16+