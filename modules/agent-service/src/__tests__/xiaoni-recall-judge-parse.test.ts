import assert from 'node:assert/strict';
import test from 'node:test';

import * as persistence from '@qq-bot/persistence';

import { createPassiveRecallDelivery, type RecallDeliveryDeps, type RecallDeliveryEvent } from '../services/xiaoni-recall-delivery';

// 精排 Agent 判决的解析,走投递闸的**真实调用路径**(runJudge → parseJudgeVerdict → 投递 / 留痕)。
//
// 2026-08-28 真库:近 24h 1327 条判决 219 条 parsed=false,**全部**是判官挑了东西的那种 ——
// 钩子里引原话用英文双引号(`"hook":"站标语从"the hand knew."换成…"`),JSON.parse 在第一个
// 内嵌 `"` 处断掉,约 48% 的正向判决被静默丢掉,调用方退回间隔节流,日志只剩「没答上来」。
// 解析本体在 packages/persistence/xiaoni-recall-delivery-judge.js;这里钉的是:
//   ① 这种判决现在能投出去,用的是判官写的钩子(引号原样保留);
//   ② 留痕行 parsed=true、recovered=true,管理端能看见这条路走了多少次;
//   ③ 真垃圾仍然 parsed=false → 退回间隔节流,不许猜成「它说不值得」。

const NOW = new Date('2026-08-28T05:00:00Z');
const REAL_SAMPLE = '{"picks":[{"id":3,"hook":"站标语从"the hand knew."换成…"}]}';

type EnqueueCall = { message: Record<string, unknown>; payload: Record<string, unknown> };

function fakeDeps(overrides: { lastDeliveredAt?: number } = {}) {
  const calls: EnqueueCall[] = [];
  const shadowWrites: Array<Record<string, unknown>> = [];
  const deps: RecallDeliveryDeps = {
    async listRecallShadowLog() { return []; },
    async listRecentAgentQueueDedupeKeys() { return []; },
    async getLastAgentQueueEnqueuedAt() { return overrides.lastDeliveredAt ?? null; },
    async insertRecallShadowLog(record) { shadowWrites.push(record as Record<string, unknown>); return { id: '1' }; },
    async enqueueAgentQueueMessage(input) {
      calls.push(input as unknown as EnqueueCall);
      return { queueId: calls.length, status: 'pending', created: true };
    }
  };
  return { deps, calls, shadowWrites };
}

const landingItem = (sourceRef: string, text: string) => ({
  kind: 'file_chunk', sourceRef, score: 0.9, text,
  provenance: { kind: 'file_chunk', path: sourceRef.split('#')[0] },
  lead: { kind: 'file_chunk', text, pointer: sourceRef.split('#')[0], privacyScope: 'self_private' }
});

const event = (surfaced: unknown[]): RecallDeliveryEvent => ({
  anchorText: '在改 touch.html 的站标语',
  row: { occurredAt: NOW, queryRef: 'stack:1', surfaced } as unknown as RecallDeliveryEvent['row']
});

const threeCandidates = () => event([
  landingItem('/n/a.md#1', '群里聊过一次亚文化'),
  landingItem('/n/b.md#1', '上个月投稿被退'),
  landingItem('/n/c.md#1', '站标语原来是 the hand knew')
]);

function delivery(judgeAnswer: string, lastDeliveredAt?: number) {
  const fake = fakeDeps({ lastDeliveredAt });
  const d = createPassiveRecallDelivery(fake.deps, {
    readGate: async () => ({ enabled: true }),
    now: () => NOW,
    judge: async () => judgeAnswer
  });
  const judgeRow = () => fake.shadowWrites.find((w) => w.queryRef === 'delivery_judge') as
    { silent?: boolean; llmWork?: { parsed?: boolean; recovered?: boolean; picks?: Array<{ id: string; hook: string }> } } | undefined;
  return { d, judgeRow, ...fake };
}

test('parseJudgeVerdict:合法 JSON 正路,recovered=false', () => {
  const out = persistence.parseJudgeVerdict('{"picks":[{"id":2,"hook":"上次投稿退了"}]}', ['a', 'b']);
  assert.deepEqual(out, { parsed: true, recovered: false, picks: [{ id: 'b', hook: '上次投稿退了' }] });
});

