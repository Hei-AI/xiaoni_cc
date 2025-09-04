import { DatabaseManager } from './database';
import { RequirementData } from '../types';
export declare class RemoteClaudeService {
    private database;
    private moduleLogger;
    private readonly sessionName;
    private readonly scriptPath;
    constructor(database: DatabaseManager);
    /**
     * 检查Claude Code远程会话是否存在
     */
    checkRemoteSession(): Promise<boolean>;
    /**
     * 处理需求 - 核心方法
     */
    processRequirement(requirementData: RequirementData): Promise<void>;
    /**
     * 执行Claude Code命令并获取输出
     */
    private executeClaudeCodeCommand;
    /**
     * 捕获Claude Code会话的输出
     */
    private captureClaudeCodeOutput;
    /**
     * 清理tmux输出，提取有用信息
     */
    private cleanTmuxOutput;
    /**
     * 获取处理状态统计
     */
    getProcessingStats(): Promise<{
        total: number;
        processing: number;
        completed: number;
        failed: number;
    }>;
    /**
     * 清理长时间处理中的需求 (超过1小时自动标记为失败)
     */
    cleanupStaleRequirements(): Promise<number>;
    /**
     * 健康检查
     */
    healthCheck(): Promise<{
        remoteSessionExists: boolean;
        scriptsAvailable: boolean;
        stats: any;
    }>;
}
export default RemoteClaudeService;
//# sourceMappingURL=remote-claude-service.d.ts.map