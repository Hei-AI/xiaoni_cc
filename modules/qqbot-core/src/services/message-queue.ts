import { EventEmitter } from 'events';
import { QQMessage, QQNotice, QQRequest } from '../types';
import { logger } from '../utils/logger';

/**
 * 队列消息接口
 */
export interface QueuedMessage {
  id: string;
  traceId: string;
  type: 'private_message' | 'group_message' | 'notice' | 'request';
  payload: QQMessage | QQNotice | QQRequest;
  source: 'websocket' | 'simulation' | 'api';
  timestamp: Date;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  partitionKey: string; // 分区键：user_id 或 group_id
}

/**
 * 分区信息
 */
export interface PartitionInfo {
  partitionKey: string;
  type: 'user' | 'group';
  lastProcessedAt?: Date;
  messageCount: number;
}

/**
 * 轻量级分区消息队列
 * 特点：
 * 1. 按用户/群组分区，避免消息串扰
 * 2. 批量消费，每次拉取分区内全部消息  
 * 3. 内存队列，轻量级无依赖
 * 4. 支持优先级和消息追踪
 */
export class PartitionedMessageQueue extends EventEmitter {
  private partitions = new Map<string, QueuedMessage[]>(); // 分区 -> 消息列表
  private partitionInfo = new Map<string, PartitionInfo>(); // 分区元信息
  private moduleLogger = logger.createModuleLogger('message-queue');
  
  // 统计信息
  private stats = {
    totalMessages: 0,
    processedMessages: 0,
    partitionCount: 0,
    lastCleanupAt: new Date()
  };

  constructor() {
    super();
    this.startCleanupTimer();
  }

  /**
   * 推送消息到对应分区
   */
  async push(message: QueuedMessage): Promise<void> {
    const { partitionKey } = message;
    
    // 初始化分区
    if (!this.partitions.has(partitionKey)) {
      this.partitions.set(partitionKey, []);
      this.partitionInfo.set(partitionKey, {
        partitionKey,
        type: this.inferPartitionType(message),
        messageCount: 0
      });
      this.stats.partitionCount++;
    }

    // 添加消息到分区
    const partition = this.partitions.get(partitionKey)!;
    partition.push(message);
    
    // 按优先级排序（HIGH > MEDIUM > LOW）
    partition.sort((a, b) => this.getPriorityWeight(b.priority) - this.getPriorityWeight(a.priority));
    
    // 更新统计
    const info = this.partitionInfo.get(partitionKey)!;
    info.messageCount++;
    this.stats.totalMessages++;

    this.moduleLogger.debug('Message pushed to partition', {
      partitionKey,
      messageId: message.id,
      traceId: message.traceId,
      type: message.type,
      source: message.source,
      priority: message.priority,
      partitionSize: partition.length
    });

    // 触发新消息事件
    this.emit('message_queued', { partitionKey, message });
  }

  /**
   * 批量消费指定分区的所有消息
   */
  async consumePartition(partitionKey: string): Promise<QueuedMessage[]> {
    const partition = this.partitions.get(partitionKey);
    if (!partition || partition.length === 0) {
      return [];
    }

    // 一次性取出该分区的所有消息
    const messages = partition.splice(0);
    
    // 更新分区信息
    const info = this.partitionInfo.get(partitionKey)!;
    info.lastProcessedAt = new Date();
    info.messageCount = 0;
    this.stats.processedMessages += messages.length;

    this.moduleLogger.info('Partition consumed', {
      partitionKey,
      messageCount: messages.length,
      traceIds: messages.map(m => m.traceId)
    });

    // 如果分区空了，触发清空事件
    if (partition.length === 0) {
      this.emit('partition_empty', { partitionKey });
    }

    return messages;
  }

  /**
   * 获取所有有消息的分区键
   */
  getActivePartitions(): string[] {
    return Array.from(this.partitions.entries())
      .filter(([_, messages]) => messages.length > 0)
      .map(([partitionKey, _]) => partitionKey);
  }

