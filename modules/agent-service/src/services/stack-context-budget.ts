// Stack-native context retention.
//
// Replaces the legacy conversation-turn counting (HISTORY_COMPACT_KEEP=30 *conversations*) with a
// BLOCK budget over the flat agent stack. No conversation/turn concept — the only unit is the BLOCK
// (one agent_stack_item).
//
// Two hard requirements shape the cut:
//   1. PAIRING (Claude): tool_use / tool_result must be paired in-context. Cutting mid-pair would
//      drop a tool result (orphan) or fabricate a `[no result recorded]` placeholder at wire time —
//      both falsify the wire view. So the cutoff must land on a "clean" boundary: a stack_index
//      where every function_call before it already has its function_call_output before it.
//   2. VERBATIM SUFFIX (immutability / replay): the retained tail must be byte-identical to the same
//      tail before compression — compression only drops the head and prepends a capsule, it never
//      rewrites a kept block. This planner selects a SUFFIX by stack_index (the stack is append-only
//      immutable), so the kept blocks ARE the pre-compression tail verbatim. The assembly layer
//      (P1.1) verifies the assembled tail hash equals the pre-compression tail hash.
//
// Policy: `keepBlocks` is a FLOOR. Keep the most recent keepBlocks blocks, FLOATED UP to the nearest
// clean boundary (so a pair is never split). WHEN to compress is decided elsewhere by the token
// trigger (REQ1); this only decides WHERE to cut. The cutoff is a stack_index, never a conversation_id.

export interface StackBlockRef {
  /** dense ascending append index on the main stack (agent_stack_items.stack_index) */
  stackIndex: number;
  /** call_id this block OPENS (a function_call / tool_use); else null */
  opensCallId?: string | null;
  /** call_id this block CLOSES (a function_call_output / tool_result); else null */
  closesCallId?: string | null;
}

export interface StackCutoffPlan {
  /** evict every block with stack_index <= this; the cutoff always lands on a clean (paired) boundary */
  readCutoffAfterStackIndex: number;
  /** floats >= keepBlocks up to the minimal complete offset */
  retainedBlockCount: number;
  evictedBlockCount: number;
}

/**
 * Decide where to cut the stack so the retained tail is the most recent `keepBlocks` blocks, floated
 * UP to the nearest clean boundary (no open tool_use straddling the cut). Returns null when nothing
 * should be evicted (already at/under keepBlocks, or no clean boundary keeps >= keepBlocks — then keep
 * everything; the next final_answer creates a clean boundary).
 *
 * `blocks` MUST be in ascending stack order. The retained tail is exactly the suffix
 * `blocks[evictedBlockCount..]` — a verbatim suffix of the input, never reordered or altered.
 */
export function planStackReadCutoffByBlockBudget(
  blocks: StackBlockRef[],
  options: { keepBlocks: number }
): StackCutoffPlan | null {
  const total = blocks.length;
  if (total === 0 || total <= options.keepBlocks) {
    return null;
  }

  // cleanAfter[i] = cutting AFTER block i leaves no open tool_use (every function_call in [0..i] has
  // its function_call_output in [0..i]) → the kept tail [i+1..] has no orphaned tool_result.
  const open = new Set<string>();
  const cleanAfter: boolean[] = new Array(total).fill(false);
  for (let i = 0; i < total; i += 1) {
    const b = blocks[i]!;
    if (b.opensCallId) open.add(b.opensCallId);
    if (b.closesCallId) open.delete(b.closesCallId);
    cleanAfter[i] = open.size === 0;
  }

  // Largest clean boundary p whose kept count (total-1-p) >= keepBlocks → the minimal complete tail
  // that still covers the budget. Start at the exact-keepBlocks cut and float EARLIER while unclean.
  const exactCutIdx = total - options.keepBlocks - 1;
  for (let p = exactCutIdx; p >= 0; p -= 1) {
    if (cleanAfter[p]) {
      return {
        readCutoffAfterStackIndex: blocks[p]!.stackIndex,
        retainedBlockCount: total - (p + 1),
        evictedBlockCount: p + 1
      };
    }
  }
  // No clean boundary that keeps >= keepBlocks → cannot cut without splitting a pair. Keep all.
  return null;
}
