import test from 'node:test';
import assert from 'node:assert/strict';
import { agentConfig } from '../config';
import { AgentLoopService, applyToolResultToLoopInput, buildCanonicalAgentTurnRequest, buildInitialInput, sanitizeLowValueOpeningFiller } from '../services/agent-loop-service';
import { MissingAgentPromptBindingError, type ResolvedAgentRuntimePrompt } from '../services/agent-prompt-service';
import type { QueueMessagePayload } from '../types';

const PRIVATE_REPLY_TOOL = 'reply_in_private';
const UNREAD_MEANING_TOOL = 'emit_unread_meaning';
const INNER_REACTION_TOOL = 'emit_inner_reaction';
const LONG_TERM_RECALL_TOOL = 'recall_long_term_learning';
const GROUP_REPLY_TOOL = 'speak_in_group';
const INSPECT_IMAGE_TOOL = 'inspect_image_placeholder';
const IMAGE_TASK_TOOL = 'request_image_task';
const SILENT_FINISH_TOOL = 'stay_silent';
const WEB_SEARCH_TOOL = 'web_search';
const GROUP_LOOP_TOOLS = [
  UNREAD_MEANING_TOOL,
  INNER_REACTION_TOOL,
  LONG_TERM_RECALL_TOOL,
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
  assert.deepEqual(getAllowedToolNames(request.tool_choice), [UNREAD_MEANING_TOOL]);
  assert.equal(request.parallel_tool_calls, false);
  assert.deepEqual(
    request.tools.map((tool) => getToolName(tool)),
    GROUP_LOOP_TOOLS
  );
  const planFunction = getFunctionTool(request.tools[0]);
  assert.equal(planFunction?.name, UNREAD_MEANING_TOOL);
  assert.match(String(request.instructions), /Available tools are .*web_search/);
  assert.match(String(request.instructions), /使用 web_search/);
  assert.match(String(request.instructions), /web_search 是求知，不是默认步骤/);
  assert.match(String(request.instructions), /知行不二/);
  assert.match(String(request.instructions), /经典原话更准确地点明了此刻判断/);
  assert.match(String(request.instructions), /我仍然回到同一个判断：说，等待，还是沉默/);
  assert.match(String(request.instructions), /工具只是这些去向的外在落点/);
  assert.match(String(planFunction?.description), /先只理解最新未读到底在讲什么/);
  assert.deepEqual(planFunction?.parameters?.required, ['latest_unread_focus', 'message_act', 'social_target', 'addressed_to_me', 'has_real_novelty', 'confidence', 'reason']);
});

test('buildCanonicalAgentTurnRequest does not include previous_response_id', () => {
  const loopInput = buildInitialInput([], createQueuePayload());
  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, loopInput, 'group');

  assert.equal(Object.prototype.hasOwnProperty.call(request, 'previous_response_id'), false);
});

test('buildCanonicalAgentTurnRequest keeps the same group loop tools on the first group turn', () => {
  const loopInput = buildInitialInput([], createQueuePayload());
  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, loopInput, 'group');

  assert.deepEqual(
    request.tools.map((tool: any) => getToolName(tool)),
    GROUP_LOOP_TOOLS
  );
  assert.deepEqual(getAllowedToolNames(request.tool_choice), [UNREAD_MEANING_TOOL]);
  assert.match(String(request.instructions), /这一轮在我体内自然按这个顺序展开/);
  assert.match(String(request.instructions), /如果我还没看清最新未读到底在讲什么，就先调用 emit_unread_meaning/);
  assert.match(String(request.instructions), /只有当当前反应让我意识到这件事可能和以前学到的东西有关时，我才调用 recall_long_term_learning/);
  assert.match(String(request.instructions), /只有当前两步都已经形成，我才调用 speak_in_group、stay_silent 或 web_search/);
});

test('buildCanonicalAgentTurnRequest only unlocks inner reaction after unread meaning replay', () => {
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
  assert.deepEqual(getAllowedToolNames(request.tool_choice), [INNER_REACTION_TOOL]);
});

