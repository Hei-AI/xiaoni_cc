"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.performanceMonitor = exports.PerformanceMonitor = void 0;
const logger_1 = require("./logger");
/**
 * 性能监控系统
 * 按照SE主督导规划的企业级性能监控标准实现
 */
class PerformanceMonitor {
    constructor() {
        this.metrics = new Map();
        this.timers = new Map();
        this.moduleLogger = logger_1.logger.createModuleLogger('performance-monitor');
        // 性能基准值 - 根据SE建议设定
        this.PERFORMANCE_THRESHOLDS = {
            SESSION_CREATION_MAX_MS: 100, // Session创建最大100ms
            MESSAGE_PROCESSING_MAX_MS: 200, // 消息处理最大200ms  
            DATABASE_QUERY_MAX_MS: 50, // 数据库查询最大50ms
            CONCURRENT_SESSIONS_MAX: 1000, // 最大并发Session数
            SESSION_SWITCH_MAX_MS: 80 // Session切换最大80ms
        };
    }
    static getInstance() {
        if (!PerformanceMonitor.instance) {
            PerformanceMonitor.instance = new PerformanceMonitor();
        }
        return PerformanceMonitor.instance;
    }
    /**
     * 开始计时
     */
    startTimer(name) {
        this.timers.set(name, performance.now());
    }
    /**
     * 结束计时并记录指标
     */
    endTimer(name, tags) {
        const startTime = this.timers.get(name);
        if (!startTime) {
            this.moduleLogger.warn(`Timer '${name}' not found`);
            return 0;
        }
        const duration = performance.now() - startTime;
        this.timers.delete(name);
        this.recordMetric({
            name,
            value: duration,
            timestamp: new Date(),
            unit: 'ms',
            tags
        });
        return duration;
    }
    /**
     * 记录性能指标
     */
    recordMetric(metric) {
        if (!this.metrics.has(metric.name)) {
            this.metrics.set(metric.name, []);
        }
        const metricList = this.metrics.get(metric.name);
        metricList.push(metric);
        // 保持最近1000个指标记录
        if (metricList.length > 1000) {
            metricList.shift();
        }
        // 检查是否超出性能阈值
        this.checkPerformanceThreshold(metric);
    }
    /**
     * 检查性能阈值
     */
    checkPerformanceThreshold(metric) {
        let threshold = 0;
        let alertLevel = 'warn';
        switch (metric.name) {
            case 'session_creation':
                threshold = this.PERFORMANCE_THRESHOLDS.SESSION_CREATION_MAX_MS;
                break;
            case 'message_processing':
                threshold = this.PERFORMANCE_THRESHOLDS.MESSAGE_PROCESSING_MAX_MS;
                break;
            case 'database_query':
                threshold = this.PERFORMANCE_THRESHOLDS.DATABASE_QUERY_MAX_MS;
                break;
            case 'session_switch':
                threshold = this.PERFORMANCE_THRESHOLDS.SESSION_SWITCH_MAX_MS;
                break;
        }
        if (threshold > 0 && metric.value > threshold) {
            alertLevel = metric.value > threshold * 2 ? 'error' : 'warn';
            this.moduleLogger[alertLevel](`Performance threshold exceeded`, {
                metric: metric.name,
                value: metric.value,
                threshold,
                unit: metric.unit,
                tags: metric.tags
            });
        }
    }
    /**
     * 测量异步操作性能
     */
    async measureAsync(name, operation, tags) {
        this.startTimer(name);
        try {
            const result = await operation();
            const duration = this.endTimer(name, tags);
            return { result, duration };
        }
        catch (error) {
            this.endTimer(name, { ...tags, error: 'true' });
            throw error;
        }
    }
    /**
     * 测量同步操作性能
     */
    measureSync(name, operation, tags) {
        this.startTimer(name);
        try {
            const result = operation();
            const duration = this.endTimer(name, tags);
            return { result, duration };
        }
        catch (error) {
            this.endTimer(name, { ...tags, error: 'true' });
            throw error;
        }
    }
    /**
     * 获取Session性能统计
     */
    getSessionPerformanceStats() {
        const now = Date.now();
        const oneHourAgo = now - 3600000; // 1小时前
        const getRecentMetricAvg = (metricName) => {
            const metrics = this.metrics.get(metricName) || [];
            const recentMetrics = metrics.filter(m => m.timestamp.getTime() > oneHourAgo);
            if (recentMetrics.length === 0)
                return 0;
            const sum = recentMetrics.reduce((acc, m) => acc + m.value, 0);
            return sum / recentMetrics.length;
        };
        return {
            sessionCreationLatency: getRecentMetricAvg('session_creation'),
            messageProcessingTime: getRecentMetricAvg('message_processing'),
            databaseQueryTime: getRecentMetricAvg('database_query'),
            concurrentSessions: this.getConcurrentSessionCount(),
            activeSessionCount: this.getActiveSessionCount(),
            sessionSwitchLatency: getRecentMetricAvg('session_switch')
        };
    }
    /**
     * 获取指标统计信息
     */
    getMetricStats(metricName, timeRangeMs = 3600000) {
        const metrics = this.metrics.get(metricName) || [];
        const cutoffTime = Date.now() - timeRangeMs;
        const recentMetrics = metrics
            .filter(m => m.timestamp.getTime() > cutoffTime)
            .map(m => m.value)
            .sort((a, b) => a - b);
        if (recentMetrics.length === 0) {
            return { count: 0, avg: 0, min: 0, max: 0, p95: 0, p99: 0 };
        }
        const sum = recentMetrics.reduce((acc, val) => acc + val, 0);
        const p95Index = Math.floor(recentMetrics.length * 0.95);
        const p99Index = Math.floor(recentMetrics.length * 0.99);
        return {
            count: recentMetrics.length,
            avg: sum / recentMetrics.length,
            min: recentMetrics[0],
            max: recentMetrics[recentMetrics.length - 1],
            p95: recentMetrics[p95Index] || 0,
            p99: recentMetrics[p99Index] || 0
        };
    }
    /**
     * 获取并发Session数量
     */
    getConcurrentSessionCount() {
        const concurrentMetrics = this.metrics.get('concurrent_sessions') || [];
        if (concurrentMetrics.length === 0)
            return 0;
        const latestMetric = concurrentMetrics[concurrentMetrics.length - 1];
        return latestMetric.value;
    }
    /**
     * 获取活跃Session数量
     */
    getActiveSessionCount() {
        const activeMetrics = this.metrics.get('active_sessions') || [];
        if (activeMetrics.length === 0)
            return 0;
        const latestMetric = activeMetrics[activeMetrics.length - 1];
        return latestMetric.value;
    }
    /**
     * 更新Session统计指标
     */
    updateSessionMetrics(concurrentCount, activeCount) {
        this.recordMetric({
            name: 'concurrent_sessions',
            value: concurrentCount,
            timestamp: new Date(),
            unit: 'count'
        });
        this.recordMetric({
            name: 'active_sessions',
            value: activeCount,
            timestamp: new Date(),
            unit: 'count'
        });
        // 检查并发Session数量是否超出阈值
        if (concurrentCount > this.PERFORMANCE_THRESHOLDS.CONCURRENT_SESSIONS_MAX) {
            this.moduleLogger.warn(`High concurrent session count`, {
                current: concurrentCount,
                threshold: this.PERFORMANCE_THRESHOLDS.CONCURRENT_SESSIONS_MAX
            });
        }
    }
    /**
     * 获取性能报告
     */
    getPerformanceReport() {
        const summary = this.getSessionPerformanceStats();
        const alerts = [];
        // 检查各项性能指标
        const metrics = {
            session_creation: this.getMetricStats('session_creation'),
            message_processing: this.getMetricStats('message_processing'),
            database_query: this.getMetricStats('database_query'),
            session_switch: this.getMetricStats('session_switch')
        };
        // 生成性能告警
        Object.entries(this.PERFORMANCE_THRESHOLDS).forEach(([key, threshold]) => {
            const metricName = key.toLowerCase().replace(/_max_ms$/, '').replace(/_/g, '_');
            const stats = metrics[metricName];
            if (stats && stats.avg > threshold) {
                alerts.push(`${metricName} average (${stats.avg.toFixed(2)}ms) exceeds threshold (${threshold}ms)`);
            }
        });
        return { summary, metrics, alerts };
    }
    /**
     * 清理旧指标数据
     */
    cleanupOldMetrics(maxAgeMs = 86400000) {
        const cutoffTime = Date.now() - maxAgeMs;
        for (const [name, metricList] of this.metrics.entries()) {
            const filteredMetrics = metricList.filter(m => m.timestamp.getTime() > cutoffTime);
            this.metrics.set(name, filteredMetrics);
        }
        this.moduleLogger.info(`Cleaned up old performance metrics`, {
            cutoffTime: new Date(cutoffTime).toISOString()
        });
    }
    /**
     * 重置所有指标
     */
    reset() {
        this.metrics.clear();
        this.timers.clear();
        this.moduleLogger.info('Performance metrics reset');
    }
}
exports.PerformanceMonitor = PerformanceMonitor;
// 导出单例实例
exports.performanceMonitor = PerformanceMonitor.getInstance();
//# sourceMappingURL=performance-monitor.js.map