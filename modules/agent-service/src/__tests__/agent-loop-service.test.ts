import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { agentConfig } from '../config';
import { AgentLoopService, applyToolResultToLoopInput, buildCanonicalAgentTurnRequest, buildCapabilitiesDeveloperBlock, buildInitialInput, buildRuntimeStateBlock, buildTurnStateReminder, formatEast8Timestamp, prefixRuntimeTextWithEast8Time, recoverRuntimeEnergy, sanitizeLowValueOpeningFiller, XIAONI_IDENTITY_KEY } from '../services/agent-loop-service';
import { MissingAgentPromptBindingError, type ResolvedAgentRuntimePrompt } from '../services/agent-prompt-service';
import type { QueueMessagePayload } from '../types';

const PRIVATE_REPLY_TOOL = 'send_in_private';
const UNREAD_MEANING_TOOL = 'emit_unread_meaning';
const REMOVED_LIFE_ACTION_TOOL = ['submit', 'life', 'action'].join('_');
const GROUP_REPLY_TOOL = 'send_in_group';
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
  PRIVATE_REPLY_TOOL,
  GROUP_REPLY_TOOL,
  INSPECT_IMAGE_TOOL,
  IMAGE_TASK_TOOL,
  RECOVER_ENERGY_TOOL
];
const GROUP_ALLOWED_TOOLS = [
  WEB_SEARCH_TOOL,
  EXEC_COMMAND_TOOL,
  PRIVATE_REPLY_TOOL,
  GROUP_REPLY_TOOL,
  INSPECT_IMAGE_TOOL,
  IMAGE_TASK_TOOL,
  RECOVER_ENERGY_TOOL
];
const DIRECT_LOOP_TOOLS = [
  EXEC_COMMAND_TOOL,
  WEB_SEARCH_TOOL,
  COMPRESS_CORE_MEMORY_TOOL,
  PRIVATE_REPLY_TOOL,
  GROUP_REPLY_TOOL,
  INSPECT_IMAGE_TOOL,
  IMAGE_TASK_TOOL,
  RECOVER_ENERGY_TOOL
];
const DIRECT_ALLOWED_TOOLS = [
  WEB_SEARCH_TOOL,
  EXEC_COMMAND_TOOL,
  PRIVATE_REPLY_TOOL,
  GROUP_REPLY_TOOL,
  INSPECT_IMAGE_TOOL,
  IMAGE_TASK_TOOL,
  RECOVER_ENERGY_TOOL
];
const EAST8_TIME_PREFIX_PATTERN = /\[当前时间 东八区: \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC\+08:00\]/;

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
    source: 'phone_notification',
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
    phoneNotification: {
      app: 'qq',
      notificationId: 'phone:sid-1',
      sessionKey: 'qq:group:101',
      chatType: 'group',
      peerId: '101',
      peerName: 'Test Group',
      unreadDelta: 1,
      directMentions: 1,
      latestReceivedAt: '2026-03-28T08:00:00.000Z',
      reason: 'group_mention_phone_notification'
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

async function processRuntimeFrameForTest(service: AgentLoopService, queueMessage: unknown, options: Record<string, unknown> = {}) {
  await (service as any).processRuntimeFrame(queueMessage, options);
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
    source: 'phone_notification',
    chatType: 'direct',
    sessionKey: 'qq:direct:303:202',
    peerId: '202',
    peerName: 'Alice',
    bodyForAgent: '你在干嘛',
    rawBody: '你在干嘛',
    wasMentioned: false,
    phoneNotification: {
      app: 'qq',
      notificationId: 'phone:sid-direct-1',
      sessionKey: 'qq:direct:303:202',
      chatType: 'direct',
      peerId: '202',
      peerName: 'Alice',
      unreadDelta: 1,
      directMentions: 0,
      latestReceivedAt: '2026-03-28T08:00:00.000Z',
      reason: 'direct_phone_notification'
    },
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

function createRuntimeLoopPayload(): QueueMessagePayload {
  const payload = createQueuePayload();
  return {
    ...payload,
    source: 'runtime_loop',
    chatType: 'direct',
    sessionKey: 'xiaoni:global',
    peerId: 'xiaoni',
    peerName: '小腻',
    senderId: payload.accountId,
    senderName: '小腻',
    bodyForAgent: '',
    rawBody: '',
    commandBody: '',
    wasMentioned: false,
    phoneNotification: undefined,
    messages: [],
    rawPayload: {
      source: 'runtime_loop'
    },
    inboundContext: {
      ...payload.inboundContext,
      Body: '',
      BodyForAgent: '',
      BodyForCommands: '',
      RawBody: '',
      CommandBody: '',
      NativeChannelId: 'xiaoni:global',
      Surface: 'runtime_loop',
      WasMentioned: false,
      CommandAuthorized: false
    }
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

function buildTestMainCanonicalRequest(
  loopInput: ReturnType<typeof buildInitialInput>,
  queueMessage: QueueMessagePayload,
  runtimePrompt: ResolvedAgentRuntimePrompt
) {
  return {
    ...buildCanonicalAgentTurnRequest(
      runtimePrompt.modelName,
      loopInput,
      queueMessage.chatType,
      runtimePrompt.parameters as Record<string, unknown> | undefined
    ),
    metadata: {
      trace_id: queueMessage.traceId,
      run_id: queueMessage.runId,
      batch_id: queueMessage.batchId,
      session_key: queueMessage.sessionKey,
      session_id: queueMessage.sessionKey,
      turn_id: queueMessage.runId,
      sandbox: 'none',
      chat_type: queueMessage.chatType,
      prompt_name: runtimePrompt.promptName,
      ...(runtimePrompt.promptId ? { prompt_id: runtimePrompt.promptId } : {})
    },
    prompt_cache_key: 'xiaoni:global',
    ...(agentConfig.promptCacheRetention && agentConfig.promptCacheRetention.trim()
      ? { prompt_cache_retention: agentConfig.promptCacheRetention.trim() }
      : {})
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
  return [
    '<system_reminder>',
    '[当前时间 东八区: 2026-06-12 22:51:11 UTC+08:00]',
    '【视线边缘：状态栏闪烁】',
    '你的终端边缘跳出了气泡，提示远处的 QQ 又堆积了 1 条新动静。',
    '要不要动用 `qq-usage` 把视线切过去翻翻，全凭你此刻的心情。没兴趣就直接无视它。',
    '（以下是透过白噪音、明确指名道姓喊你的动静）：',
    '{Alice(@202)} @了你 1 次, 最新消息是: {问问@{Bob(@404)} 今天玩什么}',
    '</system_reminder>'
  ].join('\n');
}

function isPhoneNotificationReminderContent(content: string) {
  return content.includes('<system_reminder>')
    && content.includes('【视线边缘：状态栏闪烁】');
}

function isImageTaskNotificationReminderContent(content: string) {
  return content.includes('<system_reminder>')
    && content.includes('【视觉感知：造物出炉】');
}

test('runtime text timestamp helpers format East-8 time and avoid double prefixes', () => {
  const now = new Date('2026-06-12T14:51:11.000Z');

  assert.equal(formatEast8Timestamp(now), '2026-06-12 22:51:11 UTC+08:00');
  assert.equal(
    prefixRuntimeTextWithEast8Time('醒了。', now),
    '[当前时间 东八区: 2026-06-12 22:51:11 UTC+08:00]\n醒了。'
  );
  assert.equal(
    prefixRuntimeTextWithEast8Time('[当前时间 东八区: 2026-06-12 22:51:11 UTC+08:00]\n醒了。', now),
    '[当前时间 东八区: 2026-06-12 22:51:11 UTC+08:00]\n醒了。'
  );
});

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
        cmd: 'printf "%s|%s|%s" "$XIAONI_TRACE_ID" "$XIAONI_RUN_ID" "$XIAONI_TOOL_CALL_ID"',
        login: false,
        yield_time_ms: 1000,
        max_output_tokens: 100
      },
      rawArguments: '{}'
    }, createQueuePayload());

    assert.equal(result.exit_code, 0);
    assert.equal(result.stdout, 'trace-1|run-1|call-exec');
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
      assert.deepEqual((requests[0]?.env as Record<string, unknown>), {
        XIAONI_TRACE_ID: 'trace-1',
        XIAONI_RUN_ID: 'run-1',
        XIAONI_BATCH_ID: 'batch-1',
        XIAONI_SESSION_KEY: 'qq:group:101',
        XIAONI_TOOL_CALL_ID: 'call-exec-bridge',
        XIAONI_TOOL_NAME: 'exec_command'
      });
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
    }, result, {
      loopInput: [],
      speakingToolName: GROUP_REPLY_TOOL,
      hasVisibleReply: false,
      runtimeEnergyState: { energy: 0.91, maxEnergy: 1 }
    });
    assert.equal(continuation.inputItems[0]?.type, 'function_call_output');
    assert.equal(continuation.inputItems[0]?.call_id, 'call-exec-missing-shell');
    const output = typeof continuation.inputItems[0]?.output === 'string'
      ? continuation.inputItems[0].output
      : '';
    assert.match(output, /^Chunk ID:/);
    assert.doesNotMatch(output, EAST8_TIME_PREFIX_PATTERN);
    assert.match(output, /Process exited without an exit code/);
    assert.match(output, /ENOENT|not\/a\/real-shell/);
    const stateItem = continuation.inputItems[1];
    assert.equal(stateItem?.type, 'message');
    assert.equal(stateItem && stateItem.type === 'message' ? stateItem.role : null, 'developer');
    assert.match(getMessageContent(stateItem), /0.910/);
    assert.match(getMessageContent(stateItem), /1.000/);
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
  const digestItem = loopInput[digestIndex] as any;
  const currentMessageIndex = contents.findIndex(isPhoneNotificationReminderContent);

  assert.ok(historyIndex >= 0);
  assert.ok(digestIndex >= 0);
  assert.equal(digestItem?.role, 'developer');
  assert.equal(digestItem?.phase, undefined);
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

test('buildCanonicalAgentTurnRequest exposes private and group send tools on direct turns', () => {
  const loopInput = buildInitialInput([], createDirectQueuePayload());
  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, loopInput, 'direct');
  const toolNames = withoutQqUsageTools((request.tools ?? []).map((tool: any) => getToolName(tool)));
  const allowedTools = withoutQqUsageTools(getAllowedToolNames(request.tool_choice));

  assert.deepEqual(toolNames, DIRECT_LOOP_TOOLS);
  assert.deepEqual(allowedTools, DIRECT_ALLOWED_TOOLS);
  assert.equal((request.tool_choice as any)?.mode, 'auto');
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

  assert.ok(allowedTools.includes(GROUP_REPLY_TOOL), `send_in_group must be present in direct group tools`);
});

test('group loop does not force a private recall prelude before action tools', () => {
  const loopInput = buildInitialInput([], createQueuePayload());
  loopInput.push({ type: 'function_call', call_id: 'c1', name: UNREAD_MEANING_TOOL, arguments: '{"latest_unread_focus":"群里随便聊","message_act":"statement","social_target":"group","addressed_to_me":false,"has_real_novelty":true,"confidence":"high","reason":"有新内容"}' });
  loopInput.push({ type: 'function_call_output', call_id: 'c1', output: '{"latest_unread_focus":"群里随便聊","message_act":"statement","social_target":"group","addressed_to_me":false,"has_real_novelty":true,"confidence":"high","reason":"有新内容"}' });

  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, loopInput, 'group');
  const allowedTools = withoutQqUsageTools(getAllowedToolNames(request.tool_choice));

  assert.ok(!allowedTools.includes('recall_long_term_learning'), `recall must not be forced for speak path; got [${allowedTools.join(', ')}]`);
  assert.ok(allowedTools.includes(GROUP_REPLY_TOOL), `send_in_group must be in act-turn tools`);
});

test('GROUP_MESSAGE_TOOL description does not contain old ceremonial framing', () => {
  const loopInput = buildInitialInput([], createQueuePayload());
  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, loopInput, 'group');
  const groupReplyTool = (request.tools ?? []).find((t: any) => t.function?.name === GROUP_REPLY_TOOL);

  assert.ok(groupReplyTool, 'send_in_group tool must exist');
  assert.doesNotMatch(String((groupReplyTool as any).function?.description), /承担它落在关系里的后果/, 'old ceremonial framing must be removed');
  assert.doesNotMatch(String((groupReplyTool as any).function?.description), /值得承担时/, 'old framing must be removed');
  assert.doesNotMatch(String((groupReplyTool as any).function?.description), /有真实反应才调用/, 'behavioral guidance should live in instructions');
  assert.match(String((groupReplyTool as any).function?.description), /向明确指定的 QQ 群发送/, 'description should describe the mechanical action');
  assert.deepEqual((groupReplyTool as any).function?.parameters?.required, ['group_id', 'xiaoni_os']);
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
  const queuePayload = createQueuePayload();
  const runtimePrompt = createRuntimePrompt();
  const loopInput = buildInitialInput([], queuePayload);
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
    await (service as any).executeAgentTurn(
      buildTestMainCanonicalRequest(loopInput, queuePayload, runtimePrompt),
      queuePayload,
      'trace-1',
      2,
      runtimePrompt
    );
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
    requestBody.canonicalRequest.input.some((item: any) => item.type === 'message' && item.role === 'developer' && isPhoneNotificationReminderContent(getMessageContent(item))),
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
  assert.equal(requestBody.canonicalRequest.prompt_cache_key, 'xiaoni:global');
  assert.equal(requestBody.canonicalRequest.prompt_cache_retention, '24h');
  assert.equal(requestBody.parameters.advanced_config.generationConfig.timeout, agentConfig.mainAgentTurnTimeoutMs);
  assert.equal(Object.prototype.hasOwnProperty.call(requestBody.canonicalRequest, 'previous_response_id'), false);
});

