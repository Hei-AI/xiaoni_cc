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
  parseTagDate,
  selectStaleOpenLoops,
  parseDiaryDateFromName,
  parseDiaryEvents,
  parseDiarySerialEvents,
  selectResurfacedEvents,
  isDiaryNonEpisodeFile,
  normalizeEventText,
  selectAssociativeMemories,
  DAY_MS,
  BEIJING_OFFSET_MS,
  insertRecallShadowLog,
  listRecallShadowLog
} from '@qq-bot/persistence';
import type { XiaoniAssociationStats } from '@qq-bot/persistence';

// 结构标记复发阈值:归一化标题跨 ≥N 个东八区日历日出现 = 模板(醒来/今天总结…)→ resurface 跳过。
const STRUCTURAL_RECURRENCE_DAYS = 3;

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
// 日记目录里「不是一段经历」的那几份不进被动嵌入 —— 判定收口到 persistence 的
// isDiaryNonEpisodeFile(dictionary / open-loops / INDEX*),语料底和往事腿共用同一份,
// 别在这里再留一份 Set。INDEX*.md 必须按前缀认:整份都是索引行、没有一句是经历本身,
// 而硬编 `INDEX-2026-07.md` 下个月就漏。

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
// 专题连载(一件多天的事，一份文件一章章续):文件名不是日期，而是 topic-<主题>.md，
// 事发日期在每个 `## M/D` 章节标题里。也走第三腿(diary_resurface)按时间重提旧章节。
const SERIAL_FILE_PREFIX_RE = /^topic-/i;

