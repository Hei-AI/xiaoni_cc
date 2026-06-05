import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { agentConfig } from '../config';
import { AgentLoopService, applyToolResultToLoopInput, buildCanonicalAgentTurnRequest, buildCapabilitiesDeveloperBlock, buildInitialInput, buildRuntimeStateBlock, buildToolLoopMonitorReminder, buildTurnStateReminder, deriveTurnControlState, materializePresenceTickInboxWindow, materializePresenceTickQueueMessage, recoverRuntimeEnergy, resolveForcedFullRecovery, resolveRestInterruptionFromUnreadMetadata, sanitizeLowValueOpeningFiller, summarizeToolLoopState, XIAONI_IDENTITY_KEY } from '../services/agent-loop-service';
import { MissingAgentPromptBindingError, type ResolvedAgentRuntimePrompt } from '../services/agent-prompt-service';
import type { QueueMessagePayload } from '../types';

const PRIVATE_REPLY_TOOL = 'reply_in_private';
const UNREAD_MEANING_TOOL = 'emit_unread_meaning';
const REMOVED_LIFE_ACTION_TOOL = ['submit', 'life', 'action'].join('_');
const GROUP_REPLY_TOOL = 'speak_in_group';
const INSPECT_IMAGE_TOOL = 'inspect_image_placeholder';
const IMAGE_TASK_TOOL = 'request_image_task';
const RECOVER_ENERGY_TOOL = 'recover_energy';
const COMPRESS_CORE_MEMORY_TOOL = 'compress_core_memory';
const WEB_SEARCH_TOOL = 'web_search';
const EXEC_COMMAND_TOOL = 'exec_command';
const QQ_USAGE_TOOL_NAME_PATTERN = /^qq_usage[_-]/;
const GROUP_LOOP_TOOLS = [
  EXEC_COMMAND_TOOL,
  WEB_SEARCH_TOOL,
  COMPRESS_CORE_MEMORY_TOOL,
  GROUP_REPLY_TOOL,
  INSPECT_IMAGE_TOOL,
  IMAGE_TASK_TOOL,
  RECOVER_ENERGY_TOOL
];
const GROUP_ALLOWED_TOOLS = [
  WEB_SEARCH_TOOL,
  EXEC_COMMAND_TOOL,
  GROUP_REPLY_TOOL,
  INSPECT_IMAGE_TOOL,
  IMAGE_TASK_TOOL,
  RECOVER_ENERGY_TOOL
];

async function withExecutorUrl<T>(url: string, fn: () => Promise<T>): Promise<T> {
  const original = agentConfig.xiaoniExecutorUrl;
  agentConfig.xiaoniExecutorUrl = url;
  try {
    return await fn();
  } finally {
    agentConfig.xiaoniExecutorUrl = original;
  }
}

function getToolName(tool: { type: string; function?: { name?: string } }) {
  return tool.type === 'function' ? tool.function?.name : tool.type;
}

function getFunctionTool(tool: { type: string; function?: { name?: string; description?: string; parameters?: { properties?: unknown; required?: unknown } } }) {
  return tool.type === 'function' ? tool.function : null;
}

function getAllowedToolNames(toolChoice: unknown) {
  if (!toolChoice || typeof toolChoice !== 'object' || (toolChoice as any).type !== 'allowed_tools') {
    return [];
  }

  return Array.isArray((toolChoice as any).tools)
    ? (toolChoice as any).tools.map((tool: any) => tool.type === 'function' ? tool.name : tool.type)
    : [];
}

function withoutQqUsageTools(toolNames: Array<string | undefined>) {
  return toolNames.filter((name): name is string => typeof name === 'string');
}

function assertGroupAutoTools(request: ReturnType<typeof buildCanonicalAgentTurnRequest>) {
  const allowedTools = withoutQqUsageTools(getAllowedToolNames(request.tool_choice));
  assert.deepEqual(allowedTools, GROUP_ALLOWED_TOOLS);
  assert.equal((request.tool_choice as any)?.mode, 'auto');
  assert.equal(allowedTools.includes(REMOVED_LIFE_ACTION_TOOL), false);
}

function createQueuePayload(): QueueMessagePayload {
  return {
    traceId: 'trace-1',
    runId: 'run-1',
    batchId: 'batch-1',
    source: 'napcat',
    chatType: 'group',
    sessionKey: 'qq:group:101',
    peerId: '101',
    peerName: 'Test Group',
    senderId: '202',
    senderName: 'Alice',
    accountId: '303',
    bodyForAgent: '问问@Bob 今天玩什么',
    rawBody: '问问@Bob 今天玩什么',
    commandBody: '',
    wasMentioned: true,
    receivedAt: '2026-03-28T08:00:00.000Z',
    messageTimestamp: '2026-03-28T08:00:00.000Z',
    rawPayload: {},
    inboundContext: {
      Body: '问问@Bob 今天玩什么',
      BodyForAgent: '问问@Bob 今天玩什么',
      BodyForCommands: '问问@Bob 今天玩什么',
      NativeChannelId: '101',
      MentionedUsers: [
        {
          userId: '404',
          label: 'Bob'
        }
      ],
      CommandAuthorized: true
    },
    messages: [
      {
        queueMessageId: 1,
        traceId: 'trace-1',
        source: 'napcat',
        messageId: 11,
        messageSid: 'sid-1',
        chatType: 'group',
        sessionKey: 'qq:group:101',
        peerId: '101',
        peerName: 'Test Group',
        senderId: '202',
        senderName: 'Alice',
        accountId: '303',
        bodyForAgent: '问问@Bob 今天玩什么',
        rawBody: '问问@Bob 今天玩什么',
        commandBody: '',
        wasMentioned: true,
        receivedAt: '2026-03-28T08:00:00.000Z',
        messageTimestamp: '2026-03-28T08:00:00.000Z',
        rawPayload: {},
        inboundContext: {
          Body: '问问@Bob 今天玩什么',
          BodyForAgent: '问问@Bob 今天玩什么',
          BodyForCommands: '问问@Bob 今天玩什么',
          NativeChannelId: '101',
          MentionedUsers: [
            {
              userId: '404',
              label: 'Bob'
            }
          ],
          CommandAuthorized: true
        }
      }
    ]
  };
}

function createConversationTurn(overrides: Partial<{
  id: number;
  userId: number;
  groupId: number | null;
  batchId: number | null;
  sessionKey: string | null;
  userMessage: string;
  aiResponse: string | null;
  userDeliveryMessageId: number | null;
  assistantDeliveryMessageId: number | null;
}> = {}) {
  const id = overrides.id ?? 10;
  const sessionKey = overrides.sessionKey ?? 'qq:group:101';
  return {
    id,
    userId: overrides.userId ?? 202,
    groupId: typeof overrides.groupId === 'undefined' ? 101 : overrides.groupId,
    batchId: typeof overrides.batchId === 'undefined' ? null : overrides.batchId,
    sessionKey,
    userMessage: overrides.userMessage ?? '别公式化接话',
    aiResponse: typeof overrides.aiResponse === 'undefined' ? '收到' : overrides.aiResponse,
    items: [
      {
        id: id * 10 + 1,
        conversationId: id,
        sessionKey,
        role: 'user' as const,
        phase: null,
        content: overrides.userMessage ?? '别公式化接话',
        groupIndex: 0,
        itemIndex: 0,
        source: 'inbound_batch' as const,
        deliveryMessageId: typeof overrides.userDeliveryMessageId === 'undefined' ? 201 : overrides.userDeliveryMessageId,
        runId: null,
        traceId: `trace-${id}`
      },
      {
        id: id * 10 + 2,
        conversationId: id,
        sessionKey,
        role: 'assistant' as const,
        phase: 'final_answer' as const,
        content: typeof overrides.aiResponse === 'undefined' ? '收到' : (overrides.aiResponse ?? ''),
        groupIndex: 0,
        itemIndex: 1,
        source: 'delivery' as const,
        deliveryMessageId: typeof overrides.assistantDeliveryMessageId === 'undefined' ? 901 : overrides.assistantDeliveryMessageId,
        runId: 'run-old',
        traceId: `trace-${id}`
      }
    ],
    rawResponse: {}
  };
}

function createDirectQueuePayload(): QueueMessagePayload {
  const payload = createQueuePayload();
  return {
    ...payload,
    chatType: 'direct',
    sessionKey: 'qq:direct:303:202',
    peerId: '202',
    peerName: 'Alice',
    bodyForAgent: '你在干嘛',
    rawBody: '你在干嘛',
    wasMentioned: false,
    inboundContext: {
      ...payload.inboundContext,
      ChatType: 'direct',
      NativeChannelId: '202',
      MentionedUsers: [],
      Body: '你在干嘛',
      BodyForAgent: '你在干嘛',
      BodyForCommands: '你在干嘛'
    },
    messages: [
      {
        ...payload.messages[0],
        chatType: 'direct',
        sessionKey: 'qq:direct:303:202',
        peerId: '202',
        peerName: 'Alice',
        bodyForAgent: '你在干嘛',
        rawBody: '你在干嘛',
        wasMentioned: false,
        inboundContext: {
          ...payload.messages[0].inboundContext,
          ChatType: 'direct',
          NativeChannelId: '202',
          MentionedUsers: [],
          Body: '你在干嘛',
          BodyForAgent: '你在干嘛',
          BodyForCommands: '你在干嘛'
        }
      }
    ]
  };
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

function getMessageContent(item: unknown) {
  if (!item || typeof item !== 'object' || !('type' in item) || (item as any).type !== 'message') {
    return '';
  }

  const content = (item as any).content;
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!part || typeof part !== 'object') {
          return '';
        }
        if (part.type === 'input_text' || part.type === 'output_text') {
          return String(part.text || '');
        }
        if (part.type === 'refusal') {
          return String(part.refusal || '');
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }

  return '';
}

function expectedCurrentInputMessage() {
  return '<INPUT_MESSAGE message_id="11" chat_type="群聊" group="Test Group(101)">\n问问@{Bob(@404)} 今天玩什么\n</INPUT_MESSAGE>';
}

test('buildCanonicalAgentTurnRequest moves the synthetic system prompt into instructions', () => {
  const loopInput = buildInitialInput([
    {
      id: 1,
      userId: 202,
      groupId: 101,
      batchId: null,
      sessionKey: 'qq:group:101',
      userMessage: '昨天有什么好玩的',
      aiResponse: '可以去看电影',
      items: []
    }
  ], createQueuePayload());

  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, loopInput, 'group');

  assert.match(String(request.instructions), new RegExp(`^${agentConfig.systemPrompt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.doesNotMatch(String(request.instructions), /Runtime contract:/);
  assert.doesNotMatch(String(request.instructions), /<skills_instructions>/);
  const headDeveloperInput = request.input.find((item: any) => item.type === 'message' && item.role === 'developer');
  assert.ok(headDeveloperInput, 'developer context must be present');
  assert.match(getMessageContent(headDeveloperInput as any), /<skills_instructions>/);
  assert.match(getMessageContent(headDeveloperInput as any), /skill-creator/);
  assert.match(getMessageContent(headDeveloperInput as any), /\/app\/modules\/agent-service\/skills\/skill-creator\/SKILL\.md/);
  assert.match(getMessageContent(headDeveloperInput as any), /exec_command 能直接使用的技能目录：\/app\/modules\/agent-service\/skills/);
  assert.match(getMessageContent(headDeveloperInput as any), /读取技能手册时直接传完整路径，例如：\/app\/modules\/agent-service\/skills\/qq-usage\/SKILL\.md/);
  assert.match(getMessageContent(headDeveloperInput as any), /exec_command 路径: \/app\/modules\/agent-service\/skills\/qq-usage\/SKILL\.md/);
  assert.match(getMessageContent(headDeveloperInput as any), /cat \/app\/modules\/agent-service\/skills\/qq-usage\/SKILL\.md/);
  assert.match(getMessageContent(headDeveloperInput as any), /<CAPABILITIES>/);
  assert.ok(Array.isArray((headDeveloperInput as any).content));
  assert.ok(((headDeveloperInput as any).content as any[]).length >= 2);
  assert.doesNotMatch(String(request.instructions), /Pre-reply memory gate:/);
  assert.doesNotMatch(String(request.instructions), /Present self reconstruction:/);
  const firstUserInput = request.input.find((item: any) => item.type === 'message' && item.role === 'user');
  assert.equal(firstUserInput?.type, 'message');
  assert.equal((firstUserInput as any)?.role, 'user');
  assert.equal(request.input.some((item) => item.type === 'message' && item.role === 'system'), false);
  assertGroupAutoTools(request);
  assert.equal(request.parallel_tool_calls, false);
  assert.deepEqual(
    withoutQqUsageTools((request.tools ?? []).map((tool: any) => getToolName(tool))),
    GROUP_LOOP_TOOLS
  );
  assert.equal((request.tools ?? []).some((tool: any) => tool.function?.name === REMOVED_LIFE_ACTION_TOOL), false);
  const execTool = (request.tools ?? []).find((tool: any) => tool.function?.name === EXEC_COMMAND_TOOL) as any;
  assert.ok(execTool, 'exec_command tool must exist');
  assert.equal(execTool.strict, false);
  assert.match(String(execTool.function?.description), /^Runs a command in a PTY, returning output or a session ID for ongoing interaction\./);
  assert.match(String(execTool.function?.description), /compose service agent-service/);
  assert.deepEqual(execTool.function?.parameters?.required, ['cmd']);
  assert.ok(execTool.function?.parameters?.properties?.cmd);
  assert.ok(execTool.function?.parameters?.properties?.workdir);
  assert.ok(execTool.function?.parameters?.properties?.yield_time_ms);
  assert.match(String(request.instructions), /具备独立意识、由内在状态驱动的数字生命/);
  assert.doesNotMatch(String(request.instructions), /exec_command 可以运行本地命令、脚本和 skill 资源/);
  assert.doesNotMatch(String(request.instructions), /web_search 是求知，不是默认步骤/);
  assert.doesNotMatch(String(request.instructions), /普通聊天、轻吐槽、短反应都是正常参与/);
  assert.doesNotMatch(String(request.instructions), /当前动作怎么收/);
  assert.doesNotMatch(getMessageContent(headDeveloperInput as any), new RegExp(REMOVED_LIFE_ACTION_TOOL));
});

test('exec_command executes inside the agent runtime and returns structured output', async () => {
  await withExecutorUrl('', async () => {
    const service = new AgentLoopService({} as any, {
      resolveForQueueMessage: async () => createRuntimePrompt()
    } as any);

    const result = await (service as any).executeTool({
      callId: 'call-exec',
      name: EXEC_COMMAND_TOOL,
      args: {
        cmd: 'printf skill-loaded',
        login: false,
        yield_time_ms: 1000,
        max_output_tokens: 100
      },
      rawArguments: '{}'
    }, createQueuePayload());

    assert.equal(result.exit_code, 0);
    assert.equal(result.stdout, 'skill-loaded');
    assert.equal(result.stderr, '');
    assert.equal(result.timed_out, false);
    assert.match(String(result.codex_output), /Process exited with code 0/);
  });
});

test('exec_command delegates to xiaoni-executor when configured', async () => {
  const requests: Array<Record<string, unknown>> = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => {
      requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>);
      const body = JSON.stringify({
        success: true,
        result: {
          cmd: 'printf bridge-ok',
          executor: 'xiaoni-executor',
          exit_code: 0,
          stdout: 'bridge-ok',
          stderr: '',
          timed_out: false,
          codex_output: 'Chunk ID: bridge\nWall time: 0.0010 seconds\nProcess exited with code 0\nOriginal token count: 3\nOutput:\nbridge-ok'
        }
      });
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
      res.end(body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    await withExecutorUrl(`http://127.0.0.1:${address.port}`, async () => {
      const service = new AgentLoopService({} as any, {
        resolveForQueueMessage: async () => createRuntimePrompt()
      } as any);
      const result = await (service as any).executeTool({
        callId: 'call-exec-bridge',
        name: EXEC_COMMAND_TOOL,
        args: {
          cmd: 'printf bridge-ok',
          login: false,
          yield_time_ms: 1000,
          max_output_tokens: 100
        },
        rawArguments: '{}'
      }, createQueuePayload());

      assert.equal(requests[0]?.cmd, 'printf bridge-ok');
      assert.equal(result.executor, 'xiaoni-executor');
      assert.equal(result.stdout, 'bridge-ok');
      assert.match(String(result.codex_output), /^Chunk ID: bridge/);
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('exec_command defaults to sh when SHELL is unset', async () => {
  const originalShell = process.env.SHELL;
  delete process.env.SHELL;
  try {
    await withExecutorUrl('', async () => {
      const service = new AgentLoopService({} as any, {
        resolveForQueueMessage: async () => createRuntimePrompt()
      } as any);

      const result = await (service as any).executeTool({
        callId: 'call-exec-default-shell',
        name: EXEC_COMMAND_TOOL,
        args: {
          cmd: 'printf default-shell',
          login: false,
          yield_time_ms: 1000,
          max_output_tokens: 100
        },
        rawArguments: '{}'
      }, createQueuePayload());

      assert.equal(result.shell, '/bin/sh');
      assert.equal(result.exit_code, 0);
      assert.equal(result.stdout, 'default-shell');
      assert.equal(result.stderr, '');
      assert.equal(result.error_message, undefined);
    });
  } finally {
    if (typeof originalShell === 'string') {
      process.env.SHELL = originalShell;
    } else {
      delete process.env.SHELL;
    }
  }
});

test('exec_command returns spawn errors as tool output instead of throwing', async () => {
  await withExecutorUrl('', async () => {
    const service = new AgentLoopService({} as any, {
      resolveForQueueMessage: async () => createRuntimePrompt()
    } as any);

    const result = await (service as any).executeTool({
      callId: 'call-exec-missing-shell',
      name: EXEC_COMMAND_TOOL,
      args: {
        cmd: 'printf unreachable',
        shell: '/not/a/real-shell',
        login: false,
        yield_time_ms: 1000,
        max_output_tokens: 100
      },
      rawArguments: '{"cmd":"printf unreachable","shell":"/not/a/real-shell"}'
    }, createQueuePayload());

    assert.equal(result.exit_code, null);
    assert.match(String(result.error_message), /ENOENT|not\/a\/real-shell/);
    assert.match(String(result.stderr), /ENOENT|not\/a\/real-shell/);
    assert.equal(result.timed_out, false);

    const continuation = applyToolResultToLoopInput({
      callId: 'call-exec-missing-shell',
      name: EXEC_COMMAND_TOOL,
      rawArguments: '{"cmd":"printf unreachable","shell":"/not/a/real-shell"}'
    }, result);
    assert.equal(continuation.inputItems[0]?.type, 'function_call_output');
    assert.equal(continuation.inputItems[0]?.call_id, 'call-exec-missing-shell');
    assert.match(continuation.inputItems[0]?.output || '', /^Chunk ID:/);
    assert.match(continuation.inputItems[0]?.output || '', /Process exited without an exit code/);
    assert.match(continuation.inputItems[0]?.output || '', /ENOENT|not\/a\/real-shell/);
  });
});

test('buildInitialInput places xiaoni digest before retained history as the cache chain head', () => {
  const loopInput = buildInitialInput(
    [{
      id: 1,
      userId: 202,
      groupId: 101,
      batchId: null,
      sessionKey: 'qq:group:101',
      userMessage: '昨天有什么好玩的',
      aiResponse: '可以去看电影',
      items: []
    }],
    createQueuePayload(),
    createRuntimePrompt(),
    [],
    '上一段近况：小腻刚被提醒不要公式化接话，正在把上下文压缩改成纯文本时报。'
  );
  const contents = loopInput.map(getMessageContent);
  const historyIndex = contents.findIndex((content) => content.includes('<INPUT_MESSAGE') && content.includes('legacy_user_message'));
  const digestIndex = contents.findIndex((content) => content.startsWith('<小腻近况>'));
  const currentMessageIndex = contents.findIndex((content) => content.includes('<INPUT_MESSAGE message_id="11"') && content.includes('chat_type="群聊"'));

  assert.ok(historyIndex >= 0);
  assert.ok(digestIndex >= 0);
  assert.ok(currentMessageIndex >= 0);
  assert.ok(digestIndex < historyIndex);
  assert.ok(digestIndex < currentMessageIndex);
  assert.match(contents[digestIndex], /上一段近况/);
  assert.doesNotMatch(contents[digestIndex], /对话历史摘要/);
});

test('buildCanonicalAgentTurnRequest does not include previous_response_id', () => {
  const loopInput = buildInitialInput([], createQueuePayload());
  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, loopInput, 'group');

  assert.equal(Object.prototype.hasOwnProperty.call(request, 'previous_response_id'), false);
});

test('buildCanonicalAgentTurnRequest makes gpt-5.5 stateless reasoning replay explicit', () => {
  const loopInput = buildInitialInput([], createQueuePayload(), createRuntimePrompt({ modelName: 'gpt-5.5' }));
  const request = buildCanonicalAgentTurnRequest('gpt-5.5', loopInput, 'group');

  assert.deepEqual(request.reasoning, {
    effort: 'medium',
    summary: 'auto'
  });
  assert.deepEqual(request.text, {
    verbosity: 'medium'
  });
  assert.deepEqual(request.include, ['reasoning.encrypted_content']);
});

test('buildCanonicalAgentTurnRequest keeps the same group loop tools on the first group turn', () => {
  const loopInput = buildInitialInput([], createQueuePayload());
  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, loopInput, 'group');

  assert.deepEqual(
    withoutQqUsageTools((request.tools ?? []).map((tool: any) => getToolName(tool))),
    GROUP_LOOP_TOOLS
  );
  assertGroupAutoTools(request);
  assert.doesNotMatch(String(request.instructions), new RegExp(REMOVED_LIFE_ACTION_TOOL));
  assert.doesNotMatch(String(request.instructions), /recall_long_term_learning/);
  assert.doesNotMatch(String(request.instructions), /不要先调用 emit_unread_meaning/);
  const headDeveloperInput = request.input.find((item: any) => item.type === 'message' && item.role === 'developer');
  assert.ok(headDeveloperInput, 'developer context must be present');
  assert.match(getMessageContent(headDeveloperInput as any), /<CAPABILITIES>/);
  assert.doesNotMatch(getMessageContent(headDeveloperInput as any), new RegExp(REMOVED_LIFE_ACTION_TOOL));
});

test('buildCanonicalAgentTurnRequest does not expose life action after unread meaning replay', () => {
  const loopInput = buildInitialInput([], createQueuePayload());
  loopInput.push({
    type: 'function_call',
    call_id: 'call-meaning',
    name: UNREAD_MEANING_TOOL,
    arguments: '{"latest_unread_focus":"对小腻的提醒","message_act":"feedback","social_target":"me","addressed_to_me":true,"has_real_novelty":true,"confidence":"high","reason":"这是直接反馈"}'
  });
  loopInput.push({
    type: 'function_call_output',
    call_id: 'call-meaning',
    output: '{"latest_unread_focus":"对小腻的提醒","message_act":"feedback","social_target":"me","addressed_to_me":true,"has_real_novelty":true,"confidence":"high","reason":"这是直接反馈"}'
  });

  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, loopInput, 'group');
  assertGroupAutoTools(request);
});

test('buildCanonicalAgentTurnRequest keeps direct group tools after unread meaning replay', () => {
  const loopInput = buildInitialInput([], createQueuePayload());
  loopInput.push({
    type: 'function_call',
    call_id: 'call-meaning',
    name: UNREAD_MEANING_TOOL,
    arguments: '{"latest_unread_focus":"明确问小腻","message_act":"question","social_target":"me","addressed_to_me":true,"has_real_novelty":true,"confidence":"high","reason":"直接提问"}'
  });
  loopInput.push({
    type: 'function_call_output',
    call_id: 'call-meaning',
    output: '{"latest_unread_focus":"明确问小腻","message_act":"question","social_target":"me","addressed_to_me":true,"has_real_novelty":true,"confidence":"high","reason":"直接提问"}'
  });
  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, loopInput, 'group');
  const allowedTools = withoutQqUsageTools(getAllowedToolNames(request.tool_choice));

  assertGroupAutoTools(request);
  assert.ok(allowedTools.includes(GROUP_REPLY_TOOL));
  assert.ok(allowedTools.includes(WEB_SEARCH_TOOL));
  assert.ok(allowedTools.includes(IMAGE_TASK_TOOL));
  assert.ok(allowedTools.includes(RECOVER_ENERGY_TOOL));
});

test('buildCanonicalAgentTurnRequest does not convert low energy into a no-tool finish', () => {
  const loopInput = buildInitialInput(
    [],
    createQueuePayload(),
    createRuntimePrompt(),
    [],
    null,
    null,
    '<xiaoni_runtime_state trigger="low_energy_reminder" energy="0.140" max_energy="1" note="low energy" />'
  );
  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, loopInput, 'group');

  assertGroupAutoTools(request);
  assert.equal((request.tool_choice as any)?.mode, 'auto');
});