test('parseJudgeVerdict:真实线上样本(钩子夹英文双引号)→ parsed=true,钩子原样', () => {
  const out = persistence.parseJudgeVerdict(REAL_SAMPLE, ['a', 'b', 'c']);
  assert.equal(out.parsed, true);
  assert.equal(out.recovered, true);
  assert.deepEqual(out.picks, [{ id: 'c', hook: '站标语从"the hand knew."换成…' }]);
});

test('parseJudgeVerdict:多条 pick 各夹引号', () => {
  const out = persistence.parseJudgeVerdict(
    '{"picks":[{"id":1,"hook":"楠楠说"手"不一样"},{"id":2,"hook":"他说 "no" 了"}]}', ['a', 'b']);
  assert.deepEqual(out.picks.map((p) => p.hook), ['楠楠说"手"不一样', '他说 "no" 了']);
});

test('parseJudgeVerdict:空 picks → parsed=true 静默;垃圾 → parsed=false', () => {
  assert.deepEqual(persistence.parseJudgeVerdict('{"picks":[]}', ['a']), { parsed: true, recovered: false, picks: [] });
  assert.equal(persistence.parseJudgeVerdict('模型挂了没输出', ['a']).parsed, false);
  assert.equal(persistence.parseJudgeVerdict('{"picks":[{"id":1,"hook":', ['a']).parsed, false);
});

test('投递闸:线上那条判决现在能投出去,用的是判官写的钩子(引号原样);留痕 parsed=true + recovered=true', async () => {
  // 上一条 1 分钟前刚投过:判官缺席的话这里会被间隔节流拦下 —— 正是修前的表现。
  const { d, calls, judgeRow } = delivery(REAL_SAMPLE, NOW.getTime() - 60_000);
  assert.equal(await d.deliverForEvent(threeCandidates()), 'delivered');
  assert.equal(calls.length, 1);
  assert.match(String(calls[0]!.payload.rawBody), /站标语从"the hand knew\."换成/u);
  assert.match(String(calls[0]!.message.dedupeKey), /^recall-surface:/u);
  const row = judgeRow();
  assert.ok(row, '判官要留痕');
  assert.equal(row!.silent, false);
  assert.equal(row!.llmWork?.parsed, true);
  assert.equal(row!.llmWork?.recovered, true);
  assert.equal(row!.llmWork?.picks?.length, 1);
});

test('投递闸:多条夹引号的 pick 全投,每条一个 notify', async () => {
  const { d, calls } = delivery('{"picks":[{"id":2,"hook":"上次投稿退了,地址是"错的那个""},{"id":3,"hook":"标语"the hand knew"就是它"}]}');
  assert.equal(await d.deliverForEvent(threeCandidates()), 'delivered');
  assert.equal(calls.length, 2);
  assert.match(String(calls[0]!.payload.rawBody), /"错的那个"/u);
  assert.match(String(calls[1]!.payload.rawBody), /"the hand knew"/u);
});

test('投递闸:正常 JSON 留痕 recovered=false;空 picks 仍是静默', async () => {
  const ok = delivery('{"picks":[{"id":1,"hook":"值得"}]}');
  assert.equal(await ok.d.deliverForEvent(threeCandidates()), 'delivered');
  assert.equal(ok.judgeRow()!.llmWork?.recovered, false);
  const empty = delivery('{"picks":[]}');
  assert.equal(await empty.d.deliverForEvent(threeCandidates()), 'none');
  assert.equal(empty.calls.length, 0);
  assert.equal(empty.judgeRow()!.silent, true);
  assert.equal(empty.judgeRow()!.llmWork?.parsed, true);
});

test('投递闸:真垃圾仍然 parsed=false → 退回间隔节流(刚投过就不投),不许猜成「它说不值得」', async () => {
  const { d, calls, judgeRow } = delivery('模型挂了没输出', NOW.getTime() - 60_000);
  assert.equal(await d.deliverForEvent(threeCandidates()), 'none');
  assert.equal(calls.length, 0);
  assert.equal(judgeRow()!.llmWork?.parsed, false);
  assert.equal(judgeRow()!.llmWork?.recovered, false);
});
