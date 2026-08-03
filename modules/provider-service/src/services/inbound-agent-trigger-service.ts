import type { FinalizedInboundContext, InboxMessageRecord, SemanticInboundMessage } from '../types';

export type InboundAgentQueueTriggerReason =
  | 'group_mention_phone_notification'
  | 'group_message_phone_notification'
  | 'direct_phone_notification';
type GroupNotificationMode = 'all' | 'mentions_only';

export type InboundAgentQueueTriggerDecision = {
  shouldEnqueue: boolean;
  reason: InboundAgentQueueTriggerReason;
};

export type InboundAgentQueuePolicyState = {
  exists: boolean;
  isEnabled: boolean;
  continuousLearningEnabled: boolean;
  autoReplyEnabled: boolean;
  notificationMode: GroupNotificationMode;
  notificationAggregationSeconds: number;
};

export type InboundAgentQueueRuntimeStore = {
  enqueueSemanticMessage(message: SemanticInboundMessage): Promise<{
    queueId: number;
    status: string;
  }>;
  scheduleGroupNotificationAggregation(message: SemanticInboundMessage, seconds: number): Promise<{
    scheduled: boolean;
    reason?: string | null;
    dueAt?: string | Date | null;
    unreadDelta?: number | null;
  }>;
  logTimelineEvent(params: {
    traceId: string;
    eventType: string;
    eventName: string;
    eventPhase?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
};

export function decideInboundAgentQueueTrigger(
  message: Pick<InboxMessageRecord, 'chatType' | 'wasMentioned' | 'senderId'>,
  options: { directTriggerUserIds?: Set<string>; notificationMode?: GroupNotificationMode } = {}
): InboundAgentQueueTriggerDecision {
  if (message.chatType === 'group') {
    if (message.wasMentioned) {
      return {
        shouldEnqueue: true,
        reason: 'group_mention_phone_notification'
      };
    }
    if (options.notificationMode === 'mentions_only') {
      return {
        shouldEnqueue: false,
        reason: 'group_message_phone_notification'
      };
    }

    return {
      shouldEnqueue: true,
      reason: 'group_message_phone_notification'
    };
  }

  return {
    shouldEnqueue: true,
    reason: 'direct_phone_notification'
  };
}

export function shouldForceInboundAgentQueueTrigger(
  message: Pick<InboxMessageRecord, 'chatType' | 'wasMentioned' | 'senderId'>,
  options: { directTriggerUserIds?: Set<string> } = {}
) {
  if (message.chatType === 'group' && message.wasMentioned === true) {
    return true;
  }

  const senderId = String(message.senderId || '').trim();
  return message.chatType === 'direct'
    && senderId.length > 0
    && options.directTriggerUserIds?.has(senderId) === true;
}

// 「小腻是否够得着这条消息」的运行时唯一真理源。is_enabled 只是它的近似,在两个口上分岔:
// 关闭群里 @她 会被 applyForcedInboundAgentQueuePolicy 强制放行(她真会醒 → 可达);
// mentions_only 群的普通消息 shouldEnqueue=false(群是开的但递不到 → 不可达)。
// 被动召回的语料写入门与 notificationAllowed 共用这一个函数,防止两处判据漂移。
export function isReachableByXiaoni(
  policy: Pick<InboundAgentQueuePolicyState, 'autoReplyEnabled'>,
  decision: Pick<InboundAgentQueueTriggerDecision, 'shouldEnqueue'>
): boolean {
  return policy.autoReplyEnabled === true && decision.shouldEnqueue === true;
}

export function applyForcedInboundAgentQueuePolicy(
  policy: InboundAgentQueuePolicyState,
  message: Pick<InboxMessageRecord, 'chatType' | 'wasMentioned' | 'senderId'>,
  options: { directTriggerUserIds?: Set<string> } = {}
): InboundAgentQueuePolicyState {
  if (!shouldForceInboundAgentQueueTrigger(message, options)) {
    return policy;
  }

  return {
    ...policy,
    isEnabled: true,
    autoReplyEnabled: true
  };
}

function truncateNotificationPreview(text: string, maxChars = 20) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }
  const chars = Array.from(normalized);
  return chars.length > maxChars
    ? `${chars.slice(0, maxChars).join('')}...`
    : normalized;
}

