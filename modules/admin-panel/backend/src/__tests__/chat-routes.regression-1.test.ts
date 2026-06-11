import express from 'express';
import request from 'supertest';
import winston from 'winston';
import { createChatRoutes } from '../routes/chat-routes';

function createLogger(): winston.Logger {
  return winston.createLogger({ silent: true });
}

function createDatabaseMock() {
  return {
    executeQuery: jest.fn(),
    getPrivateChatSettingById: jest.fn(),
    upsertPrivateChatSettings: jest.fn(),
    upsertGroupChatSettings: jest.fn(),
    getGroupChatSettingById: jest.fn(),
  };
}

function createApp(database: ReturnType<typeof createDatabaseMock>) {
  const app = express();
  app.use(express.json());
  app.use('/api', createChatRoutes(database as never, createLogger()));
  return app;
}

describe('chat settings route regressions', () => {
  it('does not require prompt binding when rendering private auto-reply settings', async () => {
    const database = createDatabaseMock();
    database.executeQuery
      .mockResolvedValueOnce([
        {
          user_id: 999999991,
          nickname: 'stale-user',
          last_conversation_time: null,
          status: 'pending',
          total_conversations: '0',
          successful_replies: '0',
          failed_replies: '0',
          success_rate: '0',
          avg_response_time: '0ms',
          is_enabled: 1,
          continuous_learning_enabled: 1,
          auto_reply_enabled: 0,
          transcript_compact_offset: 6,
          user_notes: null,
          agent_prompt_id: null,
        }
      ])
      .mockResolvedValueOnce([{ total: '1' }])
      .mockResolvedValueOnce([
        {
          user_id: 999999991,
          username: 'stale-user',
          is_enabled: 1,
          continuous_learning_enabled: 1,
          auto_reply_enabled: 0,
          welcome_message: null,
          user_notes: null,
          transcript_compact_offset: 6,
          agent_prompt_id: null,
          last_activity: null,
        }
      ])
      .mockResolvedValueOnce([{ today_conversations: '0', today_success: '0', today_failed: '0' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ total: '1' }]);

    const app = createApp(database);
    const listResponse = await request(app).get('/api/private-chats?page=1&limit=20');
    const detailResponse = await request(app).get('/api/private-chats/999999991');

    expect(listResponse.status).toBe(200);
    expect(detailResponse.status).toBe(200);
    expect(listResponse.body.data[0]).toMatchObject({
      user_id: 999999991,
      auto_reply_enabled: 0,
    });
    expect(detailResponse.body.data.user_settings).toMatchObject({
      user_id: 999999991,
      auto_reply_enabled: 0,
    });
  });
});
