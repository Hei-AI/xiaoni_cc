import { listAbMemoryStreamItems } from '@qq-bot/persistence';
import {
  AbMemoryItemType,
  AbMemoryStreamItem,
  AbRetrievalPolicySnapshot,
  JsonObject,
  RetrievedMemoryContext,
  RetrievedMemoryItem
} from './ab-types';

export interface AbMemoryProjectorSource {
  listMemoryStreamItems(filters: {
    namespace?: string;
    arm?: string;
    type?: string;
    subtype?: string;
    status?: string;
    includeExpired?: boolean;
    limit?: number;
  }): Promise<unknown[]>;
}

export interface AbMemoryProjectInput {
  namespace: string;
  queryText: string;
  retrievalPolicy: AbRetrievalPolicySnapshot;
  sessionKey?: string | null;
  peerId?: string | null;
  senderId?: string | null;
  arm?: string;
  items?: AbMemoryStreamItem[];
  source?: AbMemoryProjectorSource;
}

type BucketName = 'observations' | 'reflections' | 'plans' | 'selfState';

const bucketByType: Record<AbMemoryItemType, BucketName> = {
  observation: 'observations',
  reflection: 'reflections',
  plan: 'plans'
};

const selfStateSubtypes = new Set([
  'xiaoni_os',
  'self_state',
  'self-state',
  'selfState',
  'present_self',
  'identity_self_state'
]);

function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(text.trim().length / 4));
}

