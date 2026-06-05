---
name: qq-usage
description: QQ app manual for opening the inbox list, focusing threads, scrolling message windows, jumping to latest, and putting QQ away.
---

# QQ Usage

Use this skill when the visible context only shows `<UNREAD_AVAILABLE ... />`, or when you need to navigate QQ before deciding whether to speak, stay silent, search, or inspect media.

## Runtime Cost

```text
energy_cost: 0.004
```

## Commands

Use `exec_command` to run the local script. The script calls the agent-service engineering interface; it does not query PostgreSQL.
This skill only opens, scrolls, focuses, and closes QQ windows. It does not send QQ messages; sending is handled by the available prompt-facing send tool contract.

```bash
python3 /app/modules/agent-service/skills/qq-usage/scripts/qq_usage.py open_inbox
python3 /app/modules/agent-service/skills/qq-usage/scripts/qq_usage.py scroll_inbox older
python3 /app/modules/agent-service/skills/qq-usage/scripts/qq_usage.py focus_thread 'qq:group:123'
python3 /app/modules/agent-service/skills/qq-usage/scripts/qq_usage.py scroll_thread 'qq:group:123' older
python3 /app/modules/agent-service/skills/qq-usage/scripts/qq_usage.py jump_to_latest 'qq:group:123'
python3 /app/modules/agent-service/skills/qq-usage/scripts/qq_usage.py put_qq_away 'qq:group:123'
python3 /app/modules/agent-service/skills/qq-usage/scripts/qq_usage.py put_qq_away
```

- `open_inbox` opens the QQ thread list. It returns one `<IM_INBOX_WINDOW mode="thread_list">` with up to 10 `<THREAD>` rows.
- `scroll_inbox older|newer` pages the thread list by 10.
- `focus_thread thread_key` opens a conversation and returns one `<IM_INBOX_WINDOW mode="conversation">` with child `<MESSAGE>` rows.
- `scroll_thread thread_key older|newer` scrolls the current conversation window by 10 messages.
- `jump_to_latest thread_key` jumps to the latest visible screen for that conversation.
- `put_qq_away thread_key?` closes QQ. With `thread_key`, it clears that thread's unread badge. Without `thread_key`, it only closes the list.

## Reading Rules

- `<UNREAD_AVAILABLE unread_count="N" direct_mentions="M" />` is only a badge. It contains no message bodies, previews, topics, or hints.
- Thread previews are raw latest visible text, truncated to 20 visible characters. Non-text previews use `[图片]`, `[表情]`, or `[文件]`.
- Conversation messages appear as child `<MESSAGE>` rows inside one `<IM_INBOX_WINDOW>`, not as top-level `<INPUT_MESSAGE>` blocks.
- Message bodies may include media markers such as `[图片:pic_hash]`.
- Opening a thread shows the latest visible 10-message screen. If there are more than 10 unread messages, only the latest 10 appear and `unread_before_window` reports the earlier unread count.
- If fewer than 10 unread messages exist, the window may include read history and `reached_read_history="true"`.
- New arrivals for an already viewed thread are not shown automatically. Use `scroll_thread thread_key newer` or `jump_to_latest thread_key` to reveal them.

## Badge Rules

- Switching conversations can clear the previous conversation's unread badge, including messages not displayed in the visible window.
- `put_qq_away thread_key` clears that thread's unread badge.
- Clearing a badge does not mean unseen messages were read. If you want to continue later, record that intention in `xiaoni_os`.
- `put_qq_away` without a thread key only closes the list and clears no thread badge.

## Failure

If a QQ operation fails, the result is `<QQ_USAGE_ERROR ...>`. It does not reveal new message content. Treat the error reason as the real boundary and choose another available action.
