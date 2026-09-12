type AdmissionPriority = 'interactive' | 'background';

type QueueEntry = {
  id: number;
  priority: AdmissionPriority;
  enqueuedAt: number;
  signal?: AbortSignal;
  onAbort?: () => void;
  resolve: (result: CodexPromptCacheAdmissionResult) => void;
  reject: (error: Error) => void;
};

type BucketState = {
  // A cache namespace is a single-flight resource. This is deliberately separate
  // from `timestamps`: the RPM window limits admission starts, while `active`
  // prevents a second upstream prefill before the first one returns.
  active: boolean;
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
  release: () => void;
};

type AdmissionOptions = {
  payload: Record<string, any>;
  executionMode?: string | null;
  signal?: AbortSignal;
};

const DEFAULT_LIMIT_PER_WINDOW = 14;
const DEFAULT_WINDOW_MS = 60_000;

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

function removeQueueEntry(queue: QueueEntry[], entry: QueueEntry): boolean {
  const index = queue.indexOf(entry);
  if (index < 0) {
    return false;
  }
  queue.splice(index, 1);
  return true;
}

function createAbortError(): Error {
  const error = new Error('Prompt cache admission wait aborted');
  error.name = 'AbortError';
  return error;
}

export class CodexPromptCacheAdmissionGate {
  private readonly buckets = new Map<string, BucketState>();

  async acquire(options: AdmissionOptions): Promise<CodexPromptCacheAdmissionResult> {
    if (!parseBooleanEnv('CODEX_PROMPT_CACHE_GATE_ENABLED', true)) {
      return this.createNoopAdmission({
        enabled: false,
        admitted: true,
        bypassed: false,
        waitMs: 0,
        queueDepth: 0
      });
    }

    const promptCacheKey = typeof options.payload.prompt_cache_key === 'string'
      ? options.payload.prompt_cache_key.trim()
      : '';
    if (!promptCacheKey) {
      return this.createNoopAdmission({
        enabled: true,
        admitted: true,
        bypassed: false,
        waitMs: 0,
        queueDepth: 0
      });
    }

    if (options.signal?.aborted) {
      throw createAbortError();
    }

    const limit = parsePositiveIntegerEnv('CODEX_PROMPT_CACHE_GATE_RPM', DEFAULT_LIMIT_PER_WINDOW);
    const windowMs = parsePositiveIntegerEnv('CODEX_PROMPT_CACHE_GATE_WINDOW_MS', DEFAULT_WINDOW_MS);
    const priority = resolvePriority(options.executionMode);
    // prompt_cache_key is the caller's cache namespace. Do not add a sample of
    // `input` here: Anthropic caches system/tools before messages, so including
    // the changing history would split requests that share the same cold prefix.
    // Serializing different bodies under one namespace is conservative but safe.
    const bucketKey = [options.payload.model || 'unknown-model', promptCacheKey].join(':');

    const now = Date.now();
    const bucket = this.getBucket(bucketKey);
    this.prune(bucket, now, windowMs);
    if (!bucket.active && bucket.timestamps.length < limit && bucket.queue.length === 0) {
      bucket.active = true;
      bucket.timestamps.push(now);
      this.schedule(bucketKey, bucket, limit, windowMs);
      return this.createAdmission({
        enabled: true,
        bucketKey,
        admitted: true,
        bypassed: false,
        waitMs: 0,
        queueDepth: 0,
        priority
      }, bucketKey, bucket, limit, windowMs);
    }

    return await new Promise<CodexPromptCacheAdmissionResult>((resolve, reject) => {
      const entry: QueueEntry = {
        id: nextEntryId++,
        priority,
        enqueuedAt: now,
        signal: options.signal,
        resolve,
        reject
      };
      entry.onAbort = () => {
        if (!removeQueueEntry(bucket.queue, entry)) {
          return;
        }
        this.cleanupQueueEntry(entry);
        this.schedule(bucketKey, bucket, limit, windowMs);
        reject(createAbortError());
      };
      bucket.queue.push(entry);
      if (options.signal) {
        options.signal.addEventListener('abort', entry.onAbort, { once: true });
      }
      this.process(bucketKey, bucket, limit, windowMs);
    });
  }

