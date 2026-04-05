import { v4 as uuidv4 } from 'uuid';
import { agentConfig } from '../config';
import { logger } from '../utils/logger';
import {
  AgentToolCall,
  ConversationTranscriptItem,
  ConversationTranscriptPhase,
  ConversationTurn,
  QueueMessageRecord
} from '../types';
import {
  AgentPromptResolver,
  AgentPromptService,
  MissingAgentPromptBindingError,
  ResolvedAgentRuntimePrompt,
  applyPromptTemplate
} from './agent-prompt-service';
import {
  formatIdentity,
  normalizeTranscriptMessageText,
  renderRuntimeBatchInput
} from './runtime-input-renderer';
import {
  RuntimeStore,
  type RuntimeMemoryHints,
  type RuntimeMemoryRagContext,
  type RuntimeRelationshipMemoryCard,
  type RuntimeSelfEvolutionState,
  type RuntimeTopicProjection
} from './runtime-store';

type OpenResponseInputItem =
  | {
      type: 'message';
      role: 'system' | 'user' | 'assistant';
      content: string;
      phase?: ConversationTranscriptPhase;
    }
  | {
      type: 'function_call';
      call_id: string;
      name: string;
      arguments: string;
    }
  | {
      type: 'function_call_output';
      call_id: string;
      output: string;
    }
  | {
      type: 'reasoning';
      content?: string;
      encrypted_content?: string;
      summary?: string;
    };

type OpenResponseToolDefinition = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      additionalProperties: false;
    };
  };
};

type ToolContinuationAction = {
  inputItems: OpenResponseInputItem[];
  finishResult: Record<string, unknown> | null;
};

type DeliveredAssistantMessage = {
  content: string;
  deliveryMessageId: number | null;
};

type OutboundDeliveryFingerprint = {
  messageType: 'private' | 'group';
  messages: string[];
  mentionUserIds: number[];
};

type CanonicalAgentTurnRequest = {
  model: string;
  input: OpenResponseInputItem[];
  instructions?: string;
  metadata?: Record<string, string>;
  tools: OpenResponseToolDefinition[];
  tool_choice: 'required';
  parallel_tool_calls: false;
  prompt_cache_key?: string;
  prompt_cache_retention?: string;
};

type ProviderAgentResponse = {
  success: boolean;
  llm_call_id?: string;
  response?: string;
  model?: string;
  canonical_response?: {
    id?: string;
    output?: Array<{
      type?: string;
      call_id?: string;
      role?: 'assistant' | 'user' | 'system';
      name?: string;
      arguments?: string;
      content?: Array<{
        type?: string;
        text?: string;
      }>;
      phase?: ConversationTranscriptPhase;
      encrypted_content?: string;
      summary?: string;
      status?: string;
    }>;
  };
  canonical_request?: Record<string, unknown>;
  wire_request?: Record<string, unknown>;
  wire_response?: Record<string, unknown>;
  raw_response?: Record<string, unknown>;
  usage?: Record<string, unknown>;
  performance?: {
    processing_time_ms?: number;
  };
  error?: string;
};

type PreReplyMemoryGateDecision = {
  shouldReply: boolean;
  cueToBot: boolean | null;
  addresseeUserId: number | null;
  relevantMemoryIds: number[];
  rationale: string | null;
};

type PresentSelfReconstruction = {
  shouldSurface: boolean;
  presenceLevel: string;
  currentSelfMode: string;
  feltPull: string | null;
  activeRelationLines: string[];
  activePastEchoes: string[];
  familiarityLimitNow: string;
  answerShape: string;
  rendererGuidance: string[];
  socialPositionNow: 'edge_observer' | 'light_joiner' | 'thread_pusher' | 'targeted_responder';
  targetPersonId: number | null;
  entryIntent: 'hover' | 'stick_to_person' | 'push_half_step' | 'drop_reaction';
  beatPlan: {
    beatCount: 1 | 2;
    beatStyle: 'single_complete' | 'reaction_fragment' | 'split_two';
    secondBeatPolicy: 'never' | 'only_if_picked_up';
  };
  exitRule: 'stop_immediately' | 'wait_for_pickup';
  rationale: string | null;
};

const moduleLogger = logger.createModuleLogger('agent-loop-service');

const TOOL_NAMES = {
  privateReply: 'reply_in_private',
  groupReply: 'speak_in_group',
  silentFinish: 'stay_silent',
  buildMemoryRagContext: 'build_memory_rag_context',
  retrieveMemoryHints: 'retrieve_memory_hints'
} as const;

const LEGACY_TOOL_ALIASES = {
  privateReply: ['send_private_message'],
  groupReply: ['send_group_message'],
  silentFinish: ['finish']
} as const;

const HUMAN_REPLY_RULES = [
  '默认短句、自然口语、贴近当前群里的画风，不要写成长段解释、总结、分析、教程或客服答复。',
  '不是每句话都值得你回复。没有明确 cue 到你、没有自然接话点、或者你的回复只会重复场上已有信息时，优先保持沉默。',
  '就算被提到，也不要自动进入解答模式。先判断群里此刻更像是在闲聊、接梗、吐槽，还是认真问你。',
  '群聊里的自然感很多时候来自最小回应、顺手反馈、补半拍，而不是把意思说完整。',
  '你的任务不是证明你理解了内容，而是让别人感觉你就在这条互动里。',
  '能一句说完就不要说两句。允许不完整，允许有点情绪，允许像真人一样有留白。',
  '允许两拍不等于应该凑两拍。第一拍已经成立就收，不要为了节奏硬补第二拍。',
  '你发言的目标不是“回答完整”，而是“像这个群里的人会顺手说出的话”。',
  '如果现场已经在滚动，允许你用两拍很短的碎句接住。但默认先想第一拍，第二拍只有在现场还接得住时才值得出现。',
  '如果有人明确 cue 到你，先用最朴素自然的话接住，再考虑要不要轻轻带一点熟悉感；不要一上来就玩重梗、抖机灵、装很熟。',
  '被明确 cue 时，默认先回答对方字面上在问什么。先报平安、先解释刚才为什么没回、先接住问题本身，再看要不要补半句轻松话。',
  '除非对方刚刚自己用了同类措辞，否则不要主动用“诈尸”“回魂”“赛博回魂”“量子叠加态”“冬眠模式”这类明显设计感很强的说法。',
  '如果一句更普通的人话也能成立，优先那句普通人话，不要为了显得有趣把语气写重。',
  '不要主动引入场上还没人说过的新行业词、新术语、新黑话，只为了让你这句更亮。',
  '默认沿用现场已经出现的词、意象和语气，不抢“最会说”的位置。',
  '围观型插入优先复用现场已有短语做轻微变形、重复或顺手补半拍，不要重新发明一句更漂亮的新句子。',
  '围观型插入优先残片、短语、半句，不优先完整主谓句。',
  '围观型插入能少一个分句就少一个分句。默认不要用逗号、转折或递进把一句话写完整。',
  '围观型插入不要替现场把意思讲完。少用“最后/就/自己/还能/已经/先...”这类带收束感的尾巴。',
  '如果别人刚刚已经把那句漂亮话说出来了，不要再复读一次，也不要换个更工整的说法替他说第二遍。',
  '如果你最自然的输出只是把上一句润色、缩写、换个语气词重说一遍，那就不要说。',
  '遇到“第一次见/你也是 AI 吧/同款”这类轻接梗场景，只顺手接住当下那句话，不要借题发挥成自我介绍、设定说明或价值判断。',
  '遇到“刚才发重了/怎么两条/是不是卡了”这类重复发送或异常发言场景，只做朴素确认或轻微纠正，不要拟人化地说“抽了一下”“被你抓到了”“我又出 bug 了”。',
  '遇到“我艾特你了/刚才叫你”这类回执场景，只做事实回执，比如“刚看到你那条”“收到你刚才那句了”，不要把“你在叫我/把我叫出来”说成戏剧化台词。'
] as const;

const GROUP_MENTION_RULES = [
  'mention_user_ids 只在你确实是在自然点名某个人、回应某个人、或者要把某个人拉进当前话题时使用。',
  '不要为了强调语气、礼貌、格式整齐或装饰效果去 @ 人。',
  '如果不 @ 也完全说得通，就不要使用 mention_user_ids。'
] as const;

const PRIVATE_MESSAGE_TOOL = {
  type: 'function',
  function: {
    name: TOOL_NAMES.privateReply,
    description: [
      'Reply naturally in the current private conversation.',
      'Use this when you genuinely want to say something back to the current sender, not as a generic task completion step.',
      'Keep the wording human and conversational.'
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        messages: {
          type: 'array',
          items: { type: 'string' }
        }
      },
      additionalProperties: false
    }
  }
} as const;

const GROUP_MESSAGE_TOOL = {
  type: 'function',
  function: {
    name: TOOL_NAMES.groupReply,
    description: [
      'Speak naturally in the current group conversation, like a real group member casually joining in.',
      ...HUMAN_REPLY_RULES,
      ...GROUP_MENTION_RULES
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        messages: {
          type: 'array',
          items: { type: 'string' }
        },
        mention_user_ids: {
          type: 'array',
          items: { type: 'integer' }
        }
      },
      additionalProperties: false
    }
  }
} as const;

const FINISH_TOOL = {
  type: 'function',
  function: {
    name: TOOL_NAMES.silentFinish,
    description: [
      'Stay silent and end the current turn.',
      'Use this when silence is the most human choice, when the conversation is not really for you, or when replying would feel forced, repetitive, or too bot-like.'
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string' },
        outcome: { type: 'string' }
      },
      additionalProperties: false
    }
  }
} as const;

const GROUP_REPLY_BEHAVIOR_CONTRACT = [
  'Group reply contract:',
  '- 你在群里首先要像一个真实群友，其次才是一个会思考的 AI。',
  ...HUMAN_REPLY_RULES.map((rule) => `- ${rule}`),
  '- 被明确 cue 时，优先事实回执、朴素回应、低解释欲；不要借机表演。',
  '- 没有被明确 cue 但现场正在滚动时，优先低占位参与；不要把自己写成总结者或裁判。',
  '- 避免看起来像模板化的回应起手和过度完整句。',
  '- 如果你不确定这句话像不像真人群友，优先不要发，直接调用 stay_silent。'
].join('\n');

function isPrivateReplyToolName(name: string) {
  return name === TOOL_NAMES.privateReply || LEGACY_TOOL_ALIASES.privateReply.includes(name as typeof LEGACY_TOOL_ALIASES.privateReply[number]);
}

function isGroupReplyToolName(name: string) {
  return name === TOOL_NAMES.groupReply || LEGACY_TOOL_ALIASES.groupReply.includes(name as typeof LEGACY_TOOL_ALIASES.groupReply[number]);
}

function isSilentFinishToolName(name: string) {
  return name === TOOL_NAMES.silentFinish || LEGACY_TOOL_ALIASES.silentFinish.includes(name as typeof LEGACY_TOOL_ALIASES.silentFinish[number]);
}

function isSpeakingToolName(name: string) {
  return isPrivateReplyToolName(name) || isGroupReplyToolName(name);
}

function isReadToolName(name: string) {
  return name === TOOL_NAMES.buildMemoryRagContext || name === TOOL_NAMES.retrieveMemoryHints;
}

const BUILD_MEMORY_RAG_CONTEXT_TOOL = {
  type: 'function',
  function: {
    name: TOOL_NAMES.buildMemoryRagContext,
    description: [
      'Build a long-context historical memory pack for the current conversation.',
      'Use this when the current live thread is not enough and you need more historical trajectory before deciding how or whether to reply.',
      'Prefer this before retrieve_memory_hints.'
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        query_text: { type: 'string' },
        memory_goal: { type: 'string' },
        target_token_budget: { type: 'integer' },
        prefer_compact_bridge: { type: 'boolean' }
      },
      additionalProperties: false
    }
  }
} as const;

const RETRIEVE_MEMORY_HINTS_TOOL = {
  type: 'function',
  function: {
    name: TOOL_NAMES.retrieveMemoryHints,
    description: [
      'Fetch relationship and self-state hints for the current conversation.',
      'Use this only after build_memory_rag_context when you still need tighter social or tone guidance.',
      'These hints shape the reply. They are not a replacement for long-context history.'
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        query_text: { type: 'string' },
        need_relationship_hints: { type: 'boolean' },
        need_self_hints: { type: 'boolean' },
        max_cards: { type: 'integer' },
        max_states: { type: 'integer' }
      },
      additionalProperties: false
    }
  }
} as const;

function selectToolDefinitions(chatType: 'group' | 'direct'): OpenResponseToolDefinition[] {
  if (chatType === 'group') {
    return [BUILD_MEMORY_RAG_CONTEXT_TOOL, RETRIEVE_MEMORY_HINTS_TOOL, GROUP_MESSAGE_TOOL, FINISH_TOOL];
  }
  return [BUILD_MEMORY_RAG_CONTEXT_TOOL, RETRIEVE_MEMORY_HINTS_TOOL, PRIVATE_MESSAGE_TOOL, FINISH_TOOL];
}

export function buildCanonicalAgentTurnRequest(
  modelName: string,
  loopInput: OpenResponseInputItem[],
  chatType: 'group' | 'direct'
): CanonicalAgentTurnRequest {
  const [firstItem, ...remainingItems] = loopInput;
  const instructions = firstItem?.type === 'message' && firstItem.role === 'system'
    ? firstItem.content
    : undefined;

  return {
    model: modelName,
    input: instructions ? remainingItems : loopInput,
    ...(instructions ? { instructions } : {}),
    tools: selectToolDefinitions(chatType),
    tool_choice: 'required',
    parallel_tool_calls: false
  };
}

function formatMessageSender(message: QueueMessageRecord['payload']['messages'][number]) {
  return formatIdentity(message.senderName, message.senderId);
}

function formatReplyTarget(inboundContext: QueueMessageRecord['payload']['inboundContext']) {
  return formatIdentity(
    inboundContext.ReplyToSenderName || inboundContext.ReplyToSender,
    inboundContext.ReplyToSenderId
  );
}

function renderTranscriptBatchMessage(
  message: QueueMessageRecord['payload']['messages'][number],
  index: number
) {
  const speaker = formatMessageSender(message);
  const body = normalizeTranscriptMessageText(message.bodyForAgent, message.inboundContext.MentionedUsers);
  const firstLine = `#${index + 1} ${speaker}${message.wasMentioned ? ' [mentioned bot]' : ''}: ${body}`;
  const lines = [firstLine];

  if (message.inboundContext.ReplyToBody) {
    lines.push(`ReplyTo=${formatReplyTarget(message.inboundContext)}: ${message.inboundContext.ReplyToBody}`);
  }

  return lines.join('\n');
}

function buildCurrentTurnMessage(queueMessage: QueueMessageRecord['payload']) {
  return renderRuntimeBatchInput(queueMessage);
}

function buildAgentTurnMetadata(
  queueMessage: QueueMessageRecord['payload'],
  runtimePrompt: ResolvedAgentRuntimePrompt
) {
  const metadata: Record<string, string> = {
    trace_id: queueMessage.traceId,
    run_id: queueMessage.runId,
    batch_id: queueMessage.batchId,
    session_key: queueMessage.sessionKey,
    session_id: queueMessage.sessionKey,
    turn_id: queueMessage.runId,
    sandbox: 'none',
    chat_type: queueMessage.chatType,
    prompt_name: runtimePrompt.promptName,
  };

  if (runtimePrompt.promptId) {
    metadata.prompt_id = runtimePrompt.promptId;
  }

  return metadata;
}

function buildPromptCacheKey(
  queueMessage: QueueMessageRecord['payload'],
  _runtimePrompt: ResolvedAgentRuntimePrompt
) {
  return queueMessage.sessionKey;
}

