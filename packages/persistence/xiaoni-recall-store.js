'use strict';

// 小腻被动浮现召回语料存储(SQL 收口于此)。只被 admin-backend(shadow)读写。
// 向量 v1 存 Json float[],相似度在 band-pass 侧 JS 算(延迟无所谓,pgvector 是 scale 后续)。
// 详见 docs/XIAONI_PASSIVE_RECALL_SURFACING.md。

// 召回桶(recall scope):陈旧语料「不删,只不进召回」。收窄前的宽索引存量(reading/ 读过的
// 小说、旧 notes/、forever/writing、toys/ 等)仍留在 xiaoni_recall_cues 表里,但不参与召回——
// 否则「你在 …/ch44.txt 里记过」这类把读物冒充成亲历的假记忆会浮上来。
// 桶 = 实时对话(inbound/action_stream) ∪ 宫殿 allowlist 文件(diary 目录 + identity-anchor)。
// 这份 allowlist 与 reindex 侧的 listPalaceFiles(PALACE_FILES/PALACE_DIRS)一致;两处都改才算改范围。
// 纯静态字面量(无用户输入),直接拼进 raw SQL 注入安全。候选池、去 anisotropy 的 μ/主成分——
// 每一处读语料底的路径都必须套同一 scope,否则 μ 仍被 47k 读物向量污染,fence 只做一半。
// 动作流侧再加一道「她自己不是别人」的闸(2026-08-07 真库诊断):
// 动作流投影的 peerName 会回退到 session_key='xiaoni',于是她自己的 plan post / 工具调用
// 全带 peer='xiaoni' 且 cueClass='db_life_cue' → 落进**他人域**。真库计数:他人域池子里
// 自噪音 9826 条 vs 真人 347 条,近 7 天 shadow 的 peer_message 有 80% 是「xiaoni 提过：
// ``` /app/modules/…/xiaoni-plan post <<'PLAN'…」——她被告知自己说过自己的 plan,
// 同时真正的 Nova/阿花/帕秋莉被挤出 top-K。
// 她自己的经历有更好的载体(日记 file_chunk + 她自己说过的话 db_spoken_fragment),
// 原始动作流是**转瞬的行为轨迹**,不是记忆 → 只有带**真** peer 的动作流条目才进召回。
// 存量行(peer='xiaoni')和新行(extractor 已把 self peer 写成 null)两种形状都被这条挡住。
// db_spoken_fragment 例外放行:那一类的语义就是「她自己说的」,peer 是不是她无关紧要。
const SELF_PEER_NAMES_SQL = "('xiaoni','小腻')";
const ACTION_STREAM_SCOPE_SQL =
  "(source_kind = 'action_stream' AND (" +
  "provenance->>'cueClass' = 'db_spoken_fragment' " +
  `OR (provenance->>'peer' IS NOT NULL AND lower(provenance->>'peer') NOT IN ${SELF_PEER_NAMES_SQL})))`;
