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
- `clock`：可选，正整数分钟数，范围 `5..120`。含义是“几分钟后尝试叫醒我继续做事”，不是睡眠时长，也不是夜间 8 小时完整睡眠的闹铃。

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
full_recovery_minutes = 480
```

`full_recovery_minutes` 是小腻数字躯体完整恢复到满值的周期。单次 session 还有昼夜节律上限：夜间可睡到完整 8 小时或夜间窗口结束；白天按 nap 处理，通常最多 90 分钟。只有达到完整 8 小时才是 `hard_cap` 满血醒；白天 nap cap 或昼夜节律推醒时，按当前曲线值结算精力，不提前满血。

## Recovery Curve

睡眠时压力按指数曲线下降，但曲线以小腻的完整数字睡眠周期 `T = 480min` 作为终点边界。也就是说，公式仍然控制 `0 <= t < T` 的恢复形状；到达 `T` 时视为完整睡眠周期结束，精力结算到满值。白天短睡的 session cap 不改变 `T`，只会让小腻提前按当前曲线值醒来。

```text
raw_sleep(t) = p_floor + (p_start - p_floor) * exp(-sleep_minutes / tau_sleep_minutes)
raw_sleep(T) = p_floor + (p_start - p_floor) * exp(-T / tau_sleep_minutes)

if sleep_minutes >= T:
  p_after(t) = 0
else:
  p_after(t) = p_start * (raw_sleep(t) - raw_sleep(T)) / (p_start - raw_sleep(T))

energy_after(t) = max_energy * (1 - p_after(t))
```

这个终点归一化保证：

- `t = 0` 时压力仍为 `p_start`。
- `0 < t < 480` 时仍是指数恢复曲线，不是线性恢复。
- `t >= 480` 时 `pressure = 0`、`energy = max_energy`，符合夜间完整睡眠 8 小时满恢复的身体设定。
- 私聊、群 @ 或 clock 提前唤醒时，按当前 `sleep_minutes` 的曲线值结算精力，不提前满血。
- 白天 nap cap 或昼夜节律推醒也按当前 `sleep_minutes` 的曲线值结算精力，不提前满血。

默认参数：

```text
p_floor = 0.05
tau_sleep_minutes = 252      // paper-scale 4.2h sleep tau
p_natural_wake = 0.12       // energy ~= 0.88
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
tau_wake_minutes = 1092     // paper-scale 18.2h wake tau
```

## Circadian Process C

runtime 使用上海时间的 24 小时昼夜振荡器调制睡眠：

```text
sleep_drive = cos(2π * (local_minutes - 05:00) / 1440)
night_window = 01:00..09:00 Asia/Shanghai
daytime_nap_max_recovery_minutes = 90
circadian_wake_tau_amplitude = 0.35
```

- `sleep_drive` 越高，越容易入睡、越不容易自然醒；`05:00` 附近睡眠促进最强。
- `sleep_drive` 越高，清醒状态下的有效 `tau_wake_minutes` 越小，压力上升越快；夜里硬撑会更快变困。
- `sleep_drive` 越低，越不容易入睡、越容易被昼夜节律推醒；`17:00` 附近清醒促进最强，清醒压力上升更慢。
- 夜间 session 的最晚上限是 `min(480min, 到 09:00 的剩余分钟数)`。
- 夜间无 `clock` 的自然睡眠不会因为压力提前低于 `p_natural_wake` 就醒；它以夜间窗口结束或完整 8 小时作为预定醒点。
- 夜间自然睡眠的外界唤醒阈值按睡眠阶段呈 U 型：刚入睡和快到预定醒点时较容易叫醒，中段最难叫醒。
- 白天 session 的最晚上限是 `90min`，wake cause 为 `daytime_nap_cap`，不满血。
- 每个 `agent_recovery_sessions` row 在 `metadata.recovery_policy_snapshot` 写入创建时的 Process S / Process C 参数；已存在且无 snapshot 的旧 session 按 2 小时旧规则结算，避免部署时延长正在进行的睡眠。

清醒疲劳必须接入 `agent_life_states.projection_json` 的 life reducer，而不是只在 `recover_energy` 会话内计算。主 runtime 的 `<STATE>`、`recover_energy` 接受门槛、强制休息判断和 presence 恢复判断都必须读同一个投影。

内部投影应拆分：

```text
pressure = homeostatic_pressure + action_debt
energy = 1 - pressure
```

- `homeostatic_pressure`：按清醒时间自然上升，按睡眠恢复曲线下降。
- `action_debt`：说话、搜索、阅读、处理消息等行动造成的额外透支。
- `action_debt` 随清醒时间按指数曲线缓慢恢复，避免短时间高频 QQ 读写被永久线性累加成过度疲劳。
- prompt-facing `<STATE>` 仍只显示 `energy/max_energy`，不暴露 pressure、homeostatic_pressure 或 action_debt。

默认行动债恢复参数：

```text
tau_action_debt_recovery_minutes = 360
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
tau_rest_cooldown_minutes = 180
```

Process C 会进一步调整门槛：夜间降低 `p_required_to_start_sleep`，白天提高它。

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
else if night natural sleep:
  progress = elapsed_minutes / session_max_recovery_minutes
  sleep_stage_depth = sin(pi * progress)^0.75
  pressure_depth = clamp(pressure_after(t), 0, 1)^gamma
  required_calls = ceil(N_min + N_span * (0.75 * sleep_stage_depth + 0.25 * pressure_depth))
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
if elapsed_minutes >= full_recovery_minutes:
  energy_after = max_energy
  pressure_after = 0
  wake_cause = hard_cap
else if elapsed_minutes >= session_max_recovery_minutes:
  wake_cause = daytime_nap_cap or circadian_wake
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
  ├─ full 8h recovery reached -> hard_cap
  ├─ daytime nap cap reached -> daytime_nap_cap
  ├─ night window ends before full recovery -> circadian_wake
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
       optionally run no-persist cache heartbeat
       sleep and retry
  3. if session settled:
       run next model frame from appended callback/reminder
  4. otherwise:
       normal Notify Bucket claim
```

