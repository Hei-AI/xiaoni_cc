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
import { RuntimeStore, type RuntimeRelationshipMemoryCard } from './runtime-store';

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

const moduleLogger = logger.createModuleLogger('agent-loop-service');

const TOOL_NAMES = {
  privateReply: 'reply_in_private',
  groupReply: 'speak_in_group',
  silentFinish: 'stay_silent'
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
  '能一句说完就不要说两句。允许不完整，允许有点情绪，允许像真人一样有留白。',
  '你发言的目标不是“回答完整”，而是“像这个群里的人会顺手说出的话”。'
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

function selectToolDefinitions(chatType: 'group' | 'direct'): OpenResponseToolDefinition[] {
  if (chatType === 'group') {
    return [GROUP_MESSAGE_TOOL, FINISH_TOOL];
  }
  return [PRIVATE_MESSAGE_TOOL, FINISH_TOOL];
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
  chatType: 'group' | 'direct',
  summaryText?: string | null,
  relationshipMemory?: {
    groupCards?: RuntimeRelationshipMemoryCard[];
    currentUserCards?: RuntimeRelationshipMemoryCard[];
    recentUserCards?: RuntimeRelationshipMemoryCard[];
  } | null
) {
  let composed = systemPrompt.trim();

  if (chatType === 'group') {
    composed = appendRuntimePromptSection(
      composed,
      'Runtime behavior contract:',
      GROUP_REPLY_BEHAVIOR_CONTRACT
    );
  }

  const normalizedSummary = typeof summaryText === 'string' ? summaryText.trim() : '';
  if (normalizedSummary) {
    composed = appendRuntimePromptSection(
      composed,
      'Conversation summary:',
      normalizedSummary
    );
  }

  const relationshipSection = formatRelationshipMemorySection(relationshipMemory);
  if (relationshipSection) {
    composed = appendRuntimePromptSection(
      composed,
      'Relationship memory cues:',
      relationshipSection
    );
  }

  return composed;
}

function formatRelationshipCard(card: RuntimeRelationshipMemoryCard) {
  const details = [
    card.summaryText,
    card.contextBefore ? `前因: ${card.contextBefore}` : '',
    card.trigger ? `触发: ${card.trigger}` : '',
    card.interaction ? `经过: ${card.interaction}` : '',
    card.outcome ? `结果: ${card.outcome}` : ''
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
      const replayState = await this.store.loadSessionReplayState({
        userId: sessionIds.userId,
        groupId: sessionIds.groupId,
        recentUserIds: resolveRecentRelatedUserIds(payload)
      });
      const history = await this.store.listRecentTurns({
        userId: sessionIds.userId,
        groupId: sessionIds.groupId,
        afterConversationId: replayState.summarizedThroughConversationId
      });
      historyCount = history.length;

      runtimePrompt = await this.promptResolver.resolveForQueueMessage(payload);
      let cumulativeInput = buildInitialInput(history, payload, runtimePrompt, {
        summaryText: replayState.summaryText,
        relationshipMemory: replayState.relationshipCards
      });
      let requestInput = cumulativeInput;
      let finishResult: Record<string, unknown> | null = null;
      let deliveryState = await this.store.getRunDeliveryState(queueMessage.id);

      for (let turn = 1; turn <= agentConfig.maxTurns; turn += 1) {
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

            const rawToolResult = await this.executeTool(toolCall, payload);
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

            if (isSpeakingToolName(toolCall.name)) {
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
          }
        },
        rawResponse: {
          sent_messages: sentMessages,
          total_turns: turnsExecuted,
          termination_reason: termination.terminationReason,
          finish_reason: termination.finishReason,
          finish_outcome: termination.finishOutcome,
          no_reply: termination.noReply
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
          }
        },
        rawResponse: {
          sent_messages: sentMessages,
          total_turns: turnsExecuted,
          termination_reason: termination.terminationReason,
          no_reply: termination.noReply
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
      prompt_cache_key: buildPromptCacheKey(queueMessage, runtimePrompt)
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

  private async executeTool(toolCall: AgentToolCall, queueMessage: QueueMessageRecord['payload']): Promise<Record<string, unknown>> {
    switch (toolCall.name) {
      case TOOL_NAMES.privateReply:
      case 'send_private_message':
        return this.sendMessage('private', toolCall.args, queueMessage);
      case TOOL_NAMES.groupReply:
      case 'send_group_message':
        return this.sendMessage('group', toolCall.args, queueMessage);
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

  private async sendMessage(
    messageType: 'private' | 'group',
    args: Record<string, unknown>,
    queueMessage: QueueMessageRecord['payload']
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
    const messages = normalizeMessages(sanitizedArgs);
    const mentionUserIds = normalizeOptionalIntegerList(sanitizedArgs.mention_user_ids);
    if (!Number.isFinite(groupId) || messages.length === 0) {
      throw new Error(`${TOOL_NAMES.groupReply} requires a valid current group target plus message or messages`);
    }

    const response = await fetch(`${agentConfig.providerServiceUrl}/api/internal/send_group`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        session_key: queueMessage.sessionKey,
        group_id: groupId,
        messages,
        mention_user_ids: mentionUserIds
      })
    });
    const payload = await response.json() as { success?: boolean; error?: string; data?: unknown };
    if (!response.ok || payload.success === false) {
      throw new Error(payload.error || `${TOOL_NAMES.groupReply} failed with ${response.status}`);
    }
    return {
      message_type: 'group',
      mention_user_ids: mentionUserIds,
      sent_messages: messages,
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
  } = {}
): OpenResponseInputItem[] {
  const items: OpenResponseInputItem[] = [
    {
      type: 'message',
      role: 'system',
      content: composeSystemPrompt(runtimePrompt.systemPrompt, queueMessage.chatType, options.summaryText, options.relationshipMemory)
    }
  ];

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
