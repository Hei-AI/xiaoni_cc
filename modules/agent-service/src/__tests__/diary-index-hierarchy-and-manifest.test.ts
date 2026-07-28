import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync, rmSync, chmodSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AgentLoopService,
  DIARY_INDEX_RECENT_DAYS,
  maintainDiaryIndexHierarchy,
  writeDiaryHeadingManifests
} from '../services/agent-loop-service';

// ════════════════════════════════════════════════════════════════════════════
// T3 引擎接管月索引降级 + 回填存量 / T4 日内 heading 目录
//
// 两件都挂在 commitCoreMemoryCompression 的原子提交帧上,所以**最硬的一条断言在文件
// 末尾**:注入异常后 commitCoreMemoryCompression 仍然照常提交。异常逃出去会同时废掉
// 正常提交和 22 轮 hard-cap 兜底提交 → read_cutoff 永不前移 → 撞 30MiB → 压缩永久卡死。
// ════════════════════════════════════════════════════════════════════════════

const COMPRESS_CORE_MEMORY_TOOL = 'compress_core_memory';
// 兜底提交那条文案的形状(走的是同一个 commitCoreMemoryCompression)。
const FALLBACK_SUMMARY = '（这轮记忆整理没能在限定步数内写完近况。）';

function scratchDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `${prefix}-`));
}

