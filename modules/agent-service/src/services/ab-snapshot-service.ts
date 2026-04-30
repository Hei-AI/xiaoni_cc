import crypto from 'node:crypto';
import { createAbTurnSnapshot } from '@qq-bot/persistence';
import {
  AbRetrievalPolicySnapshot,
  AbRuntimeConfigSnapshot,
  AbSceneMessage,
  AbSceneSnapshot,
  AbTurnSnapshot,
  JsonObject,
  RetrievedMemoryContext
} from './ab-types';

export interface AbSnapshotBuilderInput {
  sourceKey?: string;
  traceId?: string | null;
  runId?: string | null;
  sessionKey?: string | null;
  chatType?: string | null;
  peerId?: string | null;
  senderId?: string | null;
  queueMessageIds?: Array<string | number>;
  providerEventIds?: Array<string | number>;
  unreadMessages?: AbSceneMessage[];
  recentContext?: AbSceneMessage[];
  readCutoff?: AbSceneSnapshot['readCutoff'];
  sceneSummary?: string | null;
  sceneMetadata?: JsonObject;
  identityMetadata?: JsonObject;
  mediaMetadata?: JsonObject;
  traceMetadata?: JsonObject;
  memoryStreamView: RetrievedMemoryContext;
  retrievalPolicy: AbRetrievalPolicySnapshot;
  runtimeConfig: AbRuntimeConfigSnapshot;
}

export interface AbSnapshotPersistence {
  createAbTurnSnapshot(input: Record<string, unknown>): Promise<unknown>;
}

export interface CaptureAbTurnSnapshotResult {
  snapshot: AbTurnSnapshot | null;
  sourceKey: string;
  failedOpen: boolean;
  error?: Error;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return Object.fromEntries(entries.map(([key, entryValue]) => [key, canonicalize(entryValue)]));
  }
  return value;
}

function hashJson(prefix: string, value: unknown) {
  const digest = crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
  return `${prefix}_${digest.slice(0, 48)}`;
}

function deepClone<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value)) as T;
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object') {
    return value;
  }
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}

