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

async function tableExists(connection, tableName) {
  const [rows] = await connection.execute(
    `SELECT COUNT(*) AS count
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    [dbConfig.database, tableName]
  );
  return Number(rows[0]?.count || 0) > 0;
}

async function checkLLMTraceData() {
  let connection;

  try {
    connection = await mysql.createConnection(dbConfig);
    console.log('✅ 数据库连接成功');

    const hasLegacyTraceTable = await tableExists(connection, 'llm_call_traces');
    if (hasLegacyTraceTable) {
      console.log('\nℹ️ 检测到历史表 llm_call_traces，当前主路径已切换到 llm_call_logs。');
      const [traceCount] = await connection.execute('SELECT COUNT(*) AS count FROM llm_call_traces');
      console.log(`📊 llm_call_traces 记录数: ${traceCount[0].count}`);
    }

    console.log('\n🔍 检查 llm_call_logs 表结构:');
    const [logStructure] = await connection.execute('DESCRIBE llm_call_logs');
    logStructure.forEach((field) => {
      console.log(`   ${field.Field}: ${field.Type} ${field.Null === 'NO' ? '(NOT NULL)' : '(NULL)'}`);
    });

    const [logCount] = await connection.execute('SELECT COUNT(*) AS count FROM llm_call_logs');
    console.log(`\n📊 llm_call_logs 记录数: ${logCount[0].count}`);

    if (logCount[0].count > 0) {
      const [sampleLogs] = await connection.execute(
        `SELECT trace_id, model_name, model_provider, status, request_format_version,
                wire_provider_format, timestamp
         FROM llm_call_logs
         ORDER BY timestamp DESC
         LIMIT 3`
      );

      console.log('\n📝 样本 llm_call_logs 记录:');
      sampleLogs.forEach((log, index) => {
        console.log(`   ${index + 1}. trace_id: ${log.trace_id}`);
        console.log(`      model_name: ${log.model_name}`);
        console.log(`      model_provider: ${log.model_provider}`);
        console.log(`      status: ${log.status}`);
        console.log(`      request_format_version: ${log.request_format_version}`);
        console.log(`      wire_provider_format: ${log.wire_provider_format}`);
        console.log(`      timestamp: ${log.timestamp}`);
      });
    }

    console.log('\n🔍 检查 conversations 表中带 trace_id 的记录:');
    const [tracedConversations] = await connection.execute(
      `SELECT id, trace_id, model_name, timestamp
       FROM conversations
       WHERE trace_id IS NOT NULL
       ORDER BY timestamp DESC
       LIMIT 3`
    );
    console.log(`📊 样本对话数: ${tracedConversations.length}`);

    tracedConversations.forEach((conversation, index) => {
      console.log(`   ${index + 1}. conversation_id: ${conversation.id}`);
      console.log(`      trace_id: ${conversation.trace_id}`);
      console.log(`      model_name: ${conversation.model_name}`);
      console.log(`      timestamp: ${conversation.timestamp}`);
    });
  } catch (error) {
    console.error('❌ 错误:', error.message);
    process.exitCode = 1;
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

checkLLMTraceData().catch((error) => {
  console.error('❌ 未处理异常:', error);
  process.exit(1);
});
