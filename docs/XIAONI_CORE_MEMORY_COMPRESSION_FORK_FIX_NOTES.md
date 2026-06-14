# Xiaoni Core Memory Compression Fork Fix Notes

Status: investigation note, 2026-06-14.

## Incident

Failed run:

- `core_memory_compression_fork_runs.id=56`
- `fork_run_id=core-memory-fork:runtime_1781366735887_34612a7c:9d541f35`
- Started at `2026-06-14 00:05:37`
- Error: `compress_core_memory fork tried unsupported tool: send_in_private`

The previous run for the same window succeeded:

- `core_memory_compression_fork_runs.id=55`
- `fork_run_id=core-memory-fork:runtime_1781366656648_6ce7a621:f480eb79`

## Root Cause

The normal compression path is correct: the compression fork request should allow only:

- `exec_command`
- `compress_core_memory`

The failed run did not enter that normal path. A pending compression state leaked into the main-loop budget plan:

1. `pendingCoreMemoryCompression` made `buildContextBudgetPlan()` return `coreMemoryCompression` with `summarySourceInput = null`.
2. The scheduler then used `summarySourceInput ?? requestInput`.
3. Because `summarySourceInput` was null, it built a compression fork from ordinary main-agent input.
4. Ordinary input has no core-memory pressure marker, so the request inherited the ordinary main-agent allowed tools.
5. The model called `send_in_private`; the compression fork runtime correctly rejected it before execution.

This was an engineering state-machine bug, not the main agent self-triggering compression.

## Cache Constraint

Do not dynamically change the `tools` definition list for this workflow. Keeping the same tool schema protects prompt prefix caching.

Runtime phase gating can still use `tool_choice.allowed_tools.tools` to restrict which of the already-defined tools are callable for a given phase.

## Fix Direction

1. Remove the `pendingCoreMemoryCompression` budget-plan branch.
   - The main agent should not care about compression pending/running state.
   - The main loop should read durable cutoff/summary and build its own normal request.

2. Remove `summarySourceInput ?? requestInput`.
   - A compression fork must only be scheduled with `summarySourceInput`.
   - If a plan has `coreMemoryCompression` but no `summarySourceInput`, refuse to schedule and log an engineering error.

3. Keep compression fork `tools` equal to the stable workflow tools list.
   - Do not cut the tool schema.
   - Do keep compression fork `tool_choice.allowed_tools.tools` restricted to `exec_command` and `compress_core_memory`.

4. Move duplicate/running/stale handling to persistence.
   - The in-memory `coreMemoryCompressionForks` map can remain only as a local promise cache.
   - The durable source of truth should be a claim on `core_memory_compression_fork_runs`.

5. Upgrade `core_memory_compression_fork_runs` from audit-only to claim-capable.
   - Add durable coverage/claim fields such as `compression_covered_end_conversation_id`, `claimed_by`, and `claimed_at`.
   - Add a partial unique guard for one running compression per `(identity_key, context_session_key)`.
   - Mark stale running claims stale/superseded before retry.

6. Guard commit against late stale writers.
   - Before writing `context_summary` and read cutoff, verify the fork is still the active running claim.
   - If current cutoff already covers the fork range, mark the fork superseded/no-op and do not overwrite summary/cutoff.

No full transaction rollback of external side effects is required.

## Tests To Add

- Pending/race regression: no compression fork can start from ordinary `requestInput`.
- Missing `summarySourceInput` regression: scheduling refuses instead of falling back.
- Compression request contract: `tools` stays stable, `tool_choice.allowed_tools.tools` is `exec_command + compress_core_memory`.
- Restart durability: a new service instance sees an existing running claim and does not schedule a duplicate.
- Stale reclaim: expired running claim is marked stale and exactly one replacement starts.
- Late commit: older fork finishing after a newer cutoff is marked superseded/no-op and does not overwrite summary/cutoff.
