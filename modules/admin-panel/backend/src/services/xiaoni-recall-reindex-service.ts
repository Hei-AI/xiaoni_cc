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
  parseDiaryDateFromName,
  parseDiaryEvents,
  selectResurfacedEvents,
  insertRecallShadowLog,
  listRecallShadowLog
} from '@qq-bot/persistence';

// 小腻被动浮现召回语料 reindex/ingest。扫动作流 + 文件底,只对内容变了的重嵌,写向量。
// 只在 admin-backend 跑,不进 agent-service / 小腻 loop。docs/XIAONI_PASSIVE_RECALL_SURFACING.md

const PROVIDER_SERVICE_URL = process.env.PROVIDER_SERVICE_URL || 'http://qqbot-provider-service:8090';
const RUNTIME_ROOT = process.env.XIAONI_RUNTIME_ROOT || '/home/liahua/.qqbot-local/xiaoni-runtime';
const CANONICAL_ROOT = '/xiaoni-runtime';
const EMBED_BATCH = 64;
const HASH_LOOKUP_BATCH = 1000;

// 前瞻索引闸(§7.1):被动浮现语料的文件底只索引「记忆宫殿」—— 她刻意维护的那几份,
// 不是整个文件系统。路径定义与 modules/agent-service/skills/xiaoni-memory-anchor/SKILL.md
// 逐字对齐(读端 cat 什么、写端嵌什么必须同一套)。旧的 ['forever','notes','reading','toys']
// 把 reading(读过的原文)/toys/死归档整盘子都嵌了 —— 85% 语料污染的根就在这。
// 这是「往后只加宫殿」的前瞻闸:存量污染 cue 不在这里回溯删(小腻按指定方式自迁清理)。
// 注意:动作流那条腿(collectActionStreamRecords)是行为事实,不受此闸影响。
// docs/XIAONI_MEMORY_PALACE_GENERATION.md §7.1
const PALACE_FILES = ['notes/xiaoni-identity-anchor.md']; // 宫殿地图(身份索引)
const PALACE_DIRS = ['notes/diary'];                      // 日记(情节记忆,被动浮现主力)
// 日记目录里这两份【不进】被动嵌入:
//  - dictionary.md 是关键词→哪天的查找索引,密集 bullet 整块糊成一个泛化向量,
//    只供主动 cat 翻查,嵌进被动召回反而污染;
//  - open-loops.md 由第二条腿(scanOpenLoopsToShadow)按时间/状态扫,嵌 checkbox 行是噪音。
const PALACE_DIR_EXCLUDE = new Set(['dictionary.md', 'open-loops.md']);

// 被动召回【第二条腿】:开放承诺按时间重提(非语义)。docs/XIAONI_MEMORY_PALACE_GENERATION.md §11。
const OPEN_LOOPS_REL_PATH = 'notes/diary/open-loops.md';
const OPEN_LOOP_SCAN_QUERY_REF = 'open_loop_scan';
const OPEN_LOOP_STALE_DAYS = 2;       // 搁置≥2 天才算「该提」
const OPEN_LOOP_MAX_ACTIVE_DAYS = 30; // 超过 30 天归 overdue 降权,防老死承诺霸榜饿死中龄的
const OPEN_LOOP_SURFACE_LIMIT = 3;    // 一次最多浮 3 条,别倒一堆
const OPEN_LOOP_DEDUP_LOOKBACK = 30;  // 最近 30 条 open_loop 扫描里已浮过的,冷却跳过

// 被动召回【第三条腿】:纯情节往事按时间重提(非语义,非承诺)。§10 纯事件盲区根治。
const DIARY_DIR_REL_PATH = 'notes/diary';   // 日记目录(扁平一层)
const DIARY_RESURFACE_QUERY_REF = 'diary_resurface';
const DIARY_MIN_AGE_DAYS = 7;               // 搁≥7 天(她大概忘了)才值得翻出来
const DIARY_SURFACE_LIMIT = 2;              // 一次最多翻 2 件旧事
const DIARY_DEDUP_LOOKBACK = 40;            // 最近 40 条 diary_resurface 里翻过的,冷却跳过
const DIARY_NON_EVENT_FILES = new Set(['dictionary.md', 'open-loops.md']); // 不是往事日记,不扫

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

