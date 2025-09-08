/**
 * 创建链路追踪相关的数据库表
 * 运行: node create_trace_tables.js
 */

const mysql = require('mysql2/promise');
const fs = require('fs').promises;
const path = require('path');

// 数据库配置
const dbConfig = {
  host: 'localhost',
  user: 'qqbot_user',
  password: 'qqbot_password',
  database: 'qqbot_db',
  charset: 'utf8mb4'
};

async function createTables() {
  let connection;
  
  try {
    console.log('🔗 连接数据库...');
    connection = await mysql.createConnection(dbConfig);
    console.log('✅ 数据库连接成功');

    // 读取SQL文件
    const sqlFile = path.join(__dirname, 'database/schema/trace_logging_tables.sql');
    console.log('📖 读取SQL文件:', sqlFile);
    
    const sqlContent = await fs.readFile(sqlFile, 'utf-8');
    
    // 分割SQL语句（按分号分割，但忽略存储过程中的分号）
    const statements = sqlContent
      .split('\n')
      .filter(line => !line.trim().startsWith('--') && line.trim().length > 0)
      .join('\n')
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('/*') && !stmt.includes('DELIMITER'));

    console.log(`📝 准备执行 ${statements.length} 条SQL语句...`);

    // 执行每条SQL语句
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      if (statement.trim() === '') continue;
      
      try {
        console.log(`⚡ 执行语句 ${i + 1}/${statements.length}...`);
        await connection.execute(statement);
        console.log(`✅ 语句 ${i + 1} 执行成功`);
      } catch (error) {
        // 如果是表已存在的错误，忽略
        if (error.code === 'ER_TABLE_EXISTS_ERROR') {
          console.log(`⚠️  语句 ${i + 1} - 表已存在，跳过`);
          continue;
        }
        console.error(`❌ 语句 ${i + 1} 执行失败:`, error.message);
        console.error('SQL:', statement.substring(0, 200) + '...');
      }
    }

    // 验证表是否创建成功
    console.log('\n🔍 验证表创建结果...');
    const tables = [
      'websocket_logs',
      'llm_call_logs', 
      'session_traces',
      'trace_statistics'
    ];

    for (const tableName of tables) {
      try {
        const [rows] = await connection.execute(`DESCRIBE ${tableName}`);
        console.log(`✅ 表 ${tableName} 创建成功，包含 ${rows.length} 个字段`);
      } catch (error) {
        console.error(`❌ 表 ${tableName} 验证失败:`, error.message);
      }
    }

    console.log('\n🎉 所有链路追踪表创建完成！');
    
  } catch (error) {
    console.error('💥 创建表时发生错误:', error);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      console.log('🔌 数据库连接已关闭');
    }
  }
}

// 运行表创建
createTables().catch(console.error);