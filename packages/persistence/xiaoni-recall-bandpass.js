'use strict';

// 小腻被动浮现 —— band-pass 选择 + lead 渲染(纯函数,无 IO)。
//
// 目标函数和 rankFeedbackReflectionsForRecall 相反:那个取 top-k、越像越好;
// 这里要「关联 − 在场」—— 惩罚顶端(太像 = 大概率就是她当前上下文里刚做的、冗余),
// 只取中间那条带。三条边:
//   上限 CEILING  太像 → drop_too_similar(冗余/已在场)   ← 状态无关的冗余切
//   下限 floor    太远 → drop_too_far(噪音)              ← 由状态调:task-locked 抬高(只留紧邻火花)
//   在场排除      源在当前上下文近窗 / 和近窗语义太像 → drop_in_context
//
// 详见 docs/XIAONI_PASSIVE_RECALL_SURFACING.md。常量先给保守默认,标注待真数据调。

const DEFAULT_FLOOR = 0.35;        // 发散态下限:低于视作噪音
const TASK_LOCK_FLOOR = 0.60;      // task-locked:抬高下限,只留和当前活紧邻的火花,防带偏
const DEFAULT_CEILING = 0.92;      // 冗余上限(状态无关):高于视作「已在场」的近似重复

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i];
    const y = b[i];
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function resolveFloor({ taskLocked, floor }) {
  if (typeof floor === 'number') {
    return floor;
  }
  return taskLocked ? TASK_LOCK_FLOOR : DEFAULT_FLOOR;
}

// 去各向异性:减全库均值 μ 再算 cos。小嵌入模型向量挤在一个公共方向上(cos 整体抬到 ~0.9、
// 少数向量成"跟谁都像"的枢纽);减 μ 后 cos 拉开、枢纽塌成 ~0。真库实测见 getRecallCorpusMeanVector。
function subtractMean(vec, mu) {
  if (!Array.isArray(mu) || !Array.isArray(vec) || mu.length !== vec.length) {
    return vec;
  }
  const out = new Array(vec.length);
  for (let i = 0; i < vec.length; i += 1) {
    out[i] = vec[i] - mu[i];
  }
  return out;
}

// 去 anisotropy 升级版(All-but-the-Top):减 mean + 减 top-k 主成分投影。
// 减均值只去掉一个公共方向;残留泛枢纽(压缩快照/长文)靠再减前几个主成分方向压死。
function subtractDeanisotropy(vec, mean, components) {
  if (!Array.isArray(mean) || !Array.isArray(vec) || mean.length !== vec.length) {
    return vec;
  }
  const out = new Array(vec.length);
  for (let i = 0; i < vec.length; i += 1) out[i] = vec[i] - mean[i];
  if (Array.isArray(components)) {
    for (const pc of components) {
      if (!Array.isArray(pc) || pc.length !== vec.length) continue;
      let d = 0;
      for (let i = 0; i < vec.length; i += 1) d += out[i] * pc[i];
      for (let i = 0; i < vec.length; i += 1) out[i] -= d * pc[i];
    }
  }
  return out;
}

// ── BM25 双路(字符 bigram,语言无关;在 top-K 候选集内做局部 BM25)──
// 补 dense 的盲区:「中文 query × 英文文档」dense 说像但零词面重叠 → BM25≈0 → 融合压下去。
function bigramTokens(text) {
  const s = (typeof text === 'string' ? text : '').replace(/\s+/g, '');
  const grams = [];
  for (let i = 0; i < s.length - 1; i += 1) grams.push(s.slice(i, i + 2));
  return grams;
}

function bm25Scores(queryText, candidates) {
  const docs = candidates.map((c) => bigramTokens(c && c.embeddingText));
  const N = docs.length || 1;
  const avgLen = (docs.reduce((a, d) => a + d.length, 0) / N) || 1;
  const df = new Map();
  for (const d of docs) {
    for (const t of new Set(d)) df.set(t, (df.get(t) || 0) + 1);
  }
  const q = new Set(bigramTokens(queryText));
  const k1 = 1.5;
  const b = 0.75;
  return docs.map((d) => {
    const tf = new Map();
    for (const t of d) tf.set(t, (tf.get(t) || 0) + 1);
    let score = 0;
    for (const qt of q) {
      const f = tf.get(qt) || 0;
      if (!f) continue;
      const n = df.get(qt) || 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * (d.length / avgLen)));
    }
    return score;
  });
}

