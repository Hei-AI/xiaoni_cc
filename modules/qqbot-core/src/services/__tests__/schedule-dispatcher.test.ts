/**
 * ScheduleDispatcher 单元测试
 */

import { ScheduleDispatcher } from '../schedule-dispatcher';
import { MessageQueueService } from '../message-queue-service';
import { BatchHandler, TriggerType } from '../direct-notifier';
import { DrainedMessage } from '../message-queue-service';
import { QQMessage } from '../../types';

// Mock BatchHandler for testing
class MockBatchHandler implements BatchHandler {
  public privateMessages: Array<{ sourceKey: string; messages: DrainedMessage[]; triggerType: TriggerType }> = [];
  public groupMessages: Array<{ sourceKey: string; messages: DrainedMessage[]; triggerType: TriggerType }> = [];

  async handlePrivateMessageBatch(sourceKey: string, messages: DrainedMessage[], triggerType: TriggerType): Promise<void> {
    this.privateMessages.push({ sourceKey, messages, triggerType });
  }

  async handleGroupMessageBatch(sourceKey: string, messages: DrainedMessage[], triggerType: TriggerType): Promise<void> {
    this.groupMessages.push({ sourceKey, messages, triggerType });
  }

  reset() {
    this.privateMessages = [];
    this.groupMessages = [];
  }
}

// Helper function to wait for a specified time
function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

