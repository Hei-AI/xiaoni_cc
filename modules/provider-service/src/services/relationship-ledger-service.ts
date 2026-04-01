import { appendRelationshipLedgerEvent, type DatabaseUrlConfig } from '@qq-bot/persistence';
import { databaseConfig } from '../config';
import type { FinalizedInboundContext } from '../types';
import { logger } from '../utils/logger';

export type RecentLedgerInboundMessage = {
  messageSid: string;
  senderId: string;
  senderName?: string | null;
  bodyForAgent: string;
  rawBody?: string | null;
  wasMentioned: boolean;
  replyToSender?: string | null;
  replyToBody?: string | null;
  receivedAtMs: number;
};

type RelationshipLedgerServiceDeps = {
  recentMessageProvider?: (params: { sessionKey: string; currentMessageSid?: string }) => Promise<RecentLedgerInboundMessage[]>;
  appendEvent?: typeof appendRelationshipLedgerEvent;
};

function normalizeText(value: string | undefined | null) {
  return (value || '').trim().replace(/\s+/g, ' ');
}

function extractKeywordCandidates(text: string) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return [];
  }

  return Array.from(new Set(
    normalized
      .split(/[\s,，。！？!?:：;；、]+/)
      .map((item) => item.trim())
      .filter((item) => item.length >= 2)
  ));
}

function hasSharedKeywordOverlap(left: string, right: string) {
  const leftTokens = extractKeywordCandidates(left);
  const rightTokens = new Set(extractKeywordCandidates(right));
  return leftTokens.find((token) => rightTokens.has(token)) || null;
}

function sharedBigramOverlap(left: string, right: string) {
  const normalizedLeft = normalizeText(left);
  const normalizedRight = normalizeText(right);
  if (normalizedLeft.length < 2 || normalizedRight.length < 2) {
    return null;
  }

  const grams = new Set<string>();
  for (let index = 0; index < normalizedRight.length - 1; index += 1) {
    grams.add(normalizedRight.slice(index, index + 2));
  }

  for (let index = 0; index < normalizedLeft.length - 1; index += 1) {
    const gram = normalizedLeft.slice(index, index + 2);
    if (grams.has(gram) && !/\s/.test(gram)) {
      return gram;
    }
  }

  return null;
}

function containsQuotedCallback(current: string, previous: string) {
  const normalizedCurrent = normalizeText(current);
  const normalizedPrevious = normalizeText(previous);
  if (!normalizedCurrent || !normalizedPrevious) {
    return false;
  }

  if (normalizedPrevious.length < 4) {
    return false;
  }

  return normalizedCurrent.includes(normalizedPrevious.slice(0, Math.min(12, normalizedPrevious.length)));
}

export class RelationshipLedgerService {
  private readonly moduleLogger = logger.createModuleLogger('relationship-ledger-service');
  private readonly recentMessageProvider?: RelationshipLedgerServiceDeps['recentMessageProvider'];
  private readonly appendEvent: typeof appendRelationshipLedgerEvent;

  constructor(deps: RelationshipLedgerServiceDeps = {}) {
    this.recentMessageProvider = deps.recentMessageProvider;
    this.appendEvent = deps.appendEvent || ((input, config?: DatabaseUrlConfig) => appendRelationshipLedgerEvent(input, config || databaseConfig));
  }

  async recordFromInboundContext(inboundContext: FinalizedInboundContext): Promise<{ created: string[] }> {
    if (inboundContext.ChatType !== 'group' || !inboundContext.SessionKey || !inboundContext.NativeChannelId) {
      return { created: [] };
    }

    const groupId = Number(inboundContext.NativeChannelId);
    if (!Number.isFinite(groupId) || groupId <= 0) {
      return { created: [] };
    }

    const recentMessages = this.recentMessageProvider
      ? await this.recentMessageProvider({
          sessionKey: inboundContext.SessionKey,
          currentMessageSid: inboundContext.MessageSid
        })
      : [];

    const created: string[] = [];
    const currentBody = normalizeText(inboundContext.BodyForAgent || inboundContext.RawBody || inboundContext.Body);
    if (!currentBody) {
      return { created };
    }

    const latestOther = recentMessages.find((message) => message.senderId !== inboundContext.SenderId) || null;
    const latestSameSender = recentMessages.find((message) => message.senderId === inboundContext.SenderId) || null;

    if (latestOther) {
      const overlap = hasSharedKeywordOverlap(currentBody, latestOther.bodyForAgent)
        || sharedBigramOverlap(currentBody, latestOther.bodyForAgent);
      if (overlap) {
        await this.appendEvent({
          groupId,
          targetUserId: Number(inboundContext.SenderId),
          sessionKey: inboundContext.SessionKey,
          eventType: 'topic_reactivated',
          eventWeight: 0.8,
          confidence: 'medium',
          sourceMessageIds: [latestOther.messageSid, inboundContext.MessageSid || ''],
          sourceExcerpt: `旧话题关键词延续: ${overlap}`,
          metadata: {
            keyword: overlap,
            previousSenderId: latestOther.senderId,
            previousSenderName: latestOther.senderName || null
          }
        });
        created.push('topic_reactivated');
      }
    }

    if (latestSameSender) {
      const previousText = normalizeText(latestSameSender.bodyForAgent);
      const overlap = hasSharedKeywordOverlap(currentBody, previousText)
        || sharedBigramOverlap(currentBody, previousText);
      if (overlap || containsQuotedCallback(currentBody, previousText)) {
        await this.appendEvent({
          groupId,
          targetUserId: Number(inboundContext.SenderId),
          sessionKey: inboundContext.SessionKey,
          eventType: 'shared_joke_formed',
          eventWeight: 0.9,
          confidence: overlap ? 'medium' : 'low',
          sourceMessageIds: [latestSameSender.messageSid, inboundContext.MessageSid || ''],
          sourceExcerpt: overlap
            ? `重复出现的共享关键词: ${overlap}`
            : '连续复用前文表达',
          metadata: {
            keyword: overlap,
            previousMessageSid: latestSameSender.messageSid
          }
        });
        created.push('shared_joke_formed');
      }
    }

    if (inboundContext.ReplyToSenderId || inboundContext.ReplyToBody) {
      await this.appendEvent({
        groupId,
        targetUserId: Number(inboundContext.SenderId),
        sessionKey: inboundContext.SessionKey,
        eventType: 'reply_chain_success',
        eventWeight: 1,
        confidence: 'high',
        sourceMessageIds: [inboundContext.ReplyToId || '', inboundContext.MessageSid || ''].filter(Boolean),
        sourceExcerpt: normalizeText(inboundContext.ReplyToBody || currentBody).slice(0, 120),
        metadata: {
          replyToSenderId: inboundContext.ReplyToSenderId || null,
          replyToSenderName: inboundContext.ReplyToSenderName || null,
          replyToIsQuote: inboundContext.ReplyToIsQuote === true
        }
      });
      created.push('reply_chain_success');
    }

    if (created.length > 0) {
      this.moduleLogger.info('Recorded relationship ledger events', {
        sessionKey: inboundContext.SessionKey,
        messageSid: inboundContext.MessageSid,
        senderId: inboundContext.SenderId,
        created
      });
    }

    return { created };
  }
}

export default RelationshipLedgerService;
