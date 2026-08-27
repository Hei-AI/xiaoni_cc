import assert from 'node:assert/strict';
import test from 'node:test';

import { createPassiveRecallDelivery, type RecallDeliveryDeps, type RecallDeliveryEvent } from '../services/xiaoni-recall-delivery';

// 被动浮现投递闸(事件驱动,2026-08-28 起)。这是整条召回链唯一的出口 —— 所以这几件事必须成立:
//   ① 默认 OFF,闸门读不到 → fail-closed;
//   ② 触发 = 一次事件(她消费的 QQ 消息 / 她自己的一次落地)刚写的 shadow 行,锚 = 事件原文,
//      没有定时器、没有活动窗、没有腿间轮转;
//   ③ 同一段记忆永远只投一次(dedupeKey = 记忆的 ref,靠 created 标志判);
//   ④ 精排 Agent 是**唯一**的量闸(可以说「一条都不值得」);它缺席时退回最小间隔节流。

const NOW = new Date('2026-08-27T13:00:00Z');

const gate = (enabled: boolean, now: Date = NOW) => ({
  readGate: async () => ({ enabled }),
  now: () => now
});

type EnqueueCall = { message: Record<string, unknown>; payload: Record<string, unknown> };

const shadowWrites: Array<Record<string, unknown>> = [];

