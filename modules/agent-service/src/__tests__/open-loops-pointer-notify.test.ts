import assert from 'node:assert/strict';
import test from 'node:test';

import { createOpenLoopsNotify, countOpenLoops, slotIdOf, type OpenLoopsNotifyDeps } from '../services/xiaoni-open-loops-notify';

// 欠账**不走召回**(CONTEXT.md),改由这条定时指针通知承担。
// 它只给指针 + 计数,不列条目 —— 一列就又变成待办推送,而且会重新引入我们刚甩掉的那一整套
// (挑哪几条、排序、去重、重投窗)。计数是唯一值得给的信息:那是她看不到的总量感。

const LOOPS = [
  '# open loops',
  '- [ ] 给陈显写信 #chenxian (8/3)',
  '- [x] 已经做完的 #done',
  '- [ ] 等 Nova 回 #nova',
  '- [-] 划掉的 #dropped',
  '- [ ] 第三件 #third',
  '- [ ] 第四件 #fourth',
  '- [ ] 第五件 #fifth'
].join('\n');

function fakeDeps(sentKeys: string[] = []) {
  const calls: Array<Record<string, unknown>> = [];
  const seen = new Set(sentKeys);
  const deps: OpenLoopsNotifyDeps = {
    async listRecentAgentQueueDedupeKeys() { return [...seen]; },
    async enqueueAgentQueueMessage(input) {
      const msg = (input as { message: Record<string, unknown> }).message;
      calls.push(input as Record<string, unknown>);
      const key = String(msg.dedupeKey);
      const isNew = !seen.has(key);
      seen.add(key);
      return { created: isNew };
    }
  };
  return { deps, calls };
}

const opts = (extra: Record<string, unknown> = {}) => ({
  enabled: true,
  intervalHours: 24,
  minOpen: 5,
  now: () => new Date('2026-08-20T02:00:00Z'),
  readOpenLoops: async () => LOOPS,
  ...extra
});

test('计数口径与写端一致:只数 `- [ ]`,`[x]` 和 `[-]` 都不算', () => {
  assert.equal(countOpenLoops(LOOPS), 5);
  assert.equal(countOpenLoops(''), 0);
  assert.equal(countOpenLoops(null as unknown as string), 0);
});

test('默认 OFF', async () => {
  const { deps, calls } = fakeDeps();
  const n = createOpenLoopsNotify(deps, { ...opts(), enabled: false });
  assert.equal(await n.notifyOnce(), 'disabled');
  assert.equal(calls.length, 0);
});

test('投一条:正文只有指针 + 计数,不列任何条目', async () => {
  const { deps, calls } = fakeDeps();
  assert.equal(await createOpenLoopsNotify(deps, opts()).notifyOnce(), 'sent');
  const body = String((calls[0].message as Record<string, unknown>).bodyForAgent);
  assert.match(body, /5 条/);
  assert.match(body, /open-loops\.md/);
  assert.ok(!body.includes('给陈显写信'), '绝不能列具体条目 —— 那就成待办推送了');
  // 缓存契约:正文在入队时刻冻结,replay 从同一字段逐字读回。
  const payload = calls[0].payload as Record<string, unknown>;
  assert.equal((payload.systemReminder as Record<string, unknown>).reminder, body);
  assert.ok(String((calls[0].message as Record<string, unknown>).traceId).startsWith('runtrace_'),
    'trace_id 必须给足,空的会击穿 run 边界缓存');
});

test('同一个槽内不重复投(键锚在槽上,整条腿无状态)', async () => {
  const { deps, calls } = fakeDeps();
  const n = createOpenLoopsNotify(deps, opts());
  assert.equal(await n.notifyOnce(), 'sent');
  assert.equal(await n.notifyOnce(), 'already_sent');
  assert.equal(calls.length, 1);
});

test('跨到下一个槽 → 再投一次', async () => {
  const { deps } = fakeDeps();
  let t = new Date('2026-08-20T02:00:00Z');
  const n = createOpenLoopsNotify(deps, { ...opts(), now: () => t });
  assert.equal(await n.notifyOnce(), 'sent');
  t = new Date('2026-08-21T10:00:00Z');
  assert.equal(await n.notifyOnce(), 'sent');
});

test('欠账太少 → 不提(清单本来就短时,提醒只是噪音)', async () => {
  const { deps, calls } = fakeDeps();
  const few = '- [ ] 只有一条 #x';
  assert.equal(await createOpenLoopsNotify(deps, { ...opts(), readOpenLoops: async () => few }).notifyOnce(), 'too_few');
  assert.equal(calls.length, 0);
});

test('文件读不到 → 不提,不猜数', async () => {
  const { deps, calls } = fakeDeps();
  const n = createOpenLoopsNotify(deps, { ...opts(), readOpenLoops: async () => null });
  assert.equal(await n.notifyOnce(), 'unreadable');
  assert.equal(calls.length, 0);
});

test('频率可调:槽长变了,槽号跟着变', () => {
  const t = new Date('2026-08-20T02:00:00Z');
  assert.notEqual(slotIdOf(t, 24), slotIdOf(t, 6));
  // 同一槽长内,相邻时刻同槽
  assert.equal(slotIdOf(new Date('2026-08-20T02:00:00Z'), 24), slotIdOf(new Date('2026-08-20T05:00:00Z'), 24));
});

// 活动窗:notify 会唤醒主 loop,而槽位按东八零点滚 —— 不加这道闸,跨日后第一拍(15 分钟内)
// 就会在半夜把她叫醒。2026-08-13 实测过那个时段投出去的只换来「记着。明天处理。」。
test('活动窗外不投(半夜跨日那一拍)', async () => {
  const { deps, calls } = fakeDeps();
  const midnight = new Date('2026-08-19T16:10:00Z'); // 东八 00:10
  const n = createOpenLoopsNotify(deps, { ...opts(), now: () => midnight });
  assert.equal(await n.notifyOnce(), 'outside_window');
  assert.equal(calls.length, 0);
});

test('活动窗边界:09:00 放行,23:00 不放行', async () => {
  for (const [utc, expect] of [['2026-08-20T01:00:00Z', 'sent'], ['2026-08-20T15:00:00Z', 'outside_window']] as const) {
    const { deps } = fakeDeps();
    const n = createOpenLoopsNotify(deps, { ...opts(), now: () => new Date(utc) });
    // eslint-disable-next-line no-await-in-loop
    assert.equal(await n.notifyOnce(), expect, utc);
  }
});
