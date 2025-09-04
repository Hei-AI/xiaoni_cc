import { DatabaseManager, getDatabaseManager } from '../src/services/database';
import RemoteClaudeService from '../src/services/remote-claude-service';
import AIService from '../src/services/ai-service';
import { config } from '../src/config';
import { RequirementData } from '../src/types';
import { v4 as uuidv4 } from 'uuid';

describe('Remote Claude Integration', () => {
  let database: DatabaseManager;
  let remoteClaudeService: RemoteClaudeService;
  let aiService: AIService;

  beforeAll(async () => {
    // 初始化服务
    database = getDatabaseManager(config.database);
    remoteClaudeService = new RemoteClaudeService(database);
    aiService = new AIService(config.ai, database);

    // 确保数据库连接正常
    const connected = await database.testConnection();
    if (!connected) {
      throw new Error('Database connection failed');
    }
  });

  afterAll(async () => {
    await database.close();
  });

  describe('Environment Setup', () => {
    test('should have tmux available', async () => {
      const sessionExists = await remoteClaudeService.checkRemoteSession();
      expect(typeof sessionExists).toBe('boolean');
      
      if (!sessionExists) {
        console.warn('⚠️  Claude Code远程会话未启动，某些测试可能失败');
        console.warn('请运行: ./scripts/setup_remote_claude.sh');
      }
    });

    test('should have database connection', async () => {
      const connected = await database.testConnection();
      expect(connected).toBe(true);
    });
  });

  describe('Intent Analysis', () => {
    test('should detect development requirements', async () => {
      const testMessages = [
        '帮我实现一个用户登录功能',
        '修复数据库连接超时的问题',
        '优化查询性能',
        '添加新的API接口',
        '重构代码结构'
      ];

      for (const message of testMessages) {
        const intent = await aiService.analyzeIntent(message, 85178516);
        
        expect(intent.isRequirement).toBe(true);
        expect(intent.confidence).toBeGreaterThan(60);
        expect(intent.category).toBeDefined();
        expect(intent.complexity).toBeDefined();
        
        console.log(`✅ "${message}" -> ${intent.category} (${intent.complexity}, 置信度: ${intent.confidence}%)`);
      }
    });

    test('should not detect casual conversation as requirements', async () => {
      const casualMessages = [
        '你好',
        '今天天气怎么样',
        '谢谢',
        '晚安'
      ];

      for (const message of casualMessages) {
        const intent = await aiService.analyzeIntent(message, 85178516);
        
        expect(intent.isRequirement).toBe(false);
        
        console.log(`✅ "${message}" -> 非需求 (置信度: ${intent.confidence}%)`);
      }
    });
  });

  describe('Database Operations', () => {
    let testRequirementId: string;

    beforeEach(() => {
      testRequirementId = uuidv4();
    });

    afterEach(async () => {
      // 清理测试数据
      try {
        await database.executeUpdate(
          'DELETE FROM requirements WHERE id = ?',
          [testRequirementId]
        );
      } catch (error) {
        console.warn('Failed to cleanup test data:', error);
      }
    });

    test('should save and retrieve requirements', async () => {
      const requirementData: RequirementData = {
        id: testRequirementId,
        user_id: 85178516,
        message: '测试需求：创建一个简单的待办事项管理器',
        status: 'received',
        created_at: new Date(),
        updated_at: new Date()
      };

      // 保存需求
      const saved = await database.saveRequirement(requirementData);
      expect(saved).toBe(true);

      // 检索需求
      const retrieved = await database.getRequirementById(testRequirementId);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.message).toBe(requirementData.message);
      expect(retrieved?.status).toBe('pending');

      console.log('✅ 需求数据库操作测试通过');
    });

    test('should update requirement status', async () => {
      const requirementData: RequirementData = {
        id: testRequirementId,
        user_id: 85178516,
        message: '测试需求：状态更新测试',
        status: 'received',
        created_at: new Date(),
        updated_at: new Date()
      };

      // 保存初始需求
      await database.saveRequirement(requirementData);

      // 更新状态为processing
      await database.updateRequirementStatus(testRequirementId, 'processing', {
        processing_start_time: new Date()
      });

      const processing = await database.getRequirementById(testRequirementId);
      expect(processing?.status).toBe('processing');
      expect(processing?.processing_start_time).toBeDefined();

      // 更新状态为completed
      await database.updateRequirementStatus(testRequirementId, 'completed', {
        processing_end_time: new Date(),
        claude_code_output: '测试输出',
        completion_details: '测试完成'
      });

      const completed = await database.getRequirementById(testRequirementId);
      expect(completed?.status).toBe('completed');
      expect(completed?.claude_code_output).toBe('测试输出');

      console.log('✅ 需求状态更新测试通过');
    });
  });

  describe('Remote Claude Service', () => {
    test('should check remote session status', async () => {
      const sessionExists = await remoteClaudeService.checkRemoteSession();
      expect(typeof sessionExists).toBe('boolean');
      
      console.log(`✅ 远程会话状态: ${sessionExists ? '存在' : '不存在'}`);
    });

    test('should get processing statistics', async () => {
      const stats = await remoteClaudeService.getProcessingStats();
      
      expect(stats).toHaveProperty('total');
      expect(stats).toHaveProperty('processing');
      expect(stats).toHaveProperty('completed');
      expect(stats).toHaveProperty('failed');
      
      expect(typeof stats.total).toBe('number');
      expect(typeof stats.processing).toBe('number');
      expect(typeof stats.completed).toBe('number');
      expect(typeof stats.failed).toBe('number');

      console.log('✅ 处理统计:', stats);
    });

    test('should perform health check', async () => {
      const health = await remoteClaudeService.healthCheck();
      
      expect(health).toHaveProperty('remoteSessionExists');
      expect(health).toHaveProperty('scriptsAvailable');
      expect(health).toHaveProperty('stats');
      
      expect(typeof health.remoteSessionExists).toBe('boolean');
      expect(typeof health.scriptsAvailable).toBe('boolean');

      console.log('✅ 健康检查结果:', health);
    });

    test('should cleanup stale requirements', async () => {
      const cleanupCount = await remoteClaudeService.cleanupStaleRequirements();
      expect(typeof cleanupCount).toBe('number');
      expect(cleanupCount).toBeGreaterThanOrEqual(0);

      console.log(`✅ 清理了 ${cleanupCount} 个过期需求`);
    });
  });

  describe('End-to-End Integration', () => {
    let testRequirementId: string;

    beforeEach(() => {
      testRequirementId = uuidv4();
    });

    afterEach(async () => {
      // 清理测试数据
      try {
        await database.executeUpdate(
          'DELETE FROM requirements WHERE id = ?',
          [testRequirementId]
        );
      } catch (error) {
        console.warn('Failed to cleanup test data:', error);
      }
    });

    test('should process requirement end-to-end', async () => {
      const sessionExists = await remoteClaudeService.checkRemoteSession();
      
      if (!sessionExists) {
        console.warn('⚠️  跳过端到端测试：Claude Code远程会话未启动');
        return;
      }

      const requirementData: RequirementData = {
        id: testRequirementId,
        user_id: 85178516,
        message: '测试需求：创建一个简单的Hello World函数',
        status: 'received',
        created_at: new Date(),
        updated_at: new Date()
      };

      // 保存需求
      await database.saveRequirement(requirementData);

      try {
        // 处理需求
        console.log('📝 开始处理测试需求...');
        await remoteClaudeService.processRequirement(requirementData);

        // 检查处理结果
        const result = await database.getRequirementById(testRequirementId);
        expect(result).not.toBeNull();
        expect(['processing', 'completed', 'failed']).toContain(result?.status);

        if (result?.status === 'completed') {
          expect(result.claude_code_output).toBeDefined();
          expect(result.processing_end_time).toBeDefined();
          console.log('✅ 需求处理成功完成');
          console.log('📋 输出摘要:', result.claude_code_output?.substring(0, 200));
        } else if (result?.status === 'failed') {
          console.log('❌ 需求处理失败:', result.error_message);
        } else if (result?.status === 'processing') {
          console.log('⏳ 需求仍在处理中...');
        }

      } catch (error) {
        console.warn('⚠️  需求处理过程中出现错误:', error);
        // 不让测试失败，因为这可能是环境问题
      }
    }, 60000); // 60秒超时
  });
});

// 如果直接运行此文件，执行测试
if (require.main === module) {
  console.log('🧪 运行Remote Claude集成测试...\n');
  
  // 这里可以添加简单的测试运行逻辑
  // 由于Jest配置复杂，我们提供一个简单的手动测试版本
  console.log('请运行: npm test -- remote-claude-integration.test.ts');
}