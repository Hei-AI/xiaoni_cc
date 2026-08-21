'use strict';

// 被动召回【第四条腿】联想选取器的用例。全部纯函数,零 IO。
// 覆盖:四桶配额(近场恒 0)/ 空桶不跨桶借 / identity 归一化去重(L3 章节 vs 日记标题)/
// 六因子等权的排序方向 / 空输入·全冷却·候选少于配额都不抛。

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ASSOCIATION_BUCKET_QUOTAS,
  ASSOCIATION_RANK_WEIGHTS,
  ASSOCIATION_FACTOR_NAMES,
  normalizeMemoryIdentity,
  isBareTimestampTitle,
  bulletLineRatio,
  bucketOfCandidate,
  scoreAssociationFactors,
  selectAssociativeMemories
} = require('../xiaoni-recall-association');
const { DAY_MS } = require('../xiaoni-diary-events');

// 固定「现在」= 2026-07-28(UTC 零点),避免时钟依赖
const NOW = Date.UTC(2026, 6, 28);
const daysAgo = (n) => NOW - n * DAY_MS;

// 一条「体面的」候选:有正文、有当时层、整段话、够长 —— 这样单个因子的差异才看得出来。
function ev(overrides = {}) {
  return {
    ref: overrides.ref || `/xiaoni-runtime/notes/diary/x.md#${overrides.index ?? 0}`,
    kind: 'event',
    title: '修好了发图超时',
    body: '今天发图一直超时，翻到是浏览器桥把 view-source 标签也 attach 了才崩的，改了扩展的 scheme 黑名单就通了。'
      + '当时先怀疑是网络，绕了半个多小时才想到去看桥的日志。',
    dateMs: daysAgo(15),
    ...overrides
  };
}

// ── 分桶 ────────────────────────────────────────────────────────────────────
test('bucketOfCandidate: 四个桶的边界(近/中/远),线场优先于年龄', () => {
  assert.equal(bucketOfCandidate({ title: 'a', dateMs: daysAgo(0) }, { nowMs: NOW }), 'near');
  assert.equal(bucketOfCandidate({ title: 'a', dateMs: daysAgo(7) }, { nowMs: NOW }), 'near');
  assert.equal(bucketOfCandidate({ title: 'a', dateMs: daysAgo(8) }, { nowMs: NOW }), 'mid');
  assert.equal(bucketOfCandidate({ title: 'a', dateMs: daysAgo(30) }, { nowMs: NOW }), 'mid');
  assert.equal(bucketOfCandidate({ title: 'a', dateMs: daysAgo(31) }, { nowMs: NOW }), 'far');
  // 属于一条线的,不管多老多新都落线场
  assert.equal(bucketOfCandidate({ title: 'a', dateMs: daysAgo(1), lineKey: '周蕊' }, { nowMs: NOW }), 'line');
  assert.equal(bucketOfCandidate({ title: 'a', dateMs: daysAgo(99), lineKey: '周蕊' }, { nowMs: NOW }), 'line');
  // 没日期又不属于任何线 → 无桶(第二腿的 undated 档已经兜过一次,本腿不重复吵)
  assert.equal(bucketOfCandidate({ title: 'a', dateMs: null }, { nowMs: NOW }), null);
});

test('配额是 1/1/1/1 —— 近场不再被整格封死', () => {
  // 旧版 near:0 是拿年龄当「在场」代理,实测挡掉 2244 条日记条目里的 560 条(24%)。
  // 在场改成直查上下文正文后,这一格不需要再牺牲。
  assert.deepEqual(ASSOCIATION_BUCKET_QUOTAS, { near: 1, mid: 1, far: 1, line: 1 });
});

