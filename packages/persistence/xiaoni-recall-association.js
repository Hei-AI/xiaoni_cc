'use strict';

// 被动召回【第四条腿】:联想。给「此刻落地的这段文本」配一件**旧事**,按「值不值得再想起」排序,
// 而不是按纯年龄(第三腿)或纯语义近邻(第一腿)。
//
// 为什么还要第四条腿(实测,2026-07-27/28 真库 + 真语料):
//   - 第三腿排序是纯 `ageDays` 降序,609 次扫描只浮出过 33 个 distinct ref,`2026-07-05.md#0`
//     一条占 47.6%。年龄天花板是结构性的:语料越写越多,越死。
//   - 第一腿(语义 band-pass)只捞「和落地文本语义相近」的,而相近的东西大半就在她当前上下文里
//     (同一天的砖头),真正该想起的旧事在 cos 上够不着。
//   本腿的两个地基换法:① 排序从单维年龄换成六因子等权;② 冷却从 ref 级换成 identity 级
//   (同一件事的多份表示 —— 日记条目 + L3 章节 —— 共享 identity,一次只出一份)。
//   设计出处 docs/specs/xiaoni-memory-layers-and-recall.md §5。
//
// 本模块是**纯函数**:不碰 fs / prisma / 时钟 / HTTP。nowMs、landedText、peerNames、冷却集合
// 全由调用方传入。fs 扫描 + shadow 落库的编排在调用方(admin-backend 的 reindex service,
// 和第二/三腿同一处、同一套 shadow 落库路径)。
//
// 铁律:本腿 **shadow-only,绝不投递**。产物只进 xiaoni_recall_shadow_log + 管理端观察面,
// 不进任何 LLM 请求字节 → 对双缓存(fork 克隆前缀 / 下一次主 run replay)零影响。

const {
  DAY_MS,
  normalizeEventText,
  stripChapterDatePrefix,
  isEmptyResurfaceBody,
  isChecklistBody,
  isSeedStructuralTitle
} = require('./xiaoni-diary-events');
const { stripTrailingHashTags } = require('./xiaoni-open-loops');
const { bm25Scores } = require('./xiaoni-recall-bandpass');

// ── 年龄桶 + 配额(§5.4 分层抽样,打破年龄天花板)────────────────────────────
// 只有打分不够:limit 小 + 冷却窗有限,最高分那批会长期霸占。所以按年龄分桶,每桶独立取。
// **空桶就少浮,不许跨桶借配额** —— 宁少不吵(见 selectAssociativeMemories 里的 pickFromBucket)。
const NEAR_MAX_DAYS = 7;   // 近场上界(含):0–7 天
const MID_MAX_DAYS = 30;   // 中场上界(含):8–30 天
// 桶处理顺序 = 表格顺序(near 配额恒 0,实际从 mid 开始)。identity 去重按这个顺序先到先得:
// 同一件事若同时以「中场日记条目」和「线场 L3 章节」两份出现,先落的那个桶拿走它,另一个桶
// 顺位取下一名 —— 这才是「一次只出一份」而不是「两个 slot 是同一件事的两份拷贝」(实测那个
// 坑在 ref 级冷却下是 100%,见 spec §8.1)。
const ASSOCIATION_BUCKET_ORDER = ['near', 'mid', 'far', 'line'];
const ASSOCIATION_BUCKET_QUOTAS = {
  // 近场恒 0:那一段还在她上下文里(或刚过去),浮它等于把砖头当引子。
  // 历史事故:90 分钟前的消息被当成往事浮出来。这一格**不是**调参项。
  near: 0,
  mid: 1,   // 8–30 天:刚开始模糊的
  far: 1,   // 30 天+:真正的往事
  line: 1   // 线场(任意年龄,但属于一条 L3 线):断档的线重新接上
};

// ── 六因子(第一版**等权**)────────────────────────────────────────────────
// 用户拍板:先验证「结构改进」(分桶 + identity 冷却 + 多维)有没有用,权重调优等 shadow 数据。
// 每个因子独立归一化到 [0,1],等权相加 → score ∈ [0,6]。
// 每个因子下面都写了「它想抓什么」+「真语料里的区分度实测」(2026-07-28,notes/diary 下
// 21 份按日日记 → 1451 个 `## ` 条目 → 过掉空/清单/结构头后 1419 条候选)。
const ASSOCIATION_FACTOR_NAMES = ['relevance', 'introspection', 'effort', 'prose', 'peer', 'titleSpecificity'];

