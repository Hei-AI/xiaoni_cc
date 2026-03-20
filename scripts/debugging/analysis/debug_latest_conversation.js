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

async function debugLatestConversation() {
  let connection;

  try {
    connection = await mysql.createConnection(dbConfig);
    console.log('✅ 数据库连接成功');

    const conversationId = '166c1e09-1c56-496e-a0d5-a503e3c39b9d';

    console.log('\n🔍 检查最新 conversation 的 model_name:');
    const [conversations] = await connection.execute(
      `SELECT id, model_name, status, user_message, ai_response
       FROM conversations
       WHERE id = ?`,
      [conversationId]
    );

    if (conversations.length > 0) {
      const conv = conversations[0];
      console.log('📊 对话记录:');
      console.log(`   ID: ${conv.id}`);
      console.log(`   模型: ${conv.model_name}`);
      console.log(`   用户消息: ${conv.user_message}`);
      console.log(`   AI回复: ${conv.ai_response ? conv.ai_response.substring(0, 100) + '...' : 'NULL'}`);
    } else {
      console.log('⚠️ 没有找到对话记录');
    }

    console.log('\n🔍 检查最新 llm_call_logs 的 model_name:');
    const [logs] = await connection.execute(
      `SELECT id, model_name, agent_type, status, timestamp
       FROM llm_call_logs
       WHERE conversation_id = ?
       ORDER BY timestamp DESC`,
      [conversationId]
    );

    if (logs.length > 0) {
      console.log('📊 找到 LLM 调用记录:');
      logs.forEach((log, idx) => {
        console.log(`   记录 ${idx + 1}: 模型=${log.model_name}, Agent=${log.agent_type}, 状态=${log.status}`);
      });
    } else {
      console.log('⚠️ 没有找到 LLM 调用记录');
    }
  } catch (error) {
    console.error('❌ 错误:', error.message);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

debugLatestConversation().catch(console.error);
