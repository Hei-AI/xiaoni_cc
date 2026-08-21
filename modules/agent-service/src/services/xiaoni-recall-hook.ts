// 被动浮现动作流钩子(agent-service 侧)。stack append 事件后 fire-and-forget:
//   投影最近动作流头部(getXiaoniActionStream)→ 触发1 ingest(hash 去重跳过旧的)
//   → 触发2 recall(最新一条当 query,近窗其余项当 contextRefs 做 ④ 语义在场排除)。
//
// 事件驱动(append 触发,非轮询)。铁律:不投递 → 零缓存;绝不 await 进 turn,失败全吞。
// 轻量防抖:突发 append 合并,避免每次 append 都投影一遍头部。
// docs/XIAONI_PASSIVE_RECALL_SHADOW_COMPLETION.md §3

import fs from 'node:fs/promises';
import path from 'node:path';

import * as persistence from '@qq-bot/persistence';

import { callRecallLlm, type RecallPrompt } from './xiaoni-recall-llm-client';
import { readContextMenuTexts } from './xiaoni-context-menus';

const IDENTITY_KEY = 'xiaoni';
const HEAD_LIMIT = 50;                 // 每次事件投影的头部条数(覆盖一个 turn 的落地)
const DEBOUNCE_MS = 3000;              // 突发 append 合并窗口
const PROVIDER_URL = process.env.PROVIDER_SERVICE_URL || 'http://qqbot-provider-service:8090';
const EMBEDDING_TIMEOUT_MS = Number.parseInt(process.env.EMBEDDING_TIMEOUT_MS || '30000', 10);
const ENABLED = process.env.XIAONI_PASSIVE_RECALL_INGEST_ENABLED !== 'false'; // 默认开,可环境关

