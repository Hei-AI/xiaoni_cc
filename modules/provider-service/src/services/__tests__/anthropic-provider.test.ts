import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

import {
  translateCanonicalToMessages,
  translateMessagesResponseToCanonical,
  type AnthropicMessagesResponse
} from '../llm-provider/anthropic-translate';
import {
  loadClaudeOAuthCredential,
  buildClaudeHeaders,
  refreshClaudeOAuthCredential,
  CLAUDE_OAUTH_TOKEN_URL
} from '../llm-provider/anthropic-oauth';
import { inferProviderFromModelName } from '../llm-provider/provider-config';
import { AnthropicProvider } from '../llm-provider/anthropic-provider';
import { xxh64, signClaudeBillingCch } from '../llm-provider/anthropic-cch';
import type { OpenResponseCreateRequest } from '../llm-provider/types';
import type { AIConfig } from '../../types';

function baseConfig(extra: Partial<AIConfig> = {}): AIConfig {
  return {
    gemini_api_keys: [],
    model_name: 'claude-opus-4-6',
    authorized_user_id: 1,
    bot_qq_number: 1,
    ...extra
  } as AIConfig;
}

// ---------------------------------------------------------------------------
// Provider dispatch / inference
// ---------------------------------------------------------------------------

test('inferProviderFromModelName routes claude-* to anthropic', () => {
  assert.equal(inferProviderFromModelName('claude-opus-4-6'), 'anthropic');
  assert.equal(inferProviderFromModelName('claude-sonnet-4-6'), 'anthropic');
  assert.equal(inferProviderFromModelName('gpt-5.5'), 'codex-local');
  assert.equal(inferProviderFromModelName('gpt-4o'), 'openai');
});

test('MODEL_PROVIDER_OVERRIDES_JSON can force anthropic', () => {
  const prev = process.env.MODEL_PROVIDER_OVERRIDES_JSON;
  process.env.MODEL_PROVIDER_OVERRIDES_JSON = JSON.stringify({ 'my-model': 'claude' });
  try {
    assert.equal(inferProviderFromModelName('my-model'), 'anthropic');
  } finally {
    if (prev === undefined) delete process.env.MODEL_PROVIDER_OVERRIDES_JSON;
    else process.env.MODEL_PROVIDER_OVERRIDES_JSON = prev;
  }
});

// ---------------------------------------------------------------------------
// Translate request: tools / tool_choice
// ---------------------------------------------------------------------------

const FN_TOOLS = [
  { type: 'function' as const, function: { name: 'exec_command', parameters: { type: 'object', properties: {} } } },
  { type: 'function' as const, function: { name: 'private_message', parameters: { type: 'object', properties: {} } } },
  { type: 'function' as const, function: { name: 'compress_core_memory', parameters: { type: 'object', properties: {} } } },
  { type: 'web_search' as const },
  { type: 'image_generation' as const }
];

test('allowed_tools(auto, subset) -> tools[]=subset + tool_choice auto + thinking on', () => {
  const req: OpenResponseCreateRequest = {
    model: 'claude-opus-4-6',
    instructions: 'You are Xiaoni.',
    input: [{ type: 'message', role: 'user', content: 'hi' }],
    tools: FN_TOOLS,
    tool_choice: {
      type: 'allowed_tools',
      mode: 'auto',
      tools: [
        { type: 'function', name: 'exec_command' },
        { type: 'function', name: 'private_message' },
        { type: 'web_search' }
      ]
    }
  };
  const { body, thinkingEnabled } = translateCanonicalToMessages(req);
  assert.equal(body.tool_choice?.type, 'auto');
  assert.equal(thinkingEnabled, true);
  assert.deepEqual(body.thinking, { type: 'adaptive' });
  const names = (body.tools || []).map((t) => t.type || t.name).sort();
  // image_generation dropped, compress not allowed -> excluded; web_search mapped to server tool
  assert.deepEqual(names, ['exec_command', 'private_message', 'web_search_20260209'].sort());
  // system[] = [ billing block, Claude Code identity cloak, the real instructions ];
  // the cache breakpoint lands on the last system block (the instructions).
  assert.match(body.system?.[0]?.text || '', /x-anthropic-billing-header:/);  // billing as system[0]
  assert.match(body.system?.[1]?.text || '', /Claude/);                       // identity cloak
  assert.equal(body.system?.[1]?.cache_control, undefined);                   // not the breakpoint
  assert.equal(body.system?.[2]?.text, 'You are Xiaoni.');                    // real instructions
  assert.deepEqual(body.system?.[2]?.cache_control, { type: 'ephemeral' });
});

