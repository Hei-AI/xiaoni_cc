import {
  createSqlAdapter,
  enqueueAgentQueueMessage,
  ensureAgentRuntimeSchema,
  logRuntimeTimelineEvent,
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
    void params;
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
