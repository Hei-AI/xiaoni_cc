import test from 'node:test';
import assert from 'node:assert/strict';
import { agentConfig } from '../config';
import {
  buildCanonicalAgentTurnRequest,
  buildCoreMemoryCompressionForkRequest,
  buildSubconsciousAgentForkRequest,
  buildCacheHeartbeatForkRequest,
  buildImageVisionForkRequest
} from '../services/agent-loop-service';

// Fork cache-alignment: 0-tolerance prompt-cache 穿透 guard.
//
// Every fork (subconscious / core-memory compression / image-vision / cache
// heartbeat) is a CLONE of the main agent's canonical request plus a small TAIL.
// To ride the main loop's warm in-context cache, the fork's shared prefix —
// instructions (system), tools, and the cloned input items — must be BYTE-IDENTICAL
// to the main request it clones. The only allowed difference is items APPENDED at
// the tail (the fork's own system_reminder steering). Any prefix divergence (a
// head-only rebuild, a stripped/reordered block, a re-rendered timestamp, a
// changed tool_choice) breaks the cache for the fork AND for the next main turn.
//
// These assert byte-identity directly on the real production builders, with a
// base request shaped like production: it carries a user message, an assistant
// type:text output, a tool_call + tool_result pair, and a <system_reminder>. No
// LLM, no store.

const EXEC_COMMAND_TOOL = 'exec_command';

// A production-shaped main-loop input: every item kind the real loop sends.
function buildProductionMainLoopInput() {
  return [
    { type: 'message', role: 'user', content: [{ type: 'input_text', text: '群里有人问你今天玩什么' }] },
    // main agent returned a type:text assistant output (narration) — a real scenario.
    { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '我想想，先看看他们在聊啥。' }] },
    { type: 'function_call', call_id: 'call-1', name: EXEC_COMMAND_TOOL, arguments: JSON.stringify({ cmd: 'cat /tmp/notes.md' }) },
    { type: 'function_call_output', call_id: 'call-1', output: '昨天聊到桌游' },
    // a folded runtime reminder that is now frozen history in the prefix.
    { type: 'message', role: 'developer', content: [{ type: 'input_text', text: '<system_reminder>\n【视线边缘】又堆积了 1 条新动静\n</system_reminder>' }] },
    // the current-turn trigger (cache_volatile in production, still part of the cloned body).
    { type: 'message', role: 'developer', content: [{ type: 'input_text', text: '[当前回合] 接着做。' }], cache_volatile: true }
  ] as any[];
}

function buildBaseRequest() {
  return buildCanonicalAgentTurnRequest(agentConfig.modelName, buildProductionMainLoopInput(), 'group');
}

// The core invariant shared by all forks.
function assertForkPrefixByteIdentical(forkRequest: any, baseRequest: any, label: string) {
  // 1. system prompt prefix unchanged
  assert.deepEqual(forkRequest.instructions, baseRequest.instructions, `${label}: instructions (system) must be byte-identical`);
  // 2. tools tier unchanged
  assert.deepEqual(forkRequest.tools, baseRequest.tools, `${label}: tools must be byte-identical`);
  // 3. tool_choice unchanged (FORK 铁律 — same auto tool_choice as the main loop)
  assert.deepEqual(forkRequest.tool_choice, baseRequest.tool_choice, `${label}: tool_choice must match the main loop`);
  // 4. the fork only APPENDS — the cloned prefix is byte-identical to the base input
  assert.ok(forkRequest.input.length >= baseRequest.input.length, `${label}: fork must not drop prefix items`);
  const clonedPrefix = forkRequest.input.slice(0, baseRequest.input.length);
  assert.equal(
    JSON.stringify(clonedPrefix),
    JSON.stringify(baseRequest.input),
    `${label}: cloned prefix must be byte-identical to the main request (no head-only rebuild / strip / reorder / re-stamp)`
  );
  // 5. the clone is a deep copy, not a shared reference (mutating the fork must not
  //    corrupt the base — production reuses the base for the main turn).
  assert.notEqual(forkRequest.input, baseRequest.input, `${label}: fork input must be a distinct array`);
}

