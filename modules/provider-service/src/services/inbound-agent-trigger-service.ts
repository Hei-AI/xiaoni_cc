import type { FinalizedInboundContext, InboxMessageRecord, SemanticInboundMessage } from '../types';

export type InboundAgentQueueTriggerReason =
  | 'group_mention_im_trigger'
  | 'direct_inbox_only'
  | 'group_unmentioned_inbox_only';

export type InboundAgentQueueTriggerDecision = {
  shouldEnqueue: boolean;
  reason: InboundAgentQueueTriggerReason;
};

export type InboundAgentQueueRuntimeStore = {
  buildSemanticInboundMessage(message: InboxMessageRecord, sourceContext: {
    source: string;
    rawPayload: Record<string, unknown>;
    inboundContext: FinalizedInboundContext;
  }): SemanticInboundMessage;
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

export function decideInboundAgentQueueTrigger(message: Pick<InboxMessageRecord, 'chatType' | 'wasMentioned'>): InboundAgentQueueTriggerDecision {
  if (message.chatType === 'group') {
    if (message.wasMentioned) {
      return {
        shouldEnqueue: true,
        reason: 'group_mention_im_trigger'
      };
    }

    return {
      shouldEnqueue: false,
      reason: 'group_unmentioned_inbox_only'
    };
  }

  return {
    shouldEnqueue: false,
    reason: 'direct_inbox_only'
  };
}

export async function processInboundAgentQueueTrigger(params: {
  inboxEvent: InboxMessageRecord;
  inboxWindowMessages?: InboxMessageRecord[];
  inboundContext: FinalizedInboundContext;
  rawPayload: Record<string, unknown>;
  traceId: string;
  source: 'napcat' | 'simulator';
}, runtimeStoreService: InboundAgentQueueRuntimeStore) {
  const triggerDecision = decideInboundAgentQueueTrigger(params.inboxEvent);

  if (!triggerDecision.shouldEnqueue) {
    await runtimeStoreService.logTimelineEvent({
      traceId: params.traceId,
      eventType: 'queue',
      eventName: 'enqueue',
      eventPhase: 'skipped',
      metadata: {
        source: params.source,
        reason: triggerDecision.reason,
        chat_type: params.inboxEvent.chatType,
        session_key: params.inboxEvent.sessionKey,
        was_mentioned: params.inboxEvent.wasMentioned
      }
    });

    return {
      attempted: true,
      queued: false,
      reason: triggerDecision.reason,
      traceId: params.traceId,
      triggerDecision
    };
  }

  const inboxWindowMessages = normalizeInboxWindowMessages(params.inboxEvent, params.inboxWindowMessages);

  await runtimeStoreService.logTimelineEvent({
    traceId: params.traceId,
    eventType: 'queue',
    eventName: 'normalize',
    eventPhase: 'start',
    metadata: {
      source: params.source,
      trigger_reason: triggerDecision.reason,
      chat_type: params.inboxEvent.chatType,
      session_key: params.inboxEvent.sessionKey,
      im_window_count: inboxWindowMessages.length
    }
  });

  const semanticMessages = inboxWindowMessages.map((message) => {
    const isTriggerMessage = message.id === params.inboxEvent.id || message.messageSid === params.inboxEvent.messageSid;
    return runtimeStoreService.buildSemanticInboundMessage(message, {
      source: message.source || params.source,
      rawPayload: isTriggerMessage ? params.rawPayload : message.rawPayload,
      inboundContext: message.inboundContext || params.inboundContext
    });
  });

  await runtimeStoreService.logTimelineEvent({
    traceId: params.traceId,
    eventType: 'queue',
    eventName: 'normalize',
    eventPhase: 'end',
    metadata: {
      source: params.source,
      trigger_reason: triggerDecision.reason,
      dedupe_keys: semanticMessages.map((message) => message.dedupeKey || null),
      im_window_count: semanticMessages.length
    }
  });

  await runtimeStoreService.logTimelineEvent({
    traceId: params.traceId,
    eventType: 'queue',
    eventName: 'enqueue',
    eventPhase: 'start',
    metadata: {
      message_sids: semanticMessages.map((message) => message.messageSid),
      source: params.source,
      trigger_reason: triggerDecision.reason,
      im_window_count: semanticMessages.length
    }
  });

  const queueResults = [];
  for (const semanticMessage of semanticMessages) {
    queueResults.push(await runtimeStoreService.enqueueSemanticMessage(semanticMessage));
  }

  await runtimeStoreService.logTimelineEvent({
    traceId: params.traceId,
    eventType: 'queue',
    eventName: 'enqueue',
    eventPhase: 'end',
    metadata: {
      queue_ids: queueResults.map((result) => result.queueId),
      queue_statuses: queueResults.map((result) => result.status),
      trigger_reason: triggerDecision.reason,
      im_window_count: semanticMessages.length
    }
  });

  const primaryQueueResult = queueResults[queueResults.length - 1] || queueResults[0];
  return {
    attempted: true,
    queued: true,
    queueId: primaryQueueResult?.queueId ?? 0,
    queueIds: queueResults.map((result) => result.queueId),
    queueStatus: primaryQueueResult?.status ?? 'pending',
    queueStatuses: queueResults.map((result) => result.status),
    traceId: params.traceId,
    imWindowMessageCount: semanticMessages.length,
    triggerDecision
  };
}

function normalizeInboxWindowMessages(triggerMessage: InboxMessageRecord, inboxWindowMessages?: InboxMessageRecord[]) {
  const messages = Array.isArray(inboxWindowMessages) && inboxWindowMessages.length > 0
    ? [...inboxWindowMessages]
    : [triggerMessage];
  const hasTrigger = messages.some((message) => {
    return message.id === triggerMessage.id || message.messageSid === triggerMessage.messageSid;
  });
  if (!hasTrigger) {
    messages.push(triggerMessage);
  }

  const seen = new Set<string>();
  return messages
    .sort((left, right) => {
      const byTime = String(left.receivedAt || '').localeCompare(String(right.receivedAt || ''));
      if (byTime !== 0) {
        return byTime;
      }
      return Number(left.id || 0) - Number(right.id || 0);
    })
    .filter((message) => {
      const key = message.messageSid || String(message.id);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}