// 前瞻闸:只收宫殿文件(单文件 allowlist + 日记目录扁平一层),不再递归整个文件系统。
// 缺文件 = 还没建/还没迁,静默跳过(不报错、不阻断动作流那条腿)。
// runtimeRoot 参数化并导出,让「实际索引什么」和「管理端预览候选什么」共用同一份宫殿定义
// (单一真理源),不再两处各留一份 divergent 的 FILE_DIRS。
export async function listPalaceFiles(runtimeRoot: string): Promise<string[]> {
  const found: string[] = [];

  // 1) 宫殿显式单文件(identity-anchor 等)。
  for (const rel of PALACE_FILES) {
    const absolutePath = path.join(runtimeRoot, rel);
    try {
      const stat = await fs.stat(absolutePath);
      if (stat.isFile()) {
        found.push(absolutePath);
      }
    } catch {
      // 还没建,跳过。
    }
  }

  // 2) 宫殿目录(日记):扁平一层,只取 .md/.txt,排除字典/open-loops(见上注释)。
  //    日记结构是 notes/diary/YYYY-MM-DD.md 一层平铺,不递归子目录避免误收归档。
  for (const rel of PALACE_DIRS) {
    const dir = path.join(runtimeRoot, rel);
    let entries: Array<{ name: string; isFile: () => boolean }>;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      if (entry.name.startsWith('.') || PALACE_DIR_EXCLUDE.has(entry.name)) {
        continue;
      }
      if (!/\.(md|txt)$/i.test(entry.name)) {
        continue;
      }
      found.push(path.join(dir, entry.name));
    }
  }

  return found;
}

async function walkIndexableFiles(): Promise<string[]> {
  return listPalaceFiles(RUNTIME_ROOT);
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
  diaryResurfaceScan?: DiaryResurfaceScanResult;
}

export interface OpenLoopScanResult {
  totalOpen: number;
  surfaced: Array<{ text: string; openedTag: string | null; ageDays: number | null; tier: string }>;
  shadowLogId: string | null;
}

