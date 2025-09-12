#!/usr/bin/env node

/**
 * 综合测试脚本 - Token-Model绑定系统验证
 * 测试范围: 数据库连接、Token管理、AI服务、私聊/群聊功能
 */

const axios = require('axios');
const mysql = require('mysql2/promise');

// 测试配置
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
  },
  test_data: {
    private_user_id: 123456789,
    group_id: 987654321,
    test_message: "测试token-model绑定系统是否正常工作"
  }
};

class TokenModelSystemTester {
  constructor() {
    this.db = null;
    this.testResults = [];
  }

  async connect() {
    try {
      this.db = await mysql.createConnection({
        ...config.database,
        charset: 'utf8mb4'
      });
      console.log('✅ 数据库连接成功');
      return true;
    } catch (error) {
      console.error('❌ 数据库连接失败:', error.message);
      return false;
    }
  }

  async testDatabaseSchema() {
    console.log('\n🔍 测试数据库表结构...');
    
    try {
      // 测试新增的字段是否存在
      const tables = [
        { table: 'agent_prompts', columns: ['model_name', 'allowed_token_ids'] },
        { table: 'api_tokens', columns: ['model_blacklist'] }
      ];

      for (const { table, columns } of tables) {
        const [rows] = await this.db.execute(`DESCRIBE ${table}`);
        const existingColumns = rows.map(row => row.Field);
        
        for (const column of columns) {
          if (existingColumns.includes(column)) {
            console.log(`✅ ${table}.${column} 字段存在`);
          } else {
            console.error(`❌ ${table}.${column} 字段缺失`);
            return false;
          }
        }
      }

      // 检查group_chat_settings表
      const [groupSettings] = await this.db.execute(`DESCRIBE group_chat_settings`);
      const groupColumns = groupSettings.map(row => row.Field);
      if (groupColumns.includes('is_enabled') && groupColumns.includes('auto_reply_enabled')) {
        console.log('✅ group_chat_settings 表结构正确');
      } else {
        console.error('❌ group_chat_settings 表结构不完整');
        return false;
      }

      return true;
    } catch (error) {
      console.error('❌ 数据库表结构测试失败:', error.message);
      return false;
    }
  }

  async testTokenModelBinding() {
    console.log('\n🔍 测试Token-Model绑定...');
    
    try {
      // 插入测试数据
      await this.db.execute(`
        INSERT INTO agent_prompts (id, agent_type, prompt_name, model_name, allowed_token_ids, system_instructions, is_active, version, created_by)
        VALUES (UUID(), 'test_bot', 'test_model_binding', 'gemini-2.5-flash', '[1,2,3]', '["测试模型绑定系统指令"]', TRUE, 1, 'test_system')
        ON DUPLICATE KEY UPDATE id = id
      `);

      // 查询验证
      const [prompts] = await this.db.execute(`
        SELECT * FROM agent_prompts 
        WHERE agent_type = 'test_bot' AND prompt_name = 'test_model_binding'
      `);

      if (prompts.length > 0) {
        const prompt = prompts[0];
        console.log(`✅ Agent Prompt创建成功: ${prompt.model_name}, tokens: ${prompt.allowed_token_ids}`);
        
        // 测试Token选择逻辑
        const [tokens] = await this.db.execute(`
          SELECT t.id, t.project_name, t.model_blacklist
          FROM api_tokens t
          JOIN agent_prompts ap ON (
            ap.model_name = ? 
            AND ap.agent_type = ?
            AND ap.prompt_name = ?
            AND (ap.allowed_token_ids IS NULL OR JSON_CONTAINS(ap.allowed_token_ids, CAST(t.id AS JSON)))
          )
          WHERE t.daily_used < t.daily_limit
          LIMIT 3
        `, ['gemini-2.5-flash', 'test_bot', 'test_model_binding']);

        console.log(`✅ 找到 ${tokens.length} 个可用token`);
        return true;
      }

      return false;
    } catch (error) {
      console.error('❌ Token-Model绑定测试失败:', error.message);
      return false;
    }
  }

  async testServiceHealth() {
    console.log('\n🔍 测试服务健康状态...');
    
    const services = Object.entries(config.services);
    let healthyServices = 0;

    for (const [name, url] of services) {
      try {
        const response = await axios.get(`${url}/health`, { timeout: 5000 });
        if (response.status === 200) {
          console.log(`✅ ${name} 服务健康`);
          healthyServices++;
        }
      } catch (error) {
        console.error(`❌ ${name} 服务不可用: ${error.message}`);
      }
    }

    return healthyServices === services.length;
  }

