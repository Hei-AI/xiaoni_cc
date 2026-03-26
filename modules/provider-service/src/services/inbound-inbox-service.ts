import { createSqlAdapter, type SqlAdapter } from '@qq-bot/persistence';
import { v4 as uuidv4 } from 'uuid';
import { databaseConfig } from '../config';
import {
  FinalizedInboundContext,
  InboxConversationSummary,
  InboxMessageRecord,
  InboxSource,
  InboxStats,
} from '../types';
import { logger } from '../utils/logger';

type IngestIncomingMessageInput = {
  inboundContext: FinalizedInboundContext;
  rawPayload: Record<string, unknown>;
  traceId?: string;
  source?: InboxSource;
};

type ClaimMessagesInput = {
  sessionKey?: string;
  limit?: number;
};

type ListConversationMessagesInput = {
  sessionKey: string;
  includeRead?: boolean;
  limit?: number;
};

type InboxRow = {
  id: number;
  trace_id: string;
  source: InboxSource;
  message_sid: string;
  dedupe_key: string;
  chat_type: 'direct' | 'group';
  session_key: string;
  peer_id: string;
  peer_name: string | null;
  sender_id: string;
  sender_name: string | null;
  account_id: string;
  is_read: number;
  read_at: Date | string | null;
  received_at: Date | string;
  message_timestamp: Date | string | null;
  body_for_agent: string;
  raw_body: string | null;
  command_body: string | null;
  was_mentioned: number;
  reply_to_id: string | null;
  reply_to_body: string | null;
  reply_to_sender: string | null;
  raw_payload: string | Record<string, unknown>;
  inbound_context: string | Record<string, unknown>;
};

type ConversationSummaryRow = {
  session_key: string;
  chat_type: 'direct' | 'group';
  peer_id: string;
  peer_name: string | null;
  account_id: string;
  unread_count: number;
  total_messages: number;
  last_received_at: Date | string | null;
  latest_body_for_agent: string | null;
  latest_sender_id: string | null;
  latest_sender_name: string | null;
};

type StatsRow = {
  total_conversations: number | null;
  total_messages: number | null;
  unread_conversations: number | null;
  unread_messages: number | null;
  last_received_at: Date | string | null;
};

const TABLE_NAME = 'agent_inbound_messages';
const DEFAULT_CLAIM_LIMIT = 20;
const DEFAULT_MESSAGE_LIMIT = 100;

