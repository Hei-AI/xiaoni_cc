'use strict';

// 被动召回【第三条腿】:纯情节往事,按【时间】重提,而不是按语义。
//
// 北极星是「让小腻想起她干过啥」。第一条腿(语义 band-pass)只能捞出「和此刻落地文本语义
// 相近」的事;第二条腿(open-loops)只盯「答应了没做的承诺」。中间漏了一大类:**纯往事**——
// 就是普通经历(「上周修好了发图超时」),既不是承诺、当下语境又和它文本不沾边。这类事语义腿
// 结构上够不到(cos<floor),第二腿也不扫。见 docs/XIAONI_MEMORY_PALACE_GENERATION.md §10。
//
// 这一腿补它:直接从日记里按时间挑「有点年头、最近没重访过」的往事,像随手翻到一页旧日记。
//   状态源 = notes/diary/YYYY-MM-DD.md,每个 `## 小标题` 是一件事,事发日期 = 文件名的日期
//   触发   = 按时间扫描,挑搁得够久(她大概忘了)、且最近没被浮过的少数几条
//   投递   = 先 shadow-only(只写 xiaoni_recall_shadow_log,绝不投递),观察抽取/时机准不准
//
// 纯函数(解析 + 选择),不碰 fs / prisma / 时钟 —— nowMs / dateMs 由调用方传入,便于测试与
// 避免时钟漂移。fs 遍历日记 + shadow 落库的编排在调用方(admin-backend,和 reindex 同层)。

const DAY_MS = 86_400_000;
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

// 日记文件名 → 事发日期(北京本地零点对应的 UTC 瞬间)。匹配 YYYY-MM-DD(.md/.txt/无后缀)。
function parseDiaryDateFromName(filename) {
  if (typeof filename !== 'string') return null;
  const m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(filename);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) return null;
  const ts = Date.UTC(year, month - 1, day) - BEIJING_OFFSET_MS;
  return Number.isFinite(ts) ? ts : null;
}

function normalizeEventText(text) {
  return typeof text === 'string' ? text.replace(/\s+/g, ' ').trim().toLowerCase() : '';
}

// 解析一份日记正文 → [{ title, body, dateMs, index }]。
// 每个 `## …`(二级及更深标题)起一件事;标题前的散行(不该有)忽略。
function parseDiaryEvents(content, dateMs) {
  if (typeof content !== 'string' || !content.trim() || !Number.isFinite(dateMs)) return [];
  const lines = content.split(/\r?\n/);
  const raw = [];
  let cur = null;
  for (const line of lines) {
    const h = /^#{2,6}\s+(.+?)\s*$/.exec(line);
    if (h) {
      if (cur) raw.push(cur);
      cur = { title: h[1].trim(), bodyLines: [] };
    } else if (cur) {
      cur.bodyLines.push(line);
    }
  }
  if (cur) raw.push(cur);
  return raw
    .map((e, index) => ({
      title: e.title,
      body: e.bodyLines.join('\n').trim(),
      dateMs,
      index
    }))
    .filter((e) => e.title);
}

