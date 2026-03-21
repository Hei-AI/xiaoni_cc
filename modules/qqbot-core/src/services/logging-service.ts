/**
 * 日志记录服务
 * 负责记录WebSocket通信、LLM调用和会话追踪的完整链路日志
 */

import { DatabaseManager } from './database';
import { logger } from '../utils/logger';
import { randomUUID } from 'crypto';

/**
 * WebSocket日志记录数据接口
 */
export interface WebSocketLogData {
  traceId?: string;
  sessionId?: string;
  direction: 'IN' | 'OUT';
  messageType: string;
  eventPriority?: 'HIGH' | 'MEDIUM' | 'LOW' | 'IGNORE';
  rawPayload: any;
  processedPayload?: any;
  userId?: number;
  groupId?: number;
  messageId?: number;
  processingTimeMs?: number;
  status?: 'SUCCESS' | 'ERROR' | 'TIMEOUT' | 'IGNORED';
  errorMessage?: string;
  metadata?: any;
}

/**
 * LLM调用日志记录数据接口
 */
export interface LLMCallLogData {
  traceId: string;
  llmCallId?: string;
  conversationId?: string;
  sessionId?: string;
  callSequence?: number;
  agentTurn?: number;
  agentType: string;
  modelName: string;
  modelProvider?: string;
  promptTemplate?: string;
  canonicalRequest: any;
  wireRequest: any;
  requestFormatVersion?: string;
  wireProviderFormat?: string;
  inputTokens?: number;
  canonicalResponse?: any;
  wireResponse?: any;
  processedResponse?: string;
  outputTokens?: number;
  apiCallTimeMs: number;
  processingTimeMs: number;
  startedAt?: Date;
  completedAt?: Date;
  status?: 'SUCCESS' | 'ERROR' | 'TIMEOUT' | 'QUOTA_EXCEEDED';
  errorMessage?: string;
  errorCode?: string;
  costEstimate?: number;
  tokenUsage?: any;
  userId?: number;
}

/**
 * 会话追踪创建数据接口
 */
export interface SessionTraceCreateData {
  traceId: string;
  sessionId: string;
  userId: number;
  groupId?: number;
  triggerMessageId?: number;
  triggerEventType: string;
}

/**
 * 会话追踪更新数据接口
 */
export interface SessionTraceUpdateData {
  websocketLogIds?: number[];
  llmCallLogIds?: number[];
  decisionResult?: any;
  contextResult?: any;
  styleResult?: any;
  /** @deprecated legacy persona result field */
  personaResult?: any;
  finalResponse?: string;
  totalProcessingTimeMs?: number;
  endTime?: Date;
  status?: 'PROCESSING' | 'COMPLETED' | 'ERROR' | 'TIMEOUT' | 'CANCELLED';
  errorMessage?: string;
  websocketMessagesCount?: number;
  llmCallsCount?: number;
  totalTokensUsed?: number;
  totalCostEstimate?: number;
}

/**
 * 时间线事件记录数据接口
 */
export interface TimelineEventData {
  traceId: string;
  conversationId?: string;
  eventType: string;
  eventName: string;
  eventPhase?: 'start' | 'end' | 'instant';
  eventTime?: Date;
  durationMs?: number;
  metadata?: any;
}

export interface StartSpanData {
  traceId: string;
  conversationId?: string;
  parentSpanId?: string;
  spanId?: string;
  name: string;
  kind?: 'internal' | 'client' | 'server' | 'producer' | 'consumer';
  statusCode?: 'unset' | 'ok' | 'error';
  statusMessage?: string;
  startedAt?: Date;
  summary?: string;
  input?: any;
  output?: any;
  evidence?: any;
  confidence?: 'observed' | 'derived' | 'missing';
  sourceRef?: string;
  attributes?: Record<string, unknown>;
}

export interface EndSpanData {
  endedAt?: Date;
  statusCode?: 'unset' | 'ok' | 'error';
  statusMessage?: string;
  summary?: string;
  output?: any;
  evidence?: any;
  attributes?: Record<string, unknown>;
}

export interface SpanEventRecordData {
  spanId: string;
  name: string;
  eventTime?: Date;
  attributes?: Record<string, unknown>;
}

export interface SpanLinkRecordData {
  spanId: string;
  linkedTraceId?: string;
  linkedSpanId?: string;
  attributes?: Record<string, unknown>;
}

/**
 * 日志记录服务
 */
export class LoggingService {
  private database: DatabaseManager;
  private moduleLogger = logger.createModuleLogger('logging-service');
  // 移除内存中的序列号管理，改用数据库原子操作保证一致性
  private sequenceLocks: Map<string, Promise<number>> = new Map(); // 按trace_id的序列锁
  private pendingLifecycleSpans: Map<string, string[]> = new Map();

  constructor(database: DatabaseManager) {
    this.database = database;
  }

  /**
   * 原子性获取下一个序列号
   */
  private async getNextSequenceAtomic(traceId: string): Promise<number> {
    // 检查是否已经有同一个trace_id的操作在进行
    const existingLock = this.sequenceLocks.get(traceId);
    if (existingLock) {
      // 等待之前的操作完成，然后递增
      const prevSequence = await existingLock;
      return prevSequence + 1;
    }

    // 创建新的原子操作
    const sequencePromise = this.database.executeQuery(`
      SELECT COALESCE(MAX(call_sequence), 0) + 1 as next_sequence 
      FROM llm_call_logs 
      WHERE trace_id = ?
    `, [traceId]).then(result => {
      return result[0]?.next_sequence || 1;
    }).finally(() => {
      // 操作完成后清理锁
      this.sequenceLocks.delete(traceId);
    });

    this.sequenceLocks.set(traceId, sequencePromise);
    return await sequencePromise;
  }

