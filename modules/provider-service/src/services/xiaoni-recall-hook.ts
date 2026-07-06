// 被动浮现入站钩子(provider 侧)。入站消息落库后 fire-and-forget:
//   触发1 ingest(把这条入站存进语料)+ 触发2 recall(拿它当 query 跑召回,写 shadow_log)。
// 铁律:不投递 → 零缓存;绝不 await 进热路径,失败全吞(shadow 出错不影响入站主链)。
// docs/XIAONI_PASSIVE_RECALL_SHADOW_COMPLETION.md §3

import axios from 'axios';
import * as persistence from '@qq-bot/persistence';

const EMBEDDING_BASE_URL = process.env.EMBEDDING_BASE_URL || '';
const EMBEDDING_MODEL_ID = process.env.EMBEDDING_MODEL_ID || 'embeddinggemma-300m';
const EMBEDDING_TIMEOUT_MS = Number.parseInt(process.env.EMBEDDING_TIMEOUT_MS || '30000', 10);

async function embed(texts: string[]): Promise<number[][]> {
  if (!EMBEDDING_BASE_URL || !Array.isArray(texts) || texts.length === 0) {
    return texts.map(() => []);
  }
  const resp = await axios.post(
    `${EMBEDDING_BASE_URL}/v1/embeddings`,
    { input: texts, model: EMBEDDING_MODEL_ID, encoding_format: 'float', normalize: 2 },
    { timeout: EMBEDDING_TIMEOUT_MS, headers: { 'Content-Type': 'application/json' } }
  );
  const data = resp.data?.data;
  if (!Array.isArray(data) || data.length !== texts.length) {
    return texts.map(() => []);
  }
  return data.map((e: { embedding?: number[] }) => (Array.isArray(e?.embedding) ? e.embedding : []));
}

let ingestSingleton: any = null;
function getIngest() {
  if (!ingestSingleton) {
    ingestSingleton = persistence.createRecallIngest({ embed, persistence, identityKey: 'xiaoni' });
  }
  return ingestSingleton;
}

// 入站消息落库后调用。同步返回,内部完全 fire-and-forget。
export function fireInboundRecall(record: {
  id?: number | string;
  messageSid?: string;
  chatType?: string;
  senderName?: string;
  peerName?: string;
  bodyForAgent?: string;
  messageTimestamp?: string;
  receivedAt?: string;
} | null | undefined): void {
  if (!record || !EMBEDDING_BASE_URL) {
    return; // embedding 未配置则整体静默(不建 shadow 语料)。
  }
  const ingest = getIngest();
  const landedRef = `inbound:${record.id ?? record.messageSid ?? ''}`;
  const landedText = record.bodyForAgent || '';
  const occurredAt = record.messageTimestamp || record.receivedAt || undefined;
  // 触发1 + 触发2,均 fire-and-forget,失败吞掉。
  Promise.resolve()
    .then(() => ingest.ingestInboundMessages([record]))
    .catch(() => {});
  Promise.resolve()
    .then(() => ingest.runShadowRecall({ landedText, landedRef, contextRefs: [], taskLocked: false, occurredAt }))
    .catch(() => {});
}