test('compression fork: cloned prefix byte-identical to the main request (NOT head-only)', () => {
  const base = buildBaseRequest();
  const baseSnapshot = JSON.stringify(base.input);
  const fork: any = buildCoreMemoryCompressionForkRequest(base, 1);
  assertForkPrefixByteIdentical(fork, base, 'compression');
  // The compression fork is a PURE clone — its compression-reminder tail is appended
  // downstream at dispatch (runCoreMemoryCompressionFork), per the FORK 铁律. So the
  // builder output's input must equal the base input exactly (no head-only rebuild).
  assert.equal(JSON.stringify(fork.input), baseSnapshot, 'compression fork must be a full clone, not a head-only rebuild');
  // The historical bug was a head-only summarySourceInput rebuild. Guard it: the
  // prefix carries the FULL main history (the tool pair + reminder), not a head slice.
  const forkText = JSON.stringify(fork.input);
  assert.ok(forkText.includes('昨天聊到桌游'), 'compression fork must clone the full tool-result history');
  assert.ok(forkText.includes('视线边缘'), 'compression fork must clone the folded reminder');
  assert.equal(fork.metadata?.core_memory_compression_fork, 'true');
  // Building the fork must not mutate the base request the main turn reuses.
  assert.equal(JSON.stringify(base.input), baseSnapshot, 'compression fork must not mutate the base');
});

test('subconscious fork: cloned prefix byte-identical + appends self-continuation & restriction reminders', () => {
  const base = buildBaseRequest();
  const recentNarration = [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '刚才我说要看看群里。' }] }] as any[];
  const fork: any = buildSubconsciousAgentForkRequest(base, 1, recentNarration);
  assertForkPrefixByteIdentical(fork, base, 'subconscious');
  assert.ok(fork.input.length > base.input.length, 'subconscious fork must append a steering tail');
  // The tail re-injects the recent narration (cold) + two developer reminders.
  const tail = JSON.stringify(fork.input.slice(base.input.length));
  assert.ok(tail.includes('刚才我说要看看群里'), 'subconscious fork must re-inject recent narration at the tail');
  assert.equal(fork.metadata?.subconscious_agent_fork, 'true');
});

test('cache-heartbeat fork: cloned prefix byte-identical + appends the heartbeat developer item', () => {
  const base = buildBaseRequest();
  const fork: any = buildCacheHeartbeatForkRequest(base);
  assertForkPrefixByteIdentical(fork, base, 'heartbeat');
  assert.ok(fork.input.length > base.input.length, 'heartbeat fork must append the heartbeat developer item');
  // The heartbeat must refresh the SAME cache entry: tiny max_output_tokens, but
  // the prefix + tool_choice are the main loop's, untouched.
  assert.ok(fork.max_output_tokens <= 16, 'heartbeat must use a tiny output budget');
  assert.equal(fork.metadata?.cache_heartbeat, 'true');
});

test('image-vision fork: cloned prefix byte-identical + appends inspect/observe tail', () => {
  const base = buildBaseRequest();
  const fork: any = buildImageVisionForkRequest(
    base,
    'data:image/png;base64,iVBORw0KGgo=',
    'img-1',
    '/xiaoni-runtime/image-vision/observations/img-1.md',
    null
  );
  assertForkPrefixByteIdentical(fork, base, 'image-vision');
  assert.ok(fork.input.length > base.input.length, 'image-vision fork must append the inspect/observe tail');
  const tail = JSON.stringify(fork.input.slice(base.input.length));
  assert.ok(tail.includes('img-1'), 'image-vision fork tail must reference the image id');
  assert.equal(fork.metadata?.image_vision_fork, 'true');
});

test('all forks share the SAME cloned prefix as each other (one warm cache entry)', () => {
  const base = buildBaseRequest();
  const prefixLen = base.input.length;
  const forks = [
    buildCoreMemoryCompressionForkRequest(base, 1),
    buildSubconsciousAgentForkRequest(base, 1, []),
    buildCacheHeartbeatForkRequest(base),
    buildImageVisionForkRequest(base, 'data:image/png;base64,iVBORw0KGgo=', 'img-1', '/x/y.md', null)
  ];
  const basePrefix = JSON.stringify(base.input.slice(0, prefixLen));
  for (const fork of forks) {
    assert.equal(
      JSON.stringify(fork.input.slice(0, prefixLen)),
      basePrefix,
      'every fork must share the identical warm prefix the main loop keeps alive'
    );
    assert.deepEqual(fork.instructions, base.instructions);
    assert.deepEqual(fork.tools, base.tools);
    assert.deepEqual(fork.tool_choice, base.tool_choice);
  }
});
