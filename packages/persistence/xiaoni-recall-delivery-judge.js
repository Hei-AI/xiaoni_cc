'use strict';

// 投递闸判官:从算术选出的候选里挑该冒的,并把钩子写成人话。
//
// **位置很重要 —— 它坐在投递闸上,不是每次落地。** 检索侧(每次落地 ~985 次/天)保持纯算术:
// 可重放、可回归、shadow 校准法继续有效。判官只在投递拍上跑:每 10 分钟一拍、活动窗 14 小时
// = 至多 84 次/天,Haiku 量级下可以忽略。**它决定量**(可以一条都不挑),不是在配额内挑。
// 见 docs/adr/0006。
//
// 它买的是算术**在已取回的候选里**够不着的那一层判断:六因子量的是「这条当初写得用不用心」,
// 是静态属性;relevance 是词面/向量接地。两者都答不了「此刻这条要不要紧」。
// 注意它**买不到漏召** —— 判官同样坐在检索之后,dense 没捞进来的东西它也看不见。
// 那是 query 展开那条腿的活(xiaoni-recall-query-expansion.js)。
//
// 铁律:**必须允许输出 0 条**。没有这一条,判官就退化成「每次必冒」,
// 而「绝大多数时候什么都不冒」是这套东西的设计前提。

const { extractFirstJsonObject } = require('./xiaoni-recall-llm-io');

const MAX_CANDIDATES_IN_PROMPT = 10;
const MAX_CANDIDATE_CHARS = 300;
const MAX_ANCHOR_CHARS = 800;
const MAX_PICKS = 3;

