import assert from 'node:assert/strict';
import test from 'node:test';

import { clockPingSlotId, isClockPingPayload, renderClockPingReminderText } from '../services/agent-loop-service';

// The live half of the 2026-07-28 "连续干活一天半" fix. <xiaoni_status> is frozen between
// compressions and the reject reminder only fires when she tries to sleep, so this is the one
// unconditional channel: every interval she is handed the current time and the distance from her
// last real wake. Two properties carry the whole leg — slot idempotency (so it self-heals instead
// of drifting) and NOT being a phone_notification (so it can never force-wake her).

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

test('slot id is stable inside an interval and advances across the boundary', () => {
  // 2026-07-28 09:00 / 09:59 / 10:00 East-8.
  const at0900 = new Date('2026-07-28T01:00:00.000Z');
  const at0959 = new Date('2026-07-28T01:59:59.000Z');
  const at1000 = new Date('2026-07-28T02:00:00.000Z');

  const slot0900 = clockPingSlotId(at0900, TWO_HOURS_MS);
  assert.equal(clockPingSlotId(at0959, TWO_HOURS_MS), slot0900, '同一格内必须同一个 slot（重复 tick 被 dedupe 吞掉）');
  assert.notEqual(clockPingSlotId(at1000, TWO_HOURS_MS), slot0900, '跨格必须换 slot');
});

test('slot boundaries land on even East-8 clock hours', () => {
  // A 2h slot must break at 08:00/10:00/12:00 East-8, not at an arbitrary offset — otherwise the
  // ping reads as a random interruption rather than "看了一眼钟".
  const boundary = new Date('2026-07-28T02:00:00.000Z'); // 10:00 +08
  const justBefore = new Date('2026-07-28T01:59:59.999Z');
  assert.notEqual(clockPingSlotId(boundary, TWO_HOURS_MS), clockPingSlotId(justBefore, TWO_HOURS_MS));
});

test('missed slots do not accumulate a backlog — each instant maps to exactly one slot', () => {
  // Restart / downtime must not replay every skipped slot. Slot is a pure function of the instant,
  // so a gap simply skips those ids; nothing queues up.
  const slots = new Set<string>();
  for (let hour = 0; hour < 24; hour += 1) {
    slots.add(clockPingSlotId(new Date(Date.UTC(2026, 6, 28, hour, 30)), TWO_HOURS_MS));
  }
  assert.equal(slots.size, 12, '一天 24 小时按 2h 分格应恰好 12 格');
});

test('reminder carries both the current time and the gap since the last real wake', () => {
  const now = new Date('2026-07-28T02:03:11.000Z'); // 10:03:11 +08
  const lastWakeAt = new Date('2026-07-28T01:00:39.000Z').toISOString(); // 09:00:39 +08

  const text = renderClockPingReminderText(now, lastWakeAt);

  assert.match(text, /现在是 2026-07-28 10:03:11（东八区）。/);
  assert.match(text, /你上一次睡醒是 2026-07-28 09:00:39，到现在过去了 1 小时 3 分钟。/);
  // It reads as a system readout, not as a task — she already over-accounts without prompting.
  assert.match(text, /^系统报时: /);
});

test('reminder is raw body — the <system_reminder> wrapper is added at consume time', () => {
  // renderSystemReminder → formatSystemReminderBlock wraps this text and HTML-escapes its body.
  // A tag written into the template therefore reaches her as literal &lt;system_reminder&gt;
  // nested inside the real one. The template must stay tag-free.
  const text = renderClockPingReminderText(new Date('2026-07-28T02:03:11.000Z'), null);
  assert.ok(!text.includes('<'), '模板正文不能自带标签——包裹由消费端做');
  assert.ok(!text.includes('>'), '模板正文不能自带标签——包裹由消费端做');
});

test('reminder degrades cleanly with no recorded wake', () => {
  const now = new Date('2026-07-28T02:03:11.000Z');
  const text = renderClockPingReminderText(now, null);
  assert.match(text, /现在是 2026-07-28 10:03:11（东八区）。/);
  assert.ok(!text.includes('你上一次睡醒是'));
  assert.ok(!/[ \t]$/m.test(text), 'no trailing whitespace where the anchor would have gone');
});

test('reminder is a pure function of its inputs (replay renders byte-identical)', () => {
  const now = new Date('2026-07-28T02:03:11.000Z');
  const lastWakeAt = new Date('2026-07-28T01:00:39.000Z').toISOString();
  assert.equal(
    renderClockPingReminderText(now, lastWakeAt),
    renderClockPingReminderText(now, lastWakeAt)
  );
});

// 空转记账的识别门。报时是引擎自发的报时回合,不是一次执行 plan 的机会——它既不该洗账
// 也不该记账。IDLE_ESCALATION_AFTER_ROUNDS=2,不设门的话连看两眼钟就会被加压。
const clockPingPayload = (overrides: Record<string, unknown> = {}) => ({
  source: 'system_reminder',
  systemReminder: { reason: 'clock_ping' },
  rawPayload: { reason: 'clock_ping' },
  ...overrides
}) as never;

test('报时 payload 被认出来', () => {
  assert.equal(isClockPingPayload(clockPingPayload()), true);
});

test('别的 system_reminder 不会被误认成报时', () => {
  assert.equal(isClockPingPayload(clockPingPayload({
    systemReminder: { reason: 'core_memory_compression_done' },
    rawPayload: { reason: 'core_memory_compression_done' }
  })), false);
  assert.equal(isClockPingPayload(clockPingPayload({
    systemReminder: { reason: 'subconscious_agent' },
    rawPayload: { reason: 'subconscious_agent', notify_template: 'subconscious_agent_notify.md' }
  })), false);
});

test('QQ 消息(phone_notification)不会被误认成报时', () => {
  // 关键:真实外部消息必须照常记账,否则一条报时就能把真空转洗白。
  assert.equal(isClockPingPayload({
    source: 'phone_notification',
    rawPayload: { reason: 'clock_ping' }
  } as never), false);
});

test('a full day of pings would have contradicted the incident claim', () => {
  // Ground truth: she woke 09:00:39 and at 10:03 claimed "一天半". The 10:00 ping states the gap
  // outright — the wrong belief cannot survive one interval.
  const lastWakeAt = new Date('2026-07-28T01:00:39.000Z').toISOString();
  const text = renderClockPingReminderText(new Date('2026-07-28T02:00:00.000Z'), lastWakeAt);
  assert.match(text, /过去了 59 分钟。/);
  assert.ok(!text.includes('一天'), 'ping 只陈述真实间隔,绝不给出天级跨度');
});
