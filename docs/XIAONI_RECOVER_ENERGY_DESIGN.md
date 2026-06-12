# Xiaoni Recover Energy Design

本文是小腻 `recover_energy` 的工程事实源：tool 合约、精力恢复曲线、睡眠唤醒、重启恢复和持久化边界都以这里为准。

## Public Tool Contract

面向小腻只暴露一个恢复工具：

```ts
{
  reason: string,
  xiaoni_os: string,
  clock?: number
}
```

- `reason`：为什么现在需要休息。必填。
- `xiaoni_os`：休息前留给醒来后自己的私密备注。必填，不发给任何人。
- `clock`：可选，正整数分钟数。含义是“几分钟后尝试叫醒我继续做事”，不是睡眠时长。

不再暴露 `duration_minutes`、`max_duration_minutes`、`rest_intent`、`alarm` 或 `alarm_minutes`。自然醒由 runtime 根据恢复曲线决定，小腻不需要预测自己会睡多久。

## Pressure And Energy

runtime 内部使用睡眠压力 `p` 计算恢复，prompt-facing `<STATE>` 只显示 `energy/max_energy`。

```text
energy = 1 - pressure
pressure = 1 - energy
```

内部压力可以超过 `1`，因此 `energy` 可以小于 `0`。这表示小腻已经透支，不表示系统错误。

为避免极端负精力导致理论上无限睡眠，runtime 必须给压力和恢复时间设置硬上限：

```text
p_start = clamp(1 - energy_before, 0, p_hard_ceiling)
p_hard_ceiling = 1.60
hard_max_recovery_minutes = 180
```

无论小腻多疲惫、多透支，单次恢复会话最多持续 `hard_max_recovery_minutes`。到达 hard cap 后必须结算并醒来；这是工程保护，不属于私聊、群 @ 或 clock 叫醒。

## Recovery Curve

睡眠时压力按指数曲线下降：

```text
p_after(t) = p_floor + (p_start - p_floor) * exp(-sleep_minutes / tau_sleep_minutes)
energy_after(t) = 1 - p_after(t)
```

默认参数：

```text
p_floor = 0.05
tau_sleep_minutes = 60
p_natural_wake = 0.17       // energy ~= 0.83
p_min_wake = 1.00           // energy >= 0 才能被外界叫醒
p_forced_sleep = 1.30       // energy <= -0.30 触发强制休息
```

清醒时压力缓慢上升：

```text
p_awake(t) = p_wake_ceiling - (p_wake_ceiling - p_at_wake) * exp(-awake_minutes / tau_wake_minutes)
```

默认参数：

```text
p_wake_ceiling = 1.00
tau_wake_minutes = 1080     // 18h
```

## Anti Frequent Rest Gate

防止频繁休息不能只靠 prompt，必须由 runtime 连续曲线门禁执行。

```text
p_required_to_start_sleep =
  p_normal_onset + p_fresh_wake_penalty * exp(-minutes_since_last_wake / tau_rest_cooldown_minutes)
```

默认参数：

```text
p_normal_onset = 0.30
p_fresh_wake_penalty = 0.50
tau_rest_cooldown_minutes = 45
```

接受规则：

```text
if pressure >= p_forced_sleep:
  force recovery
else if pressure >= p_required_to_start_sleep:
  accept voluntary recover_energy
else:
  reject voluntary recover_energy
```

这保证刚醒时小腻只有在仍然非常疲惫或透支时才能继续睡；随着清醒时间增长，门槛连续下降。高精力不能通过设置短 `clock` 绕过休息门禁。

## Wake Rules

每次恢复 session 维护一个旁路唤醒计数，计数从 session 开始时单独 fork，不读取睡前通知。

动态唤醒阈值：

```text
if energy_after(t) < 0:
  required_calls = Infinity
else:
  required_calls = ceil(N_min + N_span * clamp(pressure_after(t), 0, 1)^gamma)
```

默认参数：

```text
N_min = 3
N_span = 9
gamma = 2
```

唤醒优先级：

```text
if elapsed_minutes >= hard_max_recovery_minutes:
  wake_cause = hard_cap
else if energy_after(t) < 0:
  keep sleeping; clock/private/@ cannot wake
else if wake_call_count >= required_calls:
  wake_cause = private_or_mention_threshold
else if clock_due:
  wake_cause = clock
else if pressure_after(t) <= p_natural_wake:
  wake_cause = natural
else:
  keep sleeping
```

