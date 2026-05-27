import test from 'node:test';
import assert from 'node:assert/strict';
import { CodexProvider } from '../llm-provider/codex-provider';
import { GeminiCliProvider } from '../llm-provider/gemini-cli-provider';
import { OpenAIProvider } from '../llm-provider/openai-provider';
import type { OpenResponseCreateRequest, OpenResponseToolDefinition } from '../llm-provider/types';
import { buildRequestFromMessages, buildUnifiedConfig } from '../provider-debug-service';
import { buildTraceHeaders } from '../../utils/trace-headers';

class TestOpenAIProvider extends OpenAIProvider {
  buildPayload(request: OpenResponseCreateRequest) {
    return this.buildResponsesPayload(request);
  }
}

class TestCodexProvider extends CodexProvider {
  buildPayload(request: OpenResponseCreateRequest) {
    return this.buildResponsesPayload(request);
  }

  transportDefaults() {
    return {
      baseUrl: this.baseUrl,
      responsesPath: this.responsesPath
    };
  }

  resolveApiKeyForTest() {
    return this.resolveApiKey();
  }

  postForTest(payload: Record<string, any>, traceHeaders: Record<string, string> = {}) {
    return this.postResponses(
      this.baseUrl,
      this.responsesPath,
      payload,
      'ignored-direct-token',
      1000,
      traceHeaders
    );
  }
}

const TOOL_DEFINITIONS: OpenResponseToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'finish',
      description: 'Finish the current run.',
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string' },
          note: { type: 'string' }
        },
        required: ['reason'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'web_search',
    search_context_size: 'medium',
    external_web_access: true
  }
];

function createCanonicalRequest(): OpenResponseCreateRequest {
  return {
    model: 'gpt-5.4-mini',
    instructions: 'System prompt from canonical request.',
    previous_response_id: 'resp_prev_789',
    prompt_cache_key: 'qq:group:101',
    prompt_cache_retention: '24h',
    input: [
      {
        type: 'message',
        role: 'user',
        content: 'Hello from the user.'
      }
    ],
    tools: TOOL_DEFINITIONS,
    tool_choice: 'required',
    parallel_tool_calls: false
  };
}

function createAllowedToolsRequest(): OpenResponseCreateRequest {
  return {
    ...createCanonicalRequest(),
    tool_choice: {
      type: 'allowed_tools',
      mode: 'required',
      tools: [
        { type: 'function', name: 'finish' }
      ]
    }
  };
}

test('OpenAI provider keeps canonical instructions top-level and preserves parallel_tool_calls', () => {
  const provider = new TestOpenAIProvider({} as any);
  const payload = provider.buildPayload(createCanonicalRequest());

  assert.equal(payload.instructions, 'System prompt from canonical request.');
  assert.equal(payload.parallel_tool_calls, false);
  assert.equal(Array.isArray(payload.input), true);
  assert.equal(payload.input[0]?.role, 'user');
  assert.equal(payload.input.some((item: any) => item?.role === 'system'), false);
  assert.equal(payload.tool_choice, 'required');
  assert.equal(payload.previous_response_id, 'resp_prev_789');
  assert.equal(payload.prompt_cache_key, 'qq:group:101');
  assert.equal(payload.prompt_cache_retention, '24h');
  assert.equal(payload.tools[1]?.type, 'web_search');
  assert.equal(payload.tools[1]?.search_context_size, 'medium');
  assert.equal(payload.tools[1]?.external_web_access, true);
  assert.equal(payload.tools[0]?.strict, true);
  assert.deepEqual(payload.tools[0]?.parameters?.required, ['reason', 'note']);
  assert.deepEqual(payload.tools[0]?.parameters?.properties?.note?.type, ['string', 'null']);
});

test('OpenAI provider serializes allowed_tools without changing the tool list', () => {
  const provider = new TestOpenAIProvider({} as any);
  const payload = provider.buildPayload(createAllowedToolsRequest());

  assert.deepEqual(payload.tool_choice, {
    type: 'allowed_tools',
    mode: 'required',
    tools: [
      { type: 'function', name: 'finish' }
    ]
  });
  assert.equal(payload.tools.length, TOOL_DEFINITIONS.length);
});

