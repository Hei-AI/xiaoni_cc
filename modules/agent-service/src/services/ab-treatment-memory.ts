import { createHash, randomUUID } from 'node:crypto';
import {
  createAbMemoryStreamItem,
  listAbMemoryStreamItems,
  markAbMemoryPlanFulfilled
} from '@qq-bot/persistence';
import type {
  AbMemoryItemStatus,
  AbMemoryItemType,
  AbMemoryQuery,
  AbMemoryStreamItem,
  AbSourceEventRef,
  JsonObject
} from './ab-types';
import type { TreatmentDeps } from './treatment-deps';

export const TREATMENT_MEMORY_NAMESPACE_PREFIX = 'ab:treatment';

export interface TreatmentMemoryNamespaceInput {
  experimentId: string;
  sessionKey?: string | null;
  peerId?: string | null;
}

export interface TreatmentMemoryWriteInput {
  namespace: string;
  content: string;
  subtype?: string | null;
  retrievalText?: string | null;
  embeddingText?: string | null;
  importance?: number;
  confidence?: number;
  sourceEventRefs?: AbSourceEventRef[];
  provenance?: JsonObject;
  ttlExpiresAt?: string | Date | null;
  now?: Date;
  id?: string;
}

export interface TreatmentPlanWriteInput extends TreatmentMemoryWriteInput {
  ttlExpiresAt: string | Date;
}

export interface TreatmentMemoryPlanMutationDeps {
  listMemoryStreamItems(namespace: string, query: AbMemoryQuery): Promise<AbMemoryStreamItem[]>;
  markMemoryPlanFulfilled(
    id: string,
    params?: { status?: AbMemoryItemStatus; fulfilledAt?: string | Date }
  ): Promise<AbMemoryStreamItem>;
  now(): Date;
}

export interface TreatmentMemoryPersistenceConfig {
  databaseUrl?: string;
}

function safeNamespacePart(value: string | null | undefined, fallback: string) {
  const text = typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
  return encodeURIComponent(text).replace(/%/g, '~');
}

export function buildTreatmentMemoryNamespace(input: TreatmentMemoryNamespaceInput) {
  return [
    TREATMENT_MEMORY_NAMESPACE_PREFIX,
    safeNamespacePart(input.experimentId, 'default'),
    safeNamespacePart(input.sessionKey, 'no-session'),
    safeNamespacePart(input.peerId, 'no-peer')
  ].join(':');
}

export function isTreatmentMemoryNamespace(namespace: string) {
  return namespace === TREATMENT_MEMORY_NAMESPACE_PREFIX || namespace.startsWith(`${TREATMENT_MEMORY_NAMESPACE_PREFIX}:`);
}

export function assertTreatmentMemoryNamespace(namespace: string) {
  if (!isTreatmentMemoryNamespace(namespace)) {
    throw new Error(`Treatment memory writes require an ${TREATMENT_MEMORY_NAMESPACE_PREFIX}: namespace`);
  }
}

function iso(value: string | Date | null | undefined) {
  if (value == null) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : value;
}

function boundedScore(value: number | undefined, fallback: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback;
  }
  return Math.min(1, Math.max(0, value));
}

function createItemId(input: TreatmentMemoryWriteInput, type: AbMemoryItemType, now: Date) {
  if (input.id) {
    return input.id;
  }
  const hash = createHash('sha1')
    .update(JSON.stringify({
      namespace: input.namespace,
      type,
      subtype: input.subtype ?? null,
      content: input.content,
      createdAt: now.toISOString(),
      nonce: randomUUID()
    }))
    .digest('hex')
    .slice(0, 24);
  return `abmem_${hash}`;
}

function buildTreatmentMemoryItem(type: AbMemoryItemType, input: TreatmentMemoryWriteInput): AbMemoryStreamItem {
  assertTreatmentMemoryNamespace(input.namespace);
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  return {
    id: createItemId(input, type, now),
    namespace: input.namespace,
    arm: 'treatment',
    type,
    subtype: input.subtype ?? null,
    content: input.content,
    retrievalText: input.retrievalText ?? input.content,
    embeddingText: input.embeddingText ?? input.retrievalText ?? input.content,
    importance: boundedScore(input.importance, type === 'plan' ? 0.75 : 0.6),
    confidence: boundedScore(input.confidence, 0.8),
    status: 'active',
    sourceEventRefs: input.sourceEventRefs ?? [],
    provenance: {
      writer: 'ab-treatment-memory',
      isolation: 'treatment_only',
      ...(input.provenance ?? {})
    },
    ttlExpiresAt: iso(input.ttlExpiresAt),
    fulfilledAt: null,
    createdAt: nowIso,
    updatedAt: nowIso
  };
}

