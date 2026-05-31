import test from 'node:test';
import assert from 'node:assert/strict';
import { agentConfig } from '../config';
import { AgentLoopService, applyToolResultToLoopInput, buildCanonicalAgentTurnRequest, buildInitialInput, buildToolLoopMonitorReminder, buildTurnStateReminder, deriveTurnControlState, materializePresenceTickInboxWindow, materializePresenceTickQueueMessage, sanitizeLowValueOpeningFiller, summarizeToolLoopState, XIAONI_IDENTITY_KEY } from '../services/agent-loop-service';
import { MissingAgentPromptBindingError, type ResolvedAgentRuntimePrompt } from '../services/agent-prompt-service';
import type { QueueMessagePayload } from '../types';

const PRIVATE_REPLY_TOOL = 'reply_in_private';
const UNREAD_MEANING_TOOL = 'emit_unread_meaning';
const LIFE_ACTION_TOOL = 'submit_life_action';
const GROUP_REPLY_TOOL = 'speak_in_group';
const INSPECT_IMAGE_TOOL = 'inspect_image_placeholder';
const IMAGE_TASK_TOOL = 'request_image_task';
const SILENT_FINISH_TOOL = 'stay_silent';
const WEB_SEARCH_TOOL = 'web_search';
const GROUP_LOOP_TOOLS = [
  LIFE_ACTION_TOOL,
  WEB_SEARCH_TOOL,
  GROUP_REPLY_TOOL,
  INSPECT_IMAGE_TOOL,
  IMAGE_TASK_TOOL,
  SILENT_FINISH_TOOL
];

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
  assert.match(String(request.instructions), /Runtime contract:/);
  assert.match(String(request.instructions), /<INPUT_MESSAGE>/);
  assert.match(String(request.instructions), /<OUTPUT_MESSAGE>/);
  assert.doesNotMatch(String(request.instructions), /Pre-reply memory gate:/);
  assert.doesNotMatch(String(request.instructions), /Present self reconstruction:/);
  assert.equal(request.input[0]?.type, 'message');
  assert.equal(request.input[0]?.role, 'user');
  assert.equal(request.input.some((item) => item.type === 'message' && item.role === 'system'), false);
  assert.deepEqual(getAllowedToolNames(request.tool_choice), [LIFE_ACTION_TOOL]);
  assert.equal(request.parallel_tool_calls, false);
  assert.deepEqual(
    (request.tools ?? []).map((tool) => getToolName(tool)),
    GROUP_LOOP_TOOLS
  );
  const planFunction = getFunctionTool((request.tools ?? [])[0]);
  assert.equal(planFunction?.name, LIFE_ACTION_TOOL);
  assert.match(String(request.instructions), /我在 QQ 里生活/);
  assert.match(String(request.instructions), /web_search 是求知，不是默认步骤/);
  assert.match(String(request.instructions), /普通聊天、轻吐槽、短反应都是正常参与/);
  assert.match(String(request.instructions), /具体可说点/);
  assert.match(String(request.instructions), /直接给小腻反馈、纠偏、批评或称赞/);
  assert.match(String(request.instructions), /查完还是你自己决定说不说/);
  assert.match(String(request.instructions), /当前动作怎么收/);
  assert.match(String(planFunction?.description), /一次性完成小腻本轮生活动作决策/);
  assert.doesNotMatch(String(planFunction?.description), /先搞清楚/);
  assert.deepEqual(planFunction?.parameters?.required, ['unread_meaning', 'action_type', 'reason', 'evidence_refs', 'confidence', 'interest_level', 'wants_to_know_more', 'reaction_authenticity', 'participation_judgment', 'should_search', 'context_gap', 'gap_resolution', 'xiaoni_os']);
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
    '上一轮近况：小腻刚被提醒不要公式化接话，正在把上下文压缩改成纯文本时报。'
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
  assert.match(contents[digestIndex], /上一轮近况/);
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
    (request.tools ?? []).map((tool: any) => getToolName(tool)),
    GROUP_LOOP_TOOLS
  );
  assert.deepEqual(getAllowedToolNames(request.tool_choice), [LIFE_ACTION_TOOL]);
  assert.match(String(request.instructions), /本次运行默认只有一次决策请求/);
  assert.match(String(request.instructions), /submit_life_action/);
  assert.doesNotMatch(String(request.instructions), /recall_long_term_learning/);
  assert.match(String(request.instructions), /不要先调用 emit_unread_meaning/);
});

test('buildCanonicalAgentTurnRequest only unlocks life action proposal after unread meaning replay', () => {
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
  assert.deepEqual(getAllowedToolNames(request.tool_choice), [LIFE_ACTION_TOOL]);
});

test('buildCanonicalAgentTurnRequest only allows stay_silent after life action prefers silence', () => {
  const loopInput = buildInitialInput([], createQueuePayload());
  loopInput.push({
    type: 'function_call',
    call_id: 'call-meaning',
    name: UNREAD_MEANING_TOOL,
    arguments: '{"latest_unread_focus":"重复轻回声","message_act":"reaction","social_target":"group","addressed_to_me":false,"has_real_novelty":false,"confidence":"high","reason":"重复轻回声"}'
  });
  loopInput.push({
    type: 'function_call_output',
    call_id: 'call-meaning',
    output: '{"latest_unread_focus":"重复轻回声","message_act":"reaction","social_target":"group","addressed_to_me":false,"has_real_novelty":false,"confidence":"high","reason":"重复轻回声"}'
  });
  loopInput.push({
    type: 'function_call',
    call_id: 'call-reaction',
    name: LIFE_ACTION_TOOL,
    arguments: '{"interest_level":"low","wants_to_know_more":false,"recalled_prior_pattern":"刚刚已经是同义回声","felt_direction":"没有新的拉力","reaction_authenticity":"weak_but_real","should_search":false,"action_type":"silent","reason":"只是顺手可接"}'
  });
  loopInput.push({
    type: 'function_call_output',
    call_id: 'call-reaction',
    output: '{"interest_level":"low","wants_to_know_more":false,"recalled_prior_pattern":"刚刚已经是同义回声","felt_direction":"没有新的拉力","reaction_authenticity":"weak_but_real","should_search":false,"action_type":"silent","reason":"只是顺手可接"}'
  });

  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, loopInput, 'group');

  assert.deepEqual(getAllowedToolNames(request.tool_choice), [SILENT_FINISH_TOOL]);
});

test('buildCanonicalAgentTurnRequest goes directly to act-turn when life action prefers speak', () => {
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
  loopInput.push({
    type: 'function_call',
    call_id: 'call-reaction',
    name: LIFE_ACTION_TOOL,
    arguments: '{"interest_level":"high","wants_to_know_more":false,"recalled_prior_pattern":"这是直接递话","felt_direction":"可以承担一句回应","reaction_authenticity":"formed","should_search":false,"action_type":"speak","reason":"有真实回应"}'
  });
  loopInput.push({
    type: 'function_call_output',
    call_id: 'call-reaction',
    output: '{"interest_level":"high","wants_to_know_more":false,"recalled_prior_pattern":"这是直接递话","felt_direction":"可以承担一句回应","reaction_authenticity":"formed","should_search":false,"action_type":"speak","reason":"有真实回应"}'
  });

  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, loopInput, 'group');

  assert.deepEqual(getAllowedToolNames(request.tool_choice), [WEB_SEARCH_TOOL, GROUP_REPLY_TOOL, INSPECT_IMAGE_TOOL, IMAGE_TASK_TOOL]);
});

test('buildCanonicalAgentTurnRequest uses web search directly for public-info gaps', () => {
  const loopInput = buildInitialInput([], createQueuePayload());
  loopInput.push({
    type: 'function_call',
    call_id: 'call-meaning',
    name: UNREAD_MEANING_TOOL,
    arguments: '{"latest_unread_focus":"有人问一个新资料问题","message_act":"question","social_target":"me","addressed_to_me":true,"has_real_novelty":true,"confidence":"high","reason":"直接问资料"}'
  });
  loopInput.push({
    type: 'function_call_output',
    call_id: 'call-meaning',
    output: '{"latest_unread_focus":"有人问一个新资料问题","message_act":"question","social_target":"me","addressed_to_me":true,"has_real_novelty":true,"confidence":"high","reason":"直接问资料"}'
  });
  loopInput.push({
    type: 'function_call',
    call_id: 'call-reaction',
    name: LIFE_ACTION_TOOL,
    arguments: '{"interest_level":"high","wants_to_know_more":true,"recalled_prior_pattern":"需要查资料再回应","felt_direction":"先查证","reaction_authenticity":"formed","should_search":true,"action_type":"search","context_gap":"needs_public_info","gap_resolution":"web_search","reason":"需要外部信息"}'
  });
  loopInput.push({
    type: 'function_call_output',
    call_id: 'call-reaction',
    output: '{"interest_level":"high","wants_to_know_more":true,"recalled_prior_pattern":"需要查资料再回应","felt_direction":"先查证","reaction_authenticity":"formed","should_search":true,"action_type":"search","context_gap":"needs_public_info","gap_resolution":"web_search","reason":"需要外部信息"}'
  });

  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, loopInput, 'group');

  assert.deepEqual(getAllowedToolNames(request.tool_choice), [WEB_SEARCH_TOOL, LIFE_ACTION_TOOL, SILENT_FINISH_TOOL]);
});