test('Codex provider keeps canonical instructions top-level and preserves parallel_tool_calls', () => {
  const provider = new TestCodexProvider({} as any);
  const payload = provider.buildPayload(createCanonicalRequest());

  assert.equal(payload.instructions, 'System prompt from canonical request.');
  assert.equal(payload.parallel_tool_calls, false);
  assert.equal(Array.isArray(payload.input), true);
  assert.equal(payload.input[0]?.role, 'user');
  assert.equal(payload.input.some((item: any) => item?.role === 'system'), false);
  assert.equal(payload.tool_choice, 'required');
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'previous_response_id'), false);
  assert.equal(payload.prompt_cache_key, 'qq:group:101');
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'prompt_cache_retention'), false);
  assert.equal(payload.tools[1]?.type, 'web_search');
  assert.equal(payload.tools[1]?.search_context_size, 'medium');
  assert.equal(payload.tools[1]?.external_web_access, true);
  assert.equal(payload.tools[0]?.strict, true);
  assert.deepEqual(payload.tools[0]?.parameters?.required, ['reason', 'note']);
  assert.deepEqual(payload.tools[0]?.parameters?.properties?.note?.type, ['string', 'null']);
  assert.deepEqual(payload.reasoning, { summary: 'auto' });
  assert.deepEqual(payload.include, ['reasoning.encrypted_content']);
});

test('Codex provider serializes allowed_tools without changing the tool list', () => {
  const provider = new TestCodexProvider({} as any);
  const payload = provider.buildPayload(createAllowedToolsRequest());

  assert.deepEqual(payload.tool_choice, {
    type: 'allowed_tools',
    mode: 'required',
    tools: [
      { type: 'function', name: 'finish' }
    ]
  });
});

test('Codex provider preserves explicit reasoning settings and include values', () => {
  const provider = new TestCodexProvider({} as any);
  const payload = provider.buildPayload({
    ...createCanonicalRequest(),
    reasoning: {
      effort: 'high',
      summary: 'detailed'
    },
    include: ['reasoning.encrypted_content', 'file_search_call.results']
  });

  assert.deepEqual(payload.reasoning, {
    effort: 'high',
    summary: 'detailed'
  });
  assert.deepEqual(payload.include, ['reasoning.encrypted_content', 'file_search_call.results']);
});

