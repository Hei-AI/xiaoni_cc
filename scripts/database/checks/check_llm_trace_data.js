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

async function checkLLMTraceData() {
  let connection;
  
  try {
    connection = await mysql.createConnection(dbConfig);
    console.log('✅ 数据库连接成功');
    
    // 检查llm_call_traces表数据
    console.log('\n🔍 检查llm_call_traces表:');
    const [traceStructure] = await connection.execute("DESCRIBE llm_call_traces");
    console.log('表结构:');
    traceStructure.forEach(field => {
      console.log(`   ${field.Field}: ${field.Type} ${field.Null === 'NO' ? '(NOT NULL)' : '(NULL)'}`);
    });
    
    const [traceCount] = await connection.execute("SELECT COUNT(*) as count FROM llm_call_traces");
    console.log(`\n📊 llm_call_traces 记录数: ${traceCount[0].count}`);
    
    if (traceCount[0].count > 0) {
      const [sampleTraces] = await connection.execute("SELECT * FROM llm_call_traces ORDER BY timestamp DESC LIMIT 3");
      console.log('\n📝 样本trace记录:');
      sampleTraces.forEach((trace, index) => {
        console.log(`   ${index + 1}. conversation_id: ${trace.conversation_id}`);
        console.log(`      call_sequence: ${trace.call_sequence}`);
        console.log(`      engine_type: ${trace.engine_type}`);
        console.log(`      model_name: ${trace.model_name}`);
      });
    }
    
    // 检查llm_call_logs表数据
    console.log('\n🔍 检查llm_call_logs表:');
    const [logStructure] = await connection.execute("DESCRIBE llm_call_logs");
    console.log('表结构:');
    logStructure.forEach(field => {
      console.log(`   ${field.Field}: ${field.Type} ${field.Null === 'NO' ? '(NOT NULL)' : '(NULL)'}`);
    });
    
    const [logCount] = await connection.execute("SELECT COUNT(*) as count FROM llm_call_logs");
    console.log(`\n📊 llm_call_logs 记录数: ${logCount[0].count}`);
    
    if (logCount[0].count > 0) {
      const [sampleLogs] = await connection.execute("SELECT * FROM llm_call_logs ORDER BY created_at DESC LIMIT 3");
      console.log('\n📝 样本log记录:');
      sampleLogs.forEach((log, index) => {
        console.log(`   ${index + 1}. conversation_id: ${log.conversation_id || 'NULL'}`);
        console.log(`      trace_id: ${log.trace_id || 'NULL'}`);
        console.log(`      model_name: ${log.model_name}`);
        console.log(`      success: ${log.success}`);
      });
    }
    
    // 检查conversations表中有trace_id的记录
    console.log('\n🔍 检查conversations表中带trace_id的记录:');
    const [tracedConvs] = await connection.execute("SELECT id, trace_id, session_id, model_name FROM conversations WHERE trace_id IS NOT NULL ORDER BY created_at DESC LIMIT 3");
    console.log(`📊 带trace_id的对话数: ${tracedConvs.length}`);
    
    tracedConvs.forEach((conv, index) => {
      console.log(`   ${index + 1}. conversation_id: ${conv.id}`);
      console.log(`      trace_id: ${conv.trace_id}`);
      console.log(`      session_id: ${conv.session_id || 'NULL'}`);
      console.log(`      model_name: ${conv.model_name}`);
    });
    
  } catch (error) {
    console.error('❌ 错误:', error.message);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

checkLLMTraceData().catch(console.error);