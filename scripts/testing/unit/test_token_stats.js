#!/usr/bin/env node

/**
 * 🔍 Token状态检查脚本
 * 直接调用TokenManager获取最新的Token统计信息
 */

const mysql = require('mysql2/promise');
const { config } = require('./modules/qqbot-core/dist/config');

// 数据库配置
const dbConfig = {
  host: 'localhost',
  port: 3306,
  user: 'qqbot_user',
  password: 'qqbot_password',
  database: 'qqbot_db',
  charset: 'utf8mb4'
};

async function checkTokenStatus() {
  console.log('🔍 开始检查Token状态...\n');
  
  let connection;
  
  try {
    // 连接数据库
    connection = await mysql.createConnection(dbConfig);
    console.log('✅ 数据库连接成功');
    
    // 获取Token统计信息
    const [stats] = await connection.execute(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN is_active = TRUE THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN is_healthy = TRUE THEN 1 ELSE 0 END) as healthy,
        SUM(CASE WHEN blacklisted_until > NOW() THEN 1 ELSE 0 END) as blacklisted,
        SUM(CASE WHEN daily_used >= daily_limit THEN 1 ELSE 0 END) as over_daily_limit
      FROM api_tokens
    `);
    
    console.log('\n📊 Token统计信息:');
    console.log(`   总计: ${stats[0].total} 个Token`);
    console.log(`   激活: ${stats[0].active} 个`);
    console.log(`   健康: ${stats[0].healthy} 个`);
    console.log(`   黑名单: ${stats[0].blacklisted} 个`);
    console.log(`   超限: ${stats[0].over_daily_limit} 个`);
    
    // 获取Token详细信息
    const [tokens] = await connection.execute(`
      SELECT 
        id, project_name, project_id, is_healthy, daily_used, daily_limit, 
        error_count, last_used, blacklisted_until, model_blacklist
      FROM api_tokens 
      ORDER BY priority ASC, project_name ASC
    `);
    
    console.log('\n🔧 Token详细状态:');
    tokens.forEach(token => {
      const usagePercent = ((token.daily_used / token.daily_limit) * 100).toFixed(1);
      const status = token.is_healthy ? 
        (token.blacklisted_until && new Date(token.blacklisted_until) > new Date() ? '🚫 黑名单' : '✅ 健康') : 
        '❌ 不健康';
      
      console.log(`   ${token.project_name} (ID: ${token.id})`);
      console.log(`     状态: ${status}`);
      console.log(`     使用: ${token.daily_used}/${token.daily_limit} (${usagePercent}%)`);
      console.log(`     错误: ${token.error_count} 次`);
      
      if (token.last_used) {
        const lastUsed = new Date(token.last_used);
        console.log(`     最后使用: ${lastUsed.toLocaleString('zh-CN')}`);
      }
      
      if (token.blacklisted_until && new Date(token.blacklisted_until) > new Date()) {
        const blacklistEnd = new Date(token.blacklisted_until);
        console.log(`     黑名单到期: ${blacklistEnd.toLocaleString('zh-CN')}`);
      }
      
      if (token.model_blacklist) {
        try {
          const modelBlacklist = JSON.parse(token.model_blacklist);
          const activeBlacklists = Object.entries(modelBlacklist).filter(([model, until]) => new Date(until) > new Date());
          if (activeBlacklists.length > 0) {
            console.log(`     模型黑名单: ${activeBlacklists.map(([model, until]) => `${model} (到 ${new Date(until).toLocaleString('zh-CN')})`).join(', ')}`);
          }
        } catch (e) {
          // JSON解析失败，忽略
        }
      }
      console.log('');
    });
    
    // 检查Model-aware配置
    console.log('🧠 Model-aware配置:');
    const [modelConfigs] = await connection.execute(`
      SELECT model_name, COUNT(*) as config_count,
             GROUP_CONCAT(DISTINCT agent_type) as agent_types
      FROM agent_prompts 
      WHERE model_name IS NOT NULL AND is_active = TRUE
      GROUP BY model_name
      ORDER BY model_name
    `);
    
    if (modelConfigs.length > 0) {
      modelConfigs.forEach(config => {
        console.log(`   ${config.model_name}: ${config.config_count} 个配置 (${config.agent_types})`);
      });
    } else {
      console.log('   暂无Model-aware配置');
    }
    
    // 获取最近的使用统计
    console.log('\n📈 最近使用情况 (最近1小时):');
    const [recentUsage] = await connection.execute(`
      SELECT COUNT(*) as recent_conversations,
             COUNT(DISTINCT user_id) as unique_users,
             AVG(response_time) as avg_response_time
      FROM conversations 
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)
    `);
    
    console.log(`   最近对话: ${recentUsage[0].recent_conversations} 条`);
    console.log(`   用户数量: ${recentUsage[0].unique_users} 人`);
    if (recentUsage[0].avg_response_time) {
      console.log(`   平均响应时间: ${Math.round(recentUsage[0].avg_response_time)}ms`);
    }
    
    console.log('\n🎉 Token状态检查完成!');
    
  } catch (error) {
    console.error(`❌ Token状态检查失败: ${error.message}`);
  } finally {
    if (connection) {
      await connection.end();
      console.log('\n🔧 数据库连接已关闭');
    }
  }
}

// 执行检查
if (require.main === module) {
  checkTokenStatus().catch(console.error);
}