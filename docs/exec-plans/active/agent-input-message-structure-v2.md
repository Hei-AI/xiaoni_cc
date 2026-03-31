# Agent Input Message Structure V2

## Goal
- Redefine inbound user message structure so actor, addressee, mentions, reply context, and plain text are explicit instead of being flattened into one ambiguous line.
- Keep the model-facing input readable while preserving a lossless structured representation for persistence, replay, and downstream UI/debug use.

## Scope
- `modules/agent-service`
- `packages/persistence`
- `modules/admin-panel/backend`
- Related transcript and replay readers that currently assume `conversation_items.content` is the only user-item payload

## Constraints
- Current production path is `NapCat -> provider-service -> admin-panel/backend -> admin-panel/frontend`; changes must not break the agent loop request contract.
- Provider-side canonical input still expects `type: "message"` items with string or content-part arrays; arbitrary nested JSON cannot be assumed to survive provider adapters unchanged.
- Shared persistence must stay centralized; transcript schema changes should be owned through `packages/persistence` and matching runtime-store migration work.
- Migration must be backward compatible with existing `conversation_items.content` rows.

## Problem
- Current agent input flattens inbound messages into a single string such as `#1 {闻震(@870853294)}: {小镜(@714457117)} 嘿`.
- That string mixes at least four semantics in one surface form:
  - batch position
  - speaker identity
  - mentioned-user identity
  - actual utterance text
- The result is ambiguous for both humans and models. A mention in message body is visually too similar to the actual speaker. The format is also lossy once stored as `conversation_items.content TEXT`.

## Common Message Structure
- This plan should define the repository's internal common message body, not only one inbound example.
- `conversation_items` should move to a common envelope plus per-kind payload model.
- Suggested common envelope:

```json
{
  "version": "v2",
  "kind": "inbound_message",
  "role": "user",
  "phase": null,
  "sequence": 1,
  "session": {
    "session_key": "qq:group:xxx",
    "chat_type": "group"
  },
  "trace": {
    "trace_id": "trace-1",
    "run_id": "run-1",
    "batch_id": "batch-1"
  },
  "payload": {}
}
```

- Field responsibilities:
  - `version`: schema version for message-body parsing and migrations.
  - `kind`: semantic message kind, used to decide payload shape and rendering strategy.
  - `role`: transcript role aligned with current conversation item semantics, for example `user` or `assistant`.
  - `phase`: assistant-only execution phase such as `commentary` or `final_answer`; user-side items stay `null`.
  - `sequence`: stable position within the current grouped input block.
  - `session`: transport/session context needed by replay and debugging.
  - `trace`: run-level correlation fields needed across agent loop, persistence, and admin backend.
  - `payload`: kind-specific structured body.

- Initial message kinds to support:
  - `inbound_message`: a user-side inbound chat message from NapCat or simulated inbox input.
  - `assistant_delivery`: an assistant-side delivered outbound message.
  - `tool_event`: optional future kind for structured tool I/O if we decide transcript rows should retain more than plain assistant text.
  - `legacy_text`: compatibility wrapper for old rows or fallback cases where only `content` exists.

## Target Shape
- `inbound_message` is one concrete payload under the common envelope. Suggested shape:

```json
{
  "version": "v2",
  "kind": "inbound_message",
  "role": "user",
  "phase": null,
  "sequence": 1,
  "session": {
    "session_key": "qq:group:xxx",
    "chat_type": "group"
  },
  "trace": {
    "trace_id": "trace-1",
    "run_id": "run-1",
    "batch_id": "batch-1"
  },
  "payload": {
    "speaker": {
      "user_id": "870853294",
      "display_name": "闻震"
    },
    "text": "嘿",
    "mentions": [
      {
        "user_id": "714457117",
        "display_name": "小镜",
        "surface": "@小镜"
      }
    ],
    "reply_to": null,
    "metadata": {
      "was_mentioned": false,
      "message_id": 123
    }
  }
}
```

- Keep a separate model-facing projection derived from that payload. Suggested text projection:

```text
[Message 1]
speaker: 闻震 (@870853294)
mentions: 小镜 (@714457117)
text: 嘿
```

- For reply context, append an explicit block instead of a free-form suffix:

```text
reply_to:
  speaker: 某人 (@123)
  text: 原消息
```

- `assistant_delivery` should also use the same envelope so transcript storage is consistent across roles. Suggested minimal payload:

```json
{
  "version": "v2",
  "kind": "assistant_delivery",
  "role": "assistant",
  "phase": "final_answer",
  "sequence": 2,
  "session": {
    "session_key": "qq:group:xxx",
    "chat_type": "group"
  },
  "trace": {
    "trace_id": "trace-1",
    "run_id": "run-1",
    "batch_id": "batch-1"
  },
  "payload": {
    "text": "收到，我去问一下。",
    "delivery": {
      "message_id": 5001
    }
  }
}
```

## Data Model Direction
- Extend transcript items so user-side entries can carry both:
  - `content`: human/model-readable projection string
  - `payload_json`: structured lossless payload for replay/debug/UI
- Preserve `content` for compatibility and search.
- Use `payload_json IS NULL` to represent legacy rows.
- The common envelope should be allowed for both user and assistant rows, even if assistant payload stays minimal in phase 1.

## Implementation Steps
- [ ] Add a repository migration plan for `conversation_items.payload_json` and matching Prisma/runtime-store schema updates.
- [ ] Add agent-service builders for structured inbound transcript payloads instead of calling `renderPromptBatchMessage` as the canonical source of truth.
- [ ] Change current-turn model input generation to render from the structured payload using explicit field labels.
- [ ] Change history replay to prefer structured payload rendering when present, and fall back to legacy `content`.
- [ ] Update admin/backend transcript readers to expose `payload_json` so future UI/debug pages can show speaker, mentions, and reply context separately.
- [ ] Add tests that cover mention-only, speaker-only, reply, and multi-message batch scenarios.

## Decision Log
- 2026-03-30: Do not solve this by tweaking punctuation in the old flat string. The root issue is missing structure, not separators.
- 2026-03-30: Keep provider request items in the existing `type: "message"` family and move structure ownership to transcript payload plus deterministic text projection. This avoids adapter churn across OpenAI/Codex/Gemini paths.
- 2026-03-30: `content` remains as a compatibility/search projection; `payload_json` becomes the source of truth for user inbound transcript semantics.

## Progress Log
- 2026-03-30: Audited current flattening path in `modules/agent-service/src/services/agent-loop-service.ts`; confirmed `renderPromptBatchMessage()` is used for both model input and persisted inbound transcript content.
- 2026-03-30: Audited transcript persistence and replay; confirmed current schema stores only `conversation_items.content TEXT`, which makes the flattening loss persistent across history replay.

## Verification
- Pending implementation.
