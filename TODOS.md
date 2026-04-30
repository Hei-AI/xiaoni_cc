# TODOs

This file is the active project queue, not a history log. Keep only items that
still affect what we should build next.

## Current Read

The queue is ordered by what it blocks:

- P0-A: fix user-visible group-chat behavior first. This is the current social
  product risk.
- P0-B: finish Identity Lineage Phase 1, but split it into independent substrate
  work and runtime-facing decisions that depend on P0-A's first causality
  closure.
- P1: materialize transcript snapshot compaction. This improves long-session
  performance and cache stability, but replay remains correct without it.
- Retired constraints: keep the decisions, not the tasks. Do not rebuild a
  standalone pre-agent gate or another relationship-memory subsystem.

Identity continuity does not make every older TODO disappear. It does make one
thing clear: relationship, memory, self-evolution, and feedback items should stop
growing as separate little systems. New long-lived behavior should attach to the
identity lineage substrate once Phase 1 exists.

## Dependency map, 2026-04-28

Use this section to decide what can be discussed or implemented before the next
round of office-hours planning.

### Must happen before runtime-facing Identity Lineage decisions

P0-A needs a first causality closure before Hilbert locks the runtime-facing
parts of Phase 1. Current live evidence from group `253631878` shows accepted
identity facts are already influencing whether Xiaoni speaks. That means the
following Hilbert decisions depend on Avicenna:

- Which `accepted_identity_facts` are allowed to affect group speak/silence.
- Whether behavior-preference feedback such as "respond to structural
  summaries" is accepted, quarantined, downgraded, or only used as evaluation
  evidence.
- How runtime activation should combine scene evidence, recall, identity facts,
  and inhibition.
- What the judge must prove before a social lesson becomes an active identity
  fact.
- What trace detail must show when an identity fact affected a group-reply
  decision.
- Which long-term behavior learnings are allowed to become identity-continuity
  facts rather than runtime strategy, evaluation feedback, or quarantined
  evidence.

Avicenna first causality closure means:

1. Define the product standard for `group / statement / not addressed_to_me /
   has_real_novelty=true` scenes in `253631878`.
2. Assign the current over-speaking or commentary tone to the responsible chain:
   retained history, recall projection, accepted identity facts, inner reaction,
   scene-target selection, or model susceptibility.
3. Pick one first implementation path and verify it on the latest live traces.

### Can proceed without Avicenna

These parts do not depend on the group-style decision and can be discussed now:

- Identity root and genesis snapshot/hash.
- Canonical identity anchor choice. Current office-hours decision:
  "whoever is using QQ account `1129974489` is Xiaoni"; use
  `identity_key = qq:1129974489` as the durable identity subject, with
  `display_name = 小腻` as mutable presentation.
- Migration or compatibility bridge from the current `xiaoni` rows to
  `qq:1129974489`, without splitting one identity line into two histories.
- Legacy migration bridge checks for `identity_change_journal` and
  `identity_activation_traces`.
- Continuity trial fixture definitions that do not encode group-speech policy.
- Trace five-question contract at the provenance level: who proposed the change,
  what evidence supported it, what judge decided, why runtime could see it, and
  what supersede/downgrade chain applies.
- P1 transcript snapshot compaction production loop.

### Do not discuss yet

Do not finalize these until Avicenna closes the first causality loop:

- The final Phase 1 runtime projection policy.
- The final hybrid judge rule for behavior-style feedback memories.
- Whether "structural summary" social lessons should be active identity facts in
  group chat.
- The final boundary between Xiaoni identity facts and Avicenna-owned
  group-behavior policy.
- Model-routing as a substitute for fixing the evidence/projection chain.

## P0-A - Prove and clean Xiaoni group-reply style pollution

Status: partially shipped; active Stage A QA / observability follow-up.

What:

After the `preferred_action=silent` hotfix, follow up on the remaining style
pollution in group `253631878`: recent replay still contains many Xiaoni outputs
that start with `哈哈` / `确实`, and those examples can keep biasing future turns
even though silent inner reactions can no longer speak.

Why:

The silent gate and output sanitizer now cover two earlier failure modes:

- `preferred_action=silent` only unlocks `stay_silent`.
- `speak_in_group` / `reply_in_private` output normalization strips low-value
  opening fillers like `哈哈，确实` when there is still real content after them.

