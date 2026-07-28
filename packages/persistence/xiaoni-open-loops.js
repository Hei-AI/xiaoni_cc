'use strict';

// 被动召回【第二条腿】:开放承诺 / 未闭合的事,按【时间 · 状态】重提,而不是按语义。
//
// 语义 band-pass(第一条腿)只能捞出「和此刻落地文本语义相近」的记忆;她「答应楠楠盯考研进度」
// 这类承诺,当楠楠发来一句「在吗」时文本毫不相干,band-pass 结构上够不到(见
// docs/XIAONI_MEMORY_PALACE_GENERATION.md §10)。这一腿补这个洞:
//   状态源 = 她维护的 notes/diary/open-loops.md
//            `- [ ] 事 #标签 (M/D)` 开;`- [x]` 做完;`- [-]` 放弃/不做了(和做完一样不再提)
//            日期括号里允许有尾巴(`(7/27起)`、`(7/25-7/27)`);`#标签` 抽成独立字段并从 text 剥掉
//   触发   = 按时间扫描,挑「开着且搁置够久、且最近没被提过」的少数几条
//   投递   = 先 shadow-only(只写 xiaoni_recall_shadow_log,绝不投递),观察抽取/时机准不准
//
// 本模块是纯函数(解析 + 选择),不碰 fs / prisma / 时钟 —— nowMs 由调用方传入,便于测试与
// 避免时钟漂移。fs 读取 + shadow 落库的编排在调用方(admin-backend,和 reindex 同层)。

const DAY_MS = 86_400_000;
// 她写的日期是北京 wall-clock(UTC+8);nowMs 是真 UTC 毫秒。算 age 要把标注日期按北京
// 本地零点解释,否则同一天登记同一天扫会差 ±8h,在阈值边界误判一天。见交叉 review 2026-07-12。
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
// 解析出来的日期距今超过这么久,就不认它是日期(返回 null → 落 undated 档)。
//
// 护的是「括号里像日期、其实是分数 / 进度」的写法:放宽正则去吃括号里的尾巴之后,
// `(1/3进度)`、`(2/5看完)` 这类会被当成 1 月 3 日、2 月 5 日 —— 半年前。误判的后果比 undated
// 严重得多:第二腿按 ageDays「最久优先」排序,一条假的半年前条目 ageDays 巨大,会长期钉在最
// 前面被反复浮(「百天老死承诺霸榜、饿死中龄承诺」正是这条腿的已知病,不能再往里灌假老条目)。
// 落 undated 只是「不知搁多久、兜底浮一次」,代价小得多。
//
// 零伤害依据:open-loops.md 是 2026-07-23 才建的,现存最老的时间锚是 07-20 那一档,
// 全部远在 180 天内;180 天也远大于 maxActiveDays(默认 30),不影响 active/overdue 分档的语义。
// 副作用(有意):M/D 缺年回退去年那条路径,只有在回退后仍落在 180 天内时才成立 ——
// 也就是每年上半年(dayOfYear < 180)才可能命中;下半年写一个「更晚的月/日」一律判 undated。
const MAX_TAG_AGE_DAYS = 180;

