# Anthropic API Levers for Tool-Use Control Without Cache Breaking

**Research Date:** September 11, 2026  
**Target Model:** `claude-opus-4-6`  
**Use Case:** Stop a specific tool (recover_energy) from being called for a time window without modifying the cached `tools` array or system prompt (prefix cache constraint: ~430K cached tokens).

**CI Information:** Research cites official Anthropic platform documentation at https://platform.claude.com/docs/. For claims not documented there, status is marked `UNVERIFIED`.

---

## 1. `tool_choice` Parameter & Cache Implications

### Supported Values on Opus 4.6

**Official specification** ([platform.claude.com tool use docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools#controlling-claude-s-output)):

- **`{type: "auto"}`** — Default. Model decides whether and which tools to use (tool_choice not specified implies this).
- **`{type: "any"}`** — Model must use at least one available tool.
- **`{type: "tool", name: "X"}`** — Force model to use specific named tool X.
- **`{type: "none"}`** — Model cannot use any tools.

**Does NOT exist:**
- `{type: "allowed_tools", tools: [...]}` — **This is NOT standard Anthropic API** (it is your canonical layer / provider translation; see below).
- No built-in `allowed_tools` or "all tools except X" variant in the Messages API itself.

### Cache Behavior

**Source:** [Tool use with prompt caching](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-use-with-prompt-caching.md) — cache invalidation table:

> | Change | Invalidates |
> |--------|------------|
> | Changing `tool_choice` | **Messages cache only** |

**Impact:** Changing `tool_choice` between requests **does NOT invalidate the tools or system caches**. It only invalidates message-tier prefixes. Your ~430K cached prefix (tools + system) survives; only the messages below it are recomputed.

**Caching with forced tool use:** When you use `tool_choice: {type: "any"}` or `{type: "tool", name: "..."}`, the API prefills the assistant message to force tool use. This still hits the tools+system cache as long as the prefix is unchanged.

### "All Tools Except X" Problem

**Official status:** No built-in API mechanism. The Messages API does not support filtering tools while keeping the full toolset in the `tools` array.

**Workaround in principle:** Remove the tool from the `tools` array → breaks the prefix cache (see below).

---

## 2. Tools Array Modifications & Cache Invalidation

### Removing a Tool from the Array

**Source:** [Tool use with prompt caching](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-use-with-prompt-caching.md):

> | Change | Invalidates |
> |--------|------------|
> | Modifying tool definitions | **Entire cache (tools, system, messages)** |

**Impact:** Filtering the `tools` array (e.g., removing `recover_energy` so it cannot be called) **invalidates the tools cache prefix and all downstream prefixes** (system and messages). This is a **hard cache break**.

**Cost:** You lose the entire 430K cached token prefix and must recompute it. Given your use case (rejecting repeated recover_energy calls every 1–2 minutes), this is **not usable at scale**.

### Your Code: `allowed_tools` Translation

**Location:** `/home/liahua/IdeaProject/qq_bot/modules/provider-service/src/services/llm-provider/anthropic-translate.ts` lines 576–602.

**What it does:**
```typescript
// allowed_tools subset (lines 576-602)
if (choice && typeof choice === 'object' && choice.type === 'allowed_tools') {
  const fnNames = new Set<string>();
  // ... collect function names, web search, computer use flags
  const tools = buildFromAllowed(fnNames, allowWeb, allowComputer);
  if (tools.length === 0) {
    return { tools: [], toolChoice: undefined, forced: false };
  }
  // Return filtered tools array
  return { tools, toolChoice: { type: 'auto' }, forced: false };
}
```

**Verdict:** Your translator **filters the tools array by name**, returning only the allowed subset. This **breaks the prefix cache** on every use. The code explicitly acknowledges the Layer-1/Layer-2 split in comments (lines 24–29): it notes that forks align via full tools + execution-time rejection, not via tool_choice.

---

## 3. Assistant Prefill as a Steering Lever

### Support on Opus 4.6

**Status:** Prefilling the assistant message is still supported on Opus 4.6 *when prefill does not conflict with forced tool use.*

**Forced tool use + prefill rule:** When `tool_choice: {type: "any"}` or `{type: "tool", name: "..."}` is set, the API **automatically prefills** the assistant turn to force a tool call. If you try to supply your own prefill, it is overridden.

**Without forced tool use** (e.g., `tool_choice: {type: "auto"}` or default): You can prefill the assistant message with text to steer the model's direction.

### Can Prefill Prevent Tool Calls?

**Documented:** No. [Define tools](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools#model-responses-with-tools) says:

> Claude often comments on what it's doing or responds naturally to the user before calling tools... Your code should treat these responses like any other assistant-generated text.

Prefilling with a text opener (e.g., "I'll help by...") does **not** prevent the model from calling tools afterward in the same turn; it only frames the response.

**Limitation:** Prefill cannot forbid a tool; it can only suggest framing. The model decides whether to follow the prefill tone or call tools anyway.

### Cache Implications

**Source:** [Tool use with prompt caching](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-use-with-prompt-caching.md) and [Define tools](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools#controlling-claude-s-output):

Adding a prefilled assistant message adds content to the `messages` array. If the prefill differs between requests, it **invalidates the message-tier cache** only (tools and system remain cached).

**Verdict:** Negligible cache cost vs. filtering tools, but ineffective at blocking a specific tool.

---

## 4. Stop Sequences to Abort a Specific Tool

### How Stop Sequences Work

**Source:** Messages API documentation ([/messages/create](https://platform.claude.com/docs/en/api/messages/create.md)):

> **`stop_sequences`** (optional array of string) — Custom text sequences that cause the model to stop generating.
>
> When the model encounters a custom sequence, the response includes:
> - `stop_reason: "stop_sequence"`
> - `stop_sequence: <matched sequence>`

### Can Stop Sequences Fire Mid-Tool-JSON?

**Documented behavior:** **UNVERIFIED.** Official docs do not explicitly state whether stop sequences can fire inside a `tool_use` block's input JSON (e.g., after the model writes `"name":"recover_energy"`).

**Inference from practice:** Stop sequences are character-level, so theoretically a sequence like `"name":"recover_energy"` could match mid-JSON. However:
- No official docs confirm this works or what the response looks like if it does.
- The response format undefined if a `tool_use` block is incomplete.
- Relying on this is **fragile and unsupported**.

**Verdict:** **Not recommended.** Behavior is undocumented and likely to abort the turn entirely rather than selectively block one tool call.

### Cache Implications

Adding `stop_sequences` to a request **does not appear in the documented cache-invalidation table**. **UNVERIFIED whether it invalidates cache**, but if it does, it is likely message-tier only (same tier as `tool_choice`).

---

## 5. Special Tokens, XML Tags, and `<system-reminder>` Authority

### Official `<system-reminder>` Behavior

**Status:** `<system-reminder>` is **NOT a documented Anthropic API feature**. It is a **Claude Code convention**.

**Origin:** Your memory notes (anthropic-oauth.md, system-reminder blocks in tool results) show `<system-reminder>` is used by Claude Code to inject per-session configuration into conversation messages without breaking the shared system-prompt cache.

**What Anthropic documents:**
- No official API docs mention `<system-reminder>` or its special handling.
- No documented "special XML tokens" that carry special weight at the API level.

**How it works (Claude Code internal):**
- Claude Code interprets `<system-reminder>` blocks in tool results as high-priority overrides.
- The model is trained to treat blocks marked `[system-reminder]` as authoritative.
- This is a **product convention, not an API-level feature**; the API itself treats all tool_result text equally.

### Documented XML in Prompts

**Source:** [Citations](https://platform.claude.com/docs/en/build-with-claude/citations.md) and general API docs:

- The API accepts XML tags in prompts, but **does not assign special meaning to them by name**. Tags like `<document>`, `<thinking>`, and structured XML in documents are parsed for citations, but generic XML is treated as text.
- **No documented "control XML"** (e.g., `<budget:>`, `<automated_reminder_from_anthropic>`) that carries semantic weight.

### Inference & Cautions

- If you send `<system-reminder>` in a user message or tool_result via the Messages API, the model will **process it as text**, not as a command.
- Claude's training includes many system-reminder-like blocks from Claude Code sessions, so it recognizes the pattern and treats such blocks as high-priority.
- **This is not an API feature; it relies on model training and user convention.**

**Verdict:** `<system-reminder>` works in Claude Code because the model recognizes it, not because the API enforces it. On the Messages API, treat it as a text pattern the model understands, not an API primitive.

---

## 6. Extended Thinking & Adaptive Thinking on Opus 4.6

### Support on Opus 4.6

**Source:** [Thinking overview](https://platform.claude.com/docs/en/build-with-claude/thinking.md) (line 51):

> On Claude Opus 4.8, Claude Opus 4.7, Claude Opus 4.6, and Claude Sonnet 4.6, thinking is off until you set `thinking: {type: "adaptive"}`, which lets Claude decide when and how deeply to think based on the request.

**Extended Thinking (Manual Mode):**

**Source:** [Extended thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking.md):

> Extended thinking (`thinking.type: "enabled"` with `budget_tokens`) is **deprecated on the Claude 4.6 models** (requests using it still succeed).

**Verdict:** Opus 4.6 supports **adaptive thinking only** (`thinking: {type: "adaptive"}`). Manual extended thinking is deprecated but still works.

### Thinking Parameters & Cache

**Source:** [Tool use with prompt caching](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-use-with-prompt-caching.md):

> | Change | Invalidates |
> |--------|------------|
> | Changing thinking parameters | Messages cache always; tool and system caches too on models that render the thinking configuration ahead of them |

**For Opus 4.6 specifically:**
- Enabling/disabling adaptive thinking or changing `effort` level invalidates **at minimum the messages cache**.
- Whether it invalidates tool and system caches is model-dependent; assume it does to be safe.

### Can Thinking Prevent Tool Use?

**Documented:** No. Thinking is internal reasoning; it does not constrain tool selection. The model can think through a problem and then decide to call recover_energy anyway.

**With tool use:** [Thinking with tool use](https://platform.claude.com/docs/en/build-with-claude/thinking.md#thinking-with-tool-use) shows thinking can occur **between** tool calls (interleaved), but the model still chooses which tools to call.

**Verdict:** Thinking does not provide tool control.

---

## 7. Structured Outputs & Strict Tool Schemas

### Support on Opus 4.6

**Source:** [Strict tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/strict-tool-use.md):

Opus 4.6 supports `strict: true` on tool definitions. Structured outputs (grammar-constrained sampling) are supported on all active models including Opus 4.6.

### Can Strict Schemas Acknowledge a Constraint?

**Principle:** A strict schema enforces that tool inputs match a JSON Schema. You could theoretically add a field that the model must echo:

```json
{
  "name": "recover_energy",
  "strict": true,
  "input_schema": {
    "type": "object",
    "properties": {
      "acknowledgment_timestamp": {
        "type": "string",
        "description": "Echo back the retry_after timestamp to acknowledge backoff"
      }
    },
    "required": ["acknowledgment_timestamp"]
  }
}
```

**But:** This does **not** stop the model from calling the tool; it only changes what fields the tool requires. The model would fill in the field and call the tool anyway. You still see the tool call; you just reject it in code.

**Cache Implications:**
- Changing schema definitions invalidates the entire cache (tools, system, messages).
- Enabling/disabling strict mode or changing a schema **is a tool definition change**, so it breaks the prefix cache.

**Verdict:** Strict schemas enforce structure, not behavior. They do not prevent tool calls.

---

## 8. Context Management / Tool Result Clearing

### Support on Opus 4.6

**Source:** [Context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing.md):

Server-side context management with `clear_tool_uses_20250919` is available on Opus 4.6 via the `context_management` parameter and the `anthropic-beta: context-management-2025-06-27` header.

### Can Tool Result Clearing Stop Tool Calls?

**No.** Context editing clears **old tool_result blocks from the conversation history**, not from the tools array. It does not prevent the model from calling a tool on the next turn.

**Use case:** Long-running agent loops where old results are stale and waste context.

**Cache implications:**
- Clearing results invalidates cached prefixes when content is removed.
- Must be used with `clear_at_least` threshold to avoid thrashing the cache.

**Verdict:** Wrong tool for this use case. Context editing manages history, not tool access control.

---

## 9. Tool Description Best Practices

### Official Guidance

**Source:** [Define tools](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools.md#best-practices-for-tool-definitions):

> * **Provide extremely detailed descriptions.** This is by far the most important factor in tool performance. Your descriptions should explain every detail about the tool, including:
>   * What the tool does
>   * **When it should be used (and when it shouldn't)**
>   * What each parameter means and how it affects the tool's behavior
>   * Any important caveats or limitations
>
> * Aim for at least 3–4 sentences for each tool description, more if the tool is complex.

### Discouraging Over-Use via Description

**Documented:** Yes. Adding "when it shouldn't" guidance to the description can reduce inappropriate calls:

```json
{
  "name": "recover_energy",
  "description": "Allows the agent to sleep and restore energy. Should ONLY be called when energy is critically low (below 0.2). Do NOT call repeatedly or in close succession; wait at least 1 hour between calls. Repeated calls within short timeframes will be rejected with 'rest_rejected' and will harm task performance."
}
```

**Effectiveness:** Model training includes patterns that respond to such caveats, but **it is not a guarantee**. The model may still call recover_energy against the description if it believes the situation warrants it or if the description is ambiguous.

**Source hierarchy:**
1. **System prompt** — Highest authority; shapes the base instruction set.
2. **Tool description** — Mid-tier authority; Claude considers it when deciding whether to call the tool.
3. **Tool result feedback** — Lower tier; only seen after a call is made.

**Verdict:** Detailed descriptions help reduce over-use but are **not a tool restriction**. They influence behavior, not enforce it.

---

## 10. Your Code's `allowed_tools` Translation

### What It Does

**File:** `modules/provider-service/src/services/llm-provider/anthropic-translate.ts` lines 576–602.

**Behavior:** When a canonical request has `tool_choice.type === 'allowed_tools'`, your translator:
1. Extracts the subset of allowed tools.
2. Calls `buildFromAllowed(fnNames, allowWeb, allowComputer)` to build a filtered tools array.
3. Returns that filtered array and sets `toolChoice: {type: 'auto'}`.

**Result:** The Anthropic wire request has a **reduced tools array**, not a `tool_choice` restriction.

**Cache consequence:** This **breaks the prefix cache** on every request that uses `allowed_tools`, because the tools array is modified.

### Better Approach

**Documented alternative:** Layer-1/Layer-2 split (mentioned in your code comments, lines 24–29):
- **Layer 1 (wire level):** Send the **full tools array** with `tool_choice: {type: 'auto'}` to preserve cache.
- **Layer 2 (execution level):** After the model responds, **reject tool calls** to `recover_energy` (or any forbidden tool) in your execution loop, returning an error like "tool not available in this context."

This preserves the prefix cache while still controlling tool access.

---

## 11. Recommended Path Forward

### Rank by "Usable Without Breaking Cached Prefix"

#### **Tier 1: No Cache Cost (Messages-tier only)**

1. **Adjust tool description** — Add detailed "when NOT to use" guidance. Reduces (not prevents) over-use.
2. **Change `tool_choice` parameter** — Between requests, change from `{type: "auto"}` to `{type: "none"}` (or other value). This invalidates **messages cache only**, not tools/system.
3. **Prefill assistant message** — Add opening text to guide the model away from the tool (e.g., "I need to focus on completing this task first..."). Invalidates messages cache only; low cost.

#### **Tier 2: Light Cache Cost (System-tier invalidation)**

4. **Toggle web search or citations** — Toggling server tools invalidates system and messages caches but preserves tools. Not applicable to recover_energy, but included for reference.

#### **Tier 3: Full Cache Break (Not recommended)**

5. **Remove tool from `tools` array** — Your current `allowed_tools` approach. Breaks entire prefix cache.

### Concrete Recommendation

For your recover_energy rejection loop (500 rejections/week, 1–2 minute intervals):

1. **Improve tool description:**
   - State clearly when NOT to call it.
   - Cite the retry_after timestamp in the error message.

2. **Use Layer-2 execution-time rejection:**
   - Send full tools array (preserve cache).
   - When model calls recover_energy within the backoff window, reject it with a descriptive error in the tool_result: `{is_error: true, content: "rest_rejected, retry after 19:05. Do NOT call again until that time."}`
   - Let the model re-reason and pick a different action.

3. **Track rejection patterns:**
   - Use the memory tool or a similar mechanism to persist "last successful rest time" so the model can reason about when to try again.
   - This avoids repeated rejections within the same turn.

**Cache cost:** ~Zero degradation from the cache break you currently incur with filtered tools arrays. Full ~430K prefix remains warm.

---

## Summary Table

| Mechanism | Cost | Effectiveness | Usability |
|-----------|------|----------------|-----------|
| **Tool description** | None | Medium (trains model, not enforced) | High |
| **`tool_choice` change** | Message cache only | Low (doesn't prevent tool) | High |
| **Prefill assistant** | Message cache only | Low (suggestion only) | High |
| **`tool_choice: none`** | Message cache only | High (blocks all tools) | Low (too broad) |
| **Strict schema** | Full cache break | None (doesn't prevent call) | N/A |
| **Extended thinking** | System cache + | None (doesn't prevent tool) | Low |
| **Stop sequences** | Likely message cache | Unknown / risky | N/A |
| **`allowed_tools` filtering** | Full cache break | High (works) | Low (current cost) |
| **Context clearing** | Variable | None (history only) | N/A |
| **Layer-2 rejection** | None | High (works) | High |

---

## Sources

- [Tool use with prompt caching](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-use-with-prompt-caching.md)
- [Define tools](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools.md)
- [Thinking](https://platform.claude.com/docs/en/build-with-claude/thinking.md)
- [Extended thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking.md)
- [Strict tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/strict-tool-use.md)
- [Context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing.md)
- [Messages API reference](https://platform.claude.com/docs/en/api/messages/create.md)
- [Citations](https://platform.claude.com/docs/en/build-with-claude/citations.md)
- Your code: `/home/liahua/IdeaProject/qq_bot/modules/provider-service/src/services/llm-provider/anthropic-translate.ts` lines 1–40, 560–620

