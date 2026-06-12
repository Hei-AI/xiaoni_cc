import {
  createSqlAdapter,
  enqueueAgentQueueMessage,
  ensureAgentRuntimeSchema,
  logRuntimeTimelineEvent,
  recordLlmRequestSlice,
  attachConversationIdToRuntimeTrace,
  type SqlAdapter
} from '@qq-bot/persistence';
import { agentRunConfig, databaseConfig } from '../config';
import { FinalizedInboundContext, InboxMessageRecord, SemanticInboundMessage } from '../types';

function toNumericConversationId(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export class RuntimeStoreService {
  private readonly sql: SqlAdapter;

  constructor() {
    this.sql = createSqlAdapter({
      databaseUrl: databaseConfig.url,
      host: databaseConfig.host,
      port: databaseConfig.port,
      user: databaseConfig.user,
      password: databaseConfig.password,
      database: databaseConfig.database,
      connectionLimit: 8,
      applicationName: 'provider-service'
    });
  }

  async initialize() {
    await this.ensureSchema();
  }

  async close() {
    await this.sql.close();
  }

  async enqueueSemanticMessage(message: SemanticInboundMessage) {
    const dedupeKey = message.dedupeKey || `${message.source}:${message.messageSid}`;
    const availableAt = new Date(Date.now() + agentRunConfig.batchWindowMs).toISOString();
    return enqueueAgentQueueMessage({
      message: {
        ...message,
        dedupeKey
      },
      payload: message as unknown as Record<string, unknown>,
      availableAt
    }, databaseConfig);
  }

  async logTimelineEvent(params: {
    traceId: string;
    eventType: string;
    eventName: string;
    eventPhase?: string | null;
    conversationId?: number | null;
    metadata?: Record<string, unknown>;
    durationMs?: number | null;
  }) {
    await logRuntimeTimelineEvent({
      ...params,
      component: 'provider-service',
      sqlAdapter: this.sql
    }, databaseConfig);
  }

  async recordLlmCall(params: {
    traceId?: string;
    runId?: string;
    conversationId?: unknown;
    sliceId?: string;
    llmCallId?: string;
    agentTurn?: number;
    agentType?: string;
    promptName?: string;
    inputStartIndex?: number | null;
    inputEndIndex?: number | null;
    inputStackItemIds?: Array<string | number>;
    outputStartIndex?: number | null;
    outputEndIndex?: number | null;
    modelName: string;
    modelProvider: string;
    canonicalRequest: Record<string, unknown>;
    wireRequest: Record<string, unknown>;
    wireRequestHeaders?: Record<string, unknown> | null;
    wireRequestUrl?: string | null;
    canonicalResponse: Record<string, unknown>;
    wireResponse: Record<string, unknown>;
    wireResponseHeaders?: Record<string, unknown> | null;
    wireResponseStatus?: number | null;
    wireResponseStatusText?: string | null;
    rawResponse?: Record<string, unknown> | null;
    outputItems?: unknown[];
    effectiveUnifiedConfig: Record<string, unknown>;
    processedResponse: string;
    usage: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      processingTimeMs: number;
      cachedInputTokens?: number;
      reasoningTokens?: number;
      rawUsage?: Record<string, unknown>;
    };
    requestFormatVersion: string;
    wireProviderFormat: string;
    errorMessage?: string | null;
  }) {
    const outputItems = Array.isArray(params.outputItems)
      ? params.outputItems
      : Array.isArray((params.canonicalResponse as { output?: unknown }).output)
        ? (params.canonicalResponse as { output: unknown[] }).output
        : [];
    const status = params.errorMessage ? 'failed' : 'completed';
    return recordLlmRequestSlice({
      identityKey: 'xiaoni',
      sliceId: params.sliceId || params.llmCallId,
      llmCallId: params.llmCallId || null,
      traceId: params.traceId || null,
      runId: params.runId || null,
      conversationId: params.conversationId ?? null,
      agentTurn: params.agentTurn ?? null,
      inputStartIndex: params.inputStartIndex ?? null,
      inputEndIndex: params.inputEndIndex ?? null,
      inputStackItemIds: params.inputStackItemIds || [],
      outputStartIndex: params.outputStartIndex ?? null,
      outputEndIndex: params.outputEndIndex ?? null,
      canonicalRequest: params.canonicalRequest,
      wireRequest: params.wireRequest,
      canonicalResponse: params.canonicalResponse,
      wireResponse: params.wireResponse,
      rawResponse: params.rawResponse || null,
      outputItems,
      status,
      tokenUsage: {
        input_tokens: params.usage.inputTokens ?? null,
        output_tokens: params.usage.outputTokens ?? null,
        total_tokens: params.usage.totalTokens ?? null,
        cached_input_tokens: params.usage.cachedInputTokens ?? null,
        reasoning_tokens: params.usage.reasoningTokens ?? null,
        raw_usage: params.usage.rawUsage || {}
      },
      modelName: params.modelName,
      modelProvider: params.modelProvider,
      requestFormatVersion: params.requestFormatVersion,
      wireProviderFormat: params.wireProviderFormat,
      processingTimeMs: params.usage.processingTimeMs ?? null,
      metadata: {
        agent_type: params.agentType || null,
        prompt_name: params.promptName || null,
        effective_unified_config: params.effectiveUnifiedConfig,
        processed_response: params.processedResponse,
        provider_request_headers: params.wireRequestHeaders || null,
        provider_request_url: params.wireRequestUrl || null,
        provider_response_headers: params.wireResponseHeaders || null,
        provider_response_status: params.wireResponseStatus ?? null,
        provider_response_status_text: params.wireResponseStatusText || null,
        error_message: params.errorMessage || null,
        recorded_by: 'provider-service'
      }
    }, databaseConfig);
  }

  async attachConversationIdToTrace(traceId: string, conversationId: unknown) {
    const numericConversationId = toNumericConversationId(conversationId);
    if (!traceId || numericConversationId === null) {
      return;
    }

    await attachConversationIdToRuntimeTrace({
      traceId,
      conversationId: numericConversationId,
      sqlAdapter: this.sql
    }, databaseConfig);
  }

  buildSemanticInboundMessage(message: InboxMessageRecord, sourceContext: {
    source: string;
    rawPayload: Record<string, unknown>;
    inboundContext: FinalizedInboundContext;
  }): SemanticInboundMessage {
    return {
      traceId: message.traceId,
      source: sourceContext.source,
      messageId: message.id,
      messageSid: message.messageSid,
      dedupeKey: message.dedupeKey,
      chatType: message.chatType,
      sessionKey: message.sessionKey,
      peerId: message.peerId,
      peerName: message.peerName,
      senderId: message.senderId,
      senderName: message.senderName,
      accountId: message.accountId,
      bodyForAgent: message.bodyForAgent,
      rawBody: message.rawBody,
      commandBody: message.commandBody,
      wasMentioned: message.wasMentioned,
      receivedAt: message.receivedAt,
      messageTimestamp: message.messageTimestamp,
      rawPayload: sourceContext.rawPayload,
      inboundContext: sourceContext.inboundContext
    };
  }

  private async ensureSchema() {
    await ensureAgentRuntimeSchema({
      sqlAdapter: this.sql
    }, databaseConfig);
  }
}

export const runtimeStoreService = new RuntimeStoreService();
