/**
 * 🔧 P3重构：统一缓存管理系统
 * 优化缓存策略，提供多层缓存、智能过期、性能监控等功能
 */

import { logger } from './logger';
import { EventEmitter } from 'events';

// ============================================================================
// 📋 缓存类型定义
// ============================================================================

export interface CacheConfig {
  // 基础配置
  maxSize: number;              // 最大缓存项数
  defaultTTL: number;           // 默认过期时间(毫秒)
  checkInterval: number;        // 过期检查间隔(毫秒)

  // 策略配置
  evictionPolicy: 'LRU' | 'LFU' | 'FIFO';  // 驱逐策略
  enableStatistics: boolean;    // 是否启用统计
  enableEvents: boolean;        // 是否启用事件

  // 性能配置
  compactionThreshold: number;  // 压缩阈值(0-1)
  preloadRatio: number;         // 预加载比例(0-1)
}

export interface CacheItem<T> {
  key: string;
  value: T;
  createdAt: number;
  accessedAt: number;
  expiresAt: number;
  accessCount: number;
  size: number;                 // 估算的内存大小
  tags: string[];              // 缓存标签，用于批量操作
}

export interface CacheStatistics {
  // 基础统计
  totalItems: number;
  totalSize: number;
  hitCount: number;
  missCount: number;
  evictionCount: number;

  // 性能指标
  hitRate: number;
  averageAccessTime: number;
  memoryUsage: number;

  // 详细信息
  oldestItem?: Date;
  newestItem?: Date;
  mostAccessedKey?: string;
  largestItem?: string;
}

export type CacheEventType = 'hit' | 'miss' | 'set' | 'delete' | 'evict' | 'expire' | 'clear';

export interface CacheEvent<T = any> {
  type: CacheEventType;
  key: string;
  value?: T;
  reason?: string;
  timestamp: number;
}

// ============================================================================
// 🏗️ 缓存管理器实现
// ============================================================================

export class CacheManager<T = any> extends EventEmitter {
  private cache: Map<string, CacheItem<T>> = new Map();
  private config: CacheConfig;
  private moduleLogger = logger.createModuleLogger('cache-manager');

