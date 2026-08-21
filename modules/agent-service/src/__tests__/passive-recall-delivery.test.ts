import assert from 'node:assert/strict';
import test from 'node:test';

import { createPassiveRecallDelivery, type RecallDeliveryDeps } from '../services/xiaoni-recall-delivery';

// 固定时钟。投递有**时机闸**(活动窗 09:00–23:00 东八),不钉死时钟的话用例会随
// 「现在几点」时绿时红。选 21:00 东八 = 窗内,不干扰非时机用例。
const AT_2100_EAST8 = new Date('2026-08-07T13:00:00Z');

// 开关/日额的唯一真理源是 agent_runtime_control(管理端可改、每拍热读)。测试直接注入闸门值。
const gate = (enabled: boolean, dailyCap: number, now: Date = AT_2100_EAST8) => ({
  readGate: async () => ({ enabled, dailyCap }),
  now: () => now
});

// 被动浮现投递闸。在此之前整条召回链是 shadow-only,这是唯一的出口 —— 所以三件事必须成立:
//   ① 默认 OFF(不给一个「忘了关」的世界线);
//   ② 同一段记忆永远只投一次(dedupeKey = 记忆的 ref,靠 created 标志判,不是靠 status);
//   ③ 判断力缺席时不放量 —— 判官是主闸(它可以说「一条都不值得」),日额只是兜底;
//      判官不在场时退回最小间隔节流,而不是每拍都投(每 10 分钟一拍 = 84 条/天)。

type EnqueueCall = { message: Record<string, unknown>; payload: Record<string, unknown> };

const shadowWrites: Array<Record<string, unknown>> = [];

function fakeDeps(overrides: {
  rowsByQueryRef?: Record<string, unknown[]>;
  deliveredToday?: number;
  alreadyDelivered?: Set<string>;
  // 今天已投的 dedupe_key(新→旧)。日额计数与腿间轮转都从这一份读。
  todaysKeys?: string[];
  // 上一条召回投出去的时刻(毫秒)。只有判官缺席时才被读到。
  lastDeliveredAt?: number;
} = {}) {
  const calls: EnqueueCall[] = [];
  const already = overrides.alreadyDelivered || new Set<string>();
  const deps: RecallDeliveryDeps = {
    async listRecallShadowLog(params) {
      // 落地腿不带 queryRef(它的 queryRef 每次落地都变,推不下去)→ 用 '' 这个键。
      const queryRef = String((params as { queryRef?: unknown }).queryRef || '');
      return (overrides.rowsByQueryRef || {})[queryRef] || [];
    },
    async listRecentAgentQueueDedupeKeys() {
      if (Array.isArray(overrides.todaysKeys)) {
        return overrides.todaysKeys;
      }
      return Array.from({ length: overrides.deliveredToday ?? 0 }, (_, i) => `recall-surface:open_loop:pad${i}`);
    },
    async listRecentAgentQueueDeliveredAt() {
      return overrides.lastDeliveredAt ?? null;
    },
    async insertRecallShadowLog(record) {
      shadowWrites.push(record as Record<string, unknown>);
      return { id: '1' };
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
// 落地腿(file_chunk / peer_message)的 surfaced 形状:lead 是**对象**,身份是 sourceRef。
const landingItem = (sourceRef: string, text: string) => ({
  cos: 0.42, domain: 'self', sourceRef,
  provenance: { kind: 'file_chunk', path: sourceRef.split('#')[0] },
  lead: { kind: 'file_chunk', text, pointer: sourceRef.split('#')[0], privacyScope: 'self_private' }
});
const landingRow = (items: unknown[]) => ({ queryRef: 'stack:123', occurredAt: '2026-08-20T03:00:00Z', surfaced: items });
const associationItem = (ref: string, lead: string) => ({ kind: 'association', ref, lead });

test('闸门读不到 → fail-closed,一条都不投', async () => {
  const { deps, calls } = fakeDeps({
    rowsByQueryRef: { '': [landingRow([landingItem('/x/a.md#1', '你在 /x/a.md 里记过：X')])] }
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
    rowsByQueryRef: { association_scan: [rowWith([associationItem('as:not-knowing', lead)])] }
  });
  const delivery = createPassiveRecallDelivery(deps, gate(true, 6));

  assert.equal(await delivery.deliverOnce(), 'delivered');
  assert.equal(calls.length, 1);
  assert.match(String(calls[0].message.dedupeKey), /^recall-surface:association:[0-9a-f]{32}$/);
  assert.equal((calls[0].message.rawPayload as Record<string, unknown>).recall_ref, 'as:not-knowing');
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
      '': [landingRow([landingItem('/x/a.md#1', 'A'), landingItem('/x/b.md#2', 'B')])],
      association_scan: [rowWith([associationItem('as:1', 'C')])]
    }
  });
  const delivery = createPassiveRecallDelivery(deps, gate(true, 6));
  assert.equal(await delivery.deliverOnce(), 'delivered');
  assert.equal(calls.length, 1);
});

