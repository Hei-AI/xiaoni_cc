import { AIConfig, ConversationData, AgentPromptData } from '../types';
import { DatabaseManager } from './database';
export declare class AIService {
    private config;
    private database;
    private moduleLogger;
    private currentApiKeyIndex;
    private genAI;
    private promptCache;
    private cacheTimeout;
    constructor(config: AIConfig, database: DatabaseManager);
    private initializeGenAI;
    private getNextApiKey;
    private initializeDefaultPrompts;
    private getDefaultAgentPrompts;
    private getAgentPrompt;
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
    getModelInfo(): {
        name: string;
        apiKeysCount: number;
    };
}
export default AIService;
//# sourceMappingURL=ai-service-old.d.ts.map