describe('ScheduleDispatcher', () => {
  let queueService: MessageQueueService;
  let dispatcher: ScheduleDispatcher;
  let mockHandler: MockBatchHandler;
  const AUTHORIZED_USER_ID = 85178516;
  const BOT_QQ_NUMBER = 1129974489;

  beforeEach(() => {
    queueService = new MessageQueueService(AUTHORIZED_USER_ID, BOT_QQ_NUMBER);
    mockHandler = new MockBatchHandler();

    // 使用短间隔进行测试
    dispatcher = new ScheduleDispatcher(queueService, mockHandler, {
      scanInterval: 100,  // 100ms
      minInterval: 50,    // 50ms
      maxInterval: 500,   // 500ms
      tickInterval: 50    // 50ms tick
    });
  });

  afterEach(() => {
    dispatcher.stop();
  });

  describe('High Priority Immediate Processing', () => {
    it('should immediately process HIGH priority messages', async () => {
      // Enqueue HIGH priority message
      const message: QQMessage = {
        message_type: 'private',
        user_id: AUTHORIZED_USER_ID,
        message: '测试消息',
        raw_message: '测试消息',
        message_id: 1001,
        time: Math.floor(Date.now() / 1000),
        self_id: BOT_QQ_NUMBER,
        sender: {
          user_id: AUTHORIZED_USER_ID,
          nickname: '授权用户',
          sex: 'unknown'
        },
        font: 14,
        sub_type: 'friend',
        post_type: 'message'
      };

      await queueService.enqueue(message);

      // Schedule with HIGH priority
      await dispatcher.schedule('user_' + AUTHORIZED_USER_ID, 'HIGH');

      // Should be processed immediately
      expect(mockHandler.privateMessages).toHaveLength(1);
      expect(mockHandler.privateMessages[0].sourceKey).toBe('user_' + AUTHORIZED_USER_ID);
      expect(mockHandler.privateMessages[0].triggerType).toBe('scheduled');

      // Queue should be empty after processing
      expect(queueService.getUnreadCount('user_' + AUTHORIZED_USER_ID)).toBe(0);
    });

    it('should process @bot messages immediately', async () => {
      const message: QQMessage = {
        message_type: 'group',
        user_id: 123456,
        group_id: 789012,
        message: [
          { type: 'at', data: { qq: BOT_QQ_NUMBER.toString() } },
          { type: 'text', data: { text: ' 测试@机器人' } }
        ],
        raw_message: '@机器人 测试',
        message_id: 2001,
        time: Math.floor(Date.now() / 1000),
        self_id: BOT_QQ_NUMBER,
        sender: {
          user_id: 123456,
          nickname: '测试用户',
          sex: 'unknown',
          card: '群名片',
          role: 'member'
        },
        font: 14,
        sub_type: 'normal',
        post_type: 'message'
      };

      await queueService.enqueue(message);
      await dispatcher.schedule('group_789012', 'HIGH');

      expect(mockHandler.groupMessages).toHaveLength(1);
      expect(mockHandler.groupMessages[0].sourceKey).toBe('group_789012');
      expect(queueService.getUnreadCount('group_789012')).toBe(0);
    });
  });

  describe('Scheduled Processing', () => {
    it('should schedule MEDIUM priority messages', async () => {
      dispatcher.start();

      const message: QQMessage = {
        message_type: 'private',
        user_id: 123456,
        message: '普通消息',
        raw_message: '普通消息',
        message_id: 3001,
        time: Math.floor(Date.now() / 1000),
        self_id: BOT_QQ_NUMBER,
        sender: {
          user_id: 123456,
          nickname: '测试用户',
          sex: 'unknown'
        },
        font: 14,
        sub_type: 'friend',
        post_type: 'message'
      };

      await queueService.enqueue(message);

      // Schedule with MEDIUM priority
      await dispatcher.schedule('user_123456', 'MEDIUM');

      // Should NOT be processed immediately
      expect(mockHandler.privateMessages).toHaveLength(0);

      // Check that it's in the schedule queue
      const scheduleQueue = dispatcher.getScheduleQueue();
      expect(scheduleQueue).toHaveLength(1);
      expect(scheduleQueue[0].sourceKey).toBe('user_123456');
      expect(scheduleQueue[0].priority).toBe('MEDIUM');

      // Wait for tick to process
      await wait(200); // Wait for tick + processing

      // Now it should be processed
      expect(mockHandler.privateMessages.length).toBeGreaterThan(0);
      expect(queueService.getUnreadCount('user_123456')).toBe(0);

      // Schedule queue should be empty after processing
      expect(dispatcher.getScheduleQueue()).toHaveLength(0);
    });

    it('should schedule LOW priority messages', async () => {
      dispatcher.start();

      const message: QQMessage = {
        message_type: 'group',
        user_id: 123456,
        group_id: 789012,
        message: '普通群聊',
        raw_message: '普通群聊',
        message_id: 4001,
        time: Math.floor(Date.now() / 1000),
        self_id: BOT_QQ_NUMBER,
        sender: {
          user_id: 123456,
          nickname: '测试用户',
          sex: 'unknown',
          card: '群名片',
          role: 'member'
        },
        font: 14,
        sub_type: 'normal',
        post_type: 'message'
      };

      await queueService.enqueue(message);
      await dispatcher.schedule('group_789012', 'LOW');

      // Should be in schedule queue
      const scheduleQueue = dispatcher.getScheduleQueue();
      expect(scheduleQueue).toHaveLength(1);
      expect(scheduleQueue[0].priority).toBe('LOW');

      // Wait for processing
      await wait(200);

      expect(mockHandler.groupMessages.length).toBeGreaterThan(0);
    });
  });

  describe('NextCheckTime Calculation', () => {
    it('should clamp nextCheckTime to minInterval', async () => {
      // Create dispatcher with specific intervals
      const testDispatcher = new ScheduleDispatcher(queueService, mockHandler, {
        scanInterval: 10,   // Very short scan interval
        minInterval: 100,   // Min is 100ms
        maxInterval: 1000,
        tickInterval: 50
      });

      const message: QQMessage = {
        message_type: 'private',
        user_id: 111111,
        message: '测试',
        raw_message: '测试',
        message_id: 5001,
        time: Math.floor(Date.now() / 1000),
        self_id: BOT_QQ_NUMBER,
        sender: { user_id: 111111, nickname: 'test', sex: 'unknown' },
        font: 14,
        sub_type: 'friend',
        post_type: 'message'
      };

      await queueService.enqueue(message);
      await testDispatcher.schedule('user_111111', 'MEDIUM');

      const scheduleQueue = testDispatcher.getScheduleQueue();
      expect(scheduleQueue).toHaveLength(1);

      const nextCheckTime = scheduleQueue[0].nextCheckTime;
      const now = new Date();
      const timeDiff = nextCheckTime.getTime() - now.getTime();

      // Should be clamped to at least minInterval (100ms)
      expect(timeDiff).toBeGreaterThanOrEqual(90); // Allow small timing variance
      expect(timeDiff).toBeLessThanOrEqual(1100); // Should not exceed maxInterval

      testDispatcher.stop();
    });

    it('should clamp nextCheckTime to maxInterval', async () => {
      const testDispatcher = new ScheduleDispatcher(queueService, mockHandler, {
        scanInterval: 10000, // Very long scan interval
        minInterval: 50,
        maxInterval: 200,    // Max is 200ms
        tickInterval: 50
      });

      const message: QQMessage = {
        message_type: 'private',
        user_id: 222222,
        message: '测试',
        raw_message: '测试',
        message_id: 5002,
        time: Math.floor(Date.now() / 1000),
        self_id: BOT_QQ_NUMBER,
        sender: { user_id: 222222, nickname: 'test', sex: 'unknown' },
        font: 14,
        sub_type: 'friend',
        post_type: 'message'
      };

      await queueService.enqueue(message);
      await testDispatcher.schedule('user_222222', 'MEDIUM');

      const scheduleQueue = testDispatcher.getScheduleQueue();
      const nextCheckTime = scheduleQueue[0].nextCheckTime;
      const now = new Date();
      const timeDiff = nextCheckTime.getTime() - now.getTime();

      // Should be clamped to at most maxInterval (200ms)
      expect(timeDiff).toBeLessThanOrEqual(250); // Allow small timing variance

      testDispatcher.stop();
    });
  });

  describe('Tick Loop', () => {
    it('should process messages when nextCheckTime is reached', async () => {
      dispatcher.start();

      const message: QQMessage = {
        message_type: 'private',
        user_id: 333333,
        message: '定时处理',
        raw_message: '定时处理',
        message_id: 6001,
        time: Math.floor(Date.now() / 1000),
        self_id: BOT_QQ_NUMBER,
        sender: { user_id: 333333, nickname: 'test', sex: 'unknown' },
        font: 14,
        sub_type: 'friend',
        post_type: 'message'
      };

      await queueService.enqueue(message);
      await dispatcher.schedule('user_333333', 'MEDIUM');

      // Initially should not be processed
      expect(mockHandler.privateMessages).toHaveLength(0);

      // Wait for tick to process (needs to be > minInterval + tickInterval)
      await wait(150);

      // Should be processed by tick loop
      expect(mockHandler.privateMessages).toHaveLength(1);
      expect(mockHandler.privateMessages[0].sourceKey).toBe('user_333333');
    });

    it('should not process messages before nextCheckTime', async () => {
      const testDispatcher = new ScheduleDispatcher(queueService, mockHandler, {
        scanInterval: 1000, // Long delay
        minInterval: 1000,
        maxInterval: 2000,
        tickInterval: 100
      });

      testDispatcher.start();

      const message: QQMessage = {
        message_type: 'private',
        user_id: 444444,
        message: '延迟处理',
        raw_message: '延迟处理',
        message_id: 7001,
        time: Math.floor(Date.now() / 1000),
        self_id: BOT_QQ_NUMBER,
        sender: { user_id: 444444, nickname: 'test', sex: 'unknown' },
        font: 14,
        sub_type: 'friend',
        post_type: 'message'
      };

      await queueService.enqueue(message);
      await testDispatcher.schedule('user_444444', 'MEDIUM');

      // Wait a short time (less than minInterval)
      await wait(200);

      // Should NOT be processed yet
      expect(mockHandler.privateMessages).toHaveLength(0);

      testDispatcher.stop();
    });
  });

  describe('Rescheduling', () => {
    it('should reschedule if more messages arrive during processing', async () => {
      dispatcher.start();

      // Enqueue first message
      const message1: QQMessage = {
        message_type: 'private',
        user_id: 555555,
        message: '消息1',
        raw_message: '消息1',
        message_id: 8001,
        time: Math.floor(Date.now() / 1000),
        self_id: BOT_QQ_NUMBER,
        sender: { user_id: 555555, nickname: 'test', sex: 'unknown' },
        font: 14,
        sub_type: 'friend',
        post_type: 'message'
      };

      await queueService.enqueue(message1);
      await dispatcher.schedule('user_555555', 'MEDIUM');

      // Wait for first message to be processed
      await wait(150);

      expect(mockHandler.privateMessages).toHaveLength(1);

      // Enqueue second message while first is being processed
      const message2: QQMessage = {
        ...message1,
        message: '消息2',
        raw_message: '消息2',
        message_id: 8002
      };

      await queueService.enqueue(message2);
      await dispatcher.schedule('user_555555', 'MEDIUM');

      // Wait for rescheduled processing
      await wait(200);

      // Should have processed both messages
      expect(mockHandler.privateMessages.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Statistics', () => {
    it('should track statistics correctly', async () => {
      const stats1 = dispatcher.getStats();
      expect(stats1.totalScheduled).toBe(0);
      expect(stats1.immediateProcessed).toBe(0);
      expect(stats1.scheduledProcessed).toBe(0);

      // Schedule HIGH priority (immediate)
      const message1: QQMessage = {
        message_type: 'private',
        user_id: AUTHORIZED_USER_ID,
        message: '测试',
        raw_message: '测试',
        message_id: 9001,
        time: Math.floor(Date.now() / 1000),
        self_id: BOT_QQ_NUMBER,
        sender: { user_id: AUTHORIZED_USER_ID, nickname: 'test', sex: 'unknown' },
        font: 14,
        sub_type: 'friend',
        post_type: 'message'
      };

      await queueService.enqueue(message1);
      await dispatcher.schedule('user_' + AUTHORIZED_USER_ID, 'HIGH');

      const stats2 = dispatcher.getStats();
      expect(stats2.totalScheduled).toBe(1);
      expect(stats2.immediateProcessed).toBe(1);

      // Schedule MEDIUM priority (scheduled)
      dispatcher.start();

      const message2: QQMessage = {
        message_type: 'private',
        user_id: 666666,
        message: '测试',
        raw_message: '测试',
        message_id: 9002,
        time: Math.floor(Date.now() / 1000),
        self_id: BOT_QQ_NUMBER,
        sender: { user_id: 666666, nickname: 'test', sex: 'unknown' },
        font: 14,
        sub_type: 'friend',
        post_type: 'message'
      };

      await queueService.enqueue(message2);
      await dispatcher.schedule('user_666666', 'MEDIUM');

      await wait(200);

      const stats3 = dispatcher.getStats();
      expect(stats3.totalScheduled).toBe(2);
      expect(stats3.scheduledProcessed).toBeGreaterThan(0);
    });
  });

  describe('Start/Stop', () => {
    it('should start and stop correctly', () => {
      expect(dispatcher.getStats().isRunning).toBe(false);

      dispatcher.start();
      expect(dispatcher.getStats().isRunning).toBe(true);

      dispatcher.stop();
      expect(dispatcher.getStats().isRunning).toBe(false);
    });

    it('should not start twice', () => {
      dispatcher.start();
      dispatcher.start(); // Should not throw or cause issues

      expect(dispatcher.getStats().isRunning).toBe(true);

      dispatcher.stop();
    });
  });
});
