/**
 * Token管理系统测试
 * 测试新的数据库驱动token管理功能
 */

import { TokenManager, getTokenManager, resetTokenManager } from '../src/utils/token-manager';
import { getDatabaseManager, DatabaseManager } from '../src/services/database';
import { TokenMigrator } from '../scripts/migrate_tokens_to_db';
import { config } from '../src/config';

describe('Token Management System', () => {
  let database: DatabaseManager;
  let tokenManager: TokenManager;
  let migrator: TokenMigrator;

  beforeAll(async () => {
    // 使用测试数据库配置
    database = getDatabaseManager({
      ...config.database,
      database: 'qq_bot_test' // 使用测试数据库
    });
    
    migrator = new TokenMigrator();
  });

  beforeEach(async () => {
    // 重置token管理器实例
    resetTokenManager();
    tokenManager = getTokenManager(database);
    
    // 清理测试数据
    await cleanupTestData();
  });

  afterAll(async () => {
    // 清理测试数据
    await cleanupTestData();
  });

  async function cleanupTestData() {
    try {
      await database.executeUpdate('DELETE FROM api_token_logs');
      await database.executeUpdate('DELETE FROM api_tokens');
      await database.executeUpdate('DELETE FROM api_token_health_config');
    } catch (error) {
      console.warn('Cleanup warning:', error);
    }
  }

  async function createTestTokens() {
    await database.executeUpdate(`
      INSERT INTO api_tokens 
      (token, project_name, project_id, is_active, is_healthy, daily_limit, priority)
      VALUES 
      ('test_token_1_12345678901234567890', 'test_project_1', '1001', TRUE, TRUE, 100, 1),
      ('test_token_2_12345678901234567890', 'test_project_2', '1002', TRUE, TRUE, 100, 2),
      ('test_token_3_12345678901234567890', 'test_project_3', '1003', FALSE, TRUE, 100, 3)
    `);
  }

  describe('TokenManager Basic Functionality', () => {
    test('should initialize with database backend', async () => {
      // 执行迁移以创建表结构
      await migrator.migrate().catch(() => {}); // 忽略表已存在的错误
      
      const stats = await tokenManager.getStats();
      expect(stats).toHaveProperty('total');
      expect(stats).toHaveProperty('active');
      expect(stats).toHaveProperty('healthy');
      expect(stats).toHaveProperty('blacklisted');
    });

    test('should get next available token', async () => {
      await migrator.migrate().catch(() => {});
      await createTestTokens();
      
      const token = await tokenManager.getNextToken();
      expect(token).toBeTruthy();
      expect(typeof token).toBe('string');
    });

    test('should report token success correctly', async () => {
      await migrator.migrate().catch(() => {});
      await createTestTokens();
      
      const token = await tokenManager.getNextToken();
      if (token) {
        await tokenManager.reportSuccess(token, 500, { tokens: 100 });
        
        // 验证token状态更新
        const tokenData = await database.executeQuery(
          'SELECT error_count FROM api_tokens WHERE token = ?',
          [token]
        );
        expect(tokenData[0]?.error_count).toBe(0);
      }
    });

    test('should handle token errors and blacklisting', async () => {
      await migrator.migrate().catch(() => {});
      await createTestTokens();
      
      const token = await tokenManager.getNextToken();
      if (token) {
        // 报告多次错误触发黑名单
        await tokenManager.reportError(token, 'Test error 1');
        await tokenManager.reportError(token, 'Test error 2');
        await tokenManager.reportError(token, 'Test error 3');
        
        // 验证token被加入黑名单
        const tokenData = await database.executeQuery(
          'SELECT error_count, blacklisted_until FROM api_tokens WHERE token = ?',
          [token]
        );
        
        expect(tokenData[0]?.error_count).toBeGreaterThanOrEqual(3);
        expect(tokenData[0]?.blacklisted_until).toBeTruthy();
      }
    });

    test('should get token statistics correctly', async () => {
      await migrator.migrate().catch(() => {});
      await createTestTokens();
      
      const stats = await tokenManager.getStats();
      
      expect(stats.total).toBeGreaterThan(0);
      expect(stats.active).toBeGreaterThan(0);
      expect(Array.isArray(stats.tokens)).toBe(true);
      expect(stats.tokens.length).toBeGreaterThan(0);
    });

    test('should clear blacklist correctly', async () => {
      await migrator.migrate().catch(() => {});
      await createTestTokens();
      
      // 先将一个token加入黑名单
      const token = await tokenManager.getNextToken();
      if (token) {
        for (let i = 0; i < 3; i++) {
          await tokenManager.reportError(token, `Error ${i + 1}`);
        }
        
        // 清除黑名单
        const clearedCount = await tokenManager.clearBlacklist();
        expect(clearedCount).toBeGreaterThan(0);
        
        // 验证黑名单已清除
        const blacklistedTokens = await database.executeQuery(
          'SELECT COUNT(*) as count FROM api_tokens WHERE blacklisted_until > NOW()'
        );
        expect(blacklistedTokens[0]?.count).toBe(0);
      }
    });
  });

  describe('Token Migration', () => {
    test('should migrate tokens from properties file', async () => {
      // 测试迁移功能
      await migrator.migrate();
      
      // 验证tokens表是否被创建和填充
      const tokenCount = await database.executeQuery<{count: number}>(
        'SELECT COUNT(*) as count FROM api_tokens'
      );
      
      expect(tokenCount[0]?.count).toBeGreaterThan(0);
    });

    test('should not duplicate tokens on repeated migration', async () => {
      // 第一次迁移
      await migrator.migrate();
      const firstCount = await database.executeQuery<{count: number}>(
        'SELECT COUNT(*) as count FROM api_tokens'
      );
      
      // 第二次迁移
      await migrator.migrate();
      const secondCount = await database.executeQuery<{count: number}>(
        'SELECT COUNT(*) as count FROM api_tokens'
      );
      
      // 数量应该相同，没有重复插入
      expect(firstCount[0]?.count).toBe(secondCount[0]?.count);
    });
  });

  describe('Token Health Check', () => {
    test('should run health check without errors', async () => {
      await migrator.migrate().catch(() => {});
      await createTestTokens();
      
      // 运行健康检查不应该抛出错误
      await expect(tokenManager.runHealthCheck()).resolves.not.toThrow();
    });

    test('should log health check results', async () => {
      await migrator.migrate().catch(() => {});
      await createTestTokens();
      
      await tokenManager.runHealthCheck();
      
      // 验证日志记录
      const logCount = await database.executeQuery<{count: number}>(
        'SELECT COUNT(*) as count FROM api_token_logs WHERE action = \"health_check\"'
      );
      
      expect(logCount[0]?.count).toBeGreaterThan(0);
    });
  });

  describe('Daily Usage Reset', () => {
    test('should reset daily usage for tokens', async () => {
      await migrator.migrate().catch(() => {});
      await createTestTokens();
      
      // 更新一些token的使用量和重置日期
      await database.executeUpdate(`
        UPDATE api_tokens SET 
          daily_used = 50, 
          last_reset_date = DATE_SUB(CURDATE(), INTERVAL 1 DAY)
        WHERE project_name = 'test_project_1'
      `);
      
      // 获取新token触发重置检查
      await tokenManager.getNextToken();
      
      // 验证使用量已重置
      const tokenData = await database.executeQuery(
        'SELECT daily_used, last_reset_date FROM api_tokens WHERE project_name = ?',
        ['test_project_1']
      );
      
      expect(tokenData[0]?.daily_used).toBe(1); // 因为getNextToken会增加使用量
      expect(new Date(tokenData[0]?.last_reset_date).toDateString()).toBe(new Date().toDateString());
    });
  });

  describe('Token Selection Strategy', () => {
    test('should select tokens by priority and usage', async () => {
      await migrator.migrate().catch(() => {});
      await createTestTokens();
      
      // 获取多个token，验证选择策略
      const tokens = [];
      for (let i = 0; i < 3; i++) {
        const token = await tokenManager.getNextToken();
        if (token) tokens.push(token);
      }
      
      expect(tokens.length).toBeGreaterThan(0);
      
      // 验证选择的是活跃的token
      for (const token of tokens) {
        const tokenData = await database.executeQuery(
          'SELECT is_active FROM api_tokens WHERE token = ?',
          [token]
        );
        expect(tokenData[0]?.is_active).toBe(1);
      }
    });

    test('should not select blacklisted tokens', async () => {
      await migrator.migrate().catch(() => {});
      await createTestTokens();
      
      // 将所有token加入黑名单
      await database.executeUpdate(`
        UPDATE api_tokens SET 
          blacklisted_until = DATE_ADD(NOW(), INTERVAL 1 HOUR),
          blacklist_reason = 'Test blacklist'
        WHERE is_active = TRUE
      `);
      
      // 尝试获取token应该返回null
      const token = await tokenManager.getNextToken();
      expect(token).toBeNull();
    });

    test('should not select tokens over daily limit', async () => {
      await migrator.migrate().catch(() => {});
      await createTestTokens();
      
      // 将所有token的使用量设置为达到限制
      await database.executeUpdate(`
        UPDATE api_tokens SET daily_used = daily_limit 
        WHERE is_active = TRUE
      `);
      
      // 尝试获取token应该返回null
      const token = await tokenManager.getNextToken();
      expect(token).toBeNull();
    });
  });
}); // Jest配置中已设置超时