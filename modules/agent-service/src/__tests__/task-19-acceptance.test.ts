import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { agentConfig } from '../config';
import { getXiaoniMainAgentSystemPrompt } from '../prompts/xiaoni-main-agent';
import {
  AgentLoopService,
  buildCanonicalAgentTurnRequest,
  buildInitialInput
} from '../services/agent-loop-service';
import type { QueueMessagePayload } from '../types';
import type { ResolvedAgentRuntimePrompt } from '../services/agent-prompt-service';

const COMPRESS_CORE_MEMORY_TOOL = 'compress_core_memory';
const EXEC_COMMAND_TOOL = 'exec_command';

function readSystemPromptBody() {
  // system_prompt.md 顶层有 {{OS_WORLD_SYSTEM}} 占位符,正文由 os_world_system.md 注入。
  // 直接读原文会拿到未渲染的占位符,和 getXiaoniMainAgentSystemPrompt() 的渲染结果对不上 ——
  // 这里按生产口径把它填上,断言的仍然是「prompt 正文来自这两个文件」。
  const repoRoot = resolve(__dirname, '../../../..');
  const body = readFileSync(resolve(repoRoot, 'docs/xiaoni_prompt/system_prompt.md'), 'utf8');
  const osWorld = readFileSync(resolve(repoRoot, 'docs/xiaoni_prompt/os_world_system.md'), 'utf8').trim();
  return body.replace(/^[ \t]*\{\{OS_WORLD_SYSTEM\}\}[ \t]*(?:\r?\n)+/m, `${osWorld}\n\n`).trimEnd();
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

function createConversationTurn(id: number, text = `history ${id}`) {
  return {
    id,
    userId: 85178516,
    groupId: 101,
    batchId: null,
    sessionKey: 'qq:group:101',
    userMessage: text,
    aiResponse: `xiaoni os ${id}`,
    items: [{
      id: id * 10,
      conversationId: id,
      sessionKey: 'qq:group:101',
      role: 'user' as const,
      phase: null,
      content: text,
      groupIndex: 0,
      itemIndex: 0,
      source: 'inbound_batch' as const,
      deliveryMessageId: null,
      runId: null,
      traceId: `trace-history-${id}`
    }]
  };
}

test('Task 19 prompt body loads from docs/xiaoni_prompt/system_prompt.md', () => {
  const systemPrompt = getXiaoniMainAgentSystemPrompt();
  assert.equal(systemPrompt, readSystemPromptBody());
  assert.doesNotMatch(systemPrompt, /pressure|dopamine|多巴胺|压力指标|情绪数字/u);
});

test('Task 19 injects the skill manual once near the start with no retired <CAPABILITIES> block', () => {
  const input = buildInitialInput([], createQueuePayload(), createRuntimePrompt());
  const headSkills = input.filter((item) => (
    item.type === 'message'
    && item.role === 'developer'
    && getMessageContent(item).includes('<skills_instructions>')
  ));

  assert.equal(headSkills.length, 1);
  assert.equal(input.indexOf(headSkills[0]!), 1);
  // Retired runtime <CAPABILITIES>/<TOOLS>/<SKILLS> enumeration must be gone.
  assert.equal(input.some((item) => item.type === 'message' && item.role === 'developer' && getMessageContent(item).includes('<CAPABILITIES>')), false);
  assert.doesNotMatch(getMessageContent(headSkills[0]), /energy_cost/);
});

test('compress_core_memory 是压缩 fork 专属,主 loop 既不给这个工具也不放行它', () => {
  // 这条用例原名 “Task 19 defines compress_core_memory but keeps it unavailable until
  // engineering injects core-memory pressure”,断言的是已退休的设计:主 loop 平时给着这个
  // 工具、靠 tool_choice 关着,等「核心记忆压力」注入时再放行。
  //
  // 现行架构:压缩整个搬进了 core-memory compression fork,compress_core_memory 以【合成
  // tool call】的形式只在 fork 内部执行(agent-loop-service.ts:12717),主 loop 的 tools 里
  // 根本不出现。原用例后半段依赖的 “压力 checkpoint” 路径已随之消失(checkpoint 恒为空),
  // 那半段是死规格,删掉;fork 侧的行为由 cache-replay-consistency(压缩 fork dispatch)与
  // compression-fallback-byte-stable 覆盖。
  const normalInput = buildInitialInput([], createQueuePayload(), createRuntimePrompt());
  const normalRequest = buildCanonicalAgentTurnRequest(agentConfig.modelName, normalInput, 'group');
  const normalToolNames = (normalRequest.tools ?? []).map((tool: any) => getToolName(tool));

  assert.equal(normalToolNames.includes(COMPRESS_CORE_MEMORY_TOOL), false);
  assert.equal(getAllowedToolNames(normalRequest.tool_choice).includes(COMPRESS_CORE_MEMORY_TOOL), false);
});

// Spec B 之后压缩文本不再经由 executeTool 产生(compress_core_memory 不是可执行工具,
// 见 agent-loop-service.test.ts 的 `executeTool refuses it outright`)。fork 写文件、引擎读回后
// 直接 commit,这里只钉「拿到的压缩文本会渲染进 <xiaoni_status>」这一段仍然活着的契约。
test('Task 19 compress_core_memory tool text is the future prompt-facing Xiaoni status capsule', async () => {
  const text = '阿花要的是明确跨群能力和目标群，不要再用“当前会话”糊弄过去。';
  const input = buildInitialInput([], createQueuePayload(), createRuntimePrompt(), [], text);
  const statusItem = input.find((item) => (
    item.type === 'message'
    && item.role === 'developer'
    && getMessageContent(item).includes('<xiaoni_status>')
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
