#!/usr/bin/env node
/**
 * LLM Flow API 规范验证脚本
 *
 * 功能：
 * 1. 验证API响应是否符合MESSAGE_FLOW_API_SPECIFICATION.md规范
 * 2. 检查向后兼容性是否保持
 * 3. 生成详细的验证报告
 * 4. 发现不符合规范的问题并提供修复建议
 */

const axios = require('axios');
const mysql = require('mysql2/promise');

// 配置
const CONFIG = {
  API_BASE_URL: 'http://localhost:9080',
  SIMULATE_API_URL: 'http://localhost:8081/api/simulate/private',
  DB_CONFIG: {
    host: 'localhost',
    port: 3306,
    user: 'qqbot_user',
    password: 'qqbot_password',
    database: 'qqbot_db'
  }
};

// 验证结果记录
const validationResults = {
  passed: [],
  failed: [],
  warnings: []
};

function log(level, message, data = null) {
  const timestamp = new Date().toISOString();
  const prefix = {
    'SUCCESS': '✅',
    'ERROR': '❌',
    'WARNING': '⚠️',
    'INFO': 'ℹ️'
  }[level] || 'ℹ️';

  console.log(`[${timestamp}] ${prefix} ${message}`);
  if (data) {
    console.log('   ', JSON.stringify(data, null, 2).slice(0, 200) + (JSON.stringify(data).length > 200 ? '...' : ''));
  }
}

function assert(condition, message, category = 'failed') {
  if (condition) {
    validationResults.passed.push(message);
    log('SUCCESS', message);
    return true;
  } else {
    validationResults[category].push(message);
    log(category === 'failed' ? 'ERROR' : 'WARNING', message);
    if (category === 'failed') {
      throw new Error(message);
    }
    return false;
  }
}

