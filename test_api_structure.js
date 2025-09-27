#!/usr/bin/env node
/**
 * 简化版API结构测试
 * 直接测试现有对话记录的API响应结构
 */

const axios = require('axios');

const CONFIG = {
  API_BASE_URL: 'http://localhost:9080'
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
  if (data && typeof data === 'object') {
    console.log('   ', JSON.stringify(data, null, 2));
  }
}

async function testAPIStructure() {
  console.log('🔍 测试 LLM Flow API 结构改进...\n');

  try {
    // 使用已知的对话记录ID进行测试
    log('INFO', '使用测试对话记录...');
    const conversationId = '48a706fa-a8ba-4573-bdd3-16b15841d835';

    log('SUCCESS', `找到最新对话记录 ID: ${conversationId}`);

    // 测试LLM Flow API
    log('INFO', '测试LLM Flow API响应结构...');
    const flowResponse = await axios.get(`${CONFIG.API_BASE_URL}/api/debug/conversation/${conversationId}/llm-flow`);
    const data = flowResponse.data;

    log('SUCCESS', 'API调用成功，开始验证结构...');

    // 基础字段验证
    const checks = [
      // 必需字段检查
      { field: 'conversation_id', exists: data.conversation_id !== undefined, type: typeof data.conversation_id },
      { field: 'trace_id', exists: data.trace_id !== undefined, type: typeof data.trace_id },

      // 新规范字段检查
      { field: 'message_input', exists: data.message_input !== undefined, type: typeof data.message_input },
      { field: 'message_output', exists: data.message_output !== undefined, type: typeof data.message_output },
      { field: 'llm_call_chain', exists: data.llm_call_chain !== undefined, type: typeof data.llm_call_chain, isArray: Array.isArray(data.llm_call_chain) },
      { field: 'processing_events', exists: data.processing_events !== undefined, type: typeof data.processing_events, isArray: Array.isArray(data.processing_events) },
      { field: 'flow_summary', exists: data.flow_summary !== undefined, type: typeof data.flow_summary },
      { field: 'debug_info', exists: data.debug_info !== undefined, type: typeof data.debug_info },

      // 向后兼容字段检查
      { field: 'websocket_input', exists: data.websocket_input !== undefined, type: typeof data.websocket_input },
      { field: 'websocket_output', exists: data.websocket_output !== undefined, type: typeof data.websocket_output },
      { field: 'llm_trace', exists: data.llm_trace !== undefined, type: typeof data.llm_trace, isArray: Array.isArray(data.llm_trace) },
      { field: 'timeline_events', exists: data.timeline_events !== undefined, type: typeof data.timeline_events, isArray: Array.isArray(data.timeline_events) }
    ];

    console.log('\n📋 字段结构检查结果:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    let passedChecks = 0;
    let totalChecks = checks.length;

    checks.forEach(check => {
      const status = check.exists ? '✅' : '❌';
      const arrayInfo = check.isArray !== undefined ? (check.isArray ? ' (数组)' : ' (非数组)') : '';
      console.log(`${status} ${check.field.padEnd(20)} | 存在: ${check.exists.toString().padEnd(5)} | 类型: ${check.type}${arrayInfo}`);
      if (check.exists) passedChecks++;
    });

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`通过率: ${passedChecks}/${totalChecks} (${Math.round((passedChecks/totalChecks)*100)}%)`);

    // 详细结构分析
    if (data.message_input) {
      console.log('\n🔍 message_input 结构分析:');
      Object.keys(data.message_input).forEach(key => {
        console.log(`  - ${key}: ${typeof data.message_input[key]} = ${JSON.stringify(data.message_input[key])}`);
      });
    }

    if (data.message_output) {
      console.log('\n🔍 message_output 结构分析:');
      Object.keys(data.message_output).forEach(key => {
        console.log(`  - ${key}: ${typeof data.message_output[key]} = ${JSON.stringify(data.message_output[key])}`);
      });
    }

    if (data.llm_call_chain && data.llm_call_chain.length > 0) {
      console.log('\n🔍 llm_call_chain 结构分析:');
      console.log(`  调用链长度: ${data.llm_call_chain.length}`);
      const firstCall = data.llm_call_chain[0];
      console.log('  第一个调用的字段:');
      Object.keys(firstCall).forEach(key => {
        console.log(`    - ${key}: ${typeof firstCall[key]}`);
      });

      if (firstCall.input) {
        console.log('  input 子字段:');
        Object.keys(firstCall.input).forEach(key => {
          console.log(`    - input.${key}: ${typeof firstCall.input[key]}`);
        });
      }

      if (firstCall.output) {
        console.log('  output 子字段:');
        Object.keys(firstCall.output).forEach(key => {
          console.log(`    - output.${key}: ${typeof firstCall.output[key]}`);
        });
      }
    }

    if (data.flow_summary) {
      console.log('\n🔍 flow_summary 结构分析:');
      Object.keys(data.flow_summary).forEach(key => {
        console.log(`  - ${key}: ${typeof data.flow_summary[key]} = ${data.flow_summary[key]}`);
      });
    }

    if (data.debug_info) {
      console.log('\n🔍 debug_info 结构分析:');
      Object.keys(data.debug_info).forEach(key => {
        const value = data.debug_info[key];
        if (Array.isArray(value)) {
          console.log(`  - ${key}: 数组 (${value.length} 项)`);
        } else if (typeof value === 'object') {
          console.log(`  - ${key}: 对象 (${Object.keys(value).length} 字段)`);
        } else {
          console.log(`  - ${key}: ${typeof value} = ${value}`);
        }
      });
    }

    // 规范符合性检查
    console.log('\n📐 规范符合性检查:');
    const compliance = {
      '新规范字段完整性': data.message_input && data.message_output && data.llm_call_chain && data.flow_summary && data.debug_info,
      '向后兼容性': data.websocket_input && data.websocket_output && data.llm_trace,
      'trace_id字段': data.trace_id !== undefined,
      '队列解耦特性': data.message_input && data.message_input.source && data.message_output && data.message_output.delivery_method === 'http_api',
      'LLM调用链非空': data.llm_call_chain && data.llm_call_chain.length > 0
    };

    Object.entries(compliance).forEach(([check, passed]) => {
      console.log(`${passed ? '✅' : '❌'} ${check}`);
    });

    const overallCompliance = Object.values(compliance).filter(Boolean).length / Object.keys(compliance).length;
    console.log(`\n总体规范符合率: ${Math.round(overallCompliance * 100)}%`);

    if (overallCompliance >= 0.8) {
      log('SUCCESS', '🎉 API结构改进验证通过！');
    } else {
      log('WARNING', '⚠️ API结构需要进一步改进');
    }

    return { conversationId, data, compliance: overallCompliance };

  } catch (error) {
    log('ERROR', `测试失败: ${error.message}`);
    if (error.response) {
      log('ERROR', `HTTP状态: ${error.response.status}`);
      log('ERROR', `响应内容: ${JSON.stringify(error.response.data)}`);
    }
    throw error;
  }
}

// 直接运行
if (require.main === module) {
  testAPIStructure()
    .then(result => {
      console.log('\n✅ 测试完成');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ 测试失败:', error.message);
      process.exit(1);
    });
}

module.exports = { testAPIStructure };