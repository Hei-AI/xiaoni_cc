import {
  createSqlAdapter,
  listRelationshipMemoryCards,
  listRelationshipMemoryOverrides,
  serializeTimestampForApi,
  type SqlAdapter
} from '@qq-bot/persistence';
import { v4 as uuidv4 } from 'uuid';
import { databaseConfig } from '../config';
import {
  ConversationTranscriptItem,
  ConversationTranscriptPhase,
  ConversationTranscriptRole,
  ConversationTranscriptSource,
  ConversationTurn,
  FinalizedInboundContext,
  QueueBatchMessage,
  QueueMessagePayload,
  QueueMessageRecord
} from '../types';
import { renderRuntimeBatchMessage } from './runtime-input-renderer';

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

type StructuredReplayQueueRow = {
  id: number;
  trace_id: string;
  run_id: string | null;
  conversation_id: number | null;
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
  payload: string | Record<string, unknown>;
  created_at: string | Date;
};

export type AgentRunDeliveryPhase = 'reasoning_open' | 'delivery_committed' | 'finished';

type AgentRunDeliveryStateRow = {
  delivery_phase: string | null;
  delivery_commit_count: number | string | null;
  blocked_delivery_attempt_count: number | string | null;
  last_blocked_delivery_reason: string | null;
};

export type AgentRunDeliveryState = {
  deliveryPhase: AgentRunDeliveryPhase;
  deliveryCommitCount: number;
  blockedDeliveryAttemptCount: number;
  lastBlockedDeliveryReason: string | null;
};

export type RuntimeRelationshipMemoryCard = {
  id: number;
  cardType: string;
  groupId: number | null;
  targetUserId: number | null;
  summaryText: string;
  actors: string[];
  contextBefore: string | null;
  trigger: string | null;
  interaction: string | null;
  outcome: string | null;
  sourceEventIds: number[];
  sourceMessageIds: number[];
  decayedScore: number;
  metadata: Record<string, unknown>;
};

function toIso(value: string | Date | null | undefined): string | null {
  return serializeTimestampForApi(value) as string | null;
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

function normalizeDeliveryPhase(value: unknown): AgentRunDeliveryPhase {
  if (value === 'delivery_committed' || value === 'finished') {
    return value;
  }
  return 'reasoning_open';
}

function mapAgentRunDeliveryState(row?: Partial<AgentRunDeliveryStateRow> | null): AgentRunDeliveryState {
  return {
    deliveryPhase: normalizeDeliveryPhase(row?.delivery_phase),
    deliveryCommitCount: Number(row?.delivery_commit_count || 0),
    blockedDeliveryAttemptCount: Number(row?.blocked_delivery_attempt_count || 0),
    lastBlockedDeliveryReason: typeof row?.last_blocked_delivery_reason === 'string' && row.last_blocked_delivery_reason.trim().length > 0
      ? row.last_blocked_delivery_reason
      : null
  };
}

function buildBatchSummary(rows: QueueRow[]) {
  return rows.map((row, index) => `#${index + 1} ${row.sender_name || row.sender_id}: ${row.body_for_agent}`).join('\n');
}

function buildTranscriptSessionId(userId: number, groupId?: number | null) {
  if (groupId && Number.isFinite(groupId)) {
    return `group:${groupId}`;
  }
  return `private:${userId}`;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

function normalizeNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item))
    .map((item) => Math.trunc(item));
}