// agent-service 无 axios 依赖 → 用 Node 18 全局 fetch(不加依赖)。
async function embed(texts: string[]): Promise<number[][]> {
  if (!Array.isArray(texts) || texts.length === 0) {
    return [];
  }
  const resp = await fetch(`${PROVIDER_URL}/v1/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: texts, encoding_format: 'float', normalize: 2 }),
    signal: AbortSignal.timeout(EMBEDDING_TIMEOUT_MS)
  });
  if (!resp.ok) {
    return texts.map(() => []);
  }
  const json = (await resp.json()) as { data?: Array<{ embedding?: number[] }> };
  const data = json?.data;
  if (!Array.isArray(data) || data.length !== texts.length) {
    return texts.map(() => []);
  }
  return data.map((e) => (Array.isArray(e?.embedding) ? e.embedding : []));
}

// 菜单读取与小模型调用都收口在共用模块(见各自文件头)。
const RUNTIME_ROOT = process.env.XIAONI_RUNTIME_ROOT || '/xiaoni-runtime';
const PEOPLE_INDEX_REL = 'notes/people/INDEX.md';
const EXPANSION_MODEL = process.env.XIAONI_RECALL_EXPANSION_MODEL || undefined;
const EXPANSION_TIMEOUT_MS = Number.parseInt(process.env.XIAONI_RECALL_EXPANSION_TIMEOUT_MS || '25000', 10);

async function readIfExists(absolutePath: string): Promise<string | null> {
  try {
    return await fs.readFile(absolutePath, 'utf8');
  } catch {
    return null;
  }
}

const readContextMenus = () => readContextMenuTexts(RUNTIME_ROOT);

const expandQueries = (prompt: RecallPrompt) => callRecallLlm(prompt, {
  model: EXPANSION_MODEL,
  maxTokens: 512,
  timeoutMs: EXPANSION_TIMEOUT_MS,
  label: 'recall-expansion'
});

// 她的人物菜单名字表。喂 importance 的 peer / profiledPeer 两个因子。
// 与 readTags 分开:那个混着专题标签,当人名用会误命中。
const PEOPLE_INDEX_LINE_RE = /^\s*-\s*([^(（|]+)/gm;

async function readPeerNames(): Promise<string[]> {
  const peopleIndex = await readIfExists(path.join(RUNTIME_ROOT, PEOPLE_INDEX_REL));
  if (!peopleIndex) {
    return [];
  }
  const names: string[] = [];
  for (const m of peopleIndex.matchAll(PEOPLE_INDEX_LINE_RE)) {
    const name = (m[1] || '').trim();
    if (name.length >= 2) {
      names.push(name);
    }
  }
  return Array.from(new Set(names));
}

// 标签命名空间取自她自己写的东西(topics 文件名 + 人物菜单名字),不另造词表 ——
// 模型的活因此是**组合**而不是生成:便宜、可控、结果可解释。
async function readTags(): Promise<string[]> {
  const tags: string[] = [];
  try {
    const names = await fs.readdir(path.join(RUNTIME_ROOT, 'notes/topics'));
    for (const n of names) {
      if (/\.(md|txt)$/i.test(n) && !/^INDEX([-.]|$)/i.test(n)) {
        tags.push(n.replace(/\.(md|txt)$/i, ''));
      }
    }
  } catch {
    // 目录还没建 → 只用人名
  }
  return Array.from(new Set([...tags, ...(await readPeerNames())]));
}

let ingestSingleton: ReturnType<typeof persistence.createRecallIngest> | null = null;
function getIngest() {
  if (!ingestSingleton) {
    ingestSingleton = persistence.createRecallIngest({ embed, persistence, identityKey: IDENTITY_KEY, readContextMenus, expandQueries, readTags, readPeerNames });
  }
  return ingestSingleton;
}

let lastFiredAt = 0;
let inFlight = false;

async function projectAndIngest(): Promise<void> {
  const feed = await persistence.getXiaoniActionStream({ identityKey: IDENTITY_KEY, limit: HEAD_LIMIT });
  const items: Array<Record<string, unknown>> = Array.isArray((feed as any)?.items) ? (feed as any).items : [];
  if (items.length === 0) {
    return;
  }
  const ingest = getIngest();
  // 触发1:整头部过一遍,hash 没变的自动跳过(只新的/改的会嵌入+upsert)。
  await ingest.ingestActionStreamItems(items);

  // 触发2:最新一条当 query,其余头部项当近窗(结构式 + ④ 语义式在场排除)。
  const newest: any = items[0];
  const landedText = (typeof newest?.body === 'string' && newest.body)
    || (typeof newest?.title === 'string' && newest.title) || '';
  const landedRef = (typeof newest?.id === 'string' && newest.id)
    || (typeof newest?.eventId === 'string' && newest.eventId) || null;
  if (!landedText) {
    return;
  }
  const contextRefs = items
    .slice(1, 15)
    .map((it: any) => (typeof it?.id === 'string' ? it.id : (typeof it?.eventId === 'string' ? it.eventId : null)))
    .filter(Boolean) as string[];
  await ingest.runShadowRecall({
    landedText,
    landedRef,
    contextRefs,
    taskLocked: false,
    occurredAt: typeof newest?.timestamp === 'string' ? newest.timestamp : undefined
  });
}

// 消费侧 query 点火。被动召回是对小腻**正在消费的内容**的进一步联想,所以点火时刻只有一个:
// 她真的把这条 notify 消费掉的那一刻。还躺在 Notify Bucket 里没被消费的,不构成她的「当下」
//   —— 她睡着时进桶的消息不点火,等她醒来消费才点。
//
// 为什么不复用 fireActionStreamRecall:消费 notify 会写 runtime_input 栈行,那条腿确实会触发,
// 但它的 query 文本是整个 runtime_input 的渲染,实测被 <xiaoni_plan> 盖过(全库 8431 条
// action_stream cue 只有 62 条含对方名字)。「别人刚说的话勾起她一段回忆」需要消息原文当 query。
//
// landedRef 沿用 `inbound:<id>` 形状,shadow_log.query_ref 语义与挪之前完全一致。
// 铁律:fire-and-forget,不进 request、不写 agent_stack_items,对双缓存零影响。
export function fireConsumedNotifyRecall(payload: Record<string, unknown> | null | undefined): void {
  if (!ENABLED || !payload) {
    return;
  }
  // 只对 QQ 消息类 notify 点火;xiaoni_plan / clock_ping / 压缩完成等自驱动 notify 仍由
  // fireActionStreamRecall 覆盖(它们本来就是她自己的动作)。
  if (!payload.phoneNotification) {
    return;
  }
  const landedText = typeof payload.bodyForAgent === 'string' ? payload.bodyForAgent : '';
  if (!landedText) {
    return;
  }
  const messageId = (payload as Record<string, any>).messageId;
  const landedRef = messageId ? `inbound:${messageId}` : null;
  const occurredAt = (typeof payload.messageTimestamp === 'string' && payload.messageTimestamp)
    || (typeof payload.receivedAt === 'string' && payload.receivedAt) || undefined;
  Promise.resolve()
    .then(() => getIngest().runShadowRecall({
      landedText,
      landedRef,
      contextRefs: [],
      taskLocked: false,
      occurredAt
    }))
    .catch(() => {});
}

// stack append 事件后调用。同步返回,内部完全 fire-and-forget + 防抖 + 单飞。
export function fireActionStreamRecall(): void {
  if (!ENABLED || inFlight) {
    return;
  }
  const now = Date.now();
  if (now - lastFiredAt < DEBOUNCE_MS) {
    return; // 防抖:突发 append 合并
  }
  lastFiredAt = now;
  inFlight = true;
  Promise.resolve()
    .then(() => projectAndIngest())
    .catch(() => {})
    .finally(() => { inFlight = false; });
}
