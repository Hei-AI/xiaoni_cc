/**
 * 时间线追踪器 - 用于收集对话处理过程中的关键时间节点
 * 支持在时间线页面显示各个处理阶段的开始时间
 */

export interface TimelineEvent {
  eventType: string;
  eventName: string;
  timestamp: Date;
  duration?: number;
  metadata?: any;
}

export class TimelineTracker {
  private events: TimelineEvent[] = [];
  private traceId: string;
  private startTimes: Map<string, number> = new Map();

  constructor(traceId: string) {
    this.traceId = traceId;
  }

  /**
   * 记录事件开始时间
   */
  markStart(eventType: string, eventName: string, metadata?: any): void {
    const timestamp = new Date();
    const key = `${eventType}_${eventName}`;

    this.startTimes.set(key, timestamp.getTime());

    this.events.push({
      eventType,
      eventName,
      timestamp,
      metadata
    });
  }

  /**
   * 记录事件结束时间并计算耗时
   */
  markEnd(eventType: string, eventName: string, metadata?: any): void {
    const endTime = new Date();
    const key = `${eventType}_${eventName}`;
    const startTime = this.startTimes.get(key);

    if (startTime) {
      const duration = endTime.getTime() - startTime;

      // 找到对应的开始事件并更新耗时
      const startEvent = this.events.find(e =>
        e.eventType === eventType &&
        e.eventName === eventName &&
        !e.duration
      );

      if (startEvent) {
        startEvent.duration = duration;
        if (metadata) {
          startEvent.metadata = { ...startEvent.metadata, ...metadata };
        }
      }
    }
  }

  /**
   * 记录瞬时事件（无持续时间）
   */
  markInstant(eventType: string, eventName: string, metadata?: any): void {
    this.events.push({
      eventType,
      eventName,
      timestamp: new Date(),
      duration: 0,
      metadata
    });
  }

  /**
   * 获取所有时间线事件
   */
  getEvents(): TimelineEvent[] {
    return [...this.events].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  /**
   * 获取特定类型的事件
   */
  getEventsByType(eventType: string): TimelineEvent[] {
    return this.events
      .filter(e => e.eventType === eventType)
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  /**
   * 清空所有事件
   */
  clear(): void {
    this.events = [];
    this.startTimes.clear();
  }

  /**
   * 导出时间线数据供API使用
   */
  exportForAPI() {
    return {
      traceId: this.traceId,
      events: this.getEvents(),
      summary: {
        totalEvents: this.events.length,
        firstEvent: this.events.length > 0 ? Math.min(...this.events.map(e => e.timestamp.getTime())) : null,
        lastEvent: this.events.length > 0 ? Math.max(...this.events.map(e => e.timestamp.getTime())) : null,
        totalDuration: this.calculateTotalDuration()
      }
    };
  }

  private calculateTotalDuration(): number {
    if (this.events.length === 0) return 0;

    const times = this.events.map(e => e.timestamp.getTime());
    return Math.max(...times) - Math.min(...times);
  }
}

/**
 * 全局时间线追踪器管理器
 */
class TimelineTrackerManager {
  private trackers: Map<string, TimelineTracker> = new Map();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // 定期清理超过1小时的追踪器
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60 * 60 * 1000); // 1小时清理一次
  }

  /**
   * 获取或创建追踪器
   */
  getTracker(traceId: string): TimelineTracker {
    if (!this.trackers.has(traceId)) {
      this.trackers.set(traceId, new TimelineTracker(traceId));
    }
    return this.trackers.get(traceId)!;
  }

  /**
   * 获取追踪器（不创建新的）
   */
  getExistingTracker(traceId: string): TimelineTracker | null {
    return this.trackers.get(traceId) || null;
  }

  /**
   * 移除追踪器
   */
  removeTracker(traceId: string): void {
    this.trackers.delete(traceId);
  }

  /**
   * 清理超时的追踪器
   */
  private cleanup(): void {
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    const toRemove: string[] = [];

    for (const [traceId, tracker] of this.trackers.entries()) {
      const events = tracker.getEvents();
      if (events.length > 0) {
        const lastEventTime = Math.max(...events.map(e => e.timestamp.getTime()));
        if (lastEventTime < oneHourAgo) {
          toRemove.push(traceId);
        }
      }
    }

    toRemove.forEach(traceId => this.trackers.delete(traceId));
  }

  /**
   * 销毁管理器
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.trackers.clear();
  }
}

// 全局实例
export const timelineTrackerManager = new TimelineTrackerManager();

/**
 * 便捷的时间线事件类型常量
 */
export const TIMELINE_EVENTS = {
  WEBSOCKET: {
    MESSAGE_RECEIVED: 'message_received',
    MESSAGE_SENT: 'message_sent'
  },
  PROCESSING: {
    START: 'processing_start',
    CONTEXT_BUILD: 'context_build',
    DECISION_ENGINE: 'decision_engine',
    SESSION_PROCESS: 'session_process'
  },
  LLM: {
    CALL_START: 'llm_call_start',
    CALL_END: 'llm_call_end'
  },
  ENGINE: {
    DECISION_V2: 'decision_engine_v2',
    STYLE: 'style_engine',
    CONTEXT: 'context_engine'
  }
} as const;
