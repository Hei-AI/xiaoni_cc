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

// candidate: { sourceRef, embedding: number[], provenance, embeddingText }
// query: { vector: number[], contextRefs?: string[], contextVectors?: number[][], taskLocked?: bool }
function classifyCandidate(candidate, query, { floor, ceiling, contextRefSet }) {
  const sourceRef = candidate && candidate.sourceRef;
  // 结构式在场排除:她刚做/刚读的那条,直接剔(不必算相似度)。
  if (sourceRef && contextRefSet.has(sourceRef)) {
    return { verdict: 'drop_in_context', cos: null };
  }
  const cos = cosineSimilarity(query.vector, candidate.embedding);
  if (cos > ceiling) {
    return { verdict: 'drop_too_similar', cos };
  }
  if (cos < floor) {
    return { verdict: 'drop_too_far', cos };
  }
  // 语义式在场排除:和近窗任一条太像 = 换了说法的「刚做过」。
  const contextVectors = Array.isArray(query.contextVectors) ? query.contextVectors : [];
  for (const ctxVec of contextVectors) {
    if (cosineSimilarity(candidate.embedding, ctxVec) > ceiling) {
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

  const scored = (Array.isArray(candidates) ? candidates : []).map((candidate) => {
    const { verdict, cos } = classifyCandidate(candidate, query, { floor, ceiling, contextRefSet });
    return { candidate, verdict, cos };
  });

  const surfaced = scored
    .filter((entry) => entry.verdict === 'surfaced')
    .sort((left, right) => right.cos - left.cos)
    .slice(0, Math.max(1, limit));
  const surfacedSet = new Set(surfaced);
  const dropped = scored.filter((entry) => !surfacedSet.has(entry));

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
