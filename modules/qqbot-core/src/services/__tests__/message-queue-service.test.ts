/**
 * MessageQueueService 单元测试
 */

import { MessageQueueService } from '../message-queue-service';
import { QQMessage } from '../../types';

describe('MessageQueueService', () => {
  let queueService: MessageQueueService;
  const AUTHORIZED_USER_ID = 85178516;
  const BOT_QQ_NUMBER = 1129974489;

  beforeEach(() => {
    queueService = new MessageQueueService(AUTHORIZED_USER_ID, BOT_QQ_NUMBER);
  });

  describe('enqueue and drain', () => {
    it('should enqueue and drain private messages', async () => {
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

      // Enqueue
      await queueService.enqueue(message, { traceId: 'test-trace-1' });

      // Check unread count
      const unreadCount = queueService.getUnreadCount('user_123456');
      expect(unreadCount).toBe(1);

      // Drain
      const drained = await queueService.drain('user_123456');
      expect(drained).toHaveLength(1);
      expect(drained[0].message).toEqual(message);
      expect(drained[0].traceId).toBe('test-trace-1');

      // After drain, queue should be empty
      const afterDrainCount = queueService.getUnreadCount('user_123456');
      expect(afterDrainCount).toBe(0);
    });

    it('should enqueue and drain group messages', async () => {
      const message: QQMessage = {
        message_type: 'group',
        user_id: 123456,
        group_id: 789012,
        message: '群聊测试',
        raw_message: '群聊测试',
        message_id: 1002,
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

      const unreadCount = queueService.getUnreadCount('group_789012');
      expect(unreadCount).toBe(1);

      const drained = await queueService.drain('group_789012');
      expect(drained).toHaveLength(1);
      expect(drained[0].message).toEqual(message);
    });

    it('should batch drain multiple messages', async () => {
      const userId = 123456;

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

      // Should have 3 unread
      const unreadCount = queueService.getUnreadCount(`user_${userId}`);
      expect(unreadCount).toBe(3);

      // Drain all at once
      const drained = await queueService.drain(`user_${userId}`);
      expect(drained).toHaveLength(3);

      // Queue should be empty after drain
      const afterCount = queueService.getUnreadCount(`user_${userId}`);
      expect(afterCount).toBe(0);
    });
  });

  describe('priority detection', () => {
    it('should set HIGH priority for authorized user private messages', async () => {
      const message: QQMessage = {
        message_type: 'private',
        user_id: AUTHORIZED_USER_ID,
        message: '测试消息',
        raw_message: '测试消息',
        message_id: 3001,
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
      const drained = await queueService.drain(`user_${AUTHORIZED_USER_ID}`);
      expect(drained[0].priority).toBe('HIGH');
    });

    it('should set HIGH priority for @ bot messages', async () => {
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

      await queueService.enqueue(message);
      const drained = await queueService.drain('group_789012');
      expect(drained[0].priority).toBe('HIGH');
    });

    it('should set MEDIUM priority for normal private messages', async () => {
      const message: QQMessage = {
        message_type: 'private',
        user_id: 111111, // Not authorized user
        message: '普通消息',
        raw_message: '普通消息',
        message_id: 3003,
        time: Math.floor(Date.now() / 1000),
        self_id: BOT_QQ_NUMBER,
        sender: {
          user_id: 111111,
          nickname: '普通用户',
          sex: 'unknown'
        },
        font: 14,
        sub_type: 'friend',
        post_type: 'message'
      };

      await queueService.enqueue(message);
      const drained = await queueService.drain('user_111111');
      expect(drained[0].priority).toBe('MEDIUM');
    });

    it('should set LOW priority for normal group messages without @', async () => {
      const message: QQMessage = {
        message_type: 'group',
        user_id: 123456,
        group_id: 789012,
        message: '普通群聊',
        raw_message: '普通群聊',
        message_id: 3004,
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
      const drained = await queueService.drain('group_789012');
      expect(drained[0].priority).toBe('LOW');
    });
  });

  describe('getActiveSourceKeys', () => {
    it('should return all source keys with unread messages', async () => {
      // Enqueue messages for 2 users and 1 group
      const message1: QQMessage = {
        message_type: 'private',
        user_id: 111,
        message: 'msg1',
        raw_message: 'msg1',
        message_id: 4001,
        time: Math.floor(Date.now() / 1000),
        self_id: BOT_QQ_NUMBER,
        sender: { user_id: 111, nickname: 'user1', sex: 'unknown' },
        font: 14,
        sub_type: 'friend',
        post_type: 'message'
      };

      const message2: QQMessage = {
        message_type: 'private',
        user_id: 222,
        message: 'msg2',
        raw_message: 'msg2',
        message_id: 4002,
        time: Math.floor(Date.now() / 1000),
        self_id: BOT_QQ_NUMBER,
        sender: { user_id: 222, nickname: 'user2', sex: 'unknown' },
        font: 14,
        sub_type: 'friend',
        post_type: 'message'
      };

      const message3: QQMessage = {
        message_type: 'group',
        user_id: 333,
        group_id: 999,
        message: 'group msg',
        raw_message: 'group msg',
        message_id: 4003,
        time: Math.floor(Date.now() / 1000),
        self_id: BOT_QQ_NUMBER,
        sender: { user_id: 333, nickname: 'user3', sex: 'unknown', card: 'card', role: 'member' },
        font: 14,
        sub_type: 'normal',
        post_type: 'message'
      };

      await queueService.enqueue(message1);
      await queueService.enqueue(message2);
      await queueService.enqueue(message3);

      const activeKeys = queueService.getActiveSourceKeys();
      expect(activeKeys).toHaveLength(3);
      expect(activeKeys).toContain('user_111');
      expect(activeKeys).toContain('user_222');
      expect(activeKeys).toContain('group_999');
    });
  });

  describe('peek', () => {
    it('should preview messages without consuming', async () => {
      const message: QQMessage = {
        message_type: 'private',
        user_id: 123456,
        message: '测试peek',
        raw_message: '测试peek',
        message_id: 5001,
        time: Math.floor(Date.now() / 1000),
        self_id: BOT_QQ_NUMBER,
        sender: { user_id: 123456, nickname: 'test', sex: 'unknown' },
        font: 14,
        sub_type: 'friend',
        post_type: 'message'
      };

      await queueService.enqueue(message);

      // Peek should return messages
      const peeked = queueService.peek('user_123456');
      expect(peeked).toHaveLength(1);
      expect(peeked[0].message).toEqual(message);

      // But queue should still have the message
      const unreadCount = queueService.getUnreadCount('user_123456');
      expect(unreadCount).toBe(1);
    });
  });
});
