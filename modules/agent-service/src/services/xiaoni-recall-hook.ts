// 被动浮现动作流钩子(agent-service 侧)。stack append 事件后 fire-and-forget:
//   投影最近动作流头部(getXiaoniActionStream)→ 触发1 ingest(hash 去重跳过旧的)
//   → 触发2 recall(最新一条当 query,近窗其余项当 contextRefs 做 ④ 语义在场排除)。
//
// 事件驱动(append 触发,非轮询)。铁律:不投递 → 零缓存;绝不 await 进 turn,失败全吞。
// 轻量防抖:突发 append 合并,避免每次 append 都投影一遍头部。
// docs/XIAONI_PASSIVE_RECALL_SHADOW_COMPLETION.md §3

import axios from 'axios';
import * as persistence from '@qq-bot/persistence';

const IDENTITY_KEY = 'xiaoni';
const HEAD_LIMIT = 50;                 // 每次事件投影的头部条数(覆盖一个 turn 的落地)
const DEBOUNCE_MS = 3000;              // 突发 append 合并窗口
const PROVIDER_URL = process.env.PROVIDER_SERVICE_URL || 'http://qqbot-provider-service:8090';
const EMBEDDING_TIMEOUT_MS = Number.parseInt(process.env.EMBEDDING_TIMEOUT_MS || '30000', 10);
const ENABLED = process.env.XIAONI_PASSIVE_RECALL_INGEST_ENABLED !== 'false'; // 默认开,可环境关

async function embed(texts: string[]): Promise<number[][]> {
  if (!Array.isArray(texts) || texts.length === 0) {
    return [];
  }
  const resp = await axios.post(
    `${PROVIDER_URL}/v1/embeddings`,
    { input: texts, encoding_format: 'float', normalize: 2 },
    { timeout: EMBEDDING_TIMEOUT_MS, headers: { 'Content-Type': 'application/json' } }
  );
  const data = resp.data?.data;
  if (!Array.isArray(data) || data.length !== texts.length) {
    return texts.map(() => []);
  }
  return data.map((e: { embedding?: number[] }) => (Array.isArray(e?.embedding) ? e.embedding : []));
}

let ingestSingleton: ReturnType<typeof persistence.createRecallIngest> | null = null;
function getIngest() {
  if (!ingestSingleton) {
    ingestSingleton = persistence.createRecallIngest({ embed, persistence, identityKey: IDENTITY_KEY });
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
