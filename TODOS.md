# TODOs

This file is the active project queue, not a history log. Keep only items that
still affect what we should build next.

## Current Read

Identity continuity does not make every older TODO disappear.

It does make one thing clear: relationship, memory, self-evolution, and feedback
items should stop growing as separate little systems. New long-lived behavior
should attach to the identity lineage substrate once Phase 1 exists.

So the queue is now split this way:

- Stage A behavior cleanup: keep fixing what users actually see in group chat.
- Identity Lineage Phase 1: build the continuity substrate.
- Infrastructure follow-up: keep if it improves correctness or performance and is
  independent of identity.
- Retired as standalone: fold into identity lineage instead of building another
  parallel memory model.

## P0 - Clean up Xiaoni group-reply style pollution after the silent-gate hotfix

Status: active Stage A follow-up.

What:

After the `preferred_action=silent` hotfix, follow up on the remaining style
pollution in group `253631878`: recent replay still contains many Xiaoni outputs
that start with `哈哈` / `确实`, and those examples can keep biasing future turns
even though silent inner reactions can no longer speak.

Why:

The hotfix only makes the inner-reaction decision authoritative when it says
silence. It does not remove polluted recent history, and it does not stop valid
`preferred_action=speak` turns from choosing low-value affirmative openers.
Without follow-up, 小腻 may become quieter but still sound patterned when she does
speak.

Identity impact:

Identity Lineage Phase 1 will help explain and trace this kind of drift later,
but it does not itself clean polluted replay history or make current group speech
better. This item stays active.

Follow-up work:

- Run a targeted replay/live QA pass for the latest `哈哈` / `确实` cluster and
  verify the hotfix does not over-silence normal group participation.
- Decide whether to advance
  `agent_session_context_windows.read_cutoff_after_conversation_id` or add
  runtime-only style-pollution filtering in the replay renderer.
- Preserve raw chat as truth. Prefer renderer/projection changes over rewriting
  stored chat history.
- Add trace-detail observability that shows when inner reaction narrowed the
  allowed tool set, especially `silent -> stay_silent only`.
- Add tests for the `preferred_action=search` path and decide whether search
  should force another inner reaction before speech.
- If Identity Lineage Phase 1 exists by the time this is implemented, record
  repeated negative feedback about formulaic openings as typed evidence /
  activation refs, not as another free-floating memory cue.

Depends on / blocked by:

- The silent-gate hotfix must stay deployed and healthy in `agent-service`.
- We need fresh post-hotfix examples from group `253631878` before deciding
  whether the next issue is still replay pollution, style selection during valid
  speech, or over-silencing.

## P0 - Finish Xiaoni Identity Lineage Phase 1

Status: in progress. The clean Phase 1 persistence contract and first runtime
vertical slice have landed.

Source:

- Current design:
  `/home/liahua/.gstack/projects/liahua-qq_bot/liahua-refactor-runtime-gateway-design-20260426-003522.md`
- Superseded design:
  `/home/liahua/.gstack/projects/liahua-qq_bot/liahua-refactor-runtime-gateway-design-20260424-175020.md`
- Phase 2 deferrals:
  `/home/liahua/.gstack/projects/liahua-qq_bot/xiaoni-identity-lineage-todo-20260425.md`

What:

Build the minimal identity continuity substrate with the new Phase 1 schema as the
only active contract:

```text
identity root + genesis snapshot/hash
-> identity change candidate
-> typed evidence refs
-> integrity judge result
-> accepted identity facts
-> lineage events
-> runtime activation traces as observation, not identity facts
```

Why:

Xiaoni's current runtime can preserve residue, replay `<小腻的OS>`, write
reflections, and recall memory. It cannot yet prove that a later Xiaoni is the
same Xiaoni continuing to live rather than a new character reading old notes.

Scope:

- Keep `packages/persistence` as the only persistence entry point.
- Keep `identity_key` global first, for example `xiaoni-main`, not session-scoped.
- Snapshot identity-bearing genesis separately from mutable `agent_prompts`.
- Use typed evidence refs from day one. Raw chat/action remains truth; summaries
  are projections.
- Treat all sources as candidate producers. Nothing writes accepted facts directly
  without judge semantics.
- Use `accepted_identity_facts` as the small runtime-readable projection.
- Keep runtime activation observation in `runtime_identity_activation_traces`, not
  in the durable identity lineage itself.
- Migrate old `identity_change_journal` rows into candidates when present, then
  stop exposing the old journal API.
- Migrate old `identity_activation_traces` rows into runtime activation traces
  when present, then stop exposing the old activation table API.
- Wire the first runtime loop:
  feedback reflection -> identity candidate -> phase1 hard-check judge ->
  accepted identity fact -> capped runtime projection -> activation trace.
- Add continuity trials for ordinary growth, external rewrite, reinterpretation,
  forgetting, fork divergence, and runtime/genesis separation.

Explicitly not Phase 1:

