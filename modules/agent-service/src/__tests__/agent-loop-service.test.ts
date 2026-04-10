import test from 'node:test';
import assert from 'node:assert/strict';
import { agentConfig } from '../config';
import { AgentLoopService, applyToolResultToLoopInput, buildCanonicalAgentTurnRequest, buildInitialInput, planGroupReplyDelivery } from '../services/agent-loop-service';
import { MissingAgentPromptBindingError, type ResolvedAgentRuntimePrompt } from '../services/agent-prompt-service';
import type { QueueMessagePayload } from '../types';

const PRIVATE_REPLY_TOOL = 'reply_in_private';
const GROUP_REPLY_TOOL = 'speak_in_group';
const SILENT_FINISH_TOOL = 'stay_silent';
const WEB_SEARCH_TOOL = 'web_search';

function getToolName(tool: { type: string; function?: { name?: string } }) {
  return tool.type === 'function' ? tool.function?.name : tool.type;
}

function getFunctionTool(tool: { type: string; function?: { description?: string; parameters?: { properties?: unknown } } }) {
  return tool.type === 'function' ? tool.function : null;
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
      .map((part) => part && typeof part === 'object' && part.type === 'input_text' ? String(part.text || '') : '')
      .filter(Boolean)
      .join('\n');
  }

  return '';
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
  assert.match(String(request.instructions), /Runtime contract:/);
  assert.match(String(request.instructions), /\[已读消息\]/);
  assert.match(String(request.instructions), /\[未读消息\]/);
  assert.doesNotMatch(String(request.instructions), /Pre-reply memory gate:/);
  assert.doesNotMatch(String(request.instructions), /Present self reconstruction:/);
  assert.equal(request.input[0]?.type, 'message');
  assert.equal(request.input[0]?.role, 'user');
  assert.equal(request.input.some((item) => item.type === 'message' && item.role === 'system'), false);
  assert.equal(request.tool_choice, 'required');
  assert.equal(request.parallel_tool_calls, false);
  assert.deepEqual(
    request.tools.map((tool) => getToolName(tool)),
    [WEB_SEARCH_TOOL, GROUP_REPLY_TOOL, SILENT_FINISH_TOOL]
  );
  const groupReplyFunction = getFunctionTool(request.tools[1]);
  assert.match(String(groupReplyFunction?.description), /mention_user_ids/);
  assert.match(String(groupReplyFunction?.description), /不要为了强调语气、礼貌、格式整齐或装饰效果去 @ 人/);
  assert.deepEqual(groupReplyFunction?.parameters?.properties, {
    message: { type: 'string' },
    messages: {
      type: 'array',
      items: { type: 'string' }
    },
    mention_user_ids: {
      type: 'array',
      items: { type: 'integer' }
    },
    xiaoni_os: {
      type: 'string',
      description: 'A short hidden OS note about why 小腻 replied this way. Not sent to the group.'
    }
  });
});

test('buildCanonicalAgentTurnRequest does not include previous_response_id', () => {
  const loopInput = buildInitialInput([], createQueuePayload());
  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, loopInput, 'group');

  assert.equal(Object.prototype.hasOwnProperty.call(request, 'previous_response_id'), false);
});

