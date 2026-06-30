import test from 'node:test';
import assert from 'node:assert/strict';
import { planStackReadCutoffByBlockBudget, type StackBlockRef } from '../services/stack-context-budget';

// CONTRACT: stack-native context retention. There is NO conversation/turn concept — the units are
// the BLOCK (one agent_stack_item) and the FRAME (a completed request cycle ending in an assistant
// final_answer = the only safe cut boundary; cutting elsewhere would split a function_call from its
// function_call_output). Retention is a BLOCK BUDGET with HYSTERESIS:
//   - triggerBlocks: only compress once the stack exceeds this (don't nibble at the vacuum edge);
//   - targetBlocks: cut back to ~this many recent blocks, snapped to a frame boundary.
// The cutoff is a stack_index, never a conversation_id.

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

test('under the hysteresis trigger: returns null (no compression — avoids vacuum-edge thrash)', () => {
  const stack = buildStack([5, 5, 5]); // 15 blocks
  assert.equal(planStackReadCutoffByBlockBudget(stack, { targetBlocks: 10, triggerBlocks: 20 }), null,
    '15 blocks < triggerBlocks 20 → must not compress');
});

test('over trigger: cuts at a FRAME boundary and retains AT LEAST the target block budget', () => {
  const stack = buildStack([4, 4, 4, 4, 4, 4]); // 24 blocks, 6 frames of 4
  const plan = planStackReadCutoffByBlockBudget(stack, { targetBlocks: 10, triggerBlocks: 20 });
  assert.ok(plan, '24 blocks > trigger 20 → must compress');
  assert.ok(plan!.retainedBlockCount >= 10, `must retain >= targetBlocks: got ${plan!.retainedBlockCount}`);
  // the cutoff must land on a frame-end block (safe boundary), never mid-frame
  const cutBlock = stack.find((b) => b.stackIndex === plan!.readCutoffAfterStackIndex);
  assert.ok(cutBlock && cutBlock.isFrameEnd,
    'cutoff stack_index must be a frame-end (final_answer) block — never split a request cycle');
  assert.equal(plan!.retainedBlockCount + plan!.evictedBlockCount, 24, 'retained + evicted == total');
});

test('retention is MINIMAL above the budget (does not keep far more than needed)', () => {
  const stack = buildStack([4, 4, 4, 4, 4, 4]); // 24 blocks
  const plan = planStackReadCutoffByBlockBudget(stack, { targetBlocks: 10, triggerBlocks: 20 });
  // target 10, frames of 4 → smallest whole-frame retention >= 10 is 3 frames = 12 blocks
  assert.equal(plan!.retainedBlockCount, 12, 'keep exactly the fewest whole frames that meet the budget');
});

test('a single heavy trailing frame is kept WHOLE even when it exceeds the target (atomicity wins)', () => {
  const stack = buildStack([3, 3, 50]); // last frame alone is 50 blocks
  const plan = planStackReadCutoffByBlockBudget(stack, { targetBlocks: 10, triggerBlocks: 20 });
  assert.ok(plan, 'total 56 > trigger 20 → compress');
  assert.equal(plan!.retainedBlockCount, 50, 'the live 50-block frame cannot be split → keep it whole');
  const cutBlock = stack.find((b) => b.stackIndex === plan!.readCutoffAfterStackIndex);
  assert.ok(cutBlock && cutBlock.isFrameEnd, 'cut on the frame boundary before the heavy frame');
});

test('no safe boundary in the evictable region: returns null (cannot split an open cycle)', () => {
  // one giant unclosed frame (no final_answer until the very end) bigger than trigger
  const stack: StackBlockRef[] = [];
  for (let i = 0; i < 30; i += 1) stack.push({ stackIndex: 2000 + i, isFrameEnd: i === 29 });
  const plan = planStackReadCutoffByBlockBudget(stack, { targetBlocks: 10, triggerBlocks: 20 });
  assert.equal(plan, null, 'only one frame → no earlier boundary to cut at → null (keep it whole)');
});

test('hysteresis gap: total between target and trigger does NOT compress', () => {
  const stack = buildStack([3, 3, 3, 3, 3]); // 15 blocks
  // target 8, trigger 18 → 15 is above target but below trigger → no compression (headroom)
  assert.equal(planStackReadCutoffByBlockBudget(stack, { targetBlocks: 8, triggerBlocks: 18 }), null,
    'between target and trigger → stay put; only compress once over trigger, then cut to ~target');
});

test('cutoff is a stack_index, and evicted blocks are exactly those at/below it', () => {
  const stack = buildStack([2, 2, 2, 2, 2, 2, 2, 2]); // 16 blocks, frames of 2
  const plan = planStackReadCutoffByBlockBudget(stack, { targetBlocks: 5, triggerBlocks: 10 });
  assert.ok(plan);
  const evicted = stack.filter((b) => b.stackIndex <= plan!.readCutoffAfterStackIndex).length;
  assert.equal(evicted, plan!.evictedBlockCount, 'evictedBlockCount == blocks with stack_index <= cutoff');
  assert.ok(stack.every((b) => b.stackIndex > plan!.readCutoffAfterStackIndex
    ? true
    : b.stackIndex <= plan!.readCutoffAfterStackIndex), 'partition is clean by stack_index');
});
