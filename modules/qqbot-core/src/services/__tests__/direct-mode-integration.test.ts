/**
 * Direct Mode Integration Test
 * 测试直连模式下的完整消息处理流程
 */

import { MessageQueueService } from '../message-queue-service';
import DirectNotifier, { BatchHandler, TriggerType } from '../direct-notifier';
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

describe('Direct Mode Integration', () => {
  let queueService: MessageQueueService;
  let directNotifier: DirectNotifier;
  let mockHandler: MockBatchHandler;
  const AUTHORIZED_USER_ID = 85178516;
  const BOT_QQ_NUMBER = 1129974489;

  beforeEach(() => {
    queueService = new MessageQueueService(AUTHORIZED_USER_ID, BOT_QQ_NUMBER);
    mockHandler = new MockBatchHandler();
    directNotifier = new DirectNotifier(mockHandler);
  });

  describe('Private Message Flow', () => {
    it('should process private message end-to-end in direct mode', async () => {
      const message: QQMessage = {
        message_type: 'private',
        user_id: 123456,
        message: '测试消息',
        raw_message: '测试消息',
        message_id: 1001,
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

      // Step 1: Enqueue message
      await queueService.enqueue(message, { traceId: 'test-trace-private' });

      // Verify message is queued
      const sourceKey = 'user_123456';
      expect(queueService.getUnreadCount(sourceKey)).toBe(1);

      // Step 2: Drain messages
      const messages = await queueService.drain(sourceKey);
      expect(messages).toHaveLength(1);
      expect(messages[0].traceId).toBe('test-trace-private');

      // Step 3: Trigger DirectNotifier
      await directNotifier.notify(sourceKey, messages);

      // Verify handler was called
      expect(mockHandler.privateMessages).toHaveLength(1);
      expect(mockHandler.privateMessages[0].sourceKey).toBe(sourceKey);
      expect(mockHandler.privateMessages[0].messages).toHaveLength(1);
      expect(mockHandler.privateMessages[0].triggerType).toBe('direct');
      expect(mockHandler.privateMessages[0].messages[0].message).toEqual(message);
    });

    it('should handle multiple private messages from same user', async () => {
      const userId = 123456;
      const sourceKey = `user_${userId}`;

      // Enqueue 3 messages
      for (let i = 0; i < 3; i++) {
        const message: QQMessage = {
          message_type: 'private',
          user_id: userId,
          message: `消息 ${i + 1}`,
          raw_message: `消息 ${i + 1}`,
          message_id: 2000 + i,
          time: Math.floor(Date.now() / 1000),
          self_id: BOT_QQ_NUMBER,
          sender: {
            user_id: userId,
            nickname: '测试用户',
            sex: 'unknown'
          },
          font: 14,
          sub_type: 'friend',
          post_type: 'message'
        };

        await queueService.enqueue(message, { traceId: `trace-${i}` });
      }

      // Drain and notify
      const messages = await queueService.drain(sourceKey);
      await directNotifier.notify(sourceKey, messages);

      // Verify all 3 messages were processed in batch
      expect(mockHandler.privateMessages).toHaveLength(1);
      expect(mockHandler.privateMessages[0].messages).toHaveLength(3);
      expect(mockHandler.privateMessages[0].messages.map(m => (m.message as QQMessage).message))
        .toEqual(['消息 1', '消息 2', '消息 3']);
    });
  });

  describe('Group Message Flow', () => {
    it('should process group message end-to-end in direct mode', async () => {
      const message: QQMessage = {
        message_type: 'group',
        user_id: 123456,
        group_id: 789012,
        message: '群聊测试',
        raw_message: '群聊测试',
        message_id: 3001,
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

      // Step 1: Enqueue message
      await queueService.enqueue(message, { traceId: 'test-trace-group' });

      // Verify message is queued
      const sourceKey = 'group_789012';
      expect(queueService.getUnreadCount(sourceKey)).toBe(1);

      // Step 2: Drain messages
      const messages = await queueService.drain(sourceKey);
      expect(messages).toHaveLength(1);

      // Step 3: Trigger DirectNotifier
      await directNotifier.notify(sourceKey, messages);

      // Verify handler was called
      expect(mockHandler.groupMessages).toHaveLength(1);
      expect(mockHandler.groupMessages[0].sourceKey).toBe(sourceKey);
      expect(mockHandler.groupMessages[0].messages).toHaveLength(1);
      expect(mockHandler.groupMessages[0].triggerType).toBe('direct');
    });

    it('should handle @bot messages with HIGH priority', async () => {
      const message: QQMessage = {
        message_type: 'group',
        user_id: 123456,
        group_id: 789012,
        message: [
          { type: 'at', data: { qq: BOT_QQ_NUMBER.toString() } },
          { type: 'text', data: { text: ' 测试@机器人' } }
        ],
        raw_message: '@机器人 测试',
        message_id: 3002,
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

      await queueService.enqueue(message, { traceId: 'test-at-bot' });

      const sourceKey = 'group_789012';
      const messages = await queueService.drain(sourceKey);

      // Verify message has HIGH priority
      expect(messages[0].priority).toBe('HIGH');

      await directNotifier.notify(sourceKey, messages);

      expect(mockHandler.groupMessages).toHaveLength(1);
      expect(mockHandler.groupMessages[0].messages[0].priority).toBe('HIGH');
    });
  });

  describe('Mixed Message Types', () => {
    it('should handle messages from multiple sources independently', async () => {
      // Private message from user 111
      const privateMsg1: QQMessage = {
        message_type: 'private',
        user_id: 111,
        message: 'private 1',
        raw_message: 'private 1',
        message_id: 4001,
        time: Math.floor(Date.now() / 1000),
        self_id: BOT_QQ_NUMBER,
        sender: { user_id: 111, nickname: 'user1', sex: 'unknown' },
        font: 14,
        sub_type: 'friend',
        post_type: 'message'
      };

      // Group message from group 999
      const groupMsg: QQMessage = {
        message_type: 'group',
        user_id: 222,
        group_id: 999,
        message: 'group msg',
        raw_message: 'group msg',
        message_id: 4002,
        time: Math.floor(Date.now() / 1000),
        self_id: BOT_QQ_NUMBER,
        sender: { user_id: 222, nickname: 'user2', sex: 'unknown', card: 'card', role: 'member' },
        font: 14,
        sub_type: 'normal',
        post_type: 'message'
      };

      // Enqueue both
      await queueService.enqueue(privateMsg1, { traceId: 'trace-private-1' });
      await queueService.enqueue(groupMsg, { traceId: 'trace-group-1' });

      // Process private message
      const privateKey = 'user_111';
      const privateMessages = await queueService.drain(privateKey);
      await directNotifier.notify(privateKey, privateMessages);

      // Process group message
      const groupKey = 'group_999';
      const groupMessages = await queueService.drain(groupKey);
      await directNotifier.notify(groupKey, groupMessages);

      // Verify both were processed independently
      expect(mockHandler.privateMessages).toHaveLength(1);
      expect(mockHandler.groupMessages).toHaveLength(1);
      expect(mockHandler.privateMessages[0].sourceKey).toBe(privateKey);
      expect(mockHandler.groupMessages[0].sourceKey).toBe(groupKey);
    });
  });

  describe('DirectNotifier Stats', () => {
    it('should track notification statistics', async () => {
      const message: QQMessage = {
        message_type: 'private',
        user_id: 123456,
        message: '测试',
        raw_message: '测试',
        message_id: 5001,
        time: Math.floor(Date.now() / 1000),
        self_id: BOT_QQ_NUMBER,
        sender: { user_id: 123456, nickname: 'test', sex: 'unknown' },
        font: 14,
        sub_type: 'friend',
        post_type: 'message'
      };

      await queueService.enqueue(message);
      const messages = await queueService.drain('user_123456');
      await directNotifier.notify('user_123456', messages);

      const stats = directNotifier.getStats();
      expect(stats.totalNotifications).toBe(1);
      expect(stats.privateNotifications).toBe(1);
      expect(stats.groupNotifications).toBe(0);
      expect(stats.failedNotifications).toBe(0);
    });
  });
});
