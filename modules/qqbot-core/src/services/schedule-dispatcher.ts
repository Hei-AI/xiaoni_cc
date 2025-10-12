/**
 * ScheduleDispatcher - 拟人化调度器
 *
 * 职责：
 * - 基于时间间隔调度消息批处理
 * - 维护优先级队列（sourceKey → nextCheckTime）
 * - 高优先级消息立即触发处理
 * - 实现 nextCheckTime 计算和 clamp 逻辑
 *
 * 工作流程：
 * 1. 监听 message_queued 事件
 * 2. 检测优先级：HIGH → 立即处理，其他 → 调度
 * 3. tick 循环检查是否到达 nextCheckTime
 * 4. 触发 handler(sourceKey, 'scheduled')
 * 5. 处理完成后重新计算 nextCheckTime
 */

import { logger } from '../utils/logger';
import { MessageQueueService } from './message-queue-service';
import { BatchHandler, TriggerType } from './direct-notifier';

interface ScheduleEntry {
  sourceKey: string;
  nextCheckTime: Date;
  lastProcessedTime?: Date;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  unreadCount: number;
}

interface DispatcherConfig {
  scanInterval: number; // 扫描间隔（毫秒）
  minInterval: number;  // 最小检查间隔（毫秒）
  maxInterval: number;  // 最大等待时间（毫秒）
  tickInterval: number; // tick 循环间隔（毫秒）
}

export class ScheduleDispatcher {
  private moduleLogger = logger.createModuleLogger('schedule-dispatcher');
  private messageQueueService: MessageQueueService;
  private handler: BatchHandler;
  private config: DispatcherConfig;

  // 优先级队列：sourceKey → ScheduleEntry
  private scheduleQueue: Map<string, ScheduleEntry> = new Map();

  // tick 循环控制
  private tickTimer?: ReturnType<typeof setTimeout>;
  private isRunning = false;

  // 统计信息
  private stats = {
    totalScheduled: 0,
    immediateProcessed: 0,
    scheduledProcessed: 0,
    failedProcessing: 0
  };

  constructor(
    messageQueueService: MessageQueueService,
    handler: BatchHandler,
    config?: Partial<DispatcherConfig>
  ) {
    this.messageQueueService = messageQueueService;
    this.handler = handler;

    // 默认配置
    this.config = {
      scanInterval: parseInt(process.env.HUMAN_LIKE_SCAN_INTERVAL || '8000', 10),  // 8秒
      minInterval: parseInt(process.env.HUMAN_LIKE_MIN_INTERVAL || '3000', 10),    // 3秒
      maxInterval: parseInt(process.env.HUMAN_LIKE_MAX_INTERVAL || '30000', 10),   // 30秒
      tickInterval: parseInt(process.env.HUMAN_LIKE_TICK_INTERVAL || '1000', 10),  // 1秒
      ...config
    };

    this.moduleLogger.info('ScheduleDispatcher initialized', {
      config: this.config
    });
  }