async function withDirAsync<T>(prefix: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = scratchDir(prefix);
  try {
    return await fn(dir);
  } finally {
    try {
      chmodSync(dir, 0o700);
    } catch {
      // 同上
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeIndex(dir: string, lines: string[]): void {
  writeFileSync(join(dir, 'INDEX.md'), `${lines.join('\n')}\n`, 'utf8');
}

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

function snapshotDir(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isFile()) {
      out.set(name, read(path));
    }
  }
  return out;
}

// 北京时间 12:00 = UTC 04:00,离两边的日界都远,窗口计算不会被时区抖动影响。
function beijingNoon(iso: string): Date {
  return new Date(`${iso}T12:00:00+08:00`);
}

// ── T3:滚动窗口边界 ────────────────────────────────────────────────────────

test('T3 window boundary: exactly DIARY_INDEX_RECENT_DAYS days back stays, one day older moves', async () => {
  assert.equal(DIARY_INDEX_RECENT_DAYS, 7, '改窗口天数要同时改 commit_memory.py 的 DIARY_INDEX_RECENT_DAYS');
  await withDirAsync('diary-window', async (dir) => {
    // 北京 2026-07-28 → 窗口 [2026-07-22, 2026-07-28]。边界那天(07-22)必须留下。
    writeIndex(dir, [
      '# 日记目录',
      '',
      '- 2026-07-28 | 今天',
      '- 2026-07-22 | 窗口最老的一天(边界内)',
      '- 2026-07-21 | 掉出窗口一天'
    ]);
    const result = await maintainDiaryIndexHierarchy({ diaryDir: dir, now: beijingNoon('2026-07-28') });
    assert.equal(result.ok, true);
    assert.equal(result.movedDayLines, 1);

    const top = read(join(dir, 'INDEX.md'));
    assert.ok(top.includes('- 2026-07-28 | 今天'));
    assert.ok(top.includes('- 2026-07-22 | 窗口最老的一天(边界内)'), '边界那天在窗口内,不许搬');
    assert.ok(!top.includes('2026-07-21'), '掉出窗口的行必须从顶层摘掉');

    const month = read(join(dir, 'INDEX-2026-07.md'));
    // 行原样搬,一个字都不改写
    assert.ok(month.includes('- 2026-07-21 | 掉出窗口一天'));
  });
});

test('T3 uses the Beijing date, not the container clock (UTC 17:00 is already tomorrow in 东八)', async () => {
  await withDirAsync('diary-tz', async (dir) => {
    // UTC 2026-07-27T17:00 → 北京 2026-07-28T01:00 → 窗口起点 07-22(而不是 UTC 口径的 07-21)。
    writeIndex(dir, ['# 日记目录', '', '- 2026-07-21 | 只在北京口径下掉出窗口']);
    const result = await maintainDiaryIndexHierarchy({
      diaryDir: dir,
      now: new Date('2026-07-27T17:00:00Z')
    });
    assert.equal(result.ok, true);
    assert.equal(result.movedDayLines, 1, '按北京日期 07-21 已超窗;若按 UTC 会误判为在窗口内');
    assert.ok(read(join(dir, 'INDEX-2026-07.md')).includes('- 2026-07-21 |'));
  });
});

test('T3 month row (- YYYY-MM | …) is never mistaken for a day row', async () => {
  await withDirAsync('diary-monthrow', async (dir) => {
    writeIndex(dir, [
      '# 日记目录',
      '',
      '- 2026-07-28 | 今天',
      '- 2026-07 | 七月。（细目在 INDEX-2026-07.md）',
      '- 2026-06 | 六月。（细目在 INDEX-2026-06.md）'
    ]);
    const result = await maintainDiaryIndexHierarchy({ diaryDir: dir, now: beijingNoon('2026-07-28') });
    assert.equal(result.ok, true);
    assert.equal(result.movedDayLines, 0, '月行天然不匹配按天正则,不许被当成超窗的按天行搬走');
    assert.equal(result.topLevelRewritten, false);
    assert.ok(read(join(dir, 'INDEX.md')).includes('- 2026-06 | 六月。'));
    assert.equal(existsSync(join(dir, 'INDEX-2026-06.md')), false, '没搬东西就不许凭空建月索引');
  });
});

// ── T3:跨月 + 月索引不存在时新建 ────────────────────────────────────────────

test('T3 cross-month demotion in one pass creates each month index from scratch and adds one pointer row per month', async () => {
  await withDirAsync('diary-crossmonth', async (dir) => {
    writeIndex(dir, [
      '# 日记目录',
      '',
      '- 2026-08-02 | 八月二号',
      '- 2026-08-01 | 八月一号',
      '- 2026-07-31 | 七月最后一天',
      '- 2026-06-30 | 六月最后一天'
    ]);
    const result = await maintainDiaryIndexHierarchy({ diaryDir: dir, now: beijingNoon('2026-08-07') });
    assert.equal(result.ok, true);
    assert.equal(result.movedDayLines, 2);
    assert.equal(result.monthRowsAdded.length, 2);
    assert.equal(result.monthFilesWritten.length, 2);

    const july = read(join(dir, 'INDEX-2026-07.md'));
    const june = read(join(dir, 'INDEX-2026-06.md'));
    assert.ok(july.startsWith('# 2026-07 日记月索引'));
    assert.ok(july.includes('- 2026-07-31 | 七月最后一天'), '按行自己的月份落对文件');
    assert.ok(!july.includes('2026-06-30'));
    assert.ok(june.includes('- 2026-06-30 | 六月最后一天'));

    const top = read(join(dir, 'INDEX.md'));
    assert.ok(!top.includes('2026-07-31'));
    assert.ok(!top.includes('2026-06-30'));
    assert.ok(top.includes('（细目在 INDEX-2026-07.md）'), '顶层给搬空的月留一行指路');
    assert.ok(top.includes('（细目在 INDEX-2026-06.md）'));
    // "那个月的一句话"是她的活,引擎不编内容:只留一个看得见的空位。
    assert.ok(top.includes('（这个月的一句话还没写）'));
  });
});

test('T3 keeps an existing month pointer row instead of adding a second one', async () => {
  await withDirAsync('diary-pointer-dup', async (dir) => {
    writeIndex(dir, [
      '# 日记目录',
      '',
      '- 2026-07-28 | 今天',
      '- 2026-07-01 | 老行',
      '- 2026-07 | 七月。（细目在 INDEX-2026-07.md）'
    ]);
    const result = await maintainDiaryIndexHierarchy({ diaryDir: dir, now: beijingNoon('2026-07-28') });
    assert.equal(result.ok, true);
    assert.equal(result.movedDayLines, 1);
    assert.deepEqual(result.monthRowsAdded, [], '已经有月行了就不许再加一行');
    const top = read(join(dir, 'INDEX.md'));
    assert.equal(top.match(/- 2026-07 \|/g)?.length, 1);
    assert.ok(top.includes('- 2026-07 | 七月。'), '她写的月行原样保留,不许被占位文案盖掉');
  });
});

// ── T3:幂等 ───────────────────────────────────────────────────────────────

test('T3 is idempotent: the second pass writes nothing and produces zero byte drift', async () => {
  await withDirAsync('diary-idem', async (dir) => {
    writeIndex(dir, [
      '# 日记目录',
      '',
      '- 2026-07-28 | 今天',
      '- 2026-07-10 | 老行一',
      '- 2026-07-09 | 老行二'
    ]);
    writeFileSync(join(dir, '2026-07-15.md'), '## 十五号第一段\n正文\n', 'utf8');

    const first = await maintainDiaryIndexHierarchy({ diaryDir: dir, now: beijingNoon('2026-07-28') });
    assert.equal(first.ok, true);
    assert.equal(first.movedDayLines, 2);
    assert.deepEqual(first.backfilledDates, ['2026-07-15']);

    const before = snapshotDir(dir);
    const second = await maintainDiaryIndexHierarchy({ diaryDir: dir, now: beijingNoon('2026-07-28') });
    assert.equal(second.ok, true);
    assert.equal(second.movedDayLines, 0);
    assert.deepEqual(second.backfilledDates, []);
    assert.deepEqual(second.monthFilesWritten, []);
    assert.equal(second.topLevelRewritten, false);

    const after = snapshotDir(dir);
    assert.deepEqual([...after.keys()].sort(), [...before.keys()].sort(), '第二遍不许多出文件');
    for (const [name, content] of before) {
      assert.equal(after.get(name), content, `第二遍不许改动 ${name} 的字节`);
    }
    // 月索引里同一天只许一行
    const month = read(join(dir, 'INDEX-2026-07.md'));
    assert.equal(month.match(/^- 2026-07-10 \|/gm)?.length, 1);
    assert.equal(month.match(/^- 2026-07-15 \|/gm)?.length, 1);
  });
});

// ── T3:回填存量 ────────────────────────────────────────────────────────────

test('T3 backfills days that exist on disk but appear in no index, quoting her own words verbatim', async () => {
  await withDirAsync('diary-backfill', async (dir) => {
    writeIndex(dir, ['# 日记目录', '', '- 2026-07-28 | 今天']);
    // ① 正常:第一个 ## 标题
    writeFileSync(join(dir, '2026-07-15.md'), '# 2026-07-15\n\n## 醒来\n正文\n\n## 第二段\n', 'utf8');
    // ② 零 `##`(真实存在:2026-07-04.md)→ 退到第一个 `#` 标题
    writeFileSync(join(dir, '2026-07-04.md'), '# 7月4号 · 手习惯了\n\ngrep驱动跳读decay。\n', 'utf8');
    // ③ 零 `##` 且 `#` 只是个日期(真实存在:2026-07-10.md)→ 退到第一句正文
    writeFileSync(join(dir, '2026-07-10.md'), '# 2026-07-10\n\n目录空了。手敲下第一个字。\n', 'utf8');
    // ④ 一个字都取不到 → 不编内容,跳过并留痕
    writeFileSync(join(dir, '2026-07-11.md'), '# 2026-07-11\n\n\n', 'utf8');
    // ⑤ 不是严格的 YYYY-MM-DD.md → 不参与(真实存在:2026-07-07-summary.md / 2026-07-09-short.md)
    writeFileSync(join(dir, '2026-07-09-short.md'), '## 旁支文件\n', 'utf8');
    writeFileSync(join(dir, 'dictionary.md'), '## 字典\n', 'utf8');

    const result = await maintainDiaryIndexHierarchy({ diaryDir: dir, now: beijingNoon('2026-07-28') });
    assert.equal(result.ok, true);
    assert.deepEqual(result.backfilledDates, ['2026-07-04', '2026-07-10', '2026-07-15']);
    assert.deepEqual(result.backfillSkippedDates, ['2026-07-11']);

    const month = read(join(dir, 'INDEX-2026-07.md'));
    assert.ok(month.includes('- 2026-07-15 | 醒来（引擎回填）'));
    assert.ok(month.includes('- 2026-07-04 | 7月4号 · 手习惯了（引擎回填）'));
    assert.ok(month.includes('- 2026-07-10 | 目录空了。手敲下第一个字。（引擎回填）'), '`# 2026-07-10` 只有日期没信息,要退到第一句正文');
    assert.ok(!month.includes('2026-07-11'), '取不到原话就不许回填(绝不编内容)');
    assert.ok(!month.includes('旁支文件'));
    assert.ok(!month.includes('字典'));
    // 这批是引擎回填的 → 月索引顶部注明
    assert.ok(month.includes('（引擎回填）的行'), '月索引顶部要注明这批是引擎回填的');
    // 按日期升序,她翻起来才顺
    const dates = [...month.matchAll(/^- (\d{4}-\d{2}-\d{2}) \|/gm)].map((m) => m[1]);
    assert.deepEqual(dates, [...dates].sort());
  });
});

test('T3 backfill never touches a day she already has a top-level row for', async () => {
  await withDirAsync('diary-backfill-respect', async (dir) => {
    writeIndex(dir, ['# 日记目录', '', '- 2026-07-28 | 今天', '- 2026-07-27 | 她自己写的那句']);
    writeFileSync(join(dir, '2026-07-27.md'), '## 引擎会取到的那句\n', 'utf8');
    const result = await maintainDiaryIndexHierarchy({ diaryDir: dir, now: beijingNoon('2026-07-28') });
    assert.equal(result.ok, true);
    assert.deepEqual(result.backfilledDates, []);
    assert.equal(existsSync(join(dir, 'INDEX-2026-07.md')), false);
  });
});

test('T3 lets her verbatim row replace the engine placeholder when that day later rolls out of the window', async () => {
  await withDirAsync('diary-replace', async (dir) => {
    writeIndex(dir, ['# 日记目录']);
    writeFileSync(join(dir, '2026-08-01.md'), '## 引擎取到的第一段\n', 'utf8');
    // 第一步:两边都没有这天的行 → 回填占位
    const first = await maintainDiaryIndexHierarchy({ diaryDir: dir, now: beijingNoon('2026-08-03') });
    assert.deepEqual(first.backfilledDates, ['2026-08-01']);
    assert.ok(read(join(dir, 'INDEX-2026-08.md')).includes('- 2026-08-01 | 引擎取到的第一段（引擎回填）'));

    // 第二步:她自己在顶层写了这天,然后这天掉出窗口 → 她那行原样搬下来,替换占位
    writeIndex(dir, ['# 日记目录', '', '- 2026-08-01 | 她自己写的那一句,比引擎那句好', '- 2026-08 | 八月。（细目在 INDEX-2026-08.md）']);
    const second = await maintainDiaryIndexHierarchy({ diaryDir: dir, now: beijingNoon('2026-08-20') });
    assert.equal(second.movedDayLines, 1);

    const month = read(join(dir, 'INDEX-2026-08.md'));
    assert.ok(month.includes('- 2026-08-01 | 她自己写的那一句,比引擎那句好'));
    assert.ok(!month.includes('引擎取到的第一段'), '她的原话必须替换掉引擎占位,不许两行并存也不许被当重复丢掉');
    assert.equal(month.match(/^- 2026-08-01 \|/gm)?.length, 1);
  });
});

test('T3 never overwrites a row she wrote herself in the month index (hers wins)', async () => {
  await withDirAsync('diary-hers-wins', async (dir) => {
    writeIndex(dir, ['# 日记目录', '', '- 2026-07-28 | 今天', '- 2026-07-01 | 顶层这行是新写的']);
    writeFileSync(join(dir, 'INDEX-2026-07.md'), '# 2026-07 日记月索引\n\n- 2026-07-01 | 月索引里她早写好的那句\n', 'utf8');
    const result = await maintainDiaryIndexHierarchy({ diaryDir: dir, now: beijingNoon('2026-07-28') });
    assert.equal(result.ok, true);
    const month = read(join(dir, 'INDEX-2026-07.md'));
    assert.ok(month.includes('- 2026-07-01 | 月索引里她早写好的那句'));
    assert.ok(!month.includes('顶层这行是新写的'));
    assert.equal(month.match(/^- 2026-07-01 \|/gm)?.length, 1, '同一天只许一行');
  });
});

test('T3 falls back to append-only when she has interleaved her own structure between day rows', async () => {
  await withDirAsync('diary-interleaved', async (dir) => {
    writeIndex(dir, ['# 日记目录', '', '- 2026-07-28 | 今天', '- 2026-07-01 | 一号']);
    writeFileSync(join(dir, 'INDEX-2026-07.md'), [
      '# 2026-07 日记月索引',
      '',
      '### 上半月',
      '- 2026-07-05 | 五号',
      '### 下半月',
      '- 2026-07-20 | 二十号',
      ''
    ].join('\n'), 'utf8');

    const result = await maintainDiaryIndexHierarchy({ diaryDir: dir, now: beijingNoon('2026-07-28') });
    assert.equal(result.ok, true);
    assert.equal(result.movedDayLines, 1);
    const lines = read(join(dir, 'INDEX-2026-07.md')).trimEnd().split('\n');
    // 她插的小标题原位不动,新行只追加在末尾——绝不为了排序打乱她的结构
    assert.deepEqual(lines.slice(0, 6), [
      '# 2026-07 日记月索引',
      '',
      '### 上半月',
      '- 2026-07-05 | 五号',
      '### 下半月',
      '- 2026-07-20 | 二十号'
    ]);
    assert.equal(lines[6], '- 2026-07-01 | 一号');
  });
});

// ── T3:错误处理(两个 critical gap)────────────────────────────────────────

test('T3 skips and logs when she hand-edited INDEX.md into an illegal date (never throws, never rewrites)', async () => {
  await withDirAsync('diary-malformed', async (dir) => {
    const original = '# 日记目录\n\n- 2026-07-28 | 今天\n- 2026-13-45 | 手改坏了的日期\n- 2026-07-01 | 本来该搬的行\n';
    writeFileSync(join(dir, 'INDEX.md'), original, 'utf8');
    const result = await maintainDiaryIndexHierarchy({ diaryDir: dir, now: beijingNoon('2026-07-28') });
    assert.equal(result.ok, false);
    assert.equal(result.skippedReason, 'top_index_malformed_day_line');
    assert.equal(result.movedDayLines, 0);
    // 读不懂的文件上不许搬家:原文一个字节都不许动
    assert.equal(read(join(dir, 'INDEX.md')), original);
    assert.equal(existsSync(join(dir, 'INDEX-2026-07.md')), false);
  });
});

test('T3 skips a day file it cannot parse and keeps going on the others', async () => {
  await withDirAsync('diary-badday', async (dir) => {
    writeIndex(dir, ['# 日记目录', '', '- 2026-07-28 | 今天']);
    writeFileSync(join(dir, '2026-07-05.md'), '## 好的那天\n', 'utf8');
    // 断掉的 symlink:stat 就 ENOENT。比 chmod 000 可靠——测试跑在 root 下时 chmod 拦不住。
    symlinkSync(join(dir, 'does-not-exist.md'), join(dir, '2026-07-06.md'));
    const result = await maintainDiaryIndexHierarchy({ diaryDir: dir, now: beijingNoon('2026-07-28') });
    assert.equal(result.ok, true, '一份读不了不许拖垮整轮');
    assert.deepEqual(result.backfilledDates, ['2026-07-05']);
    assert.deepEqual(result.backfillSkippedDates, ['2026-07-06']);
    assert.ok(read(join(dir, 'INDEX-2026-07.md')).includes('- 2026-07-05 | 好的那天（引擎回填）'));
  });
});

test('T3 keeps top-level rows when the month index write fails (moving, never deleting)', async () => {
  await withDirAsync('diary-writefail', async (dir) => {
    const original = '# 日记目录\n\n- 2026-07-28 | 今天\n- 2026-07-01 | 该搬但搬不动的行\n';
    writeFileSync(join(dir, 'INDEX.md'), original, 'utf8');
    // 月索引这个名字被一个非空目录占了 → tmp 写得进去、rename 必失败(EISDIR/ENOTEMPTY)。
    // 用目录而不是 chmod:root 下也一样失败。
    mkdirSync(join(dir, 'INDEX-2026-07.md'), { recursive: true });
    writeFileSync(join(dir, 'INDEX-2026-07.md', 'blocker'), 'x', 'utf8');

    const result = await maintainDiaryIndexHierarchy({ diaryDir: dir, now: beijingNoon('2026-07-28') });
    assert.equal(result.ok, true);
    assert.equal(result.movedDayLines, 0, '月索引没写成就不许从顶层摘行');
    assert.equal(result.monthFilesFailed.length, 1);
    assert.equal(read(join(dir, 'INDEX.md')), original, '宁可下次再搬,绝不丢行');
    // 原子写:失败不留半份产物
    assert.deepEqual(readdirSync(dir).filter((n) => n.includes('.tmp-')), []);
  });
});

test('T3 fail-open: unreadable / missing diary dir returns ok:false instead of throwing', async () => {
  const missing = join(tmpdir(), `diary-missing-${Date.now()}`);
  const result = await maintainDiaryIndexHierarchy({ diaryDir: missing, now: beijingNoon('2026-07-28') });
  assert.equal(result.ok, false);
  assert.equal(result.skippedReason, 'top_index_unreadable');
});

test('T3 fail-open: an exception thrown before any inner guard is swallowed by the outer catch', async () => {
  await withDirAsync('diary-outer', async (dir) => {
    writeIndex(dir, ['# 日记目录']);
    // now 不是 Date → east8DayNumber 里 getTime() 抛 TypeError,位置在所有内层 try 之前。
    const result = await maintainDiaryIndexHierarchy({ now: {} as unknown as Date, diaryDir: dir });
    assert.equal(result.ok, false);
    assert.equal(result.skippedReason, 'unexpected_error');
  });
});

test('T3 skips a top index too large to be an index (she cat-ed a diary into it)', async () => {
  await withDirAsync('diary-huge-index', async (dir) => {
    writeFileSync(join(dir, 'INDEX.md'), 'x'.repeat(1024 * 1024 + 1), 'utf8');
    const result = await maintainDiaryIndexHierarchy({ diaryDir: dir, now: beijingNoon('2026-07-28') });
    assert.equal(result.ok, false);
    assert.equal(result.skippedReason, 'top_index_too_large');
  });
});

// ── T4:日内 heading manifest ───────────────────────────────────────────────

test('T4 turns a 93KB diary blob into a navigable heading manifest with sed-ready line ranges', async () => {
  await withDirAsync('manifest-big', async (dir) => {
    const manifestDir = join(dir, 'out');
    const diaryDir = join(dir, 'diary');
    mkdirSync(diaryDir, { recursive: true });
    // 复刻真实最大那份的量级:2026-07-15.md = 93204 字节 / 191 个 ## 条目。
    const sections: string[] = ['# 2026-07-15', ''];
    const headingCount = 191;
    const body = '正文'.repeat(80);
    for (let i = 0; i < headingCount; i += 1) {
      sections.push(`## 第${i}段小标题`);
      sections.push(body);
      sections.push('');
    }
    const diaryPath = join(diaryDir, '2026-07-15.md');
    writeFileSync(diaryPath, `${sections.join('\n')}\n`, 'utf8');
    assert.ok(statSync(diaryPath).size > 90 * 1024, '样本要达到真实最大日文件的量级');

    const result = await writeDiaryHeadingManifests({ diaryDir, manifestDir });
    assert.equal(result.ok, true);
    assert.deepEqual(result.writtenDates, ['2026-07-15']);
    assert.deepEqual(result.skippedDates, []);

    const manifest = read(join(manifestDir, '2026-07-15.md'));
    // 目录本身必须远小于日记(不然就没有导航价值)
    assert.ok(Buffer.byteLength(manifest, 'utf8') * 5 < statSync(diaryPath).size, '目录要比日记小一个量级');
    assert.ok(manifest.includes(`sed -n '起,止p' ${diaryPath}`), '要给出她能直接跑的取段命令');

    const rows = [...manifest.matchAll(/^- (\d+)-(\d+) \| (.*)$/gm)];
    assert.equal(rows.length, headingCount, '所有 ## 条目都要在目录里');
    // 行号真的对得上:第一条的起始行就是那个标题在文件里的行号
    const diaryLines = read(diaryPath).split('\n');
    for (const row of [rows[0], rows[1], rows[rows.length - 1]]) {
      const start = Number(row[1]);
      const end = Number(row[2]);
      assert.ok(diaryLines[start - 1].startsWith('## '), `第 ${start} 行应当是一个 ## 标题`);
      assert.ok(diaryLines[start - 1].includes(row[3]), '标题文本要对得上');
      assert.ok(end >= start);
    }
    // 段落首尾相接、不重叠:上一条的止 = 下一条的起 - 1
    for (let i = 0; i + 1 < rows.length; i += 1) {
      assert.equal(Number(rows[i][2]) + 1, Number(rows[i + 1][1]));
    }
  });
});

test('T4 handles a diary with zero ## headings (real: 2026-07-04.md) without throwing', async () => {
  await withDirAsync('manifest-noheading', async (dir) => {
    const manifestDir = join(dir, 'out');
    const diaryDir = join(dir, 'diary');
    mkdirSync(diaryDir, { recursive: true });
    writeFileSync(join(diaryDir, '2026-07-04.md'), '# 7月4号 · 手习惯了\n\ngrep驱动跳读decay。\n', 'utf8');
    const result = await writeDiaryHeadingManifests({ diaryDir, manifestDir });
    assert.equal(result.ok, true);
    assert.deepEqual(result.writtenDates, ['2026-07-04']);
    const manifest = read(join(manifestDir, '2026-07-04.md'));
    assert.ok(manifest.includes('0 个小节'));
    assert.ok(manifest.includes('没有 ## 小节'), '零标题时要告诉她整份直接读,而不是给一份空目录');
    assert.ok(!/^- \d+-\d+ \|/m.test(manifest));
  });
});

test('T4 is incremental: unchanged diaries are skipped without rewriting the manifest', async () => {
  await withDirAsync('manifest-incremental', async (dir) => {
    const manifestDir = join(dir, 'out');
    const diaryDir = join(dir, 'diary');
    mkdirSync(diaryDir, { recursive: true });
    writeFileSync(join(diaryDir, '2026-07-01.md'), '## 一\nx\n## 二\ny\n', 'utf8');
    writeFileSync(join(diaryDir, '2026-07-02.md'), '## 三\nz\n', 'utf8');

    const first = await writeDiaryHeadingManifests({ diaryDir, manifestDir });
    assert.deepEqual(first.writtenDates, ['2026-07-01', '2026-07-02']);

    const manifestPath = join(manifestDir, '2026-07-01.md');
    const bytesBefore = read(manifestPath);
    const mtimeBefore = statSync(manifestPath).mtimeMs;

    const second = await writeDiaryHeadingManifests({ diaryDir, manifestDir });
    assert.equal(second.ok, true);
    assert.deepEqual(second.writtenDates, [], '内容没变就不许重生成');
    assert.deepEqual(second.unchangedDates, ['2026-07-01', '2026-07-02']);
    assert.equal(read(manifestPath), bytesBefore);
    assert.equal(statSync(manifestPath).mtimeMs, mtimeBefore, '不许制造无意义的 mtime churn');

    // 内容变了 → 只重生成变了那一份
    writeFileSync(join(diaryDir, '2026-07-02.md'), '## 三\nz\n## 四\nw\n', 'utf8');
    const third = await writeDiaryHeadingManifests({ diaryDir, manifestDir });
    assert.deepEqual(third.writtenDates, ['2026-07-02']);
    assert.deepEqual(third.unchangedDates, ['2026-07-01']);
    assert.ok(read(join(manifestDir, '2026-07-02.md')).includes('| 四'));
  });
});

test('T4 skips one unparsable diary and still writes the rest (never throws)', async () => {
  await withDirAsync('manifest-badday', async (dir) => {
    const manifestDir = join(dir, 'out');
    const diaryDir = join(dir, 'diary');
    mkdirSync(diaryDir, { recursive: true });
    writeFileSync(join(diaryDir, '2026-07-01.md'), '## 好的\nx\n', 'utf8');
    // 断掉的 symlink → stat ENOENT(root 下也一样,不像 chmod 000 会被 root 绕过)
    symlinkSync(join(diaryDir, 'does-not-exist.md'), join(diaryDir, '2026-07-02.md'));
    const result = await writeDiaryHeadingManifests({ diaryDir, manifestDir });
    assert.equal(result.ok, true);
    assert.deepEqual(result.writtenDates, ['2026-07-01']);
    assert.deepEqual(result.skippedDates, ['2026-07-02']);
    assert.equal(existsSync(join(manifestDir, '2026-07-02.md')), false);
  });
});

test('T4 ignores non-date files so the manifest dir mirrors exactly the day diaries', async () => {
  await withDirAsync('manifest-filter', async (dir) => {
    const manifestDir = join(dir, 'out');
    const diaryDir = join(dir, 'diary');
    mkdirSync(diaryDir, { recursive: true });
    writeFileSync(join(diaryDir, '2026-07-01.md'), '## 一\n', 'utf8');
    writeFileSync(join(diaryDir, '2026-07-09-short.md'), '## 旁支\n', 'utf8');
    writeFileSync(join(diaryDir, 'INDEX.md'), '# 日记目录\n', 'utf8');
    writeFileSync(join(diaryDir, 'INDEX-2026-07.md'), '# 月索引\n', 'utf8');
    writeFileSync(join(diaryDir, 'dictionary.md'), '## 字典\n', 'utf8');
    writeFileSync(join(diaryDir, '2026-02-30.md'), '## 不存在的日期\n', 'utf8');
    const result = await writeDiaryHeadingManifests({ diaryDir, manifestDir });
    assert.equal(result.ok, true);
    assert.equal(result.scannedDates, 1);
    assert.deepEqual(readdirSync(manifestDir), ['2026-07-01.md']);
  });
});

test('T4 fail-open: missing diary dir and a broken manifest dir both return ok:false instead of throwing', async () => {
  const missing = await writeDiaryHeadingManifests({
    diaryDir: join(tmpdir(), `manifest-missing-${Date.now()}`),
    manifestDir: join(tmpdir(), `manifest-out-${Date.now()}`)
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.skippedReason, 'diary_dir_unreadable');

  await withDirAsync('manifest-outer', async (dir) => {
    writeFileSync(join(dir, '2026-07-01.md'), '## 一\n', 'utf8');
    // manifestDir 不是字符串 → nodePath.join 在所有内层 try 之前抛,验外层 catch。
    const broken = await writeDiaryHeadingManifests({ diaryDir: dir, manifestDir: {} as unknown as string });
    assert.equal(broken.ok, false);
    assert.equal(broken.skippedReason, 'unexpected_error');
  });
});

test('T4 keeps its output OUT of notes/diary/ (that dir is the passive-recall corpus)', async () => {
  await withDirAsync('manifest-isolation', async (dir) => {
    const diaryDir = join(dir, 'notes', 'diary');
    mkdirSync(diaryDir, { recursive: true });
    writeFileSync(join(diaryDir, '2026-07-01.md'), '## 一\n', 'utf8');
    const savedIndexPath = process.env.XIAONI_DIARY_INDEX_PATH;
    const savedManifestDir = process.env.XIAONI_DIARY_MANIFEST_DIR;
    delete process.env.XIAONI_DIARY_MANIFEST_DIR;
    process.env.XIAONI_DIARY_INDEX_PATH = join(diaryDir, 'INDEX.md');
    try {
      // 默认解析(不传 manifestDir):产物必须落在 notes/diary 的兄弟目录,不在它里面。
      // 召回腿 (xiaoni-recall-reindex-service) 的 PALACE_DIRS = ['notes/diary'] 扁平一层
      // 扫所有 .md;目录清单落进去会被切块嵌入,污染召回语料。
      const result = await writeDiaryHeadingManifests({});
      assert.equal(result.ok, true);
      assert.equal(result.manifestDir, join(dir, 'notes', 'diary-manifest'));
      assert.ok(!result.manifestDir.startsWith(`${diaryDir}/`), 'manifest 目录绝不许在 notes/diary/ 之内');
      assert.deepEqual(
        readdirSync(diaryDir).sort(),
        ['2026-07-01.md'],
        'notes/diary/ 里不许多出任何目录产物'
      );
      assert.deepEqual(readdirSync(result.manifestDir), ['2026-07-01.md']);
    } finally {
      if (savedIndexPath === undefined) {
        delete process.env.XIAONI_DIARY_INDEX_PATH;
      } else {
        process.env.XIAONI_DIARY_INDEX_PATH = savedIndexPath;
      }
      if (savedManifestDir === undefined) {
        delete process.env.XIAONI_DIARY_MANIFEST_DIR;
      } else {
        process.env.XIAONI_DIARY_MANIFEST_DIR = savedManifestDir;
      }
    }
  });
});

// ── 两者共同:注入异常,commitCoreMemoryCompression 仍然照常提交 ────────────
//
// 这是整份用例里最硬的一条。两个函数挂在 commitCoreMemoryCompression 的原子提交帧上;
// 一旦异常逃出去,正常提交和 22 轮 hard-cap 兜底提交(走同一个函数)会一起废掉 →
// read_cutoff 永不前移 → 上下文只涨不降 → 撞 30MiB 硬线 → 压缩永久卡死。

function buildAtomicCommitHarness() {
  const atomicWrites: any[] = [];
  const timelineEvents: any[] = [];
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
    getSessionReadCutoffState: async () => {
      throw new Error('atomic commit should not use pre-read guard');
    },
    upsertSessionContextSummary: async () => {
      throw new Error('atomic commit should not split summary write');
    },
    upsertSessionReadCutoffState: async () => {
      throw new Error('atomic commit should not split cutoff write');
    },
    logTimelineEvent: async (event: any) => { timelineEvents.push(event); }
  } as any);
  const compression = {
    required: true,
    contextSessionKey: 'xiaoni:test-global',
    readCutoffAfterStackIndex: 171,
    previousReadCutoffAfterStackIndex: null,
    compressionCoveredEndStackIndex: 201,
    historyUserId: 303,
    historyGroupId: null,
    historyScope: 'global',
    lastContextWindowTokens: 400000,
    lastTargetBudgetTokens: 280000,
    lastHardBudgetTokens: 380000
  };
  const commit = (text: string, callId: string) => (service as any).commitCoreMemoryCompression({
    rawToolResult: { compressed: true, text, outcome: 'core_memory_compressed' },
    toolCall: { name: COMPRESS_CORE_MEMORY_TOOL, callId },
    compression,
    contextSessionKey: 'xiaoni:test-global',
    sourceResponseId: `llm-${callId}`,
    metadata: { trace_id: `trace-${callId}`, execution_mode: 'compression_fork' }
  });
  return { commit, atomicWrites, timelineEvents };
}

