import { createHash } from 'crypto';

type AdmissionPriority = 'interactive' | 'background';

type QueueEntry = {
  id: number;
  priority: AdmissionPriority;
  enqueuedAt: number;
  bypassTimer?: ReturnType<typeof setTimeout>;
  resolve: (result: CodexPromptCacheAdmissionResult) => void;
};

type BucketState = {
  timestamps: number[];
  queue: QueueEntry[];
  timer?: ReturnType<typeof setTimeout>;
};

export type CodexPromptCacheAdmissionResult = {
  enabled: boolean;
  bucketKey?: string;
  admitted: boolean;
  bypassed: boolean;
  waitMs: number;
  queueDepth: number;
  priority?: AdmissionPriority;
};

type AdmissionOptions = {
  payload: Record<string, any>;
  executionMode?: string | null;
};

const DEFAULT_LIMIT_PER_WINDOW = 14;
const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_INTERACTIVE_MAX_WAIT_MS = 3_000;
const DEFAULT_PREFIX_BYTES = 8_192;

let nextEntryId = 1;

function parseBooleanEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw || !raw.trim()) {
    return fallback;
  }
  return !['0', 'false', 'no', 'off'].includes(raw.trim().toLowerCase());
}

function parsePositiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw || !raw.trim()) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeExecutionMode(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function resolvePriority(executionMode: string | null | undefined): AdmissionPriority {
  const normalized = normalizeExecutionMode(executionMode);
  if (
    normalized.includes('fork')
    || normalized.includes('heartbeat')
    || normalized.includes('subconscious')
    || normalized.endsWith('_no_persist')
  ) {
    return 'background';
  }
  return 'interactive';
}

function stableStringify(value: unknown, maxBytes: number): string {
  let serialized = '';
  try {
    serialized = JSON.stringify(value);
  } catch {
    serialized = String(value);
  }
  return serialized.length > maxBytes ? serialized.slice(0, maxBytes) : serialized;
}

function computeStablePrefixHash(payload: Record<string, any>, maxBytes: number): string {
  const prefixShape = {
    model: payload.model || null,
    instructions: payload.instructions || null,
    tools: Array.isArray(payload.tools) ? payload.tools : [],
    text: payload.text || null,
    input: Array.isArray(payload.input)
      ? payload.input.slice(0, 16)
      : payload.input
  };
  return createHash('sha256')
    .update(stableStringify(prefixShape, maxBytes))
    .digest('hex')
    .slice(0, 24);
}

function removeQueueEntry(queue: QueueEntry[], entry: QueueEntry): boolean {
  const index = queue.indexOf(entry);
  if (index < 0) {
    return false;
  }
  queue.splice(index, 1);
  return true;
}

export class CodexPromptCacheAdmissionGate {
  private readonly buckets = new Map<string, BucketState>();

  async admit(options: AdmissionOptions): Promise<CodexPromptCacheAdmissionResult> {
    if (!parseBooleanEnv('CODEX_PROMPT_CACHE_GATE_ENABLED', true)) {
      return { enabled: false, admitted: true, bypassed: false, waitMs: 0, queueDepth: 0 };
    }

    const promptCacheKey = typeof options.payload.prompt_cache_key === 'string'
      ? options.payload.prompt_cache_key.trim()
      : '';
    if (!promptCacheKey) {
      return { enabled: true, admitted: true, bypassed: false, waitMs: 0, queueDepth: 0 };
    }

    const limit = parsePositiveIntegerEnv('CODEX_PROMPT_CACHE_GATE_RPM', DEFAULT_LIMIT_PER_WINDOW);
    const windowMs = parsePositiveIntegerEnv('CODEX_PROMPT_CACHE_GATE_WINDOW_MS', DEFAULT_WINDOW_MS);
    const prefixBytes = parsePositiveIntegerEnv('CODEX_PROMPT_CACHE_GATE_PREFIX_BYTES', DEFAULT_PREFIX_BYTES);
    const priority = resolvePriority(options.executionMode);
    const bucketKey = [
      options.payload.model || 'unknown-model',
      promptCacheKey,
      computeStablePrefixHash(options.payload, prefixBytes)
    ].join(':');

    const now = Date.now();
    const bucket = this.getBucket(bucketKey);
    this.prune(bucket, now, windowMs);
    if (bucket.timestamps.length < limit && bucket.queue.length === 0) {
      bucket.timestamps.push(now);
      this.schedule(bucketKey, bucket, limit, windowMs);
      return {
        enabled: true,
        bucketKey,
        admitted: true,
        bypassed: false,
        waitMs: 0,
        queueDepth: 0,
        priority
      };
    }

    return await new Promise<CodexPromptCacheAdmissionResult>((resolve) => {
      const entry: QueueEntry = {
        id: nextEntryId++,
        priority,
        enqueuedAt: now,
        resolve
      };
      bucket.queue.push(entry);
      if (priority === 'interactive') {
        const maxWaitMs = parsePositiveIntegerEnv(
          'CODEX_PROMPT_CACHE_GATE_INTERACTIVE_MAX_WAIT_MS',
          DEFAULT_INTERACTIVE_MAX_WAIT_MS
        );
        entry.bypassTimer = setTimeout(() => {
          if (!removeQueueEntry(bucket.queue, entry)) {
            return;
          }
          const releasedAt = Date.now();
          this.prune(bucket, releasedAt, windowMs);
          bucket.timestamps.push(releasedAt);
          this.schedule(bucketKey, bucket, limit, windowMs);
          entry.resolve({
            enabled: true,
            bucketKey,
            admitted: true,
            bypassed: true,
            waitMs: Math.max(0, releasedAt - entry.enqueuedAt),
            queueDepth: bucket.queue.length,
            priority
          });
        }, maxWaitMs);
      }
      this.process(bucketKey, bucket, limit, windowMs);
    });
  }

  resetForTest() {
    for (const bucket of this.buckets.values()) {
      if (bucket.timer) {
        clearTimeout(bucket.timer);
      }
      for (const entry of bucket.queue) {
        if (entry.bypassTimer) {
          clearTimeout(entry.bypassTimer);
        }
      }
    }
    this.buckets.clear();
    nextEntryId = 1;
  }

  private getBucket(bucketKey: string): BucketState {
    let bucket = this.buckets.get(bucketKey);
    if (!bucket) {
      bucket = { timestamps: [], queue: [] };
      this.buckets.set(bucketKey, bucket);
    }
    return bucket;
  }

  private prune(bucket: BucketState, now: number, windowMs: number) {
    const cutoff = now - windowMs;
    bucket.timestamps = bucket.timestamps.filter((timestamp) => timestamp > cutoff);
  }

  private process(bucketKey: string, bucket: BucketState, limit: number, windowMs: number) {
    const now = Date.now();
    this.prune(bucket, now, windowMs);

    while (bucket.timestamps.length < limit && bucket.queue.length > 0) {
      const entry = this.dequeueNext(bucket.queue);
      if (!entry) {
        break;
      }
      if (entry.bypassTimer) {
        clearTimeout(entry.bypassTimer);
      }
      const releasedAt = Date.now();
      bucket.timestamps.push(releasedAt);
      entry.resolve({
        enabled: true,
        bucketKey,
        admitted: true,
        bypassed: false,
        waitMs: Math.max(0, releasedAt - entry.enqueuedAt),
        queueDepth: bucket.queue.length,
        priority: entry.priority
      });
    }

    this.schedule(bucketKey, bucket, limit, windowMs);
  }

  private dequeueNext(queue: QueueEntry[]): QueueEntry | null {
    if (queue.length === 0) {
      return null;
    }
    let bestIndex = 0;
    for (let index = 1; index < queue.length; index += 1) {
      const candidate = queue[index];
      const best = queue[bestIndex];
      if (!candidate || !best) {
        continue;
      }
      if (candidate.priority === 'interactive' && best.priority !== 'interactive') {
        bestIndex = index;
      } else if (candidate.priority === best.priority && candidate.id < best.id) {
        bestIndex = index;
      }
    }
    const [entry] = queue.splice(bestIndex, 1);
    return entry || null;
  }

  private schedule(bucketKey: string, bucket: BucketState, limit: number, windowMs: number) {
    if (bucket.timer) {
      clearTimeout(bucket.timer);
      bucket.timer = undefined;
    }
    const now = Date.now();
    this.prune(bucket, now, windowMs);
    if (bucket.queue.length === 0) {
      if (bucket.timestamps.length === 0) {
        this.buckets.delete(bucketKey);
      } else {
        const oldest = Math.min(...bucket.timestamps);
        const waitMs = Math.max(1, oldest + windowMs - now + 1);
        bucket.timer = setTimeout(() => this.schedule(bucketKey, bucket, limit, windowMs), waitMs);
      }
      return;
    }
    if (bucket.timestamps.length < limit) {
      bucket.timer = setTimeout(() => this.process(bucketKey, bucket, limit, windowMs), 0);
      return;
    }
    const oldest = Math.min(...bucket.timestamps);
    const waitMs = Math.max(1, oldest + windowMs - now + 1);
    bucket.timer = setTimeout(() => this.process(bucketKey, bucket, limit, windowMs), waitMs);
  }
}

export const codexPromptCacheAdmissionGate = new CodexPromptCacheAdmissionGate();

export function resetCodexPromptCacheAdmissionGateForTest() {
  codexPromptCacheAdmissionGate.resetForTest();
}