test('ANTHROPIC_THINKING_ENABLED=false forces thinking off even on auto tool_choice', () => {
  const prev = process.env.ANTHROPIC_THINKING_ENABLED;
  process.env.ANTHROPIC_THINKING_ENABLED = 'false';
  try {
    const req: OpenResponseCreateRequest = {
      model: 'claude-opus-4-6',
      instructions: 'You are Xiaoni.',
      input: [{ type: 'message', role: 'user', content: 'hi' }],
      tools: FN_TOOLS,
      tool_choice: {
        type: 'allowed_tools',
        mode: 'auto',
        tools: [
          { type: 'function', name: 'exec_command' },
          { type: 'function', name: 'private_message' }
        ]
      }
    };
    const { body, thinkingEnabled } = translateCanonicalToMessages(req);
    assert.equal(body.tool_choice?.type, 'auto');   // still auto — only thinking is suppressed
    assert.equal(thinkingEnabled, false);
    assert.equal(body.thinking, undefined);          // no thinking param sent to Anthropic
  } finally {
    if (prev === undefined) delete process.env.ANTHROPIC_THINKING_ENABLED;
    else process.env.ANTHROPIC_THINKING_ENABLED = prev;
  }
});

test('every tool_use is immediately followed by its tool_result (Anthropic pairing)', () => {
  const req: OpenResponseCreateRequest = {
    model: 'claude-opus-4-6',
    instructions: 'sys',
    input: [
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'do it' }] },
      // tool_use whose output is split from it by a developer reminder
      { type: 'function_call', call_id: 'call_A', name: 'exec_command', arguments: '{}' },
      { type: 'message', role: 'developer', content: '[reminder]' },
      { type: 'function_call_output', call_id: 'call_A', output: 'ok A' },
      // dangling tool_use with no recorded output
      { type: 'function_call', call_id: 'call_B', name: 'exec_command', arguments: '{}' },
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'next' }] }
    ],
    tools: FN_TOOLS,
    tool_choice: { type: 'allowed_tools', mode: 'auto', tools: [{ type: 'function', name: 'exec_command' }] }
  };
  const { body } = translateCanonicalToMessages(req);
  for (let i = 0; i < body.messages.length; i += 1) {
    const toolUseIds = body.messages[i]!.content.filter((b) => b.type === 'tool_use').map((b) => (b as any).id);
    if (toolUseIds.length === 0) continue;
    const next = body.messages[i + 1];
    assert.ok(next && next.role === 'user', `tool_use msg ${i} must be followed by a user message`);
    const resultIds = new Set(next!.content.filter((b) => b.type === 'tool_result').map((b) => (b as any).tool_use_id));
    for (const id of toolUseIds) {
      assert.ok(resultIds.has(id), `tool_result for ${id} must be present immediately after`);
    }
  }
});

test('cache_anchor item gets its own breakpoint so the compression head boundary stays warm', () => {
  const req: OpenResponseCreateRequest = {
    model: 'claude-opus-4-6',
    instructions: 'You are Xiaoni.',
    input: [
      // head boundary (H_X): the last turn the compression fork will summarize
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'old head boundary' }], cache_anchor: true } as any,
      { type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: 'ack' }] },
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'recent retained' }] },
      { type: 'message', role: 'developer', content: 'volatile runtime reminder' }
    ],
    tools: FN_TOOLS,
    tool_choice: { type: 'allowed_tools', mode: 'auto', tools: [{ type: 'function', name: 'exec_command' }] }
  };
  const { body } = translateCanonicalToMessages(req);

  // collect every cache_control breakpoint
  const breakpoints: string[] = [];
  for (const s of body.system || []) {
    if (s.cache_control) breakpoints.push('system');
  }
  let anchorMarked = false;
  let tailMarked = false;
  body.messages.forEach((m) => m.content.forEach((b) => {
    if ((b as any).cache_control) {
      breakpoints.push((b as any).text || (b as any).type);
      if ((b as any).text === 'old head boundary') anchorMarked = true;
      if ((b as any).text === 'recent retained') tailMarked = true;
    }
  }));

  // system + anchor(head boundary) + last-durable(retained tail) == 3, within the 4 cap
  assert.ok(breakpoints.length >= 3 && breakpoints.length <= 4, `breakpoints=${breakpoints.join(',')}`);
  assert.equal(anchorMarked, true);   // [..H_X] gets its own warm entry
  assert.equal(tailMarked, true);     // live tail still cached for the next turn
});

