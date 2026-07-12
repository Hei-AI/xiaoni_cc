'use strict';

// 被动召回【第二条腿】:开放承诺 / 未闭合的事,按【时间 · 状态】重提,而不是按语义。
//
// 语义 band-pass(第一条腿)只能捞出「和此刻落地文本语义相近」的记忆;她「答应楠楠盯考研进度」
// 这类承诺,当楠楠发来一句「在吗」时文本毫不相干,band-pass 结构上够不到(见
// docs/XIAONI_MEMORY_PALACE_GENERATION.md §10)。这一腿补这个洞:
//   状态源 = 她维护的 notes/diary/open-loops.md
//            `- [ ] 事 (M/D)` 开;`- [x]` 做完;`- [-]` 放弃/不做了(和做完一样不再提)
//   触发   = 按时间扫描,挑「开着且搁置够久、且最近没被提过」的少数几条
//   投递   = 先 shadow-only(只写 xiaoni_recall_shadow_log,绝不投递),观察抽取/时机准不准
//
// 本模块是纯函数(解析 + 选择),不碰 fs / prisma / 时钟 —— nowMs 由调用方传入,便于测试与
// 避免时钟漂移。fs 读取 + shadow 落库的编排在调用方(admin-backend,和 reindex 同层)。

const DAY_MS = 86_400_000;
// 她写的日期是北京 wall-clock(UTC+8);nowMs 是真 UTC 毫秒。算 age 要把标注日期按北京
// 本地零点解释,否则同一天登记同一天扫会差 ±8h,在阈值边界误判一天。见交叉 review 2026-07-12。
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

// `- [ ] 文本` 开;`- [x]` 做完;`- [-]` 放弃。缩进、大小写 x 都容忍。
const OPEN_LOOP_LINE = /^\s*[-*]\s*\[( |x|X|-)\]\s+(.+?)\s*$/;
// 行尾的开启日期标注:(M/D) / (M-D) / (YYYY-MM-DD) / (YYYY/M/D)
const TRAILING_DATE_TAG = /\(\s*(\d{1,4})[-/](\d{1,2})(?:[-/](\d{1,2}))?\s*\)\s*$/;

function normalizeLoopText(text) {
  return typeof text === 'string' ? text.replace(/\s+/g, ' ').trim().toLowerCase() : '';
}

// 把行尾日期标注解析成时间戳。M/D(缺年)按北京「今天」的年推断:若那样得到的日期落在未来,
// 说明是去年的事,回退一年。标注日期一律按北京本地零点(= UTC 零点 − 8h)。
// 返回 ms 或 null(无法解析)。确定性:只依赖传入的 nowMs。
function parseTagDate(tag, nowMs) {
  if (typeof tag !== 'string') return null;
  const m = TRAILING_DATE_TAG.exec(`(${tag})`) || TRAILING_DATE_TAG.exec(tag) || null;
  const raw = m || TRAILING_DATE_TAG.exec(`(${String(tag).trim()})`);
  if (!raw) return null;
  const a = Number(raw[1]);
  const b = Number(raw[2]);
  const c = raw[3] != null ? Number(raw[3]) : null;
  // 把 now 移到北京 wall-clock,再取年 → 缺年推断用的是她那边的「今年」。
  const nowBeijing = new Date(nowMs + BEIJING_OFFSET_MS);
  let year;
  let month;
  let day;
  if (raw[3] != null) {
    // 三段:第一段是年(4 位)或年份缩写;按 YYYY-M-D 解释
    year = a >= 100 ? a : 2000 + a;
    month = b;
    day = c;
  } else {
    // 两段:M/D,缺年 → 用北京今年
    year = nowBeijing.getUTCFullYear();
    month = a;
    day = b;
  }
  if (!(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) return null;
  // 北京本地零点对应的 UTC 瞬间 = UTC 零点 − 8h
  let ts = Date.UTC(year, month - 1, day) - BEIJING_OFFSET_MS;
  if (raw[3] == null && ts - nowMs > DAY_MS) {
    // M/D 用今年算出来在未来 → 是去年的
    ts = Date.UTC(year - 1, month - 1, day) - BEIJING_OFFSET_MS;
  }
  return Number.isFinite(ts) ? ts : null;
}

// 解析 open-loops.md 全文 → [{ line, state, done, text, openedTag }]
//   state: 'open' | 'done' | 'dropped';done = 非 open(做完或放弃,都不再提)
function parseOpenLoops(content) {
  if (typeof content !== 'string' || !content.trim()) return [];
  const out = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const m = OPEN_LOOP_LINE.exec(lines[i]);
    if (!m) continue;
    const mark = m[1].toLowerCase();
    const state = mark === 'x' ? 'done' : mark === '-' ? 'dropped' : 'open';
    let text = m[2].trim();
    let openedTag = null;
    const dm = TRAILING_DATE_TAG.exec(text);
    if (dm) {
      openedTag = dm[0].replace(/^\(|\)$/g, '').trim();
      text = text.slice(0, dm.index).trim();
    }
    if (!text) continue;
    out.push({ line: i + 1, state, done: state !== 'open', text, openedTag });
  }
  return out;
}

