import test from 'node:test';
import assert from 'node:assert/strict';
import { agentConfig } from '../config';
import {
  buildCanonicalAgentTurnRequest,
  buildCoreMemoryCompressionForkRequest,
  buildCoreMemoryCompressionReminder,
  buildCoreMemoryCompressionForkRetryReminder,
  buildSubconsciousAgentForkRequest,
  buildCacheHeartbeatForkRequest,
  buildImageVisionForkRequest,
  buildPsychAssessmentForkRequest
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

// The real inspect_image_placeholder call the main agent emitted (call_id + arguments), threaded
// into the image-vision fork so it carries the genuine call rather than a fabricated one.
const IMAGE_VISION_SOURCE_CALL = {
  callId: 'call-inspect-image',
  arguments: JSON.stringify({ image_id: 'img-1', detail: 'original' })
};

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

test('subconscious fork: cloned prefix byte-identical + appends self-continuation reminder', () => {
  const base = buildBaseRequest();
  const recentNarration = [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '刚才我说要看看群里。' }] }] as any[];
  const fork: any = buildSubconsciousAgentForkRequest(base, 1, recentNarration);
  assertForkPrefixByteIdentical(fork, base, 'subconscious');
  assert.ok(fork.input.length > base.input.length, 'subconscious fork must append a steering tail');
  // The tail re-injects the recent narration (cold) + the self-continuation reminder.
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
    null,
    IMAGE_VISION_SOURCE_CALL
  );
  assertForkPrefixByteIdentical(fork, base, 'image-vision');
  assert.ok(fork.input.length > base.input.length, 'image-vision fork must append the inspect/observe tail');
  const tail = JSON.stringify(fork.input.slice(base.input.length));
  assert.ok(tail.includes('img-1'), 'image-vision fork tail must reference the image id');
  assert.equal(fork.metadata?.image_vision_fork, 'true');
});

test('psych-assessment fork: cloned prefix byte-identical + appends judged text (cache_volatile) + verdict reminder', () => {
  const base = buildBaseRequest();
  const baseSnapshot = JSON.stringify(base.input);
  const judgedText = [
    { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '做了半天了，今天就不想再动了。' }] }
  ] as any[];
  const fork: any = buildPsychAssessmentForkRequest(base, judgedText);
  assertForkPrefixByteIdentical(fork, base, 'psych-assessment');
  assert.ok(fork.input.length > base.input.length, 'psych fork must append the judged text + verdict reminder tail');
  const tailItems = fork.input.slice(base.input.length) as any[];
  const tail = JSON.stringify(tailItems);
  // the judged text is re-injected at the tail (it is THIS turn's output, not in the sent prefix)
  assert.ok(tail.includes('今天就不想再动了'), 'psych fork must re-inject the judged assistant text at the tail');
  // the judged text carries the binary verdict protocol tokens so the parser has a contract to read
  assert.ok(tail.includes('PSYCH_VERDICT'), 'psych fork tail must carry the verdict instruction');
  // EVERY appended tail item must be NON-durable, or the tail breakpoint drags off the warm prefix.
  tailItems.forEach((item, i) => {
    assert.equal(
      isDurableItem(item),
      false,
      `psych-assessment: appended tail item #${i} (type=${item?.type} role=${item?.role}) must be NON-durable`
    );
  });
  // the re-injected assistant text specifically must be cache_volatile (assistant messages are durable by role)
  const injected = tailItems.find((item) => item?.role === 'assistant');
  assert.ok(injected, 'psych fork must re-inject an assistant-role text item');
  assert.equal(injected.cache_volatile, true, 're-injected judged text must be cache_volatile (else it becomes lastDurable)');
  // tail must stay under the 20-block lookback
  assert.ok(tailItems.length < 20, `psych fork tail must be < 20 blocks, got ${tailItems.length}`);
  assert.equal(fork.metadata?.psych_assessment_fork, 'true');
  // building the fork must not mutate the base request the main turn reuses
  assert.equal(JSON.stringify(base.input), baseSnapshot, 'psych fork must not mutate the base');
});

