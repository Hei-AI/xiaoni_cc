import { createSqlAdapter, type SqlAdapter } from '@qq-bot/persistence';
import { databaseConfig } from '../config';

export type StoredConversationTurn = {
  id: number;
  user_id: number;
  group_id: number | null;
  user_message: string;
  ai_response: string | null;
  timestamp: string;
  response_time: number;
  status: string | null;
  error_reason: string | null;
  model_name: string | null;
  raw_request: Record<string, unknown>;
  raw_response: Record<string, unknown>;
  trace_id: string | null;
  source_message_ids: number[];
  source_message_sids: string[];
};

type CreateConversationInput = {
  userId: number;
  groupId?: number | null;
  userMessage: string;
  aiResponse?: string | null;
  responseTimeMs?: number;
  status?: string;
  errorReason?: string | null;
  modelName?: string | null;
  rawRequest?: Record<string, unknown>;
  rawResponse?: Record<string, unknown>;
  traceId?: string | null;
};

type MaterializeInboundConversationInput = {
  userId: number;
  groupId?: number | null;
  userMessage: string;
  traceId?: string | null;
  sourceMessageId?: number | null;
  sourceMessageSid?: string | null;
  rawRequest?: Record<string, unknown>;
};

export class ConversationStoreService {
  private readonly sql: SqlAdapter;

  constructor() {
    this.sql = createSqlAdapter({
      databaseUrl: databaseConfig.url,
      host: databaseConfig.host,
      port: databaseConfig.port,
      user: databaseConfig.user,
      password: databaseConfig.password,
      database: databaseConfig.database,
      connectionLimit: 5,
      applicationName: 'provider-service'
    });
  }

  async initialize() {
    await this.ensureChatSettingsColumns();
    await this.ensureConversationIndexes();
  }

  async listRecentTurns(params: {
    userId: number;
    groupId?: number | null;
    limit?: number;
    afterConversationId?: number | null;
  }): Promise<StoredConversationTurn[]> {
    const limit = typeof params.limit === 'number'
      ? Math.max(1, Math.min(params.limit, 1000))
      : null;
    const conditions = [];
    const values: any[] = [];

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

    const rows = await this.sql.query<StoredConversationTurn>(
      `
        SELECT
          id,
          user_id,
          group_id,
          user_message,
          ai_response,
          timestamp,
          response_time,
          status,
          error_reason,
          model_name,
          raw_request,
          raw_response,
          trace_id
        FROM conversations
        WHERE ${conditions.join(' AND ')}
        ORDER BY id DESC
        ${limit ? `LIMIT ${limit}` : ''}
      `,
      values
    );

    const traceIds = Array.from(new Set(
      rows
        .map((row) => (typeof row.trace_id === 'string' ? row.trace_id.trim() : ''))
        .filter(Boolean)
    ));
    const queueRows = traceIds.length > 0
      ? await this.sql.query<{
          trace_id: string;
          message_sid: string;
          payload: string | Record<string, unknown>;
        }>(
          `
            SELECT
              trace_id,
              message_sid,
              payload
            FROM agent_queue_messages
            WHERE trace_id IN (${traceIds.map(() => '?').join(', ')})
            ORDER BY id ASC
          `,
          traceIds
        )
      : [];
    const messageIdsByTrace = new Map<string, number[]>();
    const messageSidsByTrace = new Map<string, string[]>();

    for (const row of queueRows) {
      const traceId = typeof row.trace_id === 'string' ? row.trace_id.trim() : '';
      if (!traceId) {
        continue;
      }
      const payload = normalizeJson(row.payload);
      const sourceMessageId = Number(payload.messageId);
      const sourceMessageIds = messageIdsByTrace.get(traceId) || [];
      if (Number.isFinite(sourceMessageId) && sourceMessageId > 0 && !sourceMessageIds.includes(sourceMessageId)) {
        sourceMessageIds.push(sourceMessageId);
        messageIdsByTrace.set(traceId, sourceMessageIds);
      }

      const sourceMessageSid = typeof row.message_sid === 'string' ? row.message_sid.trim() : '';
      const sourceMessageSids = messageSidsByTrace.get(traceId) || [];
      if (sourceMessageSid && !sourceMessageSids.includes(sourceMessageSid)) {
        sourceMessageSids.push(sourceMessageSid);
        messageSidsByTrace.set(traceId, sourceMessageSids);
      }
    }

    return rows.reverse().map((row) => {
      const traceId = typeof row.trace_id === 'string' ? row.trace_id.trim() : '';
      const rawRequest = normalizeJson(row.raw_request);
      const rawResponse = normalizeJson(row.raw_response);
      const fallbackMessageIds = normalizeNumberArray(rawRequest.source_message_ids);
      const fallbackMessageSids = normalizeStringArray(rawRequest.source_message_sids);

      return {
        ...row,
        raw_request: rawRequest,
        raw_response: rawResponse,
        source_message_ids: messageIdsByTrace.get(traceId) || fallbackMessageIds,
        source_message_sids: messageSidsByTrace.get(traceId) || fallbackMessageSids
      };
    });
  }

