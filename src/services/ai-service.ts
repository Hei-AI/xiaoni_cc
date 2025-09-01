import { GoogleGenerativeAI } from '@google/generative-ai';
import { AIConfig, ConversationData } from '../types';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

export class AIService {
  private config: AIConfig;
  private moduleLogger = logger.createModuleLogger('ai-service');
  private currentApiKeyIndex: number = 0;
  private genAI: GoogleGenerativeAI | null = null;

  constructor(config: AIConfig) {
    this.config = config;
    this.initializeGenAI();
  }

  private initializeGenAI(): void {
    if (this.config.gemini_api_keys.length === 0) {
      throw new Error('No Gemini API keys configured');
    }
    
    const apiKey = this.getNextApiKey();
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  private getNextApiKey(): string {
    if (this.config.gemini_api_keys.length === 0) {
      throw new Error('No Gemini API keys configured');
    }

    const apiKey = this.config.gemini_api_keys[this.currentApiKeyIndex];
    this.currentApiKeyIndex = (this.currentApiKeyIndex + 1) % this.config.gemini_api_keys.length;
    
    return apiKey;
  }

  private async callGeminiAPI(
    prompt: string,
    systemContext?: string
  ): Promise<{ response: string; rawResponse: any }> {
    if (!this.genAI) {
      this.initializeGenAI();
    }

    try {
      const startTime = Date.now();
      const model = this.genAI!.getGenerativeModel({ model: this.config.model_name });
      
      const fullPrompt = systemContext ? `${systemContext}\n\n${prompt}` : prompt;
      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 4096
        }
      });

      const responseTime = Date.now() - startTime;
      const response = await result.response;
      const responseText = response.text();

      this.moduleLogger.info('Gemini API call successful', {
        model: this.config.model_name,
        responseTime,
        tokenUsage: response.usageMetadata
      });

      return {
        response: responseText,
        rawResponse: response
      };
    } catch (error) {
      this.moduleLogger.error('Gemini API call failed', { 
        error,
        model: this.config.model_name,
        apiKeyIndex: this.currentApiKeyIndex 
      });
      
      // Try rotating to next API key
      if (this.config.gemini_api_keys.length > 1) {
        this.initializeGenAI();
      }
      throw error;
    }
  }

  public async generateResponse(
    userMessage: string,
    userId: number,
    context?: string
  ): Promise<ConversationData> {
    const conversationId = uuidv4();
    const timestamp = new Date();

    try {
      const systemContext = context || this.getDefaultSystemContext();
      const { response, rawResponse } = await this.callGeminiAPI(userMessage, systemContext);

      const conversationData: ConversationData = {
        id: conversationId,
        user_id: userId,
        user_message: userMessage,
        ai_response: response,
        timestamp,
        response_time: 0, // Will be calculated later
        model_name: this.config.model_name,
        raw_request: JSON.stringify({ userMessage, systemContext }),
        raw_response: JSON.stringify(rawResponse)
      };

      return conversationData;
    } catch (error) {
      this.moduleLogger.error('Failed to generate AI response', { error, userId, conversationId });
      throw error;
    }
  }

  public async analyzeIntent(
    message: string,
    userId: number
  ): Promise<{ isRequirement: boolean; confidence: number; category?: string; complexity?: string }> {
    const systemContext = `
你是一个需求分析专家。请分析用户消息是否是软件开发需求。

判断标准：
1. 包含开发相关关键词：实现、开发、修改、修复、优化、添加、创建、构建、重构、改进、升级、集成
2. 描述技术功能或系统需求
3. 要求代码修改或新功能开发

请返回JSON格式：
{
  "isRequirement": true/false,
  "confidence": 0-100,
  "category": "功能开发/bug修复/性能优化/架构重构/其他",
  "complexity": "简单/中等/复杂"
}

复杂度判断：
- 简单：单个文件修改、配置调整、简单bug修复
- 中等：多文件修改、新增功能模块
- 复杂：包含"系统"、"模块"、"功能"关键词，或消息长度>100字符，或需要架构变更
`;

    try {
      const { response } = await this.callGeminiAPI(message, systemContext);
      
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
    } catch (error) {
      this.moduleLogger.error('Failed to analyze intent', { error, userId, message });
      
      // 回退到基于关键词的简单分析
      return this.fallbackIntentAnalysis(message);
    }
  }

  private fallbackIntentAnalysis(message: string): { isRequirement: boolean; confidence: number; category?: string; complexity?: string } {
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

  private getDefaultSystemContext(): string {
    return `
你是一个智能QQ机器人助手，基于Gemini AI技术。你的特点是：

1. 友好、专业、有帮助
2. 能够理解中文对话
3. 可以协助用户进行各种咨询和交流
4. 对于技术问题能够提供有用的建议
5. 保持对话的连贯性和相关性

请用中文回复，语言要自然、亲切。如果用户提出开发需求，可以提供技术建议或引导用户提供更多详细信息。
`;
  }

  public isAuthorizedUser(userId: number): boolean {
    return userId === this.config.authorized_user_id;
  }

  public getBotQQNumber(): number {
    return this.config.bot_qq_number;
  }

  public getModelInfo(): { name: string; apiKeysCount: number } {
    return {
      name: this.config.model_name,
      apiKeysCount: this.config.gemini_api_keys.length
    };
  }
}

export default AIService;