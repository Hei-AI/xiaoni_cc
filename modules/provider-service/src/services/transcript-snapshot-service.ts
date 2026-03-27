import { createSqlAdapter, type SqlAdapter } from '@qq-bot/persistence';
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
    await this.sql.execute(
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
      `
    );
    await this.sql.execute(
      'CREATE INDEX IF NOT EXISTS idx_chat_transcript_snapshots_private_user ON chat_transcript_snapshots (private_user_id, updated_at DESC)'
    );
    await this.sql.execute(
      'CREATE INDEX IF NOT EXISTS idx_chat_transcript_snapshots_group ON chat_transcript_snapshots (group_id, updated_at DESC)'
    );
    await this.sql.execute(
      'CREATE INDEX IF NOT EXISTS idx_chat_transcript_snapshots_status ON chat_transcript_snapshots (summary_status, updated_at DESC)'
    );
  }

  async getBySessionId(sessionId: string): Promise<TranscriptSnapshotRecord | null> {
    const rows = await this.sql.query<TranscriptSnapshotRecord>(
      `
        SELECT
          session_id,
          chat_type,
          private_user_id,
          group_id,
          summary_text,
          summary_format_version,
          summarized_through_conversation_id,
          summary_status,
          summary_job_id,
          last_compacted_at,
          created_at,
          updated_at
        FROM chat_transcript_snapshots
        WHERE session_id = ?
        LIMIT 1
      `,
      [sessionId]
    );

    return rows[0] || null;
  }

  async upsert(input: UpsertTranscriptSnapshotInput): Promise<void> {
    await this.sql.execute(
      `
        INSERT INTO chat_transcript_snapshots (
          session_id,
          chat_type,
          private_user_id,
          group_id,
          summary_text,
          summary_format_version,
          summarized_through_conversation_id,
          summary_status,
          summary_job_id,
          last_compacted_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (session_id) DO UPDATE SET
          chat_type = EXCLUDED.chat_type,
          private_user_id = EXCLUDED.private_user_id,
          group_id = EXCLUDED.group_id,
          summary_text = EXCLUDED.summary_text,
          summary_format_version = EXCLUDED.summary_format_version,
          summarized_through_conversation_id = EXCLUDED.summarized_through_conversation_id,
          summary_status = EXCLUDED.summary_status,
          summary_job_id = EXCLUDED.summary_job_id,
          last_compacted_at = EXCLUDED.last_compacted_at,
          updated_at = CURRENT_TIMESTAMP
      `,
      [
        input.sessionId,
        input.chatType,
        input.privateUserId ?? null,
        input.groupId ?? null,
        input.summaryText,
        input.summaryFormatVersion,
        input.summarizedThroughConversationId,
        input.summaryStatus || 'ready',
        input.summaryJobId ?? null,
        normalizeTimestamp(input.lastCompactedAt)
      ]
    );
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

function normalizeTimestamp(value: string | Date | null | undefined) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
