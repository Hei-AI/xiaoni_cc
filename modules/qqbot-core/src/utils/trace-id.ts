/**
 * TraceID 生成和管理工具
 * 用于追踪从WebSocket消息接收到最终回复的完整链路
 */

export class TraceIdGenerator {
  /**
   * 生成新的TraceID
   * 格式: trace_${timestamp}_${randomId}_${userId}
   * @param userId 可选的用户ID，用于关联特定用户
   * @returns 唯一的TraceID字符串
   */
  static generate(userId?: number): string {
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 10);
    const userSuffix = userId ? `_${userId}` : '';
    return `trace_${timestamp}_${randomId}${userSuffix}`;
  }

  /**
   * 解析TraceID获取基本信息
   * @param traceId TraceID字符串
   * @returns 解析出的信息对象
   */
  static parse(traceId: string): {
    timestamp: number;
    randomId: string;
    userId?: number;
    isValid: boolean;
  } {
    try {
      const parts = traceId.split('_');
      if (parts[0] !== 'trace' || parts.length < 3) {
        return { timestamp: 0, randomId: '', isValid: false };
      }

      const timestamp = parseInt(parts[1], 10);
      const randomId = parts[2];
      const userId = parts.length >= 4 ? parseInt(parts[3], 10) : undefined;

      return {
        timestamp,
        randomId,
        userId,
        isValid: !isNaN(timestamp) && randomId.length > 0
      };
    } catch (error) {
      return { timestamp: 0, randomId: '', isValid: false };
    }
  }

  /**
   * 验证TraceID格式是否有效
   * @param traceId TraceID字符串
   * @returns 是否为有效格式
   */
  static isValid(traceId: string): boolean {
    return this.parse(traceId).isValid;
  }

  /**
   * 从TraceID提取时间戳并格式化为可读时间
   * @param traceId TraceID字符串
   * @returns 格式化的时间字符串
   */
  static getReadableTime(traceId: string): string {
    const parsed = this.parse(traceId);
    if (!parsed.isValid) {
      return 'Invalid TraceID';
    }
    return new Date(parsed.timestamp).toISOString();
  }
}

/**
 * 执行上下文接口
 * 用于在组件间传递TraceID和其他上下文信息
 */
export interface ExecutionContext {
  traceId: string;
  startTime: Date;
  sessionId?: string;
  userId?: number;
  groupId?: number;
  messageId?: number;
}

/**
 * 创建执行上下文
 * @param traceId TraceID
 * @param additionalContext 额外的上下文信息
 * @returns 完整的执行上下文对象
 */
export function createExecutionContext(
  traceId: string, 
  additionalContext: Partial<Omit<ExecutionContext, 'traceId' | 'startTime'>> = {}
): ExecutionContext {
  return {
    traceId,
    startTime: new Date(),
    ...additionalContext
  };
}

/**
 * TraceID相关的类型定义
 */
export type TraceableOperation<T = any> = (context: ExecutionContext) => Promise<T>;

export interface TraceableResult<T = any> {
  result: T;
  context: ExecutionContext;
  duration: number;
}

/**
 * 执行可追踪的操作
 * @param operation 要执行的操作
 * @param context 执行上下文
 * @returns 包含结果和追踪信息的对象
 */
export async function executeWithTrace<T>(
  operation: TraceableOperation<T>,
  context: ExecutionContext
): Promise<TraceableResult<T>> {
  const startTime = Date.now();
  const result = await operation(context);
  const duration = Date.now() - startTime;

  return {
    result,
    context,
    duration
  };
}