- Full `neural_nodes` / `neural_edges` graph.
- Selfhood Mirror.
- Skill Neuron Library.
- Heavy approval UI.
- A second runtime pipeline outside `agent-service`.
- A standalone pre-agent gate.

Mandatory tests:

- `packages/persistence/__tests__/identity-lineage.test.js`
- `modules/admin-panel/backend/src/__tests__/trace-span-builder.test.ts`
- `modules/agent-service/src/__tests__/agent-loop-service.test.ts` for the
  current vertical slice. Split to `identity-runtime-service.test.ts` if this
  grows into a separate service.
- Continuity trials fixture/eval suite if LLM classification is involved.

Done in this iteration:

- New active persistence contract:
  `identity_change_candidates`, `accepted_identity_facts`,
  `runtime_identity_activation_traces`, typed evidence refs, and lineage links.
- Legacy `identity_change_journal` / `identity_activation_traces` remain as
  migration sources only; no public writer path uses them.
- Agent runtime loads capped active accepted facts for `xiaoni` and projects them
  into the scene input as `[身份连续性]`.
- Agent runtime records `runtime_identity_activation_traces` after a run when
  accepted facts were projected.
- Feedback memory writer can turn a supported feedback reflection into an
  identity candidate and, when the phase1 hard-check judge passes, an accepted
  identity fact.

Done means:

- Prompt edits cannot mutate identity genesis.
- Ordinary growth and suspicious drift are distinguishable in tests.
- Fork and forgetting have explicit lineage semantics.
- Trace view can answer why a self/identity change was accepted, rejected, or
  downgraded.
- Runtime can receive only a capped set of accepted identity facts plus activation
  refs, not the full identity history.

## P2 - Retire standalone pre-agent gate

What:

Do not build a separate lightweight gate before the main agent loop.

Why:

The original concern was real: a group with `auto_reply_enabled=1` can make
Xiaoni feel too "on duty" because every message reaches the full agent path.
But a standalone pre-agent gate is the wrong abstraction once identity lineage
exists.

Identity impact:

Whether Xiaoni should notice, stay quiet, recall something, or join a thread is
not a separate router problem. It is part of her scene understanding and
activation path.

Build this inside the identity/activation system instead:

```text
scene evidence
-> unread meaning
-> activated relationship/topic/self refs
-> inhibition / permission to speak
-> speak, search, or stay silent
```

That keeps attention, memory, relationship, and speech choice in one traceable
chain instead of adding another shallow decision layer before the real one.

Constraints:

- Do not create a separate pre-agent service or heuristic gate.
- Do not route every message through a cheap classifier that silently drops
  context before Xiaoni can understand the scene.
- If cost becomes a real production problem, solve it as runtime scheduling or
  batching, not as a personality/attention fork.
- Keep any future "should I notice this?" behavior traceable through identity
  activation spans.

## P1 - Materialize transcript snapshot compaction in production

Status: independent infrastructure follow-up.

What:

Make `provider-service` actually produce and refresh
`chat_transcript_snapshots` rows in live traffic, instead of only having the
fixed-anchor replay code ready to consume them once they exist.

Why:

The stateless replay refactor is already done. What is still missing is the
production loop that turns long conversation history into a ready summary
anchor. Until that happens, replay is still correct, but it falls back to
rebuilding from the start of the session.

Identity impact:

This is not made obsolete by identity lineage. It remains useful for
cache-stability and long-session performance. It must, however, preserve the
same rule as identity work: raw chat is truth, summaries are projections.

Follow-up work:

- Confirm the summary webhook or equivalent production summary executor that
  will consume pending snapshot jobs.
- Add deployment-time verification that
  `chat_transcript_snapshots.summary_status` moves through
  `pending -> ready`.
- Add operator checks for failed or stale snapshot rows before relying on
  compaction for long-session performance.

## P2 - Fold deferred relationship-ledger event expansion into identity lineage

Status: retired as standalone TODO.

Former standalone ask:

After the first v1 relationship-ledger rollout lands with the minimal 3 event
types, add:

- `user_reengaged_xiaoni`
- `relationship_cooled`

Decision:

Do not keep this as a top-level relationship-memory TODO.

Once Identity Lineage Phase 1 exists, these higher-order social events should
be modeled as typed evidence / activation / relationship projection inputs
inside the lineage-aware system. Building them as a separate relationship-ledger
expansion would recreate the problem we are trying to leave behind: parallel
memory systems that each claim to know what Xiaoni is becoming.

What remains useful:

- `user_reengaged_xiaoni` is still a real signal, but it should point to
  concrete conversation evidence and activation context.
- `relationship_cooled` is still a real signal, but it should be derived from
  observed interaction decay and confidence downgrade, not a hand-wavy social
  label.

Revisit after:

- Identity Lineage Phase 1 has typed evidence refs.
- Relationship cards can cite lineage/evidence cleanly.
- Real traffic shows the initial 3 relationship events are stable enough.