export async function processInboundAgentQueueTrigger(params: {
  inboxEvent: InboxMessageRecord;
  inboxWindowMessages?: InboxMessageRecord[];
  inboundContext: FinalizedInboundContext;
  policyState?: InboundAgentQueuePolicyState;
  rawPayload: Record<string, unknown>;
  traceId: string;
  source: 'napcat' | 'simulator';
}, runtimeStoreService: InboundAgentQueueRuntimeStore) {
  const triggerDecision = decideInboundAgentQueueTrigger(params.inboxEvent, {
    notificationMode: params.policyState?.notificationMode
  });
  await runtimeStoreService.logTimelineEvent({
    traceId: params.traceId,
    eventType: 'phone_notification',
    eventName: 'build',
    eventPhase: 'start',
    metadata: {
      source: params.source,
      reason: triggerDecision.reason,
      chat_type: params.inboxEvent.chatType,
      session_key: params.inboxEvent.sessionKey,
      sender_id: params.inboxEvent.senderId,
      was_mentioned: params.inboxEvent.wasMentioned
    }
  });

  if (!triggerDecision.shouldEnqueue) {
    await runtimeStoreService.logTimelineEvent({
      traceId: params.traceId,
      eventType: 'phone_notification',
      eventName: 'enqueue',
      eventPhase: 'skip',
      metadata: {
        source: params.source,
        reason: 'group_notification_mentions_only',
        trigger_reason: triggerDecision.reason,
        session_key: params.inboxEvent.sessionKey,
        notification_mode: params.policyState?.notificationMode || 'all'
      }
    });

    return {
      attempted: true,
      queued: false,
      queueId: null,
      queueIds: [],
      queueStatus: 'skipped',
      queueStatuses: [],
      traceId: params.traceId,
      notificationCount: 0,
      triggerDecision,
      reason: 'group_notification_mentions_only'
    };
  }

  if (params.policyState?.autoReplyEnabled === false) {
    await runtimeStoreService.logTimelineEvent({
      traceId: params.traceId,
      eventType: 'phone_notification',
      eventName: 'enqueue',
      eventPhase: 'skip',
      metadata: {
        source: params.source,
        reason: 'auto_reply_disabled',
        trigger_reason: triggerDecision.reason,
        session_key: params.inboxEvent.sessionKey
      }
    });

    return {
      attempted: true,
      queued: false,
      queueId: null,
      queueIds: [],
      queueStatus: 'skipped',
      queueStatuses: [],
      traceId: params.traceId,
      notificationCount: 0,
      triggerDecision,
      reason: 'auto_reply_disabled'
    };
  }

  const notificationMessage = buildPhoneNotificationMessage(params.inboxEvent, {
    source: params.source,
    reason: triggerDecision.reason
  });
  const aggregationSeconds = Math.max(0, Number(params.policyState?.notificationAggregationSeconds || 0));
  if (
    params.inboxEvent.chatType === 'group'
    && params.inboxEvent.wasMentioned !== true
    && triggerDecision.reason === 'group_message_phone_notification'
    && aggregationSeconds > 0
  ) {
    await runtimeStoreService.logTimelineEvent({
      traceId: params.traceId,
      eventType: 'phone_notification',
      eventName: 'group_aggregation.schedule',
      eventPhase: 'start',
      metadata: {
        source: params.source,
        reason: triggerDecision.reason,
        notification_id: notificationMessage.messageSid,
        session_key: params.inboxEvent.sessionKey,
        aggregation_seconds: aggregationSeconds
      }
    });

    const aggregationResult = await runtimeStoreService.scheduleGroupNotificationAggregation(notificationMessage, aggregationSeconds);

    await runtimeStoreService.logTimelineEvent({
      traceId: params.traceId,
      eventType: 'phone_notification',
      eventName: 'group_aggregation.schedule',
      eventPhase: aggregationResult.scheduled ? 'end' : 'skip',
      metadata: {
        source: params.source,
        reason: aggregationResult.reason || 'scheduled',
        trigger_reason: triggerDecision.reason,
        notification_id: notificationMessage.messageSid,
        session_key: params.inboxEvent.sessionKey,
        aggregation_seconds: aggregationSeconds,
        due_at: aggregationResult.dueAt || null,
        unread_delta: aggregationResult.unreadDelta ?? null
      }
    });

    return {
      attempted: true,
      queued: false,
      queueId: null,
      queueIds: [],
      queueStatus: aggregationResult.scheduled ? 'scheduled' : 'skipped',
      queueStatuses: [],
      traceId: params.traceId,
      notificationCount: 0,
      triggerDecision,
      aggregationScheduled: aggregationResult.scheduled,
      reason: aggregationResult.reason || 'group_notification_aggregated'
    };
  }

  await runtimeStoreService.logTimelineEvent({
    traceId: params.traceId,
    eventType: 'phone_notification',
    eventName: 'enqueue',
    eventPhase: 'start',
    metadata: {
      source: params.source,
      reason: triggerDecision.reason,
      notification_id: notificationMessage.messageSid,
      session_key: params.inboxEvent.sessionKey
    }
  });

  const queueResult = await runtimeStoreService.enqueueSemanticMessage(notificationMessage);

  await runtimeStoreService.logTimelineEvent({
    traceId: params.traceId,
    eventType: 'phone_notification',
    eventName: 'enqueue',
    eventPhase: 'end',
    metadata: {
      queue_id: queueResult.queueId,
      queue_status: queueResult.status,
      reason: triggerDecision.reason
    }
  });

  return {
    attempted: true,
    queued: true,
    queueId: queueResult.queueId,
    queueIds: [queueResult.queueId],
    queueStatus: queueResult.status,
    queueStatuses: [queueResult.status],
    traceId: params.traceId,
    notificationCount: 1,
    triggerDecision
  };
}