  /**
   * 获取指定分区的消息数量
   */
  getPartitionSize(partitionKey: string): number {
    return this.partitions.get(partitionKey)?.length || 0;
  }

  /**
   * 获取分区信息
   */
  getPartitionInfo(partitionKey: string): PartitionInfo | undefined {
    return this.partitionInfo.get(partitionKey);
  }

  /**
   * 获取所有分区信息
   */
  getAllPartitions(): PartitionInfo[] {
    return Array.from(this.partitionInfo.values());
  }

  /**
   * 预览分区消息（不消费）
   */
  peekPartition(partitionKey: string, limit: number = 10): QueuedMessage[] {
    const partition = this.partitions.get(partitionKey);
    if (!partition || partition.length === 0) {
      return [];
    }
    return partition.slice(0, limit);
  }

  /**
   * 清空指定分区
   */
  clearPartition(partitionKey: string): number {
    const partition = this.partitions.get(partitionKey);
    if (!partition) return 0;

    const clearedCount = partition.length;
    partition.splice(0);
    
    const info = this.partitionInfo.get(partitionKey)!;
    info.messageCount = 0;
    
    this.moduleLogger.info('Partition cleared', { partitionKey, clearedCount });
    return clearedCount;
  }

  /**
   * 获取队列统计信息
   */
  getStats() {
    return {
      ...this.stats,
      activePartitions: this.getActivePartitions().length,
      totalPartitions: this.partitionInfo.size,
      avgMessagesPerPartition: this.stats.totalMessages / Math.max(1, this.partitionInfo.size)
    };
  }

  /**
   * 生成分区键
   */
  static generatePartitionKey(message: QQMessage | QQNotice | QQRequest): string {
    const msg = message as any;
    
    if (msg.message_type === 'private' || (!msg.group_id && msg.user_id)) {
      return `user_${msg.user_id}`;
    } else if (msg.message_type === 'group' || msg.group_id) {
      return `group_${msg.group_id}`;
    } else {
      // 其他类型消息（notice、request等）按用户分区
      return `user_${msg.user_id || 'system'}`;
    }
  }

  /**
   * 推断分区类型
   */
  private inferPartitionType(message: QueuedMessage): 'user' | 'group' {
    return message.partitionKey.startsWith('user_') ? 'user' : 'group';
  }

  /**
   * 获取优先级权重
   */
  private getPriorityWeight(priority: string): number {
    switch (priority) {
      case 'HIGH': return 3;
      case 'MEDIUM': return 2;
      case 'LOW': return 1;
      default: return 0;
    }
  }

  /**
   * 定时清理空分区
   */
  private startCleanupTimer(): void {
    setInterval(() => {
      this.cleanupEmptyPartitions();
    }, 5 * 60 * 1000); // 5分钟清理一次
  }

  /**
   * 清理空分区和过期数据
   */
  private cleanupEmptyPartitions(): void {
    const now = new Date();
    const cleanupThreshold = 30 * 60 * 1000; // 30分钟无活动则清理
    let cleanedCount = 0;

    for (const [partitionKey, info] of this.partitionInfo.entries()) {
      const partition = this.partitions.get(partitionKey);
      
      // 如果分区为空且长时间无活动，则清理
      if (!partition || partition.length === 0) {
        const lastActivity = info.lastProcessedAt || now;
        if (now.getTime() - lastActivity.getTime() > cleanupThreshold) {
          this.partitions.delete(partitionKey);
          this.partitionInfo.delete(partitionKey);
          this.stats.partitionCount--;
          cleanedCount++;
        }
      }
    }

    if (cleanedCount > 0) {
      this.moduleLogger.info('Empty partitions cleaned up', { 
        cleanedCount, 
        remainingPartitions: this.partitionInfo.size 
      });
    }

    this.stats.lastCleanupAt = now;
  }
}

/**
 * 消息模拟器 - 用于测试
 */
export default PartitionedMessageQueue;