test('allowed_tools(required, [exec,compress]) -> tool_choice any + thinking off', () => {
  const req: OpenResponseCreateRequest = {
    model: 'claude-opus-4-6',
    input: [{ type: 'message', role: 'user', content: 'x' }],
    tools: FN_TOOLS,
    tool_choice: {
      type: 'allowed_tools',
      mode: 'required',
      tools: [
        { type: 'function', name: 'exec_command' },
        { type: 'function', name: 'compress_core_memory' }
      ]
    }
  };
  const { body, thinkingEnabled } = translateCanonicalToMessages(req);
  assert.equal(body.tool_choice?.type, 'any');
  assert.equal(thinkingEnabled, false);
  assert.equal(body.thinking, undefined);
  const names = (body.tools || []).map((t) => t.name).sort();
  assert.deepEqual(names, ['compress_core_memory', 'exec_command']);
});

test('single forced function -> tool_choice {tool,name}', () => {
  const req: OpenResponseCreateRequest = {
    model: 'claude-opus-4-6',
    input: [{ type: 'message', role: 'user', content: 'x' }],
    tools: FN_TOOLS,
    tool_choice: { type: 'function', function: { name: 'exec_command' } }
  };
  const { body, thinkingEnabled } = translateCanonicalToMessages(req);
  assert.deepEqual(body.tool_choice, { type: 'tool', name: 'exec_command' });
  assert.equal(thinkingEnabled, false);
});

test("tool_choice 'none' -> {type:none}, no tools, thinking off", () => {
  const req: OpenResponseCreateRequest = {
    model: 'claude-opus-4-6',
    input: [{ type: 'message', role: 'user', content: 'x' }],
    tools: FN_TOOLS,
    tool_choice: 'none',
    max_output_tokens: 1
  };
  const { body, thinkingEnabled } = translateCanonicalToMessages(req);
  assert.deepEqual(body.tool_choice, { type: 'none' });
  assert.equal(body.tools, undefined);
  assert.equal(thinkingEnabled, false);
  assert.equal(body.max_tokens, 1);
});

test('aligned fork (auto tool_choice) keeps thinking ON so it rides the main prefix cache', () => {
  // Cache-alignment contract: forks inherit the main loop's auto tool_choice, so
  // their tools+system+history prefix AND thinking param stay byte-identical to the
  // main loop's and read the same warm cache entry. Tool restriction is enforced at
  // execution time in agent-service, NOT by cropping tool_choice/thinking here.
  const req: OpenResponseCreateRequest = {
    model: 'claude-opus-4-6',
    input: [{ type: 'message', role: 'user', content: 'x' }],
    tools: FN_TOOLS,
    tool_choice: { type: 'allowed_tools', mode: 'auto', tools: [{ type: 'function', name: 'exec_command' }] },
    metadata: { image_vision_fork: 'true' }
  };
  const { thinkingEnabled, body } = translateCanonicalToMessages(req);
  assert.equal(thinkingEnabled, true);
  assert.deepEqual(body.thinking, { type: 'adaptive' });
  assert.equal(body.tool_choice?.type, 'auto');
});

// ---------------------------------------------------------------------------
// Translate request: input items
// ---------------------------------------------------------------------------

