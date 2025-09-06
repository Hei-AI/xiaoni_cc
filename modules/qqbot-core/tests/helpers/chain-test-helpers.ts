import { QQMessage } from '../../src/types';
import { createMockPrivateMessage, createMockReplyMessage } from './test-messages';

export interface ChainNode {
  id: string;
  depth: number;
  parent?: string;
  userId?: number;
  message?: string;
}

/**
 * 创建复杂的回复链测试数据
 * 按照SE同事建议实现分层测试方法
 */
export class ReplyChainTestBuilder {
  private chains: ChainNode[] = [];
  private messages: QQMessage[] = [];

  /**
   * 添加链节点
   */
  addNode(node: ChainNode): this {
    this.chains.push(node);
    return this;
  }

  /**
   * 创建深度回复链
   */
  createDeepChain(depth: number, startId: number = 1000, userId: number = 85178516): this {
    for (let i = 0; i < depth; i++) {
      const nodeId = (startId + i).toString();
      const parentId = i > 0 ? (startId + i - 1).toString() : undefined;
      
      this.addNode({
        id: nodeId,
        depth: i + 1,
        parent: parentId,
        userId: userId,
        message: `深度回复消息 ${i + 1}`
      });
    }
    return this;
  }

  /**
   * 创建分支回复链
   */
  createBranchedChain(rootId: string, branches: number, depth: number): this {
    // 添加根节点
    this.addNode({
      id: rootId,
      depth: 1,
      userId: 85178516,
      message: '根消息'
    });

    // 为每个分支创建子链
    for (let branch = 0; branch < branches; branch++) {
      for (let level = 1; level <= depth; level++) {
        const nodeId = `${rootId}_branch${branch}_${level}`;
        const parentId = level === 1 ? rootId : `${rootId}_branch${branch}_${level - 1}`;
        
        this.addNode({
          id: nodeId,
          depth: level + 1,
          parent: parentId,
          userId: 85178516,
          message: `分支${branch} 第${level}层消息`
        });
      }
    }
    return this;
  }

  /**
   * 创建断裂的回复链（测试错误处理）
   */
  createBrokenChain(totalDepth: number, missingNodeDepth: number): this {
    for (let i = 0; i < totalDepth; i++) {
      const nodeId = (1000 + i).toString();
      
      // 跳过指定深度的节点，创建断裂
      if (i + 1 === missingNodeDepth) {
        continue;
      }
      
      const parentId = i > 0 ? (1000 + i - 1).toString() : undefined;
      
      this.addNode({
        id: nodeId,
        depth: i + 1,
        parent: parentId,
        userId: 85178516,
        message: `断裂链消息 ${i + 1}`
      });
    }
    return this;
  }

  /**
   * 创建跨用户回复链
   */
  createMultiUserChain(depth: number, userIds: number[]): this {
    for (let i = 0; i < depth; i++) {
      const nodeId = (2000 + i).toString();
      const parentId = i > 0 ? (2000 + i - 1).toString() : undefined;
      const userId = userIds[i % userIds.length];
      
      this.addNode({
        id: nodeId,
        depth: i + 1,
        parent: parentId,
        userId: userId,
        message: `跨用户消息 ${i + 1} (用户${userId})`
      });
    }
    return this;
  }

  /**
   * 获取链数据
   */
  getChains(): ChainNode[] {
    return [...this.chains];
  }

  /**
   * 转换为QQMessage数组
   */
  toQQMessages(): QQMessage[] {
    const messages: QQMessage[] = [];
    
    this.chains.forEach(node => {
      if (node.parent) {
        // 创建回复消息
        const message = createMockReplyMessage(
          parseInt(node.id),
          node.userId || 85178516,
          parseInt(node.parent),
          node.message || `回复消息 ${node.id}`
        );
        messages.push(message);
      } else {
        // 创建普通消息
        const message = createMockPrivateMessage(
          parseInt(node.id),
          node.userId || 85178516,
          node.message || `消息 ${node.id}`
        );
        messages.push(message);
      }
    });
    
    return messages;
  }

  /**
   * 获取特定深度的节点
   */
  getNodeAtDepth(depth: number): ChainNode | undefined {
    return this.chains.find(node => node.depth === depth);
  }

