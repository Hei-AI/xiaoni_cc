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
  charset: 'utf8mb4',
  multipleStatements: true
};

async function createTables() {
  let connection;
  
  try {
    console.log('🔗 连接数据库...');
    connection = await mysql.createConnection(dbConfig);
    console.log('✅ 数据库连接成功');

    // 读取SQL文件
    const sqlFile = path.resolve(__dirname, '../../../database/schema/trace_logging_tables.sql');
    console.log('📖 读取SQL文件:', sqlFile);
    
    const rawSqlContent = await fs.readFile(sqlFile, 'utf-8');
    const executableSql = rawSqlContent
      .replace(/^DELIMITER\s+\/\/\s*$/gm, '')
      .replace(/^DELIMITER\s+;\s*$/gm, '')
      .replace(/\/\/\s*$/gm, ';');

    console.log('📝 执行 trace logging schema...');
    await connection.query(executableSql);
    console.log('✅ trace logging schema 执行完成');

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