// f2 introspection:正文里有没有「当时」那一层 —— 卡在哪、犹豫过什么、为什么最后这么定。
// 抓的是「她当时真在意」。写端 prompt 要求每条都写这一层,真实只有一小部分写了 → 稀疏即信号。
// 真语料区分度:180/1419 = 12.7% 命中。稀疏但不为零,正好当「这条不是流水账」的标记。
const INTROSPECTION_RE = /(当时|其实|犹豫|为什么|才想到|才发现|没想到|我以为|怕的是|说不出|不确定|后来才|意识到|承认|担心|舍不得)/;

// f3 effort:她花了多少力气写这一条(正文字数,log 段线性归一)。
// 真语料区分度:正文字数 p10=66 p25=106 p50=160 p75=238 p90=338 p99=737(max 3859)。
// 所以 log 段取 [60, 340]:把中间 80% 铺开,340 以上一律 1(再长不代表更值得想起)。
const EFFORT_MIN_CHARS = 60;
const EFFORT_FULL_CHARS = 340;

// f4 prose:整段话(她自己说清一件事) vs 清单式的日内小目录。
// 抓的是「这条是记忆,不是那天的目录」。清单行本身不算废(第二腿的料是 `- [ ]`,已被
// isChecklistBody 挡掉),但**无勾选的 `- ` 罗列**逃过了所有现有过滤器 —— 那正是 spec §9 记的
// 已知缺口(旧伞状格式的日内小节头)。
// 真语料区分度:prose-majority 856(60.3%) / bullet-majority 563(39.7%);而且分布不是随机的:
// 伞状/时间轴那几天 2026-07-06 83%、07-14 88%、07-22 87% 全落 bullet 侧,
// 她真正在写的那几天 07-24 14%、07-25 16%、07-26 18%、07-27 14%。因子直接把两类分开。
const BULLET_LINE_RE = /^[-*•]\s|^\d+[.、)]\s/;

// f6 titleSpecificity:标题指不指得出「是哪件事」(归一化标题长度)。
// 真语料区分度:归一化标题字数 p5=2 p25=6 p50=10 p75=15 p90=21;≤3 字的 99 条(7.0%),
// 而重复霸榜的 identity 恰恰全在这一批(「最后」×7、「封底」×5、「读了」×3、「进度」×3)。
// 所以 [1, 10] 段线性归一:10 字以上给满分,2-3 字的短标题拿 0.1-0.2。
const TITLE_FULL_CHARS = 10;

// 裸时刻标题(`22:00-22:30` / `03:00` / `9点`)= 日内时间轴的框架头,不是一件事的名字。
// 真语料实测 61/1419 = 4.3%,逐条看全是框架头(2026-07-22 一天就贡献 20+ 条连号时段)。
// 正文常常有真内容,但拿「03:00」当引子去提醒她想起一件事是纯噪音 → 直接不进候选。
const BARE_TIMESTAMP_TITLE_RE = /^[\s~约]*(\d{1,2}[:：]\d{2}(\s*[-–—~]\s*\d{1,2}[:：]\d{2})?|\d{1,2}\s*点(半|\d{1,2}分?)?)\s*$/;

// peerNames 里单字名(她的人物索引里真有一个叫「N」的)不能直接 includes:单个拉丁字母
// 会命中几乎每条带英文的正文(latin 命中率 77.3%),那 f5 就退化成常数。只用 ≥2 字的名字。
const MIN_PEER_NAME_CHARS = 2;

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function toSet(value) {
  if (value instanceof Set) return value;
  return new Set(Array.isArray(value) ? value.filter((v) => typeof v === 'string' && v) : []);
}