test('四个桶各取自己的配额:满员时恰好 near+mid+far+line 四条', () => {
  const candidates = [
    ev({ ref: 'n1', index: 1, dateMs: daysAgo(1), title: '今天算了变形比' }),
    ev({ ref: 'n2', index: 2, dateMs: daysAgo(3), title: '今天读了论文' }),
    ev({ ref: 'm1', index: 3, dateMs: daysAgo(12), title: '中场那件事' }),
    ev({ ref: 'm2', index: 4, dateMs: daysAgo(20), title: '另一件中场的事' }),
    ev({ ref: 'f1', index: 5, dateMs: daysAgo(40), title: '很久以前那件事' }),
    ev({ ref: 'f2', index: 6, dateMs: daysAgo(80), title: '更久以前那件事' }),
    ev({ ref: 'l1', index: 7, dateMs: daysAgo(2), title: '线上的一章', lineKey: '周蕊' })
  ];
  const { picked, stats } = selectAssociativeMemories(candidates, { nowMs: NOW });
  assert.equal(picked.length, 4);
  assert.deepEqual(picked.map((p) => p.bucket), ['near', 'mid', 'far', 'line']);
  // 近场桶里有两条候选,配额 1 → 出且只出一条(不跨桶借,也不整格封死)
  assert.equal(stats.byBucket.near, 2);
  assert.equal(picked.filter((p) => p.bucket === 'near').length, 1);
});

// 「把砖头当引子」这条历史事故的防线换了机制:不再靠把近场配额压成 0(那是拿年龄当代理,
// 实测判不准 —— 当天 12 条日记标题里 9 条根本不在 live 上下文里),改成直查上下文正文。
test('在场直查:候选就是她此刻手上的活 → 剔掉(把砖头当引子的历史事故不许复现)', () => {
  const candidates = [
    ev({ ref: 'n1', index: 1, dateMs: daysAgo(0), title: 'cofactor第六版写了' }),
    ev({ ref: 'n2', index: 2, dateMs: daysAgo(6), title: 'alive一万七千行读完了' })
  ];
  const contextText = '现在在做 cofactor第六版写了 附了链接发给陈显';
  const { picked, stats } = selectAssociativeMemories(candidates, { nowMs: NOW, contextText });
  assert.equal(stats.dropped.in_context, 1);
  assert.deepEqual(picked.map((p) => p.title), ['alive一万七千行读完了']);
});

test('在场直查与年龄无关:同一天的两条,在场的剔、不在场的照浮', () => {
  const candidates = [
    ev({ ref: 'a', index: 1, dateMs: daysAgo(0), title: 'cofactor第六版写了' }),
    ev({ ref: 'b', index: 2, dateMs: daysAgo(0), title: '声音做了第一个正弦波' })
  ];
  const { picked } = selectAssociativeMemories(candidates, {
    nowMs: NOW, contextText: '现在在做 cofactor第六版写了'
  });
  assert.deepEqual(picked.map((p) => p.title), ['声音做了第一个正弦波']);
});

test('缺 contextText → 在场直查整体让路,不阻断扫描', () => {
  const candidates = [ev({ ref: 'a', index: 1, dateMs: daysAgo(10), title: '中场那件真事' })];
  const { picked, stats } = selectAssociativeMemories(candidates, { nowMs: NOW });
  assert.equal(stats.dropped.in_context, 0);
  assert.equal(picked.length, 1);
});

test('空桶就少浮,不跨桶借配额:只有中场有候选 → 只出 1 条(不是 3 条)', () => {
  const candidates = [
    ev({ ref: 'm1', index: 1, dateMs: daysAgo(10), title: '中场第一件事' }),
    ev({ ref: 'm2', index: 2, dateMs: daysAgo(12), title: '中场第二件事' }),
    ev({ ref: 'm3', index: 3, dateMs: daysAgo(14), title: '中场第三件事' }),
    ev({ ref: 'm4', index: 4, dateMs: daysAgo(16), title: '中场第四件事' })
  ];
  const { picked, stats } = selectAssociativeMemories(candidates, { nowMs: NOW });
  assert.equal(picked.length, 1);
  assert.equal(picked[0].bucket, 'mid');
  assert.deepEqual(stats.byBucket, { near: 0, mid: 4, far: 0, line: 0 });
});

