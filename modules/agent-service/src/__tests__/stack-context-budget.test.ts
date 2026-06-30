import test from 'node:test';
import assert from 'node:assert/strict';
import { planStackReadCutoffByBlockBudget, type StackBlockRef } from '../services/stack-context-budget';

// CONTRACT: stack-native context retention. There is NO conversation/turn concept — the units are
// the BLOCK (one agent_stack_item) and the FRAME (a completed request cycle ending in an assistant
// final_answer = the only safe cut boundary; cutting elsewhere would split a function_call from its
// function_call_output). Policy: keep the most recent `keepBlocks` blocks, snapped UP to a whole
// frame. WHEN to compress is decided elsewhere by the token trigger (REQ1); this only decides WHERE
// to cut. The cutoff is a stack_index, never a conversation_id.

// Build a flat block stream from frame sizes. Frame i has sizes[i] blocks; the LAST block of each
// frame is a final_answer (isFrameEnd=true). stack_index is dense ascending from 1000.
function buildStack(frameSizes: number[]): StackBlockRef[] {
  const blocks: StackBlockRef[] = [];
  let si = 1000;
  for (const size of frameSizes) {
    for (let b = 0; b < size; b += 1) {
      blocks.push({ stackIndex: si, isFrameEnd: b === size - 1 });
      si += 1;
    }
  }
  return blocks;
}

test('stack already at/under keepBlocks: returns null (nothing to evict)', () => {
  const stack = buildStack([5, 5, 5]); // 15 blocks
  assert.equal(planStackReadCutoffByBlockBudget(stack, { keepBlocks: 30 }), null,
    '15 blocks <= keepBlocks 30 → nothing to cut');
});

test('keeps the most recent keepBlocks, cut on a FRAME boundary (never split a cycle)', () => {
  const stack = buildStack([4, 4, 4, 4, 4, 4, 4, 4, 4, 4]); // 40 blocks, 10 frames of 4
  const plan = planStackReadCutoffByBlockBudget(stack, { keepBlocks: 30 });
  assert.ok(plan, '40 > keep 30 → must cut');
  assert.ok(plan!.retainedBlockCount >= 30, `must retain >= keepBlocks: got ${plan!.retainedBlockCount}`);
  const cutBlock = stack.find((b) => b.stackIndex === plan!.readCutoffAfterStackIndex);
  assert.ok(cutBlock && cutBlock.isFrameEnd,
    'cutoff stack_index must be a frame-end (final_answer) block — never split a request cycle');
  assert.equal(plan!.retainedBlockCount + plan!.evictedBlockCount, 40, 'retained + evicted == total');
});

test('retention is MINIMAL above the budget (fewest whole frames that meet keepBlocks)', () => {
  const stack = buildStack([4, 4, 4, 4, 4, 4, 4, 4, 4, 4]); // 40 blocks, frames of 4
  const plan = planStackReadCutoffByBlockBudget(stack, { keepBlocks: 30 });
  // keep 30, frames of 4 → smallest whole-frame retention >= 30 is 8 frames = 32 blocks
  assert.equal(plan!.retainedBlockCount, 32, 'keep exactly the fewest whole frames that meet the budget');
});

test('a single heavy trailing frame is kept WHOLE even when it exceeds keepBlocks (atomicity wins)', () => {
  const stack = buildStack([3, 3, 50]); // last frame alone is 50 blocks
  const plan = planStackReadCutoffByBlockBudget(stack, { keepBlocks: 30 });
  assert.ok(plan, 'total 56 > keep 30 → cut');
  assert.equal(plan!.retainedBlockCount, 50, 'the live 50-block frame cannot be split → keep it whole');
  const cutBlock = stack.find((b) => b.stackIndex === plan!.readCutoffAfterStackIndex);
  assert.ok(cutBlock && cutBlock.isFrameEnd, 'cut on the frame boundary before the heavy frame');
});

test('no safe boundary in the evictable region: returns null (cannot split an open cycle)', () => {
  // one giant unclosed frame (no final_answer until the very end) bigger than keepBlocks
  const stack: StackBlockRef[] = [];
  for (let i = 0; i < 50; i += 1) stack.push({ stackIndex: 2000 + i, isFrameEnd: i === 49 });
  const plan = planStackReadCutoffByBlockBudget(stack, { keepBlocks: 30 });
  assert.equal(plan, null, 'only one frame → no earlier boundary to cut at → null (keep it whole)');
});

test('the REAL number 30: keep the last 30 blocks worth of whole frames, evict the rest', () => {
  // ~12 blocks/frame (production avg). 8 frames of 12 = 96 blocks → keep 30 ≈ 3 frames = 36.
  const stack = buildStack([12, 12, 12, 12, 12, 12, 12, 12]); // 96 blocks
  const plan = planStackReadCutoffByBlockBudget(stack, { keepBlocks: 30 });
  assert.ok(plan);
  assert.equal(plan!.retainedBlockCount, 36, 'keep the 3 most recent 12-block frames (>= 30)');
  assert.equal(plan!.evictedBlockCount, 60, 'evict the older 5 frames');
});

test('cutoff is a stack_index; evicted blocks are exactly those at/below it (clean partition)', () => {
  const stack = buildStack([2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2]); // 32 blocks, frames of 2
  const plan = planStackReadCutoffByBlockBudget(stack, { keepBlocks: 10 });
  assert.ok(plan);
  const evicted = stack.filter((b) => b.stackIndex <= plan!.readCutoffAfterStackIndex).length;
  assert.equal(evicted, plan!.evictedBlockCount, 'evictedBlockCount == blocks with stack_index <= cutoff');
});