function buildPhoneNotificationMessage(
  message: InboxMessageRecord,
  options: { source: 'napcat' | 'simulator'; reason: InboundAgentQueueTriggerReason }
): SemanticInboundMessage {
  const notificationId = `phone:${message.messageSid || message.id}`;
  const peerName = message.peerName || (message.chatType === 'group' ? `群 ${message.peerId}` : `QQ ${message.peerId}`);
  const sourcePreview = truncateNotificationPreview(message.bodyForAgent || message.rawBody || '');
  const summary = message.chatType === 'group'
    ? `${peerName} 有 1 条新 QQ 消息${message.wasMentioned ? '，其中有人 @ 小腻' : ''}。`
    : `${peerName} 发来 1 条 QQ 私聊。`;
  const preview = message.chatType === 'group' && !message.wasMentioned
    ? summary
    : (message.bodyForAgent || message.rawBody || message.commandBody || summary);
  const inboundContext: FinalizedInboundContext = {
    ...message.inboundContext,
    Body: preview,
    BodyForAgent: preview,
    BodyForCommands: '',
    RawBody: preview,
    CommandBody: '',
    Surface: 'phone_notification',
    MessageSid: notificationId,
    WasMentioned: message.wasMentioned,
    CommandAuthorized: false
  };

  return {
    traceId: message.traceId,
    source: 'phone_notification',
    messageId: message.id,
    messageSid: notificationId,
    dedupeKey: `phone_notification:${message.dedupeKey || message.messageSid || message.id}`,
    chatType: message.chatType,
    sessionKey: message.sessionKey,
    peerId: message.peerId,
    peerName: message.peerName,
    senderId: 'qq',
    senderName: 'QQ',
    accountId: message.accountId,
    bodyForAgent: preview,
    rawBody: preview,
    commandBody: '',
    wasMentioned: message.wasMentioned,
    receivedAt: message.receivedAt,
    messageTimestamp: message.messageTimestamp,
    rawPayload: {
      kind: 'phone_notification',
      app: 'qq',
      reason: options.reason,
      source: options.source,
      source_message_id: message.id,
      source_message_sid: message.messageSid,
      session_key: message.sessionKey,
      chat_type: message.chatType,
      peer_id: message.peerId,
      peer_name: message.peerName || null,
      latest_sender_id: message.senderId,
      latest_sender_name: message.senderName || null,
      latest_preview: sourcePreview,
      source_preview: sourcePreview,
      unread_delta: 1,
      direct_mentions: message.wasMentioned ? 1 : 0,
      latest_received_at: message.receivedAt
    },
    inboundContext,
    phoneNotification: {
      app: 'qq',
      notificationId,
      sessionKey: message.sessionKey,
      chatType: message.chatType,
      peerId: message.peerId,
      peerName: message.peerName || null,
      unreadDelta: 1,
      directMentions: message.wasMentioned ? 1 : 0,
      latestReceivedAt: message.receivedAt,
      reason: options.reason
    }
  };
}
