import assert from 'node:assert/strict';
import test from 'node:test';

import { createPassiveRecallDelivery, type RecallDeliveryDeps } from '../services/xiaoni-recall-delivery';

// 固定时钟。投递有**节奏闸**(日额按活动窗 09:00–23:00 东八分槽摊开),不钉死时钟的话
// 用例会随「现在几点」时绿时红。选 21:00 东八 = 槽位已放行到第 6 条,不干扰非节奏用例。
const AT_2100_EAST8 = new Date('2026-08-07T13:00:00Z');

// 开关/日额的唯一真理源是 agent_runtime_control(管理端可改、每拍热读)。测试直接注入闸门值。
const gate = (enabled: boolean, dailyCap: number, now: Date = AT_2100_EAST8) => ({
  readGate: async () => ({ enabled, dailyCap }),
  now: () => now
});

// 被动浮现投递闸。在此之前整条召回链是 shadow-only,这是唯一的出口 —— 所以三件事必须成立:
//   ① 默认 OFF(不给一个「忘了关」的世界线);
//   ② 同一段记忆永远只投一次(dedupeKey = 记忆的 ref,靠 created 标志判,不是靠 status);
//   ③ 日额是硬闸(notify 会唤醒主 loop,量失控 = 她被记忆刷屏)。

type EnqueueCall = { message: Record<string, unknown>; payload: Record<string, unknown> };

function fakeDeps(overrides: {
  rowsByQueryRef?: Record<string, unknown[]>;
  deliveredToday?: number;
  alreadyDelivered?: Set<string>;
  // 今天已投的 dedupe_key(新→旧)。日额计数与腿间轮转都从这一份读。
  todaysKeys?: string[];
} = {}) {
  const calls: EnqueueCall[] = [];
  const already = overrides.alreadyDelivered || new Set<string>();
  const deps: RecallDeliveryDeps = {
    async listRecallShadowLog(params) {
      const queryRef = String((params as { queryRef?: unknown }).queryRef || '');
      return (overrides.rowsByQueryRef || {})[queryRef] || [];
    },
    async listRecentAgentQueueDedupeKeys() {
      if (Array.isArray(overrides.todaysKeys)) {
        return overrides.todaysKeys;
      }
      return Array.from({ length: overrides.deliveredToday ?? 0 }, (_, i) => `recall-surface:open_loop:pad${i}`);
    },
    async enqueueAgentQueueMessage(input) {
      const call = input as unknown as EnqueueCall;
      calls.push(call);
      const dedupeKey = String(call.message.dedupeKey);
      const isNew = !already.has(dedupeKey);
      already.add(dedupeKey);
      return { queueId: 1, status: 'pending', created: isNew };
    }
  };
  return { deps, calls, already };
}

const rowWith = (items: unknown[]) => ({ occurredAt: '2026-08-07T03:00:00Z', surfaced: items });
const openLoopItem = (ref: string, lead: string) => ({ kind: 'open_loop', ref, lead });
const associationItem = (ref: string, lead: string) => ({ kind: 'association', ref, lead });

test('闸门读不到 → fail-closed,一条都不投', async () => {
  const { deps, calls } = fakeDeps({
    rowsByQueryRef: { open_loop_scan: [rowWith([openLoopItem('ol:1', '你之前记过一件还没了的事：X')])] }
  });
  // 不注入 readGate → 走生产路径(现读 agent_runtime_control),库里没开就是 disabled。
  // 这里用一个「读不出来」的闸门模拟最坏情况:必须 fail-closed。
  const delivery = createPassiveRecallDelivery(deps, { readGate: async () => { throw new Error('db down'); } });
  assert.equal(await delivery.deliverOnce(), 'disabled');
  assert.equal(calls.length, 0, '关着的时候一条都不能入队');
});

