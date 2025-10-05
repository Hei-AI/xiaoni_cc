/**
 * DirectNotifier - 直连模式通知器
 *
 * 职责：
 * - 消息入队后立即触发 handler 处理
 * - 绕过调度器，实现低延迟响应
 * - 适用于 ENABLE_HUMAN_LIKE_PROCESSING=false 场景
 *
 * 工作流程：
 * 1. WebSocket 收到消息 → enqueue
 * 2. DirectNotifier.notify(sourceKey) 立即触发
 * 3. 调用 handler(sourceKey, 'direct')
 * 4. handler 内部 drain(sourceKey) 取出消息批量处理
 */

import { logger } from '../utils/logger';
import { DrainedMessage } from './message-queue-service';

export type TriggerType = 'direct' | 'scheduled' | 'manual';

export interface BatchHandler {
  handlePrivateMessageBatch(sourceKey: string, messages: DrainedMessage[], triggerType: TriggerType): Promise<void>;
  handleGroupMessageBatch(sourceKey: string, messages: DrainedMessage[], triggerType: TriggerType): Promise<void>;
}

export class DirectNotifier {
  private moduleLogger = logger.createModuleLogger('direct-notifier');
  private handler: BatchHandler;
  private stats = {
    totalNotifications: 0,
    privateNotifications: 0,
    groupNotifications: 0,
    failedNotifications: 0
  };

  constructor(handler: BatchHandler) {
    this.handler = handler;
    this.moduleLogger.info('DirectNotifier initialized');
  }

  /**
   * 立即通知处理指定 sourceKey 的消息
   * @param sourceKey 源标识符 (user_123 或 group_456)
   * @param messages 已 drain 的消息数组
   */
  async notify(sourceKey: string, messages: DrainedMessage[]): Promise<void> {
    if (messages.length === 0) {
      this.moduleLogger.debug('No messages to process', { sourceKey });
      return;
    }

    this.stats.totalNotifications++;

    const messageType = this.inferMessageType(sourceKey);
    this.moduleLogger.info('DirectNotifier triggering handler', {
      sourceKey,
      messageType,
      messageCount: messages.length,
      triggerType: 'direct'
    });

    try {
      if (messageType === 'private') {
        this.stats.privateNotifications++;
        await this.handler.handlePrivateMessageBatch(sourceKey, messages, 'direct');
      } else if (messageType === 'group') {
        this.stats.groupNotifications++;
        await this.handler.handleGroupMessageBatch(sourceKey, messages, 'direct');
      }

      this.moduleLogger.info('Handler completed successfully', {
        sourceKey,
        messageCount: messages.length
      });
    } catch (error) {
      this.stats.failedNotifications++;
      this.moduleLogger.error('Handler failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        sourceKey,
        messageCount: messages.length
      });
      throw error;
    }
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return { ...this.stats };
  }

  /**
   * 重置统计信息
   */
  resetStats() {
    this.stats = {
      totalNotifications: 0,
      privateNotifications: 0,
      groupNotifications: 0,
      failedNotifications: 0
    };
  }

  /**
   * 推断消息类型（基于 sourceKey）
   */
  private inferMessageType(sourceKey: string): 'private' | 'group' {
    return sourceKey.startsWith('user_') ? 'private' : 'group';
  }
}

export default DirectNotifier;
