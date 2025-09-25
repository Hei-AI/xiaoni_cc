/**
 * 消息流程API完整验证脚本
 *
 * 用途：验证队列解耦架构下的消息处理完整性
 * 依据：MESSAGE_FLOW_API_SPECIFICATION.md
 *
 * 使用方法：
 * node test_message_flow_api_complete.js
 */

const mysql = require('mysql2/promise');
const axios = require('axios');

// 配置信息
const CONFIG = {
  database: {
    host: 'localhost',
    user: 'qqbot_user',
    password: 'qqbot_password',
    database: 'qqbot_db'
  },
  api: {
    baseUrl: 'http://localhost:8081',
    adminUrl: 'http://localhost:3003'
  },
  test: {
    userId: 85178516,
    message: '完整验证测试：队列解耦架构消息流程检查',
    timeoutMs: 30000
  }
};

async function runCompleteValidation() {
  console.log('🚀 开始消息流程API完整验证...');
  console.log('📋 验证依据：MESSAGE_FLOW_API_SPECIFICATION.md\n');

  const startTime = Date.now();
  let conversationId = null;

  try {
    // ========================================
    // 第1层：端到端流程验证
    // ========================================
    console.log('🔸 第1层：端到端流程验证');
    console.log('发送测试消息到队列系统...');

    const response = await axios.post(`${CONFIG.api.baseUrl}/api/simulate/private`, {
      user_id: CONFIG.test.userId,
      message: CONFIG.test.message
    }, {
      timeout: CONFIG.test.timeoutMs
    });

    // 验证基础响应
    assert(response.status === 200, `❌ HTTP状态码异常: ${response.status}`);
    assert(response.data.conversation_id, '❌ 未返回conversation_id');

    conversationId = response.data.conversation_id;
    console.log(`✅ 消息发送成功，conversation_id: ${conversationId}`);

    // 等待异步处理完成
    console.log('⏳ 等待消息处理完成...');
    await waitForProcessingComplete(conversationId);

    // ========================================
    // 第2层：数据库记录完整性验证
    // ========================================
    console.log('\n🔸 第2层：数据库记录完整性验证');
    await validateDataCompleteness(conversationId);
    console.log('✅ 数据库记录验证通过');

    // ========================================
    // 第3层：API响应结构验证
    // ========================================
    console.log('\n🔸 第3层：API响应结构验证');
    const apiData = await validateAPIResponse(conversationId);
    console.log('✅ API响应结构验证通过');

    // ========================================
    // 第4层：业务逻辑验证
    // ========================================
    console.log('\n🔸 第4层：业务逻辑验证');
    await validateBusinessLogic(apiData);
    console.log('✅ 业务逻辑验证通过');

    // ========================================
    // 生成验证报告
    // ========================================
    const totalTime = Date.now() - startTime;
    console.log('\n📊 生成验证报告...');
    const report = generateValidationReport(conversationId, apiData, totalTime);
    console.log(report);

    console.log('\n🎉 消息流程API完整验证通过！');
    return {
      conversationId,
      status: 'SUCCESS',
      validationTime: totalTime,
      report
    };

  } catch (error) {
    console.error('\n❌ 验证失败:', error.message);
    if (conversationId) {
      console.log(`🔍 问题对话ID: ${conversationId}`);
      console.log(`🔗 调试链接: ${CONFIG.api.adminUrl}/conversation/${conversationId}/timeline`);
    }
    throw error;
  }
}

/**
 * 等待消息处理完成
 */