  async testPrivateChatAPI() {
    console.log('\n🔍 测试私聊API...');
    
    try {
      const response = await axios.post(`${config.services.qqbot_core}/api/simulate-private-message`, {
        user_id: config.test_data.private_user_id,
        message: config.test_data.test_message,
        message_type: 'private'
      }, { timeout: 30000 });

      if (response.status === 200 && response.data.success) {
        console.log('✅ 私聊消息处理成功');
        console.log(`   响应: ${response.data.ai_response?.substring(0, 50)}...`);
        
        // 验证数据库记录
        const [conversations] = await this.db.execute(`
          SELECT * FROM conversations 
          WHERE user_id = ? AND user_message = ?
          ORDER BY timestamp DESC LIMIT 1
        `, [config.test_data.private_user_id, config.test_data.test_message]);

        if (conversations.length > 0) {
          console.log('✅ 私聊对话已记录到数据库');
          return true;
        } else {
          console.error('❌ 私聊对话未记录到数据库');
          return false;
        }
      }
      
      return false;
    } catch (error) {
      console.error('❌ 私聊API测试失败:', error.message);
      return false;
    }
  }

  async testGroupChatAPI() {
    console.log('\n🔍 测试群聊API...');
    
    try {
      // 首先确保群聊设置启用
      await this.db.execute(`
        INSERT INTO group_chat_settings (group_id, is_enabled, auto_reply_enabled)
        VALUES (?, TRUE, TRUE)
        ON DUPLICATE KEY UPDATE is_enabled = TRUE, auto_reply_enabled = TRUE
      `, [config.test_data.group_id]);

      const response = await axios.post(`${config.services.qqbot_core}/api/simulate-group-message`, {
        group_id: config.test_data.group_id,
        user_id: config.test_data.private_user_id,
        message: `@机器人 ${config.test_data.test_message}`,
        message_type: 'group'
      }, { timeout: 30000 });

      if (response.status === 200 && response.data.success) {
        console.log('✅ 群聊消息处理成功');
        console.log(`   响应: ${response.data.ai_response?.substring(0, 50)}...`);
        
        // 验证数据库记录
        const [conversations] = await this.db.execute(`
          SELECT * FROM conversations 
          WHERE user_id = ? AND group_id = ? AND user_message LIKE ?
          ORDER BY timestamp DESC LIMIT 1
        `, [config.test_data.private_user_id, config.test_data.group_id, `%${config.test_data.test_message}%`]);

        if (conversations.length > 0) {
          console.log('✅ 群聊对话已记录到数据库');
          return true;
        } else {
          console.error('❌ 群聊对话未记录到数据库');
          return false;
        }
      }
      
      return false;
    } catch (error) {
      console.error('❌ 群聊API测试失败:', error.message);
      return false;
    }
  }