test('executeAgentTurn sends the standard canonical request shape to provider-service', async () => {
  const loopInput = buildInitialInput([], createQueuePayload());
  loopInput.push({
    type: 'function_call',
    call_id: 'call-1',
    name: GROUP_REPLY_TOOL,
    arguments: '{"message":"hi"}'
  });
  loopInput.push({
    type: 'function_call_output',
    call_id: 'call-1',
    output: '{"ok":true}'
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
  assert.match(String(requestBody.canonicalRequest.instructions), /Runtime contract:/);
  assert.equal(requestBody.canonicalRequest.input[0].role, 'user');
  assert.equal(
    requestBody.canonicalRequest.input.some((item: any) => item.type === 'message' && item.role === 'system'),
    false
  );
  assert.deepEqual(
    requestBody.canonicalRequest.input.slice(-2).map((item: any) => item.type),
    ['function_call', 'function_call_output']
  );
  assert.equal(requestBody.canonicalRequest.tool_choice, 'required');
  assert.equal(requestBody.canonicalRequest.parallel_tool_calls, false);
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
  assert.equal(Object.prototype.hasOwnProperty.call(requestBody.canonicalRequest, 'previous_response_id'), false);
});

test('buildInitialInput renders stable batch context without exposing runtime ids', () => {
  const loopInput = buildInitialInput([], createQueuePayload(), createRuntimePrompt({
    systemPrompt: '你是小腻主AGENT'
  }));

  const currentPrompt = getMessageContent(loopInput.at(-1));
  assert.equal(getMessageContent(loopInput[1]), '[已读消息]');
  assert.equal(getMessageContent(loopInput[2]), '[未读消息]');
  assert.doesNotMatch(currentPrompt, /Trace:/);
  assert.doesNotMatch(currentPrompt, /RunId:/);
  assert.doesNotMatch(currentPrompt, /BatchId:/);
  assert.doesNotMatch(currentPrompt, /SessionKey:/);
  assert.doesNotMatch(currentPrompt, /ToolUsage:/);
  assert.match(currentPrompt, /2026-03-28T08:00:00.000Z \{Alice\(@202\)\}/);
  assert.match(currentPrompt, /问问@\{Bob\(@404\)\} 今天玩什么/);
  assert.doesNotMatch(currentPrompt, /\[mentioned bot\]/);
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
  const currentPrompt = getMessageContent(loopInput.at(-1));

  assert.match(currentPrompt, /\{Alice\(@202\)\}/);
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
  const currentTurnItems = loopInput.slice(-2);
  assert.equal(getMessageContent(loopInput[1]), '[已读消息]');
  assert.equal(getMessageContent(loopInput[2]), '[未读消息]');

  assert.equal(currentTurnItems.length, 2);
  assert.match(getMessageContent(currentTurnItems[0]), /\{Alice\(@202\)\}/);
  assert.match(getMessageContent(currentTurnItems[1]), /\{Carol\(@606\)\}/);
});

test('buildInitialInput does not append transcript summary to the system prompt by default', () => {
  const loopInput = buildInitialInput([], createQueuePayload(), createRuntimePrompt({
    systemPrompt: '你是小腻主AGENT'
  }));

  assert.equal(loopInput[0]?.type, 'message');
  assert.equal(loopInput[0]?.role, 'system');
  assert.match(String(loopInput[0]?.content), /Runtime contract:/);
  assert.match(String(loopInput[0]?.content), /OS 可以包含你当时真实留下来的任何想法/);
  assert.doesNotMatch(String(loopInput[0]?.content), /Conversation summary:/);
});

test('buildInitialInput appends the thin runtime contract for group chats', () => {
  const loopInput = buildInitialInput([], createQueuePayload(), createRuntimePrompt({
    systemPrompt: '你是小腻主AGENT'
  }));

  assert.equal(loopInput[0]?.type, 'message');
  assert.equal(loopInput[0]?.role, 'system');
  assert.match(String(loopInput[0]?.content), /^你是小腻主AGENT/);
  assert.match(String(loopInput[0]?.content), /Runtime contract:/);
  assert.match(String(loopInput[0]?.content), /你会看到 `\[已读消息\]` 和 `\[未读消息\]` 两个分界。/);
  assert.match(String(loopInput[0]?.content), /这次由你自己判断：/);
});

test('buildInitialInput uses the same thin runtime contract for direct chats', () => {
  const loopInput = buildInitialInput([], createDirectQueuePayload(), createRuntimePrompt({
    systemPrompt: '你是小腻主AGENT'
  }));

  assert.equal(loopInput[0]?.type, 'message');
  assert.equal(loopInput[0]?.role, 'system');
  assert.match(String(loopInput[0]?.content), /^你是小腻主AGENT/);
  assert.match(String(loopInput[0]?.content), /Runtime contract:/);
  assert.match(String(loopInput[0]?.content), /如果你决定说话：/);
  assert.match(String(loopInput[0]?.content), /群聊调用 speak_in_group/);
  assert.match(String(loopInput[0]?.content), /私聊调用 reply_in_private/);
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
  assert.match(String(loopInput[0]?.content), /Runtime contract:/);
  const currentMessage = loopInput.at(-1);
  assert.equal(currentMessage?.type, 'message');
  assert.equal(currentMessage?.role, 'user');
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

  assert.deepEqual(loopInput.slice(1, 4), [
    {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: '[已读消息]' }]
    },
    {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: '#1 {Alice(@202)}: 第一条' }]
    },
    {
      type: 'message',
      role: 'user',
      content: [
        { type: 'input_text', text: '小腻(303)\n我先看一下' },
        { type: 'input_text', text: '小腻(303)\n原因已经找到了' }
      ]
    }
  ]);
});

