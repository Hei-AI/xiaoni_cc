import test from 'node:test';
import assert from 'node:assert/strict';
import GroupParticipationService, { type RecentInboundMessage } from '../group-participation-service';
import type { FinalizedInboundContext } from '../../types';

function buildContext(overrides: Partial<FinalizedInboundContext> = {}): FinalizedInboundContext {
  return {
    Body: overrides.Body ?? '今天吃什么？',
    BodyForAgent: overrides.BodyForAgent ?? overrides.Body ?? '今天吃什么？',
    RawBody: overrides.RawBody ?? overrides.Body ?? '今天吃什么？',
    BodyForCommands: overrides.BodyForCommands ?? overrides.BodyForAgent ?? '今天吃什么？',
    CommandBody: overrides.CommandBody ?? overrides.BodyForAgent ?? '今天吃什么？',
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
    MessageSid: overrides.MessageSid ?? `msg_${Date.now()}`,
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

function buildService(options: {
  now?: () => number;
  recentMessages?: RecentInboundMessage[];
  embeddingEnabled?: boolean;
  embeddings?: number[][];
  embeddingError?: Error;
  llmJudge?: (input: any) => Promise<any>;
}) {
  return new GroupParticipationService({
    now: options.now,
    cooldownMs: 60_000,
    replyWindowMs: 600_000,
    maxRepliesPerWindow: 2,
    botNameCues: ['小腻'],
    recentMessageProvider: async () => options.recentMessages || [],
    embeddingService: {
      isEnabled: () => options.embeddingEnabled === true,
      createEmbeddings: async () => {
        if (options.embeddingError) {
          throw options.embeddingError;
        }
        return {
          object: 'list' as const,
          data: (options.embeddings || []).map((embedding, index) => ({
            object: 'embedding' as const,
            index,
            embedding
          })),
          model: 'test-embedding',
          usage: {
            prompt_tokens: 0,
            total_tokens: 0
          }
        };
      }
    },
    llmJudge: options.llmJudge
  });
}

test('replies immediately when explicitly mentioned', async () => {
  const service = buildService({});
  const result = await service.decide(buildContext({
    Body: '@小腻 你怎么看',
    BodyForAgent: '@小腻 你怎么看',
    WasMentioned: true
  }));

  assert.equal(result.decision, 'reply');
  assert.equal(result.reason, 'explicit_mention');
});

test('suppresses non-directed chatter during cooldown', async () => {
  let now = 1_000_000;
  const service = buildService({
    now: () => now
  });
  service.recordBotReply('qq:group:100', now);
  now += 15_000;

  const result = await service.decide(buildContext({
    Body: '今天好热',
    BodyForAgent: '今天好热'
  }));

  assert.equal(result.decision, 'ignore');
  assert.equal(result.reason, 'cooldown_active');
});

test('allows strong continuity when embeddings show near-identical topic', async () => {
  const service = buildService({
    embeddingEnabled: true,
    embeddings: [
      [1, 0, 0],
      [0.99, 0.01, 0],
      [0, 1, 0]
    ],
    recentMessages: [
      {
        messageSid: 'prev1',
        senderId: '20001',
        bodyForAgent: '昨天那家火锅店好吃吗',
        wasMentioned: false,
        replyToSender: null,
        replyToBody: null,
        receivedAtMs: Date.now() - 5_000
      },
      {
        messageSid: 'prev2',
        senderId: '20002',
        bodyForAgent: '我觉得一般',
        wasMentioned: false,
        replyToSender: null,
        replyToBody: null,
        receivedAtMs: Date.now() - 3_000
      }
    ]
  });

  const result = await service.decide(buildContext({
    Body: '那你还会再去吗？',
    BodyForAgent: '那你还会再去吗？',
    SenderId: '20001'
  }));

  assert.equal(result.decision, 'reply');
  assert.equal(result.reason, 'score_reply');
  assert.equal(result.usedEmbeddings, true);
});

test('falls back conservatively when embedding scoring fails', async () => {
  const service = buildService({
    embeddingEnabled: true,
    embeddingError: new Error('embedding offline'),
    recentMessages: [
      {
        messageSid: 'prev1',
        senderId: '20001',
        bodyForAgent: '昨晚那个电影还不错',
        wasMentioned: false,
        replyToSender: null,
        replyToBody: null,
        receivedAtMs: Date.now() - 10_000
      }
    ]
  });

  const result = await service.decide(buildContext({
    Body: '确实有点意思',
    BodyForAgent: '确实有点意思'
  }));

  assert.equal(result.decision, 'ignore');
  assert.equal(result.reason, 'embedding_error');
  assert.equal(result.conservativeFallback, true);
});

test('uses llm judge to promote ambiguous borderline cases into reply', async () => {
  const service = buildService({
    recentMessages: [
      {
        messageSid: 'prev1',
        senderId: '20001',
        bodyForAgent: '刚才不是在聊那家火锅店吗',
        wasMentioned: true,
        replyToSender: '1129974489',
        replyToBody: '我感觉一般般',
        receivedAtMs: Date.now() - 5_000
      }
    ],
    llmJudge: async () => ({
      decision: 'reply',
      confidence: 'medium',
      reason: 'natural_follow_up',
      modelName: 'judge-test'
    })
  });

  const result = await service.decide(buildContext({
    Body: '小腻 你觉得还要再去吗？',
    BodyForAgent: '小腻 你觉得还要再去吗？',
    RawBody: '小腻 你觉得还要再去吗？',
    ReplyToBody: '我感觉一般般'
  }));

  assert.equal(result.decision, 'reply');
  assert.equal(result.reason, 'llm_judge_reply');
  assert.equal(result.usedLlmJudge, true);
  assert.equal(result.metadata.path, 'llm_judge');
  assert.equal(result.metadata.llmJudgeModel, 'judge-test');
});

test('falls back to ignore when llm judge errors on ambiguous cases', async () => {
  const service = buildService({
    recentMessages: [
      {
        messageSid: 'prev1',
        senderId: '20001',
        bodyForAgent: '刚才不是在聊那家火锅店吗',
        wasMentioned: true,
        replyToSender: '1129974489',
        replyToBody: '我感觉一般般',
        receivedAtMs: Date.now() - 5_000
      }
    ],
    llmJudge: async () => {
      throw new Error('judge offline');
    }
  });

  const result = await service.decide(buildContext({
    Body: '小腻 你觉得还要再去吗？',
    BodyForAgent: '小腻 你觉得还要再去吗？',
    RawBody: '小腻 你觉得还要再去吗？',
    ReplyToBody: '我感觉一般般'
  }));

  assert.equal(result.decision, 'ignore');
  assert.equal(result.reason, 'llm_judge_error');
  assert.equal(result.usedLlmJudge, true);
  assert.equal(result.conservativeFallback, true);
});
