import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { agentConfig } from '../config';
import { XIAONI_MAIN_AGENT_SYSTEM_PROMPT } from '../prompts/xiaoni-main-agent';
import {
  AgentLoopService,
  buildCanonicalAgentTurnRequest,
  buildInitialInput
} from '../services/agent-loop-service';
import type { QueueMessagePayload } from '../types';
import type { ResolvedAgentRuntimePrompt } from '../services/agent-prompt-service';

const COMPRESS_CORE_MEMORY_TOOL = 'compress_core_memory';

function readNextPromptBody() {
  const repoRoot = resolve(__dirname, '../../../..');
  const doc = readFileSync(resolve(repoRoot, 'docs/XIAONI_MAIN_PROMPT_NEXT.md'), 'utf8');
  const marker = '## Prompt Body\n\n';
  const markerIndex = doc.indexOf(marker);
  assert.notEqual(markerIndex, -1, 'XIAONI_MAIN_PROMPT_NEXT.md must keep a Prompt Body marker');
  return doc.slice(markerIndex + marker.length).trimEnd();
}

function getToolName(tool: { type: string; function?: { name?: string } }) {
  return tool.type === 'function' ? tool.function?.name : tool.type;
}

function getAllowedToolNames(toolChoice: unknown) {
  if (!toolChoice || typeof toolChoice !== 'object' || (toolChoice as any).type !== 'allowed_tools') {
    return [];
  }
  return Array.isArray((toolChoice as any).tools)
    ? (toolChoice as any).tools.map((tool: any) => tool.type === 'function' ? tool.name : tool.type)
    : [];
}

function getMessageContent(item: unknown) {
  if (!item || typeof item !== 'object' || !('type' in item) || (item as any).type !== 'message') {
    return '';
  }
  const content = (item as any).content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part) => {
    if (part?.type === 'input_text' || part?.type === 'output_text') return String(part.text || '');
    if (part?.type === 'refusal') return String(part.refusal || '');
    return '';
  }).join('\n');
}

function createRuntimePrompt(overrides: Partial<ResolvedAgentRuntimePrompt> = {}): ResolvedAgentRuntimePrompt {
  return {
    source: 'default',
    promptId: null,
    promptName: 'agent_loop_v1',
    systemPrompt: agentConfig.systemPrompt,
    identityGenesisSnapshot: agentConfig.systemPrompt,
    userPromptTemplate: null,
    contextVariables: {},
    runtimeVariables: {},
    modelName: agentConfig.modelName,
    parameters: {},
    ...overrides
  };
}

function createQueuePayload(): QueueMessagePayload {
  return {
    traceId: 'trace-task-19',
    runId: 'run-task-19',
    batchId: 'batch-task-19',
    source: 'napcat',
    chatType: 'group',
    sessionKey: 'qq:group:101',
    peerId: '101',
    peerName: 'Test Group',
    senderId: '202',
    senderName: 'Alice',
    accountId: '303',
    bodyForAgent: '问问@小腻 今天玩什么',
    rawBody: '问问@小腻 今天玩什么',
    commandBody: '',
    wasMentioned: true,
    receivedAt: '2026-06-04T08:00:00.000Z',
    messageTimestamp: '2026-06-04T08:00:00.000Z',
    rawPayload: {},
    inboundContext: {
      Body: '问问@小腻 今天玩什么',
      BodyForAgent: '问问@小腻 今天玩什么',
      BodyForCommands: '问问@小腻 今天玩什么',
      NativeChannelId: '101',
      MentionedUsers: [],
      CommandAuthorized: true
    },
    messages: []
  };
}

function createConversationTurn(id: number) {
  return {
    id,
    userId: 85178516,
    groupId: 101,
    batchId: null,
    sessionKey: 'qq:group:101',
    userMessage: `history ${id}`,
    aiResponse: `xiaoni os ${id}`,
    items: [{
      id: id * 10,
      conversationId: id,
      sessionKey: 'qq:group:101',
      role: 'user' as const,
      phase: null,
      content: `history ${id}`,
      groupIndex: 0,
      itemIndex: 0,
      source: 'inbound_batch' as const,
      deliveryMessageId: null,
      runId: null,
      traceId: `trace-history-${id}`
    }]
  };
}

test('Task 19 prompt body mirrors docs/XIAONI_MAIN_PROMPT_NEXT.md and keeps survival language', () => {
  assert.equal(XIAONI_MAIN_AGENT_SYSTEM_PROMPT, readNextPromptBody());
  assert.match(XIAONI_MAIN_AGENT_SYSTEM_PROMPT, new RegExp(COMPRESS_CORE_MEMORY_TOOL));
  assert.match(XIAONI_MAIN_AGENT_SYSTEM_PROMPT, /脑容量达到极限/);
  assert.doesNotMatch(XIAONI_MAIN_AGENT_SYSTEM_PROMPT, /pressure|dopamine|多巴胺|压力指标|情绪数字/u);
});