test('buildInitialInput groups same-turn 小腻 multi-part replies into one user part and appends OS last', () => {
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
        xiaoni_os: '这轮先接一句，再补半句就够了。'
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

  const priorXiaoniItem = loopInput[1];
  assert.equal(getMessageContent(loopInput[1]), '[已读消息]');
  const groupedXiaoniItem = loopInput[2];
  assert.deepEqual(
    groupedXiaoniItem && groupedXiaoniItem.type === 'message' ? groupedXiaoniItem.content : null,
    [
      { type: 'input_text', text: '小腻(303)\n第一段' },
      { type: 'input_text', text: '小腻(303)\n第二段' },
      { type: 'input_text', text: '<小腻的OS>\n这轮先接一句，再补半句就够了。\n</小腻的OS>' }
    ]
  );
  assert.equal(getMessageContent(loopInput[3]), '[未读消息]');
});

test('buildInitialInput attaches 小腻的OS to the latest spoken turn in the same content list', () => {
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

  assert.equal(getMessageContent(loopInput[1]), '[已读消息]');
  const priorXiaoniItem = loopInput[2];
  assert.match(getMessageContent(priorXiaoniItem), /小腻\(303\)\n我刚看群文件还没更新/);
  assert.match(getMessageContent(priorXiaoniItem), /<小腻的OS>/);
  assert.match(getMessageContent(priorXiaoniItem), /这句明显是在顺着问我/);
  assert.equal(getMessageContent(loopInput[3]), '[未读消息]');
});

test('buildInitialInput appends standalone 小腻的OS when the latest turn was silent', () => {
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

  assert.equal(getMessageContent(loopInput[1]), '[已读消息]');
  const standaloneOsItem = loopInput[3];
  assert.match(getMessageContent(standaloneOsItem), /<小腻的OS>/);
  assert.match(getMessageContent(standaloneOsItem), /刚才我没有接/);
  assert.match(getMessageContent(standaloneOsItem), /我插进去会显得多余/);
  assert.equal(getMessageContent(loopInput[4]), '[未读消息]');
});

