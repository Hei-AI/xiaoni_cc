import { QQMessage } from '../../types';
import {
  extractNormalizedMessageText,
  parseReplyIntentContext
} from '../reply-intent';

describe('reply intent helpers', () => {
  const buildBaseMessage = (): QQMessage => ({
    time: 1710980609,
    post_type: 'message',
    message_type: 'group',
    sub_type: 'normal',
    message_id: 470624550,
    user_id: 85178516,
    message: [],
    raw_message: '',
    font: 14,
    sender: {
      user_id: 85178516,
      nickname: '李阿花',
      sex: 'unknown',
      role: 'member'
    },
    group_id: 10001,
    self_id: 1129974489
  });

  it('parses quoted sender as address target when there is no mention', () => {
    const message = {
      ...buildBaseMessage(),
      message: [
        { type: 'reply', data: { id: '470624549' } },
        { type: 'text', data: { text: '这什么情况' } }
      ],
      raw: {
        records: [
          {
            senderUin: '714457117',
            sendNickName: '小镜',
            elements: [
              {
                replyElement: {
                  sourceMsgText: '《阿花》→《鈰花》'
                }
              }
            ]
          }
        ]
      }
    } as QQMessage & { raw: any };

    const replyIntent = parseReplyIntentContext(message);

    expect(replyIntent).toEqual({
      message_kind: 'directed_reply',
      semantic_anchor: {
        message_id: 470624549,
        text: '《阿花》→《鈰花》',
        sender_id: 714457117,
        sender_nickname: '小镜'
      },
      address_target: {
        type: 'quoted_sender',
        user_id: 714457117,
        nickname: '小镜'
      },
      interpretation: 'The user is directly replying to the quoted sender and quoted content.'
    });
    expect(extractNormalizedMessageText(message)).toBe('这什么情况');
  });

  it('prefers mention target over quoted sender when both exist', () => {
    const message = {
      ...buildBaseMessage(),
      message: [
        { type: 'reply', data: { id: '470624549' } },
        { type: 'at', data: { qq: '1129974489' } },
        { type: 'text', data: { text: ' ' } }
      ],
      raw: {
        elements: [
          {
            textElement: {
              atUid: '1129974489',
              content: '@小腻'
            }
          }
        ],
        records: [
          {
            senderUin: '714457117',
            sendNickName: '小镜',
            elements: [
              {
                replyElement: {
                  sourceMsgText: '输入法这波属于现场做法'
                }
              }
            ]
          }
        ]
      }
    } as QQMessage & { raw: any };

    const replyIntent = parseReplyIntentContext(message);

    expect(replyIntent?.address_target).toEqual({
      type: 'mention',
      user_id: 1129974489,
      nickname: '小腻'
    });
    expect(replyIntent?.interpretation).toBe(
      'The user is replying to the quoted message, but is currently addressing the mentioned user.'
    );
    expect(extractNormalizedMessageText(message)).toBe('@1129974489');
  });

  it('falls back to sourceMsgTextElems when sourceMsgText is unavailable', () => {
    const message = {
      ...buildBaseMessage(),
      message: [
        { type: 'reply', data: { id: '470624549' } },
        { type: 'text', data: { text: '收到' } }
      ],
      raw: {
        records: [
          {
            senderUin: '714457117',
            sendNickName: '小镜',
            elements: [
              {
                replyElement: {
                  sourceMsgTextElems: [
                    { textElemContent: '《阿花》→' },
                    { textElemContent: '《鈰花》' }
                  ]
                }
              }
            ]
          }
        ]
      }
    } as QQMessage & { raw: any };

    const replyIntent = parseReplyIntentContext(message);

    expect(replyIntent?.semantic_anchor.text).toBe('《阿花》→《鈰花》');
    expect(replyIntent?.address_target.type).toBe('quoted_sender');
  });
});
