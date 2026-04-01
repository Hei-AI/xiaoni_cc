import express from 'express';
import request from 'supertest';
import winston from 'winston';
import { createChatRoutes, normalizeChatSettingUpdates } from '../routes/chat-routes';

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

describe('chat settings routes', () => {
  it('normalizes boolean group toggle fields to integer flags', async () => {
    const database = createDatabaseMock();
    database.upsertGroupChatSettings.mockResolvedValue(true);
    database.getGroupChatSettingById.mockResolvedValueOnce({
      group_id: 123,
      agent_prompt_id: 'prompt-123',
      auto_reply_enabled: 0,
    });
    database.getGroupChatSettingById.mockResolvedValue({
      group_id: 123,
      group_name: 'Test Group',
      is_enabled: 0,
      continuous_learning_enabled: 0,
      auto_reply_enabled: 1,
      transcript_compact_offset: 6,
      agent_prompt_id: 'prompt-123',
    });

    const response = await request(createApp(database))
      .put('/api/group-chats/123/settings')
      .send({ is_enabled: false, auto_reply_enabled: true });

    expect(response.status).toBe(200);
    expect(database.upsertGroupChatSettings).toHaveBeenCalledWith(123, {
      is_enabled: 0,
      continuous_learning_enabled: 0,
      auto_reply_enabled: 0,
    });
    expect(response.body.data).toMatchObject({
      group_id: 123,
      is_enabled: 0,
      continuous_learning_enabled: 0,
      auto_reply_enabled: 1,
    });
  });

  it('keeps private chat toggle normalization behavior unchanged', async () => {
    const database = createDatabaseMock();
    database.upsertPrivateChatSettings.mockResolvedValue(true);
    database.getPrivateChatSettingById
      .mockResolvedValueOnce({
        user_id: 456,
        username: 'tester',
        is_enabled: 1,
        continuous_learning_enabled: 1,
        auto_reply_enabled: 0,
        transcript_compact_offset: 6,
        welcome_message: null,
        user_notes: null,
        agent_prompt_id: 'prompt-456',
        last_activity: null,
      })
      .mockResolvedValue({
        user_id: 456,
        username: 'tester',
        is_enabled: 1,
        continuous_learning_enabled: 1,
        auto_reply_enabled: 0,
        transcript_compact_offset: 6,
        welcome_message: null,
        user_notes: null,
        agent_prompt_id: 'prompt-456',
        last_activity: null,
      });

    const response = await request(createApp(database))
      .put('/api/private-chats/456/settings')
      .send({ is_enabled: true, auto_reply_enabled: false });

    expect(response.status).toBe(200);
    expect(database.upsertPrivateChatSettings).toHaveBeenCalledWith(456, {
      is_enabled: 1,
      auto_reply_enabled: 0,
    });
    expect(response.body.data).toMatchObject({
      user_id: 456,
      is_enabled: 1,
      auto_reply_enabled: 0,
    });
  });

  it('normalizes continuous learning updates to integer flags', async () => {
    const database = createDatabaseMock();
    database.upsertPrivateChatSettings.mockResolvedValue(true);
    database.getPrivateChatSettingById
      .mockResolvedValueOnce({
        user_id: 456,
        username: 'tester',
        is_enabled: 1,
        continuous_learning_enabled: 0,
        auto_reply_enabled: 0,
        transcript_compact_offset: 6,
        welcome_message: null,
        user_notes: null,
        agent_prompt_id: 'prompt-456',
        last_activity: null,
      })
      .mockResolvedValue({
        user_id: 456,
        username: 'tester',
        is_enabled: 1,
        continuous_learning_enabled: 1,
        auto_reply_enabled: 0,
        transcript_compact_offset: 6,
        welcome_message: null,
        user_notes: null,
        agent_prompt_id: 'prompt-456',
        last_activity: null,
      });

    const response = await request(createApp(database))
      .put('/api/private-chats/456/settings')
      .send({ continuous_learning_enabled: true });

    expect(response.status).toBe(200);
    expect(database.upsertPrivateChatSettings).toHaveBeenCalledWith(456, {
      continuous_learning_enabled: 1,
    });
  });

  it('accepts transcript_compact_offset for group and private chat settings', async () => {
    const database = createDatabaseMock();
    database.upsertGroupChatSettings.mockResolvedValue(true);
    database.getGroupChatSettingById.mockResolvedValue({
      group_id: 123,
      transcript_compact_offset: 12,
    });
    database.upsertPrivateChatSettings.mockResolvedValue(true);
    database.getPrivateChatSettingById.mockResolvedValue({
        user_id: 456,
        transcript_compact_offset: 9,
      });

    const app = createApp(database);
    const [groupResponse, privateResponse] = await Promise.all([
      request(app)
        .put('/api/group-chats/123/settings')
        .send({ transcript_compact_offset: 12 }),
      request(app)
        .put('/api/private-chats/456/settings')
        .send({ transcript_compact_offset: 9 }),
    ]);

    expect(groupResponse.status).toBe(200);
    expect(privateResponse.status).toBe(200);
    expect(database.upsertGroupChatSettings).toHaveBeenCalledWith(123, {
      transcript_compact_offset: 12,
    });
    expect(database.upsertPrivateChatSettings).toHaveBeenCalledWith(456, {
      transcript_compact_offset: 9,
    });
  });

  it('rejects invalid transcript_compact_offset values', async () => {
    const database = createDatabaseMock();
    const app = createApp(database);

    const [groupResponse, privateResponse] = await Promise.all([
      request(app)
        .put('/api/group-chats/123/settings')
        .send({ transcript_compact_offset: -1 }),
      request(app)
        .put('/api/private-chats/456/settings')
        .send({ transcript_compact_offset: 1.5 }),
    ]);

    expect(groupResponse.status).toBe(400);
    expect(privateResponse.status).toBe(400);
    expect(groupResponse.body.error).toBe('transcript_compact_offset must be an integer between 0 and 500');
    expect(privateResponse.body.error).toBe('transcript_compact_offset must be an integer between 0 and 500');
  });

  it('rejects empty settings updates', async () => {
    const database = createDatabaseMock();
    const app = createApp(database);

    const groupResponse = await request(app)
      .put('/api/group-chats/123/settings')
      .send({});
    const privateResponse = await request(app)
      .put('/api/private-chats/456/settings')
      .send({});

    expect(groupResponse.status).toBe(400);
    expect(groupResponse.body.error).toBe('No valid fields to update');
    expect(privateResponse.status).toBe(400);
    expect(privateResponse.body.error).toBe('No valid fields to update');
  });

  it('rejects enabling group auto reply without a prompt binding', async () => {
    const database = createDatabaseMock();
    database.getGroupChatSettingById.mockResolvedValue({
      group_id: 123,
      auto_reply_enabled: 0,
      agent_prompt_id: null,
    });

    const response = await request(createApp(database))
      .put('/api/group-chats/123/settings')
      .send({ auto_reply_enabled: true });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Cannot enable auto reply without an agent prompt binding');
    expect(database.upsertGroupChatSettings).not.toHaveBeenCalled();
  });

  it('rejects enabling private auto reply when the resulting settings have no prompt binding', async () => {
    const database = createDatabaseMock();
    database.getPrivateChatSettingById.mockResolvedValue({
      user_id: 456,
      auto_reply_enabled: 0,
      agent_prompt_id: null,
    });

    const response = await request(createApp(database))
      .put('/api/private-chats/456/settings')
      .send({ auto_reply_enabled: true });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Cannot enable auto reply without an agent prompt binding');
    expect(database.upsertPrivateChatSettings).not.toHaveBeenCalled();
  });

  it('allows enabling private auto reply when a prompt binding is provided in the same update', async () => {
    const database = createDatabaseMock();
    database.upsertPrivateChatSettings.mockResolvedValue(true);
    database.getPrivateChatSettingById
      .mockResolvedValueOnce({
        user_id: 456,
        auto_reply_enabled: 0,
        agent_prompt_id: null,
      })
      .mockResolvedValue({
        user_id: 456,
        auto_reply_enabled: 1,
        agent_prompt_id: 'prompt-456',
      });

    const response = await request(createApp(database))
      .put('/api/private-chats/456/settings')
      .send({ auto_reply_enabled: true, agent_prompt_id: 'prompt-456' });

    expect(response.status).toBe(200);
    expect(database.upsertPrivateChatSettings).toHaveBeenCalledWith(456, {
      auto_reply_enabled: 1,
      agent_prompt_id: 'prompt-456',
    });
  });

  it('clears child switches when receive is disabled', () => {
    expect(normalizeChatSettingUpdates(
      {
        is_enabled: false,
        continuous_learning_enabled: true,
        auto_reply_enabled: true,
      },
      {
        allowedFields: ['is_enabled', 'continuous_learning_enabled', 'auto_reply_enabled'],
      }
    )).toEqual({
      sanitizedUpdates: {
        is_enabled: 0,
        continuous_learning_enabled: 0,
        auto_reply_enabled: 0,
      },
      validationError: null,
    });
  });
});