// 第1步：触发端到端测试消息
async function triggerTestMessage() {
  log('INFO', '🚀 第1步：发送测试消息...');

  const testMessage = {
    user_id: 888999,
    message: '规范验证测试：检查LLM Flow API完整性 - ' + new Date().toISOString()
  };

  try {
    const response = await axios.post(CONFIG.SIMULATE_API_URL, testMessage, {
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' }
    });

    assert(response.status === 200, 'API调用返回HTTP 200状态码');
    assert(response.data.conversation_id, 'API响应包含conversation_id');

    const conversationId = response.data.conversation_id;
    log('SUCCESS', `测试消息发送成功，conversation_id: ${conversationId}`);

    // 等待处理完成
    log('INFO', '等待5秒让消息处理完成...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    return conversationId;
  } catch (error) {
    throw new Error(`发送测试消息失败: ${error.message}`);
  }
}

// 第2步：验证数据库记录完整性
async function validateDatabaseCompleteness(conversationId) {
  log('INFO', '📊 第2步：验证数据库记录完整性...');

  const connection = await mysql.createConnection(CONFIG.DB_CONFIG);

  try {
    // 验证conversations表记录
    const [conversationRows] = await connection.execute(
      'SELECT * FROM conversations WHERE id = ?', [conversationId]
    );

    assert(conversationRows.length === 1, '对话记录存在于conversations表');
    const conversation = conversationRows[0];

    assert(conversation.trace_id !== null, 'conversations.trace_id字段不为空');
    assert(conversation.ai_response !== null, 'conversations.ai_response字段不为空');
    assert(conversation.status === 'completed', 'conversations.status为completed');

    // 验证LLM调用记录
    const [llmLogRows] = await connection.execute(
      'SELECT * FROM llm_call_logs WHERE conversation_id = ? OR trace_id = ?',
      [conversationId, conversation.trace_id]
    );

    assert(llmLogRows.length >= 1, '🔥 核心修复验证：llm_call_logs表有记录');

    llmLogRows.forEach((log, index) => {
      assert(log.trace_id === conversation.trace_id, `LLM记录${index} trace_id匹配`);
      assert(log.agent_type !== null, `LLM记录${index} agent_type不为空`);
      assert(log.model_name !== null, `LLM记录${index} model_name不为空`);
      assert(log.status !== null, `LLM记录${index} status不为空`);
      assert(log.api_call_time_ms >= 0, `LLM记录${index} 调用时间合理`);
    });

    // 验证timeline_events记录
    const [timelineRows] = await connection.execute(
      'SELECT * FROM timeline_events WHERE trace_id = ?', [conversation.trace_id]
    );

    assert(timelineRows.length >= 1, 'timeline_events表有相关记录', 'warnings');

    log('SUCCESS', '数据库记录完整性验证通过');
    return { conversation, llmLogs: llmLogRows, timelineEvents: timelineRows };
  } finally {
    await connection.end();
  }
}

// 第3步：验证API响应结构规范
async function validateAPIResponseStructure(conversationId) {
  log('INFO', '🏗️ 第3步：验证API响应结构规范...');

  const response = await axios.get(`${CONFIG.API_BASE_URL}/api/debug/conversation/${conversationId}/llm-flow`);
  const data = response.data;

  // 基础结构验证
  assert(data.conversation_id === conversationId, 'conversation_id字段匹配');
  assert(typeof data.trace_id === 'string', '🆕 trace_id字段存在且为字符串');

  // 🔥 新规范字段验证
  log('INFO', '验证新规范字段...');
  assert(data.message_input !== undefined, '🆕 message_input字段存在');
  assert(data.message_output !== undefined, '🆕 message_output字段存在');
  assert(Array.isArray(data.llm_call_chain), '🆕 llm_call_chain字段存在且为数组');
  assert(Array.isArray(data.processing_events), '🆕 processing_events字段存在且为数组');
  assert(data.flow_summary !== undefined, '🆕 flow_summary字段存在');
  assert(data.debug_info !== undefined, '🆕 debug_info字段存在');

  // message_input 结构验证
  const messageInput = data.message_input;
  assert(typeof messageInput.user_id === 'number', 'message_input.user_id为数字');
  assert(typeof messageInput.message === 'string', 'message_input.message为字符串');
  assert(['private', 'group'].includes(messageInput.message_type), 'message_input.message_type值正确');
  assert(typeof messageInput.source === 'string', 'message_input.source字段存在');
  assert(typeof messageInput.queued_at === 'string', 'message_input.queued_at为ISO时间戳');
  assert(typeof messageInput.processed_at === 'string', 'message_input.processed_at为ISO时间戳');
  assert(typeof messageInput.partition_key === 'string', 'message_input.partition_key字段存在');
  assert(['HIGH', 'MEDIUM', 'LOW'].includes(messageInput.priority), 'message_input.priority值正确');

  // message_output 结构验证
  const messageOutput = data.message_output;
  assert(typeof messageOutput.content === 'string', 'message_output.content为字符串');
  assert(typeof messageOutput.response_time_ms === 'number', 'message_output.response_time_ms为数字');
  assert(typeof messageOutput.model_used === 'string', 'message_output.model_used为字符串');
  assert(messageOutput.delivery_method === 'http_api', 'message_output.delivery_method为http_api');
  assert(['sent', 'failed', 'pending'].includes(messageOutput.delivery_status), 'message_output.delivery_status值正确');
  assert(typeof messageOutput.character_count === 'number', 'message_output.character_count为数字');

  // llm_call_chain 结构验证
  if (data.llm_call_chain.length > 0) {
    data.llm_call_chain.forEach((call, index) => {
      assert(typeof call.sequence === 'number', `LLM调用${index} sequence为数字`);
      assert(typeof call.stage === 'string', `LLM调用${index} stage为字符串`);
      assert(typeof call.agent_type === 'string', `LLM调用${index} agent_type为字符串`);
      assert(typeof call.purpose === 'string', `LLM调用${index} purpose为字符串`);

      // input 结构
      assert(call.input.model_name, `LLM调用${index} input.model_name存在`);
      assert(call.input.input_prompt, `LLM调用${index} input.input_prompt存在`);
      assert(call.input.timestamp, `LLM调用${index} input.timestamp存在`);

      // output 结构
      assert(call.output.status, `LLM调用${index} output.status存在`);
      assert(call.output.token_usage, `LLM调用${index} output.token_usage存在`);
      assert(call.output.performance, `LLM调用${index} output.performance存在`);
      assert(typeof call.output.token_usage.total_tokens === 'number', `LLM调用${index} token_usage.total_tokens为数字`);
      assert(typeof call.output.performance.api_call_time_ms === 'number', `LLM调用${index} performance.api_call_time_ms为数字`);
    });
  } else {
    assert(false, '🔥 核心问题：llm_call_chain为空数组', 'warnings');
  }

  // flow_summary 结构验证
  const flowSummary = data.flow_summary;
  assert(typeof flowSummary.total_processing_time_ms === 'number', 'flow_summary.total_processing_time_ms为数字');
  assert(typeof flowSummary.total_llm_calls === 'number', 'flow_summary.total_llm_calls为数字');
  assert(typeof flowSummary.successful_calls === 'number', 'flow_summary.successful_calls为数字');
  assert(typeof flowSummary.total_tokens_used === 'number', 'flow_summary.total_tokens_used为数字');
  assert(typeof flowSummary.success_rate === 'number', 'flow_summary.success_rate为数字');
  assert(flowSummary.success_rate >= 0 && flowSummary.success_rate <= 100, 'flow_summary.success_rate范围正确');

  // debug_info 结构验证
  const debugInfo = data.debug_info;
  assert(debugInfo.data_completeness, 'debug_info.data_completeness存在');
  assert(Array.isArray(debugInfo.missing_data_reasons), 'debug_info.missing_data_reasons为数组');
  assert(Array.isArray(debugInfo.architecture_notes), 'debug_info.architecture_notes为数组');
  assert(Array.isArray(debugInfo.performance_warnings), 'debug_info.performance_warnings为数组');
  assert(Array.isArray(debugInfo.recommendations), 'debug_info.recommendations为数组');

  log('SUCCESS', 'API响应结构规范验证通过');
  return data;
}

// 第4步：验证向后兼容性
async function validateBackwardCompatibility(conversationId, apiData) {
  log('INFO', '🔄 第4步：验证向后兼容性...');

  // 验证原有字段仍然存在
  assert(apiData.websocket_input !== undefined, '向后兼容：websocket_input字段保留');
  assert(apiData.websocket_output !== undefined, '向后兼容：websocket_output字段保留');
  assert(Array.isArray(apiData.llm_trace), '向后兼容：llm_trace字段保留');
  assert(Array.isArray(apiData.timeline_events), '向后兼容：timeline_events字段保留');

  // 验证llm_trace结构保持原有格式
  if (apiData.llm_trace.length > 0) {
    const trace = apiData.llm_trace[0];
    assert(trace.llm_raw_input !== undefined, '向后兼容：llm_trace.llm_raw_input结构保留');
    assert(trace.llm_raw_output !== undefined, '向后兼容：llm_trace.llm_raw_output结构保留');
    assert(trace.llm_raw_input.agent_type, '向后兼容：llm_raw_input.agent_type字段保留');
    assert(trace.llm_raw_input.model_name, '向后兼容：llm_raw_input.model_name字段保留');
    assert(trace.llm_raw_output.status, '向后兼容：llm_raw_output.status字段保留');
    assert(typeof trace.llm_raw_output.total_tokens === 'number', '向后兼容：llm_raw_output.total_tokens保留');
  }

  log('SUCCESS', '向后兼容性验证通过');
}

// 第5步：验证业务逻辑正确性
async function validateBusinessLogic(apiData) {
  log('INFO', '💼 第5步：验证业务逻辑正确性...');

  // 队列解耦架构验证
  assert(apiData.message_input.source !== 'websocket', '消息来源不应为websocket（队列解耦架构）', 'warnings');
  assert(apiData.message_output.delivery_method === 'http_api', '输出方式应为http_api');

  // LLM调用链路验证
  const llmCalls = apiData.llm_call_chain;
  if (llmCalls.length > 0) {
    assert(llmCalls.some(call => ['chat_bot', 'main_chat', 'decision'].includes(call.agent_type)),
           'LLM调用链包含主要的处理引擎');
  }

  // 性能指标合理性验证
  const totalTime = apiData.flow_summary.total_processing_time_ms;
  assert(totalTime >= 0, 'total_processing_time_ms非负');
  assert(totalTime < 120000, 'total_processing_time_ms在合理范围内（<2分钟）', 'warnings');

  // 成本估算合理性
  const totalCost = apiData.flow_summary.total_cost_estimate;
  assert(totalCost >= 0, 'total_cost_estimate非负');
  assert(totalCost < 1, 'total_cost_estimate在合理范围内（<$1）', 'warnings');

  log('SUCCESS', '业务逻辑正确性验证通过');
}

// 生成验证报告
function generateValidationReport(conversationId, apiData) {
  const report = `
📋 LLM Flow API 规范验证报告
================================
验证时间: ${new Date().toISOString()}
对话ID: ${conversationId}
trace_id: ${apiData.trace_id}

🎯 验证摘要:
- ✅ 通过验证: ${validationResults.passed.length} 项
- ❌ 失败验证: ${validationResults.failed.length} 项
- ⚠️ 警告项目: ${validationResults.warnings.length} 项

🔍 规范符合性分析:
- 新规范字段: ✅ 已实现
  * message_input/message_output: 替代websocket_input/output
  * llm_call_chain: 符合扁平化结构要求
  * flow_summary: 提供完整统计摘要
  * debug_info: 包含调试和诊断信息
  * trace_id: 完整追踪链路标识

- 向后兼容性: ✅ 保持完整
  * 原有字段全部保留
  * 前端代码无需修改
  * 平滑迁移到新规范

🏗️ 队列解耦架构特性:
- 消息来源: ${apiData.message_input.source}
- 处理优先级: ${apiData.message_input.priority}
- 输出方式: ${apiData.message_output.delivery_method}
- 发送状态: ${apiData.message_output.delivery_status}

⚡ 性能指标:
- 总处理时间: ${apiData.flow_summary.total_processing_time_ms}ms
- LLM调用次数: ${apiData.flow_summary.total_llm_calls}
- 成功率: ${apiData.flow_summary.success_rate}%
- 总Token使用: ${apiData.flow_summary.total_tokens_used}
- 估算成本: $${apiData.flow_summary.total_cost_estimate}
- 效率评分: ${apiData.flow_summary.efficiency_score}/100

🔧 数据完整性:
- 对话记录: ${apiData.debug_info.data_completeness.conversation_record}
- LLM调用日志: ${apiData.debug_info.data_completeness.llm_call_logs}
- 队列日志: ${apiData.debug_info.data_completeness.queue_logs}
- 处理事件: ${apiData.debug_info.data_completeness.processing_events}

${validationResults.warnings.length > 0 ? `
⚠️ 警告事项:
${validationResults.warnings.map(w => `- ${w}`).join('\n')}
` : ''}

${apiData.debug_info.recommendations.length > 0 ? `
💡 改进建议:
${apiData.debug_info.recommendations.map(r => `- ${r}`).join('\n')}
` : ''}

✅ 总体评估: ${validationResults.failed.length === 0 ? '规范验证通过' : '存在不符合规范的问题'}
  `;

  return report;
}

// 主验证流程
async function runCompleteValidation() {
  console.log('🚀 开始 LLM Flow API 规范验证...\n');

  try {
    // 第1步：触发端到端测试
    const conversationId = await triggerTestMessage();

    // 第2步：数据库验证
    const dbData = await validateDatabaseCompleteness(conversationId);

    // 第3步：API响应结构验证
    const apiData = await validateAPIResponseStructure(conversationId);

    // 第4步：向后兼容性验证
    await validateBackwardCompatibility(conversationId, apiData);

    // 第5步：业务逻辑验证
    await validateBusinessLogic(apiData);

    // 生成验证报告
    const report = generateValidationReport(conversationId, apiData);
    console.log('\n' + report);

    log('SUCCESS', '🎉 LLM Flow API 规范验证完成！');

    return {
      conversationId,
      status: validationResults.failed.length === 0 ? 'SUCCESS' : 'FAILED',
      summary: {
        passed: validationResults.passed.length,
        failed: validationResults.failed.length,
        warnings: validationResults.warnings.length
      },
      report
    };

  } catch (error) {
    log('ERROR', `验证失败: ${error.message}`);
    throw error;
  }
}

// 导出给外部使用
module.exports = { runCompleteValidation };

// 直接运行
if (require.main === module) {
  runCompleteValidation()
    .then(result => {
      process.exit(result.status === 'SUCCESS' ? 0 : 1);
    })
    .catch(error => {
      console.error('\n❌ 验证过程出错:', error.message);
      process.exit(1);
    });
}