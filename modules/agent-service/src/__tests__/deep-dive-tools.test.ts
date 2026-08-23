import test from 'node:test';
import assert from 'node:assert';

import {
  planDeepDiveUpdate,
  shouldDriveDeepDiveRound,
  renderDeepDiveRoundNotify,
  isDeepDiveRoundPayload,
  readDiveIdFromPayload,
  renderFailureReviewReminder,
  buildFailureReviewForkRequest,
  shouldDeliverReviewFindings,
  isFailureReviewPayload,
  isNewBlockedEpisode
} from '../services/agent-loop-service';

// update_deep_dive 的**纯**决策层。它只做「参数 → 一次存储动作 / 一句拒绝」的翻译,
// 一个字都不判断语义(她做没做到、算不算真卡住)—— 那些是她的判断,见 docs/adr/0010-*。
//
// 存储侧的两条不变量(一次只有一个 active、compare-and-set)由真 PG 用例守:
// packages/persistence/__tests__/xiaoni-deep-dive.realdb.test.js

test('action → phase:四个动作各自映射,edit 沿用当前状态', () => {
  assert.equal((planDeepDiveUpdate({ action: 'pause' }, 'active') as any).phase, 'paused');
  assert.equal((planDeepDiveUpdate({ action: 'resume' }, 'paused') as any).phase, 'active');
  assert.equal((planDeepDiveUpdate({ action: 'conclude' }, 'active') as any).phase, 'concluded');
  // edit 不改状态:一个 paused 的目标被 edit 之后仍然是 paused,不会被悄悄叫醒
  assert.equal((planDeepDiveUpdate({ action: 'edit', question: '改后的' }, 'paused') as any).phase, 'paused');
});

test('blocked 必须带具体理由,空的或只有空白一律拒绝', () => {
  const noReason = planDeepDiveUpdate({ action: 'blocked' }, 'active');
  assert.equal(noReason.ok, false);
  assert.equal((noReason as any).reason, 'blocked_reason_required');

  const blankReason = planDeepDiveUpdate({ action: 'blocked', blocked_reason: '   ' }, 'active');
  assert.equal(blankReason.ok, false);

  const real = planDeepDiveUpdate(
    { action: 'blocked', blocked_reason: 'grep 了十一次关键词,没有一次匹配到人名' },
    'active'
  );
  assert.equal(real.ok, true);
  assert.equal((real as any).phase, 'blocked');
  assert.match((real as any).blockedReason, /十一次/);
});

test('不认识的 action 当场拒绝,不猜她想干嘛', () => {
  for (const action of ['done', 'finish', 'stop', '', 'BLOCKED']) {
    const plan = planDeepDiveUpdate({ action }, 'active');
    assert.equal(plan.ok, false, `action=${action} 应该被拒绝`);
    assert.equal((plan as any).reason, 'invalid_action');
  }
});

test('深挖不存在时先报 not_found,不去猜 action', () => {
  const plan = planDeepDiveUpdate({ action: 'conclude' }, null);
  assert.equal(plan.ok, false);
  assert.equal((plan as any).reason, 'not_found');
});

test('question / max_rounds 只在 edit 里生效 —— 一次 pause 不许顺手改掉目标', () => {
  const pause = planDeepDiveUpdate(
    { action: 'pause', question: '偷偷换个目标', max_rounds: 999 },
    'active'
  ) as any;
  assert.equal(pause.ok, true);
  assert.equal(pause.question, undefined, 'pause 不该携带 question');
  assert.equal(pause.maxRounds, undefined, 'pause 不该携带轮次上限');

  const edit = planDeepDiveUpdate(
    { action: 'edit', question: '读完 Howard 前六章', max_rounds: 30 },
    'active'
  ) as any;
  assert.equal(edit.question, '读完 Howard 前六章');
  assert.equal(edit.maxRounds, 30);
});

