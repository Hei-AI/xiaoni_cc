import assert from 'node:assert/strict';
import test from 'node:test';

import { renderRecoverEnergyRejectedReminder, renderClockPingReminderText } from '../services/agent-loop-service';
import { formatEast8Duration, renderWakeAnchorSentence } from '../services/east8-time';

// Regression for the 2026-07-28 "连续干活一天半" incident. In the stretch she described as
// "连续清醒约十五小时" she had actually slept 4 times (486 minutes total), and the reject
// reminder fired ~40 times against those 4 wakes. Reading her own stack the sleeps were
// invisible, so every rejection reinforced "身体不让我睡" and the elapsed-time belief drifted
// unchecked. The reject reminder now carries the last real wake plus the distance to it.

const REJECT_REASON = '现在还没到可以休息的线：刚醒不久、身体还撑得住的时候，很难再次入睡。';

test('reject reminder anchors to the last real wake and states the gap', () => {
  // 2026-07-28 09:00:39 +08 wake, rejection at 10:03:11 +08 — the exact live pair that produced
  // the "一天半" claim. Truth is 1 小时 3 分钟.
  const lastWakeAt = new Date('2026-07-28T01:00:39.000Z').toISOString();
  const now = new Date('2026-07-28T02:03:11.000Z');

  const reminder = renderRecoverEnergyRejectedReminder({ reason: REJECT_REASON, lastWakeAt, now });

  assert.match(reminder, /现在是 2026-07-28 10:03:11（东八区）。/);
  assert.match(reminder, /你上一次睡醒是 2026-07-28 09:00:39，到现在过去了 1 小时 3 分钟。/);
  // The rejection prose itself must survive — the anchor is added, not swapped in.
  assert.match(reminder, /【睡不着】/);
  assert.ok(reminder.includes(REJECT_REASON));
});

test('reject reminder degrades cleanly when no wake has been recorded yet', () => {
  const now = new Date('2026-07-28T02:03:11.000Z');

  const reminder = renderRecoverEnergyRejectedReminder({
    reason: REJECT_REASON,
    lastWakeAt: null,
    now
  });

  assert.match(reminder, /现在是 2026-07-28 10:03:11（东八区）。/);
  assert.ok(!reminder.includes('你上一次睡醒是'));
  // No dangling whitespace where the anchor sentence would have gone.
  assert.ok(!/[ \t]$/m.test(reminder), 'reminder must not carry trailing whitespace on any line');
});

test('reject reminder is a pure function of its inputs (replay renders byte-identical)', () => {
  const lastWakeAt = new Date('2026-07-28T01:00:39.000Z').toISOString();
  const now = new Date('2026-07-28T02:03:11.000Z');
  const first = renderRecoverEnergyRejectedReminder({ reason: REJECT_REASON, lastWakeAt, now });
  const second = renderRecoverEnergyRejectedReminder({ reason: REJECT_REASON, lastWakeAt, now });
  assert.equal(first, second);
});

test('两个surface共用同一句锚点 —— 措辞不许漂移', () => {
  // 以前拒绝提醒说「才过去」、报时说「过去了」,同一件事两个说法。她会在自己的日记里
  // 读到不一致的口径,而这套东西正是为了统一时间口径建的。现在两处都走同一个纯函数。
  const now = new Date('2026-07-28T02:03:11.000Z');
  const lastWakeAt = new Date('2026-07-28T01:00:39.000Z').toISOString();
  const sentence = renderWakeAnchorSentence(lastWakeAt, now);

  assert.ok(sentence.length > 0);
  assert.ok(
    renderRecoverEnergyRejectedReminder({ reason: REJECT_REASON, lastWakeAt, now }).includes(sentence),
    '拒绝提醒必须用共用函数产出的那一句'
  );
  assert.ok(
    renderClockPingReminderText(now, lastWakeAt).includes(sentence),
    '时钟推送必须用同一句'
  );
});

test('共用锚点函数在无醒来记录时返回空串', () => {
  assert.equal(renderWakeAnchorSentence(null, new Date()), '');
  assert.equal(renderWakeAnchorSentence('not-a-date', new Date()), '');
});

test('duration formatter reads the way she would say it', () => {
  const base = Date.UTC(2026, 6, 28, 0, 0, 0);
  assert.equal(formatEast8Duration(base, base + 47 * 60_000), '47 分钟');
  assert.equal(formatEast8Duration(base, base + 60 * 60_000), '1 小时');
  assert.equal(formatEast8Duration(base, base + 63 * 60_000), '1 小时 3 分钟');
  assert.equal(formatEast8Duration(base, base + 276 * 60_000), '4 小时 36 分钟');
  // Clock skew must never render a negative gap.
  assert.equal(formatEast8Duration(base, base - 60_000), '0 分钟');
});