// candidate: { sourceRef, embedding: number[], provenance, embeddingText }
// query: { vector, text?, contextRefs?, contextVectors?, meanVector?, components?, taskLocked? }
function classifyCandidate(candidate, query, { floor, ceiling, contextRefSet, centeredQuery, deanis }) {
  const sourceRef = candidate && candidate.sourceRef;
  // 结构式在场排除:她刚做/刚读的那条,直接剔(不必算相似度)。
  if (sourceRef && contextRefSet.has(sourceRef)) {
    return { verdict: 'drop_in_context', cos: null };
  }
  const candVec = deanis ? subtractDeanisotropy(candidate.embedding, deanis.mean, deanis.components) : candidate.embedding;
  const cos = cosineSimilarity(centeredQuery, candVec);
  if (cos > ceiling) {
    return { verdict: 'drop_too_similar', cos };
  }
  if (cos < floor) {
    return { verdict: 'drop_too_far', cos };
  }
  // 语义式在场排除:和近窗任一条太像 = 换了说法的「刚做过」(同样去 anisotropy 后比)。
  const contextVectors = Array.isArray(query.contextVectors) ? query.contextVectors : [];
  for (const ctxVec of contextVectors) {
    const cv = deanis ? subtractDeanisotropy(ctxVec, deanis.mean, deanis.components) : ctxVec;
    if (cosineSimilarity(candVec, cv) > ceiling) {
      return { verdict: 'drop_in_context', cos };
    }
  }
  return { verdict: 'surfaced', cos };
}