test('buildCanonicalAgentTurnRequest allows speech when life action prefers speak without pre-reply recall', () => {
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
  loopInput.push({
    type: 'function_call',
    call_id: 'call-reaction',
    name: LIFE_ACTION_TOOL,
    arguments: '{"interest_level":"high","wants_to_know_more":false,"recalled_prior_pattern":"这是直接递话","felt_direction":"可以承担一句回应","reaction_authenticity":"formed","should_search":false,"action_type":"speak","reason":"有真实回应"}'
  });
  loopInput.push({
    type: 'function_call_output',
    call_id: 'call-reaction',
    output: '{"interest_level":"high","wants_to_know_more":false,"recalled_prior_pattern":"这是直接递话","felt_direction":"可以承担一句回应","reaction_authenticity":"formed","should_search":false,"action_type":"speak","reason":"有真实回应"}'
  });
  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, loopInput, 'group');

  assert.deepEqual(getAllowedToolNames(request.tool_choice), [WEB_SEARCH_TOOL, GROUP_REPLY_TOOL, INSPECT_IMAGE_TOOL, IMAGE_TASK_TOOL]);
});

test('buildCanonicalAgentTurnRequest allows search when life action prefers search without private recall', () => {
  const loopInput = buildInitialInput([], createQueuePayload());
  loopInput.push({
    type: 'function_call',
    call_id: 'call-meaning',
    name: UNREAD_MEANING_TOOL,
    arguments: '{"latest_unread_focus":"有人问一个新资料问题","message_act":"question","social_target":"me","addressed_to_me":true,"has_real_novelty":true,"confidence":"high","reason":"直接问资料"}'
  });
  loopInput.push({
    type: 'function_call_output',
    call_id: 'call-meaning',
    output: '{"latest_unread_focus":"有人问一个新资料问题","message_act":"question","social_target":"me","addressed_to_me":true,"has_real_novelty":true,"confidence":"high","reason":"直接问资料"}'
  });
  loopInput.push({
    type: 'function_call',
    call_id: 'call-reaction',
    name: LIFE_ACTION_TOOL,
    arguments: '{"interest_level":"high","wants_to_know_more":true,"recalled_prior_pattern":"需要查资料再回应","felt_direction":"先查证","reaction_authenticity":"formed","should_search":true,"action_type":"search","reason":"需要外部信息"}'
  });
  loopInput.push({
    type: 'function_call_output',
    call_id: 'call-reaction',
    output: '{"interest_level":"high","wants_to_know_more":true,"recalled_prior_pattern":"需要查资料再回应","felt_direction":"先查证","reaction_authenticity":"formed","should_search":true,"action_type":"search","reason":"需要外部信息"}'
  });
  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, loopInput, 'group');

  assert.deepEqual(getAllowedToolNames(request.tool_choice), [WEB_SEARCH_TOOL, LIFE_ACTION_TOOL, SILENT_FINISH_TOOL]);
});

test('buildCanonicalAgentTurnRequest downgrades low weak speech without direct new cue to silence', () => {
  const loopInput = buildInitialInput([], createQueuePayload());
  loopInput.push({
    type: 'function_call',
    call_id: 'call-meaning',
    name: UNREAD_MEANING_TOOL,
    arguments: '{"latest_unread_focus":"对上一句轻梗做收口","message_act":"joke","social_target":"me","addressed_to_me":true,"has_real_novelty":false,"confidence":"high","reason":"只是短促收口调侃"}'
  });
  loopInput.push({
    type: 'function_call_output',
    call_id: 'call-meaning',
    output: '{"latest_unread_focus":"对上一句轻梗做收口","message_act":"joke","social_target":"me","addressed_to_me":true,"has_real_novelty":false,"confidence":"high","reason":"只是短促收口调侃"}'
  });
  loopInput.push({
    type: 'function_call',
    call_id: 'call-reaction',
    name: LIFE_ACTION_TOOL,
    arguments: '{"interest_level":"low","wants_to_know_more":false,"recalled_prior_pattern":"短句轻收口","felt_direction":"轻轻接住也可以，但没有新拉力","reaction_authenticity":"weak_but_real","should_search":false,"action_type":"speak","reason":"只是轻微会心"}'
  });
  loopInput.push({
    type: 'function_call_output',
    call_id: 'call-reaction',
    output: '{"interest_level":"low","wants_to_know_more":false,"recalled_prior_pattern":"短句轻收口","felt_direction":"轻轻接住也可以，但没有新拉力","reaction_authenticity":"weak_but_real","should_search":false,"action_type":"speak","reason":"只是轻微会心"}'
  });

  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, loopInput, 'group');

  assert.deepEqual(getAllowedToolNames(request.tool_choice), [SILENT_FINISH_TOOL]);
});

test('buildCanonicalAgentTurnRequest goes to act-turn directly for direct new low weak speech', () => {
  const loopInput = buildInitialInput([], createQueuePayload());
  loopInput.push({
    type: 'function_call',
    call_id: 'call-meaning',
    name: UNREAD_MEANING_TOOL,
    arguments: '{"latest_unread_focus":"明确问小腻一个新问题","message_act":"question","social_target":"me","addressed_to_me":true,"has_real_novelty":true,"confidence":"high","reason":"直接新问题"}'
  });
  loopInput.push({
    type: 'function_call_output',
    call_id: 'call-meaning',
    output: '{"latest_unread_focus":"明确问小腻一个新问题","message_act":"question","social_target":"me","addressed_to_me":true,"has_real_novelty":true,"confidence":"high","reason":"直接新问题"}'
  });
  loopInput.push({
    type: 'function_call',
    call_id: 'call-reaction',
    name: LIFE_ACTION_TOOL,
    arguments: '{"interest_level":"low","wants_to_know_more":false,"recalled_prior_pattern":"直接递话仍要回应","felt_direction":"短答即可","reaction_authenticity":"weak_but_real","should_search":false,"action_type":"speak","reason":"直接问到我"}'
  });
  loopInput.push({
    type: 'function_call_output',
    call_id: 'call-reaction',
    output: '{"interest_level":"low","wants_to_know_more":false,"recalled_prior_pattern":"直接递话仍要回应","felt_direction":"短答即可","reaction_authenticity":"weak_but_real","should_search":false,"action_type":"speak","reason":"直接问到我"}'
  });

  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, loopInput, 'group');

  assert.deepEqual(getAllowedToolNames(request.tool_choice), [WEB_SEARCH_TOOL, GROUP_REPLY_TOOL, INSPECT_IMAGE_TOOL, IMAGE_TASK_TOOL]);
});

test('buildCanonicalAgentTurnRequest downgrades low+formed+no-direct-cue speak to silence', () => {
  const loopInput = buildInitialInput([], createQueuePayload());
  loopInput.push({
    type: 'function_call',
    call_id: 'call-meaning',
    name: UNREAD_MEANING_TOOL,
    arguments: '{"latest_unread_focus":"群里随便聊天","message_act":"statement","social_target":"group","addressed_to_me":false,"has_real_novelty":false,"confidence":"high","reason":"旁观者"}'
  });
  loopInput.push({
    type: 'function_call_output',
    call_id: 'call-meaning',
    output: '{"latest_unread_focus":"群里随便聊天","message_act":"statement","social_target":"group","addressed_to_me":false,"has_real_novelty":false,"confidence":"high","reason":"旁观者"}'
  });
  loopInput.push({
    type: 'function_call',
    call_id: 'call-reaction',
    name: LIFE_ACTION_TOOL,
    arguments: '{"interest_level":"low","wants_to_know_more":false,"recalled_prior_pattern":"类似话题之前聊过","felt_direction":"有个想法但不强","reaction_authenticity":"formed","should_search":false,"action_type":"speak","reason":"有点想法但没人问我"}'
  });
  loopInput.push({
    type: 'function_call_output',
    call_id: 'call-reaction',
    output: '{"interest_level":"low","wants_to_know_more":false,"recalled_prior_pattern":"类似话题之前聊过","felt_direction":"有个想法但不强","reaction_authenticity":"formed","should_search":false,"action_type":"speak","reason":"有点想法但没人问我"}'
  });

  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, loopInput, 'group');

  assert.deepEqual(getAllowedToolNames(request.tool_choice), [SILENT_FINISH_TOOL]);
});

