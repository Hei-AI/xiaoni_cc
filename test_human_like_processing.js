#!/usr/bin/env node

/**
 * 🧠 事件分离式人类化消息处理系统 - 专项测试脚本
 *
 * 职责: 全面验证人类化消息处理系统的实现状态和功能完整性
 * 覆盖: 数据库结构、服务组件、环境配置、功能验证
 */

const mysql = require('mysql2/promise');
const axios = require('axios');

// 配置信息
const config = {
  database: {
    host: 'localhost',
    port: 3306,
    user: 'qqbot_user',
    password: 'qqbot_password',
    database: 'qqbot_db'
  },
  services: {
    qqbot_core: 'http://localhost:8081',
    http_api: 'http://localhost:8080',
    admin_backend: 'http://localhost:9080'
  }
};

let connection;

async function connectDatabase() {
  try {
    connection = await mysql.createConnection(config.database);
    console.log('✅ 数据库连接成功');
    return true;
  } catch (error) {
    console.error('❌ 数据库连接失败:', error.message);
    return false;
  }
}

async function testDatabaseStructure() {
  console.log('\n🔍 测试人类化处理数据库结构...');

  try {
    // 1. 检查人类化处理核心表
    const requiredTables = [
      'message_arrivals',
      'message_consumptions',
      'aggregation_windows',
      'life_rhythm_logs'
    ];

    const [tables] = await connection.execute(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = ? AND table_name IN (${requiredTables.map(() => '?').join(',')})
    `, [config.database.database, ...requiredTables]);

    if (tables.length === requiredTables.length) {
      console.log('✅ 人类化处理核心表完整:', tables.map(t => t.table_name).join(', '));
    } else {
      console.log('❌ 缺少人类化处理表:', requiredTables.filter(t => !tables.find(row => row.table_name === t)));
      return false;
    }

    // 2. 检查conversations表扩展字段
    const [aggColumns] = await connection.execute(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = ? AND table_name = 'conversations'
      AND column_name IN ('is_aggregated', 'batch_size', 'aggregation_window_id', 'trigger_reason')
    `, [config.database.database]);

    if (aggColumns.length === 4) {
      console.log('✅ conversations表聚合字段完整:', aggColumns.map(c => c.column_name).join(', '));
    } else {
      console.log('❌ conversations表缺少聚合字段:', ['is_aggregated', 'batch_size', 'aggregation_window_id', 'trigger_reason'].filter(c => !aggColumns.find(row => row.column_name === c)));
      return false;
    }

    // 3. 检查数据库视图
    const [views] = await connection.execute(`
      SELECT table_name FROM information_schema.views
      WHERE table_schema = ? AND table_name IN ('human_like_processing_stats', 'source_processing_stats', 'hourly_activity_stats')
    `, [config.database.database]);

    if (views.length >= 1) {
      console.log('✅ 人类化处理视图存在:', views.map(v => v.table_name).join(', '));
    } else {
      console.log('⚠️  未找到人类化处理视图 (可选功能)');
    }

    // 4. 检查存储过程
    const [procedures] = await connection.execute(`
      SELECT routine_name FROM information_schema.routines
      WHERE routine_schema = ? AND routine_name = 'CleanOldHumanLikeData'
    `, [config.database.database]);

    if (procedures.length > 0) {
      console.log('✅ 数据清理存储过程存在: CleanOldHumanLikeData');
    } else {
      console.log('⚠️  未找到数据清理存储过程 (可选功能)');
    }

    return true;

  } catch (error) {
    console.error('❌ 数据库结构测试失败:', error.message);
    return false;
  }
}

async function testServiceHealth() {
  console.log('\n🔍 测试服务健康状态...');

  const healthResults = {};

  for (const [serviceName, serviceUrl] of Object.entries(config.services)) {
    try {
      const response = await axios.get(`${serviceUrl}/health`, { timeout: 5000 });
      if (response.status === 200 && response.data.status === 'healthy') {
        console.log(`✅ ${serviceName} 服务健康`);
        healthResults[serviceName] = true;
      } else {
        console.log(`❌ ${serviceName} 服务状态异常:`, response.data);
        healthResults[serviceName] = false;
      }
    } catch (error) {
      console.log(`❌ ${serviceName} 服务连接失败:`, error.message);
      healthResults[serviceName] = false;
    }
  }

  return Object.values(healthResults).every(result => result);
}

