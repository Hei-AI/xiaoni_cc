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
    expect(formatted.plainText).toContain('--- 以下是未读消息 ---');
    expect(formatted.plainText).not.toContain('======已读消息========');
    expect(formatted.chatViewport?.source_key).toBe('user_123');
  });
});
