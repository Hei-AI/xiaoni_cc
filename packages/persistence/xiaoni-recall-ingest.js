'use strict';

// 被动浮现 ingest + 触发2 orchestrator(纯编排)。
//
// embed 与 persistence 由调用方注入,本模块自身不做 HTTP、不认识具体服务 —— provider(入站)
// 和 agent-service(动作流)各自 fire-and-forget 调用,逻辑只此一份(DRY)。
//   触发1 ingest:新内容落地 → 建 cue → 嵌入(变了才嵌)→ upsert(成为将来的 cue)。
//   触发2 recall:同一落地内容当 query → pgvector top-K → band-pass → 写 shadow_log(**不投递**)。
// 详见 docs/XIAONI_PASSIVE_RECALL_SHADOW_COMPLETION.md §3。
//
// 铁律:调用方必须 fire-and-forget(不 await 进 live turn)+ 吞掉失败(不冒泡)。不投递 → 零缓存影响。

const {
  buildRecallCuesFromActionStream,
  buildRecallCueFromInboundMessage,
  normalizeRecallText
} = require('./xiaoni-passive-recall-extractor');
const { scoreCandidateImportance } = require('./xiaoni-recall-importance');
const {
  isWeakResult,
  buildExpansionPrompt,
  parseExpansion,
  DEFAULT_QUERY_COUNT
} = require('./xiaoni-recall-query-expansion');
const {
  bandpassRecall,
  renderRecallLead,
  recallDomainOf,
  isLowInfoRecallText,
  filterInboundBricksByPresence,
  combineDomainResults,
  SELF_DOMAIN_CUE_CLASSES,
  PEER_DOMAIN_CUE_CLASSES
} = require('./xiaoni-recall-bandpass');

// 去均值(anisotropy 修复)后 cos 分布整体下移 —— 阈值另设一套(env 可调,先给起点值,按 shadow 真分布再校)。
const envNum = (name, dflt) => (Number.isFinite(Number(process.env[name])) ? Number(process.env[name]) : dflt);
const CENTERED_FLOOR = envNum('XIAONI_RECALL_FLOOR', 0.15);
const CENTERED_TASK_FLOOR = envNum('XIAONI_RECALL_TASK_FLOOR', 0.30);
const CENTERED_CEILING = envNum('XIAONI_RECALL_CEILING', 0.60);
// 自适应跳出门:top 需高出邻域基线 margin 才冒(治静默率)。env 可调,调大更静默。
// 0.25 = P2 真库 sweep 定档(200 条落地 replay:0.08→fire96%,0.25→fire~39%);再高会连真·连续性一起砍,
// 「别吵」交给 v2 投递做轻,不靠把选择做到极稀。
const CENTERED_STANDOUT_MARGIN = envNum('XIAONI_RECALL_STANDOUT_MARGIN', 0.25);
// 近似重复在场抑制:候选 top centered-cos ≥ 此值 → 整条静默(她在重复已有记录的事,非遗忘)。
// 阈值取高(0.95)只杀近乎同一,保留 0.90-0.94 的强相关真·连续性。
const CENTERED_NEARDUP_SUPPRESS = envNum('XIAONI_RECALL_NEARDUP_SUPPRESS', 0.95);
const MEAN_TTL_MS = 10 * 60 * 1000; // μ 变化慢,缓存 10min,别每次落地扫全库
// per-cue 冷却窗:窗口内浮过的砖不再浮。第二/三/四腿各自都有冷却,唯独向量腿没有 ——
// 真库(2026-08-07 近 7 天):db_file_provenance 648 次只有 10 个不同 ref,单个文件 446 次;
// file_chunk 4226 次 949 个 chunk。同一块砖反复砸等于没有召回,只有复读。
const SURFACED_COOLDOWN_HOURS = envNum('XIAONI_RECALL_COOLDOWN_HOURS', 72);
const COOLDOWN_TTL_MS = 60 * 1000; // 冷却集只随「又浮了一块」变化,缓存 1min 足够

