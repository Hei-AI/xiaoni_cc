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