test('buildCanonicalAgentTurnRequest only allows stay_silent after inner reaction prefers silence', () => {
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
    name: INNER_REACTION_TOOL,
    arguments: '{"interest_level":"low","wants_to_know_more":false,"recalled_prior_pattern":"刚刚已经是同义回声","felt_direction":"没有新的拉力","reaction_authenticity":"weak_but_real","should_search":false,"preferred_action":"silent","reason":"只是顺手可接"}'
  });
  loopInput.push({
    type: 'function_call_output',
    call_id: 'call-reaction',
    output: '{"interest_level":"low","wants_to_know_more":false,"recalled_prior_pattern":"刚刚已经是同义回声","felt_direction":"没有新的拉力","reaction_authenticity":"weak_but_real","should_search":false,"preferred_action":"silent","reason":"只是顺手可接"}'
  });

  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, loopInput, 'group');

  assert.deepEqual(getAllowedToolNames(request.tool_choice), [SILENT_FINISH_TOOL]);
});

test('buildCanonicalAgentTurnRequest requires recall before speech when inner reaction prefers speak', () => {
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
    name: INNER_REACTION_TOOL,
    arguments: '{"interest_level":"high","wants_to_know_more":false,"recalled_prior_pattern":"这是直接递话","felt_direction":"可以承担一句回应","reaction_authenticity":"formed","should_search":false,"preferred_action":"speak","reason":"有真实回应"}'
  });
  loopInput.push({
    type: 'function_call_output',
    call_id: 'call-reaction',
    output: '{"interest_level":"high","wants_to_know_more":false,"recalled_prior_pattern":"这是直接递话","felt_direction":"可以承担一句回应","reaction_authenticity":"formed","should_search":false,"preferred_action":"speak","reason":"有真实回应"}'
  });

  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, loopInput, 'group');

  assert.deepEqual(getAllowedToolNames(request.tool_choice), [LONG_TERM_RECALL_TOOL]);
});

test('buildCanonicalAgentTurnRequest requires recall before search when inner reaction prefers search', () => {
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
    name: INNER_REACTION_TOOL,
    arguments: '{"interest_level":"high","wants_to_know_more":true,"recalled_prior_pattern":"需要查资料再回应","felt_direction":"先查证","reaction_authenticity":"formed","should_search":true,"preferred_action":"search","reason":"需要外部信息"}'
  });
  loopInput.push({
    type: 'function_call_output',
    call_id: 'call-reaction',
    output: '{"interest_level":"high","wants_to_know_more":true,"recalled_prior_pattern":"需要查资料再回应","felt_direction":"先查证","reaction_authenticity":"formed","should_search":true,"preferred_action":"search","reason":"需要外部信息"}'
  });

  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, loopInput, 'group');

  assert.deepEqual(getAllowedToolNames(request.tool_choice), [LONG_TERM_RECALL_TOOL]);
});

test('buildCanonicalAgentTurnRequest allows speech after recall when inner reaction prefers speak', () => {
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
    name: INNER_REACTION_TOOL,
    arguments: '{"interest_level":"high","wants_to_know_more":false,"recalled_prior_pattern":"这是直接递话","felt_direction":"可以承担一句回应","reaction_authenticity":"formed","should_search":false,"preferred_action":"speak","reason":"有真实回应"}'
  });
  loopInput.push({
    type: 'function_call_output',
    call_id: 'call-reaction',
    output: '{"interest_level":"high","wants_to_know_more":false,"recalled_prior_pattern":"这是直接递话","felt_direction":"可以承担一句回应","reaction_authenticity":"formed","should_search":false,"preferred_action":"speak","reason":"有真实回应"}'
  });
  loopInput.push({
    type: 'function_call',
    call_id: 'call-recall',
    name: LONG_TERM_RECALL_TOOL,
    arguments: '{"reason":"当前反应可能和以往互动反馈有关","topic_hint":"直接递话","include_current_sender":true,"desired_recall_count":2}'
  });
  loopInput.push({
    type: 'function_call_output',
    call_id: 'call-recall',
    output: '{"reason":"当前反应可能和以往互动反馈有关","topic_hint":"直接递话","query_text":"直接递话","items":[],"markdown_items":[]}'
  });

  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, loopInput, 'group');

  assert.deepEqual(getAllowedToolNames(request.tool_choice), [WEB_SEARCH_TOOL, GROUP_REPLY_TOOL, INSPECT_IMAGE_TOOL, IMAGE_TASK_TOOL, SILENT_FINISH_TOOL]);
});