function bandpassRecall(params) {
  const {
    query,
    candidates = [],
    limit = 1
  } = params || {};
  if (!query || !Array.isArray(query.vector) || query.vector.length === 0) {
    return { surfaced: [], dropped: [], silent: true, floor: null, ceiling: DEFAULT_CEILING };
  }
  const ceiling = typeof params.ceiling === 'number' ? params.ceiling : DEFAULT_CEILING;
  const floor = resolveFloor({ taskLocked: !!query.taskLocked, floor: params.floor });
  const contextRefSet = new Set(Array.isArray(query.contextRefs) ? query.contextRefs : []);
  // 去 anisotropy 模型:mean(+可选 top-k 主成分)。给了 meanVector 且维度对得上才启用。
  const mean = Array.isArray(query.meanVector) && query.meanVector.length === query.vector.length
    ? query.meanVector
    : null;
  const components = mean && Array.isArray(query.components)
    ? query.components.filter((pc) => Array.isArray(pc) && pc.length === query.vector.length)
    : [];
  const deanis = mean ? { mean, components } : null;
  const centeredQuery = deanis ? subtractDeanisotropy(query.vector, deanis.mean, deanis.components) : query.vector;

  // 自适应"跳出"门(治静默率):固定 floor 切不干净(genuine 和弱关联的 cos 混在一起)。
  // 只有 top 明显跳出这次候选群(cos ≥ 邻域基线均值 + margin)才算"冒出来";平淡查询静默。
  // 基线**排除最高那条**(否则 outlier 抬高自己的基线);margin 由 params.standoutMargin 控制(env 可调)。
  // 未给则退回纯固定 floor(不改行为)。
  const cands = Array.isArray(candidates) ? candidates : [];
  const cosList = cands.map((candidate) => {
    const cv = deanis ? subtractDeanisotropy(candidate.embedding, deanis.mean, deanis.components) : candidate.embedding;
    return cosineSimilarity(centeredQuery, cv);
  });
  // 「在场」强信号:候选池里存在与当前落地近乎同一的项(top centered-cos ≥ nearDupSuppress)= 她在
  // 重复一件已有记录的事(刚做/记过),不是「想不起的往事」→ 整条静默。真库抽查证实:这类落地剩下的
  // 中带命中多是短句表面撞词的虚假匹配(「我在钓鱼呢」→「我在睡觉」)。阈值远高于 ceiling,只杀近乎
  // 同一,不误伤强相关(0.90-0.94 的真·连续性保留)。ceiling 只剔掉近似重复那一条,这里是整条落地压制。
  const nearDupSuppress = typeof params.nearDupSuppress === 'number' ? params.nearDupSuppress : null;
  const nearDupPresent = nearDupSuppress !== null && cosList.some((c) => Number.isFinite(c) && c >= nearDupSuppress);
  let effectiveFloor = floor;
  const standoutMargin = typeof params.standoutMargin === 'number' ? params.standoutMargin : null;
  if (standoutMargin !== null) {
    const finite = cosList.filter((c) => Number.isFinite(c)).sort((a, b) => b - a);
    if (finite.length > 3) {
      const rest = finite.slice(1); // 排除最高的那条,用其余作邻域基线
      const baseline = rest.reduce((a, b) => a + b, 0) / rest.length;
      effectiveFloor = Math.max(floor, baseline + standoutMargin);
    }
  }

  const scored = cands.map((candidate) => {
    const { verdict, cos } = classifyCandidate(candidate, query, { floor: effectiveFloor, ceiling, contextRefSet, centeredQuery, deanis });
    return { candidate, verdict, cos };
  });

  let qualified = scored.filter((entry) => entry.verdict === 'surfaced');
  // BM25 双路:带内候选做局部 BM25,dense 名次 + BM25 名次 RRF 融合重排(词面接地的优先当 top-1)。
  // 给了 query.text 且带内 >1 条才融合;否则退回纯 cos 排序(纯语义远亲照旧能冒)。
  if (qualified.length > 1 && typeof query.text === 'string' && query.text.trim()) {
    const denseRank = new Map([...qualified].sort((a, b) => b.cos - a.cos).map((e, i) => [e, i]));
    const bm = bm25Scores(query.text, qualified.map((e) => e.candidate));
    const bmRank = new Map(
      qualified.map((e, i) => ({ e, s: bm[i] })).sort((a, b) => b.s - a.s).map((x, i) => [x.e, i])
    );
    // 第三路:importance(「她的投入痕迹」)。给了 importanceOf 才加。
    //
    // 为什么在这里加是安全的:bandpassRecall 是**按域分别跑**的(自我域 = 她写的东西,
    // 他人域 = 别人说的话),而 importance 的作者分类正好和域一一对应
    // (file_chunk→db_file_provenance→self→authored_by_her;inbound→db_life_cue→peer→
    // authored_by_peer)。所以「importance 只在同类之间排序、绝不跨类比大小」这条纪律
    // 在这里是**结构性成立**的,不靠额外守卫。见 xiaoni-recall-importance.js 顶注。
    //
    // 用名次而不是分值参与融合:她写的那类是 79 级连续谱、别人写的只有 3 级,分值不可比;
    // 名次可比,而且 RRF 本来就是名次融合。
    const importanceRank = typeof params.importanceOf === 'function'
      ? new Map(
        [...qualified]
          .sort((a, b) => (Number(params.importanceOf(b.candidate)) || 0) - (Number(params.importanceOf(a.candidate)) || 0))
          .map((e, i) => [e, i])
      )
      : null;
    const RRF_K = 60;
    qualified = qualified
      .map((e) => ({
        e,
        fused: 1 / (RRF_K + denseRank.get(e))
          + 1 / (RRF_K + bmRank.get(e))
          + (importanceRank ? 1 / (RRF_K + importanceRank.get(e)) : 0)
      }))
      .sort((a, b) => b.fused - a.fused)
      .map((x) => x.e);
  } else {
    qualified = qualified.sort((left, right) => right.cos - left.cos);
  }
  // 近似重复在场 → 整条静默(surfaced 清空);dropped 保留全量分类,shadow_log 里近似重复的 cos 仍在
  // dropped_sample,可事后区分「近似重复抑制的静默」(silent 且 dropped 有 cos≥nearDupSuppress)。
  const surfaced = nearDupPresent ? [] : qualified.slice(0, Math.max(1, limit));
  // dropped 只装「没过带」的;超出 limit 的合格项既不进 surfaced,也不误标成 dropped:'surfaced'。
  const dropped = scored.filter((entry) => entry.verdict !== 'surfaced');

  return {
    surfaced,
    dropped,
    silent: surfaced.length === 0,
    // 近似重复在场信号透传:它是「这次落地是重复,不是遗忘」的**落地级**属性——
    // 分域调用方(combineDomainResults)靠它把整条落地静默,不能只静默命中的那个域。
    nearDupPresent,
    floor,
    ceiling
  };
}

// ── lead 渲染 ────────────────────────────────────────────────────────────────
// 只冒指针 + 一句勾人提示,绝不冒正文。措辞按 provenance.leadTemplate / cueClass,
// 缺模板退通用。守 privacyScope(v1 shadow 只透传标注;真正的「别在会串的场合冒」是 v2 投递时的活)。