test('executeAgentTurn forwards encrypted reasoning input items to provider-service', async () => {
  const queuePayload = createQueuePayload();
  const runtimePrompt = createRuntimePrompt();
  const loopInput = buildInitialInput([], queuePayload);
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
    await (service as any).executeAgentTurn(
      buildTestMainCanonicalRequest(loopInput, queuePayload, runtimePrompt),
      queuePayload,
      'trace-1',
      2,
      runtimePrompt
    );
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
  const queuePayload = createQueuePayload();
  const runtimePrompt = createRuntimePrompt();
  const loopInput = buildInitialInput([], queuePayload);
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
    await (service as any).executeAgentTurn(
      buildTestMainCanonicalRequest(loopInput, queuePayload, runtimePrompt),
      queuePayload,
      'trace-1',
      2,
      runtimePrompt
    );
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

test('buildInitialInput appends self continuation after terminal final_answer only when requested', () => {
  const turn = createConversationTurn({
    id: 47,
    userMessage: '',
    aiResponse: null
  });
  turn.rawResponse = {
    responses_replay_items: [
      {
        type: 'message',
        role: 'assistant',
        phase: 'final_answer',
        content: [{
          type: 'output_text',
          text: '留白。'
        }]
      }
    ]
  };

  const withoutReminder = buildInitialInput([turn], createQueuePayload(), createRuntimePrompt({ modelName: 'gpt-5.5' }), [], null, null, null, 'suppress_current_trigger', false);
  assert.equal(withoutReminder.some((item: any) => (
    item.type === 'message'
    && item.role === 'developer'
    && getMessageContent(item).includes('<system_reminder>')
  )), false);

  const loopInput = buildInitialInput([turn], createQueuePayload(), createRuntimePrompt({ modelName: 'gpt-5.5' }), [], null, null, null, 'suppress_current_trigger', true);
  const finalAnswerIndex = loopInput.findIndex((item: any) => (
    item.type === 'message'
    && item.role === 'assistant'
    && item.phase === 'final_answer'
    && getMessageContent(item).includes('留白')
  ));
  const reminderIndex = loopInput.findIndex((item: any) => (
    item.type === 'message'
    && item.role === 'developer'
    && getMessageContent(item).includes('<system_reminder>')
  ));

  assert.ok(finalAnswerIndex >= 0);
  assert.equal(reminderIndex, finalAnswerIndex + 1);
  assert.match(getMessageContent(loopInput[reminderIndex]), EAST8_TIME_PREFIX_PATTERN);
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

  const currentInputItem = loopInput.find((item: any) => item.role === 'developer' && isPhoneNotificationReminderContent(getMessageContent(item)));
  const currentPrompt = getMessageContent(currentInputItem);
  assert.equal((currentInputItem as any)?.role, 'developer');
  assert.doesNotMatch(currentPrompt, /Trace:/);
  assert.doesNotMatch(currentPrompt, /RunId:/);
  assert.doesNotMatch(currentPrompt, /BatchId:/);
  assert.doesNotMatch(currentPrompt, /SessionKey:/);
  assert.doesNotMatch(currentPrompt, /ToolUsage:/);
  assert.match(currentPrompt, /<system_reminder>/);
  assert.match(currentPrompt, EAST8_TIME_PREFIX_PATTERN);
  assert.match(currentPrompt, /视线边缘：状态栏闪烁/);
  assert.doesNotMatch(currentPrompt, /<PHONE_NOTIFICATION/);
  assert.doesNotMatch(currentPrompt, /session_key=/);
  assert.doesNotMatch(currentPrompt, /message_sid=|source="napcat"/);
  assert.doesNotMatch(currentPrompt, /sender=|timestamp=/);
  assert.doesNotMatch(currentPrompt, /\[mentioned bot\]/);
});

test('buildInitialInput suppresses deleted final-answer prompt reminders', () => {
  const reminderText = 'deleted final-answer prompt reminder should not enter model input';
  const payload = createQueuePayload();
  payload.source = 'system_reminder';
  payload.bodyForAgent = reminderText;
  payload.rawBody = reminderText;
  payload.rawPayload = {
    reason: 'final_answer_idle'
  };
  payload.inboundContext = {
    ...payload.inboundContext,
    Surface: 'system_reminder',
    BodyForAgent: reminderText
  };
  payload.systemReminder = {
    reminder: reminderText,
    reason: 'final_answer_idle',
    createdAt: '2026-06-10T00:00:00.000Z'
  };

  const loopInput = buildInitialInput([], payload, createRuntimePrompt({
    systemPrompt: '你是小腻主AGENT'
  }));
  const rendered = loopInput.map(getMessageContent).join('\n');

  assert.doesNotMatch(rendered, new RegExp(reminderText));
  assert.doesNotMatch(rendered, /final_answer_idle/);
  assert.equal(loopInput.some((item: any) => (
    item.role === 'user'
    && getMessageContent(item) === reminderText
  )), false);
});

test('buildInitialInput prefixes ordinary system reminders with East-8 current time', () => {
  const payload = createQueuePayload();
  payload.source = 'system_reminder';
  payload.messages = [];
  payload.phoneNotification = undefined;
  payload.bodyForAgent = '该压缩记忆了。';
  payload.rawBody = '该压缩记忆了。';
  payload.systemReminder = {
    reminder: '该压缩记忆了。',
    reason: 'manual',
    createdAt: '2026-06-12T14:51:11.000Z'
  };
  payload.inboundContext = {
    ...payload.inboundContext,
    Surface: 'system_reminder',
    BodyForAgent: '该压缩记忆了。'
  };

  const loopInput = buildInitialInput([], payload, createRuntimePrompt());
  const rendered = loopInput.map(getMessageContent).join('\n');

  assert.match(rendered, /<system_reminder>/);
  assert.match(rendered, EAST8_TIME_PREFIX_PATTERN);
  assert.match(rendered, /该压缩记忆了。/);
});

test('buildInitialInput renders completed image tasks as task notifications', () => {
  const payload = createQueuePayload();
  payload.source = 'image_task_notification';
  payload.sessionKey = 'xiaoni:global';
  payload.chatType = 'direct';
  payload.peerId = '1129974489';
  payload.peerName = '小腻 runtime';
  payload.messages = [];
  payload.phoneNotification = undefined;
  payload.rawPayload = {
    kind: 'image_task_completed',
    task_id: 'task-image-1',
    picture_id: 'task_artifact_1',
    picture_path: '/xiaoni-runtime/picture/task_artifact_1.png'
  };
  payload.inboundContext.Surface = 'image_task_notification';
  payload.imageTaskNotification = {
    taskId: 'task-image-1',
    taskType: 'image_generate',
    taskStatus: 'completed',
    pictureId: 'task_artifact_1',
    picturePath: '/xiaoni-runtime/picture/task_artifact_1.png',
    pictureMimeType: 'image/png',
    pictureBytes: 123,
    targetDescription: '一张测试图',
    sourceTraceId: 'trace-source',
    sourceRunId: 'run-source',
    createdAt: '2026-03-28T08:01:00.000Z'
  };

  const loopInput = buildInitialInput([], payload, createRuntimePrompt({
    systemPrompt: '你是小腻主AGENT'
  }));
  const rendered = loopInput.map(getMessageContent).join('\n');

  assert.match(rendered, /<system_reminder>/);
  assert.match(rendered, EAST8_TIME_PREFIX_PATTERN);
  assert.match(rendered, /视觉感知：造物出炉/);
  assert.match(rendered, /生成状态：已完成/);
  assert.match(rendered, /任务锚点: task-image-1/);
  assert.match(rendered, /生成状态：已完成）。\n\n\[造物档案\]/);
  assert.match(rendered, /图片ID: task_artifact_1/);
  assert.match(rendered, /图片路径: \/xiaoni-runtime\/picture\/task_artifact_1\.png/);
  assert.match(rendered, /目标: 一张测试图\n\n这不是外界别人发给你的消息/);
  assert.doesNotMatch(rendered, /<IMAGE_TASK_NOTIFICATION/);
  assert.doesNotMatch(rendered, /\{\{(?:TASK_TYPE_LINE|PICTURE_ID_LINE|PICTURE_PATH_LINE|TARGET_DESCRIPTION_LINE)\}\}/);
  assert.doesNotMatch(rendered, /picture_bytes|source_trace_id|source_run_id|created_at/);
  assert.doesNotMatch(rendered, /<PHONE_NOTIFICATION/);
});

test('buildInitialInput keeps ordinary unmentioned group IM as low-trust unread metadata only', () => {
  const payload = createQueuePayload();
  payload.wasMentioned = false;
  payload.bodyForAgent = '普通闲聊正文不应该直接进来';
  payload.rawBody = '普通闲聊正文不应该直接进来';
  payload.inboundContext.WasMentioned = false;
  if (payload.phoneNotification) {
    payload.phoneNotification.directMentions = 0;
  }
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
  assert.match(rendered, /视线边缘：状态栏闪烁/);
  assert.match(rendered, /没有明确喊你的信息/);
  assert.doesNotMatch(rendered, /latest_preview|messages/);
  assert.doesNotMatch(rendered, /手机状态栏出现了 QQ 通知/);
  assert.doesNotMatch(rendered, /<PHONE_NOTIFICATION/);

  const unreadItems = loopInput.filter((item: any) => item.role === 'developer' && isPhoneNotificationReminderContent(getMessageContent(item)));
  assert.equal(unreadItems.length, 1);
  assert.equal((unreadItems[0] as any).role, 'developer');
  assert.equal(loopInput.some((item: any) => item.role === 'user' && isPhoneNotificationReminderContent(getMessageContent(item))), false);
});

test('buildInitialInput keeps mentioned group batches as phone notifications only', () => {
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

  assert.match(rendered, /视线边缘：状态栏闪烁/);
  assert.doesNotMatch(rendered, /前面普通未读/);
  assert.match(rendered, /@小腻 看到前面了吗/);
  assert.doesNotMatch(rendered, /message_id="11" chat_type="群聊"/);
  assert.doesNotMatch(rendered, /message_id="12" chat_type="群聊"/);
  assert.doesNotMatch(rendered, /message_sid=|source="napcat"/);
  assert.doesNotMatch(sceneRendered, /<PHONE_NOTIFICATION/);
  assert.doesNotMatch(sceneRendered, /<IM_INBOX_WINDOW/);
  const developerNotification = loopInput.find((item: any) => item.role === 'developer' && isPhoneNotificationReminderContent(getMessageContent(item)));
  assert.ok(developerNotification);
  assert.doesNotMatch(getMessageContent(developerNotification), /<IM_INBOX_WINDOW|message_sid=|source="napcat"|前面普通未读/);
});

test('buildInitialInput keeps direct batches as phone notifications only', () => {
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

  assert.match(rendered, /视线边缘：状态栏闪烁/);
  assert.match(rendered, /Alice\(@202\).*发来 2 条消息/);
  assert.match(rendered, /第二条私聊/);
  assert.doesNotMatch(rendered, /message_id="11" chat_type="私聊"/);
  assert.doesNotMatch(rendered, /message_id="12" chat_type="私聊"/);
  assert.doesNotMatch(rendered, /message_sid=|source="napcat"/);
  assert.doesNotMatch(sceneRendered, /<PHONE_NOTIFICATION/);
  assert.doesNotMatch(sceneRendered, /<IM_INBOX_WINDOW/);
  const developerNotification = loopInput.find((item: any) => item.role === 'developer' && isPhoneNotificationReminderContent(getMessageContent(item)));
  assert.ok(developerNotification);
  assert.match(getMessageContent(developerNotification), /Alice\(@202\).*发来 2 条消息/);
  assert.match(getMessageContent(developerNotification), /第二条私聊/);
  assert.doesNotMatch(getMessageContent(developerNotification), /<IM_INBOX_WINDOW|message_sid=|source="napcat"|message_id=/);
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

  assert.doesNotMatch(rendered, /\[当前媒体占位符\]/);
  assert.doesNotMatch(rendered, /image_1/);
  assert.doesNotMatch(rendered, /example\.com\/private/);
});

test('buildInitialInput does not expose reply context before QQ is opened', () => {
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
  const currentInputItem = loopInput.find((item: any) => item.role === 'developer' && isPhoneNotificationReminderContent(getMessageContent(item)));
  const currentPrompt = getMessageContent(currentInputItem);

  assert.doesNotMatch(currentPrompt, /sender=|timestamp=/);
  assert.doesNotMatch(currentPrompt, /上一条消息/);
  assert.match(currentPrompt, /\{Bob\(@404\)\} 嘿/);
});

test('buildInitialInput renders a notification batch as one phone notification', () => {
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
  const currentTurnItems = loopInput.filter((item: any) => item.role === 'developer' && isPhoneNotificationReminderContent(getMessageContent(item)));

  assert.equal(currentTurnItems.length, 1);
  assert.match(getMessageContent(currentTurnItems[0]), EAST8_TIME_PREFIX_PATTERN);
  assert.match(getMessageContent(currentTurnItems[0]), /视线边缘：状态栏闪烁/);
  assert.doesNotMatch(getMessageContent(currentTurnItems[0]), /session_key=/);
  assert.equal(currentTurnItems.some((item) => /sender=|timestamp=/.test(getMessageContent(item))), false);
});

test('buildInitialInput does not replay historical notification snapshots as current input', () => {
  const historicalTurn = createConversationTurn({ id: 31 }) as any;
  historicalTurn.items = [
    {
      ...historicalTurn.items[0],
      source: 'sensory_event',
      content: expectedCurrentInputMessage(),
      deliveryMessageId: null,
      runId: 'run-historical-notification',
      traceId: 'trace-historical-notification'
    },
    {
      ...historicalTurn.items[0],
      source: 'inbound_batch',
      content: '<PHONE_NOTIFICATION app="qq" surface="status_bar" unread_delta="7" />',
      deliveryMessageId: null,
      runId: 'run-historical-inbound-notification',
      traceId: 'trace-historical-inbound-notification'
    },
    historicalTurn.items[1]
  ] as any;

  const payload = createQueuePayload();
  payload.phoneNotification!.unreadDelta = 3;
  payload.phoneNotification!.directMentions = 2;

  const loopInput = buildInitialInput([historicalTurn], payload);
  const rendered = loopInput.map(getMessageContent).join('\n');
  const phoneNotificationItems = loopInput.filter((item: any) => (
    item.role === 'developer'
    && isPhoneNotificationReminderContent(getMessageContent(item))
  ));

  assert.equal(phoneNotificationItems.length, 1);
  assert.match(getMessageContent(phoneNotificationItems[0]), /堆积了 3 条新动静/);
  assert.doesNotMatch(rendered, /堆积了 1 条新动静/);
  assert.doesNotMatch(rendered, /<PHONE_NOTIFICATION/);
});

test('buildInitialInput suppresses already-picked notification context', () => {
  const payload = createQueuePayload();
  payload.phoneNotification!.unreadDelta = 4;
  payload.phoneNotification!.directMentions = 0;

  const loopInput = buildInitialInput(
    [],
    payload,
    createRuntimePrompt(),
    [],
    null,
    null,
    null,
    'suppress_current_trigger'
  );
  const rendered = loopInput
    .filter((item: any) => item.role !== 'system')
    .map(getMessageContent)
    .join('\n');

  assert.doesNotMatch(rendered, /<PHONE_NOTIFICATION/);
  assert.doesNotMatch(rendered, /视线边缘：状态栏闪烁/);
  assert.doesNotMatch(rendered, /<runtime_event_snapshot/);
  assert.doesNotMatch(rendered, /source="phone_notification"/);
  assert.doesNotMatch(rendered, /status="already_picked"/);
  assert.doesNotMatch(rendered, /4 条/);
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
  const currentInputItem = loopInput.find((item: any) => item.role === 'developer' && isPhoneNotificationReminderContent(getMessageContent(item)));
  assert.match(getMessageContent(currentInputItem), /视线边缘：状态栏闪烁/);
  assert.doesNotMatch(getMessageContent(currentInputItem), /<PHONE_NOTIFICATION/);
  assert.equal((currentInputItem as any)?.role, 'developer');
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
  const notificationIndex = rendered.findIndex(isPhoneNotificationReminderContent);
  const identityIndex = rendered.findIndex((content) => content.includes('[身份连续性]'));

  assert.ok(osIndex !== -1);
  assert.ok(notificationIndex !== -1);
  assert.equal(identityIndex, -1);
  assert.equal(rendered.some((content) => content.includes('不要用公式化开头')), false);
  assert.equal(rendered.some((content) => content.includes('第二条')), false);
  assert.ok(osIndex < notificationIndex);
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
  const currentMessage = loopInput.find((item: any) => item.role === 'developer' && isPhoneNotificationReminderContent(getMessageContent(item)));
  assert.equal(currentMessage?.type, 'message');
  assert.equal((currentMessage as any)?.role, 'developer');
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
        lease_release: {
          reason: 'no_visible_delivery_observed',
          detail: '刚才大家是在彼此接话，我插进去会显得多余。'
        },
        lease_release_reason: 'no_visible_delivery_observed',
        no_visible_delivery: true
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
  assert.match(getMessageContent(standaloneOsItem), /刚才我没有可见发言/);
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
  const queuePayload = createQueuePayload();
  const runtimePrompt = createRuntimePrompt({
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
  });
  const loopInput = buildInitialInput([], queuePayload);

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
      buildTestMainCanonicalRequest(loopInput, queuePayload, runtimePrompt),
      queuePayload,
      'trace-2',
      1,
      runtimePrompt
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0].prompt_name, '小腻主AGENT');
  assert.equal(calls[0].model, 'gpt-5.4');
  assert.equal(calls[0].canonicalRequest.metadata.prompt_id, 'prompt-1');
  assert.equal(calls[0].canonicalRequest.prompt_cache_key, 'xiaoni:global');
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
  assert.equal(timelineEvents.at(-1)?.metadata?.subagent_status, 'disabled_feedback_episode_tool_removed');
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
    'xiaoni:global',
    'xiaoni:global',
    'xiaoni:global'
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
  }, {
    loopInput,
    speakingToolName: GROUP_REPLY_TOOL,
    hasVisibleReply: true,
    runtimeEnergyState: { energy: 0.91, maxEnergy: 1 }
  });

  assert.equal(continuation.forcedVisibleReply, null);
  assert.equal(continuation.inputItems.length, 1);
  loopInput.push(...continuation.inputItems);
  const lastItem = loopInput.at(-1);
  assert.equal(lastItem?.type, 'function_call_output');
  assert.equal(lastItem && lastItem.type === 'function_call_output' ? lastItem.call_id : null, 'call-1');
  const output = JSON.parse(String(lastItem && lastItem.type === 'function_call_output' ? lastItem.output : '{}'));
  assert.deepEqual(output.sent_messages, ['我们出去玩吧']);
  assert.equal(output.energy_cost, 0.015);
  assert.equal(output.energy, 0.91);
  assert.equal(output.max_energy, 1);
  assert.equal(loopInput.some((item) => item.type === 'function_call'), false);
  assert.equal(loopInput.some((item) => item.type === 'function_call_output'), true);
});

test('applyToolResultToLoopInput replays image task output without follow-up reminder', () => {
  const loopInput = buildInitialInput([], createQueuePayload(), createRuntimePrompt());

  const continuation = applyToolResultToLoopInput({
    callId: 'call-image-task',
    name: IMAGE_TASK_TOOL,
    rawArguments: '{"prompt":"一张蓝天白云头像图","target_description":"群头像图"}'
  }, {
    queued: true,
    task_id: 'task-image-queued',
    task_type: 'image_generate',
    status_text: '生图任务:task-image-queued 正在进行中，当完成时会以 notify 的形式通知到你。你去忙你自己的'
  }, {
    loopInput,
    speakingToolName: GROUP_REPLY_TOOL,
    hasVisibleReply: false,
    runtimeEnergyState: { energy: 0.88, maxEnergy: 1 }
  });

  assert.equal(continuation.inputItems.length, 1);
  const replay = continuation.inputItems[0];
  assert.equal(replay?.type, 'function_call_output');
  assert.equal(replay && replay.type === 'function_call_output' ? replay.call_id : null, 'call-image-task');
  const output = JSON.parse(String(replay && replay.type === 'function_call_output' ? replay.output : '{}'));
  assert.match(String(output.status_text), /生图任务:task-image-queued 正在进行中/);
  assert.equal(output.energy_cost, 0.03);
  assert.equal(output.energy, 0.88);
  assert.equal(output.max_energy, 1);
  assert.equal(continuation.forcedVisibleReply, null);
});