async function waitForProcessingComplete(conversationId, maxWaitSeconds = 30) {
  const connection = await mysql.createConnection(CONFIG.database);

  for (let i = 0; i < maxWaitSeconds; i++) {
    const [conversations] = await connection.execute(
      'SELECT status, ai_response FROM conversations WHERE id = ?',
      [conversationId]
    );

    if (conversations.length > 0) {
      const conv = conversations[0];
      if (conv.status === 'completed' && conv.ai_response) {
        await connection.end();
        console.log(`✅ 消息处理完成 (${i + 1}秒)`);
        return;
      }
      if (conv.status === 'failed') {
        await connection.end();
        throw new Error('消息处理失败');
      }
    }

    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  await connection.end();
  throw new Error('消息处理超时');
}

/**
 * 第2层：数据库记录完整性验证
 */
async function validateDataCompleteness(conversationId) {
  const connection = await mysql.createConnection(CONFIG.database);

  try {
    // 1. 验证conversations表基础记录
    console.log('  🔍 检查conversations表记录...');
    const [conversations] = await connection.execute(
      'SELECT id, trace_id, user_id, user_message, ai_response, status, model_name, response_time FROM conversations WHERE id = ?',
      [conversationId]
    );

    assert(conversations.length === 1, "❌ 对话记录不存在");
    const conversation = conversations[0];
    assert(conversation.trace_id !== null, "❌ trace_id缺失");
    assert(conversation.ai_response !== null, "❌ AI回复缺失");
    assert(conversation.status === 'completed', "❌ 状态不是completed");
    assert(conversation.model_name !== null, "❌ model_name缺失");
    console.log(`    ✅ 基础记录完整 (trace_id: ${conversation.trace_id})`);

    // 2. 验证LLM调用记录 (核心修复验证点)
    console.log('  🔍 检查llm_call_logs表记录...');
    const [llmLogs] = await connection.execute(
      'SELECT id, trace_id, conversation_id, agent_type, model_name, status, api_call_time_ms, call_sequence FROM llm_call_logs WHERE conversation_id = ? ORDER BY call_sequence',
      [conversationId]
    );

    assert(llmLogs.length >= 1, "❌ 核心BUG：llm_call_logs无记录! AIService未调用logLLMCall()");
    console.log(`    ✅ LLM调用记录完整 (${llmLogs.length}条)`);

    llmLogs.forEach((log, index) => {
      assert(log.trace_id === conversation.trace_id, `❌ LLM记录${index + 1} trace_id不匹配`);
      assert(log.agent_type !== null, `❌ LLM记录${index + 1} agent_type缺失`);
      assert(log.model_name !== null, `❌ LLM记录${index + 1} model_name缺失`);
      assert(['SUCCESS', 'ERROR', 'TIMEOUT'].includes(log.status), `❌ LLM记录${index + 1} status异常: ${log.status}`);
      assert(log.api_call_time_ms >= 0, `❌ LLM记录${index + 1} 调用时间异常: ${log.api_call_time_ms}`);
    });

    // 3. 验证处理事件记录
    console.log('  🔍 检查timeline_events表记录...');
    const [events] = await connection.execute(
      'SELECT event_type, event_name, event_phase, event_time FROM timeline_events WHERE trace_id = ? ORDER BY event_time',
      [conversation.trace_id]
    );

    assert(events.length >= 2, "❌ 处理事件记录不完整，至少应有start和end事件");
    const startEvents = events.filter(e => e.event_phase === 'start');
    const endEvents = events.filter(e => e.event_phase === 'end');
    assert(startEvents.length >= 1, "❌ 缺少开始事件");
    assert(endEvents.length >= 1, "❌ 缺少结束事件");
    console.log(`    ✅ 处理事件完整 (${events.length}条事件)`);

    // 4. 验证消息队列记录 (如果存在相关表)
    try {
      const [messageArrivals] = await connection.execute(
        'SELECT * FROM message_arrivals WHERE conversation_id = ?',
        [conversationId]
      );
      if (messageArrivals.length > 0) {
        console.log(`    ✅ 队列到达记录 (${messageArrivals.length}条)`);
      }
    } catch (error) {
      // 表可能不存在，这是正常的
      console.log('    ⚠️  message_arrivals表不存在（正常）');
    }

  } finally {
    await connection.end();
  }
}

/**
 * 第3层：API响应结构验证
 */
async function validateAPIResponse(conversationId) {
  console.log('  🔍 调用LLM Flow API...');
  const response = await axios.get(`${CONFIG.api.adminUrl}/api/debug/conversation/${conversationId}/llm-flow`, {
    timeout: 10000
  });

  assert(response.status === 200, `❌ API响应状态异常: ${response.status}`);
  const data = response.data;

  // 1. 基础结构验证
  console.log('  🔍 验证基础响应结构...');
  assert(data.conversation_id === conversationId, "❌ conversation_id不匹配");
  assert(data.websocket_input !== null, "❌ websocket_input缺失 (注: 命名待重构)");
  assert(data.websocket_output !== null, "❌ websocket_output缺失 (注: 命名待重构)");
  assert(Array.isArray(data.llm_trace), "❌ llm_trace不是数组");
  assert(Array.isArray(data.timeline_events), "❌ timeline_events不是数组");

  // 2. 核心修复验证：LLM调用链路不为空
  console.log('  🔍 验证LLM调用链路数据...');
  assert(data.llm_trace.length > 0, "❌ 核心BUG：llm_trace仍为空数组! API数据转换失败");
  console.log(`    ✅ LLM调用链路数据完整 (${data.llm_trace.length}条记录)`);

  // 3. LLM调用记录结构验证
  data.llm_trace.forEach((trace, index) => {
    // 验证输入结构
    assert(trace.llm_raw_input !== null, `❌ LLM trace[${index}] raw_input缺失`);
    assert(trace.llm_raw_input.agent_type, `❌ LLM trace[${index}] agent_type缺失`);
    assert(trace.llm_raw_input.model_name, `❌ LLM trace[${index}] model_name缺失`);
    assert(trace.llm_raw_input.input_prompt, `❌ LLM trace[${index}] input_prompt缺失`);
    assert(trace.llm_raw_input.timestamp, `❌ LLM trace[${index}] timestamp缺失`);

    // 验证输出结构
    assert(trace.llm_raw_output !== null, `❌ LLM trace[${index}] raw_output缺失`);
    assert(trace.llm_raw_output.status, `❌ LLM trace[${index}] status缺失`);
    assert(typeof trace.llm_raw_output.api_call_time_ms === 'number', `❌ LLM trace[${index}] api_call_time_ms类型错误`);
    assert(trace.llm_raw_output.api_call_time_ms >= 0, `❌ LLM trace[${index}] api_call_time_ms为负数`);

    // 验证token数据
    const totalTokens = (trace.llm_raw_output.input_tokens || 0) + (trace.llm_raw_output.output_tokens || 0);
    assert(totalTokens >= 0, `❌ LLM trace[${index}] token数据异常`);
  });

  // 4. Timeline事件验证
  console.log('  🔍 验证Timeline事件数据...');
  assert(data.timeline_events.length >= 2, "❌ Timeline事件数据不完整");
  data.timeline_events.forEach((event, index) => {
    assert(event.event_type, `❌ Timeline事件[${index}] event_type缺失`);
    assert(event.event_name, `❌ Timeline事件[${index}] event_name缺失`);
    assert(event.event_phase, `❌ Timeline事件[${index}] event_phase缺失`);
    assert(event.event_time, `❌ Timeline事件[${index}] event_time缺失`);
  });

  console.log('    ✅ API响应结构完整');
  return data;
}

/**
 * 第4层：业务逻辑验证
 */
async function validateBusinessLogic(apiData) {
  console.log('  🔍 验证队列解耦架构特性...');

  // 验证消息输入来源 (注意：当前字段名为websocket_input，但实际应该是队列)
  const messageInput = apiData.websocket_input;
  // 注：由于当前API仍使用旧命名，我们验证数据内容而非字段名
  assert(messageInput !== null, "❌ 消息输入数据缺失");

  // 验证消息输出方式
  const messageOutput = apiData.websocket_output;
  assert(messageOutput !== null, "❌ 消息输出数据缺失");
  assert(messageOutput.content, "❌ AI回复内容缺失");
  assert(typeof messageOutput.response_time_ms === 'string' || typeof messageOutput.response_time_ms === 'number',
         "❌ 响应时间数据类型错误");

  console.log('  🔍 验证LLM调用链路业务逻辑...');
  const llmTrace = apiData.llm_trace;

  // 验证是否包含主要的AI调用
  const hasMainChat = llmTrace.some(trace =>
    trace.llm_raw_input.agent_type === 'chat_bot' ||
    trace.llm_raw_input.agent_type === 'main_chat'
  );
  assert(hasMainChat, "❌ 缺少主要的chat_bot或main_chat调用");

  // 验证模型使用
  const validModels = ['gemini-2.5-flash', 'gemini-2.0-flash-exp', 'gemini-1.5-pro'];
  llmTrace.forEach((trace, index) => {
    const modelName = trace.llm_raw_input.model_name;
    assert(validModels.includes(modelName), `❌ LLM trace[${index}] 使用了未知模型: ${modelName}`);
  });

  // 验证调用顺序
  const sequences = llmTrace.map(trace => trace.llm_raw_input.call_sequence).filter(seq => seq !== null);
  if (sequences.length > 1) {
    for (let i = 1; i < sequences.length; i++) {
      assert(sequences[i] > sequences[i-1], `❌ LLM调用序号不正确: ${sequences[i-1]} -> ${sequences[i]}`);
    }
  }

  console.log('  🔍 验证性能和成本指标...');

  // 计算总处理时间
  const totalApiTime = llmTrace.reduce((sum, trace) =>
    sum + (trace.llm_raw_output.api_call_time_ms || 0), 0);
  assert(totalApiTime > 0, "❌ 总LLM调用时间为0");
  assert(totalApiTime < 60000, "❌ 总LLM调用时间过长 (>60秒)");

  // 计算总Token使用
  const totalTokens = llmTrace.reduce((sum, trace) =>
    sum + (trace.llm_raw_output.input_tokens || 0) + (trace.llm_raw_output.output_tokens || 0), 0);
  assert(totalTokens > 0, "❌ 总Token使用量为0");

  // 验证成功率
  const successfulCalls = llmTrace.filter(trace => trace.llm_raw_output.status === 'SUCCESS').length;
  const successRate = (successfulCalls / llmTrace.length) * 100;
  assert(successRate >= 50, `❌ LLM调用成功率过低: ${successRate}%`);

  console.log(`    ✅ 业务逻辑验证完成 (总耗时: ${totalApiTime}ms, 总Token: ${totalTokens}, 成功率: ${successRate}%)`);
}

/**
 * 生成验证报告
 */
function generateValidationReport(conversationId, apiData, validationTime) {
  const llmTrace = apiData.llm_trace;
  const totalApiTime = llmTrace.reduce((sum, trace) =>
    sum + (trace.llm_raw_output.api_call_time_ms || 0), 0);
  const totalTokens = llmTrace.reduce((sum, trace) =>
    sum + (trace.llm_raw_output.input_tokens || 0) + (trace.llm_raw_output.output_tokens || 0), 0);
  const successfulCalls = llmTrace.filter(trace => trace.llm_raw_output.status === 'SUCCESS').length;
  const successRate = Math.round((successfulCalls / llmTrace.length) * 100);

  // 估算成本 (粗略计算)
  const estimatedCost = totalTokens * 0.000002; // $0.002 per 1000 tokens

  return `
════════════════════════════════════════
📋 消息流程API验证报告
════════════════════════════════════════
🔗 对话ID: ${conversationId}
⏰ 验证时间: ${new Date().toISOString()}
⚡ 验证耗时: ${validationTime}ms
📄 规范版本: v1.0 (MESSAGE_FLOW_API_SPECIFICATION.md)

🔍 架构验证结果:
├─ 队列解耦架构: ✅ 正常
├─ 数据库记录: ✅ 完整
├─ API响应结构: ✅ 正常
└─ LLM调用链路: ✅ 正常 (${llmTrace.length}条记录)

⚡ 性能指标:
├─ LLM调用总时间: ${totalApiTime}ms
├─ 调用成功率: ${successRate}%
├─ Timeline事件数: ${apiData.timeline_events.length}
└─ 平均单次调用: ${Math.round(totalApiTime / llmTrace.length)}ms

💰 资源消耗:
├─ 总Token使用: ${totalTokens.toLocaleString()}
├─ 输入Token: ${llmTrace.reduce((sum, trace) => sum + (trace.llm_raw_output.input_tokens || 0), 0)}
├─ 输出Token: ${llmTrace.reduce((sum, trace) => sum + (trace.llm_raw_output.output_tokens || 0), 0)}
└─ 估算成本: $${estimatedCost.toFixed(6)}

🎯 LLM调用详情:
${llmTrace.map((trace, index) =>
  `├─ [${index + 1}] ${trace.llm_raw_input.agent_type} (${trace.llm_raw_input.model_name}) - ${trace.llm_raw_output.status} - ${trace.llm_raw_output.api_call_time_ms}ms`
).join('\n')}

🔗 调试链接:
└─ Admin Panel: ${CONFIG.api.adminUrl}/conversation/${conversationId}/timeline

✅ 验证状态: 全部通过
🎉 队列解耦架构消息流程工作正常！
════════════════════════════════════════
  `;
}

/**
 * 断言函数
 */
function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

// 导出给其他脚本使用
module.exports = {
  runCompleteValidation,
  validateDataCompleteness,
  validateAPIResponse,
  validateBusinessLogic
};

// 如果直接运行此脚本
if (require.main === module) {
  runCompleteValidation()
    .then(result => {
      console.log(`\n✅ 验证完成，耗时 ${result.validationTime}ms`);
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ 验证失败:', error.message);
      console.error('\n💡 解决建议:');
      console.error('1. 检查所有服务是否正常运行');
      console.error('2. 确认数据库连接正常');
      console.error('3. 验证LLM API Token配置');
      console.error('4. 查看详细错误日志');
      process.exit(1);
    });
}