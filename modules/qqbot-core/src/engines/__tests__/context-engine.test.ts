import { ContextEngine } from '../context-engine';

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

describe('ContextEngine', () => {
  it('builds context from real conversation queries instead of placeholder values', async () => {
    const database: any = {
      executeQuery: jest
        .fn()
        .mockResolvedValueOnce([
          {
            id: 'conv-2',
            user_id: 123456,
            user_message: '上一个问题',
            timestamp: new Date('2026-03-23T10:05:00Z'),
            response_time: 120,
            status: 'completed',
            group_id: 10001,
            created_at: new Date('2026-03-23T10:05:00Z'),
            updated_at: new Date('2026-03-23T10:05:00Z'),
            raw_request: JSON.stringify({
              time: 1711188300,
              message_type: 'group',
              post_type: 'message',
              message_id: 2002,
              user_id: 123456,
              message: '上一个问题',
              raw_message: '上一个问题',
              sender: {
                user_id: 123456,
                nickname: '李阿花',
                role: 'member',
                sex: 'unknown'
              },
              group_id: 10001,
              self_id: 1129974489
            })
          }
        ])
        .mockResolvedValueOnce([
          {
            message_count: 12,
            last_interaction: new Date('2026-03-23T10:05:00Z')
          }
        ])
        .mockResolvedValueOnce([
          {
            id: 'conv-latest',
            user_id: 123456,
            user_message: '当前消息',
            timestamp: new Date('2026-03-23T10:06:00Z'),
            response_time: 150,
            status: 'completed',
            group_id: 10001,
            created_at: new Date('2026-03-23T10:06:00Z'),
            updated_at: new Date('2026-03-23T10:06:00Z'),
            raw_request: JSON.stringify({
              time: 1711188360,
              message_type: 'group',
              post_type: 'message',
              message_id: 2003,
              user_id: 123456,
              message: '当前消息',
              raw_message: '当前消息',
              sender: {
                user_id: 123456,
                nickname: '李阿花',
                role: 'member',
                sex: 'unknown'
              },
              group_id: 10001,
              self_id: 1129974489
            })
          }
        ])
        .mockResolvedValueOnce([
          {
            message_count: 18,
            participant_count: 6
          }
        ])
    };

    const engine = new ContextEngine(database as any);
    const context = await engine.buildContext({
      time: 1711188360,
      post_type: 'message',
      message_type: 'group',
      sub_type: 'normal',
      message_id: 2003,
      user_id: 123456,
      message: '当前消息',
      raw_message: '当前消息',
      font: 14,
      sender: {
        user_id: 123456,
        nickname: '李阿花',
        sex: 'unknown',
        role: 'member'
      },
      group_id: 10001,
      self_id: 1129974489
    } as any);

    expect(context.recentMessages).toHaveLength(1);
    expect(context.userInfo).toMatchObject({
      user_id: 123456,
      nickname: '李阿花',
      recent_interaction_count: 12,
      is_frequent_user: true
    });
    expect(context.groupInfo).toMatchObject({
      group_id: 10001,
      participant_count: 6,
      recent_activity_level: 'medium'
    });
  });

  it('loads the current message by message id from conversations', async () => {
    const database: any = {
      executeQuery: jest
        .fn()
        .mockResolvedValueOnce([
          {
            id: 'conv-1',
            user_id: 654321,
            user_message: '你好',
            timestamp: new Date('2026-03-23T09:00:00Z'),
            response_time: 100,
            status: 'completed',
            group_id: null,
            message_id: 3001,
            created_at: new Date('2026-03-23T09:00:00Z'),
            updated_at: new Date('2026-03-23T09:00:00Z'),
            raw_request: JSON.stringify({
              time: 1711184400,
              message_type: 'private',
              post_type: 'message',
              message_id: 3001,
              user_id: 654321,
              message: '你好',
              raw_message: '你好',
              sender: {
                user_id: 654321,
                nickname: '测试用户',
                sex: 'unknown'
              },
              self_id: 1129974489
            })
          }
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            message_count: 1,
            last_interaction: new Date('2026-03-23T09:00:00Z')
          }
        ])
        .mockResolvedValueOnce([
          {
            id: 'conv-1',
            user_id: 654321,
            user_message: '你好',
            timestamp: new Date('2026-03-23T09:00:00Z'),
            response_time: 100,
            status: 'completed',
            group_id: null,
            message_id: 3001,
            created_at: new Date('2026-03-23T09:00:00Z'),
            updated_at: new Date('2026-03-23T09:00:00Z'),
            raw_request: JSON.stringify({
              time: 1711184400,
              message_type: 'private',
              post_type: 'message',
              message_id: 3001,
              user_id: 654321,
              message: '你好',
              raw_message: '你好',
              sender: {
                user_id: 654321,
                nickname: '测试用户',
                sex: 'unknown'
              },
              self_id: 1129974489
            })
          }
        ])
    };

    const engine = new ContextEngine(database as any);
    const context = await engine.buildContext('3001');

    expect(context.currentMessage.message_id).toBe(3001);
    expect(context.currentMessage.user_id).toBe(654321);
    expect(context.userInfo.nickname).toBe('测试用户');
  });
});