test('打开后投一条:正文 = lead 原句,dedupeKey 锚在记忆的 ref 上', async () => {
  const lead = '你之前记过一件还没了的事：not-knowing发了reddit等三天后看结果（放了 4 天了）';
  const { deps, calls } = fakeDeps({
    rowsByQueryRef: { open_loop_scan: [rowWith([openLoopItem('ol:not-knowing', lead)])] }
  });
  const delivery = createPassiveRecallDelivery(deps, gate(true, 6));

  assert.equal(await delivery.deliverOnce(), 'delivered');
  assert.equal(calls.length, 1);
  assert.match(String(calls[0].message.dedupeKey), /^recall-surface:open_loop:[0-9a-f]{32}$/);
  assert.equal((calls[0].message.rawPayload as Record<string, unknown>).recall_ref, 'ol:not-knowing');
  assert.equal(calls[0].message.source, 'system_reminder');
  assert.equal(calls[0].message.bodyForAgent, lead, '正文就是 lead 本句,不加系统框');
  // 缓存契约:正文必须在 enqueue 时刻冻结进 payload.systemReminder.reminder,
  // 下一 run 的 stack replay 从同一字段逐字节读回。
  const reminder = (calls[0].payload.systemReminder as Record<string, unknown>).reminder;
  assert.equal(reminder, lead);
  assert.ok(String(calls[0].message.traceId).startsWith('runtrace_'), 'trace_id 必须给足(空的会击穿 run 边界缓存)');
});

test('每拍最多 1 条 —— 候选再多也只投一条', async () => {
  const { deps, calls } = fakeDeps({
    rowsByQueryRef: {
      open_loop_scan: [rowWith([openLoopItem('ol:1', 'A'), openLoopItem('ol:2', 'B')])],
      association_scan: [rowWith([associationItem('as:1', 'C')])]
    }
  });
  const delivery = createPassiveRecallDelivery(deps, gate(true, 6));
  assert.equal(await delivery.deliverOnce(), 'delivered');
  assert.equal(calls.length, 1);
});

test('同一段记忆永远只投一次:第二拍撞 dedupeKey → created=false → 不算投递', async () => {
  const rows = {
    open_loop_scan: [rowWith([openLoopItem('ol:1', '还没了的事 A')])]
  };
  const shared = new Set<string>();
  const first = fakeDeps({ rowsByQueryRef: rows, alreadyDelivered: shared });
  const d1 = createPassiveRecallDelivery(first.deps, gate(true, 6));
  assert.equal(await d1.deliverOnce(), 'delivered');

  // 同一份 shadow 行再来一拍(supervisor 每 10min 一跳,shadow 行还在窗口里)。
  const second = fakeDeps({ rowsByQueryRef: rows, alreadyDelivered: shared });
  const d2 = createPassiveRecallDelivery(second.deps, gate(true, 6));
  assert.equal(await d2.deliverOnce(), 'none', '已投过的记忆不该再投一次');
});

test('日额是硬闸:今天投满了就停', async () => {
  const { deps, calls } = fakeDeps({
    rowsByQueryRef: { open_loop_scan: [rowWith([openLoopItem('ol:1', '还没了的事')])] },
    deliveredToday: 6
  });
  const delivery = createPassiveRecallDelivery(deps, gate(true, 6));
  assert.equal(await delivery.deliverOnce(), 'capped');
  assert.equal(calls.length, 0);
});

test('只投 open_loop / association 两条腿 —— 其余腿的 queryRef 根本不查', async () => {
  const queried: string[] = [];
  const deps: RecallDeliveryDeps = {
    async listRecallShadowLog(params) {
      queried.push(String((params as { queryRef?: unknown }).queryRef || ''));
      return [];
    },
    async listRecentAgentQueueDedupeKeys() { return []; },
    async enqueueAgentQueueMessage() { return { queueId: 1, status: 'pending', created: true }; }
  };
  const delivery = createPassiveRecallDelivery(deps, gate(true, 6));
  await delivery.deliverOnce();
  assert.deepEqual(queried.sort(), ['association_scan', 'open_loop_scan']);
  assert.ok(!queried.includes('diary_resurface'), 'diary_event 唯一率 12.8%,不在首发名单');
});

test('缺 ref 或缺 lead 的 surfaced 项直接跳过(没有稳定 ref 就没有幂等)', async () => {
  const { deps, calls } = fakeDeps({
    rowsByQueryRef: {
      open_loop_scan: [rowWith([
        { kind: 'open_loop', lead: '', text: '' },
        { kind: 'open_loop', ref: 'ol:x' },
        null,
        openLoopItem('ol:good', '两样都全的这条')
      ])]
    }
  });
  const delivery = createPassiveRecallDelivery(deps, gate(true, 6));
  assert.equal(await delivery.deliverOnce(), 'delivered');
  assert.equal(calls.length, 1);
  assert.equal((calls[0].message.rawPayload as Record<string, unknown>).recall_ref, 'ol:good');
});

