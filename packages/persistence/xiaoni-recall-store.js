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

  // 召回候选池:该 identity 的全部 cue(排除当前上下文近窗的 sourceRef = 结构式在场排除的一半)。
  async function listRecallCandidates(params = {}, config = {}) {
    const prisma = getClient(config);
    const identityKey = params.identityKey || 'xiaoni';
    const excludeSourceRefs = Array.isArray(params.excludeSourceRefs) ? params.excludeSourceRefs : [];
    const limit = Math.max(1, Math.min(Number(params.limit) || 5000, 50000));
    const rows = await prisma.xiaoniRecallCue.findMany({
      where: {
        identity_key: identityKey,
        ...(excludeSourceRefs.length ? { source_ref: { notIn: excludeSourceRefs } } : {})
      },
      // band-pass 要扫整个语料(相关性不是时近性),按稳定 id 排(occurred_at 对 file_chunk 恒 null,
      // 会把文件记忆全排到截断边缘)。截断由 take 上限兜,调用方应传满并看 truncated。
      orderBy: { id: 'desc' },
      take: limit
    });
    return rows.map(parseRow);
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

  return {
    getExistingContentHashes,
    upsertRecallCues,
    listRecallCandidates,
    getRecallCueByRef,
    countRecallCues,
    pruneFileChunks
  };
}

module.exports = {
  createXiaoniRecallStorePersistence,
  parseRow
};