test('developer role + function_call/output + image translate correctly', () => {
  const dataUrl = 'data:image/png;base64,QUJD';
  const req: OpenResponseCreateRequest = {
    model: 'claude-opus-4-6',
    input: [
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'look at this' }] },
      { type: 'message', role: 'assistant', phase: 'commentary', content: [{ type: 'output_text', text: '让我看看' }] },
      { type: 'function_call', call_id: 'call_1', name: 'inspect_image_placeholder', arguments: '{"image_id":"img1"}' },
      { type: 'function_call_output', call_id: 'call_1', output: [{ type: 'input_image', image_url: dataUrl }] },
      { type: 'message', role: 'developer', content: [{ type: 'input_text', text: '<system-reminder>state</system-reminder>' }] }
    ]
  };
  const { body } = translateCanonicalToMessages(req);
  // user, assistant(text+tool_use), user(tool_result + developer text)
  assert.equal(body.messages[0]?.role, 'user');
  const assistant = body.messages[1];
  assert.equal(assistant?.role, 'assistant');
  assert.equal(assistant?.content[0]?.type, 'text');
  assert.equal(assistant?.content[1]?.type, 'tool_use');
  assert.equal((assistant?.content[1] as any).id, 'call_1');
  const userTurn = body.messages[2];
  assert.equal(userTurn?.role, 'user');
  const toolResult = userTurn?.content[0] as any;
  assert.equal(toolResult.type, 'tool_result');
  assert.equal(toolResult.tool_use_id, 'call_1');
  assert.equal(toolResult.content[0].type, 'image');
  assert.deepEqual(toolResult.content[0].source, { type: 'base64', media_type: 'image/png', data: 'QUJD' });
  // developer reminder folded into the same user turn as a text block
  assert.equal(userTurn?.content[1]?.type, 'text');
});

// ---------------------------------------------------------------------------
// Translate response + golden thinking round-trip
// ---------------------------------------------------------------------------

test('response: text-only -> final_answer; usage maps cache_read', () => {
  const resp: AnthropicMessagesResponse = {
    id: 'msg_1',
    model: 'claude-opus-4-6',
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: 'hello there' }],
    usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 4000, cache_creation_input_tokens: 0 }
  };
  const canonical = translateMessagesResponseToCanonical(resp, 'claude-opus-4-6');
  const msg = canonical.output.find((o) => o.type === 'message') as any;
  assert.equal(msg.phase, 'final_answer');
  assert.equal(msg.content[0].text, 'hello there');
  assert.equal(canonical.usage.input_tokens, 4100);
  assert.equal(canonical.usage.input_tokens_details?.cached_tokens, 4000);
  assert.equal(canonical.usage.output_tokens, 20);
});

test('response with tool_use -> commentary phase + function_call item', () => {
  const resp: AnthropicMessagesResponse = {
    model: 'claude-opus-4-6',
    content: [
      { type: 'text', text: 'thinking out loud' },
      { type: 'tool_use', id: 'toolu_9', name: 'exec_command', input: { cmd: 'ls' } }
    ],
    usage: { input_tokens: 10, output_tokens: 5 }
  };
  const canonical = translateMessagesResponseToCanonical(resp, 'claude-opus-4-6');
  const msg = canonical.output.find((o) => o.type === 'message') as any;
  assert.equal(msg.phase, 'commentary');
  const call = canonical.output.find((o) => o.type === 'function_call') as any;
  assert.equal(call.call_id, 'toolu_9');
  assert.equal(call.name, 'exec_command');
  assert.equal(call.arguments, JSON.stringify({ cmd: 'ls' }));
});

test('cache breakpoint anchors on the last frozen message, not the volatile trigger', () => {
  const req: OpenResponseCreateRequest = {
    model: 'claude-opus-4-6',
    input: [
      { type: 'message', role: 'user', content: '历史触发' },
      { type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: '冻结回复' }] },
      // current-turn trigger: fresh [当前时间] stamp, marked cache_volatile by the agent
      { type: 'message', role: 'user', content: '[当前时间: 02:43:28] 当前触发', cache_volatile: true } as any
    ]
  };
  const { body } = translateCanonicalToMessages(req);
  const assistantMsg = body.messages.find((m) => m.role === 'assistant')!;
  const lastMsg = body.messages[body.messages.length - 1]!;
  // breakpoint lands on the frozen assistant reply...
  assert.ok(assistantMsg.content.some((b) => (b as any).cache_control), 'frozen reply carries the breakpoint');
  // ...NOT on the volatile current-turn trigger (the last message)
  assert.equal(lastMsg.role, 'user');
  assert.ok(!lastMsg.content.some((b) => (b as any).cache_control), 'volatile trigger has no breakpoint');
  // the cache_volatile marker is internal — it must never reach the wire
  body.messages.forEach((m) => m.content.forEach((b) => assert.equal((b as any).cache_volatile, undefined)));
  assert.equal((lastMsg as any).cache_volatile, undefined);
});

