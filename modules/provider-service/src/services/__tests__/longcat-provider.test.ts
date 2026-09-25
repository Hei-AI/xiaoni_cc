import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { translateCanonicalToMessages } from '../llm-provider/anthropic-translate';
import { AnthropicProvider } from '../llm-provider/anthropic-provider';
import { createProviderClient, resolveProviderId } from '../llm-provider';
import { inferProviderFromModelName } from '../llm-provider/provider-config';
import { resolveModelContextPolicy } from '../llm-provider/model-context-policy';
import type { OpenResponseCreateRequest } from '../llm-provider/types';
import type { AIConfig } from '../../types';

const MODEL = 'LongCat-2.5-Preview';

function baseConfig(extra: Partial<AIConfig> = {}): AIConfig {
  return {
    gemini_api_keys: [],
    model_name: MODEL,
    authorized_user_id: 1,
    bot_qq_number: 1,
    ...extra
  } as AIConfig;
}

const TOOLS: OpenResponseCreateRequest['tools'] = [
  { type: 'function', function: { name: 'exec_command', description: 'run', parameters: { type: 'object', properties: { cmd: { type: 'string' } } } } },
  { type: 'function', function: { name: 'finish', description: 'done', parameters: { type: 'object', properties: {} } } },
  { type: 'web_search' } as any,
  { type: 'computer_use', display_width_px: 1024, display_height_px: 506, enable_zoom: true } as any
];

function request(extra: Partial<OpenResponseCreateRequest> = {}): OpenResponseCreateRequest {
  return {
    model: MODEL,
    instructions: 'sys',
    input: [{ type: 'message', role: 'user', content: 'ping' }],
    tools: TOOLS,
    ...extra
  } as OpenResponseCreateRequest;
}

test('LongCat model names route to the longcat provider', () => {
  assert.equal(inferProviderFromModelName(MODEL), 'longcat');
  assert.equal(resolveProviderId(null, MODEL), 'longcat');
  assert.equal(createProviderClient('longcat').id, 'longcat');
});

test('LongCat context policy is 1M window / 262K output', () => {
  const policy = resolveModelContextPolicy(MODEL);
  assert.equal(policy?.contextWindowTokens, 1048576);
  assert.equal(policy?.maxOutputTokens, 262144);
});

test('longcat dialect: no cloak system blocks, thinking disabled, no server tools, computer as function', () => {
  const { body } = translateCanonicalToMessages(request(), { dialect: 'longcat' });
  assert.deepEqual(body.system?.map((b) => b.text), ['sys']);
  assert.deepEqual(body.thinking, { type: 'disabled' });
  const names = (body.tools || []).map((t) => t.name);
  assert.deepEqual(names, ['exec_command', 'finish', 'computer']);
  const computer = body.tools!.find((t) => t.name === 'computer')!;
  assert.equal(computer.type, undefined);
  assert.equal(computer.display_width_px, undefined);
  assert.equal(computer.input_schema?.type, 'object');
  assert.deepEqual(computer.input_schema?.required, ['action']);
  assert.ok(computer.input_schema?.properties.action.enum.includes('screenshot'));
  assert.match(String(computer.description), /1024x506/);
});

test('claude dialect stays unchanged (cloak blocks, built-in computer tool, server web search)', () => {
  const { body } = translateCanonicalToMessages(request({ model: 'claude-opus-4-6' }));
  assert.equal(body.system?.length, 3);
  assert.equal(body.thinking, undefined);
  assert.equal(body.tools!.find((t) => t.name === 'computer')?.type, 'computer_20251124');
  assert.ok(body.tools!.some((t) => t.name === 'web_search' && typeof t.type === 'string'));
});

type Captured = { auth: string; beta: string | undefined; body: any };

async function withServer(
  replies: Array<Record<string, unknown>>,
  run: (baseUrl: string, seen: Captured[]) => Promise<void>
) {
  const seen: Captured[] = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      seen.push({
        auth: String(req.headers['authorization'] || ''),
        beta: req.headers['anthropic-beta'] as string | undefined,
        body: JSON.parse(raw || '{}')
      });
      const reply = replies[Math.min(seen.length - 1, replies.length - 1)];
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: `msg_${seen.length}`, model: MODEL, usage: { input_tokens: 5, output_tokens: 1 }, ...reply }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as any;
  try {
    await run(`http://127.0.0.1:${addr.port}`, seen);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function longcat(baseUrl: string) {
  return new AnthropicProvider(baseConfig(), { id: 'longcat', baseUrl, apiKey: 'ak_test', dialect: 'longcat' });
}

test('longcat provider sends the static API key and drops Files API image ids', async () => {
  await withServer([{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'pong' }] }], async (baseUrl, seen) => {
    const result = await longcat(baseUrl).generateContent({
      request: request({
        tools: undefined,
        input: [{
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_image', image_url: 'data:image/png;base64,AAAA', anthropic_file_id: 'file_x' } as any,
            { type: 'input_text', text: 'look' }
          ]
        }]
      }),
      modelName: MODEL
    });
    assert.equal(result.text, 'pong');
    assert.equal(result.provider, 'longcat');
    assert.equal(seen[0]!.auth, 'Bearer ak_test');
    assert.equal(seen[0]!.beta, undefined);
    const image = seen[0]!.body.messages[0].content[0];
    assert.deepEqual(image.source, { type: 'base64', media_type: 'image/png', data: 'AAAA' });
  });
});

test('longcat provider re-requests an unenforced forced multi-tool choice until a tool call comes back', async () => {
  await withServer([
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'no tool' }] },
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'toolu_1', name: 'finish', input: {} }] }
  ], async (baseUrl, seen) => {
    const result = await longcat(baseUrl).generateContent({
      request: request({
        tool_choice: {
          type: 'allowed_tools',
          mode: 'required',
          tools: [{ type: 'function', name: 'exec_command' }, { type: 'function', name: 'finish' }]
        }
      }),
      modelName: MODEL
    });
    assert.equal(seen.length, 2);
    assert.deepEqual(seen[0]!.body.tool_choice, { type: 'any' });
    assert.ok(result.canonicalResponse.output.some((o: any) => o.type === 'function_call' && o.name === 'finish'));
  });
});

test('longcat provider gives up after the bounded forced-tool retries', async () => {
  await withServer([{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'never' }] }], async (baseUrl, seen) => {
    const result = await longcat(baseUrl).generateContent({
      request: request({
        tool_choice: {
          type: 'allowed_tools',
          mode: 'required',
          tools: [{ type: 'function', name: 'exec_command' }, { type: 'function', name: 'finish' }]
        }
      }),
      modelName: MODEL
    });
    assert.equal(seen.length, 3);
    assert.equal(result.text, 'never');
  });
});

test('longcat provider does not retry auto tool choice replies without tools', async () => {
  await withServer([{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'chat' }] }], async (baseUrl, seen) => {
    await longcat(baseUrl).generateContent({ request: request(), modelName: MODEL });
    assert.equal(seen.length, 1);
  });
});
