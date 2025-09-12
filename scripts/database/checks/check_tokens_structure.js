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

async function checkTokensStructure() {
  let connection;
  
  try {
    connection = await mysql.createConnection(dbConfig);
    console.log('✅ 数据库连接成功');
    
    // 检查api_tokens表结构
    console.log('\n🔍 检查api_tokens表结构:');
    const [columns] = await connection.execute(`DESCRIBE api_tokens`);
    
    console.log('📊 api_tokens表字段:');
    columns.forEach(col => {
      console.log(`   ${col.Field}: ${col.Type} (${col.Null === 'YES' ? '可空' : '不可空'})`);
    });
    
    // 检查现有tokens
    console.log('\n🔍 检查现有API tokens:');
    const [tokens] = await connection.execute(`
      SELECT id, api_key, is_active, status, model_blacklist, created_at
      FROM api_tokens
      WHERE is_active = TRUE
      ORDER BY id
      LIMIT 5
    `);
    
    if (tokens.length > 0) {
      console.log('📊 找到活跃的API tokens:');
      tokens.forEach(token => {
        console.log(`   Token ID: ${token.id}, 状态: ${token.status}, 黑名单: ${token.model_blacklist || 'NULL'}`);
      });
    } else {
      console.log('⚠️ 没有找到活跃的API tokens');
    }
    
  } catch (error) {
    console.error('❌ 错误:', error.message);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

checkTokensStructure().catch(console.error);