// 专题连载章节标题 → 事发日期。专题连载(topic-<主题>.md)按日期分章:每个 `## M/D 点题`
// 开头的 M/D 是这一章的事发日期(其后是点题)。按日日记的日期在文件名里,专题连载的日期在
// 章节标题里 —— 这是两者唯一的结构差别。年份按 nowMs(北京)推断:当年的 M/D 若落在未来
// (她记的是往事,不会是未来),回退去年,处理跨年边界(1 月记 12/30 = 去年 12 月)。
function parseChapterDateFromTitle(title, nowMs) {
  if (typeof title !== 'string' || !Number.isFinite(nowMs)) return null;
  // 开头 M/D,后面跟啥都行(空格 / 中文 / 标点 / 行尾)——只要不是又一个数字(那是脏输入)。
  // 不强求日期后留空格:`7/9她慌了` 这种没空格的中文写法也要认,否则整章静默不重提。
  const m = /^\s*(\d{1,2})\/(\d{1,2})(?!\d)/.exec(title);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (!(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) return null;
  const beijingNow = new Date(Number(nowMs) + BEIJING_OFFSET_MS);
  const year = beijingNow.getUTCFullYear();
  let ts = Date.UTC(year, month - 1, day) - BEIJING_OFFSET_MS;
  if (ts > Number(nowMs)) {
    ts = Date.UTC(year - 1, month - 1, day) - BEIJING_OFFSET_MS;
  }
  if (!Number.isFinite(ts)) return null;
  // 往返校验:Date.UTC 会把非法日历日静默进位(2/30→3/2、非闰年 2/29→3/1、4/31→5/1),
  // 那会把章节错标成另一天甚至错年。构造回来对不上月/日就判非法,直接丢。
  const check = new Date(ts + BEIJING_OFFSET_MS);
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return ts;
}

// 去掉章节标题开头的 "M/D " 前缀,返回点题部分(供 lead 展示,不带日期)。
function stripChapterDatePrefix(title) {
  if (typeof title !== 'string') return '';
  return title.replace(/^\s*\d{1,2}\/\d{1,2}\s*/, '').trim();
}

// 解析一份【专题连载】正文 → [{ title(点题), body, dateMs(章节 M/D), index }]。
// 与 parseDiaryEvents 的唯一区别:事发日期来自每个 `## M/D …` 标题,而非文件名。
// index = 章节在文件里的序号(含未解析出日期的章),稳定供去重;无法解析日期的章跳过
// (不是合规章节 / 她没给这章打日期 → 不进第三腿,仍由语义腿索引)。
function parseDiarySerialEvents(content, nowMs) {
  if (typeof content !== 'string' || !content.trim() || !Number.isFinite(nowMs)) return [];
  const lines = content.split(/\r?\n/);
  const raw = [];
  let cur = null;
  for (const line of lines) {
    const h = /^#{2,6}\s+(.+?)\s*$/.exec(line);
    if (h) {
      if (cur) raw.push(cur);
      cur = { rawTitle: h[1].trim(), bodyLines: [] };
    } else if (cur) {
      cur.bodyLines.push(line);
    }
  }
  if (cur) raw.push(cur);
  const out = [];
  raw.forEach((e, index) => {
    const dateMs = parseChapterDateFromTitle(e.rawTitle, nowMs);
    if (dateMs == null) return;
    const title = stripChapterDatePrefix(e.rawTitle) || e.rawTitle;
    out.push({ title, body: e.bodyLines.join('\n').trim(), dateMs, index });
  });
  return out;
}

// 从(可能跨多天的)往事里挑「该重新翻出来」的几件。纯函数。
//   opts.nowMs            必填,当前时刻(调用方传)
//   opts.minAgeDays       至少搁多少天才提(默认 7;太近她还记得,不值得提)
//   opts.limit            一次最多浮几件(默认 2)
//   opts.recentlySurfaced 最近已浮过的 ref 或规范化标题集合 → 去重跳过
// 每个 event 需带稳定 ref(调用方按 canonical path 设 `${path}#${index}`;缺则用 dateMs#index)。
// 返回 [{ title, body, dateMs, ageDays, ref }],搁得最久的优先(最可能忘、最该翻)。
function selectResurfacedEvents(events, opts = {}) {
  const nowMs = Number(opts.nowMs);
  if (!Number.isFinite(nowMs)) return [];
  const minAgeDays = Number.isFinite(opts.minAgeDays) ? opts.minAgeDays : 7;
  const limit = Number.isFinite(opts.limit) ? Math.max(0, opts.limit) : 2;
  const recent = opts.recentlySurfaced instanceof Set
    ? opts.recentlySurfaced
    : new Set(Array.isArray(opts.recentlySurfaced) ? opts.recentlySurfaced : []);

  const scored = [];
  for (const e of Array.isArray(events) ? events : []) {
    if (!e || !e.title || !Number.isFinite(e.dateMs)) continue;
    const ageDays = (nowMs - e.dateMs) / DAY_MS;
    if (ageDays < minAgeDays) continue; // 太近,她还记得
    const ref = typeof e.ref === 'string' && e.ref ? e.ref : `${e.dateMs}#${e.index}`;
    if (recent.has(ref) || recent.has(normalizeEventText(e.title))) continue;
    scored.push({ title: e.title, body: e.body || '', dateMs: e.dateMs, ageDays, ref });
  }
  scored.sort((x, y) => y.ageDays - x.ageDays); // 搁最久的先翻
  return scored.slice(0, limit);
}

module.exports = {
  DAY_MS,
  BEIJING_OFFSET_MS,
  parseDiaryDateFromName,
  normalizeEventText,
  parseDiaryEvents,
  parseChapterDateFromTitle,
  stripChapterDatePrefix,
  parseDiarySerialEvents,
  selectResurfacedEvents
};