  private preview(value: any, maxLength = 160): string {
    if (value === null || value === undefined || value === '') {
      return 'No summary available';
    }

    const raw = typeof value === 'string' ? value : JSON.stringify(value);
    const compact = raw.replace(/\s+/g, ' ').trim();
    if (!compact) {
      return 'No summary available';
    }
    return compact.length > maxLength ? `${compact.slice(0, maxLength)}...` : compact;
  }

  private spanStatusFromLegacyStatus(value?: string | null): 'unset' | 'ok' | 'error' {
    const normalized = (value || '').toLowerCase();
    if (['success', 'completed', 'sent', 'ok'].includes(normalized)) {
      return 'ok';
    }
    if (['error', 'failed', 'timeout', 'quota_exceeded'].includes(normalized)) {
      return 'error';
    }
    return 'unset';
  }

  private lifecycleSpanKey(traceId: string, eventType: string, eventName: string): string {
    return `${traceId}:${eventType}:${eventName}`;
  }

  private async safeSpanOperation(label: string, operation: () => Promise<void>): Promise<void> {
    try {
      await operation();
    } catch (error: unknown) {
      this.moduleLogger.warn(`Span operation failed: ${label}`, {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async ensureTraceRoot(traceId: string, conversationId?: string, startedAt?: Date | null): Promise<string> {
    const rootSpanId = `trace-root:${traceId}`;

    await this.database.executeUpdate(
      `INSERT INTO traces (
        trace_id, root_span_id, conversation_id, status, started_at, ended_at, duration_ms, span_count, error_count
      ) VALUES (?, ?, ?, 'unset', ?, ?, NULL, 0, 0)
      ON DUPLICATE KEY UPDATE
        conversation_id = COALESCE(VALUES(conversation_id), conversation_id),
        started_at = COALESCE(traces.started_at, VALUES(started_at)),
        updated_at = CURRENT_TIMESTAMP`,
      [traceId, rootSpanId, conversationId || null, startedAt || null, startedAt || null]
    );

    await this.database.executeUpdate(
      `INSERT INTO spans (
        span_id, trace_id, parent_span_id, name, kind, status_code, status_message,
        service_name, operation_name, conversation_id, depth, sort_key,
        started_at, ended_at, duration_ms, input_payload, output_payload, evidence_payload,
        summary, confidence, source_ref
      ) VALUES (?, ?, NULL, 'conversation.trace', 'internal', 'unset', NULL, 'qqbot-core', 'trace.root', ?, 0, '000', ?, ?, NULL, NULL, NULL, NULL, 'Conversation trace root', 'observed', ?)
      ON DUPLICATE KEY UPDATE
        conversation_id = COALESCE(VALUES(conversation_id), conversation_id),
        started_at = COALESCE(spans.started_at, VALUES(started_at)),
        updated_at = CURRENT_TIMESTAMP`,
      [rootSpanId, traceId, conversationId || null, startedAt || null, startedAt || null, traceId]
    );

    await this.setSpanAttributes(rootSpanId, {
      'semantic.role': 'trace_root',
      'semantic.display_name': 'Conversation Trace',
      ...(conversationId ? { 'conversation.id': conversationId } : {})
    });

    return rootSpanId;
  }

  private async refreshTraceSummary(traceId: string): Promise<void> {
    await this.database.executeUpdate(
      `UPDATE traces
       SET started_at = (
             SELECT MIN(started_at) FROM spans WHERE trace_id = ?
           ),
           ended_at = (
             SELECT MAX(COALESCE(ended_at, started_at)) FROM spans WHERE trace_id = ?
           ),
           duration_ms = (
             SELECT CASE
               WHEN MIN(started_at) IS NULL OR MAX(COALESCE(ended_at, started_at)) IS NULL THEN NULL
               ELSE TIMESTAMPDIFF(MICROSECOND, MIN(started_at), MAX(COALESCE(ended_at, started_at))) DIV 1000
             END
             FROM spans WHERE trace_id = ?
           ),
           span_count = (
             SELECT COUNT(*) FROM spans WHERE trace_id = ?
           ),
           error_count = (
             SELECT COUNT(*) FROM spans WHERE trace_id = ? AND status_code = 'error'
           ),
           updated_at = CURRENT_TIMESTAMP
       WHERE trace_id = ?`,
      [traceId, traceId, traceId, traceId, traceId, traceId]
    );
  }

  async setSpanAttributes(spanId: string, attributes: Record<string, unknown>): Promise<void> {
    const entries = Object.entries(attributes).filter(([, value]) => value !== undefined);
    if (entries.length === 0) {
      return;
    }

    const keys = entries.map(([key]) => key);
    const placeholders = keys.map(() => '?').join(', ');

    await this.database.executeUpdate(
      `DELETE FROM span_attributes WHERE span_id = ? AND attr_key IN (${placeholders})`,
      [spanId, ...keys]
    );

    const valuesSql = entries.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ');
    const params: any[] = [];
    for (const [key, value] of entries) {
      let attrType: 'string' | 'number' | 'boolean' | 'json' = 'string';
      let stringValue: string | null = null;
      let numberValue: number | null = null;
      let boolValue: boolean | null = null;
      let jsonValue: string | null = null;

      if (typeof value === 'number') {
        attrType = 'number';
        numberValue = value;
      } else if (typeof value === 'boolean') {
        attrType = 'boolean';
        boolValue = value;
      } else if (typeof value === 'string') {
        attrType = 'string';
        stringValue = value;
      } else {
        attrType = 'json';
        jsonValue = JSON.stringify(value);
      }

      params.push(spanId, key, attrType, stringValue, numberValue, boolValue, jsonValue);
    }

    await this.database.executeUpdate(
      `INSERT INTO span_attributes (
        span_id, attr_key, attr_type, string_value, number_value, bool_value, json_value
      ) VALUES ${valuesSql}`,
      params
    );
  }

  async startSpan(data: StartSpanData): Promise<string> {
    const startedAt = data.startedAt || new Date();
    const rootSpanId = await this.ensureTraceRoot(data.traceId, data.conversationId, startedAt);
    const spanId = data.spanId || `${data.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${randomUUID()}`;
    const parentSpanId = data.parentSpanId || rootSpanId;

    await this.database.executeUpdate(
      `INSERT INTO spans (
        span_id, trace_id, parent_span_id, name, kind, status_code, status_message,
        service_name, operation_name, conversation_id, depth, sort_key,
        started_at, ended_at, duration_ms, input_payload, output_payload, evidence_payload,
        summary, confidence, source_ref
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'qqbot-core', ?, ?, 0, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        parent_span_id = VALUES(parent_span_id),
        status_code = VALUES(status_code),
        status_message = VALUES(status_message),
        started_at = VALUES(started_at),
        input_payload = VALUES(input_payload),
        evidence_payload = VALUES(evidence_payload),
        summary = VALUES(summary),
        confidence = VALUES(confidence),
        source_ref = VALUES(source_ref),
        updated_at = CURRENT_TIMESTAMP`,
      [
        spanId,
        data.traceId,
        parentSpanId,
        data.name,
        data.kind || 'internal',
        data.statusCode || 'unset',
        data.statusMessage || null,
        data.name,
        data.conversationId || null,
        `pending-${Date.now()}`,
        startedAt,
        data.input ? JSON.stringify(data.input) : null,
        data.output ? JSON.stringify(data.output) : null,
        data.evidence ? JSON.stringify(data.evidence) : null,
        data.summary || data.name,
        data.confidence || 'observed',
        data.sourceRef || null
      ]
    );

    await this.setSpanAttributes(spanId, {
      'semantic.display_name': data.name,
      ...(data.attributes || {})
    });
    await this.refreshTraceSummary(data.traceId);
    return spanId;
  }

  async endSpan(spanId: string, data: EndSpanData = {}): Promise<void> {
    const endedAt = data.endedAt || new Date();
    const spanRow = await this.database.executeQuery<{ trace_id: string; started_at: string | null }>(
      'SELECT trace_id, started_at FROM spans WHERE span_id = ? LIMIT 1',
      [spanId]
    );
    const traceId = spanRow[0]?.trace_id;
    const startedAt = spanRow[0]?.started_at ? new Date(spanRow[0].started_at) : null;
    const durationMs = startedAt ? Math.max(0, endedAt.getTime() - startedAt.getTime()) : null;

    await this.database.executeUpdate(
      `UPDATE spans
       SET ended_at = ?,
           duration_ms = ?,
           status_code = COALESCE(?, status_code),
           status_message = COALESCE(?, status_message),
           output_payload = COALESCE(?, output_payload),
           evidence_payload = COALESCE(?, evidence_payload),
           summary = COALESCE(?, summary),
           updated_at = CURRENT_TIMESTAMP
       WHERE span_id = ?`,
      [
        endedAt,
        durationMs,
        data.statusCode || null,
        data.statusMessage || null,
        data.output ? JSON.stringify(data.output) : null,
        data.evidence ? JSON.stringify(data.evidence) : null,
        data.summary || null,
        spanId
      ]
    );

    if (data.attributes) {
      await this.setSpanAttributes(spanId, data.attributes);
    }

    if (traceId) {
      await this.refreshTraceSummary(traceId);
    }
  }

  async recordSpanEvent(data: SpanEventRecordData): Promise<void> {
    await this.database.executeUpdate(
      `INSERT INTO span_events (
        event_id, span_id, name, event_time, attributes_json
      ) VALUES (?, ?, ?, ?, ?)`,
      [
        `event-${randomUUID()}`,
        data.spanId,
        data.name,
        data.eventTime || new Date(),
        data.attributes ? JSON.stringify(data.attributes) : null
      ]
    );
  }

  async recordSpanLink(data: SpanLinkRecordData): Promise<void> {
    await this.database.executeUpdate(
      `INSERT INTO span_links (
        link_id, span_id, linked_trace_id, linked_span_id, attributes_json
      ) VALUES (?, ?, ?, ?, ?)`,
      [
        `link-${randomUUID()}`,
        data.spanId,
        data.linkedTraceId || null,
        data.linkedSpanId || null,
        data.attributes ? JSON.stringify(data.attributes) : null
      ]
    );
  }

  /**
   * 记录WebSocket通信日志
   */
  async logWebSocketMessage(data: WebSocketLogData): Promise<number> {
    try {
      // 补充默认值
      const logData = {
        trace_id: data.traceId || null,
        session_id: data.sessionId || null,
        direction: data.direction,
        message_type: data.messageType,
        event_priority: data.eventPriority || 'MEDIUM',
        raw_payload: JSON.stringify(data.rawPayload),
        processed_payload: data.processedPayload ? JSON.stringify(data.processedPayload) : null,
        user_id: data.userId || null,
        group_id: data.groupId || null,
        message_id: data.messageId || null,
        processing_time_ms: data.processingTimeMs || null,
        status: data.status || 'SUCCESS',
        error_message: data.errorMessage || null,
        metadata: data.metadata ? JSON.stringify(data.metadata) : null
      };

      const sql = `
        INSERT INTO websocket_logs (
          trace_id, session_id, direction, message_type, event_priority,
          raw_payload, processed_payload, user_id, group_id, message_id,
          processing_time_ms, status, error_message, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const values = [
        logData.trace_id, logData.session_id, logData.direction, 
        logData.message_type, logData.event_priority, logData.raw_payload,
        logData.processed_payload, logData.user_id, logData.group_id,
        logData.message_id, logData.processing_time_ms, logData.status,
        logData.error_message, logData.metadata
      ];

      const result = await this.database.executeQuery(sql, values);
      const logId = (result as any).insertId;

      this.moduleLogger.info('WebSocket message logged', {
        logId,
        traceId: data.traceId,
        direction: data.direction,
        messageType: data.messageType,
        status: data.status
      });

      if (data.traceId) {
        await this.safeSpanOperation('websocket-message', async () => {
          const spanId = await this.startSpan({
            traceId: data.traceId!,
            name: data.direction === 'IN' ? 'ingress.message' : 'delivery.message',
            kind: data.direction === 'IN' ? 'server' : 'producer',
            statusCode: this.spanStatusFromLegacyStatus(data.status),
            statusMessage: data.errorMessage,
            summary: this.preview(data.rawPayload?.message || data.rawPayload?.raw_message || data.messageType),
            input: data.rawPayload,
            output: data.processedPayload,
            evidence: data,
            sourceRef: String(logId),
            attributes: {
              'semantic.role': data.direction === 'IN' ? 'ingress' : 'delivery',
              'message.type': data.messageType,
              'message.direction': data.direction
            }
          });
          await this.endSpan(spanId, {
            statusCode: this.spanStatusFromLegacyStatus(data.status),
            statusMessage: data.errorMessage,
            output: data.processedPayload,
            evidence: data
          });
        });
      }

      return logId;
    } catch (error: unknown) {
      this.moduleLogger.error('Failed to log WebSocket message', { error: error instanceof Error ? error.message : String(error), data });
      throw error;
    }
  }

  /**
   * 记录LLM调用日志
   */
  async logLLMCall(data: LLMCallLogData): Promise<number> {
    try {
      // 使用内存锁和数据库确保序列号的原子性
      let callSequence: number;
      if (data.callSequence) {
        // 如果指定了序列号，直接使用
        callSequence = data.callSequence;
      } else {
        // 使用synchronized方式获取序列号
        callSequence = await this.getNextSequenceAtomic(data.traceId);
      }

      const logData = {
        trace_id: data.traceId,
        llm_call_id: data.llmCallId || null,
        conversation_id: data.conversationId || null,
        session_id: data.sessionId || null,
        call_sequence: callSequence,
        agent_turn: data.agentTurn || null,
        agent_type: data.agentType,
        model_name: data.modelName,
        model_provider: data.modelProvider || 'google-gemini-cli',
        prompt_template: data.promptTemplate || null,
        canonical_request: data.canonicalRequest ? JSON.stringify(data.canonicalRequest) : null,
        wire_request: data.wireRequest ? JSON.stringify(data.wireRequest) : null,
        request_format_version: data.requestFormatVersion || 'openresponse/v1',
        wire_provider_format: data.wireProviderFormat || `${data.modelProvider || 'unknown'}/unknown`,
        input_tokens: data.inputTokens || null,
        canonical_response: data.canonicalResponse ? JSON.stringify(data.canonicalResponse) : null,
        wire_response: data.wireResponse ? JSON.stringify(data.wireResponse) : null,
        processed_response: data.processedResponse || null,
        output_tokens: data.outputTokens || null,
        api_call_time_ms: data.apiCallTimeMs,
        processing_time_ms: data.processingTimeMs,
        status: data.status || 'SUCCESS',
        error_message: data.errorMessage || null,
        error_code: data.errorCode || null,
        cost_estimate: data.costEstimate || null,
        token_usage: data.tokenUsage ? JSON.stringify(data.tokenUsage) : null,
        user_id: data.userId || null,
        started_at: data.startedAt || null,
        completed_at: data.completedAt || null
      };

      const sql = `
        INSERT INTO llm_call_logs (
          trace_id, llm_call_id, conversation_id, session_id, call_sequence, agent_turn, agent_type, model_name, model_provider,
          prompt_template, canonical_request, wire_request, request_format_version, wire_provider_format,
          input_tokens, canonical_response, wire_response, processed_response, output_tokens,
          api_call_time_ms, processing_time_ms, timestamp, started_at, completed_at, status, error_message, error_code,
          cost_estimate, token_usage, user_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      // 🔥 使用应用程序层面的高精度时间戳，确保毫秒精度
      const preciseTimestamp = data.completedAt || new Date();

      const values = [
        logData.trace_id, logData.llm_call_id, logData.conversation_id || null, logData.session_id, logData.call_sequence,
        logData.agent_turn,
        logData.agent_type, logData.model_name, logData.model_provider,
        logData.prompt_template, logData.canonical_request, logData.wire_request,
        logData.request_format_version, logData.wire_provider_format, logData.input_tokens,
        logData.canonical_response, logData.wire_response, logData.processed_response,
        logData.output_tokens, logData.api_call_time_ms, logData.processing_time_ms,
        preciseTimestamp, logData.started_at, logData.completed_at, logData.status, logData.error_message, logData.error_code,
        logData.cost_estimate, logData.token_usage, logData.user_id
      ];

      const result = await this.database.executeQuery(sql, values);
      const logId = (result as any).insertId;

      this.moduleLogger.info('LLM call logged', {
        logId,
        traceId: data.traceId,
        llmCallId: data.llmCallId,
        agentType: data.agentType,
        modelName: data.modelName,
        agentTurn: data.agentTurn,
        callSequence,
        apiCallTime: data.apiCallTimeMs,
        status: data.status
      });

      await this.safeSpanOperation('llm-call', async () => {
        const spanId = await this.startSpan({
          traceId: data.traceId,
          conversationId: data.conversationId,
          name: 'llm.generation',
          kind: 'client',
          statusCode: this.spanStatusFromLegacyStatus(data.status),
          statusMessage: data.errorMessage,
          startedAt: data.startedAt,
          summary: this.preview(data.processedResponse || data.canonicalResponse || data.wireResponse),
          input: {
            prompt_template: data.promptTemplate,
            canonical_request: data.canonicalRequest,
            wire_request: data.wireRequest
          },
          output: {
            processed_response: data.processedResponse,
            canonical_response: data.canonicalResponse,
            wire_response: data.wireResponse,
            token_usage: data.tokenUsage
          },
          evidence: data,
          sourceRef: data.llmCallId || String(logId),
          attributes: {
            'semantic.role': 'generation',
            'semantic.actor': data.agentType,
            'llm.model_name': data.modelName,
            'llm.model_provider': data.modelProvider || 'unknown',
            'llm.prompt_template': data.promptTemplate || null,
            'usage.input_tokens': data.inputTokens ?? null,
            'usage.output_tokens': data.outputTokens ?? null,
            'trace.agent_turn': data.agentTurn ?? null
          }
        });
        await this.endSpan(spanId, {
          endedAt: data.completedAt,
          statusCode: this.spanStatusFromLegacyStatus(data.status),
          statusMessage: data.errorMessage,
          output: {
            processed_response: data.processedResponse,
            canonical_response: data.canonicalResponse,
            wire_response: data.wireResponse,
            token_usage: data.tokenUsage,
            error_message: data.errorMessage,
            error_code: data.errorCode
          },
          evidence: data
        });
      });

      return logId;
    } catch (error: unknown) {
      this.moduleLogger.error('Failed to log LLM call', { error: error instanceof Error ? error.message : String(error), data });
      throw error;
    }
  }

  /**
   * 创建会话追踪记录
   */
  async createSessionTrace(data: SessionTraceCreateData): Promise<void> {
    try {
      const sql = `
        INSERT INTO session_traces (
          trace_id, session_id, user_id, group_id, trigger_message_id, trigger_event_type
        ) VALUES (?, ?, ?, ?, ?, ?)
      `;

      const values = [
        data.traceId, data.sessionId, data.userId, 
        data.groupId || null, data.triggerMessageId || null, data.triggerEventType
      ];

      await this.database.executeQuery(sql, values);

      await this.safeSpanOperation('session-trace-root', async () => {
        await this.ensureTraceRoot(data.traceId, undefined, new Date());
      });

      this.moduleLogger.info('Session trace created', {
        traceId: data.traceId,
        sessionId: data.sessionId,
        userId: data.userId,
        triggerEventType: data.triggerEventType
      });
    } catch (error: unknown) {
      this.moduleLogger.error('Failed to create session trace', { error: error instanceof Error ? error.message : String(error), data });
      throw error;
    }
  }

  /**
   * 更新会话追踪记录
   */
  async updateSessionTrace(traceId: string, data: SessionTraceUpdateData): Promise<void> {
    try {
      const updateFields: string[] = [];
      const values: any[] = [];

      // 动态构建更新字段
      if (data.websocketLogIds !== undefined) {
        updateFields.push('websocket_log_ids = ?');
        values.push(JSON.stringify(data.websocketLogIds));
      }
      if (data.llmCallLogIds !== undefined) {
        updateFields.push('llm_call_log_ids = ?');
        values.push(JSON.stringify(data.llmCallLogIds));
      }
      if (data.decisionResult !== undefined) {
        updateFields.push('decision_result = ?');
        values.push(JSON.stringify(data.decisionResult));
      }
      if (data.contextResult !== undefined) {
        updateFields.push('context_result = ?');
        values.push(JSON.stringify(data.contextResult));
      }
      if (data.styleResult !== undefined || data.personaResult !== undefined) {
        updateFields.push('persona_result = ?');
        values.push(JSON.stringify(data.styleResult ?? data.personaResult));
      }
      if (data.finalResponse !== undefined) {
        updateFields.push('final_response = ?');
        values.push(data.finalResponse);
      }
      if (data.totalProcessingTimeMs !== undefined) {
        updateFields.push('total_processing_time_ms = ?');
        values.push(data.totalProcessingTimeMs);
      }
      if (data.endTime !== undefined) {
        updateFields.push('end_time = ?');
        values.push(data.endTime);
      }
      if (data.status !== undefined) {
        updateFields.push('status = ?');
        values.push(data.status);
      }
      if (data.errorMessage !== undefined) {
        updateFields.push('error_message = ?');
        values.push(data.errorMessage);
      }
      if (data.websocketMessagesCount !== undefined) {
        updateFields.push('websocket_messages_count = ?');
        values.push(data.websocketMessagesCount);
      }
      if (data.llmCallsCount !== undefined) {
        updateFields.push('llm_calls_count = ?');
        values.push(data.llmCallsCount);
      }
      if (data.totalTokensUsed !== undefined) {
        updateFields.push('total_tokens_used = ?');
        values.push(data.totalTokensUsed);
      }
      if (data.totalCostEstimate !== undefined) {
        updateFields.push('total_cost_estimate = ?');
        values.push(data.totalCostEstimate);
      }

      if (updateFields.length === 0) {
        this.moduleLogger.warn('No fields to update in session trace', { traceId });
        return;
      }

      const sql = `
        UPDATE session_traces 
        SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP
        WHERE trace_id = ?
      `;

      values.push(traceId);

      await this.database.executeQuery(sql, values);

      await this.safeSpanOperation('session-trace-update', async () => {
        await this.database.executeUpdate(
          `UPDATE traces
           SET status = COALESCE(?, status),
               updated_at = CURRENT_TIMESTAMP
           WHERE trace_id = ?`,
          [data.status?.toLowerCase() || null, traceId]
        );
        await this.refreshTraceSummary(traceId);
      });

      this.moduleLogger.info('Session trace updated', {
        traceId,
        updatedFields: updateFields.length,
        status: data.status
      });
    } catch (error: unknown) {
      this.moduleLogger.error('Failed to update session trace', { error: error instanceof Error ? error.message : String(error), traceId, data });
      throw error;
    }
  }

  /**
   * 获取完整的会话追踪链路
   */
  async getCompleteSessionTrace(traceId: string): Promise<any> {
    try {
      // 获取主追踪记录
      const traceSql = 'SELECT * FROM session_traces WHERE trace_id = ?';
      const traceResults = await this.database.executeQuery(traceSql, [traceId]);
      
      if (!Array.isArray(traceResults) || traceResults.length === 0) {
        return null;
      }

      const trace = traceResults[0];

      // 获取关联的WebSocket日志
      const websocketSql = 'SELECT * FROM websocket_logs WHERE trace_id = ? ORDER BY timestamp ASC';
      const websocketLogs = await this.database.executeQuery(websocketSql, [traceId]);

      // 获取关联的LLM调用日志
      const llmSql = 'SELECT * FROM llm_call_logs WHERE trace_id = ? ORDER BY call_sequence ASC';
      const llmLogs = await this.database.executeQuery(llmSql, [traceId]);

      return {
        trace,
        websocketLogs,
        llmLogs,
        summary: {
          totalWebSocketMessages: Array.isArray(websocketLogs) ? websocketLogs.length : 0,
          totalLLMCalls: Array.isArray(llmLogs) ? llmLogs.length : 0,
          startTime: trace.start_time,
          endTime: trace.end_time,
          totalProcessingTime: trace.total_processing_time_ms,
          status: trace.status
        }
      };
    } catch (error: unknown) {
      this.moduleLogger.error('Failed to get complete session trace', { error: error instanceof Error ? error.message : String(error), traceId });
      throw error;
    }
  }

  /**
   * 获取WebSocket日志（分页）
   */
  async getWebSocketLogs(options: {
    page: number;
    limit: number;
    filters?: {
      traceId?: string;
      sessionId?: string;
      userId?: number;
      messageType?: string;
      direction?: 'IN' | 'OUT';
      startTime?: Date;
      endTime?: Date;
    };
  }): Promise<{ logs: any[]; total: number; page: number; limit: number }> {
    try {
      const { page, limit, filters = {} } = options;
      const offset = (page - 1) * limit;

      // 构建WHERE条件
      const whereConditions: string[] = [];
      const values: any[] = [];

      if (filters.traceId) {
        whereConditions.push('trace_id = ?');
        values.push(filters.traceId);
      }
      if (filters.sessionId) {
        whereConditions.push('session_id = ?');
        values.push(filters.sessionId);
      }
      if (filters.userId) {
        whereConditions.push('user_id = ?');
        values.push(filters.userId);
      }
      if (filters.messageType) {
        whereConditions.push('message_type = ?');
        values.push(filters.messageType);
      }
      if (filters.direction) {
        whereConditions.push('direction = ?');
        values.push(filters.direction);
      }
      if (filters.startTime) {
        whereConditions.push('timestamp >= ?');
        values.push(filters.startTime);
      }
      if (filters.endTime) {
        whereConditions.push('timestamp <= ?');
        values.push(filters.endTime);
      }

      const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

      // 查询总数
      const countSql = `SELECT COUNT(*) as total FROM websocket_logs ${whereClause}`;
      const countResult = await this.database.executeQuery(countSql, values);
      const total = Array.isArray(countResult) ? countResult[0].total : 0;

      // 查询分页数据 - LIMIT/OFFSET不支持参数绑定，使用字符串插值（已验证为安全数值）
      const sql = `
        SELECT * FROM websocket_logs 
        ${whereClause}
        ORDER BY timestamp DESC 
        LIMIT ${parseInt(limit.toString())} OFFSET ${parseInt(offset.toString())}
      `;
      
      const logs = await this.database.executeQuery(sql, values);

      return {
        logs: Array.isArray(logs) ? logs : [],
        total,
        page,
        limit
      };
    } catch (error: unknown) {
      this.moduleLogger.error('Failed to get WebSocket logs', { error: error instanceof Error ? error.message : String(error), options });
      throw error;
    }
  }

  /**
   * 获取LLM调用日志（分页）
   */
  async getLLMCallLogs(options: {
    page: number;
    limit: number;
    filters?: {
      traceId?: string;
      sessionId?: string;
      agentType?: string;
      modelName?: string;
      userId?: number;
      startTime?: Date;
      endTime?: Date;
    };
  }): Promise<{ logs: any[]; total: number; page: number; limit: number }> {
    try {
      const { page, limit, filters = {} } = options;
      const offset = (page - 1) * limit;

      // 构建WHERE条件
      const whereConditions: string[] = [];
      const values: any[] = [];

      if (filters.traceId) {
        whereConditions.push('trace_id = ?');
        values.push(filters.traceId);
      }
      if (filters.sessionId) {
        whereConditions.push('session_id = ?');
        values.push(filters.sessionId);
      }
      if (filters.agentType) {
        whereConditions.push('agent_type = ?');
        values.push(filters.agentType);
      }
      if (filters.modelName) {
        whereConditions.push('model_name = ?');
        values.push(filters.modelName);
      }
      if (filters.userId) {
        whereConditions.push('user_id = ?');
        values.push(filters.userId);
      }
      if (filters.startTime) {
        whereConditions.push('timestamp >= ?');
        values.push(filters.startTime);
      }
      if (filters.endTime) {
        whereConditions.push('timestamp <= ?');
        values.push(filters.endTime);
      }

      const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

      // 查询总数
      const countSql = `SELECT COUNT(*) as total FROM llm_call_logs ${whereClause}`;
      const countResult = await this.database.executeQuery(countSql, values);
      const total = Array.isArray(countResult) ? countResult[0].total : 0;

      // 查询分页数据 - LIMIT/OFFSET不支持参数绑定，使用字符串插值（已验证为安全数值）
      const sql = `
        SELECT * FROM llm_call_logs 
        ${whereClause}
        ORDER BY timestamp DESC, call_sequence ASC
        LIMIT ${parseInt(limit.toString())} OFFSET ${parseInt(offset.toString())}
      `;
      
      const logs = await this.database.executeQuery(sql, values);

      return {
        logs: Array.isArray(logs) ? logs : [],
        total,
        page,
        limit
      };
    } catch (error: unknown) {
      this.moduleLogger.error('Failed to get LLM call logs', { error: error instanceof Error ? error.message : String(error), options });
      throw error;
    }
  }

  /**
   * 清理CallSequence缓存（定期调用）
   */
  clearCallSequenceCache(): void {
    // 序列号现在使用数据库原子操作管理，无需手动清理
    this.moduleLogger.info('Call sequence cache cleared');
  }

  /**
   * 获取日志统计信息
   */
  async getLoggingStatistics(hours: number = 24): Promise<any> {
    try {
      const startTime = new Date(Date.now() - hours * 60 * 60 * 1000);

      const sql = `
        SELECT 
          COUNT(*) as total_traces,
          COUNT(CASE WHEN st.status = 'COMPLETED' THEN 1 END) as completed_traces,
          COUNT(CASE WHEN st.status = 'ERROR' THEN 1 END) as error_traces,
          AVG(st.total_processing_time_ms) as avg_processing_time,
          SUM(st.llm_calls_count) as total_llm_calls,
          SUM(st.total_tokens_used) as total_tokens,
          SUM(st.total_cost_estimate) as total_cost,
          COUNT(DISTINCT st.user_id) as unique_users,
          (SELECT COUNT(*) FROM websocket_logs WHERE timestamp >= ?) as total_websocket_logs,
          (SELECT COUNT(*) FROM llm_call_logs WHERE timestamp >= ?) as total_llm_logs
        FROM session_traces st 
        WHERE st.start_time >= ?
      `;

      const result = await this.database.executeQuery(sql, [startTime, startTime, startTime]);
      return Array.isArray(result) && result.length > 0 ? result[0] : null;
    } catch (error: unknown) {
      this.moduleLogger.error('Failed to get logging statistics', { error: error instanceof Error ? error.message : String(error), hours });
      throw error;
    }
  }

  /**
   * 记录时间线事件
   */
  async logTimelineEvent(data: TimelineEventData): Promise<number> {
    try {
      const eventTime = data.eventTime || new Date();

      const sql = `
        INSERT INTO timeline_events (
          trace_id, conversation_id, event_type, event_name, event_phase,
          event_time, duration_ms, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const values = [
        data.traceId,
        data.conversationId || null,
        data.eventType,
        data.eventName,
        data.eventPhase || 'instant',
        eventTime,
        data.durationMs || null,
        data.metadata ? JSON.stringify(data.metadata) : null
      ];

      const result = await this.database.executeQuery(sql, values);
      const eventId = (result as any).insertId;

      this.moduleLogger.debug('Timeline event logged', {
        eventId,
        traceId: data.traceId,
        eventType: data.eventType,
        eventName: data.eventName,
        eventPhase: data.eventPhase,
        eventTime: eventTime.toISOString()
      });

      return eventId;
    } catch (error: unknown) {
      this.moduleLogger.error('Failed to log timeline event', {
        error: error instanceof Error ? error.message : String(error),
        data
      });
      throw error;
    }
  }

  /**
   * 获取指定trace_id的时间线事件
   */
  async getTimelineEvents(traceId: string): Promise<any[]> {
    try {
      const sql = `
        SELECT * FROM timeline_events
        WHERE trace_id = ?
        ORDER BY event_time ASC
      `;

      const result = await this.database.executeQuery(sql, [traceId]);
      return Array.isArray(result) ? result : [];
    } catch (error: unknown) {
      this.moduleLogger.error('Failed to get timeline events', {
        error: error instanceof Error ? error.message : String(error),
        traceId
      });
      throw error;
    }
  }

  /**
   * 便捷方法：记录事件开始
   */
  async logEventStart(traceId: string, eventType: string, eventName: string, conversationId?: string, metadata?: any): Promise<number> {
    const result = await this.logTimelineEvent({
      traceId,
      conversationId,
      eventType,
      eventName,
      eventPhase: 'start',
      metadata
    });
    await this.safeSpanOperation('event-start', async () => {
      const spanId = await this.startSpan({
        traceId,
        conversationId,
        name: `${eventType}.${eventName}`,
        kind: 'internal',
        summary: this.preview(metadata || eventName),
        input: metadata,
        evidence: metadata,
        attributes: {
          'semantic.role': eventType,
          'timeline.event_name': eventName
        }
      });
      const key = this.lifecycleSpanKey(traceId, eventType, eventName);
      const bucket = this.pendingLifecycleSpans.get(key) || [];
      bucket.push(spanId);
      this.pendingLifecycleSpans.set(key, bucket);
      await this.recordSpanEvent({
        spanId,
        name: `${eventType}.${eventName}.start`,
        attributes: metadata || {}
      });
    });
    return result;
  }

  /**
   * 便捷方法：记录事件结束（带耗时）
   */
  async logEventEnd(traceId: string, eventType: string, eventName: string, startTime: Date, conversationId?: string, metadata?: any): Promise<number> {
    const endTime = new Date();
    const durationMs = endTime.getTime() - startTime.getTime();

    const result = await this.logTimelineEvent({
      traceId,
      conversationId,
      eventType,
      eventName,
      eventPhase: 'end',
      eventTime: endTime,
      durationMs,
      metadata
    });
    await this.safeSpanOperation('event-end', async () => {
      const key = this.lifecycleSpanKey(traceId, eventType, eventName);
      const bucket = this.pendingLifecycleSpans.get(key) || [];
      const spanId = bucket.shift();
      if (bucket.length === 0) {
        this.pendingLifecycleSpans.delete(key);
      } else {
        this.pendingLifecycleSpans.set(key, bucket);
      }
      if (!spanId) {
        return;
      }
      await this.recordSpanEvent({
        spanId,
        name: `${eventType}.${eventName}.end`,
        eventTime: endTime,
        attributes: {
          ...(metadata || {}),
          duration_ms: durationMs
        }
      });
      await this.endSpan(spanId, {
        endedAt: endTime,
        statusCode: 'ok',
        summary: this.preview(metadata || eventName),
        output: metadata,
        evidence: metadata
      });
    });
    return result;
  }

  /**
   * 便捷方法：记录瞬时事件
   */
  async logInstantEvent(traceId: string, eventType: string, eventName: string, conversationId?: string, metadata?: any): Promise<number> {
    const result = await this.logTimelineEvent({
      traceId,
      conversationId,
      eventType,
      eventName,
      eventPhase: 'instant',
      metadata
    });
    await this.safeSpanOperation('event-instant', async () => {
      const spanId = await this.startSpan({
        traceId,
        conversationId,
        name: `${eventType}.${eventName}`,
        kind: 'internal',
        statusCode: 'ok',
        summary: this.preview(metadata || eventName),
        input: metadata,
        output: metadata,
        evidence: metadata,
        attributes: {
          'semantic.role': eventType,
          'timeline.event_name': eventName
        }
      });
      await this.recordSpanEvent({
        spanId,
        name: `${eventType}.${eventName}.instant`,
        attributes: metadata || {}
      });
      await this.endSpan(spanId, {
        statusCode: 'ok',
        summary: this.preview(metadata || eventName),
        output: metadata,
        evidence: metadata
      });
    });
    return result;
  }
}
