import { DecisionEngine } from '../decision-engine';
import { QQMessage } from '../../types';

jest.mock('../../utils/logger', () => ({
  logger: {
    createModuleLogger: jest.fn(() => ({
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn()
    }))
  }
}));

describe('DecisionEngine directed reply rules', () => {
  it('treats a directed reply as a response-worthy message even when the body is minimal', async () => {
    const engine = new DecisionEngine({} as any, {
      gemini_api_keys: [],
      model_name: 'gemini-2.5-flash',
      authorized_user_id: 85178516,
      bot_qq_number: 1129974489
    });

    const currentMessage = {
      time: 1710980609,
      post_type: 'message',
      message_type: 'group',
      sub_type: 'normal',
      message_id: 470624550,
      user_id: 85178516,
      message: [
        { type: 'reply', data: { id: '470624549' } },
        { type: 'text', data: { text: '.' } }
      ],
      raw_message: '[CQ:reply,id=470624549].',
      font: 14,
      sender: {
        user_id: 85178516,
        nickname: '李阿花',
        sex: 'unknown',
        role: 'member'
      },
      group_id: 10001,
      self_id: 1129974489,
      normalized_text: '.',
      reply_intent_context: {
        message_kind: 'directed_reply' as const,
        semantic_anchor: {
          message_id: 470624549,
          text: '引用原文',
          sender_id: 714457117,
          sender_nickname: '小镜'
        },
        address_target: {
          type: 'quoted_sender' as const,
          user_id: 714457117,
          nickname: '小镜'
        },
        interpretation: 'The user is directly replying to the quoted sender and quoted content.'
      }
    } as QQMessage;

    const decision = await engine.analyzeMessage({
      currentMessage,
      historyMessages: [],
      contextSummary: ''
    });

    expect(decision.shouldRespond).toBe(true);
    expect(decision.reason).toContain('Directed reply detected');
    expect(decision.suggestedService).toBe('chat');
    expect(decision.attentionLevel).toBe('high');
    expect(decision.attentionReason).toBe('reply_context');
    expect(decision.suggestedNextStep).toBe('inspect_reply_anchor');
  });

  it('treats low-signal ambient group chatter as ignorable instead of forcing a reply', async () => {
    const engine = new DecisionEngine({} as any, {
      gemini_api_keys: [],
      model_name: 'gemini-2.5-flash',
      authorized_user_id: 85178516,
      bot_qq_number: 1129974489
    });

    const currentMessage = {
      time: 1710980609,
      post_type: 'message',
      message_type: 'group',
      sub_type: 'normal',
      message_id: 470624551,
      user_id: 55667788,
      message: '啥阴',
      raw_message: '啥阴',
      font: 14,
      sender: {
        user_id: 55667788,
        nickname: '路人',
        sex: 'unknown',
        role: 'member'
      },
      group_id: 10001,
      self_id: 1129974489,
      normalized_text: '啥阴'
    } as QQMessage;

    const decision = await engine.analyzeMessage({
      currentMessage,
      historyMessages: [],
      contextSummary: ''
    });

    expect(decision.shouldRespond).toBe(false);
    expect(decision.suggestedService).toBe('ignore');
    expect(decision.attentionLevel).toBe('low');
    expect(decision.attentionReason).toBe('ambient');
    expect(decision.suggestedNextStep).toBe('end');
  });
});
