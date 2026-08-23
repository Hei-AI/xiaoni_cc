import test from 'node:test';
import assert from 'node:assert';

import {
  planDeepDiveUpdate,
  UPDATE_DEEP_DIVE_TOOL,
  shouldDriveDeepDiveRound,
  sherlockConsultDue,
  renderDeepDiveRoundNotify,
  isDeepDiveRoundPayload,
  readDiveIdFromPayload,
  renderSherlockReminder,
  seedSherlockForkInput,
  buildSherlockForkRequest,
  shouldDeliverSherlockDirection,
  isSherlockPayload,
  isSherlockRequest
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

test('求助必须带具体内容,空的或只有空白一律拒绝(原 blocked 契约,载体换成 need_outsider)', () => {
  const noPaths = planDeepDiveUpdate({ action: 'need_outsider' }, 'active');
  assert.equal(noPaths.ok, false);
  assert.equal((noPaths as any).reason, 'searched_paths_required');

  const blank = planDeepDiveUpdate({ action: 'need_outsider', searched_paths: '   ' }, 'active');
  assert.equal(blank.ok, false);

  const real = planDeepDiveUpdate(
    { action: 'need_outsider', searched_paths: 'grep 了十一次关键词,没有一次匹配到人名' },
    'active'
  );
  assert.equal(real.ok, true);
  assert.equal((real as any).phase, 'active', '求助不改 phase');
  assert.match((real as any).searchedPaths, /十一次/);
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

test('question / max_requests 只在 edit 里生效 —— 一次 pause 不许顺手改掉目标', () => {
  const pause = planDeepDiveUpdate(
    { action: 'pause', question: '偷偷换个目标', max_requests: 999 },
    'active'
  ) as any;
  assert.equal(pause.ok, true);
  assert.equal(pause.question, undefined, 'pause 不该携带 question');
  assert.equal(pause.maxRequests, undefined, 'pause 不该携带上限');

  const edit = planDeepDiveUpdate(
    { action: 'edit', question: '读完 Howard 前六章', max_requests: 30 },
    'active'
  ) as any;
  assert.equal(edit.question, '读完 Howard 前六章');
  assert.equal(edit.maxRequests, 30);
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

test('上限:非数字、非有限值一律忽略,不写进存储动作', () => {
  for (const bad of ['30', null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
    const plan = planDeepDiveUpdate({ action: 'edit', max_requests: bad }, 'active') as any;
    assert.equal(plan.ok, true);
    assert.equal(plan.maxRequests, undefined, `max_requests=${String(bad)} 应被忽略`);
  }
  // 小数截断成整数,不是拒绝 —— 她写 30.7 的意思显然是 30
  const truncated = planDeepDiveUpdate({ action: 'edit', max_requests: 30.7 }, 'active') as any;
  assert.equal(truncated.maxRequests, 30);
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

// ── 福尔摩斯 ─────────────────────────────────────────────────────────────────
// 取代复核 fork。整套设计的赌注不再是「克隆之后能不能靠一句话切开身份」,而是
// **根本不给她的上下文** —— ADR-0009 §三 验出结论的那个配置就是「不带身份、不带上下文」。

test('引导文案:问题原文和她整理的路径都要原样带进去', () => {
  const text = renderSherlockReminder('找到那个长期没音讯的人', 'grep 了十一次关键词,全是噪音', null);
  assert.match(text, /找到那个长期没音讯的人/);
  assert.match(text, /grep 了十一次关键词,全是噪音/);
  // 输出契约必须在文案里,否则它会退化成第二个 plan(实测 plan 76% 零工具 run)
  assert.match(text, /NO_DIRECTION/);
});

test('第二次引导:必须看得见第一次给过的方向 —— ②的全部价值在这儿', () => {
  const text = renderSherlockReminder('同一个问题', '她整理的路径', '上次的方向:换成按时间排,别再换关键词');
  assert.match(text, /按时间排/);
});

test('fork 请求:**不是克隆**,不带任何主 agent 前缀,只给 exec_command', () => {
  const fork = buildSherlockForkRequest('m', [], 1, 'REMINDER');
  assert.equal(fork.instructions, 'REMINDER', 'instructions 就是引导本身,不是她的 system prompt');
  assert.deepEqual(
    (fork.tools || []).map((t: any) => t.function?.name ?? t.name),
    ['exec_command']
  );
  assert.equal(fork.store, false);
  assert.equal((fork.metadata as any).sherlock_fork, 'true');
  assert.equal((fork.metadata as any).no_persist, 'true');
});

test('同一次 fork 的多个 turn 共用同一份引导字节', () => {
  const t1 = buildSherlockForkRequest('m', [], 1, 'SAME_BYTES');
  const t2 = buildSherlockForkRequest('m', [], 2, 'SAME_BYTES');
  assert.equal(t1.instructions, t2.instructions, '引导必须逐字节相同');
});

test('累积链:后一轮的 input 是前一轮的严格延长', () => {
  const seed = seedSherlockForkInput('R');
  const grown = [...seed, { type: 'message', role: 'assistant', content: 'x' } as any];
  const t2 = buildSherlockForkRequest('m', grown, 2, 'R');
  assert.deepEqual(t2.input.slice(0, seed.length), seed, '前缀必须是种子本身');
});

test('NO_DIRECTION 契约:查不出方向就不投递,不拿「我尽力了」占她一次唤醒', () => {
  assert.equal(shouldDeliverSherlockDirection('NO_DIRECTION'), false);
  assert.equal(shouldDeliverSherlockDirection('  NO_DIRECTION\n'), false);
  assert.equal(shouldDeliverSherlockDirection('NO_DIRECTION\n我翻遍了'), false);
  assert.equal(shouldDeliverSherlockDirection(''), false);
  assert.equal(shouldDeliverSherlockDirection('   '), false);
  assert.equal(shouldDeliverSherlockDirection(null), false);
  assert.equal(shouldDeliverSherlockDirection('diary/2026-08-16.md:996\n  「小伊: 8/8到现在没回。」'), true);
});

test('复核 notify 可识别:空转账本据此对它隐形', () => {
  const review = { systemReminder: { reason: 'sherlock' }, rawPayload: { reason: 'sherlock' } } as any;
  assert.equal(isSherlockPayload(review), true);
  for (const reason of ['deep_dive_round', 'subconscious_agent', 'clock_ping']) {
    assert.equal(isSherlockPayload({ systemReminder: { reason }, rawPayload: { reason } } as any), false);
  }
});

// ── blocked 是「相变」才触发复核(Spec 轴第八轮 (c)-4)──────────────────────────
// 事故:去重键曾是 `${diveId}:${revision}`,而 revision 每次 mutation 都 +1 ——
// 不 resume 连着报两次 blocked 就是两把不同的键,复核跑两遍。而那个集合还在内存里,
// 重启即失效。spec §1 要的是「同一次卡住只复核一次,resume 之后再卡住才有第二次」,
// 那本来就是一次**相变**,按相变判天然满足且不依赖任何进程内状态。

test('福尔摩斯触发口:只认 need_outsider', () => {
  assert.equal(isSherlockRequest('need_outsider'), true);
  for (const a of ['conclude', 'pause', 'resume', 'edit', 'blocked']) {
    assert.equal(isSherlockRequest(a), false, `${a} 不该点火福尔摩斯`);
  }
});

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
// `roundsStarted < maxRequests`,跑满之后不再发 deep-dive-round notify,**但那一行仍然
// 留在 active**。唯一索引是 `WHERE phase='active'`,于是 create_deep_dive 从此恒返回
// already_active —— 一个她不管了的深挖会把整个机制永久锁死,除非她自己想起来去收它。
//
// 正确的修法不是「跑满就自动 pause」(那是引擎替她放弃,和引擎替她下结论同一类错),
// 而是**取消停止驱动**:没收口就一直提醒她,于是她不可能忘掉它,槽位被占也就不构成死锁。
// 收敛不来自这个上限,来自「她 → 福尔摩斯 → 阿花」那条升级阶梯。

test('点火判据:有 active 深挖就驱动,跑满 max_requests 之后照样驱动', () => {
  assert.equal(
    shouldDriveDeepDiveRound({ phase: 'active', roundsStarted: 0, maxRequests: 8 }),
    true
  );
  assert.equal(
    shouldDriveDeepDiveRound({ phase: 'active', roundsStarted: 8, maxRequests: 8 }),
    true,
    '恰好跑满不该停 —— 停了那一行就永远卡在 active'
  );
  assert.equal(
    shouldDriveDeepDiveRound({ phase: 'active', roundsStarted: 999, maxRequests: 8 }),
    true,
    '远超上限也照样驱动'
  );
});

test('点火判据:没有 active 深挖就不驱动,让位给潜意识 fork', () => {
  assert.equal(shouldDriveDeepDiveRound(null), false);
});

// ── 福尔摩斯:什么时候该请他 ────────────────────────────────────────────────────
// 阶梯是「她 → 福尔摩斯 → 阿花」,福尔摩斯请两次、两个角色:
//   ① 到 N     给一个新方向
//   ② 到 2N    额外拿到「①的方向她照做了、还是没成」,判这问题在这儿还有没有解;
//              判没有,由它告诉她去找阿花
// 判据只数**主 agent 的 LLM 请求次数**(不数 run、不数轮)——她伪造不了「没进展」这件事,
// 因为它量的是缺席不是在场。

test('福尔摩斯:没到 N 不请', () => {
  assert.equal(sherlockConsultDue({ phase: 'active', requestsSpent: 39, maxRequests: 40, sherlockConsults: 0 }), null);
});

test('福尔摩斯:到 N 请第一次', () => {
  assert.equal(sherlockConsultDue({ phase: 'active', requestsSpent: 40, maxRequests: 40, sherlockConsults: 0 }), 1);
  assert.equal(sherlockConsultDue({ phase: 'active', requestsSpent: 77, maxRequests: 40, sherlockConsults: 0 }), 1,
    '早该请而没请到的,补请第一次,不跳级');
});

test('福尔摩斯:请过一次之后要等到 2N 才请第二次', () => {
  assert.equal(sherlockConsultDue({ phase: 'active', requestsSpent: 79, maxRequests: 40, sherlockConsults: 1 }), null);
  assert.equal(sherlockConsultDue({ phase: 'active', requestsSpent: 80, maxRequests: 40, sherlockConsults: 1 }), 2);
});

test('福尔摩斯:两次请完就不再请 —— 收敛靠阶梯,不靠无限重试', () => {
  assert.equal(sherlockConsultDue({ phase: 'active', requestsSpent: 9999, maxRequests: 40, sherlockConsults: 2 }), null);
});

test('福尔摩斯:只对 active 的深挖有效', () => {
  assert.equal(sherlockConsultDue(null), null);
  for (const phase of ['paused', 'concluded', 'blocked']) {
    assert.equal(
      sherlockConsultDue({ phase, requestsSpent: 999, maxRequests: 40, sherlockConsults: 0 }),
      null,
      `${phase} 的深挖不该请福尔摩斯`
    );
  }
});

// ── need_outsider 取代 blocked ────────────────────────────────────────────────
// blocked 是任务语义残留(「这活卡住了」),深挖的正确语义是「这问题我暂时想不通」。
// 两个出口语义重叠、她一个都没用过,合并成一个:自评 need_outsider。
// 复核 fork 也跟着挂到 need_outsider 上 —— 它 0 次触发的病根就是在等一个她从不发出的信号。

test('action 集合:blocked 已删,conclude/pause/resume/edit/need_outsider 五个', () => {
  for (const action of ['blocked']) {
    const plan = planDeepDiveUpdate({ action }, 'active') as any;
    assert.equal(plan.ok, false, 'blocked 必须已经不认');
    assert.equal(plan.reason, 'invalid_action');
  }
  assert.equal((planDeepDiveUpdate({ action: 'need_outsider', searched_paths: '翻了 x/y/z' }, 'active') as any).ok, true);
});

test('need_outsider 必须带 searched_paths —— 那份整理本身就是一次重新框定', () => {
  const empty = planDeepDiveUpdate({ action: 'need_outsider' }, 'active') as any;
  assert.equal(empty.ok, false);
  assert.equal(empty.reason, 'searched_paths_required');
  const blank = planDeepDiveUpdate({ action: 'need_outsider', searched_paths: '   ' }, 'active') as any;
  assert.equal(blank.ok, false, '空白不算整理');
});

test('need_outsider 不改 phase —— 她还在挖,只是求助了', () => {
  const plan = planDeepDiveUpdate({ action: 'need_outsider', searched_paths: '翻了 a/b' }, 'active') as any;
  assert.equal(plan.phase, 'active', '求助不等于收口,深挖照常活着');
  assert.match(plan.searchedPaths, /a\/b/);
});

test('searched_paths 只跟着 need_outsider 走,别的 action 传了就忽略', () => {
  const paused = planDeepDiveUpdate({ action: 'pause', searched_paths: '不该带走' }, 'active') as any;
  assert.equal(paused.searchedPaths, undefined);
});

// ── 工具 schema 必须和判据层同步 ────────────────────────────────────────────────
// 本轮真事故:判据层删了 blocked / 加了 need_outsider,而 UPDATE_DEEP_DIVE_TOOL 的 enum
// 和 properties 一个字没改,还带着 additionalProperties:false —— 于是她**根本发不出**
// need_outsider,也传不进 searched_paths,整条福尔摩斯链从模型面不可达。
// 编译器管不到 JSON schema 和判据层之间这条边,只能靠这条用例钉。
test('工具 schema 与判据层同步:enum 与 action 映射逐项对齐', () => {
  const schema: any = (UPDATE_DEEP_DIVE_TOOL as any).function.parameters;
  const enumValues: string[] = schema.properties.action.enum;
  assert.deepEqual(
    [...enumValues].sort(),
    ['conclude', 'edit', 'need_outsider', 'pause', 'resume'],
    'enum 必须与 DEEP_DIVE_ACTION_TO_PHASE 的键完全一致'
  );
  for (const action of enumValues) {
    const plan = planDeepDiveUpdate(
      { action, searched_paths: 'x', question: 'q' },
      'active'
    ) as any;
    assert.notEqual(plan.reason, 'invalid_action', `schema 允许 ${action},判据层却不认`);
  }
  assert.ok(schema.properties.searched_paths, 'need_outsider 的必填参数必须在 schema 里');
  assert.equal(schema.additionalProperties, false, '仍然禁止额外字段');
  assert.ok(!schema.properties.blocked_reason, 'blocked_reason 已废,不该还在 schema 里');
});
