import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyForcedInboundAgentQueuePolicy,
  processInboundAgentQueueTrigger,
  shouldForceInboundAgentQueueTrigger,
  type InboundAgentQueueRuntimeStore
} from '../inbound-agent-trigger-service';
import type { FinalizedInboundContext, InboxMessageRecord, SemanticInboundMessage } from '../../types';

class FakeRuntimeStore implements InboundAgentQueueRuntimeStore {
  readonly timelineEvents: Array<Record<string, unknown>> = [];
  readonly enqueuedMessages: SemanticInboundMessage[] = [];

  buildSemanticInboundMessage(message: InboxMessageRecord, sourceContext: {
    source: string;
    rawPayload: Record<string, unknown>;
    inboundContext: FinalizedInboundContext;
  }): SemanticInboundMessage {
    return {
      traceId: message.traceId,
      source: sourceContext.source,
      messageId: message.id,
      messageSid: message.messageSid,
      dedupeKey: message.dedupeKey,
      chatType: message.chatType,
      sessionKey: message.sessionKey,
      peerId: message.peerId,
      peerName: message.peerName,
      senderId: message.senderId,
      senderName: message.senderName,
      accountId: message.accountId,
      bodyForAgent: message.bodyForAgent,
      rawBody: message.rawBody,
      commandBody: message.commandBody,
      wasMentioned: message.wasMentioned,
      receivedAt: message.receivedAt,
      messageTimestamp: message.messageTimestamp,
      rawPayload: sourceContext.rawPayload,
      inboundContext: sourceContext.inboundContext
    };
  }

  async enqueueSemanticMessage(message: SemanticInboundMessage) {
    this.enqueuedMessages.push(message);
    return {
      queueId: this.enqueuedMessages.length,
      status: 'pending'
    };
  }

  async logTimelineEvent(params: Record<string, unknown>) {
    this.timelineEvents.push(params);
  }
}

function buildContext(overrides: Partial<FinalizedInboundContext> = {}): FinalizedInboundContext {
  const chatType = overrides.ChatType === 'direct' ? 'direct' : 'group';
  const sessionKey = chatType === 'direct' ? 'qq:direct:1129974489:20001' : 'qq:group:100';
  const body = overrides.Body ?? 'hello';

  return {
    Body: body,
    BodyForAgent: overrides.BodyForAgent ?? body,
    RawBody: overrides.RawBody ?? body,
    CommandBody: overrides.CommandBody ?? body,
    BodyForCommands: overrides.BodyForCommands ?? overrides.CommandBody ?? body,
    From: overrides.From ?? (chatType === 'direct' ? 'qq:20001' : 'qq:group:100'),
    To: overrides.To ?? (chatType === 'direct' ? 'user:20001' : 'group:100'),
    SessionKey: overrides.SessionKey ?? sessionKey,
    AccountId: overrides.AccountId ?? '1129974489',
    MessageSid: overrides.MessageSid ?? 'msg-1',
    ChatType: chatType,
    ConversationLabel: overrides.ConversationLabel ?? (chatType === 'direct' ? 'user 20001' : 'group 100'),
    GroupSubject: overrides.GroupSubject,
    SenderName: overrides.SenderName ?? 'alice',
    SenderId: overrides.SenderId ?? '20001',
    SenderUsername: overrides.SenderUsername ?? 'alice',
    Timestamp: overrides.Timestamp ?? 1_700_000_000,
    Provider: overrides.Provider ?? 'qq',
    Surface: overrides.Surface ?? 'test',
    WasMentioned: overrides.WasMentioned ?? false,
    MentionedUsers: overrides.MentionedUsers,
    CommandAuthorized: overrides.CommandAuthorized ?? false,
    OriginatingChannel: overrides.OriginatingChannel ?? 'qq',
    OriginatingTo: overrides.OriginatingTo ?? (chatType === 'direct' ? 'user:20001' : 'group:100'),
    NativeChannelId: overrides.NativeChannelId ?? (chatType === 'direct' ? '20001' : '100')
  };
}

