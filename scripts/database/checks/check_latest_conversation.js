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

async function checkLatestConversation() {
  let connection;
  
  try {
    connection = await mysql.createConnection(dbConfig);
    console.log('✅ 数据库连接成功');
    
    // 获取最新的conversation记录
    console.log('\n🔍 检查最新的conversation记录:');
    const [conversations] = await connection.execute(`
      SELECT id, user_id, user_message, created_at, trace_id,
             LENGTH(raw_request) as raw_request_length,
             raw_request IS NOT NULL as has_raw_request
      FROM conversations 
      WHERE user_id = 999999
      ORDER BY created_at DESC 
      LIMIT 3
    `);
    
    console.log(`📊 找到 ${conversations.length} 条记录:`);
    
    for (const conv of conversations) {
      console.log(`\n📝 Conversation: ${conv.id}`);
      console.log(`   用户消息: ${conv.user_message}`);
      console.log(`   创建时间: ${conv.created_at}`);
      console.log(`   trace_id: ${conv.trace_id || 'NULL'}`);
      console.log(`   has_raw_request: ${conv.has_raw_request ? 'YES' : 'NO'}`);
      console.log(`   raw_request长度: ${conv.raw_request_length || 0} 字符`);
      
      // 获取并解析raw_request内容
      const [fullData] = await connection.execute(
        "SELECT raw_request FROM conversations WHERE id = ?", 
        [conv.id]
      );
      
      if (fullData.length > 0 && fullData[0].raw_request) {
        try {
          const rawRequest = JSON.parse(fullData[0].raw_request);
          console.log(`   ✅ raw_request JSON解析成功:`);
          console.log(`      message: ${rawRequest.message || 'undefined'}`);
          console.log(`      user_id: ${rawRequest.user_id || 'undefined'}`);
          console.log(`      message_id: ${rawRequest.message_id || 'undefined'}`);
          console.log(`      message_type: ${rawRequest.message_type || 'undefined'}`);
          
          // 检查是否包含完整的模拟消息结构
          if (rawRequest.message && rawRequest.user_id && rawRequest.message_id) {
            console.log(`   🎉 raw_request包含完整数据！`);
          } else {
            console.log(`   ⚠️  raw_request数据不完整`);
          }
        } catch (e) {
          console.log(`   ❌ raw_request JSON解析失败: ${e.message}`);
        }
      } else {
        console.log(`   ❌ raw_request为空或NULL`);
      }
    }
    
  } catch (error) {
    console.error('❌ 错误:', error.message);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

checkLatestConversation().catch(console.error);