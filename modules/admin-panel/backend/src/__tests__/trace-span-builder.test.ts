import winston from 'winston';
import { listRuntimeIdentityActivationTraces, listIdentityEvidenceRefs, listTraceTrafficLogs } from '@qq-bot/persistence';
import { buildConversationTracePayload } from '../services/trace-span-builder';

jest.mock('@qq-bot/persistence', () => ({
  listRuntimeIdentityActivationTraces: jest.fn(),
  listIdentityEvidenceRefs: jest.fn(),
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
    (listRuntimeIdentityActivationTraces as jest.Mock).mockResolvedValue([]);
    (listIdentityEvidenceRefs as jest.Mock).mockResolvedValue([]);
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

  it('surfaces participation decision timeline metadata as readable decision spans', async () => {
    const db = createDatabase({
      timelineRows: [
        {
          id: 301,
          trace_id: 'trace-1',
          conversation_id: 'conversation-1',
          event_type: 'participation',
          event_name: 'decision',
          event_phase: 'end',
          duration_ms: 8,
          metadata: JSON.stringify({
            decision: 'ignore',
            reason: 'cooldown_active',
            confidence: 'high',
            used_embeddings: false,
            used_llm_judge: true,
            llmJudgeModel: 'gpt-5.4-mini',
            llmJudgeDecision: 'ignore',
            llmJudgeConfidence: 'high',
            conservative_fallback: true
          }),
          event_time: '2026-03-28T10:00:00.500Z'
        }
      ]
    });

    (listTraceTrafficLogs as jest.Mock).mockResolvedValue([]);

    const payload = await buildConversationTracePayload(db as never, createLogger(), 'conversation-1');
    expect(payload).not.toBeNull();

    const participationSpan = payload!.spans.find((span) => span.name === 'phase.decision' && span.attributes['semantic.display_name'] === 'participation.decision');
    expect(participationSpan).toMatchObject({
      summary: 'participation / ignore / cooldown_active / high',
      attributes: expect.objectContaining({
        'participation.decision': 'ignore',
        'participation.reason': 'cooldown_active',
        'participation.confidence': 'high',
        'participation.used_embeddings': false,
        'participation.used_llm_judge': true,
        'participation.llm_judge_model': 'gpt-5.4-mini',
        'participation.llm_judge_decision': 'ignore',
        'participation.llm_judge_confidence': 'high',
        'participation.conservative_fallback': true
      })
    });
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

  it('renders blocked second-send attempts as blocked transition tool spans', async () => {
    const db = createDatabase({
      toolCallRows: [
        {
          id: 301,
          tool_call_id: 'tool-call-301',
          trace_id: 'trace-1',
          conversation_id: 'conversation-1',
          job_id: 'job-1',
          agent_turn: 2,
          llm_call_id: 'llm-call-1',
          tool_type: 'function',
          tool_name: 'speak_in_group',
          method_id: 'speak_in_group',
          arguments: JSON.stringify({ message: '同一句话。' }),
          result: JSON.stringify({
            outcome: 'blocked_transition',
            blocked_reason: 'already_delivery_committed',
            reason: 'Outbound delivery already committed earlier in this run.',
            duplicate_suppressed: false
          }),
          status: 'completed',
          error_message: null,
          execution_mode: 'agent_loop',
          side_effect: true,
          started_at: '2026-03-28T10:00:04.000Z',
          completed_at: '2026-03-28T10:00:04.010Z',
          duration_ms: 10
        }
      ]
    });

    (listTraceTrafficLogs as jest.Mock).mockResolvedValue([]);

    const payload = await buildConversationTracePayload(db as never, createLogger(), 'conversation-1');
    expect(payload).not.toBeNull();

    const blockedSpan = payload!.spans.find((span) => span.span_id === 'tool-call:tool-call-301');
    expect(blockedSpan).toMatchObject({
      name: 'tool.blocked_transition',
      attributes: expect.objectContaining({
        'semantic.role': 'blocked_transition',
        'tool.outcome': 'blocked_transition',
        'tool.blocked_reason': 'already_delivery_committed',
        'tool.duplicate_suppressed': false
      })
    });
    expect(String(blockedSpan?.summary)).toMatch(/already committed/i);
  });

  it('surfaces identity trace-lite activation and typed evidence spans', async () => {
    const db = createDatabase();
    (listTraceTrafficLogs as jest.Mock).mockResolvedValue([]);
    (listRuntimeIdentityActivationTraces as jest.Mock).mockResolvedValue([
      {
        id: 601,
        identity_key: 'xiaoni.main',
        run_id: 'run-identity',
        trace_id: 'trace-1',
        conversation_id: 'conversation-1',
        scene_fingerprint: 'group:253631878',
        cue_summary: 'conversation touched identity history',
        activated_refs: JSON.stringify([{ sourceType: 'accepted_identity_fact', sourceId: '801' }]),
        suppressed_refs: [],
        selected_skill_ref: 'social-boundary',
        activation_reason: 'identity-relevant cue',
        metadata: JSON.stringify({ phase: 'continuity_trial' }),
        created_at: '2026-03-28T10:00:02.000Z',
      },
    ]);
    (listIdentityEvidenceRefs as jest.Mock).mockResolvedValue([
      {
        id: 701,
        identity_key: 'xiaoni.main',
        identity_event_id: 31,
        change_candidate_id: 41,
        accepted_fact_id: 801,
        source_type: 'conversation_item',
        source_id: '123',
        trace_id: 'trace-1',
        run_id: 'run-identity',
        conversation_id: 'conversation-1',
        redaction_status: 'visible',
        confidence: 'high',
        metadata: JSON.stringify({ quote: 'source excerpt' }),
        created_at: '2026-03-28T10:00:02.100Z',
      },
    ]);

    const payload = await buildConversationTracePayload(db as never, createLogger(), 'conversation-1');
    const activationSpan = payload!.spans.find((span) => span.span_id === 'runtime-identity-activation:601');
    const evidenceSpan = payload!.spans.find((span) => span.span_id === 'identity-evidence:701');

    expect(listRuntimeIdentityActivationTraces).toHaveBeenCalledWith({
      traceId: 'trace-1',
      conversationId: 'conversation-1',
      limit: 100,
    });
    expect(listIdentityEvidenceRefs).toHaveBeenCalledWith({
      traceId: 'trace-1',
      limit: 200,
    });
    expect(activationSpan).toMatchObject({
      name: 'identity.activation',
      attributes: expect.objectContaining({
        'identity.key': 'xiaoni.main',
        'identity.activated_ref_count': 1,
        'identity.selected_skill_ref': 'social-boundary',
      }),
      output: expect.objectContaining({
        selected_skill_ref: 'social-boundary',
        activation_reason: 'identity-relevant cue',
      }),
    });
    expect(evidenceSpan).toMatchObject({
      name: 'identity.evidence_ref',
      attributes: expect.objectContaining({
        'identity.key': 'xiaoni.main',
        'identity.source_type': 'conversation_item',
        'identity.source_id': '123',
        'identity.confidence': 'high',
      }),
    });
    expect((payload!.raw_evidence as any).runtime_identity_activation_traces).toHaveLength(1);
    expect((payload!.raw_evidence as any).identity_evidence_refs).toHaveLength(1);
    expect(payload!.data_quality.identity_trace_lite).toBe('complete');
  });

  it('trims oversized provider payloads from the initial trace response', async () => {
    const db = createDatabase({
      llmCallRows: [
        {
          id: 21,
          llm_call_id: 'llm-call-big',
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
          canonical_request: JSON.stringify({ prompt: 'x'.repeat(40000) }),
          wire_request: JSON.stringify({ prompt: 'x'.repeat(40000) }),
          canonical_response: JSON.stringify({ output_text: 'y'.repeat(40000) }),
          wire_response: JSON.stringify({ output_text: 'y'.repeat(40000) }),
          effective_unified_config: JSON.stringify({ model: { provider: 'openai', name: 'gpt-5.4-mini' } }),
          processed_response: 'ok',
          input_tokens: 10,
          output_tokens: 20,
          token_usage: JSON.stringify({ input_tokens: 10, output_tokens: 20 }),
          processing_time_ms: 2000,
        },
      ],
    });

    (listTraceTrafficLogs as jest.Mock).mockResolvedValue([
      {
        id: 501,
        request_id: 'req-501',
        trace_id: 'trace-1',
        conversation_id: 'conversation-1',
        agent_turn: 1,
        llm_call_id: 'llm-call-big',
        method: 'POST',
        url: 'https://api.openai.com/v1/responses',
        host: 'api.openai.com',
        path: '/v1/responses',
        request_headers: JSON.stringify({ 'content-type': 'application/json' }),
        request_body: 'x'.repeat(50000),
        response_status: 200,
        response_headers: JSON.stringify({ 'content-type': 'application/json' }),
        response_body: JSON.stringify({ output_text: 'z'.repeat(50000) }),
        duration_ms: 321,
        request_timestamp: '2026-03-28T10:00:01.200Z',
        response_timestamp: '2026-03-28T10:00:01.521Z',
        is_ai_request: true,
        api_type: 'openai',
        error_message: null,
      },
    ]);

    const payload = await buildConversationTracePayload(db as never, createLogger(), 'conversation-1');
    const generationSpan = payload!.spans.find((span) => span.span_id === 'llm-call:llm-call-big');
    const providerSpan = payload!.spans.find((span) => span.span_id === 'provider-request:501');
    const generationInput = generationSpan?.input as any;
    const providerInput = providerSpan?.input as any;
    const rawEvidence = payload!.raw_evidence as any;

    expect(generationInput?.canonical_request).toMatchObject({
      __trace_payload_truncated: true,
      label: 'canonical_request',
    });
    expect(providerInput?.body).toMatchObject({
      __trace_payload_truncated: true,
      label: 'request_body',
    });
    expect(rawEvidence.llm_calls[0].canonical_request).toMatchObject({
      __trace_payload_truncated: true,
      label: 'canonical_request',
    });
    expect(rawEvidence.http_logs[0].response_body).toMatchObject({
      __trace_payload_truncated: true,
      label: 'response_body',
    });
  });
});
