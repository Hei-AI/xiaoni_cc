import express from 'express';
import request from 'supertest';
import winston from 'winston';
import { createAgentRuntimeRoutes } from '../routes/agent-runtime-routes';
import {
  buildConversationTracePayload,
  buildConversationTraceSpanDetail,
  buildStackTracePayload,
  buildStackTraceSpanDetail
} from '../services/trace-span-builder';
import { findXiaoniActionEventTraceTarget } from '@qq-bot/persistence';

jest.mock('@qq-bot/persistence', () => ({
  getXiaoniActionStream: jest.fn(),
  getXiaoniActivityFeed: jest.fn(),
  findXiaoniActionEventTraceTarget: jest.fn(),
  listAgentMediaAssets: jest.fn(),
  listAgentTasks: jest.fn()
}));

jest.mock('../services/trace-span-builder', () => ({
  buildConversationTracePayload: jest.fn(),
  buildConversationTraceSpanDetail: jest.fn(),
  buildStackTracePayload: jest.fn(),
  buildStackTraceSpanDetail: jest.fn()
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

  it('resolves an LLM request action event to its conversation trace', async () => {
    const database = createDatabaseMock();
    (findXiaoniActionEventTraceTarget as jest.Mock).mockResolvedValueOnce({
      traceId: 'trace-1',
      conversationId: '42',
      spanId: 'stack-slice:slice_abc',
      internalExecutionLeaseId: 'lease-1'
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
      .get('/api/xiaoni/action-stream/events/llm-slice%3Aslice_abc/trace');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(database.executeQuery).not.toHaveBeenCalled();
    expect(findXiaoniActionEventTraceTarget).toHaveBeenCalledWith('llm-slice:slice_abc');
    expect(buildConversationTracePayload).toHaveBeenCalledWith(expect.anything(), expect.anything(), '42');
    expect(response.body.data.action_event).toEqual({
      event_id: 'llm-slice:slice_abc',
      focus_span_id: 'stack-slice:slice_abc',
      trace_id: 'trace-1'
    });
  });

  it('loads span detail through the action event route', async () => {
    const database = createDatabaseMock();
    (findXiaoniActionEventTraceTarget as jest.Mock).mockResolvedValueOnce({
      traceId: 'trace-1',
      conversationId: '42',
      spanId: 'stack-slice:slice_abc',
      internalExecutionLeaseId: 'lease-1'
    });
    (buildConversationTraceSpanDetail as jest.Mock).mockResolvedValueOnce({
      input: { raw_body: '{"model":"gpt"}' },
      output: { raw_body: '{"type":"response"}' },
      evidence: { synthetic: true }
    });

    const response = await request(createApp(database))
      .get('/api/xiaoni/action-stream/events/llm-slice%3Aslice_abc/trace/spans/provider-request%3Awire%3Allm_abc/detail');

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

  it('resolves a life action event to its conversation trace', async () => {
    const database = createDatabaseMock();
    (findXiaoniActionEventTraceTarget as jest.Mock).mockResolvedValueOnce({
      traceId: 'trace-internal',
      conversationId: '42',
      spanId: 'llm-call:llm_abc',
      internalExecutionLeaseId: 'lease-internal'
    });
    (buildConversationTracePayload as jest.Mock).mockResolvedValueOnce({
      conversation_id: '42',
      batch_id: null,
      trace: { trace_id: 'trace-internal', status: 'ok' },
      spans: [],
      raw_evidence: {},
      data_quality: {}
    });

    const response = await request(createApp(database))
      .get('/api/xiaoni/action-stream/events/life%3A1/trace');

    expect(response.status).toBe(200);
    expect(buildConversationTracePayload).toHaveBeenCalledWith(expect.anything(), expect.anything(), '42');
    expect(response.body.data.action_event).toEqual({
      event_id: 'life:1',
      focus_span_id: 'llm-call:llm_abc',
      trace_id: 'trace-internal'
    });
  });

  it('does not fall back to route-local audit queries when no trace target exists', async () => {
    const database = createDatabaseMock();
    (findXiaoniActionEventTraceTarget as jest.Mock).mockResolvedValueOnce(null);

    const response = await request(createApp(database))
      .get('/api/xiaoni/action-stream/events/llm-slice%3Amissing/trace');

    expect(response.status).toBe(404);
    expect(database.executeQuery).not.toHaveBeenCalled();
    expect(buildConversationTracePayload).not.toHaveBeenCalled();
  });

  it('falls back to stack trace when the target has no conversation', async () => {
    const database = createDatabaseMock();
    (findXiaoniActionEventTraceTarget as jest.Mock).mockResolvedValueOnce({
      traceId: 'runtrace-global',
      conversationId: null,
      spanId: 'stack-slice:slice_global',
      internalExecutionLeaseId: 'run-global',
      llmRequestSliceId: 'slice_global',
      toolCallId: null,
      stackItemId: '1204'
    });
    (buildStackTracePayload as jest.Mock).mockResolvedValueOnce({
      conversation_id: null,
      batch_id: null,
      trace: { trace_id: 'runtrace-global', status: 'ok' },
      spans: [],
      raw_evidence: {},
      data_quality: {}
    });

    const response = await request(createApp(database))
      .get('/api/xiaoni/action-stream/events/llm-slice%3Aslice_global/trace');

    expect(response.status).toBe(200);
    expect(database.executeQuery).not.toHaveBeenCalled();
    expect(buildConversationTracePayload).not.toHaveBeenCalled();
    expect(buildStackTracePayload).toHaveBeenCalledWith(expect.anything(), {
      traceId: 'runtrace-global',
      conversationId: null,
      spanId: 'stack-slice:slice_global',
      internalExecutionLeaseId: 'run-global',
      llmRequestSliceId: 'slice_global',
      toolCallId: null,
      stackItemId: '1204'
    });
    expect(response.body.data.action_event).toEqual({
      event_id: 'llm-slice:slice_global',
      focus_span_id: 'stack-slice:slice_global',
      trace_id: 'runtrace-global'
    });
  });

  it('falls back to stack span detail when the target has no conversation', async () => {
    const database = createDatabaseMock();
    (findXiaoniActionEventTraceTarget as jest.Mock).mockResolvedValueOnce({
      traceId: 'runtrace-global',
      conversationId: null,
      spanId: 'tool-call:call_global',
      internalExecutionLeaseId: 'run-global',
      llmRequestSliceId: 'slice_global',
      toolCallId: 'call_global',
      stackItemId: '1204'
    });
    (buildStackTraceSpanDetail as jest.Mock).mockResolvedValueOnce({
      input: { arguments: { cmd: 'date' } },
      output: { result: { stdout: 'ok' } },
      evidence: { execution_id: 'tool-1' }
    });

    const response = await request(createApp(database))
      .get('/api/xiaoni/action-stream/events/stack%3A1204/trace/spans/tool-call%3Acall_global/detail');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(buildConversationTraceSpanDetail).not.toHaveBeenCalled();
    expect(buildStackTraceSpanDetail).toHaveBeenCalledWith(
      expect.anything(),
      {
        traceId: 'runtrace-global',
        conversationId: null,
        spanId: 'tool-call:call_global',
        internalExecutionLeaseId: 'run-global',
        llmRequestSliceId: 'slice_global',
        toolCallId: 'call_global',
        stackItemId: '1204'
      },
      'tool-call:call_global'
    );
    expect(response.body.data.input.arguments.cmd).toBe('date');
  });
});
