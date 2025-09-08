/**
 * TraceID生成策略管理器
 * 决定哪些事件需要生成TraceID进行链路追踪
 */

import { TraceIdGenerator } from './trace-id';

/**
 * 事件类型枚举
 */
export enum EventType {
  // 消息类事件
  PRIVATE_MESSAGE = 'private_message',
  GROUP_MESSAGE = 'group_message', 
  MESSAGE_SENT = 'message_sent',

  // 请求类事件
  FRIEND_REQUEST = 'friend_request',
  GROUP_REQUEST = 'group_request',

  // 通知类事件 - 重要
  GROUP_INCREASE = 'group_increase',
  GROUP_DECREASE = 'group_decrease',
  GROUP_BAN = 'group_ban',
  GROUP_ADMIN = 'group_admin',
  
  // 通知类事件 - 一般
  GROUP_CARD = 'group_card',
  FRIEND_ADD = 'friend_add',

  // 系统维护事件
  META_LIFECYCLE = 'meta_event',
  META_HEARTBEAT = 'heartbeat',
  
  // API响应
  API_RESPONSE = 'api_response'
}

/**
 * TraceID策略配置
 */
interface TraceStrategy {
  shouldGenerateTrace: boolean;    // 是否生成TraceID
  shouldLogEvent: boolean;         // 是否记录事件日志
  priority: 'HIGH' | 'MEDIUM' | 'LOW' | 'IGNORE';  // 事件优先级
  description: string;             // 策略说明
}

/**
 * 事件处理策略映射表
 */
const EVENT_STRATEGIES: Record<string, TraceStrategy> = {
  // 消息类事件 - 最高优先级，只有这些事件生成TraceID
  [EventType.PRIVATE_MESSAGE]: {
    shouldGenerateTrace: true,
    shouldLogEvent: true,
    priority: 'HIGH',
    description: '私聊消息 - 核心用户交互，必须追踪完整链路'
  },
  [EventType.GROUP_MESSAGE]: {
    shouldGenerateTrace: true,
    shouldLogEvent: true,
    priority: 'HIGH', 
    description: '群聊消息 - 核心用户交互，必须追踪完整链路'
  },
  [EventType.MESSAGE_SENT]: {
    shouldGenerateTrace: false, // 关联现有TraceID，不生成新的
    shouldLogEvent: true,
    priority: 'HIGH',
    description: '消息发送确认 - 关联现有TraceID记录发送结果'
  },

  // 请求类事件 - 仅记录日志，不生成TraceID
  [EventType.FRIEND_REQUEST]: {
    shouldGenerateTrace: false,
    shouldLogEvent: true,
    priority: 'MEDIUM',
    description: '好友申请 - 仅记录事件，不追踪处理链路'
  },
  [EventType.GROUP_REQUEST]: {
    shouldGenerateTrace: false,
    shouldLogEvent: true,
    priority: 'MEDIUM',
    description: '群邀请/申请 - 仅记录事件，不追踪处理链路'
  },

  // 重要通知事件 - 仅记录日志，不生成TraceID
  [EventType.GROUP_INCREASE]: {
    shouldGenerateTrace: false,
    shouldLogEvent: true,
    priority: 'LOW',
    description: '群成员增加 - 仅记录事件，不追踪处理链路'
  },
  [EventType.GROUP_DECREASE]: {
    shouldGenerateTrace: false,
    shouldLogEvent: true,
    priority: 'LOW',
    description: '群成员减少 - 仅记录事件，不追踪处理链路'
  },
  [EventType.GROUP_BAN]: {
    shouldGenerateTrace: false,
    shouldLogEvent: true,
    priority: 'LOW',
    description: '群禁言事件 - 仅记录事件，不追踪处理链路'
  },
  [EventType.GROUP_ADMIN]: {
    shouldGenerateTrace: false,
    shouldLogEvent: true,
    priority: 'LOW',
    description: '群管理变动 - 仅记录事件，不追踪处理链路'
  },

  // 一般通知事件 - 低优先级
  [EventType.GROUP_CARD]: {
    shouldGenerateTrace: false,
    shouldLogEvent: true,
    priority: 'LOW',
    description: '群名片变动 - 仅记录，通常不需要处理'
  },
  [EventType.FRIEND_ADD]: {
    shouldGenerateTrace: false,
    shouldLogEvent: true,
    priority: 'LOW',
    description: '好友添加成功 - 仅记录，处理已完成'
  },

  // 系统维护事件 - 忽略或极低优先级
  [EventType.META_LIFECYCLE]: {
    shouldGenerateTrace: false,
    shouldLogEvent: false,
    priority: 'IGNORE',
    description: '生命周期事件 - 系统内部维护，不需要追踪'
  },
  [EventType.META_HEARTBEAT]: {
    shouldGenerateTrace: false,
    shouldLogEvent: false,
    priority: 'IGNORE',
    description: '心跳事件 - 系统维护，不需要追踪或记录'
  },
  [EventType.API_RESPONSE]: {
    shouldGenerateTrace: false,
    shouldLogEvent: false,
    priority: 'IGNORE',
    description: 'API响应 - 内部通信确认，不需要追踪'
  }
};

