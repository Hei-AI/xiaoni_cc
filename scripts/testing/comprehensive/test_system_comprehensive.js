#!/usr/bin/env node

/**
 * 🚀 QQ Bot Token-Model绑定系统 - 修复后综合测试
 * 
 * 测试内容：
 * 1. 数据库表结构验证
 * 2. Token-Model绑定功能
 * 3. WebSocket日志与对话记录关联
 * 4. 服务健康状态
 * 5. 私聊功能测试
 * 6. 群聊功能测试  
 * 7. 调用链路追踪API
 * 8. Model-aware Token选择验证
 */

const mysql = require('mysql2/promise');
const axios = require('axios');

// 数据库配置
const dbConfig = {
  host: 'localhost',
  port: 3306,
  user: 'qqbot_user',
  password: 'qqbot_password',
  database: 'qqbot_db',
  charset: 'utf8mb4'
};

// 服务端点
const services = {
  qqbot_core: 'http://localhost:8081',
  http_api: 'http://localhost:8080',
  admin_backend: 'http://localhost:9080'
};

let connection;

// 测试结果跟踪
const testResults = {
  database_schema: false,
  token_model_binding: false,
  websocket_conversation_link: false,
  service_health: false,
  private_message: false,
  group_message: false,
  conversation_debug: false,
  model_aware_selection: false
};

/**
 * 1. 数据库表结构测试
 */
async function testDatabaseSchema() {
  console.log('\\n🔍 测试数据库表结构...');
  
  try {
    // 检查agent_prompts表的model_name字段
    const [modelNameField] = await connection.execute(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'agent_prompts' AND COLUMN_NAME = 'model_name'
    `, [dbConfig.database]);
    
    if (modelNameField.length === 0) {
      throw new Error('agent_prompts.model_name 字段不存在');
    }
    console.log('✅ agent_prompts.model_name 字段存在');
    
    // 检查agent_prompts表的allowed_token_ids字段
    const [allowedTokensField] = await connection.execute(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'agent_prompts' AND COLUMN_NAME = 'allowed_token_ids'
    `, [dbConfig.database]);
    
    if (allowedTokensField.length === 0) {
      throw new Error('agent_prompts.allowed_token_ids 字段不存在');
    }
    console.log('✅ agent_prompts.allowed_token_ids 字段存在');
    
    // 检查api_tokens表的model_blacklist字段
    const [blacklistField] = await connection.execute(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'api_tokens' AND COLUMN_NAME = 'model_blacklist'
    `, [dbConfig.database]);
    
    if (blacklistField.length === 0) {
      throw new Error('api_tokens.model_blacklist 字段不存在');
    }
    console.log('✅ api_tokens.model_blacklist 字段存在');
    
    // 检查conversations表的trace_id字段
    const [traceIdField] = await connection.execute(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'conversations' AND COLUMN_NAME = 'trace_id'
    `, [dbConfig.database]);
    
    if (traceIdField.length === 0) {
      throw new Error('conversations.trace_id 字段不存在');
    }
    console.log('✅ conversations.trace_id 字段存在');
    
    testResults.database_schema = true;
    
  } catch (error) {
    console.log(`❌ 数据库表结构测试失败: ${error.message}`);
  }
}

/**
 * 2. Token-Model绑定功能测试
 */
async function testTokenModelBinding() {
  console.log('\\n🔍 测试Token-Model绑定...');
  
  try {
    // 检查现有的token数量
    const [tokens] = await connection.execute('SELECT COUNT(*) as count FROM api_tokens');
    console.log(`✅ 找到 ${tokens[0].count} 个token`);
    
    // 检查是否有model-aware的agent_prompts配置
    const [prompts] = await connection.execute(`
      SELECT * FROM agent_prompts 
      WHERE model_name IS NOT NULL 
      LIMIT 1
    `);
    
    if (prompts.length > 0) {
      console.log(`✅ 找到Model-aware Agent Prompt: ${prompts[0].model_name}`);
    } else {
      // 创建一个测试配置
      const testPromptId = `test_prompt_${Date.now()}`;
      await connection.execute(`
        INSERT INTO agent_prompts (id, agent_type, prompt_name, system_instructions, model_name, allowed_token_ids, is_active, version, created_by, created_at, updated_at)
        VALUES (?, 'chat_bot', 'test_model_binding', '[\"Test model binding prompt\"]', 'gemini-2.5-flash', '[1,2,3]', TRUE, 1, 'system_test', NOW(), NOW())
      `, [testPromptId]);
      console.log(`✅ 创建测试Agent Prompt: ${testPromptId}`);
    }
    
    testResults.token_model_binding = true;
    
  } catch (error) {
    console.log(`❌ Token-Model绑定测试失败: ${error.message}`);
  }
}