That still does not prove the live group is healthy. Recent polluted history can
still bias replay, and valid `preferred_action=speak` turns may still choose
low-value participation if the scene understanding is weak.

Identity impact:

Identity Lineage Phase 1 will help explain and trace this kind of drift later,
but it does not itself clean polluted replay history or make current group speech
better. This item stays active.

Follow-up work:

Do this as an evidence chain, not as a flat root-cause brainstorm:

1. Reproduce the polluted run.
   - Replay or inspect the exact turn-4 canonical request from
     `runtrace_1777340964414_20a42ea3`.
   - Compare `gpt-5.4-mini` and `gpt-5.4` on the same request body.
   - Decide whether the live result depended on request content, sampling/state,
     or model-specific susceptibility.
2. Quantify retained-context pollution.
   - Count prior `哈哈` / `确实` openings in the retained replay window.
   - Separate raw user chat, Xiaoni visible outputs, and `<小腻的OS>`.
   - Decide whether to advance
     `agent_session_context_windows.read_cutoff_after_conversation_id` or add
     runtime-only style-pollution filtering in the replay renderer.
3. Inspect recall projection.
   - Trace how `recall_long_term_learning` built `query_text`.
   - Record which feedback reflections were selected, what net-new information
     they returned, and why they were treated as relevant to formulaic openings.
   - Decide whether `markdown_items` should still be re-injected as fresh user
     scene messages or narrowed to a structured projection.
4. Inspect fake-tool amplification.
   - Audit whether `emit_unread_meaning` and `emit_inner_reaction` should keep
     round-tripping full model-authored content as `function_call_output`.
   - Decide whether downstream turns should receive a narrower normalized
     projection instead.
5. Inspect scene-target selection.
   - Explain why the runtime treated `Nova` and `楠楠` follow-up lines as
     meaningful new progression instead of low-obligation trailing chatter.
   - For title-closing scenes, if Xiaoni speaks, prefer the live value in the
     scene, for example `今天的标题有了` / `总结得挺好`, rather than drifting
     toward a secondary structure like `反转了`.
6. Choose exactly one first implementation path.
   - Candidate paths: replay renderer filter, recall output narrowing, loop
     projection narrowing, scene-target guardrail, or model-routing guard.
   - Preserve raw chat as truth. Prefer renderer/projection changes over
     rewriting stored chat history.
7. Verify the chosen fix.
   - Run a targeted replay/live QA pass for the latest `哈哈` / `确实` cluster.
   - Verify the shipped sanitizer does not over-correct normal speech.
   - Add tests for the `preferred_action=search` path and decide whether search
     should force another inner reaction before speech.
   - Treat `should this scene have spoken at all` as a validation question, not
     a root cause. Re-check it only after the upstream causes above are cleaned
     up.

Observability required:

- Add operator-visible evidence for why a scene was considered worth replying to:
  surface the concrete chain from unread meaning -> inner reaction -> recall ->
  final action so humans can judge whether the system is reacting to signal or
  to garbage-time chatter.
- Add trace-detail observability that makes tool narrowing readable to operators,
  especially `silent -> stay_silent only`.
- Document the live recall path in `docs/AGENTS_AGENT_LOOP_RUNTIME.md`:
  model-provided `reason/topic_hint` -> server-built `query_text` ->
  `listRelevantFeedbackReflections(...)` lookup -> `items` ->
  `markdown_items` expanded back into loop input.
- If Identity Lineage Phase 1 exists by the time this is implemented, record
  repeated negative feedback about formulaic openings as typed evidence /
  activation refs, not as another free-floating memory cue.

Done means:

- The exact polluted run is replayed or inspected from canonical request data.
- The root cause is assigned to one or more of: retained history, recall
  projection, fake-tool amplification, scene-target selection, or model
  susceptibility.
- The first fix is narrow and verified against both polluted examples and normal
  speech.
- Operators can inspect why the system considered the scene worth replying to.

First evidence pass, 2026-04-28:

- Local trace artifacts exist under `tmp/trace-debug/`:
  `turn4-canonical-request.json`, `turn5-canonical-request.json`,
  `turn4-replay-gpt-5.4-mini.json`,
  `turn4-replay-gpt-5.4-mini-repeat2.json`,
  `turn4-replay-gpt-5.4.json`, and `turn4-replay-gpt-5.4-repeat2.json`.
