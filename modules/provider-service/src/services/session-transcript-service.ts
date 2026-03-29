import { getPrismaClient } from '@qq-bot/persistence';
import { FinalizedInboundContext } from '../types';
import { databaseConfig } from '../config';
import { estimateTokensFromText } from './llm-provider/helpers';
import { computeContextThresholds, resolveModelContextPolicy } from './llm-provider/model-context-policy';
import { ConversationStoreService, StoredConversationTurn } from './conversation-store-service';
import { TranscriptSnapshotRecord, TranscriptSnapshotService } from './transcript-snapshot-service';

export type SessionTranscriptMessage = {
  role: 'user' | 'assistant';
  content: string;
  conversationId?: number;
};

export type SessionTranscriptState = {
  sessionId: string;
  chatType: 'direct' | 'group';
  userId: number;
  groupId?: number | null;
  summaryText: string | null;
  transcriptCompactOffset: number;
  snapshot: TranscriptSnapshotRecord | null;
  messages: SessionTranscriptMessage[];
  turns: StoredConversationTurn[];
  estimatedInputTokens: number;
  contextPolicy: ReturnType<typeof resolveModelContextPolicy>;
  contextThresholds: ReturnType<typeof computeContextThresholds> | null;
};

type SummaryRequestInput = {
  sessionId: string;
  chatType: 'direct' | 'group';
  userId: number;
  groupId?: number | null;
  turns: StoredConversationTurn[];
  snapshot: TranscriptSnapshotRecord | null;
};

export class SessionTranscriptService {
  private readonly conversationStore: ConversationStoreService;
  private readonly snapshotService: TranscriptSnapshotService;
  private readonly systemPrompt: string;
  private readonly summaryWebhookUrl?: string;
  private readonly prisma;

  constructor(params: {
    conversationStore: ConversationStoreService;
    snapshotService: TranscriptSnapshotService;
    systemPrompt: string;
    summaryWebhookUrl?: string;
  }) {
    this.conversationStore = params.conversationStore;
    this.snapshotService = params.snapshotService;
    this.systemPrompt = params.systemPrompt;
    this.summaryWebhookUrl = params.summaryWebhookUrl;
    this.prisma = getPrismaClient({
      databaseUrl: databaseConfig.url,
      host: databaseConfig.host,
      port: databaseConfig.port,
      user: databaseConfig.user,
      password: databaseConfig.password,
      database: databaseConfig.database
    });
  }

  async loadSessionState(
    inboundContext: FinalizedInboundContext,
    modelName: string
  ): Promise<SessionTranscriptState | null> {
    const identity = extractSessionIdentity(inboundContext);
    if (!identity) {
      return null;
    }

    const snapshot = await this.snapshotService.getBySessionId(identity.sessionId);
    const transcriptCompactOffset = await this.loadTranscriptCompactOffset(identity);
    const turns = await this.conversationStore.listRecentTurns({
      userId: identity.userId,
      groupId: identity.groupId,
      afterConversationId:
        snapshot?.summary_status === 'ready'
          ? snapshot.summarized_through_conversation_id
          : null
    });
    const messages = buildTranscriptMessages(turns);
    const summaryText = snapshot?.summary_status === 'ready' && snapshot.summary_text.trim()
      ? snapshot.summary_text.trim()
      : null;
    const contextPolicy = resolveModelContextPolicy(modelName);
    const contextThresholds = contextPolicy
      ? computeContextThresholds(contextPolicy)
      : null;
    const estimatedInputTokens =
      estimateTokensFromText(this.systemPrompt)
      + estimateTokensFromText(summaryText || '')
      + messages.reduce((sum, message) => sum + estimateTokensFromText(message.content), 0);

    return {
      sessionId: identity.sessionId,
      chatType: identity.chatType,
      userId: identity.userId,
      groupId: identity.groupId,
      summaryText,
      transcriptCompactOffset,
      snapshot,
      messages,
      turns,
      estimatedInputTokens,
      contextPolicy,
      contextThresholds
    };
  }

  buildPrompt(state: SessionTranscriptState, inboundContext: FinalizedInboundContext) {
    const systemPrompt = state.summaryText
      ? `${this.systemPrompt.trim()}\n\nConversation summary:\n${state.summaryText}`
      : this.systemPrompt.trim();

    return {
      systemPrompt,
      messages: [
        ...state.messages,
        {
          role: 'user' as const,
          content: formatInboundMessage({
            chatType: state.chatType,
            userId: state.userId,
            groupId: state.groupId,
            senderName: inboundContext.SenderName,
            message: inboundContext.BodyForAgent
          })
        }
      ]
    };
  }

