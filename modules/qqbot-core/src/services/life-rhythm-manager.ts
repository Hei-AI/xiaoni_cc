/**
 * 🧠 生活节奏管理器 - 人类行为模拟核心组件
 * 职责: 模拟人类活动规律，定期检查未处理消息，实现真实的在线状态模拟
 */

import {
  LifeRhythmConfig,
  QueuedMessage
} from '../types';
import { MessageArrivalHandler } from './message-arrival-handler';
import { MessageConsumptionTrigger } from './message-consumption-trigger';
import { LoggingService } from './logging-service';
import { logger } from '../utils/logger';

export class LifeRhythmManager {
  private checkInterval: NodeJS.Timeout | null = null;
  private messageArrivalHandler: MessageArrivalHandler;
  private consumptionTrigger: MessageConsumptionTrigger;
  private loggingService: LoggingService;
  private moduleLogger = logger.createModuleLogger('life-rhythm-manager');
  private config: LifeRhythmConfig;

  // 统计信息
  private stats = {
    totalChecks: 0,
    checksPerformed: 0,
    checksSkipped: 0,
    messagesProcessedByRhythm: 0,
    currentProbability: 0,
    lastCheckTime: new Date(),
    rhythmStartTime: new Date()
  };

  constructor(
    messageArrivalHandler: MessageArrivalHandler,
    consumptionTrigger: MessageConsumptionTrigger,
    loggingService: LoggingService,
    config: LifeRhythmConfig
  ) {
    this.messageArrivalHandler = messageArrivalHandler;
    this.consumptionTrigger = consumptionTrigger;
    this.loggingService = loggingService;
    this.config = config;

    this.moduleLogger.info('LifeRhythmManager initialized', {
      enabled: config.enabled,
      baseCheckInterval: config.baseCheckInterval,
      workHoursProbability: config.workHoursProbability,
      restHoursProbability: config.restHoursProbability,
      sleepHoursProbability: config.sleepHoursProbability
    });
  }

  /**
   * 启动生活节奏检查
   */
  public start(): void {
    if (!this.config.enabled) {
      this.moduleLogger.info('Life rhythm checking is disabled');
      return;
    }

    if (this.checkInterval) {
      this.moduleLogger.warn('Life rhythm manager already started');
      return;
    }

    this.stats.rhythmStartTime = new Date();

    this.checkInterval = setInterval(async () => {
      await this.performRhythmCheck();
    }, this.config.baseCheckInterval);

    this.moduleLogger.info('Life rhythm checking started', {
      checkInterval: this.config.baseCheckInterval
    });
  }

  /**
   * 停止生活节奏检查
   */
  public stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;

