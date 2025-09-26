/**
 * 🧠 人类化消息处理器 - 主集成类
 * 职责: 整合所有事件分离组件，提供统一的人类化消息处理接口
 */

import {
  QQMessage,
  HumanLikeProcessorOptions,
  HumanLikeProcessingConfig,
  HumanLikeProcessingStats,
  MessageAggregationConfig,
  LifeRhythmConfig
} from '../types';
import { DatabaseManager } from './database';
import { LoggingService } from './logging-service';
import { MessageArrivalHandler } from './message-arrival-handler';
import { MessageAggregationManager } from './message-aggregation-manager';
import { MessageConsumptionTrigger } from './message-consumption-trigger';
import { LifeRhythmManager } from './life-rhythm-manager';
import { logger } from '../utils/logger';

export class HumanLikeMessageProcessor {
  private database: DatabaseManager;
  private loggingService: LoggingService;
  private moduleLogger = logger.createModuleLogger('human-like-processor');

  // 核心组件
  private messageArrivalHandler!: MessageArrivalHandler;
  private messageAggregationManager!: MessageAggregationManager;
  private messageConsumptionTrigger!: MessageConsumptionTrigger;
  private lifeRhythmManager!: LifeRhythmManager;

  // 配置
  private config: HumanLikeProcessingConfig;
  private isInitialized = false;
  private isRunning = false;

  constructor(options: HumanLikeProcessorOptions) {
    this.database = options.database;
    this.loggingService = options.loggingService;

    // 构建默认配置
    this.config = this.buildDefaultConfig(options.config);

    this.moduleLogger.info('HumanLikeMessageProcessor created', {
      enabled: this.config.enabled,
      aggregationWindowMs: this.config.aggregation.aggregationWindowMs,
      lifeRhythmEnabled: this.config.lifeRhythm.enabled
    });

    // 初始化组件
    this.initializeComponents(options);
  }

  /**
   * 构建默认配置
   */
  private buildDefaultConfig(userConfig?: Partial<HumanLikeProcessingConfig>): HumanLikeProcessingConfig {
    const defaultConfig: HumanLikeProcessingConfig = {
      enabled: process.env.ENABLE_HUMAN_LIKE_PROCESSING === 'true',
      debug: process.env.NODE_ENV === 'development',
      aggregation: {
        aggregationWindowMs: parseInt(process.env.MESSAGE_AGGREGATION_WINDOW_MS || '5000'),
        maxQueueSize: parseInt(process.env.MAX_QUEUE_SIZE || '100'),
        enableWindowExtension: true,
        maxWindowExtensions: 2
      },
      lifeRhythm: {
        enabled: process.env.LIFE_RHYTHM_ENABLED === 'true',
        baseCheckInterval: parseInt(process.env.LIFE_RHYTHM_CHECK_INTERVAL_MS || '30000'),
        workHoursProbability: parseFloat(process.env.WORK_HOURS_PROBABILITY || '0.7'),
        restHoursProbability: parseFloat(process.env.REST_HOURS_PROBABILITY || '0.4'),
        sleepHoursProbability: parseFloat(process.env.SLEEP_HOURS_PROBABILITY || '0.05'),
        workHoursStart: 9,
        workHoursEnd: 17,
        restHoursStart: 18,
        restHoursEnd: 22
      }
    };

    return {
      ...defaultConfig,
      ...userConfig,
      aggregation: { ...defaultConfig.aggregation, ...userConfig?.aggregation },
      lifeRhythm: { ...defaultConfig.lifeRhythm, ...userConfig?.lifeRhythm }
    };
  }

