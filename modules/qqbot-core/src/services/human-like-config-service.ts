import { DatabaseManager } from './database';
import { GroupChatSettings, PrivateChatSettings } from '../types';
import { logger } from '../utils/logger';

export interface HumanLikeScheduleConfig {
  scanInterval: number;
  minInterval: number;
  maxInterval: number;
}

export interface HumanLikeConfigProvider {
  getConfigForSource(sourceKey: string): Promise<HumanLikeScheduleConfig>;
}

interface CacheEntry {
  config: HumanLikeScheduleConfig;
  expiresAt: number;
}

interface HumanLikeConfigServiceOptions {
  cacheTtlMs?: number;
}

export class HumanLikeConfigService implements HumanLikeConfigProvider {
  private database: DatabaseManager;
  private defaults: HumanLikeScheduleConfig;
  private cache = new Map<string, CacheEntry>();
  private cacheTtlMs: number;
  private moduleLogger = logger.createModuleLogger('human-like-config-service');

  constructor(
    database: DatabaseManager,
    defaults: HumanLikeScheduleConfig,
    options?: HumanLikeConfigServiceOptions
  ) {
    this.database = database;
    this.defaults = defaults;
    this.cacheTtlMs = options?.cacheTtlMs ?? 15_000;
  }

  async getConfigForSource(sourceKey: string): Promise<HumanLikeScheduleConfig> {
    const now = Date.now();
    const cached = this.cache.get(sourceKey);
    if (cached && cached.expiresAt > now) {
      return cached.config;
    }

    const resolved = await this.fetchConfigForSource(sourceKey);
    this.cache.set(sourceKey, {
      config: resolved,
      expiresAt: now + this.cacheTtlMs
    });
    return resolved;
  }

  invalidate(sourceKey: string): void {
    this.cache.delete(sourceKey);
  }

  invalidateGroup(groupId: number): void {
    this.invalidate(`group_${groupId}`);
  }

  invalidateUser(userId: number): void {
    this.invalidate(`user_${userId}`);
  }

  invalidateAll(): void {
    this.cache.clear();
  }

  private async fetchConfigForSource(sourceKey: string): Promise<HumanLikeScheduleConfig> {
    const match = sourceKey.match(/^(group|user)_(\d+)$/);
    if (!match) {
      this.moduleLogger.warn('Invalid sourceKey for config resolution', { sourceKey });
      return { ...this.defaults };
    }

    const [, kind, idStr] = match;
    const numericId = Number(idStr);
    if (!Number.isFinite(numericId)) {
      this.moduleLogger.warn('Invalid numeric identifier for sourceKey', { sourceKey });
      return { ...this.defaults };
    }

    let overrides: Partial<HumanLikeScheduleConfig> | null = null;
    try {
      if (kind === 'group') {
        const settings = await this.database.getGroupChatSettingById(numericId);
        overrides = this.extractOverrides(settings);
      } else {
        const settings = await this.database.getPrivateChatSettingById(numericId);
        overrides = this.extractOverrides(settings);
      }
    } catch (error) {
      this.moduleLogger.error('Failed to fetch config overrides', {
        error: error instanceof Error ? error.message : 'Unknown error',
        sourceKey
      });
    }

    return this.composeConfig(overrides);
  }

  private extractOverrides(
    settings: GroupChatSettings | PrivateChatSettings | null
  ): Partial<HumanLikeScheduleConfig> | null {
    if (!settings) {
      return null;
    }

    return {
      scanInterval: this.sanitizeOverride(settings.human_like_scan_interval_ms),
      minInterval: this.sanitizeOverride(settings.human_like_min_interval_ms),
      maxInterval: this.sanitizeOverride(settings.human_like_max_interval_ms)
    };
  }

  private sanitizeOverride(value?: number | null): number | undefined {
    if (value === null || value === undefined) {
      return undefined;
    }
    if (!Number.isFinite(value) || value <= 0) {
      return undefined;
    }
    return Math.round(value);
  }

  private composeConfig(
    overrides?: Partial<HumanLikeScheduleConfig> | null
  ): HumanLikeScheduleConfig {
    const scan = overrides?.scanInterval ?? this.defaults.scanInterval;
    const minInterval = overrides?.minInterval ?? this.defaults.minInterval;
    const maxInterval = overrides?.maxInterval ?? this.defaults.maxInterval;

    if (minInterval > maxInterval) {
      this.moduleLogger.warn('Invalid interval overrides detected, reverting to defaults', {
        overrides
      });
      return { ...this.defaults };
    }

    let effectiveScan = scan;
    if (effectiveScan < minInterval) {
      effectiveScan = minInterval;
    }
    if (effectiveScan > maxInterval) {
      effectiveScan = maxInterval;
    }

    return {
      scanInterval: effectiveScan,
      minInterval,
      maxInterval
    };
  }
}

export default HumanLikeConfigService;
