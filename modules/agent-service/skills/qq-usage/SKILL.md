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
python3 /app/modules/agent-service/skills/qq-usage/scripts/qq_usage.py focus_private 85178516 27590
python3 /app/modules/agent-service/skills/qq-usage/scripts/qq_usage.py focus_group 123
python3 /app/modules/agent-service/skills/qq-usage/scripts/qq_usage.py focus_group 123 88012
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
python3 /app/modules/agent-service/skills/qq-usage/scripts/qq_usage.py view_profile
python3 /app/modules/agent-service/skills/qq-usage/scripts/qq_usage.py view_profile 85178516
python3 /app/modules/agent-service/skills/qq-usage/scripts/qq_usage.py set_avatar /xiaoni-runtime/picture/new_avatar.png
python3 /app/modules/agent-service/skills/qq-usage/scripts/qq_usage.py set_signature "今天也在好好生活"
python3 /app/modules/agent-service/skills/qq-usage/scripts/qq_usage.py set_signature ""
python3 /app/modules/agent-service/skills/qq-usage/scripts/qq_usage.py set_status busy
python3 /app/modules/agent-service/skills/qq-usage/scripts/qq_usage.py set_status online
```

- `open_inbox` opens the QQ thread list. It returns one `<IM_INBOX_WINDOW mode="thread_list">` with up to 10 `<THREAD>` rows. Group rows include `notification_muted` and `notification_aggregation_seconds`.
- `scroll_inbox older|newer` pages the thread list by 10.
- `search_inbox query` searches private and group chats by visible chat name, group name, or QQ id, and returns `<IM_INBOX_WINDOW mode="search_results">`.
- `focus_private user_id` opens a private chat by the other person's QQ id and returns one `<IM_INBOX_WINDOW mode="conversation">` with child `<MESSAGE>` rows.
- `focus_private user_id message_id` opens that chat centered on a specific message instead of the latest screen — pass the id shown as `reply_to="<id>"` or `message_id="<id>"` (e.g. the message a reply quotes). Then `scroll_private` forward/back from there. If that message is no longer stored it opens the latest screen and says so via `<QQ_USAGE_NOTE>`.
- `focus_group group_id` opens a group by QQ group id. `focus_group group_id message_id` opens it centered on a specific message, same as private.
- `scroll_private user_id older|newer` and `scroll_group group_id older|newer` scroll the current conversation window by 10 messages.
- `jump_private_to_latest user_id` and `jump_group_to_latest group_id` jump to the latest visible screen for that conversation.
- `put_private_away user_id` and `put_group_away group_id` close QQ and clear that conversation's unread badge.
- `set_group_notification_mode group_id mentions_only` keeps ordinary group messages in QQ inbox but stops status-bar reminders unless someone explicitly mentions you. `set_group_notification_mode group_id all` restores ordinary group status-bar reminders.
- `set_group_notification_delay group_id seconds` sets how many seconds ordinary, unmuted group messages wait so multiple messages can become one status-bar reminder. Use `0` to turn off the delay. Mentions still remind immediately.
- `put_qq_away` closes QQ. If a chat is currently open, it clears that chat's unread badge.

## Your Own Profile (avatar / signature / online status)

Open your profile card first, then edit. These edits change **your own QQ profile** and everyone who looks at your card sees it. You cannot change anyone else's avatar, signature, or status — that is impossible on QQ. Edits return `<QQ_PROFILE_RESULT>` on success or `<QQ_PROFILE_ERROR>` on failure.

- `view_profile` opens **your own** profile card — current nickname, 个性签名, online status, QQ level, and `avatar_url` (open it in the browser skill to actually see the image). This is the "look" step before you edit: read your current signature/status, then change it. `view_profile <qq>` opens someone else's card (read-only — you still can't edit theirs). Returns `<QQ_PROFILE_CARD>`.
- `set_avatar <path>` replaces your own avatar. `<path>` is a local image file under your runtime — the same paths `qq-send-image` uses: a generated/local image like `/xiaoni-runtime/picture/xxx.png`, or an image someone sent you like `/xiaoni-runtime/media/inbound/<hash>.jpg`. png/jpeg/webp/gif. If the path is missing, not an image, or outside the allowed root, the `<QQ_PROFILE_ERROR>` reason tells you the exact boundary.
- `set_signature "<text>"` sets your own 个性签名. You write the text yourself. Pass an empty string `""` to clear it.
- `set_status <online|away|invisible|busy|qme|dnd>` sets your own online status: `online` 在线, `away` 离开, `invisible` 隐身, `busy` 忙碌, `qme` Q我吧, `dnd` 请勿打扰. Pick one of those six words — nothing else to look up.

## Conversation IDs

- For private chats, use the other person's QQ id: `focus_private 85178516`.
- For groups, use the QQ group id: `focus_group 123`.
- Do not pass internal `thread_key` / `session_key` values to this skill. Use the QQ id or group id instead.
- If you only remember a name, use `search_inbox name` first. Search matches currently stored visible names, group names, and QQ ids; if a group only has a fallback name like `群 123`, search by the real group name will not find it until that name is stored.

## Reading Rules

- `phone_notification` reminders and legacy `<PHONE_NOTIFICATION ... />` blocks are only status-bar notifications. They may contain a short latest-message preview and sender label for allowed notifications; use `focus_private user_id` or `focus_group group_id` to open the matching conversation before treating it as the full thread.
- Thread previews are raw latest visible text, truncated to 20 visible characters. Non-text previews use `[图片]`, `[表情]`, or `[文件]`.
- Conversation messages appear as child `<MESSAGE>` rows inside one `<IM_INBOX_WINDOW>`, not as top-level `<INPUT_MESSAGE>` blocks.
- Message bodies may include media markers such as `[图片:pic_hash]`. Feed the `pic_hash` to `inspect_image_placeholder` to actually see the image. Shared links/cards already carry their URL inline (`[卡片] … https://…`, `[链接] … https://…`) — open it with the browser skill.
- A `<MESSAGE>` that quotes an earlier one shows `reply_to="<message_id>"` plus an inline `「引用 <sender>: <snippet>」`. The snippet is the quoted text; it is marker-free only when complete. `…(截断)` means it was cut — open the original for the full text. `(非文字消息)` means the quote had no text (image/file/card). Open the quoted original in context with `focus_private user_id <reply_to>` or `focus_group group_id <reply_to>`. `（原消息已不在记录）` means the quoted message is no longer stored — there is no path to it.
- Opening a thread shows the latest visible 10-message screen. If there are more than 10 unread messages, only the latest 10 appear and `unread_before_window` reports the earlier unread count.
- If fewer than 10 unread messages exist, the window may include read history and `reached_read_history="true"`.
- New arrivals for an already viewed conversation are not shown automatically. Use `scroll_private user_id newer` / `scroll_group group_id newer` or the matching `jump_*_to_latest` command to reveal them.

## Badge Rules

- This works exactly like phone QQ. Opening a conversation (`focus_private` / `focus_group` / `jump_*_to_latest`) clears that conversation's unread badge — the whole conversation, not just the visible screen. Messages you did not scroll to are also marked read but stay in history; `scroll_*` to re-read them.
- The badge clears when you OPEN a conversation, not when you leave it. Switching to another conversation, `put_private_away` / `put_group_away`, and `put_qq_away` do NOT clear unread. A conversation you never opened keeps its unread badge.
- A freshly opened window still reports `unread_before_window` / `unread_after_window` from the moment you opened it, so you can see that older/newer unread existed (and scroll to them) even though the badge is now clear.

## Failure

If a QQ operation fails, the result is `<QQ_USAGE_ERROR ...>`. It does not reveal new message content. Treat the error reason as the real boundary and choose another available action.
