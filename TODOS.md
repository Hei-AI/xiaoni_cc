# TODOs

## Design a memory-aware pre-agent gate for group chat

What:
Add a lightweight gate before the main agent loop that decides whether an incoming group message is worth sending into the full agent pipeline.

Why:
Right now a group with `auto_reply_enabled=1` still pushes every message into the main agent path, and 小腻 can only decide to stay silent after spending a full reasoning turn. That makes her feel like she is always "on duty" instead of naturally paying attention.

Pros:
- Reduces obvious bot-like over-attention in busy groups.
- Lowers wasted main-agent turns on chatter that is clearly unrelated.
- Creates the right foundation for the later "should I join this conversation?" stage.

Cons:
- This is easy to get wrong without memory and speaker-target inference.
- A naive gate will suppress valid opportunities where nobody @mentions 小腻 but the message is still clearly aimed at her.
- Adds another decision layer, so it must be simpler and more boring than the main agent, not a second personality engine.

Context:
We explicitly deferred this during `/plan-eng-review` on branch `refactor/runtime-gateway`.
The current design keeps Stage A focused on "when 小腻 speaks, she should sound like a real group member."
We decided not to build the pre-agent gate yet because group-chat relevance is not recoverable from the current message alone.
In real group conversation, people often continue a thread without directly @mentioning the person they are addressing, so the gate needs memory and thread-target inference before it is safe.

Depends on / blocked by:
- Finish Stage A first: stabilize prompt/runtime/tool wording so 小腻 stops sounding like customer support.
- Then design Stage B: memory + topic continuity + "who is this message actually for?" inference.
- Only after those exist should we add a pre-agent gate.

## Materialize transcript snapshot compaction in production

What:
Make `provider-service` actually produce and refresh `chat_transcript_snapshots` rows in live traffic, instead of only having the fixed-anchor replay code ready to consume them once they exist.

Why:
The stateless replay refactor is already done. What is still missing is the production loop that turns long conversation history into a ready summary anchor. Until that happens, replay is still correct, but it falls back to rebuilding from the start of the session.

Pros:
- Unlocks the intended cache-stability win for longer-running sessions.
- Puts the existing `transcript_compact_offset` setting to real use.
- Keeps the replay contract and the compaction pipeline clearly separated.

Cons:
- Adds background summarization behavior that needs monitoring and failure handling.
- Needs careful rollout so summary freshness and bad-summary recovery are observable.

Context:
The fixed-anchor replay work is complete and has been archived out of `active/`.
What remains is not a blocker for replay correctness. It is follow-up productionization work for the snapshot materialization path already scaffolded in `provider-service`.

Depends on / blocked by:
- Confirm the summary webhook or equivalent production summary executor that will consume pending snapshot jobs.
- Add deployment-time verification that `chat_transcript_snapshots.summary_status` moves through `pending -> ready`.
- Add operator checks for failed or stale snapshot rows before relying on compaction for long-session performance.

## Expand deferred Xiaoni relationship-ledger event types after v1

What:
After the first v1 relationship-ledger rollout lands with the minimal 3 event types, add the deferred higher-order social events:
- `user_reengaged_xiaoni`
- `relationship_cooled`

Why:
The v1 relationship memory plan intentionally starts with the smallest stable set of events that can produce visible shared-history behavior:
- `shared_joke_formed`
- `reply_chain_success`
- `topic_reactivated`

That keeps the first implementation from turning into a noisy social-theory engine. But long-term, we still need two additional signals:
- `user_reengaged_xiaoni`: someone actively pulls 小腻 back into the thread, which is different from generic reply success
- `relationship_cooled`: a once-real connection has gone stale and should fade for product reasons, not just generic score decay

Pros:
- Preserves the v1 scope boundary while keeping the fuller relationship model visible
- Avoids losing two product-important signals in chat history or tribal memory
- Creates a clean stage-2 TODO for the relationship-ledger system instead of quietly expanding v1

Cons:
- Leaves the first rollout without explicit “they came back for her” and “this relationship actually cooled” event semantics
- Some early card behavior will rely on score decay alone instead of first-class cooling events

Context:
The approved relationship-memory direction is `B + A`:
- relationship ledger as truth layer
- traceable relationship cards as runtime projection layer

During planning we explicitly chose to keep v1 event generation to 3 event types only, and defer the other 2 to a later pass so the first implementation stays disciplined.

Depends on / blocked by:
- Land the v1 relationship-ledger plan first
- Observe real traffic and confirm the first 3 event types are stable enough before adding higher-order social events
