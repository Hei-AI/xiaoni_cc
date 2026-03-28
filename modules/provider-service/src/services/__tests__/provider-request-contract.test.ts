import test from 'node:test';
import assert from 'node:assert/strict';
import { CodexProvider } from '../llm-provider/codex-provider';
import { OpenAIProvider } from '../llm-provider/openai-provider';
import type { OpenResponseCreateRequest, OpenResponseToolDefinition } from '../llm-provider/types';
import { buildRequestFromMessages, buildUnifiedConfig } from '../provider-debug-service';

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
  }
];

function createCanonicalRequest(): OpenResponseCreateRequest {
  return {
    model: 'gpt-5.4-mini',
    instructions: 'System prompt from canonical request.',
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