test('all forks share the SAME cloned prefix as each other (one warm cache entry)', () => {
  const base = buildBaseRequest();
  const prefixLen = base.input.length;
  const forks = [
    buildCoreMemoryCompressionForkRequest(base, 1),
    buildSubconsciousAgentForkRequest(base, 1, []),
    buildCacheHeartbeatForkRequest(base),
    buildImageVisionForkRequest(base, 'data:image/png;base64,iVBORw0KGgo=', 'img-1', '/x/y.md', null, IMAGE_VISION_SOURCE_CALL)
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

// Replicated contract from provider-service anthropic-translate.ts:343 `isDurableItem`
// (agent-service can't cross-import provider-service: rootDir ./src, no dependency edge).
// Keep BYTE-IDENTICAL to that function — it is the sole determinant of WHERE the tail
// cache_control breakpoint lands:
//   - a cache_volatile item is NON-durable (returns false)
//   - a 'message' is durable UNLESS role is 'developer' or 'system'
//   - every other item kind (function_call, function_call_output, ...) is durable.
// The tail breakpoint anchors on the LAST DURABLE block, so if ANY appended tail item is
// durable it becomes `lastDurable` and drags the breakpoint OFF the shared warm history →
// the fork can no longer read the main loop's warm prefix (the image-vision cold-read bug).
function isDurableItem(item: any): boolean {
  if (item && item.cache_volatile === true) {
    return false;
  }
  if (item && item.type === 'message') {
    return item.role !== 'developer' && item.role !== 'system';
  }
  return true;
}

// The cache-KEY guard input byte-identity CANNOT catch: every item a fork APPENDS past the
// cloned prefix must be NON-durable, so the tail cache_control breakpoint stays anchored on
// the last DURABLE block of the SHARED history (which the main loop keeps warm). A single
// durable appended item (an assistant/user message, a function_call, or a function_call_output
// without cache_volatile) becomes `lastDurable` and moves the breakpoint onto NEW content —
// the fork then cold-reads the whole history every turn (the image-vision fork bug: it
// appended a durable assistant sentinel + function_call + a function_call_output holding the
// base64 image, so its breakpoint sat on the image, past the shared prefix).
test('every fork appends ONLY non-durable tail items (breakpoint stays on shared warm history)', () => {
  const base = buildBaseRequest();
  const recentNarration = [
    { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '刚才我说要看看群里。' }] }
  ] as any[];
  const forks: Array<[string, any]> = [
    // compression builder is a pure clone (tail 0); reminder appended at dispatch.
    ['compression', buildCoreMemoryCompressionForkRequest(base, 1)],
    ['subconscious', buildSubconsciousAgentForkRequest(base, 1, recentNarration)],
    ['heartbeat', buildCacheHeartbeatForkRequest(base)],
    ['image-vision', buildImageVisionForkRequest(
      base,
      'data:image/png;base64,iVBORw0KGgo=',
      'img-1',
      '/xiaoni-runtime/image-vision/observations/img-1.md',
      '旧观察',
      IMAGE_VISION_SOURCE_CALL
    )]
  ];
  for (const [label, fork] of forks) {
    const tail = fork.input.slice(base.input.length) as any[];
    tail.forEach((item, i) => {
      assert.equal(
        isDurableItem(item),
        false,
        `${label}: appended tail item #${i} (type=${item?.type} role=${item?.role}) must be NON-durable ` +
        `(cache_volatile OR developer/system message). A durable tail item moves the cache breakpoint ` +
        `off the shared warm history and forces a cold-read every turn.`
      );
    });
  }
});

// GAP the builder-based check above CANNOT see: the compression fork builder is a PURE
// clone (tail 0) — its steering tail (the pressure reminder, and retry reminders on later
// turns) is appended DOWNSTREAM at dispatch (runCoreMemoryCompressionFork:
// forkInput = [...base.input, ...compressionReminderItems]). So the non-durability of THAT
// tail is not exercised by "every fork appends ONLY non-durable tail items". Assert the
// dispatch-appended items directly: if either reminder were built as a durable role
// (user/assistant) instead of developer, it would become `lastDurable` and drag the
// compression fork's breakpoint off the shared warm history — the same cold-read bug,
// invisible to the builder check because the builder never appends it.
test('compression fork DISPATCH tail (pressure + retry reminders) is NON-durable', () => {
  const pressure = buildCoreMemoryCompressionReminder({
    contextSessionKey: 'xiaoni:global',
    readCutoffAfterStackIndex: 12345,
    pressureSummary: '上下文接近预算上限'
  });
  assert.equal(
    isDurableItem(pressure),
    false,
    'compression pressure reminder must be NON-durable (developer role): it is appended at ' +
    'dispatch as the fork tail; a durable one would move the breakpoint off the shared history'
  );
  const retry = buildCoreMemoryCompressionForkRetryReminder({
    forkTurn: 2,
    reason: 'no_tool_call',
    retryCount: 1,
    maxRetries: 3,
    outputPath: '/xiaoni-runtime/compress/xiaoni_global.md'
  });
  assert.equal(
    isDurableItem(retry),
    false,
    'compression fork retry reminder must be NON-durable (developer role): it too is appended ' +
    'as a dispatch-time tail on retry turns'
  );
});

// CONTRACT (docs/CACHE_CONTRACT.md §3.1): each fork appends fewer than 20 content
// blocks past the cloned prefix, so the provider's 20-block lookback always finds the
// main's P_n entry (the fork's tail breakpoint reads it). A fork whose cold tail
// exceeds 20 blocks would stop hitting the shared prefix → full cold prefill.
test('every fork appends < 20 content blocks past the cloned prefix (20-block lookback guard)', () => {
  const base = buildBaseRequest();
  const subc: any = buildSubconsciousAgentForkRequest(base, 1, [
    { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '刚才的叙述' }] }
  ] as any[]);
  const heartbeat: any = buildCacheHeartbeatForkRequest(base);
  const imageVision: any = buildImageVisionForkRequest(base, 'data:image/png;base64,iVBORw0KGgo=', 'img-1', '/x/y.md', '旧观察', IMAGE_VISION_SOURCE_CALL);
  for (const [label, fork] of [['subconscious', subc], ['heartbeat', heartbeat], ['image-vision', imageVision]] as const) {
    const tail = fork.input.length - base.input.length;
    assert.ok(tail > 0 && tail < 20, `${label} fork tail must be in (0,20) blocks, got ${tail}`);
  }
  // The compression fork builder is a pure clone (tail 0); its 1-item compression
  // reminder is appended at dispatch (runCoreMemoryCompressionFork), well under 20.
  const compression: any = buildCoreMemoryCompressionForkRequest(base, 1);
  assert.equal(compression.input.length, base.input.length, 'compression fork builder must be a pure clone (tail added at dispatch)');
});

