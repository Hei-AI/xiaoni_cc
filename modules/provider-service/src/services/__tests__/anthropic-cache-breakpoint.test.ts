import test from 'node:test';
import assert from 'node:assert/strict';
import { translateCanonicalToMessages } from '../llm-provider/anthropic-translate';

// CONTRACT (docs/CACHE_CONTRACT.md §1 + Anthropic prompt-caching): each request pins a small
// message-tier tail SET (wire-side only, never touching the canonical input):
//   - tail        = the TRUE last content block (caches the full request, incl. a trailing frozen
//                   cache_volatile nudge, so the next hop reads it warm),
//   - prevBoundary= the block BEFORE the last assistant message = the previous request's true tail
//                   (deterministic sliding-window sharing: prevBoundary(N+1) == tail(N)),
//   - lastDurable = the last DURABLE block (`isDurableItem` treats developer/system messages and any
//                   cache_volatile item as NON-durable); keeps the idle/heartbeat final answer warm.
//
// This is the cache-KEY determinant — input byte-identity is necessary but NOT sufficient. The
// cache heartbeat is a PRE-WARM: it WRITES the entry the next main run READS. It appends a
// role:'developer' "Return exactly: 1" placeholder (non-durable by ROLE), so `lastDurable` stays on
// the shared history block (the assistant final answer) and the heartbeat warms it. The failure mode
// this guards (the F1 over-extension bug) is appending a DURABLE tail — e.g. a role:'user'
// self-continuation item — which becomes `lastDurable` and drags it off the final answer, so a
// queue-backed wake run (which reads [..final]) can no longer hit it → cold-read of the final.

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

test('lastDurable keeps the shared history final warm for a developer tail, loses it for a durable user tail', () => {
  // GOOD — the heartbeat's "Return exactly: 1" placeholder is role:'developer' → non-durable by
  // role → `lastDurable` stays on the shared history block (the assistant final answer), so it keeps
  // a breakpoint that the queue-backed wake run also pins. The true-end tail (placeholder) ALSO gets
  // a breakpoint now, but that is harmless — the point is the FINAL stays warm.
  const heartbeatTail = translateCanonicalToMessages(mkRequest({
    type: 'message', role: 'developer',
    content: [{ type: 'input_text', text: 'Heartbeat. Return exactly: 1 <<PLACEHOLDER_MARKER>>' }]
  }) as any);
  assert.ok(pinned(heartbeatTail.body, 'FINAL_MARKER'),
    'developer tail: the shared history final answer must keep a breakpoint (lastDurable) so the wake run reads it warm');

  // BAD (the F1 bug this guards) — a DURABLE role:'user' self-continuation tail becomes `lastDurable`
  // and drags it off the final answer, so a heartbeat ending this way warms [..self-cont] but NOT
  // [..final]: the queue-backed wake run (which appends NO self-continuation) can no longer hit the
  // final → cold-read of the final answer.
  const selfContTail = translateCanonicalToMessages(mkRequest({
    type: 'message', role: 'user',
    content: [{ type: 'input_text', text: '[继续] 接着做 <<SELFCONT_MARKER>>' }]
  }) as any);
  assert.ok(pinned(selfContTail.body, 'SELFCONT_MARKER'),
    'durable user tail becomes lastDurable and gets its own breakpoint — the over-extension shape');
  assert.ok(!pinned(selfContTail.body, 'FINAL_MARKER'),
    'durable user tail: the shared history final answer no longer has a breakpoint (lost warmth)');
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

  // Both tails are non-durable, so `lastDurable` lands on the identical history block (the assistant
  // final answer) in BOTH — the heartbeat warms the exact FINAL entry the wake run reads. Their
  // true-end tails differ (placeholder vs trigger) and each gets its own harmless breakpoint.
  assert.ok(pinned(heartbeat.body, 'FINAL_MARKER') && pinned(wake.body, 'FINAL_MARKER'),
    'heartbeat and wake run must BOTH keep a breakpoint on the shared history final answer (cache continuity)');
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
  // The durable image tool_result becomes `lastDurable`, and the durable sentinel merges the shared
  // history final (H_TAIL) into a non-breakpoint assistant message — so H_TAIL loses its breakpoint.
  // (The sliding-window prevBoundary still keeps the block before it warm, but the fork would
  // cold-read the shared history's final block — why the production fix appends an ALL-volatile tail,
  // see the next test.)
  assert.ok(!pinned(buggy.body, 'H_TAIL'),
    'durable image tail: the shared history final block loses its breakpoint (the cold-read bug)');
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
  // Every appended item is non-durable → `lastDurable` stays on the shared history final (H_TAIL),
  // so the fork keeps a breakpoint there and rides the main loop's warm prefix. The true-end tail
  // (the reminder) additionally gets its own breakpoint (harmless; caches the fork's own steering).
  assert.ok(pinned(fixed.body, 'H_TAIL'),
    'all-non-durable tail: the shared warm history final must keep a breakpoint (lastDurable) — the fork rides the main cache');
});

