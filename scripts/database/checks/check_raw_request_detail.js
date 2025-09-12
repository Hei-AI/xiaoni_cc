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

async function checkRawRequestDetail() {
  let connection;
  
  try {
    connection = await mysql.createConnection(dbConfig);
    console.log('✅ 数据库连接成功');
    
    // 检查特定conversation的raw_request字段
    const conversationIds = [
      '4887fad6-865f-4691-8513-4affc959d2fe',
      '900752d6-6b1b-45ba-8a66-b77b591f3b86'
    ];
    
    for (const conversationId of conversationIds) {
      console.log(`\n🔍 检查conversation ${conversationId}:`);
      
      const [convs] = await connection.execute(`
        SELECT id, raw_request,
               raw_request IS NULL as is_null,
               raw_request = '' as is_empty_string,
               LENGTH(raw_request) as length_result,
               CHAR_LENGTH(raw_request) as char_length_result
        FROM conversations 
        WHERE id = ?
      `, [conversationId]);
      
      if (convs.length === 0) {
        console.log('❌ 记录不存在');
        continue;
      }
      
      const conv = convs[0];
      console.log(`   is_null: ${conv.is_null}`);
      console.log(`   is_empty_string: ${conv.is_empty_string}`);
      console.log(`   LENGTH(): ${conv.length_result}`);
      console.log(`   CHAR_LENGTH(): ${conv.char_length_result}`);
      
      if (conv.raw_request !== null) {
        console.log(`   实际类型: ${typeof conv.raw_request}`);
        console.log(`   JavaScript长度: ${conv.raw_request ? conv.raw_request.length : 'N/A'}`);
        console.log(`   内容预览: ${conv.raw_request ? conv.raw_request.substring(0, 100) + '...' : 'NULL'}`);
        
        // 尝试解析JSON
        if (conv.raw_request && conv.raw_request.trim() !== '') {
          try {
            const parsed = JSON.parse(conv.raw_request);
            console.log(`   ✅ JSON解析成功`);
            console.log(`   raw_message: ${parsed.raw_message || 'undefined'}`);
            console.log(`   message_type: ${parsed.message_type || 'undefined'}`);
          } catch (e) {
            console.log(`   ❌ JSON解析失败: ${e.message}`);
          }
        } else {
          console.log(`   ⚠️  raw_request为空字符串或null`);
        }
      } else {
        console.log(`   ❌ raw_request为NULL`);
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

checkRawRequestDetail().catch(console.error);