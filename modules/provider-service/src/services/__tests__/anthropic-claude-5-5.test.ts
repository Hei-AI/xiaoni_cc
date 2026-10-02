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

test('5.5: computer tool goes out as the native computer toolset (no name, no display size)', () => {
  const { body } = translateCanonicalToMessages(req('claude-sonnet-5-5'));
  const computer = body.tools?.filter((t) => typeof t.type === 'string' && t.type.startsWith('computer_'));
  assert.deepEqual(computer, [{ type: 'computer_toolset_20260801' }]);
  assert.ok(!body.tools?.some((t) => t.name === 'computer'));
  // pre-5.5 Claude still gets computer_20251124
  const old = translateCanonicalToMessages(req('claude-opus-4-6'));
  assert.equal(old.body.tools?.find((t) => t.name === 'computer')?.type, 'computer_20251124');
});

test('5.5: toolset member calls map to the agent `computer` function_call and back, byte-stable', () => {
  const resp: AnthropicMessagesResponse = {
    model: 'claude-opus-5-5',
    stop_reason: 'tool_use',
    content: [
      { type: 'tool_use', id: 'toolu_c1', name: 'left_click', toolset_name: 'computer', input: { coordinate: [10, 20] } },
      { type: 'tool_use', id: 'toolu_c2', name: 'screenshot', toolset_name: 'computer', input: {} },
      { type: 'tool_use', id: 'toolu_e', name: 'exec_command', input: { cmd: 'ls' } }
    ],
    usage: { input_tokens: 1, output_tokens: 1 }
  };
  const canonical = translateMessagesResponseToCanonical(resp, 'claude-opus-5-5');
  const calls = canonical.output.filter((o) => o.type === 'function_call') as any[];
  assert.deepEqual(calls.map((c) => [c.name, c.arguments]), [
    ['computer', JSON.stringify({ action: 'left_click', coordinate: [10, 20] })],
    ['computer', JSON.stringify({ action: 'screenshot' })],
    ['exec_command', JSON.stringify({ cmd: 'ls' })]
  ]);

  const replayInput = [
    { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] },
    ...(canonical.output as any[]),
    { type: 'function_call_output', call_id: 'toolu_c1', output: 'OK' },
    { type: 'function_call_output', call_id: 'toolu_c2', output: [{ type: 'input_image', image_url: 'data:image/png;base64,AAAA' }] },
    { type: 'function_call_output', call_id: 'toolu_e', output: 'a.txt' }
  ];
  const wire = translateCanonicalToMessages(req('claude-opus-5-5', { tool_choice: 'auto', input: replayInput as any })).body;
  const toolUses = wire.messages.flatMap((m) => m.content).filter((b) => b.type === 'tool_use') as any[];
  assert.deepEqual(toolUses[0], { type: 'tool_use', id: 'toolu_c1', name: 'left_click', input: { coordinate: [10, 20] }, toolset_name: 'computer' });
  assert.deepEqual(toolUses[1], { type: 'tool_use', id: 'toolu_c2', name: 'screenshot', input: {}, toolset_name: 'computer' });
  assert.deepEqual(toolUses[2], { type: 'tool_use', id: 'toolu_e', name: 'exec_command', input: { cmd: 'ls' } });
  const results = wire.messages.flatMap((m) => m.content).filter((b) => b.type === 'tool_result') as any[];
  assert.deepEqual(results.map((r) => [r.tool_use_id, r.toolset_name]), [
    ['toolu_c1', 'computer'], ['toolu_c2', 'computer'], ['toolu_e', undefined]
  ]);
  // replaying the same canonical twice gives the same bytes
  const again = translateCanonicalToMessages(req('claude-opus-5-5', { tool_choice: 'auto', input: JSON.parse(JSON.stringify(replayInput)) })).body;
  assert.equal(JSON.stringify(again), JSON.stringify(wire));
});

test('pre-5.5 Claude replays computer calls unchanged (name computer, no toolset_name)', () => {
  const wire = translateCanonicalToMessages(req('claude-opus-4-6', {
    tool_choice: 'auto',
    input: [
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] },
      { type: 'function_call', call_id: 'c1', name: 'computer', arguments: JSON.stringify({ action: 'screenshot' }) },
      { type: 'function_call_output', call_id: 'c1', output: 'OK' }
    ] as any
  })).body;
  const toolUse = wire.messages.flatMap((m) => m.content).find((b) => b.type === 'tool_use') as any;
  assert.deepEqual(toolUse, { type: 'tool_use', id: 'c1', name: 'computer', input: { action: 'screenshot' } });
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