// 被动召回【第四条腿】:联想。六因子等权 + 四个年龄桶独立配额 + identity 级冷却。
// 纯选取器在 packages/persistence/xiaoni-recall-association.js;这里只做 fs 扫描 + shadow 落库。
// 和第二/三腿同一处、同一套 shadow 路径、同一个 reindex 节律 —— 不新建第二条通路。
// **shadow-only:绝不投递**,产物不进任何 LLM 请求字节 → 双缓存零影响。
const ASSOCIATION_SCAN_QUERY_REF = 'association_scan';
// identity 级冷却窗。默认 30 分钟一轮重扫 → 336 行 ≈ 7 天。挑这个数是为了让「同一 identity
// 一周内不重复浮」成为结构性事实,而不是靠运气(spec §5.6 过线标准第三条)。
// listRecallShadowLog 的 limit 上限是 500,336 在内。
const ASSOCIATION_DEDUP_LOOKBACK = 336;
// L3 线(专题物化产物)的目录。**隔离目录**是有意的:落在 notes/diary/ 里时,同一件事的
// 「日记条目 + 线章节」两份拷贝会各占一个 slot(实测 155/155 = 100%,见 spec §8.1)。
// 目录不存在(P1 还没落地/还没跑过)→ 线场桶为空 → 按「空桶就少浮」少浮一条,不报错。
const TOPICS_DIR_REL_PATH = 'notes/topics';
// 真人名表来源:她自己维护的人物档案菜单。硬编人名会漂,读她的菜单才是单一真理源。
const PEOPLE_INDEX_REL_PATH = 'notes/people/INDEX.md';
const PEOPLE_INDEX_LINE_RE = /^\s*-\s*([^(（|]+)/gm;
const PEOPLE_NAME_ALIAS_SEP = /[/、,，\s]+/;

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
      if (entry.name.startsWith('.') || isDiaryNonEpisodeFile(entry.name)) {
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
  associationScan?: AssociationScanResult;
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

export interface AssociationScanResult {
  candidates: number;
  surfaced: Array<{ ref: string; bucket: string; identity: string; score: number }>;
  stats: XiaoniAssociationStats | null;
  shadowLogId: string | null;
  landedRef?: string | null;
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
  // queryRef 必须下推到 SQL(listRecallShadowLog 参数),不能取全表最近 N 行再在这里筛:
  // 这张表 ~97% 是语义腿的落地留痕,不带 queryRef 时窗口里几乎一条本腿行都没有 → 冷却失效。
  const recentTexts: string[] = [];
  const recent = await listRecallShadowLog({
    identityKey,
    queryRef: OPEN_LOOP_SCAN_QUERY_REF,
    limit: OPEN_LOOP_DEDUP_LOOKBACK
  });
  for (const row of recent) {
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

interface DiaryEventCandidate {
  title: string;
  body: string;
  dateMs: number;
  index: number;
  ref: string;
  lineKey: string | null;
}

// 扫 notes/diary/ → 每个 `## 小标题` 一件往事。第三腿(按时间重提)和第四腿(联想)共用这一份,
// 别各扫一遍:同一份文件解析两次不但浪费,还会在两条腿之间产生「同一个 ref 两种 index 口径」。
// readable=false 表示目录读不了(还没建/权限),调用方据此静默返回。
// lineKey:只有专题连载(topic-<主题>.md)才有 —— 它就是「这条线的名字」。按日日记恒 null。
async function collectDiaryEventCandidates(nowMs: number): Promise<{ readable: boolean; events: DiaryEventCandidate[] }> {
  const diaryDir = path.join(RUNTIME_ROOT, DIARY_DIR_REL_PATH);
  let entries: Array<{ name: string; isFile: () => boolean }>;
  try {
    entries = await fs.readdir(diaryDir, { withFileTypes: true });
  } catch {
    return { readable: false, events: [] };
  }

  // ref = canonical path#index(稳定,供去重)。
  const events: DiaryEventCandidate[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || entry.name.startsWith('.') || isDiaryNonEpisodeFile(entry.name)) {
      continue;
    }
    if (!/\.(md|txt)$/i.test(entry.name)) {
      continue;
    }
    // 先判专题连载:topic-<主题>.md 的文件名里可能也嵌了日期(topic-2026-07-05-复盘.md),
    // 必须优先按专题走每章 `## M/D`,否则会被 parseDiaryDateFromName 误当按日日记、整份钉死文件名日期。
    const isSerial = SERIAL_FILE_PREFIX_RE.test(entry.name);
    const dateMs = isSerial ? null : parseDiaryDateFromName(entry.name);
    if (!isSerial && dateMs == null) {
      continue; // 既不是按日日记(文件名日期)、也不是专题连载(topic-*) → 不进这两条腿,仍由语义腿索引
    }
    const absolutePath = path.join(diaryDir, entry.name);
    let content = '';
    try {
      content = await fs.readFile(absolutePath, 'utf8');
    } catch {
      continue;
    }
    const canonicalPath = canonicalOf(absolutePath);
    // 按日日记:整份共享文件名日期;专题连载:每章 `## M/D` 自带事发日期。
    // 走到这里非专题分支即 dateMs 必非空(上面的 guard 已排除 dateMs==null && !isSerial)。
    const parsed = isSerial
      ? parseDiarySerialEvents(content, nowMs)
      : parseDiaryEvents(content, dateMs as number);
    const lineKey = isSerial
      ? entry.name.replace(SERIAL_FILE_PREFIX_RE, '').replace(/\.(md|txt)$/i, '') || null
      : null;
    for (const ev of parsed) {
      events.push({ ...ev, ref: `${canonicalPath}#${ev.index}`, lineKey });
    }
  }
  return { readable: true, events };
}

// step-1 结构标记复发识别:按归一化标题聚跨天集合;跨 ≥STRUCTURAL_RECURRENCE_DAYS 个东八区
// 日历日出现的标题判为模板(醒来/今天总结…),交给选取器跳过。
// 复用 normalizeEventText——与选取器内去重/结构判定同一归一化(单一真理源)。第三、四腿共用。
function computeStructuralTitles(events: Array<{ title: string; dateMs: number }>): Set<string> {
  const titleDayBuckets = new Map<string, Set<number>>();
  for (const ev of events) {
    const nt = normalizeEventText(ev.title);
    if (!nt) continue;
    const dayKey = Math.floor((ev.dateMs + BEIJING_OFFSET_MS) / DAY_MS);
    let days = titleDayBuckets.get(nt);
    if (!days) {
      days = new Set<number>();
      titleDayBuckets.set(nt, days);
    }
    days.add(dayKey);
  }
  const structuralTitles = new Set<string>();
  for (const [nt, days] of titleDayBuckets) {
    if (days.size >= STRUCTURAL_RECURRENCE_DAYS) structuralTitles.add(nt);
  }
  return structuralTitles;
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

  const scan = await collectDiaryEventCandidates(nowMs);
  if (!scan.readable) {
    return { totalEvents: 0, surfaced: [], shadowLogId: null };
  }
  const events = scan.events;

  // 去重:最近若干条 diary_resurface 扫描里翻过的 ref,冷却期内别重复翻。
  // queryRef 下推到 SQL(见第二腿同样注释):不下推时 40 条窗口里 diary 行真库实测 = 0,
  // 冷却整个失效 —— 609 次扫描只浮出过 33 个 distinct ref、07-08 之后约 1200 条事件从没浮过。
  const recentRefs: string[] = [];
  const recent = await listRecallShadowLog({
    identityKey,
    queryRef: DIARY_RESURFACE_QUERY_REF,
    limit: DIARY_DEDUP_LOOKBACK
  });
  for (const row of recent) {
    const surfaced = (row as { surfaced?: unknown }).surfaced;
    if (!Array.isArray(surfaced)) continue;
    for (const item of surfaced) {
      const ref = item && typeof (item as { ref?: unknown }).ref === 'string'
        ? (item as { ref: string }).ref
        : null;
      if (ref) recentRefs.push(ref);
    }
  }

  const structuralTitles = computeStructuralTitles(events);

  const picked = selectResurfacedEvents(events, {
    nowMs,
    minAgeDays: DIARY_MIN_AGE_DAYS,
    limit: DIARY_SURFACE_LIMIT,
    recentlySurfaced: recentRefs,
    structuralTitles
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

// 她自己维护的人物档案菜单 → 真人名表(第四腿 f5 因子用)。读不到 = 空表 → f5 恒 0,不报错。
async function readPeerNames(): Promise<string[]> {
  let content = '';
  try {
    content = await fs.readFile(path.join(RUNTIME_ROOT, PEOPLE_INDEX_REL_PATH), 'utf8');
  } catch {
    return [];
  }
  const names = new Set<string>();
  for (const match of content.matchAll(PEOPLE_INDEX_LINE_RE)) {
    const name = (match[1] || '').trim();
    // 太长的不是称呼(是被误配的正文);单字名由选取器按 MIN_PEER_NAME_CHARS 自己剔。
    if (!name || name.length > 24) continue;
    if (name.length <= 12) names.add(name);
    // 别名切分:菜单里真实写成 `CC/骑猪去看月`、`Bartosz Ciechanowski`,而她在日记里只写
    // 「CC」「Bartosz」。不切的话这两个人在 f5 上永远命中不到。
    for (const alias of name.split(PEOPLE_NAME_ALIAS_SEP)) {
      const trimmed = alias.trim();
      if (trimmed.length >= 2 && trimmed.length <= 12) names.add(trimmed);
    }
  }
  return [...names];
}

// L3 线目录 notes/topics/<标签>.md → 章节候选(每章 `## M/D 点题`)。
// 目录不存在(P1 物化还没落地)→ 返回空 → 线场桶为空 → 少浮一条。这是「空桶就少浮」的正常路径。
async function collectTopicLineCandidates(nowMs: number): Promise<DiaryEventCandidate[]> {
  const topicsDir = path.join(RUNTIME_ROOT, TOPICS_DIR_REL_PATH);
  let entries: Array<{ name: string; isFile: () => boolean }>;
  try {
    entries = await fs.readdir(topicsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: DiaryEventCandidate[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || entry.name.startsWith('.') || isDiaryNonEpisodeFile(entry.name)) continue;
    if (!/\.(md|txt)$/i.test(entry.name)) continue;
    const absolutePath = path.join(topicsDir, entry.name);
    let content = '';
    try {
      content = await fs.readFile(absolutePath, 'utf8');
    } catch {
      continue;
    }
    const canonicalPath = canonicalOf(absolutePath);
    const lineKey = entry.name.replace(/\.(md|txt)$/i, '');
    for (const ev of parseDiarySerialEvents(content, nowMs)) {
      out.push({ ...ev, ref: `${canonicalPath}#${ev.index}`, lineKey });
    }
  }
  return out;
}

// 第四条腿:联想。候选 = 日记往事 ∪ L3 线章节 ∪ 开放承诺;排序 = 六因子等权;
// 名额 = 四个年龄桶各自的配额(近场恒 0);冷却 = identity 级。只写 shadow_log(**绝不投递**)。
//
// landedText(本次落地的那段文本)取动作流最新一条的 body/title —— 和 agent-service 侧那个
// 召回钩子(modules/agent-service/src/services/xiaoni-recall-hook.ts:62-64)同一口径、同一来源,
// 不新起第二种「什么算落地」的定义。取不到 → f1 全 0,其余五因子照排(不瘫)。
export async function scanAssociativeRecallToShadow(
  opts: { identityKey?: string; nowMs?: number } = {}
): Promise<AssociationScanResult> {
  const identityKey = opts.identityKey || 'xiaoni';
  const nowMs = Number.isFinite(opts.nowMs) ? Number(opts.nowMs) : Date.now();

  const diaryScan = await collectDiaryEventCandidates(nowMs);
  if (!diaryScan.readable) {
    return { candidates: 0, surfaced: [], stats: null, shadowLogId: null };
  }
  const [lineCandidates, peerNames] = await Promise.all([
    collectTopicLineCandidates(nowMs),
    readPeerNames()
  ]);

  // 开放承诺(第二腿的解析产物)也进候选:kind='promise',行末 `#标签` 就是它的线。
  // 它的正文就是那一行本身 → 不走 substance 过滤(选取器按 kind 分流)。
  const promiseCandidates: Array<{
    ref: string; kind: 'promise'; title: string; body: string; dateMs: number | null; lineKey: string | null; tier: string;
  }> = [];
  try {
    const loopsContent = await fs.readFile(path.join(RUNTIME_ROOT, OPEN_LOOPS_REL_PATH), 'utf8');
    const canonicalLoops = canonicalOf(path.join(RUNTIME_ROOT, OPEN_LOOPS_REL_PATH));
    for (const loop of parseOpenLoops(loopsContent)) {
      if (loop.done || !loop.text) continue;
      const openedMs = parseTagDate(loop.openedTag, nowMs);
      promiseCandidates.push({
        ref: `${canonicalLoops}#${loop.line}`,
        kind: 'promise',
        title: loop.text,
        body: '',
        dateMs: openedMs, // 没写日期 → null → 选取器判无桶,不进本腿(第二腿的 undated 档已兜过)
        lineKey: Array.isArray(loop.tags) && loop.tags.length ? loop.tags[0] : null,
        tier: 'open'
      });
    }
  } catch {
    // 还没有欠账文件,跳过这一类候选。
  }

  const candidates = [
    ...diaryScan.events.map((ev) => ({ ...ev, kind: 'event' as const })),
    ...lineCandidates.map((ev) => ({ ...ev, kind: 'event' as const })),
    ...promiseCandidates
  ];

  // 落地文本:动作流最新一条(和 agent-service 召回钩子同口径)。取不到不阻断。
  let landedText = '';
  let landedRef: string | null = null;
  try {
    const feed = await getXiaoniActionStream({ identityKey, limit: 1 });
    const items = Array.isArray(feed?.items) ? feed.items : [];
    const newest = items[0];
    if (newest) {
      landedText = (typeof newest.body === 'string' && newest.body)
        || (typeof newest.title === 'string' && newest.title) || '';
      landedRef = (typeof newest.id === 'string' && newest.id)
        || (typeof newest.eventId === 'string' && newest.eventId) || null;
    }
  } catch {
    landedText = '';
  }

  // identity 级冷却:窗口必须带 queryRef 下推到 SQL —— 这张表 ~97% 是语义腿每次落地写的留痕,
  // 不下推时窗口里本腿的行实测是 0 条,冷却完全失效(第二/三腿踩过的同一个坑,P0 刚修)。
  const recentIdentities: string[] = [];
  const recent = await listRecallShadowLog({
    identityKey,
    queryRef: ASSOCIATION_SCAN_QUERY_REF,
    limit: ASSOCIATION_DEDUP_LOOKBACK
  });
  for (const row of recent) {
    const surfaced = (row as { surfaced?: unknown }).surfaced;
    if (!Array.isArray(surfaced)) continue;
    for (const item of surfaced) {
      const identity = item && typeof (item as { identity?: unknown }).identity === 'string'
        ? (item as { identity: string }).identity
        : null;
      if (identity) recentIdentities.push(identity);
      // ref 也收:同一条留痕里 identity 缺失(老行)时按 ref 兜一层。
      const ref = item && typeof (item as { ref?: unknown }).ref === 'string'
        ? (item as { ref: string }).ref
        : null;
      if (ref) recentIdentities.push(ref);
    }
  }

  // 结构模板识别只看有事发日期的那两类(日记条目 + 线章节)。承诺行不是模板,不参与。
  const structuralTitles = computeStructuralTitles([...diaryScan.events, ...lineCandidates]);

  const { picked, stats } = selectAssociativeMemories(candidates, {
    nowMs,
    landedText,
    peerNames,
    recentlySurfacedIdentities: recentIdentities,
    structuralTitles
  });

  // lead 按桶分档:中场给天数,远场点破「挺久了」,线场带上这条线的名字。
  const surfaced = picked.map((p) => {
    const days = p.ageDays == null ? null : Math.floor(p.ageDays);
    const firstLine = (p.body || '').split(/\n/).map((s) => s.trim()).find(Boolean) || '';
    const teaser = firstLine.length > 60 ? `${firstLine.slice(0, 60)}…` : firstLine;
    const tail = teaser ? `${p.title}——${teaser}` : p.title;
    let lead: string;
    if (p.bucket === 'line') {
      lead = `你在追的这条线（${p.lineKey}）里有一段：${tail}`;
    } else if (p.kind === 'promise') {
      lead = `你之前记过一件还没了的事：${p.title}${days == null ? '' : `（放了 ${days} 天了）`}`;
    } else if (p.bucket === 'far') {
      lead = `${days} 天前（挺久了）你记过一件事：${tail}`;
    } else {
      lead = `${days} 天前你记过一件事：${tail}`;
    }
    return {
      kind: 'association',
      memoryKind: p.kind,
      bucket: p.bucket,
      identity: p.identity,
      title: p.title,
      ref: p.ref,
      lineKey: p.lineKey,
      tier: p.tier,
      ageDays: p.ageDays == null ? null : Math.round(p.ageDays * 10) / 10,
      score: Math.round(p.score * 1000) / 1000,
      factors: p.factors,
      lead
    };
  });

  const { id } = await insertRecallShadowLog({
    identityKey,
    occurredAt: new Date(nowMs),
    queryRef: ASSOCIATION_SCAN_QUERY_REF,
    // 落地文本进 queryText:观察期要能回答「这一浮是被什么勾起来的」。
    queryText: landedText ? landedText.slice(0, 2000) : null,
    silent: surfaced.length === 0,
    corpusCount: stats.filtered,
    topK: surfaced.length,
    surfaced,
    // 分桶/剔除计数塞 droppedCounts(既有列,管理端已在读),不新开列。
    droppedCounts: {
      bucket_near: stats.byBucket.near,
      bucket_mid: stats.byBucket.mid,
      bucket_far: stats.byBucket.far,
      bucket_line: stats.byBucket.line,
      ...stats.dropped
    },
    droppedSample: []
  });

  return {
    candidates: candidates.length,
    surfaced: surfaced.map((s) => ({ ref: s.ref, bucket: s.bucket, identity: s.identity, score: s.score })),
    stats,
    shadowLogId: id,
    landedRef
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
  // 第四条腿(联想)同样搭这次重扫顺带跑,出错吞掉不拖垮语料 reindex。shadow-only。
  let associationScan: AssociationScanResult | undefined;
  try {
    associationScan = await scanAssociativeRecallToShadow({ identityKey });
  } catch {
    associationScan = undefined;
  }

  return {
    scanned: all.length,
    changed: changed.length,
    embedded,
    upserted,
    prunedPaths,
    counts,
    openLoopScan,
    diaryResurfaceScan,
    associationScan
  };
}
