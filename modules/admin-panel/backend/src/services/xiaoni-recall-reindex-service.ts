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
  countRecallCues
  // @ts-ignore — JS persistence package, no bundled types for these helpers
} from '@qq-bot/persistence';

// 小腻被动浮现召回语料 reindex/ingest。扫动作流 + 文件底,只对内容变了的重嵌,写向量。
// 只在 admin-backend 跑,不进 agent-service / 小腻 loop。docs/XIAONI_PASSIVE_RECALL_SURFACING.md

const PROVIDER_SERVICE_URL = process.env.PROVIDER_SERVICE_URL || 'http://qqbot-provider-service:8090';
const RUNTIME_ROOT = process.env.XIAONI_RUNTIME_ROOT || '/home/liahua/.qqbot-local/xiaoni-runtime';
const CANONICAL_ROOT = '/xiaoni-runtime';
const FILE_DIRS = ['forever', 'notes', 'reading', 'toys'];
const EMBED_BATCH = 64;
const HASH_LOOKUP_BATCH = 1000;

interface RecallRecord {
  sourceKind: string;
  sourceRef: string;
  occurredAt: string | null;
  embeddingText: string;
  provenance: Record<string, unknown>;
  contentHash: string;
  embedding?: number[];
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = texts.slice(i, i + EMBED_BATCH);
    if (batch.length === 0) {
      continue;
    }
    const resp = await axios.post(
      `${PROVIDER_SERVICE_URL}/v1/embeddings`,
      { input: batch },
      { timeout: 120000 }
    );
    const data = resp.data?.data;
    if (!Array.isArray(data) || data.length !== batch.length) {
      throw new Error(`embedding response count mismatch (want ${batch.length}, got ${Array.isArray(data) ? data.length : 'n/a'})`);
    }
    for (const entry of data) {
      out.push(Array.isArray(entry?.embedding) ? entry.embedding : []);
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

  const embeddings = await embedTexts(changed.map((record) => record.embeddingText));
  changed.forEach((record, index) => {
    record.embedding = embeddings[index];
  });
  const usable = changed.filter((record) => Array.isArray(record.embedding) && record.embedding.length > 0);

  const { upserted } = await upsertRecallCues(identityKey, usable);

  // 文件重扫后清掉不再存在的旧块(文件被删短)。
  let prunedPaths = 0;
  for (const [filePath, keep] of fileData.keepByPath) {
    await pruneFileChunks(identityKey, filePath, keep);
    prunedPaths += 1;
  }

  const counts = await countRecallCues(identityKey);
  return {
    scanned: all.length,
    changed: changed.length,
    embedded: usable.length,
    upserted,
    prunedPaths,
    counts
  };
}
