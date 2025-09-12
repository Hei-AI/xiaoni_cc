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

async function checkTraceIdConversations() {
  let connection;
  
  try {
    connection = await mysql.createConnection(dbConfig);
    console.log('✅ 数据库连接成功');
    
    // 检查有trace_id的conversation记录
    console.log('\n🔍 检查有trace_id的conversation记录:');
    const [tracedConvs] = await connection.execute(`
      SELECT id, user_id, user_message, created_at, trace_id,
             LENGTH(raw_request) as raw_request_length,
             raw_request IS NOT NULL as has_raw_request
      FROM conversations 
      WHERE trace_id IS NOT NULL 
      ORDER BY created_at DESC 
      LIMIT 5
    `);
    
    console.log(`📊 找到 ${tracedConvs.length} 条有trace_id的记录:`);
    
    if (tracedConvs.length === 0) {
      console.log('⚠️  没有找到有trace_id的记录');
      
      // 检查最新的10条记录，看看是否有任何更新
      console.log('\n🔍 检查最新的10条记录:');
      const [latestConvs] = await connection.execute(`
        SELECT id, user_id, user_message, created_at, trace_id,
               LENGTH(raw_request) as raw_request_length,
               status, model_name
        FROM conversations 
        ORDER BY created_at DESC 
        LIMIT 10
      `);
      
      latestConvs.forEach((conv, index) => {
        console.log(`${index + 1}. ${conv.id}`);
        console.log(`   用户消息: ${conv.user_message || 'NULL'}`);
        console.log(`   时间: ${conv.created_at}`);
        console.log(`   trace_id: ${conv.trace_id || 'NULL'}`);
        console.log(`   raw_request长度: ${conv.raw_request_length || 0}`);
        console.log(`   状态: ${conv.status || 'NULL'}`);
        console.log(`   模型: ${conv.model_name || 'NULL'}`);
        console.log('');
      });
    } else {
      tracedConvs.forEach((conv, index) => {
        console.log(`\n${index + 1}. ${conv.id}`);
        console.log(`   用户消息: ${conv.user_message}`);
        console.log(`   时间: ${conv.created_at}`);
        console.log(`   trace_id: ${conv.trace_id}`);
        console.log(`   raw_request长度: ${conv.raw_request_length || 0}`);
        console.log(`   has_raw_request: ${conv.has_raw_request ? 'YES' : 'NO'}`);
      });
    }
    
  } catch (error) {
    console.error('❌ 错误:', error.message);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

checkTraceIdConversations().catch(console.error);