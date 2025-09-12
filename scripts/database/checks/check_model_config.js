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

async function checkModelConfig() {
  let connection;
  
  try {
    connection = await mysql.createConnection(dbConfig);
    console.log('✅ 数据库连接成功');
    
    // 检查agent_prompts表中的模型配置
    console.log('\n🔍 检查agent_prompts表中的模型配置:');
    const [prompts] = await connection.execute(`
      SELECT agent_type, prompt_name, model_name, is_active, created_at
      FROM agent_prompts 
      WHERE is_active = TRUE
      ORDER BY agent_type, prompt_name
    `);
    
    console.log(`📊 找到 ${prompts.length} 个活跃的agent prompt配置:`);
    prompts.forEach(prompt => {
      console.log(`   ${prompt.agent_type}/${prompt.prompt_name}: ${prompt.model_name || 'NULL'}`);
    });
    
    // 检查系统配置文件中的默认模型
    console.log('\n🔍 检查最近conversation中使用的模型:');
    const [recentConvs] = await connection.execute(`
      SELECT model_name, COUNT(*) as count
      FROM conversations 
      WHERE model_name IS NOT NULL
        AND created_at >= DATE_SUB(NOW(), INTERVAL 2 HOUR)
      GROUP BY model_name
      ORDER BY count DESC
    `);
    
    if (recentConvs.length > 0) {
      console.log('📊 最近2小时使用的模型:');
      recentConvs.forEach(conv => {
        console.log(`   ${conv.model_name}: ${conv.count} 次`);
      });
    } else {
      console.log('⚠️  最近2小时没有使用模型的对话记录');
    }
    
    // 检查LLM traces中的模型
    console.log('\n🔍 检查llm_call_traces表中的模型使用:');
    const [traces] = await connection.execute(`
      SELECT model_name, COUNT(*) as count
      FROM llm_call_traces 
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 2 HOUR)
      GROUP BY model_name
      ORDER BY count DESC
    `);
    
    if (traces.length > 0) {
      console.log('📊 最近2小时LLM trace中的模型:');
      traces.forEach(trace => {
        console.log(`   ${trace.model_name}: ${trace.count} 次`);
      });
    } else {
      console.log('⚠️  最近2小时没有LLM trace记录');
    }
    
  } catch (error) {
    console.error('❌ 错误:', error.message);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

checkModelConfig().catch(console.error);