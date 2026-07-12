import fs from 'fs/promises';
import path from 'path';
import axios from 'axios';
import {
  buildRecallCuesFromActionStream,
  chunkRuntimeFile,
  getXiaoniActionStream,
  getExistingContentHashes,
  upsertRecallCues,
  pruneFileChunks,
  countRecallCues,
  parseOpenLoops,
  selectStaleOpenLoops,
  insertRecallShadowLog,
  listRecallShadowLog
} from '@qq-bot/persistence';

// 小腻被动浮现召回语料 reindex/ingest。扫动作流 + 文件底,只对内容变了的重嵌,写向量。
// 只在 admin-backend 跑,不进 agent-service / 小腻 loop。docs/XIAONI_PASSIVE_RECALL_SURFACING.md

const PROVIDER_SERVICE_URL = process.env.PROVIDER_SERVICE_URL || 'http://qqbot-provider-service:8090';
const RUNTIME_ROOT = process.env.XIAONI_RUNTIME_ROOT || '/home/liahua/.qqbot-local/xiaoni-runtime';
const CANONICAL_ROOT = '/xiaoni-runtime';
const FILE_DIRS = ['forever', 'notes', 'reading', 'toys'];
const EMBED_BATCH = 64;
const HASH_LOOKUP_BATCH = 1000;

// 被动召回【第二条腿】:开放承诺按时间重提(非语义)。docs/XIAONI_MEMORY_PALACE_GENERATION.md §11。
const OPEN_LOOPS_REL_PATH = 'notes/diary/open-loops.md';
const OPEN_LOOP_SCAN_QUERY_REF = 'open_loop_scan';
const OPEN_LOOP_STALE_DAYS = 2;      // 搁置≥2 天才算「该提」
const OPEN_LOOP_SURFACE_LIMIT = 3;   // 一次最多浮 3 条,别倒一堆
const OPEN_LOOP_DEDUP_LOOKBACK = 30; // 最近 30 条 open_loop 扫描里已浮过的,冷却跳过

interface RecallRecord {
  sourceKind: string;
  sourceRef: string;
  occurredAt: string | null;
  embeddingText: string;
  provenance: Record<string, unknown>;
  contentHash: string;
  embedding?: number[];
}

async function embedBatch(batch: string[]): Promise<number[][]> {
  const resp = await axios.post(
    `${PROVIDER_SERVICE_URL}/v1/embeddings`,
    { input: batch },
    { timeout: 120000 }
  );
  const data = resp.data?.data;
  if (!Array.isArray(data) || data.length !== batch.length) {
    throw new Error(`embedding response count mismatch (want ${batch.length}, got ${Array.isArray(data) ? data.length : 'n/a'})`);
  }
  return data.map((entry: { embedding?: number[] }) => (Array.isArray(entry?.embedding) ? entry.embedding : []));
}

// 逐批嵌入;整批失败(某条过长/异常触发上游 500)时,退回逐条重试,坏的给空向量跳过,
// 好的照存 —— 绝不因一条坏输入让整轮 reindex 归零(all-or-nothing 是真实事故:实测一批 500 → 0 写入)。
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = texts.slice(i, i + EMBED_BATCH);
    if (batch.length === 0) {
      continue;
    }
    try {
      out.push(...(await embedBatch(batch)));
    } catch {
      for (const text of batch) {
        try {
          const [vector] = await embedBatch([text]);
          out.push(Array.isArray(vector) ? vector : []);
        } catch {
          out.push([]); // 这条跳过(usable 过滤会丢掉空向量),不阻断其余。
        }
      }
    }
  }
  return out;
}

function canonicalOf(absolutePath: string): string {
  return `${CANONICAL_ROOT}${absolutePath.slice(RUNTIME_ROOT.length)}`.replace(/\/+/g, '/');
}

