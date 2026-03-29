import winston from 'winston';
import { listTraceTrafficLogs } from '@qq-bot/persistence';
import { buildConversationTracePayload } from '../services/trace-span-builder';

jest.mock('@qq-bot/persistence', () => ({
  listTraceTrafficLogs: jest.fn(),
  parseInstantValue: jest.fn((value: unknown) => {
    if (!value) {
      return null;
    }
    const parsed = value instanceof Date ? value : new Date(value as string | number);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }),
  serializeTimestampForApi: jest.fn((value: unknown) => {
    if (!value) {
      return null;
    }
    const parsed = value instanceof Date ? value : new Date(value as string | number);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }),
}));

function createLogger(): winston.Logger {
  return winston.createLogger({ silent: true });
}

function createDatabase(overrides?: {
  llmCallRows?: any[];
  toolCallRows?: any[];
  websocketRows?: any[];
  timelineRows?: any[];
  llmJobRows?: any[];
  queueRows?: any[];
}) {
  const conversation = {
    id: 'conversation-1',
    trace_id: 'trace-1',
    batch_id: 'batch-1',
    user_id: 'user-1',
    group_id: null,
    user_message: 'hello',
    ai_response: 'hi',
    status: 'completed',
    error_reason: null,
    response_time: 1200,
    model_name: 'gpt-5.4-mini',
    raw_request: JSON.stringify({ prompt: 'hello' }),
    timestamp: '2026-03-28T10:00:00.000Z',
  };

  const llmCallRows = overrides?.llmCallRows ?? [];
  const toolCallRows = overrides?.toolCallRows ?? [];
  const websocketRows = overrides?.websocketRows ?? [];
  const timelineRows = overrides?.timelineRows ?? [];
  const llmJobRows = overrides?.llmJobRows ?? [];
  const queueRows = overrides?.queueRows ?? [];

  return {
    executeQuery: jest.fn(async (sql: string) => {
      if (sql.includes('FROM conversations')) {
        return [conversation];
      }
      if (sql.includes('FROM llm_call_logs')) {
        return llmCallRows;
      }
      if (sql.includes('FROM tool_execution_logs')) {
        return toolCallRows;
      }
      if (sql.includes('FROM websocket_logs')) {
        return websocketRows;
      }
      if (sql.includes('FROM timeline_events')) {
        return timelineRows;
      }
      if (sql.includes('FROM llm_jobs')) {
        return llmJobRows;
      }
      if (sql.includes('FROM agent_queue_messages')) {
        return queueRows;
      }
      return [];
    }),
  };
}

