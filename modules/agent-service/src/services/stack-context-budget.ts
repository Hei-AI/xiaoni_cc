// Stack-native context retention.
//
// This replaces the legacy conversation-turn counting (HISTORY_COMPACT_KEEP=30 *conversations*,
// `planReadCutoffForForcedCompression`) with a BLOCK BUDGET over the flat agent stack. There is no
// conversation/turn concept here — the only units are:
//   - BLOCK: one agent_stack_item, the thing the request actually pays for / caches;
//   - FRAME: a completed request cycle ending in an assistant `final_answer`. A frame is the only
//     SAFE cut boundary — cutting anywhere else could split a function_call from its
//     function_call_output and break replay. Frames are derived purely from stack structure
//     (`isFrameEnd`), never from conversation_id.
//
// The cutoff this produces is a `stack_index`, not a conversation_id.

export interface StackBlockRef {
  /** dense ascending append index on the main stack (agent_stack_items.stack_index) */
  stackIndex: number;
  /** true when this block closes a request cycle (assistant final_answer) — a safe cut boundary */
  isFrameEnd: boolean;
}

export interface StackCutoffBudget {
  /** keep at least this many recent blocks (the steady warm-prefix size we agree to re-read each turn) */
  targetBlocks: number;
  /**
   * only compress once the stack exceeds this many blocks. HYSTERESIS: triggerBlocks MUST be
   * > targetBlocks so that after a cut (down to ~targetBlocks) it takes several new turns to climb
   * back over the trigger — instead of vacuum-edge nibbling one frame every turn.
   */
  triggerBlocks: number;
}

export interface StackCutoffPlan {
  /** evict every block with stack_index <= this; the cutoff always lands on a frame-end block */
  readCutoffAfterStackIndex: number;
  retainedBlockCount: number;
  evictedBlockCount: number;
}

/**
 * Decide where to cut the stack so the retained tail meets the block budget, snapped to a frame
 * boundary. Returns null when nothing should be evicted (under the hysteresis trigger, or there is
 * no earlier safe boundary to cut at — e.g. one giant open frame).
 *
 * `blocks` MUST be in ascending stack order.
 */
export function planStackReadCutoffByBlockBudget(
  blocks: StackBlockRef[],
  budget: StackCutoffBudget
): StackCutoffPlan | null {
  const total = blocks.length;
  // Hysteresis: do nothing until the stack is genuinely over the trigger watermark.
  if (total === 0 || total <= budget.triggerBlocks) {
    return null;
  }
  // Walk from the tail accumulating kept blocks. Once we've met the target budget, cut at the FIRST
  // frame boundary at or before that point — keep at least `targetBlocks`, snapped up to a whole
  // frame so a request cycle is never split.
  let kept = 0;
  for (let i = total - 1; i >= 0; i -= 1) {
    kept += 1;
    if (kept >= budget.targetBlocks && i - 1 >= 0 && blocks[i - 1]!.isFrameEnd) {
      const cutIdx = i - 1; // last evicted block (a frame-end / safe boundary)
      return {
        readCutoffAfterStackIndex: blocks[cutIdx]!.stackIndex,
        retainedBlockCount: total - (cutIdx + 1),
        evictedBlockCount: cutIdx + 1
      };
    }
  }
  // No safe boundary exists below the kept region (the whole budget-meeting tail is one open frame)
  // → cannot cut without splitting a cycle. Keep everything; next final_answer creates a boundary.
  return null;
}
