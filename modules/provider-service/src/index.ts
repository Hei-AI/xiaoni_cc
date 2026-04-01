import express from 'express';
import { ensureRelationshipMemorySchema } from '@qq-bot/persistence';
import { aiConfig, relationshipMemoryConfig, serverConfig } from './config';
import EmbeddingService from './services/embedding-service';
import { executeAgentRequest, executeDebugRequest } from './services/provider-debug-service';
import { NapcatClient } from './services/napcat-client';
import { ChatPolicyService } from './services/chat-policy-service';
import {
  buildNapcatInboundContext,
  OneBotMessageEvent,
  RecentMessageCache,
  rememberInboundContext,
} from './services/agent-im-input-adapter';
import { InboundInboxService } from './services/inbound-inbox-service';
import { ConversationStoreService } from './services/conversation-store-service';
import { SessionTranscriptService } from './services/session-transcript-service';
import { TranscriptSnapshotService } from './services/transcript-snapshot-service';
import RelationshipLedgerService from './services/relationship-ledger-service';
import RelationshipMemoryService from './services/relationship-memory-service';
import RelationshipMemoryExecutorService from './services/relationship-memory-executor-service';
import { GroupParticipationService } from './services/group-participation-service';
import {
  buildSimpleQueueSimulationContext,
  type ProviderMessageType,
  type SimpleQueueSimulationPayload,
} from './services/simple-queue-simulation-context';
import { FinalizedInboundContext } from './types';
import { runtimeStoreService } from './services/runtime-store-service';
import { logger } from './utils/logger';

const app = express();
const moduleLogger = logger.createModuleLogger('provider-service');
const embeddingService = new EmbeddingService(aiConfig);
const napcatClient = new NapcatClient();
const inboxService = new InboundInboxService();
const chatPolicyService = new ChatPolicyService();
const recentMessageCache = new RecentMessageCache();
const groupParticipationService = new GroupParticipationService({ embeddingService });
const conversationStoreService = new ConversationStoreService();
const transcriptSnapshotService = new TranscriptSnapshotService();
const relationshipLedgerService = new RelationshipLedgerService({
  recentMessageProvider: async ({ sessionKey, currentMessageSid }) => {
    const messages = await inboxService.listConversationMessages({
      sessionKey,
      includeRead: true,
      limit: 8
    });

    return messages
      .filter((message) => !currentMessageSid || message.messageSid !== currentMessageSid)
      .map((message) => ({
        messageId: message.id,
        messageSid: message.messageSid,
        senderId: message.senderId,
        senderName: message.senderName || null,
        bodyForAgent: message.bodyForAgent,
        rawBody: message.rawBody || null,
        wasMentioned: message.wasMentioned,
        replyToSender: message.replyToSender || null,
        replyToBody: message.replyToBody || null,
        receivedAtMs: new Date(message.receivedAt).getTime()
      }));
  }
});
const relationshipMemoryService = new RelationshipMemoryService({
  enabled: relationshipMemoryConfig.enabled,
  webhookUrl: relationshipMemoryConfig.webhookUrl,
  minNewTurns: relationshipMemoryConfig.minNewTurns,
  minNewLedgerEvents: relationshipMemoryConfig.minNewLedgerEvents
});
const relationshipMemoryExecutorService = new RelationshipMemoryExecutorService();
const transcriptService = new SessionTranscriptService({
  conversationStore: conversationStoreService,
  snapshotService: transcriptSnapshotService,
  systemPrompt: process.env.CHATBOT_SYSTEM_PROMPT || [
    'You are a QQ chat bot.',
    'Reply naturally, directly, and briefly in Chinese by default.',
    'In group chats, keep responses short unless the user explicitly asks for detail.'
  ].join('\n'),
  summaryWebhookUrl: process.env.TRANSCRIPT_SUMMARY_WEBHOOK_URL || undefined
});

function scheduleCompactionSideEffects(inboundContext: FinalizedInboundContext) {
  void (async () => {
    try {
      const state = await transcriptService.loadSessionState(inboundContext, aiConfig.model_name);
      if (!state) {
        return;
      }
      await transcriptService.maybeRequestSummary(state);
      await relationshipMemoryService.maybeRequestRefresh(state);
    } catch (error) {
      moduleLogger.warn('Failed to schedule transcript or relationship compaction side effects', {
        error: error instanceof Error ? error.message : String(error),
        sessionKey: inboundContext.SessionKey
      });
    }
  })();
}