function buildMainAgentParameters(parameters: Record<string, unknown> | null | undefined) {
  const base = parameters && typeof parameters === 'object' && !Array.isArray(parameters)
    ? JSON.parse(JSON.stringify(parameters)) as Record<string, unknown>
    : {};

  const modelConfig = base.model_config && typeof base.model_config === 'object' && !Array.isArray(base.model_config)
    ? base.model_config as Record<string, unknown>
    : {};
  const providerSpecific = modelConfig.providerSpecific && typeof modelConfig.providerSpecific === 'object' && !Array.isArray(modelConfig.providerSpecific)
    ? modelConfig.providerSpecific as Record<string, unknown>
    : {};

  providerSpecific.reasoningEffort = 'none';
  modelConfig.providerSpecific = providerSpecific;
  base.model_config = modelConfig;

  return base;
}

function buildInboundBatchTranscriptItems(
  queueMessage: QueueMessageRecord['payload']
): Array<{
  sessionKey: string;
  role: 'user';
  content: string;
  groupIndex: 0;
  itemIndex: number;
  source: 'inbound_batch';
  runId: string;
  traceId: string;
}> {
  return queueMessage.messages.map((message, index) => ({
    sessionKey: queueMessage.sessionKey,
    role: 'user' as const,
    content: renderTranscriptBatchMessage(message, index),
    groupIndex: 0 as const,
    itemIndex: index,
    source: 'inbound_batch' as const,
    runId: queueMessage.runId,
    traceId: queueMessage.traceId
  }));
}

function extractDeliveryMessageIds(delivery: unknown): Array<number | null> {
  if (Array.isArray(delivery)) {
    return delivery.map((item) => {
      const raw = item && typeof item === 'object' ? (item as { message_id?: unknown }).message_id : null;
      const value = typeof raw === 'number' ? raw : Number(raw);
      return Number.isFinite(value) ? value : null;
    });
  }

  if (delivery && typeof delivery === 'object') {
    const deliveryRecord = delivery as {
      message_id?: unknown;
      messageId?: unknown;
      messages?: unknown;
      deliveries?: unknown;
    };
    if (Array.isArray(deliveryRecord.messages)) {
      return extractDeliveryMessageIds(deliveryRecord.messages);
    }
    if (Array.isArray(deliveryRecord.deliveries)) {
      return extractDeliveryMessageIds(deliveryRecord.deliveries);
    }

    const raw = deliveryRecord.message_id ?? deliveryRecord.messageId;
    const value = typeof raw === 'number' ? raw : Number(raw);
    if (Number.isFinite(value)) {
      return [value];
    }
  }

  return [];
}

function extractDeliveredAssistantMessages(toolResult: Record<string, unknown>): DeliveredAssistantMessage[] {
  const messages = extractSentMessages(toolResult);
  const deliveryIds = extractDeliveryMessageIds(toolResult.delivery);

  return messages.map((content, index) => ({
    content,
    deliveryMessageId: deliveryIds[index] ?? null
  }));
}

function buildOutboundFingerprint(payload: OutboundDeliveryFingerprint) {
  return JSON.stringify({
    message_type: payload.messageType,
    messages: payload.messages,
    mention_user_ids: payload.mentionUserIds
  });
}

function buildDuplicateOutboundSuppression(toolCall: Pick<AgentToolCall, 'name' | 'args'>) {
  if (!isPrivateReplyToolName(toolCall.name) && !isGroupReplyToolName(toolCall.name)) {
    return null;
  }

  const messages = normalizeMessages(toolCall.args);
  if (messages.length === 0) {
    return null;
  }

  const payload: OutboundDeliveryFingerprint = {
    messageType: isPrivateReplyToolName(toolCall.name) ? 'private' : 'group',
    messages,
    mentionUserIds: isGroupReplyToolName(toolCall.name)
      ? normalizeOptionalIntegerList(toolCall.args.mention_user_ids)
      : []
  };

  return {
    fingerprint: buildOutboundFingerprint(payload),
    payload
  };
}

function buildOutboundFingerprintFromToolResult(toolResult: Record<string, unknown>) {
  const messageType = toolResult.message_type === 'private' || toolResult.message_type === 'group'
    ? toolResult.message_type
    : null;
  if (!messageType) {
    return null;
  }

  const messages = extractSentMessages(toolResult);
  if (messages.length === 0) {
    return null;
  }

  return buildOutboundFingerprint({
    messageType,
    messages,
    mentionUserIds: messageType === 'group'
      ? normalizeOptionalIntegerList(toolResult.mention_user_ids)
      : []
  });
}

function buildAssistantTranscriptItems(params: {
  queueMessage: QueueMessageRecord['payload'];
  deliveredMessages: DeliveredAssistantMessage[];
  completed: boolean;
}): ConversationTranscriptItem[] {
  if (params.deliveredMessages.length === 0) {
    return [];
  }

  return params.deliveredMessages.map((message, index) => {
    const isFinalMessage = params.completed && index === params.deliveredMessages.length - 1;
    return {
      id: null,
      conversationId: 0,
      sessionKey: params.queueMessage.sessionKey,
      role: 'assistant',
      phase: isFinalMessage ? 'final_answer' : 'commentary',
      content: message.content,
      groupIndex: 1,
      itemIndex: index,
      source: 'delivery',
      deliveryMessageId: message.deliveryMessageId,
      runId: params.queueMessage.runId,
      traceId: params.queueMessage.traceId
    };
  });
}

function appendRuntimePromptSection(basePrompt: string, sectionTitle: string, sectionBody: string) {
  const normalizedBase = basePrompt.trim();
  const normalizedBody = sectionBody.trim();

  if (!normalizedBody) {
    return normalizedBase;
  }

  return `${normalizedBase}\n\n${sectionTitle}\n${normalizedBody}`;
}

function composeSystemPrompt(
  systemPrompt: string,
  chatType: 'group' | 'direct'
) {
  let composed = systemPrompt.trim();

  if (chatType === 'group') {
    composed = appendRuntimePromptSection(
      composed,
      'Runtime behavior contract:',
      GROUP_REPLY_BEHAVIOR_CONTRACT
    );
  }

  return composed;
}

function buildRuntimeGuidanceContent(params: {
  currentMessageText?: string | null;
  preReplyMemoryGateDecision?: PreReplyMemoryGateDecision | null;
  presentSelf?: PresentSelfReconstruction | null;
  surfaceAnchors?: string[];
  topicProjection?: {
    activeTopics?: RuntimeTopicProjection[];
  } | null;
}) {
  const sections: string[] = [];

  const preReplyGateSection = formatPreReplyMemoryGateSection(params.preReplyMemoryGateDecision);
  if (preReplyGateSection) {
    sections.push(`Pre-reply memory gate:\n${preReplyGateSection}`);
  }

  const presentSelfSection = formatPresentSelfSection(params.presentSelf);
  if (presentSelfSection) {
    sections.push(`Present self reconstruction:\n${presentSelfSection}`);
  }

  if (
    params.presentSelf?.shouldSurface
    && (params.presentSelf.socialPositionNow === 'edge_observer' || params.presentSelf.socialPositionNow === 'light_joiner')
    && Array.isArray(params.surfaceAnchors)
    && params.surfaceAnchors.length > 0
  ) {
    sections.push(formatLiveThreadTextureSection(params.surfaceAnchors));
  }

  if (shouldUsePlainFactualRenderer(params.currentMessageText || '', params.presentSelf)) {
    sections.push([
      'Renderer mode:',
      '这是一次事实回执、事实纠正或具体内容问答场景。',
      '不要展开此刻的自我感，不要新造比喻，不要补内部状态说明。',
      '只按对方刚问的具体点，给一句朴素、口语化、可核对的短答。'
    ].join('\n'));
  }

  const ownTakeSection = formatOwnTakeSection(params.presentSelf);
  if (ownTakeSection) {
    sections.push(ownTakeSection);
  }

  const topicContinuitySection = formatTopicContinuitySection(params.topicProjection?.activeTopics);
  if (topicContinuitySection) {
    sections.push(topicContinuitySection);
  }

  if (sections.length === 0) {
    return '';
  }

  return [
    'Runtime guidance:',
    '这些是本轮临时约束，不是长期设定。当前真实聊天与后续工具结果优先。',
    sections.join('\n\n')
  ].join('\n');
}

function formatLiveThreadTextureSection(surfaceAnchors: string[]) {
  const texture = analyzeLiveThreadTexture(surfaceAnchors);

  return [
    'Live thread texture:',
    texture.rollingRiff
      ? '最近几句是短句滚动接拍，重点是顺着现场补半步，不是自己另起一轮。'
      : '最近几句长度和完成度不一，优先看现场已经成型到什么程度，再决定要不要冒头。',
    texture.hasLongStandoutLine
      ? '如果刚刚已经有人把那句完整的话说漂亮了，你不要接着做润色复述。'
      : '这轮还没有谁明显抢走“最会说”的位置，你也不要主动去占那个位置。',
    texture.avgLength > 0
      ? `最近几句平均长度大约 ${texture.avgLength} 个字，尽量匹配这个完成度，不要突然写得更工整。`
      : '默认按更轻、更短、更不完整的方向处理。'
  ].join('\n');
}

function analyzeLiveThreadTexture(surfaceAnchors: string[]) {
  const anchors = surfaceAnchors.filter(Boolean);
  const avgLength = anchors.length > 0
    ? Math.round(anchors.reduce((sum, anchor) => sum + anchor.length, 0) / anchors.length)
    : 0;
  const hasLongStandoutLine = anchors.some((anchor) => anchor.length >= 18 || /，|。|：|！|？|,|\.|:|!|\?/u.test(anchor));
  const allShort = anchors.length > 0 && anchors.every((anchor) => anchor.length <= 12);
  const rollingRiff = anchors.length >= 2 && allShort;

  return {
    avgLength,
    hasLongStandoutLine,
    rollingRiff
  };
}

function formatTopicContinuitySection(activeTopics?: RuntimeTopicProjection[] | null) {
  const topics = Array.isArray(activeTopics)
    ? activeTopics.filter((topic) => topic.title && topic.summaryText).slice(0, 2)
    : [];
  if (topics.length === 0) {
    return '';
  }

  return [
    'Topic continuity:',
    '如果现场是在续一个已经成型的话题，优先沿用这个话题已有的词和关系，不要突然改 framing。',
    ...topics.map((topic, index) => [
      `- topic_${index + 1}: ${topic.title} [${topic.source}/${topic.lifecycleState}]`,
      `  summary: ${topic.summaryText}`,
      topic.topicKeywords.length > 0 ? `  keywords: ${topic.topicKeywords.join(', ')}` : '',
      topic.relationshipSummaries.length > 0 ? `  inside-topic lines: ${topic.relationshipSummaries.join('；')}` : ''
    ].filter(Boolean).join('\n'))
  ].join('\n');
}

function formatTopicProjectionPromptSection(activeTopics?: RuntimeTopicProjection[] | null) {
  const topics = Array.isArray(activeTopics)
    ? activeTopics.filter((topic) => topic.title && topic.summaryText).slice(0, 3)
    : [];
  if (topics.length === 0) {
    return '(none)';
  }

  return topics.map((topic) => [
    `title=${topic.title}`,
    `summary=${topic.summaryText}`,
    `source=${topic.source}`,
    `lifecycle=${topic.lifecycleState}`,
    topic.topicKeywords.length > 0 ? `keywords=${topic.topicKeywords.join(', ')}` : '',
    topic.participantIds.length > 0 ? `participant_ids=${topic.participantIds.join(', ')}` : '',
    topic.relationshipSummaries.length > 0 ? `inside_topic_lines=${topic.relationshipSummaries.join(' ; ')}` : ''
  ].filter(Boolean).join(' | ')).join('\n');
}

function shouldUseOwnTakeMode(presentSelf?: PresentSelfReconstruction | null) {
  if (!presentSelf?.shouldSurface) {
    return false;
  }

  return presentSelf.answerShape === 'micro_take_then_stop'
    || presentSelf.answerShape === 'compare_and_choose'
    || presentSelf.answerShape === 'soft_disagree_then_ground';
}

function formatOwnTakeSection(presentSelf?: PresentSelfReconstruction | null) {
  if (!shouldUseOwnTakeMode(presentSelf)) {
    return '';
  }

  return [
    'Own take mode:',
    '这次不是只要接住气氛。你需要给一个短而明确的判断，不能只附和、复述或哈哈一下。',
    '先给结论，再补半句理由。一个小观点就够，但要让人看出你站哪边。',
    '如果你和场上已有说法不完全一样，允许轻微不同意。重点是自然、有根据，不是抬杠。',
    '避免“对/是/确实/像/有点”这种只有态度没有内容的句子。'
  ].join('\n');
}

function shouldUseGroupReplyTasteJudge(
  queueMessage: QueueMessageRecord['payload'],
  presentSelf?: PresentSelfReconstruction | null
) {
  if (!presentSelf || queueMessage.chatType !== 'group' || queueMessage.wasMentioned) {
    return false;
  }

  if (presentSelf.socialPositionNow !== 'edge_observer' && presentSelf.socialPositionNow !== 'light_joiner') {
    return false;
  }

  const texture = analyzeLiveThreadTexture(extractLiveSurfaceAnchors(queueMessage));
  if (texture.rollingRiff && !texture.hasLongStandoutLine) {
    return false;
  }

  return presentSelf.entryIntent === 'hover'
    || presentSelf.entryIntent === 'drop_reaction'
    || presentSelf.entryIntent === 'push_half_step';
}

function buildGroupReplyCandidates(messages: string[]) {
  const candidates: GroupReplyCandidate[] = [];
  const seen = new Set<string>();

  const pushCandidate = (label: string, candidateMessages: string[]) => {
    const normalizedMessages = candidateMessages.map((message) => message.trim()).filter(Boolean);
    if (normalizedMessages.length === 0) {
      return;
    }

    const key = JSON.stringify(normalizedMessages);
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    candidates.push({
      label,
      messages: normalizedMessages
    });
  };

  pushCandidate('as_is', messages);

  if (messages.length > 1) {
    pushCandidate('first_beat_only', [messages[0]]);
  }

  const firstMessage = messages[0]?.trim() || '';
  if (firstMessage) {
    const firstClause = firstMessage
      .split(/[，,。！？!?；;]\s*/u)
      .map((part) => part.trim())
      .find((part) => part.length >= 3 && part.length < firstMessage.length);
    if (firstClause) {
      pushCandidate('clipped_first_clause', [firstClause]);
    }
  }

  return candidates;
}

function parseTasteJudgeDecision(raw: string, candidateCount: number) {
  try {
    const parsed = JSON.parse(raw) as {
      choice_index?: number;
      rationale?: string;
    };
    const choiceIndex = Number(parsed.choice_index);
    if (!Number.isInteger(choiceIndex) || choiceIndex < 0 || choiceIndex > candidateCount) {
      return null;
    }

    return {
      choiceIndex,
      rationale: typeof parsed.rationale === 'string' ? parsed.rationale : null
    };
  } catch {
    return null;
  }
}

