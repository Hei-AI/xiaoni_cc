import test from 'node:test';
import assert from 'node:assert';

import { planGoalUpdate } from '../services/agent-loop-service';

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