test('cache breakpoint: without the marker, the trailing user turn still anchors (regression guard)', () => {
  const req: OpenResponseCreateRequest = {
    model: 'claude-opus-4-6',
    input: [
      { type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: 'a' }] },
      { type: 'message', role: 'user', content: 'plain user turn' }
    ]
  };
  const { body } = translateCanonicalToMessages(req);
  const lastMsg = body.messages[body.messages.length - 1]!;
  assert.equal(lastMsg.role, 'user');
  assert.ok(lastMsg.content.some((b) => (b as any).cache_control), 'unmarked user turn keeps the breakpoint');
});

test('response: terminal end_turn with no text -> empty-content final_answer carrier', () => {
  // Model delivered everything via a tool earlier and ended the turn empty.
  const resp: AnthropicMessagesResponse = {
    model: 'claude-opus-4-6',
    stop_reason: 'end_turn',
    content: [],
    usage: { input_tokens: 10, output_tokens: 0 }
  };
  const canonical = translateMessagesResponseToCanonical(resp, 'claude-opus-4-6');
  const msg = canonical.output.find((o) => o.type === 'message') as any;
  assert.ok(msg, 'final_answer carrier emitted even with no text');
  assert.equal(msg.phase, 'final_answer');
  assert.deepEqual(msg.content, []);
});

test('response: terminal end_turn with only a thinking block -> final_answer carrier', () => {
  const resp: AnthropicMessagesResponse = {
    model: 'claude-opus-4-6',
    stop_reason: 'end_turn',
    content: [{ type: 'thinking', thinking: 'done', signature: 'SIG==' }],
    usage: { input_tokens: 5, output_tokens: 1 }
  };
  const canonical = translateMessagesResponseToCanonical(resp, 'claude-opus-4-6');
  const msg = canonical.output.find((o) => o.type === 'message') as any;
  assert.ok(msg, 'final_answer carrier emitted alongside thinking');
  assert.equal(msg.phase, 'final_answer');
  assert.deepEqual(msg.content, []);
});

test('response: tool_use turn with no text does NOT synthesize a final_answer', () => {
  const resp: AnthropicMessagesResponse = {
    model: 'claude-opus-4-6',
    stop_reason: 'tool_use',
    content: [{ type: 'tool_use', id: 'toolu_1', name: 'send_in_private', input: { text: 'hi' } }],
    usage: { input_tokens: 5, output_tokens: 3 }
  };
  const canonical = translateMessagesResponseToCanonical(resp, 'claude-opus-4-6');
  const msg = canonical.output.find((o) => o.type === 'message');
  assert.equal(msg, undefined, 'no assistant message for a mid-turn tool_use slice');
  const call = canonical.output.find((o) => o.type === 'function_call') as any;
  assert.equal(call.name, 'send_in_private');
});

test('round-trip: empty final_answer carrier is dropped from the Anthropic wire', () => {
  const req: OpenResponseCreateRequest = {
    model: 'claude-opus-4-6',
    input: [
      { type: 'message', role: 'user', content: 'hi' },
      { type: 'function_call', call_id: 'c1', name: 'send_in_private', arguments: '{"text":"yo"}' },
      { type: 'function_call_output', call_id: 'c1', output: 'ok' },
      // the synthesized terminal carrier — empty content
      { type: 'message', role: 'assistant', phase: 'final_answer', content: [] }
    ]
  };
  const { body } = translateCanonicalToMessages(req);
  // user(hi) -> assistant(tool_use) -> user(tool_result). The empty carrier must NOT
  // produce a trailing empty assistant turn (it would 400 / churn the cache prefix).
  assert.equal(body.messages[body.messages.length - 1]!.role, 'user');
  body.messages.forEach((m) => assert.ok(m.content.length > 0, 'no empty message turns on the wire'));
});

test('golden: thinking block survives response -> request round-trip byte-identical', () => {
  const resp: AnthropicMessagesResponse = {
    model: 'claude-opus-4-6',
    content: [
      { type: 'thinking', thinking: 'let me reason', signature: 'SIG_ABC123==' },
      { type: 'text', text: 'answer' }
    ],
    usage: { input_tokens: 1, output_tokens: 1 }
  };
  const canonical = translateMessagesResponseToCanonical(resp, 'claude-opus-4-6');
  const reasoning = canonical.output.find((o) => o.type === 'reasoning') as any;
  assert.ok(reasoning, 'reasoning item produced');

  // replay: feed the reasoning item back into a thinking-enabled request
  const replayReq: OpenResponseCreateRequest = {
    model: 'claude-opus-4-6',
    input: [
      { type: 'message', role: 'user', content: 'q' },
      { type: 'reasoning', encrypted_content: reasoning.encrypted_content },
      { type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: 'answer' }] },
      { type: 'message', role: 'user', content: 'follow up' }
    ]
  };
  const { body } = translateCanonicalToMessages(replayReq);
  const assistantTurn = body.messages.find((m) => m.role === 'assistant');
  const thinkingBlock = assistantTurn?.content.find((b) => b.type === 'thinking') as any;
  assert.ok(thinkingBlock, 'thinking block replayed');
  assert.equal(thinkingBlock.thinking, 'let me reason');
  assert.equal(thinkingBlock.signature, 'SIG_ABC123==');
});

