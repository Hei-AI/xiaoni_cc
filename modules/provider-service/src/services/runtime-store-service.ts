import {
  createSqlAdapter,
  enqueueAgentQueueMessage,
  ensureAgentRuntimeSchema,
  logRuntimeTimelineEvent,
  recordLlmCallLog,
  attachConversationIdToRuntimeTrace,
  attachConversationIdToXiaoniReplayEventsByTrace,
  ensureXiaoniReplayEventSchema,
  recordXiaoniReplayEvent,
  type SqlAdapter
} from '@qq-bot/persistence';
import { agentRunConfig, databaseConfig } from '../config';
import { FinalizedInboundContext, InboxMessageRecord, SemanticInboundMessage } from '../types';

type ProviderReplayEventParams = {
  identityKey?: string;
  traceId?: string;
  conversationId?: unknown;
  llmCallId?: string;
  agentTurn?: number;
  agentType?: string;
  promptName?: string;
  modelName: string;
  modelProvider: string;
  canonicalRequest: Record<string, unknown>;
  wireRequest: Record<string, unknown>;
  canonicalResponse: Record<string, unknown>;
  wireResponse: Record<string, unknown>;
  effectiveUnifiedConfig: Record<string, unknown>;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    processingTimeMs: number;
    cachedInputTokens?: number;
    reasoningTokens?: number;
  };
  requestFormatVersion: string;
  wireProviderFormat: string;
  errorMessage?: string | null;
  sourceTable?: string | null;
  sourceId?: string | null;
};

function toNumericConversationId(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function isCodexProvider(params: { modelProvider?: string; wireProviderFormat?: string; effectiveUnifiedConfig?: Record<string, unknown> }) {
  const config = params.effectiveUnifiedConfig || {};
  const model = config.model && typeof config.model === 'object' ? config.model as Record<string, unknown> : {};
  return [params.modelProvider, params.wireProviderFormat, model.provider]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .some((value) => value.toLowerCase().includes('codex'));
}

function replayEventIdForLlmCall(params: { llmCallId?: string; traceId?: string; agentTurn?: number; modelName?: string }) {
  if (params.llmCallId) {
    return `provider:codex:${params.llmCallId}`;
  }
  return `provider:codex:${params.traceId || 'unknown'}:${params.agentTurn || 1}:${params.modelName || 'model'}`;
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
    await ensureXiaoniReplayEventSchema(databaseConfig);
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

  async recordProviderReplayEvent(params: ProviderReplayEventParams) {
    if (!isCodexProvider(params)) {
      return null;
    }
    if (params.errorMessage) {
      return null;
    }

    return recordXiaoniReplayEvent({
      eventId: replayEventIdForLlmCall(params),
      identityKey: params.identityKey || 'xiaoni',
      eventKind: 'codex_provider_request',
      source: 'codex_provider',
      traceId: params.traceId || null,
      conversationId: toNumericConversationId(params.conversationId),
      providerCallId: params.llmCallId || null,
      modelName: params.modelName,
      modelProvider: params.modelProvider,
      status: 'completed',
      replayable: true,
      replayPayload: {
        canonical_request: params.canonicalRequest || {},
        canonical_response: params.canonicalResponse || {},
        wire_request: params.wireRequest || {},
        wire_response: params.wireResponse || {},
        effective_unified_config: params.effectiveUnifiedConfig || {}
      },
      wireRequest: params.wireRequest || {},
      wireResponse: params.wireResponse || {},
      metadata: {
        llmCallId: params.llmCallId || null,
        spanId: params.llmCallId ? `provider-request:wire:${params.llmCallId}` : replayEventIdForLlmCall(params),
        agentTurn: params.agentTurn ?? 1,
        agentType: params.agentType || 'chat_bot',
        promptName: params.promptName || 'agent_loop_v1',
        providerFormat: params.wireProviderFormat,
        requestFormatVersion: params.requestFormatVersion,
        processingTimeMs: params.usage.processingTimeMs,
        apiCallTimeMs: params.usage.processingTimeMs,
        inputTokens: params.usage.inputTokens,
        outputTokens: params.usage.outputTokens,
        totalTokens: params.usage.totalTokens,
        cachedInputTokens: params.usage.cachedInputTokens || 0,
        reasoningTokens: params.usage.reasoningTokens || 0,
        errorMessage: null
      },
      sourceTable: params.sourceTable || null,
      sourceId: params.sourceId || null
    }, databaseConfig);
  }

  async recordLlmCall(params: {
    traceId?: string;
    conversationId?: unknown;
    llmCallId?: string;
    agentTurn?: number;
    agentType?: string;
    promptName?: string;
    modelName: string;
    modelProvider: string;
    canonicalRequest: Record<string, unknown>;
    wireRequest: Record<string, unknown>;
    canonicalResponse: Record<string, unknown>;
    wireResponse: Record<string, unknown>;
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
    await this.recordProviderReplayEvent({
      ...params,
      sourceTable: 'llm_call_logs',
      sourceId: params.llmCallId || null
    });

    await recordLlmCallLog({
      ...params,
      sqlAdapter: this.sql
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
    await attachConversationIdToXiaoniReplayEventsByTrace({
      traceId,
      conversationId: numericConversationId
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
