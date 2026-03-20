#!/usr/bin/env node

const mysql = require('mysql2/promise');

const dbConfig = {
  host: 'localhost',
  port: 3306,
  user: 'qqbot_user',
  password: 'qqbot_password',
  database: 'qqbot_db',
  charset: 'utf8mb4'
};

async function checkModelConfig() {
  let connection;

  try {
    connection = await mysql.createConnection(dbConfig);
    console.log('✅ 数据库连接成功');

    console.log('\n🔍 检查 agent_prompts 表中的模型配置:');
    const [prompts] = await connection.execute(`
      SELECT agent_type, prompt_name, model_name, is_active, created_at
      FROM agent_prompts
      WHERE is_active = TRUE
      ORDER BY agent_type, prompt_name
    `);

    console.log(`📊 找到 ${prompts.length} 个活跃的 agent prompt 配置:`);
    prompts.forEach((prompt) => {
      console.log(`   ${prompt.agent_type}/${prompt.prompt_name}: ${prompt.model_name || 'NULL'}`);
    });

    console.log('\n🔍 检查最近 conversation 中使用的模型:');
    const [recentConversations] = await connection.execute(`
      SELECT model_name, COUNT(*) AS count
      FROM conversations
      WHERE model_name IS NOT NULL
        AND created_at >= DATE_SUB(NOW(), INTERVAL 2 HOUR)
      GROUP BY model_name
      ORDER BY count DESC
    `);

    if (recentConversations.length > 0) {
      console.log('📊 最近 2 小时使用的模型:');
      recentConversations.forEach((conversation) => {
        console.log(`   ${conversation.model_name}: ${conversation.count} 次`);
      });
    } else {
      console.log('⚠️ 最近 2 小时没有使用模型的对话记录');
    }

    console.log('\n🔍 检查 llm_call_logs 表中的模型使用:');
    const [llmLogs] = await connection.execute(`
      SELECT model_name, COUNT(*) AS count
      FROM llm_call_logs
      WHERE timestamp >= DATE_SUB(NOW(), INTERVAL 2 HOUR)
      GROUP BY model_name
      ORDER BY count DESC
    `);

    if (llmLogs.length > 0) {
      console.log('📊 最近 2 小时 llm_call_logs 中的模型:');
      llmLogs.forEach((log) => {
        console.log(`   ${log.model_name}: ${log.count} 次`);
      });
    } else {
      console.log('⚠️ 最近 2 小时没有 llm_call_logs 记录');
    }
  } catch (error) {
    console.error('❌ 错误:', error.message);
    process.exitCode = 1;
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

checkModelConfig().catch(console.error);