// CONTRACT (docs/CACHE_CONTRACT.md §2 + §4): a fork is a FROZEN clone of the main
// lineage at its own fork point. Once built, the main advancing or doing an STW switch
// must NOT mutate the fork's already-cloned prefix — each holds an independent deep
// copy, so its P_n stays byte-identical and keeps hitting its own cache entry.
test('forks at different points are frozen: the main advancing / switching does not mutate them', () => {
  const base = buildBaseRequest();
  // Fork A frozen at this point.
  const forkA: any = buildSubconsciousAgentForkRequest(base, 1, []);
  const forkASnapshot = JSON.stringify(forkA.input);
  // Fork B frozen at a LATER point (the main has advanced two more blocks by now).
  const advanced = buildCanonicalAgentTurnRequest(agentConfig.modelName, [
    ...buildProductionMainLoopInput(),
    { type: 'function_call', call_id: 'c2', name: EXEC_COMMAND_TOOL, arguments: '{"cmd":"ls"}' },
    { type: 'function_call_output', call_id: 'c2', output: 'more' }
  ] as any[], 'group');
  const forkB: any = buildCoreMemoryCompressionForkRequest(advanced, 1);
  const forkBSnapshot = JSON.stringify(forkB.input);

  // Now the main advances further / does an STW switch — mutate BOTH base requests.
  (base.input as any[]).push({ type: 'function_call', call_id: 'c-new', name: EXEC_COMMAND_TOOL, arguments: '{"cmd":"switch"}' });
  (advanced.input as any[]).length = 0; // simulate an aggressive STW rebuild of the main
  (base as any).instructions = 'MUTATED';

  // Both forks are unaffected — frozen independent copies at their own P_n.
  assert.equal(JSON.stringify(forkA.input), forkASnapshot, 'fork A prefix must be frozen against later main mutation');
  assert.equal(JSON.stringify(forkB.input), forkBSnapshot, 'fork B prefix must be frozen against an STW rebuild of the main');
});
