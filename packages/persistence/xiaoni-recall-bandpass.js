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
    const RRF_K = 60;
    qualified = qualified
      .map((e) => ({ e, fused: 1 / (RRF_K + denseRank.get(e)) + 1 / (RRF_K + bmRank.get(e)) }))
      .sort((a, b) => b.fused - a.fused)
      .map((x) => x.e);
  } else {
    qualified = qualified.sort((left, right) => right.cos - left.cos);
  }
  const surfaced = qualified.slice(0, Math.max(1, limit));
  // dropped 只装「没过带」的;超出 limit 的合格项既不进 surfaced,也不误标成 dropped:'surfaced'。
  const dropped = scored.filter((entry) => entry.verdict !== 'surfaced');

  return {
    surfaced,
    dropped,
    silent: surfaced.length === 0,
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

module.exports = {
  DEFAULT_FLOOR,
  TASK_LOCK_FLOOR,
  DEFAULT_CEILING,
  cosineSimilarity,
  bandpassRecall,
  renderRecallLead
};
