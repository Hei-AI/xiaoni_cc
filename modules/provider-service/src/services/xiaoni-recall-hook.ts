// 被动浮现入站钩子(provider 侧)。只做触发1:把入站消息写进召回语料。
//
// 调用点在 index.ts 的 notificationAllowed 之后(isReachableByXiaoni),所以语料只收
// 「真的递到小腻面前」的消息 —— 关闭的聊天对象、mentions_only 群的非@消息都不写。
//
// 触发2(拿消息当 query 跑召回)已经不在这里:被动召回是对她**正在消费的内容**的联想,
// 消息还躺在 Notify Bucket 里没被消费时不构成她的「当下」。query 点火挪到了
// agent-service/src/services/xiaoni-recall-hook.ts 的 fireConsumedNotifyRecall。
//
// 铁律:不投递 → 零缓存;绝不 await 进热路径,失败全吞(出错不影响入站主链)。
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

// 可达性门通过后调用(index.ts processAutoReply)。record 形状宽松(适配器防御式取字段);
// 同步返回,内部完全 fire-and-forget。
export function fireInboundRecall(record: object | null | undefined): void {
  if (!record || !EMBEDDING_BASE_URL) {
    return; // embedding 未配置则整体静默(不建 shadow 语料)。
  }
  const r = record as Record<string, any>;
  // 触发1:写语料。fire-and-forget,失败吞掉。
  Promise.resolve()
    .then(() => getIngest().ingestInboundMessages([r]))
    .catch(() => {});
}
