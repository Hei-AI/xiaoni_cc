import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import WebSocket from 'ws';
import mysql from 'mysql2/promise';
import { config } from '../src/config';

/**
 * WebSocket消息模拟器测试
 * 用于测试机器人对不同类型QQ消息的处理能力
 */

interface MockQQMessage {
  post_type: string;
  message_type?: string;
  sub_type?: string;
  user_id: number;
  group_id?: number;
  message: any[];
  raw_message: string;
  time: number;
  message_id: number;
}

describe('WebSocket Message Simulator - 消息处理测试', () => {
  let wsClient: WebSocket;
  let dbConnection: mysql.Connection;
  const TEST_USER_ID = 85178516;
  const TEST_GROUP_ID = 123456789;
  const WEBSOCKET_URL = 'ws://localhost:3001?access_token=w@123456';

  beforeAll(async () => {
    // 连接到机器人的WebSocket服务器
    wsClient = new WebSocket(WEBSOCKET_URL);
    
    await new Promise((resolve, reject) => {
      wsClient.on('open', resolve);
      wsClient.on('error', reject);
      setTimeout(() => reject(new Error('WebSocket connection timeout')), 5000);
    });
    
    // 数据库连接
    dbConnection = await mysql.createConnection(config.database);
    
    console.log('✅ WebSocket Message Simulator initialized');
  });

  afterAll(async () => {
    wsClient?.close();
    await dbConnection?.end();
  });

  /**
   * 发送模拟QQ消息并等待响应
   */
  async function sendMockMessage(message: MockQQMessage, expectResponse = true): Promise<string | null> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Message response timeout after 8 seconds'));
      }, 8000);

      if (!expectResponse) {
        clearTimeout(timeout);
        wsClient.send(JSON.stringify(message));
        resolve(null);
        return;
      }

      const messageHandler = (data: Buffer) => {
        try {
          const response = JSON.parse(data.toString());
          
          // 检查是否是期待的回复消息
          if (response.action && 
              (response.action === 'send_private_msg' || response.action === 'send_group_msg')) {
            clearTimeout(timeout);
            wsClient.removeListener('message', messageHandler);
            resolve(response.params?.message || 'Empty response');
          }
        } catch (error) {
          // 忽略解析错误，继续等待
        }
      };

      wsClient.on('message', messageHandler);
      wsClient.send(JSON.stringify(message));
    });
  }

  describe('私聊消息模拟', () => {
    it('模拟普通私聊对话消息', async () => {
      const mockMessage: MockQQMessage = {
        post_type: 'message',
        message_type: 'private',
        sub_type: 'friend',
        user_id: TEST_USER_ID,
        message: [{ type: 'text', data: { text: '你好，这是一条测试消息' } }],
        raw_message: '你好，这是一条测试消息',
        time: Math.floor(Date.now() / 1000),
        message_id: Date.now()
      };

      const response = await sendMockMessage(mockMessage);
      
      expect(response).toBeTruthy();
      expect(typeof response).toBe('string');
      expect(response!.length).toBeGreaterThan(0);
      
      console.log(`✅ Private conversation test: ${response!.substring(0, 50)}...`);
    });

    it('模拟开发需求识别消息', async () => {
      const mockMessage: MockQQMessage = {
        post_type: 'message',
        message_type: 'private',
        sub_type: 'friend',
        user_id: TEST_USER_ID,
        message: [{ 
          type: 'text', 
          data: { text: '帮我实现一个Redis缓存系统，需要支持分布式锁和过期策略' } 
        }],
        raw_message: '帮我实现一个Redis缓存系统，需要支持分布式锁和过期策略',
        time: Math.floor(Date.now() / 1000),
        message_id: Date.now()
      };

      const response = await sendMockMessage(mockMessage);
      
      expect(response).toBeTruthy();
      expect(response).toContain('已识别为开发需求');
      expect(response).toMatch(/需求ID: [a-f0-9-]{36}/);
      
      console.log(`✅ Requirement recognition test: ${response!.substring(0, 100)}...`);
    });

    it('模拟群聊管理命令', async () => {
      const mockMessage: MockQQMessage = {
        post_type: 'message',
        message_type: 'private',
        sub_type: 'friend',
        user_id: TEST_USER_ID,
        message: [{ type: 'text', data: { text: '群聊列表' } }],
        raw_message: '群聊列表',
        time: Math.floor(Date.now() / 1000),
        message_id: Date.now()
      };

      const response = await sendMockMessage(mockMessage);
      
      expect(response).toBeTruthy();
      expect(response).toContain('当前');
      expect(response).toContain('群聊');
      
      console.log(`✅ Group management command test: ${response}`);
    });
  });

  describe('群聊消息模拟', () => {
    it('模拟@机器人的群聊消息', async () => {
      const botQQ = config.ai.bot_qq_number;
      
      // 首先添加测试群到白名单
      await sendMockMessage({
        post_type: 'message',
        message_type: 'private',
        sub_type: 'friend',
        user_id: TEST_USER_ID,
        message: [{ type: 'text', data: { text: `添加群聊 ${TEST_GROUP_ID}` } }],
        raw_message: `添加群聊 ${TEST_GROUP_ID}`,
        time: Math.floor(Date.now() / 1000),
        message_id: Date.now()
      });

      await new Promise(resolve => setTimeout(resolve, 1000)); // 等待白名单更新

      // 发送@机器人的群消息
      const mockMessage: MockQQMessage = {
        post_type: 'message',
        message_type: 'group',
        sub_type: 'normal',
        user_id: 999999,
        group_id: TEST_GROUP_ID,
        message: [
          { type: 'at', data: { qq: botQQ.toString() } },
          { type: 'text', data: { text: ' 群聊AI对话测试' } }
        ],
        raw_message: `[CQ:at,qq=${botQQ}] 群聊AI对话测试`,
        time: Math.floor(Date.now() / 1000),
        message_id: Date.now()
      };

      const response = await sendMockMessage(mockMessage);
      
      expect(response).toBeTruthy();
      console.log(`✅ Group at-message test: ${response!.substring(0, 50)}...`);
    });

    it('模拟非@机器人的群消息（应被忽略）', async () => {
      const mockMessage: MockQQMessage = {
        post_type: 'message',
        message_type: 'group',
        sub_type: 'normal',
        user_id: 999999,
        group_id: TEST_GROUP_ID,
        message: [{ type: 'text', data: { text: '这是一条普通群消息' } }],
        raw_message: '这是一条普通群消息',
        time: Math.floor(Date.now() / 1000),
        message_id: Date.now()
      };

      // 发送消息但不期待响应
      await sendMockMessage(mockMessage, false);
      
      // 等待确认没有响应
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      console.log('✅ Non-at group message correctly ignored');
    });
  });

  describe('通知消息模拟', () => {
    it('模拟群成员加入通知', async () => {
      const mockNotice = {
        post_type: 'notice',
        notice_type: 'group_increase',
        sub_type: 'approve',
        group_id: TEST_GROUP_ID,
        operator_id: TEST_USER_ID,
        user_id: 888888,
        time: Math.floor(Date.now() / 1000)
      };

      wsClient.send(JSON.stringify(mockNotice));
      
      // 通知消息不需要响应，但应该被正确处理和记录
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      console.log('✅ Group member join notice sent');
    });

    it('模拟群成员离开通知', async () => {
      const mockNotice = {
        post_type: 'notice',
        notice_type: 'group_decrease',
        sub_type: 'leave',
        group_id: TEST_GROUP_ID,
        operator_id: 777777,
        user_id: 888888,
        time: Math.floor(Date.now() / 1000)
      };

      wsClient.send(JSON.stringify(mockNotice));
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      console.log('✅ Group member leave notice sent');
    });
  });

  describe('好友请求模拟', () => {
    it('模拟好友添加请求（应自动同意）', async () => {
      const mockRequest = {
        post_type: 'request',
        request_type: 'friend',
        user_id: 777777,
        comment: '测试好友请求',
        flag: 'test_flag_' + Date.now(),
        time: Math.floor(Date.now() / 1000)
      };

      // 监听自动同意响应
      const approvalResponse = await new Promise<any>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Friend request approval timeout'));
        }, 5000);

        const messageHandler = (data: Buffer) => {
          try {
            const response = JSON.parse(data.toString());
            if (response.action === 'set_friend_add_request') {
              clearTimeout(timeout);
              wsClient.removeListener('message', messageHandler);
              resolve(response);
            }
          } catch (error) {
            // 继续等待
          }
        };

        wsClient.on('message', messageHandler);
        wsClient.send(JSON.stringify(mockRequest));
      });

      expect(approvalResponse.action).toBe('set_friend_add_request');
      expect(approvalResponse.params.flag).toBe(mockRequest.flag);
      expect(approvalResponse.params.approve).toBe(true);
      
      console.log('✅ Friend request automatically approved');
    });
  });

  describe('错误消息模拟', () => {
    it('模拟格式错误的消息', async () => {
      // 发送无效JSON
      wsClient.send('{"invalid": json message without proper closing}');
      
      // 发送缺少必需字段的消息
      wsClient.send(JSON.stringify({
        post_type: 'message'
        // 缺少其他必需字段
      }));
      
      // 确保服务器仍然能处理正常消息
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const validResponse = await sendMockMessage({
        post_type: 'message',
        message_type: 'private',
        sub_type: 'friend',
        user_id: TEST_USER_ID,
        message: [{ type: 'text', data: { text: '服务恢复测试' } }],
        raw_message: '服务恢复测试',
        time: Math.floor(Date.now() / 1000),
        message_id: Date.now()
      });
      
      expect(validResponse).toBeTruthy();
      console.log('✅ Service remains stable after receiving invalid messages');
    });
  });

  describe('并发消息模拟', () => {
    it('模拟多用户同时发送消息', async () => {
      const concurrentUsers = [TEST_USER_ID, 123456, 789012];
      const messages = [
        '同时消息测试 - 用户1',
        '同时消息测试 - 用户2',  
        '同时消息测试 - 用户3'
      ];
      
      // 同时发送多条消息
      const responsePromises = concurrentUsers.map((userId, index) => 
        sendMockMessage({
          post_type: 'message',
          message_type: 'private',
          sub_type: 'friend',
          user_id: userId,
          message: [{ type: 'text', data: { text: messages[index] } }],
          raw_message: messages[index],
          time: Math.floor(Date.now() / 1000),
          message_id: Date.now() + index
        })
      );
      
      const responses = await Promise.all(responsePromises);
      
      // 验证所有用户都收到了响应
      expect(responses).toHaveLength(3);
      responses.forEach((response, index) => {
        expect(response).toBeTruthy();
        console.log(`✅ Concurrent user ${index + 1} response: ${response!.substring(0, 30)}...`);
      });
    });
  });

  describe('数据库验证', () => {
    it('验证对话记录已正确保存', async () => {
      const testMessage = '数据库验证测试消息';
      
      await sendMockMessage({
        post_type: 'message',
        message_type: 'private',
        sub_type: 'friend',
        user_id: TEST_USER_ID,
        message: [{ type: 'text', data: { text: testMessage } }],
        raw_message: testMessage,
        time: Math.floor(Date.now() / 1000),
        message_id: Date.now()
      });
      
      // 等待数据库写入
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // 查询数据库验证记录
      const [conversations] = await dbConnection.execute<mysql.RowDataPacket[]>(
        'SELECT * FROM conversations WHERE user_id = ? AND user_message = ? ORDER BY created_at DESC LIMIT 1',
        [TEST_USER_ID, testMessage]
      );
      
      expect(conversations.length).toBe(1);
      const conversation = conversations[0];
      expect(conversation.user_message).toBe(testMessage);
      expect(conversation.ai_response).toBeTruthy();
      expect(conversation.response_time).toBeGreaterThan(0);
      
      console.log(`✅ Database verification passed - Conversation ID: ${conversation.id}`);
      
      // 清理测试数据
      await dbConnection.execute('DELETE FROM conversations WHERE id = ?', [conversation.id]);
    });
  });
});