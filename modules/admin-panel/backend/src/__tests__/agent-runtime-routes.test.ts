import express from 'express';
import request from 'supertest';
import winston from 'winston';
import axios from 'axios';
import { createAgentRuntimeRoutes } from '../routes/agent-runtime-routes';
import {
  buildConversationTracePayload,
  buildConversationTraceSpanDetail,
  buildConversationRawProviderTrace,
  buildStackTracePayload,
  buildStackTraceSpanDetail,
  buildStackRawProviderTrace
} from '../services/trace-span-builder';
import {
  findXiaoniActionEventTraceTarget,
  getXiaoniActionStream,
  getXiaoniLlmUsageTimeline,
  listAgentRecoverySessions
} from '@qq-bot/persistence';

jest.mock('axios');

jest.mock('@qq-bot/persistence', () => ({
  getXiaoniActionStream: jest.fn(),
  getXiaoniActivityFeed: jest.fn(),
  getXiaoniLlmUsageTimeline: jest.fn(),
  findXiaoniActionEventTraceTarget: jest.fn(),
  listAgentMediaAssets: jest.fn(),
  listAgentRecoverySessions: jest.fn(),
  listAgentTasks: jest.fn()
}));

jest.mock('../services/trace-span-builder', () => ({
  buildConversationTracePayload: jest.fn(),
  buildConversationTraceSpanDetail: jest.fn(),
  buildConversationRawProviderTrace: jest.fn(),
  buildStackTracePayload: jest.fn(),
  buildStackTraceSpanDetail: jest.fn(),
  buildStackRawProviderTrace: jest.fn()
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

describe('agent runtime recovery session routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists recover energy sessions and exposes the active session', async () => {
    const database = createDatabaseMock();
    (axios.get as jest.Mock).mockResolvedValueOnce({
      status: 200,
      data: {
        status: 'healthy',
        service: 'agent-service',
        worker_busy: false,
        task_worker_busy: false,
        presence_tick_busy: false,
        runtime_enabled: true,
        timestamp: '2026-06-13T00:00:00.000Z'
      }
    });
    (listAgentRecoverySessions as jest.Mock).mockResolvedValueOnce([
      {
        id: 88,
        identityKey: 'xiaoni',
        status: 'active',
        reason: '累了',
        startedAt: '2026-06-13T00:00:00.000Z'
      },
      {
        id: 87,
        identityKey: 'xiaoni',
        status: 'completed',
        reason: '自然醒',
        startedAt: '2026-06-12T23:00:00.000Z'
      }
    ]);
    (getXiaoniActionStream as jest.Mock).mockResolvedValueOnce({
      current: {
        latestActivityAt: '2026-06-13T00:00:00.000Z',
        lifeState: {
          projection: {
            state: {
              energy: 0.87,
              actionCost: 0.13
            }
          },
          explanation: {
            summary: '当前精力=0.87'
          }
        }
      },
      items: [
        {
          id: 'tool-exec:1',
          source: 'tool_execution',
          kind: 'recover_energy',
          title: 'tool: recover_energy',
          body: '休息恢复精力',
          timestamp: '2026-06-13T00:00:00.000Z'
        }
      ]
    });

    const response = await request(createApp(database))
      .get('/api/agent-runtime/recovery-sessions?identity_key=xiaoni&status=all&limit=40');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(listAgentRecoverySessions).toHaveBeenCalledWith({
      identityKey: 'xiaoni',
      status: 'all',
      limit: 40
    });
    expect(getXiaoniActionStream).toHaveBeenCalledWith({
      identityKey: 'xiaoni',
      limit: 12
    });
    expect(response.body.data.active.id).toBe(88);
    expect(response.body.data.sessions).toHaveLength(2);
    expect(response.body.data.current.lifeState.projection.state.energy).toBe(0.87);
    expect(response.body.data.recentExperience).toHaveLength(1);
    expect(response.body.data.recentExperience[0].title).toBe('tool: recover_energy');
    expect(response.body.data.runtime.live).toBe(true);
    expect(response.body.data.current.runtime.live).toBe(true);
    expect(database.executeQuery).not.toHaveBeenCalled();
  });
});

describe('agent runtime action event trace routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('loads Xiaoni LLM usage timeline with bucket and time filters', async () => {
    const database = createDatabaseMock();
    (getXiaoniLlmUsageTimeline as jest.Mock).mockResolvedValueOnce({
      identityKey: 'xiaoni',
      generatedAt: '2026-06-13T00:00:00.000Z',
      timezone: 'Asia/Shanghai',
      requestedBucket: 'hour',
      bucket: 'hour',
      maxPoints: 500,
      downsampled: false,
      warnings: [],
      window: {
        startTime: '2026-06-12T16:00:00.000Z',
        endTime: '2026-06-12T18:00:00.000Z'
      },
      dataBounds: {
        firstAt: '2026-06-12T16:00:00.000Z',
        lastAt: '2026-06-12T18:00:00.000Z'
      },
      summary: {
        callCount: 2,
        inputTokens: 100,
        cachedTokens: 40,
        outputTokens: 20,
        totalTokens: 120,
        cacheRatio: 0.4,
        peakInputTokens: 80,
        peakOutputTokens: 15
      },
      points: [],
      peaks: [],
      overlays: {
        eventDensity: [],
        toolDensity: [],
        runtimeBands: [],
        compressionForkBands: [],
        searchHits: []
      },
      miniMap: null
    });

    const response = await request(createApp(database))
      .get('/api/xiaoni/action-stream/llm-usage')
      .query({
        range: 'custom',
        start_time: '2026-06-13T00:00:00+08:00',
        end_time: '2026-06-13T02:00:00+08:00',
        bucket: 'hour',
        max_points: '500',
        include_peaks: '1',
        include_overlays: 'compression_fork'
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.bucket).toBe('hour');
    expect(response.body.data.filters).toEqual({
      range: 'custom',
      startTime: '2026-06-12T16:00:00.000Z',
      endTime: '2026-06-12T18:00:00.000Z'
    });
    expect(getXiaoniLlmUsageTimeline).toHaveBeenCalledWith({
      identityKey: 'xiaoni',
      range: 'custom',
      startTime: new Date('2026-06-13T00:00:00+08:00'),
      endTime: new Date('2026-06-13T02:00:00+08:00'),
      bucket: 'hour',
      maxPoints: 500,
      includePeaks: true,
      includeMiniMap: false,
      includeOverlays: 'compression_fork',
      searchQuery: null
    });
  });

  it('resolves an LLM request action event to its focused stack trace even after conversation attach', async () => {
    const database = createDatabaseMock();
    (findXiaoniActionEventTraceTarget as jest.Mock).mockResolvedValueOnce({
      traceId: 'trace-1',
      conversationId: '42',
      spanId: 'stack-slice:slice_abc',
      internalExecutionLeaseId: 'lease-1',
      llmRequestSliceId: 'slice_abc',
      toolCallId: null,
      stackItemId: '1204'
    });
    (buildStackTracePayload as jest.Mock).mockResolvedValueOnce({
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
    expect(buildConversationTracePayload).not.toHaveBeenCalled();
    expect(buildStackTracePayload).toHaveBeenCalledWith(expect.anything(), {
      traceId: 'trace-1',
      conversationId: '42',
      spanId: 'stack-slice:slice_abc',
      internalExecutionLeaseId: 'lease-1',
      llmRequestSliceId: 'slice_abc',
      toolCallId: null,
      stackItemId: '1204'
    });
    expect(response.body.data.action_event).toEqual({
      event_id: 'llm-slice:slice_abc',
      focus_span_id: 'stack-slice:slice_abc',
      trace_id: 'trace-1'
    });
  });

  it('loads focused stack span detail through the action event route after conversation attach', async () => {
    const database = createDatabaseMock();
    (findXiaoniActionEventTraceTarget as jest.Mock).mockResolvedValueOnce({
      traceId: 'trace-1',
      conversationId: '42',
      spanId: 'stack-slice:slice_abc',
      internalExecutionLeaseId: 'lease-1',
      llmRequestSliceId: 'slice_abc',
      toolCallId: null,
      stackItemId: '1204'
    });
    (buildStackTraceSpanDetail as jest.Mock).mockResolvedValueOnce({
      input: { raw_body: '{"model":"gpt"}' },
      output: { raw_body: '{"type":"response"}' },
      evidence: { synthetic: true }
    });

    const response = await request(createApp(database))
      .get('/api/xiaoni/action-stream/events/llm-slice%3Aslice_abc/trace/spans/provider-request%3Awire%3Allm_abc/detail');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(buildConversationTraceSpanDetail).not.toHaveBeenCalled();
    expect(buildStackTraceSpanDetail).toHaveBeenCalledWith(
      expect.anything(),
      {
        traceId: 'trace-1',
        conversationId: '42',
        spanId: 'stack-slice:slice_abc',
        internalExecutionLeaseId: 'lease-1',
        llmRequestSliceId: 'slice_abc',
        toolCallId: null,
        stackItemId: '1204'
      },
      'provider-request:wire:llm_abc'
    );
    expect(response.body.data.input.raw_body).toBe('{"model":"gpt"}');
  });

  it('loads raw provider exchange through the narrow raw trace route', async () => {
    const database = createDatabaseMock();
    (findXiaoniActionEventTraceTarget as jest.Mock).mockResolvedValueOnce({
      traceId: 'trace-1',
      conversationId: '42',
      spanId: 'stack-slice:slice_abc',
      internalExecutionLeaseId: 'lease-1',
      llmRequestSliceId: 'slice_abc',
      toolCallId: null,
      stackItemId: '1204'
    });
    (buildStackRawProviderTrace as jest.Mock).mockResolvedValueOnce({
      span_id: 'provider-request:wire:llm_abc',
      trace_id: 'trace-1',
      conversation_id: '42',
      slice_id: 'slice_abc',
      llm_call_id: 'llm_abc',
      source: 'llm_request_slices.provider_exchange',
      model_name: 'gpt-test',
      model_provider: 'codex',
      request_format_version: 'responses/v1',
      wire_provider_format: 'openai/responses',
      started_at: '2026-06-13T00:00:00.000Z',
      completed_at: '2026-06-13T00:00:01.000Z',
      duration_ms: 1000,
      request: {
        method: 'POST',
        upstream_url: 'https://example.test/v1/responses',
        headers: { 'content-type': 'application/json' },
        body: '{"model":"gpt"}',
        bytes: 15,
        body_format: 'json',
        body_source: 'llm_request_slices.wire_request'
      },
      response: {
        status_code: 200,
        status_text: 'OK',
        headers: { 'content-type': 'text/event-stream' },
        body: '{"type":"response"}',
        bytes: 19,
        body_format: 'json',
        body_source: 'llm_request_slices.raw_response',
        error_message: null
      }
    });

    const response = await request(createApp(database))
      .get('/api/xiaoni/action-stream/events/llm-slice%3Aslice_abc/raw-trace?spanId=provider-request%3Awire%3Allm_abc');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(buildConversationRawProviderTrace).not.toHaveBeenCalled();
    expect(buildStackRawProviderTrace).toHaveBeenCalledWith(
      expect.anything(),
      {
        traceId: 'trace-1',
        conversationId: '42',
        spanId: 'stack-slice:slice_abc',
        internalExecutionLeaseId: 'lease-1',
        llmRequestSliceId: 'slice_abc',
        toolCallId: null,
        stackItemId: '1204'
      },
      'provider-request:wire:llm_abc'
    );
    expect(buildStackTracePayload).not.toHaveBeenCalled();
    expect(buildStackTraceSpanDetail).not.toHaveBeenCalled();
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.data.request.headers['content-type']).toBe('application/json');
    expect(response.body.data.request.body).toBe('{"model":"gpt"}');
    expect(response.body.data.response.headers['content-type']).toBe('text/event-stream');
    expect(response.body.data.response.body).toBe('{"type":"response"}');
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