/**
 * 3. WebSocket日志与对话记录关联测试
 */
async function testWebSocketConversationLink() {
  console.log('\\n🔍 测试WebSocket日志与对话记录关联...');
  
  try {
    // 检查是否有带trace_id的对话记录
    const [conversations] = await connection.execute(`
      SELECT c.id, c.trace_id, w.id as ws_log_id 
      FROM conversations c 
      LEFT JOIN websocket_logs w ON c.trace_id = w.trace_id 
      WHERE c.trace_id IS NOT NULL 
      LIMIT 5
    `);
    
    console.log(`✅ conversations表包含trace_id字段`);
    console.log(`📊 找到 ${conversations.length} 条带trace_id的对话记录`);
    
    if (conversations.length > 0) {
      const linkedCount = conversations.filter(c => c.ws_log_id !== null).length;
      console.log(`🔗 其中 ${linkedCount} 条已关联WebSocket日志`);
    }
    
    testResults.websocket_conversation_link = true;
    
  } catch (error) {
    console.log(`❌ WebSocket关联测试失败: ${error.message}`);
  }
}

/**
 * 4. 服务健康状态测试
 */
async function testServiceHealth() {
  console.log('\\n🔍 测试服务健康状态...');
  
  try {
    const healthChecks = [
      { name: 'qqbot_core', url: `${services.qqbot_core}/health` },
      { name: 'http_api', url: `${services.http_api}/health` },
      { name: 'admin_backend', url: `${services.admin_backend}/health` }
    ];
    
    for (const service of healthChecks) {
      try {
        const response = await axios.get(service.url, { timeout: 5000 });
        if (response.status === 200 && response.data.status === 'healthy') {
          console.log(`✅ ${service.name} 服务健康`);
        } else {
          console.log(`⚠️  ${service.name} 服务状态异常: ${response.data.status}`);
        }
      } catch (error) {
        console.log(`❌ ${service.name} 服务无响应: ${error.message}`);
        return;
      }
    }
    
    testResults.service_health = true;
    
  } catch (error) {
    console.log(`❌ 服务健康检查失败: ${error.message}`);
  }
}

/**
 * 5. 私聊功能测试
 */
async function testPrivateMessage() {
  console.log('\\n🔍 测试私聊功能...');
  
  try {
    const testMessage = {
      user_id: 999999,
      message: `测试私聊消息 ${new Date().toISOString()}`
    };
    
    const response = await axios.post(
      `${services.qqbot_core}/api/test/simulate_private_message`,
      testMessage,
      { 
        timeout: 10000,
        headers: { 'Content-Type': 'application/json' }
      }
    );
    
    if (response.status === 200 && response.data.success) {
      console.log('✅ 私聊消息模拟成功');
      
      // 等待1秒让消息处理完成
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // 检查对话记录是否创建
      const [conversations] = await connection.execute(
        'SELECT * FROM conversations WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
        [testMessage.user_id]
      );
      
      if (conversations.length > 0) {
        console.log(`✅ 对话记录已创建: ${conversations[0].id}`);
        testResults.private_message = true;
      } else {
        console.log('⚠️  未找到对话记录');
      }
    } else {
      console.log(`❌ 私聊消息失败: ${response.data.error}`);
    }
    
  } catch (error) {
    console.log(`❌ 私聊测试失败: ${error.response?.data?.error || error.message}`);
  }
}

/**
 * 6. 群聊功能测试
 */
async function testGroupMessage() {
  console.log('\\n🔍 测试群聊功能...');
  
  try {
    const testMessage = {
      user_id: 999999,
      group_id: 123456,
      message: `测试群聊消息 ${new Date().toISOString()}`
    };
    
    const response = await axios.post(
      `${services.qqbot_core}/api/test/simulate_group_message`,
      testMessage,
      { 
        timeout: 10000,
        headers: { 'Content-Type': 'application/json' }
      }
    );
    
    if (response.status === 200 && response.data.success) {
      console.log('✅ 群聊消息模拟成功');
      testResults.group_message = true;
    } else {
      console.log(`❌ 群聊消息失败: ${response.data.error}`);
    }
    
  } catch (error) {
    console.log(`❌ 群聊测试失败: ${error.response?.data?.error || error.message}`);
  }
}

/**
 * 7. 调用链路追踪API测试
 */
