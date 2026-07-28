import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AgentLoopService,
  TOPIC_MATERIALIZE_MIN_CUTOFFS,
  TOPIC_MAX_CHAPTERS_PER_FILE,
  buildTopicsIndexContent,
  extractTopicTagsFromOpenLoops,
  isValidTopicTag,
  normalizeTopicMaterializationState,
  parseTopicFileChapters,
  planTopicMaterialization,
  sliceDiaryEntries,
  stableTopicStateJson,
  topicChapterKey,
  writeTopicMaterialization,
  type TopicMaterializationPlan,
  type TopicMaterializationState
} from '../services/agent-loop-service';

// ════════════════════════════════════════════════════════════════════════════
// Lane E 专题物化(L1 日记 → L3 线):两段式 + 持久化水位
//
// 最硬的两条断言:
//   ① 水位闸门 —— 落盘失败时**一个字都不许落库**,下一轮拿同一个水位重做同一批,
//      且重做不许补出第二份(文件是这一层的真理源)。
//   ② 压缩提交不被拖累 —— 物化整条路径全炸时,commitCoreMemoryCompression 仍然写出
//      context_summary_written / read_cutoff_written(正常路径 **和** 22 轮兜底路径)。
//      异常逃出去会同时废掉两条提交路径 → read_cutoff 永不前移 → 撞 30MiB → 压缩永久卡死。
// ════════════════════════════════════════════════════════════════════════════

const COMPRESS_CORE_MEMORY_TOOL = 'compress_core_memory';
// 22 轮 hard-cap 兜底提交那条文案的形状(走的是同一个 commitCoreMemoryCompression)。
const FALLBACK_SUMMARY = '（这轮记忆整理没能在限定步数内写完近况。）';

interface Dirs {
  root: string;
  diaryDir: string;
  topicsDir: string;
}

function setupDirs(prefix: string): Dirs {
  const root = mkdtempSync(join(tmpdir(), `${prefix}-`));
  const diaryDir = join(root, 'notes', 'diary');
  const topicsDir = join(root, 'notes', 'topics');
  mkdirSync(diaryDir, { recursive: true });
  return { root, diaryDir, topicsDir };
}

function cleanup(dirs: Dirs): void {
  rmSync(dirs.root, { recursive: true, force: true });
}

interface RoundResult {
  plan: TopicMaterializationPlan;
  write: Awaited<ReturnType<typeof writeTopicMaterialization>>;
  /** 只有落盘全成功才前移;失败时原样返回上一轮的状态(= 水位不动)。 */
  state: TopicMaterializationState | null;
}

async function round(dirs: Dirs, cutoff: number, priorState: TopicMaterializationState | null): Promise<RoundResult> {
  const plan = await planTopicMaterialization({
    sessionKey: 'xiaoni:test-global',
    cutoff,
    priorState,
    diaryDir: dirs.diaryDir,
    topicsDir: dirs.topicsDir
  });
  const write = await writeTopicMaterialization(plan);
  return { plan, write, state: write.nextState ?? priorState ?? null };
}

// 一条线成形需要「该标签在**新写进日记的内容**里命中过 TOPIC_MATERIALIZE_MIN_CUTOFFS 个不同
// 的 read_cutoff」。所以每一轮都要真的多出一天日记 —— 一次性铺好 3 天再跑 3 轮只算 1 轮
// (第一轮水位就走到文件末尾了)。这正是 H5「用 cutoff 集合而不是计数器」想要的语义。
async function threeRounds(dirs: Dirs, tag: string): Promise<{ state: TopicMaterializationState | null; results: RoundResult[] }> {
  let state: TopicMaterializationState | null = null;
  const results: RoundResult[] = [];
  const days = ['2026-07-01', '2026-07-02', '2026-07-03'];
  for (let i = 0; i < days.length; i += 1) {
    writeFileSync(join(dirs.diaryDir, `${days[i]}.md`), `## ${tag} 第${i}\n嗯${i}。\n`, 'utf8');
    const result = await round(dirs, 10 + i, state);
    state = result.state;
    results.push(result);
  }
  return { state, results };
}

function listTopics(dirs: Dirs): string[] {
  try {
    return readdirSync(dirs.topicsDir).sort();
  } catch {
    return [];
  }
}

function chapterHeadings(body: string): string[] {
  return body.split('\n').filter((line) => line.startsWith('## '));
}

// ── 标签口径:必须和写端 memory_write.py 的 validate_tag 逐条一致 ─────────────
// 口径不一致的后果是最阴的一种:她**打了**标签,系统**不算**,这条线永远连不起来,
// 而且没有任何地方会告诉她。