test('承诺腿优先于联想腿(还没了的事比旧事重提更该说)', async () => {
  const { deps, calls } = fakeDeps({
    rowsByQueryRef: {
      open_loop_scan: [rowWith([openLoopItem('ol:1', '还没了的事')])],
      association_scan: [rowWith([associationItem('as:1', '旧事重提')])]
    }
  });
  const delivery = createPassiveRecallDelivery(deps, gate(true, 6));
  await delivery.deliverOnce();
  assert.equal((calls[0].message.rawPayload as Record<string, unknown>).recall_ref, 'ol:1');
});

test('闸门关着 → disabled;日额 0 也等同关闭', async () => {
  for (const g of [{ enabled: false, dailyCap: 6 }, { enabled: true, dailyCap: 0 }]) {
    const { deps, calls } = fakeDeps({
      rowsByQueryRef: { open_loop_scan: [rowWith([openLoopItem('ol:1', '还没了的事')])] }
    });
    const delivery = createPassiveRecallDelivery(deps, { readGate: async () => g });
    assert.equal(await delivery.deliverOnce(), 'disabled');
    assert.equal(calls.length, 0);
  }
});

test('闸门每拍现读 —— 管理端中途关掉,下一拍就停(不用重启)', async () => {
  const { deps, calls } = fakeDeps({
    rowsByQueryRef: {
      open_loop_scan: [rowWith([openLoopItem('ol:1', 'A'), openLoopItem('ol:2', 'B')])]
    }
  });
  let enabled = true;
  const delivery = createPassiveRecallDelivery(deps, { readGate: async () => ({ enabled, dailyCap: 6 }) });

  assert.equal(await delivery.deliverOnce(), 'delivered');
  assert.equal(calls.length, 1);

  enabled = false; // 运营在管理端翻了开关
  assert.equal(await delivery.deliverOnce(), 'disabled');
  assert.equal(calls.length, 1, '关掉之后不能再多投一条');
});

// open_loop 的 surfaced 项**没有 ref 字段**(真库核查:只有 kind/text/openedTag/ageDays/tier/lead)。
// 要求 ref 会让这条腿一条都投不出去 —— 而且是静默的,看日志只会以为「今天没东西可投」。
// 它自己的冷却就是按承诺正文(recentTexts)去重的,投递侧沿用同一个身份概念。
test('open_loop 没有 ref:按承诺正文当身份,照样投得出去', async () => {
  const { deps, calls } = fakeDeps({
    rowsByQueryRef: {
      open_loop_scan: [rowWith([{
        kind: 'open_loop',
        text: 'not-knowing发了reddit等三天后看结果 between也在等',
        openedTag: '8/3',
        ageDays: 4.3,
        tier: 'active',
        lead: '你之前记过一件还没了的事：not-knowing发了reddit等三天后看结果 between也在等（放了 4 天了）'
      }])]
    }
  });
  const delivery = createPassiveRecallDelivery(deps, gate(true, 6));
  assert.equal(await delivery.deliverOnce(), 'delivered', '没有 ref 不该让这条腿哑掉');
  assert.equal(
    (calls[0].message.rawPayload as Record<string, unknown>).recall_ref,
    'not-knowing发了reddit等三天后看结果 between也在等'
  );
});

// lead 里带「放了 N 天了」,天数每天变。身份若取 lead,同一件事会被天天重投一次。
test('open_loop 身份取 text 不取 lead —— 天数变了也认得出是同一件事', async () => {
  const loop = { kind: 'open_loop', text: '给陈显写信', openedTag: '8/3', tier: 'active' };
  const shared = new Set<string>();
  const day1 = fakeDeps({
    rowsByQueryRef: { open_loop_scan: [rowWith([{ ...loop, ageDays: 4.3, lead: '你之前记过一件还没了的事：给陈显写信（放了 4 天了）' }])] },
    alreadyDelivered: shared
  });
  assert.equal(await createPassiveRecallDelivery(day1.deps, gate(true, 6)).deliverOnce(), 'delivered');

  const day2 = fakeDeps({
    rowsByQueryRef: { open_loop_scan: [rowWith([{ ...loop, ageDays: 5.3, lead: '你之前记过一件还没了的事：给陈显写信（放了 5 天了）' }])] },
    alreadyDelivered: shared
  });
  assert.equal(await createPassiveRecallDelivery(day2.deps, gate(true, 6)).deliverOnce(), 'none', '天数变了不算新记忆');
});