  async maybeRequestSummary(state: SessionTranscriptState): Promise<void> {
    if (!state.contextThresholds || !state.contextPolicy) {
      return;
    }
    if (state.estimatedInputTokens < state.contextThresholds.softTriggerTokens) {
      return;
    }
    if (state.turns.length < 8) {
      return;
    }
    if (state.snapshot?.summary_status === 'pending') {
      return;
    }
    if (!this.summaryWebhookUrl) {
      return;
    }

    const turnsToSummarize = state.turns.slice(0, Math.max(0, state.turns.length - state.transcriptCompactOffset));
    if (turnsToSummarize.length === 0) {
      return;
    }

    const summaryJobId = `summary_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const lastConversationId = turnsToSummarize[turnsToSummarize.length - 1]?.id;
    if (!lastConversationId) {
      return;
    }

    await this.snapshotService.markPending({
      sessionId: state.sessionId,
      chatType: state.chatType,
      privateUserId: state.chatType === 'direct' ? state.userId : null,
      groupId: state.chatType === 'group' ? state.groupId ?? null : null,
      summaryJobId,
      summarizedThroughConversationId: lastConversationId
    });

    const payload: SummaryRequestInput = {
      sessionId: state.sessionId,
      chatType: state.chatType,
      userId: state.userId,
      groupId: state.groupId,
      turns: turnsToSummarize,
      snapshot: state.snapshot
    };

    void fetch(this.summaryWebhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        job_id: summaryJobId,
        payload
      })
    }).catch(async () => {
      await this.snapshotService.markFailed({
        sessionId: state.sessionId,
        summaryJobId,
        summaryFormatVersion: state.snapshot?.summary_format_version || 'webhook_failed'
      }).catch(() => undefined);
    });
  }

  private async loadTranscriptCompactOffset(identity: {
    chatType: 'direct' | 'group';
    userId: number;
    groupId?: number | null;
  }) {
    const defaultOffset = 6;

    if (identity.chatType === 'group') {
      if (!identity.groupId || !Number.isFinite(identity.groupId)) {
        return defaultOffset;
      }

      const row = await this.prisma.groupChatSetting.findUnique({
        where: { group_id: BigInt(identity.groupId) },
        select: { transcript_compact_offset: true }
      });
      return normalizeCompactOffset(row?.transcript_compact_offset, defaultOffset);
    }

    const row = await this.prisma.privateChatSetting.findUnique({
      where: { user_id: BigInt(identity.userId) },
      select: { transcript_compact_offset: true }
    });
    return normalizeCompactOffset(row?.transcript_compact_offset, defaultOffset);
  }
}

function normalizeCompactOffset(value: unknown, fallback: number) {
  const numericValue = typeof value === 'bigint' ? Number(value) : Number(value);
  if (!Number.isInteger(numericValue) || numericValue < 0) {
    return fallback;
  }
  return numericValue;
}

function extractSessionIdentity(inboundContext: FinalizedInboundContext) {
  const userId = Number(inboundContext.SenderId);
  if (!Number.isFinite(userId) || userId <= 0) {
    return null;
  }

  if (inboundContext.ChatType === 'group') {
    const groupId = Number(inboundContext.NativeChannelId);
    if (!Number.isFinite(groupId) || groupId <= 0) {
      return null;
    }

    return {
      sessionId: `group:${groupId}`,
      chatType: 'group' as const,
      userId,
      groupId
    };
  }

  return {
    sessionId: `private:${userId}`,
    chatType: 'direct' as const,
    userId,
    groupId: null
  };
}

function buildTranscriptMessages(turns: StoredConversationTurn[]): SessionTranscriptMessage[] {
  const messages: SessionTranscriptMessage[] = [];

  for (const turn of turns) {
    if (turn.user_message && turn.user_message.trim()) {
      messages.push({
        role: 'user',
        content: formatTurnUserMessage(turn),
        conversationId: turn.id
      });
    }

    if (turn.ai_response && turn.ai_response.trim()) {
      messages.push({
        role: 'assistant',
        content: turn.ai_response.trim(),
        conversationId: turn.id
      });
    }
  }

  return messages;
}

function formatTurnUserMessage(turn: StoredConversationTurn) {
  const senderName = resolveSenderName(turn.raw_request, turn.user_id);
  if (turn.group_id && Number.isFinite(turn.group_id)) {
    return `[Group ${turn.group_id}][User ${turn.user_id}][Name ${senderName}] ${turn.user_message}`;
  }
  return `[User ${turn.user_id}][Name ${senderName}] ${turn.user_message}`;
}

function formatInboundMessage(params: {
  chatType: 'direct' | 'group';
  userId: number;
  groupId?: number | null;
  senderName?: string;
  message: string;
}) {
  const senderName = (params.senderName || `user_${params.userId}`).trim();
  if (params.chatType === 'group') {
    return `[Group ${params.groupId}][User ${params.userId}][Name ${senderName}] ${params.message}`;
  }
  return `[User ${params.userId}][Name ${senderName}] ${params.message}`;
}

function resolveSenderName(rawRequest: Record<string, unknown>, userId: number) {
  const sender = rawRequest.sender && typeof rawRequest.sender === 'object'
    ? rawRequest.sender as Record<string, unknown>
    : {};
  const candidates = [
    sender.nickname,
    sender.card,
    rawRequest.sender_name,
    rawRequest.user_name
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return `user_${userId}`;
}