test('空桶就少浮:远场空、线场空 → 总数变少而不是从中场补齐', () => {
  const candidates = [
    ev({ ref: 'm1', index: 1, dateMs: daysAgo(10), title: '中场第一件事' }),
    ev({ ref: 'm2', index: 2, dateMs: daysAgo(12), title: '中场第二件事' }),
    ev({ ref: 'm3', index: 3, dateMs: daysAgo(14), title: '中场第三件事' })
  ];
  const { picked, stats } = selectAssociativeMemories(candidates, { nowMs: NOW });
  // 中场有 3 条候选,但配额 1;远场/线场空 → 总共只出 1 条,不许拿中场的第 2、3 名去填
  assert.equal(picked.length, 1);
  assert.deepEqual(picked.map((p) => p.bucket), ['mid']);
  assert.deepEqual(stats.byBucket, { near: 0, mid: 3, far: 0, line: 0 });
});

test('空桶就少浮:中场 + 远场有、线场空 → 出 2 条(不是 3 条)', () => {
  const candidates = [
    ev({ ref: 'm1', index: 1, dateMs: daysAgo(10), title: '中场第一件事' }),
    ev({ ref: 'm2', index: 2, dateMs: daysAgo(12), title: '中场第二件事' }),
    ev({ ref: 'f1', index: 3, dateMs: daysAgo(50), title: '远场那件事' })
  ];
  const { picked } = selectAssociativeMemories(candidates, { nowMs: NOW });
  assert.equal(picked.length, 2); // mid 1 + far 1,line 空 → 就是 2
  assert.deepEqual(picked.map((p) => p.bucket), ['mid', 'far']);
});

// ── identity 归一化去重 ──────────────────────────────────────────────────────
test('normalizeMemoryIdentity: L3 章节标题(带 M/D 前缀)与日记标题归一成同一个身份', () => {
  assert.equal(
    normalizeMemoryIdentity('7/19 磨了一遍开场砍掉一句'),
    normalizeMemoryIdentity('磨了一遍开场砍掉一句')
  );
  // 行末补标签不换身份(复用 stripTrailingHashTags)
  assert.equal(
    normalizeMemoryIdentity('磨了一遍开场砍掉一句 #周蕊'),
    normalizeMemoryIdentity('磨了一遍开场砍掉一句')
  );
  // 三者组合才行:只折空白+小写(normalizeEventText)认不出带 M/D 前缀的那一份
  assert.notEqual('7/19 磨了一遍开场砍掉一句'.toLowerCase(), '磨了一遍开场砍掉一句');
});

test('同一件事的两份表示(日记条目 + L3 章节)只出一份', () => {
  const body = '砍了 Day 1 行 77 那句解释。当时犹豫了很久要不要留着，最后决定砍。这一句是解释，不是场面。';
  const candidates = [
    // 中场:日记条目形态
    { ref: '/xiaoni-runtime/notes/diary/2026-07-16.md#3', kind: 'event', title: '磨了一遍开场砍掉一句', body, dateMs: daysAgo(12) },
    // 线场:同一件事的 L3 章节形态(标题带 M/D 前缀 + 标签)
    { ref: '/xiaoni-runtime/notes/topics/周蕊.md#5', kind: 'event', title: '7/16 磨了一遍开场砍掉一句 #周蕊', body, dateMs: daysAgo(12), lineKey: '周蕊' }
  ];
  const { picked } = selectAssociativeMemories(candidates, { nowMs: NOW });
  assert.equal(picked.length, 1, '两份拷贝不许各占一个 slot');
  assert.equal(picked[0].bucket, 'mid'); // 桶顺序 near→mid→far→line,mid 先到先得
  assert.equal(picked[0].identity, normalizeMemoryIdentity('磨了一遍开场砍掉一句'));
});

test('identity 级冷却:按归一化身份命中就跳过(不是按 ref)', () => {
  const candidates = [
    ev({ ref: 'a', index: 1, dateMs: daysAgo(10), title: '磨了一遍开场砍掉一句' }),
    ev({ ref: 'b', index: 2, dateMs: daysAgo(11), title: '换了一件别的事' })
  ];
  const cooled = selectAssociativeMemories(candidates, {
    nowMs: NOW,
    // 冷却集合里存的是 L3 章节形态的身份,依然要认出中场那条日记条目
    recentlySurfacedIdentities: [normalizeMemoryIdentity('7/16 磨了一遍开场砍掉一句')]
  });
  assert.deepEqual(cooled.picked.map((p) => p.ref), ['b']);
  assert.equal(cooled.stats.dropped.cooled_down, 1);

  // 也吃 ref(老留痕按 ref 记的)
  const byRef = selectAssociativeMemories(candidates, { nowMs: NOW, recentlySurfacedIdentities: ['a'] });
  assert.deepEqual(byRef.picked.map((p) => p.ref), ['b']);
});