async function walkIndexableFiles(): Promise<string[]> {
  const found: string[] = [];
  async function visit(dir: string, depth: number): Promise<void> {
    if (depth > 8 || found.length > 5000) {
      return;
    }
    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) {
        continue;
      }
      const absolutePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath, depth + 1);
      } else if (entry.isFile() && /\.(md|txt)$/i.test(entry.name)) {
        found.push(absolutePath);
      }
    }
  }
  await Promise.all(FILE_DIRS.map((dir) => visit(path.join(RUNTIME_ROOT, dir), 1)));
  return found;
}

async function collectFileRecords(): Promise<{ records: RecallRecord[]; keepByPath: Map<string, string[]> }> {
  const files = await walkIndexableFiles();
  const records: RecallRecord[] = [];
  const keepByPath = new Map<string, string[]>();
  for (const absolutePath of files) {
    let content = '';
    try {
      content = await fs.readFile(absolutePath, 'utf8');
    } catch {
      continue;
    }
    const canonicalPath = canonicalOf(absolutePath);
    const chunks = chunkRuntimeFile({ path: canonicalPath, content }) as RecallRecord[];
    keepByPath.set(canonicalPath, chunks.map((chunk) => chunk.sourceRef));
    records.push(...chunks);
  }
  return { records, keepByPath };
}

async function collectActionStreamRecords(identityKey: string, limit: number): Promise<RecallRecord[]> {
  const stream = await getXiaoniActionStream({ identityKey, limit });
  const items = Array.isArray(stream?.items) ? stream.items : [];
  return buildRecallCuesFromActionStream(items) as RecallRecord[];
}

async function existingHashesBatched(identityKey: string, refs: string[]): Promise<Map<string, string>> {
  const merged = new Map<string, string>();
  for (let i = 0; i < refs.length; i += HASH_LOOKUP_BATCH) {
    const slice = refs.slice(i, i + HASH_LOOKUP_BATCH);
    const found: Map<string, string> = await getExistingContentHashes(identityKey, slice);
    for (const [key, value] of found) {
      merged.set(key, value);
    }
  }
  return merged;
}

export interface ReindexResult {
  scanned: number;
  changed: number;
  embedded: number;
  upserted: number;
  prunedPaths: number;
  counts: { total: number; byKind: Record<string, number> };
  openLoopScan?: OpenLoopScanResult;
}

export interface OpenLoopScanResult {
  totalOpen: number;
  surfaced: Array<{ text: string; openedTag: string | null; ageDays: number }>;
  shadowLogId: string | null;
}

// 第二条腿:读 open-loops.md → 挑搁置够久的开放承诺 → 只写 shadow_log(绝不投递)。
// 语义 band-pass 捞不到「情境相关但文本不相干」的承诺(§10);这里按时间/状态补。
// nowMs 由调用方传(避免时钟漂移进纯选择器)。文件不存在 = 还没有开放承诺,静默返回。
export async function scanOpenLoopsToShadow(
  opts: { identityKey?: string; nowMs?: number } = {}
): Promise<OpenLoopScanResult> {
  const identityKey = opts.identityKey || 'xiaoni';
  const nowMs = Number.isFinite(opts.nowMs) ? Number(opts.nowMs) : Date.now();
  const absPath = path.join(RUNTIME_ROOT, OPEN_LOOPS_REL_PATH);

  let content = '';
  try {
    content = await fs.readFile(absPath, 'utf8');
  } catch {
    return { totalOpen: 0, surfaced: [], shadowLogId: null };
  }

  const loops = parseOpenLoops(content);
  const totalOpen = loops.filter((loop) => !loop.done).length;

  // 去重:最近若干条 open_loop 扫描里已浮过的,冷却期内别重复提。
  const recentTexts: string[] = [];
  const recent = await listRecallShadowLog({ identityKey, limit: OPEN_LOOP_DEDUP_LOOKBACK });
  for (const row of recent) {
    if ((row as { query_ref?: string; queryRef?: string }).query_ref !== OPEN_LOOP_SCAN_QUERY_REF
      && (row as { queryRef?: string }).queryRef !== OPEN_LOOP_SCAN_QUERY_REF) continue;
    const surfaced = (row as { surfaced?: unknown }).surfaced;
    if (!Array.isArray(surfaced)) continue;
    for (const item of surfaced) {
      const text = item && typeof (item as { text?: unknown }).text === 'string'
        ? (item as { text: string }).text
        : null;
      if (text) recentTexts.push(text);
    }
  }

  const picked = selectStaleOpenLoops(loops, {
    nowMs,
    staleDays: OPEN_LOOP_STALE_DAYS,
    limit: OPEN_LOOP_SURFACE_LIMIT,
    recentlySurfaced: recentTexts
  });

  const surfaced = picked.map((p) => ({
    kind: 'open_loop',
    text: p.text,
    openedTag: p.openedTag,
    ageDays: Math.round(p.ageDays * 10) / 10,
    lead: `你之前记过一件还没了的事：${p.text}（放了 ${Math.floor(p.ageDays)} 天了）`
  }));

  const { id } = await insertRecallShadowLog({
    identityKey,
    occurredAt: new Date(nowMs),
    queryRef: OPEN_LOOP_SCAN_QUERY_REF,
    queryText: null,
    silent: surfaced.length === 0,
    corpusCount: totalOpen,
    topK: surfaced.length,
    surfaced
  });

  return {
    totalOpen,
    surfaced: picked.map((p) => ({ text: p.text, openedTag: p.openedTag, ageDays: p.ageDays })),
    shadowLogId: id
  };
}