// 从解析结果里挑「该重提」的开放承诺。纯函数。
//   opts.nowMs            必填,当前时刻(调用方传,避免时钟漂移)
//   opts.staleDays        搁置多少天才算「该提」(默认 2)
//   opts.maxActiveDays    还算「救得回、值得提」的年龄上限(默认 30);超过归入 overdue 降权,
//                         防一条百天老死承诺按最久优先长期霸榜、饿死中龄承诺(交叉 review 2026-07-12)
//   opts.limit            一次最多浮几条(默认 3,别一次倒一堆)
//   opts.recentlySurfaced 最近已提过(或语义腿已浮过)的规范化文本集合 → 去重跳过
// 返回 [{ text, openedTag, ageDays, line, tier, undated }],优先级:
//   tier 'active'  搁置在 [staleDays, maxActiveDays] 内 —— 主力,按最久优先
//   tier 'overdue' 搁置 > maxActiveDays —— 可能已放着不管,降到主力之后当填充
//   tier 'undated' 没写日期 —— 不知搁多久,兜底浮一次(否则最该兜的健忘反而永久隐形),
//                  排最后当填充,ageDays=null;靠 recentlySurfaced 冷却防刚写就吵
function selectStaleOpenLoops(loops, opts = {}) {
  const nowMs = Number(opts.nowMs);
  if (!Number.isFinite(nowMs)) return [];
  const staleDays = Number.isFinite(opts.staleDays) ? opts.staleDays : 2;
  const maxActiveDays = Number.isFinite(opts.maxActiveDays) ? opts.maxActiveDays : 30;
  const limit = Number.isFinite(opts.limit) ? Math.max(0, opts.limit) : 3;
  const recent = opts.recentlySurfaced instanceof Set
    ? opts.recentlySurfaced
    : new Set(Array.isArray(opts.recentlySurfaced) ? opts.recentlySurfaced.map(normalizeLoopText) : []);

  const active = [];
  const overdue = [];
  const undated = [];
  for (const loop of Array.isArray(loops) ? loops : []) {
    if (!loop || loop.done || !loop.text) continue; // 只碰 open
    if (recent.has(normalizeLoopText(loop.text))) continue;
    const openedMs = parseTagDate(loop.openedTag, nowMs);
    if (openedMs == null) {
      // 没写日期:不知搁多久,但也别永久隐形 —— 兜底浮一次(填充档)。
      undated.push({ text: loop.text, openedTag: null, ageDays: null, line: loop.line, tier: 'undated', undated: true });
      continue;
    }
    const ageDays = (nowMs - openedMs) / DAY_MS;
    if (ageDays < staleDays) continue; // 太新,还不该提
    const entry = { text: loop.text, openedTag: loop.openedTag, ageDays, line: loop.line, undated: false };
    if (ageDays <= maxActiveDays) {
      active.push({ ...entry, tier: 'active' });
    } else {
      overdue.push({ ...entry, tier: 'overdue' });
    }
  }
  active.sort((x, y) => y.ageDays - x.ageDays);   // 主力:最久优先
  overdue.sort((x, y) => y.ageDays - x.ageDays);  // 填充:同样最久优先
  // undated 保持文件顺序(稳定),排最后。
  return [...active, ...overdue, ...undated].slice(0, limit);
}

module.exports = {
  DAY_MS,
  BEIJING_OFFSET_MS,
  normalizeLoopText,
  parseTagDate,
  parseOpenLoops,
  selectStaleOpenLoops
};