test('topic tag charset matches the write-end skill (memory_write.py validate_tag)', () => {
  assert.equal(isValidTopicTag('周蕊'), true, '中文标签必须成线(JS 的 \\w 只有 ASCII,写死会全拒)');
  assert.equal(isValidTopicTag('c-d_e'), true);
  assert.equal(isValidTopicTag('decay'), true);
  assert.equal(isValidTopicTag('39'), false, '纯数字读起来是引用编号(Issue #39),写端也拒');
  assert.equal(isValidTopicTag('INDEX'), false, 'topics/INDEX.md 自己占着这个名字');
  assert.equal(isValidTopicTag('index'), false, '大小写不敏感');
  assert.equal(isValidTopicTag('周 蕊'), false, '含空格 —— 标签要当文件名用');
  assert.equal(isValidTopicTag('a.b'), false);
  assert.equal(isValidTopicTag('a/b'), false, '路径分隔符绝不许进文件名');
  assert.equal(isValidTopicTag('..'), false);
  assert.equal(isValidTopicTag(''), false);
  assert.equal(isValidTopicTag(null), false);
  assert.equal(isValidTopicTag('长'.repeat(40)), true, '上限 40 码位(写端 TAG_MAX_CODEPOINTS)');
  assert.equal(isValidTopicTag('长'.repeat(41)), false);
});

test('open-loops tag extraction matches the write-end skill (extract_tags)', () => {
  assert.deepEqual(extractTopicTagsFromOpenLoops('- [ ] 修好了 #周蕊 (7/27)'), ['周蕊']);
  assert.deepEqual(extractTopicTagsFromOpenLoops('- [ ] explorabl.es Issue #39 提了'), []);
  assert.deepEqual(extractTopicTagsFromOpenLoops('- [ ] a #b #c-d_e'), ['b', 'c-d_e']);
  assert.deepEqual(extractTopicTagsFromOpenLoops('# Open Loops\n## 二级标题'), [], 'markdown 标题不是标签');
  assert.deepEqual(extractTopicTagsFromOpenLoops('a #x\nb #X'), ['x'], '同一条线不许因为大小写变成两条');
  assert.deepEqual(extractTopicTagsFromOpenLoops('- [ ] 看 #(周蕊)'), [], '括号被排掉');
  assert.deepEqual(extractTopicTagsFromOpenLoops(null), []);
});

// ── 归一化去重:三个函数串起来才认得出同一件事 ──────────────────────────────

test('topicChapterKey folds the L3 chapter form and the diary-heading form into one identity', () => {
  // L3 章节标题带 `M/D ` 前缀;日记标题没有。normalizeEventText 只折空白 + 小写,不碰前缀
  // → 单用它认不出同一件事(之前有一版设计就漏了 stripChapterDatePrefix,实测 100% 重复)。
  assert.equal(topicChapterKey('7/19 周蕊说想看开场 #周蕊'), topicChapterKey('周蕊说想看开场'));
  assert.equal(topicChapterKey('12/30  跨年 '), topicChapterKey('跨年'));
  assert.equal(topicChapterKey('7/4 Decay  Again'), topicChapterKey('decay again'));
  assert.notEqual(topicChapterKey('周蕊说想看开场'), topicChapterKey('周蕊不想看了'));
  assert.equal(topicChapterKey(null), '');
});

test('sliceDiaryEntries records byte offsets so the watermark and stat.size share one ruler', () => {
  const text = '## 一\n正文一\n\n## 二\n正文二\n';
  const entries = sliceDiaryEntries(text);
  assert.deepEqual(entries.map((entry) => entry.title), ['一', '二']);
  assert.deepEqual(entries.map((entry) => entry.lead), ['正文一', '正文二']);
  assert.equal(entries[1].endByte, Buffer.byteLength(text, 'utf8'));
  assert.ok(entries[0].endByte < entries[1].endByte);
  assert.deepEqual(sliceDiaryEntries(''), []);
});

test('parseTopicFileChapters keeps her handwritten header and chapter bodies verbatim', () => {
  const parsed = parseTopicFileChapters('# 周蕊\n\n> 我自己加的一句\n\n## 7/19 一\n她写的\n\n## 7/20 二\n');
  assert.deepEqual(parsed.header, ['# 周蕊', '', '> 我自己加的一句', '']);
  assert.equal(parsed.chapters.length, 2);
  assert.deepEqual(parsed.chapters[0].raw, ['## 7/19 一', '她写的', '']);
  assert.equal(parsed.chapters[0].date, '07-19');
  assert.deepEqual(parseTopicFileChapters(null), { header: [], chapters: [] });
});

// ── 主路径:三轮成线 + 幂等 ─────────────────────────────────────────────────