唤醒计数只读扫描 `agent_queue_messages`：

cache heartbeat 只用于睡眠中的 provider prompt-cache 保温。它用 no-notify 主请求前缀追加
developer `Heartbeat`，通过 `/api/internal/llm/debug` 发送
`cache_heartbeat_no_persist`，并设置 `store:false` / canonical `max_output_tokens:1`。
当前 Codex backend 会拒绝 wire `max_output_tokens`，所以 Codex provider 实际只发送
developer heartbeat 约束。heartbeat 不认领 Notify Bucket，不把任何 QQ 未读写入上下文，
不写主 stack，也不消耗模型返回内容。
`agent_runtime_control.cache_heartbeat_paused=true` 时，睡眠期间自动 heartbeat 不会 claim
recovery session schedule，也不会请求 provider；这只暂停自动保温，不影响手动验证入口。
heartbeat 续约状态持久化在 active `agent_recovery_sessions.metadata.cache_heartbeat` 中：
每次 due 时先 claim，同一 session 只允许一个 in-flight heartbeat；成功后写入下一次
`next_due_at = started_at + 5min`，失败时短间隔重试。agent-service 意外重启后，只要
recovery session 仍是 active，下一轮 reconcile 会继续按该持久化 schedule 续约；session
正常或提前醒来后，工程清掉 `next_due_at` 和 in-flight 标记，后续不会再发 planned heartbeat。
需要本机验证时，走 agent-service 的一次性 internal 入口：

```bash
curl -sS -X POST http://127.0.0.1:8092/api/internal/runtime/cache-heartbeat
```

这个入口复用同一套 heartbeat fork，绕过 5 分钟自动调度间隔，只返回 provider usage 摘要。
即使 runtime control 暂停了自动 heartbeat，这个手动入口仍可用于本机排障。

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