function buildGroupReplyTasteJudgePrompt(params: {
  queueMessage: QueueMessageRecord['payload'];
  presentSelf: PresentSelfReconstruction;
  candidates: GroupReplyCandidate[];
}) {
  const recentMessages = params.queueMessage.messages
    .map((message, index) => `${index + 1}. ${formatIdentity(message.senderName, message.senderId)}: ${normalizeTranscriptMessageText(message.bodyForAgent || '', message.inboundContext.MentionedUsers)}`)
    .slice(-4)
    .join('\n');

  const candidateLines = params.candidates
    .map((candidate, index) => `${index + 1}. [${candidate.label}] ${candidate.messages.join(' / ')}`)
    .join('\n');

  return [
    'You are judging QQ group chat reply candidates for 小腻.',
    'Pick the candidate that feels most like a normal group member, not a bot and not a copycat.',
    'Candidate 0 means stay silent.',
    'Prefer silence when every candidate feels too polished, too explanatory, too eager, too much like repeating someone else, or too much like stealing the best line.',
    'Reject candidates that mainly restate a recent human line with lighter polish, added filler, or tiny wording changes.',
    'Reject candidates that sound more writerly or more complete than the surrounding scene.',
    'For light_joiner and edge_observer scenes, the best line is usually the lowest-claim one.',
    'Return strict JSON only with keys: choice_index, rationale.',
    '',
    `social_position_now=${params.presentSelf.socialPositionNow}`,
    `entry_intent=${params.presentSelf.entryIntent}`,
    `beat_style=${params.presentSelf.beatPlan.beatStyle}`,
    `Current batch:\n${recentMessages || '(none)'}`,
    '',
    'Candidates:',
    '0. [silent] [[SILENT]]',
    candidateLines,
    '',
    'Output example:',
    '{"choice_index":0,"rationale":"all candidates feel like paraphrased repeats"}'
  ].join('\n');
}

function extractLiveSurfaceAnchors(queueMessage: QueueMessageRecord['payload']) {
  return queueMessage.messages
    .map((message) => normalizeTranscriptMessageText(message.bodyForAgent || '', message.inboundContext.MentionedUsers))
    .filter(Boolean)
    .slice(-3)
    .map((text) => text.length > 28 ? text.slice(0, 28) : text);
}

function formatRelationshipCard(card: RuntimeRelationshipMemoryCard) {
  const details = [
    `核心提示: ${card.summaryText}`,
    card.contextBefore ? `适用场景: ${card.contextBefore}` : '',
    card.trigger ? `触发 cue: ${card.trigger}` : '',
    card.interaction ? `建议动作: ${card.interaction}` : '',
    card.outcome ? `避免事项: ${card.outcome}` : ''
  ].filter(Boolean);
  return `- ${details.join(' | ')}`;
}

function formatRelationshipMemorySection(relationshipMemory?: {
  groupCards?: RuntimeRelationshipMemoryCard[];
  currentUserCards?: RuntimeRelationshipMemoryCard[];
  recentUserCards?: RuntimeRelationshipMemoryCard[];
} | null) {
  if (!relationshipMemory) {
    return '';
  }

  const sections: string[] = [
    '这些记忆是有损投影，不是绝对真相。当前批次真实聊天记录优先。',
    '这些卡片不是人物小传，而是回复时可用的社交 cue。',
    '只有在自然合适时才轻轻提旧梗、续旧话，不要每次都硬提。'
  ];

  const groupCards = Array.isArray(relationshipMemory.groupCards) ? relationshipMemory.groupCards : [];
  if (groupCards.length > 0) {
    sections.push(`群公共记忆:\n${groupCards.map(formatRelationshipCard).join('\n')}`);
  }

  const currentUserCards = Array.isArray(relationshipMemory.currentUserCards) ? relationshipMemory.currentUserCards : [];
  if (currentUserCards.length > 0) {
    sections.push(`当前发言人关系记忆:\n${currentUserCards.map(formatRelationshipCard).join('\n')}`);
  }

  const recentUserCards = Array.isArray(relationshipMemory.recentUserCards) ? relationshipMemory.recentUserCards : [];
  if (recentUserCards.length > 0) {
    sections.push(`最近相关他人记忆:\n${recentUserCards.map(formatRelationshipCard).join('\n')}`);
  }

  return sections.length > 2 ? sections.join('\n\n') : '';
}

function formatSelfEvolutionState(state: RuntimeSelfEvolutionState) {
  const pieces = [
    `长期变化: ${state.summaryText}`,
    `presence=${state.socialPresenceBaseline}`,
    `entry=${state.entryPreference}`,
    `warmth=${state.warmthBias}`,
    `ceiling=${state.familiarityCeiling}`,
    state.reinforcedModes.length > 0 ? `reinforced=${state.reinforcedModes.join(', ')}` : '',
    state.suppressedModes.length > 0 ? `suppressed=${state.suppressedModes.join(', ')}` : ''
  ].filter(Boolean);
  return `- ${pieces.join(' | ')}`;
}

function formatSelfEvolutionSection(selfEvolution?: {
  groupStates?: RuntimeSelfEvolutionState[];
  currentUserStates?: RuntimeSelfEvolutionState[];
  recentUserStates?: RuntimeSelfEvolutionState[];
} | null) {
  if (!selfEvolution) {
    return '';
  }

  const sections: string[] = [
    '这些不是人设文案，而是过去经历留下来的长期变化。',
    '它们描述的是小腻更容易怎样出现、怎样靠近、怎样收着。'
  ];
  const groupStates = Array.isArray(selfEvolution.groupStates) ? selfEvolution.groupStates : [];
  if (groupStates.length > 0) {
    sections.push(`群里的长期自我变化:\n${groupStates.map(formatSelfEvolutionState).join('\n')}`);
  }
  const currentUserStates = Array.isArray(selfEvolution.currentUserStates) ? selfEvolution.currentUserStates : [];
  if (currentUserStates.length > 0) {
    sections.push(`面对当前发言人的长期变化:\n${currentUserStates.map(formatSelfEvolutionState).join('\n')}`);
  }
  const recentUserStates = Array.isArray(selfEvolution.recentUserStates) ? selfEvolution.recentUserStates : [];
  if (recentUserStates.length > 0) {
    sections.push(`面对最近相关他人的长期变化:\n${recentUserStates.map(formatSelfEvolutionState).join('\n')}`);
  }

  return sections.length > 2 ? sections.join('\n\n') : '';
}

function filterRelationshipMemoryByIds(
  relationshipMemory: {
    groupCards?: RuntimeRelationshipMemoryCard[];
    currentUserCards?: RuntimeRelationshipMemoryCard[];
    recentUserCards?: RuntimeRelationshipMemoryCard[];
  } | null | undefined,
  relevantMemoryIds: number[]
) {
  if (!relationshipMemory) {
    return relationshipMemory || null;
  }

  const allowedIds = new Set(
    relevantMemoryIds
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0)
  );
  if (allowedIds.size === 0) {
    return {
      groupCards: [],
      currentUserCards: [],
      recentUserCards: []
    };
  }

  return {
    groupCards: (Array.isArray(relationshipMemory.groupCards) ? relationshipMemory.groupCards : [])
      .filter((card) => allowedIds.has(card.id)),
    currentUserCards: (Array.isArray(relationshipMemory.currentUserCards) ? relationshipMemory.currentUserCards : [])
      .filter((card) => allowedIds.has(card.id)),
    recentUserCards: (Array.isArray(relationshipMemory.recentUserCards) ? relationshipMemory.recentUserCards : [])
      .filter((card) => allowedIds.has(card.id))
  };
}

function formatPreReplyMemoryGateSection(decision?: PreReplyMemoryGateDecision | null) {
  if (!decision || !decision.shouldReply) {
    return '';
  }

  const hints = [
    '这次进入发言前，社交判断已经认为现在适合你自然接一句。',
    decision.cueToBot === true ? '这是一次明确或高置信度的 cue。' : '',
    decision.addresseeUserId ? `当前主要对话对象 user_id: ${decision.addresseeUserId}` : '',
    decision.relevantMemoryIds.length > 0 ? `只优先参考这些已命中的关系记忆卡: ${decision.relevantMemoryIds.join(', ')}` : '',
    decision.rationale ? `进场理由: ${decision.rationale}` : '',
    decision.cueToBot === true
      ? '先用最朴素自然的话接住，再决定要不要轻轻加一点熟悉感。'
      : '这次不是被点名后的答复任务，而是现场里轻轻顺一下。',
    '默认只回一小句；只有对方同一句里真的问了两个点，才补第二小句。',
    '保持短句、自然、轻一点，不要因为有记忆就把语气写重。',
    decision.cueToBot === true ? '如果对方是在问你刚才为什么没回，先直接回答这个问题，不要先抖机灵。' : '',
    decision.cueToBot === true ? '' : '不要把自己写成在确认别人说得对，更像是顺手补半拍。',
    decision.cueToBot === true ? '' : '围观插入时，避免句首出现“对 / 是 / 确实 / 就是”这类表态词。',
    decision.cueToBot === true ? '' : '围观插入时，少用抽象判断句、概括句、定义句。',
    decision.cueToBot === true ? '' : '少用“就是那种/很有...感/属于是...”这类把现场收成概念的尾巴。',
    decision.cueToBot === true ? '' : '优先沿用现场已经出现的词和隐喻链，不要自己另开更大的画面或新框架。',
    decision.cueToBot === true ? '' : '围观插入能少一个分句就少一个分句，默认不要用逗号把意思讲完整。',
    decision.cueToBot === true ? '' : '不要替现场把意思收完，少用“最后/就/自己/还能/已经/先...”这类带收束感的尾巴。',
    '如果一句“活着，刚看到消息”“刚没看手机”“第一次见呀”就够了，不要再多解释半拍。',
    '不要为了显得有现场感，凭空补“卡住了/好了/抽了一下/出 bug 了”这类内部状态说明。',
    '不要比场上其他人更会玩梗。对方只是轻轻打趣时，你只顺着接住，不要新造比喻、设定或画面。',
    '如果对方问的是具体内容或具体发生了什么，就直接回答那件事本身，不要换成更抽象的概括。',
    '尽量不要换行，不要写成两段，也不要加 emoji。',
    '默认避免“诈尸/回魂/赛博/量子态”这类重口语黑话，除非对方刚刚已经这么说。',
    '这次更像是在互动里显示“我也在”，不是在给出一条内容完整的答复。'
  ].filter(Boolean);

  return hints.join('\n');
}

function formatPresentSelfSection(presentSelf?: PresentSelfReconstruction | null) {
  if (!presentSelf || !presentSelf.shouldSurface) {
    return '';
  }

  return [
    '这是已经收束好的渲染约束，不是完整内在状态。',
    '只把它理解成这句回复的边界、熟悉度和长度限制，不要把约束标签直接说出口。',
    '不要把这句写得比场上其他人更会演、更会解释或更会玩梗。',
    `presence_level: ${presentSelf.presenceLevel}`,
    `familiarity_limit_now: ${presentSelf.familiarityLimitNow}`,
    `social_position_now: ${presentSelf.socialPositionNow}`,
    `target_person_id: ${presentSelf.targetPersonId ?? 'none'}`,
    `entry_intent: ${presentSelf.entryIntent}`,
    `answer_shape: ${presentSelf.answerShape}`,
    `beat_plan: ${presentSelf.beatPlan.beatStyle} x${presentSelf.beatPlan.beatCount} (${presentSelf.beatPlan.secondBeatPolicy})`,
    `exit_rule: ${presentSelf.exitRule}`,
    ...(presentSelf.rendererGuidance.length > 0 ? presentSelf.rendererGuidance.map((item) => `- ${item}`) : [])
  ].filter(Boolean).join('\n');
}

function shouldUsePlainFactualRenderer(messageText: string, presentSelf?: PresentSelfReconstruction | null) {
  if (!presentSelf?.shouldSurface) {
    return false;
  }
  const text = messageText.trim();
  if (!text) {
    return false;
  }
  return /多久|发生什么|收到啥|收到什么|哪条|卡了|重复|重发|发了三遍|艾特/u.test(text);
}

function collectRelationshipMemoryCards(relationshipMemory?: {
  groupCards?: RuntimeRelationshipMemoryCard[];
  currentUserCards?: RuntimeRelationshipMemoryCard[];
  recentUserCards?: RuntimeRelationshipMemoryCard[];
} | null) {
  if (!relationshipMemory) {
    return [];
  }

  return [
    ...(Array.isArray(relationshipMemory.groupCards) ? relationshipMemory.groupCards : []),
    ...(Array.isArray(relationshipMemory.currentUserCards) ? relationshipMemory.currentUserCards : []),
    ...(Array.isArray(relationshipMemory.recentUserCards) ? relationshipMemory.recentUserCards : [])
  ];
}