export interface DiaryResurfaceScanResult {
  totalEvents: number;
  surfaced: Array<{ title: string; ageDays: number; ref: string }>;
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
    maxActiveDays: OPEN_LOOP_MAX_ACTIVE_DAYS,
    limit: OPEN_LOOP_SURFACE_LIMIT,
    recentlySurfaced: recentTexts
  });

  // lead 按 tier 分档:无日期不谎报天数,overdue 点破「放了挺久」,active 给天数。
  const leadFor = (p: { text: string; ageDays: number | null; tier: string }): string => {
    if (p.ageDays == null) {
      return `你之前记过一件还没了的事，但没写日期：${p.text}（不确定放多久了，还算数吗？）`;
    }
    const days = Math.floor(p.ageDays);
    if (p.tier === 'overdue') {
      return `你之前记过一件还没了的事，放了挺久了：${p.text}（${days} 天了，还做吗？做不了就划掉）`;
    }
    return `你之前记过一件还没了的事：${p.text}（放了 ${days} 天了）`;
  };
  const surfaced = picked.map((p) => ({
    kind: 'open_loop',
    text: p.text,
    openedTag: p.openedTag,
    ageDays: p.ageDays == null ? null : Math.round(p.ageDays * 10) / 10,
    tier: p.tier,
    lead: leadFor(p)
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
    surfaced: picked.map((p) => ({ text: p.text, openedTag: p.openedTag, ageDays: p.ageDays, tier: p.tier })),
    shadowLogId: id
  };
}

// 第三条腿:遍历日记文件 → 每个 `## 小标题` 是一件往事(日期=文件名)→ 挑搁得够久、
// 最近没翻过的几件 → 只写 shadow_log(绝不投递)。补 §10 的「纯情节事件」盲区:语义腿
// (cos<floor)与第二腿(只扫承诺)之间漏掉的普通往事,这里按时间翻出来。
// nowMs 由调用方传。目录不存在/日记还没写 = 静默返回空。
export async function scanDiaryEventsToShadow(
  opts: { identityKey?: string; nowMs?: number } = {}
): Promise<DiaryResurfaceScanResult> {
  const identityKey = opts.identityKey || 'xiaoni';
  const nowMs = Number.isFinite(opts.nowMs) ? Number(opts.nowMs) : Date.now();
  const diaryDir = path.join(RUNTIME_ROOT, DIARY_DIR_REL_PATH);

  let entries: Array<{ name: string; isFile: () => boolean }>;
  try {
    entries = await fs.readdir(diaryDir, { withFileTypes: true });
  } catch {
    return { totalEvents: 0, surfaced: [], shadowLogId: null };
  }

  // 收集所有往事,ref = canonical path#index(稳定,供去重)。
  const events: Array<{ title: string; body: string; dateMs: number; index: number; ref: string }> = [];
  for (const entry of entries) {
    if (!entry.isFile() || entry.name.startsWith('.') || DIARY_NON_EVENT_FILES.has(entry.name)) {
      continue;
    }
    if (!/\.(md|txt)$/i.test(entry.name)) {
      continue;
    }
    const dateMs = parseDiaryDateFromName(entry.name);
    if (dateMs == null) {
      continue; // 文件名不含日期 → 不是按日往事日记,跳过
    }
    const absolutePath = path.join(diaryDir, entry.name);
    let content = '';
    try {
      content = await fs.readFile(absolutePath, 'utf8');
    } catch {
      continue;
    }
    const canonicalPath = canonicalOf(absolutePath);
    for (const ev of parseDiaryEvents(content, dateMs)) {
      events.push({ ...ev, ref: `${canonicalPath}#${ev.index}` });
    }
  }

  // 去重:最近若干条 diary_resurface 扫描里翻过的 ref,冷却期内别重复翻。
  const recentRefs: string[] = [];
  const recent = await listRecallShadowLog({ identityKey, limit: DIARY_DEDUP_LOOKBACK });
  for (const row of recent) {
    if ((row as { query_ref?: string; queryRef?: string }).query_ref !== DIARY_RESURFACE_QUERY_REF
      && (row as { queryRef?: string }).queryRef !== DIARY_RESURFACE_QUERY_REF) continue;
    const surfaced = (row as { surfaced?: unknown }).surfaced;
    if (!Array.isArray(surfaced)) continue;
    for (const item of surfaced) {
      const ref = item && typeof (item as { ref?: unknown }).ref === 'string'
        ? (item as { ref: string }).ref
        : null;
      if (ref) recentRefs.push(ref);
    }
  }

  const picked = selectResurfacedEvents(events, {
    nowMs,
    minAgeDays: DIARY_MIN_AGE_DAYS,
    limit: DIARY_SURFACE_LIMIT,
    recentlySurfaced: recentRefs
  });

  const surfaced = picked.map((p) => {
    const days = Math.floor(p.ageDays);
    const firstLine = (p.body || '').split(/\n/).map((s) => s.trim()).find(Boolean) || '';
    const teaser = firstLine.length > 60 ? `${firstLine.slice(0, 60)}…` : firstLine;
    return {
      kind: 'diary_event',
      title: p.title,
      ref: p.ref,
      ageDays: Math.round(p.ageDays * 10) / 10,
      lead: teaser
        ? `${days} 天前你记过一件事：${p.title}——${teaser}`
        : `${days} 天前你记过一件事：${p.title}`
    };
  });

  const { id } = await insertRecallShadowLog({
    identityKey,
    occurredAt: new Date(nowMs),
    queryRef: DIARY_RESURFACE_QUERY_REF,
    queryText: null,
    silent: surfaced.length === 0,
    corpusCount: events.length,
    topK: surfaced.length,
    surfaced
  });

  return {
    totalEvents: events.length,
    surfaced: picked.map((p) => ({ title: p.title, ageDays: p.ageDays, ref: p.ref })),
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

  // 第二/三条腿:开放承诺 + 纯往事按时间重提(shadow-only)。搭这次重扫顺带跑;
  // 绝不能因它们出错而拖垮语料 reindex → 各自 try/catch 吞掉。
  let openLoopScan: OpenLoopScanResult | undefined;
  try {
    openLoopScan = await scanOpenLoopsToShadow({ identityKey });
  } catch {
    openLoopScan = undefined;
  }
  let diaryResurfaceScan: DiaryResurfaceScanResult | undefined;
  try {
    diaryResurfaceScan = await scanDiaryEventsToShadow({ identityKey });
  } catch {
    diaryResurfaceScan = undefined;
  }

  return {
    scanned: all.length,
    changed: changed.length,
    embedded,
    upserted,
    prunedPaths,
    counts,
    openLoopScan,
    diaryResurfaceScan
  };
}