// ── 腿间轮转(2026-08-07 首日活体观察发现)──────────────────────────────────
// 固定优先级下 6 条日额全被 open_loop 吃光,association 一条没轮到 —— 她常年有 20 条开放
// 承诺,那条腿永远有货,排在前面就永远不让位。首发放两条腿、实际只跑一条。
test('轮转:上一条是 open_loop → 这一拍先给 association', async () => {
  const { deps, calls } = fakeDeps({
    todaysKeys: ['recall-surface:open_loop:aaa'],
    rowsByQueryRef: {
      open_loop_scan: [rowWith([openLoopItem('ol:new', '还没了的事')])],
      association_scan: [rowWith([associationItem('as:new', '旧事重提')])]
    }
  });
  const delivery = createPassiveRecallDelivery(deps, gate(true, 6));
  assert.equal(await delivery.deliverOnce(), 'delivered');
  assert.equal((calls[0].message.rawPayload as Record<string, unknown>).recall_leg, 'association');
});

test('轮转:上一条是 association → 这一拍换回 open_loop', async () => {
  const { deps, calls } = fakeDeps({
    todaysKeys: ['recall-surface:association:bbb'],
    rowsByQueryRef: {
      open_loop_scan: [rowWith([openLoopItem('ol:new', '还没了的事')])],
      association_scan: [rowWith([associationItem('as:new', '旧事重提')])]
    }
  });
  const delivery = createPassiveRecallDelivery(deps, gate(true, 6));
  assert.equal(await delivery.deliverOnce(), 'delivered');
  assert.equal((calls[0].message.rawPayload as Record<string, unknown>).recall_leg, 'open_loop');
});

test('轮转不是死等:该轮到的那条腿没货 → 落回另一条,不空投', async () => {
  const { deps, calls } = fakeDeps({
    todaysKeys: ['recall-surface:open_loop:aaa'],
    rowsByQueryRef: {
      open_loop_scan: [rowWith([openLoopItem('ol:new', '还没了的事')])],
      association_scan: [] // association 这轮没扫出东西
    }
  });
  const delivery = createPassiveRecallDelivery(deps, gate(true, 6));
  assert.equal(await delivery.deliverOnce(), 'delivered');
  assert.equal((calls[0].message.rawPayload as Record<string, unknown>).recall_leg, 'open_loop');
});

test('今天还没投过 → 用默认顺序(open_loop 先)', async () => {
  const { deps, calls } = fakeDeps({
    todaysKeys: [],
    rowsByQueryRef: {
      open_loop_scan: [rowWith([openLoopItem('ol:new', '还没了的事')])],
      association_scan: [rowWith([associationItem('as:new', '旧事重提')])]
    }
  });
  const delivery = createPassiveRecallDelivery(deps, gate(true, 6));
  await delivery.deliverOnce();
  assert.equal((calls[0].message.rawPayload as Record<string, unknown>).recall_leg, 'open_loop');
});

test('日额仍按今天已投的键数刹车', async () => {
  const { deps, calls } = fakeDeps({
    todaysKeys: Array.from({ length: 6 }, (_, i) => `recall-surface:open_loop:k${i}`),
    rowsByQueryRef: { open_loop_scan: [rowWith([openLoopItem('ol:1', '还没了的事')])] }
  });
  const delivery = createPassiveRecallDelivery(deps, gate(true, 6));
  assert.equal(await delivery.deliverOnce(), 'capped');
  assert.equal(calls.length, 0);
});


// ── 节奏闸 ────────────────────────────────────────────────────────────────
// 实测 2026-08-08..08-13:24 条投递全部落在 00:07–00:57,一小时烧光日额,其余 23 小时 capped。
// 而 00:00 正是她收尾睡觉的窗口(那几拍的栈里连着六七次 recover_energy「够了。睡了。」),
// 投进去只换来「记着。明天处理。」。下面几条把「摊开 + 避开凌晨」钉成结构性事实。
const east8At = (hour: number) => new Date(Date.UTC(2026, 7, 7, 0, 0, 0) + (hour - 8) * 3600_000);

