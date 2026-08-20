'use strict';

// 自适应 query 展开:算术拿不出像样候选时,换几种问法重取。
//
// 为什么需要它 —— 召回只有 dense 这一路。BM25 只在**已取回**的 top-K 池内做 RRF 重排,
// 补不了漏召,而且它的作用方向是压掉假阳性(收紧)不是放宽。所以 dense 没捞进来的东西,
// 后面无论排序多准、判官多聪明都看不见。而「她不知道自己做过」的那些,恰恰是词面/语义
// 都不直接接壤的 —— 她今天为开口紧张,四十天前「第一次给人发消息前手抖」共同词接近零。
//
// 为什么自适应而不是每次都跑 —— 算术已经捞到好东西时展开没有价值(dense 命中强 = 已经接上了)。
// 真正需要它的正是「算术拿不出像样候选」那些时刻。量也顺带降一个数量级。
//
// 做法(先标签化再组装,而不是让模型自由发挥):
//   锚点文本 + 她自己的标签命名空间 → 模型挑出几个标签 → 用标签组装 2-3 个不同角度的 query
// 标签来自她自己写的东西(loops --tag / notes/topics/<标签>.md / 人物菜单名字),
// 不另造词表 —— 模型的活变成组合而不是生成,便宜、可控、结果可解释。

// 触发闸:算术结果「弱」的判据。两条都满足才算强,不用展开。
const DEFAULT_WEAK_TOP_COS = 0.45;   // 最高一条的 centered cos 低于此 → 弱
const DEFAULT_MIN_QUALIFIED = 3;      // 过完硬事实后带内候选少于此 → 弱

// 组装几个 query。多了摊薄收益还翻倍检索成本。
const DEFAULT_QUERY_COUNT = 3;

function isWeakResult(stats = {}, opts = {}) {
  const weakTopCos = Number.isFinite(opts.weakTopCos) ? opts.weakTopCos : DEFAULT_WEAK_TOP_COS;
  const minQualified = Number.isFinite(opts.minQualified) ? opts.minQualified : DEFAULT_MIN_QUALIFIED;
  const topCos = Number(stats.topCos);
  const qualified = Number(stats.qualifiedCount);
  if (Number.isFinite(qualified) && qualified < minQualified) {
    return true;
  }
  if (Number.isFinite(topCos) && topCos < weakTopCos) {
    return true;
  }
  // 两个数都拿不到 → 当强,不展开(宁可少做,不无端烧调用)。
  return false;
}

// 给模型的输入。标签表截断:她的标签会越攒越多,而 prompt 越长越贵、越容易跑偏。
const MAX_TAGS_IN_PROMPT = 120;
const MAX_ANCHOR_CHARS = 1200;

function buildExpansionPrompt(anchorText, tags, queryCount = DEFAULT_QUERY_COUNT) {
  const picked = (Array.isArray(tags) ? tags : [])
    .filter((t) => typeof t === 'string' && t.trim())
    .slice(0, MAX_TAGS_IN_PROMPT);
  const anchor = String(anchorText || '').slice(0, MAX_ANCHOR_CHARS);
  const system = [
    '你在给一个人的私人记忆库做检索扩写。',
    '给你「她此刻在做的事」和「她自己用过的标签表」。',
    `请挑出最多 5 个相关标签,然后组装 ${queryCount} 条**角度不同**的检索句。`,
    '角度举例:这件事本身在说什么 / 牵涉到谁 / 她此刻的处境或情绪。',
    '检索句要是自然语句,不是关键词堆砌;每条 10-40 字。',
    '只输出 JSON,形如 {"tags":["..."],"queries":["...","...","..."]},不要任何其它文字。'
  ].join('\n');
  const user = [
    '【她此刻在做的事】',
    anchor,
    '',
    '【她自己用过的标签】',
    picked.join(' / ') || '(暂无)'
  ].join('\n');
  return { system, user };
}

// 解析模型输出。模型不听话是常态,所以:抠出第一个 JSON 对象;拿不到 → 返回空,
// 调用方退回单 query(fail-open,展开只做放宽,失败的后果是回到现状)。
function parseExpansion(raw) {
  const text = typeof raw === 'string' ? raw : '';
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return { tags: [], queries: [] };
  }
  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return { tags: [], queries: [] };
  }
  const clean = (arr) => (Array.isArray(arr) ? arr : [])
    .filter((x) => typeof x === 'string' && x.trim())
    .map((x) => x.trim())
    .slice(0, 8);
  return { tags: clean(parsed.tags), queries: clean(parsed.queries) };
}

module.exports = {
  DEFAULT_WEAK_TOP_COS,
  DEFAULT_MIN_QUALIFIED,
  DEFAULT_QUERY_COUNT,
  MAX_TAGS_IN_PROMPT,
  isWeakResult,
  buildExpansionPrompt,
  parseExpansion
};