describe('buildConversationTracePayload', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('attaches provider.request spans directly under generation for exact AI traffic matches', async () => {
    const db = createDatabase({
      llmCallRows: [
        {
          id: 11,
          llm_call_id: 'llm-call-1',
          trace_id: 'trace-1',
          conversation_id: 'conversation-1',
          agent_turn: 1,
          call_sequence: 1,
          started_at: '2026-03-28T10:00:01.000Z',
          completed_at: '2026-03-28T10:00:03.000Z',
          status: 'completed',
          model_name: 'gpt-5.4-mini',
          model_provider: 'openai',
          agent_type: 'chat_bot',
          prompt_template: 'agent_loop_v1',
          canonical_request: JSON.stringify({ model: 'gpt-5.4-mini' }),
          wire_request: JSON.stringify({ model: 'gpt-5.4-mini' }),
          canonical_response: JSON.stringify({ output_text: 'hi' }),
          wire_response: JSON.stringify({ id: 'resp_1' }),
          effective_unified_config: JSON.stringify({ model: { provider: 'openai', name: 'gpt-5.4-mini' } }),
          processed_response: 'hi',
          input_tokens: 10,
          output_tokens: 20,
          token_usage: JSON.stringify({ input_tokens: 10, output_tokens: 20 }),
          processing_time_ms: 2000,
          request_format_version: 'openresponse/v1',
          wire_provider_format: 'openai/responses',
        },
      ],
    });

    (listTraceTrafficLogs as jest.Mock).mockResolvedValue([
      {
        id: 101,
        request_id: 'req-101',
        trace_id: 'trace-1',
        conversation_id: 'conversation-1',
        agent_turn: 1,
        llm_call_id: 'llm-call-1',
        method: 'POST',
        url: 'https://api.openai.com/v1/responses',
        host: 'api.openai.com',
        path: '/v1/responses',
        request_headers: JSON.stringify({ 'content-type': 'application/json' }),
        request_body: '{"model":"gpt-5.4-mini"}',
        response_status: 200,
        response_headers: JSON.stringify({ 'content-type': 'application/json' }),
        response_body: '{"id":"resp_1"}',
        duration_ms: 321,
        request_timestamp: '2026-03-28T10:00:01.200Z',
        response_timestamp: '2026-03-28T10:00:01.521Z',
        is_ai_request: true,
        api_type: 'openai',
        error_message: null,
      },
    ]);

    const payload = await buildConversationTracePayload(db as never, createLogger(), 'conversation-1');
    expect(payload).not.toBeNull();

    const spans = payload!.spans;
    const generationSpan = spans.find((span) => span.name === 'llm.generation');
    const providerRequestSpan = spans.find((span) => span.name === 'provider.request');

    expect(generationSpan?.attributes['provider.request_count']).toBe(1);
    expect(providerRequestSpan).toMatchObject({
      parent_span_id: 'llm-call:llm-call-1',
      attributes: expect.objectContaining({
        'semantic.role': 'provider_request',
        'provider.traffic_log_id': 101,
      }),
      evidence: expect.objectContaining({
        traffic_log_id: 101,
        request_id: 'req-101',
        llm_call_id: 'llm-call-1',
        api_type: 'openai',
      }),
    });
    expect(spans.some((span) => span.name === 'provider.exchange')).toBe(false);
    expect(spans.some((span) => span.span_id === 'http:101')).toBe(false);
  });

  it('keeps AI traffic without llm_call_id out of provider spans', async () => {
    const db = createDatabase({
      llmCallRows: [
        {
          id: 12,
          llm_call_id: 'llm-call-2',
          trace_id: 'trace-1',
          conversation_id: 'conversation-1',
          agent_turn: 1,
          call_sequence: 1,
          started_at: '2026-03-28T10:00:01.000Z',
          completed_at: '2026-03-28T10:00:03.000Z',
          status: 'completed',
          model_name: 'gpt-5.4-mini',
          model_provider: 'openai',
          agent_type: 'chat_bot',
          prompt_template: 'agent_loop_v1',
          canonical_request: JSON.stringify({ model: 'gpt-5.4-mini' }),
          wire_request: JSON.stringify({ model: 'gpt-5.4-mini' }),
          canonical_response: JSON.stringify({ output_text: 'hi' }),
          wire_response: JSON.stringify({ id: 'resp_2' }),
          effective_unified_config: JSON.stringify({ model: { provider: 'openai', name: 'gpt-5.4-mini' } }),
          processed_response: 'hi',
          input_tokens: 10,
          output_tokens: 20,
          token_usage: JSON.stringify({ input_tokens: 10, output_tokens: 20 }),
          processing_time_ms: 2000,
          request_format_version: 'openresponse/v1',
          wire_provider_format: 'openai/responses',
        },
      ],
    });

    (listTraceTrafficLogs as jest.Mock).mockResolvedValue([
      {
        id: 202,
        request_id: 'req-202',
        trace_id: 'trace-1',
        conversation_id: 'conversation-1',
        agent_turn: 1,
        llm_call_id: null,
        method: 'POST',
        url: 'https://api.openai.com/v1/responses',
        host: 'api.openai.com',
        path: '/v1/responses',
        request_headers: JSON.stringify({ 'content-type': 'application/json' }),
        request_body: '{"model":"gpt-5.4-mini"}',
        response_status: 200,
        response_headers: JSON.stringify({ 'content-type': 'application/json' }),
        response_body: '{"id":"resp_2"}',
        duration_ms: 400,
        request_timestamp: '2026-03-28T10:00:01.400Z',
        response_timestamp: '2026-03-28T10:00:01.800Z',
        is_ai_request: true,
        api_type: 'openai',
        error_message: null,
      },
    ]);

    const payload = await buildConversationTracePayload(db as never, createLogger(), 'conversation-1');
    expect(payload).not.toBeNull();

    const spans = payload!.spans;
    expect(spans.some((span) => span.name === 'provider.exchange')).toBe(false);
    expect(spans.some((span) => span.name === 'provider.request')).toBe(false);
    expect(spans.find((span) => span.span_id === 'http:202')?.name).toBe('http.request');
  });

  it('uses the final completed response for SSE provider body while preserving raw SSE output', async () => {
    const db = createDatabase({
      llmCallRows: [
        {
          id: 13,
          llm_call_id: 'llm-call-3',
          trace_id: 'trace-1',
          conversation_id: 'conversation-1',
          agent_turn: 1,
          call_sequence: 1,
          started_at: '2026-03-28T10:00:01.000Z',
          completed_at: '2026-03-28T10:00:03.000Z',
          status: 'completed',
          model_name: 'gpt-5.4-mini',
          model_provider: 'codex',
          agent_type: 'chat_bot',
          prompt_template: 'agent_loop_v1',
          canonical_request: JSON.stringify({ model: 'gpt-5.4-mini' }),
          wire_request: JSON.stringify({ model: 'gpt-5.4-mini', stream: true }),
          canonical_response: JSON.stringify({ id: 'resp_sse' }),
          wire_response: JSON.stringify({ id: 'resp_sse' }),
          effective_unified_config: JSON.stringify({ model: { provider: 'codex', name: 'gpt-5.4-mini' } }),
          processed_response: null,
          input_tokens: 10,
          output_tokens: 20,
          token_usage: JSON.stringify({ input_tokens: 10, output_tokens: 20 }),
          processing_time_ms: 2000,
          request_format_version: 'openresponse/v1',
          wire_provider_format: 'codex/responses',
        },
      ],
    });

    const sseBody = [
      'event: response.created',
      'data: {"type":"response.created","response":{"id":"resp_sse","status":"in_progress"}}',
      '',
      'event: response.output_text.delta',
      'data: {"type":"response.output_text.delta","delta":"hel"}',
      '',
      'event: response.completed',
      'data: {"type":"response.completed","response":{"id":"resp_sse","status":"completed","output":[{"type":"message"}]}}',
      '',
    ].join('\n');

    (listTraceTrafficLogs as jest.Mock).mockResolvedValue([
      {
        id: 303,
        request_id: 'req-303',
        trace_id: 'trace-1',
        conversation_id: 'conversation-1',
        agent_turn: 1,
        llm_call_id: 'llm-call-3',
        method: 'POST',
        url: 'https://chatgpt.com/backend-api/codex/responses',
        host: 'chatgpt.com',
        path: '/backend-api/codex/responses',
        request_headers: JSON.stringify({ accept: 'text/event-stream' }),
        request_body: '{"model":"gpt-5.4-mini","stream":true}',
        response_status: 200,
        response_headers: JSON.stringify({ 'content-type': 'text/event-stream' }),
        response_body: sseBody,
        duration_ms: 400,
        request_timestamp: '2026-03-28T10:00:01.400Z',
        response_timestamp: '2026-03-28T10:00:01.800Z',
        is_ai_request: true,
        api_type: 'codex',
        error_message: null,
      },
    ]);

    const payload = await buildConversationTracePayload(db as never, createLogger(), 'conversation-1');
    const providerRequestSpan = payload!.spans.find((span) => span.name === 'provider.request');

    expect(providerRequestSpan?.output).toMatchObject({
      status_code: 200,
      body: {
        id: 'resp_sse',
        status: 'completed',
        output: [{ type: 'message' }],
      },
      raw_body: sseBody,
      body_format: 'json',
      body_source: 'sse_complete',
    });
    expect(providerRequestSpan?.evidence).toMatchObject({
      normalized_response_body: {
        id: 'resp_sse',
        status: 'completed',
        output: [{ type: 'message' }],
      },
      normalized_response_body_source: 'sse_complete',
      response_body: sseBody,
    });
  });
});
