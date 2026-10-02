import test from 'node:test';
import assert from 'node:assert/strict';

import {
  claudeEffortForModel,
  isAlwaysThinkingClaudeModel,
  translateCanonicalToMessages,
  translateMessagesResponseToCanonical,
  type AnthropicMessagesResponse
} from '../llm-provider/anthropic-translate';
import type { OpenResponseCreateRequest } from '../llm-provider/types';

// Request surface of claude-opus-5-5 / claude-sonnet-5-5, verified live 2026-10-02:
// thinking:{type:'disabled'} -> 400, tool_choice any/tool -> 400, computer_20251124 -> 400.

const TOOLS: OpenResponseCreateRequest['tools'] = [
  { type: 'function', function: { name: 'exec_command', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'read_file', parameters: { type: 'object', properties: {} } } },
  { type: 'computer_use', display_width_px: 1280, display_height_px: 800 } as any
];

function req(model: string, extra: Partial<OpenResponseCreateRequest> = {}): OpenResponseCreateRequest {
  return {
    model,
    instructions: 'sys',
    input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
    tools: TOOLS,
    ...extra
  } as OpenResponseCreateRequest;
}

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test('5.5 models are always-thinking; earlier Claude models are not', () => {
  assert.equal(isAlwaysThinkingClaudeModel('claude-opus-5-5'), true);
  assert.equal(isAlwaysThinkingClaudeModel('claude-sonnet-5-5'), true);
  assert.equal(isAlwaysThinkingClaudeModel('claude-opus-4-6'), false);
  assert.equal(isAlwaysThinkingClaudeModel('LongCat-2.5-Preview'), false);
});

test('5.5: thinking adaptive + effort even with the global thinking kill-switch off', () => {
  withEnv({ ANTHROPIC_THINKING_ENABLED: undefined, ANTHROPIC_EFFORT: undefined, ANTHROPIC_EFFORT_BY_MODEL: undefined, ANTHROPIC_THINKING_DISPLAY: undefined }, () => {
    for (const model of ['claude-opus-5-5', 'claude-sonnet-5-5']) {
      const { body, thinkingEnabled } = translateCanonicalToMessages(req(model));
      assert.equal(thinkingEnabled, true);
      assert.deepEqual(body.thinking, { type: 'adaptive', display: 'summarized' });
      assert.deepEqual(body.output_config, { effort: 'low' });
    }
  });
});

test('pre-5.5 Claude keeps the old thinking-off wire (no thinking, no output_config)', () => {
  withEnv({ ANTHROPIC_THINKING_ENABLED: undefined }, () => {
    const { body } = translateCanonicalToMessages(req('claude-opus-4-6'));
    assert.equal(body.thinking, undefined);
    assert.equal(body.output_config, undefined);
  });
});

test('effort is a pure function of the model id (per-model map, then global default)', () => {
  withEnv({ ANTHROPIC_EFFORT: 'medium', ANTHROPIC_EFFORT_BY_MODEL: JSON.stringify({ 'claude-opus-5-5': 'high' }) }, () => {
    assert.equal(claudeEffortForModel('claude-opus-5-5'), 'high');
    assert.equal(claudeEffortForModel('claude-sonnet-5-5'), 'medium');
  });
  withEnv({ ANTHROPIC_EFFORT: 'bogus', ANTHROPIC_EFFORT_BY_MODEL: '{not json' }, () => {
    assert.equal(claudeEffortForModel('claude-opus-5-5'), 'low');
  });
});

test('5.5: forced tool_choice is sent as auto (tool subset kept) and flagged for the retry loop', () => {
  const forced = req('claude-opus-5-5', {
    tool_choice: { type: 'allowed_tools', mode: 'required', tools: [{ type: 'function', name: 'exec_command' }] } as any
  });
  const { body, forcedToolChoiceDowngraded } = translateCanonicalToMessages(forced);
  assert.deepEqual(body.tool_choice, { type: 'auto' });
  assert.deepEqual(body.tools?.map((t) => t.name), ['exec_command']);
  assert.equal(forcedToolChoiceDowngraded, true);
  assert.equal(body.thinking?.type, 'adaptive');

  const auto = translateCanonicalToMessages(req('claude-opus-5-5', { tool_choice: 'auto' }));
  assert.equal(auto.forcedToolChoiceDowngraded, false);
});

test('5.5: computer tool goes out as the plain `computer` function (no computer_20251124)', () => {
  const { body } = translateCanonicalToMessages(req('claude-sonnet-5-5'));
  const computer = body.tools?.find((t) => t.name === 'computer');
  assert.ok(computer);
  assert.equal(computer!.type, undefined);
  assert.ok(computer!.input_schema);
  assert.ok(!body.tools?.some((t) => typeof t.type === 'string' && t.type.startsWith('computer_')));
  // pre-5.5 Claude still gets the native computer tool
  const old = translateCanonicalToMessages(req('claude-opus-4-6'));
  assert.equal(old.body.tools?.find((t) => t.name === 'computer')?.type, 'computer_20251124');
});

test('5.5: identical canonical -> byte-identical wire (main and fork clones share the prefix)', () => {
  const a = translateCanonicalToMessages(req('claude-opus-5-5', { tool_choice: 'auto' })).body;
  const b = translateCanonicalToMessages(JSON.parse(JSON.stringify(req('claude-opus-5-5', { tool_choice: 'auto' })))).body;
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('response keeps interleaved thinking blocks in content order and replays them in that order', () => {
  const resp: AnthropicMessagesResponse = {
    model: 'claude-opus-5-5',
    stop_reason: 'tool_use',
    content: [
      { type: 'thinking', thinking: 'plan', signature: 'S1' },
      { type: 'text', text: '先看看目录' },
      { type: 'tool_use', id: 'toolu_1', name: 'exec_command', input: { cmd: 'ls' } },
      { type: 'thinking', thinking: 'progress note', signature: 'S2' },
      { type: 'tool_use', id: 'toolu_2', name: 'read_file', input: { path: 'a' } }
    ],
    usage: { input_tokens: 1, output_tokens: 1 }
  };
  const canonical = translateMessagesResponseToCanonical(resp, 'claude-opus-5-5');
  assert.deepEqual(canonical.output.map((o) => o.type), ['reasoning', 'message', 'function_call', 'reasoning', 'function_call']);

  const replay = translateCanonicalToMessages(req('claude-opus-5-5', {
    tool_choice: 'auto',
    input: [
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] },
      ...(canonical.output as any[]),
      { type: 'function_call_output', call_id: 'toolu_1', output: 'a' },
      { type: 'function_call_output', call_id: 'toolu_2', output: 'b' }
    ]
  })).body;
  const firstAssistant = replay.messages[1]!;
  assert.equal(firstAssistant.role, 'assistant');
  assert.deepEqual(firstAssistant.content.map((b) => b.type), ['thinking', 'text', 'tool_use']);
  const secondAssistant = replay.messages[3]!;
  assert.deepEqual(secondAssistant.content.map((b) => b.type), ['thinking', 'tool_use']);
  assert.equal((secondAssistant.content[0] as any).signature, 'S2');
});

test('response: refusal settles as final_answer', () => {
  const canonical = translateMessagesResponseToCanonical({
    model: 'claude-opus-5-5',
    stop_reason: 'refusal',
    content: [],
    usage: { input_tokens: 1, output_tokens: 0 }
  }, 'claude-opus-5-5');
  const msg = canonical.output.find((o) => o.type === 'message') as any;
  assert.equal(msg.phase, 'final_answer');
});
