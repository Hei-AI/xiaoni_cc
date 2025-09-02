import { DatabaseConfig, ConversationData, RequirementData, AgentPromptData, LogLevel } from '../types';
export declare class DatabaseManager {
    private pool;
    private config;
    private moduleLogger;
    constructor(config: DatabaseConfig);
    private createConnectionPool;
    testConnection(): Promise<boolean>;
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
    close(): Promise<void>;
}
export declare function getDatabaseManager(config: DatabaseConfig): DatabaseManager;
export default DatabaseManager;
//# sourceMappingURL=database.d.ts.map