function normalizeDate(value: unknown): string | null {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asNumber(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeItem(record: unknown): AbMemoryStreamItem {
  const value = record && typeof record === 'object' ? record as Record<string, unknown> : {};
  const type = value.type === 'observation' || value.type === 'reflection' || value.type === 'plan'
    ? value.type
    : 'observation';
  const sourceEventRefs = Array.isArray(value.sourceEventRefs)
    ? value.sourceEventRefs
    : Array.isArray(value.source_event_refs)
      ? value.source_event_refs
      : [];

  return {
    id: String(value.id || ''),
    namespace: String(value.namespace || ''),
    arm: value.arm === 'treatment' ? 'treatment' : 'control',
    type,
    subtype: typeof value.subtype === 'string' ? value.subtype : null,
    content: typeof value.content === 'string' ? value.content : '',
    retrievalText: typeof value.retrievalText === 'string'
      ? value.retrievalText
      : typeof value.retrieval_text === 'string'
        ? value.retrieval_text
        : null,
    embeddingText: typeof value.embeddingText === 'string'
      ? value.embeddingText
      : typeof value.embedding_text === 'string'
        ? value.embedding_text
        : null,
    importance: asNumber(value.importance),
    confidence: asNumber(value.confidence, 1),
    status: value.status === 'fulfilled' || value.status === 'expired' || value.status === 'superseded'
      ? value.status
      : 'active',
    sourceEventRefs: sourceEventRefs as AbMemoryStreamItem['sourceEventRefs'],
    provenance: value.provenance && typeof value.provenance === 'object' && !Array.isArray(value.provenance)
      ? value.provenance as JsonObject
      : {},
    ttlExpiresAt: normalizeDate(value.ttlExpiresAt || value.ttl_expires_at),
    fulfilledAt: normalizeDate(value.fulfilledAt || value.fulfilled_at),
    createdAt: normalizeDate(value.createdAt || value.created_at) || new Date(0).toISOString(),
    updatedAt: normalizeDate(value.updatedAt || value.updated_at) || new Date(0).toISOString()
  };
}

function recencyScore(item: AbMemoryStreamItem, nowMs: number) {
  const updatedAt = Date.parse(item.updatedAt || item.createdAt || '');
  if (!Number.isFinite(updatedAt)) {
    return 0;
  }
  const ageHours = Math.max(0, (nowMs - updatedAt) / 3_600_000);
  return 1 / (1 + ageHours / 24);
}

function relevanceScore(item: AbMemoryStreamItem, queryText: string) {
  const queryTerms = new Set(queryText.toLowerCase().split(/\s+/).filter((term) => term.length >= 2));
  if (queryTerms.size === 0) {
    return 0;
  }
  const haystack = `${item.content} ${item.retrievalText || ''}`.toLowerCase();
  let hits = 0;
  for (const term of queryTerms) {
    if (haystack.includes(term)) {
      hits += 1;
    }
  }
  return hits / queryTerms.size;
}

function bucketForItem(item: AbMemoryStreamItem): BucketName {
  if (item.subtype && selfStateSubtypes.has(item.subtype)) {
    return 'selfState';
  }
  return bucketByType[item.type];
}

function toRetrievedItem(
  item: AbMemoryStreamItem,
  score: number,
  scores: { relevance: number; recency: number; importance: number }
): RetrievedMemoryItem {
  const tokenEstimate = estimateTokens(item.retrievalText || item.content);
  return {
    id: item.id,
    type: item.type,
    subtype: item.subtype,
    content: item.retrievalText || item.content,
    score,
    relevanceScore: scores.relevance,
    recencyScore: scores.recency,
    importanceScore: scores.importance,
    confidence: item.confidence,
    sourceEventRefs: item.sourceEventRefs,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    metadata: {
      provenance: item.provenance,
      originalType: item.type,
      tokenEstimate
    }
  };
}

async function loadItems(input: AbMemoryProjectInput): Promise<AbMemoryStreamItem[]> {
  if (input.items) {
    return input.items.map(normalizeItem);
  }

  const source = input.source || { listMemoryStreamItems: listAbMemoryStreamItems };
  const perTypeLimit = Math.max(
    input.retrievalPolicy.typeLimits.observations.maxItems,
    input.retrievalPolicy.typeLimits.reflections.maxItems,
    input.retrievalPolicy.typeLimits.plans.maxItems,
    input.retrievalPolicy.typeLimits.selfState?.maxItems || 0,
    1
  ) * 3;
  const batches = await Promise.all(
    (['observation', 'reflection', 'plan'] as AbMemoryItemType[]).map((type) => source.listMemoryStreamItems({
      namespace: input.namespace,
      arm: input.arm,
      type,
      status: 'active',
      includeExpired: false,
      limit: perTypeLimit
    }))
  );
  return batches.flat().map(normalizeItem);
}

export async function projectAbMemoryContext(input: AbMemoryProjectInput): Promise<RetrievedMemoryContext> {
  const nowMs = Date.now();
  const items = await loadItems(input);
  const scored = items
    .filter((item) => item.status === 'active' && item.content.trim().length > 0)
    .map((item) => {
      const relevance = relevanceScore(item, input.queryText);
      const recency = recencyScore(item, nowMs);
      const importance = Math.max(0, Math.min(1, item.importance));
      const score =
        relevance * input.retrievalPolicy.relevanceWeight +
        recency * input.retrievalPolicy.recencyWeight +
        importance * input.retrievalPolicy.importanceWeight;
      return { item, bucket: bucketForItem(item), score, scores: { relevance, recency, importance } };
    })
    .sort((a, b) => b.score - a.score || String(b.item.updatedAt).localeCompare(String(a.item.updatedAt)));

  const buckets: Record<BucketName, RetrievedMemoryItem[]> = {
    observations: [],
    reflections: [],
    plans: [],
    selfState: []
  };
  const bucketTokens: Record<BucketName, number> = {
    observations: 0,
    reflections: 0,
    plans: 0,
    selfState: 0
  };
  let totalTokens = 0;
  let truncated = false;
  let truncationReason: string | null = null;

  for (const entry of scored) {
    const limit = input.retrievalPolicy.typeLimits[entry.bucket];
    if (!limit) {
      continue;
    }
    const retrieved = toRetrievedItem(entry.item, entry.score, entry.scores);
    const tokenEstimate = estimateTokens(retrieved.content);
    if (buckets[entry.bucket].length >= limit.maxItems || bucketTokens[entry.bucket] + tokenEstimate > limit.maxTokens) {
      truncated = true;
      truncationReason ||= `${entry.bucket} limit reached`;
      continue;
    }
    if (totalTokens + tokenEstimate > input.retrievalPolicy.totalHardCapTokens) {
      truncated = true;
      truncationReason ||= 'total hard token cap reached';
      continue;
    }
    buckets[entry.bucket].push(retrieved);
    bucketTokens[entry.bucket] += tokenEstimate;
    totalTokens += tokenEstimate;
  }

  return {
    namespace: input.namespace,
    observations: buckets.observations,
    reflections: buckets.reflections,
    plans: buckets.plans,
    selfState: buckets.selfState,
    budget: {
      observationsTokens: bucketTokens.observations,
      reflectionsTokens: bucketTokens.reflections,
      plansTokens: bucketTokens.plans,
      selfStateTokens: bucketTokens.selfState,
      totalTokens,
      truncated,
      truncationReason
    },
    query: {
      text: input.queryText,
      sessionKey: input.sessionKey,
      peerId: input.peerId,
      senderId: input.senderId,
      types: ['observation', 'reflection', 'plan'],
      metadata: {
        totalSoftCapTokens: input.retrievalPolicy.totalSoftCapTokens,
        totalHardCapTokens: input.retrievalPolicy.totalHardCapTokens
      }
    }
  };
}

export function estimateAbMemoryTokens(text: string) {
  return estimateTokens(text);
}