test('同一段记忆永远只投一次:第二拍撞 dedupeKey → created=false → 不算投递', async () => {
  const rows = {
    association_scan: [rowWith([associationItem('as:1', '旧事 A')])]
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
    rowsByQueryRef: { '': [landingRow([landingItem('/x/a.md#1', '手边的材料')])] },
    deliveredToday: 6
  });
  const delivery = createPassiveRecallDelivery(deps, gate(true, 6));
  assert.equal(await delivery.deliverOnce(), 'capped');
  assert.equal(calls.length, 0);
});

test('只投 association / landing 两条腿 —— diary_resurface 等的 queryRef 根本不查', async () => {
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
  // association 推 queryRef;landing 不推(它的 queryRef 每次落地都变)→ 记为 ''。
  assert.deepEqual(queried.sort(), ['', 'association_scan']);
  assert.ok(!queried.includes('open_loop_scan'), '欠账已撤出召回,改走定时指针通知');
  assert.ok(!queried.includes('diary_resurface'), 'diary_event 未合并前不投');
});

test('缺 ref 或缺 lead 的 surfaced 项直接跳过(没有稳定 ref 就没有幂等)', async () => {
  const { deps, calls } = fakeDeps({
    rowsByQueryRef: {
      association_scan: [rowWith([
        { kind: 'association', lead: '', text: '' },
        { kind: 'association', ref: 'as:x' },
        null,
        associationItem('as:good', '两样都全的这条')
      ])]
    }
  });
  const delivery = createPassiveRecallDelivery(deps, gate(true, 6));
  assert.equal(await delivery.deliverOnce(), 'delivered');
  assert.equal(calls.length, 1);
  assert.equal((calls[0].message.rawPayload as Record<string, unknown>).recall_ref, 'as:good');
});

test('闸门关着 → disabled;日额 0 也等同关闭', async () => {
  for (const g of [{ enabled: false, dailyCap: 6 }, { enabled: true, dailyCap: 0 }]) {
    const { deps, calls } = fakeDeps({
      rowsByQueryRef: { '': [landingRow([landingItem('/x/a.md#1', '手边的材料')])] }
    });
    const delivery = createPassiveRecallDelivery(deps, { readGate: async () => g });
    assert.equal(await delivery.deliverOnce(), 'disabled');
    assert.equal(calls.length, 0);
  }
});