function teaser(embeddingText, maxLength = 40) {
  if (typeof embeddingText !== 'string') {
    return '';
  }
  const compact = embeddingText.replace(/\s+/g, ' ').trim();
  if (compact.length <= maxLength) {
    return compact;
  }
  return `${compact.slice(0, maxLength - 1).trimEnd()}…`;
}

function renderRecallLead(candidate) {
  const provenance = (candidate && candidate.provenance && typeof candidate.provenance === 'object')
    ? candidate.provenance
    : {};
  const hint = teaser(candidate && candidate.embeddingText);
  const pointer = provenance.path || (candidate && candidate.sourceRef) || null;
  const privacyScope = provenance.privacyScope || 'self_private';
  const template = provenance.leadTemplate || provenance.cueClass || null;

  let text;
  switch (template) {
    case 'file_chunk':
    case 'db_file_provenance':
      text = pointer ? `你在 ${pointer} 里记过：${hint}` : `你之前写过：${hint}`;
      break;
    case 'db_spoken_fragment':
      text = `你以前说过：${hint}`;
      break;
    case 'peer_message': {
      const peer = provenance.peer || provenance.peerName || '有人';
      text = `${peer} 提过：${hint}`;
      break;
    }
    default:
      // 措辞穷举不完 → 通用兜底,永不丢 cue。
      text = pointer ? `你之前碰过和这个像的事 → ${pointer}：${hint}` : `你之前碰过和这个像的事：${hint}`;
  }

  return {
    kind: template || 'generic',
    pointer,
    hint,
    privacyScope,
    text
  };
}

// ── 海马体分域(设计:design-20260723 被动联想召回)────────────────────────────
// 跨音域 cos 不可比(短聊天 vs 长散文),混池让闲聊音域内共振永远赢 → 分两域各自选拔。
// 判别子就是现成的 cueClass 一列(真库验证:file_chunk 全 db_file_provenance,inbound 全
// db_life_cue,action_stream 99.7% db_life_cue 即 qq_usage peer-seen):
//   自我域 = 她自己的经历(日记/宫殿/自己的话/自己的文件动作)
//   他人域 = 别人说过的话(inbound + qq_usage 看到的消息)
const SELF_DOMAIN_CUE_CLASSES = ['db_file_provenance', 'db_spoken_fragment'];
const PEER_DOMAIN_CUE_CLASSES = ['db_life_cue'];

function recallDomainOf(candidate) {
  const cueClass = candidate && candidate.provenance && typeof candidate.provenance === 'object'
    ? candidate.provenance.cueClass
    : null;
  return SELF_DOMAIN_CUE_CLASSES.includes(cueClass) ? 'self' : 'peer';
}

// 闲聊门(cue 侧 + 砖侧共用):只挡「明显不是记忆/不配触发联想」的低信息文本——
// 纯笑声/语气词、纯表情符号、纯数字标点、超短寒暄。有实质内容的一律放行
// (「哈哈哈 他肯定不是这个意思但你说得对」有正文 → 放行,共振交给域内自适应基线治)。
const LOW_INFO_STRIP_RE = /[\s\d\p{P}\p{S}哈嘿呵嗯哦噢喔呀啊哇嗷呜唉诶欸嘛吧呢啦咯喽咦嘻噗汗草笑hwxXyYeE]/gu;
const LOW_INFO_MIN_CHARS = 6;

function isLowInfoRecallText(text) {
  if (typeof text !== 'string') {
    return true;
  }
  const compact = text.replace(/\s+/g, '');
  if (compact.length < LOW_INFO_MIN_CHARS) {
    return true; // 超短:勾不起任何回忆的碎砖
  }
  const substantive = compact.replace(LOW_INFO_STRIP_RE, '');
  return substantive.length === 0; // 剥掉笑声/表情/数字/标点后空了 = 纯寒暄
}

// 在场硬检查(inbound 砖,纯函数;数据由调用方注入):
//   可入选 ⟺ 已读 且 read_at 早于遗忘线时刻(压缩 cutoff 栈项的落栈时间)。
//   未读 = 从没进过她脑子,不是记忆(notify 的活);cutoff 后才读 = 还在活上下文尾里。
//   遗忘线缺失(从未压缩)= 没有「已忘」可言 → inbound 砖全剔(fail-closed)。
//   非 inbound ref(stack:/文件路径)不归本检查管,原样放行。
const INBOUND_REF_PREFIX_RE = /^inbound:/;
const INBOUND_REF_RE = /^inbound:(\d+)$/;