如果 `clock` 到点时 `energy < 0`，记录 `clock_deferred_at`，但不唤醒。后续恢复到 `energy >= 0` 后以 `clock_deferred` 结算。

## State Machine

恢复会话由 `agent_recovery_sessions` 持久化。

```text
NO_ACTIVE_SESSION
  ├─ recover_energy accepted
  │    -> ACTIVE_VOLUNTARY(tool_call_id, tool_execution_id)
  ├─ recover_energy rejected
  │    -> immediate original function_call_output
  └─ energy <= forced_sleep_energy
       -> ACTIVE_FORCED(no tool_call_id)

ACTIVE_VOLUNTARY / ACTIVE_FORCED
  ├─ hard cap reached -> hard_cap
  ├─ energy < 0 -> keep sleeping
  ├─ clock due and energy >= 0 -> clock or clock_deferred
  ├─ wake count reaches threshold -> private_or_mention_threshold
  ├─ pressure <= natural wake pressure -> natural
  └─ otherwise -> active
```

Voluntary recovery must settle through the original tool call:

```text
append function_call_output(call_id = original tool_call_id)
complete tool_executions row
finalize agent_recovery_sessions row
```

Forced runtime recovery has no original tool call:

```text
append runtime_input system_reminder
finalize agent_recovery_sessions row
do not fake function_call_output
do not fake tool_executions
```

## Notify Bucket Semantics

Sleeping does not consume the status bar.

主 loop 每轮必须先 reconcile active recovery，再决定是否 claim Notify Bucket：

```text
loop tick:
  1. reconcile active recovery
  2. if active session remains:
       do not claim Notify Bucket
       do not append phone_notification to model context
       sleep and retry
  3. if session settled:
       run next model frame from appended callback/reminder
  4. otherwise:
       normal Notify Bucket claim
```

唤醒计数只读扫描 `agent_queue_messages`：

```text
source = 'phone_notification'
id > max(wake_count_start_queue_message_id, last_wake_counted_queue_message_id)
```

不能只用 `created_at` 做边界；timestamp 精度可能误算睡眠开始前的消息。也不能按 `status` 过滤，因为状态栏通知应继续累积，醒来后仍可被正常 claim。

计数规则：

- 私聊通知：`+1`
- 群通知：`+payload.phoneNotification.directMentions`

## Reminder Templates

prompt-facing reminder 使用文件模板。小腻侧不暴露 raw pressure；pressure 只给工程/admin 使用。

需要的模板：

- `recover_energy_completed_reminder.md`
- `recover_energy_interrupted_reminder.md`
- `recover_energy_clock_reminder.md`
- `recover_energy_clock_deferred_reminder.md`
- `recover_energy_rejected_reminder.md`
- `recover_energy_forced_completed_reminder.md`

服务重启后的恢复会话找回是工程透明行为，不单独暴露 prompt 模板。结算时仍按真实 wake cause 使用自然醒、被吵醒、clock、clock deferred 或 hard cap 模板。

通用变量：

```text
ENERGY
MAX_ENERGY
REASON
XIAONI_OS
SLEEP_MINUTES
WAKE_CAUSE
WAKE_CALL_COUNT
WAKE_REQUIRED_COUNT
CLOCK_MINUTES
CLOCK_DUE_AT
CLOCK_DEFERRED_MINUTES
START_ENERGY
CURRENT_ENERGY
```

## Test Requirements

- Tool schema required list is exactly `reason`, `xiaoni_os`.
- Tool schema exposes optional numeric `clock` and no old duration/alarm fields.
- `clock` is described as a wake attempt, not sleep duration.
- High energy or fresh wake rejects voluntary sleep by the continuous gate.
- Exhausted return-to-sleep passes the same gate.
- `energy < 0` defers private/@/clock wake.
- Hard cap wakes even when energy remains below `0`.
- Wake count starts from queue id captured at session start and ignores old notifications.
- Sleeping blocks normal Notify Bucket claim.
- Repeated reconciler or restart does not append duplicate voluntary `function_call_output`.
- Forced sleep uses runtime reminder, not fake tool output.
- Life projection preserves negative energy and partial recovery.