// ============================================================================================
// Sliding-window staircase (provider-side, wire-only). Each request pins a message-tier tail SET —
// the live tail (TRUE last block), the previous turn boundary (the block before the last assistant
// message = the previous request's true tail), and the last durable block. Consecutive requests
// share exactly one breakpoint: prevBoundary(N+1) == tail(N), so the NEXT-HOP request always carries
// a cache_control the previous one wrote at, and the older breakpoint drops off. Because the tail is
// the true last block, a trailing frozen cache_volatile nudge is cached in-turn and read warm next
// turn (no double cold-read). Placed at wire-translate time only — never touches the canonical input
// — so it is byte-safe for the replay/retry consistency invariants.
//
// These lock the three transitions the requirement names: main→next-main, fork-internal→next-fork-
// internal, and main→derived-fork.
// ============================================================================================
function pinned(body: any, marker: string): boolean {
  for (const msg of body.messages || []) {
    for (const block of (Array.isArray(msg.content) ? msg.content : [])) {
      if (block && block.cache_control && JSON.stringify(block).includes(marker)) {
        return true;
      }
    }
  }
  return false;
}
const mkSlideReq = (input: any[]) => ({
  model: 'claude-opus-4-6', instructions: 'You are 小腻.', max_output_tokens: 1, tool_choice: 'auto', input
});
const SLIDE_HEAD = [
  { type: 'message', role: 'developer', content: [{ type: 'input_text', text: '<skills> head </skills>' }] },
  { type: 'message', role: 'user', content: [{ type: 'input_text', text: '历史 <<H>>' }] }
];
const turnA = [
  { type: 'function_call', call_id: 'a', name: 'exec_command', arguments: '{}' },
  { type: 'function_call_output', call_id: 'a', output: 'RESULT_A <<TR_A>>' }
];
const turnB = [
  { type: 'function_call', call_id: 'b', name: 'exec_command', arguments: '{}' },
  { type: 'function_call_output', call_id: 'b', output: 'RESULT_B <<TR_B>>' }
];

test('sliding window (main -> next-main): consecutive main turns SHARE the boundary breakpoint', () => {
  const reqN = translateCanonicalToMessages(mkSlideReq([...SLIDE_HEAD, ...turnA]) as any).body;
  const reqN1 = translateCanonicalToMessages(mkSlideReq([...SLIDE_HEAD, ...turnA, ...turnB]) as any).body;
  assert.ok(pinned(reqN, 'TR_A'), 'req N pins its live tail (tool_result A)');
  assert.ok(pinned(reqN1, 'TR_B'), 'req N+1 pins its own live tail (tool_result B)');
  // The shared breakpoint: req N's tail (TR_A) is req N+1's previous boundary → BOTH pin it.
  assert.ok(pinned(reqN1, 'TR_A'),
    'req N+1 must ALSO carry req N tail (TR_A) — the next-hop carries the previous breakpoint');
});

// The image-vision fork base: a shared history ending in an assistant final answer (小腻 idle),
// then a cache_volatile inspect/image/reminder tail. Fork-internal turns append durable exec results.
const FORK_HIST = [
  { type: 'message', role: 'user', content: [{ type: 'input_text', text: '群里发了张图 <<FH1>>' }] },
  { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '看看再说 <<FHTAIL>>' }] }
];
const forkVolatileTail = [
  { type: 'function_call', call_id: 'img', name: 'inspect_image_placeholder', arguments: '{"image_id":"i"}', cache_volatile: true },
  { type: 'function_call_output', call_id: 'img', cache_volatile: true,
    output: [{ type: 'input_image', image_url: 'data:image/png;base64,iVBORw0KGgo=', detail: 'original' }] },
  { type: 'message', role: 'developer', content: [{ type: 'input_text', text: '<system_reminder> write it </system_reminder>' }] }
];
const forkExec = [
  { type: 'function_call', call_id: 'e', name: 'exec_command', arguments: '{}' },
  { type: 'function_call_output', call_id: 'e', output: 'EXEC_OUT <<FEXEC>>' }
];

