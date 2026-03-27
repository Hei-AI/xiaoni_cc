import { createSqlAdapter, type SqlAdapter } from '@qq-bot/persistence';
import { v4 as uuidv4 } from 'uuid';
import { databaseConfig } from '../config';
import { ConversationTurn, QueueBatchMessage, QueueMessagePayload, QueueMessageRecord } from '../types';

type QueueRow = {
  id: number;
  trace_id: string;
  batch_id: string | null;
  run_id: string | null;
  source: string;
  message_sid: string;
  chat_type: string;
  session_key: string;
  peer_id: string;
  peer_name: string | null;
  sender_id: string;
  sender_name: string | null;
  account_id: string;
  body_for_agent: string;
  raw_payload: string | Record<string, unknown>;
  inbound_context: string | Record<string, unknown>;
  status: string;
  attempts: number;
  created_at: string | Date;
  processing_started_at: string | Date | null;
  completed_at: string | Date | null;
  conversation_id: number | null;
  error_message: string | null;
  payload: string | Record<string, unknown>;
};

function toIso(value: string | Date | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) {
    return fallback;
  }
  if (typeof value === 'object') {
    return value as T;
  }
  if (typeof value !== 'string') {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function buildBatchSummary(rows: QueueRow[]) {
  return rows.map((row, index) => `#${index + 1} ${row.sender_name || row.sender_id}: ${row.body_for_agent}`).join('\n');
}

export class RuntimeStore {
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
      applicationName: 'agent-service'
    });
  }

  async initialize() {
    await this.ensureSchema();
  }

  async close() {
    await this.sql.close();
  }

  async claimNextQueueMessage(workerId: string): Promise<QueueMessageRecord | null> {
    return this.sql.withTransaction(async (tx) => {
      const candidates = await tx.query<QueueRow>(
        `
          SELECT *
          FROM agent_queue_messages
          WHERE status = 'pending'
            AND available_at <= NOW()
          ORDER BY available_at ASC, id ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        `
      );

      const candidate = candidates[0];
      if (!candidate) {
        return null;
      }

      const rows = await tx.query<QueueRow>(
        `
          SELECT *
          FROM agent_queue_messages
          WHERE status = 'pending'
            AND session_key = ?
            AND available_at <= NOW()
          ORDER BY available_at ASC, id ASC
          FOR UPDATE
        `,
        [candidate.session_key]
      );

      if (rows.length === 0) {
        return null;
      }

      const batchId = `batch_${Date.now()}_${uuidv4().slice(0, 8)}`;
      const runId = `run_${Date.now()}_${uuidv4().slice(0, 8)}`;
      const traceId = `runtrace_${Date.now()}_${uuidv4().slice(0, 8)}`;
      const latest = rows[rows.length - 1];
      const placeholders = rows.map(() => '?').join(', ');
      const queueIds = rows.map((row) => Number(row.id));
      const chatType = latest.chat_type === 'group' ? 'group' : 'direct';

      await tx.insert(
        `
          INSERT INTO agent_message_batches (
            id,
            trace_id,
            session_key,
            chat_type,
            peer_id,
            peer_name,
            account_id,
            status,
            reason_for_start,
            input_message_count,
            summary,
            processing_started_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, 'processing', 'debounce_window_elapsed', ?, ?, NOW())
        `,
        [
          batchId,
          traceId,
          latest.session_key,
          chatType,
          latest.peer_id,
          latest.peer_name,
          latest.account_id,
          rows.length,
          buildBatchSummary(rows)
        ]
      );

      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        await tx.insert(
          `
            INSERT INTO agent_message_batch_items (
              batch_id,
              queue_message_id,
              inbound_message_id,
              message_sid,
              position
            )
            VALUES (?, ?, ?, ?, ?)
          `,
          [batchId, row.id, row.id, row.message_sid, index + 1]
        );
      }

      await tx.insert(
        `
          INSERT INTO agent_runs (
            id,
            batch_id,
            trace_id,
            session_key,
            chat_type,
            peer_id,
            peer_name,
            account_id,
            status,
            started_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'processing', NOW())
        `,
        [
          runId,
          batchId,
          traceId,
          latest.session_key,
          chatType,
          latest.peer_id,
          latest.peer_name,
          latest.account_id
        ]
      );

      await tx.execute(
        `
          UPDATE agent_queue_messages
          SET status = 'processing',
              attempts = attempts + 1,
              locked_at = NOW(),
              locked_by = ?,
              processing_started_at = COALESCE(processing_started_at, NOW()),
              batch_id = ?,
              run_id = ?,
              trace_id = ?,
              updated_at = NOW()
          WHERE id IN (${placeholders})
        `,
        [workerId, batchId, runId, traceId, ...queueIds]
      );

      return this.mapClaimedRun({
        runId,
        batchId,
        traceId,
        rows: rows.map((row) => ({
          ...row,
          batch_id: batchId,
          run_id: runId,
          trace_id: traceId,
        })),
      });
    });
  }

  async completeQueueMessage(runId: string, params: { conversationId?: number | null; result?: Record<string, unknown> }) {
    await this.sql.execute(
      `
        UPDATE agent_queue_messages
        SET status = 'completed',
            conversation_id = COALESCE(?, conversation_id),
            result = ?::jsonb,
            completed_at = NOW(),
            updated_at = NOW(),
            error_message = NULL
        WHERE run_id = ?
      `,
      [
        params.conversationId ?? null,
        JSON.stringify(params.result || {}),
        runId
      ]
    );
  }

  async failQueueMessage(runId: string, errorMessage: string, conversationId?: number | null) {
    await this.sql.execute(
      `
        UPDATE agent_queue_messages
        SET status = 'failed',
            error_message = ?,
            conversation_id = COALESCE(?, conversation_id),
            completed_at = NOW(),
            updated_at = NOW()
        WHERE run_id = ?
      `,
      [errorMessage, conversationId ?? null, runId]
    );
  }

  async completeAgentRun(runId: string, updates: {
    status: string;
    terminationReason: string;
    finishReason?: string | null;
    finishOutcome?: string | null;
    noReply: boolean;
    finalResponse?: string | null;
    sentMessages?: string[];
    totalTurns?: number;
    errorMessage?: string | null;
    conversationId?: number | null;
  }) {
    await this.sql.execute(
      `
        UPDATE agent_runs
        SET status = ?,
            termination_reason = ?,
            finish_reason = ?,
            finish_outcome = ?,
            no_reply = ?,
            final_response = ?,
            sent_messages = ?::jsonb,
            total_turns = ?,
            error_message = ?,
            conversation_id = COALESCE(?, conversation_id),
            completed_at = NOW(),
            updated_at = NOW()
        WHERE id = ?
      `,
      [
        updates.status,
        updates.terminationReason,
        updates.finishReason ?? null,
        updates.finishOutcome ?? null,
        updates.noReply,
        updates.finalResponse ?? null,
        JSON.stringify(updates.sentMessages || []),
        updates.totalTurns ?? 0,
        updates.errorMessage ?? null,
        updates.conversationId ?? null,
        runId
      ]
    );

    await this.sql.execute(
      `
        UPDATE agent_message_batches
        SET status = ?,
            conversation_id = COALESCE(?, conversation_id),
            completed_at = NOW(),
            updated_at = NOW()
        WHERE id = (SELECT batch_id FROM agent_runs WHERE id = ?)
      `,
      [updates.status, updates.conversationId ?? null, runId]
    );
  }

  async createLlmJob(params: {
    traceId: string;
    sessionId: string;
    agentType: string;
    metadata?: Record<string, unknown>;
  }) {
    const jobId = `job_${Date.now()}_${uuidv4().slice(0, 8)}`;
    await this.sql.insert(
      `
        INSERT INTO llm_jobs (
          job_id,
          trace_id,
          session_id,
          agent_type,
          status,
          metadata,
          started_at
        )
        VALUES (?, ?, ?, ?, 'processing', ?::jsonb, NOW())
      `,
      [
        jobId,
        params.traceId,
        params.sessionId,
        params.agentType,
        JSON.stringify(params.metadata || {})
      ]
    );
    return jobId;
  }

  async updateLlmJob(jobId: string, updates: {
    status: string;
    finalResponse?: string | null;
    errorMessage?: string | null;
    totalTurns?: number;
    conversationId?: number | null;
    metadata?: Record<string, unknown>;
  }) {
    await this.sql.execute(
      `
        UPDATE llm_jobs
        SET status = ?,
            final_response = ?,
            error_message = ?,
            total_turns = ?,
            conversation_id = COALESCE(?, conversation_id),
            metadata = COALESCE(?::jsonb, metadata),
            completed_at = CASE WHEN ? IN ('completed', 'failed') THEN NOW() ELSE completed_at END,
            updated_at = NOW()
        WHERE job_id = ?
      `,
      [
        updates.status,
        updates.finalResponse ?? null,
        updates.errorMessage ?? null,
        updates.totalTurns ?? 0,
        updates.conversationId ?? null,
        updates.metadata ? JSON.stringify(updates.metadata) : null,
        updates.status,
        jobId
      ]
    );
  }

  async createToolExecutionLog(params: {
    traceId: string;
    jobId: string;
    agentTurn: number;
    llmCallId: string;
    toolCallId: string;
    toolName: string;
    methodId?: string;
    arguments: Record<string, unknown>;
    sideEffect: boolean;
  }) {
    const result = await this.sql.insert(
      `
        INSERT INTO tool_execution_logs (
          tool_call_id,
          trace_id,
          job_id,
          agent_turn,
          llm_call_id,
          tool_type,
          tool_name,
          method_id,
          arguments,
          status,
          execution_mode,
          side_effect,
          started_at
        )
        VALUES (?, ?, ?, ?, ?, 'function', ?, ?, ?::jsonb, 'processing', 'agent_loop', ?, NOW())
      `,
      [
        params.toolCallId,
        params.traceId,
        params.jobId,
        params.agentTurn,
        params.llmCallId,
        params.toolName,
        params.methodId || params.toolName,
        JSON.stringify(params.arguments || {}),
        params.sideEffect
      ]
    );

    return result.insertId;
  }

  async completeToolExecutionLog(logId: number, params: {
    status: string;
    result?: Record<string, unknown>;
    errorMessage?: string | null;
  }) {
    await this.sql.execute(
      `
        UPDATE tool_execution_logs
        SET status = ?,
            result = ?::jsonb,
            error_message = ?,
            completed_at = NOW(),
            duration_ms = GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000))
        WHERE id = ?
      `,
      [
        params.status,
        JSON.stringify(params.result || {}),
        params.errorMessage ?? null,
        logId
      ]
    );
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
        VALUES (?, ?, ?, ?, ?, 'agent-service', ?, ?::jsonb)
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

  async listRecentTurns(params: {
    userId: number;
    groupId?: number | null;
    limit?: number;
  }): Promise<ConversationTurn[]> {
    const limit = Math.max(1, Math.min(params.limit || 20, 100));
    const conditions: string[] = [];
    const values: Array<number | null> = [];

    if (params.groupId && Number.isFinite(params.groupId)) {
      conditions.push('group_id = ?');
      values.push(params.groupId);
    } else {
      conditions.push('group_id IS NULL');
      conditions.push('user_id = ?');
      values.push(params.userId);
    }

    const rows = await this.sql.query<{
      id: number;
      user_id: number;
      group_id: number | null;
      user_message: string;
      ai_response: string | null;
    }>(
      `
        SELECT id, user_id, group_id, user_message, ai_response
        FROM conversations
        WHERE ${conditions.join(' AND ')}
        ORDER BY id DESC
        LIMIT ${limit}
      `,
      values
    );

    return rows.reverse().map((row) => ({
      id: Number(row.id),
      userId: Number(row.user_id),
      groupId: row.group_id === null ? null : Number(row.group_id),
      userMessage: row.user_message,
      aiResponse: row.ai_response
    }));
  }

  async createConversation(params: {
    userId: number;
    groupId?: number | null;
    userMessage: string;
    aiResponse?: string | null;
    responseTimeMs: number;
    status: string;
    errorReason?: string | null;
    modelName?: string | null;
    traceId: string;
    rawRequest?: Record<string, unknown>;
    rawResponse?: Record<string, unknown>;
  }) {
    const result = await this.sql.insert(
      `
        INSERT INTO conversations (
          user_id,
          group_id,
          user_message,
          ai_response,
          response_time,
          status,
          error_reason,
          model_name,
          raw_request,
          raw_response,
          trace_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?::jsonb, ?)
      `,
      [
        params.userId,
        params.groupId ?? null,
        params.userMessage,
        params.aiResponse ?? null,
        params.responseTimeMs,
        params.status,
        params.errorReason ?? null,
        params.modelName ?? null,
        JSON.stringify(params.rawRequest || {}),
        JSON.stringify(params.rawResponse || {}),
        params.traceId
      ]
    );

    return result.insertId;
  }

  async attachConversationIdToTrace(traceId: string, conversationId: number) {
    await Promise.all([
      this.sql.execute(
        'UPDATE agent_queue_messages SET conversation_id = COALESCE(conversation_id, ?) WHERE trace_id = ?',
        [conversationId, traceId]
      ),
      this.sql.execute(
        'UPDATE agent_runs SET conversation_id = COALESCE(conversation_id, ?) WHERE trace_id = ?',
        [conversationId, traceId]
      ),
      this.sql.execute(
        'UPDATE agent_message_batches SET conversation_id = COALESCE(conversation_id, ?) WHERE trace_id = ?',
        [conversationId, traceId]
      ),
      this.sql.execute(
        'UPDATE llm_jobs SET conversation_id = COALESCE(conversation_id, ?) WHERE trace_id = ?',
        [conversationId, traceId]
      ),
      this.sql.execute(
        'UPDATE tool_execution_logs SET conversation_id = COALESCE(conversation_id, ?) WHERE trace_id = ?',
        [conversationId, traceId]
      ),
      this.sql.execute(
        'UPDATE llm_call_logs SET conversation_id = COALESCE(conversation_id, ?) WHERE trace_id = ?',
        [conversationId, traceId]
      ),
      this.sql.execute(
        'UPDATE timeline_events SET conversation_id = COALESCE(conversation_id, ?) WHERE trace_id = ?',
        [conversationId, traceId]
      )
    ]);
  }

  private mapClaimedRun(input: {
    runId: string;
    batchId: string;
    traceId: string;
    rows: QueueRow[];
  }): QueueMessageRecord {
    const messages = input.rows.map((row) => {
      const payload = parseJson<Partial<QueueBatchMessage>>(row.payload, {});
      return {
        queueMessageId: Number(row.id),
        traceId: input.traceId,
        source: row.source,
        messageId: payload.messageId ?? Number(row.id),
        messageSid: row.message_sid,
        chatType: row.chat_type === 'group' ? 'group' : 'direct',
        sessionKey: row.session_key,
        peerId: row.peer_id,
        peerName: row.peer_name || undefined,
        senderId: row.sender_id,
        senderName: row.sender_name || undefined,
        accountId: row.account_id,
        bodyForAgent: row.body_for_agent,
        rawBody: payload.rawBody || row.body_for_agent,
        commandBody: payload.commandBody || row.body_for_agent,
        wasMentioned: Boolean(payload.wasMentioned),
        receivedAt: payload.receivedAt || toIso(row.created_at) || new Date().toISOString(),
        messageTimestamp: payload.messageTimestamp ?? null,
        rawPayload: parseJson<Record<string, unknown>>(row.raw_payload, {}),
        inboundContext: parseJson(row.inbound_context, {}),
      } as QueueBatchMessage;
    });

    const latest = messages[messages.length - 1];
    const payload: QueueMessagePayload = {
      traceId: input.traceId,
      runId: input.runId,
      batchId: input.batchId,
      source: latest.source,
      chatType: latest.chatType,
      sessionKey: latest.sessionKey,
      peerId: latest.peerId,
      peerName: latest.peerName,
      senderId: latest.senderId,
      senderName: latest.senderName,
      accountId: latest.accountId,
      bodyForAgent: buildBatchSummary(input.rows),
      rawBody: messages.map((message) => message.rawBody).join('\n'),
      commandBody: messages.map((message) => message.commandBody).join('\n'),
      wasMentioned: messages.some((message) => message.wasMentioned),
      receivedAt: latest.receivedAt,
      messageTimestamp: latest.messageTimestamp,
      rawPayload: latest.rawPayload,
      inboundContext: latest.inboundContext,
      messages,
    };

    return {
      id: input.runId,
      traceId: input.traceId,
      batchId: input.batchId,
      status: 'processing',
      attempts: Math.max(...input.rows.map((row) => Number(row.attempts || 0) + 1), 1),
      createdAt: toIso(input.rows[0]?.created_at) || new Date().toISOString(),
      processingStartedAt: new Date().toISOString(),
      completedAt: null,
      conversationId: null,
      errorMessage: null,
      queueMessageIds: input.rows.map((row) => Number(row.id)),
      payload,
    };
  }

  private async ensureSchema() {
    const ddlStatements = [
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
      'CREATE INDEX IF NOT EXISTS idx_llm_jobs_trace_created ON llm_jobs (trace_id, created_at, id)',
      'CREATE INDEX IF NOT EXISTS idx_tool_execution_logs_trace_started ON tool_execution_logs (trace_id, started_at, completed_at, id)',
      'CREATE INDEX IF NOT EXISTS idx_conversations_trace_id ON conversations (trace_id)'
    ];

    for (const ddl of ddlStatements) {
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
