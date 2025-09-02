import { DatabaseConfig, ConversationData, RequirementData, AgentPromptData, LogLevel, GroupChatSettings, GroupChatStats, GroupChatActivity, GroupChatOverview } from '../types';
export declare class DatabaseManager {
    private pool;
    private config;
    private moduleLogger;
    constructor(config: DatabaseConfig);
    private createConnectionPool;
    testConnection(): Promise<boolean>;
    /**
     * 确保连接使用正确的UTF-8字符集设置
     */
    private ensureUtf8Connection;
    executeQuery<T = any>(query: string, params?: any[]): Promise<T[]>;
    executeUpdate(query: string, params?: any[]): Promise<number>;
    executeBatch(query: string, paramsList: any[][]): Promise<number>;
    getConversationById(conversationId: string): Promise<ConversationData | null>;
    saveConversation(conversationData: ConversationData): Promise<boolean>;
    getConversations(userId?: number, limit?: number): Promise<ConversationData[]>;
    clearConversations(): Promise<number>;
    getRequirementById(requirementId: string): Promise<RequirementData | null>;
    saveRequirement(requirementData: RequirementData): Promise<boolean>;
    updateRequirementStatus(requirementId: string, status: string, updateFields?: Record<string, any>): Promise<boolean>;
    logSystemEvent(level: LogLevel, module: string, message: string, extraData?: Record<string, any>): Promise<void>;
    updateBotStatus(botId: string, status: string, websocketConnected?: boolean, httpServerRunning?: boolean, errorMessage?: string): Promise<boolean>;
    getConversationStats(): Promise<Record<string, any>>;
    getRequirementStats(): Promise<Record<string, any>[]>;
    getAgentPrompt(agentType: string, promptName?: string): Promise<AgentPromptData | null>;
    saveAgentPrompt(promptData: AgentPromptData): Promise<boolean>;
    getAgentPrompts(agentType?: string): Promise<AgentPromptData[]>;
    deactivateAgentPrompt(promptId: string): Promise<boolean>;
    cleanupOldData(daysToKeep?: number): Promise<Record<string, number>>;
    getSessions(userId?: number, limit?: number, status?: string): Promise<any[]>;
    getSessionById(sessionId: string): Promise<any | null>;
    private getSessionByIdFromConversations;
    /**
     * Fallback method to create mock sessions from conversations table
     */
    private getSessionsFromConversations;
    switchSessionService(sessionId: string, newService: string, reason?: string): Promise<boolean>;
    cleanupExpiredSessions(): Promise<number>;
    createSession(sessionData: {
        session_id: string;
        user_id: number;
        session_type?: string;
        current_service?: string;
        expires_at?: Date;
        conversation_context?: any;
        business_context?: any;
    }): Promise<boolean>;
    recordMessageChain(data: {
        message_id: string;
        reply_to_message_id?: string;
        user_id: number;
        session_id: string;
        depth?: number;
    }): Promise<boolean>;
    updateSessionActivity(sessionId: string, messageCount?: number): Promise<boolean>;
    getSessionHistory(sessionId: string, limit?: number): Promise<any[]>;
    getRequirements(userId?: number, limit?: number, status?: string): Promise<RequirementData[]>;
    /**
     * 获取群聊设置
     */
    getGroupChatSettings(groupId?: number): Promise<GroupChatSettings[]>;
    /**
     * 获取单个群聊设置
     */
    getGroupChatSettingById(groupId: number): Promise<GroupChatSettings | null>;
    /**
     * 保存或更新群聊设置
     */
    saveGroupChatSettings(settings: GroupChatSettings): Promise<boolean>;
    /**
     * 更新群聊设置
     */
    updateGroupChatSettings(groupId: number, updateData: Partial<GroupChatSettings>): Promise<boolean>;
    /**
     * 删除群聊设置
     */
    deleteGroupChatSettings(groupId: number): Promise<boolean>;
    /**
     * 批量操作群聊设置
     */
    bulkUpdateGroupChatSettings(groupIds: number[], updateData: Partial<GroupChatSettings>): Promise<{
        successful: number;
        failed: number;
        results: Array<{
            group_id: number;
            success: boolean;
            message?: string;
        }>;
    }>;
    /**
     * 获取群聊统计概览
     */
    getGroupChatOverview(): Promise<GroupChatOverview[]>;
    /**
     * 获取群聊活动统计
     */
    getGroupChatStats(groupId?: number, days?: number): Promise<GroupChatStats[]>;
    /**
     * 更新群聊活跃度
     */
    updateGroupActivity(groupId: number, messageCount?: number, aiResponseCount?: number): Promise<boolean>;
    /**
     * 记录群聊活动
     */
    recordGroupActivity(activity: GroupChatActivity): Promise<boolean>;
    /**
     * 获取群聊总体统计信息
     */
    getGroupChatGlobalStats(): Promise<{
        total_groups: number;
        enabled_groups: number;
        disabled_groups: number;
        total_messages_today: number;
        total_ai_responses_today: number;
        most_active_groups: Array<{
            group_id: number;
            group_name?: string;
            message_count: number;
            ai_responses: number;
        }>;
    }>;
    /**
     * 清理群聊历史数据
     */
    cleanupGroupChatData(daysToKeep?: number): Promise<{
        activity_logs_deleted: number;
        stats_deleted: number;
    }>;
    close(): Promise<void>;
}
export declare function getDatabaseManager(config: DatabaseConfig): DatabaseManager;
export default DatabaseManager;
//# sourceMappingURL=database.d.ts.map