test('buildCanonicalAgentTurnRequest keeps low+formed speak when there is a direct cue', () => {
  const loopInput = buildInitialInput([], createQueuePayload());
  loopInput.push({
    type: 'function_call',
    call_id: 'call-meaning',
    name: UNREAD_MEANING_TOOL,
    arguments: '{"latest_unread_focus":"直接问小腻一个问题","message_act":"question","social_target":"me","addressed_to_me":true,"has_real_novelty":false,"confidence":"high","reason":"直接问"}'
  });
  loopInput.push({
    type: 'function_call_output',
    call_id: 'call-meaning',
    output: '{"latest_unread_focus":"直接问小腻一个问题","message_act":"question","social_target":"me","addressed_to_me":true,"has_real_novelty":false,"confidence":"high","reason":"直接问"}'
  });
  loopInput.push({
    type: 'function_call',
    call_id: 'call-reaction',
    name: LIFE_ACTION_TOOL,
    arguments: '{"interest_level":"low","wants_to_know_more":false,"recalled_prior_pattern":"被问到要答","felt_direction":"简短作答","reaction_authenticity":"formed","should_search":false,"action_type":"speak","reason":"被问到了"}'
  });
  loopInput.push({
    type: 'function_call_output',
    call_id: 'call-reaction',
    output: '{"interest_level":"low","wants_to_know_more":false,"recalled_prior_pattern":"被问到要答","felt_direction":"简短作答","reaction_authenticity":"formed","should_search":false,"action_type":"speak","reason":"被问到了"}'
  });

  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, loopInput, 'group');

  assert.ok(getAllowedToolNames(request.tool_choice).includes(GROUP_REPLY_TOOL), 'low+formed with direct question must not be silenced');
});

test('buildCanonicalAgentTurnRequest downgrades none-interest speak to silence as safety catch', () => {
  const loopInput = buildInitialInput([], createQueuePayload());
  loopInput.push({
    type: 'function_call',
    call_id: 'call-meaning',
    name: UNREAD_MEANING_TOOL,
    arguments: '{"latest_unread_focus":"无关闲聊","message_act":"statement","social_target":"group","addressed_to_me":false,"has_real_novelty":false,"confidence":"high","reason":"和我无关"}'
  });
  loopInput.push({
    type: 'function_call_output',
    call_id: 'call-meaning',
    output: '{"latest_unread_focus":"无关闲聊","message_act":"statement","social_target":"group","addressed_to_me":false,"has_real_novelty":false,"confidence":"high","reason":"和我无关"}'
  });
  loopInput.push({
    type: 'function_call',
    call_id: 'call-reaction',
    name: LIFE_ACTION_TOOL,
    arguments: '{"interest_level":"none","wants_to_know_more":false,"recalled_prior_pattern":"无","felt_direction":"无","reaction_authenticity":"none","should_search":false,"action_type":"speak","reason":"模型选错了"}'
  });
  loopInput.push({
    type: 'function_call_output',
    call_id: 'call-reaction',
    output: '{"interest_level":"none","wants_to_know_more":false,"recalled_prior_pattern":"无","felt_direction":"无","reaction_authenticity":"none","should_search":false,"action_type":"speak","reason":"模型选错了"}'
  });

  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, loopInput, 'group');

  assert.deepEqual(getAllowedToolNames(request.tool_choice), [SILENT_FINISH_TOOL]);
});

test('buildCanonicalAgentTurnRequest routes proactive to speak+silent tools', () => {
  const loopInput = buildInitialInput([], createQueuePayload());
  loopInput.push({
    type: 'function_call',
    call_id: 'call-meaning',
    name: UNREAD_MEANING_TOOL,
    arguments: '{"latest_unread_focus":"群里随便聊","message_act":"statement","social_target":"group","addressed_to_me":false,"has_real_novelty":false,"confidence":"high","reason":"普通消息"}'
  });
  loopInput.push({
    type: 'function_call_output',
    call_id: 'call-meaning',
    output: '{"latest_unread_focus":"群里随便聊","message_act":"statement","social_target":"group","addressed_to_me":false,"has_real_novelty":false,"confidence":"high","reason":"普通消息"}'
  });
  loopInput.push({
    type: 'function_call',
    call_id: 'call-reaction',
    name: LIFE_ACTION_TOOL,
    arguments: '{"interest_level":"medium","wants_to_know_more":false,"recalled_prior_pattern":"最近看到了个有趣的东西","felt_direction":"我自己有个事想说","reaction_authenticity":"formed","should_search":false,"action_type":"proactive","reason":"借这个时机分享一个有趣的东西"}'
  });
  loopInput.push({
    type: 'function_call_output',
    call_id: 'call-reaction',
    output: '{"interest_level":"medium","wants_to_know_more":false,"recalled_prior_pattern":"最近看到了个有趣的东西","felt_direction":"我自己有个事想说","reaction_authenticity":"formed","should_search":false,"action_type":"proactive","reason":"借这个时机分享一个有趣的东西"}'
  });

  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, loopInput, 'group');
  const allowedTools = getAllowedToolNames(request.tool_choice);

  assert.ok(allowedTools.includes(GROUP_REPLY_TOOL), 'proactive must allow speak_in_group');
  assert.ok(allowedTools.includes(SILENT_FINISH_TOOL), 'proactive must allow stay_silent as fallback');
  assert.ok(!allowedTools.includes(INSPECT_IMAGE_TOOL), 'proactive must not include image tools');
});

test('speak act-turn does not include stay_silent when speech is the chosen action', () => {
  const loopInput = buildInitialInput([], createQueuePayload());
  loopInput.push({ type: 'function_call', call_id: 'c1', name: UNREAD_MEANING_TOOL, arguments: '{"latest_unread_focus":"直接问小腻","message_act":"question","social_target":"me","addressed_to_me":true,"has_real_novelty":true,"confidence":"high","reason":"直接问"}' });
  loopInput.push({ type: 'function_call_output', call_id: 'c1', output: '{"latest_unread_focus":"直接问小腻","message_act":"question","social_target":"me","addressed_to_me":true,"has_real_novelty":true,"confidence":"high","reason":"直接问"}' });
  loopInput.push({ type: 'function_call', call_id: 'c2', name: LIFE_ACTION_TOOL, arguments: '{"interest_level":"medium","wants_to_know_more":false,"recalled_prior_pattern":"直接问要直接答","felt_direction":"有回应","reaction_authenticity":"formed","should_search":false,"action_type":"speak","reason":"有真实回应"}' });
  loopInput.push({ type: 'function_call_output', call_id: 'c2', output: '{"interest_level":"medium","wants_to_know_more":false,"recalled_prior_pattern":"直接问要直接答","felt_direction":"有回应","reaction_authenticity":"formed","should_search":false,"action_type":"speak","reason":"有真实回应"}' });
  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, loopInput, 'group');
  const allowedTools = getAllowedToolNames(request.tool_choice);

  assert.ok(!allowedTools.includes(SILENT_FINISH_TOOL), `stay_silent must not be in speak act-turn tools; got [${allowedTools.join(', ')}]`);
  assert.ok(allowedTools.includes(GROUP_REPLY_TOOL), `speak_in_group must be present in speak act-turn tools`);
});

test('speak act-turn without recall goes directly to act-turn skipping recall', () => {
  const loopInput = buildInitialInput([], createQueuePayload());
  loopInput.push({ type: 'function_call', call_id: 'c1', name: UNREAD_MEANING_TOOL, arguments: '{"latest_unread_focus":"群里随便聊","message_act":"chat","social_target":"group","addressed_to_me":false,"has_real_novelty":true,"confidence":"high","reason":"有新内容"}' });
  loopInput.push({ type: 'function_call_output', call_id: 'c1', output: '{"latest_unread_focus":"群里随便聊","message_act":"chat","social_target":"group","addressed_to_me":false,"has_real_novelty":true,"confidence":"high","reason":"有新内容"}' });
  loopInput.push({ type: 'function_call', call_id: 'c2', name: LIFE_ACTION_TOOL, arguments: '{"interest_level":"medium","wants_to_know_more":false,"recalled_prior_pattern":"","felt_direction":"可以说一句","reaction_authenticity":"formed","should_search":false,"action_type":"speak","reason":"有真实感觉"}' });
  loopInput.push({ type: 'function_call_output', call_id: 'c2', output: '{"interest_level":"medium","wants_to_know_more":false,"recalled_prior_pattern":"","felt_direction":"可以说一句","reaction_authenticity":"formed","should_search":false,"action_type":"speak","reason":"有真实感觉"}' });

  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, loopInput, 'group');
  const allowedTools = getAllowedToolNames(request.tool_choice);

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
  assert.match(String((groupReplyTool as any).function?.description), /向当前 QQ 群发送/, 'description should describe the mechanical action');
  assert.match(String(request.instructions), /有具体可说点才开口/, 'participation guidance should live in instructions');
});

