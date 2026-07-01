import test from 'node:test';
import assert from 'node:assert/strict';
import { translateCanonicalToMessages } from '../llm-provider/anthropic-translate';

// CONTRACT (docs/CACHE_CONTRACT.md §1 + Anthropic prompt-caching): the message-tier cache_control
// breakpoint anchors on the LAST DURABLE block. `isDurableItem` treats developer/system messages
// and any cache_volatile item as NON-durable, so a tail of those kinds stays AFTER the breakpoint
// (uncached, cheap) and the durable history prefix before it is what gets cached/reused.
//
// This is the cache-KEY determinant — input byte-identity is necessary but NOT sufficient. The
// cache heartbeat is a PRE-WARM: it WRITES the entry the next main run READS. It appends a
// role:'developer' "Return exactly: 1" placeholder, which is non-durable by ROLE, so the breakpoint
// stays on the shared history block and the heartbeat warms exactly [..history]. The real failure
// mode this guards (the F1 over-extension bug) is appending a DURABLE tail — e.g. a role:'user'
// self-continuation item — which moves the breakpoint past the history, warming [..history, tail]:
// an entry the queue-backed wake run (which reads [..history]) can never hit → full cold-read.

function lastMessageCacheBreakpoint(body: any): string {
  let last = '';
  for (const msg of body.messages || []) {
    const content = Array.isArray(msg.content) ? msg.content : [];
    for (const block of content) {
      if (block && block.cache_control) {
        last = JSON.stringify(block);
      }
    }
  }
  return last;
}

// History ending in an assistant final answer — 小腻's idle/sleep state, the heartbeat's home turf.
const BASE_INPUT = [
  { type: 'message', role: 'developer', content: [{ type: 'input_text', text: '<skills_instructions> 固定头 </skills_instructions>' }] },
  { type: 'message', role: 'user', content: [{ type: 'input_text', text: '历史一 <<HISTORY_MARKER>>' }] },
  { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '回完话了 final <<FINAL_MARKER>>' }] }
];
const mkRequest = (tail: any) => ({
  model: 'claude-opus-4-6',
  instructions: 'You are 小腻.',
  max_output_tokens: 1,
  tool_choice: 'auto',
  input: [...BASE_INPUT, tail]
});

test('message-tier cache breakpoint stays on the shared history for a developer tail, moves for a durable user tail', () => {
  // GOOD — the heartbeat's "Return exactly: 1" placeholder is role:'developer' → non-durable by
  // role → the breakpoint stays on the last durable history block (the assistant final answer).
  const heartbeatTail = translateCanonicalToMessages(mkRequest({
    type: 'message', role: 'developer',
    content: [{ type: 'input_text', text: 'Heartbeat. Return exactly: 1 <<PLACEHOLDER_MARKER>>' }]
  }) as any);
  const goodBp = lastMessageCacheBreakpoint(heartbeatTail.body);
  assert.ok(goodBp.includes('FINAL_MARKER'),
    'developer tail: the cache breakpoint must anchor on the shared history block (assistant final)');
  assert.ok(!goodBp.includes('PLACEHOLDER_MARKER'),
    'developer tail: the cache breakpoint must NOT anchor on the heartbeat placeholder');

  // BAD (the F1 bug this guards) — a DURABLE role:'user' self-continuation tail moves the breakpoint
  // onto itself, so a heartbeat ending this way would warm [..history, self-cont]: an entry the
  // queue-backed wake run (which appends NO self-continuation) can never read → cold-read of history.
  const selfContTail = translateCanonicalToMessages(mkRequest({
    type: 'message', role: 'user',
    content: [{ type: 'input_text', text: '[继续] 接着做 <<SELFCONT_MARKER>>' }]
  }) as any);
  const badBp = lastMessageCacheBreakpoint(selfContTail.body);
  assert.ok(badBp.includes('SELFCONT_MARKER'),
    'durable user tail moves the breakpoint onto itself — the over-extension shape the heartbeat must avoid');
  assert.ok(!badBp.includes('FINAL_MARKER'),
    'durable user tail: the breakpoint no longer sits on the shared history block');
});

