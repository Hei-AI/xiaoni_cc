import { AIConfig, ConversationData, AgentPromptData, TokenStats } from '../types';
import { DatabaseManager } from './database';
export declare class AIService {
    private config;
    private database;
    private moduleLogger;
    private tokenManager;
    private baseURL;
    private currentToken;
    private promptCache;
    private cacheTimeout;
    constructor(config: AIConfig, database: DatabaseManager);
    private initializeGenAI;
    /**
     * 获取当前可用的API Token，使用数据库驱动的Token管理
     */
    private getCurrentToken;
    /**
     * 切换到下一个可用Token (当前Token失败时调用)
     */
    private switchToNextToken;
    private initializeDefaultPrompts;
    private getDefaultAgentPrompts;
    private getAgentPrompt;
    private getAgentPromptFromDatabase;
    private callGeminiAPI;
    generateResponse(userMessage: string, userId: number, agentType?: string, promptName?: string): Promise<ConversationData>;
    analyzeIntent(message: string, userId: number): Promise<{
        isRequirement: boolean;
        confidence: number;
        category?: string;
        complexity?: string;
    }>;
    private fallbackIntentAnalysis;
    updateAgentPrompt(promptData: AgentPromptData): Promise<boolean>;
    listAgentPrompts(agentType?: string): Promise<AgentPromptData[]>;
    clearPromptCache(): void;
    isAuthorizedUser(userId: number): boolean;
    getBotQQNumber(): number;
    getModelInfo(): Promise<{
        name: string;
        apiKeysCount: number;
    }>;
    /**
     * 获取Token管理器统计信息
     */
    getTokenStats(): Promise<TokenStats>;
    /**
     * 重新加载Token配置
     */
    reloadTokens(): Promise<void>;
    /**
     * 清除Token黑名单
     */
    clearTokenBlacklist(): Promise<number>;
    /**
     * 手动触发Token健康检查
     */
    runTokenHealthCheck(): Promise<void>;
}
export default AIService;
//# sourceMappingURL=ai-service.d.ts.map