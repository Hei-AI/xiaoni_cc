import { DatabaseManager } from '../services/database';
import { TokenStats } from '../types';
/**
 * 数据库驱动的Token Manager - 管理Gemini API Token的轮换策略
 *
 * 特性:
 * - 数据库存储Token信息，支持持久化状态管理
 * - 每日使用限制和自动重置机制
 * - 智能Token选择：优先级、权重、使用频率
 * - 健康检查机制，自动检测Token有效性
 * - 黑名单管理，自动恢复机制
 * - 完整的使用日志记录
 */
export declare class TokenManager {
    private database;
    private moduleLogger;
    private healthCheckTimer?;
    private dailyResetTimer?;
    private healthConfig?;
    constructor(database?: DatabaseManager);
    /**
     * 初始化Token管理器
     */
    private initialize;
    /**
     * 加载健康检查配置
     */
    private loadHealthConfig;
    /**
     * 获取下一个可用Token (智能策略)
     * @returns Token字符串，如果没有可用Token则返回null
     */
    getNextToken(): Promise<string | null>;
    /**
     * 报告Token使用成功
     * @param token 使用的Token
     * @param responseTimeMs 响应时间（毫秒）
     * @param geminiUsage Gemini API使用统计
     */
    reportSuccess(token: string, responseTimeMs?: number, geminiUsage?: Record<string, any>): Promise<void>;
    /**
     * 报告Token使用错误
     * @param token 出错的Token
     * @param error 错误信息
     * @param responseTimeMs 响应时间（毫秒）
     */
    reportError(token: string, error: string, responseTimeMs?: number): Promise<void>;
    /**
     * 清理过期的黑名单Token
     */
    private cleanupBlacklist;
    /**
     * 获取Token统计信息
     */
    getStats(): Promise<TokenStats>;
    /**
     * 手动清除所有黑名单
     */
    clearBlacklist(): Promise<number>;
    /**
     * 重置每日使用计数（如果需要）
     */
    private resetDailyUsageIfNeeded;
    /**
     * 记录Token操作日志
     */
    private logTokenAction;
    /**
     * 根据Token值获取Token数据
     */
    private getTokenByValue;
    /**
     * 启动健康检查定时器
     */
    private startHealthCheckTimer;
    /**
     * 启动每日重置定时器
     */
    private startDailyResetTimer;
    /**
     * 执行健康检查
     */
    private performHealthCheck;
    /**
     * 检查单个Token健康状态
     */
    private checkTokenHealth;
    /**
     * 手动触发健康检查
     */
    runHealthCheck(): Promise<void>;
    /**
     * 销毁管理器，清理定时器
     */
    destroy(): void;
}
export declare function getTokenManager(database?: DatabaseManager): TokenManager;
export declare function resetTokenManager(): void;
//# sourceMappingURL=token-manager.d.ts.map