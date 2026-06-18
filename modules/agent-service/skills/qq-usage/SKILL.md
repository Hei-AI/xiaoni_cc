---
name: qq-usage
description: QQ app manual for opening the inbox list, focusing threads, scrolling message windows, jumping to latest, and putting QQ away.
---

# QQ Usage

Use this skill when the visible context shows a `phone_notification` status-bar reminder, a legacy `<PHONE_NOTIFICATION ... />`, or when you need to navigate QQ before deciding whether to speak, stay silent, search, or inspect media.

## Runtime Cost

```text
energy_cost: 0.002
```

## Commands

Use `exec_command` to run the local script. The script calls the agent-service engineering interface; it does not query PostgreSQL.
This skill opens, searches, scrolls, focuses, and closes QQ windows. It does not send QQ messages; sending is handled by the available prompt-facing send tool contract.

```bash
python3 /app/modules/agent-service/skills/qq-usage/scripts/qq_usage.py open_inbox
python3 /app/modules/agent-service/skills/qq-usage/scripts/qq_usage.py scroll_inbox older
python3 /app/modules/agent-service/skills/qq-usage/scripts/qq_usage.py search_inbox 阿花
python3 /app/modules/agent-service/skills/qq-usage/scripts/qq_usage.py focus_private 85178516
python3 /app/modules/agent-service/skills/qq-usage/scripts/qq_usage.py focus_group 123
python3 /app/modules/agent-service/skills/qq-usage/scripts/qq_usage.py scroll_private 85178516 older
python3 /app/modules/agent-service/skills/qq-usage/scripts/qq_usage.py scroll_group 123 older
python3 /app/modules/agent-service/skills/qq-usage/scripts/qq_usage.py jump_private_to_latest 85178516
python3 /app/modules/agent-service/skills/qq-usage/scripts/qq_usage.py jump_group_to_latest 123
python3 /app/modules/agent-service/skills/qq-usage/scripts/qq_usage.py put_private_away 85178516
python3 /app/modules/agent-service/skills/qq-usage/scripts/qq_usage.py put_group_away 123
python3 /app/modules/agent-service/skills/qq-usage/scripts/qq_usage.py set_group_notification_mode 123 mentions_only
python3 /app/modules/agent-service/skills/qq-usage/scripts/qq_usage.py set_group_notification_mode 123 all
python3 /app/modules/agent-service/skills/qq-usage/scripts/qq_usage.py set_group_notification_delay 123 30
python3 /app/modules/agent-service/skills/qq-usage/scripts/qq_usage.py set_group_notification_delay 123 0
python3 /app/modules/agent-service/skills/qq-usage/scripts/qq_usage.py put_qq_away
```

- `open_inbox` opens the QQ thread list. It returns one `<IM_INBOX_WINDOW mode="thread_list">` with up to 10 `<THREAD>` rows. Group rows include `notification_muted` and `notification_aggregation_seconds`.
- `scroll_inbox older|newer` pages the thread list by 10.
- `search_inbox query` searches private and group chats by visible chat name, group name, or QQ id, and returns `<IM_INBOX_WINDOW mode="search_results">`.
- `focus_private user_id` opens a private chat by the other person's QQ id and returns one `<IM_INBOX_WINDOW mode="conversation">` with child `<MESSAGE>` rows.
- `focus_group group_id` opens a group by QQ group id.
- `scroll_private user_id older|newer` and `scroll_group group_id older|newer` scroll the current conversation window by 10 messages.
- `jump_private_to_latest user_id` and `jump_group_to_latest group_id` jump to the latest visible screen for that conversation.
- `put_private_away user_id` and `put_group_away group_id` close QQ and clear that conversation's unread badge.
- `set_group_notification_mode group_id mentions_only` keeps ordinary group messages in QQ inbox but stops status-bar reminders unless someone explicitly mentions you. `set_group_notification_mode group_id all` restores ordinary group status-bar reminders.
- `set_group_notification_delay group_id seconds` sets how many seconds ordinary, unmuted group messages wait so multiple messages can become one status-bar reminder. Use `0` to turn off the delay. Mentions still remind immediately.
- `put_qq_away` closes QQ. If a chat is currently open, it clears that chat's unread badge.

## Conversation IDs

- For private chats, use the other person's QQ id: `focus_private 85178516`.
- For groups, use the QQ group id: `focus_group 123`.
- Do not pass internal `thread_key` / `session_key` values to this skill. Use the QQ id or group id instead.
- If you only remember a name, use `search_inbox name` first. Search matches currently stored visible names, group names, and QQ ids; if a group only has a fallback name like `群 123`, search by the real group name will not find it until that name is stored.

## Reading Rules

- `phone_notification` reminders and legacy `<PHONE_NOTIFICATION ... />` blocks are only status-bar notifications. They may contain a short latest-message preview and sender label for allowed notifications; use `focus_private user_id` or `focus_group group_id` to open the matching conversation before treating it as the full thread.
- Thread previews are raw latest visible text, truncated to 20 visible characters. Non-text previews use `[图片]`, `[表情]`, or `[文件]`.
- Conversation messages appear as child `<MESSAGE>` rows inside one `<IM_INBOX_WINDOW>`, not as top-level `<INPUT_MESSAGE>` blocks.
- Message bodies may include media markers such as `[图片:pic_hash]`.
- Opening a thread shows the latest visible 10-message screen. If there are more than 10 unread messages, only the latest 10 appear and `unread_before_window` reports the earlier unread count.
- If fewer than 10 unread messages exist, the window may include read history and `reached_read_history="true"`.
- New arrivals for an already viewed conversation are not shown automatically. Use `scroll_private user_id newer` / `scroll_group group_id newer` or the matching `jump_*_to_latest` command to reveal them.

## Badge Rules

- Switching conversations can clear the previous conversation's unread badge, including messages not displayed in the visible window.
- `put_qq_away` clears the currently open conversation's unread badge. If only the inbox list is open, it clears no conversation badge.
- Clearing a badge does not mean unseen messages were read. If you want to continue later, record that intention in `xiaoni_os`.

## Failure

If a QQ operation fails, the result is `<QQ_USAGE_ERROR ...>`. It does not reveal new message content. Treat the error reason as the real boundary and choose another available action.