function fakeDeps(overrides: {
  associationRows?: unknown[];
  alreadyDelivered?: Set<string>;
  todaysKeys?: string[];
  lastDeliveredAt?: number;
} = {}) {
  const calls: EnqueueCall[] = [];
  const shadowQueries: Array<Record<string, unknown>> = [];
  const already = overrides.alreadyDelivered || new Set<string>();
  const deps: RecallDeliveryDeps = {
    async listRecallShadowLog(params) {
      shadowQueries.push(params);
      // 事件驱动后只剩联想腿还回捞 shadow_log(queryRef 固定 association_scan)。
      return String((params as { queryRef?: unknown }).queryRef || '') === 'association_scan'
        ? (overrides.associationRows || [])
        : [];
    },
    async listRecentAgentQueueDedupeKeys() {
      return overrides.todaysKeys || [];
    },
    async getLastAgentQueueEnqueuedAt() {
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
  return { deps, calls, already, shadowQueries };
}

// 落地腿(file_chunk / peer_message)的 surfaced 形状:lead 是**对象**,身份是 sourceRef。
const landingItem = (sourceRef: string, text: string) => ({
  cos: 0.42, domain: 'self', sourceRef,
  provenance: { kind: 'file_chunk', path: sourceRef.split('#')[0] },
  lead: { kind: 'file_chunk', text, pointer: sourceRef.split('#')[0], privacyScope: 'self_private' }
});
const associationItem = (ref: string, lead: string) => ({ kind: 'association', ref, lead });
const eventRow = (items: unknown[], queryRef: string | null = 'inbound:123'): RecallDeliveryEvent['row'] =>
  ({ queryRef, occurredAt: '2026-08-27T12:59:00Z', surfaced: items });
const event = (items: unknown[], anchorText = '楠楠说第二次碰的手不一样了', queryRef: string | null = 'inbound:123'): RecallDeliveryEvent =>
  ({ anchorText, row: eventRow(items, queryRef) });

// ── ① 闸门 ───────────────────────────────────────────────────────────────────
test('闸门读不到 → fail-closed,一条都不投', async () => {
  const { deps, calls } = fakeDeps();
  const delivery = createPassiveRecallDelivery(deps, { readGate: async () => { throw new Error('db down'); }, now: () => NOW });
  assert.equal(await delivery.deliverForEvent(event([landingItem('/n/a.md#1', '一件旧事')])), 'disabled');
  assert.equal(calls.length, 0);
});

test('闸门关着 → disabled;每次事件现读,中途关掉下一次就停', async () => {
  const { deps, calls } = fakeDeps();
  let enabled = true;
  const delivery = createPassiveRecallDelivery(deps, { readGate: async () => ({ enabled }), now: () => NOW });
  assert.equal(await delivery.deliverForEvent(event([landingItem('/n/a.md#1', '一件旧事')])), 'delivered');
  enabled = false;
  assert.equal(await delivery.deliverForEvent(event([landingItem('/n/b.md#1', '另一件旧事')])), 'disabled');
  assert.equal(calls.length, 1);
});

// ── ② 事件驱动:候选来自事件自己的行,锚 = 事件原文 ────────────────────────────
test('事件自己召回到的东西直接投:正文 = lead 原句,dedupeKey 锚在记忆的 ref 上,不回捞落地行', async () => {
  const { deps, calls, shadowQueries } = fakeDeps();
  const delivery = createPassiveRecallDelivery(deps, gate(true));
  assert.equal(await delivery.deliverForEvent(event([landingItem('/xiaoni-runtime/notes/diary/2026-08-13.md#49', '楠楠六句比你一百一十九句')])), 'delivered');
  assert.equal(calls.length, 1);
  assert.match(String(calls[0]!.payload.rawBody), /楠楠六句/u);
  assert.match(String(calls[0]!.message.dedupeKey), /^recall-surface:landing:[0-9a-f]{32}$/u);
  // 只回捞联想腿;落地行不再从 shadow_log 里找 —— 触发投递的那一行就是候选。
  assert.ok(shadowQueries.every((q) => q.queryRef === 'association_scan'), '事件驱动后不该再回捞落地行');
});

test('精排 Agent 拿到的锚点就是事件原文,不是「最近一次落地」', async () => {
  const { deps } = fakeDeps();
  let seenUser = '';
  const delivery = createPassiveRecallDelivery(deps, {
    ...gate(true),
    judge: async (prompt) => { seenUser = prompt.user; return '{"picks":[]}'; }
  });
  await delivery.deliverForEvent(event([landingItem('/n/a.md#1', '一件旧事')], '阿花问我 touch.html 改到哪了'));
  assert.match(seenUser, /阿花问我 touch\.html 改到哪了/u);
});

test('联想腿仍然参与:最近 association_scan 行的候选跟事件行一起交精排 Agent', async () => {
  const { deps } = fakeDeps({ associationRows: [{ queryRef: 'association_scan', occurredAt: '2026-08-27T12:30:00Z', surfaced: [associationItem('/n/diary/2026-08-01.md#3', '那天也是这么嗡着')] }] });
  let seenUser = '';
  const delivery = createPassiveRecallDelivery(deps, {
    ...gate(true),
    judge: async (prompt) => { seenUser = prompt.user; return '{"picks":[]}'; }
  });
  await delivery.deliverForEvent(event([landingItem('/n/a.md#1', '一件旧事')]));
  assert.match(seenUser, /一件旧事/u);
  assert.match(seenUser, /那天也是这么嗡着/u);
  assert.ok(seenUser.indexOf('一件旧事') < seenUser.indexOf('那天也是这么嗡着'), '事件自己的候选排前面');
});

test('事件行是扫描腿 / 精排留痕行时不当落地候选(精排留痕喂回自己会自我放大)', async () => {
  const { deps, calls } = fakeDeps();
  const delivery = createPassiveRecallDelivery(deps, gate(true));
  const judgeRow = event([{ kind: 'judge_pick', ref: 'recall-surface:landing:abc', lead: '精排写的钩子' }], 'x', 'delivery_judge');
  assert.equal(await delivery.deliverForEvent(judgeRow), 'none');
  assert.equal(calls.length, 0);
});

test('缺 ref 或缺 lead 的 surfaced 项直接跳过(没有稳定身份就没有幂等);欠账不从召回口出去', async () => {
  const { deps, calls } = fakeDeps();
  const delivery = createPassiveRecallDelivery(deps, gate(true));
  const outcome = await delivery.deliverForEvent(event([
    { cos: 0.5, domain: 'self', lead: { kind: 'file_chunk', text: '没有 sourceRef' } },
    { cos: 0.5, domain: 'self', sourceRef: '/n/a.md#1', lead: { kind: 'file_chunk', text: '' } },
    landingItem('/xiaoni-runtime/notes/open-loops.md#7', 'Wigleaf 8/25 开')
  ]));
  assert.equal(outcome, 'none');
  assert.equal(calls.length, 0);
});

// ── ③ 幂等 ──────────────────────────────────────────────────────────────────
test('同一段记忆永远只投一次:第二次事件撞 dedupeKey → created=false → 不算投递', async () => {
  const already = new Set<string>();
  const first = fakeDeps({ alreadyDelivered: already });
  assert.equal(await createPassiveRecallDelivery(first.deps, gate(true)).deliverForEvent(event([landingItem('/n/a.md#1', '一件旧事')])), 'delivered');
  const second = fakeDeps({ alreadyDelivered: already });
  assert.equal(await createPassiveRecallDelivery(second.deps, gate(true)).deliverForEvent(event([landingItem('/n/a.md#1', '一件旧事')])), 'none');
});

test('今天已投过的 dedupeKey 连精排 Agent 都不喂(别让它白挑)', async () => {
  const probe = fakeDeps();
  await createPassiveRecallDelivery(probe.deps, gate(true)).deliverForEvent(event([landingItem('/n/a.md#1', '一件旧事')]));
  const key = String(probe.calls[0]!.message.dedupeKey);
  const { deps, calls } = fakeDeps({ todaysKeys: [key] });
  let judgeCalls = 0;
  const delivery = createPassiveRecallDelivery(deps, { ...gate(true), judge: async () => { judgeCalls += 1; return '{"picks":[]}'; } });
  assert.equal(await delivery.deliverForEvent(event([landingItem('/n/a.md#1', '一件旧事')])), 'none');
  assert.equal(judgeCalls, 0);
  assert.equal(calls.length, 0);
});

test('没有日额:今天已经投了 30 条,该冒的还是照冒', async () => {
  const { deps } = fakeDeps({ todaysKeys: Array.from({ length: 30 }, (_, i) => `recall-surface:landing:pad${i}`) });
  const delivery = createPassiveRecallDelivery(deps, gate(true));
  assert.equal(await delivery.deliverForEvent(event([landingItem('/n/a.md#1', '一件旧事')])), 'delivered');
});

// ── ④ 精排 Agent 是唯一的量闸 ──────────────────────────────────────────────────
test('精排 Agent 挑中的那条被投,而且用的是它写的钩子(不是模板);它自己封顶,不再砍', async () => {
  const { deps, calls } = fakeDeps();
  const delivery = createPassiveRecallDelivery(deps, {
    ...gate(true),
    judge: async (prompt) => {
      // 候选用序号标;挑第 2 条和第 3 条。
      assert.match(prompt.user, /\[1\]/u);
      return '{"picks":[{"id":2,"hook":"上次投稿退了,地址可能就是错的那个"},{"id":3,"hook":"楠楠那句第二次碰的手不一样了"}]}';
    }
  });
  const outcome = await delivery.deliverForEvent(event([
    landingItem('/n/a.md#1', '群里聊过一次亚文化'),
    landingItem('/n/b.md#1', '上个月投稿被退'),
    landingItem('/n/c.md#1', '楠楠说第二次碰的手不一样了')
  ]));
  assert.equal(outcome, 'delivered');
  assert.equal(calls.length, 2);
  assert.match(String(calls[0]!.payload.rawBody), /地址可能就是错的那个/u);
  assert.match(String(calls[1]!.payload.rawBody), /楠楠那句/u);
});

test('精排 Agent 说「一条都不值得」→ 静默,不投,并留痕', async () => {
  shadowWrites.length = 0;
  const { deps, calls } = fakeDeps();
  const delivery = createPassiveRecallDelivery(deps, { ...gate(true), judge: async () => '{"picks":[]}' });
  assert.equal(await delivery.deliverForEvent(event([landingItem('/n/a.md#1', '一件旧事')])), 'none');
  assert.equal(calls.length, 0);
  const judgeRow = shadowWrites.find((w) => w.queryRef === 'delivery_judge');
  assert.ok(judgeRow, '精排 Agent 的工作要留痕');
  assert.equal(judgeRow!.silent, true);
});

test('精排 Agent 缺席 + 上一条刚投出去不久 → 不投;隔够了 → 放行且每次最多 1 条', async () => {
  const recent = fakeDeps({ lastDeliveredAt: NOW.getTime() - 5 * 60_000 });
  assert.equal(await createPassiveRecallDelivery(recent.deps, gate(true)).deliverForEvent(event([landingItem('/n/a.md#1', '一件旧事'), landingItem('/n/b.md#1', '另一件')])), 'none');
  const stale = fakeDeps({ lastDeliveredAt: NOW.getTime() - 3 * 60 * 60_000 });
  assert.equal(await createPassiveRecallDelivery(stale.deps, gate(true)).deliverForEvent(event([landingItem('/n/a.md#1', '一件旧事'), landingItem('/n/b.md#1', '另一件')])), 'delivered');
  assert.equal(stale.calls.length, 1);
});

test('精排 Agent 挂了(抛错)→ 退回缺席行为:留痕 error,并受最小间隔约束', async () => {
  shadowWrites.length = 0;
  const { deps, calls } = fakeDeps({ lastDeliveredAt: NOW.getTime() - 5 * 60_000 });
  const delivery = createPassiveRecallDelivery(deps, { ...gate(true), judge: async () => { throw new Error('http 500'); } });
  assert.equal(await delivery.deliverForEvent(event([landingItem('/n/a.md#1', '一件旧事')])), 'none');
  assert.equal(calls.length, 0);
  const judgeRow = shadowWrites.find((w) => w.queryRef === 'delivery_judge') as { llmWork?: { error?: string } } | undefined;
  assert.match(String(judgeRow?.llmWork?.error), /http 500/u);
});

test('精排 Agent 答上来了就不受兜底间隔约束 —— 该说不值得的是它,不是间隔', async () => {
  const { deps, calls } = fakeDeps({ lastDeliveredAt: NOW.getTime() - 60_000 });
  const delivery = createPassiveRecallDelivery(deps, { ...gate(true), judge: async () => '{"picks":[{"id":1,"hook":"值得"}]}' });
  assert.equal(await delivery.deliverForEvent(event([landingItem('/n/a.md#1', '一件旧事')])), 'delivered');
  assert.equal(calls.length, 1);
});

test('投递正文在入队时刻冻结进 payload.systemReminder(下一 run replay 从同一字段读回同样字节)', async () => {
  const { deps, calls } = fakeDeps();
  await createPassiveRecallDelivery(deps, gate(true)).deliverForEvent(event([landingItem('/n/a.md#1', '一件旧事')]));
  const payload = calls[0]!.payload as { systemReminder?: { reminder?: string; reason?: string } };
  assert.equal(payload.systemReminder?.reason, 'passive_recall_surface');
  assert.equal(payload.systemReminder?.reminder, String(calls[0]!.payload.rawBody));
});