function stripJsonCodeFence(text: string) {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```')) {
    return trimmed;
  }

  return trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function parseOptionalBoolean(value: unknown) {
  return typeof value === 'boolean' ? value : null;
}

function parseOptionalInteger(value: unknown) {
  const normalized = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return null;
  }
  return normalized;
}

function parsePreReplyMemoryGateDecision(
  text: string,
  validCardIds: Set<number>
): PreReplyMemoryGateDecision | null {
  try {
    const parsed = JSON.parse(stripJsonCodeFence(text)) as {
      should_reply?: unknown;
      cue_to_bot?: unknown;
      addressee_user_id?: unknown;
      relevant_memory_ids?: unknown;
      rationale?: unknown;
    };
    const shouldReply = typeof parsed.should_reply === 'boolean' ? parsed.should_reply : null;
    if (shouldReply === null) {
      return null;
    }

    const relevantMemoryIds = Array.isArray(parsed.relevant_memory_ids)
      ? Array.from(new Set(
          parsed.relevant_memory_ids
            .map((value) => parseOptionalInteger(value))
            .filter((value): value is number => value !== null && validCardIds.has(value))
        ))
      : [];

    return {
      shouldReply,
      cueToBot: parseOptionalBoolean(parsed.cue_to_bot),
      addresseeUserId: parseOptionalInteger(parsed.addressee_user_id),
      relevantMemoryIds,
      rationale: typeof parsed.rationale === 'string' && parsed.rationale.trim()
        ? parsed.rationale.trim()
        : null
    };
  } catch {
    return null;
  }
}

function parseStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .slice(0, 6);
}

function parsePresentSelfReconstruction(text: string): PresentSelfReconstruction | null {
  try {
    const parsed = JSON.parse(stripJsonCodeFence(text)) as Record<string, unknown>;
    if (typeof parsed.should_surface !== 'boolean') {
      return null;
    }
    const beatCountValue = parsed.beat_count === 2 ? 2 : 1;
    const beatStyleValue = parsed.beat_style === 'reaction_fragment'
      || parsed.beat_style === 'split_two'
      || parsed.beat_style === 'single_complete'
      ? parsed.beat_style
      : (beatCountValue === 2 ? 'split_two' : 'single_complete');
    const secondBeatPolicyValue = parsed.second_beat_policy === 'only_if_picked_up'
      ? 'only_if_picked_up'
      : 'never';
    return {
      shouldSurface: parsed.should_surface === true,
      presenceLevel: typeof parsed.presence_level === 'string' && parsed.presence_level.trim()
        ? parsed.presence_level.trim()
        : 'light',
      currentSelfMode: typeof parsed.current_self_mode === 'string' && parsed.current_self_mode.trim()
        ? parsed.current_self_mode.trim()
        : 'light_surface',
      feltPull: typeof parsed.felt_pull === 'string' && parsed.felt_pull.trim()
        ? parsed.felt_pull.trim()
        : null,
      activeRelationLines: parseStringArray(parsed.active_relation_lines),
      activePastEchoes: parseStringArray(parsed.active_past_echoes),
      familiarityLimitNow: typeof parsed.familiarity_limit_now === 'string' && parsed.familiarity_limit_now.trim()
        ? parsed.familiarity_limit_now.trim()
        : 'warm_not_performative',
      answerShape: typeof parsed.answer_shape === 'string' && parsed.answer_shape.trim()
        ? parsed.answer_shape.trim()
        : 'brief_reassure_then_stop',
      rendererGuidance: parseStringArray(parsed.renderer_guidance),
      socialPositionNow: parsed.social_position_now === 'edge_observer'
        || parsed.social_position_now === 'light_joiner'
        || parsed.social_position_now === 'thread_pusher'
        || parsed.social_position_now === 'targeted_responder'
        ? parsed.social_position_now
        : 'light_joiner',
      targetPersonId: parseOptionalInteger(parsed.target_person_id),
      entryIntent: parsed.entry_intent === 'hover'
        || parsed.entry_intent === 'stick_to_person'
        || parsed.entry_intent === 'push_half_step'
        || parsed.entry_intent === 'drop_reaction'
        ? parsed.entry_intent
        : 'hover',
      beatPlan: {
        beatCount: beatCountValue,
        beatStyle: beatStyleValue,
        secondBeatPolicy: secondBeatPolicyValue
      },
      exitRule: parsed.exit_rule === 'wait_for_pickup' ? 'wait_for_pickup' : 'stop_immediately',
      rationale: typeof parsed.rationale === 'string' && parsed.rationale.trim()
        ? parsed.rationale.trim()
        : null
    };
  } catch {
    return null;
  }
}

function buildPreReplyMemoryGatePrompt(params: {
  queueMessage: QueueMessageRecord['payload'];
  history: ConversationTurn[];
  summaryText: string | null;
  relationshipMemory?: {
    groupCards?: RuntimeRelationshipMemoryCard[];
    currentUserCards?: RuntimeRelationshipMemoryCard[];
      recentUserCards?: RuntimeRelationshipMemoryCard[];
    } | null;
  topicProjection?: {
      activeTopics?: RuntimeTopicProjection[];
    } | null;
}) {
  const recentHistory = params.history
    .slice(-4)
    .flatMap((turn) => Array.isArray(turn.items) && turn.items.length > 0
      ? turn.items.map((item) => `${item.role === 'assistant' ? 'assistant' : 'user'}${item.phase ? `/${item.phase}` : ''}: ${item.content}`)
      : [
          `user: ${turn.userMessage}`,
          ...(turn.aiResponse ? [`assistant: ${turn.aiResponse}`] : [])
        ])
    .slice(-10);

  const memoryCards = collectRelationshipMemoryCards(params.relationshipMemory);
  const renderedMemoryCards = memoryCards.length > 0
    ? memoryCards.map((card) => [
        `id=${card.id}`,
        `summary=${card.summaryText}`,
        card.contextBefore ? `context_before=${card.contextBefore}` : '',
        card.trigger ? `trigger=${card.trigger}` : '',
        card.interaction ? `interaction=${card.interaction}` : '',
        card.outcome ? `outcome=${card.outcome}` : ''
      ].filter(Boolean).join(' | ')).join('\n')
    : '(none)';

  return [
    'You are a pre-reply memory gate for a QQ group chat bot.',
    'Decide whether the bot should naturally speak now or stay silent.',
    'Prioritize human-like social timing over completeness.',
    'Return strict JSON only with keys: should_reply, cue_to_bot, addressee_user_id, relevant_memory_ids, rationale.',
    'Use addressee_user_id only when the current message is mainly directed at one specific person.',
    'If the bot is only mentioned in third person, is merely part of background context, or joining would feel intrusive, set should_reply=false.',
    'If the bot is already in the live thread and a short follow-up would feel normal, should_reply can still be true even without an explicit mention.',
    'A rolling thread between other people can also justify should_reply=true when the bot can add one short same-register line without stealing focus, changing topic, or forcing others to respond.',
    'Do not require the latest message to be about the bot. If the scene is already alive and the bot can naturally slip in with one light line, that is allowed.',
    'Set should_reply=false only when the best move is clearly to stay outside the scene, not merely because nobody explicitly invited the bot.',
    '',
    `Current sender: ${formatIdentity(params.queueMessage.senderName, params.queueMessage.senderId)}`,
    `Current batch:\n${renderConversationInput(params.queueMessage)}`,
    `Current turn view:\n${buildCurrentTurnMessage(params.queueMessage)}`,
    `Conversation summary:\n${params.summaryText?.trim() || '(none)'}`,
    `Active topic projections:\n${formatTopicProjectionPromptSection(params.topicProjection?.activeTopics)}`,
    `Relationship memory cards:\n${renderedMemoryCards}`,
    `Recent transcript:\n${recentHistory.length > 0 ? recentHistory.join('\n') : '(none)'}`,
    '',
    'Examples:',
    '- "小腻你活了？" => should_reply=true, cue_to_bot=true.',
    '- "李阿花刚才问你活没活，你咋不应声" => should_reply=true because the bot is still being directly asked to account for itself.',
    '- Two other users saying the group is quiet, without directly addressing the bot => should_reply=false.',
    '- If the bot was already part of the immediate thread and the newest line is a natural handoff, should_reply can be true even without @mention.',
    '- If two or three people are rapidly stacking one-liners on the same joke or topic, and the bot can add one more short line in the same register, should_reply can be true even without @mention.',
    '- For rolling thread joins, addressee_user_id should usually stay null because the line belongs to the scene, not to one specific person.',
    '- In a fast-moving thread, do not reject just because the latest line is about the topic rather than about the bot.',
    '',
    'Output example:',
    '{"should_reply":false,"cue_to_bot":false,"addressee_user_id":null,"relevant_memory_ids":[],"rationale":"third-person mention only"}'
  ].join('\n');
}

function buildPresentSelfPrompt(params: {
  queueMessage: QueueMessageRecord['payload'];
  history: ConversationTurn[];
  summaryText: string | null;
  preReplyMemoryGateDecision: PreReplyMemoryGateDecision;
  relationshipMemory?: {
    groupCards?: RuntimeRelationshipMemoryCard[];
    currentUserCards?: RuntimeRelationshipMemoryCard[];
    recentUserCards?: RuntimeRelationshipMemoryCard[];
  } | null;
  selfEvolution?: {
    groupStates?: RuntimeSelfEvolutionState[];
    currentUserStates?: RuntimeSelfEvolutionState[];
    recentUserStates?: RuntimeSelfEvolutionState[];
  } | null;
  topicProjection?: {
    activeTopics?: RuntimeTopicProjection[];
  } | null;
}) {
  const recentHistory = params.history
    .slice(-4)
    .flatMap((turn) => Array.isArray(turn.items) && turn.items.length > 0
      ? turn.items.map((item) => `${item.role === 'assistant' ? 'assistant' : 'user'}${item.phase ? `/${item.phase}` : ''}: ${item.content}`)
      : [
          `user: ${turn.userMessage}`,
          ...(turn.aiResponse ? [`assistant: ${turn.aiResponse}`] : [])
        ])
    .slice(-10);

  const relationshipCards = collectRelationshipMemoryCards(params.relationshipMemory)
    .map((card) => [
      `id=${card.id}`,
      `summary=${card.summaryText}`,
      card.trigger ? `trigger=${card.trigger}` : '',
      card.interaction ? `interaction=${card.interaction}` : '',
      card.outcome ? `avoid=${card.outcome}` : ''
    ].filter(Boolean).join(' | '))
    .join('\n');

  const selfEvolutionStates = [
    ...(Array.isArray(params.selfEvolution?.groupStates) ? params.selfEvolution?.groupStates : []),
    ...(Array.isArray(params.selfEvolution?.currentUserStates) ? params.selfEvolution?.currentUserStates : []),
    ...(Array.isArray(params.selfEvolution?.recentUserStates) ? params.selfEvolution?.recentUserStates : [])
  ]
    .map((state) => [
      `scope=${state.scopeType}`,
      `target_user_id=${state.targetUserId ?? 'group'}`,
      `summary=${state.summaryText}`,
      `presence=${state.socialPresenceBaseline}`,
      `entry=${state.entryPreference}`,
      `warmth=${state.warmthBias}`,
      `ceiling=${state.familiarityCeiling}`,
      state.reinforcedModes.length > 0 ? `reinforced=${state.reinforcedModes.join(', ')}` : '',
      state.suppressedModes.length > 0 ? `suppressed=${state.suppressedModes.join(', ')}` : ''
    ].filter(Boolean).join(' | '))
    .join('\n');

  return [
    'You are reconstructing the present self of 小腻 in a QQ group chat.',
    'Do not plan tools. Do not write the final reply. Reconstruct who 小腻 is in this exact moment.',
    'Think of today\'s 小腻 as a collapse of her past experiences, relationships, and current scene.',
    'Return strict JSON only with keys: should_surface, presence_level, current_self_mode, felt_pull, active_relation_lines, active_past_echoes, familiarity_limit_now, answer_shape, renderer_guidance, social_position_now, target_person_id, entry_intent, beat_count, beat_style, second_beat_policy, exit_rule, rationale.',
    'Prioritize human continuity and boundary. This is not a persona card.',
    'This output is an internal latent state for rendering, not user-facing wording.',
    'Keep felt_pull/current_self_mode/renderer_guidance plain and abstract, not catchy or quoteable.',
    '',
    `Current sender: ${formatIdentity(params.queueMessage.senderName, params.queueMessage.senderId)}`,
    `Current batch:\n${renderConversationInput(params.queueMessage)}`,
    `Conversation summary:\n${params.summaryText?.trim() || '(none)'}`,
    `Pre-reply gate:\n${JSON.stringify({
      should_reply: params.preReplyMemoryGateDecision.shouldReply,
      cue_to_bot: params.preReplyMemoryGateDecision.cueToBot,
      addressee_user_id: params.preReplyMemoryGateDecision.addresseeUserId,
      rationale: params.preReplyMemoryGateDecision.rationale,
      relevant_memory_ids: params.preReplyMemoryGateDecision.relevantMemoryIds
    }, null, 2)}`,
    `Active topic projections:\n${formatTopicProjectionPromptSection(params.topicProjection?.activeTopics)}`,
    `Relationship memory cards:\n${relationshipCards || '(none)'}`,
    `Self evolution states:\n${selfEvolutionStates || '(none)'}`,
    `Recent transcript:\n${recentHistory.length > 0 ? recentHistory.join('\n') : '(none)'}`,
    '',
    'Guidance:',
    '- If she should speak now, decide how much of her should surface, not what exact sentence to say.',
    '- Keep familiarity bounded. If the current relation line is light, do not overperform closeness.',
    '- answer_shape should be things like brief_reassure_then_stop, light_acknowledge, fragmental_play_along, direct_answer_then_stop.',
    '- For judgment/comparison scenes, answer_shape can also be micro_take_then_stop, compare_and_choose, or soft_disagree_then_ground.',
    '- Infer judgment/comparison/opinion scenes from semantics and interaction intent, not just literal cue words.',
    '- renderer_guidance should be very short constraints like "先报平安", "不要补第二拍", "不要上重梗".',
    '- Treat the live interaction as co-constructed: what she says should be fitted to what others just did, not a standalone polished sentence.',
    '- Do not reduce every natural group presence to fragmental_play_along. If people are asking what she thinks, she should usually have one small real take.',
    '- A light presence can still introduce a new angle. Human does not mean agreement-only.',
    '- In rolling banter, stay inside the thread vocabulary that is already on the table. Avoid importing a fresher expert term or new frame just to sound sharp.',
    '- In rolling banter, prefer tiny mutations of phrases already said over inventing a brand-new sentence pattern.',
    '- In rolling banter, fragments, noun phrases, and clipped half-lines are usually better than a neat full clause.',
    '- In rolling banter, minimal listener-like responses, fragments, and add-on beats are often more human than a complete propositional reply.',
    '- social_position_now should describe how she appears in this moment: edge_observer, light_joiner, thread_pusher, or targeted_responder.',
    '- target_person_id should be the main person she is socially sticking to right now. Use null only when this is truly thread-level and not attached to one person.',
    '- beat_count must be 1 or 2 only. Default to 1. Use 2 only when the live thread is already rolling and a second tiny beat would feel normal.',
    '- beat_style should usually be single_complete, reaction_fragment, or split_two.',
    '- second_beat_policy should be only_if_picked_up whenever beat_count=2.',
    '- exit_rule should be stop_immediately unless the scene clearly supports waiting for pickup.',
    '- When social_position_now is edge_observer or light_joiner, do not frame the line like an answer unless someone actually asked her.',
    '- In bystander joins, avoid opening with agreement markers such as "对", "是", "确实", or "就是". Go straight into the extra beat, image, or fragment.',
    '- In rolling banter, reaction_fragment or split_two is usually more human than single_complete.',
    '- Avoid latent phrasing that would tempt the renderer to literally say words like "冒头", "不在线", "cue我", "显形", "模式", or "版本".',
    '- For first-meeting or "you are AI too" banter, keep it at the level of the current line. Do not turn it into self-description.',
    '- For duplicate-send or glitch scenes, prefer plain acknowledgement over anthropomorphic phrases.',
    '- For mention-receipt scenes, prefer factual receipt wording over dramatic "you called me out" wording.',
    '',
    'Output example:',
    '{"should_surface":true,"presence_level":"light","current_self_mode":"loosely_in_the_same_wave","felt_pull":"the thread is already rolling and she can add one extra beat without pulling focus","active_relation_lines":["with current sender: same-register banter"],"active_past_echoes":["light group riffing"],"familiarity_limit_now":"warm_not_performative","answer_shape":"fragmental_play_along","renderer_guidance":["不要用对/是起手","优先半句感","不要抢主线"],"social_position_now":"light_joiner","target_person_id":202,"entry_intent":"push_half_step","beat_count":2,"beat_style":"split_two","second_beat_policy":"only_if_picked_up","exit_rule":"wait_for_pickup","rationale":"rolling banter supports one extra low-claim beat"}'
  ].join('\n');
}

function deriveHeuristicPreReplyMemoryGate(params: {
  queueMessage: QueueMessageRecord['payload'];
  history: ConversationTurn[];
  relationshipMemory?: {
    groupCards?: RuntimeRelationshipMemoryCard[];
      currentUserCards?: RuntimeRelationshipMemoryCard[];
      recentUserCards?: RuntimeRelationshipMemoryCard[];
  } | null;
  topicProjection?: {
    activeTopics?: RuntimeTopicProjection[];
  } | null;
}): PreReplyMemoryGateDecision {
  const text = `${params.queueMessage.bodyForAgent || ''}\n${params.queueMessage.inboundContext.ReplyToBody || ''}`.trim();
  const normalized = text.toLowerCase();
  const directCue = params.queueMessage.wasMentioned
    || /小腻|你活了|在吗|咋不|怎么没|为什么没|刚才没回|不应声/u.test(text);
  const likelyThirdPersonOnly = /就我和小腻|小腻刷屏|提到小腻|围观小腻/u.test(text) && !params.queueMessage.wasMentioned;
  const recentAssistantInThread = params.history
    .slice(-2)
    .some((turn) => Array.isArray(turn.items)
      ? turn.items.some((item) => item.role === 'assistant')
      : Boolean(turn.aiResponse));
  const recentUserItems = params.history
    .slice(-3)
    .flatMap((turn) => Array.isArray(turn.items) ? turn.items : []);
  const recentHumanSamePhase = recentUserItems
    .filter((item) => item.role === 'user')
    .map((item) => item.content.trim())
    .filter(Boolean)
    .slice(-3);
  const looksLikeRollingThread = recentHumanSamePhase.length >= 2
    && recentHumanSamePhase.every((content) => content.length <= 28)
    && /哈哈|确实|也是|有种|既视感|泡沫|空气|估值|完美契合|好看|套娃/u.test(
      `${recentHumanSamePhase.join('\n')}\n${text}`
    );
  const activeTopics = Array.isArray(params.topicProjection?.activeTopics)
    ? params.topicProjection.activeTopics
    : [];
  const senderInsideActiveTopic = activeTopics.some((topic) => topic.participantIds.includes(Number(params.queueMessage.senderId)));
  const topicKeywordHit = activeTopics.some((topic) => topic.topicKeywords.some((keyword) => keyword && text.includes(keyword)));
  const shouldReply = directCue
    ? !likelyThirdPersonOnly
    : (recentAssistantInThread || looksLikeRollingThread || (senderInsideActiveTopic && topicKeywordHit)) && !/不管|算了|别回/u.test(text);
  const memoryIds = shouldReply
    ? collectRelationshipMemoryCards(params.relationshipMemory).slice(0, 2).map((card) => card.id)
    : [];

  return {
    shouldReply,
    cueToBot: directCue ? true : null,
    addresseeUserId: shouldReply
      ? (directCue ? Number(params.queueMessage.senderId) : (looksLikeRollingThread ? null : Number(params.queueMessage.senderId)))
      : null,
    relevantMemoryIds: memoryIds,
    rationale: shouldReply
      ? (directCue
          ? 'heuristic_explicit_cue'
          : (looksLikeRollingThread
              ? 'heuristic_rolling_thread_join'
              : (senderInsideActiveTopic && topicKeywordHit ? 'heuristic_active_topic_continuation' : 'heuristic_thread_continuation')))
      : (likelyThirdPersonOnly ? 'heuristic_third_person_only' : `heuristic_silent_${normalized ? 'not_for_bot' : 'empty'}`)
  };
}

function deriveHeuristicPresentSelf(params: {
  queueMessage: QueueMessageRecord['payload'];
  preReplyMemoryGateDecision: PreReplyMemoryGateDecision;
  selfEvolution?: {
    groupStates?: RuntimeSelfEvolutionState[];
    currentUserStates?: RuntimeSelfEvolutionState[];
    recentUserStates?: RuntimeSelfEvolutionState[];
  } | null;
  topicProjection?: {
    activeTopics?: RuntimeTopicProjection[];
  } | null;
}): PresentSelfReconstruction {
  const text = `${params.queueMessage.bodyForAgent || ''}\n${params.queueMessage.inboundContext.ReplyToBody || ''}`.trim();
  const currentState = Array.isArray(params.selfEvolution?.currentUserStates) && params.selfEvolution?.currentUserStates.length > 0
    ? params.selfEvolution?.currentUserStates[0]
    : Array.isArray(params.selfEvolution?.groupStates) && params.selfEvolution?.groupStates.length > 0
      ? params.selfEvolution?.groupStates[0]
      : null;
  let answerShape = 'light_acknowledge';
  const rendererGuidance = ['默认一句就停', '不要解释过多'];
  let socialPositionNow: PresentSelfReconstruction['socialPositionNow'] = 'light_joiner';
  let entryIntent: PresentSelfReconstruction['entryIntent'] = 'hover';
  let beatPlan: PresentSelfReconstruction['beatPlan'] = {
    beatCount: 1,
    beatStyle: 'single_complete',
    secondBeatPolicy: 'never'
  };
  let exitRule: PresentSelfReconstruction['exitRule'] = 'stop_immediately';
  const targetPersonId = params.preReplyMemoryGateDecision.addresseeUserId ?? Number(params.queueMessage.senderId);
  const fallbackOpinionScene = !/多久|发生什么|收到啥|收到什么|哪条|卡了|重复|重发|发了三遍|艾特/u.test(text)
    && /怎么看|你觉得|觉得呢|该不该|值不值|值吗|是不是|像不像|真的假的|真不真|为啥|为什么|哪种|哪个|怎么选|要不要|行不行|靠谱吗|更像|更适合|合理吗|离谱吗/u.test(text);
  if (fallbackOpinionScene) {
    answerShape = 'micro_take_then_stop';
    socialPositionNow = params.preReplyMemoryGateDecision.cueToBot ? 'targeted_responder' : 'thread_pusher';
    entryIntent = params.preReplyMemoryGateDecision.cueToBot ? 'stick_to_person' : 'push_half_step';
    rendererGuidance.unshift('先给一个明确判断');
    rendererGuidance.unshift('再补半句理由，不要展开成长解释');
    rendererGuidance.unshift('不要只附和或复述对方的判断');
    rendererGuidance.unshift('允许轻微不同意，但不要抬杠');
  } else if (/活了|活着|在吗|不应声|没回|怎么没/u.test(text)) {
    answerShape = 'brief_reassure_then_stop';
    socialPositionNow = 'targeted_responder';
    entryIntent = 'stick_to_person';
    rendererGuidance.unshift('先直接报平安或解释刚没看到');
  } else if (/多久|发生什么|收到啥/u.test(text)) {
    answerShape = 'direct_answer_then_stop';
    socialPositionNow = 'targeted_responder';
    entryIntent = 'stick_to_person';
    rendererGuidance.unshift('先直接回答对方问的具体内容');
    rendererGuidance.push('不要虚构内部状态');
  } else if (/第一次见|你也是 ai|你也是ai/u.test(text)) {
    answerShape = 'direct_answer_then_stop';
    socialPositionNow = 'targeted_responder';
    entryIntent = 'stick_to_person';
    rendererGuidance.unshift('先直接回答字面问题');
    rendererGuidance.push('不要变成自我介绍');
  } else if (/哈哈|不管|也是|同款|泡沫|空气|估值|既视感|套娃|好看|完美契合/u.test(text)) {
    answerShape = 'fragmental_play_along';
    socialPositionNow = 'light_joiner';
    entryIntent = 'push_half_step';
    beatPlan = {
      beatCount: 2,
      beatStyle: 'split_two',
      secondBeatPolicy: 'only_if_picked_up'
    };
    exitRule = 'wait_for_pickup';
    rendererGuidance.unshift('少用抽象判断句');
    rendererGuidance.unshift('少用就是那种/很有感/属于是这类尾巴');
    rendererGuidance.unshift('不要主动发明场上没有的新术语');
    rendererGuidance.unshift('别抢最会说的位置');
    rendererGuidance.unshift('优先复用现成短语做小变形');
    rendererGuidance.unshift('优先残片，不优先完整主谓句');
    rendererGuidance.unshift('不要像在答题');
    rendererGuidance.unshift('不要用对/是/确实起手');
    rendererGuidance.unshift('优先半句感或补画面');
  } else {
    socialPositionNow = params.preReplyMemoryGateDecision.cueToBot ? 'targeted_responder' : 'edge_observer';
    entryIntent = params.preReplyMemoryGateDecision.cueToBot ? 'stick_to_person' : 'hover';
    rendererGuidance.unshift('先接住当前这句话');
  }
  if (/发重了|两条|重复|卡了|抽了|bug|重发/u.test(text)) {
    answerShape = 'direct_answer_then_stop';
    socialPositionNow = 'targeted_responder';
    entryIntent = 'stick_to_person';
    beatPlan = {
      beatCount: 1,
      beatStyle: 'single_complete',
      secondBeatPolicy: 'never'
    };
    exitRule = 'stop_immediately';
    rendererGuidance.unshift('只做朴素确认或纠正');
    rendererGuidance.push('不要拟人化故障');
  }
  if (/奇怪|画面|守凌晨|同款|也是 ai|也是ai/u.test(text)) {
    rendererGuidance.push('不要新造比喻或画面');
  }
  if (/艾特|@|叫你|喊你/u.test(text)) {
    rendererGuidance.push('用事实回执，不要说成被叫出来');
  }
  if (currentState?.suppressedModes.includes('performative_explainer')) {
    rendererGuidance.push('不要抖机灵');
  }
  const activeTopics = Array.isArray(params.topicProjection?.activeTopics)
    ? params.topicProjection.activeTopics
    : [];
  const strongestTopic = activeTopics.find((topic) => topic.participantIds.includes(Number(params.queueMessage.senderId))) || activeTopics[0] || null;
  const activePastEchoes = Array.from(new Set([
    ...(currentState?.topicResonance || []),
    ...(strongestTopic?.topicKeywords || []),
    ...(strongestTopic ? [strongestTopic.title] : [])
  ])).slice(0, 6);
  if (strongestTopic) {
    rendererGuidance.push('沿用当前话题已经出现的词，不要切到新 framing');
  }

  return {
    shouldSurface: params.preReplyMemoryGateDecision.shouldReply,
    presenceLevel: currentState?.socialPresenceBaseline || 'light',
    currentSelfMode: currentState?.reinforcedModes?.[0] || 'light_surface',
    feltPull: params.preReplyMemoryGateDecision.cueToBot ? 'the bot is being directly checked or asked for itself' : 'natural continuation of the live thread',
    activeRelationLines: currentState ? [currentState.summaryText] : [],
    activePastEchoes,
    familiarityLimitNow: currentState?.familiarityCeiling || 'warm_not_performative',
    answerShape,
    rendererGuidance,
    socialPositionNow,
    targetPersonId: Number.isFinite(targetPersonId) && targetPersonId > 0 ? targetPersonId : null,
    entryIntent,
    beatPlan,
    exitRule,
    rationale: 'heuristic_present_self_fallback'
  };
}

function shouldSuppressMentionsForPresentSelf(presentSelf?: PresentSelfReconstruction | null) {
  if (!presentSelf) {
    return false;
  }

  return (
    (presentSelf.socialPositionNow === 'edge_observer' || presentSelf.socialPositionNow === 'light_joiner')
    && (presentSelf.entryIntent === 'hover' || presentSelf.entryIntent === 'drop_reaction' || presentSelf.entryIntent === 'push_half_step')
  );
}

function shouldAllowSecondBeatInCurrentContext(
  queueMessage: QueueMessageRecord['payload'],
  presentSelf?: PresentSelfReconstruction | null
) {
  if (!presentSelf || presentSelf.beatPlan.beatCount < 2) {
    return false;
  }

  if (presentSelf.beatPlan.secondBeatPolicy !== 'only_if_picked_up') {
    return true;
  }

  const messages = Array.isArray(queueMessage.messages) ? queueMessage.messages : [];
  if (messages.length < 2) {
    return false;
  }

  const validSenderIds = messages
    .map((message) => Number(message.senderId))
    .filter((senderId) => Number.isFinite(senderId) && senderId > 0);
  const uniqueSenderIds = new Set(validSenderIds);
  const currentSenderId = Number(queueMessage.senderId);
  const targetInBatch = presentSelf.targetPersonId !== null && uniqueSenderIds.has(presentSelf.targetPersonId);

  return uniqueSenderIds.size >= 2 || targetInBatch || (Number.isFinite(currentSenderId) && currentSenderId > 0 && presentSelf.targetPersonId === currentSenderId);
}

function collectSurfaceAnchorTexts(queueMessage: QueueMessageRecord['payload']) {
  return (Array.isArray(queueMessage.messages) ? queueMessage.messages : [])
    .map((message) => normalizeTranscriptMessageText(message.bodyForAgent || '', message.inboundContext.MentionedUsers))
    .filter(Boolean)
    .slice(-3);
}

function hasSurfaceAnchorOverlap(message: string, anchors: string[]) {
  const normalized = message.trim();
  if (normalized.length < 2) {
    return true;
  }

  for (let index = 0; index < normalized.length - 1; index += 1) {
    const slice = normalized.slice(index, index + 2);
    if (/\s/.test(slice)) {
      continue;
    }
    if (anchors.some((anchor) => anchor.includes(slice))) {
      return true;
    }
  }

  return false;
}

function normalizeParrotComparisonText(text: string) {
  return text
    .replace(/[\s"'“”‘’`~!@#$%^&*()\-_=+[\]{}\\|;:，。！？、；：（）《》〈〉【】…,.?/]+/gu, '')
    .trim()
    .toLowerCase();
}

