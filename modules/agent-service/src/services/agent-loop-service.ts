import { v4 as uuidv4 } from 'uuid';
import { agentConfig } from '../config';
import { logger } from '../utils/logger';
import { AgentToolCall, ConversationTurn, QueueMessageRecord } from '../types';
import { AgentPromptResolver, AgentPromptService, ResolvedAgentRuntimePrompt, applyPromptTemplate } from './agent-prompt-service';
import { RuntimeStore } from './runtime-store';

type OpenResponseInputItem =
  | {
      type: 'message';
      role: 'system' | 'user' | 'assistant';
      content: string;
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

type CanonicalAgentTurnRequest = {
  model: string;
  input: OpenResponseInputItem[];
  instructions?: string;
  tools: OpenResponseToolDefinition[];
  tool_choice: 'required';
  parallel_tool_calls: false;
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
      name?: string;
      arguments?: string;
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

const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'send_private_message',
      description: 'Send one or more QQ private messages. user_id is optional and defaults to the current conversation sender.',
      parameters: {
        type: 'object',
        properties: {
          user_id: { type: 'integer' },
          message: { type: 'string' },
          messages: {
            type: 'array',
            items: { type: 'string' }
          }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'send_group_message',
      description: 'Send one or more QQ group messages. group_id is optional and defaults to the current conversation group. mention_user_ids is optional.',
      parameters: {
        type: 'object',
        properties: {
          group_id: { type: 'integer' },
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
  },
  {
    type: 'function',
    function: {
      name: 'finish',
      description: 'Finish the current agent run. Use this when no more messages should be sent.',
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string' },
          outcome: { type: 'string' }
        },
        additionalProperties: false
      }
    }
  }
] as const;

export function buildCanonicalAgentTurnRequest(
  modelName: string,
  loopInput: OpenResponseInputItem[]
): CanonicalAgentTurnRequest {
  const [firstItem, ...remainingItems] = loopInput;
  const instructions = firstItem?.type === 'message' && firstItem.role === 'system'
    ? firstItem.content
    : undefined;

  return {
    model: modelName,
    input: instructions ? remainingItems : loopInput,
    ...(instructions ? { instructions } : {}),
    tools: [...TOOL_DEFINITIONS],
    tool_choice: 'required',
    parallel_tool_calls: false
  };
}

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
    let sentMessages: string[] = [];
    let historyCount = 0;
    let runtimePrompt: ResolvedAgentRuntimePrompt = {
      source: 'default',
      promptId: null,
      promptName: 'agent_loop_v1',
      systemPrompt: agentConfig.systemPrompt,
      userPromptTemplate: null,
      contextVariables: {},
      runtimeVariables: {},
      modelName: agentConfig.modelName,
      parameters: {}
    };

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
      const history = await this.store.listRecentTurns({
        userId: sessionIds.userId,
        groupId: sessionIds.groupId
      });
      historyCount = history.length;

      runtimePrompt = await this.promptResolver.resolveForQueueMessage(payload);
      const loopInput = buildInitialInput(history, payload, runtimePrompt);
      let finishResult: Record<string, unknown> | null = null;

      for (let turn = 1; turn <= agentConfig.maxTurns; turn += 1) {
        turnsExecuted = turn;
        const modelResult = await this.executeAgentTurn(loopInput, payload.traceId, turn, runtimePrompt);
        const toolCalls = extractToolCalls(modelResult.canonical_response);

        if (toolCalls.length === 0) {
          throw new Error('Agent did not emit any tool call before finish');
        }

        for (const toolCall of toolCalls) {
          const logId = await this.store.createToolExecutionLog({
            traceId: payload.traceId,
            jobId,
            agentTurn: turn,
            llmCallId: modelResult.llm_call_id || toolCall.callId,
            toolCallId: toolCall.callId,
            toolName: toolCall.name,
            methodId: toolCall.name,
            arguments: toolCall.args,
            sideEffect: toolCall.name !== 'finish'
          });

          try {
            const rawToolResult = await this.executeTool(toolCall, payload);
            const toolResult = toolCall.name === 'finish'
              ? {
                  ...rawToolResult,
                  no_reply: sentMessages.length === 0
                }
              : rawToolResult;
            await this.store.completeToolExecutionLog(logId, {
              status: 'completed',
              result: toolResult
            });

            loopInput.push({
              type: 'function_call',
              call_id: toolCall.callId,
              name: toolCall.name,
              arguments: toolCall.rawArguments
            });
            loopInput.push({
              type: 'function_call_output',
              call_id: toolCall.callId,
              output: JSON.stringify(toolResult)
            });

            if (toolCall.name === 'send_private_message' || toolCall.name === 'send_group_message') {
              sentMessages.push(...extractSentMessages(toolResult));
            }

            if (toolCall.name === 'finish') {
              finishResult = toolResult;
              break;
            }
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

      const finalResponse = sentMessages.length > 0 ? sentMessages.join('\n\n') : null;
      const termination = deriveTermination({
        finishResult,
        sentMessages,
        errorMessage: null
      });
      conversationId = await this.store.createConversation({
        userId: sessionIds.userId,
        groupId: sessionIds.groupId,
        userMessage: renderConversationInput(payload),
        aiResponse: finalResponse,
        responseTimeMs: Date.now() - startedAt,
        status: 'completed',
        modelName: runtimePrompt.modelName,
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
      const termination = deriveTermination({
        finishResult: null,
        sentMessages,
        errorMessage: message
      });
      conversationId = await this.store.createConversation({
        userId: sessionIds.userId,
        groupId: sessionIds.groupId,
        userMessage: renderConversationInput(payload),
        aiResponse: null,
        responseTimeMs: Date.now() - startedAt,
        status: 'failed',
        errorReason: message,
        modelName: runtimePrompt.modelName,
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
        metadata: { error_message: message, total_turns: turnsExecuted },
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
    loopInput: OpenResponseInputItem[],
    traceId: string,
    turn: number,
    runtimePrompt: ResolvedAgentRuntimePrompt
  ) {
    const canonicalRequest = buildCanonicalAgentTurnRequest(runtimePrompt.modelName, loopInput);
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
        parameters: runtimePrompt.parameters,
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
      case 'send_private_message':
        return this.sendMessage('private', toolCall.args, queueMessage);
      case 'send_group_message':
        return this.sendMessage('group', toolCall.args, queueMessage);
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
    if (messageType === 'private') {
      const defaultUserId = Number(queueMessage.senderId);
      const userId = args.user_id === undefined ? defaultUserId : Number(args.user_id);
      const messages = normalizeMessages(args);
      if (!Number.isFinite(userId) || messages.length === 0) {
        throw new Error('send_private_message requires a valid user_id or current private target, plus message or messages');
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
        throw new Error(payload.error || `send_private_message failed with ${response.status}`);
      }
      return {
        message_type: 'private',
        user_id: userId,
        sent_messages: messages,
        delivery: payload.data || null
      };
    }

    const defaultGroupId = Number(queueMessage.inboundContext.NativeChannelId || queueMessage.peerId);
    const groupId = args.group_id === undefined ? defaultGroupId : Number(args.group_id);
    const messages = normalizeMessages(args);
    const mentionUserIds = normalizeOptionalIntegerList(args.mention_user_ids);
    if (!Number.isFinite(groupId) || messages.length === 0) {
      throw new Error('send_group_message requires a valid group_id or current group target, plus message or messages');
    }

    const response = await fetch(`${agentConfig.providerServiceUrl}/api/internal/send_group`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        group_id: groupId,
        messages,
        mention_user_ids: mentionUserIds
      })
    });
    const payload = await response.json() as { success?: boolean; error?: string; data?: unknown };
    if (!response.ok || payload.success === false) {
      throw new Error(payload.error || `send_group_message failed with ${response.status}`);
    }
    return {
      message_type: 'group',
      group_id: groupId,
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
  }
): OpenResponseInputItem[] {
  const items: OpenResponseInputItem[] = [
    {
      type: 'message',
      role: 'system',
      content: runtimePrompt.systemPrompt
    }
  ];

  for (const turn of history) {
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
  }

  const context = queueMessage.inboundContext;
  const batchMessages = queueMessage.messages.map((message, index) => {
    const parts = [
      `#${index + 1}`,
      `Sender=${message.senderName || message.senderId}`,
      `ReceivedAt=${message.receivedAt}`,
      `WasMentioned=${message.wasMentioned ? 'yes' : 'no'}`,
      `Message=${message.bodyForAgent}`
    ];
    if (message.inboundContext.ReplyToBody) {
      parts.push(`ReplyTo=${message.inboundContext.ReplyToBody}`);
    }
    return parts.join('\n');
  }).join('\n\n');
  const currentMessage = [
    `Trace: ${queueMessage.traceId}`,
    `RunId: ${queueMessage.runId}`,
    `BatchId: ${queueMessage.batchId}`,
    `ChatType: ${queueMessage.chatType}`,
    `SessionKey: ${queueMessage.sessionKey}`,
    `BatchMessageCount: ${queueMessage.messages.length}`,
    `DefaultPrivateTarget: ${queueMessage.senderId}`,
    `DefaultGroupTarget: ${context.NativeChannelId || 'none'}`,
    'ToolUsage: send_private_message and send_group_message may omit target ids to use the defaults above.',
    'ToolUsage: use messages when the reply should be split into multiple outbound messages.',
    'ToolUsage: send_group_message may include mention_user_ids to @ specific people; if multiple messages are sent, mentions apply to the first outbound message only.',
    `SenderName: ${queueMessage.senderName || 'unknown'}`,
    'BatchMessages:',
    batchMessages
  ].join('\n');
  const renderedCurrentMessage = runtimePrompt.userPromptTemplate
    ? applyPromptTemplate(runtimePrompt.userPromptTemplate, runtimePrompt.contextVariables, {
        ...runtimePrompt.runtimeVariables,
        user_input: currentMessage
      })
    : currentMessage;

  items.push({
    type: 'message',
    role: 'user',
    content: renderedCurrentMessage
  });

  return items;
}

function renderConversationInput(queueMessage: QueueMessageRecord['payload']) {
  return queueMessage.messages
    .map((message, index) => `#${index + 1} ${message.senderName || message.senderId}: ${message.bodyForAgent}`)
    .join('\n');
}

function deriveTermination(params: {
  finishResult: Record<string, unknown> | null;
  sentMessages: string[];
  errorMessage: string | null;
}) {
  const finishReason = typeof params.finishResult?.reason === 'string' ? params.finishResult.reason : null;
  const finishOutcome = typeof params.finishResult?.outcome === 'string' ? params.finishResult.outcome : null;
  const noReply = params.sentMessages.length === 0;

  if (params.errorMessage) {
    return {
      terminationReason: params.sentMessages.length > 0 ? 'delivery_error' : 'agent_runtime_error',
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

function resolveSessionTargets(queueMessage: QueueMessageRecord['payload']) {
  const userId = Number(queueMessage.senderId);
  const groupId = queueMessage.chatType === 'group'
    ? Number(queueMessage.inboundContext.NativeChannelId || queueMessage.peerId)
    : null;

  if (!Number.isFinite(userId)) {
    throw new Error(`Invalid sender id in queue payload: ${queueMessage.senderId}`);
  }

  return {
    userId,
    groupId: groupId !== null && Number.isFinite(groupId) ? groupId : null
  };
}

function extractToolCalls(response: ProviderAgentResponse['canonical_response']): AgentToolCall[] {
  const output = Array.isArray(response?.output) ? response.output : [];
  const toolCalls: AgentToolCall[] = [];

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

    toolCalls.push({
      callId: item.call_id || `tool_${uuidv4().slice(0, 8)}`,
      name: item.name,
      args,
      rawArguments
    });
  }

  return toolCalls;
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
