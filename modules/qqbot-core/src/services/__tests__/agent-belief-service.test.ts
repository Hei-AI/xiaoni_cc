import { extractBeliefCandidatesFromMessage } from '../agent-belief-service';
import type { QQMessage } from '../../types';

function createMessage(text: string, userId: number = 123456): QQMessage {
  return {
    post_type: 'message',
    message_type: 'private',
    sub_type: 'friend',
    user_id: userId,
    message_id: 1,
    raw_message: text,
    message: [],
    font: 14,
    sender: {
      user_id: userId
    },
    time: Math.floor(Date.now() / 1000),
    self_id: 1129974489,
    normalized_text: text
  } as unknown as QQMessage;
}

describe('extractBeliefCandidatesFromMessage', () => {
  it('extracts positive preferences', () => {
    const candidates = extractBeliefCandidatesFromMessage(
      createMessage('我喜欢蓝莓')
    );

    expect(candidates).toEqual([
      expect.objectContaining({
        subject_type: 'user',
        subject_id: '123456',
        belief_type: 'preference',
        belief_key: 'preference:蓝莓',
        claim: '用户喜欢蓝莓',
        polarity: 'positive',
        confidence: 0.78
      })
    ]);
  });

  it('extracts negative preferences before positive ones', () => {
    const candidates = extractBeliefCandidatesFromMessage(
      createMessage('我真的不喜欢香菜')
    );

    expect(candidates).toEqual([
      expect.objectContaining({
        belief_type: 'preference',
        belief_key: 'preference:香菜',
        claim: '用户不喜欢香菜',
        polarity: 'negative'
      })
    ]);
  });

  it('extracts identity and commitment statements from the same message', () => {
    const candidates = extractBeliefCandidatesFromMessage(
      createMessage('我是产品经理，我打算周末学Rust')
    );

    expect(candidates).toEqual([
      expect.objectContaining({
        belief_type: 'identity_fact',
        belief_key: 'identity:产品经理',
        claim: '用户是产品经理',
        polarity: 'neutral'
      }),
      expect.objectContaining({
        belief_type: 'commitment',
        belief_key: 'commitment:周末学Rust',
        claim: '用户打算周末学Rust',
        polarity: 'neutral'
      })
    ]);
  });

  it('returns no candidates when normalized_text is missing', () => {
    const candidates = extractBeliefCandidatesFromMessage({
      ...createMessage('我喜欢蓝莓'),
      normalized_text: undefined
    } as QQMessage);

    expect(candidates).toEqual([]);
  });
});