  // 统计信息
  private stats: {
    hits: number;
    misses: number;
    sets: number;
    deletes: number;
    evictions: number;
    totalAccessTime: number;
    accessCount: number;
  } = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
    evictions: 0,
    totalAccessTime: 0,
    accessCount: 0
  };

  // 访问顺序跟踪 (for LRU)
  private accessOrder: string[] = [];

  // 定时器
  private cleanupTimer: NodeJS.Timeout | null = null;
  private compactionTimer: NodeJS.Timeout | null = null;

  constructor(name: string, config: Partial<CacheConfig> = {}) {
    super();

    this.config = {
      maxSize: 1000,
      defaultTTL: 5 * 60 * 1000, // 5分钟
      checkInterval: 60 * 1000,   // 1分钟
      evictionPolicy: 'LRU',
      enableStatistics: true,
      enableEvents: true,
      compactionThreshold: 0.8,
      preloadRatio: 0.1,
      ...config
    };

    this.moduleLogger.info(`Cache Manager '${name}' initialized`, {
      config: this.config
    });

    this.startCleanupTimer();
    this.startCompactionTimer();
  }

  // ============================================================================
  // 🔍 核心缓存操作
  // ============================================================================

  /**
   * 获取缓存项
   */
  public get(key: string): T | undefined {
    const startTime = Date.now();
    const item = this.cache.get(key);

    if (!item) {
      this.recordMiss(key, startTime);
      return undefined;
    }

    // 检查是否过期
    if (this.isExpired(item)) {
      this.delete(key, 'expired');
      this.recordMiss(key, startTime);
      return undefined;
    }

    // 更新访问信息
    this.updateAccess(item);
    this.recordHit(key, startTime);

    return item.value;
  }

  /**
   * 设置缓存项
   */
  public set(key: string, value: T, ttl?: number, tags: string[] = []): boolean {
    try {
      const now = Date.now();
      const expiresAt = now + (ttl || this.config.defaultTTL);
      const estimatedSize = this.estimateSize(value);

      // 检查是否需要为新项腾出空间
      if (!this.cache.has(key) && this.shouldEvict()) {
        this.evictItems();
      }

      const item: CacheItem<T> = {
        key,
        value,
        createdAt: now,
        accessedAt: now,
        expiresAt,
        accessCount: 1,
        size: estimatedSize,
        tags
      };

      this.cache.set(key, item);
      this.updateAccessOrder(key);

      this.stats.sets++;
      this.emitEvent('set', key, value);

      this.moduleLogger.debug('Cache item set', {
        key,
        size: estimatedSize,
        ttl: ttl || this.config.defaultTTL,
        tags,
        totalItems: this.cache.size
      });

      return true;
    } catch (error) {
      this.moduleLogger.error('Failed to set cache item', { key, error });
      return false;
    }
  }

  /**
   * 删除缓存项
   */
  public delete(key: string, reason: string = 'manual'): boolean {
    const item = this.cache.get(key);
    if (!item) {
      return false;
    }

    this.cache.delete(key);
    this.removeFromAccessOrder(key);

    this.stats.deletes++;
    this.emitEvent('delete', key, item.value, reason);

    this.moduleLogger.debug('Cache item deleted', { key, reason });
    return true;
  }

  /**
   * 检查缓存项是否存在（不影响访问统计）
   */
  public has(key: string): boolean {
    const item = this.cache.get(key);
    return item !== undefined && !this.isExpired(item);
  }

  /**
   * 清空缓存
   */
  public clear(): void {
    const itemCount = this.cache.size;
    this.cache.clear();
    this.accessOrder = [];

    this.emitEvent('clear', 'all', undefined, `Cleared ${itemCount} items`);
    this.moduleLogger.info('Cache cleared', { itemCount });
  }

  // ============================================================================
  // 🎯 高级缓存操作
  // ============================================================================

  /**
   * 批量获取
   */
  public mget(keys: string[]): Map<string, T> {
    const result = new Map<string, T>();

    for (const key of keys) {
      const value = this.get(key);
      if (value !== undefined) {
        result.set(key, value);
      }
    }

    return result;
  }

  /**
   * 批量设置
   */
  public mset(items: Array<{ key: string; value: T; ttl?: number; tags?: string[] }>): number {
    let successCount = 0;

    for (const item of items) {
      if (this.set(item.key, item.value, item.ttl, item.tags)) {
        successCount++;
      }
    }

    return successCount;
  }

  /**
   * 根据标签删除
   */
  public deleteByTags(tags: string[]): number {
    let deletedCount = 0;
    const toDelete: string[] = [];

    for (const [key, item] of this.cache) {
      if (item.tags.some(tag => tags.includes(tag))) {
        toDelete.push(key);
      }
    }

    for (const key of toDelete) {
      if (this.delete(key, 'tag-based')) {
        deletedCount++;
      }
    }

    this.moduleLogger.info('Deleted items by tags', { tags, count: deletedCount });
    return deletedCount;
  }

  /**
   * 根据模式删除
   */
  public deleteByPattern(pattern: RegExp): number {
    let deletedCount = 0;
    const toDelete: string[] = [];

    for (const key of this.cache.keys()) {
      if (pattern.test(key)) {
        toDelete.push(key);
      }
    }

    for (const key of toDelete) {
      if (this.delete(key, 'pattern-based')) {
        deletedCount++;
      }
    }

    this.moduleLogger.info('Deleted items by pattern', { pattern: pattern.toString(), count: deletedCount });
    return deletedCount;
  }

  /**
   * 预热缓存
   */
  public async preload<K>(
    keys: K[],
    loader: (key: K) => Promise<T>,
    options: { concurrency?: number; ttl?: number; tags?: string[] } = {}
  ): Promise<{ loaded: number; failed: number; errors: Error[] }> {
    const { concurrency = 5, ttl, tags } = options;
    const errors: Error[] = [];
    let loaded = 0;
    let failed = 0;

    // 分批处理
    const batches = this.chunkArray(keys, concurrency);

    for (const batch of batches) {
      const promises = batch.map(async (key) => {
        try {
          const value = await loader(key);
          const cacheKey = String(key);

          if (this.set(cacheKey, value, ttl, tags)) {
            loaded++;
          } else {
            failed++;
          }
        } catch (error) {
          errors.push(error as Error);
          failed++;
        }
      });

      await Promise.allSettled(promises);
    }

    this.moduleLogger.info('Cache preload completed', {
      totalKeys: keys.length,
      loaded,
      failed,
      errorCount: errors.length
    });

    return { loaded, failed, errors };
  }

  // ============================================================================
  // 🧹 缓存维护
  // ============================================================================

  /**
   * 清理过期项
   */
  public cleanup(): number {
    const now = Date.now();
    const toDelete: string[] = [];

    for (const [key, item] of this.cache) {
      if (this.isExpired(item, now)) {
        toDelete.push(key);
      }
    }

    for (const key of toDelete) {
      this.delete(key, 'expired');
    }

    if (toDelete.length > 0) {
      this.moduleLogger.debug('Cleaned up expired items', { count: toDelete.length });
    }

    return toDelete.length;
  }

  /**
   * 缓存压缩（移除使用频率低的项）
   */
  public compact(): number {
    const targetSize = Math.floor(this.config.maxSize * (1 - this.config.compactionThreshold));
    const currentSize = this.cache.size;

    if (currentSize <= targetSize) {
      return 0;
    }

    const itemsToRemove = currentSize - targetSize;
    const sortedItems = Array.from(this.cache.entries())
      .sort((a, b) => {
        // 按访问频率和最后访问时间排序
        const aScore = a[1].accessCount + (a[1].accessedAt / 1000000);
        const bScore = b[1].accessCount + (b[1].accessedAt / 1000000);
        return aScore - bScore;
      });

    let removedCount = 0;
    for (let i = 0; i < Math.min(itemsToRemove, sortedItems.length); i++) {
      const [key] = sortedItems[i];
      if (this.delete(key, 'compaction')) {
        removedCount++;
      }
    }

    this.moduleLogger.info('Cache compaction completed', {
      removed: removedCount,
      remainingItems: this.cache.size
    });

    return removedCount;
  }

  // ============================================================================
  // 🔧 内部辅助方法
  // ============================================================================

  private isExpired(item: CacheItem<T>, now: number = Date.now()): boolean {
    return item.expiresAt <= now;
  }

  private shouldEvict(): boolean {
    return this.cache.size >= this.config.maxSize;
  }

  private evictItems(): void {
    if (this.cache.size === 0) return;

    const evictCount = Math.max(1, Math.floor(this.config.maxSize * 0.1)); // 驱逐10%
    let evicted = 0;

    switch (this.config.evictionPolicy) {
      case 'LRU':
        evicted = this.evictLRU(evictCount);
        break;
      case 'LFU':
        evicted = this.evictLFU(evictCount);
        break;
      case 'FIFO':
        evicted = this.evictFIFO(evictCount);
        break;
    }

    this.stats.evictions += evicted;
    this.moduleLogger.debug('Evicted items', {
      policy: this.config.evictionPolicy,
      count: evicted
    });
  }

  private evictLRU(count: number): number {
    let evicted = 0;

    // 从最少使用的开始驱逐
    while (evicted < count && this.accessOrder.length > 0) {
      const key = this.accessOrder[0];
      if (this.cache.has(key)) {
        this.delete(key, 'lru-eviction');
        evicted++;
      } else {
        this.accessOrder.shift(); // 移除无效的key
      }
    }

    return evicted;
  }

  private evictLFU(count: number): number {
    const items = Array.from(this.cache.entries())
      .sort((a, b) => a[1].accessCount - b[1].accessCount);

    let evicted = 0;
    for (let i = 0; i < Math.min(count, items.length); i++) {
      const [key] = items[i];
      this.delete(key, 'lfu-eviction');
      evicted++;
    }

    return evicted;
  }

  private evictFIFO(count: number): number {
    const items = Array.from(this.cache.entries())
      .sort((a, b) => a[1].createdAt - b[1].createdAt);

    let evicted = 0;
    for (let i = 0; i < Math.min(count, items.length); i++) {
      const [key] = items[i];
      this.delete(key, 'fifo-eviction');
      evicted++;
    }

    return evicted;
  }

  private updateAccess(item: CacheItem<T>): void {
    const now = Date.now();
    item.accessedAt = now;
    item.accessCount++;

    this.updateAccessOrder(item.key);
  }

  private updateAccessOrder(key: string): void {
    // 移除旧位置
    this.removeFromAccessOrder(key);
    // 添加到末尾（最近使用）
    this.accessOrder.push(key);
  }

  private removeFromAccessOrder(key: string): void {
    const index = this.accessOrder.indexOf(key);
    if (index !== -1) {
      this.accessOrder.splice(index, 1);
    }
  }

  private recordHit(key: string, startTime: number): void {
    this.stats.hits++;
    this.recordAccessTime(startTime);
    this.emitEvent('hit', key);
  }

  private recordMiss(key: string, startTime: number): void {
    this.stats.misses++;
    this.recordAccessTime(startTime);
    this.emitEvent('miss', key);
  }

  private recordAccessTime(startTime: number): void {
    const accessTime = Date.now() - startTime;
    this.stats.totalAccessTime += accessTime;
    this.stats.accessCount++;
  }

  private estimateSize(value: T): number {
    try {
      if (typeof value === 'string') {
        return value.length * 2; // 假设UTF-16编码
      }
      if (typeof value === 'number') {
        return 8;
      }
      if (typeof value === 'boolean') {
        return 4;
      }
      if (value === null || value === undefined) {
        return 4;
      }

      // 对象类型，估算JSON大小
      return JSON.stringify(value).length * 2;
    } catch {
      return 100; // 默认估算值
    }
  }

  private emitEvent(type: CacheEventType, key: string, value?: T, reason?: string): void {
    if (!this.config.enableEvents) return;

    const event: CacheEvent<T> = {
      type,
      key,
      value,
      reason,
      timestamp: Date.now()
    };

    this.emit(type, event);
    this.emit('event', event);
  }

  private chunkArray<K>(array: K[], chunkSize: number): K[][] {
    const chunks: K[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  // ============================================================================
  // ⏰ 定时器管理
  // ============================================================================

  private startCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.config.checkInterval);
  }

  private startCompactionTimer(): void {
    if (this.compactionTimer) {
      clearInterval(this.compactionTimer);
    }

    // 每10分钟检查一次是否需要压缩
    this.compactionTimer = setInterval(() => {
      if (this.cache.size > this.config.maxSize * this.config.compactionThreshold) {
        this.compact();
      }
    }, 10 * 60 * 1000);
  }

  // ============================================================================
  // 📊 统计和监控
  // ============================================================================

  /**
   * 获取缓存统计信息
   */
  public getStatistics(): CacheStatistics {
    const items = Array.from(this.cache.values());
    const totalSize = items.reduce((sum, item) => sum + item.size, 0);

    let oldestItem: Date | undefined;
    let newestItem: Date | undefined;
    let mostAccessedKey: string | undefined;
    let largestItem: string | undefined;

    if (items.length > 0) {
      oldestItem = new Date(Math.min(...items.map(item => item.createdAt)));
      newestItem = new Date(Math.max(...items.map(item => item.createdAt)));

      const mostAccessed = items.reduce((max, item) =>
        item.accessCount > max.accessCount ? item : max
      );
      mostAccessedKey = mostAccessed.key;

      const largest = items.reduce((max, item) =>
        item.size > max.size ? item : max
      );
      largestItem = largest.key;
    }

    const hitRate = this.stats.hits + this.stats.misses > 0
      ? this.stats.hits / (this.stats.hits + this.stats.misses)
      : 0;

    const averageAccessTime = this.stats.accessCount > 0
      ? this.stats.totalAccessTime / this.stats.accessCount
      : 0;

    return {
      totalItems: this.cache.size,
      totalSize,
      hitCount: this.stats.hits,
      missCount: this.stats.misses,
      evictionCount: this.stats.evictions,
      hitRate,
      averageAccessTime,
      memoryUsage: totalSize,
      oldestItem,
      newestItem,
      mostAccessedKey,
      largestItem
    };
  }

  /**
   * 重置统计信息
   */
  public resetStatistics(): void {
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      evictions: 0,
      totalAccessTime: 0,
      accessCount: 0
    };

    this.moduleLogger.info('Cache statistics reset');
  }

  /**
   * 获取缓存健康状况
   */
  public getHealthStatus(): {
    status: 'healthy' | 'warning' | 'critical';
    details: {
      size: string;
      hitRate: string;
      memoryUsage: string;
      oldestItem: string;
    };
  } {
    const stats = this.getStatistics();
    const sizeRatio = stats.totalItems / this.config.maxSize;

    let status: 'healthy' | 'warning' | 'critical' = 'healthy';

    if (sizeRatio > 0.9 || stats.hitRate < 0.5) {
      status = 'critical';
    } else if (sizeRatio > 0.7 || stats.hitRate < 0.7) {
      status = 'warning';
    }

    return {
      status,
      details: {
        size: `${stats.totalItems}/${this.config.maxSize} (${Math.round(sizeRatio * 100)}%)`,
        hitRate: `${Math.round(stats.hitRate * 100)}%`,
        memoryUsage: `${Math.round(stats.memoryUsage / 1024)}KB`,
        oldestItem: stats.oldestItem ? stats.oldestItem.toISOString() : 'N/A'
      }
    };
  }

  // ============================================================================
  // 🧹 清理和销毁
  // ============================================================================

  /**
   * 销毁缓存管理器
   */
  public destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    if (this.compactionTimer) {
      clearInterval(this.compactionTimer);
      this.compactionTimer = null;
    }

    this.clear();
    this.removeAllListeners();

    this.moduleLogger.info('Cache Manager destroyed');
  }
}