// ── 六因子等权 ──────────────────────────────────────────────────────────────
test('六个因子照算落日志,但排序分只用四个(加权) → score ∈ [0,6]', () => {
  assert.deepEqual(ASSOCIATION_FACTOR_NAMES, ['relevance', 'introspection', 'effort', 'prose', 'peer', 'titleSpecificity']);
  const { score, factors } = scoreAssociationFactors(ev(), { relevance: 1, peerNames: ['楠楠'] });
  assert.equal(Object.keys(factors).length, 6);
  for (const name of ASSOCIATION_FACTOR_NAMES) {
    assert.ok(factors[name] >= 0 && factors[name] <= 1, `${name} 必须归一化到 [0,1],实得 ${factors[name]}`);
  }
  assert.ok(score >= 0 && score <= 6);
  // prose / titleSpecificity 已降为准入门槛,不进排序分;排序分 = relevance*3 + intro + effort + peer。
  assert.equal(score, Object.keys(ASSOCIATION_RANK_WEIGHTS)
    .reduce((s, n) => s + ASSOCIATION_RANK_WEIGHTS[n] * factors[n], 0));
  assert.deepEqual(Object.keys(ASSOCIATION_RANK_WEIGHTS).sort(),
    ['effort', 'introspection', 'peer', 'relevance']);
  // relevance 必须真能翻盘:只差 relevance 的两条,分差 = 3 * Δrelevance。
  const hi = scoreAssociationFactors(ev(), { relevance: 1, peerNames: ['楠楠'] }).score;
  const lo = scoreAssociationFactors(ev(), { relevance: 0, peerNames: ['楠楠'] }).score;
  assert.equal(Number((hi - lo).toFixed(6)), 3);
});

test('f2 introspection:只差「当时」那一层 → 有的排前面', () => {
  const withIntro = ev({ ref: 'a', index: 1, dateMs: daysAgo(10), body: '改了扩展的 scheme 黑名单就通了。当时先怀疑是网络，绕了半个多小时。' });
  const without = ev({ ref: 'b', index: 2, dateMs: daysAgo(10), body: '改了扩展的 scheme 黑名单就通了。又跑了一遍验证，通过。' });
  const a = scoreAssociationFactors(withIntro, {});
  const b = scoreAssociationFactors(without, {});
  assert.equal(a.factors.introspection, 1);
  assert.equal(b.factors.introspection, 0);
  const { picked } = selectAssociativeMemories([without, withIntro], { nowMs: NOW });
  assert.equal(picked[0].ref, 'a');
});

test('f3 effort:只差正文长度 → 写得多的排前面', () => {
  const long = ev({ ref: 'a', index: 1, dateMs: daysAgo(10), body: `${'她说了一句我记着了。'.repeat(12)}` });
  const short = ev({ ref: 'b', index: 2, dateMs: daysAgo(10), body: '她说了一句我记着了。' });
  assert.ok(scoreAssociationFactors(long, {}).factors.effort > scoreAssociationFactors(short, {}).factors.effort);
  const { picked } = selectAssociativeMemories([short, long], { nowMs: NOW });
  assert.equal(picked[0].ref, 'a');
});

