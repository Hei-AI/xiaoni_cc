import test from 'node:test';
import assert from 'node:assert/strict';
import { agentConfig } from '../config';
import { AgentLoopService, applyToolResultToLoopInput, buildCanonicalAgentTurnRequest, buildInitialInput, planGroupReplyDelivery } from '../services/agent-loop-service';
import { MissingAgentPromptBindingError, type ResolvedAgentRuntimePrompt } from '../services/agent-prompt-service';
import type { QueueMessagePayload } from '../types';

const PRIVATE_REPLY_TOOL = 'reply_in_private';
const GROUP_REPLY_TOOL = 'speak_in_group';
const SILENT_FINISH_TOOL = 'stay_silent';
const BUILD_MEMORY_RAG_CONTEXT_TOOL = 'build_memory_rag_context';
const RETRIEVE_MEMORY_HINTS_TOOL = 'retrieve_memory_hints';

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
  return item && typeof item === 'object' && 'type' in item && (item as any).type === 'message'
    ? String((item as any).content)
    : '';
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
  assert.match(String(request.instructions), /Runtime behavior contract:/);
  assert.match(String(request.instructions), /Group reply contract:/);
  assert.doesNotMatch(String(request.instructions), /Pre-reply memory gate:/);
  assert.doesNotMatch(String(request.instructions), /Present self reconstruction:/);
  assert.equal(request.input[0]?.type, 'message');
  assert.equal(request.input[0]?.role, 'user');
  assert.equal(request.input.some((item) => item.type === 'message' && item.role === 'system'), false);
  assert.equal(request.tool_choice, 'required');
  assert.equal(request.parallel_tool_calls, false);
  assert.deepEqual(
    request.tools.map((tool) => tool.function.name),
    [BUILD_MEMORY_RAG_CONTEXT_TOOL, RETRIEVE_MEMORY_HINTS_TOOL, GROUP_REPLY_TOOL, SILENT_FINISH_TOOL]
  );
  assert.match(String(request.tools[2]?.function.description), /mention_user_ids/);
  assert.match(String(request.tools[2]?.function.description), /不要为了强调语气、礼貌、格式整齐或装饰效果去 @ 人/);
  assert.deepEqual(request.tools[2]?.function.parameters.properties, {
    message: { type: 'string' },
    messages: {
      type: 'array',
      items: { type: 'string' }
    },
    mention_user_ids: {
      type: 'array',
      items: { type: 'integer' }
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
  assert.match(String(requestBody.canonicalRequest.instructions), /Runtime behavior contract:/);
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
  assert.doesNotMatch(currentPrompt, /Trace:/);
  assert.doesNotMatch(currentPrompt, /RunId:/);
  assert.doesNotMatch(currentPrompt, /BatchId:/);
  assert.doesNotMatch(currentPrompt, /SessionKey:/);
  assert.doesNotMatch(currentPrompt, /ToolUsage:/);
  assert.match(currentPrompt, /Conversation info:\n```json\n\{\n  "sequence": 1,\n  "chat_type": "group"\n\}\n```/);
  assert.match(currentPrompt, /Sender:\n```text\n\{Alice\(@202\)\}\n```/);
  assert.match(currentPrompt, /Mentions in current message:\n```text\n\[\{Bob\(@404\)\}\]\n```/);
  assert.match(currentPrompt, /Visible message text:\n```text\n问问@Bob 今天玩什么\n```/);
  assert.match(currentPrompt, /Message semantics:\n```json\n\{\n  "text": "问问@Bob 今天玩什么"\n\}\n```/);
  assert.doesNotMatch(currentPrompt, /\[mentioned bot\]/);
  assert.doesNotMatch(currentPrompt, /ChatType:/);
  assert.doesNotMatch(currentPrompt, /DefaultPrivateTarget:/);
  assert.doesNotMatch(currentPrompt, /DefaultGroupTarget:/);
});

test('buildInitialInput renders reply context and strips leading mention in message semantics', () => {
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

  assert.match(currentPrompt, /Visible message text:\n```text\n@Bob 嘿\n```/);
  assert.match(currentPrompt, /Message semantics:\n```json\n\{\n  "text": "嘿"\n\}\n```/);
  assert.match(currentPrompt, /Reply to:\n```json\n\{\n  "sender": "\{Carol\(@505\)\}",\n  "text": "上一条消息"\n\}\n```/);
});

test('buildInitialInput renders each message in a batch as its own structured block', () => {
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
  const currentPrompt = getMessageContent(loopInput.at(-1));

  assert.equal((currentPrompt.match(/Conversation info:/g) || []).length, 2);
  assert.match(currentPrompt, /"sequence": 1/);
  assert.match(currentPrompt, /"sequence": 2/);
  assert.match(currentPrompt, /Sender:\n```text\n\{Carol\(@606\)\}\n```/);
});

test('buildInitialInput does not append transcript summary to the system prompt by default', () => {
  const loopInput = buildInitialInput([], createQueuePayload(), createRuntimePrompt({
    systemPrompt: '你是小腻主AGENT'
  }), {
    summaryText: '这是一个固定记忆区摘要'
  });

  assert.equal(loopInput[0]?.type, 'message');
  assert.equal(loopInput[0]?.role, 'system');
  assert.match(String(loopInput[0]?.content), /Runtime behavior contract:/);
  assert.match(String(loopInput[0]?.content), /Group reply contract:/);
  assert.doesNotMatch(String(loopInput[0]?.content), /Conversation summary:/);
});

test('buildInitialInput does not append relationship memory cues to the system prompt by default', () => {
  const loopInput = buildInitialInput([], createQueuePayload(), createRuntimePrompt({
    systemPrompt: '你是小腻主AGENT'
  }), {
    relationshipMemory: {
      groupCards: [{
        id: 1,
        cardType: 'group_memory',
        groupId: 101,
        targetUserId: null,
        summaryText: '群里已经把奶茶圣经当成公共梗了',
        actors: ['20001', '20002'],
        contextBefore: '昨天已经有人拿这个梗互相打趣',
        trigger: '今天又被翻出来',
        interaction: '大家顺势接话',
        outcome: '这个梗已经稳定存在',
        sourceEventIds: [11],
        sourceMessageIds: [21, 22],
        decayedScore: 0.9,
        retrievalText: '群里已经把奶茶圣经当成公共梗了',
        embeddingText: '群里已经把奶茶圣经当成公共梗了',
        lastHitAt: null,
        metadata: {}
      }],
      currentUserCards: [{
        id: 2,
        cardType: 'person_memory',
        groupId: 101,
        targetUserId: 202,
        summaryText: '和当前发言人已经形成共享梗',
        actors: ['小腻', '202'],
        contextBefore: '前两次都能接住这个梗',
        trigger: '这次再次主动提起',
        interaction: '对话顺利续上',
        outcome: '关系又被强化了一次',
        sourceEventIds: [12],
        sourceMessageIds: [23],
        decayedScore: 0.8,
        retrievalText: '和当前发言人已经形成共享梗',
        embeddingText: '和当前发言人已经形成共享梗',
        lastHitAt: null,
        metadata: {}
      }],
      recentUserCards: []
    }
  });
  const systemContent = loopInput[0]?.type === 'message'
    ? String(loopInput[0].content)
    : '';

  assert.doesNotMatch(systemContent, /Relationship memory cues:/);
  assert.doesNotMatch(systemContent, /奶茶圣经/);
});

test('buildInitialInput appends pre-reply gate guidance as runtime input, not system instructions', () => {
  const loopInput = buildInitialInput([], createQueuePayload(), createRuntimePrompt({
    systemPrompt: '你是小腻主AGENT'
  }), {
    relationshipMemory: {
      groupCards: [{
        id: 1,
        cardType: 'group_memory',
        groupId: 101,
        targetUserId: null,
        summaryText: '群里已经把奶茶圣经当成公共梗了',
        actors: ['20001', '20002'],
        contextBefore: '昨天已经有人拿这个梗互相打趣',
        trigger: '今天又被翻出来',
        interaction: '大家顺势接话',
        outcome: '这个梗已经稳定存在',
        sourceEventIds: [11],
        sourceMessageIds: [21, 22],
        decayedScore: 0.9,
        retrievalText: '群里已经把奶茶圣经当成公共梗了',
        embeddingText: '群里已经把奶茶圣经当成公共梗了',
        lastHitAt: null,
        metadata: {}
      }]
    },
    preReplyMemoryGateDecision: {
      shouldReply: true,
      cueToBot: true,
      addresseeUserId: 202,
      relevantMemoryIds: [1],
      rationale: 'explicit_cue'
    }
  });

  const systemContent = loopInput[0]?.type === 'message'
    ? String(loopInput[0].content)
    : '';
  const runtimeGuidance = loopInput[1]?.type === 'message'
    ? String(loopInput[1].content)
    : '';

  assert.doesNotMatch(systemContent, /Pre-reply memory gate:/);
  assert.match(runtimeGuidance, /Runtime guidance:/);
  assert.match(runtimeGuidance, /Pre-reply memory gate:/);
  assert.match(runtimeGuidance, /当前主要对话对象 user_id: 202/);
  assert.match(runtimeGuidance, /只优先参考这些已命中的关系记忆卡: 1/);
  assert.match(runtimeGuidance, /先用最朴素自然的话接住/);
  assert.match(runtimeGuidance, /保持短句、自然、轻一点/);
  assert.doesNotMatch(systemContent, /Relationship memory cues:/);
});

test('buildInitialInput appends present self reconstruction as runtime input, not system instructions', () => {
  const loopInput = buildInitialInput([], createQueuePayload(), createRuntimePrompt({
    systemPrompt: '你是小腻主AGENT'
  }), {
    selfEvolution: {
      groupStates: [{
        id: 31,
        sessionKey: 'qq:group:101',
        groupId: 101,
        targetUserId: null,
        scopeType: 'group_self',
        version: 2,
        socialPresenceBaseline: 'light',
        entryPreference: 'cue_first',
        warmthBias: 'warm_light',
        familiarityCeiling: 'warm_not_performative',
        topicResonance: ['late_night_ping'],
        boundaryTendencies: { avoid_overexplaining: true },
        reinforcedModes: ['just_surfaced_relaxed'],
        suppressedModes: ['performative_explainer'],
        summaryText: '最近她在深夜点名场景里更自然地短句露头，但不再抢着解释。',
        sourceEventIds: [701],
        sourceMessageIds: [1701],
        metadata: {},
        updatedAt: '2026-04-03T09:00:00.000Z'
      }],
      currentUserStates: [],
      recentUserStates: []
    },
    presentSelf: {
      shouldSurface: true,
      presenceLevel: 'light',
      currentSelfMode: 'just_surfaced_but_relaxed',
      feltPull: 'they are checking whether I am around',
      activeRelationLines: ['with current sender: warm but still light'],
      activePastEchoes: ['late-night check-in pattern'],
      familiarityLimitNow: 'warm_not_performative',
      answerShape: 'brief_reassure_then_stop',
      rendererGuidance: ['先直接回应对方字面问题', '一句就停', '不要重梗'],
      socialPositionNow: 'targeted_responder',
      targetPersonId: 202,
      entryIntent: 'stick_to_person',
      beatPlan: {
        beatCount: 1,
        beatStyle: 'single_complete',
        secondBeatPolicy: 'never'
      },
      exitRule: 'stop_immediately',
      rationale: 'explicit ping plus familiar late-night vibe'
    }
  });

  const systemContent = loopInput[0]?.type === 'message'
    ? String(loopInput[0].content)
    : '';
  const runtimeGuidance = loopInput[1]?.type === 'message'
    ? String(loopInput[1].content)
    : '';

  assert.doesNotMatch(systemContent, /Present self reconstruction:/);
  assert.match(runtimeGuidance, /Runtime guidance:/);
  assert.match(runtimeGuidance, /Present self reconstruction:/);
  assert.match(runtimeGuidance, /这是已经收束好的渲染约束/);
  assert.doesNotMatch(runtimeGuidance, /current_self_mode:/);
  assert.match(runtimeGuidance, /answer_shape: brief_reassure_then_stop/);
  assert.match(runtimeGuidance, /social_position_now: targeted_responder/);
  assert.match(runtimeGuidance, /beat_plan: single_complete x1 \(never\)/);
  assert.match(runtimeGuidance, /一句就停/);
});

test('buildInitialInput appends topic continuity as runtime input when active topic projections exist', () => {
  const loopInput = buildInitialInput([], createQueuePayload(), createRuntimePrompt({
    systemPrompt: '你是小腻主AGENT'
  }), {
    topicProjection: {
      activeTopics: [{
        topicId: 91,
        versionId: 191,
        source: 'candidate',
        title: '奶茶圣经接梗',
        summaryText: '这群人最近在围绕奶茶圣经这个梗持续做短句滚动接话。',
        lifecycleState: 'active',
        topicKeywords: ['奶茶圣经', '接梗', '短句'],
        participantIds: [202, 204],
        relationshipSummaries: ['Alice 和小腻在这个梗里更适合一人半句往下接'],
        evidenceMessageIds: [21, 22],
        heatScore: 0.88,
        reviewPriorityScore: 0.74,
        updatedAt: '2026-04-05T11:00:00.000Z'
      }]
    }
  });

  const systemContent = loopInput[0]?.type === 'message'
    ? String(loopInput[0].content)
    : '';
  const runtimeGuidance = loopInput[1]?.type === 'message'
    ? String(loopInput[1].content)
    : '';

  assert.doesNotMatch(systemContent, /Topic continuity:/);
  assert.match(runtimeGuidance, /Topic continuity:/);
  assert.match(runtimeGuidance, /topic_1: 奶茶圣经接梗 \[candidate\/active\]/);
  assert.match(runtimeGuidance, /keywords: 奶茶圣经, 接梗, 短句/);
  assert.match(runtimeGuidance, /inside-topic lines: Alice 和小腻在这个梗里更适合一人半句往下接/);
});

test('buildInitialInput appends own-take guidance from present-self selection, not literal cue words', () => {
  const payload = createQueuePayload();
  payload.bodyForAgent = '@小腻 这轮我偏向先不上';
  payload.rawBody = '@小腻 这轮我偏向先不上';
  payload.inboundContext = {
    ...payload.inboundContext,
    Body: '@小腻 这轮我偏向先不上',
    BodyForAgent: '@小腻 这轮我偏向先不上',
    BodyForCommands: '@小腻 这轮我偏向先不上'
  };
  payload.messages = [{
    ...payload.messages[0],
    bodyForAgent: '@小腻 这轮我偏向先不上',
    rawBody: '@小腻 这轮我偏向先不上',
    inboundContext: {
      ...payload.messages[0].inboundContext,
      Body: '@小腻 这轮我偏向先不上',
      BodyForAgent: '@小腻 这轮我偏向先不上',
      BodyForCommands: '@小腻 这轮我偏向先不上'
    }
  }];

  const loopInput = buildInitialInput([], payload, createRuntimePrompt({
    systemPrompt: '你是小腻主AGENT'
  }), {
    presentSelf: {
      shouldSurface: true,
      presenceLevel: 'light',
      currentSelfMode: 'has_a_small_take',
      feltPull: 'they are explicitly asking what I think',
      activeRelationLines: ['with current sender: can answer directly'],
      activePastEchoes: ['recent debate'],
      familiarityLimitNow: 'warm_not_performative',
      answerShape: 'micro_take_then_stop',
      rendererGuidance: ['先给判断', '再补半句理由'],
      socialPositionNow: 'targeted_responder',
      targetPersonId: 202,
      entryIntent: 'stick_to_person',
      beatPlan: {
        beatCount: 1,
        beatStyle: 'single_complete',
        secondBeatPolicy: 'never'
      },
      exitRule: 'stop_immediately',
      rationale: 'opinion scene'
    }
  });

  const runtimeGuidance = loopInput[1]?.type === 'message'
    ? String(loopInput[1].content)
    : '';

  assert.match(runtimeGuidance, /Own take mode:/);
  assert.match(runtimeGuidance, /你需要给一个短而明确的判断/);
  assert.match(runtimeGuidance, /先给结论，再补半句理由/);
  assert.match(runtimeGuidance, /允许轻微不同意/);
});

test('buildInitialInput appends group reply contract for group chats', () => {
  const loopInput = buildInitialInput([], createQueuePayload(), createRuntimePrompt({
    systemPrompt: '你是小腻主AGENT'
  }));

  assert.equal(loopInput[0]?.type, 'message');
  assert.equal(loopInput[0]?.role, 'system');
  assert.match(String(loopInput[0]?.content), /^你是小腻主AGENT/);
  assert.match(String(loopInput[0]?.content), /Runtime behavior contract:\nGroup reply contract:/);
  assert.match(String(loopInput[0]?.content), /不是每句话都值得你回复/);
  assert.match(String(loopInput[0]?.content), /先用最朴素自然的话接住/);
  assert.match(String(loopInput[0]?.content), /如果你不确定这句话像不像真人群友，优先不要发，直接调用 stay_silent。/);
});

test('buildInitialInput does not append group reply contract for direct chats', () => {
  const loopInput = buildInitialInput([], createDirectQueuePayload(), createRuntimePrompt({
    systemPrompt: '你是小腻主AGENT'
  }));

  assert.equal(loopInput[0]?.type, 'message');
  assert.equal(loopInput[0]?.role, 'system');
  assert.equal(String(loopInput[0]?.content), '你是小腻主AGENT');
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
  assert.match(String(loopInput[0]?.content), /Runtime behavior contract:/);
  const currentMessage = loopInput.at(-1);
  assert.equal(currentMessage?.type, 'message');
  assert.equal(currentMessage?.role, 'user');
  assert.match(String(currentMessage?.content), /群上下文如下：/);
  assert.doesNotMatch(String(currentMessage?.content), /CurrentBatch:/);
  assert.match(String(currentMessage?.content), /签名：Alice/);
});

test('buildInitialInput replays structured transcript items in order and preserves assistant phase', () => {
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
      content: '#1 {Alice(@202)}: 第一条'
    },
    {
      type: 'message',
      role: 'assistant',
      phase: 'commentary',
      content: '我先看一下'
    },
    {
      type: 'message',
      role: 'assistant',
      phase: 'final_answer',
      content: '原因已经找到了'
    }
  ]);
});

