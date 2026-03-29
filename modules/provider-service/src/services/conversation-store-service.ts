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

    return rows.reverse().map((row) => ({
      ...row,
      raw_request: normalizeJson(row.raw_request),
      raw_response: normalizeJson(row.raw_response)
    }));
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
       ADD COLUMN IF NOT EXISTS transcript_compact_offset INTEGER NOT NULL DEFAULT 6`
    );
    await this.sql.execute(
      `ALTER TABLE group_chat_settings
       ADD COLUMN IF NOT EXISTS transcript_compact_offset INTEGER NOT NULL DEFAULT 6`
    );
  }
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