export async function reindexXiaoniRecall(opts: { identityKey?: string; actionStreamLimit?: number } = {}): Promise<ReindexResult> {
  const identityKey = opts.identityKey || 'xiaoni';
  const [fileData, streamRecords] = await Promise.all([
    collectFileRecords(),
    collectActionStreamRecords(identityKey, opts.actionStreamLimit ?? 4000)
  ]);
  const all: RecallRecord[] = [...fileData.records, ...streamRecords];

  // 内容 hash 没变的跳过,只嵌新的/改的(即便本地嵌入免费,也别做无谓的活)。
  const existing = await existingHashesBatched(identityKey, all.map((record) => record.sourceRef));
  const changed = all.filter((record) => existing.get(record.sourceRef) !== record.contentHash);

  // 增量:逐块 embed→upsert,进度即时落库、坏块不拖垮全局(local CPU 嵌入器单槽慢,
  // 全部嵌完再写会让语料长时间为 0、且中途失败全丢)。
  const UPSERT_CHUNK = 64;
  let embedded = 0;
  let upserted = 0;
  for (let i = 0; i < changed.length; i += UPSERT_CHUNK) {
    const slice = changed.slice(i, i + UPSERT_CHUNK);
    const vectors = await embedTexts(slice.map((record) => record.embeddingText));
    slice.forEach((record, index) => {
      record.embedding = vectors[index];
    });
    const usable = slice.filter((record) => Array.isArray(record.embedding) && record.embedding.length > 0);
    const res = await upsertRecallCues(identityKey, usable);
    embedded += usable.length;
    upserted += res.upserted;
  }

  // 文件重扫后清掉不再存在的旧块(文件被删短)。
  let prunedPaths = 0;
  for (const [filePath, keep] of fileData.keepByPath) {
    await pruneFileChunks(identityKey, filePath, keep);
    prunedPaths += 1;
  }

  const counts = await countRecallCues(identityKey);

  // 第二条腿:开放承诺按时间重提(shadow-only)。搭这个已有的周期性重扫顺带跑;
  // 绝不能因它出错而拖垮语料 reindex → try/catch 吞掉。
  let openLoopScan: OpenLoopScanResult | undefined;
  try {
    openLoopScan = await scanOpenLoopsToShadow({ identityKey });
  } catch {
    openLoopScan = undefined;
  }

  return {
    scanned: all.length,
    changed: changed.length,
    embedded,
    upserted,
    prunedPaths,
    counts,
    openLoopScan
  };
}