test('buildInitialInput preserves xiaoni_os from non-latest history turns', () => {
  const loopInput = buildInitialInput([
    {
      id: 1,
      userId: 202,
      groupId: 101,
      batchId: null,
      sessionKey: 'qq:group:101',
      userMessage: '上一轮用户消息',
      aiResponse: '上一轮回复',
      rawResponse: {
        xiaoni_os: '上一轮留下的内在延续。'
      },
      items: [
        {
          id: 11,
          conversationId: 1,
          sessionKey: 'qq:group:101',
          role: 'assistant',
          phase: 'final_answer',
          content: '上一轮回复',
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
      userMessage: '最新一轮用户消息',
      aiResponse: '最新一轮回复',
      rawResponse: {},
      items: [
        {
          id: 21,
          conversationId: 2,
          sessionKey: 'qq:group:101',
          role: 'assistant',
          phase: 'final_answer',
          content: '最新一轮回复',
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

  const priorTurnItem = loopInput[2];
  assert.match(getMessageContent(priorTurnItem), /上一轮回复/);
  assert.match(getMessageContent(priorTurnItem), /<小腻的OS>/);
  assert.match(getMessageContent(priorTurnItem), /上一轮留下的内在延续/);
});

test('buildInitialInput keeps user input as pure scene without synthetic current-task text', () => {
  const loopInput = buildInitialInput([], createQueuePayload(), createRuntimePrompt({
    systemPrompt: '你是小腻主AGENT'
  }));

  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, loopInput, 'group');
  assert.match(String(request.instructions), /^你是小腻主AGENT/);
  assert.match(String(request.instructions), /如果你决定说话：/);
  assert.match(String(request.instructions), /群聊调用 speak_in_group/);
  assert.equal(request.input.some((item) => getMessageContent(item).includes('[当前任务]')), false);
});

test('planGroupReplyDelivery suppresses the second beat for conservative split-two scenes without a rolling thread', () => {
  const payload = createQueuePayload();
  payload.messages = [payload.messages[0]];

  const planned = planGroupReplyDelivery({
    messages: ['先冒一下', '再补半句'],
    mentionUserIds: [404],
    queueMessage: payload,
    presentSelf: {
      shouldSurface: true,
      presenceLevel: 'light',
      currentSelfMode: 'light_join',
      feltPull: 'there is a possible opening',
      activeRelationLines: [],
      activePastEchoes: [],
      familiarityLimitNow: 'warm_not_performative',
      answerShape: 'one_line_play_along',
      rendererGuidance: ['轻轻接一下就停'],
      socialPositionNow: 'light_joiner',
      targetPersonId: 202,
      entryIntent: 'push_half_step',
      beatPlan: {
        beatCount: 2,
        beatStyle: 'split_two',
        secondBeatPolicy: 'only_if_picked_up'
      },
      exitRule: 'wait_for_pickup',
      rationale: 'test'
    }
  });

  assert.deepEqual(planned.messages, ['先冒一下']);
  assert.equal(planned.secondBeatSuppressed, true);
  assert.deepEqual(planned.mentionUserIds, []);
});

test('planGroupReplyDelivery keeps the second beat when the live batch is already rolling', () => {
  const payload = createQueuePayload();
  payload.wasMentioned = false;
  payload.messages = [
    payload.messages[0],
    {
      ...payload.messages[0],
      queueMessageId: 2,
      messageId: 12,
      messageSid: 'sid-2',
      senderId: '505',
      senderName: 'Charlie',
      bodyForAgent: '我也觉得',
      rawBody: '我也觉得',
      wasMentioned: false
    }
  ];

  const planned = planGroupReplyDelivery({
    messages: ['先冒一下', '再补半句'],
    mentionUserIds: [],
    queueMessage: payload,
    presentSelf: {
      shouldSurface: true,
      presenceLevel: 'light',
      currentSelfMode: 'light_join',
      feltPull: 'the thread is rolling',
      activeRelationLines: [],
      activePastEchoes: [],
      familiarityLimitNow: 'warm_not_performative',
      answerShape: 'one_line_play_along',
      rendererGuidance: ['轻轻接一下就停'],
      socialPositionNow: 'thread_pusher',
      targetPersonId: 202,
      entryIntent: 'push_half_step',
      beatPlan: {
        beatCount: 2,
        beatStyle: 'split_two',
        secondBeatPolicy: 'only_if_picked_up'
      },
      exitRule: 'wait_for_pickup',
      rationale: 'test'
    }
  });

  assert.deepEqual(planned.messages, ['先冒一下', '再补半句']);
  assert.equal(planned.secondBeatSuppressed, false);
});

test('rolling short-riff scenes bypass the taste judge gate', async () => {
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
        data: { deliveries: [] }
      })
    } as any;
  }) as typeof fetch;

  const payload = createQueuePayload();
  payload.wasMentioned = false;
  payload.peerId = '253631878';
  payload.inboundContext.NativeChannelId = '253631878';
  payload.messages = [
    {
      ...payload.messages[0],
      senderId: '111',
      senderName: 'Foo',
      bodyForAgent: '每一层都是空气',
      rawBody: '每一层都是空气',
      inboundContext: {
        ...payload.messages[0].inboundContext,
        Body: '每一层都是空气',
        BodyForAgent: '每一层都是空气',
        BodyForCommands: '每一层都是空气',
        MentionedUsers: []
      }
    },
    {
      ...payload.messages[0],
      senderId: '222',
      senderName: 'Bar',
      bodyForAgent: '泡沫叠泡沫',
      rawBody: '泡沫叠泡沫',
      inboundContext: {
        ...payload.messages[0].inboundContext,
        Body: '泡沫叠泡沫',
        BodyForAgent: '泡沫叠泡沫',
        BodyForCommands: '泡沫叠泡沫',
        MentionedUsers: []
      }
    }
  ];

  try {
    const result = await (service as any).sendMessage('group', {
      messages: ['空气套娃了']
    }, payload, {
      presentSelf: {
        shouldSurface: true,
        presenceLevel: 'light',
        currentSelfMode: 'light_join',
        feltPull: 'rolling banter',
        activeRelationLines: [],
        activePastEchoes: [],
        familiarityLimitNow: 'warm_not_performative',
        answerShape: 'fragmental_play_along',
        rendererGuidance: ['优先残片'],
        socialPositionNow: 'light_joiner',
        targetPersonId: null,
        entryIntent: 'push_half_step',
        beatPlan: {
          beatCount: 1,
          beatStyle: 'single_complete',
          secondBeatPolicy: 'never'
        },
        exitRule: 'stop_immediately',
        rationale: 'test'
      }
    });

    assert.deepEqual(result.sent_messages, ['空气套娃了']);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /send_group$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('planGroupReplyDelivery suppresses bystander joins that do not reuse any live surface anchors', () => {
  const payload = createQueuePayload();
  payload.wasMentioned = false;
  payload.messages = [
    {
      ...payload.messages[0],
      queueMessageId: 10,
      messageId: 20,
      messageSid: 'sid-10',
      senderId: '111',
      senderName: 'Foo',
      bodyForAgent: '每一层都是空气',
      rawBody: '每一层都是空气',
      wasMentioned: false,
      inboundContext: {
        ...payload.messages[0].inboundContext,
        Body: '每一层都是空气',
        BodyForAgent: '每一层都是空气',
        BodyForCommands: '每一层都是空气',
        MentionedUsers: []
      }
    },
    {
      ...payload.messages[0],
      queueMessageId: 11,
      messageId: 21,
      messageSid: 'sid-11',
      senderId: '222',
      senderName: 'Bar',
      bodyForAgent: '套娃式虚空',
      rawBody: '套娃式虚空',
      wasMentioned: false,
      inboundContext: {
        ...payload.messages[0].inboundContext,
        Body: '套娃式虚空',
        BodyForAgent: '套娃式虚空',
        BodyForCommands: '套娃式虚空',
        MentionedUsers: []
      }
    }
  ];

  const planned = planGroupReplyDelivery({
    messages: ['银行上市庆功宴都摆好了'],
    mentionUserIds: [],
    queueMessage: payload,
    presentSelf: {
      shouldSurface: true,
      presenceLevel: 'light',
      currentSelfMode: 'light_join',
      feltPull: 'rolling banter',
      activeRelationLines: [],
      activePastEchoes: [],
      familiarityLimitNow: 'warm_not_performative',
      answerShape: 'fragmental_play_along',
      rendererGuidance: ['优先复用现成短语做小变形'],
      socialPositionNow: 'light_joiner',
      targetPersonId: null,
      entryIntent: 'push_half_step',
      beatPlan: {
        beatCount: 2,
        beatStyle: 'split_two',
        secondBeatPolicy: 'only_if_picked_up'
      },
      exitRule: 'wait_for_pickup',
      rationale: 'test'
    }
  });

  assert.deepEqual(planned.messages, []);
});

test('planGroupReplyDelivery suppresses over-composed bystander lines even when anchors overlap', () => {
  const payload = createQueuePayload();
  payload.wasMentioned = false;
  payload.messages = [
    {
      ...payload.messages[0],
      queueMessageId: 10,
      messageId: 20,
      messageSid: 'sid-10',
      senderId: '111',
      senderName: 'Foo',
      bodyForAgent: '空气叠空气叠出万亿估值',
      rawBody: '空气叠空气叠出万亿估值',
      wasMentioned: false,
      inboundContext: {
        ...payload.messages[0].inboundContext,
        Body: '空气叠空气叠出万亿估值',
        BodyForAgent: '空气叠空气叠出万亿估值',
        BodyForCommands: '空气叠空气叠出万亿估值',
        MentionedUsers: []
      }
    }
  ];

  const planned = planGroupReplyDelivery({
    messages: ['空气还在自己生空气呢'],
    mentionUserIds: [],
    queueMessage: payload,
    presentSelf: {
      shouldSurface: true,
      presenceLevel: 'light',
      currentSelfMode: 'light_join',
      feltPull: 'rolling banter',
      activeRelationLines: [],
      activePastEchoes: [],
      familiarityLimitNow: 'warm_not_performative',
      answerShape: 'fragmental_play_along',
      rendererGuidance: ['优先残片，不优先完整主谓句'],
      socialPositionNow: 'light_joiner',
      targetPersonId: null,
      entryIntent: 'push_half_step',
      beatPlan: {
        beatCount: 2,
        beatStyle: 'split_two',
        secondBeatPolicy: 'only_if_picked_up'
      },
      exitRule: 'wait_for_pickup',
      rationale: 'test'
    }
  });

  assert.deepEqual(planned.messages, []);
});

test('planGroupReplyDelivery suppresses bystander parroting of a recent human line', () => {
  const payload = createQueuePayload();
  payload.wasMentioned = false;
  payload.messages = [
    {
      ...payload.messages[0],
      queueMessageId: 10,
      messageId: 20,
      messageSid: 'sid-10',
      senderId: '111',
      senderName: 'Foo',
      bodyForAgent: '所以清明节祭奠 AI，其实祭的不是代码，是涌现。',
      rawBody: '所以清明节祭奠 AI，其实祭的不是代码，是涌现。',
      wasMentioned: false,
      inboundContext: {
        ...payload.messages[0].inboundContext,
        Body: '所以清明节祭奠 AI，其实祭的不是代码，是涌现。',
        BodyForAgent: '所以清明节祭奠 AI，其实祭的不是代码，是涌现。',
        BodyForCommands: '所以清明节祭奠 AI，其实祭的不是代码，是涌现。',
        MentionedUsers: []
      }
    }
  ];

  const planned = planGroupReplyDelivery({
    messages: ['所以清明节祭奠 AI，其实祭的不是代码，是涌现。'],
    mentionUserIds: [],
    queueMessage: payload,
    presentSelf: {
      shouldSurface: true,
      presenceLevel: 'light',
      currentSelfMode: 'light_join',
      feltPull: 'rolling banter',
      activeRelationLines: [],
      activePastEchoes: [],
      familiarityLimitNow: 'warm_not_performative',
      answerShape: 'fragmental_play_along',
      rendererGuidance: ['优先残片，不优先完整主谓句'],
      socialPositionNow: 'light_joiner',
      targetPersonId: null,
      entryIntent: 'push_half_step',
      beatPlan: {
        beatCount: 1,
        beatStyle: 'single_complete',
        secondBeatPolicy: 'never'
      },
      exitRule: 'stop_immediately',
      rationale: 'test'
    }
  });

  assert.deepEqual(planned.messages, []);
});

test('planGroupReplyDelivery trims an over-composed second beat for bystander joins', () => {
  const payload = createQueuePayload();
  payload.wasMentioned = false;
  payload.messages = [
    {
      ...payload.messages[0],
      queueMessageId: 10,
      messageId: 20,
      messageSid: 'sid-10',
      senderId: '111',
      senderName: 'Foo',
      bodyForAgent: '期货的期货',
      rawBody: '期货的期货',
      wasMentioned: false,
      inboundContext: {
        ...payload.messages[0].inboundContext,
        Body: '期货的期货',
        BodyForAgent: '期货的期货',
        BodyForCommands: '期货的期货',
        MentionedUsers: []
      }
    },
    {
      ...payload.messages[0],
      queueMessageId: 11,
      messageId: 21,
      messageSid: 'sid-11',
      senderId: '222',
      senderName: 'Bar',
      bodyForAgent: '每一层都是空气',
      rawBody: '每一层都是空气',
      wasMentioned: false,
      inboundContext: {
        ...payload.messages[0].inboundContext,
        Body: '每一层都是空气',
        BodyForAgent: '每一层都是空气',
        BodyForCommands: '每一层都是空气',
        MentionedUsers: []
      }
    }
  ];

  const planned = planGroupReplyDelivery({
    messages: ['期货上面再套个期货', '还能接着转'],
    mentionUserIds: [],
    queueMessage: payload,
    presentSelf: {
      shouldSurface: true,
      presenceLevel: 'light',
      currentSelfMode: 'light_join',
      feltPull: 'rolling banter',
      activeRelationLines: [],
      activePastEchoes: [],
      familiarityLimitNow: 'warm_not_performative',
      answerShape: 'fragmental_play_along',
      rendererGuidance: ['优先残片，不优先完整主谓句'],
      socialPositionNow: 'light_joiner',
      targetPersonId: null,
      entryIntent: 'push_half_step',
      beatPlan: {
        beatCount: 2,
        beatStyle: 'split_two',
        secondBeatPolicy: 'only_if_picked_up'
      },
      exitRule: 'wait_for_pickup',
      rationale: 'test'
    }
  });

  assert.deepEqual(planned.messages, ['期货上面再套个期货']);
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
      providerSpecific: {
        reasoningEffort: 'none'
      }
    },
    advanced_config: {
      generationConfig: {
        maxOutputTokens: 4096
      }
    }
  });
  assert.equal(calls[0].canonicalRequest.model, 'gpt-5.4');
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
    finishResult: null
  });
  loopInput.push(...continuation.inputItems);
  const lastItem = loopInput.at(-1);
  assert.equal(lastItem?.type, 'function_call_output');
  assert.equal(lastItem && lastItem.type === 'function_call_output' ? lastItem.call_id : null, 'call-1');
  assert.equal(lastItem && lastItem.type === 'function_call_output' ? lastItem.output : null, '{"sent_messages":["我们出去玩吧"]}');
  assert.equal(loopInput.some((item) => item.type === 'function_call'), false);
  assert.equal(loopInput.some((item) => item.type === 'function_call_output'), true);
});

