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
