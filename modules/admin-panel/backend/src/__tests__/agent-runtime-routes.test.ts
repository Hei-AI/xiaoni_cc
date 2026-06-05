import express from 'express';
import request from 'supertest';
import winston from 'winston';
import { createAgentRuntimeRoutes } from '../routes/agent-runtime-routes';
import { buildConversationTracePayload, buildConversationTraceSpanDetail } from '../services/trace-span-builder';

jest.mock('@qq-bot/persistence', () => ({
  getXiaoniActionStream: jest.fn(),
  getXiaoniActivityFeed: jest.fn(),
  listAgentMediaAssets: jest.fn(),
  listAgentTasks: jest.fn()
}));

jest.mock('../services/trace-span-builder', () => ({
  buildConversationTracePayload: jest.fn(),
  buildConversationTraceSpanDetail: jest.fn()
}));

function createLogger(): winston.Logger {
  return winston.createLogger({ silent: true });
}

function createDatabaseMock() {
  return {
    executeQuery: jest.fn()
  };
}

function createApp(database: ReturnType<typeof createDatabaseMock>) {
  const app = express();
  app.use(express.json());
  app.use('/api', createAgentRuntimeRoutes(database as never, createLogger()));
  return app;
}

describe('agent runtime action event trace routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('resolves a Codex provider action event to its raw provider span trace', async () => {
    const database = createDatabaseMock();
    database.executeQuery.mockResolvedValueOnce([{
      id: 12,
      llm_call_id: 'llm_abc',
      conversation_id: 42,
      trace_id: 'trace-1',
      run_id: 'lease-1'
    }]);
    (buildConversationTracePayload as jest.Mock).mockResolvedValueOnce({
      conversation_id: '42',
      batch_id: null,
      trace: { trace_id: 'trace-1', status: 'ok' },
      spans: [],
      raw_evidence: {},
      data_quality: {}
    });

    const response = await request(createApp(database))
      .get('/api/xiaoni/action-stream/events/provider%3Acodex%3Allm_abc/trace');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(buildConversationTracePayload).toHaveBeenCalledWith(expect.anything(), expect.anything(), '42');
    expect(response.body.data.action_event).toEqual({
      event_id: 'provider:codex:llm_abc',
      focus_span_id: 'provider-request:wire:llm_abc',
      trace_id: 'trace-1'
    });
  });

  it('loads span detail through the action event route', async () => {
    const database = createDatabaseMock();
    database.executeQuery.mockResolvedValueOnce([{
      id: 12,
      llm_call_id: 'llm_abc',
      conversation_id: 42,
      trace_id: 'trace-1',
      run_id: 'lease-1'
    }]);
    (buildConversationTraceSpanDetail as jest.Mock).mockResolvedValueOnce({
      input: { raw_body: '{"model":"gpt"}' },
      output: { raw_body: '{"type":"response"}' },
      evidence: { synthetic: true }
    });

    const response = await request(createApp(database))
      .get('/api/xiaoni/action-stream/events/provider%3Acodex%3Allm_abc/trace/spans/provider-request%3Awire%3Allm_abc/detail');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(buildConversationTraceSpanDetail).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      '42',
      'provider-request:wire:llm_abc'
    );
    expect(response.body.data.input.raw_body).toBe('{"model":"gpt"}');
  });
});