test('闸门每拍现读 —— 管理端中途关掉,下一拍就停(不用重启)', async () => {
  const { deps, calls } = fakeDeps({
    rowsByQueryRef: {
      '': [landingRow([landingItem('/x/a.md#1', 'A'), landingItem('/x/b.md#2', 'B')])]
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
test('轮转:上一条是 landing → 这一拍先给 association', async () => {
  const { deps, calls } = fakeDeps({
    todaysKeys: ['recall-surface:landing:aaa'],
    rowsByQueryRef: {
      '': [landingRow([landingItem('/x/n.md#1', '手边的材料')])],
      association_scan: [rowWith([associationItem('as:new', '旧事重提')])]
    }
  });
  const delivery = createPassiveRecallDelivery(deps, gate(true, 6));
  assert.equal(await delivery.deliverOnce(), 'delivered');
  assert.equal((calls[0].message.rawPayload as Record<string, unknown>).recall_leg, 'association');
});

test('轮转:上一条是 association → 这一拍换回 landing', async () => {
  const { deps, calls } = fakeDeps({
    todaysKeys: ['recall-surface:association:bbb'],
    rowsByQueryRef: {
      '': [landingRow([landingItem('/x/n.md#1', '手边的材料')])],
      association_scan: [rowWith([associationItem('as:new', '旧事重提')])]
    }
  });
  const delivery = createPassiveRecallDelivery(deps, gate(true, 6));
  assert.equal(await delivery.deliverOnce(), 'delivered');
  assert.equal((calls[0].message.rawPayload as Record<string, unknown>).recall_leg, 'landing');
});

test('轮转不是死等:该轮到的那条腿没货 → 落回另一条,不空投', async () => {
  const { deps, calls } = fakeDeps({
    todaysKeys: ['recall-surface:landing:aaa'],
    rowsByQueryRef: {
      '': [landingRow([landingItem('/x/n.md#1', '手边的材料')])],
      association_scan: [] // association 这轮没扫出东西
    }
  });
  const delivery = createPassiveRecallDelivery(deps, gate(true, 6));
  assert.equal(await delivery.deliverOnce(), 'delivered');
  assert.equal((calls[0].message.rawPayload as Record<string, unknown>).recall_leg, 'landing');
});

test('今天还没投过 → 用默认顺序(association 先)', async () => {
  const { deps, calls } = fakeDeps({
    todaysKeys: [],
    rowsByQueryRef: {
      '': [landingRow([landingItem('/x/n.md#1', '手边的材料')])],
      association_scan: [rowWith([associationItem('as:new', '旧事重提')])]
    }
  });
  const delivery = createPassiveRecallDelivery(deps, gate(true, 6));
  await delivery.deliverOnce();
  assert.equal((calls[0].message.rawPayload as Record<string, unknown>).recall_leg, 'association');
});

test('日额兜底:判官把量放飞时才拦(不是日常节奏手段)', async () => {
  const { deps, calls } = fakeDeps({
    todaysKeys: Array.from({ length: 6 }, (_, i) => `recall-surface:landing:k${i}`),
    rowsByQueryRef: { '': [landingRow([landingItem('/x/a.md#1', '手边的材料')])] }
  });
  const delivery = createPassiveRecallDelivery(deps, gate(true, 6));
  assert.equal(await delivery.deliverOnce(), 'capped');
  assert.equal(calls.length, 0);
});


// ── 时机闸 ────────────────────────────────────────────────────────────────
// 实测 2026-08-08..08-13:24 条投递全部落在 00:07–00:57,而 00:00 正是她收尾睡觉的窗口
// (那几拍的栈里连着六七次 recover_energy「够了。睡了。」),投进去只换来「记着。明天处理。」。
// 这一闸挡的是**时机**,不是数量 —— 数量由判官决定。
const east8At = (hour: number) => new Date(Date.UTC(2026, 7, 7, 0, 0, 0) + (hour - 8) * 3600_000);

test('时机闸:凌晨一条都不投(她在收尾睡觉)', async () => {
  const { deps, calls } = fakeDeps({
    rowsByQueryRef: { '': [landingRow([landingItem('/x/a.md#1', '你在 /x/a.md 里记过：X')])] }
  });
  const delivery = createPassiveRecallDelivery(deps, gate(true, 6, east8At(0.2)));
  assert.equal(await delivery.deliverOnce(), 'capped');
  assert.equal(calls.length, 0, '00:12 一条都不能投 —— 这正是旧行为烧光日额的那一拍');
});

test('时机闸:活动窗开始前(08:59)不投,开窗后(09:00)放行', async () => {
  const rows = { '': [landingRow([landingItem('/x/a.md#1', '你在 /x/a.md 里记过：X')])] };
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

test('窗内已投过几条也照投 —— 量归判官管,不按槽位摊开', async () => {
  const { deps, calls } = fakeDeps({
    rowsByQueryRef: { '': [landingRow([landingItem('/x/y.md#9', '你在 /x/y.md 里记过：Y')])] },
    todaysKeys: ['recall-surface:association:pad0']
  });
  const delivery = createPassiveRecallDelivery(deps, gate(true, 25, east8At(11.3)));
  assert.equal(await delivery.deliverOnce(), 'delivered');
  assert.equal(calls.length, 1);
});

// ── 判断力缺席时的兜底节流 ────────────────────────────────────────────────
// 判官是主闸。它不在场(没注入)或没答上来时,不能退化成「每拍都投」——
// supervisor 每 10 分钟一拍,活动窗 14 小时 = 84 拍。
test('判官不在场 + 上一条刚投出去不久 → 不投', async () => {
  const { deps, calls } = fakeDeps({
    rowsByQueryRef: { '': [landingRow([landingItem('/x/y.md#9', '你在 /x/y.md 里记过：Y')])] },
    lastDeliveredAt: east8At(16).getTime() - 20 * 60_000
  });
  const delivery = createPassiveRecallDelivery(deps, gate(true, 25, east8At(16)));
  assert.equal(await delivery.deliverOnce(), 'none');
  assert.equal(calls.length, 0);
});

test('判官不在场 + 上一条已经隔了足够久 → 放行', async () => {
  const { deps, calls } = fakeDeps({
    rowsByQueryRef: { '': [landingRow([landingItem('/x/y.md#9', '你在 /x/y.md 里记过：Y')])] },
    lastDeliveredAt: east8At(16).getTime() - 3 * 3600_000
  });
  const delivery = createPassiveRecallDelivery(deps, gate(true, 25, east8At(16)));
  assert.equal(await delivery.deliverOnce(), 'delivered');
  assert.equal(calls.length, 1);
});

test('判官答上来了就不受兜底间隔约束 —— 该说不值得的是它,不是间隔', async () => {
  const { deps, calls } = fakeDeps({
    rowsByQueryRef: { '': [landingRow([landingItem('/x/y.md#9', '你在 /x/y.md 里记过：Y')])] },
    lastDeliveredAt: east8At(16).getTime() - 60_000
  });
  const delivery = createPassiveRecallDelivery(deps, {
    ...gate(true, 25, east8At(16)),
    judge: async () => JSON.stringify({ picks: [{ id: 1, hook: '判官挑的那条' }] })
  });
  assert.equal(await delivery.deliverOnce(), 'delivered');
  assert.equal(calls.length, 1);
});

// ── 未做完的承诺可以再提 ──────────────────────────────────────────────────
// 旧行为:幂等挂在 dedupe_key 唯一索引上,对三条腿一视同仁 → 同一段记忆永不重投。
// 但已做完的承诺在 parseOpenLoops 那层(state !== 'open')就被滤掉了,幂等对它们是多余的;
// 幂等实际唯一挡住的是**没做完的**。实测 2026-08-13:29 条 [ ] 未完成里 18 条已投过 →
// 永久不会再被提起,其中两条带硬截止(HWC 8/19、Taper Prime 8/17)。
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
  shadowWrites.length = 0;
  const { deps, calls } = fakeDeps({
    todaysKeys: [],
    rowsByQueryRef: {
      '': [landingRow([landingItem('/x/a.md#1', '模板钩子 A'), landingItem('/x/b.md#2', '模板钩子 B')])]
    }
  });
  // 判官回的是**序号**(prompt 里给的就是序号,不是真 id)。真 id 从它自己的留痕里读回来。
  const delivery = createPassiveRecallDelivery(deps, {
    ...gate(true, 6),
    judge: async () => JSON.stringify({ picks: [{ id: 2, hook: '判官写的一句人话' }] })
  });
  assert.equal(await delivery.deliverOnce(), 'delivered');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].message.bodyForAgent, '判官写的一句人话');
  const judged = shadowWrites.filter((r) => r.queryRef === 'delivery_judge').pop();
  const candidateIds = ((judged!.llmWork as { candidates: Array<{ id: string }> }).candidates).map((c) => c.id);
  assert.equal(calls[0].message.dedupeKey, candidateIds[1], '投的是判官挑的那条(序号 2 = 第二条)');
});

test('判官说「一条都不值得」→ 静默,不投', async () => {
  const { deps, calls } = fakeDeps({
    todaysKeys: [],
    rowsByQueryRef: { '': [landingRow([landingItem('/x/a.md#1', '模板钩子')])] }
  });
  const delivery = createPassiveRecallDelivery(deps, { ...gate(true, 6), judge: judgeOf('{"picks":[]}') });
  assert.equal(await delivery.deliverOnce(), 'none');
  assert.equal(calls.length, 0);
});

test('判官挂了 → 退回模板钩子按原顺序投(不打扰她优先于强行判断)', async () => {
  const { deps, calls } = fakeDeps({
    todaysKeys: [],
    rowsByQueryRef: { '': [landingRow([landingItem('/x/a.md#1', '模板钩子')])] }
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
    rowsByQueryRef: { '': [landingRow([landingItem('/x/a.md#1', '模板钩子')])] }
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
    rowsByQueryRef: { '': [landingRow([landingItem('/x/a.md#1', '模板钩子')])] }
  });
  const delivery = createPassiveRecallDelivery(deps, gate(true, 6));
  assert.equal(await delivery.deliverOnce(), 'delivered');
  assert.equal(calls[0].message.bodyForAgent, '模板钩子');
});

// 锚点只能取**向量腿**的 query_text。扫描腿(association_scan / diary_resurface /
// open_loop_scan)写的是 queryText: null —— 不带 queryRef 取最新一条会把锚点喂成空,
// 判官只能瞎判。code review 抓出来的。
test('判官锚点跳过扫描腿的空 queryText,取最近的向量腿落地文本', async () => {
  // 扫描腿(association_scan / diary_resurface)写 queryText: null。不带 queryRef 取最新
  // 一条会把锚点喂成空,判官只能瞎判。锚点必须来自向量腿(`stack:` 前缀)。
  const anchorRows = [
    { queryRef: 'association_scan', queryText: null, surfaced: [] },
    { queryRef: 'diary_resurface', queryText: null, surfaced: [] },
    { queryRef: 'stack:99', queryText: '她此刻正在做的那件事', surfaced: [landingItem('/x/a.md#1', '模板钩子')] }
  ];
  const deps: RecallDeliveryDeps = {
    async listRecallShadowLog(params) {
      // 落地腿和锚点查询都不带 queryRef;association 腿带。
      return (params as { queryRef?: unknown }).queryRef === undefined ? anchorRows : [];
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
  assert.ok(seenAnchor.includes('她此刻正在做的那件事'), `锚点没取到向量腿的文本:${seenAnchor.slice(0, 140)}`);
  assert.ok(!seenAnchor.includes('(拿不到)'), '不该退化成空锚点');
});

test('判官拿得到 ageDays —— 否则它不知道这件事搁了多久', async () => {
  const rows = [{
    queryRef: 'stack:1',
    queryText: '当下',
    surfaced: [{ ...landingItem('/x/a.md#1', '一段旧材料'), ageDays: 12.4 }]
  }];
  const deps: RecallDeliveryDeps = {
    async listRecallShadowLog(params) {
      return (params as { queryRef?: unknown }).queryRef === undefined ? rows : [];
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
  assert.match(seen, /12 天前/, `prompt 里该带年龄:${seen.slice(0, 180)}`);
});

// 落地腿的判据是「**不是**扫描腿写的」,不是「以 stack: 开头」。白名单版本实测漏掉近 7 天
// 766 条落地留痕(140 条有浮现):入站消息触发的召回写 `inbound:<id>` / `queue:<id>`,
// landedRef 拿不到时还会写 NULL —— 而「别人刚说的话勾起她一段回忆」正是这条腿最该服务的。
test('落地腿收下 inbound: / queue: / NULL 这些非扫描腿的留痕', async () => {
  for (const ref of ['inbound:34359', 'queue:42944', null]) {
    const { deps, calls } = fakeDeps({
      todaysKeys: [],
      rowsByQueryRef: {
        '': [{ queryRef: ref, occurredAt: null, surfaced: [landingItem('/x/a.md#1', '该被投的那条')] }]
      }
    });
    // eslint-disable-next-line no-await-in-loop
    const out = await createPassiveRecallDelivery(deps, gate(true, 6)).deliverOnce();
    assert.equal(out, 'delivered', `queryRef=${String(ref)} 该被收下`);
    assert.equal(calls.length, 1);
  }
});

test('落地腿仍然排除扫描腿的留痕', async () => {
  for (const ref of ['association_scan', 'diary_resurface', 'open_loop_scan']) {
    const { deps, calls } = fakeDeps({
      todaysKeys: [],
      rowsByQueryRef: {
        '': [{ queryRef: ref, occurredAt: null, surfaced: [landingItem('/x/b.md#1', '不该走落地腿的')] }]
      }
    });
    // eslint-disable-next-line no-await-in-loop
    assert.equal(await createPassiveRecallDelivery(deps, gate(true, 6)).deliverOnce(), 'none', ref);
    assert.equal(calls.length, 0);
  }
});

// 判官只看得到前 N 条。若候选里混着今天已投过的,它可能挑中那条 → ordered 只剩它 →
// enqueue created=false → 整拍空转,而判官之前的行为是继续往下走候选。
test('已投过的候选在交给判官之前就剔掉 —— 判官不该被喂已投的', async () => {
  const already = landingItem('/x/old.md#1', '今天已经投过的');
  const fresh = landingItem('/x/new.md#1', '还没投过的');
  const { deps, calls } = fakeDeps({
    rowsByQueryRef: { '': [landingRow([already, fresh])] }
  });
  // 先算出 already 的 dedupeKey,塞进「今天已投」
  const probe = fakeDeps({ todaysKeys: [], rowsByQueryRef: { '': [landingRow([already])] } });
  await createPassiveRecallDelivery(probe.deps, gate(true, 6)).deliverOnce();
  const alreadyKey = String(probe.calls[0].message.dedupeKey);

  const { deps: d2, calls: c2 } = fakeDeps({
    todaysKeys: [alreadyKey],
    rowsByQueryRef: { '': [landingRow([already, fresh])] }
  });
  const delivery = createPassiveRecallDelivery(d2, {
    ...gate(true, 6),
    judge: async () => JSON.stringify({ picks: [{ id: 1, hook: '判官挑的' }] })
  });
  assert.equal(await delivery.deliverOnce(), 'delivered');
  const judged2 = shadowWrites.filter((r) => r.queryRef === 'delivery_judge').pop();
  const seenIds = ((judged2!.llmWork as { candidates: Array<{ id: string }> }).candidates).map((c) => c.id);
  assert.ok(!seenIds.includes(alreadyKey), '已投过的不该进判官的候选');
  assert.equal(c2.length, 1);
  void calls;
});

// 判官走 /api/internal/llm/debug,那条路径**不落 llm_request_slices**
// (2026-08-21 核查:近 3 天 5264 条 slice 全是 opus-4-6,一条 Haiku 都没有)。
// 不主动留痕,管理端就完全看不见它判了什么、为什么没投。
test('判官的工作内容写进 shadow log(含它看过但没挑的)', async () => {
  shadowWrites.length = 0;
  const a = landingItem('/x/a.md#1', '候选甲');
  const b = landingItem('/x/b.md#1', '候选乙');
  const { deps } = fakeDeps({
    todaysKeys: [],
    rowsByQueryRef: { '': [landingRow([a, b])] }
  });
  const delivery = createPassiveRecallDelivery(deps, {
    ...gate(true, 6),
    judge: async () => JSON.stringify({ picks: [{ id: 1, hook: '判官写的钩子' }] })
  });
  await delivery.deliverOnce();

  const row = shadowWrites.find((r) => r.queryRef === 'delivery_judge');
  assert.ok(row, '应写一条 delivery_judge 的 shadow 行');
  assert.equal(
    new Date(row!.occurredAt as string | number | Date).getTime(),
    AT_2100_EAST8.getTime(),
    '判官这一行必须带真实时刻 —— 不给的话 store 落纪元占位,管理端全堆在 1970'
  );
  const work = row!.llmWork as Record<string, unknown>;
  assert.equal(work.kind, 'judge');
  assert.equal((work.picks as unknown[]).length, 1);
  assert.equal((work.candidates as unknown[]).length, 2, '看过的候选都要记');
  assert.ok(typeof work.raw === 'string' && (work.raw as string).length > 0, '模型原文要留');
  // 「为什么没投这条」靠 droppedSample 才看得见
  const skipped = row!.droppedSample as Array<Record<string, unknown>>;
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].verdict, 'judge_skipped');
});

test('判官说「一条都不值得」也留痕 —— 静默不能是隐形的', async () => {
  shadowWrites.length = 0;
  const { deps } = fakeDeps({
    todaysKeys: [],
    rowsByQueryRef: { '': [landingRow([landingItem('/x/a.md#1', '候选')])] }
  });
  await createPassiveRecallDelivery(deps, { ...gate(true, 6), judge: async () => '{"picks":[]}' }).deliverOnce();
  const row = shadowWrites.find((r) => r.queryRef === 'delivery_judge');
  assert.ok(row, '判了没投也要有行');
  assert.equal(row!.silent, true);
  assert.equal((row!.droppedCounts as Record<string, number>).picked, 0);
});
