import express from 'express';
import { aiConfig, serverConfig } from './config';
import EmbeddingService from './services/embedding-service';
import { executeDebugRequest } from './services/provider-debug-service';
import { NapcatClient } from './services/napcat-client';
import { ChatPolicyService } from './services/chat-policy-service';
import {
  buildNapcatInboundContext,
  OneBotMessageEvent,
  RecentMessageCache,
  rememberInboundContext,
} from './services/agent-im-input-adapter';
import { InboundInboxService } from './services/inbound-inbox-service';
import { FinalizedInboundContext } from './types';
import { logger } from './utils/logger';

const app = express();
const moduleLogger = logger.createModuleLogger('provider-service');
const embeddingService = new EmbeddingService(aiConfig);
const napcatClient = new NapcatClient();
const inboxService = new InboundInboxService();
const chatPolicyService = new ChatPolicyService();
const recentMessageCache = new RecentMessageCache();

type ProviderMessageType = 'private' | 'group';

type SimpleQueueSimulationPayload = {
  user_id?: number | string;
  group_id?: number | string;
  message?: string;
  priority?: string;
};

function markIncomingActivityAsync(params: { messageType: ProviderMessageType; userId: number; groupId?: number }) {
  void chatPolicyService.markIncomingActivity(params).catch((error) => {
    moduleLogger.warn('Failed to update chat activity after accepting message', {
      error: error instanceof Error ? error.message : String(error),
      ...params
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

function buildSimpleQueueSimulationContext(
  messageType: ProviderMessageType,
  payload: SimpleQueueSimulationPayload
): Partial<FinalizedInboundContext> {
  const userId = toNumericId(payload.user_id);
  const groupId = toNumericId(payload.group_id);
  const message = typeof payload.message === 'string' ? payload.message.trim() : '';

  if (!userId || !message) {
    throw new Error('Missing required parameters: user_id, message');
  }

  if (messageType === 'group' && !groupId) {
    throw new Error('Missing required parameter: group_id');
  }

  const accountId = String(aiConfig.bot_qq_number);
  const nativeChannelId = messageType === 'group' ? String(groupId) : String(userId);

  return {
    AccountId: accountId,
    ChatType: messageType === 'group' ? 'group' : 'direct',
    SenderId: String(userId),
    SenderName: `user_${userId}`,
    NativeChannelId: nativeChannelId,
    ConversationLabel: messageType === 'group' ? `group_${groupId}` : `user_${userId}`,
    GroupSubject: messageType === 'group' ? `group_${groupId}` : undefined,
    Body: message,
    BodyForAgent: message,
    RawBody: message,
    CommandBody: message,
    BodyForCommands: message,
    Timestamp: Date.now(),
    Provider: 'qq',
    Surface: 'simple-queue-simulator',
    OriginatingChannel: 'qq',
    OriginatingTo: messageType === 'group' ? `group:${groupId}` : `user:${userId}`,
    To: messageType === 'group' ? `group:${groupId}` : `user:${userId}`,
    From: `qq:${userId}`,
    WasMentioned: false
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

  return result;
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

  moduleLogger.info('Accepted OneBot message event', {
    messageType,
    userId,
    groupId: groupId ?? null,
    traceId: result.traceId,
    sessionKey: inboundContext.SessionKey,
    chatType: inboundContext.ChatType,
    wasMentioned: inboundContext.WasMentioned === true
  });

  return {
    accepted: true,
    policy,
    ...result
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
    const message = typeof req.body?.message === 'string' ? req.body.message : '';
    const enforcePolicy = Boolean(req.body?.enforce_policy);
    if (!Number.isFinite(userId) || !message.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: user_id, message'
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

    const data = await napcatClient.sendPrivateMessage(userId, message);
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
    const message = typeof req.body?.message === 'string' ? req.body.message : '';
    const enforcePolicy = Boolean(req.body?.enforce_policy);
    if (!Number.isFinite(groupId) || !message.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: group_id, message'
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

    const data = await napcatClient.sendGroupMessage(groupId, message);
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
  await inboxService.initialize();

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
