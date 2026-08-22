import test from 'node:test';
import assert from 'node:assert';

import {
  planGoalUpdate,
  renderGoalRoundNotify,
  isGoalRoundPayload,
  readGoalIdFromPayload
} from '../services/agent-loop-service';

// update_goal 的**纯**决策层。它只做「参数 → 一次存储动作 / 一句拒绝」的翻译,
// 一个字都不判断语义(她做没做到、算不算真卡住)—— 那些是她的判断,见 docs/adr/0010-*。
//
// 存储侧的两条不变量(一次只有一个 active、compare-and-set)由真 PG 用例守:
// packages/persistence/__tests__/xiaoni-goal.realdb.test.js

test('action → phase:四个动作各自映射,edit 沿用当前状态', () => {
  assert.equal((planGoalUpdate({ action: 'pause' }, 'active') as any).phase, 'paused');
  assert.equal((planGoalUpdate({ action: 'resume' }, 'paused') as any).phase, 'active');
  assert.equal((planGoalUpdate({ action: 'complete' }, 'active') as any).phase, 'completed');
  // edit 不改状态:一个 paused 的目标被 edit 之后仍然是 paused,不会被悄悄叫醒
  assert.equal((planGoalUpdate({ action: 'edit', objective: '改后的' }, 'paused') as any).phase, 'paused');
});

test('blocked 必须带具体理由,空的或只有空白一律拒绝', () => {
  const noReason = planGoalUpdate({ action: 'blocked' }, 'active');
  assert.equal(noReason.ok, false);
  assert.equal((noReason as any).reason, 'blocked_reason_required');

  const blankReason = planGoalUpdate({ action: 'blocked', blocked_reason: '   ' }, 'active');
  assert.equal(blankReason.ok, false);

  const real = planGoalUpdate(
    { action: 'blocked', blocked_reason: 'grep 了十一次关键词,没有一次匹配到人名' },
    'active'
  );
  assert.equal(real.ok, true);
  assert.equal((real as any).phase, 'blocked');
  assert.match((real as any).blockedReason, /十一次/);
});

test('不认识的 action 当场拒绝,不猜她想干嘛', () => {
  for (const action of ['done', 'finish', 'stop', '', 'BLOCKED']) {
    const plan = planGoalUpdate({ action }, 'active');
    assert.equal(plan.ok, false, `action=${action} 应该被拒绝`);
    assert.equal((plan as any).reason, 'invalid_action');
  }
});

test('goal 不存在时先报 not_found,不去猜 action', () => {
  const plan = planGoalUpdate({ action: 'complete' }, null);
  assert.equal(plan.ok, false);
  assert.equal((plan as any).reason, 'not_found');
});

test('objective / max_goal_rounds 只在 edit 里生效 —— 一次 pause 不许顺手改掉目标', () => {
  const pause = planGoalUpdate(
    { action: 'pause', objective: '偷偷换个目标', max_goal_rounds: 999 },
    'active'
  ) as any;
  assert.equal(pause.ok, true);
  assert.equal(pause.objective, undefined, 'pause 不该携带 objective');
  assert.equal(pause.maxGoalRounds, undefined, 'pause 不该携带轮次上限');

  const edit = planGoalUpdate(
    { action: 'edit', objective: '读完 Howard 前六章', max_goal_rounds: 30 },
    'active'
  ) as any;
  assert.equal(edit.objective, '读完 Howard 前六章');
  assert.equal(edit.maxGoalRounds, 30);
});

test('blocked_reason 只跟着 blocked 走,别的 action 传了就忽略', () => {
  const complete = planGoalUpdate(
    { action: 'complete', blocked_reason: '一条陈旧的卡住理由' },
    'active'
  ) as any;
  assert.equal(complete.ok, true);
  assert.equal(
    complete.blockedReason,
    undefined,
    '一条陈旧的卡住理由不许跟着一个已完成的目标走'
  );
});

test('轮次上限:非数字、非有限值一律忽略,不写进存储动作', () => {
  for (const bad of ['30', null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
    const plan = planGoalUpdate({ action: 'edit', max_goal_rounds: bad }, 'active') as any;
    assert.equal(plan.ok, true);
    assert.equal(plan.maxGoalRounds, undefined, `max_goal_rounds=${String(bad)} 应被忽略`);
  }
  // 小数截断成整数,不是拒绝 —— 她写 30.7 的意思显然是 30
  const truncated = planGoalUpdate({ action: 'edit', max_goal_rounds: 30.7 }, 'active') as any;
  assert.equal(truncated.maxGoalRounds, 30);
});

// ── 续跑块(issue #3)──────────────────────────────────────────────────────────
// D6 的可执行形态:相邻两轮**除了 round 数字之外逐字节相同**。
// 这一条是它和 xiaoni_plan 的关键差别 —— plan 每轮现写一段散文(实测 95 份只有 22 种开头),
// 既污染上下文又没法复用前缀;这一块 append-only,落在可复用前缀之后。

test('相邻两轮的续跑块:除 round 数字外逐字节相同', () => {
  const objective = '把 gorton 写到第 100 章';
  const r3 = renderGoalRoundNotify(objective, 3, 20);
  const r4 = renderGoalRoundNotify(objective, 4, 20);

  assert.notEqual(r3, r4, '轮次不同,块不该完全一样');
  // 把 round 数字抹平之后必须完全相等 —— 任何其它字节漂移都会让前缀失效
  const flatten = (text: string) => text.replace(/round="\d+"/, 'round="N"');
  assert.equal(flatten(r3), flatten(r4));
});

test('续跑块结构:objective 原样在块里,轮次和上限都在属性上', () => {
  const block = renderGoalRoundNotify('读完 Howard 前六章', 7, 20);
  assert.match(block, /<goal_round round="7" max="20">/);
  assert.match(block, /读完 Howard 前六章/);
  assert.match(block, /<\/goal_round>/);
});

test('objective 一个字都不改:引擎不重写她写的目标', () => {
  const weird = '  两边留空格  和\n换行  ';
  assert.ok(renderGoalRoundNotify(weird, 1, 20).includes(weird));
});

test('轮次计数只认 goal_round:别的 reason 一律不推进', () => {
  const goalRound = {
    systemReminder: { reason: 'goal_round' },
    rawPayload: { reason: 'goal_round', goal_id: 'goal_abc' }
  } as any;
  assert.equal(isGoalRoundPayload(goalRound), true);
  assert.equal(readGoalIdFromPayload(goalRound), 'goal_abc');

  for (const reason of ['subconscious_agent', 'clock_ping', 'attention_lease', 'external']) {
    const other = { systemReminder: { reason }, rawPayload: { reason } } as any;
    assert.equal(isGoalRoundPayload(other), false, `${reason} 不该推进 goal 轮次`);
  }
});

test('goal_id 缺失或空白 → null,调用方据此跳过计数(不猜)', () => {
  const noId = { systemReminder: { reason: 'goal_round' }, rawPayload: { reason: 'goal_round' } } as any;
  assert.equal(readGoalIdFromPayload(noId), null);
  const blank = {
    systemReminder: { reason: 'goal_round' },
    rawPayload: { reason: 'goal_round', goal_id: '   ' }
  } as any;
  assert.equal(readGoalIdFromPayload(blank), null);
});