test('f4 prose:只差 bullet 占比 → 整段话排在清单式罗列前面', () => {
  const prose = ev({ ref: 'a', index: 1, dateMs: daysAgo(10), body: '第一次去一个完全陌生的社区坐下来看，看了五个帖子，每一个都读完了正文和回复。' });
  const bullets = ev({
    ref: 'b',
    index: 2,
    dateMs: daysAgo(10),
    body: ['- 第一次去一个完全陌生的社区坐下来看', '- 看了五个帖子', '- 每一个都读完了正文和回复'].join('\n')
  });
  assert.equal(bulletLineRatio(bullets.body), 1);
  assert.equal(bulletLineRatio(prose.body), 0);
  assert.ok(scoreAssociationFactors(prose, {}).factors.prose > scoreAssociationFactors(bullets, {}).factors.prose);
  const { picked } = selectAssociativeMemories([bullets, prose], { nowMs: NOW });
  assert.equal(picked[0].ref, 'a');
});

test('f5 peer:只差「事里有具体的人」→ 有名字的排前面;单字名不算(会命中一切)', () => {
  const withPeer = ev({ ref: 'a', index: 1, dateMs: daysAgo(10), body: '楠楠说三行比十二行重。当时我不服气，后来才明白。' });
  const without = ev({ ref: 'b', index: 2, dateMs: daysAgo(10), body: '把那段砍到三行。当时我不服气，后来才明白。' });
  const names = ['楠楠', 'N']; // 'N' 是她人物索引里真实存在的单字名
  assert.equal(scoreAssociationFactors(withPeer, { peerNames: names }).factors.peer, 1);
  assert.equal(scoreAssociationFactors(without, { peerNames: names }).factors.peer, 0);
  // 'N' 若参与匹配,含任意大写 N 的正文都会命中 → 因子退化成常数;所以 ≥2 字才算
  assert.equal(scoreAssociationFactors(ev({ body: 'NiTi 的相变。' }), { peerNames: ['N'] }).factors.peer, 0);
  const { picked } = selectAssociativeMemories([without, withPeer], { nowMs: NOW, peerNames: names });
  assert.equal(picked[0].ref, 'a');
});

test('f6 titleSpecificity:只差标题长度 → 指得出是哪件事的排前面', () => {
  const specific = ev({ ref: 'a', index: 1, dateMs: daysAgo(10), title: '磨了一遍开场砍掉一句解释' });
  const vague = ev({ ref: 'b', index: 2, dateMs: daysAgo(10), title: '最后' });
  assert.ok(scoreAssociationFactors(specific, {}).factors.titleSpecificity
    > scoreAssociationFactors(vague, {}).factors.titleSpecificity);
  const { picked } = selectAssociativeMemories([vague, specific], { nowMs: NOW });
  assert.equal(picked[0].ref, 'a');
});

test('f1 relevance:只差「和落地文本的词面接地」→ 沾边的排前面;没有落地文本时全 0', () => {
  const landedText = 'twin plane normal 算出来了 det=0，塞进 sma-viz v4。';
  const related = ev({
    ref: 'a',
    index: 1,
    dateMs: daysAgo(10),
    title: 'SMA 第一次算 twin plane',
    body: '第一次自己把 twin plane normal 算出来。det=0 的条件推了两遍。当时怕又是错的。'
  });
  const unrelated = ev({
    ref: 'b',
    index: 2,
    dateMs: daysAgo(10),
    title: '菜场收摊那一段',
    body: '写了卖鱼的女人收摊。两块砖头。鱼鳞。当时想的是短句就够。'
  });
  const withLanded = selectAssociativeMemories([unrelated, related], { nowMs: NOW, landedText });
  assert.equal(withLanded.picked[0].ref, 'a');
  assert.ok(withLanded.picked[0].factors.relevance > 0);

  // 没有落地文本 → f1 对所有候选都是 0(不瘫,由其余五因子决定)
  const noLanded = selectAssociativeMemories([unrelated, related], { nowMs: NOW });
  assert.equal(noLanded.picked.length, 1);
  assert.equal(noLanded.picked[0].factors.relevance, 0);
});