function normalizeIso(value: Date | string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function parseJsonRecord(value: string | Record<string, unknown>): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }

  if (typeof value !== 'string') {
    return {};
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function toChatType(value: string | undefined): 'direct' | 'group' {
  return value === 'group' ? 'group' : 'direct';
}

function buildPeerId(context: FinalizedInboundContext) {
  if (toChatType(context.ChatType) === 'group') {
    return context.NativeChannelId || context.To?.replace(/^group:/, '') || 'unknown-group';
  }

  return context.NativeChannelId
    || context.To?.replace(/^user:/, '')
    || context.SenderId
    || 'unknown-user';
}

function buildPeerName(context: FinalizedInboundContext) {
  if (toChatType(context.ChatType) === 'group') {
    return context.GroupSubject || context.ConversationLabel || undefined;
  }

  return context.ConversationLabel || context.SenderName || undefined;
}

function toReceivedAt(context: FinalizedInboundContext) {
  return new Date();
}

function toMessageTimestamp(context: FinalizedInboundContext) {
  if (!context.Timestamp || !Number.isFinite(context.Timestamp)) {
    return null;
  }

  return new Date(context.Timestamp);
}

function finalizeSimulationContext(
  inboundContext: Partial<FinalizedInboundContext>,
  {
    fallbackBotAccountId,
    traceId,
  }: {
    fallbackBotAccountId: string;
    traceId: string;
  }
): FinalizedInboundContext {
  const chatType = toChatType(inboundContext.ChatType);
  const accountId = inboundContext.AccountId || fallbackBotAccountId;
  const senderId = inboundContext.SenderId || inboundContext.NativeChannelId || 'unknown-user';
  const nativeChannelId = inboundContext.NativeChannelId || (chatType === 'group' ? inboundContext.To?.replace(/^group:/, '') : senderId);
  const sessionKey = inboundContext.SessionKey
    || (chatType === 'group'
      ? `qq:group:${nativeChannelId || 'unknown-group'}`
      : `qq:direct:${accountId}:${nativeChannelId || senderId}`);
  const to = inboundContext.To || (chatType === 'group' ? `group:${nativeChannelId}` : `user:${nativeChannelId}`);
  const from = inboundContext.From || (chatType === 'group' ? `qq:group:${nativeChannelId}` : `qq:${senderId}`);
  const rawBody = inboundContext.RawBody ?? inboundContext.BodyForAgent ?? inboundContext.Body ?? '';
  const commandBody = inboundContext.CommandBody ?? inboundContext.BodyForCommands ?? rawBody;
  const bodyForAgent = inboundContext.BodyForAgent ?? inboundContext.Body ?? rawBody;
  const body = inboundContext.Body ?? bodyForAgent ?? rawBody;

  return {
    ...inboundContext,
    Body: body,
    BodyForAgent: bodyForAgent,
    RawBody: rawBody,
    CommandBody: commandBody,
    BodyForCommands: inboundContext.BodyForCommands ?? commandBody,
    AccountId: accountId,
    ChatType: chatType,
    SenderId: senderId,
    SessionKey: sessionKey,
    To: to,
    From: from,
    NativeChannelId: nativeChannelId,
    MessageSid: inboundContext.MessageSid || traceId,
    Timestamp: inboundContext.Timestamp && Number.isFinite(inboundContext.Timestamp) ? inboundContext.Timestamp : Date.now(),
    Provider: inboundContext.Provider || 'qq',
    Surface: inboundContext.Surface || 'simulator',
    OriginatingChannel: inboundContext.OriginatingChannel || 'qq',
    OriginatingTo: inboundContext.OriginatingTo || to,
    CommandAuthorized: inboundContext.CommandAuthorized === true,
  };
}

export class InboundInboxService {
  private readonly moduleLogger = logger.createModuleLogger('inbound-inbox-service');
  private readonly db: SqlAdapter;
  private readonly unreadBuffer = new Map<string, InboxMessageRecord[]>();

  constructor() {
    this.db = createSqlAdapter({
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
    await this.ensureTable();
    await this.ensureIndexes();
    await this.reloadUnreadBuffer();
  }

  async close() {
    await this.db.close();
  }

  createTraceId(source: InboxSource) {
    const tracePrefix = source === 'napcat' ? 'evt' : 'sim';
    return `${tracePrefix}_${Date.now()}_${uuidv4().slice(0, 8)}`;
  }

  finalizeSimulationContext(input: Partial<FinalizedInboundContext>, fallbackBotAccountId: string, traceId?: string) {
    return finalizeSimulationContext(input, {
      fallbackBotAccountId,
      traceId: traceId || this.createTraceId('simulator')
    });
  }

  async ingestIncomingMessage(input: IngestIncomingMessageInput) {
    const traceId = input.traceId || this.createTraceId(input.source || 'napcat');
    const source = input.source || 'napcat';
    const message = await this.persistMessage({
      inboundContext: input.inboundContext,
      rawPayload: input.rawPayload,
      traceId,
      source
    });

    this.addToUnreadBuffer(message);

    return {
      traceId: message.traceId,
      sessionKey: message.sessionKey,
      messageId: message.id,
      messageSid: message.messageSid,
      event: message
    };
  }

  async simulateMessage(input: { inboundContext: Partial<FinalizedInboundContext>; rawPayload?: Record<string, unknown>; fallbackBotAccountId: string }) {
    const traceId = this.createTraceId('simulator');
    const inboundContext = this.finalizeSimulationContext(input.inboundContext, input.fallbackBotAccountId, traceId);
    return this.ingestIncomingMessage({
      inboundContext,
      rawPayload: input.rawPayload || { simulated: true, inboundContext },
      traceId,
      source: 'simulator'
    });
  }

  async getStats(): Promise<InboxStats> {
    const rows = await this.db.query<StatsRow>(
      `
        SELECT
          COUNT(DISTINCT session_key) AS total_conversations,
          COUNT(*) AS total_messages,
          COUNT(DISTINCT CASE WHEN is_read = 0 THEN session_key END) AS unread_conversations,
          SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) AS unread_messages,
          MAX(received_at) AS last_received_at
        FROM ${TABLE_NAME}
      `
    );

    const row = rows[0];
    return {
      totalConversations: Number(row?.total_conversations || 0),
      totalMessages: Number(row?.total_messages || 0),
      unreadConversations: Number(row?.unread_conversations || 0),
      unreadMessages: Number(row?.unread_messages || 0),
      lastReceivedAt: normalizeIso(row?.last_received_at),
      runtimeUnreadMessages: Array.from(this.unreadBuffer.values()).reduce((sum, messages) => sum + messages.length, 0),
    };
  }

  async listConversations(limit = 100, offset = 0): Promise<InboxConversationSummary[]> {
    const rows = await this.db.query<ConversationSummaryRow>(
      `
        SELECT
          m.session_key,
          MIN(m.chat_type) AS chat_type,
          MIN(m.peer_id) AS peer_id,
          MIN(m.peer_name) AS peer_name,
          MIN(m.account_id) AS account_id,
          SUM(CASE WHEN m.is_read = 0 THEN 1 ELSE 0 END) AS unread_count,
          COUNT(*) AS total_messages,
          MAX(m.received_at) AS last_received_at,
          (
            SELECT x.body_for_agent
            FROM ${TABLE_NAME} x
            WHERE x.session_key = m.session_key
            ORDER BY x.received_at DESC, x.id DESC
            LIMIT 1
          ) AS latest_body_for_agent,
          (
            SELECT x.sender_id
            FROM ${TABLE_NAME} x
            WHERE x.session_key = m.session_key
            ORDER BY x.received_at DESC, x.id DESC
            LIMIT 1
          ) AS latest_sender_id,
          (
            SELECT x.sender_name
            FROM ${TABLE_NAME} x
            WHERE x.session_key = m.session_key
            ORDER BY x.received_at DESC, x.id DESC
            LIMIT 1
          ) AS latest_sender_name
        FROM ${TABLE_NAME} m
        GROUP BY m.session_key
        ORDER BY last_received_at DESC
        LIMIT ? OFFSET ?
      `,
      [Math.max(limit, 1), Math.max(offset, 0)]
    );

    return rows.map((row) => ({
      sessionKey: row.session_key,
      chatType: row.chat_type,
      peerId: row.peer_id,
      peerName: row.peer_name || undefined,
      accountId: row.account_id,
      unreadCount: Number(row.unread_count || 0),
      totalMessages: Number(row.total_messages || 0),
      lastReceivedAt: normalizeIso(row.last_received_at),
      latestBodyForAgent: row.latest_body_for_agent || undefined,
      latestSenderId: row.latest_sender_id || undefined,
      latestSenderName: row.latest_sender_name || undefined
    }));
  }

  async listConversationMessages(input: ListConversationMessagesInput): Promise<InboxMessageRecord[]> {
    const limit = Math.max(input.limit || DEFAULT_MESSAGE_LIMIT, 1);
    const params: Array<string | number> = [input.sessionKey];
    const filters = ['session_key = ?'];

    if (!input.includeRead) {
      filters.push('is_read = 0');
    }

    params.push(limit);

    const rows = await this.db.query<InboxRow>(
      `
        SELECT *
        FROM ${TABLE_NAME}
        WHERE ${filters.join(' AND ')}
        ORDER BY received_at DESC, id DESC
        LIMIT ?
      `,
      params
    );

    return rows.map((row) => this.mapRow(row));
  }

  async claimMessages(input: ClaimMessagesInput): Promise<InboxMessageRecord[]> {
    const limit = Math.max(input.limit || DEFAULT_CLAIM_LIMIT, 1);
    const rows = await this.db.withTransaction(async (tx) => {
      const filters = ['is_read = 0'];
      const params: Array<string | number> = [];

      if (input.sessionKey) {
        filters.push('session_key = ?');
        params.push(input.sessionKey);
      }

      params.push(limit);

      const idRows = await tx.query<{ id: number }>(
        `
          SELECT id
          FROM ${TABLE_NAME}
          WHERE ${filters.join(' AND ')}
          ORDER BY received_at ASC, id ASC
          LIMIT ?
          FOR UPDATE
        `,
        params
      );

      const ids = idRows.map((row) => Number(row.id));
      if (ids.length === 0) {
        return [];
      }

      const placeholders = ids.map(() => '?').join(', ');

      await tx.execute(
        `
          UPDATE ${TABLE_NAME}
          SET is_read = 1, read_at = NOW()
          WHERE id IN (${placeholders})
        `,
        ids
      );

      return await tx.query<InboxRow>(
        `
          SELECT *
          FROM ${TABLE_NAME}
          WHERE id IN (${placeholders})
          ORDER BY received_at ASC, id ASC
        `,
        ids
      );
    });

    const ids = rows.map((row) => Number(row.id));
    this.removeFromUnreadBuffer(ids);
    return rows.map((row) => this.mapRow(row));
  }

  private async persistMessage(params: {
    inboundContext: FinalizedInboundContext;
    rawPayload: Record<string, unknown>;
    traceId: string;
    source: InboxSource;
  }): Promise<InboxMessageRecord> {
    const inboundContext = params.inboundContext;
    const messageSid = inboundContext.MessageSid || params.traceId;
    const sessionKey = inboundContext.SessionKey || params.traceId;
    const chatType = toChatType(inboundContext.ChatType);
    const peerId = buildPeerId(inboundContext);
    const peerName = buildPeerName(inboundContext);
    const senderId = inboundContext.SenderId || peerId;
    const senderName = inboundContext.SenderName || undefined;
    const accountId = inboundContext.AccountId || 'unknown-bot';
    const dedupeKey = `${params.source}:${messageSid}`;
    const receivedAt = toReceivedAt(inboundContext);
    const messageTimestamp = toMessageTimestamp(inboundContext);

    await this.db.execute(
      `
        INSERT INTO ${TABLE_NAME} (
          trace_id,
          source,
          message_sid,
          dedupe_key,
          chat_type,
          session_key,
          peer_id,
          peer_name,
          sender_id,
          sender_name,
          account_id,
          is_read,
          read_at,
          received_at,
          message_timestamp,
          body_for_agent,
          raw_body,
          command_body,
          was_mentioned,
          reply_to_id,
          reply_to_body,
          reply_to_sender,
          raw_payload,
          inbound_context
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS jsonb), CAST(? AS jsonb))
        ON CONFLICT (dedupe_key) DO UPDATE SET
          trace_id = EXCLUDED.trace_id,
          raw_payload = EXCLUDED.raw_payload,
          inbound_context = EXCLUDED.inbound_context,
          updated_at = CURRENT_TIMESTAMP
      `,
      [
        params.traceId,
        params.source,
        messageSid,
        dedupeKey,
        chatType,
        sessionKey,
        peerId,
        peerName || null,
        senderId,
        senderName || null,
        accountId,
        receivedAt,
        messageTimestamp,
        inboundContext.BodyForAgent,
        inboundContext.RawBody || inboundContext.BodyForAgent,
        inboundContext.CommandBody || inboundContext.BodyForCommands || inboundContext.BodyForAgent,
        inboundContext.WasMentioned === true ? 1 : 0,
        inboundContext.ReplyToId || null,
        inboundContext.ReplyToBody || null,
        inboundContext.ReplyToSender || null,
        JSON.stringify(params.rawPayload || {}),
        JSON.stringify(inboundContext)
      ]
    );

    const rows = await this.db.query<InboxRow>(
      `
        SELECT *
        FROM ${TABLE_NAME}
        WHERE dedupe_key = ?
        LIMIT 1
      `,
      [dedupeKey]
    );

    if (!rows[0]) {
      throw new Error('Failed to read persisted inbound message');
    }

    return this.mapRow(rows[0]);
  }

  private mapRow(row: InboxRow): InboxMessageRecord {
    return {
      id: row.id,
      traceId: row.trace_id,
      source: row.source,
      messageSid: row.message_sid,
      dedupeKey: row.dedupe_key,
      chatType: row.chat_type,
      sessionKey: row.session_key,
      peerId: row.peer_id,
      peerName: row.peer_name || undefined,
      senderId: row.sender_id,
      senderName: row.sender_name || undefined,
      accountId: row.account_id,
      isRead: Boolean(row.is_read),
      readAt: normalizeIso(row.read_at),
      receivedAt: normalizeIso(row.received_at) || new Date().toISOString(),
      messageTimestamp: normalizeIso(row.message_timestamp),
      bodyForAgent: row.body_for_agent,
      rawBody: row.raw_body || row.body_for_agent,
      commandBody: row.command_body || row.body_for_agent,
      wasMentioned: Boolean(row.was_mentioned),
      replyToId: row.reply_to_id || undefined,
      replyToBody: row.reply_to_body || undefined,
      replyToSender: row.reply_to_sender || undefined,
      rawPayload: parseJsonRecord(row.raw_payload),
      inboundContext: parseJsonRecord(row.inbound_context) as FinalizedInboundContext,
    };
  }

  private addToUnreadBuffer(message: InboxMessageRecord) {
    if (message.isRead) {
      return;
    }

    const existing = this.unreadBuffer.get(message.sessionKey) || [];
    if (!existing.some((entry) => entry.id === message.id)) {
      existing.unshift(message);
      existing.sort((left, right) => right.receivedAt.localeCompare(left.receivedAt));
      this.unreadBuffer.set(message.sessionKey, existing);
    }
  }

  private removeFromUnreadBuffer(ids: number[]) {
    const idSet = new Set(ids);

    for (const [sessionKey, messages] of this.unreadBuffer.entries()) {
      const remaining = messages.filter((message) => !idSet.has(message.id));
      if (remaining.length > 0) {
        this.unreadBuffer.set(sessionKey, remaining);
      } else {
        this.unreadBuffer.delete(sessionKey);
      }
    }
  }

  private async reloadUnreadBuffer() {
    const rows = await this.db.query<InboxRow>(
      `
        SELECT *
        FROM ${TABLE_NAME}
        WHERE is_read = 0
        ORDER BY received_at DESC, id DESC
      `
    );

    this.unreadBuffer.clear();
    for (const row of rows) {
      this.addToUnreadBuffer(this.mapRow(row));
    }
  }

  private async ensureTable() {
    await this.db.execute(
      `
        CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
          id BIGSERIAL PRIMARY KEY,
          trace_id VARCHAR(128) NOT NULL,
          source VARCHAR(32) NOT NULL,
          message_sid VARCHAR(191) NOT NULL,
          dedupe_key VARCHAR(255) NOT NULL,
          chat_type VARCHAR(16) NOT NULL,
          session_key VARCHAR(191) NOT NULL,
          peer_id VARCHAR(191) NOT NULL,
          peer_name VARCHAR(255) NULL,
          sender_id VARCHAR(191) NOT NULL,
          sender_name VARCHAR(255) NULL,
          account_id VARCHAR(191) NOT NULL,
          is_read INTEGER NOT NULL DEFAULT 0,
          read_at TIMESTAMP(3) NULL,
          received_at TIMESTAMP(3) NOT NULL,
          message_timestamp TIMESTAMP(3) NULL,
          body_for_agent TEXT NOT NULL,
          raw_body TEXT NULL,
          command_body TEXT NULL,
          was_mentioned INTEGER NOT NULL DEFAULT 0,
          reply_to_id VARCHAR(191) NULL,
          reply_to_body TEXT NULL,
          reply_to_sender VARCHAR(255) NULL,
          raw_payload JSONB NOT NULL,
          inbound_context JSONB NOT NULL,
          created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `
    );
  }

  private async ensureIndexes() {
    const rows = await this.db.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND tablename = ?`,
      [TABLE_NAME]
    );

    const existing = new Set(rows.map((row) => row.indexname));
    const statements: Array<{ name: string; sql: string }> = [
      {
        name: 'uq_agent_inbound_messages_dedupe',
        sql: `CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_inbound_messages_dedupe ON ${TABLE_NAME} (dedupe_key)`
      },
      {
        name: 'idx_agent_inbound_messages_session_received',
        sql: `CREATE INDEX IF NOT EXISTS idx_agent_inbound_messages_session_received ON ${TABLE_NAME} (session_key, received_at, id)`
      },
      {
        name: 'idx_agent_inbound_messages_unread_session',
        sql: `CREATE INDEX IF NOT EXISTS idx_agent_inbound_messages_unread_session ON ${TABLE_NAME} (is_read, session_key, received_at, id)`
      },
      {
        name: 'idx_agent_inbound_messages_message_sid',
        sql: `CREATE INDEX IF NOT EXISTS idx_agent_inbound_messages_message_sid ON ${TABLE_NAME} (message_sid)`
      },
      {
        name: 'idx_agent_inbound_messages_peer',
        sql: `CREATE INDEX IF NOT EXISTS idx_agent_inbound_messages_peer ON ${TABLE_NAME} (chat_type, peer_id, received_at, id)`
      }
    ];

    for (const statement of statements) {
      if (existing.has(statement.name)) {
        continue;
      }
      await this.db.execute(statement.sql);
    }
  }
}

export default InboundInboxService;