  async runExclusive<T>(options: AdmissionOptions, operation: () => Promise<T>): Promise<T> {
    const admission = await this.acquire(options);
    try {
      return await operation();
    } finally {
      admission.release();
    }
  }

  resetForTest() {
    for (const bucket of this.buckets.values()) {
      if (bucket.timer) {
        clearTimeout(bucket.timer);
      }
      for (const entry of bucket.queue) {
        this.cleanupQueueEntry(entry);
        entry.reject(new Error('Prompt cache admission gate reset'));
      }
    }
    this.buckets.clear();
    nextEntryId = 1;
  }

  private getBucket(bucketKey: string): BucketState {
    let bucket = this.buckets.get(bucketKey);
    if (!bucket) {
      bucket = { active: false, timestamps: [], queue: [] };
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

    if (bucket.active || bucket.timestamps.length >= limit || bucket.queue.length === 0) {
      this.schedule(bucketKey, bucket, limit, windowMs);
      return;
    }

    const entry = this.dequeueNext(bucket.queue);
    if (!entry) {
      this.schedule(bucketKey, bucket, limit, windowMs);
      return;
    }
    const releasedAt = Date.now();
    this.cleanupQueueEntry(entry);
    bucket.active = true;
    bucket.timestamps.push(releasedAt);
    entry.resolve(this.createAdmission({
      enabled: true,
      bucketKey,
      admitted: true,
      bypassed: false,
      waitMs: Math.max(0, releasedAt - entry.enqueuedAt),
      queueDepth: bucket.queue.length,
      priority: entry.priority
    }, bucketKey, bucket, limit, windowMs));
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
      if (!bucket.active && bucket.timestamps.length === 0) {
        this.buckets.delete(bucketKey);
      } else if (!bucket.active) {
        const oldest = Math.min(...bucket.timestamps);
        const waitMs = Math.max(1, oldest + windowMs - now + 1);
        bucket.timer = setTimeout(() => this.schedule(bucketKey, bucket, limit, windowMs), waitMs);
      }
      return;
    }
    if (!bucket.active && bucket.timestamps.length < limit) {
      bucket.timer = setTimeout(() => this.process(bucketKey, bucket, limit, windowMs), 0);
      return;
    }
    if (bucket.active) {
      return;
    }
    const oldest = Math.min(...bucket.timestamps);
    const waitMs = Math.max(1, oldest + windowMs - now + 1);
    bucket.timer = setTimeout(() => this.process(bucketKey, bucket, limit, windowMs), waitMs);
  }

  private cleanupQueueEntry(entry: QueueEntry) {
    if (entry.signal && entry.onAbort) {
      entry.signal.removeEventListener('abort', entry.onAbort);
    }
    entry.onAbort = undefined;
  }

  private createNoopAdmission(
    result: Omit<CodexPromptCacheAdmissionResult, 'release'>
  ): CodexPromptCacheAdmissionResult {
    return this.createAdmission(result);
  }

  private createAdmission(
    result: Omit<CodexPromptCacheAdmissionResult, 'release'>,
    bucketKey?: string,
    bucket?: BucketState,
    limit?: number,
    windowMs?: number
  ): CodexPromptCacheAdmissionResult {
    let released = false;
    return {
      ...result,
      release: () => {
        if (released) {
          return;
        }
        released = true;
        if (!bucketKey || !bucket || this.buckets.get(bucketKey) !== bucket) {
          return;
        }
        bucket.active = false;
        this.process(
          bucketKey,
          bucket,
          limit || parsePositiveIntegerEnv('CODEX_PROMPT_CACHE_GATE_RPM', DEFAULT_LIMIT_PER_WINDOW),
          windowMs || parsePositiveIntegerEnv('CODEX_PROMPT_CACHE_GATE_WINDOW_MS', DEFAULT_WINDOW_MS)
        );
      }
    };
  }
}

export const codexPromptCacheAdmissionGate = new CodexPromptCacheAdmissionGate();

export function resetCodexPromptCacheAdmissionGateForTest() {
  codexPromptCacheAdmissionGate.resetForTest();
}
