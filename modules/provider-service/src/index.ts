import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import {
  ensureAgentMediaSchema,
  ensureIdentityLineageSchema,
  ensureSelfEvolutionSchema,
  ensureTopicLabSchema,
  upsertAgentMediaAssets,
} from '@qq-bot/persistence';
import { aiConfig, mediaInspectorConfig, selfEvolutionConfig, serverConfig, topicProjectionConfig } from './config';
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
import SelfEvolutionExecutorService from './services/self-evolution-executor-service';
import { SelfEvolutionService } from './services/self-evolution-service';
import TopicProjectionService from './services/topic-projection-service';
import TopicProjectionExecutorService from './services/topic-projection-executor-service';
import TopicReviewMaterializationService from './services/topic-review-materialization-service';
import { GroupParticipationService } from './services/group-participation-service';
import { ImagePromptAssistantService, ImageProviderError, OpenAIImageProvider } from './services/image-provider';
import { inspectMediaImage } from './services/media-inspector-service';
import {
  buildSimpleQueueSimulationContext,
  type ProviderMessageType,
  type SimpleQueueSimulationPayload,
} from './services/simple-queue-simulation-context';
import { FinalizedInboundContext, InboxMessageRecord } from './types';
import { runtimeStoreService } from './services/runtime-store-service';
import {
  applyForcedInboundAgentQueuePolicy,
  decideInboundAgentQueueTrigger,
  processInboundAgentQueueTrigger
} from './services/inbound-agent-trigger-service';
import {
  resolveInternalGroupSendRequest,
  resolveInternalPrivateSendRequest
} from './services/outbound-send-contract';
import { logger } from './utils/logger';

const app = express();
const moduleLogger = logger.createModuleLogger('provider-service');
const RUNTIME_ASSET_ROOT = process.env.PROVIDER_RUNTIME_ASSET_ROOT || '/app/logs/runtime-assets';
const RUNTIME_ASSET_BASE_URL = (process.env.PROVIDER_RUNTIME_ASSET_BASE_URL || `http://qqbot-provider-service:${serverConfig.port}`).replace(/\/$/, '');
const NAPCAT_QQ_DATA_ROOT = process.env.NAPCAT_QQ_DATA_ROOT || '/app/napcat-qq-data';
const NAPCAT_QQ_CONTAINER_ROOT = '/app/.config/QQ';
const embeddingService = new EmbeddingService(aiConfig);
const imageProvider = new OpenAIImageProvider();
const imagePromptAssistant = new ImagePromptAssistantService();
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
const selfEvolutionService = new SelfEvolutionService({
  enabled: selfEvolutionConfig.enabled,
  webhookUrl: selfEvolutionConfig.webhookUrl,
  minNewTurns: selfEvolutionConfig.minNewTurns,
  minNewLedgerEvents: selfEvolutionConfig.minNewLedgerEvents
});
const selfEvolutionExecutorService = new SelfEvolutionExecutorService({
  modelName: selfEvolutionConfig.modelName
});
const topicProjectionService = new TopicProjectionService({
  enabled: topicProjectionConfig.enabled,
  webhookUrl: topicProjectionConfig.webhookUrl,
  minNewTurns: topicProjectionConfig.minNewTurns,
  minNewLedgerEvents: topicProjectionConfig.minNewLedgerEvents,
  modelName: aiConfig.model_name
});
const topicProjectionExecutorService = new TopicProjectionExecutorService({
  modelName: aiConfig.model_name
});
const topicReviewMaterializationService = new TopicReviewMaterializationService();
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

function parseImageDataUrl(value: string) {
  const match = /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/i.exec(value.trim());
  if (!match) {
    return null;
  }
  const mimeType = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase();
  const extension = mimeType === 'image/jpeg'
    ? 'jpg'
    : mimeType.replace('image/', '');
  return {
    mimeType,
    extension,
    buffer: Buffer.from(match[2].replace(/\s+/g, ''), 'base64')
  };
}