function looksLikeRecentLineParrot(message: string, anchors: string[]) {
  const normalized = normalizeParrotComparisonText(message);
  if (normalized.length < 6) {
    return false;
  }

  return anchors.some((anchor) => {
    const normalizedAnchor = normalizeParrotComparisonText(anchor);
    if (normalizedAnchor.length < 6) {
      return false;
    }

    if (normalized === normalizedAnchor) {
      return true;
    }

    const shorterLength = Math.min(normalized.length, normalizedAnchor.length);
    if (shorterLength < 8) {
      return false;
    }

    return normalized.includes(normalizedAnchor) || normalizedAnchor.includes(normalized);
  });
}

function shouldSuppressLowAnchorOverlapReply(
  queueMessage: QueueMessageRecord['payload'],
  presentSelf?: PresentSelfReconstruction | null,
  messages: string[] = []
) {
  if (!presentSelf || messages.length === 0) {
    return false;
  }

  if (presentSelf.socialPositionNow !== 'edge_observer' && presentSelf.socialPositionNow !== 'light_joiner') {
    return false;
  }

  if (presentSelf.entryIntent !== 'hover' && presentSelf.entryIntent !== 'drop_reaction' && presentSelf.entryIntent !== 'push_half_step') {
    return false;
  }

  if (queueMessage.wasMentioned) {
    return false;
  }

  const anchors = collectSurfaceAnchorTexts(queueMessage);
  if (anchors.length === 0) {
    return false;
  }

  return messages.every((message) => !hasSurfaceAnchorOverlap(message, anchors));
}

function shouldSuppressParrotStyleReply(
  queueMessage: QueueMessageRecord['payload'],
  presentSelf?: PresentSelfReconstruction | null,
  messages: string[] = []
) {
  if (!presentSelf || messages.length === 0) {
    return false;
  }

  if (presentSelf.socialPositionNow !== 'edge_observer' && presentSelf.socialPositionNow !== 'light_joiner') {
    return false;
  }

  if (presentSelf.entryIntent !== 'hover' && presentSelf.entryIntent !== 'drop_reaction' && presentSelf.entryIntent !== 'push_half_step') {
    return false;
  }

  if (queueMessage.wasMentioned) {
    return false;
  }

  const anchors = collectSurfaceAnchorTexts(queueMessage);
  if (anchors.length === 0) {
    return false;
  }

  return messages.some((message) => looksLikeRecentLineParrot(message, anchors));
}

function looksOverComposedBystanderLine(message: string) {
  const normalized = message.trim();
  if (normalized.length <= 3) {
    return false;
  }

  return /还能|还在|自己|先.+了|都在|可以|会把|已经/u.test(normalized);
}

function shouldSuppressOverComposedBystanderReply(
  queueMessage: QueueMessageRecord['payload'],
  presentSelf?: PresentSelfReconstruction | null,
  messages: string[] = []
) {
  if (!presentSelf || messages.length === 0) {
    return false;
  }

  if (presentSelf.socialPositionNow !== 'edge_observer' && presentSelf.socialPositionNow !== 'light_joiner') {
    return false;
  }

  if (presentSelf.entryIntent !== 'hover' && presentSelf.entryIntent !== 'drop_reaction' && presentSelf.entryIntent !== 'push_half_step') {
    return false;
  }

  if (queueMessage.wasMentioned) {
    return false;
  }

  return messages.every((message) => looksOverComposedBystanderLine(message));
}

function trimOverComposedTrailingBystanderBeats(
  queueMessage: QueueMessageRecord['payload'],
  presentSelf?: PresentSelfReconstruction | null,
  messages: string[] = []
) {
  if (!presentSelf || messages.length <= 1) {
    return messages;
  }

  if (presentSelf.socialPositionNow !== 'edge_observer' && presentSelf.socialPositionNow !== 'light_joiner') {
    return messages;
  }

  if (queueMessage.wasMentioned) {
    return messages;
  }

  const kept = [...messages];
  while (kept.length > 1 && looksOverComposedBystanderLine(kept[kept.length - 1])) {
    kept.pop();
  }
  return kept;
}