test('buildInitialInput keeps runtime guidance out of instructions but ahead of the live turn', () => {
  const loopInput = buildInitialInput([], createQueuePayload(), createRuntimePrompt({
    systemPrompt: '你是小腻主AGENT'
  }), {
    preReplyMemoryGateDecision: {
      shouldReply: true,
      cueToBot: true,
      addresseeUserId: 202,
      relevantMemoryIds: [1],
      rationale: 'explicit_cue'
    }
  });

  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, loopInput, 'group');
  assert.match(String(request.instructions), /^你是小腻主AGENT/);
  assert.doesNotMatch(String(request.instructions), /Runtime guidance:/);
  assert.equal(request.input[0]?.type, 'message');
  assert.equal(request.input[0]?.role, 'user');
  assert.match(String(request.input[0]?.content), /Runtime guidance:/);
  assert.match(String(request.input[0]?.content), /Pre-reply memory gate:/);
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

test('executeTool builds memory rag context through the runtime store wrapper', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const service = new AgentLoopService({
    buildMemoryRagContext: async (params: Record<string, unknown>) => {
      calls.push(params);
      return {
        packSummary: 'stitched pack',
        timeScope: { oldestMessageAt: null, newestMessageAt: null },
        segments: [],
        bridgeNotes: []
      };
    }
  } as any);

  const result = await (service as any).executeTool({
    callId: 'call-rag',
    name: BUILD_MEMORY_RAG_CONTEXT_TOOL,
    args: {
      query_text: '历史上这段梗是怎么来的',
      memory_goal: 'old_topic_reactivation',
      target_token_budget: 16000,
      prefer_compact_bridge: true
    },
    rawArguments: '{}'
  }, createQueuePayload());

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    userId: 202,
    groupId: 101,
    currentMessageText: '历史上这段梗是怎么来的',
    recentUserIds: [],
    targetTokenBudget: 16000
  });
  assert.deepEqual(result, {
    memory_goal: 'old_topic_reactivation',
    query_text: '历史上这段梗是怎么来的',
    target_token_budget: 16000,
    prefer_compact_bridge: true,
    packSummary: 'stitched pack',
    timeScope: { oldestMessageAt: null, newestMessageAt: null },
    segments: [],
    bridgeNotes: []
  });
});