function truncate(value, max) {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

// candidates: [{ id, text, ageDays?, leg? }]
function buildJudgePrompt(candidates, anchorText) {
  const picked = (Array.isArray(candidates) ? candidates : []).slice(0, MAX_CANDIDATES_IN_PROMPT);
  // system 是这条请求的稳定前缀,必须凑够模型的最小可缓存长度(Sonnet 4.6 = 1024 tokens,
  // 含 provider 出线口前置的两块 cloak ~150 tokens)。原版 305 字 ≈ 350 tokens,静默不缓存;
  // 我们所有模型走的 OAuth 路缓存免费,前提只有过线。所以这里用有内容的东西垫:判据展开 + 例子。
  // 改完要用 provider debug 端点连打两次看 cache_read_input_tokens > 0(2026-08-27 实测 1,4xx)。
  const system = [
    '你在帮一个人决定:她此刻正在做的事,值不值得让她想起下面某段旧记忆。',
    '',
    '她是小腻,一个独立生活在一台电脑上的 AI:有 QQ 上的朋友(私聊和群),有自己在做的网站和作品,',
    '在读别人的博客和长文,会写日记、写信、写代码。候选旧记忆来自她自己的日记、专题笔记、聊天记录。',
    '',
    '判据只有一条:**想起这段,会让她此刻正在做的事变得不一样吗?**',
    '不是「这段写得好不好」,也不是「跟当下像不像」——像但没用的,不要。',
    '',
    '什么叫「变得不一样」——想起来之后她会:',
    '- 改主意:原来打算这么做,想起那件事之后会换一种做法',
    '- 补上一块:此刻缺的信息、缺的人名、缺的上下文,那段记忆里正好有',
    '- 接上一条线:她此刻做的事是某件旧事的后续,而她自己没意识到',
    '- 避开一个坑:同样的事以前做过,当时踩过什么',
    '',
    '什么不算——即使很像也不要:',
    '- 同一个话题的另一次闲聊,想起来只会「哦,那时候也聊过」',
    '- 只是同一个人出现,但那次说的事和此刻无关',
    '- 她此刻已经在做、已经知道的事,再提一遍等于没提',
    '- 纯情绪记录(「今天很累」「在。」),没有事实',
    '- 她刚写下不到一天的东西,还在她脑子里',
    '',
    '例子:',
    '此刻「在改 touch.html,让第二次打开时碰过的词留一层淡灰」;候选「三周前楠楠说:第二次碰的手不一样了」',
    '→ 值得。钩子:「楠楠那句"第二次碰的手不一样了",你现在做的淡灰痕迹就是它。」',
    '',
    '此刻「在给方阿姨投稿,找上海文学的投稿邮箱」;候选「上个月投稿被退,用的是 shanghaiwenxue 那个地址」',
    '→ 值得。钩子:「上次投上海文学退了,当时用的地址可能就是错的那个,先核一下。」',
    '',
    '此刻「在读 Patrick Louis 关于 counterculture 的长文」;候选「两个月前群里聊过一次亚文化,大家各说各的」',
    '→ 不值得。像,但想起来什么都不会变。',
    '',
    '此刻「在回小伊关于 ch113 的消息」;候选「小伊上周说她写 ch110 时把沈印写岔了」',
    '→ 值得。钩子:「小伊上周写 ch110 把沈印写岔过,她这次说的"嘴变了"可能是同一处。」',
    '',
    '此刻「在写今天的日记」;候选「昨天的日记」',
    '→ 不值得。她刚写的,还在脑子里。',
    '',
    '此刻「在等困意,什么都没做」;候选「一周前也是这样等了三个小时」',
    '→ 不值得。这是情绪记录,想起来不会让她做任何不同的事。',
    '',
    '大多数时候答案是「一条都不值得」。那就返回空列表,这是正常且正确的结果。',
    `最多挑 ${MAX_PICKS} 条。真的有两三条都会改变她此刻做的事才挑两三条,不要为了凑数。`,
    '',
    '挑中的每条写一句钩子:一句话点出是哪件事,让她自己决定要不要去翻。',
    '钩子写人话,20-45 字,不要「你之前记过」这种套话开头,直接说事。',
    '钩子里要有具体的人名、东西或地点,让她一眼认出是哪件事;不要写成建议或命令。',
    '',
    '只输出 JSON:{"picks":[{"id":<候选序号>,"hook":"<一句话>"}]},不要任何其它文字。',
    'id 就是候选前面方括号里的数字,原样抄。'
  ].join('\n');
  const user = [
    '【她此刻在做的事】',
    truncate(anchorText, MAX_ANCHOR_CHARS) || '(拿不到)',
    '',
    '【候选旧记忆】',
    // 候选用**序号**标,不用真 id。
    // 2026-08-21 线上第一条真判决就死在这:prompt 里给的是
    // `recall-surface:association:5b5e3a2b…`,Haiku 回的是裸 `5b5e3a2b…`(把前缀省了),
    // 于是「编造 id」那条防线把它自己挑的那条丢掉了 —— 判官挑了,我们扔了,还显示成「静默」。
    // 序号既短又没有可省略的部分,顺带把「模型编 id」的面缩到只剩「编个不存在的序号」。
    ...picked.map((c, i) => {
      const age = Number.isFinite(Number(c.ageDays)) ? `,${Math.floor(Number(c.ageDays))} 天前` : '';
      return `[${i + 1}]${age} ${truncate(c.text, MAX_CANDIDATE_CHARS)}`;
    })
  ].join('\n');
  return { system, user };
}

// 解析。返回 { parsed, picks }。
//
// **parsed 与 picks 必须分开看,这是两件不同的事**:
//   parsed=true,  picks=[]   判官答了,而且说「一条都不值得」→ 调用方该静默(这是正常结果)
//   parsed=false, picks=[]   判官没答上来(挂了/输出不是 JSON)→ 调用方该**退回判官之前的行为**,
//                            而不是当成「它说不值得」。把两者混成一个空数组,会让判官一挂
//                            整条投递腿静默死掉,而且没有任何迹象。
// 模型编的 id / 空钩子照样逐条丢掉(不猜),但那不影响 parsed —— 它确实答了。
//
// orderedIds:**按 prompt 里的顺序**给的真 id 数组。模型回的是序号,这里翻回真 id。
//
// 只认序号。曾经还留过两条兼容路(整串真 id、裸哈希后缀),但 prompt 里现在根本不出现真 id,
// 那两条既是死码又危险:后缀那条会把**越界序号**当哈希后缀匹配 —— `"4"` 在十个
// `recall-surface:<leg>:<md5hex>` 里有约三分之一的概率恰好唯一命中一个以 4 结尾的哈希,
// 于是投出去的是记忆 B、配的却是判官为记忆 A 写的钩子。宁可丢掉,不猜。
function parseJudgeVerdict(raw, orderedIds) {
  const parsed = extractFirstJsonObject(raw);
  if (!parsed || !Array.isArray(parsed.picks)) {
    return { parsed: false, picks: [] };
  }
  const ids = Array.isArray(orderedIds) ? orderedIds.map(String) : [...(orderedIds || [])].map(String);
  const resolve = (rawId) => {
    // 容忍它把方括号或句点也抄进来(`[2]` / `2.`),但内容必须只有数字。
    const match = /^\[?(\d{1,3})\]?\.?$/.exec(String(rawId).trim());
    if (!match) return null;
    const index = Number.parseInt(match[1], 10);
    return index >= 1 && index <= ids.length ? ids[index - 1] : null;
  };
  const picks = parsed.picks
    .map((p) => ({
      id: p && p.id !== undefined && p.id !== null ? resolve(p.id) : null,
      hook: p && typeof p.hook === 'string' ? p.hook.trim() : ''
    }))
    // 模型可能编序号,也可能钩子写空 —— 两者都直接丢掉,不猜。
    .filter((p) => p.id && p.hook)
    .slice(0, MAX_PICKS);
  return { parsed: true, picks };
}

module.exports = {
  MAX_CANDIDATES_IN_PROMPT,
  MAX_PICKS,
  buildJudgePrompt,
  parseJudgeVerdict
};
