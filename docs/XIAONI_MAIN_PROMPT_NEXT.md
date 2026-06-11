# Xiaoni Main Prompt

Status: runtime loads prompt files from `docs/xiaoni_prompt/`.

The Xiaoni main system prompt is no longer mirrored into TypeScript source.
Edit the prompt files directly:

- `docs/xiaoni_prompt/system_prompt.md`: main system prompt.
- `docs/xiaoni_prompt/skills_instructions.md`: head developer skills block.
- `docs/xiaoni_prompt/self_continuation_reminder.md`: self-continuation runtime reminder body.
- `docs/xiaoni_prompt/phone_notification_reminder.md`: QQ unread notification reminder template.
- `docs/xiaoni_prompt/image_task_notification.md`: image task completion reminder template.
- `docs/xiaoni_prompt/system_reminder_fallback.md`: fallback body for empty system reminders.
- `docs/xiaoni_prompt/core_memory_pressure_reminder.md`: core-memory pressure reminder body.

The agent-service loader checks file `mtime` and size before each read, so edited
files are reloaded without changing code. The stable system prompt and head
developer context are assembled once for a single `processQueueMessage()` run;
mid-run continuous slices keep appending to that request. Edits to stable prompt
files take effect on the next queue message, while runtime reminder templates
take effect when that template is next appended.
