# Xiaoni Fork And Image Task Engineering Plan

Status: implemented plan, 2026-06-14.

This note combines the core-memory compression fork fix plan and the image vision fork redesign plan. It also records the current image generation task review.

## Shared Runtime Contract

- Keep the workflow `tools` definition list stable. Do not dynamically remove tool schemas from the request.
- Runtime phase gating should narrow `tool_choice.allowed_tools.tools` when the base request already uses `allowed_tools`.
- Narrowing means inheriting the base `tool_choice` envelope and filtering only the allowed tool list. Keep the base mode unless the phase already has a stronger documented reason to change it.
- Do not let subflows execute visible delivery tools unless that subflow is explicitly a visible-delivery flow.

## Core Memory Compression Fork

### Incident

Failed run:

- `core_memory_compression_fork_runs.id=56`
- `fork_run_id=core-memory-fork:runtime_1781366735887_34612a7c:9d541f35`
- Started at `2026-06-14 00:05:37`
- Error: `compress_core_memory fork tried unsupported tool: send_in_private`

The previous run for the same window succeeded:

- `core_memory_compression_fork_runs.id=55`
- `fork_run_id=core-memory-fork:runtime_1781366656648_6ce7a621:f480eb79`

### Root Cause

The normal compression path is correct: the compression fork should allow only:

- `exec_command`
- `compress_core_memory`

The failed run did not enter that normal path. A pending compression state leaked into the main-loop budget plan:

1. `pendingCoreMemoryCompression` made `buildContextBudgetPlan()` return `coreMemoryCompression` with `summarySourceInput = null`.
2. The scheduler then used `summarySourceInput ?? requestInput`.
3. Because `summarySourceInput` was null, it built a compression fork from ordinary main-agent input.
4. Ordinary input has no core-memory pressure marker, so the request inherited ordinary main-agent allowed tools.
5. The model called `send_in_private`; the compression fork runtime correctly rejected it before execution.

This was an engineering state-machine bug, not the main agent self-triggering compression.

### Fix Direction

1. Remove the `pendingCoreMemoryCompression` budget-plan branch.
   - The main agent should not care about compression pending/running state.
   - The main loop should read durable cutoff/summary and build its normal request.

2. Split main-loop budget planning from compression checkpoint planning.
   - `buildContextBudgetPlan()` only builds the main request from durable read cutoff and append-only history.
   - `buildCoreMemoryCompressionCheckpoint()` owns planned cutoff, pressure reminder, and `summarySourceInput`.
   - A compression fork is scheduled only from the checkpoint's `summarySourceInput`; there is no `summarySourceInput ?? requestInput` fallback.

3. Keep compression fork `tools` equal to the stable workflow tools list.
   - Do not cut the tool schema.
   - Do narrow `tool_choice.allowed_tools.tools` to `exec_command` and `compress_core_memory`.

4. Keep main-loop checkpoints serial, but model requests parallel.
   - The main loop may synchronously read durable cutoff, build a compression checkpoint, and enqueue/start the fork.
   - The compression fork provider request runs in the background; the main agent provider request must continue immediately and must not await compression completion.

5. Treat `core_memory_compression_fork_runs` as audit/observability, not proof of a live provider request.
   - The in-memory `coreMemoryCompressionForks` map dedupes only same-process duplicate starts.
   - After service restart, a persisted `running` row does not prove that the provider request is still alive, so the main loop must not use it as active state.
   - A future owner/heartbeat/lease can add cross-process claim semantics, but that is outside this fix.

6. Keep the main-loop request window append-only on every frame.
   - The main loop always reads `listRecentTurns(afterConversationId=durableReadCutoff)` without the sliding `limit=201`.
   - `buildContextBudgetPlan()` never recomputes a planned cutoff and never emits compression artifacts.
   - Planned cutoff exists only in the compression checkpoint/fork metadata until `compress_core_memory` succeeds and the durable cutoff is committed.
   - This prevents provider prefix-cache churn and prevents unsummarized history from disappearing before the fork commits.

7. Guard commit against late stale writers.
   - Commit `context_summary` and read cutoff through one persistence operation guarded by a session-level advisory lock.
   - Inside that locked operation, read the current durable cutoff and only write if the fork advances it.
   - If the current durable cutoff already covers the fork's commit cutoff, mark the fork result `superseded` and do not overwrite summary/cutoff.

No full transaction rollback of external side effects is required.

### Tests

- Main budget regression: `buildContextBudgetPlan()` keeps the full append-only history, does not emit pressure, and does not expose `compress_core_memory` in `allowed_tools`.
- Checkpoint regression: `buildCoreMemoryCompressionCheckpoint()` emits the pressure reminder and compression metadata; the fork request allows only `exec_command + compress_core_memory`.
- Runtime regression: a compression checkpoint starts the fork in the background while the main provider request runs immediately, and no compression artifact leaks into the main conversation.
- Query regression: runtime history reads use durable `afterConversationId` without `limit=201`.
- Dedup regression: the scheduler dedupes only an in-process running fork.
- Late writer regression: an older fork finishing after a newer durable cutoff is marked superseded/no-op and does not overwrite summary/cutoff; the production commit path writes summary+cutoff atomically.

## Image Vision Fork

### Current Role

`inspect_image_placeholder` is a blocking tool. The main agent calls it when it needs to inspect an image. Engineering then starts an internal image vision fork that sees the image bytes and returns an observation to the main agent as the original tool result.

The image vision fork is not image generation. `request_image_task` is the image generation/editing tool.

### New Contract

The image vision fork should not trust provider final text as the image observation. It should require the model to use `exec_command` to write the image understanding into an engineering-specified file.

Request contract:

- Keep `tools` inherited from the main request.
- Inherit the main `tool_choice` envelope when it is `allowed_tools`.
- Narrow `tool_choice.allowed_tools.tools` to only `exec_command`.
- Append the existing image replay items:
  - assistant sentinel
  - synthetic `inspect_image_placeholder(image_id)`
  - synthetic `function_call_output` containing `input_image`
- Append a developer/system reminder that names the exact output file path and requires `exec_command` to write the image understanding into that file.
- If the fork emits a non-`exec_command` tool call, engineering must not execute that business tool. Instead, append a `function_call_output` for that exact call id, rendered from `docs/xiaoni_prompt/image_vision_unsupported_tool_output.md`. The legal `exec_command` path follows the normal main-agent tool handling shape.

The output path is generated by engineering and given to the model in the reminder. Use the image id as the Markdown file name so the observation is asset-oriented and reusable:

```text
/xiaoni-runtime/image-vision/observations/<image_id>.md
```

Example:

```text
/xiaoni-runtime/image-vision/observations/media_8b3e7cd3def2cbba01092357e17a3ae01fa9f3b99a7476ce.md
```

The model does not choose this path. Engineering computes it from the resolved `assetId`, renders it into the reminder, and later reads the same path to verify success.

The file is asset-scoped and reusable across repeated inspections. If the same image is inspected multiple times, engineering reads the existing Markdown file first and injects it into the fork with a reminder shaped like `这是之前你对这个图片的记录: {}`. The model should inspect the current image bytes again, then append, revise, or correct the file instead of treating it as a disposable one-shot output.

### Template Files

Keep prompt-facing reminders outside code so they can be tuned:

```text
docs/xiaoni_prompt/image_vision_write_description_reminder.md
docs/xiaoni_prompt/image_vision_existing_observation_reminder.md
docs/xiaoni_prompt/image_vision_retry_missing_file_reminder.md
docs/xiaoni_prompt/image_vision_failed_after_retries_reminder.md
docs/xiaoni_prompt/image_vision_unsupported_tool_output.md
```

### Loop Behavior

Reuse the mature compression-fork loop shape:

1. Call provider `/api/internal/llm/debug` with execution mode `image_vision_fork`.
2. Parse outputs through `responseActionRouter.route()`.
3. If the model calls `exec_command`, execute it and append the tool result back into the fork input.
4. Do not treat `exec_command` completion as success. The command may be a read, probe, or partial write.
5. When the model returns `final_answer`, engineering checks the target Markdown file.
6. If the file exists and has non-empty content, trim it and use it as the image description. If the file already existed before this inspection, engineering injects the old content before the model call, and the prompt asks the model to append/revise/correct it based on the current image.
7. If the model returns `final_answer` but the file is missing or empty, append a retry reminder that says the final answer arrived before a usable file was written.
8. If the model calls a non-`exec_command` tool, do not execute it; append a corrective `function_call_output` for that call id, then append a retry reminder unless the same response already reached `final_answer`.
9. Retry up to 10 times.
10. After 10 failures, complete the fork as failed and return a recoverable `inspect_image_placeholder` result to the main agent saying the image was not recognized this time.

The success criterion is only the file content: the Markdown file must exist and be non-empty after `trim()`. Do not trust provider `response`, and do not trust `final_answer` as content. `final_answer` is only the signal that engineering should validate the file now.

### Tests

- Success after `exec_command` plus `final_answer`: file contains description, observation uses file content.
- `final_answer` without a non-empty file: retry reminder appended.
- Wrong tool: tool is not executed, corrective `function_call_output` is appended, and the fork can retry.
- `exec_command` without `final_answer`: tool result is appended, but it is not accepted as success.
- Ten failed attempts: main agent receives a recoverable failed-inspection result.
- Contract: `tools` equals the main request tools; `tool_choice.allowed_tools.tools` contains only `exec_command`.
- Template files are loaded and their rendered paths appear in fork input.

## Image Generation Task Review

`request_image_task` is not an LLM fork. It is a main-agent tool that creates a durable runtime task and immediately returns pending status.

Current flow:

1. Main agent calls `request_image_task`.
2. `agent-service` creates a runtime task with type `image_generate` or `image_edit`.
3. The main loop gets a pending tool result with `completion_signal = image_task_notification`.
4. The task worker runs the image provider asynchronously.
5. On completion, the worker stores the picture in `xiaoni-executor`, registers it as a media asset, and enqueues an `image_task_notification`.
6. The main loop later receives that notification and decides what to do.

Reviewed code:

- `requestImageTask()` in `modules/agent-service/src/services/agent-loop-service.ts`
- image task worker completion notification in `modules/agent-service/src/services/agent-task-worker-service.ts`
- image provider usage recording in `modules/provider-service/src/index.ts`

Verdict:

- No same-class fork/tool-choice inheritance issue was found in image generation.
- The image task path does not clone a main canonical LLM request and rerun it as a fork.
- The main risk here is not tool-choice leakage; it is task lifecycle correctness: pending result must not be treated as an artifact, completion must come through `image_task_notification`, and generated image bytes/path must stay out of prompt-facing reminders except for the safe picture id/path notification.

Existing tests already cover important behavior:

- `requestImageTask` normalizes edit-without-source to generate.
- `requestImageTask` keeps edit when source media resolves.
- Runtime frame does not auto-send image task status after queueing.
- Same-slice visible reply is not swallowed by `request_image_task`.

Optional follow-up tests:

- Duplicate image task completion notification does not cause duplicate visible delivery.
- Failed image provider task creates a recoverable notification instead of leaving the task silently pending.
- Image task notification never includes raw bytes/data URL in prompt-facing text.