function buildInbox(overrides: Partial<InboxMessageRecord> = {}): InboxMessageRecord {
  const context = overrides.inboundContext ?? buildContext({
    ChatType: overrides.chatType ?? 'group',
    WasMentioned: overrides.wasMentioned ?? false,
    SessionKey: overrides.sessionKey
  });
  const chatType = overrides.chatType ?? (context.ChatType === 'direct' ? 'direct' : 'group');
  const sessionKey = overrides.sessionKey ?? context.SessionKey ?? 'qq:group:100';
  const body = overrides.bodyForAgent ?? context.BodyForAgent;

  return {
    id: overrides.id ?? 101,
    traceId: overrides.traceId ?? 'trace-1',
    source: overrides.source ?? 'napcat',
    messageSid: overrides.messageSid ?? context.MessageSid ?? 'msg-1',
    dedupeKey: overrides.dedupeKey ?? `napcat:${context.MessageSid ?? 'msg-1'}`,
    chatType,
    sessionKey,
    peerId: overrides.peerId ?? (chatType === 'direct' ? '20001' : '100'),
    peerName: overrides.peerName ?? context.ConversationLabel,
    senderId: overrides.senderId ?? context.SenderId ?? '20001',
    senderName: overrides.senderName ?? context.SenderName,
    accountId: overrides.accountId ?? context.AccountId ?? '1129974489',
    isRead: overrides.isRead ?? false,
    readAt: overrides.readAt ?? null,
    receivedAt: overrides.receivedAt ?? '2026-05-30T00:00:00.000Z',
    messageTimestamp: overrides.messageTimestamp ?? null,
    bodyForAgent: body,
    rawBody: overrides.rawBody ?? context.RawBody ?? body,
    commandBody: overrides.commandBody ?? context.CommandBody ?? body,
    wasMentioned: overrides.wasMentioned ?? Boolean(context.WasMentioned),
    replyToId: overrides.replyToId,
    replyToBody: overrides.replyToBody,
    replyToSender: overrides.replyToSender,
    rawPayload: overrides.rawPayload ?? {},
    inboundContext: context
  };
}

async function runTrigger(inboxEvent: InboxMessageRecord) {
  const store = new FakeRuntimeStore();
  const result = await processInboundAgentQueueTrigger({
    inboxEvent,
    inboundContext: inboxEvent.inboundContext,
    rawPayload: { test: true },
    traceId: inboxEvent.traceId,
    source: 'napcat'
  }, store);

  return { result, store };
}

test('keeps unmentioned group messages inbox-only and does not enqueue', async () => {
  const { result, store } = await runTrigger(buildInbox({
    chatType: 'group',
    wasMentioned: false
  }));

  assert.equal(result.queued, false);
  assert.equal(result.reason, 'group_unmentioned_inbox_only');
  assert.equal(store.enqueuedMessages.length, 0);
  assert.equal(store.timelineEvents.length, 1);
  assert.equal(store.timelineEvents[0]?.eventName, 'enqueue');
  assert.equal(store.timelineEvents[0]?.eventPhase, 'skipped');
});

test('enqueues mentioned group messages as IM read triggers', async () => {
  const context = buildContext({
    Body: '@xiaoni hello',
    BodyForAgent: '@xiaoni hello',
    CommandBody: 'hello',
    WasMentioned: true,
    ChatType: 'group'
  });
  const { result, store } = await runTrigger(buildInbox({
    chatType: 'group',
    wasMentioned: true,
    inboundContext: context
  }));

  assert.equal(result.queued, true);
  assert.equal(result.triggerDecision.reason, 'group_mention_im_trigger');
  assert.equal(store.enqueuedMessages.length, 1);
  assert.equal(store.enqueuedMessages[0]?.chatType, 'group');
  assert.equal(store.enqueuedMessages[0]?.sessionKey, 'qq:group:100');
  assert.equal(store.enqueuedMessages[0]?.wasMentioned, true);
});

test('enqueues the claimed unread inbox window when mention opens group IM', async () => {
  const earlierContext = buildContext({
    Body: '前面普通未读',
    BodyForAgent: '前面普通未读',
    CommandBody: '前面普通未读',
    WasMentioned: false,
    ChatType: 'group',
    MessageSid: 'msg-earlier'
  });
  const triggerContext = buildContext({
    Body: '@xiaoni 看到前面了吗',
    BodyForAgent: '@xiaoni 看到前面了吗',
    CommandBody: '看到前面了吗',
    WasMentioned: true,
    ChatType: 'group',
    MessageSid: 'msg-trigger'
  });
  const earlier = buildInbox({
    id: 100,
    messageSid: 'msg-earlier',
    dedupeKey: 'napcat:msg-earlier',
    chatType: 'group',
    wasMentioned: false,
    bodyForAgent: '前面普通未读',
    rawBody: '前面普通未读',
    commandBody: '前面普通未读',
    receivedAt: '2026-05-30T00:00:00.000Z',
    inboundContext: earlierContext
  });
  const trigger = buildInbox({
    id: 101,
    messageSid: 'msg-trigger',
    dedupeKey: 'napcat:msg-trigger',
    chatType: 'group',
    wasMentioned: true,
    bodyForAgent: '@xiaoni 看到前面了吗',
    rawBody: '@xiaoni 看到前面了吗',
    commandBody: '看到前面了吗',
    receivedAt: '2026-05-30T00:00:01.000Z',
    inboundContext: triggerContext
  });
  const store = new FakeRuntimeStore();

  const result = await processInboundAgentQueueTrigger({
    inboxEvent: trigger,
    inboxWindowMessages: [earlier, trigger],
    inboundContext: trigger.inboundContext,
    rawPayload: { trigger: true },
    traceId: trigger.traceId,
    source: 'napcat'
  }, store);

  assert.equal(result.queued, true);
  assert.equal(result.imWindowMessageCount, 2);
  assert.deepEqual(result.queueIds, [1, 2]);
  assert.equal(store.enqueuedMessages.length, 2);
  assert.equal(store.enqueuedMessages[0]?.messageSid, 'msg-earlier');
  assert.equal(store.enqueuedMessages[0]?.bodyForAgent, '前面普通未读');
  assert.equal(store.enqueuedMessages[0]?.wasMentioned, false);
  assert.equal(store.enqueuedMessages[1]?.messageSid, 'msg-trigger');
  assert.equal(store.enqueuedMessages[1]?.bodyForAgent, '@xiaoni 看到前面了吗');
  assert.equal(store.enqueuedMessages[1]?.wasMentioned, true);
});