async function writeTreatmentMemoryItem(
  deps: Pick<TreatmentDeps, 'writeMemoryStreamItem' | 'now'>,
  type: AbMemoryItemType,
  input: TreatmentMemoryWriteInput
) {
  const item = buildTreatmentMemoryItem(type, { ...input, now: input.now ?? deps.now() });
  await deps.writeMemoryStreamItem(item);
  return item;
}

export function buildTreatmentObservation(input: TreatmentMemoryWriteInput) {
  return buildTreatmentMemoryItem('observation', input);
}

export function buildTreatmentReflection(input: TreatmentMemoryWriteInput) {
  return buildTreatmentMemoryItem('reflection', input);
}

export function buildTreatmentPlan(input: TreatmentPlanWriteInput) {
  return buildTreatmentMemoryItem('plan', input);
}

export function writeTreatmentObservation(
  deps: Pick<TreatmentDeps, 'writeMemoryStreamItem' | 'now'>,
  input: TreatmentMemoryWriteInput
) {
  return writeTreatmentMemoryItem(deps, 'observation', input);
}

export function writeTreatmentReflection(
  deps: Pick<TreatmentDeps, 'writeMemoryStreamItem' | 'now'>,
  input: TreatmentMemoryWriteInput
) {
  return writeTreatmentMemoryItem(deps, 'reflection', input);
}

export function writeTreatmentPlan(
  deps: Pick<TreatmentDeps, 'writeMemoryStreamItem' | 'now'>,
  input: TreatmentPlanWriteInput
) {
  return writeTreatmentMemoryItem(deps, 'plan', input);
}

export async function fulfillTreatmentPlanMemory(
  deps: Pick<TreatmentMemoryPlanMutationDeps, 'markMemoryPlanFulfilled' | 'now'>,
  plan: Pick<AbMemoryStreamItem, 'id' | 'namespace' | 'type'>,
  fulfilledAt: string | Date = deps.now()
) {
  assertTreatmentMemoryNamespace(plan.namespace);
  if (plan.type !== 'plan') {
    throw new Error(`Only treatment plan memory can be fulfilled; got ${plan.type}`);
  }
  return deps.markMemoryPlanFulfilled(plan.id, { status: 'fulfilled', fulfilledAt });
}

export async function expireDueTreatmentPlans(
  deps: TreatmentMemoryPlanMutationDeps,
  namespace: string,
  now: Date = deps.now()
) {
  assertTreatmentMemoryNamespace(namespace);
  const activePlans = await deps.listMemoryStreamItems(namespace, {
    text: '',
    types: ['plan'],
    limit: 100,
    metadata: { status: 'active' }
  });
  const expired: AbMemoryStreamItem[] = [];
  for (const plan of activePlans) {
    if (plan.type !== 'plan' || plan.status !== 'active' || !plan.ttlExpiresAt) {
      continue;
    }
    if (new Date(plan.ttlExpiresAt).getTime() <= now.getTime()) {
      expired.push(await deps.markMemoryPlanFulfilled(plan.id, { status: 'expired', fulfilledAt: now }));
    }
  }
  return expired;
}

export function createPersistenceTreatmentMemoryDeps(
  config: TreatmentMemoryPersistenceConfig = {}
): TreatmentMemoryPlanMutationDeps & Pick<TreatmentDeps, 'writeMemoryStreamItem'> {
  return {
    now: () => new Date(),
    writeMemoryStreamItem: async (item) => {
      await createAbMemoryStreamItem(item, config);
    },
    listMemoryStreamItems: async (namespace, query) => {
      const records = await listAbMemoryStreamItems({
        namespace,
        arm: 'treatment',
        type: query.types?.length === 1 ? query.types[0] : undefined,
        status: typeof query.metadata?.status === 'string' ? query.metadata.status : undefined,
        limit: query.limit
      }, config);
      return records as AbMemoryStreamItem[];
    },
    markMemoryPlanFulfilled: async (id, params) => {
      const updated = await markAbMemoryPlanFulfilled(id, params, config);
      return updated as AbMemoryStreamItem;
    }
  };
}