test('legacy (non-anthropic) reasoning items are dropped on replay', () => {
  const req: OpenResponseCreateRequest = {
    model: 'claude-opus-4-6',
    input: [
      { type: 'message', role: 'user', content: 'q' },
      { type: 'reasoning', encrypted_content: 'openai-opaque-blob' },
      { type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: 'a' }] },
      { type: 'message', role: 'user', content: 'next' }
    ]
  };
  const { body } = translateCanonicalToMessages(req);
  for (const m of body.messages) {
    assert.ok(!m.content.some((b) => b.type === 'thinking'), 'no thinking block from legacy reasoning');
  }
});

// ---------------------------------------------------------------------------
// OAuth: load / headers / refresh / persist
// ---------------------------------------------------------------------------

test('loadClaudeOAuthCredential reads claudeAiOauth shape', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-cred-'));
  const file = path.join(dir, '.credentials.json');
  await fs.writeFile(file, JSON.stringify({
    claudeAiOauth: { accessToken: 'sk-ant-oat01-x', refreshToken: 'sk-ant-ort01-y', expiresAt: Date.now() + 3_600_000 },
    organizationUuid: 'org-1'
  }));
  const cfg = baseConfig({ anthropic_oauth_path: file });
  const { credential, source } = await loadClaudeOAuthCredential(cfg);
  assert.equal(credential?.access, 'sk-ant-oat01-x');
  assert.equal(credential?.refresh, 'sk-ant-ort01-y');
  assert.equal(source?.path, file);
  await fs.rm(dir, { recursive: true, force: true });
});

test('xxh64 matches the canonical XXH64 test vectors', () => {
  // official xxHash reference vectors (seed 0)
  assert.equal(xxh64(Buffer.from('', 'utf8'), 0n), 0xef46db3751d8e999n);
  assert.equal(
    xxh64(Buffer.from('Nobody inspects the spammish repetition', 'utf8'), 0n),
    0xfbcea83c8a378bf1n
  );
});

test('signClaudeBillingCch writes a body checksum that verifies (zero-and-rehash)', () => {
  const { body } = translateCanonicalToMessages({
    model: 'claude-opus-4-6',
    instructions: '你是小腻。',
    input: [{ type: 'message', role: 'user', content: 'hi' }],
    tools: FN_TOOLS,
    tool_choice: { type: 'allowed_tools', mode: 'auto', tools: [{ type: 'function', name: 'exec_command' }] }
  } as OpenResponseCreateRequest);
  const billing = body.system?.[0]?.text || '';
  // cch is filled in (5 lowercase hex), not the 00000 placeholder
  const m = billing.match(/cch=([0-9a-f]{5});/);
  assert.ok(m, 'cch present');
  assert.notEqual(m![1], '00000');
  // verify: zero the cch in the exact sent bytes, rehash, compare to the embedded cch
  const sentJson = JSON.stringify(body);
  const unsigned = sentJson.replace(/cch=[0-9a-f]{5};/, 'cch=00000;');
  const expected = (xxh64(Buffer.from(unsigned, 'utf8'), 0x6e52736ac806831en) & 0xfffffn)
    .toString(16).padStart(5, '0');
  assert.equal(m![1], expected);
  // signing again is idempotent
  signClaudeBillingCch(body);
  assert.equal(body.system?.[0]?.text, billing);
});

test('buildClaudeHeaders sets bearer + cc headers', () => {
  const headers = buildClaudeHeaders('sk-ant-oat01-z', baseConfig({ anthropic_client_version: '2.1.77' }));
  assert.equal(headers.Authorization, 'Bearer sk-ant-oat01-z');
  assert.equal(headers['anthropic-version'], '2023-06-01');
  assert.match(headers['anthropic-beta'], /oauth-2025-04-20/);
  assert.match(headers['anthropic-beta'], /claude-code-20250219/);
  assert.equal(headers['user-agent'], 'claude-cli/2.1.77 (external, cli)');
  assert.equal(headers['x-app'], 'cli');
  // billing header is NOT an HTTP header — it goes in system[0] (see translate tests)
  assert.equal(headers['x-anthropic-billing-header'], undefined);
});

