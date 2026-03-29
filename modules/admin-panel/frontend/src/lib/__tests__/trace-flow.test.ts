import { buildTraceFlowViewModel } from '@/lib/trace-flow';
import { ConversationTraceData, TraceSpanRecord } from '@/types';

function makeSpan(overrides: Partial<TraceSpanRecord>): TraceSpanRecord {
  return {
    span_id: 'span-default',
    parent_span_id: null,
    trace_id: 'trace-1',
    conversation_id: 'conv-1',
    name: 'default.span',
    kind: 'internal',
    status_code: 'ok',
    status_message: null,
    started_at: '2026-03-22T10:00:00.000Z',
    ended_at: '2026-03-22T10:00:01.000Z',
    duration_ms: 1000,
    depth: 0,
    sort_key: '000',
    summary: 'default summary',
    attributes: {},
    input: null,
    output: null,
    evidence: null,
    events: [],
    links: [],
    confidence: 'observed',
    source_ref: null,
    ...overrides,
  };
}

function makeTrace(spans: TraceSpanRecord[]): ConversationTraceData {
  return {
    conversation_id: 'conv-1',
    batch_id: null,
    trace: {
      trace_id: 'trace-1',
      root_span_id: 'trace-root',
      status: 'processing',
      started_at: '2026-03-22T10:00:00.000Z',
      ended_at: '2026-03-22T10:00:10.000Z',
      duration_ms: 10000,
      span_count: spans.length,
      error_count: spans.filter((span) => span.status_code === 'error').length,
      summary: 'trace summary',
      first_error: null,
      bottleneck: null,
      token_summary: {
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
        cached_input_tokens: 0,
      },
    },
    spans,
    raw_evidence: {
      conversation: {},
      websocket_logs: [],
      timeline_events: [],
      llm_calls: [],
      tool_calls: [],
      http_logs: [],
      llm_jobs: [],
    },
    data_quality: {
      overall: 'complete',
    },
  };
}