test('a tag becomes a line after 3 distinct cutoffs, then stays byte-stable', async () => {
  const dirs = setupDirs('topic-basic');
  try {
    writeFileSync(
      join(dirs.diaryDir, 'open-loops.md'),
      '# Open Loops\n\n- [ ] 开场还要再磨 #周蕊 (7/19)\n- [ ] explorabl.es Issue #39 提了\n- [ ] 什么 #INDEX\n',
      'utf8'
    );
    writeFileSync(join(dirs.diaryDir, '2026-07-19.md'), '## 周蕊说想看开场\n磨了一遍砍掉一句。\n', 'utf8');

    const r1 = await round(dirs, 100, null);
    assert.equal(r1.plan.ok, true);
    assert.deepEqual(r1.plan.whitelistTags, ['周蕊'], '纯数字 / INDEX 标签不进白名单');
    assert.equal(r1.plan.writes.length, 0);
    assert.deepEqual(listTopics(dirs), [], '还没成线 → 一个文件都不许建(也不许 mkdir)');
    assert.equal(r1.state?.candidates['周蕊'].cutoffs.length, 1);
    assert.ok((r1.state?.watermarks['2026-07-19.md'] ?? 0) > 0, '水位落在文件末尾');

    writeFileSync(join(dirs.diaryDir, '2026-07-20.md'), '## 周蕊回了一句\n她说再看看。\n', 'utf8');
    const r2 = await round(dirs, 200, r1.state);
    assert.equal(r2.plan.writes.length, 0);
    assert.equal(r2.state?.candidates['周蕊'].cutoffs.length, 2);

    writeFileSync(join(dirs.diaryDir, '2026-07-21.md'), '## 又想起周蕊那句\n下次带过去。\n', 'utf8');
    const r3 = await round(dirs, 300, r2.state);
    assert.equal(r3.plan.writes.length, 1, `第 ${TOPIC_MATERIALIZE_MIN_CUTOFFS} 轮成线`);
    assert.deepEqual(r3.write.wroteTags, ['周蕊']);
    assert.deepEqual(listTopics(dirs), ['INDEX.md', '周蕊.md']);

    const body = readFileSync(join(dirs.topicsDir, '周蕊.md'), 'utf8');
    const headings = chapterHeadings(body);
    assert.equal(headings.length, 3, '累计的三天各写一章(不是只写命中那一轮)');
    for (const heading of headings) {
      assert.match(heading, /^## \d{1,2}\/\d{1,2} /, '章节标题形状(验收 2)');
    }
    assert.match(body, /→ 2026-07-19\.md/, '每章指回当天日记(验收 2)');
    assert.match(body, /→ 2026-07-21\.md/);

    const index = readFileSync(join(dirs.topicsDir, 'INDEX.md'), 'utf8');
    assert.match(index, /- 周蕊 \| 3 段进展，最近 7\/21（细目在 周蕊\.md）/);
    assert.deepEqual(r3.state?.materialized, ['周蕊']);

    // §4 隔离目录:产物一个都不许落进 notes/diary/(那是被动召回腿的语料源)。
    assert.deepEqual(
      readdirSync(dirs.diaryDir).sort(),
      ['2026-07-19.md', '2026-07-20.md', '2026-07-21.md', 'open-loops.md'],
      'notes/diary/ 不许多出任何产物'
    );

    // 幂等:日记没变 → 零文件写入、零字节漂移,状态也不该漂移(→ 连库都不写)
    const before = readFileSync(join(dirs.topicsDir, '周蕊.md'));
    const r4 = await round(dirs, 400, r3.state);
    assert.equal(r4.plan.writes.length, 0);
    assert.deepEqual(r4.write.wroteTags, []);
    assert.equal(r4.write.indexWritten, false);
    assert.deepEqual(readFileSync(join(dirs.topicsDir, '周蕊.md')), before);
    assert.equal(stableTopicStateJson(r4.state), r4.plan.priorStateJson);
  } finally {
    cleanup(dirs);
  }
});

test('replaying the same plan (crash between file write and watermark write) adds nothing', async () => {
  const dirs = setupDirs('topic-replay');
  try {
    writeFileSync(join(dirs.diaryDir, 'open-loops.md'), '- [ ] 追 #decay (7/1)\n', 'utf8');
    const { results } = await threeRounds(dirs, 'decay');
    const plan = results[2].plan;
    const before = readFileSync(join(dirs.topicsDir, 'decay.md'));

    // 落盘成功了、水位还没落库就崩了 → 下一轮拿同一个 plan 再写一次。
    const again = await writeTopicMaterialization(plan);
    assert.equal(again.ok, true);
    assert.deepEqual(again.wroteTags, [], '零写入');
    assert.deepEqual(readFileSync(join(dirs.topicsDir, 'decay.md')), before, '零字节漂移');
    assert.equal(chapterHeadings(readFileSync(join(dirs.topicsDir, 'decay.md'), 'utf8')).length, 3);
  } finally {
    cleanup(dirs);
  }
});

// ── 水位闸门 ────────────────────────────────────────────────────────────────

test('watermark only advances after a successful write; a failure replays the same batch', async () => {
  const dirs = setupDirs('topic-writefail');
  try {
    writeFileSync(join(dirs.diaryDir, 'open-loops.md'), '- [ ] 追 #decay (7/1)\n', 'utf8');
    // 「目录占了文件名」—— 不用 chmod:chmod 拦不住 root,root 跑测试会让断言变成空绿。
    mkdirSync(join(dirs.topicsDir, 'decay.md'), { recursive: true });

    const { state, results } = await threeRounds(dirs, 'decay');
    const blocked = results[2];
    assert.equal(blocked.plan.writes.length, 1, '第三轮该写了');
    assert.deepEqual(blocked.write.failedTags, ['decay']);
    assert.equal(blocked.write.nextState, null, '有标签写失败 → 整批一个字都不许落库');
    assert.equal(blocked.state, results[1].state, '水位停在第二轮');

    // 解除阻塞。没有任何新日记内容,但水位没动 → 同一批被重新扫出来、重新补齐。
    rmSync(join(dirs.topicsDir, 'decay.md'), { recursive: true, force: true });
    const retry = await round(dirs, 50, state);
    assert.deepEqual(retry.write.wroteTags, ['decay']);
    assert.equal(
      chapterHeadings(readFileSync(join(dirs.topicsDir, 'decay.md'), 'utf8')).length,
      3,
      '重做补齐同一批,不多不少'
    );
  } finally {
    cleanup(dirs);
  }
});

test('a topic file that exists but cannot be read is refused, never replaced', async () => {
  const dirs = setupDirs('topic-symlink');
  try {
    writeFileSync(join(dirs.diaryDir, 'open-loops.md'), '- [ ] x #wave (7/1)\n', 'utf8');
    mkdirSync(dirs.topicsDir, { recursive: true });
    // 悬空 symlink:read 报 ENOENT,但 rename 上去会把这个路径实体顶掉 —— 那就是写端
    // load_for_edit 钉住的那个陷阱(拿新内容盖掉一份读不出来的旧文件 = 静默丢记忆)。
    symlinkSync(join(dirs.root, 'gone-forever.md'), join(dirs.topicsDir, 'wave.md'));
    const { results } = await threeRounds(dirs, 'wave');
    const blocked = results[2];
    assert.deepEqual(blocked.write.failedTags, ['wave']);
    assert.equal(blocked.write.nextState, null);
    assert.equal(lstatSync(join(dirs.topicsDir, 'wave.md')).isSymbolicLink(), true, 'symlink 不许被顶掉');
  } finally {
    cleanup(dirs);
  }
});

// ── 她的编辑优先 ────────────────────────────────────────────────────────────

test('a chapter already present in the file (L3 form) is not duplicated by the diary-heading form', async () => {
  const dirs = setupDirs('topic-dedup');
  try {
    writeFileSync(join(dirs.diaryDir, 'open-loops.md'), '- [ ] x #周蕊 (7/1)\n', 'utf8');
    writeFileSync(join(dirs.diaryDir, '2026-07-19.md'), '## 周蕊说想看开场\n磨了一遍。\n', 'utf8');
    mkdirSync(dirs.topicsDir, { recursive: true });
    writeFileSync(
      join(dirs.topicsDir, '周蕊.md'),
      '# 周蕊\n\n## 7/19 周蕊说想看开场 #周蕊\n她自己写的话\n→ 2026-07-19.md\n',
      'utf8'
    );
    // 已成形的线 → 白名单命中,pending 立刻可写(不用再等 3 轮)。
    const priorState = normalizeTopicMaterializationState({ materialized: ['周蕊'] });
    await round(dirs, 7, priorState);
    const body = readFileSync(join(dirs.topicsDir, '周蕊.md'), 'utf8');
    assert.equal(
      body.split('\n').filter((line) => line.includes('周蕊说想看开场')).length,
      1,
      '同一条进展只能有一份'
    );
    assert.match(body, /她自己写的话/, '她手写的正文不许被机械抄的首句覆盖');
  } finally {
    cleanup(dirs);
  }
});

test('a chapter she deleted by hand is never rebuilt, but new chapters still land', async () => {
  const dirs = setupDirs('topic-deleted');
  try {
    writeFileSync(join(dirs.diaryDir, 'open-loops.md'), '- [ ] x #Pond (7/1)\n', 'utf8');
    const { state } = await threeRounds(dirs, 'Pond');
    const topicPath = join(dirs.topicsDir, 'Pond.md');
    assert.equal(chapterHeadings(readFileSync(topicPath, 'utf8')).length, 3);

    const pruned = readFileSync(topicPath, 'utf8').replace(/## \d+\/\d+ Pond 第1\n[^\n]*\n→ [^\n]*\n\n/, '');
    writeFileSync(topicPath, pruned, 'utf8');
    writeFileSync(join(dirs.diaryDir, '2026-07-04.md'), '## Pond 第3\n新的。\n', 'utf8');
    await round(dirs, 40, state);

    const after = readFileSync(topicPath, 'utf8');
    assert.equal(after.includes('Pond 第1'), false, '手删过的章绝不重建');
    assert.equal(after.includes('Pond 第3'), true, '新的一章照补');
  } finally {
    cleanup(dirs);
  }
});

test('H3: a materialized line keeps updating after she removes the open-loops row', async () => {
  const dirs = setupDirs('topic-h3');
  try {
    writeFileSync(join(dirs.diaryDir, 'open-loops.md'), '- [ ] x #Trust (7/1)\n', 'utf8');
    const { state } = await threeRounds(dirs, 'Trust');
    // 整行删掉(比划掉更狠)。白名单包含 state.materialized,所以线继续更新 ——
    // 这直接支撑「以为做完了、后来又提起」那个 case。
    rmSync(join(dirs.diaryDir, 'open-loops.md'));
    writeFileSync(join(dirs.diaryDir, '2026-07-05.md'), '## Trust 又提起来了\n新进展。\n', 'utf8');
    const result = await round(dirs, 40, state);
    assert.deepEqual(result.write.wroteTags, ['Trust']);
    assert.match(readFileSync(join(dirs.topicsDir, 'Trust.md'), 'utf8'), /Trust 又提起来了/);
  } finally {
    cleanup(dirs);
  }
});

test('H6: chapters are capped and folding stays byte-stable across rounds', async () => {
  const dirs = setupDirs('topic-fold');
  try {
    writeFileSync(join(dirs.diaryDir, 'open-loops.md'), '- [ ] x #decay (7/1)\n', 'utf8');
    let state: TopicMaterializationState | null = null;
    for (let i = 0; i < TOPIC_MAX_CHAPTERS_PER_FILE + 10; i += 1) {
      const day = `2026-07-${String((i % 28) + 1).padStart(2, '0')}`;
      appendFileSync(join(dirs.diaryDir, `${day}.md`), `## decay 步骤${i}\n嗯${i}。\n`, 'utf8');
      state = (await round(dirs, 1000 + i, state)).state;
    }
    const body = readFileSync(join(dirs.topicsDir, 'decay.md'), 'utf8');
    assert.ok(chapterHeadings(body).length <= TOPIC_MAX_CHAPTERS_PER_FILE, `章数上限 ${TOPIC_MAX_CHAPTERS_PER_FILE}`);
    assert.match(body, /^> 更早的 \d+ 段进展在当天日记里/m, '折叠留一行说清更早的在哪');

    const before = readFileSync(join(dirs.topicsDir, 'decay.md'));
    await round(dirs, 9999, state);
    assert.deepEqual(readFileSync(join(dirs.topicsDir, 'decay.md')), before, '折叠后再跑一轮不许字节漂移');
  } finally {
    cleanup(dirs);
  }
});

// ── fail-open 每条路径 ──────────────────────────────────────────────────────

test('fail-open: unreadable diary dir / no tags / broken topicsDir / bad cutoff', async () => {
  // /dev/null 是文件不是目录 → readdir 一律 ENOTDIR。
  const missing = await planTopicMaterialization({
    sessionKey: 's',
    cutoff: 1,
    diaryDir: '/dev/null/no-such-dir',
    topicsDir: '/dev/null/no-such-topics'
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.skippedReason, 'diary_dir_unreadable');
  const missingWrite = await writeTopicMaterialization(missing);
  assert.equal(missingWrite.ok, false);
  assert.equal(missingWrite.nextState, null);
  assert.equal((await writeTopicMaterialization(null)).ok, false);

  const dirs = setupDirs('topic-failopen');
  try {
    writeFileSync(join(dirs.diaryDir, '2026-07-01.md'), '## 一\n', 'utf8');
    // open-loops 不存在 + 零已物化 → 白名单为空。ok:true(没活干),但绝不建目录。
    const noTags = await planTopicMaterialization({
      sessionKey: 's',
      cutoff: 1,
      diaryDir: dirs.diaryDir,
      topicsDir: dirs.topicsDir
    });
    assert.equal(noTags.ok, true);
    assert.equal(noTags.skippedReason, 'no_whitelisted_tags');
    await writeTopicMaterialization(noTags);
    assert.deepEqual(listTopics(dirs), [], '没有线就绝不 mkdir');

    // cutoff 不是有限数 → 结构性跳过(cutoff 是轮次身份,坏了整套计数就没意义)。
    const badCutoff = await planTopicMaterialization({
      sessionKey: 's',
      cutoff: Number.NaN,
      diaryDir: dirs.diaryDir,
      topicsDir: dirs.topicsDir
    });
    assert.equal(badCutoff.ok, false);
    assert.equal(badCutoff.skippedReason, 'cutoff_not_finite');

    // topicsDir 不是字符串 → nodePath.join 在所有内层 try 之前抛,验外层 catch。
    const broken = await writeTopicMaterialization({
      ok: true,
      sessionKey: 's',
      diaryDir: dirs.diaryDir,
      topicsDir: {} as unknown as string,
      cutoff: 1,
      priorStateJson: 'null',
      nextState: normalizeTopicMaterializationState({
        candidates: { a: { cutoffs: [1, 2, 3], pending: [{ d: '2026-07-01', t: 't', l: 'l' }] } }
      }),
      writes: [{ tag: 'a', chapters: [{ d: '2026-07-01', t: 't', l: 'l' }] }],
      whitelistTags: ['a'],
      scannedFiles: 0,
      readFiles: 0
    });
    assert.equal(broken.ok, false);
    assert.equal(broken.nextState, null, '外层 catch 也必须守住水位闸门');

    // 单份日记读不出来只跳过那一份,别的日期照做,整体 ok。
    writeFileSync(join(dirs.diaryDir, 'open-loops.md'), '- [ ] x #decay (7/1)\n', 'utf8');
    mkdirSync(join(dirs.diaryDir, '2026-07-02.md'), { recursive: true });
    writeFileSync(join(dirs.diaryDir, '2026-07-03.md'), '## decay 有进展\n嗯。\n', 'utf8');
    const partial = await planTopicMaterialization({
      sessionKey: 's',
      cutoff: 2,
      diaryDir: dirs.diaryDir,
      topicsDir: dirs.topicsDir
    });
    assert.equal(partial.ok, true);
    assert.equal(partial.nextState.candidates.decay.pending.length, 1, '坏的那一天跳过,好的那一天照记');
    assert.equal(partial.nextState.watermarks['2026-07-02.md'], undefined, '坏的那一天水位不许前移');
  } finally {
    cleanup(dirs);
  }
});

test('watermarks are pruned for vanished diary files, but never on an empty-looking dir', async () => {
  const dirs = setupDirs('topic-watermark-prune');
  try {
    writeFileSync(join(dirs.diaryDir, 'open-loops.md'), '- [ ] x #decay (7/1)\n', 'utf8');
    writeFileSync(join(dirs.diaryDir, '2026-07-01.md'), '## decay 一\n嗯。\n', 'utf8');
    writeFileSync(join(dirs.diaryDir, '2026-07-02.md'), '## decay 二\n嗯。\n', 'utf8');
    const first = await round(dirs, 1, null);
    assert.deepEqual(Object.keys(first.state?.watermarks ?? {}).sort(), ['2026-07-01.md', '2026-07-02.md']);

    rmSync(join(dirs.diaryDir, '2026-07-01.md'));
    const second = await round(dirs, 2, first.state);
    assert.deepEqual(Object.keys(second.state?.watermarks ?? {}), ['2026-07-02.md'], '文件没了就别一直留着水位');

    // 挂载错位:readdir 成功但目录是空的。这一帧**绝不许**清空水位 —— 清了等于把整套记账
    // 烧掉,下一轮从头重扫(CLAUDE.md 的 sudo 丢 HOME 挂空目录就是这个形状)。
    const emptyDirs = setupDirs('topic-watermark-empty');
    try {
      const onEmpty = await planTopicMaterialization({
        sessionKey: 's',
        cutoff: 3,
        priorState: second.state,
        diaryDir: emptyDirs.diaryDir,
        topicsDir: emptyDirs.topicsDir
      });
      assert.deepEqual(Object.keys(onEmpty.nextState.watermarks), ['2026-07-02.md'], '空目录那一帧不许动水位');
    } finally {
      cleanup(emptyDirs);
    }
  } finally {
    cleanup(dirs);
  }
});

test('normalizeTopicMaterializationState treats a broken shape as "start from zero"', () => {
  assert.deepEqual(normalizeTopicMaterializationState('not an object'), {
    v: 1,
    watermarks: {},
    candidates: {},
    materialized: []
  });
  const partial = normalizeTopicMaterializationState({
    watermarks: { 'a.md': 'x', 'b.md': 12, 'c.md': -1 },
    candidates: {
      INDEX: { cutoffs: [1] },
      39: { cutoffs: [1] },
      ok: { cutoffs: [3, 1, 1], pending: [{ d: 'bad', t: 't' }, { d: '2026-07-01', t: 't' }], folded: -5 }
    },
    materialized: ['ok', 'ok', 'INDEX']
  });
  assert.deepEqual(partial.watermarks, { 'b.md': 12 }, '非数 / 负数水位一律丢');
  assert.deepEqual(Object.keys(partial.candidates), ['ok'], '不合法标签的候选一律丢');
  assert.deepEqual(partial.candidates.ok.cutoffs, [1, 3], '去重 + 升序');
  assert.deepEqual(partial.candidates.ok.pending, [{ d: '2026-07-01', t: 't', l: '' }]);
  assert.equal(partial.candidates.ok.folded, 0);
  assert.deepEqual(partial.materialized, ['ok']);
});

test('buildTopicsIndexContent returns null when there is no line yet (never writes an empty menu)', () => {
  assert.equal(buildTopicsIndexContent(normalizeTopicMaterializationState(null)), null);
  assert.equal(
    buildTopicsIndexContent(normalizeTopicMaterializationState({ materialized: ['x'] })),
    null,
    '被标记成线但零章 → 不写'
  );
});

// ── 最硬的一条:压缩提交绝不被物化拖累 ──────────────────────────────────────

function buildCommitHarness(options?: { failWatermarkWrite?: boolean }) {
  const atomicWrites: Array<Record<string, unknown>> = [];
  const watermarkWrites: Array<{ sessionKey: string; state: Record<string, unknown> | null }> = [];
  let persisted: Record<string, unknown> | null = null;
  const service = new AgentLoopService({
    commitSessionContextSummaryAndReadCutoff: async (params: any) => {
      atomicWrites.push(params);
      return {
        committed: true,
        state: {
          sessionKey: params.sessionKey,
          readCutoffAfterStackIndex: params.readCutoffAfterStackIndex,
          lastContextWindowTokens: params.lastContextWindowTokens,
          lastTargetBudgetTokens: params.lastTargetBudgetTokens,
          lastHardBudgetTokens: params.lastHardBudgetTokens,
          contextSummary: params.contextSummary,
          pendingProactiveShare: null,
          pendingProactiveShareAge: 0,
          updatedAt: null
        }
      };
    },
    // 物化【算】段要读上一轮水位,走的就是这个入口。
    getSessionReadCutoffState: async () => ({
      sessionKey: 'xiaoni:test-global',
      readCutoffAfterStackIndex: null,
      topicMaterializationState: persisted
    }),
    upsertSessionTopicMaterializationState: async (params: any) => {
      if (options?.failWatermarkWrite) {
        throw new Error('watermark write blew up');
      }
      watermarkWrites.push(params);
      persisted = params.state;
    },
    logTimelineEvent: async () => {}
  } as any);
  const commit = (text: string, callId: string, cutoff: number) => (service as any).commitCoreMemoryCompression({
    rawToolResult: { compressed: true, text, outcome: 'core_memory_compressed' },
    toolCall: { name: COMPRESS_CORE_MEMORY_TOOL, callId },
    compression: {
      required: true,
      contextSessionKey: 'xiaoni:test-global',
      readCutoffAfterStackIndex: cutoff,
      previousReadCutoffAfterStackIndex: null,
      compressionCoveredEndStackIndex: cutoff + 30,
      historyUserId: 303,
      historyGroupId: null,
      historyScope: 'global',
      lastContextWindowTokens: 400000,
      lastTargetBudgetTokens: 280000,
      lastHardBudgetTokens: 380000
    },
    contextSessionKey: 'xiaoni:test-global',
    sourceResponseId: `llm-${callId}`,
    metadata: { trace_id: `trace-${callId}`, execution_mode: 'compression_fork' }
  });
  return { commit, atomicWrites, watermarkWrites, getPersisted: () => persisted };
}

// XIAONI_TOPICS_DIR / XIAONI_DIARY_INDEX_PATH 是进程级的,跑完必须还原。
async function withTopicEnv<T>(dirs: Dirs | null, topicsDirOverride: string | null, fn: () => Promise<T>): Promise<T> {
  const keys = ['XIAONI_DIARY_INDEX_PATH', 'XIAONI_PEOPLE_INDEX_PATH', 'XIAONI_DIARY_MANIFEST_DIR', 'XIAONI_TOPICS_DIR'] as const;
  const saved = keys.map((key) => [key, process.env[key]] as [string, string | undefined]);
  if (dirs) {
    process.env.XIAONI_DIARY_INDEX_PATH = join(dirs.diaryDir, 'INDEX.md');
    process.env.XIAONI_PEOPLE_INDEX_PATH = join(dirs.root, 'notes', 'people', 'INDEX.md');
    process.env.XIAONI_DIARY_MANIFEST_DIR = join(dirs.root, 'notes', 'diary-manifest');
  } else {
    process.env.XIAONI_DIARY_INDEX_PATH = '/dev/null/no-such-dir/INDEX.md';
    process.env.XIAONI_PEOPLE_INDEX_PATH = '/dev/null/no-such-dir/people-INDEX.md';
    process.env.XIAONI_DIARY_MANIFEST_DIR = '/dev/null/no-such-dir/diary-manifest';
  }
  if (topicsDirOverride === null) {
    delete process.env.XIAONI_TOPICS_DIR;
  } else {
    process.env.XIAONI_TOPICS_DIR = topicsDirOverride;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test('commitCoreMemoryCompression still commits when the whole materialization path is hostile', async () => {
  // 每一条路径都炸:日记目录不存在(/dev/null/...)、专题目录也不存在、水位写入口直接抛。
  // 正常提交路径 **和** 22 轮 hard-cap 兜底提交路径(同一个函数)都必须照常写出。
  await withTopicEnv(null, '/dev/null/no-such-topics', async () => {
    const { commit, atomicWrites, watermarkWrites } = buildCommitHarness({ failWatermarkWrite: true });

    const normal = await commit('原子写入的近况。', 'topic-frame-normal', 171);
    assert.equal(normal.toolResult.context_summary_written, true);
    assert.equal(normal.toolResult.read_cutoff_written, true);
    assert.equal(normal.artifact.read_cutoff_after_stack_index, 171, 'read_cutoff 必须照常前移');

    const fallback = await commit(FALLBACK_SUMMARY, 'topic-frame-fallback', 205);
    assert.equal(fallback.toolResult.context_summary_written, true);
    assert.equal(fallback.toolResult.read_cutoff_written, true, '22 轮兜底提交也必须照常前移 cutoff');
    assert.equal(fallback.artifact.read_cutoff_after_stack_index, 205);

    assert.equal(atomicWrites.length, 2);
    assert.deepEqual(watermarkWrites, [], '一条线都没成形 → 水位一次都不该写');
  });
});

test('the compression frame drives materialization end to end and gates the watermark on the write', async () => {
  const dirs = setupDirs('topic-commit-e2e');
  try {
    writeFileSync(join(dirs.diaryDir, 'open-loops.md'), '- [ ] 追 #decay (7/1)\n', 'utf8');
    await withTopicEnv(dirs, dirs.topicsDir, async () => {
      const { commit, watermarkWrites, getPersisted } = buildCommitHarness();

      // 前两轮:攒 cutoff,零文件产物。
      for (const [index, day] of ['2026-07-01', '2026-07-02'].entries()) {
        writeFileSync(join(dirs.diaryDir, `${day}.md`), `## decay 第${index}\n嗯${index}。\n`, 'utf8');
        await commit(`近况 ${index}`, `e2e-${index}`, 100 + index);
      }
      assert.deepEqual(listTopics(dirs), [], `不到 ${TOPIC_MATERIALIZE_MIN_CUTOFFS} 轮不建文件`);
      assert.equal(watermarkWrites.length, 2, '水位每轮照常前移(没有落盘失败)');

      // 第三轮:成线,文件落盘 + 水位前移。
      writeFileSync(join(dirs.diaryDir, '2026-07-03.md'), '## decay 第2\n嗯2。\n', 'utf8');
      const third = await commit('近况 3', 'e2e-3', 102);
      assert.equal(third.toolResult.read_cutoff_written, true);
      assert.deepEqual(listTopics(dirs), ['INDEX.md', 'decay.md']);
      assert.equal(watermarkWrites.length, 3);
      assert.deepEqual((getPersisted() as any).materialized, ['decay']);
      const stateAfterThird = JSON.stringify(getPersisted());

      // 第四轮:把目标文件名换成目录 → 落盘失败 → 压缩提交照做,水位一个字都不许动。
      rmSync(join(dirs.topicsDir, 'decay.md'));
      mkdirSync(join(dirs.topicsDir, 'decay.md'), { recursive: true });
      writeFileSync(join(dirs.diaryDir, '2026-07-04.md'), '## decay 第3\n嗯3。\n', 'utf8');
      const fourth = await commit('近况 4', 'e2e-4', 103);
      assert.equal(fourth.toolResult.context_summary_written, true, '压缩提交绝不被落盘失败拖掉');
      assert.equal(fourth.toolResult.read_cutoff_written, true);
      assert.equal(watermarkWrites.length, 3, '落盘失败 → 水位不许前移');
      assert.equal(JSON.stringify(getPersisted()), stateAfterThird);
    });
  } finally {
    cleanup(dirs);
  }
});
