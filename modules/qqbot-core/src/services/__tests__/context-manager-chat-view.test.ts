import { ContextManager } from '../context-manager';
import { DatabaseManager } from '../database';
import { ChatViewportService } from '../chat-viewport-service';
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

describe('ContextManager chat viewport integration', () => {
  const countOccurrences = (source: string, needle: string): number =>
    source.split(needle).length - 1;

  it('should filter current message from private history when building message context', async () => {
    const database = {
      getPrivateMessageHistoryRecords: jest.fn().mockResolvedValue([
        {
          id: 1,
          conversation_id: null,
          message_id: 1001,
          user_id: 123,
          sender_id: 123,
          sender_role: 'user',
          content: '当前消息',
          content_type: 'text',
          sent_at: new Date('2026-03-21T00:00:00.000Z'),
          created_at: new Date(),
          updated_at: new Date()
        },
        {
          id: 2,
          conversation_id: null,
          message_id: 999,
          user_id: 123,
          sender_id: 1129974489,
          sender_role: 'bot',
          content: '上一条回复',
          content_type: 'text',
          sent_at: new Date('2026-03-20T23:59:00.000Z'),
          created_at: new Date(),
          updated_at: new Date()
        }
      ]),
      executeQuery: jest.fn().mockResolvedValue([{ message_count: 2 }])
    } as unknown as DatabaseManager;

    const manager = new ContextManager(database);

    const context = await manager.buildMessageContext({
      message_type: 'private',
      user_id: 123,
      message_id: 1001,
      message: '当前消息',
      raw_message: '当前消息',
      sender: { user_id: 123, nickname: '李阿花' }
    } as QQMessage);

    expect(context.historyMessages).toHaveLength(1);
    expect(context.historyMessages[0].message_id).toBe(999);
  });

  it('should render viewport transcript instead of read/unread sections', async () => {
    const database = {} as unknown as DatabaseManager;
    const viewportService = {
      buildViewportForMessage: jest.fn().mockResolvedValue({
        header_lines: ['当前窗口：与 QQ 123 的私聊', '右上角未读：2 条'],
        divider_before_history_id: 2,
        visible_messages: [
          {
            history_id: 1,
            message_id: 10,
            user_id: 123,
            sender_id: 1129974489,
            sender_role: 'bot',
            content: '在',
            content_type: 'text',
            sent_at: new Date('2026-03-20T23:59:00.000Z'),
            raw_payload: {}
          },
          {
            history_id: 2,
            message_id: 11,
            user_id: 123,
            sender_id: 123,
            sender_role: 'user',
            content: '不可用？',
            content_type: 'text',
            sent_at: new Date('2026-03-21T00:00:00.000Z'),
            raw_payload: { sender: { nickname: '李阿花' } }
          }
        ],
        cursor: {
          source_key: 'user_123',
          source_type: 'private',
          history_table: 'private_message_history',
          source_id: 123,
          anchor: 'latest',
          top_history_id: 1,
          bottom_history_id: 2,
          unread_count: 2,
          earlier_unread_count: 0,
          visible_count: 2
        }
      })
    } as unknown as ChatViewportService;

    const manager = new ContextManager(database, viewportService);

    const formatted = await manager.formatContextForAI({
      currentMessage: {
        message_type: 'private',
        user_id: 123,
        message_id: 11,
        message: '不可用？',
        raw_message: '不可用？',
        sender: { user_id: 123, nickname: '李阿花' }
      } as QQMessage,
      historyMessages: [],
      contextSummary: 'summary'
    });

    expect(formatted.plainText).toContain('当前窗口：与 QQ 123 的私聊');
    expect(formatted.plainText).toContain('- message:');
    expect(formatted.plainText).toContain('message_id=10');
    expect(formatted.plainText).toContain('sender_id=1129974489');
    expect(formatted.plainText).toContain('sender_name=我');
    expect(formatted.plainText).toContain('mentions=[]');
    expect(formatted.plainText).toContain('content_type=text');
    expect(formatted.plainText).toContain('--- 当前消息 ---');
    expect(formatted.chatViewport?.source_key).toBe('user_123');
  });

  it('should render directed reply context as structured blocks without duplicating the current message', async () => {
    const database = {} as unknown as DatabaseManager;
    const viewportService = {
      buildViewportForMessage: jest.fn().mockResolvedValue({
        header_lines: ['当前窗口：群聊 10001', '右上角未读：1 条'],
        divider_before_history_id: 2,
        visible_messages: [
          {
            history_id: 1,
            message_id: 470624540,
            group_id: 10001,
            sender_id: 714457117,
            sender_role: 'user',
            content: '上一条消息',
            content_type: 'text',
            sent_at: new Date('2026-03-20T23:59:00.000Z'),
            raw_payload: { sender: { nickname: '小镜' } }
          },
          {
            history_id: 2,
            message_id: 470624550,
            group_id: 10001,
            sender_id: 85178516,
            sender_role: 'user',
            content: '@1129974489',
            content_type: 'text',
            sent_at: new Date('2026-03-21T00:00:00.000Z'),
            raw_payload: { sender: { nickname: '李阿花' } }
          }
        ],
        cursor: {
          source_key: 'group_10001',
          source_type: 'group',
          history_table: 'group_message_history',
          source_id: 10001,
          anchor: 'latest',
          top_history_id: 1,
          bottom_history_id: 2,
          unread_count: 1,
          earlier_unread_count: 0,
          visible_count: 2
        }
      })
    } as unknown as ChatViewportService;

    const manager = new ContextManager(database, viewportService);

    const formatted = await manager.formatContextForAI({
      currentMessage: {
        time: 1710980609,
        post_type: 'message',
        message_type: 'group',
        sub_type: 'normal',
        user_id: 85178516,
        group_id: 10001,
        message_id: 470624550,
        message: [
          { type: 'reply', data: { id: '470624549' } },
          { type: 'at', data: { qq: '1129974489' } }
        ],
        raw_message: '[CQ:reply,id=470624549][CQ:at,qq=1129974489]',
        font: 14,
        sender: { user_id: 85178516, nickname: '李阿花', sex: 'unknown', role: 'member' },
        self_id: 1129974489,
        reply_intent_context: {
          message_kind: 'directed_reply',
          semantic_anchor: {
            message_id: 470624549,
            sender_id: 714457117,
            sender_nickname: '小镜',
            text: '《阿花》→《鈰花》'
          },
          address_target: {
            type: 'mention',
            user_id: 1129974489,
            nickname: '小腻'
          },
          interpretation: 'The user is replying to the quoted message, but is currently addressing the mentioned user.'
        },
        normalized_text: '@1129974489'
      } as QQMessage,
      historyMessages: [],
      contextSummary: ''
    });

    expect(formatted.plainText).toContain('message_id=470624540');
    expect(formatted.plainText).toContain('sender_id=714457117');
    expect(formatted.plainText).toContain('sender_name=小镜');
    expect(formatted.plainText).toContain('--- 当前消息 ---');
    expect(formatted.plainText).toContain('message_id=470624550');
    expect(formatted.plainText).toContain('sender_id=85178516');
    expect(formatted.plainText).toContain('mentions=["1129974489"]');
    expect(formatted.plainText).toContain('reply_ref.message_id=470624549');
    expect(formatted.plainText).toContain('reply_ref.sender_id=714457117');
    expect(formatted.plainText).toContain('reply_ref.sender_name=小镜');
    expect(formatted.plainText).toContain('reply_ref.text=《阿花》→《鈰花》');
    expect(formatted.plainText).toContain('- current_message_reply_intent:');
    expect(formatted.plainText).toContain('primary_addressee_user_id=1129974489');
    expect(formatted.plainText).toContain('primary_addressee_reason=explicit_mention_in_current_message');
    expect(countOccurrences(formatted.plainText, '@1129974489')).toBe(1);
    expect(countOccurrences(formatted.plainText, '《阿花》→《鈰花》')).toBe(1);
  });
});