  async createConversation(input: CreateConversationInput): Promise<number> {
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
        input.userId,
        input.groupId ?? null,
        input.userMessage,
        input.aiResponse ?? null,
        Math.max(0, Math.round(input.responseTimeMs || 0)),
        input.status || 'completed',
        input.errorReason ?? null,
        input.modelName ?? null,
        JSON.stringify(input.rawRequest || {}),
        JSON.stringify(input.rawResponse || {}),
        input.traceId ?? null
      ]
    );

    return result.insertId;
  }

  async materializeInboundConversation(input: MaterializeInboundConversationInput): Promise<number> {
    return this.createConversation({
      userId: input.userId,
      groupId: input.groupId,
      userMessage: input.userMessage,
      aiResponse: null,
      responseTimeMs: 0,
      status: 'received',
      traceId: input.traceId ?? null,
      rawRequest: {
        mode: 'continuous_learning',
        source_message_ids: input.sourceMessageId ? [input.sourceMessageId] : [],
        source_message_sids: input.sourceMessageSid ? [input.sourceMessageSid] : [],
        ...(input.rawRequest || {})
      },
      rawResponse: {}
    });
  }

  async close() {
    await this.sql.close();
  }

  private async ensureConversationIndexes() {
    await this.sql.execute(
      'CREATE INDEX IF NOT EXISTS idx_conversations_user_group_time ON conversations (user_id, group_id, id DESC)'
    );
    await this.sql.execute(
      'CREATE INDEX IF NOT EXISTS idx_conversations_group_time ON conversations (group_id, id DESC)'
    );
  }

  private async ensureChatSettingsColumns() {
    await this.sql.execute(
      `ALTER TABLE private_chat_settings
       ADD COLUMN IF NOT EXISTS continuous_learning_enabled INTEGER NOT NULL DEFAULT 1`
    );
    await this.sql.execute(
      `ALTER TABLE group_chat_settings
       ADD COLUMN IF NOT EXISTS continuous_learning_enabled INTEGER NOT NULL DEFAULT 1`
    );
    await this.sql.execute(
      `ALTER TABLE private_chat_settings
       ADD COLUMN IF NOT EXISTS transcript_compact_offset INTEGER NOT NULL DEFAULT 6`
    );
    await this.sql.execute(
      `ALTER TABLE group_chat_settings
       ADD COLUMN IF NOT EXISTS transcript_compact_offset INTEGER NOT NULL DEFAULT 6`
    );
  }
}

function normalizeNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(new Set(value
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item > 0)
    .map((item) => Math.trunc(item))));
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(new Set(value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)));
}

function normalizeJson(value: unknown): Record<string, unknown> {
  if (!value) {
    return {};
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }
  return {};
}
