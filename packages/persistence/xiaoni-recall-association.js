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
// 「在场」**不按年龄判**。年龄只用来分桶(决定 lead 怎么说「N 天前」),不再兼任在场代理。
//
// 旧版拿 near=0–7 天 + 配额恒 0 当在场代理,两头都错:
//   误杀 —— 实测 2244 条日记条目里 560 条(24%)落在 1–7 天,全被挡,而这批最鲜活、最可能接上;
//   漏网 —— line 桶提前 return,完全不看年龄,实测漏出过 ageDays=1.4 的 topic 章节。
// 而年龄本来就判不准在场。实测 2026-08-13 拿当天 12 条日记标题去 live 上下文
// (agent_stack_items 里 stack_index > read_cutoff_after_stack_index)里查:9 条 0 命中,
// 只有 3 条命中(`cofactor第六版写了` ×9),而那 3 条在场的原因是**她此刻正在做 cofactor**,
// 跟"记了几天"没有关系。上下文只有 0.8 小时 / 377 条,装的是她手上那一件事;
// 日记是横跨一整天写出来的另一份材料 —— 两份材料本来就基本不交集。
//
// 所以在场改成直查:候选标题在 live 上下文正文里逐字出现过 → 剔(见 contextText 入参)。
// 精确、无阈值、与年龄无关。这也正是 band-pass 里 `drop_in_context` 那条边的意思,
// association 腿之前只 import 了 bm25Scores,把这条边整个丢了。
const NEAR_MAX_DAYS = 7;   // 近场上界(含):0–7 天
const MID_MAX_DAYS = 30;   // 中场上界(含):8–30 天
// 桶处理顺序 = 表格顺序(near 配额恒 0,实际从 mid 开始)。identity 去重按这个顺序先到先得:
// 同一件事若同时以「中场日记条目」和「线场 L3 章节」两份出现,先落的那个桶拿走它,另一个桶
// 顺位取下一名 —— 这才是「一次只出一份」而不是「两个 slot 是同一件事的两份拷贝」(实测那个
// 坑在 ref 级冷却下是 100%,见 spec §8.1)。
const ASSOCIATION_BUCKET_ORDER = ['near', 'mid', 'far', 'line'];
const ASSOCIATION_BUCKET_QUOTAS = {
  // 近场 0–7 天:配额从 0 提到 1。历史事故「90 分钟前的消息被当成往事浮出来」现在由**在场直查**
  // 挡(90 分钟前她刚做的事,正文必然还在 live 上下文里,逐字就能命中),不再靠把整个近场
  // 配额压成 0 来规避 —— 那个做法连带牺牲了 24% 的可召回材料。
  near: 1,
  mid: 1,   // 8–30 天:刚开始模糊的
  far: 1,   // 30 天+:真正的往事
  line: 1   // 线场(属于一条 L3 线):断档的线重新接上;同样受 PRESENT_MAX_DAYS 约束
};

// ── 六因子:两个当门槛,四个当排序 ─────────────────────────────────────────
// v1 是**等权相加**(注释原话:「先验证结构改进有没有用,权重调优等 shadow 数据」)。
// shadow 数据到手了(2026-08-13,近 7 天 852 条投出候选),结论是等权的问题不在系数:
//   prose            均值 0.887  ← 近饱和
//   titleSpecificity 均值 0.894  ← 近饱和
//   peer             均值 0.648
//   relevance        均值 0.118  ← 唯一有区分度的,却只值 1/6 → 只占总分 3.8%
// prose 和 titleSpecificity 回答的是「这条是不是一条像样的记忆」,不是「这条跟她现在有没有
// 关系」。两个近饱和的常数参与排序,只会把分数整体抬高、把 relevance 淹掉:实测投出的候选里
// 65.6% 的 relevance 恰好为 0,76.5% 低于池内中位数 0.20 —— 它系统性地选中**比随机更不相关**
// 的记忆。所以把这两个降为**准入门槛**(过不了直接不进候选),排序只用剩下四个。
// 每个因子独立归一化到 [0,1];排序分 = relevance*3 + introspection + effort + peer ∈ [0,6]。
// 每个因子下面都写了「它想抓什么」+「真语料里的区分度实测」(2026-07-28,notes/diary 下
// 21 份按日日记 → 1451 个 `## ` 条目 → 过掉空/清单/结构头后 1419 条候选)。
const ASSOCIATION_FACTOR_NAMES = ['relevance', 'introspection', 'effort', 'prose', 'peer', 'titleSpecificity'];
// 排序权重。relevance 给 3 是为了让它真能翻盘:按实测(有 landedText 时 relevance 均值 0.331,
// introspection 0.170 / effort 0.426 / peer 0.648)算,relevance 占排序分约 44%,而不是 3.8%。
// 总分上界仍是 6,和 v1 同量纲,shadow 日志里的历史分数不用换算就能对着看。
const ASSOCIATION_RANK_WEIGHTS = { relevance: 3, introspection: 1, effort: 1, peer: 1 };
// 准入门槛。两个阈值都不是拍的,取自注释里已有的真语料分布:
//   prose:  prose-majority 856(60.3%) / bullet-majority 563(39.7%),分界就在 0.5。
//           挡掉的正是日内目录 —— 实测投出去的 `晚上（醒来后）——- 看了QQ…`、
//           `今天真做了的事（最终版）——1. …` 全是 bullet-majority。
//   title:  归一化标题 ≤3 字的 99 条(7.0%),而重复霸榜的 identity 恰恰全在这一批
//           (「最后」×7、「封底」×5、「读了」×3、「进度」×3)。4 字 → 0.333,故阈值取 1/3。
const PROSE_GATE = 0.5;
const TITLE_SPECIFICITY_GATE = 1 / 3;

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