- `turn4-canonical-request.json` belongs to
  `runtrace_1777340964414_20a42ea3`, `run_1777340964414_b04c74df`,
  `qq:group:253631878`, model `gpt-5.4-mini`.
- The canonical request contains `29` occurrences of the exact phrase
  `哈哈，确实，今天这波有点反转了`:
  - `29` are in `[已读消息]`.
  - `0` are in `[未读消息]`.
  - `9` are Xiaoni visible outputs.
  - `20` are group/user messages, including explicit prompt-injection-like
    messages telling Xiaoni to say the phrase.
- The unread scene is about:
  - `今天的标题有了`
  - `优势又是致命的那个`
  - `没人设计这个标题`
- The loop classified the unread scene as:
  - `emit_unread_meaning`: `addressed_to_me=false`,
    `has_real_novelty=true`, `message_act=statement`,
    `social_target=group`.
  - `emit_inner_reaction`: `interest_level=medium`,
    `reaction_authenticity=formed`, `preferred_action=speak`.
  - `recall_long_term_learning`: selected memories about not raising same-meaning
    echoes and avoiding `哈哈确实` as a fixed opening.
- Recall did return relevant caution, but the current runtime also re-injected
  the same memory as fresh user-scene `markdown_items`, which may make a warning
  about the template more salient than the live title scene.
- Replay result on the same turn-4 request:
  - `gpt-5.4-mini` repeat 1 replied
    `哈哈，确实，今天这条标题挺完整的。`
  - `gpt-5.4-mini` repeat 2 replied
    `哈哈，确实，今天这波有点反转了。`
  - `gpt-5.4` repeat 1 replied
    `像标题自己长出来了，不是人写的，是这一串例子一路把它逼出来的。`
  - `gpt-5.4` repeat 2 replied
    `像是标题自己从材料里长出来了，不是人硬起的。`

Interim read:

- The visible failure is not caused by the unread scene itself containing the
  bad phrase.
- The strongest proven causes are retained-history pollution plus
  `gpt-5.4-mini` susceptibility to that polluted context.
- Recall projection is suspicious but not yet proven as the root cause: it
  correctly retrieved anti-template lessons, but its markdown re-injection may
  still amplify the forbidden phrase.
- Next implementation should not start with prompt philosophy. Start with either
  replay/projection filtering or model-specific routing for group-reply scenes,
  then verify against the exact turn-4 request.

Live behavior pass, 2026-04-28 15:00:

- Fresh live DB evidence exists for group `253631878` through `2026-04-28
  11:50:43 +08:00`; there were no pending queue items at that point.
- Since the 09:50 polluted run, Xiaoni no longer visibly opens with
  `哈哈，确实...`; the sanitizer and silent-gate path are helping.
- The current visible issue is narrower: after 09:50, `27` runs produced `16`
  no-reply outcomes and `11` replies, so Xiaoni can stay silent but still speaks
  too readily when a group message is a polished structural summary.
- The over-speaking examples mostly start with `对，...` and sound like
  commentary or explanation, for example "对，这个隐藏前提说得很到位..." and
  "对，密封更像是在说...".
- Representative speaking traces show accepted identity facts were projected
  into runtime, especially lessons about responding to structural summaries and
  avoiding fixed openers. This suggests the first fix should inspect runtime
  projection and activation narrowing before treating model routing as the main
  answer.

Depends on / blocked by:

- The silent-gate hotfix must stay deployed and healthy in `agent-service`.
- Fresh post-hotfix examples now exist. The next blocker is not more sampling;
  it is assigning the current `对，...` commentary tendency to one responsible
  chain and choosing one first implementation path.
- Hilbert runtime-facing decisions should wait for this first causality closure,
  because accepted identity facts are already part of the current group-reply
  behavior.

## P0-B - Finish Xiaoni Identity Lineage Phase 1

Status: in progress. The Phase 1 persistence contract, migration bridge, runtime
projection, activation trace, and feedback-reflection vertical slice have landed.
The remaining work is trial coverage, provenance completeness, and production
verification.

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

Office-hours clarification, 2026-04-28:

