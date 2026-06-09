import {
  createSqlAdapter,
  ensureConversationStoreSchema,
  listStoredConversationTurns,
  createStoredConversation,
  type SqlAdapter
} from '@qq-bot/persistence';
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
    await ensureConversationStoreSchema({
      sqlAdapter: this.sql
    }, databaseConfig);
  }

  async listRecentTurns(params: {
    userId: number;
    groupId?: number | null;
    limit?: number;
    afterConversationId?: number | null;
  }): Promise<StoredConversationTurn[]> {
    return listStoredConversationTurns({
      ...params,
      sqlAdapter: this.sql
    }, databaseConfig) as Promise<StoredConversationTurn[]>;
  }

  async createConversation(input: CreateConversationInput): Promise<number> {
    return createStoredConversation({
      ...input,
      sqlAdapter: this.sql
    }, databaseConfig);
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
}