// ── 在场直查 ──────────────────────────────────────────────────────────────
// contextText = live 上下文正文(agent_stack_items 里 stack_index > read_cutoff_after_stack_index
// 那一段拼起来)。候选标题在里面逐字出现过 = 这件事就是她此刻手上的活,浮它等于把砖头当引子。
//
// 为什么用逐字包含而不是相似度阈值:阈值要么要 embedding(这个模块是纯函数、不做 IO),要么
// 用 BM25 —— 但 BM25 在池内按最高分归一,最高的那条恒等于 1.0,拿它卡上限会**无条件**剔掉
// 每次的头名,哪怕池里根本没有冗余。逐字包含没有这个病:没冗余就一条都不剔。
// 归一化口径复用 normalizeEventText(和 identity/冷却同一套),避免标点/大小写造成漏判。
const CONTEXT_PRESENCE_MIN_CHARS = 4;

function isPresentInContext(title, normalizedContextText) {
  if (!normalizedContextText) return false;
  const key = normalizeEventText(typeof title === 'string' ? title : '');
  // 太短的标题(「最后」「读了」)逐字包含会误伤 —— 它们本来就过不了 titleSpecificity 门槛,
  // 这里再兜一层:短于阈值不做在场判定,交给门槛去剔。
  if (key.length < CONTEXT_PRESENCE_MIN_CHARS) return false;
  return normalizedContextText.includes(key);
}

// prose / titleSpecificity 的取值同时被「准入门槛」和「打分」用到 —— 只写一份实现,
// 两边都调它,避免门槛和分数用两套算法算出互相矛盾的结果。
// f3 effort 的归一,抽成具名函数:importance 模块要用同一份(见该文件顶注)。
function effortScoreOf(body) {
  const bodyChars = (typeof body === 'string' ? body : '').replace(/\s+/g, '').length;
  return clamp01(
    (Math.log(1 + bodyChars) - Math.log(1 + EFFORT_MIN_CHARS))
    / (Math.log(1 + EFFORT_FULL_CHARS) - Math.log(1 + EFFORT_MIN_CHARS))
  );
}

function proseScoreOf(body) {
  return clamp01(1 - bulletLineRatio(typeof body === 'string' ? body : ''));
}

function titleSpecificityOf(title) {
  const titleChars = normalizeEventText(typeof title === 'string' ? title : '').length;
  return clamp01((titleChars - 1) / (TITLE_FULL_CHARS - 1));
}

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
    effort: effortScoreOf(body),
    prose: proseScoreOf(body),
    peer: peerNames.some((name) => typeof name === 'string'
      && name.length >= MIN_PEER_NAME_CHARS
      && full.includes(name)) ? 1 : 0,
    titleSpecificity: titleSpecificityOf(title)
  };
  // prose / titleSpecificity 照旧算进 factors 落 shadow 日志(观察期还要看它们的分布),
  // 但**不参与排序** —— 它们的作用在 selectAssociativeMemories 的准入门槛那一步。
  const score = Object.keys(ASSOCIATION_RANK_WEIGHTS)
    .reduce((sum, name) => sum + ASSOCIATION_RANK_WEIGHTS[name] * factors[name], 0);
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
//   landedText                   本次落地的那段文本(f1 的 query);缺 → f1 全 0,其余因子照排
//   contextText                  live 上下文正文(在场直查用);缺 → 不做在场过滤
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
  // 缺 contextText 时在场直查整体让路(返回 false),不阻断扫描 —— 和 landedText 缺失时
  // f1 全 0 同一个口径:少一个信号就少一层过滤,不因为拿不到就瘫。
  const normalizedContextText = typeof opts.contextText === 'string' && opts.contextText
    ? normalizeEventText(opts.contextText)
    : '';
  const dropped = {
    shape: 0, no_bucket: 0, empty_body: 0, checklist_body: 0,
    structural_title: 0, bare_timestamp_title: 0, cooled_down: 0,
    // 新增两格:原本当排序因子的两个饱和量,现在当准入门槛。分开记,才看得出门槛卡掉多少。
    prose_gate: 0, title_gate: 0,
    // 在场直查:候选就是她此刻手上的活,浮它等于把砖头当引子。
    in_context: 0
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
    // 准入门槛(只对 event —— promise 的「正文」就是承诺本身,不按记忆的形状要求它)。
    // 过不了的不是「分低」,是「压根不是一条能当引子的记忆」,所以在进池之前就剔掉,
    // 而不是让它带着 0.2 的 prose 分继续跟真记忆抢配额。
    if (kind === 'event') {
      if (proseScoreOf(body) < PROSE_GATE) { dropped.prose_gate += 1; continue; }
      if (titleSpecificityOf(raw.title) < TITLE_SPECIFICITY_GATE) { dropped.title_gate += 1; continue; }
    }
    // 在场直查放在年龄分桶**之前**:在不在场跟它多老没关系,实测当天条目 12 条里 9 条不在场。
    if (isPresentInContext(raw.title, normalizedContextText)) { dropped.in_context += 1; continue; }
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
  ASSOCIATION_RANK_WEIGHTS,
  PROSE_GATE,
  TITLE_SPECIFICITY_GATE,
  isPresentInContext,
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
  selectAssociativeMemories,
  // 导出给 xiaoni-recall-importance.js 复用 —— 判据只能有一份。
  // 复制一遍正则/归一段就是造第二个真理源,阈值以后必然漂。
  INTROSPECTION_RE,
  effortScoreOf,
  titleSpecificityOf
};