test('buildCanonicalAgentTurnRequest allows search after recall when inner reaction prefers search', () => {
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
    name: INNER_REACTION_TOOL,
    arguments: '{"interest_level":"high","wants_to_know_more":true,"recalled_prior_pattern":"需要查资料再回应","felt_direction":"先查证","reaction_authenticity":"formed","should_search":true,"preferred_action":"search","reason":"需要外部信息"}'
  });
  loopInput.push({
    type: 'function_call_output',
    call_id: 'call-reaction',
    output: '{"interest_level":"high","wants_to_know_more":true,"recalled_prior_pattern":"需要查资料再回应","felt_direction":"先查证","reaction_authenticity":"formed","should_search":true,"preferred_action":"search","reason":"需要外部信息"}'
  });
  loopInput.push({
    type: 'function_call',
    call_id: 'call-recall',
    name: LONG_TERM_RECALL_TOOL,
    arguments: '{"reason":"当前反应可能和以往互动反馈有关","topic_hint":"资料问题","include_current_sender":true,"desired_recall_count":2}'
  });
  loopInput.push({
    type: 'function_call_output',
    call_id: 'call-recall',
    output: '{"reason":"当前反应可能和以往互动反馈有关","topic_hint":"资料问题","query_text":"资料问题","items":[],"markdown_items":[]}'
  });

  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, loopInput, 'group');

  assert.deepEqual(getAllowedToolNames(request.tool_choice), [WEB_SEARCH_TOOL, SILENT_FINISH_TOOL]);
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
    name: INNER_REACTION_TOOL,
    arguments: '{"interest_level":"low","wants_to_know_more":false,"recalled_prior_pattern":"短句轻收口","felt_direction":"轻轻接住也可以，但没有新拉力","reaction_authenticity":"weak_but_real","should_search":false,"preferred_action":"speak","reason":"只是轻微会心"}'
  });
  loopInput.push({
    type: 'function_call_output',
    call_id: 'call-reaction',
    output: '{"interest_level":"low","wants_to_know_more":false,"recalled_prior_pattern":"短句轻收口","felt_direction":"轻轻接住也可以，但没有新拉力","reaction_authenticity":"weak_but_real","should_search":false,"preferred_action":"speak","reason":"只是轻微会心"}'
  });

  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, loopInput, 'group');

  assert.deepEqual(getAllowedToolNames(request.tool_choice), [SILENT_FINISH_TOOL]);
});

test('buildCanonicalAgentTurnRequest keeps direct new low weak speech on the recall path', () => {
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
    name: INNER_REACTION_TOOL,
    arguments: '{"interest_level":"low","wants_to_know_more":false,"recalled_prior_pattern":"直接递话仍要回应","felt_direction":"短答即可","reaction_authenticity":"weak_but_real","should_search":false,"preferred_action":"speak","reason":"直接问到我"}'
  });
  loopInput.push({
    type: 'function_call_output',
    call_id: 'call-reaction',
    output: '{"interest_level":"low","wants_to_know_more":false,"recalled_prior_pattern":"直接递话仍要回应","felt_direction":"短答即可","reaction_authenticity":"weak_but_real","should_search":false,"preferred_action":"speak","reason":"直接问到我"}'
  });

  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, loopInput, 'group');

  assert.deepEqual(getAllowedToolNames(request.tool_choice), [LONG_TERM_RECALL_TOOL]);
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
    name: INNER_REACTION_TOOL,
    arguments: '{"interest_level":"low","wants_to_know_more":false,"recalled_prior_pattern":"类似回声之前已经落地","felt_direction":"没有新的拉力","reaction_authenticity":"empty_but_convenient","should_search":false,"preferred_action":"silent","reason":"只是顺手可接"}'
  });
  loopInput.push({
    type: 'function_call_output',
    call_id: 'call-reaction',
    output: '{"interest_level":"low","wants_to_know_more":false,"recalled_prior_pattern":"类似回声之前已经落地","felt_direction":"没有新的拉力","reaction_authenticity":"empty_but_convenient","should_search":false,"preferred_action":"silent","reason":"只是顺手可接"}'
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
    requestBody.canonicalRequest.input.slice(-4).map((item: any) => item.type),
    ['function_call', 'function_call_output', 'function_call', 'function_call_output']
  );
  assert.match(String(requestBody.canonicalRequest.instructions), /这一轮在我体内自然按这个顺序展开/);
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
  assert.match(String(loopInput[0]?.content), /OS 可以包含你当时真实留下来的任何东西/);
  assert.match(String(loopInput[0]?.content), /修身为本/);
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
  assert.match(String(loopInput[0]?.content), /这次由我自己判断：/);
  assert.match(String(loopInput[0]?.content), /工具只是这些去向的外在落点/);
});

