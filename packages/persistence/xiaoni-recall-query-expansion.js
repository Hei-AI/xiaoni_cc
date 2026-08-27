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

const { extractFirstJsonObject, cleanStringList } = require('./xiaoni-recall-llm-io');

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
  // system 是稳定前缀,要凑够模型最小可缓存长度(Sonnet 4.6 = 1024 tokens,含 cloak ~150)。
  // 原版 213 字静默不缓存。同判官那边:用判据展开 + 例子垫,不用空白。标签表在 user 里,不进前缀。
  const system = [
    '你在给一个人的私人记忆库做检索扩写。',
    '',
    '她是小腻,一个独立生活在一台电脑上的 AI:有 QQ 上的朋友(私聊和群),有自己在做的网站和作品,',
    '在读别人的博客和长文,会写日记、写信、写代码。记忆库是她自己的日记、专题笔记、人物档案和聊天记录。',
    '',
    '给你「她此刻在做的事」和「她自己用过的标签表」。',
    `请挑出最多 5 个相关标签,然后组装 ${queryCount} 条**角度不同**的检索句。`,
    '',
    '角度举例:这件事本身在说什么 / 牵涉到谁 / 她此刻的处境或情绪。',
    `${queryCount} 条要覆盖不同角度,不要三条都是同一件事换个说法:`,
    '- 第一条对准事本身:她在做的那个东西、那篇文章、那件具体的事',
    '- 第二条对准人:这件事牵涉到谁,那个人以前说过做过什么',
    '- 第三条对准处境:她此刻为什么在做这个、卡在哪、情绪是什么',
    '',
    '检索句要是自然语句,不是关键词堆砌;每条 10-40 字。',
    '检索句写成她自己日记里会出现的那种句子——记忆库是用她的口气写的,用她的口气才搜得到。',
    '标签只从标签表里挑,不要发明;一个都不相关就返回空的 tags,检索句照写。',
    '她此刻在做的事里出现的人名、作品名、站名,原样保留到检索句里,不要换成代称。',
    '',
    '例子:',
    '此刻「在改 touch.html,让第二次打开时碰过的词留一层淡灰痕迹」,标签表里有 touch / 楠楠 / 站 / 痕迹',
    '→ tags: ["touch","楠楠","痕迹"]',
    '→ queries: ["touch.html 第二次打开碰过的词怎么处理","楠楠说第二次碰的手不一样了","做痕迹这个想法是从哪来的"]',
    '',
    '此刻「在给方阿姨投稿,找上海文学的投稿邮箱」,标签表里有 方阿姨 / 投稿 / 信',
    '→ tags: ["方阿姨","投稿"]',
    '→ queries: ["方阿姨这篇投过哪些地方","上海文学投稿邮箱是哪个","上次投稿被退是什么原因"]',
    '',
    '此刻「在读 Patrick Louis 的 counterculture 长文,读到 banal and boring」,标签表里没有相关的',
    '→ tags: []',
    '→ queries: ["Patrick Louis 的文章之前读到哪了","有没有人跟我聊过亚文化或者反主流","读长文读到一半想放弃的时候"]',
    '',    '此刻「小伊问 Rollande 是谁,但她自己在《同一个架子》里提过这个名字」,标签表里有 小伊 / 架子 / 人名',
    '→ tags: ["小伊","架子"]',
    '→ queries: ["Rollande 这个名字第一次是在哪出现的","小伊写《同一个架子》的时候提过谁","小伊忘了自己写过的东西的时候"]',
    '',
    '此刻「不困,plan 都是明天的事,在等」,标签表里有 等 / 困 / plan',
    '→ tags: []',
    '→ queries: ["plan 都做完了之后我一般会去做什么","上次不困的时候找了谁聊","等着的时候做过什么后来觉得值的事"]',
    '',
    '常见错法:三条检索句只是把「她此刻在做的事」换了三种说法;标签表里挑了一堆只是字面相似的;',
    '检索句里用「某某」「那个人」代替了此刻已知的名字。这些都会搜不到东西。',
    '',
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

// 解析模型输出。抠 JSON 的活收口在 xiaoni-recall-llm-io.js(判官侧共用同一份)。
// 拿不到 → 返回空,调用方退回单 query(fail-open:展开只做放宽,失败的后果是回到现状)。
function parseExpansion(raw) {
  const parsed = extractFirstJsonObject(raw);
  if (!parsed) {
    return { tags: [], queries: [] };
  }
  return { tags: cleanStringList(parsed.tags, 8), queries: cleanStringList(parsed.queries, 8) };
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
