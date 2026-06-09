import {
  createSqlAdapter,
  ensureTranscriptSnapshotSchema,
  getTranscriptSnapshotBySessionId,
  upsertTranscriptSnapshot,
  type SqlAdapter
} from '@qq-bot/persistence';
import { databaseConfig } from '../config';

export type TranscriptSnapshotStatus = 'ready' | 'pending' | 'failed';

export type TranscriptSnapshotRecord = {
  session_id: string;
  chat_type: 'direct' | 'group';
  private_user_id: number | null;
  group_id: number | null;
  summary_text: string;
  summary_format_version: string;
  summarized_through_conversation_id: number;
  summary_status: TranscriptSnapshotStatus;
  summary_job_id: string | null;
  last_compacted_at: string | null;
  created_at: string;
  updated_at: string;
};

type UpsertTranscriptSnapshotInput = {
  sessionId: string;
  chatType: 'direct' | 'group';
  privateUserId?: number | null;
  groupId?: number | null;
  summaryText: string;
  summaryFormatVersion: string;
  summarizedThroughConversationId: number;
  summaryStatus?: TranscriptSnapshotStatus;
  summaryJobId?: string | null;
  lastCompactedAt?: string | Date | null;
};

type MarkFailedSnapshotInput = {
  sessionId: string;
  summaryJobId?: string | null;
  summaryFormatVersion?: string;
};

type ApplySummaryResultInput = {
  sessionId: string;
  chatType: 'direct' | 'group';
  privateUserId?: number | null;
  groupId?: number | null;
  summaryText: string;
  summaryFormatVersion: string;
  summarizedThroughConversationId: number;
  summaryJobId?: string | null;
};

export class TranscriptSnapshotService {
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

  async initialize(): Promise<void> {
    await ensureTranscriptSnapshotSchema({
      sqlAdapter: this.sql
    }, databaseConfig);
  }

  async getBySessionId(sessionId: string): Promise<TranscriptSnapshotRecord | null> {
    return getTranscriptSnapshotBySessionId({
      sessionId,
      sqlAdapter: this.sql
    }, databaseConfig) as Promise<TranscriptSnapshotRecord | null>;
  }

  async upsert(input: UpsertTranscriptSnapshotInput): Promise<void> {
    await upsertTranscriptSnapshot({
      ...input,
      sqlAdapter: this.sql
    }, databaseConfig);
  }

  async markPending(params: {
    sessionId: string;
    chatType: 'direct' | 'group';
    privateUserId?: number | null;
    groupId?: number | null;
    summaryJobId?: string | null;
    summarizedThroughConversationId: number;
  }): Promise<void> {
    const existing = await this.getBySessionId(params.sessionId);
    await this.upsert({
      sessionId: params.sessionId,
      chatType: params.chatType,
      privateUserId: params.privateUserId,
      groupId: params.groupId,
      summaryText: existing?.summary_text || '',
      summaryFormatVersion: existing?.summary_format_version || 'pending',
      summarizedThroughConversationId: params.summarizedThroughConversationId,
      summaryStatus: 'pending',
      summaryJobId: params.summaryJobId ?? null,
      lastCompactedAt: existing?.last_compacted_at || null
    });
  }

  async markFailed(params: MarkFailedSnapshotInput): Promise<void> {
    const existing = await this.getBySessionId(params.sessionId);
    if (!existing) {
      return;
    }

    await this.upsert({
      sessionId: existing.session_id,
      chatType: existing.chat_type,
      privateUserId: existing.private_user_id,
      groupId: existing.group_id,
      summaryText: existing.summary_text,
      summaryFormatVersion: params.summaryFormatVersion || existing.summary_format_version || 'failed',
      summarizedThroughConversationId: existing.summarized_through_conversation_id,
      summaryStatus: 'failed',
      summaryJobId: params.summaryJobId ?? existing.summary_job_id,
      lastCompactedAt: existing.last_compacted_at
    });
  }

  async applySummaryResult(input: ApplySummaryResultInput): Promise<void> {
    await this.upsert({
      sessionId: input.sessionId,
      chatType: input.chatType,
      privateUserId: input.privateUserId ?? null,
      groupId: input.groupId ?? null,
      summaryText: input.summaryText,
      summaryFormatVersion: input.summaryFormatVersion,
      summarizedThroughConversationId: input.summarizedThroughConversationId,
      summaryStatus: 'ready',
      summaryJobId: input.summaryJobId ?? null,
      lastCompactedAt: new Date()
    });
  }

  async close(): Promise<void> {
    await this.sql.close();
  }
}