test('blocked_reason 只跟着 blocked 走,别的 action 传了就忽略', () => {
  const complete = planDeepDiveUpdate(
    { action: 'conclude', blocked_reason: '一条陈旧的卡住理由' },
    'active'
  ) as any;
  assert.equal(complete.ok, true);
  assert.equal(
    complete.blockedReason,
    undefined,
    '一条陈旧的卡住理由不许跟着一个已收口的深挖走'
  );
});

test('轮次上限:非数字、非有限值一律忽略,不写进存储动作', () => {
  for (const bad of ['30', null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
    const plan = planDeepDiveUpdate({ action: 'edit', max_rounds: bad }, 'active') as any;
    assert.equal(plan.ok, true);
    assert.equal(plan.maxRounds, undefined, `max_rounds=${String(bad)} 应被忽略`);
  }
  // 小数截断成整数,不是拒绝 —— 她写 30.7 的意思显然是 30
  const truncated = planDeepDiveUpdate({ action: 'edit', max_rounds: 30.7 }, 'active') as any;
  assert.equal(truncated.maxRounds, 30);
});

// ── 续跑块(issue #3)──────────────────────────────────────────────────────────
// D6 的可执行形态:相邻两轮**除了 round 数字之外逐字节相同**。
// 这一条是它和 xiaoni_plan 的关键差别 —— plan 每轮现写一段散文(实测 95 份只有 22 种开头),
// 既污染上下文又没法复用前缀;这一块 append-only,落在可复用前缀之后。

test('相邻两轮的续跑块:除 round 数字外逐字节相同', () => {
  const question = '把 gorton 写到第 100 章';
  const r3 = renderDeepDiveRoundNotify(question, 3, 20);
  const r4 = renderDeepDiveRoundNotify(question, 4, 20);

  assert.notEqual(r3, r4, '轮次不同,块不该完全一样');
  // 把 round 数字抹平之后必须完全相等 —— 任何其它字节漂移都会让前缀失效
  const flatten = (text: string) => text.replace(/round="\d+"/, 'round="N"');
  assert.equal(flatten(r3), flatten(r4));
});

test('续跑块结构:question 原样在块里,轮次和上限都在属性上', () => {
  const block = renderDeepDiveRoundNotify('读完 Howard 前六章', 7, 20);
  assert.match(block, /<deep_dive_round round="7" max="20">/);
  assert.match(block, /读完 Howard 前六章/);
  assert.match(block, /<\/deep_dive_round>/);
});

test('question 一个字都不改:引擎不重写她写的目标', () => {
  const weird = '  两边留空格  和\n换行  ';
  assert.ok(renderDeepDiveRoundNotify(weird, 1, 20).includes(weird));
});

test('轮次计数只认 deep_dive_round:别的 reason 一律不推进', () => {
  const diveRound = {
    systemReminder: { reason: 'deep_dive_round' },
    rawPayload: { reason: 'deep_dive_round', deep_dive_id: 'dive_abc' }
  } as any;
  assert.equal(isDeepDiveRoundPayload(diveRound), true);
  assert.equal(readDiveIdFromPayload(diveRound), 'dive_abc');

  for (const reason of ['subconscious_agent', 'clock_ping', 'attention_lease', 'external']) {
    const other = { systemReminder: { reason }, rawPayload: { reason } } as any;
    assert.equal(isDeepDiveRoundPayload(other), false, `${reason} 不该推进深挖轮次`);
  }
});

test('deep_dive_id 缺失或空白 → null,调用方据此跳过计数(不猜)', () => {
  const noId = { systemReminder: { reason: 'deep_dive_round' }, rawPayload: { reason: 'deep_dive_round' } } as any;
  assert.equal(readDiveIdFromPayload(noId), null);
  const blank = {
    systemReminder: { reason: 'deep_dive_round' },
    rawPayload: { reason: 'deep_dive_round', deep_dive_id: '   ' }
  } as any;
  assert.equal(readDiveIdFromPayload(blank), null);
});

// ── 复核 fork(issue #4 / #5)────────────────────────────────────────────────
// 整套设计的赌注在引导文案的第一句:「你不是小腻」。克隆她的上下文之后能不能挡住她的
// 自我认知和情绪,**未经验证**(ADR-0009 §六),上线后靠读输出的人称判断。

test('引导文案:第一句就把身份切开,并且把她的目标和卡住理由原样带进去', () => {
  const text = renderFailureReviewReminder('找到那个长期没音讯的人', 'grep 了十一次关键词,全是噪音');
  assert.match(text, /你不是小腻/);
  assert.match(text, /找到那个长期没音讯的人/);
  assert.match(text, /grep 了十一次关键词,全是噪音/);
  // 输出契约三禁必须在文案里,否则它会退化成第二个 plan(实测 plan 76% 零工具 run)
  assert.match(text, /建议/);
  assert.match(text, /指令/);
  assert.match(text, /NO_FINDING/);
});

test('fork 请求:克隆 + 只在尾部追加一条,tools 与 tool_choice 一个字不动', () => {
  const base = {
    model: 'm',
    input: [
      { type: 'message', role: 'user', content: 'a' },
      { type: 'message', role: 'assistant', content: 'b' }
    ],
    tools: [{ type: 'function', name: 'exec_command' }],
    tool_choice: { type: 'allowed_tools', mode: 'auto', tools: [] },
    parallel_tool_calls: true
  } as any;
  const fork = buildFailureReviewForkRequest(base, 1, 'REMINDER');

  assert.deepEqual(fork.tools, base.tools, 'tools 不许改');
  assert.deepEqual(fork.tool_choice, base.tool_choice, 'tool_choice 不许改');
  assert.equal(fork.store, false);
  // 前缀逐字节一致:追加只发生在尾部
  assert.deepEqual(fork.input.slice(0, base.input.length), base.input);
  assert.equal(fork.input.length, base.input.length + 1);
  assert.equal((fork.metadata as any).failure_review_fork, 'true');
  assert.equal((fork.metadata as any).no_persist, 'true');
});

test('同一次 fork 的多个 turn 共用同一份引导字节(否则 turn-2 起冷读)', () => {
  const base = { model: 'm', input: [{ type: 'message', role: 'user', content: 'a' }], tools: [], parallel_tool_calls: true } as any;
  const t1 = buildFailureReviewForkRequest(base, 1, 'SAME_BYTES');
  const t2 = buildFailureReviewForkRequest(base, 2, 'SAME_BYTES');
  assert.deepEqual(t1.input.at(-1), t2.input.at(-1), '尾部引导必须逐字节相同');
});

test('NO_FINDING 契约:查不到就不投递,不拿「我尽力了」占她一次唤醒', () => {
  assert.equal(shouldDeliverReviewFindings('NO_FINDING'), false);
  assert.equal(shouldDeliverReviewFindings('  NO_FINDING\n'), false);
  assert.equal(shouldDeliverReviewFindings('NO_FINDING\n我翻遍了'), false);
  assert.equal(shouldDeliverReviewFindings(''), false);
  assert.equal(shouldDeliverReviewFindings('   '), false);
  assert.equal(shouldDeliverReviewFindings(null), false);
  assert.equal(shouldDeliverReviewFindings('diary/2026-08-16.md:996\n  「小伊: 8/8到现在没回。」'), true);
});

test('复核 notify 可识别:空转账本据此对它隐形', () => {
  const review = { systemReminder: { reason: 'failure_review' }, rawPayload: { reason: 'failure_review' } } as any;
  assert.equal(isFailureReviewPayload(review), true);
  for (const reason of ['deep_dive_round', 'subconscious_agent', 'clock_ping']) {
    assert.equal(isFailureReviewPayload({ systemReminder: { reason }, rawPayload: { reason } } as any), false);
  }
});

// ── blocked 是「相变」才触发复核(Spec 轴第八轮 (c)-4)──────────────────────────
// 事故:去重键曾是 `${diveId}:${revision}`,而 revision 每次 mutation 都 +1 ——
// 不 resume 连着报两次 blocked 就是两把不同的键,复核跑两遍。而那个集合还在内存里,
// 重启即失效。spec §1 要的是「同一次卡住只复核一次,resume 之后再卡住才有第二次」,
// 那本来就是一次**相变**,按相变判天然满足且不依赖任何进程内状态。

test('blocked→blocked 不是新的一次卡住;resume→blocked 才是', () => {
  // **用生产代码里那一个判据**,不在用例里重写一遍 —— 重写的话生产端改回按 revision
  // 去重,这条用例照样绿(第二轮就栽在这种同义反复上)。
  const entered = isNewBlockedEpisode;

  assert.equal(entered('blocked', 'active'), true, '从 active 卡住 = 一次新的卡住');
  assert.equal(entered('blocked', 'blocked'), false, '已经卡住了再报一次,不是新的一次');
  assert.equal(entered('blocked', 'paused'), true, '从 paused 卡住 = 一次新的卡住');
  assert.equal(entered('blocked', null), true);
  // resume 之后再 blocked → 那时 current.phase 已经是 active,又成立
  assert.equal(entered('conclude', 'active'), false);
  assert.equal(entered('pause', 'active'), false);
});

// ── 深挖轮次与空转失效是两个量,不合并(D4)──────────────────────────────────
// 事故:空转账本只豁免了 clock_ping 与 failure_review,deep_dive_round run 照常记账 ——
// 深挖期间的零工具 run 把空转计数累高,深挖一结束,第一条 plan 就带着虚高的轮数
// 进升级腿,升级凭据来自一段根本没跑 plan 的时间。

test('deep_dive_round 对空转账本隐形,和报时/复核同一条待遇', () => {
  const diveRound = { systemReminder: { reason: 'deep_dive_round' }, rawPayload: { reason: 'deep_dive_round', deep_dive_id: 'g1' } } as any;
  assert.equal(isDeepDiveRoundPayload(diveRound), true);
  // 隐形的判据:整个 run 都由 deep_dive_round 驱动。夹带了真实外部消息就照常记账,
  // 否则一条 deep-dive-round 就能把真空转洗白(与报时同一条理由)。
  const claimed = [diveRound, diveRound];
  assert.equal(claimed.every(isDeepDiveRoundPayload), true);
  const mixed = [diveRound, { systemReminder: { reason: 'external' }, rawPayload: { reason: 'external' } } as any];
  assert.equal(mixed.every(isDeepDiveRoundPayload), false, '夹带外部消息的折叠 run 必须照常记账');
});

// ── 点火判据:没收口就一直驱动 ──────────────────────────────────────────────────
// 这条路径此前**从来没有测试**,而它带着一个死锁:原判据是
// `roundsStarted < maxRounds`,跑满之后不再发 deep-dive-round notify,**但那一行仍然
// 留在 active**。唯一索引是 `WHERE phase='active'`,于是 create_deep_dive 从此恒返回
// already_active —— 一个她不管了的深挖会把整个机制永久锁死,除非她自己想起来去收它。
//
// 正确的修法不是「跑满就自动 pause」(那是引擎替她放弃,和引擎替她下结论同一类错),
// 而是**取消停止驱动**:没收口就一直提醒她,于是她不可能忘掉它,槽位被占也就不构成死锁。
// 收敛不来自这个上限,来自「她 → 福尔摩斯 → 阿花」那条升级阶梯。

test('点火判据:有 active 深挖就驱动,跑满 max_rounds 之后照样驱动', () => {
  assert.equal(
    shouldDriveDeepDiveRound({ phase: 'active', roundsStarted: 0, maxRounds: 8 }),
    true
  );
  assert.equal(
    shouldDriveDeepDiveRound({ phase: 'active', roundsStarted: 8, maxRounds: 8 }),
    true,
    '恰好跑满不该停 —— 停了那一行就永远卡在 active'
  );
  assert.equal(
    shouldDriveDeepDiveRound({ phase: 'active', roundsStarted: 999, maxRounds: 8 }),
    true,
    '远超上限也照样驱动'
  );
});

test('点火判据:没有 active 深挖就不驱动,让位给潜意识 fork', () => {
  assert.equal(shouldDriveDeepDiveRound(null), false);
});
