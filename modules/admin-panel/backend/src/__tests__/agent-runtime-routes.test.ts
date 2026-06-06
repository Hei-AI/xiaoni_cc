import express from 'express';
import request from 'supertest';
import winston from 'winston';
import { createAgentRuntimeRoutes } from '../routes/agent-runtime-routes';
import { buildConversationTracePayload, buildConversationTraceSpanDetail } from '../services/trace-span-builder';
import { findXiaoniReplayEventByEventId } from '@qq-bot/persistence';

jest.mock('@qq-bot/persistence', () => ({
  getXiaoniActionStream: jest.fn(),
  getXiaoniActivityFeed: jest.fn(),
  findXiaoniReplayEventByEventId: jest.fn(),
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
    (findXiaoniReplayEventByEventId as jest.Mock).mockResolvedValueOnce({
      eventId: 'provider:codex:llm_abc',
      eventKind: 'codex_provider_request',
      source: 'codex_provider',
      traceId: 'trace-1',
      conversationId: '42',
      internalExecutionLeaseId: 'lease-1',
      providerCallId: 'llm_abc',
      replayable: true,
      metadata: { spanId: 'provider-request:wire:llm_abc' }
    });
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
    expect(database.executeQuery).not.toHaveBeenCalled();
    expect(buildConversationTracePayload).toHaveBeenCalledWith(expect.anything(), expect.anything(), '42');
    expect(response.body.data.action_event).toEqual({
      event_id: 'provider:codex:llm_abc',
      focus_span_id: 'provider-request:wire:llm_abc',
      trace_id: 'trace-1'
    });
  });

  it('loads span detail through the action event route', async () => {
    const database = createDatabaseMock();
    (findXiaoniReplayEventByEventId as jest.Mock).mockResolvedValueOnce({
      eventId: 'provider:codex:llm_abc',
      eventKind: 'codex_provider_request',
      source: 'codex_provider',
      traceId: 'trace-1',
      conversationId: '42',
      internalExecutionLeaseId: 'lease-1',
      providerCallId: 'llm_abc',
      replayable: true,
      metadata: { spanId: 'provider-request:wire:llm_abc' }
    });
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

  it('does not resolve non-replayable internal action events to traces', async () => {
    const database = createDatabaseMock();
    (findXiaoniReplayEventByEventId as jest.Mock).mockResolvedValueOnce({
      eventId: 'life:1',
      eventKind: 'surface_visit',
      source: 'life_event',
      traceId: 'trace-internal',
      conversationId: '42',
      internalExecutionLeaseId: 'lease-internal',
      providerCallId: null,
      replayable: false,
      metadata: {}
    });

    const response = await request(createApp(database))
      .get('/api/xiaoni/action-stream/events/life%3A1/trace');

    expect(response.status).toBe(404);
    expect(buildConversationTracePayload).not.toHaveBeenCalled();
  });

  it('does not fall back to audit tables when the replay ledger has no action event', async () => {
    const database = createDatabaseMock();
    database.executeQuery.mockResolvedValueOnce([{
      id: 123,
      llm_call_id: 'llm_missing',
      conversation_id: '42',
      trace_id: 'trace-1'
    }]);
    (findXiaoniReplayEventByEventId as jest.Mock).mockResolvedValueOnce(null);

    const response = await request(createApp(database))
      .get('/api/xiaoni/action-stream/events/provider%3Acodex%3Allm_missing/trace');

    expect(response.status).toBe(404);
    expect(database.executeQuery).not.toHaveBeenCalled();
    expect(buildConversationTracePayload).not.toHaveBeenCalled();
  });
});
