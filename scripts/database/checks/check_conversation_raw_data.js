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

async function checkConversationRawData() {
  let connection;
  
  try {
    connection = await mysql.createConnection(dbConfig);
    console.log('✅ 数据库连接成功');
    
    const conversationId = '4887fad6-865f-4691-8513-4affc959d2fe';
    
    // 检查conversation的完整数据
    console.log(`\n🔍 检查conversation ${conversationId}:`);
    const [convs] = await connection.execute("SELECT * FROM conversations WHERE id = ?", [conversationId]);
    
    if (convs.length === 0) {
      console.log('❌ Conversation不存在');
      return;
    }
    
    const conv = convs[0];
    console.log('✅ Conversation存在');
    console.log(`   用户ID: ${conv.user_id}`);
    console.log(`   创建时间: ${conv.created_at}`);
    console.log(`   trace_id: ${conv.trace_id || 'NULL'}`);
    console.log(`   session_id: ${conv.session_id || 'NULL'}`);
    console.log(`   用户消息: ${conv.user_message || 'NULL'}`);
    console.log(`   AI回复: ${conv.ai_response ? conv.ai_response.substring(0, 100) + '...' : 'NULL'}`);
    console.log(`   raw_request长度: ${conv.raw_request ? conv.raw_request.length : 0} 字符`);
    
    // 检查raw_request内容
    if (conv.raw_request) {
      console.log('\n📄 raw_request内容预览:');
      try {
        const rawRequest = JSON.parse(conv.raw_request);
        console.log(`   message_type: ${rawRequest.message_type || 'undefined'}`);
        console.log(`   raw_message: ${rawRequest.raw_message || 'undefined'}`);
        console.log(`   user_id: ${rawRequest.user_id || rawRequest.sender?.user_id || 'undefined'}`);
        console.log(`   group_id: ${rawRequest.group_id || 'undefined'}`);
        console.log(`   sender.nickname: ${rawRequest.sender?.nickname || 'undefined'}`);
        
        // 显示完整结构
        console.log('\n📋 raw_request完整结构:');
        console.log(JSON.stringify(rawRequest, null, 2));
      } catch (e) {
        console.log('❌ raw_request JSON解析失败');
        console.log(`   原始内容: ${conv.raw_request.substring(0, 200)}...`);
      }
    } else {
      console.log('\n⚠️  raw_request为空');
    }
    
    // 检查是否有关联的websocket日志
    if (conv.trace_id) {
      console.log(`\n🔍 检查关联的WebSocket日志 (trace_id: ${conv.trace_id}):`);
      const [wsLogs] = await connection.execute("SELECT * FROM websocket_logs WHERE trace_id = ?", [conv.trace_id]);
      console.log(`   找到 ${wsLogs.length} 条WebSocket日志`);
      
      if (wsLogs.length > 0) {
        const wsLog = wsLogs[0];
        console.log(`   日志类型: ${wsLog.event_type}`);
        console.log(`   原始数据长度: ${wsLog.raw_data ? wsLog.raw_data.length : 0} 字符`);
        
        if (wsLog.raw_data) {
          try {
            const wsRawData = JSON.parse(wsLog.raw_data);
            console.log(`   WS raw_message: ${wsRawData.raw_message || 'undefined'}`);
          } catch (e) {
            console.log('   WS raw_data JSON解析失败');
          }
        }
      }
    }
    
  } catch (error) {
    console.error('❌ 错误:', error.message);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

checkConversationRawData().catch(console.error);