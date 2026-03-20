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

async function debugConversationRaw() {
  let connection;

  try {
    connection = await mysql.createConnection(dbConfig);
    console.log('✅ 数据库连接成功');

    const conversationId = '3c15f988-6ff9-4924-ba7c-fbaccf18ef39';

    console.log('\n🔍 检查 conversations 表中的原始记录:');
    const [conversations] = await connection.execute(
      `SELECT id, model_name, status, created_at, raw_request, raw_response
       FROM conversations
       WHERE id = ?`,
      [conversationId]
    );

    if (conversations.length > 0) {
      const conv = conversations[0];
      console.log('📊 对话记录:');
      console.log(`   ID: ${conv.id}`);
      console.log(`   模型: ${conv.model_name}`);
      console.log(`   状态: ${conv.status}`);
      console.log(`   创建时间: ${conv.created_at}`);
      console.log(`   Raw Request长度: ${conv.raw_request ? conv.raw_request.length : 'NULL'} 字符`);
      console.log(`   Raw Response长度: ${conv.raw_response ? conv.raw_response.length : 'NULL'} 字符`);
    } else {
      console.log('⚠️ 没有找到对话记录');
    }

    console.log('\n🔍 检查 llm_call_logs 表中的原始记录:');
    const [logs] = await connection.execute(
      `SELECT id, model_name, agent_type, input_tokens, output_tokens, status, timestamp
       FROM llm_call_logs
       WHERE conversation_id = ?
       ORDER BY timestamp DESC`,
      [conversationId]
    );

    if (logs.length > 0) {
      console.log('📊 找到 LLM 调用记录:');
      logs.forEach((log, idx) => {
        console.log(`   记录 ${idx + 1}: 模型=${log.model_name}, Agent=${log.agent_type}, 状态=${log.status}`);
        console.log(`             Token使用: ${log.input_tokens || 0}+${log.output_tokens || 0}, 时间=${log.timestamp}`);
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

debugConversationRaw().catch(console.error);
