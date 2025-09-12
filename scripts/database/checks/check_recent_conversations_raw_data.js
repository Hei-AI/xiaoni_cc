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

async function checkRecentConversationsRawData() {
  let connection;
  
  try {
    connection = await mysql.createConnection(dbConfig);
    console.log('✅ 数据库连接成功');
    
    // 检查最近的10条conversation记录
    console.log('\n🔍 检查最近的10条conversation记录:');
    const [conversations] = await connection.execute(`
      SELECT id, user_id, created_at, 
             LENGTH(raw_request) as raw_request_length,
             user_message,
             SUBSTRING(ai_response, 1, 50) as ai_response_preview
      FROM conversations 
      ORDER BY created_at DESC 
      LIMIT 10
    `);
    
    console.log(`📊 找到 ${conversations.length} 条记录:`);
    
    conversations.forEach((conv, index) => {
      console.log(`\n${index + 1}. ${conv.id}`);
      console.log(`   用户ID: ${conv.user_id}`);
      console.log(`   时间: ${conv.created_at}`);
      console.log(`   raw_request长度: ${conv.raw_request_length} 字符`);
      console.log(`   用户消息: ${conv.user_message || 'NULL'}`);
      console.log(`   AI回复预览: ${conv.ai_response_preview || 'NULL'}...`);
      
      if (conv.raw_request_length === 0) {
        console.log(`   ⚠️  raw_request为空！`);
      } else {
        console.log(`   ✅ raw_request有数据`);
      }
    });
    
    // 统计raw_request为空的数量
    const [emptyRawRequestCount] = await connection.execute(`
      SELECT COUNT(*) as count 
      FROM conversations 
      WHERE raw_request IS NULL OR raw_request = '' OR LENGTH(raw_request) = 0
    `);
    
    const [totalCount] = await connection.execute(`SELECT COUNT(*) as count FROM conversations`);
    
    console.log(`\n📊 统计结果:`);
    console.log(`   总conversation数: ${totalCount[0].count}`);
    console.log(`   raw_request为空的数量: ${emptyRawRequestCount[0].count}`);
    console.log(`   raw_request为空的比例: ${((emptyRawRequestCount[0].count / totalCount[0].count) * 100).toFixed(1)}%`);
    
  } catch (error) {
    console.error('❌ 错误:', error.message);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

checkRecentConversationsRawData().catch(console.error);