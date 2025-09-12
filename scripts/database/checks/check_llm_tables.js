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

async function checkLLMTables() {
  let connection;
  
  try {
    connection = await mysql.createConnection(dbConfig);
    console.log('✅ 数据库连接成功');
    
    // 检查LLM相关表
    console.log('\n🔍 检查LLM相关表结构:');
    const [tables] = await connection.execute("SHOW TABLES LIKE '%llm%'");
    
    if (tables.length === 0) {
      console.log('❌ 未找到LLM相关表');
      
      // 检查是否有其他可能的表名
      const [allTables] = await connection.execute("SHOW TABLES");
      console.log('\n📋 所有数据库表:');
      allTables.forEach(table => {
        console.log(`   - ${Object.values(table)[0]}`);
      });
    } else {
      console.log('📊 找到以下LLM相关表:');
      tables.forEach(table => {
        console.log(`   - ${Object.values(table)[0]}`);
      });
    }
    
    // 检查conversations表结构（看是否有trace相关字段）
    console.log('\n🔍 检查conversations表结构:');
    const [convStructure] = await connection.execute("DESCRIBE conversations");
    convStructure.forEach(field => {
      if (field.Field.includes('trace') || field.Field.includes('session')) {
        console.log(`   ✅ ${field.Field}: ${field.Type}`);
      }
    });
    
    // 检查是否有sample conversation
    const [sampleConv] = await connection.execute("SELECT id, trace_id, session_id FROM conversations ORDER BY created_at DESC LIMIT 1");
    if (sampleConv.length > 0) {
      console.log('\n📝 样本对话记录:');
      console.log(`   conversation_id: ${sampleConv[0].id}`);
      console.log(`   trace_id: ${sampleConv[0].trace_id || 'NULL'}`);
      console.log(`   session_id: ${sampleConv[0].session_id || 'NULL'}`);
    }
    
  } catch (error) {
    console.error('❌ 错误:', error.message);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

checkLLMTables().catch(console.error);