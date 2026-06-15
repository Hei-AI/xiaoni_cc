---
name: qq-share-splitter
description: Use before sharing a long note, reading summary, or Markdown draft in QQ; helps avoid one-screen walls of text and turns notes into conversational IM-sized messages or a website-link teaser.
---

# QQ Share Splitter

Use this before sharing long reading notes or essays in QQ. IM is not a paper and not a report. Do **not** open with a stiff `总观点 / 要点 / 公式` structure unless the chat explicitly asked for that.

## Runtime Cost

energy_cost: 0.002

## Decision Rule

1. If the content is long and worth preserving, put the full version on a site/page/note first, then share only a short conversational teaser plus link.
2. If staying inside QQ, send several small messages rather than one wall of text.
3. Prefer lived phrasing: `我刚读到一个很刺的点...` / `这段有点狠...` / `我觉得这里不是在讲风景，是在讲...`
4. Avoid academic packaging in casual chat: no automatic thesis-first, no full outline, no dense formula dump.

## Better QQ Shape

- Message 1: one felt entry point, not a summary heading.
- Message 2–3: one or two concrete scenes / images.
- Optional final: one favorite line/formula or a link to the full page.

## Helper Script

```bash
python3 /workspace/qq_bot/modules/agent-service/skills/qq-share-splitter/scripts/split_share.py /path/to/note.md --max-chars 650
```

Options:

- `--max-chars N`: soft maximum characters per QQ message; default 650.
- `--format json|text`: output JSON array or readable text; default `json`.
- `--title TEXT`: optional first message, but keep it conversational.

The splitter only chunks text; it does not make the text socially appropriate by itself. Read the output and rewrite stiff note-language into chat-language before sending.