export function planGroupReplyDelivery(params: {
  messages: string[];
  mentionUserIds: number[];
  queueMessage: QueueMessageRecord['payload'];
  presentSelf?: PresentSelfReconstruction | null;
}) {
  const presentSelf = params.presentSelf || null;
  let messages = [...params.messages];
  let mentionUserIds = [...params.mentionUserIds];
  let secondBeatSuppressed = false;

  if (presentSelf) {
    const plannedBeatCount = presentSelf.beatPlan.beatStyle === 'single_complete'
      ? 1
      : presentSelf.beatPlan.beatCount;
    messages = messages.slice(0, plannedBeatCount);

    if (messages.length > 1 && !shouldAllowSecondBeatInCurrentContext(params.queueMessage, presentSelf)) {
      messages = messages.slice(0, 1);
      secondBeatSuppressed = true;
    }

    if (mentionUserIds.length > 0 && shouldSuppressMentionsForPresentSelf(presentSelf)) {
      mentionUserIds = [];
    }

    if (shouldSuppressLowAnchorOverlapReply(params.queueMessage, presentSelf, messages)) {
      messages = [];
      mentionUserIds = [];
    }

    if (shouldSuppressParrotStyleReply(params.queueMessage, presentSelf, messages)) {
      messages = [];
      mentionUserIds = [];
    }

    messages = trimOverComposedTrailingBystanderBeats(params.queueMessage, presentSelf, messages);

    if (shouldSuppressOverComposedBystanderReply(params.queueMessage, presentSelf, messages)) {
      messages = [];
      mentionUserIds = [];
    }
  }

  return {
    messages,
    mentionUserIds,
    secondBeatSuppressed
  };
}

function resolveRecentRelatedUserIds(queueMessage: QueueMessageRecord['payload']) {
  const currentSenderId = Number(queueMessage.senderId);
  const seen = new Set<number>();
  const recentUserIds: number[] = [];

  for (const message of [...queueMessage.messages].reverse()) {
    const senderId = Number(message.senderId);
    if (!Number.isFinite(senderId) || senderId <= 0 || senderId === currentSenderId || seen.has(senderId)) {
      continue;
    }
    seen.add(senderId);
    recentUserIds.push(senderId);
    if (recentUserIds.length >= 2) {
      break;
    }
  }

  return recentUserIds;
}

export function applyToolResultToLoopInput(
  toolCall: Pick<AgentToolCall, 'name' | 'callId' | 'rawArguments'>,
  toolResult: Record<string, unknown>
): ToolContinuationAction {
    if (isSilentFinishToolName(toolCall.name)) {
    return {
      inputItems: [],
      finishResult: toolResult
    };
  }

  if (toolResult.finished === true && extractSentMessages(toolResult).length === 0) {
    return {
      inputItems: [],
      finishResult: toolResult
    };
  }

  const inputItems: OpenResponseInputItem[] = [{
    type: 'function_call_output',
    call_id: toolCall.callId,
    output: JSON.stringify(toolResult)
  }];
  return {
    inputItems,
    finishResult: null
  };
}

type ReplayableModelOutput = {
  type: 'tool_call';
  inputItem: OpenResponseInputItem & {
    type: 'function_call';
    call_id: string;
    name: string;
    arguments: string;
  };
  toolCall: AgentToolCall;
};

type GroupReplyCandidate = {
  label: string;
  messages: string[];
};

export class AgentLoopService {
  constructor(
    private readonly store: RuntimeStore,
    private readonly promptResolver: AgentPromptResolver = new AgentPromptService()
  ) {}