test('executeTool retrieves memory hints through the runtime store wrapper', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const service = new AgentLoopService({
    retrieveMemoryHints: async (params: Record<string, unknown>) => {
      calls.push(params);
      return {
        relationshipCards: [{ cardId: 1, score: 0.9, summary: '关系提示', trigger: null, interactionHint: null, avoidHint: null, evidenceMessageIds: [11] }],
        selfHints: [{ stateId: 2, summary: '自我提示', entryPreference: 'light', warmthBias: 'medium', familiarityCeiling: 'medium' }]
      };
    }
  } as any);

  const result = await (service as any).executeTool({
    callId: 'call-hints',
    name: RETRIEVE_MEMORY_HINTS_TOOL,
    args: {
      query_text: '这次该不该轻轻接一下',
      max_cards: 2,
      max_states: 1
    },
    rawArguments: '{}'
  }, createQueuePayload());

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    userId: 202,
    groupId: 101,
    currentMessageText: '这次该不该轻轻接一下',
    recentUserIds: [],
    maxCards: 2,
    maxStates: 1
  });
  assert.deepEqual(result, {
    query_text: '这次该不该轻轻接一下',
    relationshipCards: [{ cardId: 1, score: 0.9, summary: '关系提示', trigger: null, interactionHint: null, avoidHint: null, evidenceMessageIds: [11] }],
    selfHints: [{ stateId: 2, summary: '自我提示', entryPreference: 'light', warmthBias: 'medium', familiarityCeiling: 'medium' }]
  });
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
        content: '#1 {Alice(@202)} [mentioned bot]: 问问{Bob(@404)} 今天玩什么',
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