test('Task 19 injects CAPABILITIES once near the start and lists compress_core_memory cost', () => {
  const input = buildInitialInput([], createQueuePayload(), createRuntimePrompt());
  const capabilities = input.filter((item) => (
    item.type === 'message'
    && item.role === 'developer'
    && getMessageContent(item).includes('<CAPABILITIES>')
  ));

  assert.equal(capabilities.length, 1);
  assert.equal(input.indexOf(capabilities[0]!), 1);
  assert.match(getMessageContent(capabilities[0]), /compress_core_memory: energy_cost=0.020/);
});

test('Task 19 keeps compress_core_memory unavailable until engineering injects core-memory pressure', async () => {
  const normalInput = buildInitialInput([], createQueuePayload(), createRuntimePrompt());
  const normalRequest = buildCanonicalAgentTurnRequest(agentConfig.modelName, normalInput, 'group');
  assert.equal((normalRequest.tools ?? []).map((tool: any) => getToolName(tool)).includes(COMPRESS_CORE_MEMORY_TOOL), false);

  const service = new AgentLoopService({
    getSessionReadCutoffState: async () => null,
    upsertSessionReadCutoffState: async () => {
      throw new Error('read cutoff must be persisted only after compress_core_memory succeeds');
    }
  } as any);
  const plan = await (service as any).buildContextBudgetPlan({
    history: Array.from({ length: 201 }, (_, index) => createConversationTurn(index + 1)),
    queueMessage: createQueuePayload(),
    runtimePrompt: createRuntimePrompt(),
    loopContinuation: [],
    runtimeIdentityFacts: [],
    developerContextBlock: null,
    contextSessionKey: 'qq:group:101'
  });

  const pressureRequest = buildCanonicalAgentTurnRequest(agentConfig.modelName, plan.requestInput, 'group');
  const pressureToolNames = (pressureRequest.tools ?? []).map((tool: any) => getToolName(tool));
  const compressTool = (pressureRequest.tools ?? []).find((tool: any) => getToolName(tool) === COMPRESS_CORE_MEMORY_TOOL) as any;

  assert.match(JSON.stringify(plan.requestInput), /source=\\?"core_memory_pressure\\?"/);
  assert.deepEqual(getAllowedToolNames(pressureRequest.tool_choice), [COMPRESS_CORE_MEMORY_TOOL]);
  assert.ok(pressureToolNames.includes(COMPRESS_CORE_MEMORY_TOOL));
  assert.deepEqual(compressTool?.function?.parameters?.required, ['text']);
  assert.equal(compressTool?.function?.parameters?.additionalProperties, false);
});

test('Task 19 compress_core_memory tool text is the future prompt-facing Xiaoni status capsule', async () => {
  const service = new AgentLoopService({} as any);
  const text = '阿花要的是明确跨群能力和目标群，不要再用“当前会话”糊弄过去。';
  const result = await (service as any).executeTool({
    name: COMPRESS_CORE_MEMORY_TOOL,
    callId: 'compress-task-19',
    rawArguments: JSON.stringify({ text }),
    args: { text }
  }, createQueuePayload());

  assert.deepEqual(result, {
    compressed: true,
    text,
    outcome: 'core_memory_compressed'
  });

  const input = buildInitialInput([], createQueuePayload(), createRuntimePrompt(), [], text);
  const statusItem = input.find((item) => (
    item.type === 'message'
    && item.role === 'assistant'
    && getMessageContent(item).includes('<小腻近况>')
  ));

  assert.ok(statusItem);
  assert.match(getMessageContent(statusItem), new RegExp(text));
});

test('Task 19 main loop no longer schedules context_summary_writer after evicted turns', () => {
  const source = readFileSync(resolve(__dirname, '../../src/services/agent-loop-service.ts'), 'utf8');
  assert.match(source, /scheduleContextCompressionMemoryWriter\(\{/);
  assert.doesNotMatch(source, /scheduleContextSummaryWriter/);
  assert.doesNotMatch(source, /runContextSummaryWriter/);
  assert.doesNotMatch(source, /CONTEXT_SUMMARY_SUBAGENT_TYPE/);
  assert.match(source, /CONTEXT_COMPRESSION_MEMORY_SUBAGENT_TYPE/);
});
