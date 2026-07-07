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
  buildRecallCueFromInboundMessage
} = require('./xiaoni-passive-recall-extractor');
const { bandpassRecall } = require('./xiaoni-recall-bandpass');
const { renderRecallLead } = require('./xiaoni-recall-bandpass');

// 去均值(anisotropy 修复)后 cos 分布整体下移 —— 阈值另设一套(env 可调,先给起点值,按 shadow 真分布再校)。
const envNum = (name, dflt) => (Number.isFinite(Number(process.env[name])) ? Number(process.env[name]) : dflt);
const CENTERED_FLOOR = envNum('XIAONI_RECALL_FLOOR', 0.15);
const CENTERED_TASK_FLOOR = envNum('XIAONI_RECALL_TASK_FLOOR', 0.30);
const CENTERED_CEILING = envNum('XIAONI_RECALL_CEILING', 0.60);
const MEAN_TTL_MS = 10 * 60 * 1000; // μ 变化慢,缓存 10min,别每次落地扫全库

function createRecallIngest({ embed, persistence, identityKey = 'xiaoni' } = {}) {
  if (typeof embed !== 'function') {
    throw new Error('createRecallIngest: embed(texts) 函数必填');
  }
  if (!persistence || typeof persistence.upsertRecallCues !== 'function') {
    throw new Error('createRecallIngest: persistence 必填');
  }

  // 全库均值 μ 缓存(去 anisotropy 用)。取不到就退回 raw cos(不阻断)。
  let cachedMean = null;
  let cachedMeanAt = 0;
  async function getMeanVector() {
    if (typeof persistence.getRecallCorpusMeanVector !== 'function') {
      return null;
    }
    const now = Date.now();
    if (cachedMean && (now - cachedMeanAt) < MEAN_TTL_MS) {
      return cachedMean;
    }
    try {
      const mu = await persistence.getRecallCorpusMeanVector(identityKey);
      if (Array.isArray(mu) && mu.length) {
        cachedMean = mu;
        cachedMeanAt = now;
      }
    } catch {
      // 保留旧缓存(若有),不阻断召回
    }
    return cachedMean;
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

  // 触发2:落地内容当 query 跑召回,写 shadow_log(shadow-only,绝不投递)。
  // contextRefs = 近窗已在场的 sourceRef(结构式在场排除);若 persistence 提供
  // getRecallCueVectorsByRefs,则取近窗向量做 ④ 语义式在场排除。
  async function runShadowRecall(params = {}) {
    const text = typeof params.landedText === 'string' ? params.landedText.trim() : '';
    if (!text) {
      return null;
    }
    const [queryVector] = await embed([text]);
    if (!Array.isArray(queryVector) || queryVector.length === 0) {
      return null;
    }
    const landedRef = params.landedRef || null;
    const contextRefs = Array.isArray(params.contextRefs) ? params.contextRefs.filter(Boolean) : [];
    const exclude = [landedRef, ...contextRefs].filter(Boolean);
    const limit = Number(params.limit) || 300;

    const candidates = await persistence.listRecallCandidates({
      identityKey,
      queryVector,
      excludeSourceRefs: exclude,
      limit
    });

    // ④ 语义式在场排除:近窗条目的向量(可选,persistence 提供才做)。
    let contextVectors = [];
    if (contextRefs.length && typeof persistence.getRecallCueVectorsByRefs === 'function') {
      contextVectors = await persistence.getRecallCueVectorsByRefs(identityKey, contextRefs);
    }

    // 去 anisotropy:取 μ 传入(去均值再算 cos)。有 μ 时用去均值空间的阈值。
    const meanVector = await getMeanVector();
    const bandParams = meanVector
      ? { floor: params.taskLocked ? CENTERED_TASK_FLOOR : CENTERED_FLOOR, ceiling: CENTERED_CEILING }
      : {};
    const result = bandpassRecall({
      query: { vector: queryVector, contextRefs: exclude, contextVectors, meanVector, taskLocked: !!params.taskLocked },
      candidates: candidates.map((c) => ({
        sourceRef: c.sourceRef,
        embedding: c.embedding,
        provenance: c.provenance,
        embeddingText: c.embeddingText
      })),
      limit: Number(params.surfaceLimit) || 1,
      ...bandParams
    });

    const droppedCounts = { drop_too_similar: 0, drop_too_far: 0, drop_in_context: 0 };
    for (const d of result.dropped) {
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
      topK: candidates.length,
      surfaced: result.surfaced.map((e) => ({
        lead: renderRecallLead(e.candidate),
        cos: e.cos,
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