  /**
   * 启动调度器
   */
  start(): void {
    if (this.isRunning) {
      this.moduleLogger.warn('ScheduleDispatcher already running');
      return;
    }

    this.isRunning = true;
    this.moduleLogger.info('ScheduleDispatcher starting');

    // 启动 tick 循环
    this.tickTimer = setInterval(() => {
      this.tick().catch(error => {
        this.moduleLogger.error('Tick loop error', {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      });
    }, this.config.tickInterval);

    this.moduleLogger.info('ScheduleDispatcher started', {
      tickInterval: this.config.tickInterval
    });
  }

  /**
   * 停止调度器
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = undefined;
    }

    this.moduleLogger.info('ScheduleDispatcher stopped');
  }

  /**
   * 调度消息处理
   * @param sourceKey 源标识符
   * @param priority 消息优先级
   */
  async schedule(sourceKey: string, priority: 'HIGH' | 'MEDIUM' | 'LOW'): Promise<void> {
    this.stats.totalScheduled++;

    const unreadCount = this.messageQueueService.getUnreadCount(sourceKey);

    this.moduleLogger.debug('Schedule request', {
      sourceKey,
      priority,
      unreadCount
    });

    // 高优先级消息立即处理
    if (priority === 'HIGH') {
      this.moduleLogger.info('High priority message detected, immediate processing', {
        sourceKey,
        unreadCount
      });

      await this.processSourceKey(sourceKey, 'scheduled');
      this.stats.immediateProcessed++;
      return;
    }

    // 普通优先级消息：添加到调度队列
    const now = new Date();
    const existingEntry = this.scheduleQueue.get(sourceKey);

    if (existingEntry) {
      // 更新现有条目
      existingEntry.unreadCount = unreadCount;
      existingEntry.priority = priority;

      this.moduleLogger.debug('Updated existing schedule entry', {
        sourceKey,
        nextCheckTime: existingEntry.nextCheckTime,
        unreadCount
      });
    } else {
      // 创建新条目
      const nextCheckTime = this.calculateNextCheckTime(now, undefined);

      const entry: ScheduleEntry = {
        sourceKey,
        nextCheckTime,
        priority,
        unreadCount
      };

      this.scheduleQueue.set(sourceKey, entry);

      this.moduleLogger.info('New schedule entry created', {
        sourceKey,
        nextCheckTime,
        priority,
        unreadCount
      });
    }
  }

  /**
   * Tick 循环：检查是否有需要处理的队列
   */
  private async tick(): Promise<void> {
    if (this.scheduleQueue.size === 0) {
      return;
    }

    const now = new Date();
    const readySourceKeys: string[] = [];

    // 检查哪些 sourceKey 已到达 nextCheckTime
    for (const [sourceKey, entry] of this.scheduleQueue.entries()) {
      if (entry.nextCheckTime <= now) {
        readySourceKeys.push(sourceKey);
      }
    }

    if (readySourceKeys.length === 0) {
      return;
    }

    this.moduleLogger.info('Tick: processing ready source keys', {
      count: readySourceKeys.length,
      sourceKeys: readySourceKeys
    });

    // 处理所有就绪的 sourceKey
    for (const sourceKey of readySourceKeys) {
      await this.processSourceKey(sourceKey, 'scheduled');
    }
  }

  /**
   * 处理指定 sourceKey 的消息
   */
  private async processSourceKey(sourceKey: string, triggerType: TriggerType): Promise<void> {
    try {
      this.moduleLogger.info('Processing sourceKey', {
        sourceKey,
        triggerType
      });

      const startTime = Date.now();

      // Drain 消息
      const messages = await this.messageQueueService.drain(sourceKey);

      if (messages.length === 0) {
        this.moduleLogger.debug('No messages to process, removing from schedule', {
          sourceKey
        });
        this.scheduleQueue.delete(sourceKey);
        return;
      }

      // 调用 handler 批量处理
      const messageType = this.inferMessageType(sourceKey);

      if (messageType === 'private') {
        await this.handler.handlePrivateMessageBatch(sourceKey, messages, triggerType);
      } else if (messageType === 'group') {
        await this.handler.handleGroupMessageBatch(sourceKey, messages, triggerType);
      }

      const finishTime = new Date();
      const processingTime = Date.now() - startTime;

      this.moduleLogger.info('Processing completed', {
        sourceKey,
        messageCount: messages.length,
        processingTime
      });

      this.stats.scheduledProcessed++;

      // 重新计算 nextCheckTime
      const existingEntry = this.scheduleQueue.get(sourceKey);
      const nextCheckTime = this.calculateNextCheckTime(finishTime, finishTime);

      // 检查是否还有未读消息
      const remainingCount = this.messageQueueService.getUnreadCount(sourceKey);

      if (remainingCount > 0) {
        // 还有消息，重新调度
        const entry: ScheduleEntry = {
          sourceKey,
          nextCheckTime,
          lastProcessedTime: finishTime,
          priority: existingEntry?.priority || 'MEDIUM',
          unreadCount: remainingCount
        };

        this.scheduleQueue.set(sourceKey, entry);

        this.moduleLogger.info('Rescheduled with remaining messages', {
          sourceKey,
          remainingCount,
          nextCheckTime
        });
      } else {
        // 没有消息了，移除调度
        this.scheduleQueue.delete(sourceKey);

        this.moduleLogger.debug('No remaining messages, removed from schedule', {
          sourceKey
        });
      }

    } catch (error) {
      this.stats.failedProcessing++;
      this.moduleLogger.error('Failed to process sourceKey', {
        error: error instanceof Error ? error.message : 'Unknown error',
        sourceKey
      });

      // 失败后延迟重试
      const entry = this.scheduleQueue.get(sourceKey);
      if (entry) {
        const retryTime = new Date(Date.now() + this.config.minInterval);
        entry.nextCheckTime = retryTime;
        this.scheduleQueue.set(sourceKey, entry);

        this.moduleLogger.info('Rescheduled after error', {
          sourceKey,
          nextCheckTime: retryTime
        });
      }
    }
  }

  /**
   * 计算下次检查时间
   *
   * nextCheckTime = clamp(
   *   finishTime + interval,
   *   now + MIN_INTERVAL,
   *   now + MAX_INTERVAL
   * )
   */
  private calculateNextCheckTime(now: Date, finishTime?: Date): Date {
    const baseTime = finishTime || now;
    const targetTime = new Date(baseTime.getTime() + this.config.scanInterval);

    const minTime = new Date(now.getTime() + this.config.minInterval);
    const maxTime = new Date(now.getTime() + this.config.maxInterval);

    // Clamp: 确保 nextCheckTime 在 [minTime, maxTime] 范围内
    let nextCheckTime = targetTime;

    if (nextCheckTime < minTime) {
      nextCheckTime = minTime;
    } else if (nextCheckTime > maxTime) {
      nextCheckTime = maxTime;
    }

    this.moduleLogger.debug('Calculated nextCheckTime', {
      now: now.toISOString(),
      finishTime: finishTime?.toISOString(),
      targetTime: targetTime.toISOString(),
      minTime: minTime.toISOString(),
      maxTime: maxTime.toISOString(),
      nextCheckTime: nextCheckTime.toISOString()
    });

    return nextCheckTime;
  }

  /**
   * 推断消息类型（基于 sourceKey）
   */
  private inferMessageType(sourceKey: string): 'private' | 'group' {
    return sourceKey.startsWith('user_') ? 'private' : 'group';
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      ...this.stats,
      scheduleQueueSize: this.scheduleQueue.size,
      isRunning: this.isRunning
    };
  }

  /**
   * 获取调度队列状态
   */
  getScheduleQueue(): ScheduleEntry[] {
    return Array.from(this.scheduleQueue.values());
  }

  /**
   * 重置统计信息
   */
  resetStats() {
    this.stats = {
      totalScheduled: 0,
      immediateProcessed: 0,
      scheduledProcessed: 0,
      failedProcessing: 0
    };
  }
}

export default ScheduleDispatcher;
