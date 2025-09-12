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
    
    // 检查conversations表中的记录
    console.log('\n🔍 检查conversations表中的原始记录:');
    const [conversations] = await connection.execute(`
      SELECT id, model_name, status, created_at, raw_request, raw_response
      FROM conversations 
      WHERE id = ?
    `, [conversationId]);
    
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
    
    // 检查llm_call_traces表中的记录
    console.log('\n🔍 检查llm_call_traces表中的原始记录:');
    const [traces] = await connection.execute(`
      SELECT id, model_name, engine_type, prompt_tokens, completion_tokens, success, created_at
      FROM llm_call_traces 
      WHERE conversation_id = ?
      ORDER BY created_at DESC
    `, [conversationId]);
    
    if (traces.length > 0) {
      console.log('📊 找到LLM调用记录:');
      traces.forEach((trace, idx) => {
        console.log(`   记录 ${idx + 1}: 模型=${trace.model_name}, 引擎=${trace.engine_type}, 成功=${trace.success ? '是' : '否'}`);
        console.log(`             Token使用: ${trace.prompt_tokens}+${trace.completion_tokens}, 时间=${trace.created_at}`);
      });
    } else {
      console.log('⚠️ 没有找到LLM调用记录');
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