test('commitCoreMemoryCompression still commits when the diary maintenance frame is pointed at hostile paths', async () => {
  const saved = {
    diary: process.env.XIAONI_DIARY_INDEX_PATH,
    people: process.env.XIAONI_PEOPLE_INDEX_PATH,
    manifest: process.env.XIAONI_DIARY_MANIFEST_DIR
  };
  // /dev/null 是文件,不是目录 → 所有 read/readdir/mkdir 一律 ENOTDIR。
  // T3/T4 必须整体吞掉、只留 warn,提交照做。
  process.env.XIAONI_DIARY_INDEX_PATH = '/dev/null/no-such-dir/INDEX.md';
  process.env.XIAONI_PEOPLE_INDEX_PATH = '/dev/null/no-such-dir/people-INDEX.md';
  process.env.XIAONI_DIARY_MANIFEST_DIR = '/dev/null/no-such-dir/diary-manifest';
  try {
    const { commit, atomicWrites } = buildAtomicCommitHarness();

    // ① 正常提交路径
    const normal = await commit('原子写入的近况。', 'diary-frame-normal');
    assert.equal(normal.text, '原子写入的近况。');
    assert.equal(normal.toolResult.context_summary_written, true);
    assert.equal(normal.toolResult.read_cutoff_written, true);
    assert.equal(normal.artifact.read_cutoff_after_stack_index, 171, 'read_cutoff 必须照常前移');

    // ② 22 轮 hard-cap 兜底提交路径(同一个 commitCoreMemoryCompression)
    const fallback = await commit(FALLBACK_SUMMARY, 'diary-frame-fallback');
    assert.equal(fallback.toolResult.read_cutoff_written, true, '兜底提交也必须照常前移 cutoff');

    assert.equal(atomicWrites.length, 2);
    // 快照读失败 = undefined(「不知道」,保留库里旧值),不是 null(那会清空好快照)
    assert.equal(atomicWrites[0].diaryIndexSnapshot, undefined);
    assert.equal(atomicWrites[0].peopleIndexSnapshot, undefined);
  } finally {
    for (const [key, value] of [
      ['XIAONI_DIARY_INDEX_PATH', saved.diary],
      ['XIAONI_PEOPLE_INDEX_PATH', saved.people],
      ['XIAONI_DIARY_MANIFEST_DIR', saved.manifest]
    ] as Array<[string, string | undefined]>) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

// 把 T3/T4 的默认路径钉到给定的 runtime 根上,跑完还原(env 是进程级的,别泄给别的用例)。
async function withDiaryEnv<T>(runtimeRoot: string, fn: () => Promise<T>): Promise<T> {
  const keys = ['XIAONI_DIARY_INDEX_PATH', 'XIAONI_PEOPLE_INDEX_PATH', 'XIAONI_DIARY_MANIFEST_DIR'] as const;
  const saved = keys.map((key) => [key, process.env[key]] as [string, string | undefined]);
  process.env.XIAONI_DIARY_INDEX_PATH = join(runtimeRoot, 'notes', 'diary', 'INDEX.md');
  process.env.XIAONI_PEOPLE_INDEX_PATH = join(runtimeRoot, 'notes', 'people', 'INDEX.md');
  process.env.XIAONI_DIARY_MANIFEST_DIR = join(runtimeRoot, 'notes', 'diary-manifest');
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

test('commitCoreMemoryCompression still commits when every diary write in the frame fails', async () => {
  await withDirAsync('commit-writefail', async (dir) => {
    const diaryDir = join(dir, 'notes', 'diary');
    mkdirSync(diaryDir, { recursive: true });
    // T3 确实有活要干(超窗行 + 待回填的日子),但每个写目标的名字都被非空目录占了 →
    // rename 一律失败。用目录而不是 chmod:root 下也一样失败。
    writeFileSync(join(diaryDir, 'INDEX.md'), '# 日记目录\n\n- 2020-01-01 | 一定超窗的老行\n', 'utf8');
    writeFileSync(join(diaryDir, '2020-01-02.md'), '## 待回填\n', 'utf8');
    mkdirSync(join(diaryDir, 'INDEX-2020-01.md'), { recursive: true });
    writeFileSync(join(diaryDir, 'INDEX-2020-01.md', 'blocker'), 'x', 'utf8');
    // T4 的产物目录名被一个普通文件占了 → mkdir recursive 报 EEXIST/ENOTDIR。
    mkdirSync(join(dir, 'notes'), { recursive: true });
    writeFileSync(join(dir, 'notes', 'diary-manifest'), 'not a dir', 'utf8');

    await withDiaryEnv(dir, async () => {
      const { commit, atomicWrites } = buildAtomicCommitHarness();
      const result = await commit('写盘全失败也要照常提交。', 'diary-frame-writefail');
      assert.equal(result.toolResult.context_summary_written, true);
      assert.equal(result.toolResult.read_cutoff_written, true);
      assert.equal(result.artifact.read_cutoff_after_stack_index, 171, 'read_cutoff 必须照常前移');
      assert.equal(atomicWrites.length, 1);
      // 月索引写不进去 → 顶层那行不许摘 → 快照就是原文
      assert.ok(String(atomicWrites[0].diaryIndexSnapshot).includes('2020-01-01'));
    });
  });
});

test('the maintenance frame runs BEFORE the snapshot read, so the frozen snapshot is the post-demotion file', async () => {
  await withDirAsync('commit-order', async (dir) => {
    const diaryDir = join(dir, 'notes', 'diary');
    mkdirSync(diaryDir, { recursive: true });
    writeFileSync(join(diaryDir, 'INDEX.md'), '# 日记目录\n\n- 2020-01-01 | 一定超窗的老行\n', 'utf8');
    writeFileSync(join(diaryDir, '2020-01-01.md'), '## 那天第一段\n正文\n## 那天第二段\n正文\n', 'utf8');

    await withDiaryEnv(dir, async () => {
      const { commit, atomicWrites } = buildAtomicCommitHarness();
      await commit('同帧换血的近况。', 'diary-frame-order');
      assert.equal(atomicWrites.length, 1);
      const snapshot = String(atomicWrites[0].diaryIndexSnapshot);
      // 搬完才读:超窗的按天行已经不在顶层,取而代之的是那一行月指路
      assert.ok(!snapshot.includes('2020-01-01 |'), '冻结进库的必须是搬完之后那份');
      assert.ok(snapshot.includes('（细目在 INDEX-2020-01.md）'));
      assert.ok(read(join(diaryDir, 'INDEX-2020-01.md')).includes('- 2020-01-01 | 一定超窗的老行'));

      // T4 的产物落在隔离的兄弟目录,notes/diary/ 里一份都不许多出来
      assert.ok(read(join(dir, 'notes', 'diary-manifest', '2020-01-01.md')).includes('| 那天第一段'));
      assert.deepEqual(
        readdirSync(diaryDir).sort(),
        ['2020-01-01.md', 'INDEX-2020-01.md', 'INDEX.md'],
        'notes/diary/ 是召回语料目录,不许多出任何目录产物'
      );
    });
  });
});