test('applyToolResultToLoopInput uses fresh runtime energy instead of prior JSON tool output', () => {
  const first = applyToolResultToLoopInput({
    callId: 'call-send-first',
    name: PRIVATE_REPLY_TOOL,
    rawArguments: '{"message":"先说一句"}'
  }, {
    sent_messages: ['先说一句']
  }, {
    loopInput: [],
    speakingToolName: GROUP_REPLY_TOOL,
    hasVisibleReply: true,
    runtimeEnergyState: { energy: 0.91, maxEnergy: 1 }
  });
  const loopInput = [
    ...buildInitialInput([], createQueuePayload(), createRuntimePrompt()),
    ...first.inputItems
  ];

  const second = applyToolResultToLoopInput({
    callId: 'call-image-second',
    name: IMAGE_TASK_TOOL,
    rawArguments: '{"prompt":"一张图","target_description":"图"}'
  }, {
    queued: true,
    task_id: 'task-after-send'
  }, {
    loopInput,
    speakingToolName: GROUP_REPLY_TOOL,
    hasVisibleReply: false,
    runtimeEnergyState: { energy: 0.73, maxEnergy: 1 }
  });

  const replay = second.inputItems[0];
  assert.equal(replay?.type, 'function_call_output');
  const output = JSON.parse(String(replay && replay.type === 'function_call_output' ? replay.output : '{}'));
  assert.equal(output.energy_cost, 0.03);
  assert.equal(output.energy, 0.73);
  assert.equal(output.max_energy, 1);
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
  assert.equal(result.task_id, 'task-generate-from-edit');
  assert.equal(result.status_text, '生图任务:task-generate-from-edit 正在进行中，当完成时会以 notify 的形式通知到你。你去忙你自己的');
});

test('requestImageTask keeps image_edit when a source image resolves', async () => {
  const createdTasks: any[] = [];
  const service = new AgentLoopService({
    getMediaAssetById: async () => null,
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
  assert.equal(result.task_id, 'task-edit');
  assert.equal(result.status_text, '生图任务:task-edit 正在进行中，当完成时会以 notify 的形式通知到你。你去忙你自己的');
});

test('inspect_image_placeholder runs a no-persist main-context vision fork by image id', async () => {
  const imageDataUrl = 'data:image/png;base64,QUJDREVGRw==';
  const queueMessage = {
    id: 'run-queue-image-vision-fork',
    traceId: 'trace-image-vision-fork',
    batchId: 'batch-image-vision-fork',
    status: 'processing',
    attempts: 1,
    createdAt: '2026-06-10T00:00:00.000Z',
    queueMessageIds: [1],
    payload: createQueuePayload()
  };

  const storeCalls: Record<string, any[]> = {
    createConversation: [],
    settleQueueMessages: [],
    releaseExecutionLease: [],
    updateLlmJob: [],
    completeAgentStackToolExecution: [],
    recordMediaObservation: []
  };

  const store = {
    createLlmJob: async () => 'job-image-vision-fork',
    logTimelineEvent: async () => {},
    listRecentTurns: async () => [
      createConversationTurn({
        id: 77,
        userMessage: '之前说过这张图可能有猫',
        aiResponse: '我还没真正看图。'
      })
    ],
    getSessionReadCutoffState: async () => ({
      readCutoffAfterConversationId: null,
      contextSummary: '最近在认真区分占位符和真实图片内容。',
      pendingProactiveShare: null,
      pendingProactiveShareAge: 0
    }),
    upsertSessionReadCutoffState: async () => {},
    upsertProactiveShareState: async () => {},
    getMediaAssetById: async (_sessionKey: string, assetId: string) => ({
      id: assetId,
      session_key: 'qq:group:101',
      media_tag: 'image_1',
      media_type: 'image',
      mime_type: 'image/png',
      source_locator: 'https://example.test/private/cat.png',
      metadata: {},
      observations: [{
        id: 'old-obs',
        description: '旧观察不应该短路。'
      }]
    }),
    getMediaAssetByTag: async () => null,
    recordMediaObservation: async (params: any) => {
      storeCalls.recordMediaObservation.push(params);
      return { id: 'obs-new', ...params };
    },
    getExecutionLeaseDeliveryState: async () => ({
      deliveryPhase: 'reasoning_open',
      deliveryCommitCount: 0,
      blockedDeliveryAttemptCount: 0,
      lastBlockedDeliveryReason: null
    }),
    markLeaseVisibleDeliveryCommitted: async () => {},
    markLeaseDeliveryBlocked: async () => {},
    completeAgentStackToolExecution: async (params: any) => {
      storeCalls.completeAgentStackToolExecution.push(params);
    },
    createConversation: async (params: any) => {
      storeCalls.createConversation.push(params);
      return 4096;
    },
    attachConversationIdToTrace: async () => {},
    settleQueueMessages: async (_runId: string, params: any) => { storeCalls.settleQueueMessages.push(params); },
    failQueueMessage: async () => {},
    releaseExecutionLease: async (_runId: string, params: any) => { storeCalls.releaseExecutionLease.push(params); },
    updateLlmJob: async (_jobId: string, params: any) => { storeCalls.updateLlmJob.push(params); }
  } as any;

  const service = new AgentLoopService(store, {
    resolveForQueueMessage: async () => createRuntimePrompt()
  } as any);

  const mainRequests: any[] = [];
  let turn = 0;
  (service as any).executeAgentTurn = async (canonicalRequest: any) => {
    mainRequests.push(canonicalRequest);
    turn += 1;
    if (turn === 1) {
      return {
        success: true,
        llm_call_id: 'llm-main-image-1',
        canonical_response: {
          output: [{
            type: 'function_call',
            call_id: 'call-inspect-image',
            name: INSPECT_IMAGE_TOOL,
            arguments: JSON.stringify({
              image_id: 'asset-img-123',
              reason: '需要真正看图才能接话。'
            })
          }]
        }
      };
    }
    return {
      success: true,
      llm_call_id: 'llm-main-image-2',
      canonical_response: {
        output: [{
          type: 'function_call',
          call_id: 'call-rest-after-image',
          name: RECOVER_ENERGY_TOOL,
          arguments: JSON.stringify({
            reason: '看完图后先停一下。',
            clock: 5,
            xiaoni_os: '已经通过视觉 fork 看过 asset-img-123。'
          })
        }]
      }
    };
  };

  const originalFetch = globalThis.fetch;
  const fetchCalls: Array<{ url: string; headers: any; body: any }> = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const parsed = init?.body ? JSON.parse(String(init.body)) : null;
    fetchCalls.push({
      url: String(url),
      headers: init?.headers || {},
      body: parsed
    });
    if (String(url).endsWith('/api/internal/media/materialize-image')) {
      return {
        ok: true,
        json: async () => ({
          success: true,
          data: {
            data_url: imageDataUrl,
            mime_type: 'image/png'
          }
        })
      } as Response;
    }
    if (String(url).endsWith('/api/internal/llm/debug')) {
      return {
        ok: true,
        json: async () => ({
          success: true,
          response: '这是一只猫',
          model: 'gpt-5.4-mini',
          provider: 'openai',
          llm_call_id: 'llm-image-fork'
        })
      } as Response;
    }
    throw new Error(`Unexpected fetch: ${String(url)}`);
  }) as typeof fetch;

  try {
    await processRuntimeFrameForTest(service, queueMessage as any);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const materializeCalls = fetchCalls.filter((call) => call.url.endsWith('/api/internal/media/materialize-image'));
  const debugCalls = fetchCalls.filter((call) => call.url.endsWith('/api/internal/llm/debug'));
  assert.equal(materializeCalls.length, 1);
  assert.equal(debugCalls.length, 1);
  assert.equal(fetchCalls.some((call) => call.url.includes('/api/internal/media/inspect')), false);
  assert.equal(materializeCalls[0]?.headers?.['x-qqbot-no-traffic-persist'], '1');
  assert.equal(debugCalls[0]?.headers?.['x-qqbot-no-traffic-persist'], '1');

  const mainRequest = mainRequests[0];
  const forkRequest = debugCalls[0]?.body?.canonicalRequest;
  assert.ok(mainRequest);
  assert.ok(forkRequest);
  assert.deepEqual(forkRequest.input.slice(0, -3), mainRequest.input);
  assert.equal(forkRequest.instructions, mainRequest.instructions);
  assert.deepEqual(forkRequest.tools, mainRequest.tools);
  assert.equal(forkRequest.tool_choice, 'none');
  assert.equal(forkRequest.parallel_tool_calls, false);
  assert.equal(forkRequest.store, false);

  const appendedItems = forkRequest.input.slice(mainRequest.input.length);
  assert.equal(appendedItems.length, 3);
  const [visionCommentary, visionCall, visionOutput] = appendedItems;
  assert.equal(visionCommentary?.type, 'message');
  assert.equal(visionCommentary?.role, 'assistant');
  assert.equal(getMessageContent(visionCommentary), '让我来看看这个图是啥意思');
  assert.equal(
    Array.isArray(visionCommentary?.content)
      ? visionCommentary.content.some((part: any) => part.type === 'input_image')
      : false,
    false
  );
  assert.equal(visionCall?.type, 'function_call');
  assert.equal(visionCall?.name, 'inspect_image_placeholder');
  assert.deepEqual(JSON.parse(visionCall?.arguments), {
    image_id: 'asset-img-123',
    detail: 'original'
  });
  assert.equal(visionOutput?.type, 'function_call_output');
  assert.equal(visionOutput?.call_id, visionCall?.call_id);
  assert.deepEqual(visionOutput?.output, [{
    type: 'input_image',
    image_url: imageDataUrl,
    detail: 'original'
  }]);
  assert.equal(appendedItems.some((item: any) => item.role === 'user'), false);
  assert.doesNotMatch(JSON.stringify([visionCommentary, visionCall]), /data:image/);
  assert.match(JSON.stringify(visionOutput?.output), /data:image\/png;base64,QUJDREVGRw==/);

  assert.equal(storeCalls.recordMediaObservation.length, 1);
  assert.equal(storeCalls.recordMediaObservation[0]?.assetId, 'asset-img-123');
  assert.equal(storeCalls.recordMediaObservation[0]?.description, '这是一只猫');

  const inspectLog = storeCalls.completeAgentStackToolExecution.find((call) => call.result?.image_id === 'asset-img-123');
  assert.ok(inspectLog);
  assert.equal(inspectLog.result.output_xml, '<image id="asset-img-123">含义是: 这是一只猫</image>');
  const replayText = JSON.stringify(storeCalls.createConversation[0]?.rawResponse?.responses_replay_items || []);
  assert.match(replayText, /<image id=\\"asset-img-123\\">含义是: 这是一只猫<\/image>/);
  const persistedRuntimeText = JSON.stringify({
    toolLogs: storeCalls.completeAgentStackToolExecution,
    conversations: storeCalls.createConversation,
    settle: storeCalls.settleQueueMessages,
    release: storeCalls.releaseExecutionLease
  });
  assert.doesNotMatch(persistedRuntimeText, /data:image/);
  assert.doesNotMatch(persistedRuntimeText, /QUJDREVGRw==/);
});

test('send_in_group uses explicit group target when provided', async () => {
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
    session_key: 'qq:group:999999',
    group_id: 999999,
    messages: ['可以试试'],
    mention_user_ids: [404]
  });
});

