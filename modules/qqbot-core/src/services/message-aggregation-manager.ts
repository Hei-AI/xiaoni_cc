/**
 * 🧠 消息聚合管理器 - 时间窗口管理核心组件
 * 职责: 管理消息聚合窗口，决定何时触发消费，实现智能批量处理
 */

import { v4 as uuidv4 } from 'uuid';
import {
  QueuedMessage,
  AggregationWindow,
  MessageAggregationConfig,
  ConsumptionTriggerReason
} from '../types';
import { LoggingService } from './logging-service';
import { MessageConsumptionTrigger } from './message-consumption-trigger';
import { logger } from '../utils/logger';

export class MessageAggregationManager {
  private aggregationWindows = new Map<string, AggregationWindow>();
  private consumptionTrigger!: MessageConsumptionTrigger; // 延迟初始化
  private loggingService: LoggingService;
  private moduleLogger = logger.createModuleLogger('message-aggregation-manager');
  private config: MessageAggregationConfig;

  // 统计信息
  private stats = {
    windowsCreated: 0,
    windowsTriggered: 0,
    totalMessagesAggregated: 0,
    averageWindowDuration: 0
  };

  constructor(
    loggingService: LoggingService,
    config: MessageAggregationConfig
  ) {
    this.loggingService = loggingService;
    this.config = config;

    this.moduleLogger.info('MessageAggregationManager initialized', {
      aggregationWindowMs: config.aggregationWindowMs,
      maxQueueSize: config.maxQueueSize,
      enableWindowExtension: config.enableWindowExtension
    });
  }

  /**
   * 设置消费触发器 (延迟注入避免循环依赖)
   */
  public setConsumptionTrigger(trigger: MessageConsumptionTrigger): void {
    this.consumptionTrigger = trigger;
    this.moduleLogger.debug('Consumption trigger set');
  }

  /**
   * 消息到达通知 - 管理聚合窗口的核心方法
   */
  async onMessageArrival(sourceKey: string, queuedMessage: QueuedMessage): Promise<void> {
    const startTime = Date.now();

    try {
      let window = this.aggregationWindows.get(sourceKey);

      if (!window) {
        // 首条消息 - 创建新聚合窗口
        window = await this.createAggregationWindow(sourceKey, queuedMessage);
        this.aggregationWindows.set(sourceKey, window);
      }

      // 添加消息到聚合窗口
      await this.addMessageToWindow(window, queuedMessage);

      // 检查是否需要立即触发消费
      await this.checkTriggerConditions(window);

      const processingTime = Date.now() - startTime;
      this.moduleLogger.debug('Message aggregation completed', {
        sourceKey,
        messageId: queuedMessage.id,
        windowSize: window.messages.length,
        windowStatus: window.status,
        processingTime
      });

    } catch (error) {
      this.moduleLogger.error('Failed to handle message aggregation', {
        sourceKey,
        messageId: queuedMessage.id,
        error: error instanceof Error ? error.message : 'Unknown error',
        processingTime: Date.now() - startTime
      });

      throw error;
    }
  }

  /**
   * 创建新的聚合窗口
   */
  private async createAggregationWindow(
    sourceKey: string,
    firstMessage: QueuedMessage
  ): Promise<AggregationWindow> {
    const windowId = uuidv4();
    const window: AggregationWindow = {
      sourceKey,
      messages: [],
      firstMessageTime: new Date(),
      status: 'aggregating',
      windowTimer: null,
      windowId
    };

    // 启动聚合窗口计时器 - 首条消息延迟触发消费
    window.windowTimer = setTimeout(async () => {
      await this.triggerConsumption(sourceKey, 'window_timeout');
    }, this.config.aggregationWindowMs);

    // 记录窗口创建事件
    await this.loggingService.logInstantEvent(
      firstMessage.traceId,
      'aggregation',
      'window_created',
      sourceKey,
      {
        window_id: windowId,
        aggregation_timeout: this.config.aggregationWindowMs,
        first_message_id: firstMessage.id
      }
    );

    this.stats.windowsCreated++;

    this.moduleLogger.info('Aggregation window created', {
      sourceKey,
      windowId,
      timeoutMs: this.config.aggregationWindowMs,
      firstMessageId: firstMessage.id
    });

    return window;
  }

  /**
   * 将消息添加到聚合窗口
   */
  private async addMessageToWindow(
    window: AggregationWindow,
    queuedMessage: QueuedMessage
  ): Promise<void> {
    // 更新消息状态
    queuedMessage.status = 'aggregated';
    queuedMessage.metadata = {
      ...queuedMessage.metadata,
      isAggregated: true
    };

    // 添加到窗口
    window.messages.push(queuedMessage);

    // 记录消息聚合事件
    await this.loggingService.logInstantEvent(
      queuedMessage.traceId,
      'aggregation',
      'message_added',
      window.sourceKey,
      {
        window_id: window.windowId,
        message_id: queuedMessage.id,
        window_size: window.messages.length,
        time_since_first_message: Date.now() - window.firstMessageTime.getTime()
      }
    );

    this.stats.totalMessagesAggregated++;
  }

  /**
   * 检查触发条件
   */
  private async checkTriggerConditions(window: AggregationWindow): Promise<void> {
    // 条件1: 队列大小达到限制
    if (window.messages.length >= this.config.maxQueueSize) {
      await this.triggerConsumption(window.sourceKey, 'queue_size_limit');
      return;
    }

    // 条件2: 窗口延长逻辑 (可选功能)
    if (this.config.enableWindowExtension && window.messages.length > 1) {
      await this.considerWindowExtension(window);
    }
  }