// ---------------------------------------------------------------------------
// Mid-conversation role:"system" for developer/system items (5.5 models)
// ---------------------------------------------------------------------------

const U = (text: string) => ({ type: 'message', role: 'user', content: [{ type: 'input_text', text }] });
const D = (text: string) => ({ type: 'message', role: 'developer', content: text });
const A = (text: string) => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });

function wireRoles(model: string, input: any[]) {
  const { body } = translateCanonicalToMessages(req(model, { tool_choice: 'auto', input }));
  return body.messages.map((m) => `${m.role}:${m.content.map((b: any) => b.text ?? b.type).join('+')}`);
}

test('developer items become role:system only between a user turn and an assistant turn (or at the end)', () => {
  const roles = wireRoles('claude-opus-5-5', [
    D('head'), U('u1'), D('d1'), A('a1'), D('after-assistant'), U('u2'), D('tail1'), D('tail2')
  ]);
  assert.deepEqual(roles, [
    'user:head+u1',
    'system:d1',
    'assistant:a1',
    'user:after-assistant+u2',
    'system:tail1+tail2'
  ]);
});

test('a developer run followed by a user item stays a user turn (API: system must precede assistant or end)', () => {
  assert.deepEqual(wireRoles('claude-sonnet-5-5', [U('u1'), D('d1'), U('u2')]), ['user:u1+d1+u2']);
});

test('pre-5.5 Claude keeps every developer item in the user turn', () => {
  assert.deepEqual(wireRoles('claude-opus-4-6', [U('u1'), D('d1'), A('a1')]), ['user:u1+d1', 'assistant:a1']);
});

test('fork clones that append a developer reminder or an assistant item keep the main prefix byte-identical', () => {
  const main = translateCanonicalToMessages(req('claude-opus-5-5', { tool_choice: 'auto', input: [U('u1'), A('a1'), U('u2'), D('trigger')] as any })).body;
  for (const tail of [[D('fork reminder')], [A('fork prefill')]]) {
    const fork = translateCanonicalToMessages(req('claude-opus-5-5', { tool_choice: 'auto', input: [U('u1'), A('a1'), U('u2'), D('trigger'), ...tail] as any })).body;
    for (let m = 0; m < main.messages.length; m += 1) {
      const mainMsg = main.messages[m]!;
      const forkMsg = fork.messages[m]!;
      assert.equal(forkMsg.role, mainMsg.role);
      // block-level prefix (cache_control placement differs by design; compare text/type only)
      const strip = (b: any) => JSON.stringify({ ...b, cache_control: undefined });
      mainMsg.content.forEach((b, k) => assert.equal(strip(forkMsg.content[k]), strip(b)));
    }
  }
});

test('tool results followed by a reminder: the reminder becomes system, tool_result stays in the user turn', () => {
  const roles = wireRoles('claude-opus-5-5', [
    U('u1'),
    { type: 'function_call', call_id: 'c1', name: 'exec_command', arguments: '{"cmd":"ls"}' },
    { type: 'function_call_output', call_id: 'c1', output: 'a.txt' },
    D('notify'),
    A('done')
  ]);
  assert.deepEqual(roles, ['user:u1', 'assistant:tool_use', 'user:tool_result', 'system:notify', 'assistant:done']);
});

test('a request carrying its own effort (main agent + fork clones) overrides the per-model default', () => {
  withEnv({ ANTHROPIC_EFFORT: 'low', ANTHROPIC_EFFORT_BY_MODEL: undefined }, () => {
    const main = translateCanonicalToMessages(req('claude-sonnet-5-5', { tool_choice: 'auto', reasoning: { effort: 'high' } } as any)).body;
    assert.deepEqual(main.output_config, { effort: 'high' });
    const sideLeg = translateCanonicalToMessages(req('claude-sonnet-5-5', { tool_choice: 'auto' })).body;
    assert.deepEqual(sideLeg.output_config, { effort: 'low' });
    const bogus = translateCanonicalToMessages(req('claude-sonnet-5-5', { tool_choice: 'auto', reasoning: { effort: 'turbo' } } as any)).body;
    assert.deepEqual(bogus.output_config, { effort: 'low' });
  });
});
