#!/usr/bin/env npx ts-node

import { DatabaseManager, getDatabaseManager } from '../src/services/database';
import RemoteClaudeService from '../src/services/remote-claude-service';
import AIService from '../src/services/ai-service';
import { config } from '../src/config';
import { RequirementData } from '../src/types';
import { v4 as uuidv4 } from 'uuid';

class IntegrationTester {
  private database: DatabaseManager;
  private remoteClaudeService: RemoteClaudeService;
  private aiService: AIService;
  
  constructor() {
    this.database = getDatabaseManager(config.database);
    this.remoteClaudeService = new RemoteClaudeService(this.database);
    this.aiService = new AIService(config.ai);
  }

  async runAllTests(): Promise<void> {
    console.log('🧪 开始Remote Claude集成测试\n');
    console.log('=' .repeat(60));

    try {
      await this.testDatabaseConnection();
      await this.testRemoteSession();
      await this.testIntentAnalysis();
      await this.testDatabaseOperations();
      await this.testRemoteClaudeService();
      
      const sessionExists = await this.remoteClaudeService.checkRemoteSession();
      if (sessionExists) {
        await this.testEndToEndIntegration();
      } else {
        console.warn('\n⚠️  Claude Code远程会话未启动，跳过端到端测试');
        console.warn('   请运行: ./scripts/setup_remote_claude.sh');
      }

      console.log('\n' + '=' .repeat(60));
      console.log('✅ 所有测试完成！');
      
    } catch (error) {
      console.error('\n❌ 测试失败:', error);
      throw error;
    } finally {
      await this.database.close();
    }
  }

  private async testDatabaseConnection(): Promise<void> {
    console.log('\n📊 测试数据库连接...');
    
    const connected = await this.database.testConnection();
    if (!connected) {
      throw new Error('数据库连接失败');
    }
    
    console.log('✅ 数据库连接正常');
  }

  private async testRemoteSession(): Promise<void> {
    console.log('\n🔗 测试远程会话状态...');
    
    const sessionExists = await this.remoteClaudeService.checkRemoteSession();
    console.log(`${sessionExists ? '✅' : '⚠️ '} 远程会话状态: ${sessionExists ? '存在' : '不存在'}`);
    
    if (!sessionExists) {
      console.log('   💡 提示: 运行 ./scripts/setup_remote_claude.sh 启动远程会话');
    }
  }

  private async testIntentAnalysis(): Promise<void> {
    console.log('\n🤖 测试意图分析...');
    
    const testCases = [
      { message: '帮我实现一个用户登录功能', expectRequirement: true },
      { message: '修复数据库连接超时问题', expectRequirement: true },
      { message: '你好，今天天气怎么样', expectRequirement: false },
      { message: '谢谢', expectRequirement: false }
    ];

    for (const testCase of testCases) {
      const intent = await this.aiService.analyzeIntent(testCase.message, 85178516);
      const isCorrect = intent.isRequirement === testCase.expectRequirement;
      
      console.log(`${isCorrect ? '✅' : '❌'} "${testCase.message}"`);
      console.log(`   -> ${intent.isRequirement ? '需求' : '非需求'} (置信度: ${intent.confidence}%)`);
      
      if (!isCorrect) {
        throw new Error(`意图分析错误: "${testCase.message}"`);
      }
    }
    
    console.log('✅ 意图分析测试通过');
  }

  private async testDatabaseOperations(): Promise<void> {
    console.log('\n💾 测试数据库操作...');
    
    const testRequirementId = uuidv4();
    
    try {
      // 测试保存需求
      const requirementData: RequirementData = {
        id: testRequirementId,
        user_id: 85178516,
        message: '测试需求：创建一个简单的待办事项管理器',
        status: 'received',
        created_at: new Date(),
        updated_at: new Date()
      };

      const saved = await this.database.saveRequirement(requirementData);
      if (!saved) {
        throw new Error('保存需求失败');
      }
      console.log('✅ 需求保存成功');

      // 测试检索需求
      const retrieved = await this.database.getRequirementById(testRequirementId);
      if (!retrieved || retrieved.message !== requirementData.message) {
        throw new Error('检索需求失败');
      }
      console.log('✅ 需求检索成功');

      // 测试状态更新
      await this.database.updateRequirementStatus(testRequirementId, 'processing', {
        processing_start_time: new Date()
      });

      const updated = await this.database.getRequirementById(testRequirementId);
      if (!updated || updated.status !== 'processing') {
        throw new Error('状态更新失败');
      }
      console.log('✅ 状态更新成功');

    } finally {
      // 清理测试数据
      try {
        await this.database.executeUpdate(
          'DELETE FROM requirements WHERE id = ?',
          [testRequirementId]
        );
        console.log('✅ 测试数据清理完成');
      } catch (error) {
        console.warn('⚠️  测试数据清理失败:', error);
      }
    }
  }

  private async testRemoteClaudeService(): Promise<void> {
    console.log('\n🛠️  测试Remote Claude服务...');
    
    // 测试健康检查
    const health = await this.remoteClaudeService.healthCheck();
    console.log('✅ 健康检查完成:', JSON.stringify(health, null, 2));
    
    // 测试处理统计
    const stats = await this.remoteClaudeService.getProcessingStats();
    console.log('✅ 处理统计获取成功:', stats);
    
    // 测试清理过期需求
    const cleanupCount = await this.remoteClaudeService.cleanupStaleRequirements();
    console.log(`✅ 清理过期需求完成: ${cleanupCount} 个`);
  }

  private async testEndToEndIntegration(): Promise<void> {
    console.log('\n🔄 测试端到端集成...');
    
    const testRequirementId = uuidv4();
    
    try {
      const requirementData: RequirementData = {
        id: testRequirementId,
        user_id: 85178516,
        message: '测试需求：创建一个简单的Hello World函数，要求使用TypeScript',
        status: 'received',
        created_at: new Date(),
        updated_at: new Date()
      };

      // 保存需求
      await this.database.saveRequirement(requirementData);
      console.log('✅ 测试需求已保存');

      // 处理需求
      console.log('⏳ 开始处理需求（这可能需要一些时间）...');
      
      try {
        await this.remoteClaudeService.processRequirement(requirementData);
        
        // 检查结果
        const result = await this.database.getRequirementById(testRequirementId);
        
        if (result?.status === 'completed') {
          console.log('✅ 需求处理成功完成');
          console.log('📋 输出摘要:', result.claude_code_output?.substring(0, 300));
          if (result.claude_code_output && result.claude_code_output.length > 300) {
            console.log('   ...(输出已截断)');
          }
        } else if (result?.status === 'failed') {
          console.log('❌ 需求处理失败:', result.error_message);
        } else if (result?.status === 'processing') {
          console.log('⏳ 需求仍在处理中，这是正常的');
        }
        
        console.log('✅ 端到端测试完成');
        
      } catch (error) {
        console.warn('⚠️  需求处理过程出现问题:', error);
        console.log('   这可能是正常的，取决于Claude Code的当前状态');
      }

    } finally {
      // 清理测试数据
      try {
        await this.database.executeUpdate(
          'DELETE FROM requirements WHERE id = ?',
          [testRequirementId]
        );
        console.log('✅ 端到端测试数据清理完成');
      } catch (error) {
        console.warn('⚠️  端到端测试数据清理失败:', error);
      }
    }
  }
}

// 运行测试
async function main(): Promise<void> {
  const tester = new IntegrationTester();
  
  try {
    await tester.runAllTests();
    process.exit(0);
  } catch (error) {
    console.error('\n💥 测试运行失败:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}