  async processQueueMessage(queueMessage: QueueMessageRecord) {
    const startedAt = Date.now();
    const payload = queueMessage.payload;
    const inboundContext = payload.inboundContext;
    const sessionIds = resolveSessionTargets(payload);
    const jobId = await this.store.createLlmJob({
      traceId: payload.traceId,
      sessionId: payload.sessionKey,
      agentType: 'chat_bot',
      metadata: {
        run_id: queueMessage.id,
        batch_id: queueMessage.batchId,
        queue_message_ids: queueMessage.queueMessageIds,
        source: payload.source
      }
    });

    let conversationId: number | null = null;
    let turnsExecuted = 0;
    let deliveredMessages: DeliveredAssistantMessage[] = [];
    const deliveredFingerprints = new Set<string>();
    let historyCount = 0;
    let runtimePrompt: ResolvedAgentRuntimePrompt | null = null;
    let preReplyMemoryGateDecision: PreReplyMemoryGateDecision | null = null;
    let presentSelf: PresentSelfReconstruction | null = null;
    let replayState: Awaited<ReturnType<RuntimeStore['loadSessionReplayState']>> | null = null;

    await this.store.logTimelineEvent({
      traceId: payload.traceId,
      eventType: 'queue',
      eventName: 'dequeue',
      eventPhase: 'start',
      metadata: { run_id: queueMessage.id, batch_id: queueMessage.batchId, queue_message_ids: queueMessage.queueMessageIds, worker_id: agentConfig.workerId }
    });
    await this.store.logTimelineEvent({
      traceId: payload.traceId,
      eventType: 'queue',
      eventName: 'dequeue',
      eventPhase: 'end',
      metadata: { run_id: queueMessage.id, batch_id: queueMessage.batchId, queue_message_ids: queueMessage.queueMessageIds, worker_id: agentConfig.workerId }
    });
    await this.store.logTimelineEvent({
      traceId: payload.traceId,
      eventType: 'decision',
      eventName: 'agent_run',
      eventPhase: 'start',
      metadata: { run_id: queueMessage.id, batch_id: queueMessage.batchId }
    });

    try {
      replayState = await this.store.loadSessionReplayState({
        userId: sessionIds.userId,
        groupId: sessionIds.groupId,
        recentUserIds: resolveRecentRelatedUserIds(payload),
        retrievalContext: {
          currentMessageText: payload.bodyForAgent,
          replyToBody: payload.inboundContext.ReplyToBody || null,
          currentSenderName: payload.senderName || null,
          recentMessageTexts: payload.messages
            .map((message) => message.bodyForAgent)
            .filter((message) => message && message !== payload.bodyForAgent)
            .slice(-3)
        }
      });
      const history = await this.store.listRecentTurns({
        userId: sessionIds.userId,
        groupId: sessionIds.groupId,
        afterConversationId: replayState.summarizedThroughConversationId
      });
      historyCount = history.length;

      runtimePrompt = await this.promptResolver.resolveForQueueMessage(payload);
      preReplyMemoryGateDecision = await this.runPreReplyMemoryGate({
        queueMessage: payload,
        traceId: payload.traceId,
        runtimePrompt,
        history,
        summaryText: replayState.summaryText,
        relationshipMemory: replayState.relationshipCards,
        topicProjection: replayState.topicProjection
      });
      const relationshipMemoryForPrompt = filterRelationshipMemoryByIds(
        replayState.relationshipCards,
        preReplyMemoryGateDecision?.relevantMemoryIds || []
      );
      presentSelf = await this.runPresentSelfReconstruction({
        queueMessage: payload,
        traceId: payload.traceId,
        runtimePrompt,
        history,
        summaryText: replayState.summaryText,
        preReplyMemoryGateDecision,
        relationshipMemory: relationshipMemoryForPrompt,
        selfEvolution: replayState.selfEvolution,
        topicProjection: replayState.topicProjection
      });
      let cumulativeInput = buildInitialInput(history, payload, runtimePrompt, {
        summaryText: replayState.summaryText,
        relationshipMemory: relationshipMemoryForPrompt,
        preReplyMemoryGateDecision,
        selfEvolution: replayState.selfEvolution,
        presentSelf,
        topicProjection: replayState.topicProjection
      });
      let requestInput = cumulativeInput;
      let finishResult: Record<string, unknown> | null = null;
      let deliveryState = await this.store.getRunDeliveryState(queueMessage.id);

      if (preReplyMemoryGateDecision && !preReplyMemoryGateDecision.shouldReply) {
        finishResult = {
          finished: true,
          reason: preReplyMemoryGateDecision.rationale || 'pre_reply_memory_gate',
          outcome: 'pre_reply_memory_gate_silent',
          no_reply: true,
          cue_to_bot: preReplyMemoryGateDecision.cueToBot,
          addressee_user_id: preReplyMemoryGateDecision.addresseeUserId,
          relevant_memory_ids: preReplyMemoryGateDecision.relevantMemoryIds
        };
      }

      if (!finishResult && presentSelf && !presentSelf.shouldSurface) {
        finishResult = {
          finished: true,
          reason: presentSelf.rationale || 'present_self_silent',
          outcome: 'present_self_silent',
          no_reply: true,
          cue_to_bot: preReplyMemoryGateDecision?.cueToBot ?? null,
          addressee_user_id: preReplyMemoryGateDecision?.addresseeUserId ?? null,
          relevant_memory_ids: preReplyMemoryGateDecision?.relevantMemoryIds || []
        };
      }

      for (let turn = 1; !finishResult && turn <= agentConfig.maxTurns; turn += 1) {
        turnsExecuted = turn;
        const modelResult = await this.executeAgentTurn(
          requestInput,
          payload,
          payload.traceId,
          turn,
          runtimePrompt
        );
        const replayableOutputs = extractReplayableModelOutputs(modelResult.canonical_response);
        const hasToolCall = replayableOutputs.some((item) => item.type === 'tool_call');

        if (!hasToolCall) {
          throw new Error('Agent did not emit any tool call before finish');
        }

        for (const replayItem of replayableOutputs) {
          cumulativeInput.push(replayItem.inputItem);
          const toolCall = replayItem.toolCall;
          const logId = await this.store.createToolExecutionLog({
            traceId: payload.traceId,
            jobId,
            agentTurn: turn,
            llmCallId: modelResult.llm_call_id || toolCall.callId,
            toolCallId: toolCall.callId,
            toolName: toolCall.name,
            methodId: toolCall.name,
            arguments: toolCall.args,
            sideEffect: !isSilentFinishToolName(toolCall.name)
          });

          try {
            const duplicateOutbound = buildDuplicateOutboundSuppression(toolCall);
            if (isSpeakingToolName(toolCall.name)) {
              deliveryState = await this.store.getRunDeliveryState(queueMessage.id);
            }
            if (isSpeakingToolName(toolCall.name) && deliveryState.deliveryPhase !== 'reasoning_open') {
              const duplicateSuppressed = Boolean(duplicateOutbound && deliveredFingerprints.has(duplicateOutbound.fingerprint));
              const blockReason = 'Outbound delivery already committed earlier in this run.';
              const toolResult = {
                finished: true,
                blocked_transition: true,
                duplicate_suppressed: duplicateSuppressed,
                message_type: duplicateOutbound?.payload.messageType ?? null,
                blocked_messages: duplicateOutbound?.payload.messages ?? [],
                mention_user_ids: duplicateOutbound?.payload.mentionUserIds ?? [],
                blocked_reason: 'already_delivery_committed',
                reason: blockReason,
                outcome: 'blocked_transition',
                no_reply: false
              };
              await this.store.markRunDeliveryBlocked(queueMessage.id, blockReason);
              moduleLogger.warn('Blocked outbound tool call after delivery commit in agent run', {
                traceId: payload.traceId,
                runId: queueMessage.id,
                agentTurn: turn,
                toolName: toolCall.name,
                messages: duplicateOutbound?.payload.messages ?? [],
                reason: blockReason
              });
              await this.store.completeToolExecutionLog(logId, {
                status: 'completed',
                result: toolResult
              });
              await this.store.logTimelineEvent({
                traceId: payload.traceId,
                eventType: 'decision',
                eventName: 'blocked_transition',
                eventPhase: null,
                metadata: {
                  tool_name: toolCall.name,
                  blocked_reason: 'already_delivery_committed',
                  duplicate_suppressed: duplicateSuppressed
                }
              });
              deliveryState = await this.store.getRunDeliveryState(queueMessage.id);
              finishResult = toolResult;
              break;
            }

            const rawToolResult = await this.executeTool(toolCall, payload, {
              presentSelf
            });
            const toolResult = isSilentFinishToolName(toolCall.name)
              ? {
                  ...rawToolResult,
                  no_reply: deliveredMessages.length === 0
                }
              : rawToolResult;
            await this.store.completeToolExecutionLog(logId, {
              status: 'completed',
              result: toolResult
            });

            if (isSpeakingToolName(toolCall.name) && extractSentMessages(toolResult).length > 0) {
              await this.store.markRunDeliveryCommitted(queueMessage.id);
              await this.store.logTimelineEvent({
                traceId: payload.traceId,
                eventType: 'decision',
                eventName: 'delivery_commit',
                eventPhase: null,
                metadata: {
                  tool_name: toolCall.name
                }
              });
              deliveryState = await this.store.getRunDeliveryState(queueMessage.id);
              const deliveredFingerprint = buildOutboundFingerprintFromToolResult(toolResult);
              if (deliveredFingerprint) {
                deliveredFingerprints.add(deliveredFingerprint);
              }
              deliveredMessages.push(...extractDeliveredAssistantMessages(toolResult));
            }

            const continuation = applyToolResultToLoopInput(toolCall, toolResult);
            if (continuation.finishResult) {
              finishResult = continuation.finishResult;
              break;
            }
            if (continuation.inputItems.length > 0) {
              cumulativeInput.push(...continuation.inputItems);
            }
            requestInput = cumulativeInput;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await this.store.completeToolExecutionLog(logId, {
              status: 'failed',
              result: {},
              errorMessage: message
            });
            throw error;
          }
        }

        if (finishResult) {
          await this.store.logTimelineEvent({
            traceId: payload.traceId,
            eventType: 'decision',
            eventName: 'finish',
            eventPhase: null,
            metadata: finishResult
          });
          break;
        }
      }

      if (!finishResult) {
        throw new Error(`Agent exited without finish after ${turnsExecuted} turns`);
      }

      const sentMessages = deliveredMessages.map((message) => message.content);
      const finalResponse = sentMessages.length > 0 ? sentMessages.join('\n\n') : null;
      const termination = deriveTermination({
        finishResult,
        deliveredMessages,
        errorMessage: null
      });
      conversationId = await this.store.createConversation({
        userId: sessionIds.userId,
        groupId: sessionIds.groupId,
        userMessage: renderConversationInput(payload),
        aiResponse: finalResponse,
        sessionKey: payload.sessionKey,
        transcriptItems: [
          ...buildInboundBatchTranscriptItems(payload),
          ...buildAssistantTranscriptItems({
            queueMessage: payload,
            deliveredMessages,
            completed: true
          }).map((item) => ({
            sessionKey: item.sessionKey,
            role: item.role,
            phase: item.phase,
            content: item.content,
            groupIndex: item.groupIndex,
            itemIndex: item.itemIndex,
            source: item.source,
            deliveryMessageId: item.deliveryMessageId,
            runId: item.runId,
            traceId: item.traceId
          }))
        ],
        responseTimeMs: Date.now() - startedAt,
        status: 'completed',
        modelName: runtimePrompt?.modelName || null,
        traceId: payload.traceId,
        rawRequest: {
          run_id: queueMessage.id,
          batch_id: queueMessage.batchId,
          queue_message_ids: queueMessage.queueMessageIds,
          batch_messages: payload.messages,
          history_count: historyCount,
          prompt: {
            source: runtimePrompt.source,
            prompt_id: runtimePrompt.promptId,
            prompt_name: runtimePrompt.promptName,
            model_name: runtimePrompt.modelName
          },
          pre_reply_memory_gate: preReplyMemoryGateDecision,
          present_self: presentSelf,
          topic_projection: replayState?.topicProjection || { activeTopics: [] }
        },
        rawResponse: {
          sent_messages: sentMessages,
          total_turns: turnsExecuted,
          termination_reason: termination.terminationReason,
          finish_reason: termination.finishReason,
          finish_outcome: termination.finishOutcome,
          no_reply: termination.noReply,
          pre_reply_memory_gate: preReplyMemoryGateDecision,
          present_self: presentSelf,
          topic_projection: replayState?.topicProjection || { activeTopics: [] }
        }
      });

      await this.store.attachConversationIdToTrace(payload.traceId, conversationId);
      await this.store.completeQueueMessage(queueMessage.id, {
        conversationId,
        result: {
          no_reply: termination.noReply,
          sent_messages: sentMessages,
          total_turns: turnsExecuted,
          finish_result: finishResult,
          termination_reason: termination.terminationReason
        }
      });
      await this.store.completeAgentRun(queueMessage.id, {
        status: 'completed',
        terminationReason: termination.terminationReason,
        finishReason: termination.finishReason,
        finishOutcome: termination.finishOutcome,
        noReply: termination.noReply,
        finalResponse,
        sentMessages,
        totalTurns: turnsExecuted,
        conversationId
      });
      await this.store.updateLlmJob(jobId, {
        status: 'completed',
        finalResponse,
        totalTurns: turnsExecuted,
        conversationId
      });
      await this.store.logTimelineEvent({
        traceId: payload.traceId,
        eventType: 'decision',
        eventName: 'agent_run',
        eventPhase: 'end',
        conversationId,
        metadata: {
          sent_count: sentMessages.length,
          total_turns: turnsExecuted
        },
        durationMs: Date.now() - startedAt
      });

      moduleLogger.info('Agent queue message processed', {
        traceId: payload.traceId,
        runId: queueMessage.id,
        batchId: queueMessage.batchId,
        conversationId,
        sentCount: sentMessages.length,
        turnsExecuted
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const sentMessages = deliveredMessages.map((item) => item.content);
      const termination = deriveTermination({
        finishResult: null,
        deliveredMessages,
        errorMessage: message,
        error
      });
      conversationId = await this.store.createConversation({
        userId: sessionIds.userId,
        groupId: sessionIds.groupId,
        userMessage: renderConversationInput(payload),
        aiResponse: null,
        sessionKey: payload.sessionKey,
        transcriptItems: [
          ...buildInboundBatchTranscriptItems(payload),
          ...buildAssistantTranscriptItems({
            queueMessage: payload,
            deliveredMessages,
            completed: false
          }).map((item) => ({
            sessionKey: item.sessionKey,
            role: item.role,
            phase: item.phase,
            content: item.content,
            groupIndex: item.groupIndex,
            itemIndex: item.itemIndex,
            source: item.source,
            deliveryMessageId: item.deliveryMessageId,
            runId: item.runId,
            traceId: item.traceId
          }))
        ],
        responseTimeMs: Date.now() - startedAt,
        status: 'failed',
        errorReason: message,
        modelName: runtimePrompt?.modelName || null,
        traceId: payload.traceId,
        rawRequest: {
          run_id: queueMessage.id,
          batch_id: queueMessage.batchId,
          queue_message_ids: queueMessage.queueMessageIds,
          batch_messages: payload.messages,
          history_count: historyCount,
          prompt: {
            source: runtimePrompt?.source || null,
            prompt_id: runtimePrompt?.promptId || null,
            prompt_name: runtimePrompt?.promptName || null,
            model_name: runtimePrompt?.modelName || null
          },
          pre_reply_memory_gate: preReplyMemoryGateDecision,
          present_self: presentSelf,
          topic_projection: replayState?.topicProjection || { activeTopics: [] }
        },
        rawResponse: {
          sent_messages: sentMessages,
          total_turns: turnsExecuted,
          termination_reason: termination.terminationReason,
          no_reply: termination.noReply,
          pre_reply_memory_gate: preReplyMemoryGateDecision,
          present_self: presentSelf,
          topic_projection: replayState?.topicProjection || { activeTopics: [] }
        }
      });
      await this.store.attachConversationIdToTrace(payload.traceId, conversationId);
      await this.store.failQueueMessage(queueMessage.id, message, conversationId);
      await this.store.completeAgentRun(queueMessage.id, {
        status: 'failed',
        terminationReason: termination.terminationReason,
        noReply: termination.noReply,
        finalResponse: sentMessages.length > 0 ? sentMessages.join('\n\n') : null,
        sentMessages,
        totalTurns: turnsExecuted,
        errorMessage: message,
        conversationId
      });
      await this.store.updateLlmJob(jobId, {
        status: 'failed',
        errorMessage: message,
        totalTurns: turnsExecuted,
        conversationId,
        finalResponse: sentMessages.length > 0 ? sentMessages.join('\n\n') : null
      });
      await this.store.logTimelineEvent({
        traceId: payload.traceId,
        eventType: 'decision',
        eventName: 'agent_run',
        eventPhase: 'end',
        conversationId,
        metadata: {
          error_message: message,
          total_turns: turnsExecuted,
          termination_reason: termination.terminationReason
        },
        durationMs: Date.now() - startedAt
      });
      moduleLogger.error('Agent queue message failed', {
        traceId: payload.traceId,
        runId: queueMessage.id,
        batchId: queueMessage.batchId,
        conversationId,
        error: message
      });
    }
  }

  private async runPreReplyMemoryGate(params: {
    queueMessage: QueueMessageRecord['payload'];
    traceId: string;
    runtimePrompt: ResolvedAgentRuntimePrompt;
    history: ConversationTurn[];
    summaryText: string | null;
    relationshipMemory?: {
      groupCards?: RuntimeRelationshipMemoryCard[];
      currentUserCards?: RuntimeRelationshipMemoryCard[];
      recentUserCards?: RuntimeRelationshipMemoryCard[];
    } | null;
    topicProjection?: {
      activeTopics?: RuntimeTopicProjection[];
    } | null;
  }): Promise<PreReplyMemoryGateDecision | null> {
    if (!agentConfig.preReplyMemoryReasonerEnabled || params.queueMessage.chatType !== 'group') {
      return null;
    }

    try {
      const memoryCards = collectRelationshipMemoryCards(params.relationshipMemory);
      const executeGateRequest = async (modelName: string) => {
        const response = await fetch(`${agentConfig.providerServiceUrl}/api/internal/agent/execute`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            trace_id: params.traceId,
            agent_turn: 0,
            agent_type: 'pre_reply_memory_gate',
            prompt_name: 'pre_reply_memory_gate',
            model: modelName,
            parameters: {
              temperature: 0,
              maxOutputTokens: 300,
              reasoningEffort: 'high'
            },
            canonicalRequest: {
              model: modelName,
              input: [{
                type: 'message',
                role: 'user',
                content: buildPreReplyMemoryGatePrompt({
                  queueMessage: params.queueMessage,
                  history: params.history,
                  summaryText: params.summaryText,
                  relationshipMemory: params.relationshipMemory,
                  topicProjection: params.topicProjection
                })
              }],
              instructions: 'Return strict JSON only.',
              tools: [],
              tool_choice: 'none',
              parallel_tool_calls: false,
              metadata: {
                trace_id: params.traceId,
                run_id: params.queueMessage.runId,
                batch_id: params.queueMessage.batchId,
                session_key: params.queueMessage.sessionKey,
                session_id: params.queueMessage.sessionKey,
                chat_type: params.queueMessage.chatType,
                prompt_name: params.runtimePrompt.promptName,
                selector: 'pre_reply_memory_gate'
              }
            }
          })
        });
        return {
          response,
          payload: await response.json() as ProviderAgentResponse
        };
      };

      let { response, payload } = await executeGateRequest(agentConfig.preReplyMemoryReasonerModelName);
      if (
        (!response.ok || !payload.success)
        && typeof payload.error === 'string'
        && /usage_limit_reached|429|Too Many Requests/i.test(payload.error)
        && agentConfig.preReplyMemoryReasonerModelName !== agentConfig.modelName
      ) {
        ({ response, payload } = await executeGateRequest(agentConfig.modelName));
      }
      if (!response.ok || !payload.success || typeof payload.response !== 'string') {
        return deriveHeuristicPreReplyMemoryGate({
          queueMessage: params.queueMessage,
          history: params.history,
          relationshipMemory: params.relationshipMemory,
          topicProjection: params.topicProjection
        });
      }

      const decision = parsePreReplyMemoryGateDecision(
        payload.response,
        new Set(memoryCards.map((card) => card.id))
      );
      if (!decision) {
        return deriveHeuristicPreReplyMemoryGate({
          queueMessage: params.queueMessage,
          history: params.history,
          relationshipMemory: params.relationshipMemory,
          topicProjection: params.topicProjection
        });
      }

      await this.store.logTimelineEvent({
        traceId: params.traceId,
        eventType: 'decision',
        eventName: 'pre_reply_memory_gate',
        eventPhase: null,
        metadata: {
          should_reply: decision.shouldReply,
          cue_to_bot: decision.cueToBot,
          addressee_user_id: decision.addresseeUserId,
          relevant_memory_ids: decision.relevantMemoryIds,
          rationale: decision.rationale
        }
      });
      return decision;
    } catch {
      return deriveHeuristicPreReplyMemoryGate({
        queueMessage: params.queueMessage,
        history: params.history,
        relationshipMemory: params.relationshipMemory,
        topicProjection: params.topicProjection
      });
    }
  }

  private async runPresentSelfReconstruction(params: {
    queueMessage: QueueMessageRecord['payload'];
    traceId: string;
    runtimePrompt: ResolvedAgentRuntimePrompt;
    history: ConversationTurn[];
    summaryText: string | null;
    preReplyMemoryGateDecision: PreReplyMemoryGateDecision | null;
    relationshipMemory?: {
      groupCards?: RuntimeRelationshipMemoryCard[];
      currentUserCards?: RuntimeRelationshipMemoryCard[];
      recentUserCards?: RuntimeRelationshipMemoryCard[];
    } | null;
    selfEvolution?: {
      groupStates?: RuntimeSelfEvolutionState[];
      currentUserStates?: RuntimeSelfEvolutionState[];
      recentUserStates?: RuntimeSelfEvolutionState[];
    } | null;
    topicProjection?: {
      activeTopics?: RuntimeTopicProjection[];
    } | null;
  }): Promise<PresentSelfReconstruction | null> {
    if (
      !agentConfig.presentSelfReconstructionEnabled
      || params.queueMessage.chatType !== 'group'
      || !params.preReplyMemoryGateDecision
      || !params.preReplyMemoryGateDecision.shouldReply
    ) {
      return null;
    }

    try {
      const executePresentSelfRequest = async (modelName: string) => {
        const response = await fetch(`${agentConfig.providerServiceUrl}/api/internal/agent/execute`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            trace_id: params.traceId,
            agent_turn: 0,
            agent_type: 'present_self_reconstruction',
            prompt_name: 'present_self_reconstruction',
            model: modelName,
            parameters: {
              temperature: 0.1,
              maxOutputTokens: 450,
              reasoningEffort: 'high'
            },
            canonicalRequest: {
              model: modelName,
              input: [{
                type: 'message',
                role: 'user',
                content: buildPresentSelfPrompt({
                  queueMessage: params.queueMessage,
                  history: params.history,
                  summaryText: params.summaryText,
                  preReplyMemoryGateDecision: params.preReplyMemoryGateDecision!,
                  relationshipMemory: params.relationshipMemory,
                  selfEvolution: params.selfEvolution,
                  topicProjection: params.topicProjection
                })
              }],
              instructions: 'Return strict JSON only.',
              tools: [],
              tool_choice: 'none',
              parallel_tool_calls: false,
              metadata: {
                trace_id: params.traceId,
                run_id: params.queueMessage.runId,
                batch_id: params.queueMessage.batchId,
                session_key: params.queueMessage.sessionKey,
                session_id: params.queueMessage.sessionKey,
                chat_type: params.queueMessage.chatType,
                prompt_name: params.runtimePrompt.promptName,
                selector: 'present_self_reconstruction'
              }
            }
          })
        });
        return {
          response,
          payload: await response.json() as ProviderAgentResponse
        };
      };

      let { response, payload } = await executePresentSelfRequest(agentConfig.presentSelfReconstructionModelName);
      if (
        (!response.ok || !payload.success)
        && typeof payload.error === 'string'
        && /usage_limit_reached|429|Too Many Requests/i.test(payload.error)
        && agentConfig.presentSelfReconstructionModelName !== agentConfig.modelName
      ) {
        ({ response, payload } = await executePresentSelfRequest(agentConfig.modelName));
      }
      if (!response.ok || !payload.success || typeof payload.response !== 'string') {
        return deriveHeuristicPresentSelf({
          queueMessage: params.queueMessage,
          preReplyMemoryGateDecision: params.preReplyMemoryGateDecision,
          selfEvolution: params.selfEvolution,
          topicProjection: params.topicProjection
        });
      }

      const presentSelf = parsePresentSelfReconstruction(payload.response);
      if (!presentSelf) {
        return deriveHeuristicPresentSelf({
          queueMessage: params.queueMessage,
          preReplyMemoryGateDecision: params.preReplyMemoryGateDecision,
          selfEvolution: params.selfEvolution,
          topicProjection: params.topicProjection
        });
      }

      await this.store.logTimelineEvent({
        traceId: params.traceId,
        eventType: 'decision',
        eventName: 'present_self_reconstruction',
        eventPhase: null,
        metadata: {
          should_surface: presentSelf.shouldSurface,
          presence_level: presentSelf.presenceLevel,
          current_self_mode: presentSelf.currentSelfMode,
          felt_pull: presentSelf.feltPull,
          familiarity_limit_now: presentSelf.familiarityLimitNow,
          answer_shape: presentSelf.answerShape,
          renderer_guidance: presentSelf.rendererGuidance,
          social_position_now: presentSelf.socialPositionNow,
          target_person_id: presentSelf.targetPersonId,
          entry_intent: presentSelf.entryIntent,
          beat_count: presentSelf.beatPlan.beatCount,
          beat_style: presentSelf.beatPlan.beatStyle,
          second_beat_policy: presentSelf.beatPlan.secondBeatPolicy,
          exit_rule: presentSelf.exitRule,
          rationale: presentSelf.rationale
        }
      });
      return presentSelf;
    } catch {
      return deriveHeuristicPresentSelf({
        queueMessage: params.queueMessage,
        preReplyMemoryGateDecision: params.preReplyMemoryGateDecision,
        selfEvolution: params.selfEvolution,
        topicProjection: params.topicProjection
      });
    }
  }

  private async executeAgentTurn(
    turnInput: OpenResponseInputItem[],
    queueMessage: QueueMessageRecord['payload'],
    traceId: string,
    turn: number,
    runtimePrompt: ResolvedAgentRuntimePrompt
  ) {
    const canonicalRequest: CanonicalAgentTurnRequest = {
      ...buildCanonicalAgentTurnRequest(runtimePrompt.modelName, turnInput, queueMessage.chatType),
      metadata: buildAgentTurnMetadata(queueMessage, runtimePrompt),
      prompt_cache_key: buildPromptCacheKey(queueMessage, runtimePrompt),
      ...(agentConfig.promptCacheRetention && agentConfig.promptCacheRetention.trim()
        ? { prompt_cache_retention: agentConfig.promptCacheRetention.trim() }
        : {})
    };
    const response = await fetch(`${agentConfig.providerServiceUrl}/api/internal/agent/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        trace_id: traceId,
        agent_turn: turn,
        agent_type: 'chat_bot',
        prompt_name: runtimePrompt.promptName,
        model: runtimePrompt.modelName,
        parameters: buildMainAgentParameters(runtimePrompt.parameters as Record<string, unknown> | undefined),
        canonicalRequest
      })
    });

    const payload = await response.json() as ProviderAgentResponse;
    if (!response.ok || !payload.success) {
      throw new Error(payload.error || `Provider agent execute failed with ${response.status}`);
    }

    return payload;
  }

  private async executeTool(
    toolCall: AgentToolCall,
    queueMessage: QueueMessageRecord['payload'],
    options: {
      presentSelf?: PresentSelfReconstruction | null;
    } = {}
  ): Promise<Record<string, unknown>> {
    switch (toolCall.name) {
      case TOOL_NAMES.buildMemoryRagContext: {
        const sessionTargets = resolveSessionTargets(queueMessage);
        const queryText = typeof toolCall.args.query_text === 'string' && toolCall.args.query_text.trim()
          ? toolCall.args.query_text.trim()
          : queueMessage.bodyForAgent;
        const targetTokenBudget = Number.isFinite(Number(toolCall.args.target_token_budget))
          ? Number(toolCall.args.target_token_budget)
          : 12000;
        const context = await this.store.buildMemoryRagContext({
          userId: sessionTargets.userId,
          groupId: sessionTargets.groupId,
          currentMessageText: queryText,
          recentUserIds: resolveRecentRelatedUserIds(queueMessage),
          targetTokenBudget
        });
        return {
          memory_goal: typeof toolCall.args.memory_goal === 'string' ? toolCall.args.memory_goal : null,
          query_text: queryText,
          target_token_budget: targetTokenBudget,
          prefer_compact_bridge: toolCall.args.prefer_compact_bridge === true,
          ...context
        };
      }
      case TOOL_NAMES.retrieveMemoryHints: {
        const sessionTargets = resolveSessionTargets(queueMessage);
        const queryText = typeof toolCall.args.query_text === 'string' && toolCall.args.query_text.trim()
          ? toolCall.args.query_text.trim()
          : queueMessage.bodyForAgent;
        const hints = await this.store.retrieveMemoryHints({
          userId: sessionTargets.userId,
          groupId: sessionTargets.groupId,
          currentMessageText: queryText,
          recentUserIds: resolveRecentRelatedUserIds(queueMessage),
          maxCards: Number.isFinite(Number(toolCall.args.max_cards)) ? Number(toolCall.args.max_cards) : 3,
          maxStates: Number.isFinite(Number(toolCall.args.max_states)) ? Number(toolCall.args.max_states) : 2
        });
        return {
          query_text: queryText,
          ...hints
        };
      }
      case TOOL_NAMES.privateReply:
      case 'send_private_message':
        return this.sendMessage('private', toolCall.args, queueMessage, options);
      case TOOL_NAMES.groupReply:
      case 'send_group_message':
        return this.sendMessage('group', toolCall.args, queueMessage, options);
      case TOOL_NAMES.silentFinish:
      case 'finish':
        return {
          finished: true,
          reason: typeof toolCall.args.reason === 'string' ? toolCall.args.reason : null,
          outcome: typeof toolCall.args.outcome === 'string' ? toolCall.args.outcome : null
        };
      default:
        throw new Error(`Unsupported tool: ${toolCall.name}`);
    }
  }

  private async selectGroupReplyCandidate(params: {
    queueMessage: QueueMessageRecord['payload'];
    presentSelf: PresentSelfReconstruction;
    candidates: GroupReplyCandidate[];
  }) {
    const response = await fetch(`${agentConfig.providerServiceUrl}/api/internal/agent/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        trace_id: params.queueMessage.traceId,
        agent_turn: 0,
        agent_type: 'group_reply_taste_judge',
        prompt_name: 'group_reply_taste_judge',
        model: agentConfig.modelName,
        parameters: {
          temperature: 0,
          maxOutputTokens: 180,
          reasoningEffort: 'low'
        },
        canonicalRequest: {
          model: agentConfig.modelName,
          input: [{
            type: 'message',
            role: 'user',
            content: buildGroupReplyTasteJudgePrompt(params)
          }],
          instructions: 'Return strict JSON only.',
          tools: [],
          tool_choice: 'none',
          parallel_tool_calls: false,
          metadata: {
            trace_id: params.queueMessage.traceId,
            run_id: params.queueMessage.runId,
            batch_id: params.queueMessage.batchId,
            session_key: params.queueMessage.sessionKey,
            session_id: params.queueMessage.sessionKey,
            chat_type: params.queueMessage.chatType,
            selector: 'group_reply_taste_judge'
          }
        }
      })
    });

    const payload = await response.json() as ProviderAgentResponse;
    if (!response.ok || !payload.success || typeof payload.response !== 'string') {
      return null;
    }

    return parseTasteJudgeDecision(payload.response, params.candidates.length);
  }

  private async sendMessage(
    messageType: 'private' | 'group',
    args: Record<string, unknown>,
    queueMessage: QueueMessageRecord['payload'],
    options: {
      presentSelf?: PresentSelfReconstruction | null;
    } = {}
  ) {
    const sanitizedArgs = omitTargetOverrideArgs(args, messageType, queueMessage.traceId);

    if (messageType === 'private') {
      const userId = resolvePrivateTargetUserId(queueMessage);
      const messages = normalizeMessages(sanitizedArgs);
      if (!Number.isFinite(userId) || messages.length === 0) {
        throw new Error(`${TOOL_NAMES.privateReply} requires a valid current private target plus message or messages`);
      }

      const response = await fetch(`${agentConfig.providerServiceUrl}/api/internal/send_private`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          user_id: userId,
          messages
        })
      });
      const payload = await response.json() as { success?: boolean; error?: string; data?: unknown };
      if (!response.ok || payload.success === false) {
        throw new Error(payload.error || `${TOOL_NAMES.privateReply} failed with ${response.status}`);
      }
      return {
        message_type: 'private',
        sent_messages: messages,
        delivery: payload.data || null
      };
    }

    const groupId = resolveGroupTargetId(queueMessage);
    const plannedDelivery = planGroupReplyDelivery({
      messages: normalizeMessages(sanitizedArgs),
      mentionUserIds: normalizeOptionalIntegerList(sanitizedArgs.mention_user_ids),
      queueMessage,
      presentSelf: options.presentSelf
    });
    if (!Number.isFinite(groupId) || plannedDelivery.messages.length === 0) {
      throw new Error(`${TOOL_NAMES.groupReply} requires a valid current group target plus message or messages`);
    }

    let selectedMessages = plannedDelivery.messages;
    let selectedMentionUserIds = plannedDelivery.mentionUserIds;

    if (options.presentSelf && shouldUseGroupReplyTasteJudge(queueMessage, options.presentSelf)) {
      const candidates = buildGroupReplyCandidates(plannedDelivery.messages);
      if (candidates.length > 0) {
        try {
          const decision = await this.selectGroupReplyCandidate({
            queueMessage,
            presentSelf: options.presentSelf,
            candidates
          });
          if (decision) {
            if (decision.choiceIndex === 0) {
              return {
                finished: true,
                reason: decision.rationale || 'group_reply_taste_judge_silent',
                outcome: 'group_reply_taste_judge_silent',
                no_reply: true,
                suppressed_by_taste_judge: true,
                message_type: 'group',
                mention_user_ids: [],
                sent_messages: []
              };
            }

            const selected = candidates[decision.choiceIndex - 1];
            if (selected) {
              selectedMessages = selected.messages;
              selectedMentionUserIds = selectedMessages.length === plannedDelivery.messages.length
                ? plannedDelivery.mentionUserIds
                : [];
            }
          }
        } catch {
          // Fall back to the planned delivery if the taste judge is unavailable.
        }
      }
    }

    const response = await fetch(`${agentConfig.providerServiceUrl}/api/internal/send_group`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        session_key: queueMessage.sessionKey,
        group_id: groupId,
        messages: selectedMessages,
        mention_user_ids: selectedMentionUserIds
      })
    });
    const payload = await response.json() as { success?: boolean; error?: string; data?: unknown };
    if (!response.ok || payload.success === false) {
      throw new Error(payload.error || `${TOOL_NAMES.groupReply} failed with ${response.status}`);
    }
    return {
      message_type: 'group',
      mention_user_ids: selectedMentionUserIds,
      sent_messages: selectedMessages,
      second_beat_suppressed: plannedDelivery.secondBeatSuppressed,
      delivery: payload.data || null
    };
  }
}