test('节奏闸:凌晨投不出来(日额归零那一刻也不行)', async () => {
  const { deps, calls } = fakeDeps({
    rowsByQueryRef: { open_loop_scan: [rowWith([openLoopItem('ol:1', '你之前记过一件还没了的事：X')])] }
  });
  const delivery = createPassiveRecallDelivery(deps, gate(true, 6, east8At(0.2)));
  assert.equal(await delivery.deliverOnce(), 'capped');
  assert.equal(calls.length, 0, '00:12 一条都不能投 —— 这正是旧行为烧光日额的那一拍');
});

test('节奏闸:活动窗开始前(08:59)不投,开窗后(09:00)放行第一条', async () => {
  const rows = { open_loop_scan: [rowWith([openLoopItem('ol:1', '你之前记过一件还没了的事：X')])] };
  const before = fakeDeps({ rowsByQueryRef: rows });
  assert.equal(
    await createPassiveRecallDelivery(before.deps, gate(true, 6, east8At(8.98))).deliverOnce(),
    'capped'
  );
  const after = fakeDeps({ rowsByQueryRef: rows });
  assert.equal(
    await createPassiveRecallDelivery(after.deps, gate(true, 6, east8At(9.01))).deliverOnce(),
    'delivered'
  );
});

test('节奏闸:今天已投够这一槽的量 → 等下一槽,不抢跑', async () => {
  const { deps } = fakeDeps({
    rowsByQueryRef: { open_loop_scan: [rowWith([openLoopItem('ol:9', '你之前记过一件还没了的事：Y')])] },
    // 11:20 东八 ≈ 第 1 槽,已投 1 条 → 该等
    todaysKeys: ['recall-surface:association:pad0']
  });
  const delivery = createPassiveRecallDelivery(deps, gate(true, 6, east8At(11.3)));
  assert.equal(await delivery.deliverOnce(), 'capped');
});

test('节奏闸:同样已投 1 条,但到了晚些的槽 → 放行', async () => {
  const { deps, calls } = fakeDeps({
    rowsByQueryRef: { open_loop_scan: [rowWith([openLoopItem('ol:9', '你之前记过一件还没了的事：Y')])] },
    todaysKeys: ['recall-surface:association:pad0']
  });
  const delivery = createPassiveRecallDelivery(deps, gate(true, 6, east8At(16)));
  assert.equal(await delivery.deliverOnce(), 'delivered');
  assert.equal(calls.length, 1);
});

// ── 未做完的承诺可以再提 ──────────────────────────────────────────────────
// 旧行为:幂等挂在 dedupe_key 唯一索引上,对三条腿一视同仁 → 同一段记忆永不重投。
// 但已做完的承诺在 parseOpenLoops 那层(state !== 'open')就被滤掉了,幂等对它们是多余的;
// 幂等实际唯一挡住的是**没做完的**。实测 2026-08-13:29 条 [ ] 未完成里 18 条已投过 →
// 永久不会再被提起,其中两条带硬截止(HWC 8/19、Taper Prime 8/17)。
test('open_loop:搁置跨过重投窗 → 键换一次,同一条没做完的承诺能再提', async () => {
  const mk = (ageDays: number) => ({
    kind: 'open_loop', text: '给James写了信问什么时候知道旧名字不对。等回信。', ageDays,
    lead: `你之前记过一件还没了的事：给James写了信问什么时候知道旧名字不对。等回信。（放了 ${Math.floor(ageDays)} 天了）`
  });
  const first = fakeDeps({ rowsByQueryRef: { open_loop_scan: [rowWith([mk(3)])] } });
  await createPassiveRecallDelivery(first.deps, gate(true, 6)).deliverOnce();
  const keyAt3 = String(first.calls[0].message.dedupeKey);

  const later = fakeDeps({ rowsByQueryRef: { open_loop_scan: [rowWith([mk(10)])] } });
  await createPassiveRecallDelivery(later.deps, gate(true, 6)).deliverOnce();
  const keyAt10 = String(later.calls[0].message.dedupeKey);

  assert.notEqual(keyAt3, keyAt10, '搁置 3 天与 10 天必须落在不同的重投窗');
  assert.match(keyAt3, /:w0$/);
  assert.match(keyAt10, /:w1$/);
});