// `- [ ] 文本` 开;`- [x]` 做完;`- [-]` 放弃。缩进、大小写 x 都容忍。
const OPEN_LOOP_LINE = /^\s*[-*]\s*\[( |x|X|-)\]\s+(.+?)\s*$/;
// 行尾的开启日期标注。她真实写的从来不是裸 (M/D):(7/27起) (7/26起,现在ch55) (7/24开始)
// (7/23第一次去) (7/27定,8/27截止) (7/25-7/27) (7/27 done) (7/27→7/28) (7/28-8/4)。
// 旧正则要求括号里「只有日期」,于是 17 行里只有 1 行能解析,库里 open_loop_scan 浮出项 63%
// 落在 tier:'undated'(实测 2026-07-28:undated 89 / active 53)。所以:只认括号开头的那个日期,
// 后面的尾巴 `[^)]*` 一律吃掉。用 `[^)]*` 而不是 `.*` 是为了不让匹配跨过右括号 —— 否则
// `帮楠楠(考研)看资料 (7/20起)` 这种正文里带括号的行会被从前面那个括号开始误配。
// 第三段是可选的:g1 是 4 位年时按 YYYY-M-D;g1 > 12 且有第三段时按 YY-M-D(月不可能 > 12,
// 无歧义,保留老写法);其余一律按 M/D,第三段连同后面的都算尾巴(范围写法 7/25-7/27 走这里)。
const TRAILING_DATE_TAG = /\(\s*(\d{1,4})[-/](\d{1,2})(?:[-/](\d{1,2}))?[^)]*\)\s*$/;
// 行末 `#标签`(可多个)。spec 的规范形状是 `- [ ] 事 #标签 (M/D)`(标签在日期之前),
// 但也容忍 `- [ ] 事 (M/D) #标签`,所以剥两趟(日期前后各一趟)。
// 字符集:`#` 后跟中英文(一-鿿)/ 数字 / `-` / `_`,不含空白也不含 `/`。
// 首字符不许是数字 —— 她真实写过 `explorabl.es Issue #39提了`,`#39` 是 issue 号不是标签;
// 放开首位数字会把这半句正文当标签剥掉,反而改了 identity。
const TRAILING_HASH_TAG = /\s#([A-Za-z_一-鿿][\w\-一-鿿]*)$/;

function normalizeLoopText(text) {
  return typeof text === 'string' ? text.replace(/\s+/g, ' ').trim().toLowerCase() : '';
}

// 从文本尾部连续剥 `#标签`,返回 { text, tags }(tags 按行内从左到右的顺序)。
// 只剥尾部连续的一串:正文中间出现的 `#` 不动(见 TRAILING_HASH_TAG 注释里的 issue 号)。
function stripTrailingHashTags(input) {
  let text = typeof input === 'string' ? input.trimEnd() : '';
  const found = [];
  for (;;) {
    const m = TRAILING_HASH_TAG.exec(text);
    if (!m) break;
    found.push(m[1]);
    text = text.slice(0, m.index).trimEnd();
  }
  found.reverse(); // 从右往左剥的,反过来才是行内顺序
  return { text, tags: found };
}