async function materializeRuntimeImageAsset(imageFile: string) {
  const parsed = parseImageDataUrl(imageFile);
  if (!parsed) {
    return imageFile;
  }
  await fs.mkdir(RUNTIME_ASSET_ROOT, { recursive: true });
  const filename = `${Date.now()}-${randomUUID().slice(0, 8)}.${parsed.extension}`;
  await fs.writeFile(path.join(RUNTIME_ASSET_ROOT, filename), parsed.buffer);
  return `${RUNTIME_ASSET_BASE_URL}/api/internal/runtime-assets/${encodeURIComponent(filename)}`;
}

function isSupportedImageMimeType(value?: string | null) {
  return typeof value === 'string' && /^image\/(?:png|jpeg|jpg|webp|gif)$/i.test(value);
}

function inferImageMimeTypeFromName(value?: string | null) {
  const normalized = (value || '').toLowerCase();
  if (normalized.endsWith('.png')) return 'image/png';
  if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) return 'image/jpeg';
  if (normalized.endsWith('.webp')) return 'image/webp';
  if (normalized.endsWith('.gif')) return 'image/gif';
  return null;
}

function sniffImageMimeType(buffer: Buffer, fallback?: string | null) {
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  if (buffer.subarray(0, 3).toString('ascii') === 'GIF') {
    return 'image/gif';
  }
  return isSupportedImageMimeType(fallback) ? fallback!.toLowerCase().replace('image/jpg', 'image/jpeg') : null;
}

function toDataUrl(buffer: Buffer, mimeType: string) {
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

function mapNapcatContainerPath(filePath: string) {
  if (!filePath.startsWith(NAPCAT_QQ_CONTAINER_ROOT + '/')) {
    throw new Error('Unsupported NapCat file path');
  }
  const relative = path.relative(NAPCAT_QQ_CONTAINER_ROOT, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Unsafe NapCat file path');
  }
  return path.join(NAPCAT_QQ_DATA_ROOT, relative);
}

async function readNapcatFileAsImageDataUrl(filePath: string, filename?: string | null, mimeType?: string | null) {
  const hostPath = mapNapcatContainerPath(filePath);
  const buffer = await fs.readFile(hostPath);
  const detectedMimeType = sniffImageMimeType(buffer, mimeType || inferImageMimeTypeFromName(filename));
  if (!detectedMimeType) {
    throw new Error('Resolved NapCat file is not a supported image');
  }
  return {
    data_url: toDataUrl(buffer, detectedMimeType),
    mime_type: detectedMimeType,
    bytes: buffer.length,
    filename: filename || path.basename(filePath)
  };
}

async function fetchImageAsDataUrl(url: string, mimeType?: string | null) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch image source: ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const detectedMimeType = sniffImageMimeType(buffer, mimeType || response.headers.get('content-type'));
  if (!detectedMimeType) {
    throw new Error('Fetched source is not a supported image');
  }
  return {
    data_url: toDataUrl(buffer, detectedMimeType),
    mime_type: detectedMimeType,
    bytes: buffer.length
  };
}