test('open_loop:同一个重投窗内不重复投(窗内幂等照旧生效)', async () => {
  const mk = (ageDays: number) => ({
    kind: 'open_loop', text: '博友圈提交了RSS。等审核。', ageDays,
    lead: `你之前记过一件还没了的事：博友圈提交了RSS。等审核。（放了 ${Math.floor(ageDays)} 天了）`
  });
  const { deps, calls } = fakeDeps({ rowsByQueryRef: { open_loop_scan: [rowWith([mk(3)])] } });
  await createPassiveRecallDelivery(deps, gate(true, 6)).deliverOnce();
  const { deps: deps2, calls: calls2 } = fakeDeps({
    rowsByQueryRef: { open_loop_scan: [rowWith([mk(5)])] },
    alreadyDelivered: new Set([String(calls[0].message.dedupeKey)])
  });
  assert.equal(await createPassiveRecallDelivery(deps2, gate(true, 6)).deliverOnce(), 'none');
  assert.equal(calls2.length, 1, '入队试过一次,被唯一索引挡下(created=false),不算新投递');
});

test('association 不放松重投:日记条目没有「完成」这个状态,键里不带窗号', async () => {
  const { deps, calls } = fakeDeps({
    rowsByQueryRef: {
      association_scan: [rowWith([{ kind: 'association', ref: '/d/2026-07-23.md#103', ageDays: 21, lead: '21 天前你记过一件事：X' }])]
    }
  });
  await createPassiveRecallDelivery(deps, gate(true, 6)).deliverOnce();
  assert.doesNotMatch(String(calls[0].message.dedupeKey), /:w\d+$/);
});

// ── 投递闸判官 ────────────────────────────────────────────────────────────
// 它坐在投递闸上(一天十几次),不是每次落地 —— 检索侧那 ~985 次/天仍是纯算术。
// 铁律:必须允许它说「一条都不值得」,否则退化成每次必冒。
const judgeOf = (raw: string) => async () => raw;

test('判官挑中的那条被投,而且用的是它写的钩子(不是模板)', async () => {
  const { deps, calls } = fakeDeps({
    todaysKeys: [],
    rowsByQueryRef: {
      open_loop_scan: [rowWith([openLoopItem('ol:1', '模板钩子 A'), openLoopItem('ol:2', '模板钩子 B')])]
    }
  });
  let seenIds: string[] = [];
  const delivery = createPassiveRecallDelivery(deps, {
    ...gate(true, 6),
    judge: async (prompt) => {
      seenIds = [...prompt.user.matchAll(/\[(recall-surface:[^\]]+)\]/g)].map((m) => m[1]);
      return JSON.stringify({ picks: [{ id: seenIds[1], hook: '判官写的一句人话' }] });
    }
  });
  assert.equal(await delivery.deliverOnce(), 'delivered');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].message.bodyForAgent, '判官写的一句人话');
  assert.equal(calls[0].message.dedupeKey, seenIds[1], '投的是判官挑的那条');
});

test('判官说「一条都不值得」→ 静默,不投', async () => {
  const { deps, calls } = fakeDeps({
    todaysKeys: [],
    rowsByQueryRef: { open_loop_scan: [rowWith([openLoopItem('ol:1', '模板钩子')])] }
  });
  const delivery = createPassiveRecallDelivery(deps, { ...gate(true, 6), judge: judgeOf('{"picks":[]}') });
  assert.equal(await delivery.deliverOnce(), 'none');
  assert.equal(calls.length, 0);
});

test('判官挂了 → 退回模板钩子按原顺序投(不打扰她优先于强行判断)', async () => {
  const { deps, calls } = fakeDeps({
    todaysKeys: [],
    rowsByQueryRef: { open_loop_scan: [rowWith([openLoopItem('ol:1', '模板钩子')])] }
  });
  const delivery = createPassiveRecallDelivery(deps, {
    ...gate(true, 6),
    judge: async () => { throw new Error('haiku down'); }
  });
  assert.equal(await delivery.deliverOnce(), 'delivered');
  assert.equal(calls[0].message.bodyForAgent, '模板钩子');
});