test('refreshClaudeOAuthCredential posts the correct body and persists', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-cred-'));
  const file = path.join(dir, '.credentials.json');
  await fs.writeFile(file, JSON.stringify({ claudeAiOauth: { accessToken: 'old', refreshToken: 'r-old', expiresAt: 1 }, organizationUuid: 'org-1' }));

  const realFetch = globalThis.fetch;
  let capturedBody: any = null;
  (globalThis as any).fetch = async (url: string, init: any) => {
    capturedBody = JSON.parse(init.body);
    assert.equal(url, CLAUDE_OAUTH_TOKEN_URL);
    return {
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 })
    };
  };
  try {
    const refreshed = await refreshClaudeOAuthCredential({ access: 'old', refresh: 'r-old', expires: 1 }, { path: file });
    assert.equal(refreshed.access, 'new-access');
    assert.equal(refreshed.refresh, 'new-refresh');
    assert.equal(capturedBody.grant_type, 'refresh_token');
    assert.equal(capturedBody.refresh_token, 'r-old');
    assert.ok(typeof capturedBody.client_id === 'string' && capturedBody.client_id.length > 0);
    // persisted back into the file, preserving organizationUuid
    const persisted = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.equal(persisted.claudeAiOauth.accessToken, 'new-access');
    assert.equal(persisted.claudeAiOauth.refreshToken, 'new-refresh');
    assert.equal(persisted.organizationUuid, 'org-1');
  } finally {
    globalThis.fetch = realFetch;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// End-to-end provider against a local HTTP server
// ---------------------------------------------------------------------------

test('AnthropicProvider.generateContent end-to-end (local server)', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-cred-'));
  const file = path.join(dir, '.credentials.json');
  await fs.writeFile(file, JSON.stringify({
    claudeAiOauth: { accessToken: 'sk-ant-oat01-live', refreshToken: 'r', expiresAt: Date.now() + 3_600_000 }
  }));

  let seenAuth = '';
  let seenBody: any = null;
  const server = http.createServer((req, res) => {
    seenAuth = String(req.headers['authorization'] || '');
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      seenBody = JSON.parse(raw || '{}');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: 'msg_e2e',
        model: 'claude-opus-4-6',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'pong' }],
        usage: { input_tokens: 50, output_tokens: 3, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
      }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as any;
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    const provider = new AnthropicProvider(baseConfig({ anthropic_oauth_path: file }), { baseUrl });
    const result = await provider.generateContent({
      request: {
        model: 'claude-opus-4-6',
        instructions: 'sys',
        input: [{ type: 'message', role: 'user', content: 'ping' }],
        tools: FN_TOOLS,
        tool_choice: { type: 'allowed_tools', mode: 'auto', tools: [{ type: 'function', name: 'exec_command' }] },
        max_output_tokens: 64
      },
      modelName: 'claude-opus-4-6'
    });
    assert.equal(result.text, 'pong');
    assert.equal(result.provider, 'anthropic');
    assert.equal(result.wireProviderFormat, 'anthropic/messages');
    assert.equal(result.usage.inputTokens, 50);
    assert.equal(result.usage.outputTokens, 3);
    const finalMsg = result.canonicalResponse.output.find((o) => o.type === 'message') as any;
    assert.equal(finalMsg.content[0].text, 'pong');
    // server saw a translated Messages body
    assert.equal(seenAuth, 'Bearer sk-ant-oat01-live');
    assert.equal(seenBody.model, 'claude-opus-4-6');
    assert.equal(seenBody.max_tokens, 64);
    assert.match(seenBody.system[0].text, /x-anthropic-billing-header:/);  // billing block system[0]
    assert.match(seenBody.system[1].text, /Claude/);                       // identity cloak
    assert.equal(seenBody.system[2].text, 'sys');                          // real instructions
    assert.equal(seenBody.tool_choice.type, 'auto');
    assert.equal(seenBody.tools[0].name, 'exec_command');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(dir, { recursive: true, force: true });
  }
});
