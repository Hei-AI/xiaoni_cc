import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import WebSocket from 'ws';
import mysql from 'mysql2/promise';
import axios from 'axios';
import { config } from '../src/config';
import { QQMessage, ConversationData } from '../src/types';

interface TestConfig {
  httpBaseUrl: string;
  websocketUrl: string;
  testUserId: number;
  testGroupId: number;
  database: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
  };
}

const testConfig: TestConfig = {
  httpBaseUrl: 'http://localhost:8080',
  websocketUrl: 'ws://localhost:3001?access_token=w@123456',
  testUserId: 85178516, // 授权用户ID用于测试
  testGroupId: 123456789, // 测试群ID
  database: config.database
};

describe('QQ Bot End-to-End Tests - 对话和Session追踪', () => {
  let dbConnection: mysql.Connection;
  let mockWebSocket: WebSocket;
  let conversationIds: string[] = [];

  beforeAll(async () => {
    // 建立数据库连接用于验证数据持久化
    dbConnection = await mysql.createConnection(testConfig.database);
    
    // 创建模拟WebSocket连接用于接收机器人消息
    mockWebSocket = new WebSocket(testConfig.websocketUrl);
    
    await new Promise((resolve, reject) => {
      mockWebSocket.on('open', resolve);
      mockWebSocket.on('error', reject);
      setTimeout(() => reject(new Error('WebSocket connection timeout')), 5000);
    });
    
    console.log('✅ Test environment setup completed');
  });

  afterAll(async () => {
    // 清理测试数据
    for (const conversationId of conversationIds) {
      await dbConnection.execute(
        'DELETE FROM conversations WHERE id = ?',
        [conversationId]
      );
    }
    
    // 关闭连接
    mockWebSocket?.close();
    await dbConnection?.end();
  });

  beforeEach(async () => {
    // 清理前一个测试的消息监听器
    mockWebSocket.removeAllListeners('message');
  });

  describe('私聊对话功能', () => {
    it('应当正确处理普通AI对话并记录session', async () => {
      const testMessage = 'hello，请回复测试消息';
      const expectedResponseKeywords = ['你好', '测试', '帮助'];
      
      // Step 1: 通过HTTP API发送消息
      const sendResponse = await axios.post(`${testConfig.httpBaseUrl}/api/send_private`, {
        user_id: testConfig.testUserId,
        message: testMessage
      });
      
      expect(sendResponse.status).toBe(200);
      expect(sendResponse.data.success).toBe(true);
      
      // Step 2: 模拟接收到用户消息，监听机器人回复
      const botResponse = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Bot response timeout after 10 seconds'));
        }, 10000);
        
        mockWebSocket.on('message', (data) => {
          try {
            const message = JSON.parse(data.toString());
            if (message.action === 'send_private_msg' && 
                message.params?.user_id === testConfig.testUserId) {
              clearTimeout(timeout);
              resolve(message.params.message);
            }
          } catch (error) {
            // 忽略解析错误，继续等待下一条消息
          }
        });
        
        // 模拟发送用户消息给机器人
        mockWebSocket.send(JSON.stringify({
          post_type: 'message',
          message_type: 'private',
          sub_type: 'friend',
          user_id: testConfig.testUserId,
          message: [{ type: 'text', data: { text: testMessage } }],
          raw_message: testMessage,
          time: Math.floor(Date.now() / 1000),
          message_id: Date.now()
        }));
      });
      
      // Step 3: 验证机器人回复内容
      expect(botResponse).toBeTruthy();
      expect(typeof botResponse).toBe('string');
      console.log(`🤖 Bot Response: ${botResponse.substring(0, 100)}...`);
      
      // Step 4: 验证数据库中的对话记录
      await new Promise(resolve => setTimeout(resolve, 1000)); // 等待数据库写入
      
      const [conversations] = await dbConnection.execute<mysql.RowDataPacket[]>(
        `SELECT * FROM conversations 
         WHERE user_id = ? AND user_message = ? 
         ORDER BY created_at DESC LIMIT 1`,
        [testConfig.testUserId, testMessage]
      );
      
      expect(conversations.length).toBe(1);
      const conversation = conversations[0] as ConversationData;
      
      // 验证对话记录字段
      expect(conversation.user_id).toBe(testConfig.testUserId);
      expect(conversation.user_message).toBe(testMessage);
      expect(conversation.ai_response).toBeTruthy();
      expect(conversation.response_time).toBeGreaterThan(0);
      expect(conversation.created_at).toBeInstanceOf(Date);
      
      conversationIds.push(conversation.id);
      
      console.log(`✅ Conversation saved with ID: ${conversation.id}`);
    });

    it('应当正确识别并处理需求管理消息', async () => {
      const requirementMessage = '帮我实现一个新的用户认证系统，支持JWT Token和密码加密';
      
      // 模拟发送需求消息
      const botResponse = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Requirement processing timeout'));
        }, 15000);
        
        mockWebSocket.on('message', (data) => {
          try {
            const message = JSON.parse(data.toString());
            if (message.action === 'send_private_msg' && 
                message.params?.user_id === testConfig.testUserId &&
                message.params?.message.includes('已识别为开发需求')) {
              clearTimeout(timeout);
              resolve(message.params.message);
            }
          } catch (error) {
            // 继续等待
          }
        });
        
        // 发送需求消息
        mockWebSocket.send(JSON.stringify({
          post_type: 'message',
          message_type: 'private',
          sub_type: 'friend',
          user_id: testConfig.testUserId,
          message: [{ type: 'text', data: { text: requirementMessage } }],
          raw_message: requirementMessage,
          time: Math.floor(Date.now() / 1000),
          message_id: Date.now()
        }));
      });
      
      // 验证需求识别响应
      expect(botResponse).toContain('已识别为开发需求');
      expect(botResponse).toContain('需求ID');
      expect(botResponse).toContain('正在处理中');
      
      // 从响应中提取需求ID
      const requirementIdMatch = botResponse.match(/需求ID: ([a-f0-9-]{36})/);
      expect(requirementIdMatch).toBeTruthy();
      const requirementId = requirementIdMatch![1];
      
      // 验证需求记录已保存到数据库
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const [requirements] = await dbConnection.execute<mysql.RowDataPacket[]>(
        'SELECT * FROM requirements WHERE id = ?',
        [requirementId]
      );
      
      expect(requirements.length).toBe(1);
      const requirement = requirements[0];
      expect(requirement.user_id).toBe(testConfig.testUserId);
      expect(requirement.message).toBe(requirementMessage);
      expect(['received', 'processing', 'completed', 'failed']).toContain(requirement.status);
      
      console.log(`✅ Requirement created with ID: ${requirementId}, Status: ${requirement.status}`);
    });
  });

  describe('群聊@机器人功能', () => {
    it('应当正确响应群聊中的@消息', async () => {
      const testGroupMessage = '测试群聊消息回复功能';
      const botQQNumber = config.ai.bot_qq_number;
      
      // 首先通过授权用户添加测试群到白名单
      mockWebSocket.send(JSON.stringify({
        post_type: 'message',
        message_type: 'private',
        sub_type: 'friend',
        user_id: testConfig.testUserId,
        message: [{ type: 'text', data: { text: `添加群聊 ${testConfig.testGroupId}` } }],
        raw_message: `添加群聊 ${testConfig.testGroupId}`,
        time: Math.floor(Date.now() / 1000),
        message_id: Date.now()
      }));
      
      await new Promise(resolve => setTimeout(resolve, 1000)); // 等待白名单更新
      
      // 发送@机器人的群消息
      const botResponse = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Group message response timeout'));
        }, 10000);
        
        mockWebSocket.on('message', (data) => {
          try {
            const message = JSON.parse(data.toString());
            if (message.action === 'send_group_msg' && 
                message.params?.group_id === testConfig.testGroupId) {
              clearTimeout(timeout);
              resolve(message.params.message);
            }
          } catch (error) {
            // 继续等待
          }
        });
        
        // 发送@机器人的群消息
        mockWebSocket.send(JSON.stringify({
          post_type: 'message',
          message_type: 'group',
          sub_type: 'normal',
          group_id: testConfig.testGroupId,
          user_id: 999999, // 不同的用户ID
          message: [
            { type: 'at', data: { qq: botQQNumber.toString() } },
            { type: 'text', data: { text: ` ${testGroupMessage}` } }
          ],
          raw_message: `[CQ:at,qq=${botQQNumber}] ${testGroupMessage}`,
          time: Math.floor(Date.now() / 1000),
          message_id: Date.now()
        }));
      });
      
      expect(botResponse).toBeTruthy();
      console.log(`🤖 Group Response: ${botResponse.substring(0, 100)}...`);
    });
  });

  describe('Session持续跟踪', () => {
    it('应当在多轮对话中保持session连续性', async () => {
      const conversation1 = '我想了解QQ机器人的功能';
      const conversation2 = '刚才提到的功能中，哪个最实用？';
      const conversation3 = '谢谢你的详细回答';
      
      const conversations = [conversation1, conversation2, conversation3];
      const responses: string[] = [];
      
      // 依次发送多轮对话
      for (let i = 0; i < conversations.length; i++) {
        const message = conversations[i];
        
        const botResponse = await new Promise<string>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error(`Conversation ${i + 1} timeout`));
          }, 10000);
          
          mockWebSocket.on('message', (data) => {
            try {
              const parsedMessage = JSON.parse(data.toString());
              if (parsedMessage.action === 'send_private_msg' && 
                  parsedMessage.params?.user_id === testConfig.testUserId) {
                clearTimeout(timeout);
                mockWebSocket.removeAllListeners('message');
                resolve(parsedMessage.params.message);
              }
            } catch (error) {
              // 继续等待
            }
          });
          
          // 发送用户消息
          mockWebSocket.send(JSON.stringify({
            post_type: 'message',
            message_type: 'private',
            sub_type: 'friend',
            user_id: testConfig.testUserId,
            message: [{ type: 'text', data: { text: message } }],
            raw_message: message,
            time: Math.floor(Date.now() / 1000),
            message_id: Date.now() + i
          }));
        });
        
        responses.push(botResponse);
        console.log(`📞 Round ${i + 1} - User: ${message}`);
        console.log(`🤖 Round ${i + 1} - Bot: ${botResponse.substring(0, 80)}...`);
        
        // 短暂延迟模拟真实对话节奏
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
      
      // 验证所有轮次都有响应
      expect(responses).toHaveLength(3);
      responses.forEach((response, index) => {
        expect(response).toBeTruthy();
        expect(typeof response).toBe('string');
      });
      
      // 验证数据库中保存了完整的对话链
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const [dbConversations] = await dbConnection.execute<mysql.RowDataPacket[]>(
        `SELECT * FROM conversations 
         WHERE user_id = ? AND user_message IN (?, ?, ?) 
         ORDER BY created_at ASC`,
        [testConfig.testUserId, ...conversations]
      );
      
      expect(dbConversations.length).toBe(3);
      
      // 验证对话时间顺序
      for (let i = 1; i < dbConversations.length; i++) {
        expect(new Date(dbConversations[i].created_at).getTime())
          .toBeGreaterThan(new Date(dbConversations[i-1].created_at).getTime());
      }
      
      // 收集conversation IDs用于清理
      dbConversations.forEach(conv => conversationIds.push(conv.id));
      
      console.log(`✅ Multi-turn conversation completed with ${dbConversations.length} rounds tracked`);
    });
  });

  describe('错误处理和恢复', () => {
    it('应当优雅处理无效消息格式', async () => {
      // 发送格式错误的消息
      mockWebSocket.send('invalid json message');
      
      // 发送有效消息确保服务仍然正常
      const validResponse = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Service recovery test timeout'));
        }, 5000);
        
        mockWebSocket.on('message', (data) => {
          try {
            const message = JSON.parse(data.toString());
            if (message.action === 'send_private_msg') {
              clearTimeout(timeout);
              resolve(message.params.message);
            }
          } catch (error) {
            // 继续等待
          }
        });
        
        setTimeout(() => {
          mockWebSocket.send(JSON.stringify({
            post_type: 'message',
            message_type: 'private',
            user_id: testConfig.testUserId,
            message: [{ type: 'text', data: { text: '服务恢复测试' } }],
            raw_message: '服务恢复测试',
            time: Math.floor(Date.now() / 1000),
            message_id: Date.now()
          }));
        }, 1000);
      });
      
      expect(validResponse).toBeTruthy();
      console.log('✅ Service recovered successfully after invalid message');
    });
  });

  describe('HTTP API集成测试', () => {
    it('应当通过REST API正确查询对话历史', async () => {
      const response = await axios.get(`${testConfig.httpBaseUrl}/api/conversations`, {
        params: {
          user_id: testConfig.testUserId,
          limit: 10
        }
      });
      
      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(Array.isArray(response.data.data)).toBe(true);
      
      const conversations = response.data.data;
      if (conversations.length > 0) {
        const latestConversation = conversations[0];
        expect(latestConversation).toHaveProperty('id');
        expect(latestConversation).toHaveProperty('user_id');
        expect(latestConversation).toHaveProperty('user_message');
        expect(latestConversation).toHaveProperty('ai_response');
        expect(latestConversation).toHaveProperty('created_at');
      }
      
      console.log(`✅ Retrieved ${conversations.length} conversation records via HTTP API`);
    });

    it('应当正确返回系统状态信息', async () => {
      const response = await axios.get(`${testConfig.httpBaseUrl}/api/status`);
      
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('timestamp');
      expect(response.data).toHaveProperty('websocket');
      expect(response.data).toHaveProperty('database');
      expect(response.data).toHaveProperty('process');
      
      expect(response.data.websocket.connected).toBe(true);
      expect(response.data.database.connected).toBe(true);
      
      console.log('✅ System status API working correctly');
    });
  });
});