  /**
   * 获取链的最大深度
   */
  getMaxDepth(): number {
    return Math.max(...this.chains.map(node => node.depth));
  }

  /**
   * 清空链数据
   */
  clear(): this {
    this.chains = [];
    this.messages = [];
    return this;
  }

  /**
   * 验证链的完整性
   */
  validateChain(): { isValid: boolean; issues: string[] } {
    const issues: string[] = [];
    const nodeIds = new Set(this.chains.map(node => node.id));
    
    this.chains.forEach(node => {
      // 检查父节点是否存在
      if (node.parent && !nodeIds.has(node.parent)) {
        issues.push(`节点 ${node.id} 的父节点 ${node.parent} 不存在`);
      }
      
      // 检查深度逻辑
      if (node.parent) {
        const parent = this.chains.find(n => n.id === node.parent);
        if (parent && node.depth !== parent.depth + 1) {
          issues.push(`节点 ${node.id} 的深度 ${node.depth} 与父节点 ${node.parent} 深度不匹配`);
        }
      }
    });
    
    return {
      isValid: issues.length === 0,
      issues
    };
  }
}

/**
 * 并发测试数据生成器
 */
export class ConcurrentTestDataGenerator {
  /**
   * 生成大量并发Session创建测试数据
   */
  static generateConcurrentSessions(
    count: number, 
    userIdStart: number = 100000,
    messageIdStart: number = 10000
  ): QQMessage[] {
    const messages: QQMessage[] = [];
    
    for (let i = 0; i < count; i++) {
      const userId = userIdStart + (i % 100); // 100个不同用户
      const messageId = messageIdStart + i;
      const message = createMockPrivateMessage(
        messageId,
        userId,
        `并发需求测试消息 ${i + 1}`
      );
      messages.push(message);
    }
    
    return messages;
  }

  /**
   * 生成同一用户的并发消息
   */
  static generateSameUserConcurrentMessages(
    count: number,
    userId: number = 85178516,
    messageIdStart: number = 20000
  ): QQMessage[] {
    const messages: QQMessage[] = [];
    
    for (let i = 0; i < count; i++) {
      const messageId = messageIdStart + i;
      const message = createMockPrivateMessage(
        messageId,
        userId,
        `用户${userId}的并发消息 ${i + 1}`
      );
      messages.push(message);
    }
    
    return messages;
  }

  /**
   * 生成性能压力测试数据
   */
  static generateStressTestData(scenarios: {
    sessionCount: number;
    messagesPerSession: number;
    userCount: number;
  }): {
    messages: QQMessage[];
    expectedSessions: number;
    expectedUsers: number;
  } {
    const messages: QQMessage[] = [];
    let messageId = 30000;
    
    for (let session = 0; session < scenarios.sessionCount; session++) {
      const userId = 100000 + (session % scenarios.userCount);
      
      for (let msg = 0; msg < scenarios.messagesPerSession; msg++) {
        const message = createMockPrivateMessage(
          messageId++,
          userId,
          `压力测试会话${session}-消息${msg + 1}`
        );
        messages.push(message);
      }
    }
    
    return {
      messages,
      expectedSessions: scenarios.sessionCount,
      expectedUsers: scenarios.userCount
    };
  }
}

/**
 * Session性能测试辅助函数
 */
export class SessionPerformanceHelper {
  private static performanceMarks: Map<string, number> = new Map();

  static startTimer(label: string): void {
    this.performanceMarks.set(label, performance.now());
  }

  static endTimer(label: string): number {
    const start = this.performanceMarks.get(label);
    if (!start) {
      throw new Error(`Performance timer '${label}' not found`);
    }
    
    const duration = performance.now() - start;
    this.performanceMarks.delete(label);
    return duration;
  }

  static async measureAsync<T>(label: string, operation: () => Promise<T>): Promise<{
    result: T;
    duration: number;
  }> {
    this.startTimer(label);
    const result = await operation();
    const duration = this.endTimer(label);
    
    return { result, duration };
  }

  static clearAllTimers(): void {
    this.performanceMarks.clear();
  }
}