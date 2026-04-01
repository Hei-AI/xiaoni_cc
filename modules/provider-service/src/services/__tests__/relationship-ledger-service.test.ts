import test from 'node:test';
import assert from 'node:assert/strict';
import RelationshipLedgerService, { type RecentLedgerInboundMessage } from '../relationship-ledger-service';
import type { FinalizedInboundContext } from '../../types';

function buildContext(overrides: Partial<FinalizedInboundContext> = {}): FinalizedInboundContext {
  return {
    Body: overrides.Body ?? '今天继续吃火锅？',
    BodyForAgent: overrides.BodyForAgent ?? overrides.Body ?? '今天继续吃火锅？',
    RawBody: overrides.RawBody ?? overrides.Body ?? '今天继续吃火锅？',
    BodyForCommands: overrides.BodyForCommands ?? overrides.BodyForAgent ?? '今天继续吃火锅？',
    CommandBody: overrides.CommandBody ?? overrides.BodyForAgent ?? '今天继续吃火锅？',
    From: overrides.From ?? 'qq:group:100',
    To: overrides.To ?? 'group:100',
    SessionKey: overrides.SessionKey ?? 'qq:group:100',
    AccountId: overrides.AccountId ?? '1129974489',
    ChatType: overrides.ChatType ?? 'group',
    ConversationLabel: overrides.ConversationLabel ?? '群 100',
    GroupSubject: overrides.GroupSubject ?? '群 100',
    SenderName: overrides.SenderName ?? 'alice',
    SenderId: overrides.SenderId ?? '20001',
    SenderUsername: overrides.SenderUsername ?? 'alice',
    Provider: overrides.Provider ?? 'qq',
    Surface: overrides.Surface ?? 'test',
    MessageSid: overrides.MessageSid ?? 'msg_1',
    ReplyToId: overrides.ReplyToId,
    ReplyToBody: overrides.ReplyToBody,
    ReplyToSender: overrides.ReplyToSender,
    ReplyToSenderId: overrides.ReplyToSenderId,
    ReplyToSenderName: overrides.ReplyToSenderName,
    ReplyToIsQuote: overrides.ReplyToIsQuote,
    Timestamp: overrides.Timestamp ?? Date.now(),
    WasMentioned: overrides.WasMentioned ?? false,
    MentionedUsers: overrides.MentionedUsers,
    CommandAuthorized: false,
    OriginatingChannel: overrides.OriginatingChannel ?? 'qq',
    OriginatingTo: overrides.OriginatingTo ?? 'group:100',
    NativeChannelId: overrides.NativeChannelId ?? '100'
  };
}

test('records reply_chain_success when inbound context replies to prior message', async () => {
  const created: any[] = [];
  const service = new RelationshipLedgerService({
    appendEvent: async (input: any) => {
      created.push(input);
      return input;
    },
    recentMessageProvider: async () => [],
    lookupMessageBySid: async () => ({ id: 77 })
  });

  const result = await service.recordFromInboundContext(buildContext({
    MessageSid: 'msg_2',
    ReplyToId: 'msg_1',
    ReplyToBody: '昨天的那句梗',
    ReplyToSenderId: '30001',
    ReplyToSenderName: 'bob',
    ReplyToIsQuote: true
  }), {
    currentMessageId: 102
  });

  assert.deepEqual(result.created, ['reply_chain_success']);
  assert.equal(created[0]?.eventType, 'reply_chain_success');
  assert.deepEqual(created[0]?.sourceMessageIds, [77, 102]);
});

test('records topic_reactivated when current message overlaps recent other-speaker topic', async () => {
  const created: any[] = [];
  const recentMessages: RecentLedgerInboundMessage[] = [
    {
      messageId: 91,
      messageSid: 'prev_1',
      senderId: '30001',
      senderName: 'bob',
      bodyForAgent: '昨天说的火锅店真的不错',
      wasMentioned: false,
      receivedAtMs: Date.now() - 5000
    }
  ];
  const service = new RelationshipLedgerService({
    appendEvent: async (input: any) => {
      created.push(input);
      return input;
    },
    recentMessageProvider: async () => recentMessages
  });

  const result = await service.recordFromInboundContext(buildContext({
    MessageSid: 'msg_3',
    BodyForAgent: '今天继续吃火锅？'
  }), {
    currentMessageId: 103
  });

  assert.equal(result.created.includes('topic_reactivated'), true);
  assert.equal(created.some((item) => item.eventType === 'topic_reactivated'), true);
  assert.deepEqual(created[0]?.sourceMessageIds, [91, 103]);
});

test('records shared_joke_formed when same sender repeats a distinctive phrase', async () => {
  const created: any[] = [];
  const recentMessages: RecentLedgerInboundMessage[] = [
    {
      messageId: 92,
      messageSid: 'prev_2',
      senderId: '20001',
      senderName: 'alice',
      bodyForAgent: '电子包浆这个词太好笑了',
      wasMentioned: false,
      receivedAtMs: Date.now() - 3000
    }
  ];
  const service = new RelationshipLedgerService({
    appendEvent: async (input: any) => {
      created.push(input);
      return input;
    },
    recentMessageProvider: async () => recentMessages
  });

  const result = await service.recordFromInboundContext(buildContext({
    MessageSid: 'msg_4',
    SenderId: '20001',
    BodyForAgent: '这个群又开始电子包浆了'
  }), {
    currentMessageId: 104
  });

  assert.equal(result.created.includes('shared_joke_formed'), true);
  assert.equal(created.some((item) => item.eventType === 'shared_joke_formed'), true);
  assert.deepEqual(created[0]?.sourceMessageIds, [92, 104]);
});