function parseRelationshipMemoryCard(record: any): RuntimeRelationshipMemoryCard {
  return {
    id: Number(record.id),
    cardType: typeof record.card_type === 'string' ? record.card_type : 'person_memory',
    groupId: record.group_id === null || typeof record.group_id === 'undefined' ? null : Number(record.group_id),
    targetUserId: record.target_user_id === null || typeof record.target_user_id === 'undefined' ? null : Number(record.target_user_id),
    summaryText: typeof record.summary_text === 'string' ? record.summary_text.trim() : '',
    actors: normalizeStringArray(record.actors),
    contextBefore: typeof record.context_before === 'string' ? record.context_before.trim() : null,
    trigger: typeof record.trigger === 'string' ? record.trigger.trim() : null,
    interaction: typeof record.interaction === 'string' ? record.interaction.trim() : null,
    outcome: typeof record.outcome === 'string' ? record.outcome.trim() : null,
    sourceEventIds: normalizeNumberArray(record.source_event_ids),
    sourceMessageIds: normalizeNumberArray(record.source_message_ids),
    decayedScore: Number.isFinite(Number(record.decayed_score)) ? Number(record.decayed_score) : 0,
    metadata: record.metadata && typeof record.metadata === 'object' && !Array.isArray(record.metadata)
      ? record.metadata as Record<string, unknown>
      : {}
  };
}

async function applyRelationshipMemoryOverrides(cards: RuntimeRelationshipMemoryCard[]) {
  const adjusted: RuntimeRelationshipMemoryCard[] = [];

  for (const card of cards) {
    const overrides = await listRelationshipMemoryOverrides(card.id, databaseConfig);
    let archived = false;
    let score = card.decayedScore;

    for (const override of overrides) {
      const actionType = typeof override.action_type === 'string' ? override.action_type : '';
      if (actionType === 'archive') {
        archived = true;
        break;
      }
      if (actionType === 'pin') {
        score += 100;
      }
      if (actionType === 'downrank') {
        score -= 1;
      }
    }

    if (archived) {
      continue;
    }

    adjusted.push({
      ...card,
      decayedScore: score
    });
  }

  return adjusted;
}

type ConversationTranscriptItemInput = {
  sessionKey: string | null;
  role: ConversationTranscriptRole;
  phase?: ConversationTranscriptPhase | null;
  content: string;
  groupIndex: number;
  itemIndex: number;
  source: ConversationTranscriptSource;
  deliveryMessageId?: number | null;
  runId?: string | null;
  traceId?: string | null;
};

function buildLegacyConversationItems(params: {
  conversationId: number;
  sessionKey: string;
  userMessage: string;
  aiResponse: string | null;
  traceId?: string | null;
}): ConversationTranscriptItem[] {
  const items: ConversationTranscriptItem[] = [{
    id: null,
    conversationId: params.conversationId,
    sessionKey: params.sessionKey,
    role: 'user',
    phase: null,
    content: params.userMessage,
    groupIndex: 0,
    itemIndex: 0,
    source: 'legacy_user_message',
    deliveryMessageId: null,
    runId: null,
    traceId: params.traceId ?? null
  }];

  if (typeof params.aiResponse === 'string' && params.aiResponse.trim().length > 0) {
    items.push({
      id: null,
      conversationId: params.conversationId,
      sessionKey: params.sessionKey,
      role: 'assistant',
      phase: null,
      content: params.aiResponse,
      groupIndex: 1,
      itemIndex: 0,
      source: 'legacy_ai_response',
      deliveryMessageId: null,
      runId: null,
      traceId: params.traceId ?? null
    });
  }

  return items;
}

function buildQueueBatchMessageFromStructuredRow(row: StructuredReplayQueueRow): QueueBatchMessage {
  const payload = parseJson<Partial<QueueBatchMessage>>(row.payload, {});
  const defaultInboundContext: FinalizedInboundContext = {
    Body: payload.bodyForAgent || row.body_for_agent,
    BodyForAgent: payload.bodyForAgent || row.body_for_agent,
    BodyForCommands: payload.commandBody || payload.bodyForAgent || row.body_for_agent,
    CommandAuthorized: false
  };

  return {
    queueMessageId: Number(row.id),
    traceId: row.trace_id,
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
    bodyForAgent: payload.bodyForAgent || row.body_for_agent,
    rawBody: payload.rawBody || payload.bodyForAgent || row.body_for_agent,
    commandBody: payload.commandBody || payload.bodyForAgent || row.body_for_agent,
    wasMentioned: Boolean(payload.wasMentioned),
    receivedAt: payload.receivedAt || toIso(row.created_at) || new Date().toISOString(),
    messageTimestamp: payload.messageTimestamp ?? null,
    rawPayload: parseJson<Record<string, unknown>>(row.raw_payload, {}),
    inboundContext: parseJson(row.inbound_context, defaultInboundContext)
  };
}

