import assert from 'node:assert/strict';
import test from 'node:test';

import { createPassiveRecallDelivery, type RecallDeliveryDeps } from '../services/xiaoni-recall-delivery';

// 被动浮现投递闸。在此之前整条召回链是 shadow-only,这是唯一的出口 —— 所以三件事必须成立:
//   ① 默认 OFF(不给一个「忘了关」的世界线);
//   ② 同一段记忆永远只投一次(dedupeKey = 记忆的 ref,靠 created 标志判,不是靠 status);
//   ③ 日额是硬闸(notify 会唤醒主 loop,量失控 = 她被记忆刷屏)。

type EnqueueCall = { message: Record<string, unknown>; payload: Record<string, unknown> };

function fakeDeps(overrides: {
  rowsByQueryRef?: Record<string, unknown[]>;
  deliveredToday?: number;
  alreadyDelivered?: Set<string>;
} = {}) {
  const calls: EnqueueCall[] = [];
  const already = overrides.alreadyDelivered || new Set<string>();
  const deps: RecallDeliveryDeps = {
    async listRecallShadowLog(params) {
      const queryRef = String((params as { queryRef?: unknown }).queryRef || '');
      return (overrides.rowsByQueryRef || {})[queryRef] || [];
    },
    async countAgentQueueMessagesByDedupePrefix() {
      return overrides.deliveredToday ?? 0;
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

test('默认 OFF:不显式打开就什么都不投', async () => {
  const { deps, calls } = fakeDeps({
    rowsByQueryRef: { open_loop_scan: [rowWith([openLoopItem('ol:1', '你之前记过一件还没了的事：X')])] }
  });
  const delivery = createPassiveRecallDelivery(deps); // 不传 enabled → 走 env,默认 false
  assert.equal(await delivery.deliverOnce(), 'disabled');
  assert.equal(calls.length, 0, '关着的时候一条都不能入队');
});

test('打开后投一条:正文 = lead 原句,dedupeKey 锚在记忆的 ref 上', async () => {
  const lead = '你之前记过一件还没了的事：not-knowing发了reddit等三天后看结果（放了 4 天了）';
  const { deps, calls } = fakeDeps({
    rowsByQueryRef: { open_loop_scan: [rowWith([openLoopItem('ol:not-knowing', lead)])] }
  });
  const delivery = createPassiveRecallDelivery(deps, { enabled: true, dailyCap: 6 });

  assert.equal(await delivery.deliverOnce(), 'delivered');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].message.dedupeKey, 'recall-surface:open_loop:ol:not-knowing');
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
  const delivery = createPassiveRecallDelivery(deps, { enabled: true, dailyCap: 6 });
  assert.equal(await delivery.deliverOnce(), 'delivered');
  assert.equal(calls.length, 1);
});

test('同一段记忆永远只投一次:第二拍撞 dedupeKey → created=false → 不算投递', async () => {
  const rows = {
    open_loop_scan: [rowWith([openLoopItem('ol:1', '还没了的事 A')])]
  };
  const shared = new Set<string>();
  const first = fakeDeps({ rowsByQueryRef: rows, alreadyDelivered: shared });
  const d1 = createPassiveRecallDelivery(first.deps, { enabled: true, dailyCap: 6 });
  assert.equal(await d1.deliverOnce(), 'delivered');

  // 同一份 shadow 行再来一拍(supervisor 每 10min 一跳,shadow 行还在窗口里)。
  const second = fakeDeps({ rowsByQueryRef: rows, alreadyDelivered: shared });
  const d2 = createPassiveRecallDelivery(second.deps, { enabled: true, dailyCap: 6 });
  assert.equal(await d2.deliverOnce(), 'none', '已投过的记忆不该再投一次');
});

test('日额是硬闸:今天投满了就停', async () => {
  const { deps, calls } = fakeDeps({
    rowsByQueryRef: { open_loop_scan: [rowWith([openLoopItem('ol:1', '还没了的事')])] },
    deliveredToday: 6
  });
  const delivery = createPassiveRecallDelivery(deps, { enabled: true, dailyCap: 6 });
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
    async countAgentQueueMessagesByDedupePrefix() { return 0; },
    async enqueueAgentQueueMessage() { return { queueId: 1, status: 'pending', created: true }; }
  };
  const delivery = createPassiveRecallDelivery(deps, { enabled: true, dailyCap: 6 });
  await delivery.deliverOnce();
  assert.deepEqual(queried.sort(), ['association_scan', 'open_loop_scan']);
  assert.ok(!queried.includes('diary_resurface'), 'diary_event 唯一率 12.8%,不在首发名单');
});

test('缺 ref 或缺 lead 的 surfaced 项直接跳过(没有稳定 ref 就没有幂等)', async () => {
  const { deps, calls } = fakeDeps({
    rowsByQueryRef: {
      open_loop_scan: [rowWith([
        { kind: 'open_loop', lead: '有正文但没 ref' },
        { kind: 'open_loop', ref: 'ol:x' },
        null,
        openLoopItem('ol:good', '两样都全的这条')
      ])]
    }
  });
  const delivery = createPassiveRecallDelivery(deps, { enabled: true, dailyCap: 6 });
  assert.equal(await delivery.deliverOnce(), 'delivered');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].message.dedupeKey, 'recall-surface:open_loop:ol:good');
});

test('承诺腿优先于联想腿(还没了的事比旧事重提更该说)', async () => {
  const { deps, calls } = fakeDeps({
    rowsByQueryRef: {
      open_loop_scan: [rowWith([openLoopItem('ol:1', '还没了的事')])],
      association_scan: [rowWith([associationItem('as:1', '旧事重提')])]
    }
  });
  const delivery = createPassiveRecallDelivery(deps, { enabled: true, dailyCap: 6 });
  await delivery.deliverOnce();
  assert.equal(calls[0].message.dedupeKey, 'recall-surface:open_loop:ol:1');
});