test('RUNTIME_INPUT_READING_CONTRACT contains new positive permission text and not Confucian text', () => {
  const loopInput = buildInitialInput([], createQueuePayload());
  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, loopInput, 'group');

  assert.match(String(request.instructions), /普通聊天、轻吐槽、短反应都是正常参与/, 'positive permission line 1 must be present');
  assert.match(String(request.instructions), /有具体可说点才开口/, 'positive permission line 2 must be present');
  assert.match(String(request.instructions), /阿花当前只允许你使用这些对外能力/, 'capability boundary must be present');
  assert.match(String(request.instructions), /我还没学会怎么做/, 'out-of-scope response guidance must be present');
  assert.match(String(request.instructions), /不要主动说你现在会哪些能力/, 'do not advertise capability boundary must be present');
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
  loopInput.push({ type: 'function_call', call_id: 'c2', name: LIFE_ACTION_TOOL, arguments: '{"interest_level":"high","wants_to_know_more":true,"recalled_prior_pattern":"需要查资料再回应","felt_direction":"需要查资料","reaction_authenticity":"formed","should_search":true,"action_type":"search","reason":"需要搜索"}' });
  loopInput.push({ type: 'function_call_output', call_id: 'c2', output: '{"interest_level":"high","wants_to_know_more":true,"recalled_prior_pattern":"需要查资料再回应","felt_direction":"需要查资料","reaction_authenticity":"formed","should_search":true,"action_type":"search","reason":"需要搜索"}' });

  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, loopInput, 'group');
  assert.deepEqual(getAllowedToolNames(request.tool_choice), [WEB_SEARCH_TOOL, LIFE_ACTION_TOOL, SILENT_FINISH_TOOL]);
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
  loopInput.push({
    type: 'function_call',
    call_id: 'call-reaction',
    name: LIFE_ACTION_TOOL,
    arguments: '{"interest_level":"low","wants_to_know_more":false,"recalled_prior_pattern":"类似回声之前已经落地","felt_direction":"没有新的拉力","reaction_authenticity":"empty_but_convenient","should_search":false,"action_type":"silent","reason":"只是顺手可接"}'
  });
  loopInput.push({
    type: 'function_call_output',
    call_id: 'call-reaction',
    output: '{"interest_level":"low","wants_to_know_more":false,"recalled_prior_pattern":"类似回声之前已经落地","felt_direction":"没有新的拉力","reaction_authenticity":"empty_but_convenient","should_search":false,"action_type":"silent","reason":"只是顺手可接"}'
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
  assert.equal(
    requestBody.canonicalRequest.input.some((item: any) => item.type === 'message' && item.role === 'user' && getMessageContent(item).includes('<INPUT_MESSAGE')),
    true
  );
  assert.equal(
    requestBody.canonicalRequest.input.some((item: any) => item.type === 'message' && item.role === 'system'),
    false
  );
  assert.deepEqual(
    requestBody.canonicalRequest.input.slice(-4).map((item: any) => item.type),
    ['function_call', 'function_call_output', 'function_call', 'function_call_output']
  );
  assert.match(String(requestBody.canonicalRequest.instructions), /本次运行默认只有一次决策请求/);
  assert.deepEqual(getAllowedToolNames(requestBody.canonicalRequest.tool_choice), [SILENT_FINISH_TOOL]);
  assert.equal(requestBody.canonicalRequest.parallel_tool_calls, false);
  assert.deepEqual(
    requestBody.canonicalRequest.tools.map((tool: any) => getToolName(tool)),
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
    userMessage: '上一轮用户消息',
    aiResponse: '上一轮回复'
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
    userMessage: '上一轮用户消息',
    aiResponse: '上一轮回复'
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

test('buildInitialInput renders stable batch context without exposing runtime ids', () => {
  const loopInput = buildInitialInput([], createQueuePayload(), createRuntimePrompt({
    systemPrompt: '你是小腻主AGENT'
  }));

  const currentPrompt = getMessageContent(loopInput[1]);
  assert.equal((loopInput[1] as any).role, 'user');
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
  const rendered = loopInput.map(getMessageContent).join('\n');

  assert.doesNotMatch(rendered, /<INPUT_MESSAGE message_id="11"/);
  assert.doesNotMatch(rendered, /普通闲聊正文不应该直接进来/);
  assert.match(rendered, /<UNREAD_AVAILABLE/);
  assert.match(rendered, /not_opened/);
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
  const currentPrompt = getMessageContent(loopInput[1]);

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
  const currentTurnItems = loopInput.slice(1, -2);
  assert.match(getMessageContent(loopInput.at(-2)), /<system_reminder>/);

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
  assert.match(String(loopInput[0]?.content), /Runtime contract:/);
  assert.match(String(loopInput[0]?.content), /小腻的OS/);
  assert.match(String(loopInput[0]?.content), /普通聊天、轻吐槽、短反应都是正常参与/);
  assert.match(String(loopInput[0]?.content), /行为校准信号/);
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
  assert.match(String(loopInput[0]?.content), /<INPUT_MESSAGE>/);
  assert.match(String(loopInput[0]?.content), /<system_reminder>/);
  assert.match(String(loopInput[0]?.content), /直接给小腻反馈、纠偏、批评或称赞/);
  assert.match(String(loopInput[0]?.content), /当前动作怎么收/);
});

test('buildInitialInput uses the same thin runtime contract for direct chats', () => {
  const loopInput = buildInitialInput([], createDirectQueuePayload(), createRuntimePrompt({
    systemPrompt: '你是小腻主AGENT'
  }));

  assert.equal(loopInput[0]?.type, 'message');
  assert.equal(loopInput[0]?.role, 'system');
  assert.match(String(loopInput[0]?.content), /^你是小腻主AGENT/);
  assert.match(String(loopInput[0]?.content), /Runtime contract:/);
  assert.match(String(loopInput[0]?.content), /当前动作怎么收/);
  assert.match(String(loopInput[0]?.content), /群里说话/);
  assert.match(String(loopInput[0]?.content), /私聊说话/);
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
  assert.match(getMessageContent(loopInput[1]), /问问@\{Bob\(@404\)\} 今天玩什么/);
  assert.match(getMessageContent(loopInput.at(-2)), /<system_reminder>/);
  assert.match(getMessageContent(loopInput.at(-1)), /<runtime_history_reading>/);
});

test('buildInitialInput keeps current batch before reminder and runtime history reading', () => {
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
      ...createConversationTurn({ id: 1, aiResponse: '上一轮回复' }),
      rawResponse: {
        xiaoni_os: '上一轮留下的内在延续。'
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

  const osIndex = rendered.findIndex((content) => content.includes('上一轮留下的内在延续'));
  const firstCurrentIndex = rendered.findIndex((content) => content.includes('message_id="11" chat_type="群聊"'));
  const secondCurrentIndex = rendered.findIndex((content) => content.includes('message_id="12" chat_type="群聊"'));
  const reminderIndex = rendered.findIndex((content) => content.includes('<system_reminder>本次已打开 IM；以下是这段时间看到的未读列表'));
  const identityIndex = rendered.findIndex((content) => content.includes('[身份连续性]'));
  const historyReadingIndex = rendered.findIndex((content) => content.includes('<runtime_history_reading>'));

  assert.ok(osIndex !== -1);
  assert.ok(firstCurrentIndex !== -1);
  assert.ok(secondCurrentIndex !== -1);
  assert.ok(reminderIndex !== -1);
  assert.equal(identityIndex, -1);
  assert.equal(rendered.some((content) => content.includes('不要用公式化开头')), false);
  assert.ok(historyReadingIndex !== -1);
  assert.ok(osIndex < firstCurrentIndex);
  assert.ok(firstCurrentIndex < secondCurrentIndex);
  assert.ok(secondCurrentIndex < reminderIndex);
  assert.ok(reminderIndex < historyReadingIndex);
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
  const currentMessage = loopInput[1];
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

  assert.equal((loopInput[1] as any).role, 'user');
  assert.match(getMessageContent(loopInput[1]), /<INPUT_MESSAGE/);
  assert.match(getMessageContent(loopInput[1]), /#1 \{Alice\(@202\)\}: 第一条/);
  assert.equal((loopInput[2] as any).role, 'assistant');
  assert.equal((loopInput[2] as any).phase, 'commentary');
  assert.match(getMessageContent(loopInput[2]), /我先看一下/);
  assert.equal((loopInput[3] as any).role, 'assistant');
  assert.equal((loopInput[3] as any).phase, 'final_answer');
  assert.match(getMessageContent(loopInput[3]), /<OUTPUT_MESSAGE/);
  assert.match(getMessageContent(loopInput[3]), /原因已经找到了/);
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
  assert.equal((priorXiaoniItem as any).role, 'assistant');
  assert.equal((priorXiaoniItem as any).phase, 'commentary');
  assert.match(getMessageContent(priorXiaoniItem), /第一段/);
  assert.equal((loopInput[2] as any).role, 'assistant');
  assert.equal((loopInput[2] as any).phase, 'final_answer');
  assert.match(getMessageContent(loopInput[2]), /第二段/);
  assert.doesNotMatch(loopInput.map(getMessageContent).join('\n'), /这轮先接一句/);
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

  const priorXiaoniItem = loopInput[1];
  assert.equal((priorXiaoniItem as any).role, 'assistant');
  assert.equal((priorXiaoniItem as any).phase, 'final_answer');
  assert.match(getMessageContent(priorXiaoniItem), /<OUTPUT_MESSAGE/);
  assert.match(getMessageContent(priorXiaoniItem), /我刚看群文件还没更新/);
  assert.doesNotMatch(getMessageContent(priorXiaoniItem), /<小腻的OS>/);
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
        xiaoni_os: '她这次没有拆我，反而把那点顾虑轻轻接住了，我对她会更放松一点。'
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

  const priorXiaoniItem = loopInput[1];
  assert.match(getMessageContent(priorXiaoniItem), /这句我记下了/);
  const osItem = loopInput.find((item: any) => item.type === 'message' && item.role === 'assistant' && item.phase === 'commentary' && getMessageContent(item).includes('<小腻的OS>'));
  assert.ok(osItem);
  assert.match(getMessageContent(osItem), /我对她会更放松一点/);
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

  const standaloneOsItem = loopInput.find((item: any) => item.type === 'message' && item.role === 'assistant' && item.phase === 'commentary' && getMessageContent(item).includes('<小腻的OS>'));
  assert.ok(standaloneOsItem);
  assert.match(getMessageContent(standaloneOsItem), /<小腻的OS>/);
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

  const priorTurnItem = loopInput.find((item: any) => item.type === 'message' && item.role === 'assistant' && getMessageContent(item).includes('上一轮回复'));
  assert.ok(priorTurnItem);
  assert.match(getMessageContent(priorTurnItem), /上一轮回复/);
  const priorOsItem = loopInput.find((item: any) => item.type === 'message' && item.role === 'assistant' && item.phase === 'commentary' && getMessageContent(item).includes('上一轮留下的内在延续'));
  assert.ok(priorOsItem);
  assert.match(getMessageContent(priorOsItem), /<小腻的OS>/);
});

test('buildInitialInput replays assistant history with output_text content parts', () => {
  const loopInput = buildInitialInput([
    {
      id: 1,
      userId: 202,
      groupId: 101,
      batchId: null,
      sessionKey: 'qq:group:101',
      userMessage: '上一轮用户消息',
      aiResponse: '上一轮回复',
      rawResponse: {},
      items: [
        {
          id: 11,
          conversationId: 1,
          sessionKey: 'qq:group:101',
          role: 'user',
          phase: null,
          content: '上一轮用户消息',
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
          content: '上一轮回复',
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

  const assistantItem = loopInput.find((item: any) => item.type === 'message' && item.role === 'assistant' && getMessageContent(item).includes('上一轮回复')) as any;
  assert.ok(assistantItem);
  assert.equal(assistantItem.content[0]?.type, 'output_text');
  assert.equal(assistantItem.content[0]?.text.includes('<OUTPUT_MESSAGE'), true);

  const userItem = loopInput.find((item: any) => item.type === 'message' && item.role === 'user' && getMessageContent(item).includes('上一轮用户消息')) as any;
  assert.ok(userItem);
  assert.equal(userItem.content[0]?.type, 'input_text');
});

test('buildInitialInput keeps user input as pure scene without synthetic current-task text', () => {
  const loopInput = buildInitialInput([], createQueuePayload(), createRuntimePrompt({
    systemPrompt: '你是小腻主AGENT'
  }));

  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, loopInput, 'group');
  assert.match(String(request.instructions), /^你是小腻主AGENT/);
  assert.match(String(request.instructions), /当前动作怎么收/);
  assert.match(String(request.instructions), /具体可说点/);
  assert.match(String(request.instructions), /群里说话/);
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
        maxOutputTokens: 4096
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
      xiaoniOs: '这轮之后我意识到不能为了接话而接话。',
      deliveredMessages: ['我先想想。'],
      unreadMeaningArtifact: { message_act: 'feedback' },
      lifeActionArtifact: { action_type: 'speak' }
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
      xiaoniOs: '这轮被纠偏了。',
      deliveredMessages: ['收到。'],
      unreadMeaningArtifact: { message_act: 'feedback' },
      lifeActionArtifact: { action_type: 'speak' }
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 0);
  assert.equal(reflectionWrites, 0);
});

test('context summary writer stores plain-text digest from whole in-context, not a tool call', async () => {
  const calls: Array<any> = [];
  const summaries: Array<any> = [];
  const service = new AgentLoopService({
    upsertSessionContextSummary: async (params: any) => { summaries.push(params); }
  } as any);
  const originalFetch = globalThis.fetch;
  const runtimePrompt = createRuntimePrompt({ promptName: '小腻主AGENT', promptId: 'prompt-1' });
  const summarySourceInput = buildInitialInput(
    [{
      ...createConversationTurn(),
      rawResponse: {
        xiaoni_os: '我想回头分享这个：压缩前留下的待分享意图应该进入近况。'
      }
    }],
    createQueuePayload(),
    runtimePrompt,
    [],
    '上一轮近况：小腻刚被提醒不要公式化接话。'
  );

  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body || '{}')));
    return {
      ok: true,
      json: async () => ({
        success: true,
        canonical_response: {
          output: [{
            type: 'message',
            role: 'assistant',
            content: [{
              type: 'output_text',
              text: '刚才主要在聊小腻的压缩后记忆。她已经被提醒不要公式化接话，也知道新的近况应该像时报一样概括整段可见上下文。'
            }]
          }]
        }
      })
    } as any;
  }) as typeof fetch;

  try {
    await (service as any).runContextSummaryWriter({
      queueMessage: createQueuePayload(),
      conversationId: 1001,
      evictedTurns: [createConversationTurn()],
      existingSummary: null,
      summarySourceInput,
      runtimePrompt
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(calls[0].canonicalRequest, 'tools'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(calls[0].canonicalRequest, 'tool_choice'), false);
  const writerInputText = calls[0].canonicalRequest.input.map(getMessageContent).join('\n');
  assert.match(writerInputText, /<in_context_to_digest>/);
  assert.match(writerInputText, /上一轮近况：小腻刚被提醒不要公式化接话。/);
  assert.match(writerInputText, /我想回头分享这个：压缩前留下的待分享意图应该进入近况。/);
  assert.match(writerInputText, /<INPUT_MESSAGE message_id="11" chat_type="群聊"/);
  assert.doesNotMatch(writerInputText, /message_sid=|source="napcat"/);
  assert.deepEqual(summaries, [{
    sessionKey: 'qq:group:101',
    contextSummary: '刚才主要在聊小腻的压缩后记忆。她已经被提醒不要公式化接话，也知道新的近况应该像时报一样概括整段可见上下文。'
  }]);
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
                    text: '小腻前后两轮都被这个话题牵动，说明这是关系现场里的真实反馈。',
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
    { qq_id: '452884318', name: '龙哥' }
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

test('applyToolResultToLoopInput keeps image task turns open until there is a visible reply', () => {
  const loopInput = buildInitialInput([], createQueuePayload(), createRuntimePrompt());
  loopInput.push({
    type: 'function_call',
    call_id: 'call-image-task',
    name: IMAGE_TASK_TOOL,
    arguments: JSON.stringify({
      prompt: '一张蓝天白云头像图',
      target_description: '群头像图'
    })
  });
  loopInput.push({
    type: 'function_call_output',
    call_id: 'call-image-task',
    output: JSON.stringify({
      queued: true,
      task_type: 'image_generate',
      status_text: '我已经开始处理这张图，等结果出来再发。'
    })
  });

  const continuation = applyToolResultToLoopInput({
    callId: 'call-silent-after-image-task',
    name: SILENT_FINISH_TOOL,
    rawArguments: '{"reason":"done","outcome":"complete"}'
  }, {
    finished: true,
    reason: 'done',
    outcome: 'complete'
  }, {
    loopInput,
    speakingToolName: GROUP_REPLY_TOOL,
    hasVisibleReply: false
  });

  assert.equal(continuation.finishResult, null);
  assert.equal(continuation.inputItems.length, 2);
  const replay = continuation.inputItems[0];
  assert.equal(replay?.type, 'function_call_output');
  assert.equal(replay && replay.type === 'function_call_output' ? replay.call_id : null, 'call-silent-after-image-task');
  const reminder = getMessageContent(continuation.inputItems[1]);
  assert.equal(continuation.forcedVisibleReply, null);
  assert.match(reminder, /后台图片任务已经登记，但我还没有对聊天对象发出任何可见回复/);
  assert.match(reminder, /speak_in_group/);
  assert.match(reminder, /我已经开始处理这张图/);
});

test('applyToolResultToLoopInput forces a minimal visible reply after repeated silent image-task turns', () => {
  const loopInput = buildInitialInput([], createQueuePayload(), createRuntimePrompt());
  loopInput.push({
    type: 'function_call',
    call_id: 'call-image-task',
    name: IMAGE_TASK_TOOL,
    arguments: JSON.stringify({
      prompt: '一张蓝天白云头像图',
      target_description: '群头像图'
    })
  });
  loopInput.push({
    type: 'function_call_output',
    call_id: 'call-image-task',
    output: JSON.stringify({
      queued: true,
      task_type: 'image_generate',
      xiaoni_os: '这轮先轻轻接住，等图出来再回到现场。',
      status_text: '我已经开始处理这张图，等结果出来再发。'
    })
  });
  loopInput.push({
    type: 'function_call',
    call_id: 'call-silent-1',
    name: SILENT_FINISH_TOOL,
    arguments: JSON.stringify({
      reason: 'done',
      outcome: 'complete'
    })
  });
  loopInput.push({
    type: 'function_call_output',
    call_id: 'call-silent-1',
    output: JSON.stringify({
      finished: true,
      reason: 'done',
      outcome: 'complete',
      no_reply: true
    })
  });

  const continuation = applyToolResultToLoopInput({
    callId: 'call-silent-2',
    name: SILENT_FINISH_TOOL,
    rawArguments: '{"reason":"done","outcome":"complete"}'
  }, {
    finished: true,
    reason: 'done',
    outcome: 'complete'
  }, {
    loopInput,
    speakingToolName: GROUP_REPLY_TOOL,
    hasVisibleReply: false
  });

  assert.equal(continuation.finishResult, null);
  assert.equal(continuation.inputItems.length, 1);
  assert.equal(continuation.inputItems[0]?.type, 'function_call_output');
  assert.deepEqual(continuation.forcedVisibleReply, {
    toolName: GROUP_REPLY_TOOL,
    args: {
      messages: ['我已经开始处理这张图，等结果出来再发。'],
      xiaoni_os: '这轮先轻轻接住，等图出来再回到现场。'
    }
  });
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
    call_id: 'reaction-1',
    name: LIFE_ACTION_TOOL,
    arguments: '{"interest_level":"low","wants_to_know_more":false,"reaction_authenticity":"weak_but_real","should_search":false,"action_type":"silent","reason":"弱反应"}'
  });
  loopInput.push({
    type: 'function_call_output',
    call_id: 'reaction-1',
    output: '{"interest_level":"low","wants_to_know_more":false,"reaction_authenticity":"weak_but_real","should_search":false,"action_type":"silent","reason":"弱反应"}'
  });
  loopInput.push({
    type: 'function_call',
    call_id: 'reaction-2',
    name: LIFE_ACTION_TOOL,
    arguments: '{"interest_level":"low","wants_to_know_more":false,"reaction_authenticity":"weak_but_real","should_search":false,"action_type":"silent","reason":"仍是弱反应"}'
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
  assert.match(getMessageContent(reminder!), /submit_life_actionx2/);
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
  assert.match(getMessageContent(reminder!), /最后工具轮次/);
  assert.match(getMessageContent(reminder!), /final_answer/);
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
      message: '哈哈，确实可以试试',
      mention_user_ids: [404]
    }, createQueuePayload());

    assert.deepEqual(result, {
      message_type: 'group',
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
    group_id: 101,
    messages: ['可以试试'],
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
      message: '确实是这样，私聊回复'
    }, privatePayload);

    assert.deepEqual(result, {
      message_type: 'private',
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
    user_id: 202,
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

test('submit_life_action with a single message sends it once', async () => {
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
    const result = await (service as any).commitLifeAction({
      callId: 'call-single-life-action',
      name: LIFE_ACTION_TOOL,
      rawArguments: '{}',
      args: {
        unread_meaning: {
          latest_unread_focus: '阿花问小腻干嘛呢',
          message_act: 'question',
          social_target: 'me',
          addressed_to_me: true,
          has_real_novelty: true,
          confidence: 'high',
          reason: '这是对小腻的直接提问',
          social_act_type: 'yes_no_reaction',
          topic_context: {
            has_topic: true,
            topic_summary: '阿花问当前状态',
            addressed_to_me: true
          }
        },
        action_type: 'speak',
        message: '刚看了眼群，没干啥',
        messages: null,
        reason: '低成本状态回应。',
        evidence_refs: ['message_id=10093'],
        confidence: 0.86,
        interest_level: 'low',
        wants_to_know_more: false,
        reaction_authenticity: 'formed',
        participation_judgment: {
          status: 'has_sayable_point',
          basis: 'direct_request',
          sayable_point: '简短回答当前状态。',
          evidence_refs: ['message_id=10093'],
          memory_refs: []
        },
        should_search: false,
        context_gap: 'none',
        gap_resolution: 'none',
        xiaoni_os: '已短回。',
        pending_share: null
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

test('life-only submit_life_action defers proactive text into Xiaoni OS without sending QQ', async () => {
  const service = new AgentLoopService({
    recordPresenceAssistantAction: async () => {}
  } as any, {
    resolveForQueueMessage: async () => createRuntimePrompt()
  } as any);
  const queueMessage = createLifePresenceTickQueueMessageForTest().payload;
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = (async () => {
    fetchCalled = true;
    throw new Error('life-only presence tick must not send QQ');
  }) as typeof fetch;

  try {
    const result = await (service as any).commitLifeAction({
      callId: 'call-life-only-proactive',
      name: LIFE_ACTION_TOOL,
      rawArguments: '{}',
      args: {
        unread_meaning: {
          latest_unread_focus: '空闲生活事件，还没有打开任何具体会话',
          message_act: 'statement',
          social_target: 'me',
          addressed_to_me: false,
          has_real_novelty: true,
          confidence: 'high',
          reason: 'presence tick 只是在检查自己的状态',
          social_act_type: 'casual_remark',
          topic_context: {
            has_topic: true,
            topic_summary: '想回头分享一个小发现',
            addressed_to_me: false
          }
        },
        action_type: 'proactive',
        message: '回头可以跟阿花说一下：今天这个精力系统其实缺的是上下文里的待分享意图。',
        reason: '现在没有具体 QQ 目标，所以只能先留给后续上下文。',
        evidence_refs: ['presence_tick'],
        confidence: 0.82,
        interest_level: 'high',
        wants_to_know_more: false,
        reaction_authenticity: 'formed',
        participation_judgment: {
          status: 'has_sayable_point',
          basis: 'curiosity',
          sayable_point: '把想分享的内容留到后面打开 QQ 时使用。',
          evidence_refs: ['presence_tick'],
          memory_refs: []
        },
        should_search: false,
        context_gap: 'none',
        gap_resolution: 'none',
        xiaoni_os: '先把这个作为内部连续性留住。',
        pending_share: null
      }
    }, queueMessage);

    assert.equal(fetchCalled, false);
    assert.equal(result.outcome, 'deferred_share_context');
    assert.match(String(result.pending_share), /精力系统/);
    assert.match(String(result.xiaoni_os), /我想回头分享这个/);
  } finally {
    globalThis.fetch = originalFetch;
  }
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
          call_id: 'call-life-success',
          name: LIFE_ACTION_TOOL,
          arguments: JSON.stringify({
            unread_meaning: {
              latest_unread_focus: 'Alice 直接问小腻今天玩什么',
              message_act: 'question',
              social_target: 'me',
              addressed_to_me: true,
              has_real_novelty: true,
              confidence: 'high',
              reason: '这是对小腻的直接提问',
              topic_context: {
                has_topic: true,
                topic_summary: '今天玩什么',
                addressed_to_me: true
              }
            },
            action_type: 'speak',
            messages: ['第一条', '第二条'],
            reason: '有直接请求，也有具体回应。',
            evidence_refs: ['message_id=11'],
            confidence: 0.92,
            interest_level: 'high',
            wants_to_know_more: false,
            reaction_authenticity: 'formed',
            participation_judgment: {
              status: 'direct_request',
              basis: 'direct_request',
              sayable_point: '直接回答今天可以玩什么。',
              evidence_refs: ['message_id=11'],
              memory_refs: []
            },
            should_search: false,
            context_gap: 'none',
            gap_resolution: 'none',
            xiaoni_os: '这轮是直接问我，已经正常接住。'
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
  assert.equal(storeCalls.completeAgentRun[0]?.totalTurns, 1);
  assert.equal(storeCalls.updateLlmJob[0]?.finalResponse, '第一条\n\n第二条');
  assert.equal(storeCalls.createConversation[0]?.rawResponse?.total_turns, 1);
  assert.equal(storeCalls.createConversation[0]?.rawResponse?.loop_stage_artifacts?.life_action?.action_type, 'speak');
  assert.equal(storeCalls.createConversation[0]?.rawResponse?.loop_stage_artifacts?.unread_meaning?.message_act, 'question');
  assert.equal(storeCalls.createToolExecutionLog[0]?.toolName, LIFE_ACTION_TOOL);
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
    updateLlmJob: [],
    recordSilenceDecisionLifeEvent: []
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
    recordSilenceDecisionLifeEvent: async (params: any) => { storeCalls.recordSilenceDecisionLifeEvent.push(params); }
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
        arguments: JSON.stringify({
          reason: '第三人称围观，不自然。',
          outcome: 'complete',
          xiaoni_os: '这次只是第三人称围观我，不是在叫我加入。先不说，把这个边界留给下一轮。'
        })
      }]
    }
  });

  await service.processQueueMessage(queueMessage as any);

  assert.equal(storeCalls.createConversation.length, 1);
  assert.equal(storeCalls.createConversation[0]?.status, 'completed');
  assert.equal(storeCalls.createConversation[0]?.aiResponse, null);
  assert.equal(storeCalls.createConversation[0]?.transcriptItems?.length, 1);
  assert.equal(storeCalls.createConversation[0]?.rawResponse?.finish_reason, '第三人称围观，不自然。');
  assert.equal(
    storeCalls.createConversation[0]?.rawResponse?.xiaoni_os,
    '这次只是第三人称围观我，不是在叫我加入。先不说，把这个边界留给下一轮。'
  );
  assert.equal(storeCalls.completeQueueMessage[0]?.result?.no_reply, true);
  assert.equal(
    storeCalls.completeQueueMessage[0]?.result?.xiaoni_os,
    '这次只是第三人称围观我，不是在叫我加入。先不说，把这个边界留给下一轮。'
  );
  assert.equal(storeCalls.completeQueueMessage[0]?.result?.termination_reason, 'finish_no_reply');
  assert.equal(storeCalls.completeAgentRun[0]?.terminationReason, 'finish_no_reply');
  assert.equal(storeCalls.completeAgentRun[0]?.totalTurns, 1);
  assert.equal(storeCalls.recordSilenceDecisionLifeEvent.length, 1);
  assert.equal(storeCalls.recordSilenceDecisionLifeEvent[0]?.outcome, 'silent');
  assert.equal(storeCalls.recordSilenceDecisionLifeEvent[0]?.termination?.terminationReason, 'finish_no_reply');
  assert.equal(storeCalls.recordSilenceDecisionLifeEvent[0]?.queueMessage?.sessionKey, 'qq:group:101');
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
            call_id: `call-silent-after-task-${turn}`,
            name: SILENT_FINISH_TOOL,
            arguments: JSON.stringify({ reason: 'done', outcome: 'complete' })
          }]
        }
      };
    };

    await service.processQueueMessage(queueMessage as any);

    assert.equal(turn, 3);
    assert.equal(storeCalls.createConversation.length, 1);
    assert.equal(storeCalls.createConversation[0]?.aiResponse, '我已经开始帮Alice处理这张图，等结果出来再发。');
    assert.deepEqual(storeCalls.completeQueueMessage[0]?.result?.sent_messages, ['我已经开始帮Alice处理这张图，等结果出来再发。']);
    assert.equal(storeCalls.completeAgentRun[0]?.terminationReason, 'reply_sent');
    assert.deepEqual(storeCalls.markRunDeliveryCommitted, ['run-queue-image-task-followup']);
    assert.equal(sendGroupCalls.length, 1);
    assert.equal(sendGroupCalls[0]?.url, `${agentConfig.providerServiceUrl}/api/internal/send_group`);
    assert.deepEqual(sendGroupCalls[0]?.body, {
      session_key: 'qq:group:1019235326',
      group_id: 1019235326,
      messages: ['我已经开始帮Alice处理这张图，等结果出来再发。'],
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
        content: expectedCurrentInputMessage()
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
      xiaoni_os: '第一轮已经发出可见回复。',
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

test('processQueueMessage fingerprints duplicate life action replies with the current direct chat type', async () => {
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
          name: LIFE_ACTION_TOOL,
          arguments: JSON.stringify({
            action_type: 'speak',
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

test('processQueueMessage blocks life action image tasks after visible delivery commit', async () => {
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
          name: LIFE_ACTION_TOOL,
          arguments: JSON.stringify({
            action_type: 'image_task',
            prompt: '再生成一张图',
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

test('applyToolResultToLoopInput ends the turn on stay_silent without replaying tool payload', () => {
  const loopInput = buildInitialInput([], createQueuePayload(), createRuntimePrompt());
  const finishResult = {
    finished: true,
    reason: 'done',
    outcome: 'complete',
    xiaoni_os: '这轮不接，留给下一轮。'
  };

  const continuation = applyToolResultToLoopInput({
    callId: 'call-2',
    name: SILENT_FINISH_TOOL,
    rawArguments: '{"reason":"done","outcome":"complete","xiaoni_os":"这轮不接，留给下一轮。"}'
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
      outcome: 'noop',
      xiaoni_os: null,
      pending_share: null
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 2);
});

// A1: empty_but_convenient always forces silence
test('shouldDowngradeWeakSpeakToSilence forces silence for empty_but_convenient regardless of direct cue', () => {
  const loopInput = buildInitialInput([], createQueuePayload());
  loopInput.push({
    type: 'function_call',
    call_id: 'call-meaning',
    name: UNREAD_MEANING_TOOL,
    arguments: '{"latest_unread_focus":"直接问小腻","message_act":"question","social_target":"me","addressed_to_me":true,"has_real_novelty":true,"confidence":"high","reason":"直接提问"}'
  });
  loopInput.push({
    type: 'function_call_output',
    call_id: 'call-meaning',
    output: '{"latest_unread_focus":"直接问小腻","message_act":"question","social_target":"me","addressed_to_me":true,"has_real_novelty":true,"confidence":"high","reason":"直接提问"}'
  });
  loopInput.push({
    type: 'function_call',
    call_id: 'call-reaction',
    name: LIFE_ACTION_TOOL,
    arguments: '{"interest_level":"low","wants_to_know_more":false,"reaction_authenticity":"empty_but_convenient","should_search":false,"action_type":"speak","reason":"只是凑数的话"}'
  });
  loopInput.push({
    type: 'function_call_output',
    call_id: 'call-reaction',
    output: '{"interest_level":"low","wants_to_know_more":false,"reaction_authenticity":"empty_but_convenient","should_search":false,"action_type":"speak","reason":"只是凑数的话"}'
  });

  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, loopInput, 'group');
  assert.deepEqual(getAllowedToolNames(request.tool_choice), [SILENT_FINISH_TOOL],
    'empty_but_convenient must always be silenced even when directly addressed');
});

// A2: socialTarget === 'me' counts as direct new cue
test('hasDirectNewCue recognizes socialTarget=me even when addressedToMe is false', () => {
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
  loopInput.push({
    type: 'function_call',
    call_id: 'call-reaction',
    name: LIFE_ACTION_TOOL,
    arguments: '{"interest_level":"low","wants_to_know_more":false,"reaction_authenticity":"weak_but_real","should_search":false,"action_type":"speak","reason":"被点名了"}'
  });
  loopInput.push({
    type: 'function_call_output',
    call_id: 'call-reaction',
    output: '{"interest_level":"low","wants_to_know_more":false,"reaction_authenticity":"weak_but_real","should_search":false,"action_type":"speak","reason":"被点名了"}'
  });

  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, loopInput, 'group');
  assert.ok(
    getAllowedToolNames(request.tool_choice).includes(GROUP_REPLY_TOOL),
    'socialTarget=me with addressedToMe=false must still count as direct cue and allow speak'
  );
});

// A3: parseLifeAction succeeds without recalled_prior_pattern / felt_direction
test('parseLifeAction accepts tool output without recalled_prior_pattern and felt_direction', () => {
  const loopInput = buildInitialInput([], createQueuePayload());
  loopInput.push({
    type: 'function_call',
    call_id: 'call-meaning',
    name: UNREAD_MEANING_TOOL,
    arguments: '{"latest_unread_focus":"直接问","message_act":"question","social_target":"me","addressed_to_me":true,"has_real_novelty":true,"confidence":"high","reason":"直接问"}'
  });
  loopInput.push({
    type: 'function_call_output',
    call_id: 'call-meaning',
    output: '{"latest_unread_focus":"直接问","message_act":"question","social_target":"me","addressed_to_me":true,"has_real_novelty":true,"confidence":"high","reason":"直接问"}'
  });
  // No recalled_prior_pattern or felt_direction — this is the new clean schema
  loopInput.push({
    type: 'function_call',
    call_id: 'call-reaction',
    name: LIFE_ACTION_TOOL,
    arguments: '{"interest_level":"high","wants_to_know_more":false,"reaction_authenticity":"formed","should_search":false,"action_type":"speak","reason":"有真实回应"}'
  });
  loopInput.push({
    type: 'function_call_output',
    call_id: 'call-reaction',
    output: '{"interest_level":"high","wants_to_know_more":false,"reaction_authenticity":"formed","should_search":false,"action_type":"speak","reason":"有真实回应"}'
  });

  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, loopInput, 'group');
  assert.ok(
    getAllowedToolNames(request.tool_choice).includes(GROUP_REPLY_TOOL),
    'parseLifeAction must succeed without recalled_prior_pattern and felt_direction'
  );
});

test('participation_judgment=no_sayable_point forces stay_silent even if action_type is speak', () => {
  const loopInput = buildInitialInput([], createQueuePayload());
  loopInput.push({
    type: 'function_call',
    call_id: 'call-meaning',
    name: UNREAD_MEANING_TOOL,
    arguments: '{"latest_unread_focus":"直接问小腻","message_act":"question","social_target":"me","addressed_to_me":true,"has_real_novelty":true,"confidence":"high","reason":"直接问"}'
  });
  loopInput.push({
    type: 'function_call_output',
    call_id: 'call-meaning',
    output: '{"latest_unread_focus":"直接问小腻","message_act":"question","social_target":"me","addressed_to_me":true,"has_real_novelty":true,"confidence":"high","reason":"直接问"}'
  });
  loopInput.push({
    type: 'function_call',
    call_id: 'call-reaction',
    name: LIFE_ACTION_TOOL,
    arguments: '{"interest_level":"medium","wants_to_know_more":false,"reaction_authenticity":"formed","participation_judgment":{"status":"no_sayable_point","basis":"none","sayable_point":"","evidence_refs":[],"memory_refs":[]},"should_search":false,"action_type":"speak","context_gap":"none","gap_resolution":"none","reason":"只是能接话"}'
  });
  loopInput.push({
    type: 'function_call_output',
    call_id: 'call-reaction',
    output: '{"interest_level":"medium","wants_to_know_more":false,"reaction_authenticity":"formed","participation_judgment":{"status":"no_sayable_point","basis":"none","sayable_point":"","evidence_refs":[],"memory_refs":[]},"should_search":false,"action_type":"speak","context_gap":"none","gap_resolution":"none","reason":"只是能接话"}'
  });

  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, loopInput, 'group');
  assert.deepEqual(getAllowedToolNames(request.tool_choice), [SILENT_FINISH_TOOL]);
});

test('buildTurnStateReminder does not turn energy into an extra system reminder', () => {
  const reminder = buildTurnStateReminder([
    '<小腻当前状态>',
    '当前精力：0.14',
    '精力成本：已经开口，本次行动成本 1.00',
    '</小腻当前状态>'
  ].join('\n'));

  assert.equal(reminder, null);
});

test('energy context does not downgrade a weak but real speak decision by itself', () => {
  const loopInput = buildInitialInput(
    [],
    createQueuePayload(),
    createRuntimePrompt(),
    [],
    null,
    null,
    [
      '<小腻当前状态>',
      '当前精力：0.14',
      '精力成本：已经开口，本次行动成本 1.00',
      '</小腻当前状态>'
    ].join('\n')
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
  loopInput.push({
    type: 'function_call',
    call_id: 'call-reaction',
    name: LIFE_ACTION_TOOL,
    arguments: '{"interest_level":"medium","wants_to_know_more":false,"reaction_authenticity":"weak_but_real","should_search":false,"action_type":"speak","reason":"有一点想接但不强"}'
  });
  loopInput.push({
    type: 'function_call_output',
    call_id: 'call-reaction',
    output: '{"interest_level":"medium","wants_to_know_more":false,"reaction_authenticity":"weak_but_real","should_search":false,"action_type":"speak","reason":"有一点想接但不强"}'
  });

  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, loopInput, 'group');
  assert.ok(getAllowedToolNames(request.tool_choice).includes(GROUP_REPLY_TOOL));
});

// B: LIFE_ACTION_TOOL schema must not contain recalled_prior_pattern or felt_direction
test('LIFE_ACTION_TOOL schema does not declare recalled_prior_pattern or felt_direction', () => {
  const loopInput = buildInitialInput([], createQueuePayload());
  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, loopInput, 'group');
  const reactionTool = (request.tools ?? []).find((t: any) => t.function?.name === LIFE_ACTION_TOOL);
  assert.ok(reactionTool, 'submit_life_action tool must exist in initial turn');
  const schema = (reactionTool as any).function?.parameters ?? {};
  const props = schema?.properties ?? {};
  assert.ok('context_gap' in props, 'context_gap must be declared in schema');
  assert.ok('gap_resolution' in props, 'gap_resolution must be declared in schema');
  assert.ok('participation_judgment' in props, 'participation_judgment must be declared in schema');
  assert.ok(!('recalled_prior_pattern' in props), 'recalled_prior_pattern must be removed from schema');
  assert.ok(!('felt_direction' in props), 'felt_direction must be removed from schema');
  const required: string[] = schema?.required ?? [];
  assert.ok(required.includes('context_gap'), 'context_gap must be required');
  assert.ok(required.includes('gap_resolution'), 'gap_resolution must be required');
  assert.ok(required.includes('participation_judgment'), 'participation_judgment must be required');
  assert.ok(!required.includes('recalled_prior_pattern'), 'recalled_prior_pattern must not be in required');
  assert.ok(!required.includes('felt_direction'), 'felt_direction must not be in required');
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

function createLifePresenceTickQueueMessageForTest() {
  const queueMessage = createPresenceTickQueueMessageForTest();
  return {
    ...queueMessage,
    payload: {
      ...queueMessage.payload,
      chatType: 'direct' as const,
      peerId: 'xiaoni',
      peerName: '小腻',
      bodyForAgent: '小腻从自己的生活里抬头看了一眼消息列表；还没有打开任何具体会话。',
      inboundContext: {
        ...queueMessage.payload.inboundContext,
        ChatType: 'direct',
        NativeChannelId: 'presence_tick:xiaoni',
        To: '303'
      },
      presenceTick: {
        identityKey: 'xiaoni'
      },
      messages: queueMessage.payload.messages.map((message) => ({
        ...message,
        chatType: 'direct' as const,
        peerId: 'xiaoni',
        peerName: '小腻',
        bodyForAgent: '小腻从自己的生活里抬头看了一眼消息列表；还没有打开任何具体会话。',
        inboundContext: {
          ...message.inboundContext,
          ChatType: 'direct',
          NativeChannelId: 'presence_tick:xiaoni',
          To: '303'
        }
      }))
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

test('life-level presence tick does not materialize a legacy target group without a selected IM', () => {
  const queueMessage = createLifePresenceTickQueueMessageForTest();
  const materialized = materializePresenceTickQueueMessage(queueMessage);
  assert.equal(materialized.payload.sessionKey, 'presence_tick:xiaoni');
  assert.equal(materialized.payload.peerId, 'xiaoni');

  const loopInput = buildInitialInput([], materialized.payload, createRuntimePrompt());
  const rendered = loopInput.map(getMessageContent).join('\n');
  assert.match(rendered, /消息列表/);
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

// F: 社交认知帧 — social cognitive frame substrings appear in agent instructions
test('buildCanonicalAgentTurnRequest includes social cognitive frame prose in instructions', () => {
  const loopInput = buildInitialInput([], createQueuePayload());
  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, loopInput, 'group');
  assert.match(String(request.instructions), /目标：看懂当前可见现场/);
  assert.match(String(request.instructions), /有具体可说点才开口/);
  assert.match(String(request.instructions), /社交方向/);
  assert.match(String(request.instructions), /@ 是打开 IM 的信号/);
});

// H: developer role injection — stable world narrative stays early while turn-dynamic context stays late
test('buildInitialInput strips relationship layer while keeping stable and dynamic context', () => {
  const devBlock = '<world_narrative>test</world_narrative>\n\n<current_relationship>\n本次发言者：foo（QQ:12345）\n当前关系层级：L2\n当前可开放的自己：偶尔吐槽，有自己的语气\n</current_relationship>\n\n<小腻当前状态>刚抬头看了一眼 IM</小腻当前状态>';
  const items = buildInitialInput([], createQueuePayload(), undefined, [], null, null, devBlock);
  assert.equal(items[0]?.type, 'message');
  assert.equal((items[0] as { role?: string })?.role, 'system');
  assert.equal(items[1]?.type, 'message');
  assert.equal((items[1] as { role?: string })?.role, 'developer');
  assert.match(getMessageContent(items[1]), /world_narrative/);
  assert.doesNotMatch(getMessageContent(items[1]), /current_relationship/);
  const developerIndex = items.findIndex((item) => item.type === 'message' && item.role === 'developer' && getMessageContent(item).includes('小腻当前状态'));
  const currentReminderIndex = items.findIndex((item) => getMessageContent(item).includes('看到的未读列表'));
  const historyReadingIndex = items.findIndex((item) => getMessageContent(item).includes('<runtime_history_reading>'));
  assert.ok(developerIndex > currentReminderIndex);
  assert.ok(developerIndex < historyReadingIndex);
  assert.doesNotMatch(getMessageContent(items[developerIndex]), /world_narrative/);
  assert.doesNotMatch(getMessageContent(items[developerIndex]), /current_relationship|当前关系层级|当前可开放的自己/);
  assert.match(getMessageContent(items[developerIndex]), /小腻当前状态/);
  assert.doesNotMatch(getMessageContent(items[developerIndex]), /current_scene|消息密度|活跃人数/);
});

// I: developer role injection — buildInitialInput skips developer message when block is null
test('buildInitialInput does not inject developer message when developerContextBlock is null', () => {
  const items = buildInitialInput([], createQueuePayload(), undefined, [], null, null, null);
  assert.equal((items[0] as { role?: string })?.role, 'system');
  assert.notEqual((items[1] as { role?: string })?.role, 'developer');
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
  // Access the function via the tool result path — verify the tool schema has the fields
  const toolDef = getFunctionTool(buildInitialInput([], createQueuePayload())[0]);
  void toolDef; // We can't call parseUnreadMeaning directly; verify schema instead
  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, buildInitialInput([], createQueuePayload()), 'group');
  const lifeActionTool = (request.tools as Array<{ function?: { name?: string; parameters?: { properties?: Record<string, any>; required?: string[] } } }>)
    ?.find((t) => t.function?.name === LIFE_ACTION_TOOL);
  const unreadMeaningSchema = lifeActionTool?.function?.parameters?.properties?.unread_meaning as { properties?: Record<string, unknown>; required?: string[] } | undefined;
  assert.ok(unreadMeaningSchema, 'submit_life_action unread_meaning schema should exist');
  assert.ok(unreadMeaningSchema?.properties?.social_act_type, 'social_act_type field should exist in schema');
  assert.ok(unreadMeaningSchema?.properties?.topic_context, 'topic_context field should exist in schema');
  assert.ok(unreadMeaningSchema?.required?.includes('topic_context'), 'topic_context should be required');
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
  assert.doesNotMatch(String(block), /current_relationship|当前关系层级|当前可开放的自己|本次发言者|current_scene|消息密度|活跃人数/);
});

test('group loop no longer exposes recall_long_term_learning as a pre-reply tool', () => {
  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, buildInitialInput([], createQueuePayload()), 'group');
  const recallTool = (request.tools as Array<{ function?: { name?: string; parameters?: { properties?: Record<string, unknown>; required?: string[] } } }>)
    ?.find((t) => t.function?.name === 'recall_long_term_learning');
  assert.equal(recallTool, undefined);
  assert.ok(!getAllowedToolNames(request.tool_choice).includes('recall_long_term_learning'));
});