  /**
   * 初始化所有组件
   */
  private initializeComponents(options: HumanLikeProcessorOptions): void {
    try {
      this.moduleLogger.info('Initializing human-like processing components');

      // 1. 创建消费触发器
      this.messageConsumptionTrigger = new MessageConsumptionTrigger(
        options.originalHandlers,
        this.database,
        this.loggingService
      );

      // 2. 创建聚合管理器
      this.messageAggregationManager = new MessageAggregationManager(
        this.loggingService,
        this.config.aggregation
      );

      // 3. 设置聚合管理器的消费触发器 (解决循环依赖)
      this.messageAggregationManager.setConsumptionTrigger(this.messageConsumptionTrigger);

      // 4. 创建消息到达处理器
      this.messageArrivalHandler = new MessageArrivalHandler(
        this.database,
        this.loggingService,
        this.messageAggregationManager,
        this.config.aggregation
      );

      // 5. 创建生活节奏管理器
      this.lifeRhythmManager = new LifeRhythmManager(
        this.messageArrivalHandler,
        this.messageConsumptionTrigger,
        this.loggingService,
        this.config.lifeRhythm
      );

      this.isInitialized = true;

      this.moduleLogger.info('Human-like processing components initialized successfully');

    } catch (error) {
      this.moduleLogger.error('Failed to initialize components', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * 启动人类化处理系统
   */
  public async start(): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Components not initialized');
    }

    if (this.isRunning) {
      this.moduleLogger.warn('Human-like processor already running');
      return;
    }

    try {
      this.moduleLogger.info('Starting human-like message processing system', {
        config: this.config
      });

      // 启动生活节奏管理器
      if (this.config.lifeRhythm.enabled) {
        this.lifeRhythmManager.start();
      }

      this.isRunning = true;

      this.moduleLogger.info('Human-like message processing system started successfully');

      // 记录系统启动事件
      await this.loggingService.logInstantEvent(
        `human_like_start_${Date.now()}`,
        'system',
        'human_like_processing_started',
        'system',
        {
          config: this.config,
          timestamp: new Date()
        }
      );

    } catch (error) {
      this.moduleLogger.error('Failed to start human-like processing system', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * 停止人类化处理系统
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) {
      this.moduleLogger.warn('Human-like processor not running');
      return;
    }

    try {
      this.moduleLogger.info('Stopping human-like message processing system');

      // 停止生活节奏管理器
      await this.lifeRhythmManager.shutdown();

      // 触发所有聚合窗口的消费
      await this.messageAggregationManager.shutdown();

      // 清理消息到达处理器
      await this.messageArrivalHandler.shutdown();

      this.isRunning = false;

      this.moduleLogger.info('Human-like message processing system stopped successfully');

      // 记录系统停止事件
      await this.loggingService.logInstantEvent(
        `human_like_stop_${Date.now()}`,
        'system',
        'human_like_processing_stopped',
        'system',
        {
          timestamp: new Date(),
          finalStats: this.getStats()
        }
      );

    } catch (error) {
      this.moduleLogger.error('Failed to stop human-like processing system', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * 处理消息到达 - 主要入口点
   */
  public async handleMessageArrival(message: QQMessage, eventData?: any): Promise<void> {
    if (!this.config.enabled) {
      throw new Error('Human-like processing is disabled');
    }

    if (!this.isInitialized) {
      throw new Error('Components not initialized');
    }

    // 将消息传递给消息到达处理器
    await this.messageArrivalHandler.handleMessageArrival(message, eventData);
  }

  /**
   * 手动触发指定源的消息消费 (调试用)
   */
  public async triggerManualConsumption(sourceKey: string): Promise<void> {
    if (!this.isRunning) {
      throw new Error('Human-like processor not running');
    }

    const queuedMessages = this.messageArrivalHandler.getSourceQueue(sourceKey);
    if (queuedMessages.length === 0) {
      this.moduleLogger.info('No messages to consume manually', { sourceKey });
      return;
    }

    const messages = this.messageArrivalHandler.clearSourceQueue(sourceKey);
    await this.messageConsumptionTrigger.triggerConsumption(
      sourceKey,
      messages,
      'manual_trigger'
    );

    this.moduleLogger.info('Manual consumption triggered', {
      sourceKey,
      messageCount: messages.length
    });
  }

  /**
   * 手动触发生活节奏检查 (调试用)
   */
  public async triggerManualRhythmCheck(): Promise<void> {
    if (!this.isRunning) {
      throw new Error('Human-like processor not running');
    }

    await this.lifeRhythmManager.triggerManualCheck();
  }

  /**
   * 获取当前队列状态
   */
  public getQueueStatus(): Array<{
    sourceKey: string;
    queueSize: number;
    oldestMessageTime?: Date;
  }> {
    const activeSources = this.messageArrivalHandler.getActiveSources();

    return activeSources.map(sourceKey => {
      const queue = this.messageArrivalHandler.getSourceQueue(sourceKey);
      return {
        sourceKey,
        queueSize: queue.length,
        oldestMessageTime: queue.length > 0 ? queue[0].arrivalTime : undefined
      };
    });
  }

  /**
   * 获取活跃聚合窗口状态
   */
  public getActiveWindows() {
    return this.messageAggregationManager.getActiveWindows();
  }

  /**
   * 获取当前生活节奏状态
   */
  public getCurrentRhythmStatus() {
    return this.lifeRhythmManager.getCurrentActivityProbability();
  }

  /**
   * 更新配置 (运行时)
   */
  public updateConfig(newConfig: Partial<HumanLikeProcessingConfig>): void {
    const oldConfig = { ...this.config };
    this.config = {
      ...this.config,
      ...newConfig,
      aggregation: { ...this.config.aggregation, ...newConfig.aggregation },
      lifeRhythm: { ...this.config.lifeRhythm, ...newConfig.lifeRhythm }
    };

    this.moduleLogger.info('Configuration updated', {
      oldConfig,
      newConfig: this.config
    });

    // 更新生活节奏管理器配置
    if (newConfig.lifeRhythm) {
      this.lifeRhythmManager.updateConfig(newConfig.lifeRhythm);
    }
  }

  /**
   * 获取完整统计信息
   */
  public getStats(): HumanLikeProcessingStats {
    const arrivalStats = this.messageArrivalHandler.getStats();
    const aggregationStats = this.messageAggregationManager.getStats();
    const consumptionStats = this.messageConsumptionTrigger.getStats();
    const rhythmStats = this.lifeRhythmManager.getStats();

    return {
      // 消息到达统计
      totalMessagesArrived: arrivalStats.totalMessagesReceived,
      totalBatchesProcessed: consumptionStats.totalBatchesProcessed,
      averageBatchSize: consumptionStats.averageBatchSize,

      // 聚合窗口统计
      aggregationWindowsCreated: aggregationStats.windowsCreated,
      averageWindowDuration: aggregationStats.averageWindowDuration,
      windowTimeoutRate: aggregationStats.windowsTriggered > 0
        ? aggregationStats.windowsCreated / aggregationStats.windowsTriggered
        : 0,

      // 生活节奏统计
      rhythmChecksPerformed: rhythmStats.checksPerformed,
      rhythmChecksSkipped: rhythmStats.checksSkipped,
      messagesProcessedByRhythm: rhythmStats.messagesProcessedByRhythm,
      currentRhythmProbability: rhythmStats.currentProbability,

      // 性能指标
      averageProcessingDelay: consumptionStats.averageProcessingTime,
      totalProcessingTime: consumptionStats.totalProcessingTime,
      errorRate: 1 - consumptionStats.successRate,

      // 队列状态
      activeQueues: arrivalStats.activeQueues,
      totalQueuedMessages: arrivalStats.totalQueuedMessages,
      maxQueueSize: this.config.aggregation.maxQueueSize
    };
  }

  /**
   * 获取系统健康状态
   */
  public getHealthStatus() {
    const stats = this.getStats();
    const queueStatus = this.getQueueStatus();
    const activeWindows = this.getActiveWindows();

    return {
      isRunning: this.isRunning,
      isInitialized: this.isInitialized,
      config: this.config,
      stats,
      queueStatus,
      activeWindows,
      rhythmStatus: this.getCurrentRhythmStatus(),
      lastUpdate: new Date()
    };
  }

  /**
   * 优雅关闭
   */
  public async shutdown(): Promise<void> {
    this.moduleLogger.info('HumanLikeMessageProcessor shutting down');

    await this.stop();

    this.moduleLogger.info('HumanLikeMessageProcessor shutdown completed');
  }
}