test('判官编了不存在的 id → 那条丢掉;但它确实答了,所以按「无可投」静默', async () => {
  const { deps, calls } = fakeDeps({
    todaysKeys: [],
    rowsByQueryRef: { open_loop_scan: [rowWith([openLoopItem('ol:1', '模板钩子')])] }
  });
  const delivery = createPassiveRecallDelivery(deps, {
    ...gate(true, 6),
    judge: judgeOf('{"picks":[{"id":"我编的","hook":"x"}]}')
  });
  // parsed=true 且过滤后为空 → 视同「这次不值得」,静默;不是退回模板。
  assert.equal(await delivery.deliverOnce(), 'none');
  assert.equal(calls.length, 0);
});

test('不注入 judge → 行为与改动前一致', async () => {
  const { deps, calls } = fakeDeps({
    todaysKeys: [],
    rowsByQueryRef: { open_loop_scan: [rowWith([openLoopItem('ol:1', '模板钩子')])] }
  });
  const delivery = createPassiveRecallDelivery(deps, gate(true, 6));
  assert.equal(await delivery.deliverOnce(), 'delivered');
  assert.equal(calls[0].message.bodyForAgent, '模板钩子');
});

// 锚点只能取**向量腿**的 query_text。扫描腿(association_scan / diary_resurface /
// open_loop_scan)写的是 queryText: null —— 不带 queryRef 取最新一条会把锚点喂成空,
// 判官只能瞎判。code review 抓出来的。
test('判官锚点跳过扫描腿的空 queryText,取最近的向量腿落地文本', async () => {
  const shadowRows = [
    { queryRef: 'association_scan', queryText: null, surfaced: [] },
    { queryRef: 'diary_resurface', queryText: null, surfaced: [] },
    { queryRef: 'stack:99', queryText: '她此刻正在做的那件事', surfaced: [] }
  ];
  const deps: RecallDeliveryDeps = {
    async listRecallShadowLog(params) {
      const ref = (params as { queryRef?: unknown }).queryRef;
      if (ref === 'open_loop_scan') {
        return [rowWith([openLoopItem('ol:1', '模板钩子')])];
      }
      if (ref === undefined) return shadowRows; // 锚点查询:不带 queryRef
      return [];
    },
    async listRecentAgentQueueDedupeKeys() { return []; },
    async enqueueAgentQueueMessage() { return { queueId: 1, status: 'pending', created: true }; }
  };
  let seenAnchor = '';
  const delivery = createPassiveRecallDelivery(deps, {
    ...gate(true, 6),
    judge: async (prompt) => { seenAnchor = prompt.user; return '{"picks":[]}'; }
  });
  await delivery.deliverOnce();
  assert.ok(seenAnchor.includes('她此刻正在做的那件事'), `锚点没取到向量腿的文本:${seenAnchor.slice(0, 120)}`);
  assert.ok(!seenAnchor.includes('(拿不到)'), '不该退化成空锚点');
});

test('判官拿得到 ageDays —— 否则它不知道这件事搁了多久', async () => {
  const deps: RecallDeliveryDeps = {
    async listRecallShadowLog(params) {
      const ref = (params as { queryRef?: unknown }).queryRef;
      if (ref === 'open_loop_scan') {
        return [rowWith([{ kind: 'open_loop', text: '给陈显写信', openedTag: '8/3', ageDays: 12.4, tier: 'active', lead: '模板钩子' }])];
      }
      if (ref === undefined) return [{ queryRef: 'stack:1', queryText: '当下', surfaced: [] }];
      return [];
    },
    async listRecentAgentQueueDedupeKeys() { return []; },
    async enqueueAgentQueueMessage() { return { queueId: 1, status: 'pending', created: true }; }
  };
  let seen = '';
  const delivery = createPassiveRecallDelivery(deps, {
    ...gate(true, 6),
    judge: async (prompt) => { seen = prompt.user; return '{"picks":[]}'; }
  });
  await delivery.deliverOnce();
  assert.match(seen, /12 天前/, `prompt 里该带年龄:${seen.slice(0, 160)}`);
});
