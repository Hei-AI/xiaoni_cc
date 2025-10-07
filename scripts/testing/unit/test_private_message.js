#!/usr/bin/env node

// Queue simulator regression tests powered by Playwright MCP
const { request } = require('playwright');

const ADMIN_BASE_URL = process.env.ADMIN_BASE_URL || 'http://localhost:9080';
const PRIVATE_SIMULATE_PATH = '/api/simple-queue/simulate/private';
const GROUP_SIMULATE_PATH = '/api/simple-queue/simulate/group';

async function simulatePrivateMessage(api) {
  const payload = {
    user_id: 85178516,
    message: `Playwright MCP 私聊回归校验 ${new Date().toISOString()}`,
    priority: 'HIGH'
  };

  const response = await api.post(PRIVATE_SIMULATE_PATH, { data: payload });
  const body = await response.json();

  if (!response.ok() || !body?.success) {
    const errorDetail = body?.error || response.statusText();
    throw new Error(`模拟私聊消息失败 (status=${response.status()}, detail=${errorDetail})`);
  }

  console.log('✅ 已通过队列管理模拟器发送私聊消息');
  console.log('   • Trace ID:', body?.data?.traceId || '未知');
  console.log('   • Payload:', JSON.stringify(payload));
}

async function simulateGroupMessage(api) {
  const payload = {
    user_id: 85178516,
    group_id: 1019235326,
    message: `Playwright MCP 群聊回归校验 ${new Date().toISOString()}`,
    atBot: true,
    priority: 'MEDIUM'
  };

  const response = await api.post(GROUP_SIMULATE_PATH, { data: payload });
  const body = await response.json();

  if (!response.ok() || !body?.success) {
    const errorDetail = body?.error || response.statusText();
    throw new Error(`模拟群聊消息失败 (status=${response.status()}, detail=${errorDetail})`);
  }

  console.log('✅ 已通过队列管理模拟器发送群聊消息');
  console.log('   • Trace ID:', body?.data?.traceId || '未知');
  console.log('   • Payload:', JSON.stringify(payload));
}

async function runQueueSimulatorUseCases() {
  console.log('🚀 使用 Playwright MCP 触发队列管理消息模拟器...');
  console.log(`   • Admin API: ${ADMIN_BASE_URL}`);

  const api = await request.newContext({ baseURL: ADMIN_BASE_URL });

  try {
    await simulatePrivateMessage(api);
    await simulateGroupMessage(api);
    console.log('\n🎉 队列消息模拟用例执行完成');
  } finally {
    await api.dispose();
  }
}

runQueueSimulatorUseCases().catch((error) => {
  console.error('❌ 队列消息模拟用例执行失败:', error);
  process.exitCode = 1;
});
