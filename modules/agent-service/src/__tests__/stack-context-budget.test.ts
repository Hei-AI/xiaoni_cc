import test from 'node:test';
import assert from 'node:assert/strict';
import { planStackReadCutoffByBlockBudget, type StackBlockRef } from '../services/stack-context-budget';

// CONTRACT: stack-native context retention. No conversation/turn concept — the only unit is the
// BLOCK (one agent_stack_item). Claude requires tool_use/tool_result to be PAIRED in-context, so the
// cutoff must not split a pair (cutting mid-pair would drop a tool result or fabricate a placeholder).
// Therefore `keepBlocks` is a FLOOR: keep the most recent keepBlocks blocks, FLOATED UP to the nearest
// "clean" boundary — a stack_index where every function_call before it has its function_call_output
// before it (no open tool_use). The cutoff is a stack_index, never a conversation_id.

type Spec = 'x' | { open: string } | { close: string };

// Build blocks from a spec; stack_index dense ascending from 1000.
function build(specs: Spec[]): StackBlockRef[] {
  return specs.map((s, i) => ({
    stackIndex: 1000 + i,
    opensCallId: typeof s === 'object' && 'open' in s ? s.open : null,
    closesCallId: typeof s === 'object' && 'close' in s ? s.close : null
  }));
}
const plain = (n: number): Spec[] => Array.from({ length: n }, () => 'x' as Spec);

test('stack already at/under keepBlocks: returns null (nothing to evict)', () => {
  assert.equal(planStackReadCutoffByBlockBudget(build(plain(20)), { keepBlocks: 30 }), null);
});

test('no tool pairs: keep EXACTLY keepBlocks (every boundary is clean)', () => {
  const stack = build(plain(40)); // 40 blocks
  const plan = planStackReadCutoffByBlockBudget(stack, { keepBlocks: 30 });
  assert.ok(plan);
  assert.equal(plan!.retainedBlockCount, 30, 'no pairs → exact 30, no float');
  assert.equal(plan!.evictedBlockCount, 10);
  assert.equal(plan!.readCutoffAfterStackIndex, stack[9]!.stackIndex, 'cut after block index 9');
});

test('a pair STRADDLING the exact-30 boundary floats the cut EARLIER to keep the whole pair', () => {
  // 40 blocks. exact-30 cut is after index 9. Put a tool_use at 9 and its result at 11 → the kept
  // tail would orphan the result → unclean. Must float earlier to index 8 (clean) → keep 31.
  const specs: Spec[] = plain(40);
  specs[9] = { open: 'a' };
  specs[11] = { close: 'a' };
  const stack = build(specs);
  const plan = planStackReadCutoffByBlockBudget(stack, { keepBlocks: 30 });
  assert.ok(plan);
  assert.equal(plan!.retainedBlockCount, 31, 'float +1 to keep the tool_use with its result (>= 30)');
  assert.equal(plan!.readCutoffAfterStackIndex, stack[8]!.stackIndex, 'cut after the clean boundary at index 8');
  // verify cleanliness: no result in the kept tail references a use in the evicted head
  const cutIdx = stack.findIndex((b) => b.stackIndex === plan!.readCutoffAfterStackIndex);
  const evictedOpens = new Set(stack.slice(0, cutIdx + 1).map((b) => b.opensCallId).filter(Boolean));
  const keptCloses = stack.slice(cutIdx + 1).map((b) => b.closesCallId).filter(Boolean);
  assert.ok(keptCloses.every((id) => !evictedOpens.has(id!)), 'no orphaned tool_result in the kept tail');
});

test('a pair wholly INSIDE the kept tail does not float (exact-30 boundary is already clean)', () => {
  const specs: Spec[] = plain(40);
  specs[15] = { open: 'a' };
  specs[17] = { close: 'a' }; // both > index 9 → wholly kept
  const plan = planStackReadCutoffByBlockBudget(build(specs), { keepBlocks: 30 });
  assert.equal(plan!.retainedBlockCount, 30, 'pair inside kept region → no float, keep exact 30');
});

test('a pair wholly INSIDE the evicted head does not float (boundary clean)', () => {
  const specs: Spec[] = plain(40);
  specs[3] = { open: 'a' };
  specs[5] = { close: 'a' }; // both <= index 9 → wholly evicted, closed before the cut
  const plan = planStackReadCutoffByBlockBudget(build(specs), { keepBlocks: 30 });
  assert.equal(plan!.retainedBlockCount, 30, 'pair closed before the cut → boundary clean, keep exact 30');
});

test('no clean boundary that keeps >= keepBlocks: returns null (keep everything this round)', () => {
  // one tool_use opened at index 0, closed only at the very end → open across the whole evictable
  // range → no clean boundary with kept >= 30 → cannot cut without splitting → null.
  const specs: Spec[] = plain(40);
  specs[0] = { open: 'a' };
  specs[39] = { close: 'a' };
  assert.equal(planStackReadCutoffByBlockBudget(build(specs), { keepBlocks: 30 }), null);
});

test('retained tail is a VERBATIM SUFFIX of the pre-compression stack (hash-identical)', () => {
  // Requirement: the kept blocks must be byte-identical to the same tail before compression — float
  // up is allowed, but no block is rewritten/reordered. We model each block content by stack_index
  // and "hash" the retained suffix; it must equal the corresponding tail of the original stack.
  const specs: Spec[] = plain(40);
  specs[9] = { open: 'a' };
  specs[11] = { close: 'a' }; // forces a float (retained 31)
  const stack = build(specs);
  const plan = planStackReadCutoffByBlockBudget(stack, { keepBlocks: 30 })!;
  const hash = (rows: StackBlockRef[]) => JSON.stringify(rows.map((b) => [b.stackIndex, b.opensCallId, b.closesCallId]));

  const retained = stack.filter((b) => b.stackIndex > plan.readCutoffAfterStackIndex);
  const preCompressionTail = stack.slice(stack.length - plan.retainedBlockCount); // same-size tail before compaction
  assert.equal(hash(retained), hash(preCompressionTail),
    'retained tail must hash-equal the pre-compression tail of the same length (verbatim suffix, no mutation)');
  // and it is exactly the suffix slice — never reordered
  assert.equal(hash(retained), hash(stack.slice(plan.evictedBlockCount)),
    'retained == blocks.slice(evictedBlockCount): a pure suffix selection');
});

test('nested/multiple open pairs: floats to where ALL are closed', () => {
  // exact-30 cut after index 9. Opens at 7 and 9, closes at 12 and 13 → both straddle. The nearest
  // clean boundary at/below 9 is index 6 (before any open) → keep 33.
  const specs: Spec[] = plain(40);
  specs[7] = { open: 'a' };
  specs[9] = { open: 'b' };
  specs[12] = { close: 'a' };
  specs[13] = { close: 'b' };
  const plan = planStackReadCutoffByBlockBudget(build(specs), { keepBlocks: 30 });
  assert.ok(plan);
  assert.equal(plan!.readCutoffAfterStackIndex, 1006, 'cut after index 6 — the last point before any open use');
  assert.equal(plan!.retainedBlockCount, 33);
});
