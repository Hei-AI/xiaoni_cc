/**
 * Token HTTP API测试
 * 测试Token管理的REST API接口
 */

import request from 'supertest';
import { Express } from 'express';
import HttpServer from '../src/services/http-server';
import { getDatabaseManager, DatabaseManager } from '../src/services/database';
import WebSocketClient from '../src/services/websocket-client';
import { TokenMigrator } from '../scripts/migrate_tokens_to_db';
import { config } from '../src/config';

describe('Token HTTP API', () => {
  let app: Express;
  let httpServer: HttpServer;
  let database: DatabaseManager;
  let websocketClient: WebSocketClient;
  let migrator: TokenMigrator;

  beforeAll(async () => {
    // 初始化测试环境
    database = getDatabaseManager({
      ...config.database,
      database: 'qq_bot_test'
    });

    // 创建模拟的WebSocket客户端
    websocketClient = {
      isConnected: () => true,
      sendPrivateMessage: jest.fn(),
      sendGroupMessage: jest.fn(),
      sendReplyMessage: jest.fn(),
      sendAtMessage: jest.fn()
    } as any;

    httpServer = new HttpServer(config.http_server, {
      database,
      websocketClient
    });

    app = httpServer.getApp();
    migrator = new TokenMigrator();

    // 运行迁移脚本
    await migrator.migrate().catch(() => {});
  });

  beforeEach(async () => {
    // 清理测试数据
    await cleanupTestData();
    await createTestTokens();
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  async function cleanupTestData() {
    try {
      await database.executeUpdate('DELETE FROM api_token_logs');
      await database.executeUpdate('DELETE FROM api_tokens');
    } catch (error) {
      // 忽略清理错误
    }
  }

  async function createTestTokens() {
    await database.executeUpdate(`
      INSERT INTO api_tokens 
      (token, project_name, project_id, is_active, is_healthy, daily_limit, daily_used, priority)
      VALUES 
      ('test_token_1_api_12345678901234567890', 'test_api_project_1', '2001', TRUE, TRUE, 1000, 10, 1),
      ('test_token_2_api_12345678901234567890', 'test_api_project_2', '2002', TRUE, FALSE, 1000, 500, 2),
      ('test_token_3_api_12345678901234567890', 'test_api_project_3', '2003', FALSE, TRUE, 1000, 0, 3)
    `);
  }

  describe('GET /api/tokens', () => {
    test('should return token statistics', async () => {
      const response = await request(app)
        .get('/api/tokens')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('total');
      expect(response.body.data).toHaveProperty('active');
      expect(response.body.data).toHaveProperty('healthy');
      expect(response.body.data).toHaveProperty('tokens');
      expect(Array.isArray(response.body.data.tokens)).toBe(true);
    });
  });

  describe('GET /api/tokens/stats', () => {
    test('should return summary statistics', async () => {
      const response = await request(app)
        .get('/api/tokens/stats')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('total');
      expect(response.body.data).toHaveProperty('active');
      expect(response.body.data).toHaveProperty('healthy');
      expect(response.body.data).toHaveProperty('blacklisted');
      expect(response.body.data).toHaveProperty('over_daily_limit');

      // 验证数据类型
      expect(typeof response.body.data.total).toBe('number');
      expect(typeof response.body.data.active).toBe('number');
    });
  });

  describe('GET /api/tokens/:id', () => {
    test('should return specific token information', async () => {
      // 首先获取一个token ID
      const tokens = await database.executeQuery<{id: number}>(
        'SELECT id FROM api_tokens LIMIT 1'
      );
      
      if (tokens.length > 0) {
        const tokenId = tokens[0].id;
        
        const response = await request(app)
          .get(`/api/tokens/${tokenId}`)
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data).toHaveProperty('id');
        expect(response.body.data).toHaveProperty('token');
        expect(response.body.data).toHaveProperty('project_name');
        
        // 验证token值被隐藏
        expect(response.body.data.token).toMatch(/^.{8}\.{3}$/);
      }
    });

    test('should return 404 for non-existent token', async () => {
      const response = await request(app)
        .get('/api/tokens/99999')
        .expect(404);

      expect(response.body.error).toContain('Token not found');
    });

    test('should return 400 for invalid token ID', async () => {
      const response = await request(app)
        .get('/api/tokens/invalid')
        .expect(400);

      expect(response.body.error).toContain('Invalid token ID');
    });
  });

  describe('POST /api/tokens/health-check', () => {
    test('should initiate health check for all tokens', async () => {
      const response = await request(app)
        .post('/api/tokens/health-check')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('Health check initiated');
    });
  });

  describe('POST /api/tokens/:id/health-check', () => {
    test('should initiate health check for specific token', async () => {
      const tokens = await database.executeQuery<{id: number}>(
        'SELECT id FROM api_tokens WHERE is_active = TRUE LIMIT 1'
      );
      
      if (tokens.length > 0) {
        const tokenId = tokens[0].id;
        
        const response = await request(app)
          .post(`/api/tokens/${tokenId}/health-check`)
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.message).toContain('Health check initiated');
      }
    });

    test('should return 404 for inactive token', async () => {
      const tokens = await database.executeQuery<{id: number}>(
        'SELECT id FROM api_tokens WHERE is_active = FALSE LIMIT 1'
      );
      
      if (tokens.length > 0) {
        const tokenId = tokens[0].id;
        
        const response = await request(app)
          .post(`/api/tokens/${tokenId}/health-check`)
          .expect(404);

        expect(response.body.error).toContain('Token not found or inactive');
      }
    });
  });

  describe('POST /api/tokens/:id/activate', () => {
    test('should activate inactive token', async () => {
      const tokens = await database.executeQuery<{id: number}>(
        'SELECT id FROM api_tokens WHERE is_active = FALSE LIMIT 1'
      );
      
      if (tokens.length > 0) {
        const tokenId = tokens[0].id;
        
        const response = await request(app)
          .post(`/api/tokens/${tokenId}/activate`)
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.message).toContain('activated successfully');

        // 验证数据库中的状态已更新
        const updatedToken = await database.executeQuery(
          'SELECT is_active FROM api_tokens WHERE id = ?',
          [tokenId]
        );
        expect(updatedToken[0]?.is_active).toBe(1);
      }
    });

    test('should return 404 for non-existent token', async () => {
      const response = await request(app)
        .post('/api/tokens/99999/activate')
        .expect(404);

      expect(response.body.error).toContain('Token not found');
    });
  });

  describe('POST /api/tokens/:id/deactivate', () => {
    test('should deactivate active token', async () => {
      const tokens = await database.executeQuery<{id: number}>(
        'SELECT id FROM api_tokens WHERE is_active = TRUE LIMIT 1'
      );
      
      if (tokens.length > 0) {
        const tokenId = tokens[0].id;
        
        const response = await request(app)
          .post(`/api/tokens/${tokenId}/deactivate`)
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.message).toContain('deactivated successfully');

        // 验证数据库中的状态已更新
        const updatedToken = await database.executeQuery(
          'SELECT is_active FROM api_tokens WHERE id = ?',
          [tokenId]
        );
        expect(updatedToken[0]?.is_active).toBe(0);
      }
    });
  });

  describe('DELETE /api/tokens/blacklist', () => {
    test('should clear token blacklist', async () => {
      // 先将一些token加入黑名单
      await database.executeUpdate(`
        UPDATE api_tokens SET 
          blacklisted_until = DATE_ADD(NOW(), INTERVAL 1 HOUR),
          blacklist_reason = 'Test blacklist'
        WHERE is_active = TRUE
        LIMIT 2
      `);

      const response = await request(app)
        .delete('/api/tokens/blacklist')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toMatch(/Cleared \d+ tokens from blacklist/);

      // 验证黑名单已清除
      const blacklistedTokens = await database.executeQuery(
        'SELECT COUNT(*) as count FROM api_tokens WHERE blacklisted_until > NOW()'
      );
      expect(blacklistedTokens[0]?.count).toBe(0);
    });
  });

  describe('GET /api/tokens/:id/logs', () => {
    test('should return token usage logs', async () => {
      // 创建一些测试日志
      const tokens = await database.executeQuery<{id: number}>(
        'SELECT id FROM api_tokens LIMIT 1'
      );
      
      if (tokens.length > 0) {
        const tokenId = tokens[0].id;
        
        // 插入测试日志
        await database.executeUpdate(`
          INSERT INTO api_token_logs (token_id, action, result, created_at)
          VALUES 
          (?, 'use', 'success', NOW()),
          (?, 'health_check', 'success', NOW()),
          (?, 'error', 'error', NOW())
        `, [tokenId, tokenId, tokenId]);

        const response = await request(app)
          .get(`/api/tokens/${tokenId}/logs`)
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data).toHaveProperty('logs');
        expect(response.body.data).toHaveProperty('total');
        expect(Array.isArray(response.body.data.logs)).toBe(true);
        expect(response.body.data.logs.length).toBeGreaterThan(0);
      }
    });

    test('should support pagination', async () => {
      const tokens = await database.executeQuery<{id: number}>(
        'SELECT id FROM api_tokens LIMIT 1'
      );
      
      if (tokens.length > 0) {
        const tokenId = tokens[0].id;
        
        const response = await request(app)
          .get(`/api/tokens/${tokenId}/logs?limit=2&offset=0`)
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data.limit).toBe(2);
        expect(response.body.data.offset).toBe(0);
      }
    });

    test('should return 400 for invalid token ID', async () => {
      const response = await request(app)
        .get('/api/tokens/invalid/logs')
        .expect(400);

      expect(response.body.error).toContain('Invalid token ID');
    });
  });

  describe('Error Handling', () => {
    test('should handle database errors gracefully', async () => {
      // 临时关闭数据库连接来模拟错误
      const originalExecuteQuery = database.executeQuery;
      database.executeQuery = jest.fn().mockRejectedValue(new Error('Database connection failed'));

      const response = await request(app)
        .get('/api/tokens/stats')
        .expect(500);

      expect(response.body.error).toBeTruthy();

      // 恢复原始方法
      database.executeQuery = originalExecuteQuery;
    });
  });
}, 60000);