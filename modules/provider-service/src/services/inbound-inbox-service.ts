import {
  createInboundInboxPersistence,
  createSqlAdapter,
  type InboundInboxPersistenceApi,
  type SqlAdapter,
} from '@qq-bot/persistence';
import { v4 as uuidv4 } from 'uuid';
import { databaseConfig } from '../config';
import { fireInboundRecall } from './xiaoni-recall-hook';
import {
  FinalizedInboundContext,
  InboxConversationSummary,
  InboxMessageRecord,
  InboxSource,
  InboxStats,
} from '../types';

type IngestIncomingMessageInput = {
  inboundContext: FinalizedInboundContext;
  rawPayload: Record<string, unknown>;
  traceId?: string;
  source?: InboxSource;
};

type ClaimMessagesInput = {
  sessionKey?: string;
  limit?: number;
  order?: 'oldest' | 'latest';
  markRead?: boolean;
  includeMessageIds?: number[];
};

type ListConversationMessagesInput = {
  sessionKey: string;
  includeRead?: boolean;
  limit?: number;
};

function toChatType(value: string | undefined): 'direct' | 'group' {
  return value === 'group' ? 'group' : 'direct';
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
    await this.getPersistence().ensureInboundInboxSchema();
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

    // 被动浮现:入站落地 → fire-and-forget ingest + shadow 召回(不投递,零缓存,失败不影响主链)。
    fireInboundRecall(message);

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
    const stats = await this.getPersistence().getInboundInboxStats();
    return {
      ...stats,
      runtimeUnreadMessages: Array.from(this.unreadBuffer.values()).reduce((sum, messages) => sum + messages.length, 0),
    };
  }

  async listConversations(limit = 100, offset = 0): Promise<InboxConversationSummary[]> {
    return this.getPersistence().listInboundInboxConversations({ limit, offset }) as Promise<InboxConversationSummary[]>;
  }

  async listConversationMessages(input: ListConversationMessagesInput): Promise<InboxMessageRecord[]> {
    return this.getPersistence().listInboundConversationMessages(input) as Promise<InboxMessageRecord[]>;
  }

  async claimMessages(input: ClaimMessagesInput): Promise<InboxMessageRecord[]> {
    const shouldMarkRead = input.markRead !== false;
    const messages = await this.getPersistence().claimInboundMessages(input) as InboxMessageRecord[];
    if (shouldMarkRead) {
      this.removeFromUnreadBuffer(messages.map((message) => message.id));
    }
    return messages;
  }

  async markMessagesRead(ids: number[]) {
    const uniqueIds = Array.from(new Set(ids.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)));
    if (uniqueIds.length === 0) {
      return;
    }

    await this.getPersistence().markInboundMessagesRead({ ids: uniqueIds });
    this.removeFromUnreadBuffer(uniqueIds);
  }

  private async persistMessage(params: {
    inboundContext: FinalizedInboundContext;
    rawPayload: Record<string, unknown>;
    traceId: string;
    source: InboxSource;
  }): Promise<InboxMessageRecord> {
    return this.getPersistence().persistInboundMessage(params) as Promise<InboxMessageRecord>;
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
    const messages = await this.getPersistence().listUnreadInboundMessages() as InboxMessageRecord[];
    this.unreadBuffer.clear();
    for (const message of messages) {
      this.addToUnreadBuffer(message);
    }
  }

  private getPersistence(): InboundInboxPersistenceApi {
    return createInboundInboxPersistence({ sqlAdapter: this.db });
  }
}

export default InboundInboxService;