  /**
   * 考虑窗口延长 (高级功能)
   */
  private async considerWindowExtension(window: AggregationWindow): Promise<void> {
    const timeSinceFirstMessage = Date.now() - window.firstMessageTime.getTime();
    const remainingTime = this.config.aggregationWindowMs - timeSinceFirstMessage;

    // 如果剩余时间很少且最近有消息到达，可以延长窗口
    if (remainingTime < 1000 && window.messages.length < this.config.maxWindowExtensions) {
      if (window.windowTimer) {
        clearTimeout(window.windowTimer);
      }

      // 延长窗口时间
      window.windowTimer = setTimeout(async () => {
        await this.triggerConsumption(window.sourceKey, 'window_timeout');
      }, 2000); // 额外延长2秒

      this.moduleLogger.debug('Aggregation window extended', {
        sourceKey: window.sourceKey,
        windowId: window.windowId,
        currentSize: window.messages.length,
        extensionMs: 2000
      });
    }
  }

  /**
   * 触发消息消费
   */
  public async triggerConsumption(
    sourceKey: string,
    reason: ConsumptionTriggerReason
  ): Promise<void> {
    const window = this.aggregationWindows.get(sourceKey);
    if (!window || window.messages.length === 0) {
      this.moduleLogger.debug('No messages to consume', { sourceKey, reason });
      return;
    }

    const windowStartTime = window.firstMessageTime.getTime();
    const windowDuration = Date.now() - windowStartTime;

    try {
      // 清理计时器
      if (window.windowTimer) {
        clearTimeout(window.windowTimer);
        window.windowTimer = null;
      }

      // 准备消费的消息批次
      const messagesToConsume = [...window.messages];
      window.status = 'ready_for_consumption';

      // 记录窗口关闭事件
      await this.loggingService.logInstantEvent(
        messagesToConsume[0].traceId,
        'aggregation',
        'window_closed',
        sourceKey,
        {
          window_id: window.windowId,
          batch_size: messagesToConsume.length,
          window_duration: windowDuration,
          trigger_reason: reason
        }
      );

      // 清空窗口，准备下一批
      this.aggregationWindows.delete(sourceKey);

      // 更新统计信息
      this.updateStats(windowDuration);

      this.moduleLogger.info('Triggering message consumption', {
        sourceKey,
        windowId: window.windowId,
        batchSize: messagesToConsume.length,
        windowDuration,
        triggerReason: reason
      });

      // 触发消费事件
      if (this.consumptionTrigger) {
        await this.consumptionTrigger.triggerConsumption(
          sourceKey,
          messagesToConsume,
          reason
        );
      } else {
        this.moduleLogger.error('Consumption trigger not set', { sourceKey });
      }

    } catch (error) {
      this.moduleLogger.error('Failed to trigger consumption', {
        sourceKey,
        windowId: window.windowId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      throw error;
    }
  }

  /**
   * 更新统计信息
   */
  private updateStats(windowDuration: number): void {
    this.stats.windowsTriggered++;

    // 计算平均窗口持续时间
    const totalDuration = this.stats.averageWindowDuration * (this.stats.windowsTriggered - 1) + windowDuration;
    this.stats.averageWindowDuration = totalDuration / this.stats.windowsTriggered;
  }

  /**
   * 手动触发所有活跃窗口的消费 (系统关闭时使用)
   */
  public async triggerAllWindows(reason: ConsumptionTriggerReason = 'system_shutdown'): Promise<void> {
    const activeWindows = Array.from(this.aggregationWindows.keys());

    this.moduleLogger.info('Triggering all active windows', {
      activeWindows: activeWindows.length,
      reason
    });

    for (const sourceKey of activeWindows) {
      try {
        await this.triggerConsumption(sourceKey, reason);
      } catch (error) {
        this.moduleLogger.error('Failed to trigger window during shutdown', {
          sourceKey,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
  }

  /**
   * 获取活跃窗口信息
   */
  public getActiveWindows(): Array<{
    sourceKey: string;
    windowId?: string;
    messageCount: number;
    firstMessageTime: Date;
    status: string;
    timeElapsed: number;
  }> {
    return Array.from(this.aggregationWindows.entries()).map(([sourceKey, window]) => ({
      sourceKey,
      windowId: window.windowId,
      messageCount: window.messages.length,
      firstMessageTime: window.firstMessageTime,
      status: window.status,
      timeElapsed: Date.now() - window.firstMessageTime.getTime()
    }));
  }

  /**
   * 获取统计信息
   */
  public getStats() {
    return {
      ...this.stats,
      activeWindows: this.aggregationWindows.size
    };
  }

  /**
   * 优雅关闭
   */
  public async shutdown(): Promise<void> {
    this.moduleLogger.info('MessageAggregationManager shutting down', {
      activeWindows: this.aggregationWindows.size
    });

    // 触发所有活跃窗口的消费
    await this.triggerAllWindows('system_shutdown');

    // 清理所有计时器
    for (const window of Array.from(this.aggregationWindows.values())) {
      if (window.windowTimer) {
        clearTimeout(window.windowTimer);
      }
    }

    this.aggregationWindows.clear();

    this.moduleLogger.info('MessageAggregationManager shutdown completed');
  }
}