// 文件底 allowlist 与 reindex 侧 listPalaceFiles(PALACE_FILES/PALACE_DIRS)逐条对应。
const RECALL_SCOPE_SQL =
  "(source_kind = 'inbound' " +
  `OR ${ACTION_STREAM_SCOPE_SQL} ` +
  "OR (source_kind = 'file_chunk' AND (" +
  "source_ref LIKE '%/notes/diary/%' " +
  "OR source_ref LIKE '%/notes/people/%' " +
  "OR source_ref LIKE '%/notes/topics/%' " +
  "OR source_ref LIKE '%/notes/long-term.md%' " +
  "OR source_ref LIKE '%xiaoni-identity-anchor%')))";

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
    // 向量参数走文本 + ::vector 转型(数字数组,注入安全);排除表/域过滤走 $n::text[] 参数化。
    const vecLiteral = `[${queryVector.map((x) => Number(x)).join(',')}]`;
    const sqlParams = [identityKey, vecLiteral, k];
    let where = `identity_key = $1 AND embedding_vec IS NOT NULL AND ${RECALL_SCOPE_SQL}`;
    if (excludeSourceRefs.length) {
      sqlParams.push(excludeSourceRefs);
      where += ` AND source_ref <> ALL($${sqlParams.length}::text[])`;
    }
    // 分域检索(海马体分域):跨音域 cos 不可比,单池 top-K 会让日记在 SQL 层就输光。
    // 调用方按 cueClass 域各查一次(each top-K),候选池天然两域各有代表。
    // includeNullCueClass:与 recallDomainOf 的 JS 语义对齐(cueClass 缺失 → 他人域)——
    // 他人域查询带上它,legacy/无类行不至于从两域间静默漏掉。
    const cueClasses = Array.isArray(params.cueClasses) ? params.cueClasses.filter(Boolean) : [];
    if (cueClasses.length) {
      sqlParams.push(cueClasses);
      const anyClause = `provenance->>'cueClass' = ANY($${sqlParams.length}::text[])`;
      where += params.includeNullCueClass
        ? ` AND (${anyClause} OR provenance->>'cueClass' IS NULL)`
        : ` AND ${anyClause}`;
    }
    const sql =
      `SELECT id, identity_key, source_kind, source_ref, provenance, occurred_at, ` +
      `embedding_text, embedding, content_hash ` +
      `FROM xiaoni_recall_cues WHERE ${where} ` +
      `ORDER BY embedding_vec <=> $2::vector LIMIT $3`;
    // HNSW 默认 hnsw.ef_search=40 会把结果封顶在 ~40(不管 LIMIT),k=300 会静默截断成 ~40。
    // 每查询设 ef_search≥k(SET LOCAL 须在事务内;array 形 $transaction 保证同连接同事务)。
    // 1000 是 **pgvector 对 hnsw.ef_search 的硬上限**,不是随便定的数:
    // 设成更大的值会让 `SET LOCAL hnsw.ef_search` 直接报 22023,整条取候选查询失败 ——
    // 而这条路径是 fire-and-forget,异常被吞掉,线上表现为召回静默死掉且无任何迹象。
    // (2026-08-20 亲手踩过:为了配合 k=1500 把封顶抬到 4000,回归集replay 全静默才发现。)
    // 因此 k 有效上限也就是 1000/域 —— 再大 HNSW 也只会返约 ef_search 条。
    const efSearch = Math.floor(Math.min(Math.max(k * 2, 100), 1000));
    const setup = [prisma.$executeRawUnsafe(`SET LOCAL hnsw.ef_search = ${efSearch}`)];
    if (cueClasses.length) {
      // 分域查询靠 partial HNSW 索引(migrations-manual/2026-07-24-recall-domain-partial-hnsw.sql)。
      // partial 索引匹配要求 planner 在 plan 时证明谓词蕴含——generic plan 里 $n::text[] 是未知量,
      // 证明不了 → 退回 seq scan(实测 236ms 扫全表)。强制 custom plan 让 ANY 以字面量参与规划。
      setup.push(prisma.$executeRawUnsafe(`SET LOCAL plan_cache_mode = force_custom_plan`));
      // RECALL_SCOPE_SQL 是索引谓词之外的后置过滤(self partial 索引含全部 file_provenance 行,
      // scope 只留 diary/anchor)——普通 HNSW 扫描后置滤掉大半会返不满 k。iterative_scan
      // (pgvector≥0.8)让索引继续迭代直到凑够 LIMIT,治后置过滤饥饿。
      setup.push(prisma.$executeRawUnsafe(`SET LOCAL hnsw.iterative_scan = relaxed_order`));
    }
    const results = await prisma.$transaction([...setup, prisma.$queryRawUnsafe(sql, ...sqlParams)]);
    const rows = results[results.length - 1];
    return rows.map(parseRow);
  }

  // 去各向异性(anisotropy)用:全库均值向量 μ。band-pass 减 μ 再算 cos,压掉"跟谁都像"的枢纽。
  // 真库实测:枢纽对随机 cue 平均 cos 0.784 → 去 μ 后 -0.044;不相关两两 0.826 → 0.039。
  async function getRecallCorpusMeanVector(identityKey, config = {}) {
    const prisma = getClient(config);
    const rows = await prisma.$queryRawUnsafe(
      `SELECT avg(embedding_vec)::text AS mean FROM xiaoni_recall_cues
       WHERE identity_key = $1 AND embedding_vec IS NOT NULL AND ${RECALL_SCOPE_SQL}`,
      identityKey
    );
    const meanText = rows && rows[0] ? rows[0].mean : null;
    if (!meanText || typeof meanText !== 'string') {
      return null;
    }
    try {
      const arr = JSON.parse(meanText); // pgvector avg()::text = "[...]"(合法 JSON 数组)
      return Array.isArray(arr) && arr.length ? arr : null;
    } catch {
      return null;
    }
  }

  // 去 anisotropy 升级版:mean + top-k 主成分(All-but-the-Top)。去均值压不死的残留泛枢纽,
  // 靠减掉前几个主成分方向再削。PC 用幂迭代在样本上算(确定性初值,可复现),缓存在调用方。
  function computeTopPCs(vectors, mean, numComponents) {
    const dim = mean.length;
    if (!vectors.length || numComponents <= 0) {
      return [];
    }
    const dot = (a, b) => { let s = 0; for (let i = 0; i < dim; i += 1) s += a[i] * b[i]; return s; };
    const norm = (v) => { const n = Math.sqrt(dot(v, v)) || 1; return v.map((x) => x / n); };
    // 中心化副本(会被逐个主成分 deflate)
    const residual = vectors.map((v) => { const c = new Array(dim); for (let i = 0; i < dim; i += 1) c[i] = v[i] - mean[i]; return c; });
    const comps = [];
    for (let c = 0; c < numComponents; c += 1) {
      // 确定性初值:残差里第一条(避免 Math.random,可复现)
      let v = norm(residual[0].slice());
      for (let it = 0; it < 25; it += 1) {
        const w = new Array(dim).fill(0);
        for (const x of residual) {
          const d = dot(x, v);
          for (let i = 0; i < dim; i += 1) w[i] += d * x[i];
        }
        v = norm(w);
      }
      comps.push(v);
      // deflate:residual -= (x·v) v
      for (const x of residual) {
        const d = dot(x, v);
        for (let i = 0; i < dim; i += 1) x[i] -= d * v[i];
      }
    }
    return comps;
  }

  // 返回 { mean: number[], components: number[][] };取不到返回 null(band-pass 退回 raw)。
  async function getRecallDeanisotropyModel(identityKey, params = {}, config = {}) {
    const prisma = getClient(config);
    const sampleSize = Math.max(500, Math.min(Number(params.sampleSize) || 4000, 20000));
    const numComponents = Math.max(0, Math.min(Number.isFinite(Number(params.numComponents)) ? Number(params.numComponents) : 4, 16));
    const meanRows = await prisma.$queryRawUnsafe(
      `SELECT avg(embedding_vec)::text AS mean FROM xiaoni_recall_cues WHERE identity_key = $1 AND embedding_vec IS NOT NULL AND ${RECALL_SCOPE_SQL}`,
      identityKey
    );
    let mean = null;
    try {
      const m = JSON.parse((meanRows && meanRows[0] && meanRows[0].mean) || 'null');
      if (Array.isArray(m) && m.length) mean = m;
    } catch { mean = null; }
    if (!mean) {
      return null;
    }
    if (numComponents === 0) {
      return { mean, components: [] };
    }
    const rows = await prisma.$queryRawUnsafe(
      `SELECT embedding FROM xiaoni_recall_cues WHERE identity_key = $1 AND embedding_vec IS NOT NULL AND ${RECALL_SCOPE_SQL} ORDER BY id DESC LIMIT $2`,
      identityKey,
      sampleSize
    );
    const vectors = rows
      .map((r) => (Array.isArray(r.embedding) ? r.embedding : null))
      .filter((v) => Array.isArray(v) && v.length === mean.length);
    return { mean, components: computeTopPCs(vectors, mean, numComponents) };
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

  // queryRef 可选:按「腿」过滤(第二腿 open_loop_scan / 第三腿 diary_resurface / 语义腿的落地 ref)。
  //
  // 必须下推到 SQL,不能在 JS 里过滤取回的窗口。这张表 ~97% 的行是语义腿每次落地写的
  // stack:*/inbound:* 留痕,所以「最近 N 条本腿扫描」如果先取全表最近 N 行再筛,窗口里平均
  // 只剩 2.5 条本腿行、43% 的扫描一条都没有 → 时间腿的重复冷却形同失效
  // (真库实测:最近 40 行里 diary_resurface = 0 条,冷却完全没生效)。
  // 配套索引 (identity_key, query_ref, occurred_at DESC):
  //   prisma/migrations-manual/2026-07-28-recall-shadow-log-query-ref-index.sql
  // 不传 = 老行为(全腿混排最近 N 条),管理端流水面就靠这个。
  async function listRecallShadowLog(params = {}, config = {}) {
    const prisma = getClient(config);
    const identityKey = params.identityKey || 'xiaoni';
    const limit = Math.max(1, Math.min(Number(params.limit) || 50, 500));
    const onlySurfaced = params.onlySurfaced === true; // 只看冒了东西的(过滤掉海量静默)
    const queryRef = typeof params.queryRef === 'string' && params.queryRef.trim()
      ? params.queryRef.trim()
      : null;
    const sqlParams = [identityKey];
    let where = 'identity_key = $1';
    if (queryRef) {
      sqlParams.push(queryRef);
      where += ` AND query_ref = $${sqlParams.length}`;
    }
    if (onlySurfaced) {
      where += ' AND silent = false';
    }
    sqlParams.push(limit);
    const rows = await prisma.$queryRawUnsafe(
      `SELECT id, identity_key, occurred_at, query_ref, query_text, task_locked, band_floor, band_ceiling,
              silent, corpus_count, top_k, surfaced, dropped_counts, dropped_sample
       FROM xiaoni_recall_shadow_log
       WHERE ${where}
       ORDER BY occurred_at DESC, id DESC
       LIMIT $${sqlParams.length}`,
      ...sqlParams
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

  // 向量腿的 per-cue 冷却面:窗口内已经浮过的 sourceRef 集合。
  //
  // 第二/三/四腿(open_loop / diary_resurface / association)各自带冷却,唯独向量腿没有,
  // 于是同一块砖被无限重浮。2026-08-07 真库(近 7 天 surfaced):
  //   db_file_provenance 648 次只有 10 个不同 ref(1.5%),单个 relay-0708-busstop.md 就 446 次;
  //   file_chunk 4226 次 949 个 chunk(22.5%)。
  // 那几条腿的冷却是「读最近 N 条自己 queryRef 的 shadow 行」;向量腿的 queryRef 是每次落地
  // 变化的 stack:<id>,推不下去,所以按时间窗聚合。EXPLAIN ANALYZE 实测 3 天窗 ≈ 11ms,
  // 且调用方带 TTL 缓存 —— 不给 fire-and-forget 路径添负担。
  async function listRecentlySurfacedRecallRefs(params = {}, config = {}) {
    const prisma = getClient(config);
    const identityKey = params.identityKey || 'xiaoni';
    const windowHours = Math.max(1, Math.min(Number(params.windowHours) || 72, 24 * 30));
    const rows = await prisma.$queryRawUnsafe(
      `SELECT DISTINCT s->>'sourceRef' AS ref
       FROM xiaoni_recall_shadow_log l, jsonb_array_elements(l.surfaced) s
       WHERE l.identity_key = $1
         AND l.silent = false
         AND l.occurred_at > now() - ($2 || ' hours')::interval
         AND s->>'sourceRef' IS NOT NULL`,
      identityKey,
      String(windowHours)
    );
    return rows.map((row) => row.ref).filter(Boolean);
  }

  // 某条腿的「每个 ref 到今天为止浮过几次」。覆盖优先排序的数据面。
  //
  // 为什么要全历史而不是最近 N 行:第三腿(diary_resurface)的冷却是「最近 40 行里翻过的跳过」,
  // 40 行 ≈ 20 小时,而候选有 1899 条 —— 冷却一过它又挑回最老的那一撮。真库实测(2026-08-19)
  // 全历史 3350 次浮现只覆盖 90 个不同条目(4.7%),每条平均重复 37 次。要治这个,排序必须看
  // 「这条被翻过几次」,而那是个跨全历史的量,短窗口看不见。
  //
  // 一次 GROUP BY,按 (identity_key, query_ref) 走既有索引;调用方每 30 分钟一轮,不在热路径。
  async function countRecallSurfacedRefs(params = {}, config = {}) {
    const prisma = getClient(config);
    const identityKey = params.identityKey || 'xiaoni';
    const queryRef = typeof params.queryRef === 'string' ? params.queryRef : null;
    if (!queryRef) {
      return new Map();
    }
    const rows = await prisma.$queryRawUnsafe(
      `SELECT s->>'ref' AS ref, count(*)::int AS n
       FROM xiaoni_recall_shadow_log l, jsonb_array_elements(l.surfaced) s
       WHERE l.identity_key = $1 AND l.query_ref = $2 AND s->>'ref' IS NOT NULL
       GROUP BY 1`,
      identityKey,
      queryRef
    );
    return new Map(rows.map((row) => [row.ref, Number(row.n) || 0]));
  }

  // inbound 砖在场硬检查的数据面:批量读消息的已读态。返回 [{id, isRead, readAt}](readAt ISO|null)。
  // 规则本身(已读且在遗忘线前读的才算记忆)是纯函数,在 xiaoni-recall-bandpass.js。
  async function getInboundReadStates(ids, config = {}) {
    const prisma = getClient(config);
    const numericIds = (Array.isArray(ids) ? ids : [])
      .map((v) => Number(v))
      .filter((v) => Number.isFinite(v) && v > 0);
    if (numericIds.length === 0) {
      return [];
    }
    const rows = await prisma.$queryRawUnsafe(
      'SELECT id, is_read, read_at FROM agent_inbound_messages WHERE id = ANY($1::bigint[])',
      numericIds
    );
    return (Array.isArray(rows) ? rows : []).map((row) => ({
      id: Number(row.id),
      // is_read 是 Int 语义列:>0 即已读(别钉死 ===1,将来出现 2 之类的值不至于误判成未读丢砖)。
      isRead: row.is_read === true || Number(row.is_read) > 0,
      readAt: row.read_at ? new Date(row.read_at).toISOString() : null
    }));
  }

  return {
    getExistingContentHashes,
    upsertRecallCues,
    listRecallCandidates,
    getInboundReadStates,
    getRecallCueByRef,
    getRecallCueVectorsByRefs,
    getRecallCorpusMeanVector,
    getRecallDeanisotropyModel,
    countRecallCues,
    pruneFileChunks,
    insertRecallShadowLog,
    listRecallShadowLog,
    listRecentlySurfacedRecallRefs,
    countRecallSurfacedRefs
  };
}

module.exports = {
  createXiaoniRecallStorePersistence,
  parseRow
};