async function persistInboundMediaAssets(inboundContext: FinalizedInboundContext, sourceMessageId?: number | null, traceId?: string) {
  const mediaAssets = Array.isArray(inboundContext.MediaAssets) ? inboundContext.MediaAssets : [];
  if (mediaAssets.length === 0) {
    return [];
  }

  return upsertAgentMediaAssets(mediaAssets.map((asset) => ({
    source: inboundContext.Surface || inboundContext.Provider || 'napcat',
    sourceMessageId: sourceMessageId || null,
    traceId,
    sessionKey: inboundContext.SessionKey || '',
    chatType: inboundContext.ChatType === 'group' ? 'group' : 'direct',
    peerId: inboundContext.NativeChannelId || inboundContext.To || null,
    peerName: inboundContext.ConversationLabel || null,
    senderId: inboundContext.SenderId || null,
    senderName: inboundContext.SenderName || null,
    accountId: inboundContext.AccountId || null,
    messageSid: asset.messageSid || inboundContext.MessageSid || null,
    mediaTag: asset.mediaTag,
    placeholder: asset.placeholder,
    mediaType: asset.mediaType,
    mimeType: asset.mimeType,
    sourceLocator: asset.locator,
    metadata: {
      provider: inboundContext.Provider || null,
      surface: inboundContext.Surface || null,
      placeholder: asset.placeholder,
      file_id: asset.fileId || null,
      file_name: asset.fileName || null,
      file_size: asset.fileSize || null
    }
  })));
}

function scheduleCompactionSideEffects(inboundContext: FinalizedInboundContext) {
  moduleLogger.debug('Skipped transcript/memory side effects for simplified runtime', {
    sessionKey: inboundContext.SessionKey,
    chatType: inboundContext.ChatType
  });
}

function respondRuntimeFeatureDisabled(
  res: express.Response,
  feature: 'transcript_summary' | 'self_evolution' | 'topic_projection'
) {
  return res.status(410).json({
    success: false,
    error: `${feature} is disabled in the simplified runtime`,
    timestamp: new Date().toISOString()
  });
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
  moduleLogger.debug('Skipped relationship ledger recording for simplified runtime', {
    sessionKey: inboundContext.SessionKey,
    messageSid: inboundContext.MessageSid,
    currentMessageId: currentMessageId ?? null
  });
}

function isInboxOnlyInboundMessage(_message: { chatType: 'direct' | 'group'; wasMentioned: boolean; senderId: string }) {
  return false;
}

async function materializeContinuousLearningTurn(params: {
  inboundContext: FinalizedInboundContext;
  currentMessageId?: number | null;
  traceId: string;
}) {
  const targets = inferPolicyTargets(params.inboundContext);
  if (!targets) {
    return false;
  }

  await conversationStoreService.materializeInboundConversation({
    userId: targets.userId,
    groupId: targets.groupId,
    userMessage: params.inboundContext.BodyForAgent || params.inboundContext.Body || '',
    traceId: params.traceId,
    sourceMessageId: params.currentMessageId ?? null,
    sourceMessageSid: params.inboundContext.MessageSid || null,
    rawRequest: {
      session_key: params.inboundContext.SessionKey,
      chat_type: params.inboundContext.ChatType,
      sender_id: params.inboundContext.SenderId,
      sender_name: params.inboundContext.SenderName || null
    }
  });
  return true;
}

async function runContinuousLearningIfEnabled(params: {
  policyState: Awaited<ReturnType<ChatPolicyService['getPolicyState']>>;
  inboxEventId?: number | null;
  inboundContext: FinalizedInboundContext;
  traceId: string;
  skipMaterialization?: boolean;
  inboxOnly?: boolean;
}) {
  if (!params.policyState.continuousLearningEnabled) {
    return {
      attempted: false,
      reason: 'continuous_learning_disabled'
    };
  }

  if (params.inboxOnly) {
    return {
      attempted: false,
      reason: 'inbox_only_until_im_opened'
    };
  }

  if (!params.skipMaterialization) {
    await materializeContinuousLearningTurn({
      inboundContext: params.inboundContext,
      currentMessageId: params.inboxEventId,
      traceId: params.traceId
    });
  }

  scheduleCompactionSideEffects(params.inboundContext);
  return {
    attempted: true,
    reason: params.skipMaterialization ? 'scheduled_existing_transcript' : 'materialized_and_scheduled'
  };
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
  const policyState = await chatPolicyService.getPolicyState({
    messageType,
    userId: Number(payload.user_id),
    groupId: messageType === 'group' ? Number(payload.group_id) : undefined
  });
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
    source: 'simulator',
    policyState
  });
  const inboxOnly = isInboxOnlyInboundMessage(result.event);
  const learning = !autoReply.queued
    ? await runContinuousLearningIfEnabled({
        policyState,
        inboxEventId: result.event.id,
        inboundContext: finalizedContext,
        traceId: result.traceId,
        inboxOnly
      })
    : await runContinuousLearningIfEnabled({
        policyState,
        inboxEventId: result.event.id,
        inboundContext: finalizedContext,
        traceId: result.traceId,
        skipMaterialization: true
      });

  return {
    ...result,
    autoReply,
    learning
  };
}