      this.moduleLogger.info('Life rhythm checking stopped', {
        totalRuntime: Date.now() - this.stats.rhythmStartTime.getTime(),
        stats: this.getStats()
      });
    }
  }

  /**
   * 执行节奏检查 - 概率化处理队列
   */
  private async performRhythmCheck(): Promise<void> {
    const startTime = Date.now();
    const currentHour = new Date().getHours();
    const checkProbability = this.getCheckProbability(currentHour);

    this.stats.totalChecks++;
    this.stats.currentProbability = checkProbability;
    this.stats.lastCheckTime = new Date();

    // 生成随机数进行概率判断
    const randomValue = Math.random();
    const shouldCheck = randomValue <= checkProbability;

    this.moduleLogger.debug('Rhythm check evaluation', {
      currentHour,
      checkProbability,
      randomValue,
      shouldCheck,
      timeSlot: this.getTimeSlotName(currentHour)
    });

    if (!shouldCheck) {
      this.stats.checksSkipped++;
      this.moduleLogger.debug('Rhythm check skipped - simulating offline/busy state', {
        currentHour,
        probability: checkProbability,
        timeSlot: this.getTimeSlotName(currentHour)
      });
      return;
    }

    try {
      this.stats.checksPerformed++;

      // 记录节奏检查事件
      await this.loggingService.logInstantEvent(
        `rhythm_${Date.now()}`,
        'life_rhythm',
        'rhythm_check_performed',
        'system',
        {
          current_hour: currentHour,
          check_probability: checkProbability,
          time_slot: this.getTimeSlotName(currentHour),
          random_value: randomValue
        }
      );

      // 检查所有源的未处理消息
      const activeSources = this.messageArrivalHandler.getActiveSources();
      let totalProcessedMessages = 0;

      for (const sourceKey of activeSources) {
        const queuedMessages = this.messageArrivalHandler.getSourceQueue(sourceKey);

        if (queuedMessages.length > 0) {
          this.moduleLogger.info('Processing queued messages via rhythm check', {
            sourceKey,
            messageCount: queuedMessages.length,
            timeSlot: this.getTimeSlotName(currentHour)
          });

          // 清空队列并获取消息
          const messagesToProcess = this.messageArrivalHandler.clearSourceQueue(sourceKey);

          // 触发消费
          await this.consumptionTrigger.triggerConsumption(
            sourceKey,
            messagesToProcess,
            'life_rhythm_check'
          );

          totalProcessedMessages += messagesToProcess.length;
        }
      }

      this.stats.messagesProcessedByRhythm += totalProcessedMessages;

      const processingTime = Date.now() - startTime;

      if (totalProcessedMessages > 0) {
        this.moduleLogger.info('Rhythm check completed with message processing', {
          processedMessages: totalProcessedMessages,
          processedSources: activeSources.length,
          processingTime,
          timeSlot: this.getTimeSlotName(currentHour)
        });
      } else {
        this.moduleLogger.debug('Rhythm check completed - no messages to process', {
          checkedSources: activeSources.length,
          processingTime
        });
      }

    } catch (error) {
      this.moduleLogger.error('Rhythm check failed', {
        currentHour,
        error: error instanceof Error ? error.message : 'Unknown error',
        processingTime: Date.now() - startTime
      });
    }
  }

  /**
   * 根据当前时间计算检查概率
   */
  private getCheckProbability(hour: number): number {
    if (hour >= this.config.workHoursStart && hour <= this.config.workHoursEnd) {
      return this.config.workHoursProbability; // 工作时间
    } else if (hour >= this.config.restHoursStart && hour <= this.config.restHoursEnd) {
      return this.config.restHoursProbability; // 休息时间
    } else {
      return this.config.sleepHoursProbability; // 睡眠时间
    }
  }

  /**
   * 获取时间段名称
   */
  private getTimeSlotName(hour: number): string {
    if (hour >= this.config.workHoursStart && hour <= this.config.workHoursEnd) {
      return 'work_hours';
    } else if (hour >= this.config.restHoursStart && hour <= this.config.restHoursEnd) {
      return 'rest_hours';
    } else {
      return 'sleep_hours';
    }
  }

  /**
   * 手动触发一次检查 (调试和测试用)
   */
  public async triggerManualCheck(): Promise<void> {
    this.moduleLogger.info('Manual rhythm check triggered');

    try {
      await this.performRhythmCheck();
    } catch (error) {
      this.moduleLogger.error('Manual rhythm check failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * 获取当前的活动概率
   */
  public getCurrentActivityProbability(): {
    currentHour: number;
    timeSlot: string;
    probability: number;
    nextCheckIn: number;
  } {
    const currentHour = new Date().getHours();
    const timeSlot = this.getTimeSlotName(currentHour);
    const probability = this.getCheckProbability(currentHour);

    const nextCheckIn = this.checkInterval
      ? this.config.baseCheckInterval
      : 0;

    return {
      currentHour,
      timeSlot,
      probability,
      nextCheckIn
    };
  }

  /**
   * 更新配置 (运行时调整)
   */
  public updateConfig(newConfig: Partial<LifeRhythmConfig>): void {
    const oldConfig = { ...this.config };
    this.config = { ...this.config, ...newConfig };

    this.moduleLogger.info('Life rhythm configuration updated', {
      oldConfig,
      newConfig: this.config
    });

    // 如果启用状态发生变化，相应地启动或停止服务
    if (oldConfig.enabled !== this.config.enabled) {
      if (this.config.enabled) {
        this.start();
      } else {
        this.stop();
      }
    }

    // 如果检查间隔发生变化，重启定时器
    if (oldConfig.baseCheckInterval !== this.config.baseCheckInterval && this.checkInterval) {
      this.stop();
      this.start();
    }
  }

  /**
   * 获取统计信息
   */
  public getStats() {
    const runtime = Date.now() - this.stats.rhythmStartTime.getTime();
    const currentActivity = this.getCurrentActivityProbability();

    return {
      ...this.stats,
      // 计算比率
      checkPerformanceRate: this.stats.totalChecks > 0
        ? this.stats.checksPerformed / this.stats.totalChecks
        : 0,
      checkSkipRate: this.stats.totalChecks > 0
        ? this.stats.checksSkipped / this.stats.totalChecks
        : 0,

      // 当前状态
      isRunning: this.checkInterval !== null,
      runtime,
      currentActivity,

      // 效率指标
      averageMessagesPerCheck: this.stats.checksPerformed > 0
        ? this.stats.messagesProcessedByRhythm / this.stats.checksPerformed
        : 0,

      // 配置信息
      config: this.config
    };
  }

  /**
   * 重置统计信息
   */
  public resetStats(): void {
    this.stats = {
      totalChecks: 0,
      checksPerformed: 0,
      checksSkipped: 0,
      messagesProcessedByRhythm: 0,
      currentProbability: 0,
      lastCheckTime: new Date(),
      rhythmStartTime: new Date()
    };

    this.moduleLogger.info('Life rhythm statistics reset');
  }

  /**
   * 优雅关闭
   */
  public async shutdown(): Promise<void> {
    this.moduleLogger.info('LifeRhythmManager shutting down', {
      isRunning: this.checkInterval !== null,
      finalStats: this.getStats()
    });

    this.stop();

    this.moduleLogger.info('LifeRhythmManager shutdown completed');
  }
}