// 「不在上下文」= 不在她当前 replay 进 live 请求的 stack 尾(压缩 cutoff 之上)。这条边界的权威来源
// 是 agent_session_context_windows.read_cutoff_after_stack_index —— 同一个 session key 主 loop 在用。
const CONTEXT_SESSION_KEY = (typeof process.env.XIAONI_GLOBAL_PROMPT_CONTEXT_SESSION_KEY === 'string'
  && process.env.XIAONI_GLOBAL_PROMPT_CONTEXT_SESSION_KEY.trim())
  ? process.env.XIAONI_GLOBAL_PROMPT_CONTEXT_SESSION_KEY.trim()
  : 'xiaoni:global';
// SQL 候选池排除上限:结构式在场排除的完整性靠 band-pass 的 JS Set 兜(O(1)),SQL 只需把最可能撞进
// top-K 最近邻的「最近若干条在场项」剔出池子(她此刻正做的事最像),避免超大 text[] 参数。
const MAX_SQL_EXCLUDE_REFS = 2000;
// ④ 语义式在场排除窗口:调用方没给近窗时,退回「保留尾最近 N 条」(她此刻正做的),抓「换了说法刚做过」。
const SEMANTIC_CONTEXT_WINDOW = 20;
// 常驻菜单的向量缓存 TTL。菜单变得慢(日记目录一天一行、人物菜单更慢、近况一轮一次),
// 而每次落地都要用 —— 缓存 10 分钟足够,过期重读重嵌(本地 embedding server,不花钱)。
const CONTEXT_MENU_TTL_MS = 10 * 60 * 1000;
// 太短的行(分隔线、单个词)嵌出来是噪音向量,反而会误杀候选。
const CONTEXT_MENU_MIN_CHARS = 8;