// 一件事的**身份**。冷却和跨桶去重按这个,不按 ref —— 同一件事的多份表示(日记条目 +
// L3 章节)必须归一成同一个键,否则两个 slot 会是同一件事的两份拷贝。
//
// 复用现成的三个归一化函数,**不写第四份**:
//   stripChapterDatePrefix(xiaoni-diary-events.js:93) 剥 L3 章节标题的 `M/D ` 前缀
//   stripTrailingHashTags(xiaoni-open-loops.js:59)    剥行尾 `#标签`(补标签不换身份)
//   normalizeEventText(xiaoni-diary-events.js:34)     折叠空白 + 转小写
// 三个必须**组合**才认得出同一件事:真库里 L3 章节标题带 `M/D ` 前缀,而 normalizeEventText
// 只折空白+小写 —— 两者单用都认不出「7/19 磨了一遍开场」和「磨了一遍开场」是一条。
function normalizeMemoryIdentity(title) {
  const withoutDate = stripChapterDatePrefix(title);
  const withoutTags = stripTrailingHashTags(withoutDate).text;
  return normalizeEventText(withoutTags);
}

function isBareTimestampTitle(title) {
  return typeof title === 'string' && BARE_TIMESTAMP_TITLE_RE.test(title);
}

// 正文里 bullet 行的占比(0..1)。空正文 → 0(= prose 满分;promise 一行整句就是这种)。
function bulletLineRatio(text) {
  const lines = (typeof text === 'string' ? text : '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return 0;
  return lines.filter((line) => BULLET_LINE_RE.test(line)).length / lines.length;
}

// 年龄桶。线场优先判(带线上下文的那份要落线场,不管它多老);其余按 ageDays 分近/中/远。
// dateMs 缺失且不属于任何线 → null(不进本腿):没日期就没法分桶,而「不知搁多久」这一档
// 第二腿已经用 tier:'undated' 兜过一次了,本腿再兜一遍只是重复吵。
function bucketOfCandidate(item, opts = {}) {
  if (!item) return null;
  const nowMs = Number(opts.nowMs);
  const nearMaxDays = Number.isFinite(opts.nearMaxDays) ? opts.nearMaxDays : NEAR_MAX_DAYS;
  const midMaxDays = Number.isFinite(opts.midMaxDays) ? opts.midMaxDays : MID_MAX_DAYS;
  if (typeof item.lineKey === 'string' && item.lineKey) return 'line';
  if (!Number.isFinite(nowMs) || !Number.isFinite(item.dateMs)) return null;
  const ageDays = (nowMs - item.dateMs) / DAY_MS;
  if (ageDays <= nearMaxDays) return 'near';
  if (ageDays <= midMaxDays) return 'mid';
  return 'far';
}

// 六因子打分。relevanceByRef 由调用侧(selectAssociativeMemories)先在**整个候选池**上跑一遍
// 局部 BM25 算好再传进来 —— IDF 必须在池内算才有意义,不能逐条独立算。
function scoreAssociationFactors(item, ctx = {}) {
  const title = typeof item.title === 'string' ? item.title : '';
  const body = typeof item.body === 'string' ? item.body : '';
  const full = `${title}\n${body}`;
  const bodyChars = body.replace(/\s+/g, '').length;
  const titleChars = normalizeEventText(title).length;
  const peerNames = Array.isArray(ctx.peerNames) ? ctx.peerNames : [];

  const factors = {
    // f1 联想:与本次落地文本的词面接地。复用 bandpass 的局部 BM25(字符 bigram + IDF +
    // 长度归一),再按池内最高分归一 → [0,1]。用 BM25 而不是裸重叠率:实测裸 overlap/min
    // 被短条目和「今天全部/总结」这类长条目两头霸榜(top-5 里 3 条是同几个总结),
    // BM25 的 IDF + 长度归一把它压掉,top-5 变成真同主题条目。
    // 真语料区分度(真 landedText × 1419 候选,6 段落地各跑一遍):归一后 p50≈0.20、
    // p90≈0.45–0.50、max=1.00 —— 全程铺开,不是二值。
    relevance: clamp01(ctx.relevance),
    introspection: INTROSPECTION_RE.test(body) ? 1 : 0,
    effort: clamp01(
      (Math.log(1 + bodyChars) - Math.log(1 + EFFORT_MIN_CHARS))
      / (Math.log(1 + EFFORT_FULL_CHARS) - Math.log(1 + EFFORT_MIN_CHARS))
    ),
    prose: clamp01(1 - bulletLineRatio(body)),
    peer: peerNames.some((name) => typeof name === 'string'
      && name.length >= MIN_PEER_NAME_CHARS
      && full.includes(name)) ? 1 : 0,
    titleSpecificity: clamp01((titleChars - 1) / (TITLE_FULL_CHARS - 1))
  };
  const score = ASSOCIATION_FACTOR_NAMES.reduce((sum, name) => sum + factors[name], 0);
  return { score, factors };
}

// 候选形状:
//   { ref, kind:'event'|'promise', title, body, dateMs|null, lineKey|null, tier|null }
//   ref     稳定引用(调用方按 canonical path 设 `${path}#${index}`,与第三腿同口径)
//   kind    'event' 走 substance 过滤(空/清单/结构头);'promise' 的正文就是它本身,不过滤
//   lineKey 属于哪条 L3 线(topic 文件的主题 / open-loop 行末 `#标签`);无 → null
//
// opts:
//   nowMs                        必填
//   landedText                   本次落地的那段文本(f1 的 query);缺 → f1 全 0,其余五因子照排
//   peerNames                    真人名表(调用方从 notes/people/ 读);缺 → f5 全 0
//   recentlySurfacedIdentities   identity 级冷却集合(也吃 ref,兼容按 ref 记的老留痕)
//   structuralTitles             复发判定为模板的归一化标题集合(复用第三腿 reindex 里那份)
//   quotas                       覆盖分桶配额(测试用;near 想改成非 0 得先想清上面那条注释)
// 返回 { picked, stats }:
//   picked  [{ ref, kind, bucket, identity, title, body, dateMs, ageDays, lineKey, tier, score, factors }]
//   stats   { candidates, filtered, byBucket:{near,mid,far,line}, quotas, dropped:{...} }
function selectAssociativeMemories(candidates, opts = {}) {
  const nowMs = Number(opts.nowMs);
  const empty = {
    picked: [],
    stats: {
      candidates: Array.isArray(candidates) ? candidates.length : 0,
      filtered: 0,
      byBucket: { near: 0, mid: 0, far: 0, line: 0 },
      quotas: { ...ASSOCIATION_BUCKET_QUOTAS, ...(opts.quotas || {}) },
      dropped: {}
    }
  };
  if (!Number.isFinite(nowMs)) return empty;

  const quotas = { ...ASSOCIATION_BUCKET_QUOTAS, ...(opts.quotas || {}) };
  const recent = toSet(opts.recentlySurfacedIdentities);
  const structuralTitles = toSet(opts.structuralTitles);
  const peerNames = Array.isArray(opts.peerNames) ? opts.peerNames : [];
  const dropped = {
    shape: 0, no_bucket: 0, empty_body: 0, checklist_body: 0,
    structural_title: 0, bare_timestamp_title: 0, cooled_down: 0
  };

  // ① 过滤(顺序固定,便于按 stats.dropped 读懂一次扫描到底剔在哪一步)
  const kept = [];
  for (const raw of Array.isArray(candidates) ? candidates : []) {
    if (!raw || typeof raw.title !== 'string' || !raw.title.trim()) { dropped.shape += 1; continue; }
    const kind = raw.kind === 'promise' ? 'promise' : 'event';
    const body = typeof raw.body === 'string' ? raw.body : '';
    if (kind === 'event') {
      // 复用第三腿的 step-1 substance 谓词(单一真理源,别在这儿重写一份)。
      if (isEmptyResurfaceBody(body)) { dropped.empty_body += 1; continue; }
      if (isChecklistBody(body)) { dropped.checklist_body += 1; continue; }
    }
    if (structuralTitles.has(normalizeEventText(raw.title)) || isSeedStructuralTitle(raw.title)) {
      dropped.structural_title += 1;
      continue;
    }
    if (isBareTimestampTitle(raw.title)) { dropped.bare_timestamp_title += 1; continue; }
    const bucket = bucketOfCandidate({ ...raw, dateMs: raw.dateMs }, { nowMs, nearMaxDays: opts.nearMaxDays, midMaxDays: opts.midMaxDays });
    if (!bucket) { dropped.no_bucket += 1; continue; }
    const ref = typeof raw.ref === 'string' && raw.ref ? raw.ref : `${raw.dateMs}#${raw.index}`;
    const identity = normalizeMemoryIdentity(raw.title);
    // identity 级冷却(本腿的地基之一)。也吃 ref:老留痕/别的腿按 ref 记的,一样认。
    if (recent.has(identity) || recent.has(ref)) { dropped.cooled_down += 1; continue; }
    kept.push({
      ref,
      kind,
      bucket,
      identity,
      title: raw.title,
      body,
      dateMs: Number.isFinite(raw.dateMs) ? raw.dateMs : null,
      ageDays: Number.isFinite(raw.dateMs) ? (nowMs - raw.dateMs) / DAY_MS : null,
      lineKey: typeof raw.lineKey === 'string' && raw.lineKey ? raw.lineKey : null,
      tier: typeof raw.tier === 'string' && raw.tier ? raw.tier : null
    });
  }

  // ② f1 的 BM25 在**过滤后的整池**上算一次(IDF 只有在池内才有意义),再按池内最高分归一。
  //    landedText 为空/池里一条都没命中 → 全 0,剩下五因子照样排(不因为没有落地文本就瘫)。
  const landedText = typeof opts.landedText === 'string' ? opts.landedText : '';
  let relevances = kept.map(() => 0);
  if (landedText.trim() && kept.length > 0) {
    const raw = bm25Scores(landedText, kept.map((c) => ({ embeddingText: `${c.title}\n${c.body}` })));
    const max = raw.reduce((m, v) => (Number.isFinite(v) && v > m ? v : m), 0);
    relevances = max > 0 ? raw.map((v) => (Number.isFinite(v) ? v / max : 0)) : kept.map(() => 0);
  }

  const scored = kept.map((c, index) => {
    const { score, factors } = scoreAssociationFactors(c, { relevance: relevances[index], peerNames });
    return { ...c, score, factors };
  });

  // ③ 分桶 + 每桶独立取头名。**空桶就少浮,不跨桶借配额**(宁少不吵)。
  const byBucket = { near: [], mid: [], far: [], line: [] };
  for (const item of scored) byBucket[item.bucket].push(item);
  for (const list of Object.values(byBucket)) {
    // 分数降序;同分按搁得久的优先(第三腿的直觉保留成 tie-break);再同则 ref 升序保稳定。
    list.sort((a, b) => (b.score - a.score)
      || ((b.ageDays == null ? -1 : b.ageDays) - (a.ageDays == null ? -1 : a.ageDays))
      || (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));
  }

  const picked = [];
  const takenIdentities = new Set();
  for (const bucket of ASSOCIATION_BUCKET_ORDER) {
    const quota = Math.max(0, Number(quotas[bucket]) || 0);
    if (quota === 0) continue;
    let taken = 0;
    for (const item of byBucket[bucket]) {
      if (taken >= quota) break;
      // 跨桶 identity 去重:同一件事的两份表示只出一份(spec §5.2 的核心要求)。
      if (takenIdentities.has(item.identity)) continue;
      takenIdentities.add(item.identity);
      picked.push(item);
      taken += 1;
    }
  }

  return {
    picked,
    stats: {
      candidates: Array.isArray(candidates) ? candidates.length : 0,
      filtered: kept.length,
      byBucket: {
        near: byBucket.near.length,
        mid: byBucket.mid.length,
        far: byBucket.far.length,
        line: byBucket.line.length
      },
      quotas,
      dropped
    }
  };
}

module.exports = {
  NEAR_MAX_DAYS,
  MID_MAX_DAYS,
  EFFORT_MIN_CHARS,
  EFFORT_FULL_CHARS,
  TITLE_FULL_CHARS,
  MIN_PEER_NAME_CHARS,
  ASSOCIATION_BUCKET_ORDER,
  ASSOCIATION_BUCKET_QUOTAS,
  ASSOCIATION_FACTOR_NAMES,
  normalizeMemoryIdentity,
  isBareTimestampTitle,
  bulletLineRatio,
  bucketOfCandidate,
  scoreAssociationFactors,
  selectAssociativeMemories
};
