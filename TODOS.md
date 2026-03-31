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
