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
const { bandpassRecall } = require('./xiaoni-recall-bandpass');
const { renderRecallLead } = require('./xiaoni-recall-bandpass');

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

function createRecallIngest({ embed, persistence, identityKey = 'xiaoni' } = {}) {
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
      return [];
    }
    try {
      const cutoffState = await persistence.getSessionReadCutoffState({ sessionKey: CONTEXT_SESSION_KEY });
      const rawCutoff = cutoffState ? cutoffState.readCutoffAfterStackIndex : null;
      if (rawCutoff === null || typeof rawCutoff === 'undefined') {
        return []; // 全新/未压缩 session:没有「已挤出」边界,结构式排除无从谈起(注意 null≠0)。
      }
      const cutoff = Number(rawCutoff);
      if (!Number.isFinite(cutoff)) {
        return [];
      }
      const refs = await persistence.listInContextStackSourceRefs({ identityKey, afterStackIndex: cutoff });
      return Array.isArray(refs) ? refs.filter(Boolean) : [];
    } catch {
      return []; // 读失败不阻断召回(退回调用方近窗)。
    }
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
    const [queryVector] = await embed([text]);
    if (!Array.isArray(queryVector) || queryVector.length === 0) {
      return null;
    }
    const landedRef = params.landedRef || null;
    const callerContextRefs = Array.isArray(params.contextRefs) ? params.contextRefs.filter(Boolean) : [];
    const inContextRefs = await resolveInContextRefs();
    const limit = Number(params.limit) || 300;

    // 结构式在场排除的完整集合(她真实持有的 stack 尾 ∪ 调用方近窗 ∪ 落地项本身)。band-pass 的 JS Set
    // 用它逐候选 O(1) 剔「已在场」—— 这是「不在上下文」的硬保证,量再大也只是 Set 查询。
    const structuralRefs = Array.from(new Set([landedRef, ...inContextRefs, ...callerContextRefs].filter(Boolean)));
    // SQL 候选池排除:上限保护(超大尾时只推最近的在场项进 SQL,其余靠上面的 JS Set 兜)。
    const recentInContext = inContextRefs.slice(-MAX_SQL_EXCLUDE_REFS);
    const sqlExclude = Array.from(new Set([landedRef, ...recentInContext, ...callerContextRefs].filter(Boolean)));

    const candidates = await persistence.listRecallCandidates({
      identityKey,
      queryVector,
      excludeSourceRefs: sqlExclude,
      limit
    });

    // ④ 语义式在场排除:近窗条目的向量(可选,persistence 提供才做)。调用方给了近窗用其近窗;
    // 没给(如入站钩子)退回保留尾最近 N 条,让入站召回也能抓「换说法的刚做过」。
    const semanticRefs = callerContextRefs.length
      ? callerContextRefs
      : inContextRefs.slice(-SEMANTIC_CONTEXT_WINDOW);
    let contextVectors = [];
    if (semanticRefs.length && typeof persistence.getRecallCueVectorsByRefs === 'function') {
      contextVectors = await persistence.getRecallCueVectorsByRefs(identityKey, semanticRefs);
    }

    // 去 anisotropy(mean+主成分)+ BM25 双路:取模型传入,有模型时用去 anisotropy 空间阈值。
    const model = await getDeanisModel();
    const meanVector = model ? model.mean : null;
    const components = model ? model.components : [];
    const bandParams = meanVector
      ? { floor: params.taskLocked ? CENTERED_TASK_FLOOR : CENTERED_FLOOR, ceiling: CENTERED_CEILING, standoutMargin: CENTERED_STANDOUT_MARGIN, nearDupSuppress: CENTERED_NEARDUP_SUPPRESS }
      : {};
    const result = bandpassRecall({
      query: { vector: queryVector, text, contextRefs: structuralRefs, contextVectors, meanVector, components, taskLocked: !!params.taskLocked },
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