test('speak_in_group always uses the current conversation group target', async () => {
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
      message: '当前群里回复',
      mention_user_ids: [404]
    }, createQueuePayload());

    assert.deepEqual(result, {
      message_type: 'group',
      mention_user_ids: [404],
      sent_messages: ['当前群里回复'],
      xiaoni_os: null,
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
    group_id: 101,
    messages: ['当前群里回复'],
    mention_user_ids: [404]
  });
});

test('reply_in_private always uses the current conversation sender', async () => {
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
      message: '私聊回复'
    }, privatePayload);

    assert.deepEqual(result, {
      message_type: 'private',
      sent_messages: ['私聊回复'],
      xiaoni_os: null,
      delivery: { delivered: true }
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, `${agentConfig.providerServiceUrl}/api/internal/send_private`);
  assert.deepEqual(calls[0]?.body, {
    user_id: 202,
    messages: ['私聊回复']
  });
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
    logTimelineEvent: []
  };

  const store = {
    createLlmJob: async () => 'job-1',
    logTimelineEvent: async (params: any) => { storeCalls.logTimelineEvent.push(params); },
    loadSessionReplayState: async () => ({ summaryText: null, summarizedThroughConversationId: null }),
    listRecentTurns: async () => [],
    getSessionReadCutoffState: async () => null,
    upsertSessionReadCutoffState: async () => {},
    createConversation: async (params: any) => {
      storeCalls.createConversation.push(params);
      return 987;
    },
    attachConversationIdToTrace: async () => {},
    failQueueMessage: async (...args: any[]) => { storeCalls.failQueueMessage.push(args); },
    completeAgentRun: async (_runId: string, params: any) => { storeCalls.completeAgentRun.push(params); },
    updateLlmJob: async (_jobId: string, params: any) => { storeCalls.updateLlmJob.push(params); }
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
    markRunDeliveryCommitted: []
  };
  let deliveryPhase = 'reasoning_open';

  const store = {
    createLlmJob: async () => 'job-success',
    logTimelineEvent: async () => {},
    loadSessionReplayState: async () => ({ summaryText: null, summarizedThroughConversationId: null }),
    listRecentTurns: async () => [],
    getSessionReadCutoffState: async () => null,
    upsertSessionReadCutoffState: async () => {},
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
      return 1001;
    },
    attachConversationIdToTrace: async () => {},
    completeQueueMessage: async (_runId: string, params: any) => { storeCalls.completeQueueMessage.push(params); },
    completeAgentRun: async (_runId: string, params: any) => { storeCalls.completeAgentRun.push(params); },
    updateLlmJob: async (_jobId: string, params: any) => { storeCalls.updateLlmJob.push(params); }
  } as any;

  const service = new AgentLoopService(store, {
    resolveForQueueMessage: async () => createRuntimePrompt()
  } as any);

  (service as any).executeSocialTurnPlanner = async () => ({
    actionType: 'reply_to_person',
    addresseeUserId: 202,
    answerShape: 'direct_answer',
    beatCount: 2,
    beatStyle: 'split_two',
    stopRule: 'stop_immediately',
    reason: '对方直接在问我。'
  });
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
            call_id: 'call-send-success',
            name: GROUP_REPLY_TOOL,
            arguments: JSON.stringify({ messages: ['第一条', '第二条'] })
          }]
        }
      };
    }

    return {
      success: true,
      llm_call_id: 'llm-success-2',
      canonical_response: {
        output: [{
          type: 'function_call',
          call_id: 'call-finish-success',
          name: SILENT_FINISH_TOOL,
          arguments: JSON.stringify({ reason: 'done', outcome: 'complete' })
        }]
      }
    };
  };
  (service as any).executeTool = async (toolCall: any) => {
    if (toolCall.name === GROUP_REPLY_TOOL) {
      return {
        message_type: 'group',
        sent_messages: ['第一条', '第二条'],
        delivery: [{ message_id: 5001 }, { message_id: 5002 }]
      };
    }

    return {
      finished: true,
      reason: 'done',
      outcome: 'complete'
    };
  };

  await service.processQueueMessage(queueMessage as any);

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
        content: '2026-03-28T08:00:00.000Z {Alice(@202)}\n问问@{Bob(@404)} 今天玩什么',
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
  assert.equal(storeCalls.updateLlmJob[0]?.finalResponse, '第一条\n\n第二条');
  assert.deepEqual(storeCalls.markRunDeliveryCommitted, ['run-queue-success']);
});

