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

async function checkTokensFinal() {
  let connection;
  
  try {
    connection = await mysql.createConnection(dbConfig);
    console.log('✅ 数据库连接成功');
    
    // 检查现有tokens
    console.log('\n🔍 检查现有API tokens:');
    const [tokens] = await connection.execute(`
      SELECT id, token, project_name, is_active, is_healthy, model_blacklist, created_at
      FROM api_tokens
      WHERE is_active = TRUE
      ORDER BY id
      LIMIT 5
    `);
    
    if (tokens.length > 0) {
      console.log('📊 找到活跃的API tokens:');
      tokens.forEach(token => {
        console.log(`   Token ID: ${token.id}, 项目: ${token.project_name}, 健康: ${token.is_healthy ? '是' : '否'}, 黑名单: ${token.model_blacklist || 'NULL'}`);
      });
    } else {
      console.log('⚠️ 没有找到活跃的API tokens');
    }
    
    // 检查agent_prompts和allowed_token_ids的关系
    console.log('\n🔍 检查token-model绑定:');
    const [prompts] = await connection.execute(`
      SELECT agent_type, prompt_name, model_name, allowed_token_ids
      FROM agent_prompts 
      WHERE is_active = TRUE AND agent_type = 'chat_bot'
    `);
    
    if (prompts.length > 0) {
      console.log('📊 chat_bot相关的模型配置:');
      prompts.forEach(prompt => {
        console.log(`   ${prompt.agent_type}/${prompt.prompt_name}:`);
        console.log(`     模型: ${prompt.model_name || 'NULL'}`);
        console.log(`     允许的Token IDs: ${prompt.allowed_token_ids || 'NULL'}`);
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

checkTokensFinal().catch(console.error);