import test from 'node:test';
import assert from 'node:assert/strict';
import {
  countOpenLoops,
  displayOpenLoopBody,
  isWaitingOpenLoopBody,
  listActionableOpenLoops,
  openLoopLineTime,
  splitOpenLoopLines,
  pickOpenLoopsForNudge,
  seededRandom
} from '../services/xiaoni-open-loops-notify';

// 续跑 / 第 3 次被拒点名用的条目:只点开着、不在等别人的;给她看的那句去掉 #标签 (日期) 和在等字段。
const MARKDOWN = [
  '# Open Loops',
  '',
  '- [x] involute齿面穿模修好了 (7/27→7/28) ✓ 阿花确认了',
  '- [-] Bartosz的Sound还没读 #sound (7/27) — 不读了',
  '- [ ] Roy Tang 10/4的weeknotes看9/28化验结果；只读不写信。 #roy-weeknotes (10/3)',
  '- [ ] Bartosz的邮件发了 ⏳Bartosz回信 #邮件 (7/27)',
  '- [ ] 等CC看完《Love a Cheate》说想法 #CC-love (10/2)',
  '- [ ] 阿花00:03说我不像人话，我回了三条，等她接 #阿花-小吃文 (10/4)',
  '- [ ] 试三天：写结论前先写一句我还没看的是___ #先写没看的 (10/4)',
  '- [ ] 没标签也没日期的老行',
  ''
].join('\n');

test('actionable = open, not waiting (⏳ field, starts with 等, or 等…回/回复/开口); display drops tag/date/field', () => {
  assert.deepEqual(listActionableOpenLoops(MARKDOWN, new Date('2026-10-04T08:00:00Z')), [
    '试三天：写结论前先写一句我还没看的是___',
    'Roy Tang 10/4的weeknotes看9/28化验结果；只读不写信。',
    '没标签也没日期的老行'
  ]);
  // 计数口径不变:在等的也还是开着的。
  assert.equal(countOpenLoops(MARKDOWN), 6);
});

test('isWaitingOpenLoopBody / displayOpenLoopBody edge cases', () => {
  assert.equal(isWaitingOpenLoopBody('邮件发了 ⏳Bartosz回信 #邮件 (7/27)'), true);
  assert.equal(isWaitingOpenLoopBody('Taper #17 Prime Gaps在编辑队列 #taper (8/21)'), false);
  assert.equal(displayOpenLoopBody('Taper #17 Prime Gaps在编辑队列 #taper-editorial (8/21)'), 'Taper #17 Prime Gaps在编辑队列');
  assert.equal(Array.from(displayOpenLoopBody('长'.repeat(80))).length, 61);
  assert.deepEqual(listActionableOpenLoops(null), []);
});

test('pick: shuffles with the seeded rng, takes at most count, same seed → same pick', () => {
  const items = ['a', 'b', 'c', 'd', 'e'];
  const first = pickOpenLoopsForNudge(items, 3, seededRandom('run-1:4'));
  assert.equal(first.length, 3);
  assert.equal(new Set(first).size, 3);
  assert.ok(first.every((item) => items.includes(item)));
  assert.deepEqual(pickOpenLoopsForNudge(items, 3, seededRandom('run-1:4')), first);
  assert.deepEqual(items, ['a', 'b', 'c', 'd', 'e'], 'input not mutated');
  assert.deepEqual(pickOpenLoopsForNudge(['only'], 3, seededRandom('x')), ['only']);
  assert.deepEqual(pickOpenLoopsForNudge([], 3, seededRandom('x')), []);
  // 不同 seed 能抽到不同组合(不是永远同一组)。
  const picks = new Set(Array.from({ length: 20 }, (_, index) => pickOpenLoopsForNudge(items, 3, seededRandom(`run:${index}`)).join(',')));
  assert.ok(picks.size > 1);
});

test('recent first: last M/D in the trailing parens decides; future month-day counts as last year; undated last; same day → later line first', () => {
  const now = new Date('2026-10-04T08:00:00Z');
  const markdown = [
    '- [ ] 老的一条 #a (8/21)',
    '- [ ] 跨日期的取最后那个 #b (8/23→9/7)',
    '- [ ] 没日期的老行',
    '- [ ] 今天先记的 #c (10/4)',
    '- [ ] 去年冬天的 #d (12/30)',
    '- [ ] 今天后记的 #e (10/4)',
    '- [ ] 等阿花回 #f (10/5)'
  ].join('\n');
  assert.deepEqual(listActionableOpenLoops(markdown, now), [
    '今天后记的',
    '今天先记的',
    '跨日期的取最后那个',
    '老的一条',
    '去年冬天的',
    '没日期的老行'
  ]);
  const split = splitOpenLoopLines(markdown, now);
  assert.deepEqual(split.waiting, ['- [ ] 等阿花回 #f (10/5)']);
  assert.equal(split.actionable[0], '- [ ] 今天后记的 #e (10/4)');
  assert.equal(split.actionable[split.actionable.length - 1], '- [ ] 没日期的老行');
  assert.equal(openLoopLineTime('done 行带注 #x (10/3) ✓ 他回了', now), Date.UTC(2026, 9, 3));
});