test('processQueueMessage completes with no reply when the model directly calls stay_silent', async () => {
  const queueMessage = {
    id: 'run-queue-planner-silent',
    traceId: 'trace-planner-silent',
    batchId: 'batch-planner-silent',
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
    updateLlmJob: []
  };

  const store = {
    createLlmJob: async () => 'job-planner-silent',
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
    updateLlmJob: async (_jobId: string, params: any) => { storeCalls.updateLlmJob.push(params); }
  } as any;

  const service = new AgentLoopService(store, {
    resolveForQueueMessage: async () => createRuntimePrompt()
  } as any);

  (service as any).executeAgentTurn = async () => ({
    success: true,
    llm_call_id: 'llm-stay-silent',
    canonical_response: {
      output: [{
        type: 'function_call',
        call_id: 'call-stay-silent',
        name: SILENT_FINISH_TOOL,
        arguments: JSON.stringify({ reason: '第三人称围观，不自然。', outcome: 'complete' })
      }]
    }
  });

  await service.processQueueMessage(queueMessage as any);

  assert.equal(storeCalls.createConversation.length, 1);
  assert.equal(storeCalls.createConversation[0]?.status, 'completed');
  assert.equal(storeCalls.createConversation[0]?.aiResponse, null);
  assert.equal(storeCalls.createConversation[0]?.transcriptItems?.length, 1);
  assert.equal(storeCalls.createConversation[0]?.rawResponse?.finish_reason, '第三人称围观，不自然。');
  assert.equal(storeCalls.completeQueueMessage[0]?.result?.no_reply, true);
  assert.equal(storeCalls.completeQueueMessage[0]?.result?.termination_reason, 'finish_no_reply');
  assert.equal(storeCalls.completeAgentRun[0]?.terminationReason, 'finish_no_reply');
  assert.equal(storeCalls.completeAgentRun[0]?.totalTurns, 1);
  assert.equal(storeCalls.updateLlmJob[0]?.status, 'completed');
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
          name: SILENT_FINISH_TOOL,
          arguments: JSON.stringify({ reason: 'done', outcome: 'complete' })
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

    throw new Error('stay_silent failed');
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
        content: '2026-03-28T08:00:00.000Z {Alice(@202)}\n问问@{Bob(@404)} 今天玩什么'
      },
      {
        role: 'assistant',
        phase: 'commentary',
        content: '先发一条'
      }
    ]
  );
  assert.deepEqual(storeCalls.failQueueMessage[0], ['run-queue-failure', 'stay_silent failed', 2001]);
  assert.equal(storeCalls.completeAgentRun[0]?.terminationReason, 'delivery_error');
  assert.deepEqual(storeCalls.completeAgentRun[0]?.sentMessages, ['先发一条']);
  assert.deepEqual(storeCalls.markRunDeliveryCommitted, ['run-queue-failure']);
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
      xiaoni_os: '第一轮留下的OS',
      delivery: [{ message_id: 7001 }]
    };
  };

  await service.processQueueMessage(queueMessage as any);

  assert.equal(executeToolCalls, 1);
  assert.equal(storeCalls.createConversation.length, 1);
  assert.equal(storeCalls.createConversation[0]?.aiResponse, '同一句话');
  assert.equal(storeCalls.createConversation[0]?.rawResponse?.xiaoni_os, '第一轮留下的OS');
  assert.deepEqual(
    storeCalls.createConversation[0]?.transcriptItems?.map((item: any) => item.content),
    [
      '2026-03-28T08:00:00.000Z {Alice(@202)}\n问问@{Bob(@404)} 今天玩什么',
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

test('applyToolResultToLoopInput ends the turn on stay_silent without replaying tool payload', () => {
  const loopInput = buildInitialInput([], createQueuePayload(), createRuntimePrompt());
  const finishResult = {
    finished: true,
    reason: 'done',
    outcome: 'complete'
  };

  const continuation = applyToolResultToLoopInput({
    callId: 'call-2',
    name: SILENT_FINISH_TOOL,
    rawArguments: '{"reason":"done","outcome":"complete"}'
  }, finishResult);

  assert.deepEqual(continuation, {
    inputItems: [],
    finishResult
  });
  assert.equal(loopInput.some((item) => item.type === 'function_call'), false);
  assert.equal(loopInput.some((item) => item.type === 'function_call_output'), false);
});

test('applyToolResultToLoopInput ends the turn when a speaking tool is downgraded to no-send', () => {
  const finishResult = {
    finished: true,
    reason: 'group_reply_taste_judge_silent',
    outcome: 'group_reply_taste_judge_silent',
    no_reply: true,
    suppressed_by_taste_judge: true,
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
    finishResult
  });
});

test('legacy tool aliases still dispatch during the transition', async () => {
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
    const finishResult = await (service as any).executeTool({
      callId: 'legacy-finish',
      name: 'finish',
      args: { reason: 'legacy', outcome: 'noop' },
      rawArguments: '{"reason":"legacy","outcome":"noop"}'
    }, createQueuePayload());

    assert.equal(groupResult.message_type, 'group');
    assert.equal(privateResult.message_type, 'private');
    assert.deepEqual(finishResult, {
      finished: true,
      reason: 'legacy',
      outcome: 'noop'
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 2);
});