async function expandForwardSegments(message: OneBotMessageEvent): Promise<OneBotMessageEvent> {
  if (!Array.isArray(message.message)) {
    return message;
  }

  const hasForward = message.message.some((seg) => seg.type === 'forward');
  if (!hasForward) {
    return message;
  }

  const expandedSegments: typeof message.message = [];
  for (const seg of message.message) {
    if (seg.type !== 'forward') {
      expandedSegments.push(seg);
      continue;
    }
    const forwardId = String(seg.data?.id ?? '');
    if (!forwardId) {
      expandedSegments.push({ type: 'text', data: { text: '[转发消息]' } });
      continue;
    }
    try {
      const items = await napcatClient.getForwardMessage(forwardId);
      const lines: string[] = ['[转发消息]'];
      for (const item of items) {
        const senderName = item.sender?.nickname || String(item.sender?.user_id ?? '');
        const segments = item.content ?? item.message ?? [];
        const parts: string[] = [];
        for (const s of segments) {
          if (s.type === 'text') {
            const t = String(s.data?.text ?? '').trim();
            if (t) parts.push(t);
          } else if (s.type === 'json') {
            const raw = String(s.data?.data ?? '');
            try {
              const parsed = JSON.parse(raw);
              const detail = parsed?.meta?.detail_1 ?? {};
              const desc = detail.desc || detail.title || parsed.prompt || '';
              const rawUrl = detail.qqdocurl || detail.url || '';
              const url = rawUrl.split('?')[0];
              parts.push(url ? `[卡片] ${desc} ${url}`.trim() : `[卡片] ${desc}`);
            } catch {
              parts.push('[卡片]');
            }
          } else if (s.type === 'xml') {
            const raw = String(s.data?.data ?? '');
            const title = /<title[^>]*>([^<]+)<\/title>/i.exec(raw)?.[1]?.trim();
            const url = /<url[^>]*>([^<]+)<\/url>/i.exec(raw)?.[1]?.trim();
            const desc = /<des[^>]*>([^<]+)<\/des>/i.exec(raw)?.[1]?.trim();
            const label = title || desc;
            parts.push(url ? `[卡片] ${label ?? ''} ${url}`.trim() : `[卡片] ${label ?? ''}`);
          } else if (s.type === 'share') {
            const title = String(s.data?.title ?? s.data?.content ?? '').trim();
            const url = String(s.data?.url ?? '').trim();
            if (url) parts.push(title ? `[链接] ${title} ${url}` : `[链接] ${url}`);
          } else if (s.type === 'forward') {
            parts.push('[嵌套转发]');
          }
        }
        const combined = parts.join(' ').trim();
        if (combined) {
          lines.push(`${senderName}: ${combined}`);
        }
      }
      expandedSegments.push({ type: 'text', data: { text: lines.join('\n') } });
    } catch {
      expandedSegments.push({ type: 'text', data: { text: '[转发消息]' } });
    }
  }

  return { ...message, message: expandedSegments };
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

  const policy = await chatPolicyService.getPolicyState({
    messageType,
    userId,
    groupId
  });
  const effectivePolicy = applyForcedInboundAgentQueuePolicy(policy, {
    chatType: messageType === 'group' ? 'group' : 'direct',
    wasMentioned: false,
    senderId: String(userId)
  });

  if (!effectivePolicy.isEnabled) {
    return {
      accepted: false,
      reason: 'receive_disabled' as const,
      policy: {
        ...effectivePolicy,
        allowed: false,
        reason: 'receive_disabled' as const
      }
    };
  }

  const traceId = inboxService.createTraceId('napcat');
  const expandedMessage = await expandForwardSegments(message);
  const inboundContext = buildNapcatInboundContext({
    event: expandedMessage,
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
  await persistInboundMediaAssets(inboundContext, result.event.id, result.traceId);
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
    source: 'napcat',
    policyState: effectivePolicy
  });
  const inboxOnly = isInboxOnlyInboundMessage(result.event);
  const learning = !autoReply.queued
    ? await runContinuousLearningIfEnabled({
        policyState: policy,
        inboxEventId: result.event.id,
        inboundContext,
        traceId: result.traceId,
        inboxOnly
      })
    : await runContinuousLearningIfEnabled({
        policyState: policy,
        inboxEventId: result.event.id,
        inboundContext,
        traceId: result.traceId,
        skipMaterialization: true
      });

  return {
    accepted: true,
    policy: {
      ...effectivePolicy,
      allowed: true,
      reason: 'accepted' as const
    },
    autoReply,
    learning,
    ...result
  };
}