test('keeps direct messages inbox-only until xiaoni actively opens IM', async () => {
  const context = buildContext({
    ChatType: 'direct',
    SessionKey: 'qq:direct:1129974489:20001',
    WasMentioned: false
  });
  const { result, store } = await runTrigger(buildInbox({
    chatType: 'direct',
    sessionKey: 'qq:direct:1129974489:20001',
    wasMentioned: false,
    inboundContext: context
  }));

  assert.equal(result.queued, false);
  assert.equal(result.reason, 'direct_inbox_only');
  assert.equal(store.enqueuedMessages.length, 0);
  assert.equal(store.timelineEvents.length, 1);
  assert.equal(store.timelineEvents[0]?.eventPhase, 'skipped');
});

test('enqueues private messages from authorized user as IM triggers', async () => {
  const earlierContext = buildContext({
    ChatType: 'direct',
    SessionKey: 'qq:direct:1129974489:85178516',
    SenderId: '85178516',
    MessageSid: 'dm-earlier',
    Body: '前面一句',
    BodyForAgent: '前面一句'
  });
  const triggerContext = buildContext({
    ChatType: 'direct',
    SessionKey: 'qq:direct:1129974489:85178516',
    SenderId: '85178516',
    MessageSid: 'dm-trigger',
    Body: '现在这句要让小腻看到',
    BodyForAgent: '现在这句要让小腻看到'
  });
  const earlier = buildInbox({
    id: 201,
    messageSid: 'dm-earlier',
    dedupeKey: 'napcat:dm-earlier',
    chatType: 'direct',
    sessionKey: 'qq:direct:1129974489:85178516',
    senderId: '85178516',
    peerId: '85178516',
    bodyForAgent: '前面一句',
    inboundContext: earlierContext
  });
  const trigger = buildInbox({
    id: 202,
    messageSid: 'dm-trigger',
    dedupeKey: 'napcat:dm-trigger',
    chatType: 'direct',
    sessionKey: 'qq:direct:1129974489:85178516',
    senderId: '85178516',
    peerId: '85178516',
    bodyForAgent: '现在这句要让小腻看到',
    inboundContext: triggerContext
  });
  const store = new FakeRuntimeStore();

  const result = await processInboundAgentQueueTrigger({
    inboxEvent: trigger,
    inboxWindowMessages: [earlier, trigger],
    inboundContext: trigger.inboundContext,
    rawPayload: { trigger: true },
    traceId: trigger.traceId,
    source: 'napcat'
  }, store);

  assert.equal(result.queued, true);
  assert.equal(result.triggerDecision.reason, 'direct_authorized_user_im_trigger');
  assert.equal(result.imWindowMessageCount, 2);
  assert.deepEqual(store.enqueuedMessages.map((message) => message.messageSid), ['dm-earlier', 'dm-trigger']);
  assert.equal(store.enqueuedMessages[1]?.chatType, 'direct');
  assert.equal(store.enqueuedMessages[1]?.senderId, '85178516');
  assert.equal(store.enqueuedMessages[1]?.bodyForAgent, '现在这句要让小腻看到');
});

test('forces private authorized user through disabled receive and auto-reply policy', () => {
  const disabledPolicy = {
    exists: true,
    isEnabled: false,
    continuousLearningEnabled: false,
    autoReplyEnabled: false
  };
  const message = {
    chatType: 'direct' as const,
    wasMentioned: false,
    senderId: '85178516'
  };

  assert.equal(shouldForceInboundAgentQueueTrigger(message), true);
  assert.deepEqual(applyForcedInboundAgentQueuePolicy(disabledPolicy, message), {
    exists: true,
    isEnabled: true,
    continuousLearningEnabled: false,
    autoReplyEnabled: true
  });
});

test('does not force non-authorized private users through disabled policy', () => {
  const disabledPolicy = {
    exists: true,
    isEnabled: false,
    continuousLearningEnabled: false,
    autoReplyEnabled: false
  };
  const message = {
    chatType: 'direct' as const,
    wasMentioned: false,
    senderId: '20001'
  };

  assert.equal(shouldForceInboundAgentQueueTrigger(message), false);
  assert.equal(applyForcedInboundAgentQueuePolicy(disabledPolicy, message), disabledPolicy);
});