test('processQueueMessage short-circuits group runs when pre-reply memory gate decides to stay silent', async () => {
  const queueMessage = {
    id: 'run-queue-gated-silent',
    traceId: 'trace-gated-silent',
    batchId: 'batch-gated-silent',
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
    createLlmJob: async () => 'job-gated-silent',
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
      topicProjection: {
        activeTopics: [{
          topicId: 55,
          versionId: 155,
          source: 'candidate',
          title: '围观小腻在不在',
          summaryText: '群里这轮主要在围观小腻是否还在线。',
          lifecycleState: 'active',
          topicKeywords: ['小腻', '在不在'],
          participantIds: [202],
          relationshipSummaries: ['Alice 这轮是在点名确认小腻状态'],
          evidenceMessageIds: [201],
          heatScore: 0.7,
          reviewPriorityScore: 0.6,
          updatedAt: '2026-04-05T09:00:00.000Z'
        }]
      }
    }),
    listRecentTurns: async () => [],
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
    completeQueueMessage: async (_runId: string, params: any) => { storeCalls.completeQueueMessage.push(params); },
    completeAgentRun: async (_runId: string, params: any) => { storeCalls.completeAgentRun.push(params); },
    updateLlmJob: async (_jobId: string, params: any) => { storeCalls.updateLlmJob.push(params); }
  } as any;

  const service = new AgentLoopService(store, {
    resolveForQueueMessage: async () => createRuntimePrompt()
  } as any);

  (service as any).runPreReplyMemoryGate = async () => ({
    shouldReply: false,
    cueToBot: false,
    addresseeUserId: null,
    relevantMemoryIds: [17],
    rationale: 'third-person mention only'
  });
  (service as any).executeAgentTurn = async () => {
    throw new Error('executeAgentTurn should not run after pre-reply memory gate silence');
  };

  await service.processQueueMessage(queueMessage as any);

  assert.equal(storeCalls.createConversation.length, 1);
  assert.equal(storeCalls.createConversation[0]?.status, 'completed');
  assert.equal(storeCalls.createConversation[0]?.aiResponse, null);
  assert.equal(storeCalls.createConversation[0]?.transcriptItems?.length, 1);
  assert.equal(storeCalls.createConversation[0]?.rawResponse?.pre_reply_memory_gate?.shouldReply, false);
  assert.equal(storeCalls.createConversation[0]?.rawResponse?.pre_reply_memory_gate?.rationale, 'third-person mention only');
  assert.equal(storeCalls.createConversation[0]?.rawResponse?.topic_projection?.activeTopics?.[0]?.title, '围观小腻在不在');
  assert.equal(storeCalls.completeQueueMessage[0]?.result?.no_reply, true);
  assert.equal(storeCalls.completeQueueMessage[0]?.result?.termination_reason, 'finish_no_reply');
  assert.equal(storeCalls.completeAgentRun[0]?.terminationReason, 'finish_no_reply');
  assert.equal(storeCalls.completeAgentRun[0]?.totalTurns, 0);
  assert.equal(storeCalls.updateLlmJob[0]?.status, 'completed');
});