  async testAdminPanelTokenHealth() {
    console.log('\n🔍 测试管理面板Token健康检查...');
    
    try {
      const response = await axios.post(`${config.services.admin_backend}/api/tokens/health-check`, {}, {
        timeout: 60000
      });

      if (response.status === 200 && response.data.success) {
        console.log('✅ Token健康检查成功');
        console.log(`   检查了 ${response.data.checked_count || 0} 个token`);
        console.log(`   健康token: ${response.data.healthy_count || 0} 个`);
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('❌ Token健康检查失败:', error.message);
      return false;
    }
  }

  async testWebSocketLogsConversationsLink() {
    console.log('\n🔍 测试WebSocket日志与对话记录关联...');
    
    try {
      // 检查conversations表是否有trace_id字段
      const [conversationColumns] = await this.db.execute(`DESCRIBE conversations`);
      const hasTraceId = conversationColumns.some(col => col.Field === 'trace_id');
      
      if (!hasTraceId) {
        console.error('❌ conversations表缺少trace_id字段');
        return false;
      }
      
      console.log('✅ conversations表包含trace_id字段');
      
      // 查询有关联的记录
      const [linkedRecords] = await this.db.execute(`
        SELECT 
          c.id as conversation_id,
          c.trace_id,
          c.user_id,
          c.status as conv_status,
          COUNT(w.id) as websocket_events
        FROM conversations c
        LEFT JOIN websocket_logs w ON c.trace_id = w.trace_id
        WHERE c.trace_id IS NOT NULL
        GROUP BY c.id, c.trace_id
        ORDER BY c.timestamp DESC
        LIMIT 5
      `);
      
      if (linkedRecords.length > 0) {
        console.log(`✅ 找到 ${linkedRecords.length} 个关联的对话-WebSocket记录`);
        linkedRecords.forEach(record => {
          console.log(`   对话ID: ${record.conversation_id}, 追踪ID: ${record.trace_id}, WebSocket事件: ${record.websocket_events}`);
        });
        return true;
      } else {
        console.log('⚠️  暂无关联的对话和WebSocket日志记录');
        return true; // 这是正常情况，不算失败
      }
    } catch (error) {
      console.error('❌ WebSocket日志与对话记录关联测试失败:', error.message);
      return false;
    }
  }

  async testTraceAPI() {
    console.log('\n🔍 测试调用链路追踪...');
    
    try {
      // 查询最近的对话记录
      const [conversations] = await this.db.execute(`
        SELECT id, trace_id FROM conversations 
        WHERE trace_id IS NOT NULL 
        ORDER BY timestamp DESC LIMIT 1
      `);

      if (conversations.length === 0) {
        console.error('❌ 没有找到带trace_id的对话记录');
        return false;
      }

      const traceId = conversations[0].trace_id;
      
      // 测试调用链路查询
      const response = await axios.get(`${config.services.admin_backend}/api/traces/${traceId}`, {
        timeout: 10000
      });

      if (response.status === 200 && response.data.success) {
        console.log('✅ 调用链路追踪查询成功');
        console.log(`   追踪ID: ${traceId}`);
        console.log(`   包含 ${response.data.traces?.length || 0} 条记录`);
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('❌ 调用链路追踪测试失败:', error.message);
      return false;
    }
  }

  async runAllTests() {
    console.log('🚀 开始Token-Model绑定系统综合测试\n');
    
    if (!await this.connect()) {
      console.log('\n❌ 测试终止：数据库连接失败');
      return;
    }

    const tests = [
      { name: '数据库表结构', test: () => this.testDatabaseSchema() },
      { name: 'Token-Model绑定', test: () => this.testTokenModelBinding() },
      { name: 'WebSocket-对话记录关联', test: () => this.testWebSocketLogsConversationsLink() },
      { name: '服务健康检查', test: () => this.testServiceHealth() },
      { name: '私聊功能', test: () => this.testPrivateChatAPI() },
      { name: '群聊功能', test: () => this.testGroupChatAPI() },
      { name: 'Token健康检查', test: () => this.testAdminPanelTokenHealth() },
      { name: '调用链路追踪', test: () => this.testTraceAPI() }
    ];

    let passedTests = 0;
    
    for (const { name, test } of tests) {
      try {
        const result = await test();
        if (result) {
          passedTests++;
          this.testResults.push({ name, status: 'PASSED' });
        } else {
          this.testResults.push({ name, status: 'FAILED' });
        }
      } catch (error) {
        console.error(`❌ ${name} 测试异常:`, error.message);
        this.testResults.push({ name, status: 'ERROR', error: error.message });
      }
      
      // 测试间隔
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // 输出测试总结
    console.log('\n' + '='.repeat(60));
    console.log('📊 测试结果总结');
    console.log('='.repeat(60));
    
    this.testResults.forEach(result => {
      const status = result.status === 'PASSED' ? '✅ PASSED' : 
                    result.status === 'FAILED' ? '❌ FAILED' : 
                    '⚠️  ERROR';
      console.log(`${status} ${result.name}`);
      if (result.error) {
        console.log(`   错误: ${result.error}`);
      }
    });

    console.log('='.repeat(60));
    console.log(`总计: ${passedTests}/${tests.length} 测试通过`);
    
    if (passedTests === tests.length) {
      console.log('🎉 所有测试通过！Token-Model绑定系统工作正常');
    } else {
      console.log('⚠️  存在失败的测试，需要修复问题');
    }
  }

  async cleanup() {
    if (this.db) {
      await this.db.end();
      console.log('🔧 数据库连接已关闭');
    }
  }
}

// 运行测试
async function main() {
  const tester = new TokenModelSystemTester();
  
  try {
    await tester.runAllTests();
  } catch (error) {
    console.error('💥 测试过程中发生严重错误:', error);
  } finally {
    await tester.cleanup();
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = TokenModelSystemTester;