test('cache heartbeat and the notify wake run anchor the breakpoint on the SAME shared history block', () => {
  // The heartbeat ends with a developer placeholder; a real notify wake ends with a cache_volatile
  // current-turn trigger. Both tails are non-durable, so both place the message-tier breakpoint on
  // the identical history block — the heartbeat warms the exact entry the wake run reads.
  const heartbeat = translateCanonicalToMessages(mkRequest({
    type: 'message', role: 'developer',
    content: [{ type: 'input_text', text: 'Heartbeat. Return exactly: 1 <<PLACEHOLDER_MARKER>>' }]
  }) as any);
  const wake = translateCanonicalToMessages(mkRequest({
    type: 'message', role: 'user',
    content: [{ type: 'input_text', text: '[当前回合] 有人发消息了 <<TRIGGER_MARKER>>' }],
    cache_volatile: true
  }) as any);

  const hbBp = lastMessageCacheBreakpoint(heartbeat.body);
  const wakeBp = lastMessageCacheBreakpoint(wake.body);
  assert.ok(hbBp.includes('FINAL_MARKER') && wakeBp.includes('FINAL_MARKER'),
    'both breakpoints must anchor on the shared history block (assistant final)');
  assert.equal(hbBp, wakeBp,
    'heartbeat and wake run must anchor the cache breakpoint on the byte-identical history block');
});

// FORK CACHE-ALIGNMENT (the image-vision cold-read bug, project_image_vision_fork_cache_breakdown):
// a fork clones the main request and APPENDS a small tail. To ride the main loop's warm history
// prefix, the fork's message-tier breakpoint must anchor on a block that ALSO exists in the base's
// translated history — NOT on an appended block. The image-vision fork used to append a DURABLE
// tail (an assistant sentinel + a function_call + a function_call_output holding the base64 image),
// so `lastDurable` landed on the image and the breakpoint sat PAST the shared prefix → the fork
// cold-read the whole history every turn (cache_read stuck at system+tools floor).
const FORK_BASE_INPUT = [
  { type: 'message', role: 'user', content: [{ type: 'input_text', text: '群里发了张图 <<H1>>' }] },
  { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '看看再说 <<H_TAIL>>' }] }
];
const mkForkRequest = (tail: any[]) => ({
  model: 'claude-opus-4-6',
  instructions: 'You are 小腻.',
  max_output_tokens: 256,
  tool_choice: 'auto',
  input: [...FORK_BASE_INPUT, ...tail]
});

test('image-vision fork: a DURABLE image tail moves the breakpoint off the shared history (the bug)', () => {
  // The OLD shape: durable assistant sentinel + function_call + function_call_output(image).
  const buggy = translateCanonicalToMessages(mkForkRequest([
    { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '让我来看看这个图 <<SENTINEL>>' }] },
    { type: 'function_call', call_id: 'call-img', name: 'inspect_image_placeholder', arguments: '{"image_id":"img-1"}' },
    { type: 'function_call_output', call_id: 'call-img',
      output: [{ type: 'input_image', image_url: 'data:image/png;base64,iVBORw0KGgo=', detail: 'original' }] },
    { type: 'message', role: 'developer', content: [{ type: 'input_text', text: '写死到本地 <<REMINDER>>' }] }
  ]) as any);
  const bp = lastMessageCacheBreakpoint(buggy.body);
  // The breakpoint lands on the appended image tool_result — NOT on the shared history block.
  assert.ok(!bp.includes('H_TAIL'),
    'durable image tail: breakpoint must have moved OFF the shared history (this is the cold-read bug)');
});

