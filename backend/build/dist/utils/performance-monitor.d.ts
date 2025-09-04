export interface PerformanceMetric {
    name: string;
    value: number;
    timestamp: Date;
    unit: string;
    tags?: Record<string, string>;
}
export interface SessionPerformanceStats {
    sessionCreationLatency: number;
    messageProcessingTime: number;
    databaseQueryTime: number;
    concurrentSessions: number;
    activeSessionCount: number;
    sessionSwitchLatency: number;
}
/**
 * 性能监控系统
 * 按照SE主督导规划的企业级性能监控标准实现
 */
export declare class PerformanceMonitor {
    private metrics;
    private timers;
    private moduleLogger;
    private readonly PERFORMANCE_THRESHOLDS;
    private static instance;
    static getInstance(): PerformanceMonitor;
    /**
     * 开始计时
     */
    startTimer(name: string): void;
    /**
     * 结束计时并记录指标
     */
    endTimer(name: string, tags?: Record<string, string>): number;
    /**
     * 记录性能指标
     */
    recordMetric(metric: PerformanceMetric): void;
    /**
     * 检查性能阈值
     */
    private checkPerformanceThreshold;
    /**
     * 测量异步操作性能
     */
    measureAsync<T>(name: string, operation: () => Promise<T>, tags?: Record<string, string>): Promise<{
        result: T;
        duration: number;
    }>;
    /**
     * 测量同步操作性能
     */
    measureSync<T>(name: string, operation: () => T, tags?: Record<string, string>): {
        result: T;
        duration: number;
    };
    /**
     * 获取Session性能统计
     */
    getSessionPerformanceStats(): SessionPerformanceStats;
    /**
     * 获取指标统计信息
     */
    getMetricStats(metricName: string, timeRangeMs?: number): {
        count: number;
        avg: number;
        min: number;
        max: number;
        p95: number;
        p99: number;
    };
    /**
     * 获取并发Session数量
     */
    private getConcurrentSessionCount;
    /**
     * 获取活跃Session数量
     */
    private getActiveSessionCount;
    /**
     * 更新Session统计指标
     */
    updateSessionMetrics(concurrentCount: number, activeCount: number): void;
    /**
     * 获取性能报告
     */
    getPerformanceReport(): {
        summary: SessionPerformanceStats;
        metrics: Record<string, any>;
        alerts: string[];
    };
    /**
     * 清理旧指标数据
     */
    cleanupOldMetrics(maxAgeMs?: number): void;
    /**
     * 重置所有指标
     */
    reset(): void;
}
export declare const performanceMonitor: PerformanceMonitor;
//# sourceMappingURL=performance-monitor.d.ts.map