// 把行尾日期标注解析成时间戳。M/D(缺年)按北京「今天」的年推断:若那样得到的日期落在未来,
// 说明是去年的事,回退一年。标注日期一律按北京本地零点(= UTC 零点 − 8h)。
// 返回 ms 或 null(无法解析)。确定性:只依赖传入的 nowMs。
function parseTagDate(tag, nowMs) {
  if (typeof tag !== 'string') return null;
  const trimmed = tag.trim();
  // tag 可能带括号(调用方原样传 `(7/27起)`)也可能不带(parseOpenLoops 存的是括号里的内容)。
  const raw = TRAILING_DATE_TAG.exec(trimmed) || TRAILING_DATE_TAG.exec(`(${trimmed})`);
  if (!raw) return null;
  const a = Number(raw[1]);
  const b = Number(raw[2]);
  const c = raw[3] != null ? Number(raw[3]) : null;
  // 把 now 移到北京 wall-clock,再取年 → 缺年推断用的是她那边的「今年」。
  const nowBeijing = new Date(nowMs + BEIJING_OFFSET_MS);
  let year;
  let month;
  let day;
  let yearInferred = false; // 只有推断出来的年份才允许「未来 → 回退去年」
  if (a >= 100) {
    // 4 位年:YYYY-M-D。没有第三段(如 `2026-07`)不是日期,判失败。
    if (c == null) return null;
    year = a;
    month = b;
    day = c;
  } else if (c != null && a > 12) {
    // 三段且第一段 > 12 → 只能是 2 位年缩写 YY-M-D(月不可能 > 12,无歧义)。
    year = 2000 + a;
    month = b;
    day = c;
  } else {
    // 其余一律 M/D,缺年 → 用北京今年。
    // 【范围写法取哪个日期】`(7/25-7/27)` / `(7/28-8/4)` / `(7/27→7/28)` 这类范围,取【第一个
    // 日期 = 开始日】。理由:openedTag 的字段语义是「这事什么时候开始的」,ageDays 要量的是
    // 「搁了多久」,起算点必须是开始日;取结束日会把还没到的截止日当开始日,ageDays 变负、
    // 直接被 staleDays 挡掉 → 该提的行永远不提。所以第三段(以及它后面的一切)全当尾巴丢掉。
    year = nowBeijing.getUTCFullYear();
    month = a;
    day = b;
    yearInferred = true;
  }
  if (!(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) return null;
  // 北京本地零点对应的 UTC 瞬间 = UTC 零点 − 8h
  let ts = Date.UTC(year, month - 1, day) - BEIJING_OFFSET_MS;
  if (yearInferred && ts - nowMs > DAY_MS) {
    // M/D 用今年算出来在未来 → 是去年的
    ts = Date.UTC(year - 1, month - 1, day) - BEIJING_OFFSET_MS;
  }
  if (!Number.isFinite(ts)) return null;
  // 太老 → 不认(见 MAX_TAG_AGE_DAYS):大概率不是日期,而是 `(1/3进度)` 这类分数/进度。
  if (nowMs - ts > MAX_TAG_AGE_DAYS * DAY_MS) return null;
  return ts;
}

// 解析 open-loops.md 全文 → [{ line, state, done, text, openedTag, tags }]
//   state: 'open' | 'done' | 'dropped';done = 非 open(做完或放弃,都不再提)
//   tags:  行末 `#标签`(可 0..n 个),【已从 text 里剥掉】
//
// 为什么标签必须从 text 里剥掉:text 是这一行的身份 —— normalizeLoopText(text) 是第二腿冷却
// (recentlySurfaced)去重的键。标签留在 text 里,她给一条老行【补】一个标签就换了身份,冷却
// 失效,那行被重浮一次(还是同一句话)。剥掉之后补标签不动身份,冷却继续生效。
function parseOpenLoops(content) {
  if (typeof content !== 'string' || !content.trim()) return [];
  const out = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const m = OPEN_LOOP_LINE.exec(lines[i]);
    if (!m) continue;
    const mark = m[1].toLowerCase();
    const state = mark === 'x' ? 'done' : mark === '-' ? 'dropped' : 'open';
    // 剥两趟:spec 规范形状是 `事 #标签 (M/D)`(标签在日期前,第二趟命中),
    // 也容忍她写成 `事 (M/D) #标签`(第一趟命中)。
    const tail = stripTrailingHashTags(m[2].trim());
    let text = tail.text;
    let openedTag = null;
    const dm = TRAILING_DATE_TAG.exec(text);
    if (dm) {
      openedTag = dm[0].trim().replace(/^\(|\)$/g, '').trim();
      text = text.slice(0, dm.index).trim();
    }
    const beforeDate = stripTrailingHashTags(text);
    text = beforeDate.text;
    // 行内从左到右:日期之前的标签在前,日期之后的在后。
    const tags = [];
    for (const t of [...beforeDate.tags, ...tail.tags]) {
      if (!tags.includes(t)) tags.push(t);
    }
    if (!text) continue;
    out.push({ line: i + 1, state, done: state !== 'open', text, openedTag, tags });
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
// 返回 [{ text, openedTag, ageDays, line, tags, tier, undated }],优先级:
//   tier 'active'  搁置在 [staleDays, maxActiveDays] 内 —— 主力,按最久优先
//   tier 'overdue' 搁置 > maxActiveDays —— 可能已放着不管,降到主力之后当填充
//                  (上界是 MAX_TAG_AGE_DAYS:再老的日期根本不被认,直接落 undated)
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
      undated.push({
        text: loop.text,
        openedTag: null,
        ageDays: null,
        line: loop.line,
        tags: Array.isArray(loop.tags) ? loop.tags : [],
        tier: 'undated',
        undated: true
      });
      continue;
    }
    const ageDays = (nowMs - openedMs) / DAY_MS;
    if (ageDays < staleDays) continue; // 太新,还不该提
    const entry = {
      text: loop.text,
      openedTag: loop.openedTag,
      ageDays,
      line: loop.line,
      tags: Array.isArray(loop.tags) ? loop.tags : [],
      undated: false
    };
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
  MAX_TAG_AGE_DAYS,
  normalizeLoopText,
  stripTrailingHashTags,
  parseTagDate,
  parseOpenLoops,
  selectStaleOpenLoops
};
