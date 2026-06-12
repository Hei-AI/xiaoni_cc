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
- `docs/xiaoni_prompt/recover_energy_completed_reminder.md`: recover_energy success callback body.
- `docs/xiaoni_prompt/recover_energy_rejected_reminder.md`: recover_energy rejection callback body.

The agent-service loader checks file `mtime` and size before each read, but the
main Xiaoni runtime intentionally resolves the stable system prompt once per
`AgentLoopService` process lifetime, from `runtime_bootstrap` before the main
runtime `while` starts. Prompt file edits therefore take effect after the
agent-service process is restarted. Runtime reminder templates are read when the
corresponding reminder is appended, unless a caller explicitly caches that
template.
