import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import WebSocket from 'ws';
import axios from 'axios';
import mysql from 'mysql2/promise';
import { config } from '../src/config';

/**
 * 性能和压力测试
 * 测试QQ机器人在高并发和大量消息场景下的表现
 */

describe('Performance & Stress Tests - 性能和压力测试', () => {
  let wsClient: WebSocket;
  let dbConnection: mysql.Connection;
  const TEST_USER_ID = 85178516;
  const HTTP_BASE_URL = 'http://localhost:8080';
  const WEBSOCKET_URL = 'ws://localhost:3001?access_token=w@123456';

  beforeAll(async () => {
    wsClient = new WebSocket(WEBSOCKET_URL);
    await new Promise((resolve, reject) => {
      wsClient.on('open', resolve);
      wsClient.on('error', reject);
      setTimeout(() => reject(new Error('WebSocket connection timeout')), 5000);
    });

    dbConnection = await mysql.createConnection(config.database);
    console.log('✅ Performance test environment initialized');
  }, 10000);

  afterAll(async () => {
    wsClient?.close();
    await dbConnection?.end();
  });

  describe('HTTP API响应时间测试', () => {
    it('健康检查API响应时间应小于100ms', async () => {
      const iterations = 10;
      const responseTimes: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const startTime = Date.now();
        const response = await axios.get(`${HTTP_BASE_URL}/health`);
        const responseTime = Date.now() - startTime;
        
        responseTimes.push(responseTime);
        expect(response.status).toBe(200);
      }

      const avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
      const maxResponseTime = Math.max(...responseTimes);

      console.log(`📊 Health API - Avg: ${avgResponseTime.toFixed(2)}ms, Max: ${maxResponseTime}ms`);
      expect(avgResponseTime).toBeLessThan(100);
      expect(maxResponseTime).toBeLessThan(200);
    });

    it('系统状态API在负载下的响应时间', async () => {
      const concurrentRequests = 20;
      const promises: Promise<any>[] = [];

      for (let i = 0; i < concurrentRequests; i++) {
        promises.push(
          (async () => {
            const startTime = Date.now();
            const response = await axios.get(`${HTTP_BASE_URL}/api/status`);
            const responseTime = Date.now() - startTime;
            return { response, responseTime };
          })()
        );
      }

      const results = await Promise.all(promises);
      const responseTimes = results.map(r => r.responseTime);
      const avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
      const maxResponseTime = Math.max(...responseTimes);

      console.log(`📊 Status API - Concurrent: ${concurrentRequests}, Avg: ${avgResponseTime.toFixed(2)}ms, Max: ${maxResponseTime}ms`);
      
      results.forEach(({ response }) => {
        expect(response.status).toBe(200);
        expect(response.data).toHaveProperty('websocket');
        expect(response.data).toHaveProperty('database');
      });

      expect(avgResponseTime).toBeLessThan(500);
    });
  });

  describe('WebSocket消息处理性能', () => {
    it('大量连续消息处理测试', async () => {
      const messageCount = 50;
      const messages = Array.from({ length: messageCount }, (_, i) => 
        `性能测试消息 #${i + 1} - ${Date.now()}`
      );
      
      const startTime = Date.now();
      const responsePromises: Promise<string>[] = [];

      // 快速发送大量消息
      for (let i = 0; i < messageCount; i++) {
        const promise = new Promise<string>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error(`Message ${i + 1} timeout`));
          }, 10000);

          const messageHandler = (data: Buffer) => {
            try {
              const response = JSON.parse(data.toString());
              if (response.action === 'send_private_msg' && 
                  response.params?.message.includes(`#${i + 1}`)) {
                clearTimeout(timeout);
                wsClient.removeListener('message', messageHandler);
                resolve(response.params.message);
              }
            } catch (error) {
              // 继续等待
            }
          };

          wsClient.on('message', messageHandler);
        });

        responsePromises.push(promise);

        // 发送消息
        wsClient.send(JSON.stringify({
          post_type: 'message',
          message_type: 'private',
          sub_type: 'friend',
          user_id: TEST_USER_ID,
          message: [{ type: 'text', data: { text: messages[i] } }],
          raw_message: messages[i],
          time: Math.floor(Date.now() / 1000),
          message_id: Date.now() + i
        }));

        // 短暂间隔避免过快发送
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      // 等待所有响应
      const responses = await Promise.all(responsePromises);
      const totalTime = Date.now() - startTime;
      const avgTimePerMessage = totalTime / messageCount;

      console.log(`📊 Processed ${messageCount} messages in ${totalTime}ms (avg: ${avgTimePerMessage.toFixed(2)}ms/msg)`);
      
      expect(responses).toHaveLength(messageCount);
      expect(avgTimePerMessage).toBeLessThan(2000); // 每条消息平均处理时间小于2秒
      
      // 清理测试数据
      const messagePatterns = messages.map(m => `%${m}%`);
      await dbConnection.execute(
        `DELETE FROM conversations WHERE user_message LIKE ? OR ${messagePatterns.map(() => 'user_message LIKE ?').join(' OR ')}`,
        messagePatterns
      );
    }, 60000); // 60秒超时
  });

  describe('数据库性能测试', () => {
    it('并发数据库查询测试', async () => {
      const concurrentQueries = 30;
      const promises: Promise<any>[] = [];

      for (let i = 0; i < concurrentQueries; i++) {
        promises.push(
          (async () => {
            const startTime = Date.now();
            const [conversations] = await dbConnection.execute(
              'SELECT * FROM conversations WHERE user_id = ? ORDER BY created_at DESC LIMIT 10',
              [TEST_USER_ID]
            );
            const queryTime = Date.now() - startTime;
            return { conversations, queryTime };
          })()
        );
      }

      const results = await Promise.all(promises);
      const queryTimes = results.map(r => r.queryTime);
      const avgQueryTime = queryTimes.reduce((a, b) => a + b, 0) / queryTimes.length;
      const maxQueryTime = Math.max(...queryTimes);

      console.log(`📊 Database - ${concurrentQueries} concurrent queries, Avg: ${avgQueryTime.toFixed(2)}ms, Max: ${maxQueryTime}ms`);
      
      expect(avgQueryTime).toBeLessThan(100);
      expect(maxQueryTime).toBeLessThan(500);
    });

    it('批量数据插入性能测试', async () => {
      const batchSize = 100;
      const testData = Array.from({ length: batchSize }, (_, i) => [
        `test-conversation-${Date.now()}-${i}`,
        TEST_USER_ID,
        `Performance test user message ${i + 1}`,
        `Performance test AI response ${i + 1}`,
        Math.floor(Math.random() * 5000) + 100, // 100-5100ms response time
        new Date(),
        new Date()
      ]);

      const startTime = Date.now();
      
      const insertQuery = `
        INSERT INTO conversations (id, user_id, user_message, ai_response, response_time, created_at, updated_at)
        VALUES ?
      `;
      
      await dbConnection.execute(insertQuery, [testData]);
      
      const insertTime = Date.now() - startTime;
      const avgTimePerInsert = insertTime / batchSize;

      console.log(`📊 Batch insert - ${batchSize} records in ${insertTime}ms (avg: ${avgTimePerInsert.toFixed(2)}ms/record)`);
      
      expect(avgTimePerInsert).toBeLessThan(10); // 每条记录插入时间小于10ms
      
      // 清理测试数据
      await dbConnection.execute(
        `DELETE FROM conversations WHERE id LIKE 'test-conversation-%'`
      );
    });
  });

  describe('内存使用情况测试', () => {
    it('检查内存使用增长情况', async () => {
      // 获取初始内存使用情况
      const initialMemory = await getMemoryUsage();
      
      // 执行大量操作
      const operationCount = 200;
      for (let i = 0; i < operationCount; i++) {
        // HTTP API调用
        await axios.get(`${HTTP_BASE_URL}/health`);
        
        // WebSocket消息
        if (i % 10 === 0) {
          wsClient.send(JSON.stringify({
            post_type: 'message',
            message_type: 'private',
            user_id: TEST_USER_ID,
            message: [{ type: 'text', data: { text: `Memory test ${i}` } }],
            raw_message: `Memory test ${i}`,
            time: Math.floor(Date.now() / 1000),
            message_id: Date.now() + i
          }));
        }
        
        if (i % 20 === 0) {
          console.log(`📊 Completed ${i}/${operationCount} operations`);
        }
      }
      
      // 等待所有操作完成
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // 获取最终内存使用情况
      const finalMemory = await getMemoryUsage();
      const memoryIncrease = finalMemory.rss - initialMemory.rss;
      const memoryIncreasePerOp = memoryIncrease / operationCount;
      
      console.log(`📊 Memory - Initial: ${(initialMemory.rss / 1024 / 1024).toFixed(2)}MB, Final: ${(finalMemory.rss / 1024 / 1024).toFixed(2)}MB`);
      console.log(`📊 Memory increase: ${(memoryIncrease / 1024 / 1024).toFixed(2)}MB (${(memoryIncreasePerOp / 1024).toFixed(2)}KB/op)`);
      
      // 内存增长应该合理 (每个操作平均增长小于50KB)
      expect(memoryIncreasePerOp).toBeLessThan(50 * 1024);
    }, 30000);
  });

  describe('错误处理能力测试', () => {
    it('大量错误消息处理测试', async () => {
      const errorMessages = [
        '{"invalid": json}',
        JSON.stringify({ post_type: 'unknown_type' }),
        JSON.stringify({ post_type: 'message', message_type: 'invalid' }),
        'completely invalid message',
        JSON.stringify({ post_type: 'message', user_id: 'invalid_user_id' })
      ];
      
      const startTime = Date.now();
      
      // 发送大量错误消息
      for (let i = 0; i < 100; i++) {
        const errorMsg = errorMessages[i % errorMessages.length];
        wsClient.send(errorMsg);
        
        if (i % 20 === 0) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }
      
      // 确保服务器仍能处理正常消息
      const validResponse = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Service recovery test failed'));
        }, 5000);

        const messageHandler = (data: Buffer) => {
          try {
            const response = JSON.parse(data.toString());
            if (response.action === 'send_private_msg') {
              clearTimeout(timeout);
              wsClient.removeListener('message', messageHandler);
              resolve(response.params.message);
            }
          } catch (error) {
            // 继续等待
          }
        };

        wsClient.on('message', messageHandler);
        
        wsClient.send(JSON.stringify({
          post_type: 'message',
          message_type: 'private',
          user_id: TEST_USER_ID,
          message: [{ type: 'text', data: { text: '错误恢复测试' } }],
          raw_message: '错误恢复测试',
          time: Math.floor(Date.now() / 1000),
          message_id: Date.now()
        }));
      });
      
      const recoveryTime = Date.now() - startTime;
      
      expect(validResponse).toBeTruthy();
      console.log(`✅ Service recovered after 100 error messages in ${recoveryTime}ms`);
      expect(recoveryTime).toBeLessThan(10000); // 10秒内恢复
    });
  });

  /**
   * 获取系统内存使用情况
   */
  async function getMemoryUsage(): Promise<NodeJS.MemoryUsage> {
    try {
      const response = await axios.get(`${HTTP_BASE_URL}/api/status`);
      return response.data.process.memory;
    } catch (error) {
      // 如果API不可用，返回当前进程内存使用情况
      return process.memoryUsage();
    }
  }
});