describe('buildTraceFlowViewModel', () => {
  it('builds a stable tree-ordered waterfall from nested spans', () => {
    const trace = makeTrace([
      makeSpan({
        span_id: 'trace-root',
        sort_key: '000',
        summary: 'root',
        attributes: {
          'semantic.role': 'trace_root',
          'semantic.display_name': 'Conversation Trace',
        },
      }),
      makeSpan({
        span_id: 'turn-1',
        parent_span_id: 'trace-root',
        sort_key: '000.001',
        depth: 1,
        name: 'turn.1',
        attributes: {
          'semantic.role': 'turn',
          'semantic.display_name': 'Turn 1',
        },
      }),
      makeSpan({
        span_id: 'llm-1',
        parent_span_id: 'turn-1',
        sort_key: '000.001.001',
        depth: 2,
        name: 'llm.generation',
        kind: 'client',
        attributes: {
          'semantic.role': 'generation',
          'semantic.display_name': 'planner',
          'llm.model_name': 'gpt-5.4-mini',
          'llm.model_provider': 'openai',
        },
      }),
      makeSpan({
        span_id: 'http-1',
        parent_span_id: 'llm-1',
        sort_key: '000.001.001.001',
        depth: 3,
        name: 'http.request',
        kind: 'client',
        attributes: {
          'semantic.role': 'external_http',
          'semantic.display_name': 'GET api.openai.com',
          'http.path': '/v1/responses',
          'http.status_code': 200,
        },
      }),
    ]);

    const viewModel = buildTraceFlowViewModel(trace);
    expect(viewModel.rows.map((row) => row.id)).toEqual(['trace-root', 'turn-1', 'llm-1', 'http-1']);
    expect(viewModel.rows.find((row) => row.id === 'http-1')?.pathTokens).toEqual([
      'Conversation Trace',
      'Turn 1',
      'planner',
      'GET api.openai.com',
    ]);
    expect(viewModel.rows.find((row) => row.id === 'llm-1')?.subtitle).toBe('openai / gpt-5.4-mini');
    expect(viewModel.rows.find((row) => row.id === 'llm-1')?.inspector.sections.map((section) => section.id)).toEqual([
      'input',
      'output',
      'evidence',
    ]);
    expect('rawEvidenceSections' in viewModel).toBe(false);
  });

  it('keeps nested child-agent branches readable and auto-selects first error', () => {
    const trace = makeTrace([
      makeSpan({
        span_id: 'trace-root',
        sort_key: '000',
        attributes: {
          'semantic.role': 'trace_root',
          'semantic.display_name': 'Conversation Trace',
        },
      }),
      makeSpan({
        span_id: 'turn-2',
        parent_span_id: 'trace-root',
        sort_key: '000.001',
        depth: 1,
        name: 'turn.2',
        attributes: {
          'semantic.role': 'turn',
          'semantic.display_name': 'Turn 2',
        },
      }),
      makeSpan({
        span_id: 'invoke-search',
        parent_span_id: 'turn-2',
        sort_key: '000.001.001',
        depth: 2,
        name: 'tool.invocation',
        attributes: {
          'semantic.role': 'invocation',
          'semantic.display_name': 'tool.web_search',
          'tool.name': 'web_search',
        },
      }),
      makeSpan({
        span_id: 'child-agent',
        parent_span_id: 'invoke-search',
        sort_key: '000.001.001.001',
        depth: 3,
        name: 'agent.child',
        attributes: {
          'semantic.role': 'agent_run',
          'semantic.display_name': 'search-specialist',
        },
      }),
      makeSpan({
        span_id: 'child-turn-1',
        parent_span_id: 'child-agent',
        sort_key: '000.001.001.001.001',
        depth: 4,
        name: 'turn.1',
        attributes: {
          'semantic.role': 'turn',
          'semantic.display_name': 'Child Turn 1',
        },
      }),
      makeSpan({
        span_id: 'child-http',
        parent_span_id: 'child-turn-1',
        sort_key: '000.001.001.001.001.001',
        depth: 5,
        name: 'http.request',
        kind: 'client',
        status_code: 'error',
        status_message: 'upstream failed',
        attributes: {
          'semantic.role': 'external_http',
          'semantic.display_name': 'POST search.api',
          'http.path': '/search',
          'http.status_code': 500,
        },
      }),
    ]);
    trace.trace.first_error = {
      span_id: 'child-http',
      title: 'POST search.api',
      summary: 'upstream failed',
    };
    trace.trace.error_count = 1;

    const viewModel = buildTraceFlowViewModel(trace);
    const childHttpRow = viewModel.rows.find((row) => row.id === 'child-http');

    expect(viewModel.selectedSpanId).toBe('child-http');
    expect(childHttpRow?.pathTokens).toEqual([
      'Conversation Trace',
      'Turn 2',
      'tool.web_search',
      'search-specialist',
      'Child Turn 1',
      'POST search.api',
    ]);
    expect(viewModel.rows.find((row) => row.id === 'invoke-search')?.errorCountInSubtree).toBe(1);
  });

  it('exposes provider spans and traffic linkage metadata without duplicating generic http semantics', () => {
    const trace = makeTrace([
      makeSpan({
        span_id: 'trace-root',
        sort_key: '000',
        summary: 'root',
        attributes: {
          'semantic.role': 'trace_root',
          'semantic.display_name': 'Conversation Trace',
        },
      }),
      makeSpan({
        span_id: 'turn-1',
        parent_span_id: 'trace-root',
        sort_key: '000.001',
        depth: 1,
        name: 'turn.1',
        attributes: {
          'semantic.role': 'turn',
          'semantic.display_name': 'Turn 1',
        },
      }),
      makeSpan({
        span_id: 'llm-1',
        parent_span_id: 'turn-1',
        sort_key: '000.001.001',
        depth: 2,
        name: 'llm.generation',
        kind: 'client',
        attributes: {
          'semantic.role': 'generation',
          'semantic.display_name': 'planner',
          'llm.model_name': 'gpt-5.4-mini',
          'llm.model_provider': 'openai',
          'provider.request_count': 1,
          'provider.statuses': ['200'],
        },
        evidence: {
          llm_call_id: 'llm-call-1',
        },
      }),
      makeSpan({
        span_id: 'provider-request:101',
        parent_span_id: 'llm-1',
        sort_key: '000.001.001.001',
        depth: 3,
        name: 'provider.request',
        kind: 'client',
        attributes: {
          'semantic.role': 'provider_request',
          'semantic.display_name': 'POST api.openai.com',
          'trace.llm_call_id': 'llm-call-1',
          'provider.api_type': 'responses',
          'http.host': 'api.openai.com',
          'http.path': '/v1/responses',
          'http.status_code': 200,
        },
        evidence: {
          traffic_log_id: 101,
          llm_call_id: 'llm-call-1',
        },
      }),
    ]);

    const viewModel = buildTraceFlowViewModel(trace);
    const generationRow = viewModel.rows.find((row) => row.id === 'llm-1');
    const providerRequestRow = viewModel.rows.find((row) => row.id === 'provider-request:101');

    expect(generationRow?.providerRequestSpanId).toBe('provider-request:101');
    expect(generationRow?.llmCallId).toBe('llm-call-1');
    expect(providerRequestRow?.trafficLogId).toBe(101);
    expect(providerRequestRow?.llmCallId).toBe('llm-call-1');
    expect(providerRequestRow?.subtitle).toBe('responses / api.openai.com / /v1/responses');
    expect(viewModel.metrics.find((metric) => metric.label === 'HTTP')?.detail).toContain('Provider 1');
  });

  it('flattens legacy provider.exchange traces under generation', () => {
    const trace = makeTrace([
      makeSpan({
        span_id: 'trace-root',
        sort_key: '000',
        attributes: {
          'semantic.role': 'trace_root',
          'semantic.display_name': 'Conversation Trace',
        },
      }),
      makeSpan({
        span_id: 'turn-1',
        parent_span_id: 'trace-root',
        sort_key: '000.001',
        depth: 1,
        name: 'turn.1',
        attributes: {
          'semantic.role': 'turn',
          'semantic.display_name': 'Turn 1',
        },
      }),
      makeSpan({
        span_id: 'llm-1',
        parent_span_id: 'turn-1',
        sort_key: '000.001.001',
        depth: 2,
        name: 'llm.generation',
        kind: 'client',
        attributes: {
          'semantic.role': 'generation',
          'semantic.display_name': 'planner',
          'llm.model_name': 'gpt-5.4-mini',
          'llm.model_provider': 'openai',
        },
      }),
      makeSpan({
        span_id: 'provider-exchange:llm-call-1',
        parent_span_id: 'llm-1',
        sort_key: '000.001.001.001',
        depth: 3,
        name: 'provider.exchange',
        kind: 'internal',
        attributes: {
          'semantic.role': 'provider_exchange',
          'semantic.display_name': 'Provider Exchange',
        },
      }),
      makeSpan({
        span_id: 'provider-request:101',
        parent_span_id: 'provider-exchange:llm-call-1',
        sort_key: '000.001.001.001.001',
        depth: 4,
        name: 'provider.request',
        kind: 'client',
        attributes: {
          'semantic.role': 'provider_request',
          'semantic.display_name': 'POST api.openai.com',
        },
      }),
    ]);

    const viewModel = buildTraceFlowViewModel(trace);
    expect(viewModel.rows.find((row) => row.id === 'provider-exchange:llm-call-1')).toBeUndefined();
    expect(viewModel.rows.find((row) => row.id === 'llm-1')?.providerRequestSpanId).toBe('provider-request:101');
    expect(viewModel.rows.find((row) => row.id === 'provider-request:101')).toMatchObject({
      parentId: 'llm-1',
      depth: 3,
      pathTokens: ['Conversation Trace', 'Turn 1', 'planner', 'POST api.openai.com'],
    });
  });

  it('surfaces aggregated input/output/cached token metrics from raw llm evidence', () => {
    const trace = makeTrace([
      makeSpan({
        span_id: 'trace-root',
        sort_key: '000',
        attributes: {
          'semantic.role': 'trace_root',
          'semantic.display_name': 'Conversation Trace',
        },
      }),
    ]);
    trace.raw_evidence.llm_calls = [
      {
        input_tokens: 1200,
        output_tokens: 80,
        token_usage: {
          input_tokens: 1200,
          output_tokens: 80,
          cached_input_tokens: 512,
        },
      },
      {
        input_tokens: 900,
        output_tokens: 60,
        token_usage: {
          input_tokens: 900,
          output_tokens: 60,
          input_tokens_details: {
            cached_tokens: 256,
          },
        },
      },
    ];
    trace.trace.token_summary = {
      input_tokens: 2100,
      output_tokens: 140,
      total_tokens: 2240,
      cached_input_tokens: 768,
    };

    const viewModel = buildTraceFlowViewModel(trace);

    expect(viewModel.metrics.find((metric) => metric.label === 'Input Tokens')).toMatchObject({
      value: '2,100',
      detail: 'Total 2,240',
    });
    expect(viewModel.metrics.find((metric) => metric.label === 'Output Tokens')).toMatchObject({
      value: '140',
    });
    expect(viewModel.metrics.find((metric) => metric.label === 'Cached Tokens')).toMatchObject({
      value: '768',
      tone: 'success',
    });
  });
});
