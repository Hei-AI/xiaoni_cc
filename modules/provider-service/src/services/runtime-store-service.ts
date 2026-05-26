import { createSqlAdapter, enqueueAgentQueueMessage, type SqlAdapter } from '@qq-bot/persistence';
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
    await this.sql.insert(
      `
        INSERT INTO timeline_events (
          trace_id,
          conversation_id,
          event_type,
          event_name,
          event_phase,
          component,
          duration_ms,
          metadata
        )
        VALUES (?, ?, ?, ?, ?, 'provider-service', ?, ?::jsonb)
      `,
      [
        params.traceId,
        params.conversationId ?? null,
        params.eventType,
        params.eventName,
        params.eventPhase ?? null,
        params.durationMs ?? null,
        JSON.stringify(params.metadata || {})
      ]
    );
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
    await this.sql.insert(
      `
        INSERT INTO llm_call_logs (
          llm_call_id,
          trace_id,
          conversation_id,
          call_sequence,
          agent_turn,
          agent_type,
          model_name,
          model_provider,
          prompt_template,
          canonical_request,
          canonical_response,
          wire_request,
          wire_response,
          request_format_version,
          wire_provider_format,
          raw_response,
          processed_response,
          status,
          error_message,
          started_at,
          completed_at,
          timestamp,
          processing_time_ms,
          api_call_time_ms,
          input_tokens,
          output_tokens,
          token_usage,
          effective_unified_config
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?::jsonb, ?::jsonb, ?::jsonb, ?, ?, ?::jsonb, ?, ?, ?, NOW() - (? * INTERVAL '1 millisecond'), NOW(), NOW(), ?, ?, ?, ?, ?::jsonb, ?::jsonb)
      `,
      [
        params.llmCallId || null,
        params.traceId || null,
        toNumericConversationId(params.conversationId),
        params.agentTurn ?? 1,
        params.agentTurn ?? 1,
        params.agentType || 'chat_bot',
        params.modelName,
        params.modelProvider,
        params.promptName || 'agent_loop_v1',
        JSON.stringify(params.canonicalRequest || {}),
        JSON.stringify(params.canonicalResponse || {}),
        JSON.stringify(params.wireRequest || {}),
        JSON.stringify(params.wireResponse || {}),
        params.requestFormatVersion,
        params.wireProviderFormat,
        JSON.stringify(params.wireResponse || {}),
        params.processedResponse,
        params.errorMessage ? 'failed' : 'completed',
        params.errorMessage || null,
        params.usage.processingTimeMs,
        params.usage.processingTimeMs,
        params.usage.processingTimeMs,
        params.usage.inputTokens,
        params.usage.outputTokens,
        JSON.stringify({
          input_tokens: params.usage.inputTokens,
          output_tokens: params.usage.outputTokens,
          total_tokens: params.usage.totalTokens,
          cached_input_tokens: params.usage.cachedInputTokens || 0,
          reasoning_tokens: params.usage.reasoningTokens || 0,
          raw_usage: params.usage.rawUsage || {}
        }),
        JSON.stringify(params.effectiveUnifiedConfig || {})
      ]
    );
  }

  async attachConversationIdToTrace(traceId: string, conversationId: unknown) {
    const numericConversationId = toNumericConversationId(conversationId);
    if (!traceId || numericConversationId === null) {
      return;
    }

    const updates = [
      'UPDATE agent_queue_messages SET conversation_id = ? WHERE trace_id = ? AND conversation_id IS NULL',
      'UPDATE agent_runs SET conversation_id = ? WHERE trace_id = ? AND conversation_id IS NULL',
      'UPDATE agent_message_batches SET conversation_id = ? WHERE trace_id = ? AND conversation_id IS NULL',
      'UPDATE llm_jobs SET conversation_id = ? WHERE trace_id = ? AND conversation_id IS NULL',
      'UPDATE tool_execution_logs SET conversation_id = ? WHERE trace_id = ? AND conversation_id IS NULL',
      'UPDATE timeline_events SET conversation_id = ? WHERE trace_id = ? AND conversation_id IS NULL',
      'UPDATE llm_call_logs SET conversation_id = ? WHERE trace_id = ? AND conversation_id IS NULL'
    ];

    for (const statement of updates) {
      await this.sql.execute(statement, [numericConversationId, traceId]);
    }
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
    const ddls = [
      `
        ALTER TABLE llm_call_logs
          ADD COLUMN IF NOT EXISTS llm_call_id VARCHAR(100),
          ADD COLUMN IF NOT EXISTS agent_turn INTEGER,
          ADD COLUMN IF NOT EXISTS canonical_response JSONB,
          ADD COLUMN IF NOT EXISTS wire_request JSONB,
          ADD COLUMN IF NOT EXISTS wire_response JSONB,
          ADD COLUMN IF NOT EXISTS effective_unified_config JSONB,
          ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP(3)
      `,
      `
        ALTER TABLE agent_queue_messages
          ADD COLUMN IF NOT EXISTS batch_id VARCHAR(128),
          ADD COLUMN IF NOT EXISTS run_id VARCHAR(128)
      `,
      `
        CREATE TABLE IF NOT EXISTS agent_queue_messages (
          id BIGSERIAL PRIMARY KEY,
          trace_id VARCHAR(128) NOT NULL,
          batch_id VARCHAR(128),
          run_id VARCHAR(128),
          source VARCHAR(32) NOT NULL,
          message_sid VARCHAR(191) NOT NULL,
          dedupe_key VARCHAR(255) NOT NULL UNIQUE,
          chat_type VARCHAR(16) NOT NULL,
          session_key VARCHAR(191) NOT NULL,
          peer_id VARCHAR(191) NOT NULL,
          peer_name VARCHAR(255),
          sender_id VARCHAR(191) NOT NULL,
          sender_name VARCHAR(255),
          account_id VARCHAR(191) NOT NULL,
          body_for_agent TEXT NOT NULL,
          raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
          inbound_context JSONB NOT NULL DEFAULT '{}'::jsonb,
          payload JSONB NOT NULL DEFAULT '{}'::jsonb,
          status VARCHAR(16) NOT NULL DEFAULT 'pending',
          attempts INTEGER NOT NULL DEFAULT 0,
          max_attempts INTEGER NOT NULL DEFAULT 3,
          available_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          locked_at TIMESTAMP(3),
          locked_by VARCHAR(128),
          processing_started_at TIMESTAMP(3),
          completed_at TIMESTAMP(3),
          conversation_id BIGINT,
          error_message TEXT,
          result JSONB,
          created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `,
      `
        CREATE TABLE IF NOT EXISTS agent_message_batches (
          id VARCHAR(128) PRIMARY KEY,
          trace_id VARCHAR(128) NOT NULL,
          conversation_id BIGINT,
          session_key VARCHAR(191) NOT NULL,
          chat_type VARCHAR(16) NOT NULL,
          peer_id VARCHAR(191) NOT NULL,
          peer_name VARCHAR(255),
          account_id VARCHAR(191) NOT NULL,
          status VARCHAR(32) NOT NULL DEFAULT 'pending',
          reason_for_start VARCHAR(64),
          input_message_count INTEGER NOT NULL DEFAULT 0,
          summary TEXT,
          processing_started_at TIMESTAMP(3),
          completed_at TIMESTAMP(3),
          created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `,
      `
        CREATE TABLE IF NOT EXISTS agent_message_batch_items (
          id BIGSERIAL PRIMARY KEY,
          batch_id VARCHAR(128) NOT NULL,
          queue_message_id BIGINT NOT NULL,
          inbound_message_id BIGINT NOT NULL,
          message_sid VARCHAR(191),
          position INTEGER NOT NULL,
          created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `,
      `
        CREATE TABLE IF NOT EXISTS agent_runs (
          id VARCHAR(128) PRIMARY KEY,
          batch_id VARCHAR(128) NOT NULL,
          trace_id VARCHAR(128) NOT NULL,
          conversation_id BIGINT,
          session_key VARCHAR(191) NOT NULL,
          chat_type VARCHAR(16) NOT NULL,
          peer_id VARCHAR(191) NOT NULL,
          peer_name VARCHAR(255),
          account_id VARCHAR(191) NOT NULL,
          status VARCHAR(32) NOT NULL DEFAULT 'pending',
          termination_reason VARCHAR(64),
          finish_reason TEXT,
          finish_outcome TEXT,
          no_reply BOOLEAN NOT NULL DEFAULT FALSE,
          final_response TEXT,
          sent_messages JSONB,
          total_turns INTEGER NOT NULL DEFAULT 0,
          error_message TEXT,
          started_at TIMESTAMP(3),
          completed_at TIMESTAMP(3),
          created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `,
      `
        CREATE TABLE IF NOT EXISTS llm_jobs (
          id BIGSERIAL PRIMARY KEY,
          job_id VARCHAR(128) NOT NULL UNIQUE,
          trace_id VARCHAR(128) NOT NULL,
          conversation_id BIGINT,
          session_id VARCHAR(191),
          agent_type VARCHAR(64),
          status VARCHAR(32) NOT NULL DEFAULT 'pending',
          final_response TEXT,
          error_message TEXT,
          total_turns INTEGER NOT NULL DEFAULT 0,
          metadata JSONB,
          started_at TIMESTAMP(3),
          completed_at TIMESTAMP(3),
          created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `,
      `
        CREATE TABLE IF NOT EXISTS tool_execution_logs (
          id BIGSERIAL PRIMARY KEY,
          tool_call_id VARCHAR(128),
          trace_id VARCHAR(128) NOT NULL,
          conversation_id BIGINT,
          job_id VARCHAR(128),
          agent_turn INTEGER,
          llm_call_id VARCHAR(128),
          tool_type VARCHAR(64),
          tool_name VARCHAR(128) NOT NULL,
          method_id VARCHAR(128),
          arguments JSONB,
          result JSONB,
          status VARCHAR(32) NOT NULL DEFAULT 'pending',
          error_message TEXT,
          execution_mode VARCHAR(64),
          side_effect BOOLEAN NOT NULL DEFAULT FALSE,
          started_at TIMESTAMP(3),
          completed_at TIMESTAMP(3),
          duration_ms BIGINT
        )
      `,
      'CREATE INDEX IF NOT EXISTS idx_agent_queue_pending_available ON agent_queue_messages (status, available_at, id)',
      'CREATE INDEX IF NOT EXISTS idx_agent_queue_session_pending ON agent_queue_messages (session_key, status, available_at, id)',
      'CREATE INDEX IF NOT EXISTS idx_agent_queue_trace_created ON agent_queue_messages (trace_id, created_at, id)',
      'CREATE INDEX IF NOT EXISTS idx_agent_runs_session_created ON agent_runs (session_key, created_at DESC)',
      'CREATE INDEX IF NOT EXISTS idx_agent_runs_trace_id ON agent_runs (trace_id)',
      'CREATE INDEX IF NOT EXISTS idx_agent_batches_session_created ON agent_message_batches (session_key, created_at DESC)',
      'CREATE INDEX IF NOT EXISTS idx_agent_batch_items_batch_position ON agent_message_batch_items (batch_id, position)',
      'CREATE INDEX IF NOT EXISTS idx_llm_call_logs_trace_started_id ON llm_call_logs (trace_id, started_at, id)',
      'CREATE INDEX IF NOT EXISTS idx_llm_jobs_trace_created ON llm_jobs (trace_id, created_at, id)',
      'CREATE INDEX IF NOT EXISTS idx_tool_execution_logs_trace_started ON tool_execution_logs (trace_id, started_at, completed_at, id)'
    ];

    for (const ddl of ddls) {
      try {
        await this.sql.execute(ddl);
      } catch (error: any) {
        if (error?.code === '42P07' || error?.code === '42710') {
          continue;
        }
        throw error;
      }
    }
  }
}

export const runtimeStoreService = new RuntimeStoreService();
