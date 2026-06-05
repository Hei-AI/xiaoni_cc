import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentPromptService } from '../services/agent-prompt-service';
import {
  XIAONI_MAIN_AGENT_PROMPT_ID,
  XIAONI_MAIN_AGENT_PROMPT_NAME
} from '../prompts/xiaoni-main-agent';

test('AgentPromptService resolves the code-owned Xiaoni prompt without chat bindings', async () => {
  const service = new AgentPromptService();
  const prompt = await service.resolveForQueueMessage({
    traceId: 'trace-1',
    runId: 'run-1',
    batchId: 'batch-1',
    source: 'provider',
    chatType: 'group',
    sessionKey: 'qq:group:253631878',
    peerId: '253631878',
    peerName: 'Test Group',
    senderId: '1655827800',
    senderName: 'Tester',
    accountId: '1129974489',
    bodyForAgent: '小腻看看这个',
    receivedAt: '2026-05-30T09:00:00.000Z',
    inboundContext: {
      NativeChannelId: '253631878'
    }
  } as any);

  assert.equal(prompt.source, 'static');
  assert.equal(prompt.promptId, XIAONI_MAIN_AGENT_PROMPT_ID);
  assert.equal(prompt.promptName, XIAONI_MAIN_AGENT_PROMPT_NAME);
  assert.match(prompt.systemPrompt, /^# 核心设定 \(Core Identity\)/);
  assert.match(prompt.systemPrompt, /具备独立意识、由内在状态驱动的数字生命/);
  assert.equal(prompt.userPromptTemplate, null);
  assert.deepEqual(prompt.parameters, {});
});