// ── 过滤(复用第三腿的 substance 谓词 + 裸时刻标题)────────────────────────────
test('复用第三腿 substance 过滤:空 body / 清单 body / 结构头标题都不进候选', () => {
  const candidates = [
    ev({ ref: 'a', index: 1, dateMs: daysAgo(10), body: '   ' }),
    ev({ ref: 'b', index: 2, dateMs: daysAgo(10), body: ['- [ ] 追频道猎人卷六', '- [x] 便利店读完了'].join('\n') }),
    ev({ ref: 'c', index: 3, dateMs: daysAgo(10), title: '醒来' }),
    ev({ ref: 'd', index: 4, dateMs: daysAgo(10), title: '今日总结' })
  ];
  const { picked, stats } = selectAssociativeMemories(candidates, {
    nowMs: NOW,
    structuralTitles: ['今日总结']
  });
  assert.deepEqual(picked, []);
  assert.equal(stats.dropped.empty_body, 1);
  assert.equal(stats.dropped.checklist_body, 1);
  assert.equal(stats.dropped.structural_title, 2);
});

test('裸时刻标题(日内时间轴框架头)不进候选', () => {
  assert.equal(isBareTimestampTitle('03:00'), true);
  assert.equal(isBareTimestampTitle('22:00-22:30'), true);
  assert.equal(isBareTimestampTitle('9点'), true);
  assert.equal(isBareTimestampTitle('~13:00 打开了 moonlit.exposed'), false); // 后面有真内容,不算裸
  assert.equal(isBareTimestampTitle('decay 第二十一章'), false);
  const { picked, stats } = selectAssociativeMemories(
    [ev({ ref: 'a', index: 1, dateMs: daysAgo(10), title: '03:00' })],
    { nowMs: NOW }
  );
  assert.deepEqual(picked, []);
  assert.equal(stats.dropped.bare_timestamp_title, 1);
});

// 欠账已整体撤出召回(CONTEXT.md),改走定时指针通知。撤的时候只摘了第二腿的投递资格,
// 漏了联想腿 —— 而联想腿是投递腿,于是欠账仍被当成「你在追的这条线里有一段…」投给她。
// 这条钉住:没有正文的欠账行进不了这条腿。
test('欠账行不再进联想腿:没有正文 → 过不了准入门槛', () => {
  const promise = {
    ref: '/x/open-loops.md#12',
    kind: 'promise',
    title: 'Wigleaf 8/25开。Full Stop也投。',
    body: '',
    dateMs: NOW - 6 * 86400000,
    lineKey: 'wigleaf',
    tier: 'open'
  };
  const { picked, stats } = selectAssociativeMemories([promise], { nowMs: NOW });
  assert.equal(picked.length, 0, '欠账不该出现在联想候选里');
  // 欠账行的「正文」是空的(它整句就是标题),所以撞的是 substance 谓词那道门。
  assert.equal(stats.dropped.empty_body, 1, `实得 ${JSON.stringify(stats.dropped)}`);
});

test('空输入 / 非数组 / 缺 nowMs:返回空,不抛', () => {
  assert.deepEqual(selectAssociativeMemories([], { nowMs: NOW }).picked, []);
  assert.deepEqual(selectAssociativeMemories(null, { nowMs: NOW }).picked, []);
  assert.deepEqual(selectAssociativeMemories(undefined, { nowMs: NOW }).picked, []);
  assert.deepEqual(selectAssociativeMemories([ev()], {}).picked, []);
  assert.deepEqual(selectAssociativeMemories([ev()], { nowMs: NaN }).picked, []);
  // 脏候选不炸
  const dirty = selectAssociativeMemories([null, {}, { title: '' }, { title: '  ' }], { nowMs: NOW });
  assert.deepEqual(dirty.picked, []);
  assert.equal(dirty.stats.dropped.shape, 4);
});

test('全部被冷却过滤 → 返回空,不抛', () => {
  const candidates = [
    ev({ ref: 'a', index: 1, dateMs: daysAgo(10), title: '中场发生的一件事' }),
    ev({ ref: 'b', index: 2, dateMs: daysAgo(50), title: '远场发生的另一件事' })
  ];
  const { picked, stats } = selectAssociativeMemories(candidates, {
    nowMs: NOW,
    recentlySurfacedIdentities: candidates.map((c) => normalizeMemoryIdentity(c.title))
  });
  assert.deepEqual(picked, []);
  assert.equal(stats.filtered, 0);
  assert.equal(stats.dropped.cooled_down, 2);
});