/**
 * TraceID策略管理器
 */
export class TraceStrategyManager {
  /**
   * 判断事件是否需要生成TraceID
   * @param eventType 事件类型
   * @param eventData 事件数据
   * @returns 是否需要生成TraceID
   */
  static shouldGenerateTrace(eventType: string, eventData?: any): boolean {
    // 处理meta_event的子类型
    if (eventType === 'meta_event') {
      const metaType = eventData?.meta_event_type;
      if (metaType === 'lifecycle' || metaType === 'heartbeat') {
        return false;
      }
    }

    const strategy = EVENT_STRATEGIES[eventType];
    return strategy?.shouldGenerateTrace ?? false;
  }

  /**
   * 判断事件是否需要记录日志
   * @param eventType 事件类型
   * @param eventData 事件数据
   * @returns 是否需要记录日志
   */
  static shouldLogEvent(eventType: string, eventData?: any): boolean {
    // 处理meta_event的特殊情况
    if (eventType === 'meta_event') {
      const metaType = eventData?.meta_event_type;
      if (metaType === 'heartbeat') {
        return false; // 心跳事件不记录日志
      }
      if (metaType === 'lifecycle') {
        const subType = eventData?.sub_type;
        // 仅记录连接/断连，不记录enable/disable
        return subType === 'connect' || subType === 'disconnect';
      }
    }

    const strategy = EVENT_STRATEGIES[eventType];
    return strategy?.shouldLogEvent ?? false;
  }

  /**
   * 获取事件优先级
   * @param eventType 事件类型
   * @returns 事件优先级
   */
  static getEventPriority(eventType: string): 'HIGH' | 'MEDIUM' | 'LOW' | 'IGNORE' {
    const strategy = EVENT_STRATEGIES[eventType];
    return strategy?.priority ?? 'IGNORE';
  }

  /**
   * 获取策略描述
   * @param eventType 事件类型
   * @returns 策略说明
   */
  static getStrategyDescription(eventType: string): string {
    const strategy = EVENT_STRATEGIES[eventType];
    return strategy?.description ?? '未知事件类型';
  }

  /**
   * 为事件生成TraceID（如果需要的话）
   * @param eventType 事件类型
   * @param eventData 事件数据
   * @returns TraceID或null
   */
  static generateTraceIfNeeded(eventType: string, eventData?: any): string | null {
    if (!this.shouldGenerateTrace(eventType, eventData)) {
      return null;
    }

    // 从事件数据中提取用户ID
    const userId = eventData?.user_id || eventData?.operator_id;
    return TraceIdGenerator.generate(userId);
  }

  /**
   * 获取所有支持的事件策略
   * @returns 事件策略映射表
   */
  static getAllStrategies(): Record<string, TraceStrategy> {
    return { ...EVENT_STRATEGIES };
  }

  /**
   * 获取需要追踪的事件类型列表
   * @returns 需要生成TraceID的事件类型数组
   */
  static getTraceableEvents(): string[] {
    return Object.entries(EVENT_STRATEGIES)
      .filter(([_, strategy]) => strategy.shouldGenerateTrace)
      .map(([eventType, _]) => eventType);
  }

  /**
   * 检查事件是否为用户交互类型
   * @param eventType 事件类型
   * @returns 是否为用户交互事件
   */
  static isUserInteractionEvent(eventType: string): boolean {
    const highPriorityEvents = [
      EventType.PRIVATE_MESSAGE,
      EventType.GROUP_MESSAGE,
      EventType.FRIEND_REQUEST,
      EventType.GROUP_REQUEST
    ];
    return highPriorityEvents.includes(eventType as EventType);
  }
}

/**
 * 事件处理上下文接口
 */
export interface EventContext {
  eventType: string;
  traceId: string | null;
  priority: 'HIGH' | 'MEDIUM' | 'LOW' | 'IGNORE';
  shouldLog: boolean;
  timestamp: Date;
  eventData: any;
}

/**
 * 创建事件处理上下文
 * @param eventType 事件类型
 * @param eventData 事件数据
 * @returns 完整的事件上下文
 */
export function createEventContext(eventType: string, eventData: any): EventContext {
  const traceId = TraceStrategyManager.generateTraceIfNeeded(eventType, eventData);
  const priority = TraceStrategyManager.getEventPriority(eventType);
  const shouldLog = TraceStrategyManager.shouldLogEvent(eventType, eventData);

  return {
    eventType,
    traceId,
    priority,
    shouldLog,
    timestamp: new Date(),
    eventData
  };
}