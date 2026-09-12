// Shared across provider instances: a new caller must respect a previous caller's
// Retry-After even after that caller has disconnected or returned an error.
export class ProviderRetryWindow {
  private readonly deadlines = new Map<string, number>();

  defer(scope: string, retryAfter: unknown, now = Date.now()): number {
    const raw = String(retryAfter ?? '').trim();
    const seconds = Number(raw);
    const parsed = raw && Number.isFinite(seconds)
      ? now + Math.max(0, seconds) * 1000
      : Date.parse(raw);
    // Missing/invalid Retry-After still gets a bounded backoff, not a hot loop.
    const deadline = Number.isFinite(parsed) && parsed > now ? parsed : now + 1000;
    const next = Math.max(this.deadlines.get(scope) || 0, deadline);
    this.deadlines.set(scope, next);
    return next;
  }

  async wait(scope: string, signal?: AbortSignal): Promise<void> {
    while (true) {
      if (signal?.aborted) throw this.abortError();
      const remaining = (this.deadlines.get(scope) || 0) - Date.now();
      if (remaining <= 0) {
        this.deadlines.delete(scope);
        return;
      }
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          reject(this.abortError());
        };
        const timer = setTimeout(() => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        }, Math.min(remaining, 2_147_483_647));
        signal?.addEventListener('abort', onAbort, { once: true });
      });
      // Another response may have extended the deadline while this caller waited.
    }
  }

  private abortError(): Error {
    const error = new Error('Provider Retry-After wait aborted');
    error.name = 'AbortError';
    return error;
  }
}

export const anthropicRetryWindow = new ProviderRetryWindow();
