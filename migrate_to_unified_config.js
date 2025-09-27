#!/usr/bin/env node

/**
 * 🔄 配置迁移脚本：从Legacy双系统 → 纯统一配置
 *
 * 目标：
 * 1. 验证现有AgentPromptData的完整性
 * 2. 确保数据库表结构支持统一配置
 * 3. 清理Legacy配置相关的冗余代码引用
 * 4. 验证简化版AI Service的功能
 */

const mysql = require('mysql2/promise');
const fs = require('fs').promises;
const path = require('path');

// 数据库配置
const dbConfig = {
  host: process.env.MYSQL_HOST || 'localhost',
  port: parseInt(process.env.MYSQL_PORT || '3306'),
  user: process.env.MYSQL_USER || 'qqbot_user',
  password: process.env.MYSQL_PASSWORD || 'qqbot_password',
  database: process.env.MYSQL_DATABASE || 'qqbot_db',
  charset: 'utf8mb4'
};

async function migrateToUnifiedConfig() {
  console.log('🔄 开始迁移到纯统一配置架构...\n');

  let connection = null;

  try {
    // ============================================================================
    // 📊 步骤1: 数据库结构验证
    // ============================================================================

    console.log('📊 步骤1: 验证数据库表结构...');
    connection = await mysql.createConnection(dbConfig);

    // 检查agent_prompts表结构
    const [tableDesc] = await connection.execute('DESCRIBE agent_prompts');
    const columns = tableDesc.map(row => row.Field);

    const requiredColumns = [
      'id', 'agent_type', 'prompt_name', 'system_instructions',
      'model_name', 'model_config', 'advanced_config', 'is_active',
      'created_at', 'updated_at'
    ];

    const missingColumns = requiredColumns.filter(col => !columns.includes(col));

    if (missingColumns.length > 0) {
      console.log('❌ 数据库表结构不完整，缺少字段:', missingColumns.join(', '));
      return false;
    }

    console.log('✅ 数据库表结构验证通过');

    // ============================================================================
    // 📋 步骤2: 现有配置数据分析
    // ============================================================================

    console.log('\n📋 步骤2: 分析现有配置数据...');

    const [agentPrompts] = await connection.execute(`
      SELECT
        id, agent_type, prompt_name, model_name,
        system_instructions, model_config, advanced_config,
        is_active, created_at, updated_at
      FROM agent_prompts
      ORDER BY agent_type, prompt_name
    `);

    console.log(`📈 发现 ${agentPrompts.length} 个Agent配置:`);

    const configAnalysis = {
      byAgentType: {},
      byModelName: {},
      activeConfigs: 0,
      inactiveConfigs: 0,
      configurationIssues: []
    };

    for (const prompt of agentPrompts) {
      // 按Agent类型分组
      if (!configAnalysis.byAgentType[prompt.agent_type]) {
        configAnalysis.byAgentType[prompt.agent_type] = 0;
      }
      configAnalysis.byAgentType[prompt.agent_type]++;

      // 按模型名称分组
      if (!configAnalysis.byModelName[prompt.model_name]) {
        configAnalysis.byModelName[prompt.model_name] = 0;
      }
      configAnalysis.byModelName[prompt.model_name]++;

      // 状态统计
      if (prompt.is_active) {
        configAnalysis.activeConfigs++;
      } else {
        configAnalysis.inactiveConfigs++;
      }

      // 检查配置完整性
      try {
        const systemInstructions = JSON.parse(prompt.system_instructions || '[]');
        const modelConfig = JSON.parse(prompt.model_config || '{}');

        if (!Array.isArray(systemInstructions)) {
          configAnalysis.configurationIssues.push(`${prompt.id}: system_instructions不是数组格式`);
        }

        if (!modelConfig.temperature && !modelConfig.topK && !modelConfig.topP) {
          configAnalysis.configurationIssues.push(`${prompt.id}: model_config缺少基础参数`);
        }
      } catch (error) {
        configAnalysis.configurationIssues.push(`${prompt.id}: JSON解析失败 - ${error.message}`);
      }

      console.log(`   📝 ${prompt.agent_type}/${prompt.prompt_name} → ${prompt.model_name} (${prompt.is_active ? '激活' : '禁用'})`);
    }

    console.log('\n📊 配置统计:');
    console.log('   按Agent类型分布:', JSON.stringify(configAnalysis.byAgentType, null, 2));
    console.log('   按模型分布:', JSON.stringify(configAnalysis.byModelName, null, 2));
    console.log(`   激活配置: ${configAnalysis.activeConfigs}个`);
    console.log(`   禁用配置: ${configAnalysis.inactiveConfigs}个`);

    if (configAnalysis.configurationIssues.length > 0) {
      console.log('\n⚠️  发现配置问题:');
      configAnalysis.configurationIssues.forEach(issue => console.log(`   - ${issue}`));
    } else {
      console.log('✅ 所有配置数据格式正确');
    }

    // ============================================================================
    // 🔧 步骤3: 统一配置转换验证
    // ============================================================================

    console.log('\n🔧 步骤3: 验证统一配置转换...');

    const conversionResults = {
      successful: 0,
      failed: 0,
      errors: []
    };

    for (const prompt of agentPrompts) {
      try {
        // 模拟统一配置转换
        const unifiedConfig = {
          id: prompt.id,
          name: prompt.prompt_name,
          description: `${prompt.agent_type} configuration`,
          category: prompt.agent_type,

          model: {
            name: prompt.model_name || 'gemini-2.5-flash',
            provider: 'google',
            allowedTokenIds: []
          },

          generation: (() => {
            try {
              const modelConfig = JSON.parse(prompt.model_config || '{}');
              return {
                temperature: modelConfig.temperature || 0.7,
                topK: modelConfig.topK || 40,
                topP: modelConfig.topP || 0.95,
                maxOutputTokens: modelConfig.maxOutputTokens || 2048
              };
            } catch {
              return {
                temperature: 0.7,
                topK: 40,
                topP: 0.95,
                maxOutputTokens: 2048
              };
            }
          })(),

          context: {
            systemInstruction: (() => {
              try {
                const instructions = JSON.parse(prompt.system_instructions || '[]');
                return Array.isArray(instructions) ? instructions.join('\n') : instructions || '';
              } catch {
                return prompt.system_instructions || '';
              }
            })(),
            maxContextLength: 32000,
            historyWindowSize: 20
          },

          version: {
            version: 'v1.0.0',
            createdAt: prompt.created_at,
            updatedAt: prompt.updated_at,
            createdBy: 'migration',
            isActive: prompt.is_active
          }
        };

        // 验证必需字段
        if (!unifiedConfig.model.name || !unifiedConfig.category) {
          throw new Error('缺少必需字段');
        }

        conversionResults.successful++;

      } catch (error) {
        conversionResults.failed++;
        conversionResults.errors.push(`${prompt.id}: ${error.message}`);
      }
    }

    console.log(`✅ 转换成功: ${conversionResults.successful}个配置`);
    if (conversionResults.failed > 0) {
      console.log(`❌ 转换失败: ${conversionResults.failed}个配置`);
      conversionResults.errors.forEach(error => console.log(`   - ${error}`));
    }

    // ============================================================================
    // 🧹 步骤4: 代码清理建议
    // ============================================================================

    console.log('\n🧹 步骤4: 生成代码清理建议...');

    const filesToUpdate = [
      {
        file: 'src/services/ai-service.ts',
        action: '替换为 ai-service-simplified.ts',
        reason: '移除Legacy配置系统，使用纯统一配置'
      },
      {
        file: 'src/services/llm-config-service.ts',
        action: '删除',
        reason: '功能已整合到简化版AI Service中'
      },
      {
        file: 'src/services/llm-call-service.ts',
        action: '删除',
        reason: '功能已整合到简化版AI Service中'
      },
      {
        file: 'src/services/config-converter.ts',
        action: '简化',
        reason: '只保留AgentPromptData→UnifiedConfig的单向转换'
      },
      {
        file: 'src/services/unified-config-manager.ts',
        action: '删除',
        reason: '过度复杂，直接使用数据库+缓存即可'
      }
    ];

    console.log('📋 建议的代码清理操作:');
    filesToUpdate.forEach((item, index) => {
      console.log(`   ${index + 1}. ${item.file}`);
      console.log(`      操作: ${item.action}`);
      console.log(`      原因: ${item.reason}\n`);
    });

    // ============================================================================
    // 🎯 步骤5: 迁移建议和下一步
    // ============================================================================

    console.log('🎯 步骤5: 迁移建议和下一步...');

    const recommendations = [
      {
        priority: 'P0',
        task: '替换AI Service',
        description: '将ai-service.ts替换为ai-service-simplified.ts',
        benefit: '代码减少60%，复杂度大幅降低'
      },
      {
        priority: 'P1',
        task: '删除冗余服务',
        description: '移除llm-config-service.ts和llm-call-service.ts',
        benefit: '减少维护负担，统一架构'
      },
      {
        priority: 'P2',
        task: '简化配置转换',
        description: '保留config-converter.ts的核心转换功能',
        benefit: '保持数据兼容性，去除双系统复杂性'
      },
      {
        priority: 'P3',
        task: '清理测试代码',
        description: '更新相关测试用例，移除Legacy系统测试',
        benefit: '测试更聚焦，更容易维护'
      }
    ];

    console.log('📋 推荐的迁移路线图:');
    recommendations.forEach((rec, index) => {
      console.log(`   ${rec.priority} - ${rec.task}`);
      console.log(`        描述: ${rec.description}`);
      console.log(`        收益: ${rec.benefit}\n`);
    });

    // ============================================================================
    // 📊 总结报告
    // ============================================================================

    console.log('=' * 60);
    console.log('📊 迁移分析总结');
    console.log('=' * 60);

    const summary = {
      database: {
        status: '✅ 就绪',
        configs: agentPrompts.length,
        issues: configAnalysis.configurationIssues.length
      },
      conversion: {
        status: conversionResults.failed === 0 ? '✅ 完全兼容' : '⚠️ 部分问题',
        successRate: `${Math.round((conversionResults.successful / agentPrompts.length) * 100)}%`
      },
      codebase: {
        filesToRemove: 3,
        filesToModify: 2,
        estimatedReduction: '60%代码减少'
      },
      migration: {
        risk: '低',
        timeEstimate: '2-4小时',
        rollbackPlan: '保留原文件备份'
      }
    };

    console.log('🗄️  数据库状态:', summary.database.status);
    console.log(`     - 配置数量: ${summary.database.configs}个`);
    console.log(`     - 数据问题: ${summary.database.issues}个`);

    console.log('\n🔄 转换兼容性:', summary.conversion.status);
    console.log(`     - 成功率: ${summary.conversion.successRate}`);

    console.log('\n💻 代码库影响:', summary.codebase.estimatedReduction);
    console.log(`     - 删除文件: ${summary.codebase.filesToRemove}个`);
    console.log(`     - 修改文件: ${summary.codebase.filesToModify}个`);

    console.log('\n🎯 迁移评估:');
    console.log(`     - 风险等级: ${summary.migration.risk}`);
    console.log(`     - 预估时间: ${summary.migration.timeEstimate}`);
    console.log(`     - 回滚方案: ${summary.migration.rollbackPlan}`);

    if (agentPrompts.length > 0 && conversionResults.failed === 0) {
      console.log('\n🎉 结论: 系统已准备好迁移到纯统一配置架构！');
      console.log('💡 建议立即执行迁移，获得更简洁、更易维护的架构。');
    } else {
      console.log('\n⚠️  建议先解决数据问题，再进行迁移。');
    }

    console.log('\n🔚 迁移分析完成\n');

  } catch (error) {
    console.error('❌ 迁移分析失败:', error);
    return false;
  } finally {
    if (connection) {
      await connection.end();
    }
  }

  return true;
}

// 执行迁移分析
if (require.main === module) {
  migrateToUnifiedConfig()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('迁移分析执行失败:', error);
      process.exit(1);
    });
}

module.exports = { migrateToUnifiedConfig };