test('sliding window (main -> derived fork): the fork carries the main agent tail at fork time', () => {
  const mainReq = translateCanonicalToMessages(mkSlideReq([...FORK_HIST]) as any).body;
  const forkT1 = translateCanonicalToMessages(mkSlideReq([...FORK_HIST, ...forkVolatileTail]) as any).body;
  // Main's tail is the shared history's assistant final answer (FHTAIL). The fork's cache_volatile
  // tail is non-durable, so the fork's tail is ALSO FHTAIL → the fork carries the main's breakpoint.
  assert.ok(pinned(mainReq, 'FHTAIL'), 'main request pins the shared history tail (assistant final)');
  assert.ok(pinned(forkT1, 'FHTAIL'),
    'derived fork must carry the main tail (FHTAIL) — the volatile image/reminder tail is NOT the tail');
});

test('sliding window (fork-internal -> next fork-internal): consecutive fork turns SHARE fork T1 true tail (the reminder), never the image', () => {
  const forkT1 = translateCanonicalToMessages(mkSlideReq([...FORK_HIST, ...forkVolatileTail]) as any).body;
  const forkT2 = translateCanonicalToMessages(mkSlideReq([...FORK_HIST, ...forkVolatileTail, ...forkExec]) as any).body;
  // Fork turn 1's TRUE tail is the trailing reminder ("write it"); it also keeps FHTAIL warm via
  // lastDurable. Fork turn 2 appends a durable exec turn, so its live tail = FEXEC and its previous
  // boundary = fork T1's true tail (the reminder, the block before turn 2's exec assistant). So both
  // pin the reminder — the next fork request carries the previous fork request's true tail.
  assert.ok(pinned(forkT1, 'write it'), 'fork turn 1 pins its own true tail (the reminder)');
  assert.ok(pinned(forkT1, 'FHTAIL'), 'fork turn 1 keeps the shared history final (FHTAIL) warm via lastDurable');
  assert.ok(pinned(forkT2, 'FEXEC'), 'fork turn 2 pins its own live tail FEXEC');
  assert.ok(pinned(forkT2, 'write it'),
    'fork turn 2 must carry fork turn 1 true tail (the reminder) — the sliding-window shared boundary');
  // The volatile image block must NEVER be a breakpoint.
  assert.ok(!pinned(forkT2, '"type":"image"') && !pinned(forkT2, '"type": "image"'),
    'the cache_volatile image block must never anchor a cache breakpoint');
});

// The core regression this whole change fixes: a live tail of [tool_result, <system_reminder nudge>]
// must pin the TRUE last block (the nudge), so the nudge is cached in-turn and the NEXT turn — whose
// previous boundary lands exactly on that nudge — reads it warm. The old "last durable block" tail
// left the nudge PAST the breakpoint → uncached in turn N, re-created at full price in turn N+1.
test('sliding window: a trailing cache_volatile nudge is pinned in-turn and carried by the next turn (no double cold-read)', () => {
  const nudge = { type: 'message', role: 'developer', cache_volatile: true,
    content: [{ type: 'input_text', text: '<system_reminder> QQ 堆积了 1 条 <<NUDGE>> </system_reminder>' }] };
  const turnN = translateCanonicalToMessages(mkSlideReq([...SLIDE_HEAD, ...turnA, nudge]) as any).body;
  const turnN1 = translateCanonicalToMessages(mkSlideReq([...SLIDE_HEAD, ...turnA, nudge, ...turnB]) as any).body;
  // turn N: the nudge is the true tail → it MUST get a breakpoint (old design left it uncached).
  assert.ok(pinned(turnN, 'NUDGE'),
    'turn N must pin the trailing nudge (true tail) so it is cached in-turn, not left past the breakpoint');
  assert.ok(pinned(turnN, 'TR_A'), 'turn N still pins the durable tool_result (lastDurable)');
  // turn N+1: its previous boundary is the nudge (block before turn N+1s exec assistant) → carried.
  assert.ok(pinned(turnN1, 'NUDGE'),
    'turn N+1 must carry turn N tail (the nudge) as its previous boundary → reads the nudge warm');
  assert.ok(pinned(turnN1, 'TR_B'), 'turn N+1 pins its own live tail TR_B');
});
