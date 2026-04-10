import test from 'node:test';
import assert from 'node:assert/strict';
import { CodexProvider } from '../llm-provider/codex-provider';
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
          reason: { type: 'string' }
        }
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
});

test('Codex provider preserves reasoning items from SSE output', () => {
  const provider = new TestCodexProvider({} as any);
  const parsed = (provider as any).parseCodexSsePayload([
    'event: response.output_item.done',
    'data: {"type":"response.output_item.done","item":{"type":"reasoning","encrypted_content":"enc","summary":"done"}}',
    '',
    'event: response.output_item.done',
    'data: {"type":"response.output_item.done","item":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"hello"}]}}',
    '',
    'event: response.completed',
    'data: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":10,"output_tokens":2,"total_tokens":12}}}'
  ].join('\n'));

  assert.deepEqual(parsed.output[0], {
    type: 'reasoning',
    encrypted_content: 'enc',
    summary: 'done'
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
    'data: {"type":"response.output_item.done","item":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"done"}]}}',
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
