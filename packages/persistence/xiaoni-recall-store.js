'use strict';

// 小腻被动浮现召回语料存储(SQL 收口于此)。只被 admin-backend(shadow)读写。
// 向量 v1 存 Json float[],相似度在 band-pass 侧 JS 算(延迟无所谓,pgvector 是 scale 后续)。
// 详见 docs/XIAONI_PASSIVE_RECALL_SURFACING.md。

function toDateOrNull(value) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseRow(row) {
  return {
    id: typeof row.id === 'bigint' ? row.id.toString() : row.id,
    identityKey: row.identity_key,
    sourceKind: row.source_kind,
    sourceRef: row.source_ref,
    provenance: row.provenance && typeof row.provenance === 'object' ? row.provenance : {},
    occurredAt: row.occurred_at instanceof Date ? row.occurred_at.toISOString() : row.occurred_at || null,
    embeddingText: row.embedding_text,
    embedding: Array.isArray(row.embedding) ? row.embedding : [],
    contentHash: row.content_hash
  };
}

function createXiaoniRecallStorePersistence({ getPrismaClient }) {
  function getClient(config) {
    return getPrismaClient(config);
  }

  // 现有 sourceRef → contentHash,ingest 用来跳过内容没变的条目(省嵌入调用)。
  async function getExistingContentHashes(identityKey, sourceRefs = [], config = {}) {
    const prisma = getClient(config);
    if (!Array.isArray(sourceRefs) || sourceRefs.length === 0) {
      return new Map();
    }
    const rows = await prisma.xiaoniRecallCue.findMany({
      where: { identity_key: identityKey, source_ref: { in: sourceRefs } },
      select: { source_ref: true, content_hash: true }
    });
    return new Map(rows.map((row) => [row.source_ref, row.content_hash]));
  }

  // records: [{ sourceKind, sourceRef, occurredAt, embeddingText, embedding: number[], provenance, contentHash }]
  async function upsertRecallCues(identityKey, records = [], config = {}) {
    const prisma = getClient(config);
    let upserted = 0;
    for (const record of Array.isArray(records) ? records : []) {
      if (!record || !record.sourceRef || !record.embeddingText || !Array.isArray(record.embedding) || record.embedding.length === 0) {
        continue;
      }
      const common = {
        source_kind: record.sourceKind || 'action_stream',
        provenance: record.provenance && typeof record.provenance === 'object' ? record.provenance : {},
        occurred_at: toDateOrNull(record.occurredAt),
        embedding_text: record.embeddingText,
        embedding: record.embedding,
        content_hash: record.contentHash || ''
      };
      await prisma.xiaoniRecallCue.upsert({
        where: { identity_key_source_ref: { identity_key: identityKey, source_ref: record.sourceRef } },
        create: { identity_key: identityKey, source_ref: record.sourceRef, ...common },
        update: common
      });
      upserted += 1;
    }
    return { upserted };
  }

  // 召回候选池:pgvector 最近邻 top-K(排除近窗 sourceRef = 结构式在场排除的一半)。
  //
  // band-pass 要的是「相关但不在场」的中间带 —— 太远的下限剔本就不该 fetch,中间带都落在最近邻里,
  // 所以 top-K 最近邻天然包含要浮现的带子。这也治本地干掉了旧全量 findMany 的 napi 击穿
  // (76k 行 × 16KB Json embedding 一次序列化 >512MB → Failed to convert rust String into napi string)。
  // 返回的 top-K 仍带 embedding(几百行 ~5MB,不炸),band-pass 在 JS 侧照旧算 cos + ④ 语义在场排除。
  // 详见 docs/XIAONI_PASSIVE_RECALL_SHADOW_COMPLETION.md §3。
  async function listRecallCandidates(params = {}, config = {}) {
    const prisma = getClient(config);
    const identityKey = params.identityKey || 'xiaoni';
    const queryVector = Array.isArray(params.queryVector) ? params.queryVector : null;
    const excludeSourceRefs = Array.isArray(params.excludeSourceRefs) ? params.excludeSourceRefs : [];
    const k = Math.max(1, Math.min(Number(params.limit) || 300, 2000));
    if (!queryVector || queryVector.length === 0) {
      return []; // 无 query 向量无法最近邻检索(旧全量扫描已废弃)。
    }
    // 向量参数走文本 + ::vector 转型(数字数组,注入安全);排除表走 $n::text[] 参数化。
    const vecLiteral = `[${queryVector.map((x) => Number(x)).join(',')}]`;
    const sqlParams = [identityKey, vecLiteral, k];
    let where = 'identity_key = $1 AND embedding_vec IS NOT NULL';
    if (excludeSourceRefs.length) {
      sqlParams.push(excludeSourceRefs);
      where += ' AND source_ref <> ALL($4::text[])';
    }
    const sql =
      `SELECT id, identity_key, source_kind, source_ref, provenance, occurred_at, ` +
      `embedding_text, embedding, content_hash ` +
      `FROM xiaoni_recall_cues WHERE ${where} ` +
      `ORDER BY embedding_vec <=> $2::vector LIMIT $3`;
    // HNSW 默认 hnsw.ef_search=40 会把结果封顶在 ~40(不管 LIMIT),k=300 会静默截断成 ~40。
    // 每查询设 ef_search≥k(SET LOCAL 须在事务内;array 形 $transaction 保证同连接同事务)。
    const efSearch = Math.floor(Math.min(Math.max(k * 2, 100), 1000));
    const [, rows] = await prisma.$transaction([
      prisma.$executeRawUnsafe(`SET LOCAL hnsw.ef_search = ${efSearch}`),
      prisma.$queryRawUnsafe(sql, ...sqlParams)
    ]);
    return rows.map(parseRow);
  }

  // ④ 语义式在场排除用:取一组 sourceRef 的向量(近窗条目)。只回 embedding,量小(近窗几条)。
  async function getRecallCueVectorsByRefs(identityKey, sourceRefs = [], config = {}) {
    const prisma = getClient(config);
    const refs = Array.isArray(sourceRefs) ? sourceRefs.filter(Boolean) : [];
    if (refs.length === 0) {
      return [];
    }
    const rows = await prisma.$queryRawUnsafe(
      `SELECT embedding FROM xiaoni_recall_cues WHERE identity_key = $1 AND source_ref = ANY($2::text[])`,
      identityKey,
      refs
    );
    return rows
      .map((row) => (Array.isArray(row.embedding) ? row.embedding : null))
      .filter((v) => Array.isArray(v) && v.length > 0);
  }

  async function getRecallCueByRef(identityKey, sourceRef, config = {}) {
    const prisma = getClient(config);
    const row = await prisma.xiaoniRecallCue.findUnique({
      where: { identity_key_source_ref: { identity_key: identityKey, source_ref: sourceRef } }
    });
    return row ? parseRow(row) : null;
  }

  async function countRecallCues(identityKey, config = {}) {
    const prisma = getClient(config);
    const grouped = await prisma.xiaoniRecallCue.groupBy({
      by: ['source_kind'],
      where: { identity_key: identityKey },
      _count: true
    });
    const byKind = {};
    let total = 0;
    for (const group of grouped) {
      byKind[group.source_kind] = group._count;
      total += group._count;
    }
    return { total, byKind };
  }

  // 文件重扫后,该文件下不再存在的旧 chunk(如文件被删短)清掉,避免僵尸块。
  async function pruneFileChunks(identityKey, path, keepSourceRefs = [], config = {}) {
    const prisma = getClient(config);
    const result = await prisma.xiaoniRecallCue.deleteMany({
      where: {
        identity_key: identityKey,
        source_kind: 'file_chunk',
        source_ref: { startsWith: `${path}#`, ...(keepSourceRefs.length ? { notIn: keepSourceRefs } : {}) }
      }
    });
    return { deleted: result.count };
  }

  // ── 触发2 shadow 留痕(只记录 + 管理端展示,绝不投递)──────────────────────
  // raw SQL(和向量查询一致);Json 列走 ::jsonb 参数化。
  async function insertRecallShadowLog(record = {}, config = {}) {
    const prisma = getClient(config);
    const identityKey = record.identityKey || 'xiaoni';
    const occurredAt = toDateOrNull(record.occurredAt) || new Date(0); // 落地时刻由调用方给;缺则纪元占位(不注入时钟漂移)
    const params = [
      identityKey,
      occurredAt,
      record.queryRef || null,
      typeof record.queryText === 'string' ? record.queryText.slice(0, 2000) : null,
      !!record.taskLocked,
      typeof record.bandFloor === 'number' ? record.bandFloor : null,
      typeof record.bandCeiling === 'number' ? record.bandCeiling : null,
      record.silent !== false,
      Number.isFinite(record.corpusCount) ? record.corpusCount : 0,
      Number.isFinite(record.topK) ? record.topK : 0,
      JSON.stringify(Array.isArray(record.surfaced) ? record.surfaced : []),
      JSON.stringify(record.droppedCounts && typeof record.droppedCounts === 'object' ? record.droppedCounts : {}),
      JSON.stringify(Array.isArray(record.droppedSample) ? record.droppedSample : [])
    ];
    const rows = await prisma.$queryRawUnsafe(
      `INSERT INTO xiaoni_recall_shadow_log
         (identity_key, occurred_at, query_ref, query_text, task_locked, band_floor, band_ceiling,
          silent, corpus_count, top_k, surfaced, dropped_counts, dropped_sample)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb)
       RETURNING id`,
      ...params
    );
    const id = rows && rows[0] ? rows[0].id : null;
    return { id: typeof id === 'bigint' ? id.toString() : id };
  }

  async function listRecallShadowLog(params = {}, config = {}) {
    const prisma = getClient(config);
    const identityKey = params.identityKey || 'xiaoni';
    const limit = Math.max(1, Math.min(Number(params.limit) || 50, 500));
    const onlySurfaced = params.onlySurfaced === true; // 只看冒了东西的(过滤掉海量静默)
    const rows = await prisma.$queryRawUnsafe(
      `SELECT id, identity_key, occurred_at, query_ref, query_text, task_locked, band_floor, band_ceiling,
              silent, corpus_count, top_k, surfaced, dropped_counts, dropped_sample
       FROM xiaoni_recall_shadow_log
       WHERE identity_key = $1${onlySurfaced ? ' AND silent = false' : ''}
       ORDER BY occurred_at DESC, id DESC
       LIMIT $2`,
      identityKey,
      limit
    );
    return rows.map((row) => ({
      id: typeof row.id === 'bigint' ? row.id.toString() : row.id,
      identityKey: row.identity_key,
      occurredAt: row.occurred_at instanceof Date ? row.occurred_at.toISOString() : row.occurred_at,
      queryRef: row.query_ref,
      queryText: row.query_text,
      taskLocked: row.task_locked,
      bandFloor: row.band_floor,
      bandCeiling: row.band_ceiling,
      silent: row.silent,
      corpusCount: row.corpus_count,
      topK: row.top_k,
      surfaced: Array.isArray(row.surfaced) ? row.surfaced : [],
      droppedCounts: row.dropped_counts && typeof row.dropped_counts === 'object' ? row.dropped_counts : {},
      droppedSample: Array.isArray(row.dropped_sample) ? row.dropped_sample : []
    }));
  }

  return {
    getExistingContentHashes,
    upsertRecallCues,
    listRecallCandidates,
    getRecallCueByRef,
    getRecallCueVectorsByRefs,
    countRecallCues,
    pruneFileChunks,
    insertRecallShadowLog,
    listRecallShadowLog
  };
}

module.exports = {
  createXiaoniRecallStorePersistence,
  parseRow
};
