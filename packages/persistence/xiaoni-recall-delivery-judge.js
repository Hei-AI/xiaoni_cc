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
  const system = [
    '你在帮一个人决定:她此刻正在做的事,值不值得让她想起下面某段旧记忆。',
    '',
    '判据只有一条:**想起这段,会让她此刻正在做的事变得不一样吗?**',
    '不是「这段写得好不好」,也不是「跟当下像不像」——像但没用的,不要。',
    '',
    '大多数时候答案是「一条都不值得」。那就返回空列表,这是正常且正确的结果。',
    `最多挑 ${MAX_PICKS} 条。`,
    '',
    '挑中的每条写一句钩子:一句话点出是哪件事,让她自己决定要不要去翻。',
    '钩子写人话,20-45 字,不要「你之前记过」这种套话开头,直接说事。',
    '',
    '只输出 JSON:{"picks":[{"id":"<候选 id>","hook":"<一句话>"}]},不要任何其它文字。'
  ].join('\n');
  const user = [
    '【她此刻在做的事】',
    truncate(anchorText, MAX_ANCHOR_CHARS) || '(拿不到)',
    '',
    '【候选旧记忆】',
    ...picked.map((c, i) => {
      const age = Number.isFinite(Number(c.ageDays)) ? `,${Math.floor(Number(c.ageDays))} 天前` : '';
      return `[${c.id ?? i}]${age} ${truncate(c.text, MAX_CANDIDATE_CHARS)}`;
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
function parseJudgeVerdict(raw, validIds) {
  const parsed = extractFirstJsonObject(raw);
  if (!parsed || !Array.isArray(parsed.picks)) {
    return { parsed: false, picks: [] };
  }
  const allowed = validIds instanceof Set ? validIds : new Set(Array.isArray(validIds) ? validIds : []);
  const picks = parsed.picks
    .map((p) => ({
      id: p && p.id !== undefined && p.id !== null ? String(p.id) : null,
      hook: p && typeof p.hook === 'string' ? p.hook.trim() : ''
    }))
    // 模型可能编 id,也可能钩子写空 —— 两者都直接丢掉,不猜。
    .filter((p) => p.id && p.hook && (allowed.size === 0 || allowed.has(p.id)))
    .slice(0, MAX_PICKS);
  return { parsed: true, picks };
}

module.exports = {
  MAX_CANDIDATES_IN_PROMPT,
  MAX_PICKS,
  buildJudgePrompt,
  parseJudgeVerdict
};