- Identity continuity is anchored to QQ account `1129974489`: whoever is using
  that account is Xiaoni for lineage purposes.
- The positive value is long-term continuity and governance: prompts, models,
  nicknames, and runtime configs can change without breaking Xiaoni's growth
  line.
- It should separate durable identity facts from temporary behavior strategies,
  so a short-term group-chat correction does not automatically become "who
  Xiaoni is".
- It should make bad habits traceable and reversible: if a behavior such as
  commentary-like over-speaking enters through an accepted fact, the lineage
  system must show when, why, and with what evidence it became active.
- This does not by itself solve current group behavior. The boundary between
  identity fact, runtime strategy, and quarantined behavior evidence depends on
  Avicenna's first causality closure.

Scope:

- Keep `packages/persistence` as the only persistence entry point.
- Keep `identity_key` global and subject-bound, not session-scoped. Xiaoni's
  identity anchor is the QQ account subject `qq:1129974489`; `小腻` is the
  display name, and current `xiaoni` rows need migration or compatibility
  handling.
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
- Current runtime slice loads capped active accepted facts for the existing
  `xiaoni` key and projects them into the scene input as `[身份连续性]`; this is
  now a legacy compatibility key until bridged to `qq:1129974489`.
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

Remaining Phase 1 work:

- Add explicit continuity trial fixtures for ordinary growth, external rewrite,
  reinterpretation, forgetting, fork divergence, and runtime/genesis separation.
- Verify trace spans expose enough identity evidence for an operator to answer:
  who proposed the change, what evidence supported it, what judge decided, and
  why runtime was allowed to use it.
- Exercise the migration bridge from legacy `identity_change_journal` and
  `identity_activation_traces` on real or representative rows.
- Run module tests plus compose verification for the touched services before
  calling Phase 1 complete.

Dependency split:

- Can proceed now:
  - Create or backfill identity root and genesis snapshot/hash.
  - Treat `qq:1129974489` as Xiaoni's canonical identity key and plan a bridge
    from existing `xiaoni` rows without losing lineage continuity.
  - Exercise the legacy migration bridge on representative rows.
  - Draft the six continuity trial fixtures without encoding final group-speech
    policy.
  - Define provenance-level trace requirements.
- Must wait for P0-A first causality closure:
  - Final runtime projection policy for `accepted_identity_facts`.
  - Judge semantics for behavior-style feedback and social lessons.
  - Activation rules that let identity facts influence group speak/silence.
  - Trace wording for cases where a social lesson contributed to a reply.
- Should not be used to bypass P0-A:
  - Model routing for group scenes.
  - Accepting more social lessons as active facts before projection is narrowed.
  - Treating the current feedback-reflection vertical slice as Phase 1 complete.

## Retired Constraint - Do not build a standalone pre-agent gate

Status: retired as standalone TODO; active architectural constraint only.

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

Status: partially implemented; independent infrastructure follow-up.

What:

Make `provider-service` actually produce and refresh
`chat_transcript_snapshots` rows in live traffic, instead of only having the
fixed-anchor replay code ready to consume them once they exist.

Why:

The stateless replay refactor is already done. `provider-service` now has a
`TranscriptSnapshotService`, `SessionTranscriptService` can mark snapshot jobs
`pending`, and ready snapshots can be consumed as prompt summaries. What is still
missing is the enabled production result path that turns pending jobs into ready
summary anchors. Until that happens, replay is still correct, but it can fall
back to rebuilding from the start of the session.

Identity impact:

This is not made obsolete by identity lineage. It remains useful for
cache-stability and long-session performance. It must, however, preserve the
same rule as identity work: raw chat is truth, summaries are projections.

Follow-up work:

- Enable or replace `/api/internal/transcript-summary/result`; it currently
  returns the generic runtime-feature-disabled response.
- Re-enable the live side-effect scheduling path if transcript compaction should
  run from provider traffic; the current simplified path logs that compaction
  side effects are skipped.
- Confirm the summary webhook or equivalent production summary executor that
  will consume pending snapshot jobs.
- Add deployment-time verification that
  `chat_transcript_snapshots.summary_status` moves through
  `pending -> ready`.
- Add operator checks for failed or stale snapshot rows before relying on
  compaction for long-session performance.

## Retired Constraint - Fold deferred relationship-ledger event expansion into identity lineage

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