async function processAutoReply(params: {
  inboxEvent: Awaited<ReturnType<InboundInboxService['ingestIncomingMessage']>>['event'];
  inboundContext: FinalizedInboundContext;
  rawPayload: Record<string, unknown>;
  traceId: string;
  source: 'napcat' | 'simulator';
  policyState?: Awaited<ReturnType<ChatPolicyService['getPolicyState']>>;
}) {
  const policyTargets = inferPolicyTargets(params.inboundContext);
  if (!policyTargets) {
    return {
      attempted: false,
      queued: false,
      reason: 'invalid_policy_targets'
    };
  }

  const policy = params.policyState || await chatPolicyService.getPolicyState(policyTargets);
  await runtimeStoreService.logTimelineEvent({
    traceId: params.traceId,
    eventType: 'phone_notification',
    eventName: 'routing',
    eventPhase: 'start',
    metadata: {
      source: params.source,
      session_key: params.inboxEvent.sessionKey,
      chat_type: params.inboxEvent.chatType
    }
  });
  const triggerDecision = decideInboundAgentQueueTrigger(params.inboxEvent);
  const participationDecision = {
    decision: 'notify' as const,
    reason: triggerDecision.reason,
    confidence: 'high' as const,
    conservativeFallback: false,
    usedEmbeddings: false,
    usedLlmJudge: false,
    scores: null,
    metadata: {
      source_of_truth: 'phone_notification',
      provider_boundary_mode: 'notification_only_no_qq_body',
      trigger_reason: triggerDecision.reason,
      auto_reply_enabled: policy.autoReplyEnabled
    }
  };
  await runtimeStoreService.logTimelineEvent({
    traceId: params.traceId,
    eventType: 'phone_notification',
    eventName: 'routing',
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
  const queueResult = await processInboundAgentQueueTrigger({
    inboxEvent: params.inboxEvent,
    inboundContext: params.inboundContext,
    rawPayload: params.rawPayload,
    traceId: params.traceId,
    source: params.source
  }, runtimeStoreService);
  return {
    ...queueResult,
    participationDecision
  };
}

app.use(express.json({ limit: process.env.IMAGE_LAB_JSON_LIMIT || '50mb' }));
app.use(express.urlencoded({ extended: true, limit: process.env.IMAGE_LAB_JSON_LIMIT || '50mb' }));

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
    const { userId, messages, enforcePolicy } = resolveInternalPrivateSendRequest(req.body || {});
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
    const { groupId, messages, mentionUserIds, sessionKey, enforcePolicy } = resolveInternalGroupSendRequest(req.body || {});
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

app.post('/api/internal/send_group_image', async (req, res) => {
  try {
    const groupId = Number(req.body?.group_id);
    const imageFile = typeof req.body?.image_file === 'string'
      ? req.body.image_file
      : typeof req.body?.data_url === 'string'
        ? req.body.data_url
        : typeof req.body?.url === 'string'
          ? req.body.url
          : '';
    const caption = typeof req.body?.caption === 'string' ? req.body.caption : undefined;
    const sessionKey = typeof req.body?.session_key === 'string' && req.body.session_key.trim().length > 0
      ? req.body.session_key.trim()
      : null;

    if (!Number.isFinite(groupId) || !imageFile.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: group_id and image_file/data_url/url'
      });
    }

    const deliverableImageFile = await materializeRuntimeImageAsset(imageFile);
    const data = await napcatClient.sendGroupImage(groupId, deliverableImageFile, caption);
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
      error: error instanceof Error ? error.message : 'Failed to send group image',
      timestamp: new Date().toISOString()
    });
  }
});