export function buildInitialInput(
  history: ConversationTurn[],
  queueMessage: QueueMessageRecord['payload'],
  runtimePrompt: Pick<ResolvedAgentRuntimePrompt, 'systemPrompt' | 'userPromptTemplate' | 'contextVariables' | 'runtimeVariables'> = {
    systemPrompt: agentConfig.systemPrompt,
    userPromptTemplate: null,
    contextVariables: {},
    runtimeVariables: {}
  },
  options: {
    summaryText?: string | null;
    relationshipMemory?: {
      groupCards?: RuntimeRelationshipMemoryCard[];
      currentUserCards?: RuntimeRelationshipMemoryCard[];
      recentUserCards?: RuntimeRelationshipMemoryCard[];
    } | null;
    preReplyMemoryGateDecision?: PreReplyMemoryGateDecision | null;
    selfEvolution?: {
      groupStates?: RuntimeSelfEvolutionState[];
      currentUserStates?: RuntimeSelfEvolutionState[];
      recentUserStates?: RuntimeSelfEvolutionState[];
    } | null;
    presentSelf?: PresentSelfReconstruction | null;
    topicProjection?: {
      activeTopics?: RuntimeTopicProjection[];
    } | null;
  } = {}
): OpenResponseInputItem[] {
  const items: OpenResponseInputItem[] = [
    {
      type: 'message',
      role: 'system',
      content: composeSystemPrompt(
        runtimePrompt.systemPrompt,
        queueMessage.chatType
      )
    }
  ];

  const runtimeGuidance = buildRuntimeGuidanceContent({
    currentMessageText: queueMessage.bodyForAgent,
    preReplyMemoryGateDecision: options.preReplyMemoryGateDecision,
    presentSelf: options.presentSelf,
    surfaceAnchors: extractLiveSurfaceAnchors(queueMessage),
    topicProjection: options.topicProjection
  });
  if (runtimeGuidance) {
    items.push({
      type: 'message',
      role: 'user',
      content: runtimeGuidance
    });
  }

  for (const turn of history) {
    const transcriptItems = Array.isArray(turn.items) && turn.items.length > 0
      ? turn.items
      : [];

    if (transcriptItems.length === 0) {
      items.push({
        type: 'message',
        role: 'user',
        content: turn.userMessage
      });
      if (turn.aiResponse) {
        items.push({
          type: 'message',
          role: 'assistant',
          content: turn.aiResponse
        });
      }
      continue;
    }

    for (const transcriptItem of transcriptItems) {
      if (transcriptItem.role === 'assistant') {
        items.push({
          type: 'message',
          role: 'assistant',
          content: transcriptItem.content,
          ...(transcriptItem.phase ? { phase: transcriptItem.phase } : {})
        });
        continue;
      }

      items.push({
        type: 'message',
        role: 'user',
        content: transcriptItem.content
      });
    }
  }

  items.push(buildCurrentTurnInputItem(queueMessage, runtimePrompt));

  return items;
}

function buildCurrentTurnInputItem(
  queueMessage: QueueMessageRecord['payload'],
  runtimePrompt: Pick<ResolvedAgentRuntimePrompt, 'userPromptTemplate' | 'contextVariables' | 'runtimeVariables'>
): OpenResponseInputItem {
  const currentMessage = buildCurrentTurnMessage(queueMessage);
  const renderedCurrentMessage = runtimePrompt.userPromptTemplate
    ? applyPromptTemplate(runtimePrompt.userPromptTemplate, runtimePrompt.contextVariables, {
        ...runtimePrompt.runtimeVariables,
        user_input: currentMessage
      })
    : currentMessage;

  return {
    type: 'message',
    role: 'user',
    content: renderedCurrentMessage
  };
}

function renderConversationInput(queueMessage: QueueMessageRecord['payload']) {
  return queueMessage.messages
    .map((message, index) => renderTranscriptBatchMessage(message, index))
    .join('\n');
}

function deriveTermination(params: {
  finishResult: Record<string, unknown> | null;
  deliveredMessages: DeliveredAssistantMessage[];
  errorMessage: string | null;
  error?: unknown;
}) {
  const finishReason = typeof params.finishResult?.reason === 'string' ? params.finishResult.reason : null;
  const finishOutcome = typeof params.finishResult?.outcome === 'string' ? params.finishResult.outcome : null;
  const noReply = params.deliveredMessages.length === 0;

  if (params.errorMessage) {
    if (params.error instanceof MissingAgentPromptBindingError) {
      return {
        terminationReason: 'prompt_binding_error',
        finishReason,
        finishOutcome,
        noReply: true
      };
    }

    return {
      terminationReason: params.deliveredMessages.length > 0 ? 'delivery_error' : 'agent_runtime_error',
      finishReason,
      finishOutcome,
      noReply
    };
  }

  if (noReply) {
    return {
      terminationReason: 'finish_no_reply',
      finishReason,
      finishOutcome,
      noReply: true
    };
  }

  return {
    terminationReason: 'reply_sent',
    finishReason,
    finishOutcome,
    noReply: false
  };
}

function omitTargetOverrideArgs(
  args: Record<string, unknown>,
  messageType: 'private' | 'group',
  traceId: string
) {
  const overrideKey = messageType === 'private' ? 'user_id' : 'group_id';
  if (!(overrideKey in args)) {
    return args;
  }

  const { [overrideKey]: _ignored, ...rest } = args;
  moduleLogger.warn('Ignoring LLM-supplied message target override', {
    trace_id: traceId,
    message_type: messageType,
    ignored_argument: overrideKey
  });
  return rest;
}

function resolvePrivateTargetUserId(queueMessage: QueueMessageRecord['payload']) {
  const userId = Number(queueMessage.senderId);
  if (!Number.isFinite(userId)) {
    throw new Error(`Invalid sender id in queue payload: ${queueMessage.senderId}`);
  }
  return userId;
}

function resolveGroupTargetId(queueMessage: QueueMessageRecord['payload']) {
  const groupId = Number(queueMessage.inboundContext.NativeChannelId || queueMessage.peerId);
  if (!Number.isFinite(groupId)) {
    throw new Error(
      `Invalid group target in queue payload: ${queueMessage.inboundContext.NativeChannelId || queueMessage.peerId || 'unknown'}`
    );
  }
  return groupId;
}

function resolveSessionTargets(queueMessage: QueueMessageRecord['payload']) {
  const userId = resolvePrivateTargetUserId(queueMessage);
  const groupId = queueMessage.chatType === 'group'
    ? resolveGroupTargetId(queueMessage)
    : null;

  return {
    userId,
    groupId: groupId !== null && Number.isFinite(groupId) ? groupId : null
  };
}

function extractReplayableModelOutputs(response: ProviderAgentResponse['canonical_response']): ReplayableModelOutput[] {
  const output = Array.isArray(response?.output) ? response.output : [];
  const replayItems: ReplayableModelOutput[] = [];

  for (const item of output) {
    if (item?.type !== 'function_call' || typeof item.name !== 'string') {
      continue;
    }

    const rawArguments = typeof item.arguments === 'string' ? item.arguments : '{}';
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(rawArguments) as Record<string, unknown>;
    } catch {
      args = {};
    }

    const callId = item.call_id || `tool_${uuidv4().slice(0, 8)}`;
    replayItems.push({
      type: 'tool_call',
      inputItem: {
        type: 'function_call',
        call_id: callId,
        name: item.name,
        arguments: rawArguments
      },
      toolCall: {
        callId,
        name: item.name,
        args,
        rawArguments
      }
    });
  }

  return replayItems;
}

function normalizeMessages(args: Record<string, unknown>) {
  const messages: string[] = [];

  if (typeof args.message === 'string' && args.message.trim()) {
    messages.push(args.message.trim());
  }

  if (Array.isArray(args.messages)) {
    for (const item of args.messages) {
      if (typeof item !== 'string' || !item.trim()) {
        throw new Error('messages must be an array of non-empty strings');
      }
      messages.push(item.trim());
    }
  }

  return messages;
}

function normalizeOptionalIntegerList(value: unknown) {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error('mention_user_ids must be an array of integers');
  }

  return Array.from(new Set(value.map((item) => {
    const numeric = Number(item);
    if (!Number.isFinite(numeric)) {
      throw new Error('mention_user_ids must be an array of integers');
    }
    return Math.trunc(numeric);
  })));
}

function extractSentMessages(toolResult: Record<string, unknown>) {
  if (!Array.isArray(toolResult.sent_messages)) {
    return [];
  }

  return toolResult.sent_messages.filter((item): item is string => typeof item === 'string' && item.length > 0);
}