function compactMetadata(input: AbSnapshotBuilderInput): JsonObject | undefined {
  const metadata: JsonObject = {};
  if (input.sceneMetadata) {
    metadata.scene = deepClone(input.sceneMetadata);
  }
  if (input.identityMetadata) {
    metadata.identity = deepClone(input.identityMetadata);
  }
  if (input.mediaMetadata) {
    metadata.media = deepClone(input.mediaMetadata);
  }
  if (input.traceMetadata) {
    metadata.trace = deepClone(input.traceMetadata);
  }
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

export function buildAbSnapshotSourceKey(input: AbSnapshotBuilderInput) {
  if (input.sourceKey && input.sourceKey.trim().length > 0) {
    return input.sourceKey.trim();
  }
  return hashJson('ab_source', {
    sessionKey: input.sessionKey || null,
    chatType: input.chatType || null,
    peerId: input.peerId || null,
    senderId: input.senderId || null,
    queueMessageIds: input.queueMessageIds || [],
    providerEventIds: input.providerEventIds || [],
    readCutoff: input.readCutoff || null
  });
}

export function buildAbTurnSnapshotPayload(input: AbSnapshotBuilderInput): Readonly<Record<string, unknown>> {
  const sourceKey = buildAbSnapshotSourceKey(input);
  const scene: AbSceneSnapshot = {
    unreadMessages: deepClone(input.unreadMessages || []),
    recentContext: deepClone(input.recentContext || []),
    readCutoff: deepClone(input.readCutoff),
    summary: input.sceneSummary || null,
    metadata: compactMetadata(input)
  };
  const payload = {
    id: hashJson('ab_snap', sourceKey),
    sourceKey,
    traceId: input.traceId || null,
    runId: input.runId || null,
    sessionKey: input.sessionKey || null,
    chatType: input.chatType || null,
    peerId: input.peerId || null,
    senderId: input.senderId || null,
    queueMessageIds: deepClone(input.queueMessageIds || []),
    providerEventIds: deepClone(input.providerEventIds || []),
    scene,
    memoryStreamView: deepClone(input.memoryStreamView),
    retrievalPolicy: deepClone(input.retrievalPolicy),
    runtimeConfig: deepClone(input.runtimeConfig),
    captureStatus: 'created',
    controlStatus: 'pending',
    treatmentStatus: 'pending',
    evalStatus: 'pending'
  };

  return deepFreeze(payload);
}

function normalizeFailure(value: unknown): AbTurnSnapshot['captureError'] {
  if (!value) {
    return null;
  }
  if (typeof value === 'string') {
    return { code: 'capture_error', message: value };
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return {
      code: typeof record.code === 'string' ? record.code : 'capture_error',
      message: typeof record.message === 'string' ? record.message : JSON.stringify(record),
      retryable: typeof record.retryable === 'boolean' ? record.retryable : undefined,
      stack: typeof record.stack === 'string' ? record.stack : null,
      occurredAt: typeof record.occurredAt === 'string' ? record.occurredAt : undefined
    };
  }
  return { code: 'capture_error', message: String(value) };
}

function normalizeSnapshot(record: unknown): AbTurnSnapshot {
  const value = record && typeof record === 'object' ? record as Record<string, unknown> : {};
  return {
    id: String(value.id || ''),
    sourceKey: String(value.sourceKey || value.source_key || ''),
    traceId: typeof value.traceId === 'string' ? value.traceId : typeof value.trace_id === 'string' ? value.trace_id : null,
    runId: typeof value.runId === 'string' ? value.runId : typeof value.run_id === 'string' ? value.run_id : null,
    sessionKey: typeof value.sessionKey === 'string' ? value.sessionKey : typeof value.session_key === 'string' ? value.session_key : null,
    chatType: typeof value.chatType === 'string' ? value.chatType : typeof value.chat_type === 'string' ? value.chat_type : null,
    peerId: typeof value.peerId === 'string' ? value.peerId : typeof value.peer_id === 'string' ? value.peer_id : null,
    senderId: typeof value.senderId === 'string' ? value.senderId : typeof value.sender_id === 'string' ? value.sender_id : null,
    queueMessageIds: Array.isArray(value.queueMessageIds) ? value.queueMessageIds as Array<string | number> : Array.isArray(value.queue_message_ids) ? value.queue_message_ids as Array<string | number> : [],
    providerEventIds: Array.isArray(value.providerEventIds) ? value.providerEventIds as Array<string | number> : Array.isArray(value.provider_event_ids) ? value.provider_event_ids as Array<string | number> : [],
    scene: (value.scene && typeof value.scene === 'object' ? value.scene : {}) as AbSceneSnapshot,
    memoryStreamView: (value.memoryStreamView || value.memory_stream_view || {}) as RetrievedMemoryContext,
    retrievalPolicy: (value.retrievalPolicy || value.retrieval_policy || {}) as AbRetrievalPolicySnapshot,
    runtimeConfig: (value.runtimeConfig || value.runtime_config || {}) as AbRuntimeConfigSnapshot,
    captureStatus: value.captureStatus === 'failed' || value.capture_status === 'failed'
      ? 'failed'
      : value.captureStatus === 'partial' || value.capture_status === 'partial'
        ? 'partial'
        : 'created',
    controlStatus: (value.controlStatus || value.control_status || 'pending') as AbTurnSnapshot['controlStatus'],
    treatmentStatus: (value.treatmentStatus || value.treatment_status || 'pending') as AbTurnSnapshot['treatmentStatus'],
    evalStatus: (value.evalStatus || value.eval_status || 'pending') as AbTurnSnapshot['evalStatus'],
    captureError: normalizeFailure(value.captureError || value.capture_error),
    createdAt: String(value.createdAt || value.created_at || new Date(0).toISOString()),
    updatedAt: String(value.updatedAt || value.updated_at || new Date(0).toISOString())
  };
}

export async function captureAbTurnSnapshot(
  input: AbSnapshotBuilderInput,
  persistence: AbSnapshotPersistence = { createAbTurnSnapshot }
): Promise<CaptureAbTurnSnapshotResult> {
  const payload = buildAbTurnSnapshotPayload(input);
  const sourceKey = String(payload.sourceKey);
  try {
    const snapshot = await persistence.createAbTurnSnapshot(payload as Record<string, unknown>);
    return {
      snapshot: normalizeSnapshot(snapshot),
      sourceKey,
      failedOpen: false
    };
  } catch (error) {
    return {
      snapshot: null,
      sourceKey,
      failedOpen: true,
      error: error instanceof Error ? error : new Error(String(error))
    };
  }
}
