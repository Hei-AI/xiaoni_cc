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

async function testSpecificConversation() {
  let connection;
  
  try {
    connection = await mysql.createConnection(dbConfig);
    console.log('✅ 数据库连接成功');
    
    const conversationId = '900752d6-6b1b-45ba-8a66-b77b591f3b86';
    
    // 检查这个特定conversation是否存在
    console.log(`\n🔍 检查conversation ${conversationId}:`);
    const [convs] = await connection.execute("SELECT * FROM conversations WHERE id = ?", [conversationId]);
    
    if (convs.length === 0) {
      console.log('❌ Conversation不存在');
      
      // 查看实际存在的conversation
      const [actualConvs] = await connection.execute("SELECT id, user_id, created_at FROM conversations ORDER BY created_at DESC LIMIT 5");
      console.log('\n📋 实际存在的conversations:');
      actualConvs.forEach((conv, i) => {
        console.log(`   ${i + 1}. ${conv.id} (用户: ${conv.user_id}, 时间: ${conv.created_at})`);
      });
    } else {
      console.log('✅ Conversation存在');
      const conv = convs[0];
      console.log(`   用户ID: ${conv.user_id}`);
      console.log(`   创建时间: ${conv.created_at}`);
      console.log(`   trace_id: ${conv.trace_id || 'NULL'}`);
      console.log(`   session_id: ${conv.session_id || 'NULL'}`);
    }
    
    // 查找对应的LLM traces
    console.log(`\n🔍 检查LLM traces for conversation ${conversationId}:`);
    const [traces] = await connection.execute("SELECT * FROM llm_call_traces WHERE conversation_id = ? ORDER BY call_sequence ASC", [conversationId]);
    
    console.log(`📊 找到 ${traces.length} 条LLM trace记录`);
    traces.forEach((trace, i) => {
      console.log(`   ${i + 1}. 序列: ${trace.call_sequence}, 引擎: ${trace.engine_type}, 模型: ${trace.model_name}`);
      console.log(`      时间: ${trace.timestamp}, 成功: ${trace.success}`);
      console.log(`      Token使用: prompt=${trace.prompt_tokens}, completion=${trace.completion_tokens}, total=${trace.total_tokens}`);
    });
    
  } catch (error) {
    console.error('❌ 错误:', error.message);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

testSpecificConversation().catch(console.error);