function buildStructuredReplayConversationItems(params: {
  rows: StructuredReplayQueueRow[];
  traceToConversationId: Map<string, number>;
}): Map<number, ConversationTranscriptItem[]> {
  const itemsByConversationId = new Map<number, ConversationTranscriptItem[]>();

  for (const row of params.rows) {
    const traceId = typeof row.trace_id === 'string' ? row.trace_id.trim() : '';
    const conversationId = Number(row.conversation_id) || params.traceToConversationId.get(traceId);
    if (!conversationId) {
      continue;
    }

    const items = itemsByConversationId.get(conversationId) || [];
    const message = buildQueueBatchMessageFromStructuredRow(row);
    items.push({
      id: null,
      conversationId,
      sessionKey: row.session_key,
      role: 'user',
      phase: null,
      content: renderRuntimeBatchMessage(message, items.length),
      groupIndex: 0,
      itemIndex: items.length,
      source: 'inbound_batch',
      deliveryMessageId: null,
      runId: row.run_id,
      traceId: traceId || null
    });
    itemsByConversationId.set(conversationId, items);
  }

  return itemsByConversationId;
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
            delivery_phase,
            started_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'processing', 'reasoning_open', NOW())
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
            delivery_phase = 'finished',
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

  async getRunDeliveryState(runId: string): Promise<AgentRunDeliveryState> {
    const rows = await this.sql.query<AgentRunDeliveryStateRow>(
      `
        SELECT
          delivery_phase,
          delivery_commit_count,
          blocked_delivery_attempt_count,
          last_blocked_delivery_reason
        FROM agent_runs
        WHERE id = ?
        LIMIT 1
      `,
      [runId]
    );

    return mapAgentRunDeliveryState(rows[0]);
  }

  async markRunDeliveryCommitted(runId: string) {
    await this.sql.execute(
      `
        UPDATE agent_runs
        SET delivery_phase = 'delivery_committed',
            delivery_commit_count = CASE
              WHEN delivery_commit_count >= 1 THEN delivery_commit_count
              ELSE 1
            END,
            updated_at = NOW()
        WHERE id = ?
      `,
      [runId]
    );
  }

  async markRunDeliveryBlocked(runId: string, reason: string) {
    await this.sql.execute(
      `
        UPDATE agent_runs
        SET blocked_delivery_attempt_count = COALESCE(blocked_delivery_attempt_count, 0) + 1,
            last_blocked_delivery_reason = ?,
            updated_at = NOW()
        WHERE id = ?
      `,
      [reason, runId]
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
    afterConversationId?: number | null;
    limit?: number;
  }): Promise<ConversationTurn[]> {
    const limit = typeof params.limit === 'number'
      ? Math.max(1, Math.min(params.limit, 1000))
      : null;
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

    if (params.afterConversationId && Number.isFinite(params.afterConversationId)) {
      conditions.push('id > ?');
      values.push(params.afterConversationId);
    }

    const rows = await this.sql.query<{
      id: number;
      batch_id: number | null;
      trace_id: string | null;
      user_id: number;
      group_id: number | null;
      user_message: string;
      ai_response: string | null;
    }>(
      `
        SELECT id, batch_id, trace_id, user_id, group_id, user_message, ai_response
        FROM conversations
        WHERE ${conditions.join(' AND ')}
        ORDER BY id DESC
        ${limit ? `LIMIT ${limit}` : ''}
      `,
      values
    );

    const orderedRows = rows.reverse();
    const conversationIds = orderedRows.map((row) => Number(row.id));
    const traceToConversationId = new Map<string, number>();
    for (const row of orderedRows) {
      if (typeof row.trace_id === 'string' && row.trace_id.trim()) {
        traceToConversationId.set(row.trace_id.trim(), Number(row.id));
      }
    }
    const itemRows = conversationIds.length > 0
      ? await this.sql.query<{
          id: number;
          conversation_id: number;
          session_key: string | null;
          role: string;
          phase: string | null;
          content: string;
          group_index: number;
          item_index: number;
          source: string;
          delivery_message_id: number | null;
          run_id: string | null;
          trace_id: string | null;
        }>(
          `
            SELECT
              id,
              conversation_id,
              session_key,
              role,
              phase,
              content,
              group_index,
              item_index,
              source,
              delivery_message_id,
              run_id,
              trace_id
            FROM conversation_items
            WHERE conversation_id IN (${conversationIds.map(() => '?').join(', ')})
            ORDER BY conversation_id ASC, group_index ASC, item_index ASC, id ASC
          `,
          conversationIds
        )
      : [];
    const structuredReplayRows = traceToConversationId.size > 0
      ? await this.sql.query<StructuredReplayQueueRow>(
          `
            SELECT
              q.id,
              q.trace_id,
              q.run_id,
              q.conversation_id,
              q.source,
              q.message_sid,
              q.chat_type,
              q.session_key,
              q.peer_id,
              q.peer_name,
              q.sender_id,
              q.sender_name,
              q.account_id,
              q.body_for_agent,
              q.raw_payload,
              q.inbound_context,
              q.payload,
              q.created_at
            FROM agent_queue_messages q
            LEFT JOIN agent_message_batch_items bi ON bi.queue_message_id = q.id
            WHERE q.trace_id IN (${Array.from(traceToConversationId.keys()).map(() => '?').join(', ')})
            ORDER BY q.trace_id ASC, COALESCE(bi.position, 2147483647) ASC, q.id ASC
          `,
          Array.from(traceToConversationId.keys())
        )
      : [];

    const itemsByConversationId = new Map<number, ConversationTranscriptItem[]>();
    for (const row of itemRows) {
      const conversationId = Number(row.conversation_id);
      const items = itemsByConversationId.get(conversationId) || [];
      items.push({
        id: Number(row.id),
        conversationId,
        sessionKey: row.session_key,
        role: row.role === 'assistant' ? 'assistant' : 'user',
        phase: row.phase === 'commentary' || row.phase === 'final_answer' ? row.phase : null,
        content: row.content,
        groupIndex: Number(row.group_index),
        itemIndex: Number(row.item_index),
        source: row.source === 'delivery'
          || row.source === 'legacy_user_message'
          || row.source === 'legacy_ai_response'
          ? row.source
          : 'inbound_batch',
        deliveryMessageId: row.delivery_message_id === null ? null : Number(row.delivery_message_id),
        runId: row.run_id,
        traceId: row.trace_id
      });
      itemsByConversationId.set(conversationId, items);
    }
    const reconstructedUserItemsByConversationId = buildStructuredReplayConversationItems({
      rows: structuredReplayRows,
      traceToConversationId
    });

    return orderedRows.map((row) => {
      const conversationId = Number(row.id);
      const sessionKey = buildTranscriptSessionId(
        Number(row.user_id),
        row.group_id === null ? null : Number(row.group_id)
      );
      const existingItems = itemsByConversationId.get(conversationId) || buildLegacyConversationItems({
        conversationId,
        sessionKey,
        userMessage: row.user_message,
        aiResponse: row.ai_response,
        traceId: row.trace_id
      });
      const reconstructedUserItems = reconstructedUserItemsByConversationId.get(conversationId) || [];
      const items = reconstructedUserItems.length > 0
        ? [
            ...reconstructedUserItems,
            ...existingItems.filter((item) => item.role === 'assistant')
          ]
        : existingItems;

      return {
        id: conversationId,
        userId: Number(row.user_id),
        groupId: row.group_id === null ? null : Number(row.group_id),
        batchId: row.batch_id === null ? null : Number(row.batch_id),
        sessionKey,
        userMessage: row.user_message,
        aiResponse: row.ai_response,
        items
      };
    });
  }

  async loadSessionReplayState(params: {
    userId: number;
    groupId?: number | null;
    recentUserIds?: number[];
  }): Promise<{
    summaryText: string | null;
    summarizedThroughConversationId: number | null;
    relationshipCards: {
      groupCards: RuntimeRelationshipMemoryCard[];
      currentUserCards: RuntimeRelationshipMemoryCard[];
      recentUserCards: RuntimeRelationshipMemoryCard[];
    };
  }> {
    const snapshotSessionId = buildTranscriptSessionId(params.userId, params.groupId);
    const snapshotRows = await this.sql.query<{
      summary_text: string;
      summarized_through_conversation_id: number | string;
      summary_status: string;
    }>(
      `
        SELECT
          summary_text,
          summarized_through_conversation_id,
          summary_status
        FROM chat_transcript_snapshots
        WHERE session_id = ?
          AND summary_status = 'ready'
        LIMIT 1
      `,
      [snapshotSessionId]
    );

    const snapshot = snapshotRows[0];
    const relationshipCards = await this.loadRelationshipMemoryCards({
      groupId: params.groupId ?? null,
      currentUserId: params.userId,
      recentUserIds: params.recentUserIds || []
    });
    return {
      summaryText: snapshot?.summary_text?.trim() || null,
      summarizedThroughConversationId: snapshot
        ? Number(snapshot.summarized_through_conversation_id)
        : null,
      relationshipCards
    };
  }

  private async loadRelationshipMemoryCards(params: {
    groupId: number | null;
    currentUserId: number;
    recentUserIds: number[];
  }): Promise<{
    groupCards: RuntimeRelationshipMemoryCard[];
    currentUserCards: RuntimeRelationshipMemoryCard[];
    recentUserCards: RuntimeRelationshipMemoryCard[];
  }> {
    if (!params.groupId || !Number.isFinite(params.groupId)) {
      return {
        groupCards: [],
        currentUserCards: [],
        recentUserCards: []
      };
    }

    const uniqueRecentUserIds = Array.from(new Set(
      params.recentUserIds
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0 && value !== params.currentUserId)
    )).slice(0, 2);

    const [groupRows, currentUserRows, ...recentRowsList] = await Promise.all([
      listRelationshipMemoryCards({
        groupId: params.groupId,
        isActive: true,
        limit: 6
      }, databaseConfig),
      listRelationshipMemoryCards({
        groupId: params.groupId,
        targetUserId: params.currentUserId,
        isActive: true,
        limit: 6
      }, databaseConfig),
      ...uniqueRecentUserIds.map((userId) => listRelationshipMemoryCards({
        groupId: params.groupId as number,
        targetUserId: userId,
        isActive: true,
        limit: 4
      }, databaseConfig))
    ]);

    const groupCards = await applyRelationshipMemoryOverrides(groupRows.map(parseRelationshipMemoryCard));
    const currentUserCards = await applyRelationshipMemoryOverrides(currentUserRows.map(parseRelationshipMemoryCard));
    const recentUserCards = await applyRelationshipMemoryOverrides(
      recentRowsList.flat().map(parseRelationshipMemoryCard)
    );

    const sortCards = (cards: RuntimeRelationshipMemoryCard[]) => cards
      .sort((left, right) => right.decayedScore - left.decayedScore || right.id - left.id);

    return {
      groupCards: sortCards(groupCards).slice(0, 2),
      currentUserCards: sortCards(currentUserCards).slice(0, 3),
      recentUserCards: sortCards(recentUserCards).slice(0, 2)
    };
  }

  async createConversation(params: {
    batchId?: number | null;
    userId: number;
    groupId?: number | null;
    userMessage: string;
    aiResponse?: string | null;
    sessionKey?: string | null;
    transcriptItems?: ConversationTranscriptItemInput[];
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
          batch_id,
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
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?::jsonb, ?)
      `,
      [
        params.batchId ?? null,
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

    const conversationId = Number(result.insertId);
    const transcriptItems = Array.isArray(params.transcriptItems) ? params.transcriptItems : [];
    if (transcriptItems.length > 0) {
      for (const item of transcriptItems) {
        await this.sql.insert(
          `
            INSERT INTO conversation_items (
              conversation_id,
              session_key,
              role,
              phase,
              content,
              group_index,
              item_index,
              source,
              delivery_message_id,
              run_id,
              trace_id
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            conversationId,
            item.sessionKey ?? params.sessionKey ?? null,
            item.role,
            item.phase ?? null,
            item.content,
            item.groupIndex,
            item.itemIndex,
            item.source,
            item.deliveryMessageId ?? null,
            item.runId ?? null,
            item.traceId ?? params.traceId
          ]
        );
      }
    }

    return conversationId;
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
        CREATE TABLE IF NOT EXISTS chat_transcript_snapshots (
          session_id VARCHAR(191) PRIMARY KEY,
          chat_type VARCHAR(16) NOT NULL,
          private_user_id BIGINT NULL,
          group_id BIGINT NULL,
          summary_text TEXT NOT NULL,
          summary_format_version VARCHAR(32) NOT NULL,
          summarized_through_conversation_id BIGINT NOT NULL,
          summary_status VARCHAR(16) NOT NULL DEFAULT 'ready',
          summary_job_id VARCHAR(128) NULL,
          last_compacted_at TIMESTAMP(3) NULL,
          created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `,
      `
        CREATE TABLE IF NOT EXISTS conversation_items (
          id BIGSERIAL PRIMARY KEY,
          conversation_id BIGINT NOT NULL,
          session_key VARCHAR(191),
          role VARCHAR(16) NOT NULL,
          phase VARCHAR(32),
          content TEXT NOT NULL,
          group_index INTEGER NOT NULL DEFAULT 0,
          item_index INTEGER NOT NULL DEFAULT 0,
          source VARCHAR(32) NOT NULL,
          delivery_message_id BIGINT,
          run_id VARCHAR(128),
          trace_id VARCHAR(128),
          created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `,
      'CREATE INDEX IF NOT EXISTS idx_chat_transcript_snapshots_private_user ON chat_transcript_snapshots (private_user_id, updated_at DESC)',
      'CREATE INDEX IF NOT EXISTS idx_chat_transcript_snapshots_group ON chat_transcript_snapshots (group_id, updated_at DESC)',
      'CREATE INDEX IF NOT EXISTS idx_chat_transcript_snapshots_status ON chat_transcript_snapshots (summary_status, updated_at DESC)',
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
          delivery_phase TEXT NOT NULL DEFAULT 'reasoning_open',
          delivery_commit_count INTEGER NOT NULL DEFAULT 0,
          blocked_delivery_attempt_count INTEGER NOT NULL DEFAULT 0,
          last_blocked_delivery_reason TEXT,
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
      `ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS delivery_phase TEXT NOT NULL DEFAULT 'reasoning_open'`,
      `ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS delivery_commit_count INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS blocked_delivery_attempt_count INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS last_blocked_delivery_reason TEXT`,
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
      'CREATE INDEX IF NOT EXISTS idx_conversation_items_conversation_group_item ON conversation_items (conversation_id, group_index, item_index, id)',
      'CREATE INDEX IF NOT EXISTS idx_conversation_items_session_created ON conversation_items (session_key, created_at, id)',
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
