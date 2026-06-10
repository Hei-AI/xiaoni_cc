# Xiaoni Runtime State Diagram

这份文档只记录当前运行态，不记录历史方案。
入口事实仍以 `README.md`、`docs/START_HERE.md` 和活跃代码为准。

## Current Loop

```text
agent-service
  |
  v
while service is running and runtime control is enabled
  |
  +--> claim pending agent_queue_messages
  |      |
  |      +--> QQ / image / recovery sensory event
  |      |      |
  |      |      v
  |      |   processQueueMessage()
  |      |
  |      +--> append model response, tool result, state, memory
  |             into xiaoni:global runtime stream
  |
  +--> if no queue item:
         |
         +--> if recover_energy window is active
         |      |
         |      v
         |   wait until recovery window or idle interval
         |
         +--> if recovery window just ended
         |      |
         |      v
         |   enqueue self_continuation(reason=recovery_complete)
         |
         +--> otherwise
                |
                v
             enqueue self_continuation(reason=autonomous_runtime_slice)
```

## State Meaning

- `phone_notification` is sensory input from the phone status bar. It is not QQ message body.
- `phone_notification` is only enqueued when the chat policy allows auto reply. `auto_reply_enabled=false` still keeps the QQ body in inbox, but does not wake the main loop.
- `self_continuation` is an internal runtime slice. It is not a fake QQ message and not legacy `consciousness_tick` / `presence_tick`.
- `final_answer_idle` is a `system_reminder` queue item that is rendered as the next user scene input after a `final_answer` when the bucket is otherwise empty.
- `recover_energy` is the only prompt-facing rest tool. While a recovery window is active, the host does not create autonomous slices.
- `agent_queue_messages` is an engineering ingress queue. It is not Xiaoni's QQ unread list or cognitive boundary.
- `xiaoni:global` is the only prompt-facing history, context summary, read-cutoff, and prompt cache key for the main loop.

## Request Shape

```text
runtime input =
  system prompt
  developer capabilities / world context
  xiaoni:global retained history
  current sensory event or self_continuation reminder
  replayable model outputs and tool results
```

QQ body enters the request only after Xiaoni actively uses `$qq-usage` to open QQ.