function normalizeOutboundMessages(body: Record<string, unknown>) {
  const messages: string[] = [];

  if (typeof body.message === 'string' && body.message.trim()) {
    messages.push(body.message.trim());
  }

  if (Array.isArray(body.messages)) {
    for (const item of body.messages) {
      if (typeof item !== 'string' || !item.trim()) {
        throw new Error('messages must be an array of non-empty strings');
      }
      messages.push(item.trim());
    }
  }

  return messages;
}

function normalizeOptionalNumericIdList(value: unknown, fieldName: string) {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array of numeric ids`);
  }

  return Array.from(new Set(value.map((item) => {
    const numeric = Number(item);
    if (!Number.isFinite(numeric)) {
      throw new Error(`${fieldName} must be an array of numeric ids`);
    }
    return Math.trunc(numeric);
  })));
}

function markIncomingActivityAsync(params: { messageType: ProviderMessageType; userId: number; groupId?: number }) {
  void chatPolicyService.markIncomingActivity(params).catch((error) => {
    moduleLogger.warn('Failed to update chat activity after accepting message', {
      error: error instanceof Error ? error.message : String(error),
      ...params
    });
  });
}

function recordRelationshipLedgerAsync(inboundContext: FinalizedInboundContext, currentMessageId?: number | null) {
  void relationshipLedgerService.recordFromInboundContext(inboundContext, {
    currentMessageId
  }).catch((error) => {
    moduleLogger.warn('Failed to record relationship ledger events', {
      error: error instanceof Error ? error.message : String(error),
      sessionKey: inboundContext.SessionKey,
      messageSid: inboundContext.MessageSid
    });
  });
}

function parseBoolean(value: unknown) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    return value.toLowerCase() === 'true';
  }
  return false;
}

function toNumericId(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function inferPolicyTargets(inboundContext: FinalizedInboundContext) {
  const messageType: ProviderMessageType = inboundContext.ChatType === 'group' ? 'group' : 'private';
  const userId = toNumericId(inboundContext.SenderId);
  const groupId = messageType === 'group' ? toNumericId(inboundContext.NativeChannelId) : null;

  if (userId === null) {
    return null;
  }

  if (messageType === 'group' && groupId === null) {
    return null;
  }

  return {
    messageType,
    userId,
    groupId: groupId === null ? undefined : groupId
  };
}

async function simulateSimpleQueueMessage(messageType: ProviderMessageType, payload: SimpleQueueSimulationPayload) {
  const inboundContext = buildSimpleQueueSimulationContext(messageType, payload);
  const result = await inboxService.simulateMessage({
    inboundContext,
    fallbackBotAccountId: String(aiConfig.bot_qq_number),
    rawPayload: {
      simulated: true,
      source: 'simple-queue',
      messageType,
      priority: payload.priority || null,
      payload
    }
  });

  markIncomingActivityAsync({
    messageType,
    userId: Number(payload.user_id),
    groupId: messageType === 'group' ? Number(payload.group_id) : undefined
  });

  const finalizedContext = inboxService.finalizeSimulationContext(
    inboundContext,
    String(aiConfig.bot_qq_number),
    result.traceId
  );
  recordRelationshipLedgerAsync(finalizedContext, result.event.id);
  const autoReply = await processAutoReply({
    inboxEvent: result.event,
    inboundContext: finalizedContext,
    rawPayload: {
      simulated: true,
      source: 'simple-queue',
      messageType,
      payload
    },
    traceId: result.traceId,
    source: 'simulator'
  });

  return {
    ...result,
    autoReply
  };
}

async function handleOneBotMessageEvent(message: OneBotMessageEvent) {
  const messageType = message.message_type === 'group' ? 'group' : 'private';
  const userId = Number(message.user_id);
  const groupId = message.group_id !== undefined ? Number(message.group_id) : undefined;

  if (!Number.isFinite(userId)) {
    return { accepted: false, reason: 'invalid_message' as const };
  }

  if (messageType === 'group' && !Number.isFinite(groupId)) {
    return { accepted: false, reason: 'invalid_group_message' as const };
  }

  if (userId === aiConfig.bot_qq_number) {
    return { accepted: false, reason: 'self_message' as const };
  }

  const policy = await chatPolicyService.checkIncomingPolicy({
    messageType,
    userId,
    groupId
  });

  if (!policy.allowed) {
    return {
      accepted: false,
      reason: policy.reason,
      policy
    };
  }

  const traceId = inboxService.createTraceId('napcat');
  const inboundContext = buildNapcatInboundContext({
    event: message,
    fallbackBotAccountId: String(aiConfig.bot_qq_number),
    replyCache: recentMessageCache,
  });

  if (!inboundContext) {
    return { accepted: false, reason: 'invalid_message' as const };
  }

  const result = await inboxService.ingestIncomingMessage({
    inboundContext,
    rawPayload: message as Record<string, unknown>,
    traceId,
    source: 'napcat'
  });
  rememberInboundContext(recentMessageCache, inboundContext);

  markIncomingActivityAsync({
    messageType,
    userId,
    groupId
  });
  recordRelationshipLedgerAsync(inboundContext, result.event.id);

  moduleLogger.info('Accepted OneBot message event', {
    messageType,
    userId,
    groupId: groupId ?? null,
    traceId: result.traceId,
    sessionKey: inboundContext.SessionKey,
    chatType: inboundContext.ChatType,
    wasMentioned: inboundContext.WasMentioned === true
  });

  const autoReply = await processAutoReply({
    inboxEvent: result.event,
    inboundContext,
    rawPayload: message as Record<string, unknown>,
    traceId: result.traceId,
    source: 'napcat'
  });

  return {
    accepted: true,
    policy,
    autoReply,
    ...result
  };
}

async function processAutoReply(params: {
  inboxEvent: Awaited<ReturnType<InboundInboxService['ingestIncomingMessage']>>['event'];
  inboundContext: FinalizedInboundContext;
  rawPayload: Record<string, unknown>;
  traceId: string;
  source: 'napcat' | 'simulator';
}) {
  const policyTargets = inferPolicyTargets(params.inboundContext);
  if (!policyTargets) {
    return {
      attempted: false,
      reason: 'invalid_policy_targets'
    };
  }

  const policy = await chatPolicyService.checkAutoReplyPolicy(policyTargets);
  if (!policy.allowed) {
    return {
      attempted: false,
      reason: policy.reason,
      policy
    };
  }
  await runtimeStoreService.logTimelineEvent({
    traceId: params.traceId,
    eventType: 'participation',
    eventName: 'decision',
    eventPhase: 'start',
    metadata: {
      source: params.source,
      session_key: params.inboxEvent.sessionKey,
      chat_type: params.inboxEvent.chatType
    }
  });
  const participationDecision = await groupParticipationService.decide(params.inboundContext);
  await runtimeStoreService.logTimelineEvent({
    traceId: params.traceId,
    eventType: 'participation',
    eventName: 'decision',
    eventPhase: 'end',
    metadata: {
      source: params.source,
      decision: participationDecision.decision,
      reason: participationDecision.reason,
      confidence: participationDecision.confidence,
      conservative_fallback: participationDecision.conservativeFallback,
      used_embeddings: participationDecision.usedEmbeddings,
      used_llm_judge: participationDecision.usedLlmJudge,
      scores: participationDecision.scores,
      ...participationDecision.metadata
    }
  });
  if (participationDecision.decision !== 'reply') {
    return {
      attempted: true,
      queued: false,
      reason: participationDecision.reason,
      traceId: params.traceId,
      participationDecision
    };
  }
  await runtimeStoreService.logTimelineEvent({
    traceId: params.traceId,
    eventType: 'queue',
    eventName: 'normalize',
    eventPhase: 'start',
    metadata: {
      source: params.source,
      chat_type: params.inboxEvent.chatType,
      session_key: params.inboxEvent.sessionKey
    }
  });
  const semanticMessage = runtimeStoreService.buildSemanticInboundMessage(params.inboxEvent, {
    source: params.source,
    rawPayload: params.rawPayload,
    inboundContext: params.inboundContext
  });
  await runtimeStoreService.logTimelineEvent({
    traceId: params.traceId,
    eventType: 'queue',
    eventName: 'normalize',
    eventPhase: 'end',
    metadata: {
      source: params.source,
      dedupe_key: semanticMessage.dedupeKey || null
    }
  });
  await runtimeStoreService.logTimelineEvent({
    traceId: params.traceId,
    eventType: 'queue',
    eventName: 'enqueue',
    eventPhase: 'start',
    metadata: {
      message_sid: semanticMessage.messageSid,
      source: params.source
    }
  });
  const queueResult = await runtimeStoreService.enqueueSemanticMessage(semanticMessage);
  scheduleCompactionSideEffects(params.inboundContext);
  await runtimeStoreService.logTimelineEvent({
    traceId: params.traceId,
    eventType: 'queue',
    eventName: 'enqueue',
    eventPhase: 'end',
    metadata: {
      queue_id: queueResult.queueId,
      queue_status: queueResult.status
    }
  });
  return {
    attempted: true,
    queued: true,
    queueId: queueResult.queueId,
    queueStatus: queueResult.status,
    traceId: params.traceId,
    participationDecision
  };
}

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/health', async (_req, res) => {
  const [napcat, inbox] = await Promise.all([
    napcatClient.probe(),
    inboxService.getStats()
  ]);

  res.json({
    status: 'healthy',
    service: 'provider-service',
    timestamp: new Date().toISOString(),
    napcat,
    inbox
  });
});

app.get('/api/status', async (_req, res) => {
  const napcat = await napcatClient.probe();
  res.json({
    service: 'Provider Service',
    status: napcat.reachable ? 'running' : 'degraded',
    napcat,
    port: serverConfig.port,
    timestamp: new Date().toISOString()
  });
});

app.post('/api/internal/send_private', async (req, res) => {
  try {
    const userId = Number(req.body?.user_id);
    const messages = normalizeOutboundMessages(req.body || {});
    const enforcePolicy = Boolean(req.body?.enforce_policy);
    if (!Number.isFinite(userId) || messages.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: user_id, message or messages'
      });
    }

    if (enforcePolicy) {
      const policy = await chatPolicyService.checkAutoReplyPolicy({
        messageType: 'private',
        userId
      });
      if (!policy.allowed) {
        return res.status(409).json({
          success: false,
          error: policy.reason,
          policy,
          timestamp: new Date().toISOString()
        });
      }
    }

    const data = [];
    for (const message of messages) {
      data.push(await napcatClient.sendPrivateMessage(userId, message));
    }
    res.json({
      success: true,
      data,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to send private message',
      timestamp: new Date().toISOString()
    });
  }
});

app.post('/api/internal/send_group', async (req, res) => {
  try {
    const groupId = Number(req.body?.group_id);
    const messages = normalizeOutboundMessages(req.body || {});
    const mentionUserIds = normalizeOptionalNumericIdList(req.body?.mention_user_ids, 'mention_user_ids');
    const sessionKey = typeof req.body?.session_key === 'string' && req.body.session_key.trim().length > 0
      ? req.body.session_key.trim()
      : null;
    const enforcePolicy = Boolean(req.body?.enforce_policy);
    if (!Number.isFinite(groupId) || messages.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: group_id, message or messages'
      });
    }

    if (enforcePolicy) {
      const policy = await chatPolicyService.checkAutoReplyPolicy({
        messageType: 'group',
        userId: 0,
        groupId
      });
      if (!policy.allowed) {
        return res.status(409).json({
          success: false,
          error: policy.reason,
          policy,
          timestamp: new Date().toISOString()
        });
      }
    }

    const data = [];
    for (const [index, message] of messages.entries()) {
      data.push(await napcatClient.sendGroupMessage(
        groupId,
        message,
        index === 0 ? mentionUserIds : []
      ));
    }
    if (sessionKey) {
      groupParticipationService.recordBotReply(sessionKey);
    }
    res.json({
      success: true,
      data,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to send group message',
      timestamp: new Date().toISOString()
    });
  }
});

app.post(['/webhook', '/api/onebot/events', '/api/onebot/webhook'], async (req, res) => {
  try {
    const event = (req.body || {}) as OneBotMessageEvent;
    if (event.post_type !== 'message') {
      return res.status(202).json({
        success: true,
        ignored: true,
        reason: 'unsupported_post_type',
        timestamp: new Date().toISOString()
      });
    }

    const result = await handleOneBotMessageEvent(event);
    res.status(result.accepted ? 200 : 202).json({
      success: true,
      data: result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    moduleLogger.error('Failed to process OneBot webhook event', {
      error: error instanceof Error ? error.message : String(error)
    });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to process webhook event',
      timestamp: new Date().toISOString()
    });
  }
});

app.post('/api/internal/llm/debug', async (req, res) => {
  try {
    const result = await executeDebugRequest(req.body || {});
    res.json(result);
  } catch (error) {
    moduleLogger.error('LLM debug request failed', {
      error: error instanceof Error ? error.message : String(error)
    });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'LLM debug failed',
      timestamp: new Date().toISOString()
    });
  }
});

app.post('/api/internal/agent/execute', async (req, res) => {
  try {
    const result = await executeAgentRequest(req.body || {});
    res.json(result);
  } catch (error) {
    moduleLogger.error('Agent execution request failed', {
      error: error instanceof Error ? error.message : String(error)
    });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Agent execution failed',
      timestamp: new Date().toISOString()
    });
  }
});

app.post('/api/internal/transcript-summary/result', async (req, res) => {
  try {
    const status = req.body?.status === 'failed' ? 'failed' : 'ready';
    const sessionId = typeof req.body?.session_id === 'string' ? req.body.session_id.trim() : '';
    const summaryJobId = typeof req.body?.job_id === 'string' ? req.body.job_id.trim() : null;

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: session_id',
        timestamp: new Date().toISOString()
      });
    }

    if (status === 'failed') {
      await transcriptSnapshotService.markFailed({
        sessionId,
        summaryJobId,
        summaryFormatVersion: typeof req.body?.summary_format_version === 'string'
          ? req.body.summary_format_version
          : 'failed'
      });

      return res.json({
        success: true,
        data: {
          session_id: sessionId,
          status: 'failed'
        },
        timestamp: new Date().toISOString()
      });
    }

    const chatType = req.body?.chat_type === 'group'
      ? 'group'
      : req.body?.chat_type === 'direct'
        ? 'direct'
        : null;
    const summaryText = typeof req.body?.summary_text === 'string' ? req.body.summary_text.trim() : '';
    const summaryFormatVersion = typeof req.body?.summary_format_version === 'string'
      ? req.body.summary_format_version.trim()
      : 'v1';
    const summarizedThroughConversationId = Number(req.body?.summarized_through_conversation_id);
    const privateUserId = req.body?.private_user_id !== undefined ? Number(req.body.private_user_id) : null;
    const groupId = req.body?.group_id !== undefined ? Number(req.body.group_id) : null;

    if (!chatType) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: chat_type',
        timestamp: new Date().toISOString()
      });
    }
    if (!summaryText) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: summary_text',
        timestamp: new Date().toISOString()
      });
    }
    if (!Number.isFinite(summarizedThroughConversationId) || summarizedThroughConversationId <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: summarized_through_conversation_id',
        timestamp: new Date().toISOString()
      });
    }

    await transcriptSnapshotService.applySummaryResult({
      sessionId,
      chatType,
      privateUserId: Number.isFinite(privateUserId) ? privateUserId : null,
      groupId: Number.isFinite(groupId) ? groupId : null,
      summaryText,
      summaryFormatVersion,
      summarizedThroughConversationId,
      summaryJobId
    });

    return res.json({
      success: true,
      data: {
        session_id: sessionId,
        status: 'ready',
        summarized_through_conversation_id: summarizedThroughConversationId
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    moduleLogger.error('Failed to apply transcript summary result', {
      error: error instanceof Error ? error.message : String(error)
    });
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to apply transcript summary result',
      timestamp: new Date().toISOString()
    });
  }
});

app.post('/api/internal/relationship-memory/result', async (req, res) => {
  try {
    const jobId = Number(req.body?.job_id);
    const sessionKey = typeof req.body?.session_key === 'string' ? req.body.session_key.trim() : '';
    const groupId = Number(req.body?.group_id);
    const version = Number(req.body?.version);
    const status = req.body?.status === 'failed' ? 'failed' : 'ready';

    if (!Number.isFinite(jobId) || jobId <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: job_id',
        timestamp: new Date().toISOString()
      });
    }

    if (status === 'failed') {
      await relationshipMemoryService.markFailed(
        jobId,
        typeof req.body?.error_message === 'string' && req.body.error_message.trim()
          ? req.body.error_message.trim()
          : 'relationship_memory_failed'
      );

      return res.json({
        success: true,
        data: {
          job_id: jobId,
          status: 'failed'
        },
        timestamp: new Date().toISOString()
      });
    }

    const cards = Array.isArray(req.body?.cards) ? req.body.cards : [];
    if (!sessionKey) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: session_key',
        timestamp: new Date().toISOString()
      });
    }
    if (!Number.isFinite(groupId) || groupId <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: group_id',
        timestamp: new Date().toISOString()
      });
    }
    if (!Number.isFinite(version) || version <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: version',
        timestamp: new Date().toISOString()
      });
    }

    await relationshipMemoryService.applyResult({
      jobId,
      sessionKey,
      groupId,
      version,
      cards
    });

    return res.json({
      success: true,
      data: {
        job_id: jobId,
        status: 'ready',
        version,
        card_count: cards.length
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    moduleLogger.error('Failed to apply relationship memory result', {
      error: error instanceof Error ? error.message : String(error)
    });
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to apply relationship memory result',
      timestamp: new Date().toISOString()
    });
  }
});

app.post('/api/internal/relationship-memory/execute', async (req, res) => {
  const jobId = Number(req.body?.job_id);
  const sessionKey = typeof req.body?.session_key === 'string' ? req.body.session_key.trim() : '';
  const groupId = Number(req.body?.group_id);
  const version = Number(req.body?.version);
  const triggerReason = typeof req.body?.trigger_reason === 'string' ? req.body.trigger_reason.trim() : 'compact_checkpoint';
  const turns = Array.isArray(req.body?.turns) ? req.body.turns : [];
  const ledgerEvents = Array.isArray(req.body?.ledger_events) ? req.body.ledger_events : [];

  if (!Number.isFinite(jobId) || jobId <= 0) {
    return res.status(400).json({
      success: false,
      error: 'Missing required parameter: job_id',
      timestamp: new Date().toISOString()
    });
  }
  if (!sessionKey) {
    return res.status(400).json({
      success: false,
      error: 'Missing required parameter: session_key',
      timestamp: new Date().toISOString()
    });
  }
  if (!Number.isFinite(groupId) || groupId <= 0) {
    return res.status(400).json({
      success: false,
      error: 'Missing required parameter: group_id',
      timestamp: new Date().toISOString()
    });
  }
  if (!Number.isFinite(version) || version <= 0) {
    return res.status(400).json({
      success: false,
      error: 'Missing required parameter: version',
      timestamp: new Date().toISOString()
    });
  }

  try {
    await relationshipMemoryService.markRunning(jobId);
    const execution = await relationshipMemoryExecutorService.execute({
      job_id: jobId,
      session_key: sessionKey,
      group_id: groupId,
      version,
      trigger_reason: triggerReason,
      turns,
      ledger_events: ledgerEvents
    });

    await relationshipMemoryService.applyResult({
      jobId,
      sessionKey,
      groupId,
      version,
      cards: execution.cards
    });

    return res.json({
      success: true,
      data: {
        job_id: jobId,
        status: 'ready',
        version,
        model_name: execution.modelName,
        card_count: execution.cards.length
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'relationship_memory_execute_failed';
    await relationshipMemoryService.markFailed(jobId, message).catch(() => undefined);
    moduleLogger.error('Failed to execute relationship memory job', {
      error: message,
      jobId,
      sessionKey
    });
    return res.status(500).json({
      success: false,
      error: message,
      timestamp: new Date().toISOString()
    });
  }
});

app.post('/api/internal/config-cache/clear', (_req, res) => {
  res.json({
    success: true,
    agentType: 'all',
    timestamp: new Date().toISOString()
  });
});

app.post('/api/internal/chat-policies/check-incoming', async (req, res) => {
  try {
    const messageType = req.body?.message_type === 'group' ? 'group' : 'private';
    const userId = Number(req.body?.user_id);
    const groupId = req.body?.group_id !== undefined ? Number(req.body.group_id) : undefined;

    if (!Number.isFinite(userId) && messageType === 'private') {
      return res.status(400).json({ success: false, error: 'Missing required parameter: user_id' });
    }
    if (messageType === 'group' && !Number.isFinite(groupId)) {
      return res.status(400).json({ success: false, error: 'Missing required parameter: group_id' });
    }

    const policy = await chatPolicyService.checkIncomingPolicy({
      messageType,
      userId: Number.isFinite(userId) ? userId : 0,
      groupId
    });

    res.json({
      success: true,
      data: policy,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to check incoming chat policy',
      timestamp: new Date().toISOString()
    });
  }
});

app.post('/api/internal/chat-policies/check-auto-reply', async (req, res) => {
  try {
    const messageType = req.body?.message_type === 'group' ? 'group' : 'private';
    const userId = Number(req.body?.user_id);
    const groupId = req.body?.group_id !== undefined ? Number(req.body.group_id) : undefined;

    if (!Number.isFinite(userId) && messageType === 'private') {
      return res.status(400).json({ success: false, error: 'Missing required parameter: user_id' });
    }
    if (messageType === 'group' && !Number.isFinite(groupId)) {
      return res.status(400).json({ success: false, error: 'Missing required parameter: group_id' });
    }

    const policy = await chatPolicyService.checkAutoReplyPolicy({
      messageType,
      userId: Number.isFinite(userId) ? userId : 0,
      groupId
    });

    res.json({
      success: true,
      data: policy,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to check auto reply policy',
      timestamp: new Date().toISOString()
    });
  }
});

app.get('/api/inbox/stats', async (_req, res) => {
  try {
    const stats = await inboxService.getStats();
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to load inbox stats'
    });
  }
});

app.get('/api/simple-queue/stats', async (_req, res) => {
  try {
    const [stats, conversations] = await Promise.all([
      inboxService.getStats(),
      inboxService.listConversations(200, 0)
    ]);

    res.json({
      success: true,
      data: {
        partitions: conversations.length,
        total_conversations: stats.totalConversations,
        total_messages: stats.totalMessages,
        unread_conversations: stats.unreadConversations,
        unread_messages: stats.unreadMessages,
        runtime_unread_messages: stats.runtimeUnreadMessages,
        last_received_at: stats.lastReceivedAt
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to load simple queue stats'
    });
  }
});

app.get('/api/simple-queue/partitions', async (_req, res) => {
  try {
    const conversations = await inboxService.listConversations(200, 0);
    res.json({
      success: true,
      data: conversations.map((conversation) => ({
        partition_key: conversation.sessionKey,
        session_key: conversation.sessionKey,
        chat_type: conversation.chatType,
        peer_id: conversation.peerId,
        peer_name: conversation.peerName || null,
        unread_count: conversation.unreadCount,
        total_messages: conversation.totalMessages,
        last_received_at: conversation.lastReceivedAt || null
      })),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to load simple queue partitions'
    });
  }
});

app.get('/api/simple-queue/health', async (_req, res) => {
  try {
    const [napcat, stats] = await Promise.all([
      napcatClient.probe(),
      inboxService.getStats()
    ]);
    res.json({
      success: true,
      data: {
        status: 'healthy',
        napcat,
        inbox: stats
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to load simple queue health'
    });
  }
});

app.post('/api/simple-queue/simulate/private', async (req, res) => {
  try {
    const result = await simulateSimpleQueueMessage('private', req.body || {});
    res.json({
      success: true,
      data: {
        accepted: true,
        ...result
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to simulate private simple queue message'
    });
  }
});

app.post('/api/simple-queue/simulate/group', async (req, res) => {
  try {
    const result = await simulateSimpleQueueMessage('group', req.body || {});
    res.json({
      success: true,
      data: {
        accepted: true,
        ...result
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to simulate group simple queue message'
    });
  }
});

app.get('/api/inbox/conversations', async (req, res) => {
  try {
    const limit = Number.parseInt(String(req.query.limit || '100'), 10);
    const offset = Number.parseInt(String(req.query.offset || '0'), 10);
    const conversations = await inboxService.listConversations(limit, offset);

    res.json({
      success: true,
      data: conversations
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to load inbox conversations'
    });
  }
});

app.get('/api/inbox/conversations/:sessionKey/messages', async (req, res) => {
  try {
    const sessionKey = req.params.sessionKey;
    const includeRead = parseBoolean(req.query.include_read);
    const limit = Number.parseInt(String(req.query.limit || '100'), 10);
    const messages = await inboxService.listConversationMessages({
      sessionKey,
      includeRead,
      limit
    });

    res.json({
      success: true,
      data: messages
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to load inbox messages'
    });
  }
});

app.post('/api/inbox/messages/claim', async (req, res) => {
  try {
    const sessionKey = typeof req.body?.session_key === 'string' && req.body.session_key.trim()
      ? req.body.session_key.trim()
      : undefined;
    const limit = Number.parseInt(String(req.body?.limit || '20'), 10);
    const claimed = await inboxService.claimMessages({
      sessionKey,
      limit
    });

    res.json({
      success: true,
      data: {
        claimed,
        count: claimed.length
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to claim inbox messages'
    });
  }
});

app.post('/api/inbox/simulate', async (req, res) => {
  try {
    const inboundContextInput = req.body?.inboundContext;
    if (!inboundContextInput || typeof inboundContextInput !== 'object' || Array.isArray(inboundContextInput)) {
      return res.status(400).json({
        success: false,
        error: 'Missing required object: inboundContext'
      });
    }

    const finalizedContext = inboxService.finalizeSimulationContext(
      inboundContextInput as Partial<FinalizedInboundContext>,
      String(aiConfig.bot_qq_number)
    );
    const targets = inferPolicyTargets(finalizedContext);
    if (!targets) {
      return res.status(400).json({
        success: false,
        error: 'inboundContext must include ChatType, SenderId and NativeChannelId/session data'
      });
    }

    const policy = await chatPolicyService.checkIncomingPolicy({
      messageType: targets.messageType,
      userId: targets.userId,
      groupId: targets.groupId
    });

    if (!policy.allowed) {
      return res.json({
        success: true,
        data: {
          accepted: false,
          reason: policy.reason,
          policy
        }
      });
    }

    const result = await inboxService.ingestIncomingMessage({
      inboundContext: finalizedContext,
      rawPayload: (req.body?.rawPayload && typeof req.body.rawPayload === 'object' && !Array.isArray(req.body.rawPayload))
        ? req.body.rawPayload as Record<string, unknown>
        : { simulated: true, inboundContext: finalizedContext },
      traceId: finalizedContext.MessageSid,
      source: 'simulator'
    });
    rememberInboundContext(recentMessageCache, finalizedContext);

    markIncomingActivityAsync({
      messageType: targets.messageType,
      userId: targets.userId,
      groupId: targets.groupId
    });
    recordRelationshipLedgerAsync(finalizedContext, result.event.id);

    res.json({
      success: true,
      data: {
        accepted: true,
        policy,
        ...result
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to simulate inbound message'
    });
  }
});

app.get('/v1/models', (_req, res) => {
  res.json(embeddingService.listModels());
});

app.post('/v1/embeddings', async (req, res) => {
  try {
    const payload = req.body || {};
    const model = typeof payload.model === 'string' ? payload.model : undefined;
    const input = payload.input;
    const encodingFormat = payload.encoding_format;
    const dimensions = payload.dimensions;

    if (!embeddingService.isEnabled()) {
      return res.status(503).json({
        error: {
          message: 'Embedding service is not enabled',
          type: 'service_unavailable'
        }
      });
    }

    if (!input || (typeof input !== 'string' && !Array.isArray(input))) {
      return res.status(400).json({
        error: {
          message: 'input must be a non-empty string or non-empty array of strings',
          type: 'invalid_request_error'
        }
      });
    }

    if (encodingFormat && encodingFormat !== 'float') {
      return res.status(400).json({
        error: {
          message: 'Only encoding_format="float" is supported',
          type: 'invalid_request_error'
        }
      });
    }

    if (dimensions !== undefined && Number(dimensions) !== embeddingService.getDimensions()) {
      return res.status(400).json({
        error: {
          message: `Only dimensions=${embeddingService.getDimensions()} is supported`,
          type: 'invalid_request_error'
        }
      });
    }

    const response = await embeddingService.createEmbeddings({
      input,
      model,
      user: typeof payload.user === 'string' ? payload.user : undefined
    });
    res.json(response);
  } catch (error) {
    res.status(500).json({
      error: {
        message: error instanceof Error ? error.message : 'Embedding request failed',
        type: 'server_error'
      }
    });
  }
});

app.get('/api/internal/embedding/health', async (_req, res) => {
  try {
    const health = await embeddingService.healthCheck();
    res.json({
      success: true,
      data: health,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Embedding health check failed',
      timestamp: new Date().toISOString()
    });
  }
});

async function startServer() {
  await ensureRelationshipMemorySchema();
  await inboxService.initialize();
  await conversationStoreService.initialize();
  await transcriptSnapshotService.initialize();
  await runtimeStoreService.initialize();

  app.listen(serverConfig.port, serverConfig.host, () => {
    moduleLogger.info('Provider service started', {
      host: serverConfig.host,
      port: serverConfig.port
    });
  });
}

async function shutdown(signal: string) {
  moduleLogger.info('Shutting down provider service', { signal });
  await inboxService.close().catch((error) => {
    moduleLogger.warn('Failed to close inbox service cleanly', {
      error: error instanceof Error ? error.message : String(error)
    });
  });
  await conversationStoreService.close().catch((error) => {
    moduleLogger.warn('Failed to close conversation store cleanly', {
      error: error instanceof Error ? error.message : String(error)
    });
  });
  await transcriptSnapshotService.close().catch((error) => {
    moduleLogger.warn('Failed to close transcript snapshot service cleanly', {
      error: error instanceof Error ? error.message : String(error)
    });
  });
  await runtimeStoreService.close().catch((error) => {
    moduleLogger.warn('Failed to close runtime store cleanly', {
      error: error instanceof Error ? error.message : String(error)
    });
  });
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

startServer().catch((error) => {
  moduleLogger.error('Failed to start provider service', {
    error: error instanceof Error ? error.message : String(error)
  });
  process.exit(1);
});