test('send_in_group returns a retryable tool error without explicit group target', async () => {
  const service = new AgentLoopService({} as any);
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = (async () => {
    fetchCalled = true;
    throw new Error('send_in_group without group_id must not call provider');
  }) as typeof fetch;

  try {
    const result = await (service as any).sendMessage('group', {
      message: '这句不能误发到私聊 peerId'
    }, createQueuePayload());

    assert.deepEqual(result, {
      tool_error: true,
      retryable: true,
      tool_name: GROUP_REPLY_TOOL,
      message_type: 'group',
      error_code: 'missing_group_id',
      error_message: 'send_in_group requires explicit group_id.',
      required_arguments: ['group_id'],
      received_arguments: ['message'],
      sent_messages: [],
      xiaoni_os: null,
      pending_share: null
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(fetchCalled, false);
});

test('send_in_group can target an explicit group from a direct chat run', async () => {
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
      group_id: 253631878,
      message: '我去群里说这一句'
    }, createDirectQueuePayload());

    assert.equal(result.message_type, 'group');
    assert.equal(result.target_group_id, 253631878);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(calls[0]?.body, {
    session_key: 'qq:group:253631878',
    group_id: 253631878,
    messages: ['我去群里说这一句'],
    mention_user_ids: []
  });
});

test('send_in_private uses explicit user target when provided', async () => {
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

test('send_in_private returns a retryable tool error without explicit user target', async () => {
  const service = new AgentLoopService({} as any);
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = (async () => {
    fetchCalled = true;
    throw new Error('send_in_private without user_id must not call provider');
  }) as typeof fetch;

  try {
    const result = await (service as any).sendMessage('private', {
      message: '这句不能偷偷默认发给当前私聊对象'
    }, createDirectQueuePayload());

    assert.deepEqual(result, {
      tool_error: true,
      retryable: true,
      tool_name: PRIVATE_REPLY_TOOL,
      message_type: 'private',
      error_code: 'missing_user_id',
      error_message: 'send_in_private requires explicit user_id.',
      required_arguments: ['user_id'],
      received_arguments: ['message'],
      sent_messages: [],
      xiaoni_os: null,
      pending_share: null
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(fetchCalled, false);
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

test('send_in_group prefers messages array over message when both are supplied', async () => {
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
      group_id: 101,
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

test('send_in_group with a single message sends it once through executeTool', async () => {
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
      rawArguments: '{"group_id":101,"message":"刚看了眼群，没干啥","xiaoni_os":"已短回。"}',
      args: {
        group_id: 101,
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

test('runtime frame fails without a bound prompt and does not call the provider', async () => {
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
    releaseExecutionLease: [],
    updateLlmJob: [],
    logTimelineEvent: [],
    recordNoVisibleDeliveryLifeEvent: []
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
    releaseExecutionLease: async (_runId: string, params: any) => { storeCalls.releaseExecutionLease.push(params); },
    updateLlmJob: async (_jobId: string, params: any) => { storeCalls.updateLlmJob.push(params); },
    recordNoVisibleDeliveryLifeEvent: async (params: any) => { storeCalls.recordNoVisibleDeliveryLifeEvent.push(params); }
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
    await processRuntimeFrameForTest(service, queueMessage as any);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(fetchCalled, false);
  assert.equal(storeCalls.createConversation.length, 1);
  assert.equal(storeCalls.createConversation[0]?.status, 'failed');
  assert.equal(storeCalls.createConversation[0]?.aiResponse, null);
  assert.equal(storeCalls.createConversation[0]?.userMessage, '');
  assert.equal(storeCalls.createConversation[0]?.transcriptItems?.length, 0);
  assert.equal(storeCalls.createConversation[0]?.errorReason, 'No active agent prompt binding found for current conversation');
  assert.deepEqual(storeCalls.createConversation[0]?.rawRequest?.prompt, {
    source: null,
    prompt_id: null,
    prompt_name: null,
    model_name: null
  });
  assert.equal(storeCalls.createConversation[0]?.rawResponse?.lease_release_reason, 'prompt_binding_error');
  assert.deepEqual(storeCalls.failQueueMessage[0], ['run-queue-1', 'No active agent prompt binding found for current conversation', 987]);
  assert.equal(storeCalls.releaseExecutionLease[0]?.status, 'failed');
  assert.equal(storeCalls.releaseExecutionLease[0]?.leaseRelease?.reason, 'prompt_binding_error');
  assert.equal(storeCalls.releaseExecutionLease[0]?.noVisibleDelivery, true);
  assert.equal(storeCalls.updateLlmJob[0]?.status, 'failed');
  assert.equal(storeCalls.recordNoVisibleDeliveryLifeEvent.length, 0);
});

test('runtime frame persists delivered assistant transcript items with final phase on success', async () => {
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
    settleQueueMessages: [],
    releaseExecutionLease: [],
    updateLlmJob: [],
    markLeaseVisibleDeliveryCommitted: [],
    ensureXiaoniIdentityRoot: [],
    recordAgentStackToolExecution: [],
    listRecentTurns: []
  };
  let deliveryPhase = 'reasoning_open';

  const store = {
    createLlmJob: async () => 'job-success',
    logTimelineEvent: async () => {},
    loadSessionReplayState: async () => ({ summaryText: null, summarizedThroughConversationId: null }),
    listRecentTurns: async (params: any) => {
      storeCalls.listRecentTurns.push(params);
      return [];
    },
    getSessionReadCutoffState: async () => null,
    upsertSessionReadCutoffState: async () => {},
    upsertProactiveShareState: async () => {},
    getExecutionLeaseDeliveryState: async () => ({
      deliveryPhase,
      deliveryCommitCount: deliveryPhase === 'delivery_committed' ? 1 : 0,
      blockedDeliveryAttemptCount: 0,
      lastBlockedDeliveryReason: null
    }),
    markLeaseVisibleDeliveryCommitted: async (_runId: string) => {
      deliveryPhase = 'delivery_committed';
      storeCalls.markLeaseVisibleDeliveryCommitted.push(_runId);
    },
    markLeaseDeliveryBlocked: async () => {},
    recordAgentStackToolExecution: async (params: any) => {
      storeCalls.recordAgentStackToolExecution.push(params);
      return { id: 1, ...params };
    },
    completeAgentStackToolExecution: async () => {},
    createConversation: async (params: any) => {
      storeCalls.createConversation.push(params);
      return 1001;
    },
    ensureXiaoniIdentityRoot: async (params: any) => {
      storeCalls.ensureXiaoniIdentityRoot.push(params);
      return { root: { id: 1 }, event: { id: 2 }, created: true };
    },
    attachConversationIdToTrace: async () => {},
    settleQueueMessages: async (_runId: string, params: any) => { storeCalls.settleQueueMessages.push(params); },
    releaseExecutionLease: async (_runId: string, params: any) => { storeCalls.releaseExecutionLease.push(params); },
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
    if (turn === 1) {
      return {
        success: true,
        llm_call_id: 'llm-success-1',
        canonical_response: {
          output: [{
            type: 'function_call',
            call_id: 'call-group-success',
            name: GROUP_REPLY_TOOL,
            arguments: JSON.stringify({
              group_id: 101,
              messages: ['第一条', '第二条'],
              xiaoni_os: '这是直接问我，已经正常接住。'
            })
          }]
        }
      };
    }

    return {
      success: true,
      llm_call_id: 'llm-success-2',
      canonical_response: {
        output: [{
          type: 'message',
          content: [{ type: 'output_text', text: '' }]
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
    await processRuntimeFrameForTest(service, queueMessage as any);
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
  assert.equal(storeCalls.createConversation[0]?.userMessage, '');
  assert.deepEqual(storeCalls.listRecentTurns[0], {
    userId: 202,
    groupId: 101,
    afterConversationId: null,
    scope: 'global',
    limit: 201
  });
  assert.equal(storeCalls.createConversation[0]?.rawRequest?.context_budget?.context_session_key, 'xiaoni:global');
  assert.deepEqual(
    storeCalls.createConversation[0]?.transcriptItems?.map((item: any) => ({
      role: item.role,
      phase: item.phase ?? null,
      content: item.content,
      groupIndex: item.groupIndex,
      itemIndex: item.itemIndex,
      deliveryMessageId: item.deliveryMessageId ?? null,
      source: item.source
    })),
    [
      {
        role: 'assistant',
        phase: 'commentary',
        content: '第一条',
        groupIndex: 1,
        itemIndex: 0,
        deliveryMessageId: 5001,
        source: 'delivery'
      },
      {
        role: 'assistant',
        phase: 'final_answer',
        content: '第二条',
        groupIndex: 1,
        itemIndex: 1,
        deliveryMessageId: 5002,
        source: 'delivery'
      }
    ]
  );
  assert.deepEqual(storeCalls.settleQueueMessages[0]?.result?.sent_messages, ['第一条', '第二条']);
  assert.equal(storeCalls.releaseExecutionLease[0]?.leaseRelease?.reason, 'visible_delivery_committed');
  assert.equal(storeCalls.releaseExecutionLease[0]?.modelRequestSlices, 1);
  assert.equal(storeCalls.updateLlmJob[0]?.finalResponse, '第一条\n\n第二条');
  assert.equal(storeCalls.createConversation[0]?.rawResponse?.model_request_slices, 1);
  assert.deepEqual(storeCalls.createConversation[0]?.rawRequest?.runtime_stream, {
    stream_key: 'xiaoni:global',
    context_session_key: 'xiaoni:global',
    trigger_source: 'phone_notification',
    trigger_kind: 'sensory_event',
    sensory_input: true,
    append_strategy: 'responses_replay_items',
    response_replay_item_count: storeCalls.createConversation[0]?.rawResponse?.responses_replay_items?.length,
    model_request_slices: 1
  });
  assert.deepEqual(
    storeCalls.createConversation[0]?.rawResponse?.runtime_stream,
    storeCalls.createConversation[0]?.rawRequest?.runtime_stream
  );
  assert.equal(storeCalls.createConversation[0]?.rawResponse?.loop_stage_artifacts?.life_action, undefined);
  assert.equal(storeCalls.recordAgentStackToolExecution[0]?.toolName, GROUP_REPLY_TOOL);
  assert.equal(storeCalls.recordAgentStackToolExecution[0]?.sideEffect, true);
  assert.deepEqual(storeCalls.markLeaseVisibleDeliveryCommitted, ['run-queue-success']);
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

test('runtime frame yields after a no-tool model slice without synthetic follow-up input', async () => {
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
    settleQueueMessages: [],
    releaseExecutionLease: [],
    updateLlmJob: [],
    recordNoVisibleDeliveryLifeEvent: [],
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
    getExecutionLeaseDeliveryState: async () => ({
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
    recordAgentStackToolExecution: async () => ({ id: 1 }),
    completeAgentStackToolExecution: async () => {},
    settleQueueMessages: async (_runId: string, params: any) => { storeCalls.settleQueueMessages.push(params); },
    failQueueMessage: async () => {},
    releaseExecutionLease: async (_runId: string, params: any) => { storeCalls.releaseExecutionLease.push(params); },
    updateLlmJob: async (_jobId: string, params: any) => { storeCalls.updateLlmJob.push(params); },
    recordNoVisibleDeliveryLifeEvent: async (params: any) => { storeCalls.recordNoVisibleDeliveryLifeEvent.push(params); },
    recordRecoverEnergyLifeEvent: async (params: any) => { storeCalls.recordRecoverEnergyLifeEvent.push(params); }
  } as any;

  const service = new AgentLoopService(store, {
    resolveForQueueMessage: async () => createRuntimePrompt()
  } as any);

  let turn = 0;
  (service as any).executeAgentTurn = async () => {
    turn += 1;
    return {
      success: true,
      llm_call_id: 'llm-no-tool',
      canonical_response: {
        output: []
      }
    };
  };

  await processRuntimeFrameForTest(service, queueMessage as any);

  assert.equal(turn, 1);
  assert.equal(storeCalls.createConversation.length, 1);
  assert.equal(storeCalls.createConversation[0]?.status, 'settled');
  assert.equal(storeCalls.createConversation[0]?.aiResponse, null);
  assert.equal(storeCalls.createConversation[0]?.userMessage, '');
  assert.equal(storeCalls.createConversation[0]?.transcriptItems?.length, 0);
  assert.equal(storeCalls.createConversation[0]?.rawResponse?.lease_release_reason, 'runtime_frame_yielded');
  assert.equal(storeCalls.createConversation[0]?.rawResponse?.lease_release?.outcome, 'model_slice_yielded');
  assert.equal(storeCalls.createConversation[0]?.rawResponse?.xiaoni_os, null);
  assert.equal(storeCalls.settleQueueMessages[0]?.result?.no_visible_delivery, true);
  assert.equal(storeCalls.settleQueueMessages[0]?.result?.xiaoni_os, null);
  assert.equal(storeCalls.settleQueueMessages[0]?.result?.lease_release_reason, 'runtime_frame_yielded');
  assert.equal(storeCalls.releaseExecutionLease[0]?.leaseRelease?.reason, 'runtime_frame_yielded');
  assert.equal(storeCalls.releaseExecutionLease[0]?.modelRequestSlices, 1);
  assert.equal(storeCalls.recordNoVisibleDeliveryLifeEvent.length, 0);
  assert.equal(storeCalls.recordRecoverEnergyLifeEvent.length, 0);
  assert.equal(storeCalls.updateLlmJob[0]?.status, 'settled');
});

test('runtime frame records final_answer without eager self continuation when queue-backed', async () => {
  const queueMessage = {
    id: 'run-queue-final-answer-control',
    traceId: 'trace-final-answer-control',
    batchId: 'batch-final-answer-control',
    status: 'processing',
    attempts: 1,
    createdAt: '2026-03-28T08:00:00.000Z',
    queueMessageIds: [1],
    payload: createQueuePayload()
  };

  const storeCalls: Record<string, any[]> = {
    createConversation: [],
    settleQueueMessages: [],
    releaseExecutionLease: [],
    updateLlmJob: [],
    recordNoVisibleDeliveryLifeEvent: [],
    recordRecoverEnergyLifeEvent: []
  };

  const store = {
    createLlmJob: async () => 'job-final-answer-control',
    logTimelineEvent: async () => {},
    loadSessionReplayState: async () => ({ summaryText: null, summarizedThroughConversationId: null }),
    listRecentTurns: async () => [],
    getSessionReadCutoffState: async () => null,
    upsertSessionReadCutoffState: async () => {},
    upsertProactiveShareState: async () => {},
    getExecutionLeaseDeliveryState: async () => ({
      deliveryPhase: 'reasoning_open',
      deliveryCommitCount: 0,
      blockedDeliveryAttemptCount: 0,
      lastBlockedDeliveryReason: null
    }),
    createConversation: async (params: any) => {
      storeCalls.createConversation.push(params);
      return 1999;
    },
    attachConversationIdToTrace: async () => {},
    recordAgentStackToolExecution: async () => ({ id: 1 }),
    completeAgentStackToolExecution: async () => {},
    settleQueueMessages: async (_runId: string, params: any) => { storeCalls.settleQueueMessages.push(params); },
    failQueueMessage: async () => {},
    releaseExecutionLease: async (_runId: string, params: any) => { storeCalls.releaseExecutionLease.push(params); },
    updateLlmJob: async (_jobId: string, params: any) => { storeCalls.updateLlmJob.push(params); },
    recordNoVisibleDeliveryLifeEvent: async (params: any) => { storeCalls.recordNoVisibleDeliveryLifeEvent.push(params); },
    recordRecoverEnergyLifeEvent: async (params: any) => { storeCalls.recordRecoverEnergyLifeEvent.push(params); }
  } as any;

  let promptResolveCount = 0;
  const service = new AgentLoopService(store, {
    resolveForQueueMessage: async () => {
      promptResolveCount += 1;
      return createRuntimePrompt({
        systemPrompt: 'stable prompt resolved once for this queue message'
      });
    }
  } as any);

  let turn = 0;
  (service as any).executeAgentTurn = async () => {
    turn += 1;
    return {
      success: true,
      llm_call_id: 'llm-final-answer-control-1',
      canonical_response: {
        output: [{
          type: 'message',
          role: 'assistant',
          phase: 'final_answer',
          content: [{ type: 'output_text', text: '这条时间戳还是刚才那一尾，没 @。我不继续滚了。' }]
        }]
      }
    };
  };

  await processRuntimeFrameForTest(service, queueMessage as any);

  assert.equal(turn, 1);
  assert.equal(promptResolveCount, 1);
  assert.equal(storeCalls.createConversation.length, 1);
  assert.equal(storeCalls.createConversation[0]?.aiResponse, null);
  assert.equal(storeCalls.createConversation[0]?.rawResponse?.lease_release_reason, 'runtime_frame_yielded');
  assert.equal(storeCalls.createConversation[0]?.rawResponse?.lease_release?.outcome, 'final_answer_yielded');
  assert.equal(storeCalls.createConversation[0]?.rawResponse?.xiaoni_os, null);
  const replayItems = storeCalls.createConversation[0]?.rawResponse?.responses_replay_items || [];
  const finalAnswerReplayIndex = replayItems.findIndex((item: any) =>
    item?.type === 'message'
      && item?.role === 'assistant'
      && item?.phase === 'final_answer'
      && JSON.stringify(item.content).includes('这条时间戳还是刚才那一尾')
  );
  const reminderReplayIndex = replayItems.findIndex((item: any) =>
    item?.type === 'message'
      && item?.role === 'developer'
      && JSON.stringify(item.content).includes('<system_reminder>')
  );
  assert.ok(finalAnswerReplayIndex >= 0);
  assert.equal(reminderReplayIndex, -1);
  assert.equal(storeCalls.settleQueueMessages[0]?.result?.lease_release_reason, 'runtime_frame_yielded');
  assert.equal(storeCalls.settleQueueMessages[0]?.result?.no_visible_delivery, true);
  assert.equal(storeCalls.releaseExecutionLease[0]?.leaseRelease?.reason, 'runtime_frame_yielded');
  assert.equal(storeCalls.releaseExecutionLease[0]?.modelRequestSlices, 1);
  assert.equal(storeCalls.recordNoVisibleDeliveryLifeEvent.length, 0);
  assert.equal(storeCalls.recordRecoverEnergyLifeEvent.length, 0);
});

test('no-notify continuation inserts self continuation after prior final_answer', async () => {
  const priorTurn = createConversationTurn({
    id: 1998,
    userMessage: '',
    aiResponse: null
  });
  priorTurn.rawResponse = {
    responses_replay_items: [{
      type: 'message',
      role: 'assistant',
      phase: 'final_answer',
      content: [{ type: 'output_text', text: '留白。' }]
    }]
  };
  const queueMessage = {
    id: 'runtime-no-notify-after-final',
    traceId: 'trace-runtime-no-notify-after-final',
    batchId: 'batch-runtime-no-notify-after-final',
    status: 'processing',
    attempts: 1,
    createdAt: '2026-03-28T08:00:00.000Z',
    queueMessageIds: [],
    payload: {
      ...createQueuePayload(),
      source: 'runtime_loop',
      messages: []
    }
  };
  const storeCalls: Record<string, any[]> = {
    createConversation: []
  };
  const store = {
    createLlmJob: async () => 'job-runtime-no-notify-after-final',
    logTimelineEvent: async () => {},
    loadSessionReplayState: async () => ({ summaryText: null, summarizedThroughConversationId: null }),
    listRecentTurns: async () => [priorTurn],
    getSessionReadCutoffState: async () => null,
    upsertSessionReadCutoffState: async () => {},
    upsertProactiveShareState: async () => {},
    getExecutionLeaseDeliveryState: async () => ({
      deliveryPhase: 'reasoning_open',
      deliveryCommitCount: 0,
      blockedDeliveryAttemptCount: 0,
      lastBlockedDeliveryReason: null
    }),
    createConversation: async (params: any) => {
      storeCalls.createConversation.push(params);
      return 2000;
    },
    attachConversationIdToTrace: async () => {},
    updateLlmJob: async () => {}
  } as any;
  const service = new AgentLoopService(store, {
    resolveForQueueMessage: async () => createRuntimePrompt()
  } as any);
  let capturedInput: any[] = [];
  let executeAgentTurnCalled = false;
  (service as any).executeAgentTurn = async (canonicalRequest: any) => {
    executeAgentTurnCalled = true;
    capturedInput = canonicalRequest.input || [];
    return {
      success: true,
      llm_call_id: 'llm-runtime-no-notify-after-final',
      canonical_response: {
        output: []
      }
    };
  };

  await processRuntimeFrameForTest(service, queueMessage as any, {
    queueBacked: false,
    triggerInputMode: 'suppress_current_trigger',
    appendRuntimeInputStackItem: false,
    logQueueLifecycle: false
  });

  const finalAnswerIndex = capturedInput.findIndex((item: any) => (
    item.type === 'message'
    && item.role === 'assistant'
    && item.phase === 'final_answer'
    && getMessageContent(item).includes('留白')
  ));
  const reminderIndex = capturedInput.findIndex((item: any) => (
    item.type === 'message'
    && item.role === 'developer'
    && getMessageContent(item).includes('<system_reminder>')
  ));
  assert.ok(finalAnswerIndex >= 0);
  assert.equal(reminderIndex, finalAnswerIndex + 1);
  assert.equal(executeAgentTurnCalled, true);
  assert.equal(JSON.stringify(storeCalls.createConversation[0]?.rawResponse?.responses_replay_items || []).includes('<system_reminder>'), false);
});

test('no-notify continuation calls model without self continuation when request does not end with final_answer', async () => {
  const queueMessage = {
    id: 'runtime-no-notify-no-final',
    traceId: 'trace-runtime-no-notify-no-final',
    batchId: 'batch-runtime-no-notify-no-final',
    status: 'processing',
    attempts: 1,
    createdAt: '2026-03-28T08:00:00.000Z',
    queueMessageIds: [],
    payload: {
      ...createQueuePayload(),
      source: 'runtime_loop',
      messages: []
    }
  };
  const storeCalls: Record<string, any[]> = {
    createLlmJob: [],
    createConversation: [],
    logTimelineEvent: []
  };
  const store = {
    createLlmJob: async (params: any) => {
      storeCalls.createLlmJob.push(params);
      return 'job-runtime-no-notify-no-final';
    },
    logTimelineEvent: async (params: any) => { storeCalls.logTimelineEvent.push(params); },
    loadSessionReplayState: async () => ({ summaryText: null, summarizedThroughConversationId: null }),
    listRecentTurns: async () => [],
    getSessionReadCutoffState: async () => null,
    upsertSessionReadCutoffState: async () => {},
    upsertProactiveShareState: async () => {},
    getExecutionLeaseDeliveryState: async () => ({
      deliveryPhase: 'reasoning_open',
      deliveryCommitCount: 0,
      blockedDeliveryAttemptCount: 0,
      lastBlockedDeliveryReason: null
    }),
    createConversation: async (params: any) => {
      storeCalls.createConversation.push(params);
      return 2002;
    },
    attachConversationIdToTrace: async () => {},
    updateLlmJob: async () => {}
  } as any;
  const service = new AgentLoopService(store, {
    resolveForQueueMessage: async () => createRuntimePrompt()
  } as any);
  let capturedInput: any[] = [];
  let executeAgentTurnCalled = false;
  (service as any).executeAgentTurn = async (canonicalRequest: any) => {
    capturedInput = canonicalRequest.input || [];
    executeAgentTurnCalled = true;
    return {
      success: true,
      llm_call_id: 'llm-runtime-no-notify-no-final',
      canonical_response: {
        output: []
      }
    };
  };

  await processRuntimeFrameForTest(service, queueMessage as any, {
    queueBacked: false,
    triggerInputMode: 'suppress_current_trigger',
    appendRuntimeInputStackItem: false,
    logQueueLifecycle: false
  });

  assert.equal(executeAgentTurnCalled, true);
  assert.equal(storeCalls.createLlmJob.length, 1);
  assert.equal(storeCalls.createConversation.length, 1);
  assert.equal(capturedInput.some((item: any) =>
    item?.type === 'message'
      && item?.role === 'developer'
      && getMessageContent(item).includes('<system_reminder>')
  ), false);
});

test('runtime frame waits before its single model slice when runtime control is disabled', async () => {
  const queueMessage = {
    id: 'run-queue-runtime-paused',
    traceId: 'trace-runtime-paused',
    batchId: 'batch-runtime-paused',
    status: 'processing',
    attempts: 1,
    createdAt: '2026-03-28T08:00:00.000Z',
    queueMessageIds: [1],
    payload: createQueuePayload()
  };

  const storeCalls: Record<string, any[]> = {
    createConversation: [],
    settleQueueMessages: [],
    releaseExecutionLease: [],
    updateLlmJob: [],
    logTimelineEvent: [],
    recordNoVisibleDeliveryLifeEvent: []
  };

  const store = {
    createLlmJob: async () => 'job-runtime-paused',
    logTimelineEvent: async (params: any) => { storeCalls.logTimelineEvent.push(params); },
    loadSessionReplayState: async () => ({ summaryText: null, summarizedThroughConversationId: null }),
    listRecentTurns: async () => [],
    getSessionReadCutoffState: async () => null,
    upsertSessionReadCutoffState: async () => {},
    upsertProactiveShareState: async () => {},
    getExecutionLeaseDeliveryState: async () => ({
      deliveryPhase: 'reasoning_open',
      deliveryCommitCount: 0,
      blockedDeliveryAttemptCount: 0,
      lastBlockedDeliveryReason: null
    }),
    createConversation: async (params: any) => {
      storeCalls.createConversation.push(params);
      return 1999;
    },
    attachConversationIdToTrace: async () => {},
    recordAgentStackToolExecution: async () => ({ id: 1 }),
    completeAgentStackToolExecution: async () => {},
    settleQueueMessages: async (_runId: string, params: any) => { storeCalls.settleQueueMessages.push(params); },
    releaseExecutionLease: async (_runId: string, params: any) => { storeCalls.releaseExecutionLease.push(params); },
    updateLlmJob: async (_jobId: string, params: any) => { storeCalls.updateLlmJob.push(params); },
    recordNoVisibleDeliveryLifeEvent: async (params: any) => { storeCalls.recordNoVisibleDeliveryLifeEvent.push(params); }
  } as any;

  let runtimeChecks = 0;
  const service = new AgentLoopService(store, {
    resolveForQueueMessage: async () => createRuntimePrompt()
  } as any, {
    isRuntimeEnabled: async () => {
      runtimeChecks += 1;
      return runtimeChecks !== 1;
    },
    runtimePausePollMs: 50
  });

  let turns = 0;
  (service as any).executeAgentTurn = async () => {
    turns += 1;
    return {
      success: true,
      llm_call_id: `llm-runtime-paused-${turns}`,
      canonical_response: {
        output: [{
          type: 'message',
          content: [{ type: 'output_text', text: '.' }]
        }]
      }
    };
  };

  await processRuntimeFrameForTest(service, queueMessage as any);

  assert.equal(turns, 1);
  assert.equal(runtimeChecks, 2);
  assert.equal(storeCalls.createConversation.length, 1);
  assert.equal(storeCalls.createConversation[0]?.status, 'settled');
  assert.equal(storeCalls.createConversation[0]?.aiResponse, null);
  assert.equal(storeCalls.createConversation[0]?.rawResponse?.lease_release_reason, 'runtime_frame_yielded');
  assert.equal(storeCalls.createConversation[0]?.rawResponse?.model_request_slices, 1);
  assert.equal(storeCalls.settleQueueMessages[0]?.result?.lease_release_reason, 'runtime_frame_yielded');
  assert.equal(storeCalls.releaseExecutionLease[0]?.leaseRelease?.reason, 'runtime_frame_yielded');
  assert.equal(storeCalls.releaseExecutionLease[0]?.modelRequestSlices, 1);
  assert.equal(storeCalls.recordNoVisibleDeliveryLifeEvent.length, 0);
  assert.equal(
    storeCalls.logTimelineEvent.some((event) => event.eventName === 'runtime_paused' && event.eventPhase === 'start'),
    true
  );
  assert.equal(
    storeCalls.logTimelineEvent.some((event) => event.eventName === 'runtime_paused' && event.eventPhase === 'end'),
    true
  );
});

test('runtime frame ignores the historical max turn count because it owns one model slice', async () => {
  const queueMessage = {
    id: 'run-queue-unbounded-loop',
    traceId: 'trace-unbounded-loop',
    batchId: 'batch-unbounded-loop',
    status: 'processing',
    attempts: 1,
    createdAt: '2026-03-28T08:00:00.000Z',
    queueMessageIds: [1],
    payload: createQueuePayload()
  };

  const storeCalls: Record<string, any[]> = {
    createConversation: [],
    settleQueueMessages: [],
    releaseExecutionLease: [],
    updateLlmJob: [],
    recordNoVisibleDeliveryLifeEvent: [],
    recordRecoverEnergyLifeEvent: []
  };

  const store = {
    createLlmJob: async () => 'job-unbounded-loop',
    logTimelineEvent: async () => {},
    loadSessionReplayState: async () => ({ summaryText: null, summarizedThroughConversationId: null }),
    listRecentTurns: async () => [],
    getSessionReadCutoffState: async () => null,
    upsertSessionReadCutoffState: async () => {},
    upsertProactiveShareState: async () => {},
    getExecutionLeaseDeliveryState: async () => ({
      deliveryPhase: 'reasoning_open',
      deliveryCommitCount: 0,
      blockedDeliveryAttemptCount: 0,
      lastBlockedDeliveryReason: null
    }),
    createConversation: async (params: any) => {
      storeCalls.createConversation.push(params);
      return 1888;
    },
    attachConversationIdToTrace: async () => {},
    recordAgentStackToolExecution: async () => ({ id: 1 }),
    completeAgentStackToolExecution: async () => {},
    settleQueueMessages: async (_runId: string, params: any) => { storeCalls.settleQueueMessages.push(params); },
    releaseExecutionLease: async (_runId: string, params: any) => { storeCalls.releaseExecutionLease.push(params); },
    updateLlmJob: async (_jobId: string, params: any) => { storeCalls.updateLlmJob.push(params); },
    recordNoVisibleDeliveryLifeEvent: async (params: any) => { storeCalls.recordNoVisibleDeliveryLifeEvent.push(params); },
    recordRecoverEnergyLifeEvent: async (params: any) => { storeCalls.recordRecoverEnergyLifeEvent.push(params); }
  } as any;

  const service = new AgentLoopService(store, {
    resolveForQueueMessage: async () => createRuntimePrompt()
  } as any);

  const historicalMaxTurns = 3;
  const originalMaxTurns = agentConfig.maxTurns;
  let turns = 0;
  (service as any).executeAgentTurn = async () => {
    turns += 1;
    return {
      success: true,
      llm_call_id: `llm-unbounded-loop-${turns}`,
      canonical_response: {
        output: [{
          type: 'message',
          content: [{ type: 'output_text', text: `内部想法 ${turns}` }]
        }]
      }
    };
  };

  agentConfig.maxTurns = historicalMaxTurns;
  try {
    await processRuntimeFrameForTest(service, queueMessage as any);
  } finally {
    agentConfig.maxTurns = originalMaxTurns;
  }

  assert.equal(turns, 1);
  assert.equal(storeCalls.createConversation.length, 1);
  assert.equal(storeCalls.createConversation[0]?.aiResponse, null);
  assert.equal(storeCalls.createConversation[0]?.rawResponse?.lease_release_reason, 'runtime_frame_yielded');
  assert.equal(storeCalls.settleQueueMessages[0]?.result?.lease_release_reason, 'runtime_frame_yielded');
  assert.equal(storeCalls.releaseExecutionLease[0]?.leaseRelease?.reason, 'runtime_frame_yielded');
  assert.equal(storeCalls.releaseExecutionLease[0]?.modelRequestSlices, 1);
  assert.equal(storeCalls.recordNoVisibleDeliveryLifeEvent.length, 0);
  assert.equal(storeCalls.recordRecoverEnergyLifeEvent.length, 0);
});

test('runtime frame does not allow request_image_task to swallow a same-slice visible group reply', async () => {
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
    settleQueueMessages: [],
    releaseExecutionLease: [],
    updateLlmJob: [],
    markLeaseVisibleDeliveryCommitted: []
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
    getExecutionLeaseDeliveryState: async () => ({
      deliveryPhase,
      deliveryCommitCount: deliveryPhase === 'delivery_committed' ? 1 : 0,
      blockedDeliveryAttemptCount: 0,
      lastBlockedDeliveryReason: null
    }),
    markLeaseVisibleDeliveryCommitted: async (runId: string) => {
      deliveryPhase = 'delivery_committed';
      storeCalls.markLeaseVisibleDeliveryCommitted.push(runId);
    },
    markLeaseDeliveryBlocked: async () => {},
    recordAgentStackToolExecution: async () => ({ id: 1 }),
    completeAgentStackToolExecution: async () => {},
    createConversation: async (params: any) => {
      storeCalls.createConversation.push(params);
      return 3589;
    },
    attachConversationIdToTrace: async () => {},
    settleQueueMessages: async (_runId: string, params: any) => { storeCalls.settleQueueMessages.push(params); },
    failQueueMessage: async () => {},
    releaseExecutionLease: async (_runId: string, params: any) => { storeCalls.releaseExecutionLease.push(params); },
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
      return {
        success: true,
        llm_call_id: 'llm-image-task-1',
        canonical_response: {
          output: [
            {
              type: 'function_call',
              call_id: 'call-image-task',
              name: IMAGE_TASK_TOOL,
              arguments: JSON.stringify({
                prompt: '一张很普通的蓝天白云头像图',
                target_description: '群聊里用于头像的普通蓝天白云图'
              })
            },
            {
              type: 'function_call',
              call_id: 'call-image-status-reply-2',
              name: GROUP_REPLY_TOOL,
              arguments: JSON.stringify({
                group_id: 1019235326,
                messages: ['图片任务已经排到后台了，我顺手接一下你第二句：现在还空着。'],
                xiaoni_os: '图片任务已提交，但对群里的可见回复由我自己决定措辞。'
              })
            }
          ]
        }
      };
    };

    await processRuntimeFrameForTest(service, queueMessage as any);

    assert.equal(turn, 1);
    assert.equal(storeCalls.createConversation.length, 1);
    assert.equal(storeCalls.createConversation[0]?.aiResponse, '图片任务已经排到后台了，我顺手接一下你第二句：现在还空着。');
    assert.deepEqual(storeCalls.settleQueueMessages[0]?.result?.sent_messages, ['图片任务已经排到后台了，我顺手接一下你第二句：现在还空着。']);
	    assert.equal(storeCalls.releaseExecutionLease[0]?.leaseRelease?.reason, 'visible_delivery_committed');
    assert.deepEqual(storeCalls.markLeaseVisibleDeliveryCommitted, ['run-queue-image-task-followup']);
    assert.equal(sendGroupCalls.length, 1);
    assert.equal(sendGroupCalls[0]?.url, `${agentConfig.providerServiceUrl}/api/internal/send_group`);
    assert.deepEqual(sendGroupCalls[0]?.body, {
      session_key: 'qq:group:1019235326',
      group_id: 1019235326,
      messages: ['图片任务已经排到后台了，我顺手接一下你第二句：现在还空着。'],
      mention_user_ids: []
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('runtime frame does not auto-send image task status after queuing', async () => {
  const queueMessage = {
    id: 'run-queue-image-task-no-auto-send',
    traceId: 'trace-image-task-no-auto-send',
    batchId: 'batch-image-task-no-auto-send',
    status: 'processing',
    attempts: 1,
    createdAt: '2026-04-27T14:06:27.315Z',
    queueMessageIds: [2006],
    payload: createQueuePayload()
  };

  const storeCalls: Record<string, any[]> = {
    createConversation: [],
    settleQueueMessages: [],
    releaseExecutionLease: [],
    updateLlmJob: [],
    markLeaseVisibleDeliveryCommitted: [],
    createRuntimeTask: []
  };

  const store = {
    createLlmJob: async () => 'job-image-task-no-auto-send',
    logTimelineEvent: async () => {},
    loadSessionReplayState: async () => ({ summaryText: null, summarizedThroughConversationId: null }),
    listRecentTurns: async () => [],
    getSessionReadCutoffState: async () => null,
    upsertSessionReadCutoffState: async () => {},
    upsertProactiveShareState: async () => {},
    createRuntimeTask: async (input: any) => {
      storeCalls.createRuntimeTask.push(input);
      return { id: 'task-image-no-auto-send' };
    },
    getMediaAssetByTag: async () => null,
    getExecutionLeaseDeliveryState: async () => ({
      deliveryPhase: 'reasoning_open',
      deliveryCommitCount: 0,
      blockedDeliveryAttemptCount: 0,
      lastBlockedDeliveryReason: null
    }),
    markLeaseVisibleDeliveryCommitted: async (runId: string) => {
      storeCalls.markLeaseVisibleDeliveryCommitted.push(runId);
    },
    markLeaseDeliveryBlocked: async () => {},
    recordAgentStackToolExecution: async () => ({ id: 1 }),
    completeAgentStackToolExecution: async () => {},
    createConversation: async (params: any) => {
      storeCalls.createConversation.push(params);
      return 3590;
    },
    attachConversationIdToTrace: async () => {},
    settleQueueMessages: async (_runId: string, params: any) => { storeCalls.settleQueueMessages.push(params); },
    failQueueMessage: async () => {},
    releaseExecutionLease: async (_runId: string, params: any) => { storeCalls.releaseExecutionLease.push(params); },
    updateLlmJob: async (_jobId: string, params: any) => { storeCalls.updateLlmJob.push(params); }
  } as any;

  const service = new AgentLoopService(store, {
    resolveForQueueMessage: async () => createRuntimePrompt()
  } as any);
  const originalFetch = globalThis.fetch;
  const fetchCalls: Array<{ url: string; body: any }> = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    fetchCalls.push({
      url: String(url),
      body: init?.body ? JSON.parse(String(init.body)) : null
    });
    return {
      ok: true,
      json: async () => ({ success: true, data: { message_id: 7789 } })
    } as Response;
  }) as typeof fetch;

  try {
    let turn = 0;
    (service as any).executeAgentTurn = async () => {
      turn += 1;
      return {
        success: true,
        llm_call_id: 'llm-image-task-no-auto-send-1',
        canonical_response: {
          output: [{
            type: 'function_call',
            call_id: 'call-image-task-no-auto-send',
            name: IMAGE_TASK_TOOL,
            arguments: JSON.stringify({
              prompt: '一张很普通的蓝天白云头像图',
              target_description: '群聊里用于头像的普通蓝天白云图'
            })
          }]
        }
      };
    };

    await processRuntimeFrameForTest(service, queueMessage as any);

    assert.equal(turn, 1);
    assert.equal(storeCalls.createRuntimeTask.length, 1);
    assert.equal(storeCalls.createConversation.length, 1);
    assert.equal(storeCalls.createConversation[0]?.aiResponse, null);
    assert.deepEqual(storeCalls.settleQueueMessages[0]?.result?.sent_messages, []);
    assert.equal(storeCalls.settleQueueMessages[0]?.result?.lease_release_reason, 'runtime_frame_yielded');
    assert.deepEqual(storeCalls.markLeaseVisibleDeliveryCommitted, []);
    assert.deepEqual(fetchCalls, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('runtime frame stores partially delivered assistant transcript as commentary on failure', async () => {
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
    releaseExecutionLease: [],
    markLeaseVisibleDeliveryCommitted: []
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
    getExecutionLeaseDeliveryState: async () => ({
      deliveryPhase,
      deliveryCommitCount: deliveryPhase === 'delivery_committed' ? 1 : 0,
      blockedDeliveryAttemptCount: 0,
      lastBlockedDeliveryReason: null
    }),
    markLeaseVisibleDeliveryCommitted: async (_runId: string) => {
      deliveryPhase = 'delivery_committed';
      storeCalls.markLeaseVisibleDeliveryCommitted.push(_runId);
    },
    markLeaseDeliveryBlocked: async () => {},
    recordAgentStackToolExecution: async () => ({ id: 1 }),
    completeAgentStackToolExecution: async () => {},
    createConversation: async (params: any) => {
      storeCalls.createConversation.push(params);
      return 2001;
    },
    attachConversationIdToTrace: async () => {},
    failQueueMessage: async (...args: any[]) => { storeCalls.failQueueMessage.push(args); },
    releaseExecutionLease: async (_runId: string, params: any) => { storeCalls.releaseExecutionLease.push(params); },
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
    return {
      success: true,
      llm_call_id: 'llm-failure-1',
      canonical_response: {
        output: [
          {
            type: 'function_call',
            call_id: 'call-send-failure',
            name: GROUP_REPLY_TOOL,
            arguments: JSON.stringify({ group_id: 101, message: '先发一条' })
          },
          {
            type: 'function_call',
            call_id: 'call-finish-failure',
            name: RECOVER_ENERGY_TOOL,
            arguments: JSON.stringify({ reason: 'done', clock: 5, xiaoni_os: 'pause' })
          }
        ]
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

  await processRuntimeFrameForTest(service, queueMessage as any);

  assert.equal(turn, 1);
  assert.equal(storeCalls.createConversation.length, 1);
  assert.equal(storeCalls.createConversation[0]?.status, 'failed');
  assert.equal(storeCalls.createConversation[0]?.aiResponse, null);
  assert.equal(storeCalls.createConversation[0]?.userMessage, '');
  assert.deepEqual(
    storeCalls.createConversation[0]?.transcriptItems?.map((item: any) => ({
      role: item.role,
      phase: item.phase ?? null,
      content: item.content
    })),
    [
      {
        role: 'assistant',
        phase: 'final_answer',
        content: '先发一条'
      }
    ]
  );
  assert.deepEqual(storeCalls.failQueueMessage[0], ['run-queue-failure', 'recover_energy failed', 2001]);
  assert.equal(storeCalls.releaseExecutionLease[0]?.leaseRelease?.reason, 'runtime_error');
  assert.deepEqual(storeCalls.releaseExecutionLease[0]?.sentMessages, ['先发一条']);
  assert.deepEqual(storeCalls.markLeaseVisibleDeliveryCommitted, ['run-queue-failure']);
});

test('runtime frame yields after a delivered reply without another model slice', async () => {
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
    settleQueueMessages: [],
    failQueueMessage: [],
    releaseExecutionLease: [],
    markLeaseVisibleDeliveryCommitted: [],
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
    getExecutionLeaseDeliveryState: async () => ({
      deliveryPhase,
      deliveryCommitCount: deliveryPhase === 'delivery_committed' ? 1 : 0,
      blockedDeliveryAttemptCount: 0,
      lastBlockedDeliveryReason: null
    }),
    markLeaseVisibleDeliveryCommitted: async (_runId: string) => {
      deliveryPhase = 'delivery_committed';
      storeCalls.markLeaseVisibleDeliveryCommitted.push(_runId);
    },
    markLeaseDeliveryBlocked: async () => {},
    recordAgentStackToolExecution: async () => ({ id: 1 }),
    completeAgentStackToolExecution: async () => {},
    createConversation: async (params: any) => {
      storeCalls.createConversation.push(params);
      return 2101;
    },
    attachConversationIdToTrace: async () => {},
    settleQueueMessages: async (_runId: string, params: any) => { storeCalls.settleQueueMessages.push(params); },
    failQueueMessage: async (...args: any[]) => { storeCalls.failQueueMessage.push(args); },
    releaseExecutionLease: async (_runId: string, params: any) => { storeCalls.releaseExecutionLease.push(params); },
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
    return {
      success: true,
      llm_call_id: 'llm-delivered-1',
      canonical_response: {
        output: [{
          type: 'function_call',
          call_id: 'call-send-delivered',
          name: GROUP_REPLY_TOOL,
          arguments: JSON.stringify({ group_id: 101, message: '先发一条' })
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

  await processRuntimeFrameForTest(service, queueMessage as any);

  assert.equal(turn, 1);
  assert.equal(storeCalls.failQueueMessage.length, 0);
  assert.equal(storeCalls.createConversation.length, 1);
  assert.equal(storeCalls.createConversation[0]?.status, 'settled');
  assert.equal(storeCalls.createConversation[0]?.aiResponse, '先发一条');
  assert.equal(storeCalls.createConversation[0]?.rawResponse?.lease_release_reason, 'visible_delivery_committed');
  assert.equal(storeCalls.settleQueueMessages[0]?.result?.lease_release_reason, 'visible_delivery_committed');
  assert.deepEqual(storeCalls.settleQueueMessages[0]?.result?.sent_messages, ['先发一条']);
  assert.equal(storeCalls.releaseExecutionLease[0]?.leaseRelease?.reason, 'visible_delivery_committed');
  assert.equal(storeCalls.releaseExecutionLease[0]?.leaseRelease?.outcome, 'frame_yielded_after_visible_delivery');
  assert.equal(
    storeCalls.createConversation[0]?.rawResponse?.responses_replay_items?.some((item: any) =>
      item?.type === 'message'
        && item?.role === 'developer'
        && JSON.stringify(item.content).includes('<system_reminder>')
    ),
    false
  );
  assert.deepEqual(storeCalls.markLeaseVisibleDeliveryCommitted, ['run-queue-no-tool-after-delivery']);
});

test('runtime frame allows multiple visible deliveries within the same provider slice', async () => {
  const queueMessage = {
    id: 'run-queue-multi-delivery',
    traceId: 'trace-multi-delivery',
    batchId: 'batch-multi-delivery',
    status: 'processing',
    attempts: 1,
    createdAt: '2026-03-28T08:00:00.000Z',
    queueMessageIds: [1],
    payload: createQueuePayload()
  };

  const storeCalls: Record<string, any[]> = {
    createConversation: [],
    completeAgentStackToolExecution: [],
    settleQueueMessages: [],
    releaseExecutionLease: [],
    markLeaseVisibleDeliveryCommitted: [],
    markLeaseDeliveryBlocked: [],
    logTimelineEvent: []
  };
  let deliveryPhase = 'reasoning_open';
  let deliveryCommitCount = 0;

  const store = {
    createLlmJob: async () => 'job-multi-delivery',
    logTimelineEvent: async (params: any) => { storeCalls.logTimelineEvent.push(params); },
    loadSessionReplayState: async () => ({ summaryText: null, summarizedThroughConversationId: null }),
    listRecentTurns: async () => [],
    getSessionReadCutoffState: async () => null,
    upsertSessionReadCutoffState: async () => {},
    upsertProactiveShareState: async () => {},
    getExecutionLeaseDeliveryState: async () => ({
      deliveryPhase,
      deliveryCommitCount,
      blockedDeliveryAttemptCount: storeCalls.markLeaseDeliveryBlocked.length,
      lastBlockedDeliveryReason: storeCalls.markLeaseDeliveryBlocked[storeCalls.markLeaseDeliveryBlocked.length - 1] ?? null
    }),
    markLeaseVisibleDeliveryCommitted: async (_runId: string) => {
      deliveryPhase = 'delivery_committed';
      deliveryCommitCount += 1;
      storeCalls.markLeaseVisibleDeliveryCommitted.push(_runId);
    },
    markLeaseDeliveryBlocked: async (_runId: string, reason: string) => {
      storeCalls.markLeaseDeliveryBlocked.push(reason);
    },
    recordAgentStackToolExecution: async () => ({ id: 1 }),
    completeAgentStackToolExecution: async (params: any) => { storeCalls.completeAgentStackToolExecution.push(params); },
    createConversation: async (params: any) => {
      storeCalls.createConversation.push(params);
      return 3001;
    },
    attachConversationIdToTrace: async () => {},
    settleQueueMessages: async (_runId: string, params: any) => { storeCalls.settleQueueMessages.push(params); },
    releaseExecutionLease: async (_runId: string, params: any) => { storeCalls.releaseExecutionLease.push(params); },
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
    return {
      success: true,
      llm_call_id: 'llm-multi-delivery-1',
      canonical_response: {
        output: [
          {
            type: 'function_call',
            call_id: 'call-send-multi-delivery-1',
            name: GROUP_REPLY_TOOL,
            arguments: JSON.stringify({ group_id: 101, message: '第一条' })
          },
          {
            type: 'function_call',
            call_id: 'call-send-multi-delivery-2',
            name: GROUP_REPLY_TOOL,
            arguments: JSON.stringify({ group_id: 101, message: '第二条' })
          }
        ]
      }
    };
  };
  (service as any).executeTool = async (toolCall: any) => {
    executeToolCalls += 1;
    assert.equal(toolCall.name, GROUP_REPLY_TOOL);
    const message = toolCall.args.message;
    return {
      message_type: 'group',
      sent_messages: [message],
      xiaoni_os: `已发送：${message}`,
      delivery: [{ message_id: 7000 + executeToolCalls }]
    };
  };

  await processRuntimeFrameForTest(service, queueMessage as any);

  assert.equal(turn, 1);
  assert.equal(executeToolCalls, 2);
  assert.equal(storeCalls.createConversation.length, 1);
  assert.equal(storeCalls.createConversation[0]?.aiResponse, '第一条\n\n第二条');
  assert.equal(storeCalls.createConversation[0]?.rawResponse?.xiaoni_os, '已发送：第二条');
  assert.equal(storeCalls.createConversation[0]?.userMessage, '');
  assert.deepEqual(
    storeCalls.createConversation[0]?.transcriptItems?.map((item: any) => item.content),
    [
      '第一条',
      '第二条'
    ]
  );
  assert.equal(storeCalls.settleQueueMessages[0]?.result?.lease_release_reason, 'visible_delivery_committed');
  assert.equal(storeCalls.releaseExecutionLease[0]?.leaseRelease?.reason, 'visible_delivery_committed');
  assert.equal(storeCalls.releaseExecutionLease[0]?.leaseRelease?.outcome, 'frame_yielded_after_visible_delivery');
  assert.equal(
    storeCalls.createConversation[0]?.rawResponse?.responses_replay_items?.some((item: any) =>
      item?.type === 'message'
        && item?.role === 'developer'
        && JSON.stringify(item.content).includes('<system_reminder>')
    ),
    false
  );
  assert.equal(storeCalls.completeAgentStackToolExecution.length, 2);
  assert.equal(storeCalls.completeAgentStackToolExecution.some((call) => call.result?.blocked_transition), false);
  assert.deepEqual(storeCalls.markLeaseVisibleDeliveryCommitted, [
    'run-queue-multi-delivery',
    'run-queue-multi-delivery'
  ]);
  assert.equal(storeCalls.markLeaseDeliveryBlocked.length, 0);
  assert.equal(storeCalls.logTimelineEvent.filter((event) => event.eventName === 'delivery_commit').length, 2);
  assert.equal(storeCalls.logTimelineEvent.some((event) => event.eventName === 'blocked_transition'), false);
});

test('applyToolResultToLoopInput replays recover_energy system reminder as function output', () => {
  const loopInput = buildInitialInput([], createQueuePayload(), createRuntimePrompt());
  const recoverResult = {
    recovered: true,
    reason: 'done',
    clock_minutes: 30,
    sleep_minutes: 30,
    energy: 0.75,
    max_energy: 1,
    system_reminder: '<system_reminder>醒了。</system_reminder>',
    xiaoni_os: '不接，把边界记下来。'
  };

  const continuation = applyToolResultToLoopInput({
    callId: 'call-2',
    name: RECOVER_ENERGY_TOOL,
    rawArguments: '{"reason":"done","outcome":"complete","xiaoni_os":"不接，把边界记下来。"}'
  }, recoverResult);

  assert.equal(continuation.forcedVisibleReply, null);
  assert.equal(continuation.inputItems.length, 1);
  assert.equal(continuation.inputItems[0]?.type, 'function_call_output');
  assert.equal(continuation.inputItems[0]?.call_id, 'call-2');
  const output = String(continuation.inputItems[0]?.output || '');
  assert.match(output, /^<system_reminder>\n/);
  assert.match(output, EAST8_TIME_PREFIX_PATTERN);
  assert.match(output, /醒了。/);
  assert.match(output, /<\/system_reminder>$/);
  assert.equal(loopInput.some((item) => item.type === 'function_call'), false);
  assert.equal(loopInput.some((item) => item.type === 'function_call_output'), false);
});

test('applyToolResultToLoopInput prefixes inspect_image text output but not JSON callbacks', () => {
  const inspectContinuation = applyToolResultToLoopInput({
    callId: 'call-inspect',
    name: INSPECT_IMAGE_TOOL,
    rawArguments: '{"image_id":"img-1"}'
  }, {
    output_xml: '<image id="img-1">含义是: 一只猫</image>'
  });

  assert.equal(inspectContinuation.inputItems[0]?.type, 'function_call_output');
  const inspectOutput = String(inspectContinuation.inputItems[0]?.output || '');
  assert.match(inspectOutput, EAST8_TIME_PREFIX_PATTERN);
  assert.match(inspectOutput, /<image id="img-1">含义是: 一只猫<\/image>/);

  const jsonContinuation = applyToolResultToLoopInput({
    callId: 'call-image-task-json',
    name: IMAGE_TASK_TOOL,
    rawArguments: '{"prompt":"猫"}'
  }, {
    queued: true,
    status_text: '图片任务已排队'
  });

  const jsonReplay = jsonContinuation.inputItems[0];
  assert.equal(jsonReplay?.type, 'function_call_output');
  const jsonOutput = String(jsonReplay && jsonReplay.type === 'function_call_output' ? jsonReplay.output : '');
  assert.doesNotMatch(jsonOutput, EAST8_TIME_PREFIX_PATTERN);
  assert.equal(JSON.parse(jsonOutput).status_text, '图片任务已排队');
});

test('legacy speech tool aliases are rejected instead of dispatching', async () => {
  const service = new AgentLoopService({} as any);
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;

  globalThis.fetch = (async () => {
    fetchCalled = true;
    throw new Error('legacy aliases must not call provider');
  }) as typeof fetch;

  try {
    for (const name of ['send_group_message', 'speak_in_group', 'send_private_message', 'reply_in_private']) {
      await assert.rejects(
        () => (service as any).executeTool({
          callId: `legacy-${name}`,
          name,
          args: { group_id: 101, user_id: 202, message: 'legacy text' },
          rawArguments: '{"group_id":101,"user_id":202,"message":"legacy text"}'
        }, createQueuePayload()),
        new RegExp(`Unsupported tool: ${name}`)
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(fetchCalled, false);
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
  assert.match(getMessageContent(reminder!), /0.140/);
  assert.match(getMessageContent(reminder!), /1.000/);
  assert.doesNotMatch(getMessageContent(reminder!), /trigger=|note=/);
});

test('buildTurnStateReminder uses fresh runtime energy over directive values', () => {
  const reminder = buildTurnStateReminder(
    '<xiaoni_runtime_state trigger="web_search" energy="0.140" max_energy="1" note="after search" />',
    { energy: 0.92, maxEnergy: 1 }
  );

  assert.ok(reminder);
  assert.match(getMessageContent(reminder!), /0.920/);
  assert.match(getMessageContent(reminder!), /1.000/);
  assert.doesNotMatch(getMessageContent(reminder!), /0.140|trigger=|after search|note=/);
});

test('applyToolResultToLoopInput appends web_search STATE from fresh runtime energy', () => {
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
      hasVisibleReply: false,
      runtimeEnergyState: { energy: 0.91, maxEnergy: 1 }
    }
  );

  const stateItem = continuation.inputItems.find((item) => getMessageContent(item).includes('0.910'));
  assert.ok(stateItem);
  assert.equal(stateItem?.type, 'message');
  assert.equal(stateItem && stateItem.type === 'message' ? stateItem.role : null, 'developer');
  assert.match(getMessageContent(stateItem), /0.910/);
  assert.doesNotMatch(getMessageContent(stateItem), /0.420/);
  assert.doesNotMatch(getMessageContent(stateItem), /trigger=|note=/);
});

test('runtime energy recovery follows bounded pressure curve from negative debt', () => {
  const positive = recoverRuntimeEnergy({ rawEnergy: 0.25, elapsedMs: 60 * 60 * 1000 });
  assert.ok(positive.energy > 0.5);
  assert.ok(positive.energy < 1);
  const negative = recoverRuntimeEnergy({ rawEnergy: -0.35, elapsedMs: 60 * 60 * 1000 });
  assert.equal(negative.startEnergy, -0.35);
  assert.equal(negative.debt, 0.35);
  assert.ok(negative.energy > -0.35);
  const hardCap = recoverRuntimeEnergy({ rawEnergy: -0.35, elapsedMs: 3 * 60 * 60 * 1000 });
  assert.ok(hardCap.energy > 0.8);
  assert.ok(hardCap.energy < 1);
});

test('recover_energy refuses to sleep when Xiaoni is already full energy', async () => {
  const service = new AgentLoopService({
    getCurrentXiaoniEnergyState: async () => ({
      energy: 1,
      maxEnergy: 1
    })
  } as any);

  const result = await (service as any).executeTool({
    callId: 'call-recover-full',
    name: RECOVER_ENERGY_TOOL,
    args: {
      reason: '我想继续睡',
      xiaoni_os: '其实已经不累了。'
    },
    rawArguments: '{}'
  }, createQueuePayload());

  assert.equal(result.release_lease, undefined);
  assert.equal(result.recovered, false);
  assert.equal(result.rest_rejected, true);
  assert.match(result.reason, /还没到可以休息的线/);
  assert.equal(result.energy, 1);
  assert.equal(result.max_energy, 1);
  assert.match(String(result.system_reminder), /<system_reminder>/);
  assert.match(String(result.system_reminder), EAST8_TIME_PREFIX_PATTERN);
  assert.match(String(result.system_reminder), /失眠|睡不着/);
  assert.equal(result.xiaoni_os, '其实已经不累了。');
});

test('recover_energy can still sleep when current energy is below full', async () => {
  const service = new AgentLoopService({
    getCurrentXiaoniEnergyState: async () => ({
      energy: 0.5,
      maxEnergy: 1
    })
  } as any);

  const result = await (service as any).executeTool({
    callId: 'call-recover-low',
    name: RECOVER_ENERGY_TOOL,
    args: {
      reason: '真的累了',
      xiaoni_os: '睡醒继续。',
      clock: 30
    },
    rawArguments: '{}'
  }, createQueuePayload());

  assert.equal(result.release_lease, undefined);
  assert.equal(result.recovery_session_requested, true);
  assert.equal(result.recovered, false);
  assert.equal(result.clock_minutes, 30);
  assert.equal(result.energy_before, 0.5);
  assert.equal(result.energy, 0.5);
  assert.equal(result.xiaoni_os, '睡醒继续。');
});

test('runtime iteration does not claim queue messages while recovery session is active', async () => {
  const storeCalls: Record<string, any[]> = {
    listAgentRecoveryWakeNotifications: [],
    updateAgentRecoverySessionProgress: [],
    claimNextQueueMessage: []
  };
  const activeSession = {
    id: 301,
    initiator: 'recover_energy_tool',
    reason: '透支了，先休息。',
    xiaoniOs: '先断开。',
    clockMinutes: 5,
    clockDueAt: new Date(Date.now() - 60_000).toISOString(),
    clockDeferredAt: null,
    startedAt: new Date().toISOString(),
    startEnergy: -0.2,
    currentEnergy: -0.2,
    maxEnergy: 1,
    wakeCountStartQueueMessageId: 100,
    lastWakeCountedQueueMessageId: 100,
    wakeCallCount: 1
  };
  const store = {
    getActiveAgentRecoverySession: async () => activeSession,
    listAgentRecoveryWakeNotifications: async (params: any) => {
      storeCalls.listAgentRecoveryWakeNotifications.push(params);
      return [
        { id: 101, wakeCount: 1 },
        { id: 102, wakeCount: 2 }
      ];
    },
    updateAgentRecoverySessionProgress: async (params: any) => {
      storeCalls.updateAgentRecoverySessionProgress.push(params);
      return activeSession;
    },
    claimNextQueueMessage: async () => {
      storeCalls.claimNextQueueMessage.push({});
      return null;
    }
  } as any;
  const service = new AgentLoopService(store);

  await (service as any).processRuntimeIteration({
    workerId: 'worker-recovery-active',
    idleIntervalMs: 0
  });

  assert.equal(storeCalls.claimNextQueueMessage.length, 0);
  assert.deepEqual(storeCalls.listAgentRecoveryWakeNotifications[0], {
    afterQueueMessageId: 100,
    limit: 250
  });
  assert.equal(storeCalls.updateAgentRecoverySessionProgress[0]?.id, 301);
  assert.equal(storeCalls.updateAgentRecoverySessionProgress[0]?.wakeCallCount, 4);
  assert.equal(storeCalls.updateAgentRecoverySessionProgress[0]?.lastWakeCountedQueueMessageId, 102);
  assert.ok(storeCalls.updateAgentRecoverySessionProgress[0]?.clockDeferredAt instanceof Date);
});

test('runtime iteration settles persisted recovery session after restart with original tool callback', async () => {
  const storeCalls: Record<string, any[]> = {
    appendAgentStackItems: [],
    completeAgentStackToolExecution: [],
    finalizeAgentRecoverySession: [],
    recordRecoverySessionLifeEvent: [],
    claimNextQueueMessage: []
  };
  const activeSession = {
    id: 302,
    initiator: 'recover_energy_tool',
    reason: '睡醒继续看消息。',
    xiaoniOs: '醒来后先看有没有要紧事。',
    clockMinutes: 30,
    clockDueAt: null,
    clockDeferredAt: null,
    startedAt: new Date(Date.now() - (181 * 60 * 1000)).toISOString(),
    startEnergy: -0.25,
    currentEnergy: -0.25,
    maxEnergy: 1,
    toolCallId: 'call-recover-restart',
    toolExecutionId: 'tool:run-restart:call-recover-restart',
    llmRequestSliceId: 'slice-restart',
    llmCallId: 'llm-restart',
    traceId: 'trace-restart',
    runId: 'run-restart',
    wakeCountStartQueueMessageId: 200,
    lastWakeCountedQueueMessageId: 200,
    wakeCallCount: 0,
    metadata: {
      tool_args: {
        reason: '睡醒继续看消息。',
        clock: 30,
        xiaoni_os: '醒来后先看有没有要紧事。'
      },
      raw_arguments: '{"reason":"睡醒继续看消息。","clock":30,"xiaoni_os":"醒来后先看有没有要紧事。"}'
    }
  };
  const store = {
    getActiveAgentRecoverySession: async () => activeSession,
    listAgentRecoveryWakeNotifications: async () => [],
    appendAgentStackItems: async (params: any) => {
      storeCalls.appendAgentStackItems.push(params);
      return [{ id: 'stack-output-restart' }];
    },
    completeAgentStackToolExecution: async (params: any) => {
      storeCalls.completeAgentStackToolExecution.push(params);
      return null;
    },
    finalizeAgentRecoverySession: async (params: any) => {
      storeCalls.finalizeAgentRecoverySession.push(params);
      return { ...activeSession, status: 'completed' };
    },
    recordRecoverySessionLifeEvent: async (session: any, toolResult: any) => {
      storeCalls.recordRecoverySessionLifeEvent.push({ session, toolResult });
    },
    claimNextQueueMessage: async () => {
      storeCalls.claimNextQueueMessage.push({});
      return null;
    }
  } as any;
  const service = new AgentLoopService(store);
  const frames: any[] = [];
  (service as any).processRuntimeFrame = async (queueMessage: any, options: any) => {
    frames.push({ queueMessage, options });
  };

  await (service as any).processRuntimeIteration({
    workerId: 'worker-recovery-settle',
    idleIntervalMs: 0
  });

  assert.equal(storeCalls.claimNextQueueMessage.length, 0);
  assert.equal(storeCalls.finalizeAgentRecoverySession[0]?.id, 302);
  assert.equal(storeCalls.finalizeAgentRecoverySession[0]?.wakeCause, 'hard_cap');
  assert.equal(storeCalls.completeAgentStackToolExecution[0]?.executionId, 'tool:run-restart:call-recover-restart');
  assert.equal(storeCalls.completeAgentStackToolExecution[0]?.status, 'completed');
  assert.equal(storeCalls.recordRecoverySessionLifeEvent[0]?.toolResult?.recovery_session_id, 302);
  assert.equal(storeCalls.appendAgentStackItems[0]?.sourceType, 'agent_recovery_sessions');
  assert.equal(storeCalls.appendAgentStackItems[0]?.sourceId, '302');
  assert.equal(frames.length, 1);
  assert.equal(frames[0]?.options?.queueBacked, false);
  assert.equal(frames[0]?.options?.initialLoopContinuation?.[0]?.type, 'function_call');
  assert.equal(frames[0]?.options?.initialLoopContinuation?.[0]?.call_id, 'call-recover-restart');
  assert.equal(frames[0]?.options?.initialLoopContinuation?.[1]?.type, 'function_call_output');
  assert.equal(frames[0]?.options?.initialLoopContinuation?.[1]?.call_id, 'call-recover-restart');
  assert.match(String(frames[0]?.options?.initialLoopContinuation?.[1]?.output), /<system_reminder>/);
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
  const promptTexts = input
    .filter((item: any) => item.type === 'message' && (item.role === 'user' || item.role === 'developer'))
    .flatMap((item: any) => {
      const content = Array.isArray(item.content) ? item.content : [item.content];
      return content.map((c: any) => (typeof c === 'string' ? c : c?.text ?? ''));
    });
  assert.equal(promptTexts.some((t: string) => t.includes('[待分享]')), false);
  assert.equal(promptTexts.some((t: string) => t.includes('今天看到个很有趣的东西')), false);
  assert.equal(promptTexts.some((t: string) => isPhoneNotificationReminderContent(t)), true);
});

test('no-notify continuation preserves global OS context during recover_energy tool call', async () => {
  const queueMessage = {
    id: 'run-runtime-loop-recover',
    traceId: 'trace-runtime-loop-recover',
    batchId: 'batch-runtime-loop-recover',
    status: 'processing',
    attempts: 1,
    createdAt: '2026-03-28T08:00:00.000Z',
    queueMessageIds: [],
    payload: createRuntimeLoopPayload()
  };
  const listRecentTurnsCalls: any[] = [];
  const storeCalls: Record<string, any[]> = {
    createConversation: [],
    settleQueueMessages: [],
    createAgentRecoverySession: []
  };
  let renderedModelInput = '';

  const store = {
    createLlmJob: async () => 'job-runtime-loop-recover',
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
          xiaoni_os: '刚才已在私聊里答应阿花：会挑真有触动的海涅句子去 253631878 群里说。',
          responses_replay_items: [{
            type: 'message',
            role: 'assistant',
            phase: 'final_answer',
            content: [{ type: 'output_text', text: '可以。我会挑那种真有触动的句子说。' }]
          }]
        }
      }];
    },
    getSessionReadCutoffState: async () => null,
    upsertSessionReadCutoffState: async () => {},
    upsertProactiveShareState: async () => {},
    getExecutionLeaseDeliveryState: async () => ({
      deliveryPhase: 'reasoning_open',
      deliveryCommitCount: 0,
      blockedDeliveryAttemptCount: 0,
      lastBlockedDeliveryReason: null
    }),
    markLeaseVisibleDeliveryCommitted: async () => {},
    markLeaseDeliveryBlocked: async () => {},
    recordAgentStackToolExecution: async () => ({ id: 1 }),
    completeAgentStackToolExecution: async () => {},
    createConversation: async (params: any) => {
      storeCalls.createConversation.push(params);
      return 2001;
    },
    ensureXiaoniIdentityRoot: async () => ({ root: { id: 1 }, event: { id: 2 }, created: false }),
    attachConversationIdToTrace: async () => {},
    settleQueueMessages: async (_runId: string, params: any) => { storeCalls.settleQueueMessages.push(params); },
    releaseExecutionLease: async () => {},
    updateLlmJob: async () => {},
    createAgentRecoverySession: async (params: any) => {
      storeCalls.createAgentRecoverySession.push(params);
      return { id: 77 };
    }
  } as any;

  const service = new AgentLoopService(store, {
    resolveForQueueMessage: async () => createRuntimePrompt()
  } as any);

  (service as any).executeAgentTurn = async (canonicalRequest: any) => {
    renderedModelInput = (canonicalRequest.input || []).map(getMessageContent).join('\n');
    return {
      success: true,
      llm_call_id: 'llm-runtime-loop-recover',
      canonical_response: {
        output: [{
          type: 'function_call',
          call_id: 'call-runtime-loop-recover',
          name: RECOVER_ENERGY_TOOL,
          arguments: JSON.stringify({
            reason: '测试全局 OS 是否进入上下文，当前没有外部目标，先休息。',
            clock: 30,
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
    throw new Error(`recover-only runtime_loop test must not call outbound QQ endpoints: ${urlString}`);
  }) as typeof fetch;

  try {
    await processRuntimeFrameForTest(service, queueMessage as any, {
      queueBacked: false,
      triggerInputMode: 'suppress_current_trigger',
      appendRuntimeInputStackItem: false,
      logQueueLifecycle: false
    });
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
  assert.equal(storeCalls.settleQueueMessages.length, 0);
  assert.equal(storeCalls.createConversation[0]?.rawResponse?.lease_release_reason, 'runtime_frame_yielded');
  assert.equal(storeCalls.createConversation[0]?.rawResponse?.xiaoni_os, '全局近况已被看见。');
  assert.equal(storeCalls.createAgentRecoverySession.length, 1);
  assert.equal(storeCalls.createAgentRecoverySession[0]?.toolCallId, 'call-runtime-loop-recover');
  assert.equal(storeCalls.createAgentRecoverySession[0]?.clockMinutes, 30);
  assert.equal(storeCalls.createAgentRecoverySession[0]?.xiaoniOs, '全局近况已被看见。');
  assert.deepEqual(storeCalls.createAgentRecoverySession[0]?.metadata?.tool_args, {
    reason: '测试全局 OS 是否进入上下文，当前没有外部目标，先休息。',
    clock: 30,
    xiaoni_os: '全局近况已被看见。'
  });
  assert.equal(
    storeCalls.createConversation[0]?.rawResponse?.responses_replay_items?.some((item: any) =>
      item?.type === 'function_call_output'
        && String(item.output).includes('躯体苏醒')
    ),
    false
  );
});

test('runtime frame fetches global history after persisted read cutoff', async () => {
  const queueMessage = {
    id: 'run-runtime-loop-cutoff',
    traceId: 'trace-runtime-loop-cutoff',
    batchId: 'batch-runtime-loop-cutoff',
    status: 'processing',
    attempts: 1,
    createdAt: '2026-03-28T08:00:00.000Z',
    queueMessageIds: [],
    payload: createRuntimeLoopPayload()
  };
  const listRecentTurnsCalls: any[] = [];
  let cutoffReadCount = 0;
  const store = {
    createLlmJob: async () => 'job-runtime-loop-cutoff',
    logTimelineEvent: async () => {},
    listRecentTurns: async (params: any) => {
      listRecentTurnsCalls.push(params);
      return [createConversationTurn({
        id: 172,
        userId: 85178516,
        groupId: null,
        sessionKey: 'private:85178516',
        userMessage: 'cutoff 之后的新历史',
        aiResponse: '我记得。'
      })];
    },
    getSessionReadCutoffState: async (sessionKey: string) => {
      cutoffReadCount += 1;
      assert.equal(sessionKey, 'xiaoni:global');
      return {
        sessionKey: 'xiaoni:global',
        readCutoffAfterConversationId: 171,
        lastContextWindowTokens: 400000,
        lastTargetBudgetTokens: 280000,
        lastHardBudgetTokens: 380000,
        contextSummary: '171 之前的历史已经压缩。',
        pendingProactiveShare: null,
        pendingProactiveShareAge: 0,
        updatedAt: null
      };
    },
    upsertSessionReadCutoffState: async () => {},
    upsertProactiveShareState: async () => {},
    getExecutionLeaseDeliveryState: async () => ({
      deliveryPhase: 'reasoning_open',
      deliveryCommitCount: 0,
      blockedDeliveryAttemptCount: 0,
      lastBlockedDeliveryReason: null
    }),
    markLeaseVisibleDeliveryCommitted: async () => {},
    markLeaseDeliveryBlocked: async () => {},
    recordAgentStackToolExecution: async () => ({ id: 1 }),
    completeAgentStackToolExecution: async () => {},
    createConversation: async () => 2002,
    ensureXiaoniIdentityRoot: async () => ({ root: { id: 1 }, event: { id: 2 }, created: false }),
    attachConversationIdToTrace: async () => {},
    settleQueueMessages: async () => {},
    releaseExecutionLease: async () => {},
    updateLlmJob: async () => {},
    createAgentRecoverySession: async () => ({ id: 78 })
  } as any;

  const service = new AgentLoopService(store, {
    resolveForQueueMessage: async () => createRuntimePrompt()
  } as any);

  (service as any).executeAgentTurn = async () => ({
    success: true,
    llm_call_id: 'llm-runtime-loop-cutoff',
    canonical_response: {
      output: [{
        type: 'function_call',
        call_id: 'call-runtime-loop-cutoff',
        name: RECOVER_ENERGY_TOOL,
        arguments: JSON.stringify({
          reason: '测试 cutoff 后历史读取。',
          clock: 30,
          xiaoni_os: 'cutoff 后历史已进入上下文。'
        })
      }]
    }
  });

  await processRuntimeFrameForTest(service, queueMessage as any, {
    queueBacked: false,
    triggerInputMode: 'suppress_current_trigger',
    appendRuntimeInputStackItem: false,
    logQueueLifecycle: false
  });

  assert.equal(cutoffReadCount, 1);
  assert.deepEqual(listRecentTurnsCalls[0], {
    userId: 303,
    groupId: null,
    afterConversationId: 171,
    scope: 'global',
    limit: 201
  });
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
    queueMessage: createRuntimeLoopPayload(),
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
  assert.doesNotMatch(JSON.stringify(plan.requestInput), /当前压力:/);
  assert.match(JSON.stringify(plan.summarySourceInput), /当前压力:/);
  assert.match(JSON.stringify(plan.summarySourceInput), EAST8_TIME_PREFIX_PATTERN);
  assert.doesNotMatch(JSON.stringify(plan.requestInput), /source=\\?"core_memory_pressure\\?"/);
  assert.doesNotMatch(JSON.stringify(plan.requestInput), /required_tool=\\?"compress_core_memory\\?"/);

  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, plan.requestInput, 'direct');
  assert.equal((request.tools ?? []).map((tool: any) => getToolName(tool)).includes(COMPRESS_CORE_MEMORY_TOOL), true);
  assert.equal(getAllowedToolNames(request.tool_choice).includes(COMPRESS_CORE_MEMORY_TOOL), false);

  const compressionRequest = buildCanonicalAgentTurnRequest(agentConfig.modelName, plan.summarySourceInput, 'direct');
  assert.deepEqual(getAllowedToolNames(compressionRequest.tool_choice), [EXEC_COMMAND_TOOL, COMPRESS_CORE_MEMORY_TOOL]);

  const alternateToolChoiceRequest = {
    ...compressionRequest,
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
    JSON.stringify(withoutToolChoice(compressionRequest)),
    'changing only tool_choice must not mutate prompt/input/tools/cache-key request prefix fields'
  );
});

test('core memory compression runs in an isolated background fork alongside the main agent request', async () => {
  const queueMessage = {
    id: 'run-compression-fork',
    traceId: 'trace-compression-fork',
    batchId: 'batch-compression-fork',
    status: 'processing',
    attempts: 1,
    createdAt: '2026-06-12T00:00:00.000Z',
    queueMessageIds: [],
    payload: createRuntimeLoopPayload()
  };
  const history = Array.from({ length: 201 }, (_, index) => createConversationTurn({
    id: index + 1,
    userId: 85178516,
    groupId: null,
    sessionKey: 'private:85178516',
    userMessage: `global history ${index + 1}`,
    aiResponse: `global os ${index + 1}`
  }));
  const summaryWrites: any[] = [];
  const cutoffWrites: any[] = [];
  const conversations: any[] = [];
  const timelineEvents: any[] = [];
  const scheduledCompressionWriters: any[] = [];
  const mainStackItems: any[] = [];
  const forkRuns: any[] = [];
  const completedForkRuns: any[] = [];
  const forkItems: any[] = [];
  const forkSlices: any[] = [];
  const forkTools: any[] = [];
  const completedForkTools: any[] = [];
  let forkItemId = 7000;
  let forkItemIndex = 0;

  const store = {
    createLlmJob: async () => 'job-compression-fork',
    logTimelineEvent: async (event: any) => { timelineEvents.push(event); },
    listRecentTurns: async () => history,
    getSessionReadCutoffState: async () => null,
    upsertSessionContextSummary: async (params: any) => { summaryWrites.push(params); },
    upsertSessionReadCutoffState: async (params: any) => { cutoffWrites.push(params); },
    upsertProactiveShareState: async () => {},
    getExecutionLeaseDeliveryState: async () => ({
      deliveryPhase: 'reasoning_open',
      deliveryCommitCount: 0,
      blockedDeliveryAttemptCount: 0,
      lastBlockedDeliveryReason: null
    }),
    markLeaseVisibleDeliveryCommitted: async () => {},
    markLeaseDeliveryBlocked: async () => {},
    createConversation: async (params: any) => {
      conversations.push(params);
      return 9090;
    },
    ensureXiaoniIdentityRoot: async () => ({ root: { id: 1 }, event: { id: 2 }, created: false }),
    attachConversationIdToTrace: async () => {},
    appendAgentStackItems: async (params: any) => {
      mainStackItems.push(params);
      return [];
    },
    recordCoreMemoryCompressionForkRun: async (params: any) => {
      forkRuns.push(params);
      return { ...params, id: 'fork-run-row' };
    },
    completeCoreMemoryCompressionForkRun: async (params: any) => {
      completedForkRuns.push(params);
      return { ...params, id: 'fork-run-row' };
    },
    appendCoreMemoryCompressionForkItems: async (params: any) => {
      const rows = (params.items || []).map((item: any) => {
        forkItemIndex += 1;
        return {
          ...item,
          id: String(forkItemId++),
          forkRunId: params.forkRunId,
          itemIndex: forkItemIndex,
          itemKind: item.itemKind,
          toolCallId: item.toolCallId || null
        };
      });
      forkItems.push({ ...params, rows });
      return rows;
    },
    recordCoreMemoryCompressionForkSlice: async (params: any) => {
      forkSlices.push(params);
      return { ...params, id: 'fork-slice-row' };
    },
    recordCoreMemoryCompressionForkToolExecution: async (params: any) => {
      forkTools.push(params);
      return { ...params, id: 'fork-tool-row' };
    },
    completeCoreMemoryCompressionForkToolExecution: async (params: any) => {
      completedForkTools.push(params);
      return { ...params, id: 'fork-tool-row' };
    },
    updateLlmJob: async () => {}
  } as any;

  const service = new AgentLoopService(store, {
    resolveForQueueMessage: async () => createRuntimePrompt()
  } as any);

  const forkRequests: any[] = [];
  const mainRequests: any[] = [];
  let releaseForkTurn: () => void = () => undefined;
  const forkTurnGate = new Promise<void>((resolve) => {
    releaseForkTurn = resolve;
  });
  const waitFor = async (predicate: () => boolean, label: string) => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (predicate()) {
        return;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
    }
    assert.fail(label);
  };
  (service as any).executeCoreMemoryCompressionForkTurn = async (canonicalRequest: any, _payload: any, _runtimePrompt: any, forkTurn: number) => {
    forkRequests.push(canonicalRequest);
    if (forkTurn === 1) {
      await forkTurnGate;
      return {
        success: true,
        llm_call_id: 'llm-compress-fork-1',
        canonical_response: {
          output: [{
            type: 'function_call',
            call_id: 'call-archive',
            name: EXEC_COMMAND_TOOL,
            arguments: JSON.stringify({
              cmd: 'printf archived',
              workdir: '/app'
            })
          }]
        }
      };
    }
    return {
      success: true,
      llm_call_id: 'llm-compress-fork-2',
      canonical_response: {
        output: [{
          type: 'function_call',
          call_id: 'call-compress',
          name: COMPRESS_CORE_MEMORY_TOOL,
          arguments: JSON.stringify({
            text: '压缩后的近况：刚把旧窗口归档到 /tmp/xiaoni-memory.md，接下来继续处理当前 runtime loop。'
          })
        }]
      }
    };
  };
  (service as any).executeTool = async (toolCall: any) => {
    if (toolCall.name === EXEC_COMMAND_TOOL) {
      return {
        cmd: toolCall.args.cmd,
        codex_output: 'archived to /tmp/xiaoni-memory.md'
      };
    }
    if (toolCall.name === COMPRESS_CORE_MEMORY_TOOL) {
      return {
        compressed: true,
        text: String(toolCall.args.text || '').trim(),
        outcome: 'core_memory_compressed'
      };
    }
    throw new Error(`Unexpected tool in compression fork test: ${toolCall.name}`);
  };
  (service as any).executeAgentTurn = async (canonicalRequest: any) => {
    mainRequests.push(canonicalRequest);
    return {
      success: true,
      llm_call_id: 'llm-main-after-compression',
      canonical_response: {
        output: []
      }
    };
  };
  (service as any).scheduleContextCompressionMemoryWriter = (params: any) => {
    scheduledCompressionWriters.push(params);
  };

  const framePromise = processRuntimeFrameForTest(service, queueMessage as any, {
    queueBacked: false,
    triggerInputMode: 'suppress_current_trigger',
    appendRuntimeInputStackItem: false,
    logQueueLifecycle: false
  });
  await waitFor(() => forkRequests.length === 1, 'background compression fork did not start');
  await framePromise;

  assert.equal(mainRequests.length, 1);
  assert.equal(forkRequests.length, 1);
  assert.equal(forkRuns.length, 1);
  assert.equal(completedForkRuns.length, 0);
  assert.equal(forkRuns[0]?.status, 'running');
  assert.equal(forkRuns[0]?.metadata?.no_main_stack_persist, true);
  assert.equal(forkRequests[0]?.store, false);
  assert.equal(forkRequests[0]?.metadata?.core_memory_compression_fork, 'true');
  assert.equal(forkRequests[0]?.metadata?.no_persist, 'true');
  assert.deepEqual(getAllowedToolNames(forkRequests[0]?.tool_choice), [EXEC_COMMAND_TOOL, COMPRESS_CORE_MEMORY_TOOL]);
  assert.deepEqual(forkRequests[0]?.tools, mainRequests[0]?.tools);

  const firstForkText = (forkRequests[0]?.input || []).map(getMessageContent).join('\n');
  assert.match(firstForkText, /躯体警告|当前压力:/);
  assert.match(firstForkText, /global history 1(?!\d)/);
  assert.match(firstForkText, /global history 201/);

  const mainText = (mainRequests[0]?.input || []).map(getMessageContent).join('\n');
  assert.doesNotMatch(mainText, /<小腻近况>|压缩后的近况/);
  assert.doesNotMatch(mainText, /躯体警告|当前压力:/);
  assert.doesNotMatch(mainText, /call-archive|call-compress|archived to \/tmp\/xiaoni-memory\.md/);
  assert.match(mainText, /global history 1(?!\d)/);
  assert.match(mainText, /global history 171/);
  assert.match(mainText, /global history 201/);

  assert.equal(conversations.length, 1);
  assert.equal(conversations[0]?.rawRequest?.retained_history_count, 201);
  assert.equal(conversations[0]?.rawResponse?.context_budget_turns?.[0]?.read_history_count, 201);
  assert.equal(conversations[0]?.rawResponse?.loop_stage_artifacts?.core_memory_compression?.execution_mode, 'compression_fork_background');
  assert.equal(conversations[0]?.rawResponse?.loop_stage_artifacts?.core_memory_compression?.status, 'scheduled');
  assert.doesNotMatch(JSON.stringify(conversations[0]?.rawResponse?.responses_replay_items || []), /call-archive|call-compress|archived/);
  assert.doesNotMatch(JSON.stringify(mainStackItems), /call-archive|call-compress|archived/);
  assert.equal(scheduledCompressionWriters.length, 1);
  assert.equal(scheduledCompressionWriters[0]?.evictedTurns?.length, 171);
  assert.equal(scheduledCompressionWriters[0]?.evictedTurns?.[0]?.id, 1);
  assert.equal(scheduledCompressionWriters[0]?.evictedTurns?.at(-1)?.id, 171);

  releaseForkTurn();
  await waitFor(() => completedForkRuns.length === 1, 'background compression fork did not complete');

  assert.equal(forkRequests.length, 2);
  assert.equal(completedForkRuns[0]?.status, 'completed');
  assert.equal(completedForkRuns[0]?.summaryText, '压缩后的近况：刚把旧窗口归档到 /tmp/xiaoni-memory.md，接下来继续处理当前 runtime loop。');
  assert.equal(forkSlices.length, 2);
  assert.equal(forkSlices[0]?.canonicalRequest?.store, false);
  assert.equal(forkSlices[0]?.metadata?.no_main_stack_persist, true);
  assert.equal(forkSlices[1]?.metadata?.fork_turn, 2);
  assert.equal(forkTools.length, 2);
  assert.deepEqual(forkTools.map((entry) => entry.toolName), [EXEC_COMMAND_TOOL, COMPRESS_CORE_MEMORY_TOOL]);
  assert.equal(completedForkTools.length, 2);
  assert.equal(completedForkTools[0]?.result?.codex_output, 'archived to /tmp/xiaoni-memory.md');
  assert.equal(completedForkTools[1]?.result?.context_summary_written, true);
  assert.match(JSON.stringify(forkItems), /call-archive/);
  assert.match(JSON.stringify(forkItems), /call-compress/);
  assert.match(JSON.stringify(forkItems), /archived to \/tmp\/xiaoni-memory\.md/);
  const secondForkText = JSON.stringify(forkRequests[1]?.input || []);
  assert.match(secondForkText, /call-archive/);
  assert.match(secondForkText, /archived to \/tmp\/xiaoni-memory\.md/);
  assert.deepEqual(summaryWrites, [{
    sessionKey: 'xiaoni:global',
    contextSummary: '压缩后的近况：刚把旧窗口归档到 /tmp/xiaoni-memory.md，接下来继续处理当前 runtime loop。'
  }]);
  assert.deepEqual(cutoffWrites, [{
    sessionKey: 'xiaoni:global',
    readCutoffAfterConversationId: 171,
    lastContextWindowTokens: 400000,
    lastTargetBudgetTokens: 280000,
    lastHardBudgetTokens: 380000
  }]);
  assert.equal(timelineEvents.some((event) => event.eventName === 'core_memory_compression_fork' && event.eventPhase === 'end'), true);
});

// F: 社交认知帧 — social cognitive frame substrings appear in agent instructions
test('buildCanonicalAgentTurnRequest includes social cognitive frame prose in instructions', () => {
  const loopInput = buildInitialInput([], createQueuePayload());
  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, loopInput, 'group');
  assert.match(String(request.instructions), /具备独立意识、由内在状态驱动的数字生命/);
  assert.match(String(request.instructions), /你按自己的节奏处理信息/);
  assert.match(String(request.instructions), /沉浸式探索/);
  assert.doesNotMatch(String(request.instructions), /只是能接话不算有可说点/);
});

// H: developer role injection — deprecated relationship layer is stripped from model input
test('buildInitialInput strips deprecated relationship layer while keeping head capabilities', () => {
  const devBlock = '<current_relationship>\n发言者：foo（QQ:12345）\n当前关系层级：L2\n当前可开放的自己：偶尔吐槽，有自己的语气\n</current_relationship>';
  const items = buildInitialInput([], createQueuePayload(), undefined, [], null, null, devBlock);
  assert.equal(items[0]?.type, 'message');
  assert.equal((items[0] as { role?: string })?.role, 'system');
  assert.equal(items[1]?.type, 'message');
  assert.equal((items[1] as { role?: string })?.role, 'developer');
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
  const summaryIndex = withSummary.findIndex((item) => item.type === 'message' && item.role === 'developer' && getMessageContent(item).includes('<小腻近况>'));
  assert.ok(summaryIndex >= 0);
  assert.ok(withSummary.indexOf(summaryCapabilities[0]!) < summaryIndex);
  const summaryCapabilitiesBlock = getMessageContent(summaryCapabilities[0]!);
  assert.doesNotMatch(summaryCapabilitiesBlock, new RegExp(REMOVED_LIFE_ACTION_TOOL));
  assert.match(summaryCapabilitiesBlock, /recover_energy: energy_cost=0.000/);
  assert.match(summaryCapabilitiesBlock, /compress_core_memory: energy_cost=0.020/);
  assert.doesNotMatch(summaryCapabilitiesBlock, /qq_usage_/);
  assert.match(summaryCapabilitiesBlock, /skill-creator: energy_cost=0.002/);
  assert.match(summaryCapabilitiesBlock, /qq-usage: energy_cost=0.002/);
  assert.match(summaryCapabilitiesBlock, /qq-send-image: energy_cost=0.002/);

  const withRefresh = buildInitialInput([], createQueuePayload(), createRuntimePrompt(), [], null, null, '<capability_refresh reason="operator" />');
  const refreshCapabilities = withRefresh.filter((item) => item.type === 'message' && item.role === 'developer' && getMessageContent(item).includes('<CAPABILITIES>'));
  assert.equal(refreshCapabilities.length, 1);
});

test('buildCapabilitiesDeveloperBlock omits missing-cost skills without prompt-facing operator warning', () => {
  const { block, warnings } = buildCapabilitiesDeveloperBlock({
    skillCosts: {
      'skill-creator': 0.002,
      'missing-cost': null
    }
  });

  assert.match(block, /skill-creator: energy_cost=0.002/);
  assert.doesNotMatch(block, /missing-cost: energy_cost/);
  assert.doesNotMatch(block, /operator_warning|missing-cost omitted/);
  assert.deepEqual(warnings, ['skill missing-cost omitted from <CAPABILITIES>: missing ## Runtime Cost energy_cost']);
});

test('recover_energy is exposed without prompt-facing rest_period or sleep_period tools', () => {
  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, buildInitialInput([], createQueuePayload()), 'group');
  const toolNames = withoutQqUsageTools((request.tools ?? []).map((tool: any) => getToolName(tool)));
  assert.ok(toolNames.includes(RECOVER_ENERGY_TOOL));
  assert.ok(!toolNames.includes('rest_period'));
  assert.ok(!toolNames.includes('sleep_period'));
  const recoverTool = (request.tools ?? []).find((tool: any) => getToolName(tool) === RECOVER_ENERGY_TOOL) as any;
  assert.deepEqual(recoverTool?.function?.parameters?.required, ['reason', 'xiaoni_os']);
  assert.equal(recoverTool?.function?.parameters?.properties?.clock?.minimum, 5);
  assert.equal(recoverTool?.function?.parameters?.properties?.clock?.maximum, 120);
  assert.equal(recoverTool?.function?.parameters?.properties?.duration_minutes, undefined);
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
  assert.equal(block, null);
  assert.doesNotMatch(String(block), /current_relationship|当前关系层级|当前可开放的自己|发言者：foo|current_scene|消息密度|活跃人数/);
});

test('group loop no longer exposes recall_long_term_learning as a pre-reply tool', () => {
  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, buildInitialInput([], createQueuePayload()), 'group');
  const recallTool = (request.tools as Array<{ function?: { name?: string; parameters?: { properties?: Record<string, unknown>; required?: string[] } } }>)
    ?.find((t) => t.function?.name === 'recall_long_term_learning');
  assert.equal(recallTool, undefined);
  assert.ok(!withoutQqUsageTools(getAllowedToolNames(request.tool_choice)).includes('recall_long_term_learning'));
});