// readContextMenus:可选。返回她**常驻上下文里那三张菜单**的正文(字符串数组,一份一条)。
// 为什么要它:真库实测(2026-08-19,近 3 天 5631/5631 次请求)`<xiaoni_status>`、
// `<xiaoni_diary_index>`、`<xiaoni_people>` 100% 常驻在她的请求里。菜单已经点到的事,
// 她看一眼就想得起来 —— 那不是「她不知道自己做过」,不该再召回一遍。
// 结构式在场排除按 sourceRef 比,对菜单无效(菜单不是栈项);所以走语义式那条:
// 把菜单**逐行**嵌成向量喂进 contextVectors,和候选太像的自动 drop_in_context。
// 逐行而不是整块:整块嵌出来是一个糊掉的泛化向量,谁都像。
// 不注入 → 行为与改动前完全一致。
// expandQueries:可选。`({ system, user }) => Promise<string>` —— 发一发小模型,返回原文。
// 只在算术结果「弱」时才被调用(见 xiaoni-recall-query-expansion.js 的触发闸)。
// readTags:可选。返回她自己的标签命名空间(loops --tag / topics 文件名 / 人物菜单名字)。
// 两个都不注入 → 完全不展开,行为与改动前一致。
function createRecallIngest({
  embed,
  persistence,
  identityKey = 'xiaoni',
  readContextMenus = null,
  expandQueries = null,
  readTags = null,
  readPeerNames = null
} = {}) {
  if (typeof embed !== 'function') {
    throw new Error('createRecallIngest: embed(texts) 函数必填');
  }
  if (!persistence || typeof persistence.upsertRecallCues !== 'function') {
    throw new Error('createRecallIngest: persistence 必填');
  }

  // 去 anisotropy 模型缓存(mean + top-k 主成分)。取不到就退回 raw cos(不阻断)。
  let cachedModel = null;
  let cachedModelAt = 0;
  async function getDeanisModel() {
    const now = Date.now();
    if (cachedModel && (now - cachedModelAt) < MEAN_TTL_MS) {
      return cachedModel;
    }
    try {
      if (typeof persistence.getRecallDeanisotropyModel === 'function') {
        const m = await persistence.getRecallDeanisotropyModel(identityKey, { numComponents: 4, sampleSize: 4000 });
        if (m && Array.isArray(m.mean) && m.mean.length) {
          cachedModel = m;
          cachedModelAt = now;
        }
      } else if (typeof persistence.getRecallCorpusMeanVector === 'function') {
        const mu = await persistence.getRecallCorpusMeanVector(identityKey);
        if (Array.isArray(mu) && mu.length) {
          cachedModel = { mean: mu, components: [] };
          cachedModelAt = now;
        }
      }
    } catch {
      // 保留旧缓存(若有),不阻断召回
    }
    return cachedModel;
  }

  // 冷却集缓存(读失败 → 空集,不阻断召回:宁可多浮一次,不可整条腿哑掉)。
  let cachedCooldown = null;
  let cachedCooldownAt = 0;
  async function getCooldownRefs() {
    const now = Date.now();
    if (cachedCooldown && (now - cachedCooldownAt) < COOLDOWN_TTL_MS) {
      return cachedCooldown;
    }
    if (typeof persistence.listRecentlySurfacedRecallRefs !== 'function') {
      return new Set(); // 老 persistence:退化成「无冷却」,行为与改动前一致。
    }
    try {
      const refs = await persistence.listRecentlySurfacedRecallRefs({
        identityKey,
        windowHours: SURFACED_COOLDOWN_HOURS
      });
      cachedCooldown = new Set(Array.isArray(refs) ? refs : []);
      cachedCooldownAt = now;
    } catch {
      return cachedCooldown || new Set();
    }
    return cachedCooldown;
  }

  // 常驻菜单的逐行向量(带 TTL 缓存)。读/嵌失败 → 空数组,不阻断召回
  // (少一道在场排除只是多冒一条,不是错)。
  let cachedMenuVectors = null;
  let cachedMenuVectorsAt = 0;
  async function getContextMenuVectors() {
    if (typeof readContextMenus !== 'function') {
      return [];
    }
    const now = Date.now();
    if (cachedMenuVectors && (now - cachedMenuVectorsAt) < CONTEXT_MENU_TTL_MS) {
      return cachedMenuVectors;
    }
    try {
      const docs = await readContextMenus();
      const lines = [];
      for (const doc of Array.isArray(docs) ? docs : []) {
        if (typeof doc !== 'string') {
          continue;
        }
        for (const raw of doc.split(/\r?\n/)) {
          const line = raw.replace(/^\s*[-*]\s*/, '').trim();
          if (line.replace(/\s+/g, '').length >= CONTEXT_MENU_MIN_CHARS) {
            lines.push(line);
          }
        }
      }
      if (lines.length === 0) {
        cachedMenuVectors = [];
        cachedMenuVectorsAt = now;
        return cachedMenuVectors;
      }
      const vectors = await embed(lines);
      cachedMenuVectors = (Array.isArray(vectors) ? vectors : []).filter((v) => Array.isArray(v) && v.length);
      cachedMenuVectorsAt = now;
    } catch {
      return cachedMenuVectors || [];
    }
    return cachedMenuVectors;
  }

  // 建好的 cue → 嵌入(内容 hash 没变的跳过,省嵌入)→ upsert。
  async function embedAndUpsert(cues) {
    if (!Array.isArray(cues) || cues.length === 0) {
      return { upserted: 0 };
    }
    const existing = await persistence.getExistingContentHashes(identityKey, cues.map((c) => c.sourceRef));
    const changed = cues.filter((c) => existing.get(c.sourceRef) !== c.contentHash);
    if (changed.length === 0) {
      return { upserted: 0 };
    }
    const vectors = await embed(changed.map((c) => c.embeddingText));
    const usable = changed
      .map((c, i) => ({ ...c, embedding: Array.isArray(vectors[i]) ? vectors[i] : [] }))
      .filter((c) => c.embedding.length > 0);
    if (usable.length === 0) {
      return { upserted: 0 };
    }
    return persistence.upsertRecallCues(identityKey, usable);
  }

  // 触发1:动作流条目入库。
  async function ingestActionStreamItems(items) {
    return embedAndUpsert(buildRecallCuesFromActionStream(items));
  }

  // 触发1:入站消息入库(③「别人说过」)。
  async function ingestInboundMessages(rows) {
    const cues = (Array.isArray(rows) ? rows : [])
      .map(buildRecallCueFromInboundMessage)
      .filter(Boolean);
    return embedAndUpsert(cues);
  }

  // 结构式在场排除的权威来源:她当前 replay 进 live 请求的 stack 尾(压缩 cutoff 之上)。
  // 拿到全量 in-context sourceRef;cutoff 缺失/persistence 老版本 → 返回空,交回调用方近窗兜底。
  // 铁律相关:纯读,fire-and-forget,不投递 → 零缓存影响。
  async function resolveInContextRefs() {
    if (typeof persistence.getSessionReadCutoffState !== 'function'
      || typeof persistence.listInContextStackSourceRefs !== 'function') {
      return { refs: [], cutoffIndex: null };
    }
    try {
      const cutoffState = await persistence.getSessionReadCutoffState({ sessionKey: CONTEXT_SESSION_KEY });
      const rawCutoff = cutoffState ? cutoffState.readCutoffAfterStackIndex : null;
      if (rawCutoff === null || typeof rawCutoff === 'undefined') {
        return { refs: [], cutoffIndex: null }; // 全新/未压缩 session:没有「已挤出」边界(注意 null≠0)。
      }
      const cutoff = Number(rawCutoff);
      if (!Number.isFinite(cutoff)) {
        return { refs: [], cutoffIndex: null };
      }
      const refs = await persistence.listInContextStackSourceRefs({ identityKey, afterStackIndex: cutoff });
      return { refs: Array.isArray(refs) ? refs.filter(Boolean) : [], cutoffIndex: cutoff };
    } catch {
      return { refs: [], cutoffIndex: null }; // 读失败不阻断召回(退回调用方近窗)。
    }
  }

  // 遗忘线时刻 = 压缩 cutoff 栈项的落栈时间。inbound 砖在场硬检查用(read_at 须早于它)。
  // 拿不到(未压缩/老 persistence)→ null,filterInboundBricksByPresence 对 inbound fail-closed。
  // fail-closed 遇上**持续性**故障(列改名/权限)会把 inbound 腿永久无声杀死——所以 catch 里
  // 一次性告警(每进程一次,不刷屏),shadow 里「peer 域怎么再也不冒了」有迹可循。
  let warnedForgettingLine = false;
  let warnedReadStates = false;
  async function resolveForgettingLineMs(cutoffIndex) {
    if (!Number.isFinite(cutoffIndex) || typeof persistence.getAgentStackItemTimeByIndex !== 'function') {
      return null;
    }
    try {
      const iso = await persistence.getAgentStackItemTimeByIndex({ identityKey, stackIndex: cutoffIndex });
      const ms = iso ? Date.parse(iso) : NaN;
      return Number.isFinite(ms) ? ms : null;
    } catch (err) {
      if (!warnedForgettingLine) {
        warnedForgettingLine = true;
        console.warn('[xiaoni-recall] resolveForgettingLineMs failed (inbound bricks will fail-closed):', err && err.message);
      }
      return null;
    }
  }

  // 展开:标签化 → 组装多 query → 各取一次 top-K → 并集(去掉已在池里的)。
  // 全程 fail-open:任一步失败/拿不到就返回空,调用方退回单 query —— 展开只做放宽,
  // 失败的后果是回到现状,不是出错。
  async function runQueryExpansion({ anchorText, sqlExclude, perDomainLimit, seenRefs }) {
    const tags = typeof readTags === 'function' ? await readTags().catch(() => []) : [];
    const prompt = buildExpansionPrompt(anchorText, tags, DEFAULT_QUERY_COUNT);
    const raw = await expandQueries(prompt);
    const { tags: pickedTags, queries } = parseExpansion(raw);
    if (!queries.length) {
      return null;
    }
    const vectors = await embed(queries);
    const added = [];
    for (let i = 0; i < queries.length; i += 1) {
      const vec = vectors[i];
      if (!Array.isArray(vec) || !vec.length) {
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const rows = await persistence.listRecallCandidates({
        identityKey, queryVector: vec, excludeSourceRefs: sqlExclude, limit: perDomainLimit
      }).catch(() => []);
      for (const c of Array.isArray(rows) ? rows : []) {
        if (!c || seenRefs.has(c.sourceRef) || isLowInfoRecallText(c.embeddingText)) {
          continue;
        }
        seenRefs.add(c.sourceRef);
        added.push(c);
      }
    }
    return { tags: pickedTags, queries, added };
  }

  // 触发2:落地内容当 query 跑召回,写 shadow_log(shadow-only,绝不投递)。
  // 「在场」的定义 = 她当前上下文 stack 尾(压缩 cutoff 之上,resolveInContextRefs 权威给出);
  // 调用方 params.contextRefs 只作近窗补充(语义式在场排除窗口)。冒的必须是「不在这条尾里」的东西。
  async function runShadowRecall(params = {}) {
    // query 侧同样清洗(剥样板/脚手架);清洗后为空 = 纯样板落地,不召回。
    const text = normalizeRecallText(params.landedText || '');
    if (!text) {
      return null;
    }
    // 闲聊门(cue 侧):纯笑声/表情/裸数字/超短寒暄勾不起任何值得召回的记忆 → 本次不触发联想。
    if (isLowInfoRecallText(text)) {
      return null;
    }
    const [queryVector] = await embed([text]);
    if (!Array.isArray(queryVector) || queryVector.length === 0) {
      return null;
    }
    const landedRef = params.landedRef || null;
    const callerContextRefs = Array.isArray(params.contextRefs) ? params.contextRefs.filter(Boolean) : [];
    const inContextState = await resolveInContextRefs();
    const inContextRefs = inContextState.refs;
    // 取候选的 K。pgvector 的 ORDER BY <=> 排在**没去 anisotropy 的空间**里,而 band-pass
    // 判断用的是去 anisotropy 之后的空间 —— 两个序不一样,所以这一刀切在错的序上。
    // 真库实测 2026-08-20(25 个 query × 各自的 centered-top-10,共 250 条):
    //   掉出 K=300  6%   ← 真 top-10 里每次丢掉 6%,band-pass 再准也看不见
    //   掉出 K=1000 3%
    //   掉出 K=3000 0%   最深的一条原始名次 6225
    // raw cos 从名次 1 到名次 8000 只掉 0.166(1.000→0.834),整个语料挤在一条窄带里 ——
    // 这就是为什么原始名次几乎不携带信息、K 必须给足。
    // 但 K 有个硬天花板:pgvector 的 hnsw.ef_search 上限是 1000,再大 HNSW 也只返约 1000 条,
    // 而且把 ef_search 设过 1000 会直接报 22023 让整条查询失败(fire-and-forget 会吞掉,
    // 线上表现为召回静默死掉且无迹象 —— 2026-08-20 亲手踩过,回归集 replay 全静默才发现)。
    // 所以取每域 1000(= ef_search 上限),总 K=2000,对应约 3% 的漏召。
    // 代价实测:延迟约 105ms、载荷远低于 napi 512MB 崩点。
    // 备选方案(未采用):把去 anisotropy 搬进 SQL 直接在正确空间里排序,K=300 就够,
    // 但用不上 HNSW → seq scan 449ms,且随语料线性变慢。要它就得建 centered 列 + 索引。
    const limit = Number(params.limit) || 2000;

    // 结构式在场排除的完整集合(她真实持有的 stack 尾 ∪ 调用方近窗 ∪ 落地项本身)。band-pass 的 JS Set
    // 用它逐候选 O(1) 剔「已在场」—— 这是「不在上下文」的硬保证,量再大也只是 Set 查询。
    const structuralRefs = Array.from(new Set([landedRef, ...inContextRefs, ...callerContextRefs].filter(Boolean)));
    // SQL 候选池排除:上限保护(超大尾时只推最近的在场项进 SQL,其余靠上面的 JS Set 兜)。
    const recentInContext = inContextRefs.slice(-MAX_SQL_EXCLUDE_REFS);
    const sqlExclude = Array.from(new Set([landedRef, ...recentInContext, ...callerContextRefs].filter(Boolean)));

    // 分域检索(海马体):自我域(日记/宫殿/自己的话)与他人域(inbound + qq_usage peer-seen)
    // 各自 top-K——跨音域 cos 不可比,单池会让日记在 SQL 层就输光。他人域带 includeNullCueClass
    // (legacy 无类行按 recallDomainOf 语义归他人域,不从两域间静默漏掉)。老 persistence(不认
    // cueClasses 参数)自动退化为两次同池查询,合并去重后≈半池(各 ceil(limit/2) 去重),不炸。
    const perDomainLimit = Math.max(1, Math.ceil(limit / 2));
    const [selfCandidatesRaw, peerCandidatesRaw] = await Promise.all([
      persistence.listRecallCandidates({
        identityKey, queryVector, excludeSourceRefs: sqlExclude, limit: perDomainLimit,
        cueClasses: SELF_DOMAIN_CUE_CLASSES
      }),
      persistence.listRecallCandidates({
        identityKey, queryVector, excludeSourceRefs: sqlExclude, limit: perDomainLimit,
        cueClasses: PEER_DOMAIN_CUE_CLASSES, includeNullCueClass: true
      })
    ]);
    // 域归属以 cueClass 判(recallDomainOf)——兼容退化路径(老 persistence 忽略 cueClasses 时
    // 两次查询返回同池内容,按域重分 + 去重后仍各归各域)。
    const cooldownRefs = await getCooldownRefs();
    const seenRefs = new Set();
    const selfCandidates = [];
    let peerCandidates = [];
    const cooledDown = [];
    for (const c of [...(selfCandidatesRaw || []), ...(peerCandidatesRaw || [])]) {
      if (!c || seenRefs.has(c.sourceRef)) {
        continue;
      }
      seenRefs.add(c.sourceRef);
      // 闲聊门(砖侧):低信息记忆不配当砖。
      if (isLowInfoRecallText(c.embeddingText)) {
        continue;
      }
      // per-cue 冷却:窗口内刚浮过的这块砖,这次别再砸(与第二/三/四腿同名 verdict)。
      if (cooldownRefs.has(c.sourceRef)) {
        cooledDown.push({ candidate: c, verdict: 'cooled_down', cos: null });
        continue;
      }
      (recallDomainOf(c) === 'self' ? selfCandidates : peerCandidates).push(c);
    }

    // 在场硬检查(inbound 砖):已读 且 read_at 早于遗忘线(cutoff 栈项落栈时刻)才算记忆。
    // 结构式排除吐的是 stack:* ref,对 inbound:* 永远不命中(2026-07-23 核查实锤)——这道检查是
    // inbound 砖唯一的「不在上下文」硬保证。
    const forgettingLineMs = await resolveForgettingLineMs(inContextState.cutoffIndex);
    const inboundIds = peerCandidates
      .map((c) => (typeof c.sourceRef === 'string' ? /^inbound:(\d+)$/.exec(c.sourceRef) : null))
      .filter(Boolean)
      .map((m) => Number(m[1]));
    let readStates = new Map();
    if (inboundIds.length && typeof persistence.getInboundReadStates === 'function') {
      try {
        const rows = await persistence.getInboundReadStates(inboundIds);
        readStates = new Map((Array.isArray(rows) ? rows : []).map((r) => [Number(r.id), r]));
      } catch (err) {
        // 查失败 → 全部无状态 → filter fail-closed 剔掉 inbound 砖。持续性故障会永久杀死
        // inbound 腿,所以一次性告警留迹(同 resolveForgettingLineMs)。
        if (!warnedReadStates) {
          warnedReadStates = true;
          console.warn('[xiaoni-recall] getInboundReadStates failed (inbound bricks fail-closed):', err && err.message);
        }
        readStates = new Map();
      }
    }
    peerCandidates = filterInboundBricksByPresence(peerCandidates, readStates, forgettingLineMs);

    const candidates = [...selfCandidates, ...peerCandidates];

    // ④ 语义式在场排除:近窗条目的向量(可选,persistence 提供才做)。调用方给了近窗用其近窗;
    // 没给(如入站钩子)退回保留尾最近 N 条,让入站召回也能抓「换说法的刚做过」。
    const semanticRefs = callerContextRefs.length
      ? callerContextRefs
      : inContextRefs.slice(-SEMANTIC_CONTEXT_WINDOW);
    let contextVectors = [];
    if (semanticRefs.length && typeof persistence.getRecallCueVectorsByRefs === 'function') {
      contextVectors = await persistence.getRecallCueVectorsByRefs(identityKey, semanticRefs);
    }
    // 常驻菜单也是「在场」的一部分 —— 它们逐字在她每一次请求里。
    contextVectors = [...(Array.isArray(contextVectors) ? contextVectors : []), ...(await getContextMenuVectors())];

    // 去 anisotropy(mean+主成分)+ BM25 双路:取模型传入,有模型时用去 anisotropy 空间阈值。
    const model = await getDeanisModel();
    const meanVector = model ? model.mean : null;
    const components = model ? model.components : [];
    const bandParams = meanVector
      ? { floor: params.taskLocked ? CENTERED_TASK_FLOOR : CENTERED_FLOOR, ceiling: CENTERED_CEILING, standoutMargin: CENTERED_STANDOUT_MARGIN, nearDupSuppress: CENTERED_NEARDUP_SUPPRESS }
      : {};
    // 双域各自选拔:每域独立跑 band-pass(邻域基线/跳出门在域内算,同域才可比),
    // 再合成——优先自我经历域,每次落地最多 1 块(守「别吵」)。
    const surfaceLimit = Number(params.surfaceLimit) || 1;
    const toBandCandidate = (c) => ({
      sourceRef: c.sourceRef,
      sourceKind: c.sourceKind, // classifyCandidate 要靠它区分 inbound / file_chunk
      embedding: c.embedding,
      provenance: c.provenance,
      embeddingText: c.embeddingText
    });
    const queryShape = { vector: queryVector, text, contextRefs: structuralRefs, contextVectors, meanVector, components, taskLocked: !!params.taskLocked };
    // importance(「她的投入痕迹」)当第三路 RRF。名字表来自她自己的人物菜单;
    // 读不到 → 空表 → peer / profiledPeer 因子恒 0,其余因子照算(不阻断)。
    const peerNames = typeof readPeerNames === 'function'
      ? await readPeerNames().catch(() => [])
      : [];
    const importanceCache = new Map();
    const importanceOf = (candidate) => {
      const ref = candidate && candidate.sourceRef;
      if (!importanceCache.has(ref)) {
        importanceCache.set(ref, scoreCandidateImportance(candidate, { peerNames }).importance);
      }
      return importanceCache.get(ref);
    };

    const runBandpass = () => combineDomainResults(
      bandpassRecall({ query: queryShape, candidates: selfCandidates.map(toBandCandidate), limit: surfaceLimit, importanceOf, ...bandParams }),
      bandpassRecall({ query: queryShape, candidates: peerCandidates.map(toBandCandidate), limit: surfaceLimit, importanceOf, ...bandParams }),
      surfaceLimit
    );
    let result = runBandpass();

    // ── 自适应 query 展开 ────────────────────────────────────────────────
    // 召回只有 dense 这一路(BM25 只在已取回的池内重排,补不了漏召),所以 dense 没捞进来的
    // 东西后面谁也救不回。算术**跑完之后**判弱,弱才换几种问法重取一遍,再跑一遍 band-pass。
    //
    // 顺序很重要:第一版把这段放在 band-pass **之前**,拿 raw cos 和「取回的池子大小」当判据 ——
    // 两个都是错的量。raw cos 全语料挤在 0.83-0.92(见本文件 K 那一段的实测),永远 ≥ 阈值;
    // 池子大小是 K(最大 2000),永远 ≥ 3。于是展开**永不触发**,而且不报错、无迹象。
    // 判弱必须用 band-pass 之后的量:带内还剩几条、最高的那条离基线多远。
    // 近似重复导致的整条静默不展开:那是她在重复刚做过的事(drop_landing_near_dup),
    // 把池子放宽救不了,只会白烧一次调用。
    let expansion = null;
    if (typeof expandQueries === 'function' && !result.nearDupPresent) {
      // 带内 = 过了三道硬闸(太远 / 太像 / 已在场)的候选数。
      // drop_domain_priority 和 drop_landing_near_dup 是**带内之后**才发生的取舍,算带内。
      const OUT_OF_BAND = new Set(['drop_too_far', 'drop_too_similar', 'drop_in_context']);
      const outOfBand = result.dropped.filter((d) => OUT_OF_BAND.has(d.verdict)).length;
      const inBand = Math.max(0, candidates.length - outOfBand);
      const topCos = result.surfaced.length ? Number(result.surfaced[0].cos) : null;
      if (isWeakResult({ topCos, qualifiedCount: inBand })) {
        expansion = await runQueryExpansion({ anchorText: text, sqlExclude, perDomainLimit, seenRefs })
          .catch(() => null);
        if (expansion && expansion.added.length) {
          for (const c of expansion.added) {
            (recallDomainOf(c) === 'self' ? selfCandidates : peerCandidates).push(c);
            candidates.push(c);
          }
          result = runBandpass(); // 池子放宽了,重新选拔
        }
      }
    }

    const droppedCounts = { drop_too_similar: 0, drop_too_far: 0, drop_in_context: 0, cooled_down: 0 };
    for (const d of [...result.dropped, ...cooledDown]) {
      droppedCounts[d.verdict] = (droppedCounts[d.verdict] || 0) + 1;
    }

    await persistence.insertRecallShadowLog({
      identityKey,
      occurredAt: params.occurredAt,
      queryRef: landedRef,
      queryText: text.slice(0, 240),
      taskLocked: !!params.taskLocked,
      bandFloor: result.floor,
      bandCeiling: result.ceiling,
      silent: result.silent,
      corpusCount: candidates.length, // 近邻邻域大小(非全库;全库计数按需另查,避免每落地一次 count)
      // 展开留痕:没触发 → null。观察期要能分清「本来就捞到了」和「展开才捞到的」。
      queryExpansion: expansion
        ? { tags: expansion.tags, queries: expansion.queries, addedCount: expansion.added.length }
        : null,
      topK: candidates.length,
      surfaced: result.surfaced.map((e) => ({
        lead: renderRecallLead(e.candidate),
        cos: e.cos,
        domain: recallDomainOf(e.candidate),
        sourceRef: e.candidate.sourceRef,
        provenance: e.candidate.provenance
      })),
      droppedCounts,
      droppedSample: result.dropped
        .filter((d) => typeof d.cos === 'number')
        .sort((a, b) => b.cos - a.cos)
        .slice(0, 10)
        .map((d) => ({ verdict: d.verdict, cos: d.cos, sourceRef: d.candidate.sourceRef }))
    });

    return result;
  }

  return { ingestActionStreamItems, ingestInboundMessages, runShadowRecall };
}

module.exports = { createRecallIngest };