test('buildInitialInput uses the same thin runtime contract for direct chats', () => {
  const loopInput = buildInitialInput([], createDirectQueuePayload(), createRuntimePrompt({
    systemPrompt: '你是小腻主AGENT'
  }));

  assert.equal(loopInput[0]?.type, 'message');
  assert.equal(loopInput[0]?.role, 'system');
  assert.match(String(loopInput[0]?.content), /^你是小腻主AGENT/);
  assert.match(String(loopInput[0]?.content), /Runtime contract:/);
  assert.match(String(loopInput[0]?.content), /这一轮只有几种自然去向：/);
  assert.match(String(loopInput[0]?.content), /成长约束是真正的行为来源/);
  assert.match(String(loopInput[0]?.content), /群聊说话时，调用 speak_in_group/);
  assert.match(String(loopInput[0]?.content), /私聊说话时，调用 reply_in_private/);
});

test('buildInitialInput projects accepted identity facts as runtime scene context', () => {
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

  assert.match(getMessageContent(loopInput.at(-2)), /\[身份连续性\]/);
  assert.match(getMessageContent(loopInput.at(-2)), /公式化开头/);
  assert.match(getMessageContent(loopInput.at(-1)), /问问@\{Bob\(@404\)\} 今天玩什么/);
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
  assert.equal(getMessageContent(loopInput[1]), '[已读消息]');
  const groupedXiaoniItem = loopInput[2];
  assert.deepEqual(
    groupedXiaoniItem && groupedXiaoniItem.type === 'message' ? groupedXiaoniItem.content : null,
    [
      { type: 'input_text', text: '小腻(303)\n第一段' },
      { type: 'input_text', text: '小腻(303)\n第二段' }
    ]
  );
  assert.equal(getMessageContent(loopInput[3]), '[未读消息]');
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

  assert.equal(getMessageContent(loopInput[1]), '[已读消息]');
  const priorXiaoniItem = loopInput[2];
  assert.match(getMessageContent(priorXiaoniItem), /小腻\(303\)\n我刚看群文件还没更新/);
  assert.doesNotMatch(getMessageContent(priorXiaoniItem), /<小腻的OS>/);
  assert.doesNotMatch(getMessageContent(priorXiaoniItem), /这句明显是在顺着问我/);
  assert.equal(getMessageContent(loopInput[3]), '[未读消息]');
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

  const priorXiaoniItem = loopInput[2];
  assert.match(getMessageContent(priorXiaoniItem), /小腻\(303\)\n这句我记下了/);
  assert.match(getMessageContent(priorXiaoniItem), /<小腻的OS>/);
  assert.match(getMessageContent(priorXiaoniItem), /我对她会更放松一点/);
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
  assert.match(String(request.instructions), /这一轮只有几种自然去向：/);
  assert.match(String(request.instructions), /修身为本/);
  assert.match(String(request.instructions), /群聊说话时，调用 speak_in_group/);
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

test('feedback memory subagent uses a subagent trace and cache key without changing its tools per turn', async () => {
  const calls: Array<any> = [];
  const timelineEvents: Array<any> = [];
  const store = {
    logTimelineEvent: async (event: any) => { timelineEvents.push(event); },
    createFeedbackEpisode: async () => ({ id: 1 }),
    createFeedbackReflection: async () => ({ id: 2 }),
    upsertFeedbackLearningState: async () => ({ id: 3 })
  };
  const service = new AgentLoopService(store as any);
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body || '{}')));
    return {
      ok: true,
      json: async () => ({
        success: true,
        llm_call_id: 'llm-feedback-subagent',
        canonical_response: {
          output: []
        }
      })
    } as any;
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
      innerReactionArtifact: { preferred_action: 'speak' }
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0].trace_id, 'trace-1:subagent:feedback_memory_writer');
  assert.equal(calls[0].agent_type, 'feedback_memory_writer');
  assert.equal(calls[0].prompt_name, '小腻主AGENT:feedback_memory_writer');
  assert.equal(calls[0].canonicalRequest.prompt_cache_key, 'qq:group:101:subagent:feedback_memory_writer');
  assert.equal(calls[0].canonicalRequest.prompt_cache_retention, '24h');
  assert.deepEqual(calls[0].canonicalRequest.metadata, {
    trace_id: 'trace-1:subagent:feedback_memory_writer',
    parent_trace_id: 'trace-1',
    parent_run_id: 'run-1',
    parent_conversation_id: '1001',
    batch_id: 'batch-1',
    session_key: 'qq:group:101',
    session_id: 'qq:group:101',
    turn_id: 'run-1:feedback_memory:1',
    sandbox: 'none',
    chat_type: 'group',
    prompt_name: '小腻主AGENT',
    subagent_type: 'feedback_memory_writer',
    parent_agent_type: 'chat_bot',
    prompt_id: 'prompt-1'
  });
  assert.deepEqual(
    calls[0].canonicalRequest.tools.map((tool: any) => getToolName(tool)),
    ['extract_feedback_episode', 'synthesize_feedback_reflection', 'update_learning_state']
  );
  assert.deepEqual(getAllowedToolNames(calls[0].canonicalRequest.tool_choice), ['extract_feedback_episode']);
  assert.equal(timelineEvents[0]?.eventType, 'subagent');
  assert.equal(timelineEvents[0]?.eventPhase, 'start');
  assert.equal(timelineEvents.at(-1)?.metadata?.termination_reason, 'no_tool_call');
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
    unreadMeaningArtifact: { message_act: 'feedback' },
    innerReactionArtifact: { preferred_action: 'speak' },
    persistedEpisodeId: 7,
    persistedReflectionId: null,
    activeLearningKey: '',
    activeLearningScope: '',
    episodeCreator: async () => ({ id: 7 }),
    reflectionCreator: async () => ({ id: 8 }),
    stateUpserter: async () => ({ id: 9 }),
    identityCandidateAppender: async (params: any) => {
      identityCandidates.push(params);
      return { candidate: { id: 11 } };
    },
    acceptedIdentityFactCreator: async (params: any) => {
      acceptedFacts.push(params);
      return { fact: { id: 12 } };
    }
  });

  assert.equal(result.reflection_id, 8);
  assert.equal(result.identity_candidate_id, 11);
  assert.equal(result.accepted_identity_fact_id, 12);
  assert.equal(result.identity_judge_status, 'accepted');
  assert.equal(identityCandidates.length, 1);
  assert.equal(identityCandidates[0].identityKey, 'xiaoni');
  assert.equal(identityCandidates[0].status, 'accepted');
  assert.equal(identityCandidates[0].proposedFrom, 'agent_feedback_reflection');
  assert.equal(identityCandidates[0].evidenceRefs[0].sourceType, 'agent_feedback_reflection');
  assert.equal(acceptedFacts.length, 1);
  assert.equal(acceptedFacts[0].sourceCandidateId, 11);
  assert.equal(acceptedFacts[0].factType, 'self_boundary');
  assert.match(acceptedFacts[0].factText, /哈哈，确实/);
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
          output: [
            {
              type: 'web_search_call',
              id: 'ws-success',
              status: 'completed',
              action: {
                type: 'open_page',
                url: 'https://example.com/context'
              }
            },
            {
              type: 'function_call',
              call_id: 'call-send-success',
              name: GROUP_REPLY_TOOL,
              arguments: JSON.stringify({ messages: ['第一条', '第二条'] })
            }
          ]
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
      xiaoni_os: null
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 2);
});