function filterInboundBricksByPresence(candidates, readStates, cutoffTimeMs) {
  const list = Array.isArray(candidates) ? candidates : [];
  const states = readStates instanceof Map ? readStates : new Map();
  return list.filter((candidate) => {
    const ref = typeof candidate?.sourceRef === 'string' ? candidate.sourceRef : '';
    if (!INBOUND_REF_PREFIX_RE.test(ref)) {
      return true; // 非 inbound ref(stack:/文件路径)不归本检查管
    }
    const m = INBOUND_REF_RE.exec(ref);
    if (!m) {
      // inbound: 前缀但 id 非数字(如 message_sid 铸的 ref)→ 无法查已读态 → fail-closed。
      // 这是 inbound 砖唯一的「不在上下文」硬保证,宁可错杀不可放行。
      return false;
    }
    if (!Number.isFinite(cutoffTimeMs)) {
      return false;
    }
    const state = states.get(Number(m[1]));
    if (!state || !state.isRead || !state.readAt) {
      return false;
    }
    const readAtMs = Date.parse(state.readAt);
    return Number.isFinite(readAtMs) && readAtMs < cutoffTimeMs;
  });
}

// 双域合成:两域各自 bandpassRecall 后,优先自我经历域的胜者;每次落地最多 1 块(守「别吵」)。
// dropped/droppedCounts 合并两域,floor/ceiling 记「被采纳那个域」的(全静默记自我域的)。
// 两条落地级语义(交叉 review 修):
//   ① 近似重复压制是**落地级**的——任一域检出「她在重复刚做过的事」,整条落地静默
//     (drop_landing_near_dup),不能只静默命中的域,否则另一域照冒 = 重开已调平的噪声通道。
//   ② 落选域的带内胜者折进 dropped(drop_domain_priority)——不进 surfaced 也不消失,
//     shadow 分布保持完整,阈值校准才看得见域间竞争。
function combineDomainResults(selfResult, peerResult, limit = 1) {
  const empty = { surfaced: [], dropped: [], silent: true, nearDupPresent: false, floor: null, ceiling: null };
  const s = selfResult || empty;
  const p = peerResult || empty;
  const sSurfaced = Array.isArray(s.surfaced) ? s.surfaced : [];
  const pSurfaced = Array.isArray(p.surfaced) ? p.surfaced : [];
  const dropped = [...(Array.isArray(s.dropped) ? s.dropped : []), ...(Array.isArray(p.dropped) ? p.dropped : [])];

  const landingNearDup = !!(s.nearDupPresent || p.nearDupPresent);
  if (landingNearDup) {
    for (const e of [...sSurfaced, ...pSurfaced]) {
      dropped.push({ candidate: e.candidate, verdict: 'drop_landing_near_dup', cos: e.cos });
    }
    return {
      surfaced: [],
      dropped,
      silent: true,
      nearDupPresent: true,
      floor: s.floor,
      ceiling: s.ceiling,
      chosenDomain: null
    };
  }

  const chosen = sSurfaced.length ? s : (pSurfaced.length ? p : null);
  const surfaced = chosen ? (chosen === s ? sSurfaced : pSurfaced).slice(0, Math.max(1, limit)) : [];
  const loserSurfaced = chosen === s ? pSurfaced : (chosen === p ? sSurfaced : []);
  for (const e of loserSurfaced) {
    dropped.push({ candidate: e.candidate, verdict: 'drop_domain_priority', cos: e.cos });
  }
  return {
    surfaced,
    dropped,
    silent: surfaced.length === 0,
    nearDupPresent: false,
    floor: chosen ? chosen.floor : s.floor,
    ceiling: chosen ? chosen.ceiling : s.ceiling,
    chosenDomain: chosen ? (chosen === s ? 'self' : 'peer') : null
  };
}

module.exports = {
  DEFAULT_FLOOR,
  TASK_LOCK_FLOOR,
  DEFAULT_CEILING,
  SELF_DOMAIN_CUE_CLASSES,
  PEER_DOMAIN_CUE_CLASSES,
  cosineSimilarity,
  // 第四腿(联想)的 relevance 因子直接复用这两个:字符 bigram + 池内局部 BM25。
  // 导出而不是另写一份词面打分器 —— 分词/IDF/长度归一只能有一套。
  bigramTokens,
  bm25Scores,
  bandpassRecall,
  recallDomainOf,
  isLowInfoRecallText,
  filterInboundBricksByPresence,
  combineDomainResults,
  renderRecallLead
};