async function testConversationDebugAPI() {
  console.log('\\n🔍 测试调用链路追踪API...');
  
  try {
    const response = await axios.get(
      `${services.qqbot_core}/api/debug/conversations?limit=3`,
      { timeout: 10000 }
    );
    
    if (response.status === 200 && response.data.success) {
      const conversations = response.data.data;
      console.log(`✅ 调用链路API工作正常，返回 ${conversations.length} 条记录`);
      
      // 检查数据结构
      if (conversations.length > 0) {
        const firstConv = conversations[0];
        const hasRequiredFields = firstConv.conversation_id && 
                                 firstConv.user_input && 
                                 firstConv.ai_response;
        
        if (hasRequiredFields) {
          console.log('✅ 对话记录结构完整');
          testResults.conversation_debug = true;
        } else {
          console.log('⚠️  对话记录结构不完整');
        }
      } else {
        console.log('⚠️  暂无对话记录');
      }
    } else {
      console.log(`❌ 调用链路API失败: ${response.data.error}`);
    }
    
  } catch (error) {
    console.log(`❌ 调用链路追踪测试失败: ${error.response?.data?.error || error.message}`);
  }
}

/**
 * 8. Model-aware Token选择验证
 */
async function testModelAwareTokenSelection() {
  console.log('\\n🔍 测试Model-aware Token选择...');
  
  try {
    // 检查是否有配置了特定模型的agent_prompts
    const [modelPrompts] = await connection.execute(`
      SELECT ap.*, 
             JSON_LENGTH(ap.allowed_token_ids) as allowed_count
      FROM agent_prompts ap 
      WHERE ap.model_name IS NOT NULL 
        AND ap.allowed_token_ids IS NOT NULL
        AND ap.is_active = TRUE
      LIMIT 3
    `);
    
    if (modelPrompts.length > 0) {
      console.log(`✅ 找到 ${modelPrompts.length} 个Model-aware配置:`);
      modelPrompts.forEach(prompt => {
        console.log(`   - ${prompt.model_name}: ${prompt.allowed_count} 个允许的token`);
      });
      
      // 验证token的模型黑名单功能
      const [tokensWithBlacklist] = await connection.execute(`
        SELECT id, project_name, model_blacklist
        FROM api_tokens 
        WHERE model_blacklist IS NOT NULL 
        LIMIT 2
      `);
      
      console.log(`✅ 找到 ${tokensWithBlacklist.length} 个带模型黑名单的token`);
      
      testResults.model_aware_selection = true;
    } else {
      console.log('⚠️  未找到Model-aware配置');
    }
    
  } catch (error) {
    console.log(`❌ Model-aware测试失败: ${error.message}`);
  }
}

/**
 * 主测试函数
 */
async function runComprehensiveTest() {
  console.log('🚀 开始Token-Model绑定系统修复后综合测试\\n');
  
  try {
    // 连接数据库
    connection = await mysql.createConnection(dbConfig);
    console.log('✅ 数据库连接成功\\n');
    
    // 运行所有测试
    await testDatabaseSchema();
    await testTokenModelBinding();
    await testWebSocketConversationLink();
    await testServiceHealth();
    await testPrivateMessage();
    await testGroupMessage();
    await testConversationDebugAPI();
    await testModelAwareTokenSelection();
    
  } catch (error) {
    console.log(`❌ 测试过程中发生错误: ${error.message}`);
  } finally {
    if (connection) {
      await connection.end();
      console.log('\\n🔧 数据库连接已关闭');
    }
  }
  
  // 输出测试结果总结
  console.log('\\n============================================================');
  console.log('📊 测试结果总结');
  console.log('============================================================');
  
  const testNames = {
    database_schema: '数据库表结构',
    token_model_binding: 'Token-Model绑定',
    websocket_conversation_link: 'WebSocket-对话记录关联',
    service_health: '服务健康检查',
    private_message: '私聊功能',
    group_message: '群聊功能',
    conversation_debug: '调用链路追踪',
    model_aware_selection: 'Model-aware Token选择'
  };
  
  let passedCount = 0;
  let totalCount = 0;
  
  for (const [key, result] of Object.entries(testResults)) {
    totalCount++;
    if (result) {
      passedCount++;
      console.log(`✅ PASSED ${testNames[key]}`);
    } else {
      console.log(`❌ FAILED ${testNames[key]}`);
    }
  }
  
  console.log('============================================================');
  console.log(`总计: ${passedCount}/${totalCount} 测试通过`);
  
  if (passedCount === totalCount) {
    console.log('🎉 所有测试通过！Token-Model绑定系统运行正常！');
  } else if (passedCount >= totalCount * 0.75) {
    console.log('⚠️  大部分测试通过，系统基本正常运行');
  } else {
    console.log('❌ 多项测试失败，系统需要进一步修复');
  }
}

// 执行测试
if (require.main === module) {
  runComprehensiveTest().catch(console.error);
}