// 4-BREAKPOINT BUDGET (Anthropic hard cap: a request may carry at most 4 cache_control
// markers). `placeCacheBreakpoints` allocates them: [1] end of system (tools+system floor),
// [2..3] up to TWO mid-history anchors (cache_anchor items), [4] the last durable block (live
// tail). It reserves the last slot for the tail (`used >= MAX-1` break), so the tail ALWAYS
// gets a breakpoint and any anchors beyond the budget are DROPPED — never the tail. This guards
// the cap directly: a regression that emits a 5th marker is a 400 from Anthropic; one that lets
// an anchor steal the tail's reserved slot silently cold-reads the live tail every turn.
function countCacheControls(body: any): number {
  let n = 0;
  for (const s of body.system || []) if (s && s.cache_control) n += 1;
  for (const msg of body.messages || []) {
    for (const block of (Array.isArray(msg.content) ? msg.content : [])) {
      if (block && block.cache_control) n += 1;
    }
  }
  return n;
}

test('cache breakpoints never exceed 4: system + 2 anchors + last-durable tail; excess anchors dropped, tail always kept', () => {
  // THREE cache_anchor items requested but the budget only fits TWO (system+2 anchors = 3, tail = 4).
  const body = translateCanonicalToMessages({
    model: 'claude-opus-4-6',
    instructions: 'You are 小腻.',
    max_output_tokens: 1,
    tool_choice: 'auto',
    input: [
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: '历史0 <<H0>>' }] },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '锚1 <<A1>>' }], cache_anchor: true },
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: '历史2 <<H2>>' }] },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '锚2 <<A2>>' }], cache_anchor: true },
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: '历史4 <<H4>>' }] },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '锚3 <<A3>>' }], cache_anchor: true },
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: '活体尾 <<TAIL>>' }] }
    ]
  } as any).body;

  assert.ok(countCacheControls(body) <= 4, `must never emit more than 4 cache_control markers, got ${countCacheControls(body)}`);
  // The live tail (last durable) ALWAYS keeps its reserved breakpoint.
  assert.ok(lastMessageCacheBreakpoint(body).includes('TAIL'),
    'the last-durable live tail must always get a cache breakpoint (its slot is reserved)');
  // The 3rd anchor is the one dropped for budget — NOT the tail.
  const marked = JSON.stringify(body.messages);
  const anchoredA3 = body.messages.some((m: any) => (m.content || []).some((b: any) => b.cache_control && String(b.text).includes('A3')));
  assert.ok(!anchoredA3, 'the 3rd anchor must be dropped when the 4-breakpoint budget is full (tail keeps priority)');
});

test('image-vision fork: an all-non-durable tail keeps the breakpoint on the shared warm history (the fix)', () => {
  // The FIX shape: same three appended items, but ALL marked cache_volatile, plus a developer
  // system_reminder. Every appended item is non-durable → `lastDurable` stays on the shared
  // history block (<<H_TAIL>>), so the fork reads the main loop's warm prefix.
  const fixed = translateCanonicalToMessages(mkForkRequest([
    { type: 'message', role: 'assistant', cache_volatile: true,
      content: [{ type: 'input_text', text: '让我来看看这个图' }],
      // an assistant tool_use carried as a function_call (still cache_volatile → non-durable)
    },
    { type: 'function_call', call_id: 'call-img', name: 'inspect_image_placeholder',
      arguments: '{"image_id":"img-1"}', cache_volatile: true },
    { type: 'function_call_output', call_id: 'call-img', cache_volatile: true,
      output: [{ type: 'input_image', image_url: 'data:image/png;base64,iVBORw0KGgo=', detail: 'original' }] },
    { type: 'message', role: 'developer', content: [{ type: 'input_text', text: '<system_reminder>\n【视觉感知：画面消化与刻印】\n</system_reminder>' }] }
  ]) as any);
  const bp = lastMessageCacheBreakpoint(fixed.body);
  assert.ok(bp.includes('H_TAIL'),
    'all-non-durable tail: the breakpoint must anchor on the shared warm history block — the fork rides the main cache');
});
