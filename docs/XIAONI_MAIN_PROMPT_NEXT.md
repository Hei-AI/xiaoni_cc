# Xiaoni Main Prompt

Status: runtime loads prompt files from `docs/xiaoni_prompt/`.

The Xiaoni main system prompt is no longer mirrored into TypeScript source.
Edit the prompt files directly:

- `docs/xiaoni_prompt/system_prompt.md`: main system prompt.
- `docs/xiaoni_prompt/skills_instructions.md`: head developer skills block.
- `docs/xiaoni_prompt/self_continuation_reminder.md`: self-continuation runtime reminder body.
- `docs/xiaoni_prompt/phone_notification_reminder.md`: QQ unread notification reminder template.
- `docs/xiaoni_prompt/image_task_notification.md`: image task completion reminder template.
- `docs/xiaoni_prompt/image_task_pending.md`: image task pending reminder template used before the artifact path/id exists.
- `docs/xiaoni_prompt/attention_lease_reminder.md`: short-lived QQ attention reminder template.
- `docs/xiaoni_prompt/core_memory_compression_fork_forced_reminder.md`: compression fork forced reminder once the fork exhausts its organizing turn budget without writing xiaoni_status.
- `docs/xiaoni_prompt/runtime_state.md`: body template for prompt-facing energy state.
- `docs/xiaoni_prompt/skills_instructions.md`: developer block that tells Xiaoni how to find local skills.
- `docs/xiaoni_prompt/system_reminder_fallback.md`: fallback body for empty system reminders.
- `docs/xiaoni_prompt/core_memory_pressure_reminder.md`: core-memory pressure reminder body.
- `docs/xiaoni_prompt/recover_energy_completed_reminder.md`: recover_energy natural wake callback body.
- `docs/xiaoni_prompt/recover_energy_interrupted_reminder.md`: recover_energy private/group mention wake callback body.
- `docs/xiaoni_prompt/recover_energy_clock_reminder.md`: recover_energy clock wake callback body.
- `docs/xiaoni_prompt/recover_energy_clock_deferred_reminder.md`: recover_energy deferred clock wake callback body.
- `docs/xiaoni_prompt/recover_energy_forced_completed_reminder.md`: forced/runtime recovery completion reminder.
- `docs/xiaoni_prompt/recover_energy_batch_final_timeline.md`: optional wake callback timeline when recover_energy is executed after earlier tools in the same batch.
- `docs/xiaoni_prompt/recover_energy_rejected_reminder.md`: recover_energy rejection callback body.

The agent-service loader checks file `mtime` and size before each read. The main
Xiaoni runtime resolves the stable system prompt once at bootstrap, then
`index.ts` passes `shouldReloadRuntimePrompt` into `AgentLoopService.runRuntimeLoop()`.
When prompt files change, the next loop boundary invalidates the stable prompt and
the following model slice rereads it. Runtime reminder templates are read when
the corresponding reminder is appended, unless a caller explicitly caches that
template.
