"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AIService = void 0;
const generative_ai_1 = require("@google/generative-ai");
const logger_1 = require("../utils/logger");
const uuid_1 = require("uuid");
class AIService {
    constructor(config, database) {
        this.moduleLogger = logger_1.logger.createModuleLogger('ai-service');
        this.currentApiKeyIndex = 0;
        this.genAI = null;
        this.promptCache = new Map();
        this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
        this.config = config;
        this.database = database;
        this.initializeGenAI();
        this.initializeDefaultPrompts();
    }
    initializeGenAI() {
        if (this.config.gemini_api_keys.length === 0) {
            this.moduleLogger.warn('No Gemini API keys configured - AI features will be disabled');
            return;
        }
        // 检查API密钥是否为占位符
        const invalidKeys = this.config.gemini_api_keys.filter(key => !key || key.includes('your_') || key.length < 10);
        if (invalidKeys.length > 0) {
            this.moduleLogger.warn('Invalid or placeholder API keys detected - AI features will be disabled', { invalidKeys });
            return;
        }
        const apiKey = this.getNextApiKey();
        this.genAI = new generative_ai_1.GoogleGenerativeAI(apiKey);
        this.moduleLogger.info('Gemini AI service initialized successfully');
    }
    getNextApiKey() {
        if (this.config.gemini_api_keys.length === 0) {
            throw new Error('No Gemini API keys configured');
        }
        const apiKey = this.config.gemini_api_keys[this.currentApiKeyIndex];
        this.currentApiKeyIndex = (this.currentApiKeyIndex + 1) % this.config.gemini_api_keys.length;
        return apiKey;
    }
    async initializeDefaultPrompts() {
        try {
            // 确保默认Agent Prompts存在
            const defaultPrompts = await this.getDefaultAgentPrompts();
            for (const prompt of defaultPrompts) {
                const existing = await this.database.getAgentPrompt(prompt.agent_type, prompt.prompt_name);
                if (!existing) {
                    await this.database.saveAgentPrompt(prompt);
                    this.moduleLogger.info(`Created default agent prompt: ${prompt.agent_type}/${prompt.prompt_name}`);
                }
            }
        }
        catch (error) {
            this.moduleLogger.error('Failed to initialize default prompts', { error });
        }
    }
    getDefaultAgentPrompts() {
        const now = new Date();
        return [
            {
                id: (0, uuid_1.v4)(),
                agent_type: 'chat_bot',
                prompt_name: 'default_chat',
                system_instructions: [
                    '你是一个智能QQ机器人助手，基于Gemini AI技术。你的特点是：',
                    '1. 友好、专业、有帮助',
                    '2. 能够理解中文对话',
                    '3. 可以协助用户进行各种咨询和交流',
                    '4. 对于技术问题能够提供有用的建议',
                    '5. 保持对话的连贯性和相关性',
                    '',
                    '请用中文回复，语言要自然、亲切。如果用户提出开发需求，可以提供技术建议或引导用户提供更多详细信息。'
                ],
                model_config: {
                    temperature: 0.7,
                    topK: 40,
                    topP: 0.95,
                    maxOutputTokens: 4096
                },
                is_active: true,
                version: 1,
                created_by: 'system',
                created_at: now,
                updated_at: now,
                description: '默认聊天机器人系统指令'
            },
            {
                id: (0, uuid_1.v4)(),
                agent_type: 'intent_analyzer',
                prompt_name: 'requirement_analysis',
                system_instructions: [
                    '你是一个需求分析专家。请分析用户消息是否是软件开发需求。',
                    '',
                    '判断标准：',
                    '1. 包含开发相关关键词：实现、开发、修改、修复、优化、添加、创建、构建、重构、改进、升级、集成',
                    '2. 描述技术功能或系统需求',
                    '3. 要求代码修改或新功能开发',
                    '',
                    '请返回JSON格式：',
                    '{',
                    '  "isRequirement": true/false,',
                    '  "confidence": 0-100,',
                    '  "category": "功能开发/bug修复/性能优化/架构重构/其他",',
                    '  "complexity": "简单/中等/复杂"',
                    '}',
                    '',
                    '复杂度判断：',
                    '- 简单：单个文件修改、配置调整、简单bug修复',
                    '- 中等：多文件修改、新增功能模块',
                    '- 复杂：包含"系统"、"模块"、"功能"关键词，或消息长度>100字符，或需要架构变更'
                ],
                model_config: {
                    temperature: 0.3,
                    topK: 20,
                    topP: 0.8,
                    maxOutputTokens: 1024
                },
                is_active: true,
                version: 1,
                created_by: 'system',
                created_at: now,
                updated_at: now,
                description: '需求意图分析器系统指令'
            }
        ];
    }
    async getAgentPrompt(agentType, promptName) {
        const cacheKey = `${agentType}:${promptName || 'default'}`;
        // 检查缓存
        if (this.promptCache.has(cacheKey)) {
            const cached = this.promptCache.get(cacheKey);
            // 检查缓存是否过期
            if (Date.now() - cached.updated_at.getTime() < this.cacheTimeout) {
                return cached;
            }
            this.promptCache.delete(cacheKey);
        }
        // 从数据库获取
        try {
            const prompt = await this.database.getAgentPrompt(agentType, promptName);
            if (prompt) {
                this.promptCache.set(cacheKey, prompt);
                return prompt;
            }
        }
        catch (error) {
            this.moduleLogger.error('Failed to load agent prompt from database', { error, agentType, promptName });
        }
        return null;
    }
    async callGeminiAPI(prompt, agentType = 'chat_bot', promptName) {
        if (!this.genAI) {
            this.initializeGenAI();
        }
        try {
            const startTime = Date.now();
            // 获取Agent Prompt配置
            const agentPrompt = await this.getAgentPrompt(agentType, promptName);
            let systemInstructions = [];
            let modelConfig = {
                temperature: 0.7,
                topK: 40,
                topP: 0.95,
                maxOutputTokens: 4096
            };
            if (agentPrompt) {
                systemInstructions = agentPrompt.system_instructions;
                modelConfig = { ...modelConfig, ...agentPrompt.model_config };
            }
            // 构建系统指令
            const systemContext = systemInstructions.length > 0 ? systemInstructions.join('\n') : '';
            // 使用正确的Gemini API格式，分离系统指令和用户消息
            const model = this.genAI.getGenerativeModel({
                model: this.config.model_name,
                systemInstruction: systemContext ? systemContext : undefined
            });
            const result = await model.generateContent({
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                generationConfig: modelConfig
            });
            const responseTime = Date.now() - startTime;
            const response = await result.response;
            const responseText = response.text();
            this.moduleLogger.info('Gemini API call successful', {
                model: this.config.model_name,
                agentType,
                promptName,
                responseTime,
                tokenUsage: response.usageMetadata
            });
            return {
                response: responseText,
                rawResponse: response,
                usedPrompt: agentPrompt || undefined
            };
        }
        catch (error) {
            this.moduleLogger.error('Gemini API call failed', {
                error,
                model: this.config.model_name,
                agentType,
                promptName,
                apiKeyIndex: this.currentApiKeyIndex
            });
            // Try rotating to next API key
            if (this.config.gemini_api_keys.length > 1) {
                this.initializeGenAI();
            }
            throw error;
        }
    }
    async generateResponse(userMessage, userId, agentType = 'chat_bot', promptName) {
        const conversationId = (0, uuid_1.v4)();
        const timestamp = new Date();
        try {
            if (!this.genAI) {
                // AI服务未初始化，返回友好提示
                const fallbackResponse = '抱歉，AI服务当前不可用。请检查API密钥配置或联系管理员。';
                return {
                    id: conversationId,
                    user_id: userId,
                    user_message: userMessage,
                    ai_response: fallbackResponse,
                    timestamp,
                    response_time: 0,
                    model_name: this.config.model_name,
                    raw_request: JSON.stringify({ userMessage, agentType, promptName, note: 'AI service unavailable' }),
                    raw_response: JSON.stringify({ fallback: true })
                };
            }
            const { response, rawResponse, usedPrompt } = await this.callGeminiAPI(userMessage, agentType, promptName);
            const conversationData = {
                id: conversationId,
                user_id: userId,
                user_message: userMessage,
                ai_response: response,
                timestamp,
                response_time: 0, // Will be calculated later
                model_name: this.config.model_name,
                raw_request: JSON.stringify({
                    userMessage,
                    agentType,
                    promptName,
                    usedPrompt: usedPrompt ? {
                        id: usedPrompt.id,
                        prompt_name: usedPrompt.prompt_name,
                        version: usedPrompt.version
                    } : null
                }),
                raw_response: JSON.stringify(rawResponse)
            };
            return conversationData;
        }
        catch (error) {
            this.moduleLogger.error('Failed to generate AI response', { error, userId, conversationId, agentType, promptName });
            throw error;
        }
    }
    async analyzeIntent(message, userId) {
        if (!this.genAI) {
            this.moduleLogger.warn('AI service not available, using fallback intent analysis');
            return this.fallbackIntentAnalysis(message);
        }
        try {
            const { response } = await this.callGeminiAPI(message, 'intent_analyzer', 'requirement_analysis');
            // 尝试解析JSON响应
            const cleanedResponse = response.replace(/```json\n?|```\n?/g, '').trim();
            const result = JSON.parse(cleanedResponse);
            this.moduleLogger.debug('Intent analysis result', { userId, message, result });
            return {
                isRequirement: result.isRequirement || false,
                confidence: result.confidence || 0,
                category: result.category,
                complexity: result.complexity
            };
        }
        catch (error) {
            this.moduleLogger.error('Failed to analyze intent', { error, userId, message });
            // 回退到基于关键词的简单分析
            return this.fallbackIntentAnalysis(message);
        }
    }
    fallbackIntentAnalysis(message) {
        const requirementKeywords = [
            '实现', '开发', '修改', '修复', '优化', '添加', '创建', '构建',
            '重构', '改进', '升级', '集成', '功能', '系统', '模块'
        ];
        const complexityKeywords = ['系统', '模块', '功能', '架构'];
        let keywordCount = 0;
        let hasComplexityKeywords = false;
        requirementKeywords.forEach(keyword => {
            if (message.includes(keyword)) {
                keywordCount++;
            }
        });
        complexityKeywords.forEach(keyword => {
            if (message.includes(keyword)) {
                hasComplexityKeywords = true;
            }
        });
        const isRequirement = keywordCount > 0;
        const confidence = Math.min(keywordCount * 30, 90);
        const complexity = hasComplexityKeywords || message.length > 100 ? '复杂' : '简单';
        return {
            isRequirement,
            confidence,
            category: isRequirement ? '功能开发' : undefined,
            complexity: isRequirement ? complexity : undefined
        };
    }
    // Agent Prompt管理方法
    async updateAgentPrompt(promptData) {
        try {
            const success = await this.database.saveAgentPrompt(promptData);
            if (success) {
                // 清除相关缓存
                const cacheKey = `${promptData.agent_type}:${promptData.prompt_name}`;
                this.promptCache.delete(cacheKey);
                this.moduleLogger.info(`Agent prompt updated: ${promptData.id}`);
            }
            return success;
        }
        catch (error) {
            this.moduleLogger.error('Failed to update agent prompt', { error, id: promptData.id });
            return false;
        }
    }
    async listAgentPrompts(agentType) {
        try {
            return await this.database.getAgentPrompts(agentType);
        }
        catch (error) {
            this.moduleLogger.error('Failed to list agent prompts', { error, agentType });
            return [];
        }
    }
    clearPromptCache() {
        this.promptCache.clear();
        this.moduleLogger.info('Agent prompt cache cleared');
    }
    isAuthorizedUser(userId) {
        return userId === this.config.authorized_user_id;
    }
    getBotQQNumber() {
        return this.config.bot_qq_number;
    }
    getModelInfo() {
        return {
            name: this.config.model_name,
            apiKeysCount: this.config.gemini_api_keys.length
        };
    }
}
exports.AIService = AIService;
exports.default = AIService;
//# sourceMappingURL=ai-service-old.js.map