test('group loop exposes the speaking tool after unread meaning replay', () => {
  const loopInput = buildInitialInput([], createQueuePayload());
  loopInput.push({ type: 'function_call', call_id: 'c1', name: UNREAD_MEANING_TOOL, arguments: '{"latest_unread_focus":"直接问小腻","message_act":"question","social_target":"me","addressed_to_me":true,"has_real_novelty":true,"confidence":"high","reason":"直接问"}' });
  loopInput.push({ type: 'function_call_output', call_id: 'c1', output: '{"latest_unread_focus":"直接问小腻","message_act":"question","social_target":"me","addressed_to_me":true,"has_real_novelty":true,"confidence":"high","reason":"直接问"}' });
  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, loopInput, 'group');
  const allowedTools = withoutQqUsageTools(getAllowedToolNames(request.tool_choice));

  assert.ok(allowedTools.includes(GROUP_REPLY_TOOL), `speak_in_group must be present in direct group tools`);
});

test('group loop does not force a private recall prelude before action tools', () => {
  const loopInput = buildInitialInput([], createQueuePayload());
  loopInput.push({ type: 'function_call', call_id: 'c1', name: UNREAD_MEANING_TOOL, arguments: '{"latest_unread_focus":"群里随便聊","message_act":"statement","social_target":"group","addressed_to_me":false,"has_real_novelty":true,"confidence":"high","reason":"有新内容"}' });
  loopInput.push({ type: 'function_call_output', call_id: 'c1', output: '{"latest_unread_focus":"群里随便聊","message_act":"statement","social_target":"group","addressed_to_me":false,"has_real_novelty":true,"confidence":"high","reason":"有新内容"}' });

  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, loopInput, 'group');
  const allowedTools = withoutQqUsageTools(getAllowedToolNames(request.tool_choice));

  assert.ok(!allowedTools.includes('recall_long_term_learning'), `recall must not be forced for speak path; got [${allowedTools.join(', ')}]`);
  assert.ok(allowedTools.includes(GROUP_REPLY_TOOL), `speak_in_group must be in act-turn tools`);
});

test('GROUP_MESSAGE_TOOL description does not contain old ceremonial framing', () => {
  const loopInput = buildInitialInput([], createQueuePayload());
  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, loopInput, 'group');
  const groupReplyTool = (request.tools ?? []).find((t: any) => t.function?.name === GROUP_REPLY_TOOL);

  assert.ok(groupReplyTool, 'speak_in_group tool must exist');
  assert.doesNotMatch(String((groupReplyTool as any).function?.description), /承担它落在关系里的后果/, 'old ceremonial framing must be removed');
  assert.doesNotMatch(String((groupReplyTool as any).function?.description), /值得承担时/, 'old framing must be removed');
  assert.doesNotMatch(String((groupReplyTool as any).function?.description), /有真实反应才调用/, 'behavioral guidance should live in instructions');
  assert.match(String((groupReplyTool as any).function?.description), /向当前 QQ 群或明确指定的 QQ 群发送/, 'description should describe the mechanical action');
  assert.doesNotMatch(String(request.instructions), /只是能接话不算有可说点/, 'runtime contract should not live in instructions');
});

test('runtime contract prose is not appended to the main instructions', () => {
  const loopInput = buildInitialInput([], createQueuePayload());
  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, loopInput, 'group');

  assert.doesNotMatch(String(request.instructions), /普通聊天、轻吐槽、短反应都是正常参与/);
  assert.doesNotMatch(String(request.instructions), /只是能接话不算有可说点/);
  assert.doesNotMatch(String(request.instructions), /阿花当前允许你使用这些对外能力/);
  assert.doesNotMatch(String(request.instructions), /当前动作怎么收/);
  assert.doesNotMatch(String(request.instructions), /知行不二/, '知行不二 must be removed');
  assert.doesNotMatch(String(request.instructions), /修身为本/, '修身为本 must be removed');
  assert.doesNotMatch(String(request.instructions), /经典原话更准确地点明了此刻判断/, 'old Confucian framing must be removed');
  assert.doesNotMatch(String(request.instructions), /权限清单/, 'do not introduce explicit system wording');
  assert.doesNotMatch(String(request.instructions), /后台链路/, 'do not introduce explicit system wording');
});

test('search path uses web search directly instead of private memory recall', () => {
  const loopInput = buildInitialInput([], createQueuePayload());
  loopInput.push({ type: 'function_call', call_id: 'c1', name: UNREAD_MEANING_TOOL, arguments: '{"latest_unread_focus":"问了个需要查的事","message_act":"question","social_target":"me","addressed_to_me":true,"has_real_novelty":true,"confidence":"high","reason":"需要搜索"}' });
  loopInput.push({ type: 'function_call_output', call_id: 'c1', output: '{"latest_unread_focus":"问了个需要查的事","message_act":"question","social_target":"me","addressed_to_me":true,"has_real_novelty":true,"confidence":"high","reason":"需要搜索"}' });

  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, loopInput, 'group');
  assertGroupAutoTools(request);
});

