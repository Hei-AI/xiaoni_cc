import { logger } from '../utils/logger';

type RawLimitWindow = {
  usedPercent: number;
  windowDurationMins: number;
  resetsAt: number;
};

type RawUsageWindow = {
  used_percent?: number;
  limit_window_seconds?: number;
  reset_at?: number;
};

type RateLimitWindow = {
  usedPercent: number;
  windowDurationMins: number;
  resetsAt: string | null;
};

type RateLimitSnapshot = {
  primary: RateLimitWindow | null;
  secondary: RateLimitWindow | null;
  checkedAt: string;
};

type CachedRateLimitSnapshot = {
  expiresAtMs: number;
  value: RateLimitSnapshot | null;
};

const moduleLogger = logger.createModuleLogger('codex-rate-limit-service');
const CACHE_TTL_MS = Math.max(10_000, Number.parseInt(process.env.CODEX_RATE_LIMIT_CACHE_TTL_MS || '60000', 10));
const PROBE_TIMEOUT_MS = Math.max(5_000, Number.parseInt(process.env.CODEX_RATE_LIMIT_TIMEOUT_MS || '10000', 10));
const RATE_LIMIT_URL = 'https://chatgpt.com/backend-api/wham/usage';

function toIsoTimestamp(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  const ms = value < 1_000_000_000_000 ? value * 1000 : value;
  return new Date(ms).toISOString();
}

function normalizeWindow(input: unknown): RateLimitWindow | null {
  if (!input || typeof input !== 'object') {
    return null;
  }
  const value = input as Partial<RawLimitWindow>;
  if (typeof value.usedPercent !== 'number' || typeof value.windowDurationMins !== 'number') {
    return null;
  }
  return {
    usedPercent: value.usedPercent,
    windowDurationMins: value.windowDurationMins,
    resetsAt: toIsoTimestamp(value.resetsAt)
  };
}

function normalizeUsageWindow(input: unknown): RateLimitWindow | null {
  if (!input || typeof input !== 'object') {
    return null;
  }
  const value = input as RawUsageWindow;
  if (typeof value.used_percent !== 'number' || typeof value.limit_window_seconds !== 'number') {
    return null;
  }
  return {
    usedPercent: value.used_percent,
    windowDurationMins: Math.round(value.limit_window_seconds / 60),
    resetsAt: toIsoTimestamp(value.reset_at)
  };
}

export class CodexRateLimitService {
  private readonly cache = new Map<string, CachedRateLimitSnapshot>();

  async getAccountRateLimits(params: {
    accountId: string;
    authPayload: Record<string, unknown>;
  }): Promise<RateLimitSnapshot | null> {
    const cached = this.cache.get(params.accountId);
    if (cached && cached.expiresAtMs > Date.now()) {
      return cached.value;
    }

    const snapshot = await this.fetchRateLimitsViaHttp(params.authPayload).catch((error) => {
      moduleLogger.warn('Failed to fetch Codex rate limits for account', {
        accountId: params.accountId,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    });

    this.cache.set(params.accountId, {
      expiresAtMs: Date.now() + CACHE_TTL_MS,
      value: snapshot
    });

    return snapshot;
  }

  private async fetchRateLimitsViaHttp(authPayload: Record<string, unknown>) {
    const tokens = (authPayload.tokens && typeof authPayload.tokens === 'object')
      ? authPayload.tokens as Record<string, unknown>
      : null;
    const accessToken = typeof tokens?.access_token === 'string' ? tokens.access_token : null;
    if (!accessToken) {
      throw new Error('codex account access token missing');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

    try {
      const response = await fetch(RATE_LIMIT_URL, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
          'User-Agent': 'qq-bot-provider-service/1.0'
        },
        signal: controller.signal
      });

      const text = await response.text();
      if (!response.ok) {
        throw new Error(`rate limit request failed with ${response.status}: ${text.slice(0, 300)}`);
      }

      const payload = JSON.parse(text) as {
        rate_limit?: {
          primary_window?: RawUsageWindow | null;
          secondary_window?: RawUsageWindow | null;
        } | null;
      };
      const rateLimit = payload.rate_limit || null;

      return {
        primary: normalizeUsageWindow(rateLimit?.primary_window ?? null) || normalizeWindow(rateLimit?.primary_window ?? null),
        secondary: normalizeUsageWindow(rateLimit?.secondary_window ?? null) || normalizeWindow(rateLimit?.secondary_window ?? null),
        checkedAt: new Date().toISOString()
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

export const codexRateLimitService = new CodexRateLimitService();