test('Codex provider defaults proxy-key mode to CLIProxyAPI Codex direct route', async () => {
  const previousEnv = {
    CODEX_BASE_URL: process.env.CODEX_BASE_URL,
    CODEX_PROXY_BASE_URL: process.env.CODEX_PROXY_BASE_URL,
    CODEX_PROXY_API_KEY: process.env.CODEX_PROXY_API_KEY
  };

  try {
    delete process.env.CODEX_BASE_URL;
    delete process.env.CODEX_PROXY_BASE_URL;
    delete process.env.CODEX_PROXY_API_KEY;

    const provider = new TestCodexProvider({
      codex_proxy_api_key: 'proxy-key',
      authorized_user_id: 1,
      bot_qq_number: 2,
      gemini_api_keys: [],
      model_name: 'gpt-5.4-mini'
    });

    assert.deepEqual(provider.transportDefaults(), {
      baseUrl: 'http://host.docker.internal:8317/backend-api',
      responsesPath: '/codex/responses'
    });
    assert.equal(await provider.resolveApiKeyForTest(), 'proxy-key');
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test('Codex provider sends CLIProxyAPI proxy requests as SSE and assembles the response', async () => {
  const previousFetch = globalThis.fetch;
  const calls: Array<{ url: string; init: any }> = [];

  try {
    (globalThis as any).fetch = async (url: string, init: any) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => [
          'event: response.output_text.delta',
          'data: {"type":"response.output_text.delta","delta":"hello"}',
          '',
          'event: response.completed',
          'data: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":3,"output_tokens":1,"total_tokens":4}}}',
          ''
        ].join('\n')
      };
    };

    const provider = new TestCodexProvider({
      codex_base_url: 'http://proxy.test/backend-api',
      codex_proxy_api_key: 'proxy-key',
      authorized_user_id: 1,
      bot_qq_number: 2,
      gemini_api_keys: [],
      model_name: 'gpt-5.4-mini'
    });

    const response = await provider.postForTest({
      model: 'gpt-5.4-mini',
      stream: true,
      input: [{ type: 'message', role: 'user', content: 'ping' }]
    }, {
      session_id: 'qq:group:101',
      'x-codex-turn-metadata': '{"session_id":"qq:group:101"}'
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, 'http://proxy.test/backend-api/codex/responses');
    assert.equal(calls[0]?.init?.headers?.Authorization, 'Bearer proxy-key');
    assert.equal(calls[0]?.init?.headers?.Accept, 'text/event-stream');
    assert.equal(calls[0]?.init?.headers?.['Content-Type'], 'application/json');
    assert.equal(calls[0]?.init?.headers?.session_id, 'qq:group:101');
    assert.equal(calls[0]?.init?.headers?.['chatgpt-account-id'], undefined);
    assert.equal(JSON.parse(calls[0]?.init?.body).stream, true);
    assert.equal(response.output_text, 'hello');
    assert.equal(response.usage.total_tokens, 4);
  } finally {
    (globalThis as any).fetch = previousFetch;
  }
});

test('Gemini CLI provider rejects structured allowed_tools tool_choice', () => {
  const provider = new GeminiCliProvider({} as any);

  assert.throws(
    () => (provider as any).buildRequestPayload({
      modelName: 'gemini-2.5-flash',
      providerConfig: undefined,
      request: createAllowedToolsRequest()
    }, 'test-project'),
    /does not support structured tool_choice objects/
  );
});

test('Codex provider preserves reasoning summary and encrypted content from SSE output', () => {
  const provider = new TestCodexProvider({} as any);
  const parsed = (provider as any).parseCodexSsePayload([
    'event: response.output_item.done',
    'data: {"type":"response.output_item.done","item":{"type":"reasoning","encrypted_content":"enc","summary":[{"type":"summary_text","text":"done"}]}}',
    '',
    'event: response.output_item.done',
    'data: {"type":"response.output_item.done","item":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"hello"}]}}',
    '',
    'event: response.completed',
    'data: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":10,"output_tokens":2,"total_tokens":12}}}'
  ].join('\n'));

  assert.deepEqual(parsed.output[0], {
    type: 'reasoning',
    summary: [{
      type: 'summary_text',
      text: 'done'
    }],
    encrypted_content: 'enc'
  });
  assert.equal(parsed.output[1]?.type, 'message');
  assert.equal(parsed.output_text, 'hello');
});

test('Codex provider preserves web search items from SSE output', () => {
  const provider = new TestCodexProvider({} as any);
  const parsed = (provider as any).parseCodexSsePayload([
    'event: response.output_item.done',
    'data: {"type":"response.output_item.done","item":{"type":"web_search_call","id":"ws_1","status":"completed","action":{"type":"search","queries":["qq bot latest"]}}}',
    '',
    'event: response.output_item.done',
    'data: {"type":"response.output_item.done","item":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"done","annotations":[{"type":"url_citation","url":"https://example.com","title":"Example"}]}]}}',
    '',
    'event: response.completed',
    'data: {"type":"response.completed","response":{"status":"completed"}}'
  ].join('\n'));

  assert.deepEqual(parsed.output[0], {
    type: 'web_search_call',
    id: 'ws_1',
    status: 'completed',
    action: {
      type: 'search',
      queries: ['qq bot latest']
    }
  });
  assert.equal(parsed.output[1]?.type, 'message');
  assert.deepEqual(parsed.output[1]?.content?.[0]?.annotations, [{
    type: 'url_citation',
    url: 'https://example.com',
    title: 'Example'
  }]);
});

test('buildTraceHeaders emits Codex-compatible session metadata headers', () => {
  const headers = buildTraceHeaders({
    traceId: 'trace-1',
    agentTurn: 2,
    llmCallId: 'llm-1',
    sessionId: 'qq:group:101',
    turnId: 'run-1',
    sandbox: 'none'
  });

  assert.equal(headers['x-trace-id'], 'trace-1');
  assert.equal(headers['x-agent-turn'], '2');
  assert.equal(headers['x-llm-call-id'], 'llm-1');
  assert.equal(headers.session_id, 'qq:group:101');
  assert.match(headers['x-codex-turn-metadata'], /"session_id":"qq:group:101"/);
  assert.match(headers['x-codex-turn-metadata'], /"turn_id":"run-1"/);
  assert.match(headers['x-codex-turn-metadata'], /"sandbox":"none"/);
});

test('provider debug request builder maps systemPrompt into instructions instead of a synthetic system input message', () => {
  const config = buildUnifiedConfig('gpt-5.4-mini', 'codex', {}, 'Prompt from provider debug');
  const request = buildRequestFromMessages(
    'gpt-5.4-mini',
    'Prompt from provider debug',
    [
      { role: 'user', content: 'First message' },
      { role: 'assistant', content: 'First answer' }
    ],
    config
  );

  assert.equal(request.instructions, 'Prompt from provider debug');
  assert.equal(Array.isArray(request.input), true);
  assert.equal((request.input as any[])[0]?.role, 'user');
  assert.equal((request.input as any[]).some((item) => item?.role === 'system'), false);
});
