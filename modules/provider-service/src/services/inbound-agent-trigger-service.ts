import type { FinalizedInboundContext, InboxMessageRecord, SemanticInboundMessage } from '../types';

export type InboundAgentQueueTriggerReason =
  | 'group_mention_phone_notification'
  | 'group_message_phone_notification'
  | 'direct_phone_notification';

export type InboundAgentQueueTriggerDecision = {
  shouldEnqueue: boolean;
  reason: InboundAgentQueueTriggerReason;
};

export type InboundAgentQueuePolicyState = {
  exists: boolean;
  isEnabled: boolean;
  continuousLearningEnabled: boolean;
  autoReplyEnabled: boolean;
};

export type InboundAgentQueueRuntimeStore = {
  enqueueSemanticMessage(message: SemanticInboundMessage): Promise<{
    queueId: number;
    status: string;
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
  options: { directTriggerUserIds?: Set<string> } = {}
): InboundAgentQueueTriggerDecision {
  void options;
  if (message.chatType === 'group') {
    if (message.wasMentioned) {
      return {
        shouldEnqueue: true,
        reason: 'group_mention_phone_notification'
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
  void message;
  void options;
  return false;
}

export function applyForcedInboundAgentQueuePolicy(
  policy: InboundAgentQueuePolicyState,
  message: Pick<InboxMessageRecord, 'chatType' | 'wasMentioned' | 'senderId'>,
  options: { directTriggerUserIds?: Set<string> } = {}
): InboundAgentQueuePolicyState {
  void message;
  void options;
  return policy;
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
  const triggerDecision = decideInboundAgentQueueTrigger(params.inboxEvent);
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
  const summary = message.chatType === 'group'
    ? `${peerName} 有 1 条新 QQ 消息${message.wasMentioned ? '，其中有人 @ 小腻' : ''}。`
    : `${peerName} 发来 1 条 QQ 私聊。`;
  const inboundContext: FinalizedInboundContext = {
    ...message.inboundContext,
    Body: '',
    BodyForAgent: summary,
    BodyForCommands: '',
    RawBody: '',
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
    bodyForAgent: summary,
    rawBody: summary,
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