test('processQueueMessage short-circuits group runs when present self reconstruction decides not to surface', async () => {
  const queueMessage = {
    id: 'run-queue-present-self-silent',
    traceId: 'trace-present-self-silent',
    batchId: 'batch-present-self-silent',
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
    createLlmJob: async () => 'job-present-self-silent',
    logTimelineEvent: async () => {},
    loadSessionReplayState: async () => ({
      summaryText: '群里有人在确认小腻是不是还在',
      summarizedThroughConversationId: null,
      relationshipCards: { groupCards: [], currentUserCards: [], recentUserCards: [] },
      selfEvolution: { groupStates: [], currentUserStates: [], recentUserStates: [] }
    }),
    listRecentTurns: async () => [],
    getRunDeliveryState: async () => ({
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
    completeQueueMessage: async (_runId: string, params: any) => { storeCalls.completeQueueMessage.push(params); },
    completeAgentRun: async (_runId: string, params: any) => { storeCalls.completeAgentRun.push(params); },
    updateLlmJob: async (_jobId: string, params: any) => { storeCalls.updateLlmJob.push(params); }
  } as any;

  const service = new AgentLoopService(store, {
    resolveForQueueMessage: async () => createRuntimePrompt()
  } as any);

  (service as any).runPreReplyMemoryGate = async () => ({
    shouldReply: true,
    cueToBot: true,
    addresseeUserId: 202,
    relevantMemoryIds: [],
    rationale: 'explicit ping'
  });
  (service as any).runPresentSelfReconstruction = async () => ({
    shouldSurface: false,
    presenceLevel: 'light',
    currentSelfMode: 'withdrawn_after_check',
    feltPull: 'explicit ping but still should stay absent',
    activeRelationLines: [],
    activePastEchoes: [],
    familiarityLimitNow: 'warm_not_performative',
    answerShape: 'brief_reassure_then_stop',
    rendererGuidance: ['不要开口'],
    socialPositionNow: 'edge_observer',
    targetPersonId: 202,
    entryIntent: 'hover',
    beatPlan: {
      beatCount: 1,
      beatStyle: 'single_complete',
      secondBeatPolicy: 'never'
    },
    exitRule: 'stop_immediately',
    rationale: 'not the right moment to surface'
  });
  (service as any).executeAgentTurn = async () => {
    throw new Error('executeAgentTurn should not run after present self silence');
  };

  await service.processQueueMessage(queueMessage as any);

  assert.equal(storeCalls.createConversation.length, 1);
  assert.equal(storeCalls.createConversation[0]?.rawResponse?.present_self?.shouldSurface, false);
  assert.equal(storeCalls.completeQueueMessage[0]?.result?.no_reply, true);
  assert.equal(storeCalls.completeAgentRun[0]?.terminationReason, 'finish_no_reply');
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
        content: '#1 {Alice(@202)} [mentioned bot]: 问问{Bob(@404)} 今天玩什么'
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
      delivery: [{ message_id: 7001 }]
    };
  };

  await service.processQueueMessage(queueMessage as any);

  assert.equal(executeToolCalls, 1);
  assert.equal(storeCalls.createConversation.length, 1);
  assert.equal(storeCalls.createConversation[0]?.aiResponse, '同一句话');
  assert.deepEqual(
    storeCalls.createConversation[0]?.transcriptItems?.map((item: any) => item.content),
    [
      '#1 {Alice(@202)} [mentioned bot]: 问问{Bob(@404)} 今天玩什么',
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
    completeAgentRun: async (_runId: string, params: any) => { storeCalls.completeAgentRun.push(params); },
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