async function testHumanLikeConfiguration() {
  console.log('\n🔍 测试人类化处理配置状态...');

  try {
    // 检查QQBot Core的配置状态
    const response = await axios.get(`${config.services.qqbot_core}/debug/config`, { timeout: 5000 });

    if (response.data && response.data.humanLikeProcessing) {
      const humanConfig = response.data.humanLikeProcessing;
      console.log('✅ 人类化处理配置已加载:');
      console.log(`  - 启用状态: ${humanConfig.enabled ? '✅ 启用' : '❌ 禁用'}`);
      console.log(`  - 聚合窗口: ${humanConfig.aggregation?.aggregationWindowMs || 'N/A'}ms`);
      console.log(`  - 队列大小限制: ${humanConfig.aggregation?.maxQueueSize || 'N/A'}`);
      console.log(`  - 生活节奏: ${humanConfig.lifeRhythm?.enabled ? '✅ 启用' : '❌ 禁用'}`);

      return humanConfig.enabled === true;
    } else {
      console.log('❌ 未找到人类化处理配置');
      return false;
    }

  } catch (error) {
    console.log('⚠️  无法获取配置信息 (可能service不支持此接口):', error.message);
    return false;
  }
}

async function testHumanLikeComponents() {
  console.log('\n🔍 测试人类化处理组件状态...');

  try {
    // 尝试获取人类化处理器状态
    const response = await axios.get(`${config.services.qqbot_core}/debug/human-like-status`, { timeout: 5000 });

    if (response.data) {
      const status = response.data;
      console.log('✅ 人类化处理器状态:');
      console.log(`  - 运行状态: ${status.isRunning ? '✅ 运行中' : '❌ 未运行'}`);
      console.log(`  - 初始化状态: ${status.isInitialized ? '✅ 已初始化' : '❌ 未初始化'}`);
      console.log(`  - 活跃队列: ${status.activeQueues || 0} 个`);
      console.log(`  - 排队消息: ${status.totalQueuedMessages || 0} 条`);
      console.log(`  - 活跃聚合窗口: ${status.activeWindows?.length || 0} 个`);

      return status.isRunning && status.isInitialized;
    } else {
      console.log('❌ 无法获取人类化处理器状态');
      return false;
    }

  } catch (error) {
    console.log('⚠️  无法获取组件状态 (可能service不支持此接口):', error.message);
    return false;
  }
}

async function testHumanLikeStatistics() {
  console.log('\n🔍 测试人类化处理统计功能...');

  try {
    // 查询统计视图
    const [stats] = await connection.execute('SELECT * FROM human_like_processing_stats');

    if (stats.length > 0) {
      const stat = stats[0];
      console.log('✅ 人类化处理统计数据:');
      console.log(`  - 到达消息总数: ${stat.total_messages_arrived}`);
      console.log(`  - 处理批次总数: ${stat.total_batches_processed}`);
      console.log(`  - 平均批次大小: ${stat.average_batch_size}`);
      console.log(`  - 创建窗口总数: ${stat.total_windows_created}`);
      console.log(`  - 节奏检查总数: ${stat.total_rhythm_checks}`);
      console.log(`  - 节奏检查执行: ${stat.rhythm_checks_performed}`);

      return true;
    } else {
      console.log('✅ 统计视图可用 (暂无数据，系统尚未处理人类化消息)');
      return true;
    }

  } catch (error) {
    console.error('❌ 统计功能测试失败:', error.message);
    return false;
  }
}