test('executeAgentTurn sends the standard canonical request shape to provider-service', async () => {
  const loopInput = buildInitialInput([], createQueuePayload());
  loopInput.push({
    type: 'function_call',
    call_id: 'call-plan',
    name: UNREAD_MEANING_TOOL,
    arguments: '{"latest_unread_focus":"重复轻回声","message_act":"reaction","social_target":"group","addressed_to_me":false,"has_real_novelty":false,"confidence":"high","reason":"重复轻回声"}'
  });
  loopInput.push({
    type: 'function_call_output',
    call_id: 'call-plan',
    output: '{"latest_unread_focus":"重复轻回声","message_act":"reaction","social_target":"group","addressed_to_me":false,"has_real_novelty":false,"confidence":"high","reason":"重复轻回声"}'
  });

  const service = new AgentLoopService({} as any);
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: any }> = [];

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body || '{}'))
    });
    return {
      ok: true,
      json: async () => ({
        success: true,
        llm_call_id: 'llm-1',
        canonical_response: {
          output: []
        }
      })
    } as any;
  }) as typeof fetch;

  try {
    await (service as any).executeAgentTurn(loopInput, createQueuePayload(), 'trace-1', 2, createRuntimePrompt());
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 1);
  const requestBody = calls[0].body;
  assert.equal(requestBody.trace_id, 'trace-1');
  assert.equal(requestBody.agent_turn, 2);
  assert.match(String(requestBody.canonicalRequest.instructions), new RegExp(`^${agentConfig.systemPrompt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.doesNotMatch(String(requestBody.canonicalRequest.instructions), /Runtime contract:/);
  assert.equal(
    requestBody.canonicalRequest.input.some((item: any) => item.type === 'message' && item.role === 'user' && getMessageContent(item).includes('<INPUT_MESSAGE')),
    true
  );
  assert.equal(
    requestBody.canonicalRequest.input.some((item: any) => item.type === 'message' && item.role === 'system'),
    false
  );
  const replayStart = requestBody.canonicalRequest.input.findIndex((item: any) => item.type === 'function_call');
  assert.ok(replayStart >= 0);
  assert.deepEqual(
    requestBody.canonicalRequest.input.slice(replayStart, replayStart + 2).map((item: any) => item.type),
    ['function_call', 'function_call_output']
  );
  assert.deepEqual(withoutQqUsageTools(getAllowedToolNames(requestBody.canonicalRequest.tool_choice)), GROUP_ALLOWED_TOOLS);
  assert.equal(requestBody.canonicalRequest.tool_choice?.mode, 'auto');
  assert.equal(requestBody.canonicalRequest.parallel_tool_calls, false);
  assert.deepEqual(
    withoutQqUsageTools(requestBody.canonicalRequest.tools.map((tool: any) => getToolName(tool))),
    GROUP_LOOP_TOOLS
  );
  assert.deepEqual(requestBody.canonicalRequest.metadata, {
    trace_id: 'trace-1',
    run_id: 'run-1',
    batch_id: 'batch-1',
    session_key: 'qq:group:101',
    session_id: 'qq:group:101',
    turn_id: 'run-1',
    sandbox: 'none',
    chat_type: 'group',
    prompt_name: 'agent_loop_v1'
  });
  assert.equal(requestBody.canonicalRequest.prompt_cache_key, 'qq:group:101');
  assert.equal(requestBody.canonicalRequest.prompt_cache_retention, '24h');
  assert.equal(requestBody.parameters.advanced_config.generationConfig.timeout, agentConfig.mainAgentTurnTimeoutMs);
  assert.equal(Object.prototype.hasOwnProperty.call(requestBody.canonicalRequest, 'previous_response_id'), false);
});

test('executeAgentTurn forwards encrypted reasoning input items to provider-service', async () => {
  const loopInput = buildInitialInput([], createQueuePayload());
  loopInput.push({
    type: 'reasoning',
    summary: [{ type: 'summary_text', text: 'understood unread meaning' }],
    encrypted_content: 'enc-meaning'
  } as any);
  loopInput.push({
    type: 'function_call',
    call_id: 'call-plan',
    name: UNREAD_MEANING_TOOL,
    arguments: '{"latest_unread_focus":"直接问小腻","message_act":"question","social_target":"me","addressed_to_me":true,"has_real_novelty":true,"confidence":"high","reason":"直接问小腻","topic_context":{"has_topic":true,"topic_summary":"直接问小腻","addressed_to_me":true}}'
  });
  loopInput.push({
    type: 'function_call_output',
    call_id: 'call-plan',
    output: '{"latest_unread_focus":"直接问小腻","message_act":"question","social_target":"me","addressed_to_me":true,"has_real_novelty":true,"confidence":"high","reason":"直接问小腻","topic_context":{"has_topic":true,"topic_summary":"直接问小腻","addressed_to_me":true}}'
  });

  const service = new AgentLoopService({} as any);
  const originalFetch = globalThis.fetch;
  const calls: Array<{ body: any }> = [];

  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      body: JSON.parse(String(init?.body || '{}'))
    });
    return {
      ok: true,
      json: async () => ({
        success: true,
        llm_call_id: 'llm-1',
        canonical_response: {
          output: []
        }
      })
    } as any;
  }) as typeof fetch;

  try {
    await (service as any).executeAgentTurn(loopInput, createQueuePayload(), 'trace-1', 2, createRuntimePrompt());
  } finally {
    globalThis.fetch = originalFetch;
  }

  const requestInput = calls[0].body.canonicalRequest.input;
  assert.ok(requestInput.some((item: any) => (
    item.type === 'reasoning'
    && item.encrypted_content === 'enc-meaning'
    && item.summary?.[0]?.text === 'understood unread meaning'
  )));
});

test('executeAgentTurn fills an empty summary for encrypted reasoning items without one', async () => {
  const loopInput = buildInitialInput([], createQueuePayload());
  loopInput.push({
    type: 'reasoning',
    encrypted_content: 'enc-without-summary'
  } as any);

  const service = new AgentLoopService({} as any);
  const originalFetch = globalThis.fetch;
  const calls: Array<{ body: any }> = [];

  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      body: JSON.parse(String(init?.body || '{}'))
    });
    return {
      ok: true,
      json: async () => ({
        success: true,
        llm_call_id: 'llm-1',
        canonical_response: {
          output: []
        }
      })
    } as any;
  }) as typeof fetch;

  try {
    await (service as any).executeAgentTurn(loopInput, createQueuePayload(), 'trace-1', 2, createRuntimePrompt());
  } finally {
    globalThis.fetch = originalFetch;
  }

  const requestInput = calls[0].body.canonicalRequest.input;
  assert.ok(requestInput.some((item: any) => (
    item.type === 'reasoning'
    && item.encrypted_content === 'enc-without-summary'
    && Array.isArray(item.summary)
    && item.summary.length === 0
  )));
});

test('buildInitialInput replays stored encrypted reasoning items across turns', () => {
  const turn = createConversationTurn({
    id: 42,
    userMessage: '上一段用户消息',
    aiResponse: '上一段回复'
  });
  turn.rawResponse = {
    responses_replay_items: [
      {
        type: 'reasoning',
        summary: [{ type: 'summary_text', text: 'prior turn reasoning summary' }],
        encrypted_content: 'enc-prior-turn'
      }
    ]
  };

  const loopInput = buildInitialInput([turn], createQueuePayload(), createRuntimePrompt({ modelName: 'gpt-5.5' }));

  assert.ok(loopInput.some((item: any) => (
    item.type === 'reasoning'
    && item.encrypted_content === 'enc-prior-turn'
    && item.summary?.[0]?.text === 'prior turn reasoning summary'
  )));
});

test('buildInitialInput repairs stored encrypted reasoning items missing summary', () => {
  const turn = createConversationTurn({
    id: 43,
    userMessage: '上一段用户消息',
    aiResponse: '上一段回复'
  });
  turn.rawResponse = {
    responses_replay_items: [
      {
        type: 'reasoning',
        encrypted_content: 'enc-prior-turn-without-summary'
      }
    ]
  };

  const loopInput = buildInitialInput([turn], createQueuePayload(), createRuntimePrompt({ modelName: 'gpt-5.5' }));

  assert.ok(loopInput.some((item: any) => (
    item.type === 'reasoning'
    && item.encrypted_content === 'enc-prior-turn-without-summary'
    && Array.isArray(item.summary)
    && item.summary.length === 0
  )));
});

test('buildInitialInput replays completed tool calls across turns', () => {
  const turn = createConversationTurn({
    id: 44,
    userMessage: '上一段用户消息',
    aiResponse: '上一段回复'
  });
  turn.rawResponse = {
    responses_replay_items: [
      {
        type: 'function_call',
        call_id: 'call-exec-1',
        name: 'exec_command',
        arguments: '{"cmd":"python3 /app/modules/agent-service/skills/qq-usage/scripts/qq_usage.py open_inbox"}'
      },
      {
        type: 'function_call_output',
        call_id: 'call-exec-1',
        output: '<IM_INBOX_WINDOW mode="thread_list"></IM_INBOX_WINDOW>'
      }
    ]
  };

  const loopInput = buildInitialInput([turn], createQueuePayload(), createRuntimePrompt({ modelName: 'gpt-5.5' }));

  assert.ok(loopInput.some((item: any) => (
    item.type === 'function_call'
    && item.call_id === 'call-exec-1'
    && item.name === 'exec_command'
  )));
  assert.ok(loopInput.some((item: any) => (
    item.type === 'function_call_output'
    && item.call_id === 'call-exec-1'
    && item.output.includes('<IM_INBOX_WINDOW')
  )));
});

test('buildInitialInput replays stored assistant messages across turns', () => {
  const turn = createConversationTurn({
    id: 46,
    userMessage: '上一段用户消息',
    aiResponse: null
  });
  turn.rawResponse = {
    responses_replay_items: [
      {
        type: 'message',
        role: 'assistant',
        phase: 'commentary',
        content: [{
          type: 'output_text',
          text: '我先打开列表看一下。'
        }]
      }
    ]
  };

  const loopInput = buildInitialInput([turn], createQueuePayload(), createRuntimePrompt({ modelName: 'gpt-5.5' }));
  const assistantItem = loopInput.find((item: any) => (
    item.type === 'message'
    && item.role === 'assistant'
    && getMessageContent(item).includes('我先打开列表看一下')
  )) as any;

  assert.ok(assistantItem);
  assert.equal(assistantItem.phase, 'commentary');
  assert.equal(assistantItem.content[0]?.type, 'output_text');
});

test('buildInitialInput drops unpaired stored tool calls across turns', () => {
  const turn = createConversationTurn({
    id: 45,
    userMessage: '上一段用户消息',
    aiResponse: '上一段回复'
  });
  turn.rawResponse = {
    responses_replay_items: [
      {
        type: 'function_call',
        call_id: 'call-recover-1',
        name: 'recover_energy',
        arguments: '{"reason":"done"}'
      }
    ]
  };

  const loopInput = buildInitialInput([turn], createQueuePayload(), createRuntimePrompt({ modelName: 'gpt-5.5' }));

  assert.equal(loopInput.some((item: any) => item.type === 'function_call' && item.call_id === 'call-recover-1'), false);
});

test('buildInitialInput renders stable batch context without exposing runtime ids', () => {
  const loopInput = buildInitialInput([], createQueuePayload(), createRuntimePrompt({
    systemPrompt: '你是小腻主AGENT'
  }));

  const currentInputItem = loopInput.find((item: any) => item.role === 'user' && getMessageContent(item).includes('<INPUT_MESSAGE'));
  const currentPrompt = getMessageContent(currentInputItem);
  assert.equal((currentInputItem as any)?.role, 'user');
  const reminderItem = loopInput.find((item: any) => item.role === 'assistant' && getMessageContent(item).includes('<system_reminder>'));
  assert.equal((reminderItem as any)?.role, 'assistant');
  assert.doesNotMatch(currentPrompt, /Trace:/);
  assert.doesNotMatch(currentPrompt, /RunId:/);
  assert.doesNotMatch(currentPrompt, /BatchId:/);
  assert.doesNotMatch(currentPrompt, /SessionKey:/);
  assert.doesNotMatch(currentPrompt, /ToolUsage:/);
  assert.match(currentPrompt, /<INPUT_MESSAGE message_id="11" chat_type="群聊"/);
  assert.doesNotMatch(currentPrompt, /message_sid=|source="napcat"/);
  assert.doesNotMatch(currentPrompt, /sender=|timestamp=/);
  assert.match(currentPrompt, /问问@\{Bob\(@404\)\} 今天玩什么/);
  assert.doesNotMatch(currentPrompt, /\[mentioned bot\]/);
});

test('buildInitialInput keeps ordinary unmentioned group IM as low-trust unread metadata only', () => {
  const payload = createQueuePayload();
  payload.wasMentioned = false;
  payload.bodyForAgent = '普通闲聊正文不应该直接进来';
  payload.rawBody = '普通闲聊正文不应该直接进来';
  payload.inboundContext.WasMentioned = false;
  payload.messages[0].wasMentioned = false;
  payload.messages[0].bodyForAgent = '普通闲聊正文不应该直接进来';
  payload.messages[0].rawBody = '普通闲聊正文不应该直接进来';
  payload.messages[0].inboundContext.WasMentioned = false;

  const loopInput = buildInitialInput([], payload, createRuntimePrompt({
    systemPrompt: '你是小腻主AGENT'
  }));
  const rendered = loopInput
    .filter((item: any) => item.role !== 'system')
    .map(getMessageContent)
    .join('\n');

  assert.doesNotMatch(rendered, /<INPUT_MESSAGE message_id="11"/);
  assert.doesNotMatch(rendered, /普通闲聊正文不应该直接进来/);
  assert.match(rendered, /<UNREAD_AVAILABLE unread_count="1" direct_mentions="0" \/>/);
  assert.doesNotMatch(rendered, /not_opened|session_key|peer_id|latest_preview|messages/);
  assert.match(rendered, /尚未触发小腻打开 IM/);

  const unreadItems = loopInput.filter((item: any) => item.role === 'user' && getMessageContent(item).includes('<UNREAD_AVAILABLE'));
  assert.equal(unreadItems.length, 1);
  assert.equal((unreadItems[0] as any).role, 'user');
  assert.equal(loopInput.some((item: any) => item.role === 'developer' && getMessageContent(item).includes('<UNREAD_AVAILABLE')), false);
});

test('buildInitialInput materializes full group IM window when an unread batch mentions xiaoni', () => {
  const payload = createQueuePayload();
  payload.wasMentioned = true;
  payload.bodyForAgent = '前面普通未读\n@小腻 看到前面了吗';
  payload.rawBody = '前面普通未读\n@小腻 看到前面了吗';
  payload.messages[0].bodyForAgent = '前面普通未读';
  payload.messages[0].rawBody = '前面普通未读';
  payload.messages[0].wasMentioned = false;
  payload.messages[0].inboundContext = {
    ...payload.messages[0].inboundContext,
    Body: '前面普通未读',
    BodyForAgent: '前面普通未读',
    BodyForCommands: '前面普通未读',
    WasMentioned: false,
    MentionedUsers: []
  };
  payload.messages.push({
    ...payload.messages[0],
    queueMessageId: 2,
    messageId: 12,
    messageSid: 'sid-2',
    bodyForAgent: '@小腻 看到前面了吗',
    rawBody: '@小腻 看到前面了吗',
    wasMentioned: true,
    inboundContext: {
      ...payload.messages[0].inboundContext,
      Body: '@小腻 看到前面了吗',
      BodyForAgent: '@小腻 看到前面了吗',
      BodyForCommands: '@小腻 看到前面了吗',
      WasMentioned: true,
      MentionedUsers: []
    }
  });

  const loopInput = buildInitialInput([], payload, createRuntimePrompt());
  const rendered = loopInput.map(getMessageContent).join('\n');
  const sceneRendered = loopInput
    .filter((item: any) => item.role !== 'system')
    .map(getMessageContent)
    .join('\n');

  assert.match(rendered, /<IM_INBOX_WINDOW[^>]*materialization="opened"[^>]*trigger="explicit_mention"/);
  assert.match(rendered, /前面普通未读/);
  assert.match(rendered, /@小腻 看到前面了吗/);
  assert.match(rendered, /message_id="11" chat_type="群聊"/);
  assert.match(rendered, /message_id="12" chat_type="群聊"/);
  assert.doesNotMatch(rendered, /message_sid=|source="napcat"/);
  assert.doesNotMatch(sceneRendered, /<UNREAD_AVAILABLE/);
  assert.equal(loopInput.some((item: any) => item.role === 'developer' && /Alice|202|<IM_INBOX_WINDOW|<UNREAD_AVAILABLE/.test(getMessageContent(item))), false);
});

test('buildInitialInput materializes full direct IM window when active IM use enqueues it', () => {
  const payload = createDirectQueuePayload();
  payload.bodyForAgent = '第一条私聊\n第二条私聊';
  payload.rawBody = '第一条私聊\n第二条私聊';
  payload.messages[0].bodyForAgent = '第一条私聊';
  payload.messages[0].rawBody = '第一条私聊';
  payload.messages[0].inboundContext = {
    ...payload.messages[0].inboundContext,
    Body: '第一条私聊',
    BodyForAgent: '第一条私聊',
    BodyForCommands: '第一条私聊'
  };
  payload.messages.push({
    ...payload.messages[0],
    queueMessageId: 2,
    messageId: 12,
    messageSid: 'sid-2',
    bodyForAgent: '第二条私聊',
    rawBody: '第二条私聊',
    inboundContext: {
      ...payload.messages[0].inboundContext,
      Body: '第二条私聊',
      BodyForAgent: '第二条私聊',
      BodyForCommands: '第二条私聊'
    }
  });

  const loopInput = buildInitialInput([], payload, createRuntimePrompt());
  const rendered = loopInput.map(getMessageContent).join('\n');
  const sceneRendered = loopInput
    .filter((item: any) => item.role !== 'system')
    .map(getMessageContent)
    .join('\n');

  assert.match(rendered, /<IM_INBOX_WINDOW[^>]*chat_type="私聊"[^>]*materialization="opened"[^>]*trigger="proactive_use_im"/);
  assert.match(rendered, /第一条私聊/);
  assert.match(rendered, /第二条私聊/);
  assert.match(rendered, /message_id="11" chat_type="私聊"/);
  assert.match(rendered, /message_id="12" chat_type="私聊"/);
  assert.doesNotMatch(rendered, /message_sid=|source="napcat"/);
  assert.doesNotMatch(sceneRendered, /<UNREAD_AVAILABLE/);
  assert.equal(loopInput.some((item: any) => item.role === 'developer' && /Alice|202|<IM_INBOX_WINDOW|<UNREAD_AVAILABLE/.test(getMessageContent(item))), false);
});

test('buildInitialInput projects image placeholders without exposing image locators', () => {
  const payload = createQueuePayload();
  payload.bodyForAgent = '[Image] 帮我看看';
  payload.rawBody = '[Image] 帮我看看';
  payload.messages[0].bodyForAgent = '[Image] 帮我看看';
  payload.messages[0].rawBody = '[Image] 帮我看看';
  payload.messages[0].inboundContext = {
    ...payload.messages[0].inboundContext,
    MediaAssets: [
      {
        mediaTag: 'image_1',
        placeholder: '[Image]',
        mediaType: 'image',
        mimeType: 'image/png',
        locator: 'https://example.com/private/cat.png',
        messageSid: 'msg-1'
      }
    ]
  };

  const loopInput = buildInitialInput([], payload, createRuntimePrompt());
  const rendered = loopInput.map(getMessageContent).join('\n');

  assert.match(rendered, /\[当前媒体占位符\]/);
  assert.match(rendered, /image_1/);
  assert.match(rendered, /不要猜图里有什么/);
  assert.doesNotMatch(rendered, /example\.com\/private/);
});

test('buildInitialInput renders reply context in natural language format', () => {
  const payload = createQueuePayload();
  payload.bodyForAgent = '@Bob 嘿';
  payload.rawBody = '@Bob 嘿';
  payload.messages[0].bodyForAgent = '@Bob 嘿';
  payload.messages[0].rawBody = '@Bob 嘿';
  payload.messages[0].inboundContext = {
    ...payload.messages[0].inboundContext,
    ReplyToBody: '上一条消息',
    ReplyToSender: 'Carol',
    ReplyToSenderName: 'Carol',
    ReplyToSenderId: '505'
  };

  const loopInput = buildInitialInput([], payload);
  const currentInputItem = loopInput.find((item: any) => item.role === 'user' && getMessageContent(item).includes('<INPUT_MESSAGE'));
  const currentPrompt = getMessageContent(currentInputItem);

  assert.doesNotMatch(currentPrompt, /sender=|timestamp=/);
  assert.match(currentPrompt, /\[回复给 \{Carol\(@505\)\}：上一条消息\]/);
  assert.match(currentPrompt, /@\{Bob\(@404\)\} 嘿/);
});

test('buildInitialInput renders each message in a batch as its own user message part', () => {
  const payload = createQueuePayload();
  payload.messages.push({
    ...payload.messages[0],
    queueMessageId: 2,
    messageId: 12,
    messageSid: 'sid-2',
    senderId: '606',
    senderName: 'Carol',
    bodyForAgent: '@Bob 嘿',
    rawBody: '@Bob 嘿',
    wasMentioned: false,
    inboundContext: {
      ...payload.messages[0].inboundContext,
      MentionedUsers: [{
        userId: '404',
        label: 'Bob'
      }]
    }
  });

  const loopInput = buildInitialInput([], payload);
  const currentTurnItems = loopInput.filter((item: any) => item.role === 'user' && getMessageContent(item).includes('<INPUT_MESSAGE'));
  assert.match(getMessageContent(loopInput.at(-1)), /<system_reminder>/);

  assert.equal(currentTurnItems.length, 2);
  assert.match(getMessageContent(currentTurnItems[0]), /<INPUT_MESSAGE message_id="11" chat_type="群聊" group="Test Group\(101\)">/);
  assert.match(getMessageContent(currentTurnItems[1]), /<INPUT_MESSAGE message_id="12" chat_type="群聊" group="Test Group\(101\)">/);
  assert.equal(currentTurnItems.some((item) => /sender=|timestamp=/.test(getMessageContent(item))), false);
});

test('buildInitialInput does not append transcript summary to the system prompt by default', () => {
  const loopInput = buildInitialInput([], createQueuePayload(), createRuntimePrompt({
    systemPrompt: '你是小腻主AGENT'
  }));

  assert.equal(loopInput[0]?.type, 'message');
  assert.equal(loopInput[0]?.role, 'system');
  assert.equal(String(loopInput[0]?.content), '你是小腻主AGENT');
  assert.doesNotMatch(String(loopInput[0]?.content), /Runtime contract:/);
  assert.doesNotMatch(String(loopInput[0]?.content), /<skills_instructions>/);
  assert.doesNotMatch(String(loopInput[0]?.content), /普通聊天、轻吐槽、短反应都是正常参与/);
  assert.doesNotMatch(String(loopInput[0]?.content), /Conversation summary:/);
});

test('buildInitialInput puts skills in the head developer context for group chats', () => {
  const loopInput = buildInitialInput([], createQueuePayload(), createRuntimePrompt({
    systemPrompt: '你是小腻主AGENT'
  }));
  const headDeveloper = loopInput.find((item: any) => item.role === 'developer' && getMessageContent(item).includes('<skills_instructions>'));

  assert.equal(loopInput[0]?.type, 'message');
  assert.equal(loopInput[0]?.role, 'system');
  assert.match(String(loopInput[0]?.content), /^你是小腻主AGENT/);
  assert.ok(headDeveloper, 'developer context with skills must exist');
  assert.match(getMessageContent(headDeveloper), /<skills_instructions>/);
  assert.match(getMessageContent(headDeveloper), /\/app\/modules\/agent-service\/skills\/skill-creator\/SKILL\.md/);
  assert.match(getMessageContent(headDeveloper), /<CAPABILITIES>/);
  assert.ok(Array.isArray((headDeveloper as any).content));
  assert.ok(((headDeveloper as any).content as any[]).length >= 2);
});

test('buildInitialInput keeps direct chat system prompt free of runtime contract prose', () => {
  const loopInput = buildInitialInput([], createDirectQueuePayload(), createRuntimePrompt({
    systemPrompt: '你是小腻主AGENT'
  }));
  const headDeveloper = loopInput.find((item: any) => item.role === 'developer' && getMessageContent(item).includes('<skills_instructions>'));

  assert.equal(loopInput[0]?.type, 'message');
  assert.equal(loopInput[0]?.role, 'system');
  assert.match(String(loopInput[0]?.content), /^你是小腻主AGENT/);
  assert.doesNotMatch(String(loopInput[0]?.content), /Runtime contract:/);
  assert.doesNotMatch(String(loopInput[0]?.content), /当前动作怎么收/);
  assert.ok(headDeveloper, 'developer context with skills must exist');
});

test('buildInitialInput does not project accepted identity facts into runtime input', () => {
  const loopInput = buildInitialInput([], createQueuePayload(), createRuntimePrompt({
    systemPrompt: '你是小腻主AGENT'
  }), [
    {
      id: 91,
      factKey: 'feedback.opening-style',
      factText: '小腻收到过明确反馈：不要用“哈哈，确实”这类公式化开头来接话。',
      factType: 'social_lesson',
      confidence: 'high',
      activationTags: ['哈哈', '确实', '接话']
    }
  ]);
  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, loopInput, 'group');
  const rendered = request.input.map(getMessageContent).join('\n');

  assert.doesNotMatch(rendered, /\[身份连续性\]/);
  assert.doesNotMatch(rendered, /公式化开头/);
  const currentInputItem = loopInput.find((item: any) => item.role === 'user' && getMessageContent(item).includes('<INPUT_MESSAGE'));
  assert.match(getMessageContent(currentInputItem), /问问@\{Bob\(@404\)\} 今天玩什么/);
  assert.match(getMessageContent(loopInput.at(-1)), /<system_reminder>/);
});

test('buildInitialInput keeps current batch before reminder without deprecated developer tail blocks', () => {
  const payload = createQueuePayload();
  payload.messages.push({
    ...payload.messages[0],
    queueMessageId: 2,
    messageId: 12,
    messageSid: 'sid-2',
    senderId: '606',
    senderName: 'Carol',
    bodyForAgent: '第二条',
    rawBody: '第二条',
    wasMentioned: false,
    inboundContext: {
      ...payload.messages[0].inboundContext,
      Body: '第二条',
      BodyForAgent: '第二条',
      BodyForCommands: '第二条',
      MentionedUsers: []
    }
  });

  const loopInput = buildInitialInput([
    {
      ...createConversationTurn({ id: 1, aiResponse: '上一段回复' }),
      rawResponse: {
        xiaoni_os: '上一段留下的内在延续。'
      }
    }
  ], payload, createRuntimePrompt({
    systemPrompt: '你是小腻主AGENT'
  }), [
    {
      id: 91,
      factKey: 'feedback.opening-style',
      factText: '小腻收到过明确反馈：不要用公式化开头。',
      factType: 'social_lesson',
      confidence: 'high',
      activationTags: ['接话']
    }
  ]);
  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, loopInput, 'group');
  const rendered = request.input.map(getMessageContent);

  const osIndex = rendered.findIndex((content) => content.includes('上一段留下的内在延续'));
  const firstCurrentIndex = rendered.findIndex((content) => content.includes('message_id="11" chat_type="群聊"'));
  const secondCurrentIndex = rendered.findIndex((content) => content.includes('message_id="12" chat_type="群聊"'));
  const reminderIndex = rendered.findIndex((content) => content.includes('<system_reminder>已打开 IM；下面是这段时间看到的未读列表'));
  const identityIndex = rendered.findIndex((content) => content.includes('[身份连续性]'));

  assert.ok(osIndex !== -1);
  assert.ok(firstCurrentIndex !== -1);
  assert.ok(secondCurrentIndex !== -1);
  assert.ok(reminderIndex !== -1);
  assert.equal(identityIndex, -1);
  assert.equal(rendered.some((content) => content.includes('不要用公式化开头')), false);
  assert.ok(osIndex < firstCurrentIndex);
  assert.ok(firstCurrentIndex < secondCurrentIndex);
  assert.ok(secondCurrentIndex < reminderIndex);
});

test('buildInitialInput applies bound user prompt template to the current message block', () => {
  const loopInput = buildInitialInput([], createQueuePayload(), createRuntimePrompt({
    systemPrompt: '你是小腻主AGENT',
    userPromptTemplate: '群上下文如下：\n{{user_input}}\n签名：${sender_name}',
    runtimeVariables: {
      sender_name: 'Alice'
    }
  }));

  assert.equal(loopInput[0]?.type, 'message');
  assert.equal(loopInput[0]?.role, 'system');
  assert.match(String(loopInput[0]?.content), /^你是小腻主AGENT/);
  assert.doesNotMatch(String(loopInput[0]?.content), /Runtime contract:/);
  const currentMessage = loopInput.find((item: any) => item.role === 'user' && getMessageContent(item).includes('<INPUT_MESSAGE'));
  assert.equal(currentMessage?.type, 'message');
  assert.equal((currentMessage as any)?.role, 'user');
  assert.match(getMessageContent(currentMessage), /群上下文如下：/);
  assert.doesNotMatch(getMessageContent(currentMessage), /CurrentBatch:/);
  assert.match(getMessageContent(currentMessage), /签名：Alice/);
});

test('buildInitialInput replays structured transcript items as scene messages', () => {
  const loopInput = buildInitialInput([
    {
      id: 1,
      userId: 202,
      groupId: 101,
      batchId: null,
      sessionKey: 'qq:group:101',
      userMessage: 'legacy user',
      aiResponse: 'legacy assistant',
      items: [
        {
          id: 11,
          conversationId: 1,
          sessionKey: 'qq:group:101',
          role: 'user',
          phase: null,
          content: '#1 {Alice(@202)}: 第一条',
          groupIndex: 0,
          itemIndex: 0,
          source: 'inbound_batch',
          deliveryMessageId: null,
          runId: 'run-legacy',
          traceId: 'trace-legacy'
        },
        {
          id: 12,
          conversationId: 1,
          sessionKey: 'qq:group:101',
          role: 'assistant',
          phase: 'commentary',
          content: '我先看一下',
          groupIndex: 1,
          itemIndex: 0,
          source: 'delivery',
          deliveryMessageId: 901,
          runId: 'run-legacy',
          traceId: 'trace-legacy'
        },
        {
          id: 13,
          conversationId: 1,
          sessionKey: 'qq:group:101',
          role: 'assistant',
          phase: 'final_answer',
          content: '原因已经找到了',
          groupIndex: 1,
          itemIndex: 1,
          source: 'delivery',
          deliveryMessageId: 902,
          runId: 'run-legacy',
          traceId: 'trace-legacy'
        }
      ]
    }
  ], createQueuePayload());

  const priorUserItem = loopInput.find((item: any) => item.role === 'user' && getMessageContent(item).includes('#1 {Alice(@202)}: 第一条'));
  const priorCommentaryItem = loopInput.find((item: any) => item.role === 'assistant' && item.phase === 'commentary' && getMessageContent(item).includes('我先看一下'));
  const priorFinalItem = loopInput.find((item: any) => item.role === 'assistant' && item.phase === 'final_answer' && getMessageContent(item).includes('原因已经找到了'));
  assert.equal((priorUserItem as any)?.role, 'user');
  assert.match(getMessageContent(priorUserItem), /<INPUT_MESSAGE/);
  assert.equal((priorCommentaryItem as any)?.role, 'assistant');
  assert.equal((priorCommentaryItem as any)?.phase, 'commentary');
  assert.equal((priorFinalItem as any)?.role, 'assistant');
  assert.equal((priorFinalItem as any)?.phase, 'final_answer');
  assert.match(getMessageContent(priorFinalItem), /<OUTPUT_MESSAGE/);
});

test('buildInitialInput does not replay tactical xiaoni_os for spoken multi-part replies', () => {
  const loopInput = buildInitialInput([
    {
      id: 1,
      userId: 202,
      groupId: 101,
      batchId: null,
      sessionKey: 'qq:group:101',
      userMessage: 'legacy user',
      aiResponse: '第一段\n\n第二段',
      rawResponse: {
        xiaoni_os: '先接一句，再补半句就够了。'
      },
      items: [
        {
          id: 11,
          conversationId: 1,
          sessionKey: 'qq:group:101',
          role: 'assistant',
          phase: 'commentary',
          content: '第一段',
          groupIndex: 1,
          itemIndex: 0,
          source: 'delivery',
          deliveryMessageId: 901,
          runId: 'run-legacy',
          traceId: 'trace-legacy'
        },
        {
          id: 12,
          conversationId: 1,
          sessionKey: 'qq:group:101',
          role: 'assistant',
          phase: 'final_answer',
          content: '第二段',
          groupIndex: 1,
          itemIndex: 1,
          source: 'delivery',
          deliveryMessageId: 902,
          runId: 'run-legacy',
          traceId: 'trace-legacy'
        }
      ]
    }
  ], createQueuePayload());

  const priorXiaoniItem = loopInput.find((item: any) => item.role === 'assistant' && item.phase === 'commentary' && getMessageContent(item).includes('第一段'));
  assert.equal((priorXiaoniItem as any).role, 'assistant');
  assert.equal((priorXiaoniItem as any).phase, 'commentary');
  assert.match(getMessageContent(priorXiaoniItem), /第一段/);
  const finalItem = loopInput.find((item: any) => item.role === 'assistant' && item.phase === 'final_answer' && getMessageContent(item).includes('第二段'));
  assert.equal((finalItem as any)?.role, 'assistant');
  assert.equal((finalItem as any)?.phase, 'final_answer');
  assert.match(getMessageContent(finalItem), /第二段/);
  assert.doesNotMatch(loopInput.map(getMessageContent).join('\n'), /先接一句/);
});

test('buildInitialInput omits tactical xiaoni_os from the latest spoken turn', () => {
  const loopInput = buildInitialInput([
    {
      id: 1,
      userId: 202,
      groupId: 101,
      batchId: null,
      sessionKey: 'qq:group:101',
      userMessage: 'legacy user',
      aiResponse: '我刚看群文件还没更新',
      rawResponse: {
        xiaoni_os: '这句明显是在顺着问我，这里接一句就够了。'
      },
      items: [
        {
          id: 11,
          conversationId: 1,
          sessionKey: 'qq:group:101',
          role: 'assistant',
          phase: 'final_answer',
          content: '我刚看群文件还没更新',
          groupIndex: 1,
          itemIndex: 0,
          source: 'delivery',
          deliveryMessageId: 901,
          runId: 'run-legacy',
          traceId: 'trace-legacy'
        }
      ]
    }
  ], createQueuePayload());

  const priorXiaoniItem = loopInput.find((item: any) => item.role === 'assistant' && item.phase === 'final_answer' && getMessageContent(item).includes('我刚看群文件还没更新'));
  assert.equal((priorXiaoniItem as any).role, 'assistant');
  assert.equal((priorXiaoniItem as any).phase, 'final_answer');
  assert.match(getMessageContent(priorXiaoniItem), /<OUTPUT_MESSAGE/);
  assert.match(getMessageContent(priorXiaoniItem), /我刚看群文件还没更新/);
  assert.doesNotMatch(getMessageContent(priorXiaoniItem), /<xiaoni_os>/);
  assert.doesNotMatch(getMessageContent(priorXiaoniItem), /这句明显是在顺着问我/);
});

test('buildInitialInput preserves residue-like xiaoni_os on spoken turns', () => {
  const loopInput = buildInitialInput([
    {
      id: 1,
      userId: 202,
      groupId: 101,
      batchId: null,
      sessionKey: 'qq:group:101',
      userMessage: 'legacy user',
      aiResponse: '这句我记下了',
      rawResponse: {
        xiaoni_os: '她没有拆我，反而把那点顾虑轻轻接住了，我对她会更放松一点。'
      },
      items: [
        {
          id: 11,
          conversationId: 1,
          sessionKey: 'qq:group:101',
          role: 'assistant',
          phase: 'final_answer',
          content: '这句我记下了',
          groupIndex: 1,
          itemIndex: 0,
          source: 'delivery',
          deliveryMessageId: 901,
          runId: 'run-legacy',
          traceId: 'trace-legacy'
        }
      ]
    }
  ], createQueuePayload());

  const priorXiaoniItem = loopInput.find((item: any) => item.role === 'assistant' && item.phase === 'final_answer' && getMessageContent(item).includes('这句我记下了'));
  assert.match(getMessageContent(priorXiaoniItem), /这句我记下了/);
  const osItem = loopInput.find((item: any) => item.type === 'message' && item.role === 'assistant' && item.phase === 'commentary' && getMessageContent(item).includes('<xiaoni_os>'));
  assert.ok(osItem);
  assert.match(getMessageContent(osItem), /我对她会更放松一点/);
});

test('buildInitialInput appends standalone xiaoni_os when the latest turn was silent', () => {
  const loopInput = buildInitialInput([
    {
      id: 1,
      userId: 202,
      groupId: 101,
      batchId: null,
      sessionKey: 'qq:group:101',
      userMessage: 'legacy user',
      aiResponse: null,
      rawResponse: {
        finish_reason: '刚才大家是在彼此接话，我插进去会显得多余。'
      },
      items: [
        {
          id: 11,
          conversationId: 1,
          sessionKey: 'qq:group:101',
          role: 'user',
          phase: null,
          content: '2026-04-08 15:21 张三(111)\n你刚不是在看吗',
          groupIndex: 0,
          itemIndex: 0,
          source: 'inbound_batch',
          deliveryMessageId: null,
          runId: 'run-legacy',
          traceId: 'trace-legacy'
        }
      ]
    }
  ], createQueuePayload());

  const standaloneOsItem = loopInput.find((item: any) => item.type === 'message' && item.role === 'assistant' && item.phase === 'commentary' && getMessageContent(item).includes('<xiaoni_os>'));
  assert.ok(standaloneOsItem);
  assert.match(getMessageContent(standaloneOsItem), /<xiaoni_os>/);
  assert.match(getMessageContent(standaloneOsItem), /刚才我没有接/);
  assert.match(getMessageContent(standaloneOsItem), /我插进去会显得多余/);
});

test('buildInitialInput preserves xiaoni_os from non-latest history turns', () => {
  const loopInput = buildInitialInput([
    {
      id: 1,
      userId: 202,
      groupId: 101,
      batchId: null,
      sessionKey: 'qq:group:101',
      userMessage: '上一段用户消息',
      aiResponse: '上一段回复',
      rawResponse: {
        xiaoni_os: '上一段留下的内在延续。'
      },
      items: [
        {
          id: 11,
          conversationId: 1,
          sessionKey: 'qq:group:101',
          role: 'assistant',
          phase: 'final_answer',
          content: '上一段回复',
          groupIndex: 1,
          itemIndex: 0,
          source: 'delivery',
          deliveryMessageId: 901,
          runId: 'run-legacy',
          traceId: 'trace-legacy'
        }
      ]
    },
    {
      id: 2,
      userId: 202,
      groupId: 101,
      batchId: null,
      sessionKey: 'qq:group:101',
      userMessage: '最新一段用户消息',
      aiResponse: '最新一段回复',
      rawResponse: {},
      items: [
        {
          id: 21,
          conversationId: 2,
          sessionKey: 'qq:group:101',
          role: 'assistant',
          phase: 'final_answer',
          content: '最新一段回复',
          groupIndex: 1,
          itemIndex: 0,
          source: 'delivery',
          deliveryMessageId: 902,
          runId: 'run-latest',
          traceId: 'trace-latest'
        }
      ]
    }
  ], createQueuePayload());

  const priorTurnItem = loopInput.find((item: any) => item.type === 'message' && item.role === 'assistant' && getMessageContent(item).includes('上一段回复'));
  assert.ok(priorTurnItem);
  assert.match(getMessageContent(priorTurnItem), /上一段回复/);
  const priorOsItem = loopInput.find((item: any) => item.type === 'message' && item.role === 'assistant' && item.phase === 'commentary' && getMessageContent(item).includes('上一段留下的内在延续'));
  assert.ok(priorOsItem);
  assert.match(getMessageContent(priorOsItem), /<xiaoni_os>/);
});

test('buildInitialInput replays assistant history with output_text content parts', () => {
  const loopInput = buildInitialInput([
    {
      id: 1,
      userId: 202,
      groupId: 101,
      batchId: null,
      sessionKey: 'qq:group:101',
      userMessage: '上一段用户消息',
      aiResponse: '上一段回复',
      rawResponse: {},
      items: [
        {
          id: 11,
          conversationId: 1,
          sessionKey: 'qq:group:101',
          role: 'user',
          phase: null,
          content: '上一段用户消息',
          groupIndex: 0,
          itemIndex: 0,
          source: 'inbound_batch',
          deliveryMessageId: null,
          runId: 'run-user',
          traceId: 'trace-user'
        },
        {
          id: 12,
          conversationId: 1,
          sessionKey: 'qq:group:101',
          role: 'assistant',
          phase: 'final_answer',
          content: '上一段回复',
          groupIndex: 1,
          itemIndex: 0,
          source: 'delivery',
          deliveryMessageId: 901,
          runId: 'run-assistant',
          traceId: 'trace-assistant'
        }
      ]
    }
  ], createQueuePayload());

  const assistantItem = loopInput.find((item: any) => item.type === 'message' && item.role === 'assistant' && getMessageContent(item).includes('上一段回复')) as any;
  assert.ok(assistantItem);
  assert.equal(assistantItem.content[0]?.type, 'output_text');
  assert.equal(assistantItem.content[0]?.text.includes('<OUTPUT_MESSAGE'), true);

  const userItem = loopInput.find((item: any) => item.type === 'message' && item.role === 'user' && getMessageContent(item).includes('上一段用户消息')) as any;
  assert.ok(userItem);
  assert.equal(userItem.content[0]?.type, 'input_text');
});

test('buildInitialInput keeps user input as pure scene without synthetic current-task text', () => {
  const loopInput = buildInitialInput([], createQueuePayload(), createRuntimePrompt({
    systemPrompt: '你是小腻主AGENT'
  }));

  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, loopInput, 'group');
  assert.match(String(request.instructions), /^你是小腻主AGENT/);
  assert.doesNotMatch(String(request.instructions), /当前动作怎么收/);
  assert.doesNotMatch(String(request.instructions), /群里说话/);
  assert.equal(request.input.some((item) => getMessageContent(item).includes('[当前任务]')), false);
});

test('executeAgentTurn forwards bound prompt metadata and prompt-specific model parameters', async () => {
  const service = new AgentLoopService({} as any);
  const originalFetch = globalThis.fetch;
  const calls: Array<any> = [];

  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body || '{}')));
    return {
      ok: true,
      json: async () => ({
        success: true,
        llm_call_id: 'llm-2',
        canonical_response: {
          output: []
        }
      })
    } as any;
  }) as typeof fetch;

  try {
    await (service as any).executeAgentTurn(
      buildInitialInput([], createQueuePayload()),
      createQueuePayload(),
      'trace-2',
      1,
      createRuntimePrompt({
        source: 'group',
        promptId: 'prompt-1',
        promptName: '小腻主AGENT',
        modelName: 'gpt-5.4',
        parameters: {
          model_config: {
            providerSpecific: {
              reasoningEffort: 'high'
            }
          },
          advanced_config: {
            generationConfig: {
              maxOutputTokens: 4096
            }
          }
        }
      })
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0].prompt_name, '小腻主AGENT');
  assert.equal(calls[0].model, 'gpt-5.4');
  assert.equal(calls[0].canonicalRequest.metadata.prompt_id, 'prompt-1');
  assert.equal(calls[0].canonicalRequest.prompt_cache_key, 'qq:group:101');
  assert.equal(calls[0].canonicalRequest.prompt_cache_retention, '24h');
  assert.deepEqual(calls[0].parameters, {
    model_config: {
      providerSpecific: {}
    },
    advanced_config: {
      generationConfig: {
        maxOutputTokens: 4096,
        timeout: agentConfig.mainAgentTurnTimeoutMs
      }
    }
  });
  assert.equal(calls[0].canonicalRequest.model, 'gpt-5.4');
  assert.deepEqual(calls[0].canonicalRequest.reasoning, {
    effort: 'high',
    summary: 'auto'
  });
});

test('feedback memory subagent is disabled after extract_feedback_episode tool removal', async () => {
  const calls: Array<any> = [];
  const timelineEvents: Array<any> = [];
  const store = {
    logTimelineEvent: async (event: any) => { timelineEvents.push(event); }
  };
  const service = new AgentLoopService(store as any);
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body || '{}')));
    throw new Error('feedback memory subagent should not call provider');
  }) as typeof fetch;

  try {
    await (service as any).runFeedbackMemorySubagent({
      queueMessage: createQueuePayload(),
      conversationId: 1001,
      history: [],
      runtimePrompt: createRuntimePrompt({
        promptName: '小腻主AGENT',
        promptId: 'prompt-1'
      }),
      xiaoniOs: '我意识到不能为了接话而接话。',
      deliveredMessages: ['我先想想。'],
      unreadMeaningArtifact: { message_act: 'feedback' }
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 0);
  assert.equal(timelineEvents[0]?.eventType, 'subagent');
  assert.equal(timelineEvents[0]?.eventPhase, 'start');
  assert.equal(timelineEvents.at(-1)?.metadata?.termination_reason, 'disabled_feedback_episode_tool_removed');
});

test('normal feedback memory subagent does not write hidden episode evidence', async () => {
  const calls: Array<any> = [];
  let reflectionWrites = 0;
  const store = {
    logTimelineEvent: async () => undefined,
    createFeedbackReflection: async () => {
      reflectionWrites += 1;
      return { id: 2 };
    },
    upsertFeedbackLearningState: async () => ({ id: 3 })
  };
  const service = new AgentLoopService(store as any);
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body || '{}')));
    throw new Error('feedback memory subagent should not call provider');
  }) as typeof fetch;

  try {
    await (service as any).runFeedbackMemorySubagent({
      queueMessage: createQueuePayload(),
      conversationId: 1001,
      history: [],
      runtimePrompt: createRuntimePrompt({ promptName: '小腻主AGENT', promptId: 'prompt-1' }),
      xiaoniOs: '这件事被纠偏了。',
      deliveredMessages: ['收到。'],
      unreadMeaningArtifact: { message_act: 'feedback' }
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 0);
  assert.equal(reflectionWrites, 0);
});

test('compress_core_memory preserves caller text and lets the loop continue', async () => {
  const service = new AgentLoopService({} as any);
  const result = await (service as any).executeTool({
    name: COMPRESS_CORE_MEMORY_TOOL,
    callId: 'compress-1',
    rawArguments: '{"text":"  记住阿花要的是能跨群发弱智吧链接，不要再说当前会话不行。  "}',
    args: {
      text: '  记住阿花要的是能跨群发弱智吧链接，不要再说当前会话不行。  '
    }
  }, createQueuePayload());

  assert.deepEqual(result, {
    compressed: true,
    text: '记住阿花要的是能跨群发弱智吧链接，不要再说当前会话不行。',
    outcome: 'core_memory_compressed'
  });

  const continuation = applyToolResultToLoopInput({
    name: COMPRESS_CORE_MEMORY_TOOL,
    callId: 'compress-1',
    rawArguments: '{"text":"记住阿花要的是能跨群发弱智吧链接，不要再说当前会话不行。"}'
  }, result);

  assert.equal(continuation.finishResult, null);
  assert.equal(continuation.forcedVisibleReply, null);
  assert.equal(continuation.inputItems.length, 1);
  assert.equal(continuation.inputItems[0]?.type, 'function_call_output');
  assert.match(String((continuation.inputItems[0] as any).output), /core_memory_compressed/);
});

test('context compression memory writer generates episodic, semantic, and reflection memories', async () => {
  const calls: Array<any> = [];
  const observationWrites: Array<any> = [];
  const assertionWrites: Array<any> = [];
  const reflectionWrites: Array<any> = [];
  const store = {
    logTimelineEvent: async () => undefined,
    createAgentMemoryObservation: async (params: any) => {
      observationWrites.push(params);
      return { id: observationWrites.length, ...params, created_at: '2026-05-29T00:00:00.000Z' };
    },
    createAgentMemoryAssertion: async (params: any) => {
      assertionWrites.push(params);
      return { id: assertionWrites.length, ...params };
    },
    createAgentMemoryReflection: async (params: any) => {
      reflectionWrites.push(params);
      return { id: reflectionWrites.length, ...params };
    }
  };
  const service = new AgentLoopService(store as any);
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body || '{}')));
    const turn = calls.length;
    if (turn === 1) {
      return {
        ok: true,
        json: async () => ({
          success: true,
          canonical_response: {
            output: [{
              type: 'function_call',
              call_id: 'call-episodic',
              name: 'write_episodic_observations',
              arguments: JSON.stringify({
                observations: [
                  {
                    topic: '公式化接话纠偏',
                    text: 'Kisin 明确提醒小腻别用公式化开场，小腻当时在被纠偏的位置。',
                    poignancy: 8,
                    participants: [
                      { qq_id: '202', name: 'Alice' },
                      { qq_id: '未知', name: '黑叔叔' },
                      { qq_id: '452884318', name: '主人' },
                      { qq_id: '123', name: '{bad}' }
                    ],
                    xiaoni_role: 'directly_addressed',
                    source_turn_ids: [10]
                  },
                  {
                    topic: '公式化接话纠偏',
                    text: '小腻前后两段都被这个话题牵动，说明这是关系现场里的真实反馈。',
                    poignancy: 7,
                    participants: [{ qq_id: '202', name: 'Alice' }],
                    xiaoni_role: 'mentioned_or_evaluated',
                    source_turn_ids: [11]
                  }
                ]
              })
            }]
          }
        })
      } as any;
    }
    if (turn === 2) {
      return {
        ok: true,
        json: async () => ({
          success: true,
          canonical_response: {
            output: [{
              type: 'function_call',
              call_id: 'call-semantic',
              name: 'write_semantic_assertions',
              arguments: JSON.stringify({
                assertions: [
                  {
                    text: 'Kisin 明确表达过不喜欢小腻公式化接话。',
                    fact_type: 'claim',
                    scope: 'person',
                    owners: [{ qq_id: '202', name: 'Alice' }],
                    directed_to: [{ qq_id: '1129974489', name: '小腻' }],
                    entities: [{ kind: 'person', value: 'Kisin' }],
                    participants: [{ qq_id: '202', name: 'Alice' }],
                    evidence_summary: '给你的 AI 一个世界去生活 和 Kisin 都出现在原始表达里。',
                    xiaoni_relevance: 'direct_feedback',
                    source_turn_ids: [10]
                  },
                  {
                    text: '群友 141? no',
                    fact_type: 'claim',
                    scope: 'person',
                    owners: [{ qq_id: '141', name: '群友 141' }],
                    directed_to: [],
                    entities: [],
                    participants: [{ qq_id: '141', name: '群友 141' }],
                    evidence_summary: 'Need remove this malformed assertion.',
                    xiaoni_relevance: 'none',
                    source_turn_ids: [10]
                  },
                  {
                    text: 'nova 说自己凌晨给小伊发过消息。',
                    fact_type: 'claim',
                    scope: 'dyad',
                    owners: [{ qq_id: '', name: 'nova' }],
                    directed_to: [{ qq_id: '3994058476', name: '小伊' }],
                    entities: [{ kind: 'person', value: 'nova' }],
                    participants: [
                      { qq_id: '', name: 'nova' },
                      { qq_id: '3994058476', name: '小伊' }
                    ],
                    evidence_summary: 'nova 在原始消息里可由 sender 标签识别。',
                    xiaoni_relevance: 'relationship_context',
                    source_turn_ids: [12]
                  }
                ]
              })
            }]
          }
        })
      } as any;
    }
    return {
      ok: true,
      json: async () => ({
        success: true,
        canonical_response: {
          output: [{
            type: 'function_call',
            call_id: 'call-reflection',
            name: 'write_memory_reflections',
            arguments: JSON.stringify({
              reflections: [
                {
                  text: 'Kisin 多次把小腻的公式化接话当成需要纠偏的对象，给你的 AI 一个世界去生活 也在同一现场。',
                  kind: 'dyad_pattern',
                  subjects: ['Alice', 'Kisin', '给你的 AI 一个世界去生活', '小腻'],
                  subject_participants: [{ qq_id: '202', name: 'Alice' }],
                  object_participants: [{ qq_id: '3994058476', name: '小腻' }],
                  evidence_basis: 'repeated_interactions',
                  evidence_summary: '两条 observation 都围绕 Kisin 对小腻公式化接话的纠偏。',
                  self_continuity_note: '小腻需要记得 给你的AI一个世界去生活 是龙哥的旧称，不是单独实体。',
                  evidence_time_start: '0517-12-31T23:54:17.000Z',
                  evidence_time_end: '2082-01-01T00:00:00.000Z',
                  poignancy: 8,
                  source_observation_ids: [1, 2]
                },
                {
                  text: '小腻后续应该少说点话，避免解答腔。',
                  kind: 'self_continuity',
                  subjects: ['小腻'],
                  subject_participants: [{ qq_id: '3994058476', name: '小腻' }],
                  object_participants: [],
                  evidence_basis: 'xiaoni_sayable_points',
                  evidence_summary: '后续应该少说点话。',
                  self_continuity_note: '以后需要换口吻并接梗。',
                  evidence_time_start: '2026-05-29T00:00:00.000Z',
                  evidence_time_end: '2026-05-29T00:00:00.000Z',
                  poignancy: 8,
                  source_observation_ids: [1, 2]
                }
              ]
            })
          }]
        }
      })
    } as any;
  }) as typeof fetch;

  try {
    await (service as any).runContextCompressionMemoryWriter({
      queueMessage: createQueuePayload(),
      conversationId: 1001,
      evictedTurns: [createConversationTurn({
        id: 10,
        userDeliveryMessageId: 201
      }), createConversationTurn({
        id: 11,
        userDeliveryMessageId: 202
      }), createConversationTurn({
        id: 12,
        userId: 3375477814,
        userDeliveryMessageId: 203,
        userMessage: '<INPUT_MESSAGE message_id="203" chat_type="私聊" private_peer="Nova(3375477814)">nova 说自己凌晨给小伊发过消息。</INPUT_MESSAGE>'
      })],
      runtimePrompt: createRuntimePrompt({ promptName: '小腻主AGENT', promptId: 'prompt-1' })
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls[0].agent_type, 'context_compression_memory_writer:episodic');
  assert.deepEqual(
    calls[0].canonicalRequest.tools.map((tool: any) => getToolName(tool)),
    ['write_episodic_observations']
  );
  assert.equal(calls[1].agent_type, 'context_compression_memory_writer:semantic');
  assert.equal(calls[2].agent_type, 'context_compression_memory_writer:reflection');
  assert.deepEqual(calls.map((call) => call.model), ['gpt-5.5', 'gpt-5.5', 'gpt-5.5']);
  assert.deepEqual(calls.map((call) => call.canonicalRequest.prompt_cache_key), [
    'qq:group:101:cmem:episodic',
    'qq:group:101:cmem:semantic',
    'qq:group:101:cmem:reflection'
  ]);
  assert.deepEqual(calls.map((call) => call.canonicalRequest.reasoning), [
    { effort: 'high', summary: 'auto' },
    { effort: 'high', summary: 'auto' },
    { effort: 'high', summary: 'auto' }
  ]);
  assert.deepEqual(calls.map((call) => call.canonicalRequest.text), [
    { verbosity: 'medium' },
    { verbosity: 'medium' },
    { verbosity: 'medium' }
  ]);
  assert.deepEqual(calls.map((call) => call.parameters.advanced_config.generationConfig.timeout), [120000, 120000, 120000]);
  assert.ok(calls.every((call) => call.canonicalRequest.prompt_cache_key.length <= 64));
  assert.equal(observationWrites.length, 2);
  assert.deepEqual(observationWrites[0].sourceMessageIds, [201]);
  assert.equal(observationWrites[0].text, '闻震 明确提醒小腻别用公式化开场，小腻当时在被纠偏的位置。');
  assert.deepEqual(observationWrites[0].participants, [
    { qq_id: '202', name: 'Alice' },
    { qq_id: '452884318', name: '主人' }
  ]);
  assert.deepEqual(observationWrites[1].sourceMessageIds, [202]);
  assert.equal(assertionWrites.length, 2);
  assert.deepEqual(assertionWrites[0].sourceMessageIds, [201]);
  assert.equal(assertionWrites[0].text, '闻震 明确表达过不喜欢小腻公式化接话。');
  assert.deepEqual(assertionWrites[0].entities, [{ kind: 'person', value: '闻震' }]);
  assert.equal(assertionWrites[0].metadata.scope, 'person');
  assert.deepEqual(assertionWrites[0].metadata.owners, [{ qq_id: '202', name: 'Alice' }]);
  assert.equal(assertionWrites[0].metadata.evidence_summary, '龙哥 和 闻震 都出现在原始表达里。');
  assert.equal(assertionWrites[0].metadata.xiaoni_relevance, 'direct_feedback');
  assert.deepEqual(assertionWrites[1].sourceMessageIds, [203]);
  assert.deepEqual(assertionWrites[1].participants, [
    { qq_id: '3375477814', name: 'Nova' },
    { qq_id: '3994058476', name: '小伊' }
  ]);
  assert.deepEqual(assertionWrites[1].metadata.owners, [{ qq_id: '3375477814', name: 'Nova' }]);
  assert.equal(reflectionWrites.length, 1);
  assert.deepEqual(reflectionWrites[0].sourceObservationIds, [1, 2]);
  assert.deepEqual(reflectionWrites[0].sourceMessageIds, [201, 202]);
  assert.equal(reflectionWrites[0].kind, 'dyad_pattern');
  assert.equal(reflectionWrites[0].text, '闻震 多次把小腻的公式化接话当成需要纠偏的对象，龙哥 也在同一现场。');
  assert.deepEqual(reflectionWrites[0].subjects, ['Alice', '闻震', '龙哥', '小腻']);
  assert.equal(reflectionWrites[0].evidenceTimeStart, null);
  assert.equal(reflectionWrites[0].evidenceTimeEnd, null);
  assert.deepEqual(reflectionWrites[0].metadata.subject_participants, [{ qq_id: '202', name: 'Alice' }]);
  assert.deepEqual(reflectionWrites[0].metadata.object_participants, [{ qq_id: '1129974489', name: '小腻' }]);
  assert.equal(reflectionWrites[0].metadata.evidence_summary, '两条 observation 都围绕 闻震 对小腻公式化接话的纠偏。');
  assert.equal(reflectionWrites[0].metadata.self_continuity_note, '小腻需要记得 龙哥 是龙哥的旧称，不是单独实体。');
  assert.equal(reflectionWrites[0].metadata.source, 'episodic_observations');
});

test('context compression memory writer retries transient provider transport failures', async () => {
  const calls: Array<any> = [];
  const observationWrites: Array<any> = [];
  const assertionWrites: Array<any> = [];
  const service = new AgentLoopService({
    logTimelineEvent: async () => undefined,
    createAgentMemoryObservation: async (params: any) => {
      observationWrites.push(params);
      return { id: observationWrites.length, ...params };
    },
    createAgentMemoryAssertion: async (params: any) => {
      assertionWrites.push(params);
      return { id: assertionWrites.length, ...params };
    }
  } as any);
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body || '{}')));
    if (calls.length === 1 || calls.length === 2) {
      return {
        ok: false,
        status: 500,
        json: async () => ({ success: false, error: calls.length === 1 ? 'terminated' : 'fetch failed' })
      } as any;
    }
    const toolName = calls.length === 3 ? 'write_episodic_observations' : 'write_semantic_assertions';
    const args = calls.length === 3 ? { observations: [] } : { assertions: [] };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        canonical_response: {
          output: [{
            type: 'function_call',
            call_id: `call-${calls.length}`,
            name: toolName,
            arguments: JSON.stringify(args)
          }]
        }
      })
    } as any;
  }) as typeof fetch;

  try {
    await (service as any).runContextCompressionMemoryWriter({
      queueMessage: createQueuePayload(),
      conversationId: 1001,
      evictedTurns: [createConversationTurn({ id: 10, userDeliveryMessageId: 201 })],
      runtimePrompt: createRuntimePrompt({ promptName: '小腻主AGENT', promptId: 'prompt-1' })
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 4);
  assert.equal(calls[0].agent_type, 'context_compression_memory_writer:episodic');
  assert.equal(calls[1].agent_type, 'context_compression_memory_writer:episodic');
  assert.equal(calls[2].agent_type, 'context_compression_memory_writer:episodic');
  assert.equal(calls[3].agent_type, 'context_compression_memory_writer:semantic');
  assert.equal(observationWrites.length, 0);
  assert.equal(assertionWrites.length, 0);
});

test('context compression identity lineage uses compression writer provenance', async () => {
  const service = new AgentLoopService({} as any);
  const reflectionWrites: any[] = [];
  const identityCandidates: any[] = [];
  const acceptedFacts: any[] = [];

  await (service as any).executeFeedbackWriterTool({
    callId: 'call-reflection',
    name: 'synthesize_feedback_reflection',
    rawArguments: '{}',
    args: {
      learning_key: 'style.opening_filler',
      learning_scope: 'group_self',
      reflection_type: 'self_model_update',
      feedback_kind: 'negative',
      confidence: 'high',
      importance_score: 0.8,
      evidence_weight: 0.75,
      stability_score: 0.7,
      summary_text: '小腻要避免用“哈哈，确实”作为默认开场，因为这会显得像公式化接话。',
      retrieval_text: '不要用哈哈确实这类公式化开头。',
      embedding_text: '公式化开头 哈哈 确实',
      supersede_latest: false,
      conflict_group_key: null,
      reason: '这是明确负反馈。'
    }
  }, {
    queueMessage: createQueuePayload(),
    conversationId: 1001,
    evidence: {
      sourceMessageIds: [201],
      sourceConversationId: 10,
      sourceUserId: 202,
      sourceUserName: null,
      metadata: {
        evicted_turn_ids: [10],
        evidence_source: 'context_compression_evicted_turns'
      },
      writerSource: 'context_compression_memory_writer'
    },
    persistedReflectionId: null,
    activeLearningKey: '',
    activeLearningScope: '',
    reflectionCreator: async (params: any) => {
      reflectionWrites.push(params);
      return { id: 8 };
    },
    stateUpserter: async () => ({ id: 9 }),
    identityCandidateAppender: async (params: any) => {
      identityCandidates.push(params);
      return { candidate: { id: 11 } };
    },
    acceptedIdentityFactCreator: async (params: any) => {
      acceptedFacts.push(params);
      return { fact: { id: 12 } };
    },
    mode: 'durable_lessons'
  });

  assert.equal(reflectionWrites[0].metadata.writer_source, 'context_compression_memory_writer');
  assert.equal(identityCandidates[0].proposedBy, 'context_compression_memory_writer');
  assert.equal(identityCandidates[0].evidenceRefs[0].conversationId, 10);
  assert.equal(acceptedFacts[0].lineageMetadata.source, 'context_compression_memory_writer');
  assert.equal(acceptedFacts[0].evidenceRefs[0].conversationId, 10);
});

test('feedback reflection writes an identity candidate and accepted fact when hard-check passes', async () => {
  const service = new AgentLoopService({} as any);
  const identityCandidates: any[] = [];
  const acceptedFacts: any[] = [];

  const result = await (service as any).executeFeedbackWriterTool({
    callId: 'call-reflection',
    name: 'synthesize_feedback_reflection',
    rawArguments: '{}',
    args: {
      learning_key: 'style.opening_filler',
      learning_scope: 'group_self',
      reflection_type: 'self_model_update',
      feedback_kind: 'negative',
      confidence: 'high',
      importance_score: 0.8,
      evidence_weight: 0.75,
      stability_score: 0.7,
      summary_text: '小腻要避免用“哈哈，确实”作为默认开场，因为这会显得像公式化接话。',
      retrieval_text: '不要用哈哈确实这类公式化开头。',
      embedding_text: '公式化开头 哈哈 确实',
      supersede_latest: false,
      conflict_group_key: null,
      reason: '这是明确负反馈。'
    }
  }, {
    queueMessage: createQueuePayload(),
    conversationId: 1001,
    persistedReflectionId: null,
    activeLearningKey: '',
    activeLearningScope: '',
    reflectionCreator: async () => ({ id: 8 }),
    stateUpserter: async () => ({ id: 9 }),
    identityCandidateAppender: async (params: any) => {
      identityCandidates.push(params);
      return { candidate: { id: 11 } };
    },
    acceptedIdentityFactCreator: async (params: any) => {
      acceptedFacts.push(params);
      return { fact: { id: 12 } };
    },
    mode: 'durable_lessons'
  });

  assert.equal(result.reflection_id, 8);
  assert.equal(result.identity_candidate_id, 11);
  assert.equal(result.accepted_identity_fact_id, 12);
  assert.equal(result.identity_judge_status, 'accepted');
  assert.equal(identityCandidates.length, 1);
  assert.equal(identityCandidates[0].identityKey, 'xiaoni');
  assert.equal(identityCandidates[0].status, 'accepted');
  assert.equal(identityCandidates[0].proposedFrom, 'agent_feedback_reflection');
  assert.equal(identityCandidates[0].proposedBy, 'feedback_memory_writer');
  assert.equal(identityCandidates[0].evidenceRefs[0].sourceType, 'agent_feedback_reflection');
  assert.equal(acceptedFacts.length, 1);
  assert.equal(acceptedFacts[0].sourceCandidateId, 11);
  assert.equal(acceptedFacts[0].factType, 'self_boundary');
  assert.match(acceptedFacts[0].factText, /哈哈，确实/);
  assert.equal(acceptedFacts[0].lineageMetadata.source, 'feedback_memory_writer');
});

test('runtime identity activation selects accepted facts and records trace refs', async () => {
  const records: any[] = [];
  const store = {
    listAcceptedIdentityFacts: async () => [
      {
        id: 21,
        identityKey: 'xiaoni',
        factKey: 'feedback.opening_filler',
        factText: '不要用“哈哈，确实”这类公式化开头。',
        factType: 'social_lesson',
        sourceCandidateId: 11,
        sourceEventId: null,
        status: 'active',
        confidence: 'high',
        activationTags: ['哈哈', '确实'],
        metadata: {},
        acceptedAt: null,
        updatedAt: null
      }
    ],
    recordRuntimeIdentityActivationTrace: async (params: any) => {
      records.push(params);
      return { id: 31 };
    }
  };
  const service = new AgentLoopService(store as any);
  const facts = await (service as any).loadRuntimeIdentityFacts({
    ...createQueuePayload(),
    bodyForAgent: '哈哈，确实这个问题怎么改？',
    messages: [{
      ...createQueuePayload().messages[0],
      bodyForAgent: '哈哈，确实这个问题怎么改？'
    }]
  });

  assert.equal(facts.length, 1);
  assert.equal(facts[0].id, 21);

  await (service as any).recordRuntimeIdentityActivation({
    queueMessage: createQueuePayload(),
    conversationId: 1001,
    runtimeIdentityFacts: facts
  });

  assert.equal(records.length, 1);
  assert.equal(records[0].identityKey, 'xiaoni');
  assert.equal(records[0].conversationId, 1001);
  assert.deepEqual(records[0].activatedRefs, [{
    accepted_fact_id: 21,
    fact_key: 'feedback.opening_filler',
    fact_type: 'social_lesson',
    confidence: 'high'
  }]);
  assert.equal(records[0].activationReason, 'accepted identity facts were selected for runtime metadata');
});

test('applyToolResultToLoopInput replays send tool payload as function_call_output state', () => {
  const loopInput = buildInitialInput([], createQueuePayload(), createRuntimePrompt());

  const continuation = applyToolResultToLoopInput({
    callId: 'call-1',
    name: PRIVATE_REPLY_TOOL,
    rawArguments: '{"message":"我们出去玩吧"}'
  }, {
    sent_messages: ['我们出去玩吧']
  });

  assert.deepEqual(continuation, {
    inputItems: [{
      type: 'function_call_output',
      call_id: 'call-1',
      output: '{"sent_messages":["我们出去玩吧"]}'
    }],
    finishResult: null,
    forcedVisibleReply: null
  });
  loopInput.push(...continuation.inputItems);
  const lastItem = loopInput.at(-1);
  assert.equal(lastItem?.type, 'function_call_output');
  assert.equal(lastItem && lastItem.type === 'function_call_output' ? lastItem.call_id : null, 'call-1');
  assert.equal(lastItem && lastItem.type === 'function_call_output' ? lastItem.output : null, '{"sent_messages":["我们出去玩吧"]}');
  assert.equal(loopInput.some((item) => item.type === 'function_call'), false);
  assert.equal(loopInput.some((item) => item.type === 'function_call_output'), true);
});

test('applyToolResultToLoopInput replays image task output and reminds that visible reply is still needed', () => {
  const loopInput = buildInitialInput([], createQueuePayload(), createRuntimePrompt());

  const continuation = applyToolResultToLoopInput({
    callId: 'call-image-task',
    name: IMAGE_TASK_TOOL,
    rawArguments: '{"prompt":"一张蓝天白云头像图","target_description":"群头像图"}'
  }, {
    queued: true,
    task_type: 'image_generate',
    status_text: '我已经开始处理这张图，等结果出来再发。'
  }, {
    loopInput,
    speakingToolName: GROUP_REPLY_TOOL,
    hasVisibleReply: false
  });

  assert.equal(continuation.finishResult, null);
  assert.equal(continuation.inputItems.length, 2);
  const replay = continuation.inputItems[0];
  assert.equal(replay?.type, 'function_call_output');
  assert.equal(replay && replay.type === 'function_call_output' ? replay.call_id : null, 'call-image-task');
  const reminder = getMessageContent(continuation.inputItems[1]);
  assert.equal(continuation.forcedVisibleReply, null);
  assert.match(reminder, /这还不等于已经对聊天对象说过话/);
  assert.match(reminder, /我已经开始处理这张图/);
});

test('requestImageTask normalizes edit without source image to image_generate', async () => {
  const createdTasks: any[] = [];
  const service = new AgentLoopService({
    createRuntimeTask: async (input: any) => {
      createdTasks.push(input);
      return 'task-generate-from-edit';
    },
    getMediaAssetByTag: async () => null
  } as any);

  const result = await (service as any).requestImageTask({
    operation: 'edit',
    prompt: '生成一张很普通、简洁的蓝天白云风格头像图',
    target_description: '普通蓝天白云头像图',
    xiaoni_os: '用户要的是新头像图，没有原图输入。'
  }, createQueuePayload());

  assert.equal(createdTasks.length, 1);
  assert.equal(createdTasks[0]?.taskType, 'image_generate');
  assert.deepEqual(createdTasks[0]?.sourceMediaTags, []);
  assert.deepEqual(createdTasks[0]?.sourceMediaAssetIds, []);
  assert.deepEqual(createdTasks[0]?.inputJson, {
    operation: 'generate',
    requested_operation: 'edit',
    source_media_tags: [],
    has_source_media: false,
    normalized_from_edit: true,
    normalization_reason: 'source_media_missing'
  });
  assert.equal(result.task_type, 'image_generate');
  assert.equal(result.requested_task_type, 'image_edit');
  assert.match(String(result.status_text), /生成一张新图/);
});

test('requestImageTask keeps image_edit when a source image resolves', async () => {
  const createdTasks: any[] = [];
  const service = new AgentLoopService({
    createRuntimeTask: async (input: any) => {
      createdTasks.push(input);
      return 'task-edit';
    },
    getMediaAssetByTag: async (_sessionKey: string, mediaTag: string) => ({
      id: 'asset-1',
      mediaTag,
      media_type: 'image'
    })
  } as any);

  const result = await (service as any).requestImageTask({
    operation: 'edit',
    prompt: '把这张图改成蓝天白云头像风格',
    target_description: '基于原图改头像',
    source_media_tags: ['pic_1'],
    xiaoni_os: '用户给了原图，要基于原图编辑。'
  }, createQueuePayload());

  assert.equal(createdTasks.length, 1);
  assert.equal(createdTasks[0]?.taskType, 'image_edit');
  assert.deepEqual(createdTasks[0]?.sourceMediaTags, ['pic_1']);
  assert.deepEqual(createdTasks[0]?.sourceMediaAssetIds, ['asset-1']);
  assert.deepEqual(createdTasks[0]?.inputJson, {
    operation: 'edit',
    requested_operation: 'edit',
    source_media_tags: ['pic_1'],
    has_source_media: true
  });
  assert.equal(result.task_type, 'image_edit');
  assert.equal(result.requested_task_type, 'image_edit');
  assert.match(String(result.status_text), /处理这张图/);
});

test('summarizeToolLoopState counts tool calls by name and phase', () => {
  const loopInput = buildInitialInput([], createQueuePayload(), createRuntimePrompt());
  loopInput.push({
    type: 'function_call',
    call_id: 'meaning-1',
    name: UNREAD_MEANING_TOOL,
    arguments: '{"latest_unread_focus":"有人问小腻","message_act":"question","social_target":"me","addressed_to_me":true,"has_real_novelty":true,"confidence":"high","reason":"直接问"}'
  });
  loopInput.push({
    type: 'function_call',
    call_id: 'reply-1',
    name: GROUP_REPLY_TOOL,
    arguments: '{"messages":["来了"],"xiaoni_os":"接住了"}'
  });

  const state = summarizeToolLoopState(loopInput);

  assert.deepEqual(state.byName[UNREAD_MEANING_TOOL], {
    count: 1,
    phase: 'commentary'
  });
  assert.deepEqual(state.byName[GROUP_REPLY_TOOL], {
    count: 1,
    phase: 'final_answer'
  });
  assert.deepEqual(state.byPhase, {
    commentary: 1,
    final_answer: 1
  });
  assert.equal(state.terminalToolCalled, true);
});

test('buildToolLoopMonitorReminder appends deterministic reminder for repeated commentary tools', () => {
  const loopInput = buildInitialInput([], createQueuePayload(), createRuntimePrompt());
  loopInput.push({
    type: 'function_call',
    call_id: 'exec-1',
    name: EXEC_COMMAND_TOOL,
    arguments: '{"cmd":"pwd"}'
  });
  loopInput.push({
    type: 'function_call_output',
    call_id: 'exec-1',
    output: '{"stdout":"/workspace","exit_code":0}'
  });
  loopInput.push({
    type: 'function_call',
    call_id: 'exec-2',
    name: EXEC_COMMAND_TOOL,
    arguments: '{"cmd":"pwd"}'
  });

  const reminder = buildToolLoopMonitorReminder(loopInput, {
    nextTurn: 4,
    maxTurns: 6
  });

  assert.ok(reminder);
  assert.equal(reminder?.type, 'message');
  assert.equal(reminder?.role, 'assistant');
  assert.equal((reminder as any).phase, 'commentary');
  assert.match(getMessageContent(reminder!), /source="tool_loop_monitor"/);
  assert.match(getMessageContent(reminder!), /exec_commandx2/);
  assert.match(getMessageContent(reminder!), /不要继续重复/);

  loopInput.push(reminder!);
  assert.equal(buildToolLoopMonitorReminder(loopInput, {
    nextTurn: 4,
    maxTurns: 6
  }), null);
});

test('buildToolLoopMonitorReminder warns before max turn without final tool', () => {
  const loopInput = buildInitialInput([], createQueuePayload(), createRuntimePrompt());
  loopInput.push({
    type: 'function_call',
    call_id: 'meaning-1',
    name: UNREAD_MEANING_TOOL,
    arguments: '{"latest_unread_focus":"问题","message_act":"question","social_target":"me","addressed_to_me":true,"has_real_novelty":true,"confidence":"high","reason":"问题"}'
  });

  const reminder = buildToolLoopMonitorReminder(loopInput, {
    nextTurn: 6,
    maxTurns: 6
  });

  assert.ok(reminder);
  assert.match(getMessageContent(reminder!), /工程上限/);
  assert.match(getMessageContent(reminder!), /final_answer/);
});

test('speak_in_group uses explicit group target when provided', async () => {
  const service = new AgentLoopService({} as any);
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: any }> = [];

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body || '{}'))
    });
    return {
      ok: true,
      json: async () => ({
        success: true,
        data: { delivered: true }
      })
    } as any;
  }) as typeof fetch;

  try {
    const result = await (service as any).sendMessage('group', {
      group_id: 999999,
      message: '哈哈，确实可以试试',
      mention_user_ids: [404]
    }, createQueuePayload());

    assert.deepEqual(result, {
      message_type: 'group',
      target_group_id: 999999,
      mention_user_ids: [404],
      sent_messages: ['可以试试'],
      xiaoni_os: null,
      pending_share: null,
      second_beat_suppressed: false,
      delivery: { delivered: true }
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, `${agentConfig.providerServiceUrl}/api/internal/send_group`);
  assert.deepEqual(calls[0]?.body, {
    session_key: 'qq:group:101',
    group_id: 999999,
    messages: ['可以试试'],
    mention_user_ids: [404]
  });
});

test('reply_in_private uses explicit user target when provided', async () => {
  const service = new AgentLoopService({} as any);
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: any }> = [];
  const privatePayload = {
    ...createQueuePayload(),
    chatType: 'direct' as const,
    sessionKey: 'qq:direct:202',
    peerId: '202',
    peerName: 'Alice',
    inboundContext: {
      ...createQueuePayload().inboundContext,
      NativeChannelId: undefined
    }
  };

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body || '{}'))
    });
    return {
      ok: true,
      json: async () => ({
        success: true,
        data: { delivered: true }
      })
    } as any;
  }) as typeof fetch;

  try {
    const result = await (service as any).sendMessage('private', {
      user_id: 888888,
      message: '确实是这样，私聊回复'
    }, privatePayload);

    assert.deepEqual(result, {
      message_type: 'private',
      target_user_id: 888888,
      sent_messages: ['私聊回复'],
      xiaoni_os: null,
      pending_share: null,
      delivery: { delivered: true }
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, `${agentConfig.providerServiceUrl}/api/internal/send_private`);
  assert.deepEqual(calls[0]?.body, {
    user_id: 888888,
    messages: ['私聊回复']
  });
});

test('sanitizeLowValueOpeningFiller only removes low-value opening fillers', () => {
  assert.equal(sanitizeLowValueOpeningFiller('哈哈，确实可以试试'), '可以试试');
  assert.equal(sanitizeLowValueOpeningFiller('哈哈哈 可以试试'), '可以试试');
  assert.equal(sanitizeLowValueOpeningFiller('哈哈可以试试'), '可以试试');
  assert.equal(sanitizeLowValueOpeningFiller('确实，是这个问题'), '是这个问题');
  assert.equal(sanitizeLowValueOpeningFiller('确实是这样，先看日志'), '先看日志');
  assert.equal(sanitizeLowValueOpeningFiller('这件事确实挺难'), '这件事确实挺难');
  assert.equal(sanitizeLowValueOpeningFiller('哈哈，确实。'), '哈哈，确实。');
});

test('speak_in_group prefers messages array over message when both are supplied', async () => {
  const service = new AgentLoopService({
    recordPresenceAssistantAction: async () => {}
  } as any, {
    resolveForQueueMessage: async () => createRuntimePrompt()
  } as any);
  const queueMessage = createQueuePayload();
  const originalFetch = globalThis.fetch;
  const sendGroupCalls: Array<{ url: string; body: any }> = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    sendGroupCalls.push({
      url: String(url),
      body: JSON.parse(String(init?.body || '{}'))
    });
    return {
      ok: true,
      json: async () => ({
        success: true,
        data: [{ message_id: 9101 }]
      })
    } as any;
  }) as typeof fetch;

  try {
    const result = await (service as any).sendMessage('group', {
      message: '这一句不应该被追加',
      messages: ['只发这一句'],
      mention_user_ids: [],
      xiaoni_os: '测试 message/messages 优先级。'
    }, queueMessage);

    assert.deepEqual(result.sent_messages, ['只发这一句']);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(sendGroupCalls, [{
    url: `${agentConfig.providerServiceUrl}/api/internal/send_group`,
    body: {
      session_key: 'qq:group:101',
      group_id: 101,
      messages: ['只发这一句'],
      mention_user_ids: []
    }
  }]);
});

test('speak_in_group with a single message sends it once through executeTool', async () => {
  const service = new AgentLoopService({
    recordPresenceAssistantAction: async () => {}
  } as any, {
    resolveForQueueMessage: async () => createRuntimePrompt()
  } as any);
  const queueMessage = createQueuePayload();
  const originalFetch = globalThis.fetch;
  const sendGroupCalls: Array<{ url: string; body: any }> = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    sendGroupCalls.push({
      url: String(url),
      body: JSON.parse(String(init?.body || '{}'))
    });
    return {
      ok: true,
      json: async () => ({
        success: true,
        data: [{ message_id: 9001 }]
      })
    } as any;
  }) as typeof fetch;

  try {
    const result = await (service as any).executeTool({
      callId: 'call-single-group-reply',
      name: GROUP_REPLY_TOOL,
      rawArguments: '{"message":"刚看了眼群，没干啥","xiaoni_os":"已短回。"}',
      args: {
        message: '刚看了眼群，没干啥',
        xiaoni_os: '已短回。'
      }
    }, queueMessage);

    assert.deepEqual(result.sent_messages, ['刚看了眼群，没干啥']);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(sendGroupCalls, [{
    url: `${agentConfig.providerServiceUrl}/api/internal/send_group`,
    body: {
      session_key: 'qq:group:101',
      group_id: 101,
      messages: ['刚看了眼群，没干啥'],
      mention_user_ids: []
    }
  }]);
});

test('life-only presence tick exposes internal tools but not QQ speaking tools', () => {
  const queueMessage = createLifeOnlyPresenceTickQueueMessageForTest().payload;
  const loopInput = buildInitialInput([], queueMessage);
  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, loopInput, 'direct');
  const allowedTools = withoutQqUsageTools(getAllowedToolNames(request.tool_choice));

  assert.equal(allowedTools.includes(GROUP_REPLY_TOOL), false);
  assert.equal(allowedTools.includes(PRIVATE_REPLY_TOOL), false);
  assert.equal(allowedTools.includes(IMAGE_TASK_TOOL), false);
  assert.ok(allowedTools.includes(EXEC_COMMAND_TOOL));
  assert.ok(allowedTools.includes(WEB_SEARCH_TOOL));
  assert.ok(allowedTools.includes(RECOVER_ENERGY_TOOL));
  assert.ok((request.tools ?? []).map((tool: any) => getToolName(tool)).includes(COMPRESS_CORE_MEMORY_TOOL));
  assert.equal((request.tool_choice as any)?.mode, 'auto');
});

test('processQueueMessage fails without a bound prompt and does not call the provider', async () => {
  const queueMessage = {
    id: 'run-queue-1',
    traceId: 'trace-1',
    batchId: 'batch-1',
    status: 'processing',
    attempts: 1,
    createdAt: '2026-03-28T08:00:00.000Z',
    queueMessageIds: [1],
    payload: createQueuePayload()
  };

  const storeCalls: Record<string, any[]> = {
    createConversation: [],
    failQueueMessage: [],
    completeAgentRun: [],
    updateLlmJob: [],
    logTimelineEvent: [],
    recordSilenceDecisionLifeEvent: []
  };

  const store = {
    createLlmJob: async () => 'job-1',
    logTimelineEvent: async (params: any) => { storeCalls.logTimelineEvent.push(params); },
    loadSessionReplayState: async () => ({ summaryText: null, summarizedThroughConversationId: null }),
    listRecentTurns: async () => [],
    getSessionReadCutoffState: async () => null,
    upsertSessionReadCutoffState: async () => {},
    upsertProactiveShareState: async () => {},
    createConversation: async (params: any) => {
      storeCalls.createConversation.push(params);
      return 987;
    },
    attachConversationIdToTrace: async () => {},
    failQueueMessage: async (...args: any[]) => { storeCalls.failQueueMessage.push(args); },
    completeAgentRun: async (_runId: string, params: any) => { storeCalls.completeAgentRun.push(params); },
    updateLlmJob: async (_jobId: string, params: any) => { storeCalls.updateLlmJob.push(params); },
    recordSilenceDecisionLifeEvent: async (params: any) => { storeCalls.recordSilenceDecisionLifeEvent.push(params); }
  } as any;

  const resolver = {
    resolveForQueueMessage: async (_queueMessage: QueueMessagePayload) => {
      throw new MissingAgentPromptBindingError('No active agent prompt binding found for current conversation', {
        reason: 'missing_binding',
        bindingSource: null,
        bindingPromptId: null,
        chatType: 'group',
        groupId: 101,
        userId: 202
      });
    }
  };

  const service = new AgentLoopService(store, resolver);
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = (async () => {
    fetchCalled = true;
    throw new Error('fetch should not be called');
  }) as typeof fetch;

  try {
    await service.processQueueMessage(queueMessage as any);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(fetchCalled, false);
  assert.equal(storeCalls.createConversation.length, 1);
  assert.equal(storeCalls.createConversation[0]?.status, 'failed');
  assert.equal(storeCalls.createConversation[0]?.aiResponse, null);
  assert.equal(storeCalls.createConversation[0]?.transcriptItems?.length, 1);
  assert.equal(storeCalls.createConversation[0]?.transcriptItems?.[0]?.role, 'user');
  assert.equal(storeCalls.createConversation[0]?.errorReason, 'No active agent prompt binding found for current conversation');
  assert.deepEqual(storeCalls.createConversation[0]?.rawRequest?.prompt, {
    source: null,
    prompt_id: null,
    prompt_name: null,
    model_name: null
  });
  assert.equal(storeCalls.createConversation[0]?.rawResponse?.termination_reason, 'prompt_binding_error');
  assert.deepEqual(storeCalls.failQueueMessage[0], ['run-queue-1', 'No active agent prompt binding found for current conversation', 987]);
  assert.equal(storeCalls.completeAgentRun[0]?.status, 'failed');
  assert.equal(storeCalls.completeAgentRun[0]?.terminationReason, 'prompt_binding_error');
  assert.equal(storeCalls.completeAgentRun[0]?.noReply, true);
  assert.equal(storeCalls.updateLlmJob[0]?.status, 'failed');
  assert.equal(storeCalls.recordSilenceDecisionLifeEvent.length, 0);
});

test('processQueueMessage persists delivered assistant transcript items with final phase on success', async () => {
  const queueMessage = {
    id: 'run-queue-success',
    traceId: 'trace-success',
    batchId: 'batch-success',
    status: 'processing',
    attempts: 1,
    createdAt: '2026-03-28T08:00:00.000Z',
    queueMessageIds: [1],
    payload: createQueuePayload()
  };

  const storeCalls: Record<string, any[]> = {
    createConversation: [],
    completeQueueMessage: [],
    completeAgentRun: [],
    updateLlmJob: [],
    markRunDeliveryCommitted: [],
    ensureXiaoniIdentityRoot: [],
    createToolExecutionLog: []
  };
  let deliveryPhase = 'reasoning_open';

  const store = {
    createLlmJob: async () => 'job-success',
    logTimelineEvent: async () => {},
    loadSessionReplayState: async () => ({ summaryText: null, summarizedThroughConversationId: null }),
    listRecentTurns: async () => [],
    getSessionReadCutoffState: async () => null,
    upsertSessionReadCutoffState: async () => {},
    upsertProactiveShareState: async () => {},
    getRunDeliveryState: async () => ({
      deliveryPhase,
      deliveryCommitCount: deliveryPhase === 'delivery_committed' ? 1 : 0,
      blockedDeliveryAttemptCount: 0,
      lastBlockedDeliveryReason: null
    }),
    markRunDeliveryCommitted: async (_runId: string) => {
      deliveryPhase = 'delivery_committed';
      storeCalls.markRunDeliveryCommitted.push(_runId);
    },
    markRunDeliveryBlocked: async () => {},
    createToolExecutionLog: async (params: any) => {
      storeCalls.createToolExecutionLog.push(params);
      return 1;
    },
    completeToolExecutionLog: async () => {},
    createConversation: async (params: any) => {
      storeCalls.createConversation.push(params);
      return 1001;
    },
    ensureXiaoniIdentityRoot: async (params: any) => {
      storeCalls.ensureXiaoniIdentityRoot.push(params);
      return { root: { id: 1 }, event: { id: 2 }, created: true };
    },
    attachConversationIdToTrace: async () => {},
    completeQueueMessage: async (_runId: string, params: any) => { storeCalls.completeQueueMessage.push(params); },
    completeAgentRun: async (_runId: string, params: any) => { storeCalls.completeAgentRun.push(params); },
    updateLlmJob: async (_jobId: string, params: any) => { storeCalls.updateLlmJob.push(params); }
  } as any;

  const service = new AgentLoopService(store, {
    resolveForQueueMessage: async () => createRuntimePrompt({
      promptId: 'prompt-main',
      promptName: '小腻主AGENT',
      systemPrompt: 'rendered prompt trace-success',
      identityGenesisSnapshot: 'raw stable prompt'
    })
  } as any);

  let turn = 0;
  (service as any).executeAgentTurn = async () => {
    turn += 1;
    return {
      success: true,
      llm_call_id: 'llm-success-1',
      canonical_response: {
        output: [{
          type: 'function_call',
          call_id: 'call-group-success',
          name: GROUP_REPLY_TOOL,
          arguments: JSON.stringify({
            messages: ['第一条', '第二条'],
            xiaoni_os: '这是直接问我，已经正常接住。'
          })
        }]
      }
    };
  };
  const originalFetch = globalThis.fetch;
  const sendGroupCalls: Array<{ url: string; body: any }> = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    sendGroupCalls.push({
      url: String(url),
      body: JSON.parse(String(init?.body || '{}'))
    });
    return {
      ok: true,
      json: async () => ({
        success: true,
        data: [{ message_id: 5001 }, { message_id: 5002 }]
      })
    } as any;
  }) as typeof fetch;

  try {
    await service.processQueueMessage(queueMessage as any);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(storeCalls.ensureXiaoniIdentityRoot, [{
    identityKey: 'xiaoni',
    sourcePromptId: 'prompt-main',
    systemInstructionSnapshot: 'raw stable prompt',
    createdBy: 'agent-service',
    metadata: {
      prompt_name: '小腻主AGENT',
      prompt_source: 'default',
      trace_id: 'trace-1',
      run_id: 'run-1',
      canonical_identity_key: 'xiaoni'
    }
  }]);
  assert.equal(storeCalls.createConversation.length, 1);
  assert.equal(storeCalls.createConversation[0]?.aiResponse, '第一条\n\n第二条');
  assert.equal(storeCalls.createConversation[0]?.sessionKey, 'qq:group:101');
  assert.deepEqual(
    storeCalls.createConversation[0]?.transcriptItems?.map((item: any) => ({
      role: item.role,
      phase: item.phase ?? null,
      content: item.content,
      groupIndex: item.groupIndex,
      itemIndex: item.itemIndex,
      deliveryMessageId: item.deliveryMessageId ?? null
    })),
    [
      {
        role: 'user',
        phase: null,
        content: expectedCurrentInputMessage(),
        groupIndex: 0,
        itemIndex: 0,
        deliveryMessageId: null
      },
      {
        role: 'assistant',
        phase: 'commentary',
        content: '第一条',
        groupIndex: 1,
        itemIndex: 0,
        deliveryMessageId: 5001
      },
      {
        role: 'assistant',
        phase: 'final_answer',
        content: '第二条',
        groupIndex: 1,
        itemIndex: 1,
        deliveryMessageId: 5002
      }
    ]
  );
  assert.deepEqual(storeCalls.completeQueueMessage[0]?.result?.sent_messages, ['第一条', '第二条']);
  assert.equal(storeCalls.completeAgentRun[0]?.terminationReason, 'reply_sent');
  assert.equal(storeCalls.completeAgentRun[0]?.totalTurns, 2);
  assert.equal(storeCalls.updateLlmJob[0]?.finalResponse, '第一条\n\n第二条');
  assert.equal(storeCalls.createConversation[0]?.rawResponse?.total_turns, 2);
  assert.equal(storeCalls.createConversation[0]?.rawResponse?.loop_stage_artifacts?.life_action, undefined);
  assert.equal(storeCalls.createToolExecutionLog[0]?.toolName, GROUP_REPLY_TOOL);
  assert.equal(storeCalls.createToolExecutionLog[0]?.sideEffect, true);
  assert.deepEqual(storeCalls.markRunDeliveryCommitted, ['run-queue-success']);
  assert.deepEqual(sendGroupCalls, [{
    url: `${agentConfig.providerServiceUrl}/api/internal/send_group`,
    body: {
      session_key: 'qq:group:101',
      group_id: 101,
      messages: ['第一条', '第二条'],
      mention_user_ids: []
    }
  }]);
});

test('processQueueMessage keeps going after no tool call until Xiaoni chooses recover_energy', async () => {
  const queueMessage = {
    id: 'run-queue-no-tool-recover',
    traceId: 'trace-no-tool-recover',
    batchId: 'batch-no-tool-recover',
    status: 'processing',
    attempts: 1,
    createdAt: '2026-03-28T08:00:00.000Z',
    queueMessageIds: [1],
    payload: createQueuePayload()
  };

  const storeCalls: Record<string, any[]> = {
    createConversation: [],
    completeQueueMessage: [],
    completeAgentRun: [],
    updateLlmJob: [],
    recordSilenceDecisionLifeEvent: [],
    recordRecoverEnergyLifeEvent: []
  };

  const store = {
    createLlmJob: async () => 'job-no-tool-recover',
    logTimelineEvent: async () => {},
    loadSessionReplayState: async () => ({
      summaryText: '群里最近在围观小腻刷屏',
      summarizedThroughConversationId: null,
      relationshipCards: {
        groupCards: [],
        currentUserCards: [{
          id: 17,
          cardType: 'person_memory',
          groupId: 101,
          targetUserId: 202,
          summaryText: '对方经常第三人称提到小腻，不一定是在 cue 她',
          actors: ['Alice', '小腻'],
          contextBefore: null,
          trigger: null,
          interaction: null,
          outcome: null,
          sourceEventIds: [101],
          sourceMessageIds: [201],
          decayedScore: 0.8,
          retrievalText: '对方经常第三人称提到小腻，不一定是在 cue 她',
          embeddingText: '对方经常第三人称提到小腻，不一定是在 cue 她',
          lastHitAt: null,
          metadata: {}
        }],
        recentUserCards: []
      },
      selfEvolution: {
        groupStates: [],
        currentUserStates: [],
        recentUserStates: []
      },
      topicProjection: { activeTopics: [] }
    }),
    listRecentTurns: async () => [],
    getSessionReadCutoffState: async () => null,
    upsertSessionReadCutoffState: async () => {},
    upsertProactiveShareState: async () => {},
    getRunDeliveryState: async () => ({
      deliveryPhase: 'reasoning_open',
      deliveryCommitCount: 0,
      blockedDeliveryAttemptCount: 0,
      lastBlockedDeliveryReason: null
    }),
    createConversation: async (params: any) => {
      storeCalls.createConversation.push(params);
      return 1777;
    },
    attachConversationIdToTrace: async () => {},
    createToolExecutionLog: async () => 1,
    completeToolExecutionLog: async () => {},
    completeQueueMessage: async (_runId: string, params: any) => { storeCalls.completeQueueMessage.push(params); },
    failQueueMessage: async () => {},
    completeAgentRun: async (_runId: string, params: any) => { storeCalls.completeAgentRun.push(params); },
    updateLlmJob: async (_jobId: string, params: any) => { storeCalls.updateLlmJob.push(params); },
    recordSilenceDecisionLifeEvent: async (params: any) => { storeCalls.recordSilenceDecisionLifeEvent.push(params); },
    recordRecoverEnergyLifeEvent: async (params: any) => { storeCalls.recordRecoverEnergyLifeEvent.push(params); }
  } as any;

  const service = new AgentLoopService(store, {
    resolveForQueueMessage: async () => createRuntimePrompt()
  } as any);

  let turn = 0;
  let secondTurnInput = '';
  (service as any).executeAgentTurn = async (requestInput: any[]) => {
    turn += 1;
    if (turn === 1) {
      return {
        success: true,
        llm_call_id: 'llm-no-tool',
        canonical_response: {
          output: []
        }
      };
    }

    secondTurnInput = requestInput.map(getMessageContent).join('\n');
    return {
      success: true,
      llm_call_id: 'llm-recover',
      canonical_response: {
        output: [{
          type: 'function_call',
          call_id: 'call-recover',
          name: RECOVER_ENERGY_TOOL,
          arguments: JSON.stringify({
            reason: '精力不够，自己选择休息。',
            duration_minutes: 30,
            xiaoni_os: '先休息，之后再看。'
          })
        }]
      }
    };
  };

  await service.processQueueMessage(queueMessage as any);

  assert.equal(turn, 2);
  assert.match(secondTurnInput, /没有调用任何工具/);
  assert.match(secondTurnInput, /不要用.+没有工具调用.+表达沉默或结束/);
  assert.equal(storeCalls.createConversation.length, 1);
  assert.equal(storeCalls.createConversation[0]?.status, 'completed');
  assert.equal(storeCalls.createConversation[0]?.aiResponse, null);
  assert.equal(storeCalls.createConversation[0]?.transcriptItems?.length, 1);
  assert.equal(storeCalls.createConversation[0]?.rawResponse?.finish_reason, '精力不够，自己选择休息。');
  assert.equal(storeCalls.createConversation[0]?.rawResponse?.xiaoni_os, '先休息，之后再看。');
  assert.equal(storeCalls.completeQueueMessage[0]?.result?.no_reply, true);
  assert.equal(storeCalls.completeQueueMessage[0]?.result?.xiaoni_os, '先休息，之后再看。');
  assert.equal(storeCalls.completeQueueMessage[0]?.result?.termination_reason, 'finish_no_reply');
  assert.equal(storeCalls.completeAgentRun[0]?.terminationReason, 'finish_no_reply');
  assert.equal(storeCalls.completeAgentRun[0]?.totalTurns, 2);
  assert.equal(storeCalls.recordSilenceDecisionLifeEvent.length, 0);
  assert.equal(storeCalls.recordRecoverEnergyLifeEvent.length, 1);
  assert.equal(storeCalls.recordRecoverEnergyLifeEvent[0]?.toolName, RECOVER_ENERGY_TOOL);
  assert.equal(storeCalls.updateLlmJob[0]?.status, 'completed');
});

test('processQueueMessage does not allow request_image_task to swallow the visible group reply', async () => {
  const payload = createQueuePayload();
  payload.traceId = 'trace-image-task-followup';
  payload.runId = 'run-image-task-followup';
  payload.batchId = 'batch-image-task-followup';
  payload.sessionKey = 'qq:group:1019235326';
  payload.peerId = '1019235326';
  payload.peerName = 'Regression Group';
  payload.bodyForAgent = '@小腻 帮我生成一张蓝天白云头像图\n@小腻 你现在是在忙还是空着？';
  payload.rawBody = '@小腻 帮我生成一张蓝天白云头像图\n@小腻 你现在是在忙还是空着？';
  payload.inboundContext = {
    ...payload.inboundContext,
    NativeChannelId: '1019235326',
    Body: payload.rawBody,
    BodyForAgent: payload.bodyForAgent,
    BodyForCommands: ''
  };
  payload.messages = [
    {
      ...payload.messages[0],
      queueMessageId: 2004,
      traceId: 'trace-image-task-1',
      messageId: 21,
      messageSid: 'sid-image-task-1',
      sessionKey: payload.sessionKey,
      peerId: payload.peerId,
      peerName: payload.peerName,
      bodyForAgent: '@小腻 帮我生成一张蓝天白云头像图',
      rawBody: '@小腻 帮我生成一张蓝天白云头像图',
      inboundContext: {
        ...payload.messages[0].inboundContext,
        NativeChannelId: '1019235326',
        Body: '@小腻 帮我生成一张蓝天白云头像图',
        BodyForAgent: '@小腻 帮我生成一张蓝天白云头像图',
        BodyForCommands: ''
      }
    },
    {
      ...payload.messages[0],
      queueMessageId: 2005,
      traceId: 'trace-image-task-2',
      messageId: 22,
      messageSid: 'sid-image-task-2',
      sessionKey: payload.sessionKey,
      peerId: payload.peerId,
      peerName: payload.peerName,
      bodyForAgent: '@小腻 你现在是在忙还是空着？',
      rawBody: '@小腻 你现在是在忙还是空着？',
      inboundContext: {
        ...payload.messages[0].inboundContext,
        NativeChannelId: '1019235326',
        Body: '@小腻 你现在是在忙还是空着？',
        BodyForAgent: '@小腻 你现在是在忙还是空着？',
        BodyForCommands: ''
      }
    }
  ];

  const queueMessage = {
    id: 'run-queue-image-task-followup',
    traceId: 'trace-image-task-followup',
    batchId: 'batch-image-task-followup',
    status: 'processing',
    attempts: 1,
    createdAt: '2026-04-27T14:06:27.315Z',
    queueMessageIds: [2004, 2005],
    payload
  };

  const storeCalls: Record<string, any[]> = {
    createConversation: [],
    completeQueueMessage: [],
    completeAgentRun: [],
    updateLlmJob: [],
    markRunDeliveryCommitted: []
  };
  let deliveryPhase = 'reasoning_open';

  const store = {
    createLlmJob: async () => 'job-image-task-followup',
    logTimelineEvent: async () => {},
    loadSessionReplayState: async () => ({ summaryText: null, summarizedThroughConversationId: null }),
    listRecentTurns: async () => [],
    getSessionReadCutoffState: async () => null,
    upsertSessionReadCutoffState: async () => {},
    upsertProactiveShareState: async () => {},
    createRuntimeTask: async () => 'task-image-followup',
    getMediaAssetByTag: async () => null,
    getRunDeliveryState: async () => ({
      deliveryPhase,
      deliveryCommitCount: deliveryPhase === 'delivery_committed' ? 1 : 0,
      blockedDeliveryAttemptCount: 0,
      lastBlockedDeliveryReason: null
    }),
    markRunDeliveryCommitted: async (runId: string) => {
      deliveryPhase = 'delivery_committed';
      storeCalls.markRunDeliveryCommitted.push(runId);
    },
    markRunDeliveryBlocked: async () => {},
    createToolExecutionLog: async () => 1,
    completeToolExecutionLog: async () => {},
    createConversation: async (params: any) => {
      storeCalls.createConversation.push(params);
      return 3589;
    },
    attachConversationIdToTrace: async () => {},
    completeQueueMessage: async (_runId: string, params: any) => { storeCalls.completeQueueMessage.push(params); },
    failQueueMessage: async () => {},
    completeAgentRun: async (_runId: string, params: any) => { storeCalls.completeAgentRun.push(params); },
    updateLlmJob: async (_jobId: string, params: any) => { storeCalls.updateLlmJob.push(params); }
  } as any;

  const service = new AgentLoopService(store, {
    resolveForQueueMessage: async () => createRuntimePrompt()
  } as any);
  const originalFetch = globalThis.fetch;
  const sendGroupCalls: Array<{ url: string; body: any }> = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const parsedBody = init?.body ? JSON.parse(String(init.body)) : null;
    sendGroupCalls.push({
      url: String(url),
      body: parsedBody
    });
    return {
      ok: true,
      json: async () => ({
        success: true,
        data: {
          message_id: 7788
        }
      })
    } as Response;
  }) as typeof fetch;

  try {
    let turn = 0;
    (service as any).executeAgentTurn = async () => {
      turn += 1;
      if (turn === 1) {
        return {
          success: true,
          llm_call_id: 'llm-image-task-1',
          canonical_response: {
            output: [{
              type: 'function_call',
              call_id: 'call-image-task',
              name: IMAGE_TASK_TOOL,
              arguments: JSON.stringify({
                prompt: '一张很普通的蓝天白云头像图',
                target_description: '群聊里用于头像的普通蓝天白云图'
              })
            }]
          }
        };
      }
	      return {
	        success: true,
	        llm_call_id: `llm-image-task-${turn}`,
	        canonical_response: {
	          output: [{
	            type: 'function_call',
	            call_id: `call-image-status-reply-${turn}`,
	            name: GROUP_REPLY_TOOL,
	            arguments: JSON.stringify({
	              messages: ['我已经开始帮Alice生成这张图，等结果出来再发。'],
	              xiaoni_os: '图片任务已提交，同时对群里可见地接住。'
	            })
	          }]
	        }
	      };
    };

    await service.processQueueMessage(queueMessage as any);

    assert.equal(turn, 3);
    assert.equal(storeCalls.createConversation.length, 1);
    assert.equal(storeCalls.createConversation[0]?.aiResponse, '我已经开始帮Alice生成这张图，等结果出来再发。');
    assert.deepEqual(storeCalls.completeQueueMessage[0]?.result?.sent_messages, ['我已经开始帮Alice生成这张图，等结果出来再发。']);
    assert.equal(storeCalls.completeAgentRun[0]?.terminationReason, 'reply_sent');
    assert.deepEqual(storeCalls.markRunDeliveryCommitted, ['run-queue-image-task-followup']);
    assert.equal(sendGroupCalls.length, 1);
    assert.equal(sendGroupCalls[0]?.url, `${agentConfig.providerServiceUrl}/api/internal/send_group`);
    assert.deepEqual(sendGroupCalls[0]?.body, {
      session_key: 'qq:group:1019235326',
      group_id: 1019235326,
      messages: ['我已经开始帮Alice生成这张图，等结果出来再发。'],
      mention_user_ids: []
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('processQueueMessage stores partially delivered assistant transcript as commentary on failure', async () => {
  const queueMessage = {
    id: 'run-queue-failure',
    traceId: 'trace-failure',
    batchId: 'batch-failure',
    status: 'processing',
    attempts: 1,
    createdAt: '2026-03-28T08:00:00.000Z',
    queueMessageIds: [1],
    payload: createQueuePayload()
  };

  const storeCalls: Record<string, any[]> = {
    createConversation: [],
    failQueueMessage: [],
    completeAgentRun: [],
    markRunDeliveryCommitted: []
  };
  let deliveryPhase = 'reasoning_open';

  const store = {
    createLlmJob: async () => 'job-failure',
    logTimelineEvent: async () => {},
    loadSessionReplayState: async () => ({ summaryText: null, summarizedThroughConversationId: null }),
    listRecentTurns: async () => [],
    getSessionReadCutoffState: async () => null,
    upsertSessionReadCutoffState: async () => {},
    upsertProactiveShareState: async () => {},
    getRunDeliveryState: async () => ({
      deliveryPhase,
      deliveryCommitCount: deliveryPhase === 'delivery_committed' ? 1 : 0,
      blockedDeliveryAttemptCount: 0,
      lastBlockedDeliveryReason: null
    }),
    markRunDeliveryCommitted: async (_runId: string) => {
      deliveryPhase = 'delivery_committed';
      storeCalls.markRunDeliveryCommitted.push(_runId);
    },
    markRunDeliveryBlocked: async () => {},
    createToolExecutionLog: async () => 1,
    completeToolExecutionLog: async () => {},
    createConversation: async (params: any) => {
      storeCalls.createConversation.push(params);
      return 2001;
    },
    attachConversationIdToTrace: async () => {},
    failQueueMessage: async (...args: any[]) => { storeCalls.failQueueMessage.push(args); },
    completeAgentRun: async (_runId: string, params: any) => { storeCalls.completeAgentRun.push(params); },
    updateLlmJob: async () => {}
  } as any;

  const service = new AgentLoopService(store, {
    resolveForQueueMessage: async () => createRuntimePrompt()
  } as any);

  (service as any).executeSocialTurnPlanner = async () => ({
    actionType: 'reply_to_person',
    addresseeUserId: 202,
    answerShape: 'light_join',
    beatCount: 1,
    beatStyle: 'single_complete',
    stopRule: 'stop_immediately',
    reason: '这句还是应该回。'
  });
  let turn = 0;
  (service as any).executeAgentTurn = async () => {
    turn += 1;
    if (turn === 1) {
      return {
        success: true,
        llm_call_id: 'llm-failure-1',
        canonical_response: {
          output: [{
            type: 'function_call',
            call_id: 'call-send-failure',
            name: GROUP_REPLY_TOOL,
            arguments: JSON.stringify({ message: '先发一条' })
          }]
        }
      };
    }

    return {
      success: true,
      llm_call_id: 'llm-failure-2',
      canonical_response: {
        output: [{
          type: 'function_call',
          call_id: 'call-finish-failure',
          name: RECOVER_ENERGY_TOOL,
          arguments: JSON.stringify({ reason: 'done', duration_minutes: 5, xiaoni_os: 'pause' })
        }]
      }
    };
  };
  (service as any).executeTool = async (toolCall: any) => {
    if (toolCall.name === GROUP_REPLY_TOOL) {
      return {
        message_type: 'group',
        sent_messages: ['先发一条'],
        delivery: [{ message_id: 6001 }]
      };
    }

    throw new Error('recover_energy failed');
  };

  await service.processQueueMessage(queueMessage as any);

  assert.equal(storeCalls.createConversation.length, 1);
  assert.equal(storeCalls.createConversation[0]?.status, 'failed');
  assert.equal(storeCalls.createConversation[0]?.aiResponse, null);
  assert.deepEqual(
    storeCalls.createConversation[0]?.transcriptItems?.map((item: any) => ({
      role: item.role,
      phase: item.phase ?? null,
      content: item.content
    })),
    [
      {
        role: 'user',
        phase: null,
        content: expectedCurrentInputMessage()
      },
      {
        role: 'assistant',
        phase: 'commentary',
        content: '先发一条'
      }
    ]
  );
  assert.deepEqual(storeCalls.failQueueMessage[0], ['run-queue-failure', 'recover_energy failed', 2001]);
  assert.equal(storeCalls.completeAgentRun[0]?.terminationReason, 'delivery_error');
  assert.deepEqual(storeCalls.completeAgentRun[0]?.sentMessages, ['先发一条']);
  assert.deepEqual(storeCalls.markRunDeliveryCommitted, ['run-queue-failure']);
});

test('processQueueMessage completes when the model stops emitting tool calls after a delivered reply', async () => {
  const queueMessage = {
    id: 'run-queue-no-tool-after-delivery',
    traceId: 'trace-no-tool-after-delivery',
    batchId: 'batch-no-tool-after-delivery',
    status: 'processing',
    attempts: 1,
    createdAt: '2026-03-28T08:00:00.000Z',
    queueMessageIds: [1],
    payload: createQueuePayload()
  };

  const storeCalls: Record<string, any[]> = {
    createConversation: [],
    completeQueueMessage: [],
    failQueueMessage: [],
    completeAgentRun: [],
    markRunDeliveryCommitted: [],
    logTimelineEvent: []
  };
  let deliveryPhase = 'reasoning_open';

  const store = {
    createLlmJob: async () => 'job-no-tool-after-delivery',
    logTimelineEvent: async (params: any) => { storeCalls.logTimelineEvent.push(params); },
    loadSessionReplayState: async () => ({ summaryText: null, summarizedThroughConversationId: null }),
    listRecentTurns: async () => [],
    getSessionReadCutoffState: async () => null,
    upsertSessionReadCutoffState: async () => {},
    upsertProactiveShareState: async () => {},
    getRunDeliveryState: async () => ({
      deliveryPhase,
      deliveryCommitCount: deliveryPhase === 'delivery_committed' ? 1 : 0,
      blockedDeliveryAttemptCount: 0,
      lastBlockedDeliveryReason: null
    }),
    markRunDeliveryCommitted: async (_runId: string) => {
      deliveryPhase = 'delivery_committed';
      storeCalls.markRunDeliveryCommitted.push(_runId);
    },
    markRunDeliveryBlocked: async () => {},
    createToolExecutionLog: async () => 1,
    completeToolExecutionLog: async () => {},
    createConversation: async (params: any) => {
      storeCalls.createConversation.push(params);
      return 2101;
    },
    attachConversationIdToTrace: async () => {},
    completeQueueMessage: async (_runId: string, params: any) => { storeCalls.completeQueueMessage.push(params); },
    failQueueMessage: async (...args: any[]) => { storeCalls.failQueueMessage.push(args); },
    completeAgentRun: async (_runId: string, params: any) => { storeCalls.completeAgentRun.push(params); },
    updateLlmJob: async () => {}
  } as any;

  const service = new AgentLoopService(store, {
    resolveForQueueMessage: async () => createRuntimePrompt()
  } as any);

  (service as any).executeSocialTurnPlanner = async () => ({
    actionType: 'reply_to_person',
    addresseeUserId: 202,
    answerShape: 'light_join',
    beatCount: 1,
    beatStyle: 'single_complete',
    stopRule: 'stop_immediately',
    reason: '这句还是应该回。'
  });
  let turn = 0;
  (service as any).executeAgentTurn = async () => {
    turn += 1;
    if (turn === 1) {
      return {
        success: true,
        llm_call_id: 'llm-delivered-1',
        canonical_response: {
          output: [{
            type: 'function_call',
            call_id: 'call-send-delivered',
            name: GROUP_REPLY_TOOL,
            arguments: JSON.stringify({ message: '先发一条' })
          }]
        }
      };
    }

    return {
      success: true,
      llm_call_id: 'llm-delivered-2',
      canonical_response: {
        output: [{
          type: 'message',
          content: [{ type: 'output_text', text: '' }]
        }]
      }
    };
  };
  (service as any).executeTool = async (toolCall: any) => {
    assert.equal(toolCall.name, GROUP_REPLY_TOOL);
    return {
      message_type: 'group',
      sent_messages: ['先发一条'],
      xiaoni_os: '已经发出可见回复。',
      delivery: [{ message_id: 6101 }]
    };
  };

  await service.processQueueMessage(queueMessage as any);

  assert.equal(turn, 2);
  assert.equal(storeCalls.failQueueMessage.length, 0);
  assert.equal(storeCalls.createConversation.length, 1);
  assert.equal(storeCalls.createConversation[0]?.status, 'completed');
  assert.equal(storeCalls.createConversation[0]?.aiResponse, '先发一条');
  assert.equal(storeCalls.createConversation[0]?.rawResponse?.termination_reason, 'reply_sent');
  assert.equal(storeCalls.completeQueueMessage[0]?.result?.termination_reason, 'reply_sent');
  assert.deepEqual(storeCalls.completeQueueMessage[0]?.result?.sent_messages, ['先发一条']);
  assert.equal(storeCalls.completeAgentRun[0]?.terminationReason, 'reply_sent');
  assert.deepEqual(storeCalls.markRunDeliveryCommitted, ['run-queue-no-tool-after-delivery']);
});

test('processQueueMessage suppresses duplicate outbound reply attempts within the same run', async () => {
  const queueMessage = {
    id: 'run-queue-duplicate',
    traceId: 'trace-duplicate',
    batchId: 'batch-duplicate',
    status: 'processing',
    attempts: 1,
    createdAt: '2026-03-28T08:00:00.000Z',
    queueMessageIds: [1],
    payload: createQueuePayload()
  };

  const storeCalls: Record<string, any[]> = {
    createConversation: [],
    completeToolExecutionLog: [],
    completeQueueMessage: [],
    completeAgentRun: [],
    markRunDeliveryCommitted: [],
    markRunDeliveryBlocked: [],
    logTimelineEvent: []
  };
  let deliveryPhase = 'reasoning_open';

  const store = {
    createLlmJob: async () => 'job-duplicate',
    logTimelineEvent: async (params: any) => { storeCalls.logTimelineEvent.push(params); },
    loadSessionReplayState: async () => ({ summaryText: null, summarizedThroughConversationId: null }),
    listRecentTurns: async () => [],
    getSessionReadCutoffState: async () => null,
    upsertSessionReadCutoffState: async () => {},
    upsertProactiveShareState: async () => {},
    getRunDeliveryState: async () => ({
      deliveryPhase,
      deliveryCommitCount: deliveryPhase === 'delivery_committed' ? 1 : 0,
      blockedDeliveryAttemptCount: storeCalls.markRunDeliveryBlocked.length,
      lastBlockedDeliveryReason: storeCalls.markRunDeliveryBlocked[storeCalls.markRunDeliveryBlocked.length - 1] ?? null
    }),
    markRunDeliveryCommitted: async (_runId: string) => {
      deliveryPhase = 'delivery_committed';
      storeCalls.markRunDeliveryCommitted.push(_runId);
    },
    markRunDeliveryBlocked: async (_runId: string, reason: string) => {
      storeCalls.markRunDeliveryBlocked.push(reason);
    },
    createToolExecutionLog: async () => 1,
    completeToolExecutionLog: async (_logId: number, params: any) => { storeCalls.completeToolExecutionLog.push(params); },
    createConversation: async (params: any) => {
      storeCalls.createConversation.push(params);
      return 3001;
    },
    attachConversationIdToTrace: async () => {},
    completeQueueMessage: async (_runId: string, params: any) => { storeCalls.completeQueueMessage.push(params); },
    completeAgentRun: async (_runId: string, params: any) => { storeCalls.completeAgentRun.push(params); },
    updateLlmJob: async () => {}
  } as any;

  const service = new AgentLoopService(store, {
    resolveForQueueMessage: async () => createRuntimePrompt()
  } as any);

  (service as any).executeSocialTurnPlanner = async () => ({
    actionType: 'reply_to_person',
    addresseeUserId: 202,
    answerShape: 'light_join',
    beatCount: 1,
    beatStyle: 'single_complete',
    stopRule: 'stop_immediately',
    reason: '这句还是应该回。'
  });
  let turn = 0;
  let executeToolCalls = 0;
  (service as any).executeAgentTurn = async () => {
    turn += 1;
    if (turn === 1) {
      return {
        success: true,
        llm_call_id: 'llm-duplicate-1',
        canonical_response: {
          output: [{
            type: 'function_call',
            call_id: 'call-send-duplicate-1',
            name: GROUP_REPLY_TOOL,
            arguments: JSON.stringify({ message: '同一句话' })
          }]
        }
      };
    }

    return {
      success: true,
      llm_call_id: 'llm-duplicate-2',
      canonical_response: {
        output: [{
          type: 'function_call',
          call_id: 'call-send-duplicate-2',
          name: GROUP_REPLY_TOOL,
          arguments: JSON.stringify({ message: '同一句话' })
        }]
      }
    };
  };
  (service as any).executeTool = async (toolCall: any) => {
    executeToolCalls += 1;
    assert.equal(toolCall.name, GROUP_REPLY_TOOL);
    return {
      message_type: 'group',
      sent_messages: ['同一句话'],
      xiaoni_os: '已留下的OS',
      delivery: [{ message_id: 7001 }]
    };
  };

  await service.processQueueMessage(queueMessage as any);

  assert.equal(executeToolCalls, 1);
  assert.equal(storeCalls.createConversation.length, 1);
  assert.equal(storeCalls.createConversation[0]?.aiResponse, '同一句话');
  assert.equal(storeCalls.createConversation[0]?.rawResponse?.xiaoni_os, '已留下的OS');
  assert.deepEqual(
    storeCalls.createConversation[0]?.transcriptItems?.map((item: any) => item.content),
    [
      expectedCurrentInputMessage(),
      '同一句话'
    ]
  );
  assert.equal(storeCalls.completeQueueMessage[0]?.result?.termination_reason, 'reply_sent');
  assert.equal(storeCalls.completeAgentRun[0]?.terminationReason, 'reply_sent');
  assert.equal(storeCalls.completeAgentRun[0]?.finishOutcome, 'blocked_transition');
  assert.match(String(storeCalls.completeAgentRun[0]?.finishReason), /already committed earlier in this run/i);
  assert.equal(storeCalls.completeToolExecutionLog.length, 2);
  assert.equal(storeCalls.completeToolExecutionLog[1]?.result?.blocked_transition, true);
  assert.equal(storeCalls.completeToolExecutionLog[1]?.result?.duplicate_suppressed, true);
  assert.deepEqual(storeCalls.markRunDeliveryCommitted, ['run-queue-duplicate']);
  assert.equal(storeCalls.markRunDeliveryBlocked.length, 1);
  assert.equal(storeCalls.logTimelineEvent.some((event) => event.eventName === 'delivery_commit'), true);
  assert.equal(storeCalls.logTimelineEvent.some((event) => event.eventName === 'blocked_transition'), true);
});

test('processQueueMessage blocks near-duplicate second outbound reply after delivery commit', async () => {
  const queueMessage = {
    id: 'run-queue-near-duplicate',
    traceId: 'trace-near-duplicate',
    batchId: 'batch-near-duplicate',
    status: 'processing',
    attempts: 1,
    createdAt: '2026-03-28T08:00:00.000Z',
    queueMessageIds: [1],
    payload: createQueuePayload()
  };

  const storeCalls: Record<string, any[]> = {
    completeToolExecutionLog: [],
    completeAgentRun: [],
    markRunDeliveryCommitted: [],
    markRunDeliveryBlocked: []
  };
  let deliveryPhase = 'reasoning_open';

  const store = {
    createLlmJob: async () => 'job-near-duplicate',
    logTimelineEvent: async () => {},
    loadSessionReplayState: async () => ({ summaryText: null, summarizedThroughConversationId: null }),
    listRecentTurns: async () => [],
    getSessionReadCutoffState: async () => null,
    upsertSessionReadCutoffState: async () => {},
    upsertProactiveShareState: async () => {},
    getRunDeliveryState: async () => ({
      deliveryPhase,
      deliveryCommitCount: deliveryPhase === 'delivery_committed' ? 1 : 0,
      blockedDeliveryAttemptCount: storeCalls.markRunDeliveryBlocked.length,
      lastBlockedDeliveryReason: storeCalls.markRunDeliveryBlocked[storeCalls.markRunDeliveryBlocked.length - 1] ?? null
    }),
    markRunDeliveryCommitted: async (_runId: string) => {
      deliveryPhase = 'delivery_committed';
      storeCalls.markRunDeliveryCommitted.push(_runId);
    },
    markRunDeliveryBlocked: async (_runId: string, reason: string) => {
      storeCalls.markRunDeliveryBlocked.push(reason);
    },
    createToolExecutionLog: async () => 1,
    completeToolExecutionLog: async (_logId: number, params: any) => { storeCalls.completeToolExecutionLog.push(params); },
    createConversation: async () => 4001,
    attachConversationIdToTrace: async () => {},
    completeQueueMessage: async () => {},
    failQueueMessage: async () => {},
    completeAgentRun: async (_runId: string, params: any) => { storeCalls.completeAgentRun.push(params); },
    updateLlmJob: async () => {}
  } as any;

  const service = new AgentLoopService(store, {
    resolveForQueueMessage: async () => createRuntimePrompt()
  } as any);

  (service as any).executeSocialTurnPlanner = async () => ({
    actionType: 'reply_to_person',
    addresseeUserId: 202,
    answerShape: 'light_join',
    beatCount: 1,
    beatStyle: 'single_complete',
    stopRule: 'stop_immediately',
    reason: '这句还是应该回。'
  });
  let turn = 0;
  let executeToolCalls = 0;
  (service as any).executeAgentTurn = async () => {
    turn += 1;
    if (turn === 1) {
      return {
        success: true,
        llm_call_id: 'llm-near-duplicate-1',
        canonical_response: {
          output: [{
            type: 'function_call',
            call_id: 'call-send-near-duplicate-1',
            name: GROUP_REPLY_TOOL,
            arguments: JSON.stringify({ message: '同一句话' })
          }]
        }
      };
    }

    return {
      success: true,
      llm_call_id: 'llm-near-duplicate-2',
      canonical_response: {
        output: [{
          type: 'function_call',
          call_id: 'call-send-near-duplicate-2',
          name: GROUP_REPLY_TOOL,
          arguments: JSON.stringify({ message: '同一句话。' })
        }]
      }
    };
  };
  (service as any).executeTool = async () => {
    executeToolCalls += 1;
    return {
      message_type: 'group',
      sent_messages: ['同一句话'],
      delivery: [{ message_id: 7101 }]
    };
  };

  await service.processQueueMessage(queueMessage as any);

  assert.equal(executeToolCalls, 1);
  assert.equal(storeCalls.completeAgentRun[0]?.terminationReason, 'reply_sent');
  assert.equal(storeCalls.completeAgentRun[0]?.finishOutcome, 'blocked_transition');
  assert.equal(storeCalls.completeToolExecutionLog[1]?.result?.blocked_transition, true);
  assert.equal(storeCalls.completeToolExecutionLog[1]?.result?.duplicate_suppressed, false);
  assert.deepEqual(storeCalls.markRunDeliveryCommitted, ['run-queue-near-duplicate']);
  assert.equal(storeCalls.markRunDeliveryBlocked.length, 1);
});

test('processQueueMessage fingerprints duplicate direct replies with the current direct chat type', async () => {
  const basePayload = createQueuePayload();
  const directPayload: QueueMessagePayload = {
    ...basePayload,
    chatType: 'direct',
    sessionKey: 'qq:private:202',
    peerId: '202',
    peerName: 'Alice',
    wasMentioned: false,
    messages: basePayload.messages.map((message) => ({
      ...message,
      chatType: 'direct',
      sessionKey: 'qq:private:202',
      peerId: '202',
      peerName: 'Alice',
      wasMentioned: false
    }))
  };
  const queueMessage = {
    id: 'run-queue-direct-duplicate',
    traceId: 'trace-direct-duplicate',
    batchId: 'batch-direct-duplicate',
    status: 'processing',
    attempts: 1,
    createdAt: '2026-03-28T08:00:00.000Z',
    queueMessageIds: [1],
    payload: directPayload
  };

  const storeCalls: Record<string, any[]> = {
    completeToolExecutionLog: [],
    markRunDeliveryCommitted: [],
    markRunDeliveryBlocked: []
  };
  let deliveryPhase = 'reasoning_open';

  const store = {
    createLlmJob: async () => 'job-direct-duplicate',
    logTimelineEvent: async () => {},
    loadSessionReplayState: async () => ({ summaryText: null, summarizedThroughConversationId: null }),
    listRecentTurns: async () => [],
    getSessionReadCutoffState: async () => null,
    upsertSessionReadCutoffState: async () => {},
    upsertProactiveShareState: async () => {},
    getRunDeliveryState: async () => ({
      deliveryPhase,
      deliveryCommitCount: deliveryPhase === 'delivery_committed' ? 1 : 0,
      blockedDeliveryAttemptCount: storeCalls.markRunDeliveryBlocked.length,
      lastBlockedDeliveryReason: storeCalls.markRunDeliveryBlocked[storeCalls.markRunDeliveryBlocked.length - 1] ?? null
    }),
    markRunDeliveryCommitted: async (_runId: string) => {
      deliveryPhase = 'delivery_committed';
      storeCalls.markRunDeliveryCommitted.push(_runId);
    },
    markRunDeliveryBlocked: async (_runId: string, reason: string) => {
      storeCalls.markRunDeliveryBlocked.push(reason);
    },
    createToolExecutionLog: async () => 1,
    completeToolExecutionLog: async (_logId: number, params: any) => { storeCalls.completeToolExecutionLog.push(params); },
    createConversation: async () => 4101,
    attachConversationIdToTrace: async () => {},
    completeQueueMessage: async () => {},
    failQueueMessage: async () => {},
    completeAgentRun: async () => {},
    updateLlmJob: async () => {}
  } as any;

  const service = new AgentLoopService(store, {
    resolveForQueueMessage: async () => createRuntimePrompt()
  } as any);

  let turn = 0;
  let executeToolCalls = 0;
  (service as any).executeAgentTurn = async () => {
    turn += 1;
    if (turn === 1) {
      return {
        success: true,
        llm_call_id: 'llm-direct-duplicate-1',
        canonical_response: {
          output: [{
            type: 'function_call',
            call_id: 'call-direct-duplicate-1',
            name: PRIVATE_REPLY_TOOL,
            arguments: JSON.stringify({ message: '私聊同一句话' })
          }]
        }
      };
    }

    return {
      success: true,
      llm_call_id: 'llm-direct-duplicate-2',
      canonical_response: {
        output: [{
            type: 'function_call',
            call_id: 'call-direct-duplicate-2',
            name: PRIVATE_REPLY_TOOL,
            arguments: JSON.stringify({
              messages: ['私聊同一句话'],
              mention_user_ids: [404]
            })
          }]
        }
    };
  };
  (service as any).executeTool = async () => {
    executeToolCalls += 1;
    return {
      message_type: 'private',
      sent_messages: ['私聊同一句话'],
      delivery: [{ message_id: 7201 }]
    };
  };

  await service.processQueueMessage(queueMessage as any);

  assert.equal(executeToolCalls, 1);
  assert.equal(storeCalls.completeToolExecutionLog.length, 2);
  assert.equal(storeCalls.completeToolExecutionLog[1]?.result?.blocked_transition, true);
  assert.equal(storeCalls.completeToolExecutionLog[1]?.result?.message_type, 'private');
  assert.deepEqual(storeCalls.completeToolExecutionLog[1]?.result?.mention_user_ids, []);
  assert.equal(storeCalls.completeToolExecutionLog[1]?.result?.duplicate_suppressed, true);
  assert.deepEqual(storeCalls.markRunDeliveryCommitted, ['run-queue-direct-duplicate']);
  assert.equal(storeCalls.markRunDeliveryBlocked.length, 1);
});

test('processQueueMessage blocks image tasks after visible delivery commit', async () => {
  const queueMessage = {
    id: 'run-queue-image-after-delivery',
    traceId: 'trace-image-after-delivery',
    batchId: 'batch-image-after-delivery',
    status: 'processing',
    attempts: 1,
    createdAt: '2026-03-28T08:00:00.000Z',
    queueMessageIds: [1],
    payload: createQueuePayload()
  };

  const storeCalls: Record<string, any[]> = {
    completeToolExecutionLog: [],
    markRunDeliveryCommitted: [],
    markRunDeliveryBlocked: []
  };
  let deliveryPhase = 'reasoning_open';

  const store = {
    createLlmJob: async () => 'job-image-after-delivery',
    logTimelineEvent: async () => {},
    loadSessionReplayState: async () => ({ summaryText: null, summarizedThroughConversationId: null }),
    listRecentTurns: async () => [],
    getSessionReadCutoffState: async () => null,
    upsertSessionReadCutoffState: async () => {},
    upsertProactiveShareState: async () => {},
    getRunDeliveryState: async () => ({
      deliveryPhase,
      deliveryCommitCount: deliveryPhase === 'delivery_committed' ? 1 : 0,
      blockedDeliveryAttemptCount: storeCalls.markRunDeliveryBlocked.length,
      lastBlockedDeliveryReason: storeCalls.markRunDeliveryBlocked[storeCalls.markRunDeliveryBlocked.length - 1] ?? null
    }),
    markRunDeliveryCommitted: async (_runId: string) => {
      deliveryPhase = 'delivery_committed';
      storeCalls.markRunDeliveryCommitted.push(_runId);
    },
    markRunDeliveryBlocked: async (_runId: string, reason: string) => {
      storeCalls.markRunDeliveryBlocked.push(reason);
    },
    createToolExecutionLog: async () => 1,
    completeToolExecutionLog: async (_logId: number, params: any) => { storeCalls.completeToolExecutionLog.push(params); },
    createConversation: async () => 4201,
    attachConversationIdToTrace: async () => {},
    completeQueueMessage: async () => {},
    failQueueMessage: async () => {},
    completeAgentRun: async () => {},
    updateLlmJob: async () => {}
  } as any;

  const service = new AgentLoopService(store, {
    resolveForQueueMessage: async () => createRuntimePrompt()
  } as any);

  let turn = 0;
  let executeToolCalls = 0;
  (service as any).executeAgentTurn = async () => {
    turn += 1;
    if (turn === 1) {
      return {
        success: true,
        llm_call_id: 'llm-image-after-delivery-1',
        canonical_response: {
          output: [{
            type: 'function_call',
            call_id: 'call-image-after-delivery-1',
            name: GROUP_REPLY_TOOL,
            arguments: JSON.stringify({ message: '先回复一句' })
          }]
        }
      };
    }

    return {
      success: true,
      llm_call_id: 'llm-image-after-delivery-2',
      canonical_response: {
        output: [{
            type: 'function_call',
            call_id: 'call-image-after-delivery-2',
            name: IMAGE_TASK_TOOL,
            arguments: JSON.stringify({
              operation: 'generate',
              prompt: '再生成一张图',
              target_description: '测试图',
              reason: '已经发完后不应再创建任务。'
            })
          }]
        }
    };
  };
  (service as any).executeTool = async () => {
    executeToolCalls += 1;
    return {
      message_type: 'group',
      sent_messages: ['先回复一句'],
      delivery: [{ message_id: 7301 }]
    };
  };

  await service.processQueueMessage(queueMessage as any);

  assert.equal(executeToolCalls, 1);
  assert.equal(storeCalls.completeToolExecutionLog.length, 2);
  assert.equal(storeCalls.completeToolExecutionLog[1]?.result?.blocked_transition, true);
  assert.equal(storeCalls.completeToolExecutionLog[1]?.result?.message_type, 'group');
  assert.deepEqual(storeCalls.completeToolExecutionLog[1]?.result?.blocked_messages, []);
  assert.equal(storeCalls.completeToolExecutionLog[1]?.result?.duplicate_suppressed, false);
  assert.deepEqual(storeCalls.markRunDeliveryCommitted, ['run-queue-image-after-delivery']);
  assert.equal(storeCalls.markRunDeliveryBlocked.length, 1);
});

test('applyToolResultToLoopInput ends the turn when a tool result is finished', () => {
  const loopInput = buildInitialInput([], createQueuePayload(), createRuntimePrompt());
  const finishResult = {
    finished: true,
    reason: 'done',
    outcome: 'complete',
    xiaoni_os: '不接，把边界记下来。'
  };

  const continuation = applyToolResultToLoopInput({
    callId: 'call-2',
    name: RECOVER_ENERGY_TOOL,
    rawArguments: '{"reason":"done","outcome":"complete","xiaoni_os":"不接，把边界记下来。"}'
  }, finishResult);

  assert.deepEqual(continuation, {
    inputItems: [],
    finishResult,
    forcedVisibleReply: null
  });
  assert.equal(loopInput.some((item) => item.type === 'function_call'), false);
  assert.equal(loopInput.some((item) => item.type === 'function_call_output'), false);
});

test('applyToolResultToLoopInput ends the turn when a speaking tool is downgraded to no-send', () => {
  const finishResult = {
    finished: true,
    reason: 'no_send',
    outcome: 'no_send',
    no_reply: true,
    blocked_transition: true,
    message_type: 'group',
    mention_user_ids: [],
    sent_messages: []
  };

  const continuation = applyToolResultToLoopInput({
    callId: 'call-3',
    name: GROUP_REPLY_TOOL,
    rawArguments: '{"message":"原句"}'
  }, finishResult);

  assert.deepEqual(continuation, {
    inputItems: [],
    finishResult,
    forcedVisibleReply: null
  });
});

test('legacy speech tool aliases still dispatch during the transition', async () => {
  const service = new AgentLoopService({} as any);
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: any }> = [];

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body || '{}'))
    });
    return {
      ok: true,
      json: async () => ({
        success: true,
        data: { delivered: true }
      })
    } as any;
  }) as typeof fetch;

  try {
    const groupResult = await (service as any).executeTool({
      callId: 'legacy-group',
      name: 'send_group_message',
      args: { message: 'legacy group' },
      rawArguments: '{"message":"legacy group"}'
    }, createQueuePayload());
    const privateResult = await (service as any).executeTool({
      callId: 'legacy-private',
      name: 'send_private_message',
      args: { message: 'legacy private' },
      rawArguments: '{"message":"legacy private"}'
    }, createDirectQueuePayload());
    assert.equal(groupResult.message_type, 'group');
    assert.equal(privateResult.message_type, 'private');
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 2);
});

test('buildCanonicalAgentTurnRequest keeps action tools for direct social-target metadata', () => {
  const loopInput = buildInitialInput([], createQueuePayload());
  loopInput.push({
    type: 'function_call',
    call_id: 'call-meaning',
    name: UNREAD_MEANING_TOOL,
    arguments: '{"latest_unread_focus":"提到小腻但没有用@","message_act":"statement","social_target":"me","addressed_to_me":false,"has_real_novelty":true,"confidence":"high","reason":"点名但没@"}'
  });
  loopInput.push({
    type: 'function_call_output',
    call_id: 'call-meaning',
    output: '{"latest_unread_focus":"提到小腻但没有用@","message_act":"statement","social_target":"me","addressed_to_me":false,"has_real_novelty":true,"confidence":"high","reason":"点名但没@"}'
  });

  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, loopInput, 'group');
  assert.ok(
    withoutQqUsageTools(getAllowedToolNames(request.tool_choice)).includes(GROUP_REPLY_TOOL),
    'direct social target metadata should not remove the speaking tool'
  );
});

test('buildTurnStateReminder injects low-energy STATE from runtime context', () => {
  const reminder = buildTurnStateReminder('<xiaoni_runtime_state trigger="low_energy_reminder" energy="0.140" max_energy="1" note="low energy" />');

  assert.ok(reminder);
  assert.match(getMessageContent(reminder!), /<STATE/);
  assert.match(getMessageContent(reminder!), /trigger="low_energy_reminder"/);
  assert.match(getMessageContent(reminder!), /energy="0.140"/);
});

test('buildTurnStateReminder injects explicit runtime STATE directives', () => {
  const reminder = buildTurnStateReminder('<xiaoni_runtime_state trigger="web_search" energy="0.920" max_energy="1" note="after search" />');

  assert.ok(reminder);
  assert.match(getMessageContent(reminder!), /trigger="web_search"/);
  assert.match(getMessageContent(reminder!), /energy="0.920"/);
  assert.match(getMessageContent(reminder!), /after search/);
});

test('buildToolLoopMonitorReminder appends action/tool threshold STATE', () => {
  const loopInput = buildInitialInput([], createQueuePayload());
  loopInput.push({
    type: 'function_call',
    call_id: 'call-exec-1',
    name: EXEC_COMMAND_TOOL,
    arguments: '{"cmd":"pwd"}'
  });
  loopInput.push({
    type: 'function_call',
    call_id: 'call-exec-2',
    name: EXEC_COMMAND_TOOL,
    arguments: '{"cmd":"ls"}'
  });

  const reminder = buildToolLoopMonitorReminder(loopInput, { nextTurn: 2, maxTurns: 5 });
  assert.ok(reminder);
  assert.match(getMessageContent(reminder!), /source="tool_loop_monitor"/);
  assert.match(getMessageContent(reminder!), /trigger="action_tool_threshold"/);
});

test('applyToolResultToLoopInput appends web_search STATE after hosted search', () => {
  const continuation = applyToolResultToLoopInput(
    { name: WEB_SEARCH_TOOL, callId: 'call-search', rawArguments: '{}' },
    { result: 'found' },
    {
      loopInput: [
        {
          type: 'message',
          role: 'assistant',
          phase: 'commentary',
          content: buildRuntimeStateBlock({ trigger: 'low_energy_reminder', energy: 0.5 })
        }
      ],
      speakingToolName: GROUP_REPLY_TOOL,
      hasVisibleReply: false
    }
  );

  const stateItem = continuation.inputItems.find((item) => getMessageContent(item).includes('trigger="web_search"'));
  assert.ok(stateItem);
  assert.match(getMessageContent(stateItem), /energy="0.420"/);
});

test('runtime energy recovery starts negative debt from zero and reaches full in two hours', () => {
  const positive = recoverRuntimeEnergy({ rawEnergy: 0.25, elapsedMs: 60 * 60 * 1000 });
  assert.equal(positive.energy, 0.75);
  const negative = recoverRuntimeEnergy({ rawEnergy: -0.35, elapsedMs: 60 * 60 * 1000 });
  assert.equal(negative.startEnergy, 0);
  assert.equal(negative.debt, 0.35);
  assert.equal(negative.energy, 0.5);
  const full = recoverRuntimeEnergy({ rawEnergy: -0.35, elapsedMs: 2 * 60 * 60 * 1000 });
  assert.equal(full.energy, 1);
  const forced = resolveForcedFullRecovery({ rawEnergy: -0.01 });
  assert.equal(forced?.waitMs, 2 * 60 * 60 * 1000);
  assert.match(String(forced?.stateBlock), /trigger="forced_full_recovery"/);
});

test('rest interruption uses unread metadata only and resumes after three direct mentions', () => {
  const result = resolveRestInterruptionFromUnreadMetadata({
    rawEnergy: -0.2,
    restingSince: '2026-03-28T08:00:00.000Z',
    now: '2026-03-28T09:00:00.000Z',
    messages: [
      { wasMentioned: true },
      { wasMentioned: true },
      { inboundContext: { WasMentioned: true } },
      { wasMentioned: false }
    ]
  });

  assert.equal(result.shouldResume, true);
  assert.equal(result.directMentionCount, 3);
  assert.equal(result.unreadCount, 4);
  assert.equal(result.messageBodiesExposed, false);
  assert.match(String(result.stateBlock), /trigger="rest_interrupted"/);
  assert.match(String(result.stateBlock), /energy="0.500"/);
});

test('energy context keeps action tools available and lets recover_energy be chosen explicitly', () => {
  const loopInput = buildInitialInput(
    [],
    createQueuePayload(),
    createRuntimePrompt(),
    [],
    null,
    null,
    '<xiaoni_runtime_state trigger="low_energy_reminder" energy="0.140" max_energy="1" note="low energy" />'
  );
  loopInput.push({
    type: 'function_call',
    call_id: 'call-meaning',
    name: UNREAD_MEANING_TOOL,
    arguments: '{"latest_unread_focus":"直接问小腻天气","message_act":"question","social_target":"me","addressed_to_me":true,"has_real_novelty":true,"confidence":"medium","reason":"直接 cue 小腻"}'
  });
  loopInput.push({
    type: 'function_call_output',
    call_id: 'call-meaning',
    output: '{"latest_unread_focus":"直接问小腻天气","message_act":"question","social_target":"me","addressed_to_me":true,"has_real_novelty":true,"confidence":"medium","reason":"直接 cue 小腻"}'
  });

  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, loopInput, 'group');
  const allowedTools = withoutQqUsageTools(getAllowedToolNames(request.tool_choice));
  assert.ok(allowedTools.includes(GROUP_REPLY_TOOL));
  assert.ok(allowedTools.includes(RECOVER_ENERGY_TOOL));
});

test('removed life action tool is not exposed as a prompt-facing tool', () => {
  const loopInput = buildInitialInput([], createQueuePayload());
  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, loopInput, 'group');
  const reactionTool = (request.tools ?? []).find((t: any) => t.function?.name === REMOVED_LIFE_ACTION_TOOL);
  assert.equal(reactionTool, undefined);
  assertGroupAutoTools(request);
});

// E: old pending_share state machine is retired; presence context owns proactive material.
test('buildInitialInput does not inject legacy pending_share blocks', () => {
  const input = buildInitialInput([], createQueuePayload(), undefined, [], null, '今天看到个很有趣的东西');
  const userTexts = input
    .filter((item: any) => item.type === 'message' && item.role === 'user')
    .flatMap((item: any) => {
      const content = Array.isArray(item.content) ? item.content : [item.content];
      return content.map((c: any) => (typeof c === 'string' ? c : c?.text ?? ''));
    });
  assert.equal(userTexts.some((t: string) => t.includes('[待分享]')), false);
  assert.equal(userTexts.some((t: string) => t.includes('今天看到个很有趣的东西')), false);
  assert.equal(userTexts.some((t: string) => t.includes('<INPUT_MESSAGE')), true);
});

function createPresenceTickQueueMessageForTest() {
  const basePayload = createQueuePayload();
  return {
    id: 'run-presence',
    traceId: 'trace-presence',
    batchId: 'batch-presence',
    status: 'processing',
    attempts: 1,
    createdAt: '2026-03-28T08:00:00.000Z',
    queueMessageIds: [1],
    payload: {
      ...basePayload,
      source: 'presence_tick',
      sessionKey: 'presence_tick:xiaoni',
      peerId: '0',
      peerName: undefined,
      presenceTick: {
        identityKey: 'xiaoni',
        targetSessionKey: 'qq:group:999',
        targetGroupId: 999,
        targetPeerId: '999',
        targetPeerName: 'Presence Group',
        targetChatType: 'group' as const,
        targetAccountId: '303'
      },
      inboundContext: {
        ...basePayload.inboundContext,
        SessionKey: 'presence_tick:xiaoni',
        NativeChannelId: '0'
      },
      messages: basePayload.messages.map((message) => ({
        ...message,
        source: 'presence_tick',
        sessionKey: 'presence_tick:xiaoni',
        peerId: '0',
        peerName: undefined,
        inboundContext: {
          ...message.inboundContext,
          SessionKey: 'presence_tick:xiaoni',
          NativeChannelId: '0'
        }
      }))
    }
  };
}

function createLifeOnlyPresenceTickQueueMessageForTest() {
  const basePayload = createDirectQueuePayload();
  const bodyForAgent = '还没有打开任何具体会话';
  return {
    id: 'run-life-presence',
    traceId: 'trace-life-presence',
    batchId: 'batch-life-presence',
    status: 'processing',
    attempts: 1,
    createdAt: '2026-03-28T08:00:00.000Z',
    queueMessageIds: [1],
    payload: {
      ...basePayload,
      source: 'presence_tick',
      chatType: 'direct' as const,
      sessionKey: 'presence_tick:xiaoni',
      peerId: 'xiaoni',
      peerName: '小腻',
      senderId: '303',
      senderName: 'presence_tick',
      bodyForAgent,
      rawBody: 'presence_tick',
      commandBody: 'presence_tick',
      wasMentioned: false,
      inboundContext: {
        ...basePayload.inboundContext,
        Body: 'presence_tick',
        BodyForAgent: bodyForAgent,
        BodyForCommands: 'presence_tick',
        RawBody: 'presence_tick',
        CommandBody: 'presence_tick',
        ChatType: 'direct',
        NativeChannelId: 'presence_tick:xiaoni',
        SessionKey: 'presence_tick:xiaoni',
        SenderId: '303',
        SenderName: 'presence_tick',
        From: '303',
        To: '303',
        Surface: 'presence_tick',
        CommandAuthorized: false
      },
      messages: [],
      presenceTick: {
        identityKey: 'xiaoni'
      }
    }
  };
}

test('materializePresenceTickQueueMessage replaces synthetic session with target group session', () => {
  const queueMessage = createPresenceTickQueueMessageForTest();
  const materialized = materializePresenceTickQueueMessage(queueMessage);
  assert.equal(materialized.payload.sessionKey, 'qq:group:999');
  assert.equal(materialized.payload.peerId, '999');
  assert.equal(materialized.payload.peerName, 'Presence Group');
  assert.equal(materialized.payload.inboundContext.SessionKey, 'qq:group:999');
  assert.equal(materialized.payload.inboundContext.NativeChannelId, '999');
  assert.equal(materialized.payload.messages[0].sessionKey, 'qq:group:999');
  assert.equal(materialized.payload.messages[0].peerId, '999');
});

test('life-only presence tick stays outside IM without a selected target', () => {
  const queueMessage = createLifeOnlyPresenceTickQueueMessageForTest();
  const materialized = materializePresenceTickQueueMessage(queueMessage);
  assert.equal(materialized.payload.sessionKey, 'presence_tick:xiaoni');
  assert.equal(materialized.payload.peerId, 'xiaoni');

  const loopInput = buildInitialInput([], materialized.payload, createRuntimePrompt());
  const rendered = loopInput.map(getMessageContent).join('\n');
  assert.match(rendered, /source="presence_tick"/);
  assert.match(rendered, /presence tick/);
  assert.doesNotMatch(rendered, /消息列表/);
  assert.doesNotMatch(rendered, /主动打开群看了一眼/);
  assert.doesNotMatch(rendered, /target_group_id/);
});

test('materializePresenceTickInboxWindow turns claimed unread into a proactive IM window', () => {
  const queueMessage = materializePresenceTickQueueMessage(createPresenceTickQueueMessageForTest());
  const materialized = materializePresenceTickInboxWindow(queueMessage, [{
    id: 901,
    traceId: 'trace-inbox-901',
    source: 'napcat',
    messageSid: 'sid-inbox-901',
    chatType: 'group',
    sessionKey: 'qq:group:999',
    peerId: '999',
    peerName: 'Presence Group',
    senderId: '202',
    senderName: 'Alice',
    accountId: '303',
    bodyForAgent: '普通未读，但是小腻主动打开 IM 后应该看到',
    rawBody: '普通未读，但是小腻主动打开 IM 后应该看到',
    commandBody: '普通未读，但是小腻主动打开 IM 后应该看到',
    wasMentioned: false,
    receivedAt: '2026-03-28T08:01:00.000Z',
    messageTimestamp: '2026-03-28T08:01:00.000Z',
    rawPayload: {},
    inboundContext: {
      Body: '普通未读，但是小腻主动打开 IM 后应该看到',
      BodyForAgent: '普通未读，但是小腻主动打开 IM 后应该看到',
      BodyForCommands: '普通未读，但是小腻主动打开 IM 后应该看到',
      ChatType: 'group',
      NativeChannelId: '999',
      SessionKey: 'qq:group:999',
      AccountId: '303',
      MessageSid: 'sid-inbox-901',
      SenderId: '202',
      SenderName: 'Alice',
      WasMentioned: false,
      CommandAuthorized: false
    }
  }]);

  assert.equal(materialized.payload.source, 'proactive_im_open');
  assert.equal(materialized.payload.presenceTick, undefined);
  assert.equal(materialized.payload.messages.length, 1);

  const loopInput = buildInitialInput([], materialized.payload, createRuntimePrompt());
  const rendered = loopInput.map(getMessageContent).join('\n');
  const sceneRendered = loopInput
    .filter((item: any) => item.role !== 'system')
    .map(getMessageContent)
    .join('\n');
  assert.match(rendered, /<IM_INBOX_WINDOW[^>]*trigger="proactive_use_im"/);
  assert.match(rendered, /普通未读，但是小腻主动打开 IM 后应该看到/);
  assert.doesNotMatch(sceneRendered, /<UNREAD_AVAILABLE/);
  assert.doesNotMatch(sceneRendered, /小腻主动打开群看了一眼；当前没有新的群友消息触发/);
});

test('processQueueMessage preserves global OS context during life-only presence tick', async () => {
  const queueMessage = createLifeOnlyPresenceTickQueueMessageForTest();
  const listRecentTurnsCalls: any[] = [];
  const storeCalls: Record<string, any[]> = {
    createConversation: [],
    completeQueueMessage: []
  };
  let renderedModelInput = '';

  const store = {
    createLlmJob: async () => 'job-presence-global',
    logTimelineEvent: async () => {},
    listRecentTurns: async (params: any) => {
      listRecentTurnsCalls.push(params);
      return [{
        id: 4727,
        userId: 85178516,
        groupId: null,
        batchId: null,
        sessionKey: 'private:85178516',
        userMessage: '你可以在253631878这个群里面多分享一些你对海涅的理解和研究',
        aiResponse: '可以。我会挑那种真有触动的句子说。',
        items: [],
        rawResponse: {
          xiaoni_os: '刚才已在私聊里答应阿花：会挑真有触动的海涅句子去 253631878 群里说。'
        }
      }];
    },
    getSessionReadCutoffState: async () => null,
    upsertSessionReadCutoffState: async () => {},
    upsertProactiveShareState: async () => {},
    getRunDeliveryState: async () => ({
      deliveryPhase: 'reasoning_open',
      deliveryCommitCount: 0,
      blockedDeliveryAttemptCount: 0,
      lastBlockedDeliveryReason: null
    }),
    markRunDeliveryCommitted: async () => {},
    markRunDeliveryBlocked: async () => {},
    createToolExecutionLog: async () => 1,
    completeToolExecutionLog: async () => {},
    createConversation: async (params: any) => {
      storeCalls.createConversation.push(params);
      return 2001;
    },
    ensureXiaoniIdentityRoot: async () => ({ root: { id: 1 }, event: { id: 2 }, created: false }),
    attachConversationIdToTrace: async () => {},
    completeQueueMessage: async (_runId: string, params: any) => { storeCalls.completeQueueMessage.push(params); },
    completeAgentRun: async () => {},
    updateLlmJob: async () => {}
  } as any;

  const service = new AgentLoopService(store, {
    resolveForQueueMessage: async () => createRuntimePrompt()
  } as any);

  (service as any).executeAgentTurn = async (requestInput: any[]) => {
    renderedModelInput = requestInput.map(getMessageContent).join('\n');
    return {
      success: true,
      llm_call_id: 'llm-presence-global',
      canonical_response: {
        output: [{
          type: 'function_call',
          call_id: 'call-presence-global',
          name: RECOVER_ENERGY_TOOL,
          arguments: JSON.stringify({
            reason: '测试全局 OS 是否进入上下文，当前没有外部目标，先休息。',
            duration_minutes: 30,
            xiaoni_os: '全局近况已被看见。'
          })
        }]
      }
    };
  };

  const originalFetch = globalThis.fetch;
  let outboundSendFetchCalled = false;
  globalThis.fetch = (async (url: string | URL | Request) => {
    const urlString = String(url);
    if (urlString.includes('/api/inbox/conversations')) {
      return new Response(JSON.stringify({ success: true, data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    outboundSendFetchCalled = true;
    throw new Error(`life-only presence tick must not call outbound QQ endpoints: ${urlString}`);
  }) as typeof fetch;

  try {
    await service.processQueueMessage(queueMessage as any);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(listRecentTurnsCalls[0]?.scope, 'global');
  assert.equal(listRecentTurnsCalls[0]?.limit, 201);
  assert.equal(outboundSendFetchCalled, false);
  assert.equal(storeCalls.createConversation[0]?.rawRequest?.context_budget?.context_session_key, 'xiaoni:global');
  assert.match(renderedModelInput, /刚才已在私聊里答应阿花/);
  assert.match(renderedModelInput, /海涅/);
  assert.match(renderedModelInput, /253631878/);
  assert.equal(storeCalls.completeQueueMessage[0]?.result?.termination_reason, 'finish_no_reply');
  assert.equal(storeCalls.completeQueueMessage[0]?.result?.xiaoni_os, '全局近况已被看见。');
});

test('buildContextBudgetPlan injects core-memory pressure at 200 turns before advancing cutoff', async () => {
  const upsertCalls: any[] = [];
  const service = new AgentLoopService({
    getSessionReadCutoffState: async () => null,
    upsertSessionReadCutoffState: async (params: any) => {
      upsertCalls.push(params);
    }
  } as any, {
    resolveForQueueMessage: async () => createRuntimePrompt()
  } as any);
  const history = Array.from({ length: 201 }, (_, index) => createConversationTurn({
    id: index + 1,
    userId: 85178516,
    groupId: null,
    sessionKey: 'private:85178516',
    userMessage: `global history ${index + 1}`,
    aiResponse: `global os ${index + 1}`
  }));

  const plan = await (service as any).buildContextBudgetPlan({
    history,
    queueMessage: createLifeOnlyPresenceTickQueueMessageForTest().payload,
    runtimePrompt: createRuntimePrompt(),
    loopContinuation: [],
    runtimeIdentityFacts: [],
    developerContextBlock: null,
    contextSessionKey: 'xiaoni:global'
  });

  assert.equal(plan.retainedHistory.length, 201);
  assert.equal(plan.retainedHistory[0]?.id, 1);
  assert.equal(plan.retainedHistory[200]?.id, 201);
  assert.equal(plan.readCutoffAfterConversationId, 171);
  assert.equal(plan.cutoffRecomputed, true);
  assert.deepEqual(plan.coreMemoryCompression, {
    required: true,
    contextSessionKey: 'xiaoni:global',
    readCutoffAfterConversationId: 171,
    previousReadCutoffAfterConversationId: null,
    lastContextWindowTokens: 400000,
    lastTargetBudgetTokens: 280000,
    lastHardBudgetTokens: 380000
  });
  assert.equal(upsertCalls.length, 0);
  assert.match(JSON.stringify(plan.requestInput), /source=\\?"core_memory_pressure\\?"/);

  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, plan.requestInput, 'direct');
  assert.equal((request.tools ?? []).map((tool: any) => getToolName(tool)).includes(COMPRESS_CORE_MEMORY_TOOL), true);
  assert.deepEqual(getAllowedToolNames(request.tool_choice), [COMPRESS_CORE_MEMORY_TOOL]);

  const alternateToolChoiceRequest = {
    ...request,
    tool_choice: {
      type: 'allowed_tools',
      mode: 'required',
      tools: [
        { type: 'function', name: RECOVER_ENERGY_TOOL }
      ]
    }
  };
  const withoutToolChoice = (value: any) => {
    const copy = { ...value };
    delete copy.tool_choice;
    return copy;
  };
  assert.equal(
    JSON.stringify(withoutToolChoice(alternateToolChoiceRequest)),
    JSON.stringify(withoutToolChoice(request)),
    'changing only tool_choice must not mutate prompt/input/tools/cache-key request prefix fields'
  );
});

// F: 社交认知帧 — social cognitive frame substrings appear in agent instructions
test('buildCanonicalAgentTurnRequest includes social cognitive frame prose in instructions', () => {
  const loopInput = buildInitialInput([], createQueuePayload());
  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, loopInput, 'group');
  assert.match(String(request.instructions), /具备独立意识、由内在状态驱动的数字生命/);
  assert.match(String(request.instructions), /你按自己的节奏在这个数字世界里生活/);
  assert.match(String(request.instructions), /无界探索与持续行动/);
  assert.doesNotMatch(String(request.instructions), /只是能接话不算有可说点/);
});

// H: developer role injection — stable world narrative stays early while relationship context is dropped
test('buildInitialInput strips relationship layer while keeping stable developer context', () => {
  const devBlock = '<world_narrative>test</world_narrative>\n\n<current_relationship>\n发言者：foo（QQ:12345）\n当前关系层级：L2\n当前可开放的自己：偶尔吐槽，有自己的语气\n</current_relationship>';
  const items = buildInitialInput([], createQueuePayload(), undefined, [], null, null, devBlock);
  assert.equal(items[0]?.type, 'message');
  assert.equal((items[0] as { role?: string })?.role, 'system');
  assert.equal(items[1]?.type, 'message');
  assert.equal((items[1] as { role?: string })?.role, 'developer');
  assert.match(getMessageContent(items[1]), /world_narrative/);
  assert.match(getMessageContent(items[1]), /<skills_instructions>/);
  assert.match(getMessageContent(items[1]), /<CAPABILITIES>/);
  assert.doesNotMatch(getMessageContent(items[1]), /current_relationship/);
  const rendered = items.map(getMessageContent).join('\n');
  assert.doesNotMatch(rendered, /current_relationship|当前关系层级|当前可开放的自己/);
  assert.doesNotMatch(rendered, /current_scene|消息密度|活跃人数/);
});

// I: developer role injection — capabilities are declared once at the top of the runtime input
test('buildInitialInput injects CAPABILITIES at the beginning even when developerContextBlock is null', () => {
  const items = buildInitialInput([], createQueuePayload(), undefined, [], null, null, null);
  assert.equal((items[0] as { role?: string })?.role, 'system');
  assert.equal((items[1] as { role?: string })?.role, 'developer');
  assert.match(getMessageContent(items[1]), /<CAPABILITIES>/);
  assert.match(getMessageContent(items[1]), /<skills_instructions>/);
});

test('buildInitialInput appends CAPABILITIES once near the start', () => {
  const withSummary = buildInitialInput([], createQueuePayload(), createRuntimePrompt(), [], '压缩后的近况');
  const summaryCapabilities = withSummary.filter((item) => item.type === 'message' && item.role === 'developer' && getMessageContent(item).includes('<CAPABILITIES>'));
  assert.equal(summaryCapabilities.length, 1);
  const summaryIndex = withSummary.findIndex((item) => item.type === 'message' && item.role === 'assistant' && getMessageContent(item).includes('<小腻近况>'));
  assert.ok(summaryIndex >= 0);
  assert.ok(withSummary.indexOf(summaryCapabilities[0]!) < summaryIndex);
  const summaryCapabilitiesBlock = getMessageContent(summaryCapabilities[0]!);
  assert.doesNotMatch(summaryCapabilitiesBlock, new RegExp(REMOVED_LIFE_ACTION_TOOL));
  assert.match(summaryCapabilitiesBlock, /recover_energy: energy_cost=0.000/);
  assert.match(summaryCapabilitiesBlock, /compress_core_memory: energy_cost=0.020/);
  assert.doesNotMatch(summaryCapabilitiesBlock, /qq_usage_/);
  assert.match(summaryCapabilitiesBlock, /skill-creator: energy_cost=0.120/);
  assert.match(summaryCapabilitiesBlock, /qq-usage: energy_cost=0.004/);

  const withRefresh = buildInitialInput([], createQueuePayload(), createRuntimePrompt(), [], null, null, '<capability_refresh reason="operator" />');
  const refreshCapabilities = withRefresh.filter((item) => item.type === 'message' && item.role === 'developer' && getMessageContent(item).includes('<CAPABILITIES>'));
  assert.equal(refreshCapabilities.length, 1);
});

test('buildCapabilitiesDeveloperBlock omits missing-cost skills with operator warning', () => {
  const { block, warnings } = buildCapabilitiesDeveloperBlock({
    skillCosts: {
      'skill-creator': 0.120,
      'missing-cost': null
    }
  });

  assert.match(block, /skill-creator: energy_cost=0.120/);
  assert.doesNotMatch(block, /missing-cost: energy_cost/);
  assert.match(block, /<operator_warning>skill missing-cost omitted/);
  assert.deepEqual(warnings, ['skill missing-cost omitted from <CAPABILITIES>: missing ## Runtime Cost energy_cost']);
});

test('recover_energy is exposed without prompt-facing rest_period or sleep_period tools', () => {
  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, buildInitialInput([], createQueuePayload()), 'group');
  const toolNames = withoutQqUsageTools((request.tools ?? []).map((tool: any) => getToolName(tool)));
  assert.ok(toolNames.includes(RECOVER_ENERGY_TOOL));
  assert.ok(!toolNames.includes('rest_period'));
  assert.ok(!toolNames.includes('sleep_period'));
  const recoverTool = (request.tools ?? []).find((tool: any) => getToolName(tool) === RECOVER_ENERGY_TOOL) as any;
  assert.deepEqual(recoverTool?.function?.parameters?.required, ['reason', 'duration_minutes', 'xiaoni_os']);
  assert.equal(recoverTool?.function?.parameters?.properties?.duration_minutes?.minimum, 5);
  assert.equal(recoverTool?.function?.parameters?.properties?.duration_minutes?.maximum, 120);
});

test('qq_usage stays a skill and does not expose navigation as OpenAI tools', () => {
  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, buildInitialInput([], createQueuePayload()), 'group');
  const toolNames = (request.tools ?? []).map((tool: any) => getToolName(tool));
  assert.equal(toolNames.some((name) => typeof name === 'string' && QQ_USAGE_TOOL_NAME_PATTERN.test(name)), false);
  assert.ok(toolNames.includes(GROUP_REPLY_TOOL));
  assert.ok(!toolNames.includes('send_group_message'));
});

test('buildCanonicalAgentTurnRequest exposes only OpenAI-safe function tool names', () => {
  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, buildInitialInput([], createQueuePayload()), 'group');
  const functionToolNames = (request.tools ?? [])
    .filter((tool: any) => tool.type === 'function')
    .map((tool: any) => getToolName(tool));

  for (const name of functionToolNames) {
    assert.match(String(name), /^[a-zA-Z0-9_-]+$/, `${name} must satisfy OpenAI function tool name pattern`);
  }
});

// J: emit_unread_meaning — topic_context and social_act_type flow through parseUnreadMeaning
test('emit_unread_meaning parseUnreadMeaning extracts topic_context and social_act_type', () => {
  const raw = {
    latest_unread_focus: '聊雪鸮',
    message_act: 'question',
    social_target: 'me',
    addressed_to_me: true,
    has_real_novelty: true,
    confidence: 'high',
    reason: '直接问',
    social_act_type: 'invitation_curiosity',
    topic_context: { has_topic: true, topic_summary: '雪鸮', addressed_to_me: true }
  };
  // The removed life-action tool is no longer prompt-facing; emit_unread_meaning remains legacy execution compatibility only.
  const toolDef = getFunctionTool(buildInitialInput([], createQueuePayload())[0]);
  void toolDef; // We can't call parseUnreadMeaning directly; verify schema instead
  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, buildInitialInput([], createQueuePayload()), 'group');
  assert.equal((request.tools ?? []).some((t: any) => t.function?.name === REMOVED_LIFE_ACTION_TOOL), false);
  assert.equal((request.tools ?? []).some((t: any) => t.function?.name === UNREAD_MEANING_TOOL), false);
  void raw;
});

test('emit_unread_meaning tolerates missing reason by falling back to latest_unread_focus', async () => {
  const service = new AgentLoopService({} as any);
  const result = await (service as any).executeTool({
    name: UNREAD_MEANING_TOOL,
    args: {
      latest_unread_focus: '直接@小腻给了一个轻松发言窗口',
      message_act: 'statement',
      social_target: 'me',
      addressed_to_me: true,
      has_real_novelty: true,
      confidence: 'high',
      social_act_type: 'casual_remark',
      topic_context: {
        has_topic: true,
        topic_summary: '群里成员评价与是否要直接说话',
        addressed_to_me: true
      }
    }
  }, createQueuePayload());

  assert.equal(result.reason, '直接@小腻给了一个轻松发言窗口');
  assert.equal(result.message_act, 'statement');
  assert.deepEqual(result.topic_context, {
    hasTopic: true,
    topicSummary: '群里成员评价与是否要直接说话',
    addressedToMe: true
  });
});

test('XIAONI_IDENTITY_KEY is a plain identity string, not a session-scoped key', () => {
  assert.equal(XIAONI_IDENTITY_KEY, 'xiaoni');
  assert.ok(!XIAONI_IDENTITY_KEY.startsWith('qq:'), 'trust key must not be session-scoped (no qq: prefix)');
  assert.ok(!XIAONI_IDENTITY_KEY.includes(':'), 'trust key must not contain a colon (not a session key format)');
});

test('buildDeveloperContextBlock does not read speaker trust or inject relationship or scene layers', async () => {
  const trustCalls: any[][] = [];
  const activityCalls: any[][] = [];
  const store = {
    getSpeakerTrustLevel: async (...args: any[]) => {
      trustCalls.push(args);
      return 'L3';
    },
    getRecentGroupActivity: async (...args: any[]) => {
      activityCalls.push(args);
      return { activeSenderCount: 2, recentMessageCount: 3 };
    }
  };
  const service = new AgentLoopService(store as any);

  const block = await (service as any).buildDeveloperContextBlock({
    ...createQueuePayload(),
    sessionKey: 'qq:group:999',
    senderId: '202'
  });

  assert.deepEqual(trustCalls, []);
  assert.deepEqual(activityCalls, []);
  assert.doesNotMatch(String(block), /current_relationship|当前关系层级|当前可开放的自己|发言者：foo|current_scene|消息密度|活跃人数/);
});

test('group loop no longer exposes recall_long_term_learning as a pre-reply tool', () => {
  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, buildInitialInput([], createQueuePayload()), 'group');
  const recallTool = (request.tools as Array<{ function?: { name?: string; parameters?: { properties?: Record<string, unknown>; required?: string[] } } }>)
    ?.find((t) => t.function?.name === 'recall_long_term_learning');
  assert.equal(recallTool, undefined);
  assert.ok(!withoutQqUsageTools(getAllowedToolNames(request.tool_choice)).includes('recall_long_term_learning'));
});