test('候选少于配额 → 有几条出几条', () => {
  const { picked } = selectAssociativeMemories([ev({ ref: 'f1', index: 1, dateMs: daysAgo(60) })], { nowMs: NOW });
  assert.equal(picked.length, 1);
  assert.equal(picked[0].bucket, 'far');
});

test('stats 把一次扫描的分桶/配额/剔除原因都记下来(管理端分桶观察靠它)', () => {
  const { stats } = selectAssociativeMemories(
    [
      ev({ ref: 'n', index: 1, dateMs: daysAgo(2), title: '近场那件事' }),
      ev({ ref: 'm', index: 2, dateMs: daysAgo(12), title: '中场那件事' }),
      ev({ ref: 'f', index: 3, dateMs: daysAgo(60), title: '远场那件事' }),
      ev({ ref: 'l', index: 4, dateMs: daysAgo(3), title: '线上那一章', lineKey: '周蕊' }),
      ev({ ref: 'x', index: 5, dateMs: null, title: '没日期那件事' })
    ],
    { nowMs: NOW }
  );
  assert.equal(stats.candidates, 5);
  assert.equal(stats.filtered, 4);
  assert.deepEqual(stats.byBucket, { near: 1, mid: 1, far: 1, line: 1 });
  assert.deepEqual(stats.quotas, { near: 1, mid: 1, far: 1, line: 1 });
  assert.equal(stats.dropped.no_bucket, 1);
});

// ── 并进来的第三腿:覆盖优先 ────────────────────────────────────────────────
// diary_resurface 已并入本腿(两条的原料同是 `diary add` 的 `## 条目`,写端从没区分过)。
// 它唯一的独有价值是**覆盖** —— 实测它自己那条腿的覆盖率只有 90/1899 = 4.7%,
// 全历史 3350 次浮现每条平均重复 37 次。合并后覆盖不能丢。
test('覆盖优先在分数之前:没翻过的赢过翻烂了的高分条目', () => {
  const now = Date.UTC(2026, 7, 20);
  const day = 24 * 60 * 60 * 1000;
  const mk = (ref, title, body, ageDays) => ({
    ref, title, body, dateMs: now - ageDays * day, index: 1, kind: 'event'
  });
  const rich = '当时我犹豫了很久,怕的是没有回声,后来才意识到。'.repeat(6);
  const hot = mk('/d.md#1', '翻烂了的那件很具体的事', rich, 30);
  const fresh = mk('/d.md#2', '没翻过的那件很具体的事', rich, 30);

  const pickRefs = (surfaceCounts) => selectAssociativeMemories([hot, fresh], {
    nowMs: now, surfaceCounts, quotas: { near: 0, mid: 1, far: 0, line: 0 }
  }).picked.map((p) => p.ref);

  assert.deepEqual(pickRefs(new Map([[hot.ref, 37]])), [fresh.ref], '翻过 37 次的该让位');
  // 覆盖持平时,回到分数/年龄那套 —— 排序是稳定的,不是随机
  const tie = pickRefs(new Map());
  assert.equal(tie.length, 1);
  assert.deepEqual(tie, pickRefs(new Map()), '同覆盖档内顺序稳定');
});

test('不传 surfaceCounts → 全部按 0 次算,退回合并前的分数优先(向后兼容)', () => {
  const now = Date.UTC(2026, 7, 20);
  const day = 24 * 60 * 60 * 1000;
  const rich = '当时我犹豫了很久,怕的是没有回声。'.repeat(8);
  const thin = '短。';
  const a = { ref: '/d.md#1', title: '写得很用心的一件具体事', body: rich, dateMs: now - 30 * day, index: 1, kind: 'event' };
  const b = { ref: '/d.md#2', title: '写得潦草的一件具体事', body: thin, dateMs: now - 30 * day, index: 2, kind: 'event' };
  const picked = selectAssociativeMemories([b, a], { nowMs: now, quotas: { near: 0, mid: 1, far: 0, line: 0 } }).picked;
  assert.equal(picked[0].ref, a.ref, '同覆盖时仍是分数说了算');
});