async function testMessageArrivalAPI() {
  console.log('\n🔍 测试消息到达API模拟...');

  try {
    // 模拟发送测试消息到人类化处理系统
    const testMessage = {
      user_id: 85178516,
      message: '🧠 人类化处理系统测试消息',
      message_type: 'private',
      time: Math.floor(Date.now() / 1000),
      message_id: Date.now(),
      sender: {
        user_id: 85178516,
        nickname: 'Test User'
      }
    };

    // 尝试触发人类化处理
    const response = await axios.post(`${config.services.qqbot_core}/debug/trigger-human-like`, testMessage, {
      timeout: 5000,
      headers: { 'Content-Type': 'application/json' }
    });

    if (response.status === 200) {
      console.log('✅ 人类化消息处理触发成功');

      // 等待一段时间后检查数据库变化
      await new Promise(resolve => setTimeout(resolve, 2000));

      const [arrivals] = await connection.execute(
        'SELECT COUNT(*) as count FROM message_arrivals WHERE user_id = ?',
        [testMessage.user_id]
      );

      if (arrivals[0].count > 0) {
        console.log(`✅ 消息到达记录已创建: ${arrivals[0].count} 条`);
        return true;
      } else {
        console.log('⚠️  消息到达记录未找到 (可能处理过快或配置问题)');
        return false;
      }
    } else {
      console.log('❌ 人类化消息处理触发失败');
      return false;
    }

  } catch (error) {
    console.log('⚠️  消息到达API测试失败 (可能service不支持此接口):', error.message);
    return false;
  }
}

async function generateTestReport() {
  console.log('\n📊 生成测试报告...');

  const testResults = [];

  // 执行所有测试
  testResults.push(['数据库结构', await testDatabaseStructure()]);
  testResults.push(['服务健康状态', await testServiceHealth()]);
  testResults.push(['人类化处理配置', await testHumanLikeConfiguration()]);
  testResults.push(['处理组件状态', await testHumanLikeComponents()]);
  testResults.push(['统计功能', await testHumanLikeStatistics()]);
  testResults.push(['消息到达API', await testMessageArrivalAPI()]);

  // 统计结果
  const passedTests = testResults.filter(([_, passed]) => passed).length;
  const totalTests = testResults.length;

  console.log('\n============================================================');
  console.log('📋 人类化消息处理系统测试报告');
  console.log('============================================================');

  testResults.forEach(([testName, passed]) => {
    console.log(`${passed ? '✅' : '❌'} ${testName}`);
  });

  console.log('============================================================');
  console.log(`📊 测试结果: ${passedTests}/${totalTests} 通过`);

  if (passedTests === totalTests) {
    console.log('🎉 所有测试通过！人类化消息处理系统完全可用！');
  } else if (passedTests >= totalTests * 0.7) {
    console.log('⚠️  大部分测试通过，系统基本可用，建议检查失败项目');
  } else {
    console.log('❌ 多项测试失败，系统可能未正确部署或配置');
  }

  console.log('============================================================');

  // 提供部署建议
  const failedTests = testResults.filter(([_, passed]) => !passed);
  if (failedTests.length > 0) {
    console.log('\n🔧 故障排除建议:');

    failedTests.forEach(([testName, _]) => {
      switch (testName) {
        case '数据库结构':
          console.log('- 运行数据库迁移: mysql -u qqbot_user -p qqbot_db < database/migrations/004_create_human_like_processing_tables.sql');
          break;
        case '服务健康状态':
          console.log('- 检查Docker容器状态: docker ps | grep qqbot');
          console.log('- 重启相关服务: docker compose restart provider-service admin-backend');
          break;
        case '人类化处理配置':
          console.log('- 检查环境变量: ENABLE_HUMAN_LIKE_PROCESSING=true');
          console.log('- 更新容器配置并重启服务');
          break;
        case '处理组件状态':
          console.log('- 检查人类化处理器初始化日志');
          console.log('- 确保所有组件正确加载');
          break;
        case '消息到达API':
          console.log('- 检查API端点是否正确实现');
          console.log('- 验证WebSocket连接状态');
          break;
      }
    });
  }

  return passedTests === totalTests;
}

async function main() {
  console.log('🚀 开始人类化消息处理系统专项测试\n');

  // 连接数据库
  if (!await connectDatabase()) {
    console.log('❌ 数据库连接失败，无法继续测试');
    process.exit(1);
  }

  try {
    // 生成完整测试报告
    const allTestsPassed = await generateTestReport();

    console.log('\n🔧 数据库连接已关闭');
    process.exit(allTestsPassed ? 0 : 1);

  } catch (error) {
    console.error('❌ 测试执行过程中发生错误:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// 执行测试
if (require.main === module) {
  main();
}

module.exports = {
  testDatabaseStructure,
  testServiceHealth,
  testHumanLikeConfiguration,
  testHumanLikeComponents,
  testHumanLikeStatistics,
  testMessageArrivalAPI
};
