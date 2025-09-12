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

async function checkChatBotConfig() {
  let connection;
  
  try {
    connection = await mysql.createConnection(dbConfig);
    console.log('✅ 数据库连接成功');
    
    // 检查chat_bot的默认配置
    console.log('\n🔍 检查chat_bot默认配置:');
    const [chatBot] = await connection.execute(`
      SELECT agent_type, prompt_name, model_name, allowed_token_ids, is_active
      FROM agent_prompts 
      WHERE agent_type = 'chat_bot' AND prompt_name = 'default_chat' AND is_active = TRUE
    `);
    
    if (chatBot.length > 0) {
      console.log('📊 找到chat_bot默认配置:');
      chatBot.forEach(config => {
        console.log(`   模型: ${config.model_name || 'NULL'}`);
        console.log(`   允许的Token IDs: ${config.allowed_token_ids || 'NULL'}`);
      });
    } else {
      console.log('⚠️ 没有找到chat_bot默认配置');
    }
    
    // 检查API tokens配置
    console.log('\n🔍 检查API tokens配置:');
    const [tokens] = await connection.execute(`
      SELECT id, model_name, is_active, model_blacklist
      FROM api_tokens
      WHERE is_active = TRUE
      ORDER BY id
    `);
    
    if (tokens.length > 0) {
      console.log('📊 找到活跃的API tokens:');
      tokens.forEach(token => {
        console.log(`   Token ID: ${token.id}, 模型: ${token.model_name || 'NULL'}, 黑名单: ${token.model_blacklist || 'NULL'}`);
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

checkChatBotConfig().catch(console.error);