app.post('/api/internal/send_private_image', async (req, res) => {
  try {
    const userId = Number(req.body?.user_id);
    const imageFile = typeof req.body?.image_file === 'string'
      ? req.body.image_file
      : typeof req.body?.data_url === 'string'
        ? req.body.data_url
        : typeof req.body?.url === 'string'
          ? req.body.url
          : '';
    const caption = typeof req.body?.caption === 'string' ? req.body.caption : undefined;

    if (!Number.isFinite(userId) || !imageFile.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: user_id and image_file/data_url/url'
      });
    }

    const deliverableImageFile = await materializeRuntimeImageAsset(imageFile);
    const data = await napcatClient.sendPrivateImage(userId, deliverableImageFile, caption);
    res.json({
      success: true,
      data,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to send private image',
      timestamp: new Date().toISOString()
    });
  }
});

app.get('/api/internal/runtime-assets/:filename', async (req, res) => {
  try {
    const filename = path.basename(req.params.filename || '');
    if (!filename) {
      return res.status(404).end();
    }
    const filePath = path.join(RUNTIME_ASSET_ROOT, filename);
    const extension = path.extname(filename).toLowerCase();
    const mimeType = extension === '.jpg' || extension === '.jpeg'
      ? 'image/jpeg'
      : extension === '.webp'
        ? 'image/webp'
        : extension === '.gif'
          ? 'image/gif'
          : 'image/png';
    res.type(mimeType);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(await fs.readFile(filePath));
  } catch {
    res.status(404).end();
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

app.post('/api/internal/image/generate', async (req, res) => {
  try {
    const data = await imageProvider.generate(req.body || {});
    res.json({
      success: true,
      data,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    const statusCode = error instanceof ImageProviderError ? error.statusCode : 500;
    moduleLogger.error('Image generation request failed', {
      error: error instanceof Error ? error.message : String(error),
      statusCode
    });
    res.status(statusCode).json({
      success: false,
      error: error instanceof Error ? error.message : 'Image generation failed',
      timestamp: new Date().toISOString()
    });
  }
});

app.post('/api/internal/image/edit', async (req, res) => {
  try {
    const data = await imageProvider.edit(req.body || {});
    res.json({
      success: true,
      data,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    const statusCode = error instanceof ImageProviderError ? error.statusCode : 500;
    moduleLogger.error('Image edit request failed', {
      error: error instanceof Error ? error.message : String(error),
      statusCode
    });
    res.status(statusCode).json({
      success: false,
      error: error instanceof Error ? error.message : 'Image edit failed',
      timestamp: new Date().toISOString()
    });
  }
});

app.post('/api/internal/image/prompt-assistant', async (req, res) => {
  try {
    const data = await imagePromptAssistant.compose(req.body || {});
    res.json({
      success: true,
      data,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    moduleLogger.error('Image prompt assistant request failed', {
      error: error instanceof Error ? error.message : String(error)
    });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Image prompt assistant failed',
      timestamp: new Date().toISOString()
    });
  }
});

app.post('/api/internal/media/inspect', async (req, res) => {
  try {
    const imageUrl = typeof req.body?.image_url === 'string'
      ? req.body.image_url.trim()
      : typeof req.body?.url === 'string'
        ? req.body.url.trim()
        : typeof req.body?.data_url === 'string'
          ? req.body.data_url.trim()
          : '';
    if (!imageUrl) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: image_url'
      });
    }

    const reason = typeof req.body?.reason === 'string' && req.body.reason.trim()
      ? req.body.reason.trim()
      : typeof req.body?.prompt === 'string' && req.body.prompt.trim()
        ? req.body.prompt.trim()
        : undefined;
    const model = typeof req.body?.model === 'string' && req.body.model.trim()
      ? req.body.model.trim()
      : undefined;
    const result = await inspectMediaImage({
      imageUrl,
      traceId: typeof req.body?.trace_id === 'string' ? req.body.trace_id : undefined,
      reason,
      model,
      defaultModel: mediaInspectorConfig.modelName
    }, executeAgentRequest);

    res.json({
      success: true,
      data: {
        description: result.description,
        summary: result.summary,
        visible_text: result.visible_text,
        objects: result.objects,
        uncertainty: result.uncertainty,
        safety_notes: result.safety_notes,
        model: result.model,
        provider: result.provider,
        llm_call_id: result.llm_call_id
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    moduleLogger.error('Media inspect request failed', {
      error: error instanceof Error ? error.message : String(error)
    });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Media inspect failed',
      timestamp: new Date().toISOString()
    });
  }
});

app.post('/api/internal/media/materialize-image', async (req, res) => {
  try {
    const metadata = req.body?.metadata && typeof req.body.metadata === 'object'
      ? req.body.metadata as Record<string, unknown>
      : {};
    const fileId = typeof req.body?.file_id === 'string' && req.body.file_id.trim()
      ? req.body.file_id.trim()
      : typeof metadata.file_id === 'string' && metadata.file_id.trim()
        ? metadata.file_id.trim()
        : '';
    const filename = typeof req.body?.file_name === 'string' && req.body.file_name.trim()
      ? req.body.file_name.trim()
      : typeof metadata.file_name === 'string' && metadata.file_name.trim()
        ? metadata.file_name.trim()
        : null;
    const mimeType = typeof req.body?.mime_type === 'string' && req.body.mime_type.trim()
      ? req.body.mime_type.trim()
      : null;

    if (fileId) {
      const fileInfo = await napcatClient.getFile(fileId);
      const filePath = typeof fileInfo?.file === 'string' && fileInfo.file.trim()
        ? fileInfo.file.trim()
        : typeof fileInfo?.url === 'string' && fileInfo.url.trim()
          ? fileInfo.url.trim()
          : '';
      if (filePath && !/^https?:\/\//i.test(filePath)) {
        const data = await readNapcatFileAsImageDataUrl(filePath, filename || fileInfo?.file_name, mimeType);
        return res.json({
          success: true,
          data: {
            ...data,
            source: 'napcat_file'
          },
          timestamp: new Date().toISOString()
        });
      }
      if (filePath) {
        const data = await fetchImageAsDataUrl(filePath, mimeType);
        return res.json({
          success: true,
          data: {
            ...data,
            source: 'napcat_file_url'
          },
          timestamp: new Date().toISOString()
        });
      }
    }

    const sourceLocator = typeof req.body?.source_locator === 'string' && req.body.source_locator.trim()
      ? req.body.source_locator.trim()
      : typeof req.body?.url === 'string' && req.body.url.trim()
        ? req.body.url.trim()
        : '';
    if (!sourceLocator) {
      return res.status(400).json({
        success: false,
        error: 'Missing source image locator or file_id'
      });
    }
    if (sourceLocator.startsWith('data:')) {
      const parsed = parseImageDataUrl(sourceLocator);
      if (!parsed) {
        return res.status(400).json({
          success: false,
          error: 'Unsupported image data URL'
        });
      }
      return res.json({
        success: true,
        data: {
          data_url: toDataUrl(parsed.buffer, parsed.mimeType),
          mime_type: parsed.mimeType,
          bytes: parsed.buffer.length,
          source: 'data_url'
        },
        timestamp: new Date().toISOString()
      });
    }
    const data = await fetchImageAsDataUrl(sourceLocator, mimeType);
    res.json({
      success: true,
      data: {
        ...data,
        source: 'url'
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    moduleLogger.error('Media materialize request failed', {
      error: error instanceof Error ? error.message : String(error)
    });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Media materialize failed',
      timestamp: new Date().toISOString()
    });
  }
});

app.post('/api/internal/transcript-summary/result', async (req, res) => {
  return respondRuntimeFeatureDisabled(res, 'transcript_summary');
});

app.post('/api/internal/self-evolution/execute', async (req, res) => {
  return respondRuntimeFeatureDisabled(res, 'self_evolution');
});

app.post('/api/internal/topic-projection/execute', async (req, res) => {
  return respondRuntimeFeatureDisabled(res, 'topic_projection');
});

app.post('/api/internal/topic-reviews/apply', async (req, res) => {
  return respondRuntimeFeatureDisabled(res, 'topic_projection');
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
    const order = req.body?.order === 'latest' ? 'latest' : 'oldest';
    const markRead = req.body?.mark_read === false || req.body?.markRead === false
      ? false
      : undefined;
    const claimed = await inboxService.claimMessages({
      sessionKey,
      limit,
      order,
      markRead
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

    const policy = await chatPolicyService.getPolicyState({
      messageType: targets.messageType,
      userId: targets.userId,
      groupId: targets.groupId
    });
    const effectivePolicy = applyForcedInboundAgentQueuePolicy(policy, {
      chatType: targets.messageType === 'group' ? 'group' : 'direct',
      wasMentioned: finalizedContext.WasMentioned === true,
      senderId: String(targets.userId)
    });

    if (!effectivePolicy.isEnabled) {
      return res.json({
        success: true,
        data: {
          accepted: false,
          reason: 'receive_disabled',
          policy: {
            ...effectivePolicy,
            allowed: false,
            reason: 'receive_disabled'
          }
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
    const rawPayload = (req.body?.rawPayload && typeof req.body.rawPayload === 'object' && !Array.isArray(req.body.rawPayload))
      ? req.body.rawPayload as Record<string, unknown>
      : { simulated: true, inboundContext: finalizedContext };
    const autoReply = await processAutoReply({
      inboxEvent: result.event,
      inboundContext: finalizedContext,
      rawPayload,
      traceId: result.traceId,
      source: 'simulator',
      policyState: effectivePolicy
    });
    const learning = autoReply.queued
      ? await runContinuousLearningIfEnabled({
          policyState: policy,
          inboxEventId: result.event.id,
          inboundContext: finalizedContext,
          traceId: result.traceId,
          skipMaterialization: true
        })
      : await runContinuousLearningIfEnabled({
          policyState: policy,
          inboxEventId: result.event.id,
          inboundContext: finalizedContext,
          traceId: result.traceId,
          inboxOnly: isInboxOnlyInboundMessage(result.event)
        });

    res.json({
      success: true,
      data: {
        accepted: true,
        policy: {
          ...effectivePolicy,
          allowed: true,
          reason: 'accepted'
        },
        autoReply,
        learning,
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
  await ensureSelfEvolutionSchema();
  await ensureIdentityLineageSchema();
  await ensureTopicLabSchema();
  await ensureAgentMediaSchema();
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