// ============================================================================
// 🎯 缓存管理器工厂
// ============================================================================

export class CacheManagerFactory {
  private static instances: Map<string, CacheManager> = new Map();

  /**
   * 获取或创建缓存管理器实例
   */
  public static getInstance<T = any>(
    name: string,
    config?: Partial<CacheConfig>
  ): CacheManager<T> {
    if (!this.instances.has(name)) {
      const instance = new CacheManager<T>(name, config);
      this.instances.set(name, instance);
    }

    return this.instances.get(name) as CacheManager<T>;
  }

  /**
   * 销毁指定的缓存管理器
   */
  public static destroy(name: string): boolean {
    const instance = this.instances.get(name);
    if (instance) {
      instance.destroy();
      this.instances.delete(name);
      return true;
    }
    return false;
  }

  /**
   * 销毁所有缓存管理器
   */
  public static destroyAll(): void {
    for (const [name, instance] of this.instances) {
      instance.destroy();
    }
    this.instances.clear();
  }

  /**
   * 获取所有缓存管理器的统计信息
   */
  public static getAllStatistics(): Record<string, CacheStatistics> {
    const stats: Record<string, CacheStatistics> = {};

    for (const [name, instance] of this.instances) {
      stats[name] = instance.getStatistics();
    }

    return stats;
  }
}

export default CacheManager;