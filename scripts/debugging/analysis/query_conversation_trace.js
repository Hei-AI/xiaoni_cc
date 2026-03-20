const mysql = require('mysql2/promise');

async function queryConversationTrace(conversationId) {
  const config = {
    host: 'localhost',
    port: 3306,
    user: 'qqbot_user',
    password: 'qqbot_password',
    database: 'qqbot_db',
    charset: 'utf8mb4'
  };

  let connection;

  try {
    console.log(`🔍 查询对话 ${conversationId} 的 LLM 调用链路...`);
    connection = await mysql.createConnection(config);

    console.log('\n📄 基本对话信息:');
    const [conversation] = await connection.execute(
      'SELECT * FROM conversations WHERE id = ?',
      [conversationId]
    );

    if (conversation.length === 0) {
      console.log(`❌ 未找到对话记录: ${conversationId}`);
      return;
    }

    const conv = conversation[0];
    console.log(`  对话ID: ${conv.id}`);
    console.log(`  用户ID: ${conv.user_id}`);
    console.log(`  用户消息: ${conv.user_message}`);
    console.log(`  AI回复: ${conv.ai_response?.substring(0, 100)}...`);
    console.log(`  时间: ${conv.timestamp}`);
    console.log(`  响应时间: ${conv.response_time}ms`);
    console.log(`  trace_id: ${conv.trace_id || '无'}`);

    console.log('\n🔍 LLM 调用记录:');
    const [llmLogs] = await connection.execute(
      `SELECT *
       FROM llm_call_logs
       WHERE conversation_id = ? OR trace_id = ?
       ORDER BY call_sequence ASC, timestamp ASC`,
      [conversationId, conv.trace_id || '']
    );

    if (llmLogs.length === 0) {
      console.log('  ❌ 未找到 LLM 调用记录');
    } else {
      console.log(`  ✅ 找到 ${llmLogs.length} 条 LLM 调用记录:`);

      let totalTokens = 0;
      let totalResponseTime = 0;
      let successCount = 0;
      const agentBreakdown = {};

      llmLogs.forEach((log, index) => {
        console.log(`\n  ${index + 1}. 调用序号 ${log.call_sequence}:`);
        console.log(`     Agent类型: ${log.agent_type}`);
        console.log(`     模型: ${log.model_name || '未知'}`);
        console.log(`     时间: ${log.timestamp}`);
        console.log(`     响应时间: ${log.processing_time_ms}ms`);
        console.log(`     Token使用: 输入${log.input_tokens || 0} + 输出${log.output_tokens || 0} = 总计${(log.input_tokens || 0) + (log.output_tokens || 0)}`);
        console.log(`     状态: ${log.status}`);

        if (log.processed_response) {
          console.log(`     响应预览: ${String(log.processed_response).substring(0, 100)}...`);
        }

        if (log.error_message) {
          console.log(`     错误信息: ${log.error_message}`);
        }

        totalTokens += (log.input_tokens || 0) + (log.output_tokens || 0);
        totalResponseTime += log.processing_time_ms || 0;
        if (log.status === 'SUCCESS') {
          successCount += 1;
        }
        agentBreakdown[log.agent_type] = (agentBreakdown[log.agent_type] || 0) + 1;
      });

      console.log('\n📊 统计信息:');
      console.log(`  总调用次数: ${llmLogs.length}`);
      console.log(`  成功率: ${((successCount / llmLogs.length) * 100).toFixed(1)}%`);
      console.log(`  总Token消耗: ${totalTokens}`);
      console.log(`  总响应时间: ${totalResponseTime}ms`);
      console.log(`  平均响应时间: ${(totalResponseTime / llmLogs.length).toFixed(1)}ms`);

      console.log('\n🔧 Agent 使用分布:');
      Object.entries(agentBreakdown).forEach(([agentType, count]) => {
        console.log(`  ${agentType}: ${count}次`);
      });
    }

    console.log('\n🔍 raw_request 数据完整性检查:');
    if (conv.raw_request) {
      try {
        const rawData = JSON.parse(conv.raw_request);
        console.log('  ✅ raw_request 格式正确');
        console.log(`  包含字段: ${Object.keys(rawData).join(', ')}`);
      } catch (error) {
        console.log('  ❌ raw_request JSON 格式错误:', error.message);
      }
    } else {
      console.log('  ❌ raw_request 为空');
    }
  } catch (error) {
    console.error('❌ 查询失败:', error.message);
    console.error('详细错误:', error);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

const conversationId = process.argv[2] || 'e09cf1c3-d4ad-4572-997c-a4f3bf43331d';
queryConversationTrace(conversationId).catch(console.error);
