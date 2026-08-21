'use strict';

const crypto = require('crypto');
const { normalizeRecallText } = require('./xiaoni-passive-recall-extractor');

// 小腻文件语料底(记忆宫殿:identity-anchor + notes/diary 日记;范围由 reindex 的前瞻闸定)
// 的分块 —— 纯函数,content 传入,不碰 fs。
// 一个文件含多条不同记忆,整文件一个向量太粗;按标题/段落切块,lead 才能指到「某段」。
// 每块 contentHash 变了才重嵌。详见 docs/XIAONI_PASSIVE_RECALL_SURFACING.md。

const MIN_CHUNK_CHARS = 40;
const MAX_CHUNK_CHARS = 1200;

function sha256(text) {
  return crypto.createHash('sha256').update(typeof text === 'string' ? text : '').digest('hex');
}

function splitByHeadings(content) {
  const lines = content.split(/\r?\n/);
  const sections = [];
  let current = [];
  const flush = () => {
    if (current.some((line) => line.trim())) {
      sections.push(current.join('\n'));
    }
    current = [];
  };
  for (const line of lines) {
    if (/^#{1,6}\s/.test(line)) {
      flush();
      current = [line];
    } else {
      current.push(line);
    }
  }
  flush();
  return sections;
}

function splitParagraphs(section) {
  return section
    .split(/\n\s*\n/)
    .map((para) => para.replace(/[ \t]+$/gm, '').trim())
    .filter(Boolean);
}

function hardCut(text, max) {
  if (text.length <= max) {
    return [text];
  }
  const out = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max);
    if (cut < max * 0.5) {
      cut = rest.lastIndexOf(' ', max);
    }
    if (cut < max * 0.5) {
      cut = max;
    }
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) {
    out.push(rest);
  }
  return out.filter(Boolean);
}

// 过短块并入前一块(合并后不超上限),避免碎成单行噪音。
function mergeShort(pieces) {
  const merged = [];
  for (const piece of pieces) {
    const prev = merged[merged.length - 1];
    if (prev && (piece.length < MIN_CHUNK_CHARS || prev.length < MIN_CHUNK_CHARS)
      && (prev.length + piece.length + 1) <= MAX_CHUNK_CHARS) {
      merged[merged.length - 1] = `${prev}\n${piece}`;
    } else {
      merged.push(piece);
    }
  }
  return merged;
}

// 节首的标题行(splitByHeadings 保证标题在节的第一行)。没有标题的节返回 null。
const SECTION_HEADING_RE = /^\s*#{1,6}\s+\S/;

function sectionHeadingOf(section) {
  const first = (typeof section === 'string' ? section : '').split(/\r?\n/, 1)[0] || '';
  return SECTION_HEADING_RE.test(first) ? first.trim() : null;
}

// 块首补标题;已经以该标题开头的(节内第一块)原样返回,不重复。
function withHeading(text, heading) {
  if (!heading) {
    return text;
  }
  return text.trimStart().startsWith(heading) ? text : `${heading}\n${text}`;
}

function chunkRuntimeFile(params) {
  const { path, content, privacyScope = 'self_private' } = params || {};
  if (typeof content !== 'string' || !content.trim() || !path) {
    return [];
  }
  // 每个标题节是一条独立记忆 —— 只在节内合并过短段落,绝不跨标题合并。
  //
  // 每块都补上所属小节的标题。splitByHeadings 把标题行留在节首,但 splitParagraphs 再切一层
  // 之后只有**第一块**带得上它 —— 真库实测带标题比例 topics 99% / anchor 77% / diary 59% /
  // people 36%,那 41% 的日记续段是被切掉了标题,不是她没写。后果有两层:
  //   ① importance 的 titleSpecificity 因子对续段失效(只能记中性值);
  //   ② 更要紧的是**检索** —— 续段成了无主孤块,dense 只能靠它自己那几句话被找到。
  //      而 dense 是唯一的召回通路(BM25 只在已取回的池内重排,补不了漏召)。
  // 所以统一成「每块都以小节标题开头」,让标题参与嵌入。首块本来就有,不重复加。
  const merged = [];
  for (const section of splitByHeadings(content)) {
    const heading = sectionHeadingOf(section);
    const pieces = [];
    for (const para of splitParagraphs(section)) {
      pieces.push(...hardCut(para, MAX_CHUNK_CHARS));
    }
    for (const text of mergeShort(pieces)) {
      if (!text.trim()) {
        continue;
      }
      merged.push({ text: withHeading(text, heading), heading });
    }
  }

  // embeddingText/contentHash 用清洗后文本(剥样板/工具输出);sourceRef/path 指针用原始位置,
  // 保持稳定 + 让 lead 仍指向她真实文件(主动 cat 得到原文)。纯样板块清洗后为空 → 不入库。
  return merged.map(({ text: rawText, heading }, index) => {
    const text = normalizeRecallText(rawText);
    if (!text) {
      return null;
    }
    return {
      sourceKind: 'file_chunk',
      sourceRef: `${path}#${index}`,
      occurredAt: null,
      embeddingText: text,
      provenance: {
        source: 'runtime_file',
        kind: 'file_chunk',
        path,
        privacyScope,
        cueClass: 'db_file_provenance',
        leadTemplate: 'file_chunk',
        // 所属小节标题。文本里也有一份(见上),这里单独留一份给读取侧免去解析。
        heading: heading || null
      },
      contentHash: sha256(text)
    };
  }).filter(Boolean);
}

module.exports = {
  MIN_CHUNK_CHARS,
  MAX_CHUNK_CHARS,
  chunkRuntimeFile
};
