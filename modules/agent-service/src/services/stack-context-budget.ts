// Stack-native context retention.
//
// This replaces the legacy conversation-turn counting (HISTORY_COMPACT_KEEP=30 *conversations*,
// `planReadCutoffForForcedCompression`) with a BLOCK budget over the flat agent stack. There is no
// conversation/turn concept here — the only units are:
//   - BLOCK: one agent_stack_item, the thing the request actually pays for / caches;
//   - FRAME: a completed request cycle ending in an assistant `final_answer`. A frame is the only
//     SAFE cut boundary — cutting anywhere else could split a function_call from its
//     function_call_output and break replay. Frames are derived purely from stack structure
//     (`isFrameEnd`), never from conversation_id.
//
// Policy: keep the most recent `keepBlocks` blocks (the original HISTORY_COMPACT_KEEP=30 INTENT —
// "keep the last 30", which the legacy code mis-applied to conversations, so it kept ~30 cycles
// ≈ 360 blocks instead). WHEN to compress is decided elsewhere by the token trigger (REQ1); this
// function only decides WHERE to cut. The cutoff it returns is a `stack_index`, not a conversation_id.

export interface StackBlockRef {
  /** dense ascending append index on the main stack (agent_stack_items.stack_index) */
  stackIndex: number;
  /** true when this block closes a request cycle (assistant final_answer) — a safe cut boundary */
  isFrameEnd: boolean;
}

export interface StackCutoffPlan {
  /** evict every block with stack_index <= this; the cutoff always lands on a frame-end block */
  readCutoffAfterStackIndex: number;
  retainedBlockCount: number;
  evictedBlockCount: number;
}

/**
 * Decide where to cut the stack so the retained tail is the most recent `keepBlocks` blocks, snapped
 * UP to a whole frame (so a request cycle is never split). Returns null when nothing should be
 * evicted: the stack is already at/under `keepBlocks`, or there is no earlier safe frame boundary to
 * cut at (the budget-meeting tail is one open cycle — keep it whole, the next final_answer makes a
 * boundary). Hysteresis is implicit: a small `keepBlocks` leaves the post-cut stack far below the
 * token trigger, so it takes many turns to climb back — no vacuum-edge thrash.
 *
 * `blocks` MUST be in ascending stack order.
 */
export function planStackReadCutoffByBlockBudget(
  blocks: StackBlockRef[],
  options: { keepBlocks: number }
): StackCutoffPlan | null {
  const total = blocks.length;
  if (total === 0 || total <= options.keepBlocks) {
    return null;
  }
  // Walk from the tail accumulating kept blocks. Once we've met the keep budget, cut at the first
  // frame boundary at or before that point — keep at least `keepBlocks`, snapped up to a whole frame.
  let kept = 0;
  for (let i = total - 1; i >= 0; i -= 1) {
    kept += 1;
    if (kept >= options.keepBlocks && i - 1 >= 0 && blocks[i - 1]!.isFrameEnd) {
      const cutIdx = i - 1; // last evicted block (a frame-end / safe boundary)
      return {
        readCutoffAfterStackIndex: blocks[cutIdx]!.stackIndex,
        retainedBlockCount: total - (cutIdx + 1),
        evictedBlockCount: cutIdx + 1
      };
    }
  }
  // No safe boundary below the kept region → cannot cut without splitting a cycle. Keep everything.
  return null;
}
