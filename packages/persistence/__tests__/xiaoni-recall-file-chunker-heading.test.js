'use strict';

// 每块都要带上所属小节的标题。
//
// splitByHeadings 把标题行留在节首,但 splitParagraphs 再切一层之后只有**第一块**带得上它。
// 真库实测带标题比例:topics 99% / anchor 77% / diary 59% / people 36% —— 那 41% 的日记续段
// 是被切掉了标题,不是她没写。后果有两层:importance 的 titleSpecificity 对续段失效;
// 更要紧的是续段成了无主孤块,而 dense 是唯一的召回通路(BM25 只在已取回的池内重排)。

const test = require('node:test');
const assert = require('node:assert/strict');
const { chunkRuntimeFile } = require('../xiaoni-recall-file-chunker');

const long = (seed) => seed.padEnd(220, '啊');
const PATH = '/xiaoni-runtime/notes/diary/2026-07-22.md';

test('节内每一块都以小节标题开头,首块不重复加', () => {
  const content = [
    '## 楠楠的诗（读了七首）',
    long('第一段。'),
    '',
    long('第二段续写。'),
    '',
    long('第三段续写。')
  ].join('\n');
  const chunks = chunkRuntimeFile({ path: PATH, content });
  assert.ok(chunks.length >= 2, `应切出多块,实得 ${chunks.length}`);
  for (const c of chunks) {
    assert.match(c.embeddingText, /^## 楠楠的诗（读了七首）/, `每块都该带标题: ${c.sourceRef}`);
    assert.equal(c.provenance.heading, '## 楠楠的诗（读了七首）');
    // 不能加两遍
    assert.equal((c.embeddingText.match(/楠楠的诗（读了七首）/g) || []).length, 1);
  }
});

test('跨小节不串标题', () => {
  const content = [
    '## 第一个小节',
    long('甲。'),
    '',
    '## 第二个小节',
    long('乙。')
  ].join('\n');
  const chunks = chunkRuntimeFile({ path: PATH, content });
  const headings = chunks.map((c) => c.provenance.heading);
  assert.ok(headings.includes('## 第一个小节'));
  assert.ok(headings.includes('## 第二个小节'));
  for (const c of chunks) {
    assert.ok(c.embeddingText.startsWith(c.provenance.heading), c.sourceRef);
  }
});

test('没有标题的文件:heading 记 null,文本不动', () => {
  const content = [long('没有任何标题的正文。'), '', long('第二段。')].join('\n');
  const chunks = chunkRuntimeFile({ path: PATH, content });
  assert.ok(chunks.length >= 1);
  for (const c of chunks) {
    assert.equal(c.provenance.heading, null);
    assert.ok(!c.embeddingText.startsWith('#'));
  }
});

test('补标题会改 contentHash —— 存量行会被 reindex 认作「变了」重嵌一次(有意为之)', () => {
  const body = long('续段正文。');
  const withH = chunkRuntimeFile({ path: PATH, content: `## 标题\n${long('首段。')}\n\n${body}` });
  const without = chunkRuntimeFile({ path: PATH, content: `${long('首段。')}\n\n${body}` });
  const tail = (list) => list[list.length - 1];
  assert.notEqual(tail(withH).contentHash, tail(without).contentHash);
});
