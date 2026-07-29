import assert from 'node:assert/strict';
import test from 'node:test';

import { renderSleepTimelineBlock } from '../services/east8-time';

// 2026-07-28「连续干活一天半」事故的最终修法。她当时对阿花说自己连续干了一天半,实际那段
// 睡了 4 觉共 486 分钟。第一版修法是禁令(「禁止出现连续清醒 X 小时」)+ 一句醒来锚点;这一版
// 把禁令整段作废,直接把窗口内的真实睡眠时间线摆到她眼前——禁令的前提「中间睡过几觉这段里
// 看不出来」是引擎不给,不是事实上取不到:agent_recovery_sessions 里睡着/醒来两个时刻都记着。
//
// 数据源与管理端 /agent-runtime/recovery-sessions 同一条(listAgentRecoverySessions),
// 不另起第二真理源。

const NOW = new Date('2026-07-28T08:00:13.000Z'); // 东八 2026-07-28 16:00:13

test('窗口内的每一觉都带睡着/醒来两个真时刻和真时长', () => {
  const block = renderSleepTimelineBlock({
    windowStartedAt: '2026-07-27T15:00:00.000Z',
    sleeps: [
      { sleptAt: '2026-07-27T08:22:15.000Z', wokeAt: '2026-07-27T09:52:15.000Z' },
      { sleptAt: '2026-07-27T20:24:38.000Z', wokeAt: '2026-07-28T01:00:39.000Z' },
      { sleptAt: '2026-07-28T04:56:40.000Z', wokeAt: '2026-07-28T06:26:41.000Z' }
    ],
    lastWakeAt: '2026-07-28T06:26:41.000Z',
    now: NOW
  });
  assert.match(block, /^这段上下文覆盖的是 2026-07-27 23:00:00 到现在。这中间你睡过 3 觉：$/m);
  assert.match(block, /^- 2026-07-27 16:22:15 睡到 17:52:15（1 小时 30 分钟）$/m);
  assert.match(block, /^- 2026-07-28 04:24:38 睡到 09:00:39（4 小时 36 分钟）$/m);
  assert.match(block, /^最后一次醒来到现在，你连续醒着 1 小时 34 分钟。$/m);
});

test('跨天的那一觉醒来时刻写完整日期 —— 免得把 00:15 读成前一天', () => {
  const block = renderSleepTimelineBlock({
    windowStartedAt: '2026-07-27T12:00:00.000Z',
    sleeps: [{ sleptAt: '2026-07-27T14:45:21.000Z', wokeAt: '2026-07-27T16:15:23.000Z' }],
    lastWakeAt: '2026-07-27T16:15:23.000Z',
    now: NOW
  });
  // 东八:22:45 睡 → 次日 00:15 醒,跨天
  assert.match(block, /- 2026-07-27 22:45:21 睡到 2026-07-28 00:15:23（1 小时 30 分钟）/);
});

test('窗口内一觉没睡时说清楚，并给出连续清醒时长', () => {
  const block = renderSleepTimelineBlock({
    windowStartedAt: '2026-07-28T07:00:00.000Z',
    sleeps: [],
    lastWakeAt: '2026-07-28T06:26:41.000Z',
    now: NOW
  });
  assert.match(block, /这中间你一觉没睡。/);
  assert.match(block, /你上一次睡醒是 2026-07-28 14:26:41，到现在过去了 1 小时 34 分钟。/);
});

test('窗口起点缺失时退回单句锚点 —— 半截窗口描述比没有更糟', () => {
  const block = renderSleepTimelineBlock({
    windowStartedAt: null,
    sleeps: [{ sleptAt: '2026-07-28T04:56:40.000Z', wokeAt: '2026-07-28T06:26:41.000Z' }],
    lastWakeAt: '2026-07-28T06:26:41.000Z',
    now: NOW
  });
  assert.equal(block, '你上一次睡醒是 2026-07-28 14:26:41，到现在过去了 1 小时 34 分钟。');
});

test('什么记录都没有时返回空串，调用方整块不渲染', () => {
  assert.equal(renderSleepTimelineBlock({
    windowStartedAt: null,
    sleeps: [],
    lastWakeAt: null,
    now: NOW
  }), '');
});

test('超长窗口截断时明说截了多少 —— 不静默吞', () => {
  const sleeps = Array.from({ length: 20 }, (_unused, index) => ({
    sleptAt: new Date(Date.UTC(2026, 6, 1, index, 0, 0)).toISOString(),
    wokeAt: new Date(Date.UTC(2026, 6, 1, index, 30, 0)).toISOString()
  }));
  const block = renderSleepTimelineBlock({
    windowStartedAt: '2026-06-30T00:00:00.000Z',
    sleeps,
    lastWakeAt: sleeps[sleeps.length - 1]!.wokeAt,
    now: NOW,
    maxSegments: 5
  });
  assert.match(block, /这中间你睡过 20 觉，最近 5 觉是：/);
  assert.equal(block.split('\n').filter((line) => line.startsWith('- ')).length, 5);
});

test('时长口径与她收到的其它时间提醒一致 —— 同一函数,不会两种说法', () => {
  // renderWakeAnchorSentence(报时/拒绝提醒共用)与本块的「连续醒着」用的是同一个
  // formatEast8Duration。同一事实两份说法正是这条腿存在要防的失败。
  const block = renderSleepTimelineBlock({
    windowStartedAt: '2026-07-28T07:00:00.000Z',
    sleeps: [],
    lastWakeAt: '2026-07-27T06:26:41.000Z',
    now: NOW
  });
  assert.match(block, /过去了 25 小时 34 分钟。/);
});
