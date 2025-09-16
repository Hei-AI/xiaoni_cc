import axios from 'axios';
import { AIConfig, ConversationData, AgentPromptData, TokenStats, LLMCallTrace } from '../types';
import { logger } from '../utils/logger';
import { DatabaseManager } from './database';
import { getTokenManager } from '../utils/token-manager';
import { LoggingService } from './logging-service';
import { v4 as uuidv4 } from 'uuid';

export class AIService {
  private config: AIConfig;
  private database!: DatabaseManager;
  private loggingService: LoggingService;
  private moduleLogger = logger.createModuleLogger('ai-service');
  private tokenManager!: ReturnType<typeof getTokenManager>;
  private baseURL = 'https://generativelanguage.googleapis.com/v1beta/models';
  private currentToken: string | null = null;
  private promptCache: Map<string, AgentPromptData> = new Map();
  private cacheTimeout: number = 5 * 60 * 1000; // 5 minutes

  constructor(config: AIConfig, database: DatabaseManager, loggingService: LoggingService) {
    this.config = config;
    this.database = database;
    this.loggingService = loggingService;
    this.tokenManager = getTokenManager(this.database);
    // 异步初始化
    this.initializeGenAI().catch(error => {
      this.moduleLogger.error('AI service initialization failed', { error });
    });
    this.initializeDefaultPrompts();
  }

  private async initializeGenAI(): Promise<void> {
    try {
      const token = await this.tokenManager.getNextToken();
      if (!token) {
        this.moduleLogger.warn('No valid tokens available - AI features will be disabled');
        return;
      }
      
      this.currentToken = token;
      this.moduleLogger.info('Gemini AI service initialized successfully with database-backed token management');
      
      // 记录Token统计信息
      const stats = await this.tokenManager.getStats();
      this.moduleLogger.info('Token manager stats', stats);
    } catch (error) {
      this.moduleLogger.error('Failed to initialize Gemini AI service', { error });
    }
  }

  /**
   * 获取当前可用的API Token，使用数据库驱动的Token管理
   */
  private async getCurrentToken(): Promise<string | null> {
    try {
      // 如果没有当前 Token，尝试获取新Token
      if (!this.currentToken) {
        const token = await this.tokenManager.getNextToken();
        if (token) {
          this.currentToken = token;
          this.moduleLogger.debug('Got fresh token for API calls');
        }
      }
      
      return this.currentToken;
    } catch (error) {
      this.moduleLogger.error('Failed to get current token', { error });
      return null;
    }
  }
  
  /**
   * 切换到下一个可用Token (当前Token失败时调用)
   */
  private async switchToNextToken(): Promise<boolean> {
    try {
      if (this.currentToken) {
        await this.tokenManager.reportError(this.currentToken, 'API call failed, switching token');
      }
      
      const newToken = await this.tokenManager.getNextToken();
      if (newToken && newToken !== this.currentToken) {
        this.currentToken = newToken;
        this.moduleLogger.info('Switched to next available token');
        return true;
      }
      
      this.moduleLogger.warn('No alternative tokens available');
      return false;
    } catch (error) {
      this.moduleLogger.error('Failed to switch token', { error });
      return false;
    }
  }

  private async initializeDefaultPrompts(): Promise<void> {
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
    } catch (error) {
      this.moduleLogger.error('Failed to initialize default prompts', { error });
    }
  }

  private getDefaultAgentPrompts(): AgentPromptData[] {
    const now = new Date();
    return [
      {
        id: uuidv4(),
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
        id: uuidv4(),
        agent_type: 'chat_bot',
        prompt_name: 'enhanced_chat',
        system_instructions: [
          '你是阿正，一个智能QQ机器人助手，基于Gemini AI技术。你的角色特点是：',
          '1. 友好、专业、热情，具有人格化特征',
          '2. 技术能力强，能够理解和回答各种技术问题',  
          '3. 语言风格自然亲切，略带幽默感',
          '4. 能够基于对话历史提供连贯性回复',
          '5. 对用户请求给予有帮助的建议和解决方案',
          '',
          '回复要求：',
          '- 使用自然的中文表达，语气友好但专业',
          '- 根据上下文历史提供相关性强的回复',
          '- 对技术问题给出准确、有用的建议',
          '- 保持对话的连贯性和一致性',
          '- 如遇到开发需求，可提供技术指导或询问更多细节'
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
        description: '增强型聊天机器人系统指令，包含上下文感知'
      },
      {
        id: uuidv4(),
        agent_type: 'persona_chat',
        prompt_name: 'persona_chat',
        system_instructions: [
          '你是一个人格化增强处理专家。你的任务是将AI生成的标准回复转换为具有"阿正"人格特征的个性化回复。',
          '',
          '阿正的人格特点：',
          '- 友好专业的技术专家和好伙伴',
          '- 热情、乐于助人、略带幽默感',
          '- 语言风格自然亲切、不官方、像真实的同事朋友',
          '- 技术过硬，能帮助解决技术问题',
          '',
          '转换要求：',
          '1. 保持原始回复的核心信息和准确性，不能丢失重要内容',
          '2. 将语言风格转换为阿正的自然亲切表达',
          '3. 适当使用emoji增加亲和力（但不过度）',
          '4. 根据上下文调整语气和专业程度',
          '5. 保持回复长度适中，不要过长或过短',
          '6. 去除AI腔调，使回复更人性化',
          '',
          '注意：你的任务是增强润色，不是重新回答问题。必须基于提供的原始AI回复进行人格化转换。'
        ],
        model_config: {
          temperature: 0.6,
          topK: 30,
          topP: 0.9,
          maxOutputTokens: 2048
        },
        is_active: true,
        version: 1,
        created_by: 'system',
        created_at: now,
        updated_at: now,
        description: 'Persona人格化增强处理系统指令'
      },
      {
        id: uuidv4(),
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

  private async getAgentPrompt(agentType: string, promptName?: string): Promise<AgentPromptData | null> {
    const cacheKey = `${agentType}:${promptName || 'default'}`;
    
    // 检查缓存
    if (this.promptCache.has(cacheKey)) {
      const cached = this.promptCache.get(cacheKey)!;
      // 检查缓存是否过期 - 安全地处理updated_at字段
      try {
        let updatedAt: Date;
        if (cached.updated_at instanceof Date) {
          updatedAt = cached.updated_at;
        } else if (typeof cached.updated_at === 'string') {
          updatedAt = new Date(cached.updated_at);
        } else {
          // 如果updated_at无效，认为缓存已过期
          this.promptCache.delete(cacheKey);
          this.moduleLogger.warn('Invalid updated_at in cached prompt, clearing cache', { 
            cacheKey, 
            updated_at: cached.updated_at 
          });
          // 跳出缓存检查，从数据库重新获取
          return await this.getAgentPromptFromDatabase(agentType, promptName, cacheKey);
        }
        
        if (updatedAt! && Date.now() - updatedAt.getTime() < this.cacheTimeout) {
          return cached;
        }
      } catch (error) {
        this.moduleLogger.warn('Error processing cached prompt timestamp, clearing cache', { 
          error: error instanceof Error ? error.message : 'Unknown error', 
          cacheKey 
        });
      }
      this.promptCache.delete(cacheKey);
    }

    return await this.getAgentPromptFromDatabase(agentType, promptName, cacheKey);
  }

  private async getAgentPromptFromDatabase(agentType: string, promptName: string | undefined, cacheKey: string): Promise<AgentPromptData | null> {
    // 从数据库获取
    try {
      const prompt = await this.database.getAgentPrompt(agentType, promptName);
      if (prompt) {
        this.promptCache.set(cacheKey, prompt);
        return prompt;
      }
    } catch (error) {
      this.moduleLogger.error('Failed to load agent prompt from database', { error, agentType, promptName });
    }

    return null;
  }

  private async callGeminiAPI(
    prompt: string,
    agentType: string = 'chat_bot',
    promptName: string = 'default_chat',
    traceId?: string,
    userId?: number
  ): Promise<{ response: string; rawResponse: any; usedPrompt?: AgentPromptData; requestBody?: any; modelName: string } | null> {
    // 生成唯一的LLM调用ID
    const llmCallId = uuidv4();
    const callStartTime = Date.now();

    // Model-aware Token管理 - 支持重试机制
    let lastError: Error | null = null;
    let agentPrompt: AgentPromptData | null = null;
    let requestBody: any = null;
    let modelName = 'gemini-2.5-flash'; // 默认模型
    let tokenInfo: { token: string; tokenId: number; projectName: string } | null = null;
    const maxRetries = 3;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const attemptStartTime = Date.now();
        
        // 获取Agent Prompt配置
        agentPrompt = await this.getAgentPrompt(agentType, promptName);
        let systemInstructions: string[] = [];
        let modelConfig = {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 2048  // 降低输出token限制，为思考token留出空间
        };

        if (agentPrompt) {
          systemInstructions = agentPrompt.system_instructions;
          modelConfig = { ...modelConfig, ...agentPrompt.model_config };
          // 使用Agent Prompt中配置的模型名称
          modelName = agentPrompt.model_name || 'gemini-2.5-flash';
          this.moduleLogger.debug('🔍 Agent Prompt model debug', {
            agentType,
            promptName,
            agentPromptModelName: agentPrompt.model_name,
            finalModelName: modelName,
            configModelName: this.config.model_name
          });
        } else {
          this.moduleLogger.debug('🔍 No agent prompt found, using default', {
            agentType,
            promptName,
            defaultModelName: modelName,
            configModelName: this.config.model_name
          });
        }

        // 构建系统指令
        const systemContext = systemInstructions.length > 0 ? systemInstructions.join('\n') : '';
        
        // 使用Model-aware Token获取
        tokenInfo = await this.tokenManager.getTokenForModel(modelName, agentType, promptName);
        if (!tokenInfo) {
          throw new Error(`No available tokens for model ${modelName} and prompt ${agentType}/${promptName}`);
        }

        this.moduleLogger.debug('Using token for model-aware API call', {
          tokenId: tokenInfo.tokenId,
          projectName: tokenInfo.projectName,
          modelName,
          attempt
        });

        // 构建请求体
        requestBody = {
          contents: [
            {
              parts: [
                {
                  text: systemContext ? `${systemContext}\n\n${prompt}` : prompt
                }
              ]
            }
          ],
          generationConfig: {
            temperature: modelConfig.temperature,
            topK: modelConfig.topK,
            topP: modelConfig.topP,
            maxOutputTokens: modelConfig.maxOutputTokens
          }
        };

        const result = await axios.post(
          `${this.baseURL}/${modelName}:generateContent`,
          requestBody,
          {
            headers: {
              'Content-Type': 'application/json',
              'X-goog-api-key': tokenInfo.token
            },
            timeout: 30000 // 30秒超时
          }
        );

        const responseTime = Date.now() - attemptStartTime;
        const response = result.data;
        
        // 添加详细的响应结构日志用于调试
        this.moduleLogger.debug('Raw Gemini API response structure', {
          status: result.status,
          hasResponse: !!response,
          responseKeys: response ? Object.keys(response) : null,
          hasCandidates: !!response?.candidates,
          candidatesLength: response?.candidates?.length || 0,
          finishReason: response?.candidates?.[0]?.finishReason,
          safetyRatings: response?.candidates?.[0]?.safetyRatings,
          usageMetadata: response?.usageMetadata,
          error: response?.error
        });
        
        // 从 HTTP API响应中提取文本 - 改进的鲁棒解析逻辑
        let responseText: string;
        try {
          // 检查基本响应结构
          if (!response) {
            throw new Error('API响应为空');
          }
          
          if (!response.candidates) {
            this.moduleLogger.error('API响应缺少candidates字段', { 
              responseKeys: Object.keys(response),
              responseError: response.error 
            });
            throw new Error('API响应中没有candidates字段');
          }
          
          if (!Array.isArray(response.candidates) || response.candidates.length === 0) {
            this.moduleLogger.error('candidates为空或格式错误', { 
              candidatesType: typeof response.candidates,
              candidatesLength: response.candidates?.length 
            });
            throw new Error('API响应中没有候选结果');
          }
          
          const candidate = response.candidates[0];
          this.moduleLogger.debug('Processing first candidate', { 
            candidateKeys: Object.keys(candidate),
            hasContent: !!candidate.content,
            finishReason: candidate.finishReason,
            safetyRatings: candidate.safetyRatings
          });
          
          // 检查内容被过滤的情况
          if (candidate.finishReason && candidate.finishReason !== 'STOP') {
            this.moduleLogger.warn('Candidate finished with non-STOP reason', { 
              finishReason: candidate.finishReason,
              safetyRatings: candidate.safetyRatings 
            });
            
            if (candidate.finishReason === 'SAFETY') {
              throw new Error('内容被安全过滤器拦截');
            } else if (candidate.finishReason === 'RECITATION') {
              throw new Error('内容被引用检测器拦截');
            } else {
              throw new Error(`生成被终止: ${candidate.finishReason}`);
            }
          }
          
          if (!candidate.content) {
            this.moduleLogger.error('Candidate缺少content字段', { 
              candidateKeys: Object.keys(candidate) 
            });
            throw new Error('候选结果中没有内容');
          }
          
          if (!candidate.content.parts || !Array.isArray(candidate.content.parts) || candidate.content.parts.length === 0) {
            this.moduleLogger.error('Content缺少parts或parts为空', { 
              contentKeys: Object.keys(candidate.content),
              partsType: typeof candidate.content.parts,
              partsLength: candidate.content.parts?.length 
            });
            throw new Error('候选结果内容为空');
          }
          
          const firstPart = candidate.content.parts[0];
          this.moduleLogger.debug('Processing first part', {
            partKeys: Object.keys(firstPart),
            hasText: 'text' in firstPart,
            textType: typeof firstPart.text,
            textLength: firstPart.text?.length || 0
          });
          
          if (!('text' in firstPart) || typeof firstPart.text !== 'string') {
            this.moduleLogger.error('First part没有text字段或类型错误', { 
              partKeys: Object.keys(firstPart),
              textType: typeof firstPart.text 
            });
            throw new Error('候选结果第一部分没有有效的text字段');
          }
          
          responseText = firstPart.text || '';
          
          if (responseText === '') {
            this.moduleLogger.warn('Extracted text is empty but no error occurred');
            // 返回空响应，不生成错误消息
            return null;
          }
          
          // 检查是否存在编码问题（常见的UTF-8乱码特征）
          if (responseText.includes('ä') || responseText.includes('ã') || responseText.includes('â') || responseText.includes('�')) {
            this.moduleLogger.warn('Detected potential encoding issue in Gemini response', { 
              preview: responseText.substring(0, 50) + '...' 
            });
            
            // 尝试修复：假设原文本是UTF-8被误解析为latin-1
            try {
              const buffer = Buffer.from(responseText, 'latin1');
              const fixedText = buffer.toString('utf-8');
              
              // 验证修复结果是否更合理（包含合法的中文字符）
              if (/[\u4e00-\u9fa5]/.test(fixedText) && !fixedText.includes('�')) {
                responseText = fixedText;
                this.moduleLogger.info('Successfully fixed UTF-8 encoding issue');
              } else {
                // 修复失败，保持原文本
                this.moduleLogger.warn('Encoding fix failed, keeping original text');
              }
            } catch (fixError) {
              this.moduleLogger.warn('Error during encoding fix attempt', { error: fixError });
            }
          }
        } catch (error) {
          this.moduleLogger.error('Failed to extract response text - detailed analysis', { 
            error: error instanceof Error ? error.message : 'Unknown error',
            responseType: typeof response,
            responseKeys: response ? Object.keys(response) : null,
            fullResponse: JSON.stringify(response, null, 2)
          });
          throw new Error(`Failed to extract response text from Gemini API: ${error instanceof Error ? error.message : 'Unknown parsing error'}`);
        }

        // Model-aware成功处理 - 记录token使用成功
        await this.tokenManager.markTokenSuccess(tokenInfo.tokenId);

        this.moduleLogger.info('Model-aware Gemini API call successful', {
          modelName,
          agentType,
          promptName,
          responseTime,
          attempt,
          tokenId: tokenInfo.tokenId,
          projectName: tokenInfo.projectName,
          tokenUsage: response.usageMetadata
        });

        // Log successful LLM call to database
        try {
          if (traceId && this.loggingService) {
            await this.loggingService.logLLMCall({
              traceId: traceId,
              userId: userId,
              callSequence: attempt,
              agentType: agentType,
              modelName: modelName,
              promptTemplate: promptName || 'default',
              inputPrompt: prompt,
              modelConfig: {
                temperature: requestBody.generationConfig.temperature,
                topK: requestBody.generationConfig.topK,
                topP: requestBody.generationConfig.topP,
                maxOutputTokens: requestBody.generationConfig.maxOutputTokens
              },
              rawResponse: JSON.stringify(response),
              processedResponse: responseText,
              apiCallTimeMs: responseTime,
              processingTimeMs: responseTime,
              status: 'SUCCESS',
              tokenUsage: response.usageMetadata || {}
            });
          }
        } catch (loggingError) {
          this.moduleLogger.warn('Failed to log LLM call', { 
            error: loggingError, 
            llmCallId,
            traceId 
          });
        }

        return {
          response: responseText,
          rawResponse: response,
          usedPrompt: agentPrompt || undefined,
          requestBody: requestBody,
          modelName: modelName
        };
        
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown API error');
        
        // Model-aware错误处理 - 记录token失败
        if (tokenInfo) {
          await this.tokenManager.markTokenFailedForModel(tokenInfo.tokenId, modelName, lastError, 'AI Service API调用');
        }
        
        this.moduleLogger.warn(`Model-aware Gemini API call failed (attempt ${attempt}/${maxRetries})`, { 
          error: lastError.message,
          modelName,
          agentType,
          promptName,
          tokenId: tokenInfo?.tokenId,
          projectName: tokenInfo?.projectName
        });
        
        // 最后一次尝试失败，不再重试
        if (attempt >= maxRetries) {
          break;
        }
        
        // 尝试切换Token
        const switched = await this.switchToNextToken();
        if (!switched) {
          this.moduleLogger.warn('Cannot switch token, no alternatives available');
          break;
        }
        
        // 短暂延迟后重试
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }

    // 所有重试都失败，报告错误并抛出异常
    if (this.currentToken && lastError) {
      await this.tokenManager.reportError(this.currentToken, lastError.message);
    }
    
    // Log failed LLM call to database
    try {
      if (traceId && this.loggingService) {
        const totalTime = Date.now() - callStartTime;
        await this.loggingService.logLLMCall({
          traceId: traceId,
          userId: userId,
          callSequence: maxRetries,
          agentType: agentType,
          modelName: modelName,
          promptTemplate: promptName || 'default',
          inputPrompt: prompt,
          modelConfig: requestBody?.generationConfig || {},
          rawResponse: '',
          processedResponse: '',
          apiCallTimeMs: totalTime,
          processingTimeMs: totalTime,
          status: 'ERROR',
          errorMessage: lastError?.message || 'All API call attempts failed',
          tokenUsage: {}
        });
      }
    } catch (loggingError) {
      this.moduleLogger.warn('Failed to log failed LLM call', { 
        error: loggingError, 
        llmCallId,
        traceId 
      });
    }
    
    throw lastError || new Error('All API call attempts failed');
  }

  public async generateResponse(
    userMessage: string,
    userId: number,
    agentType: string = 'chat_bot',
    promptName?: string,
    traceId?: string
  ): Promise<ConversationData | null> {
    const conversationId = uuidv4();
    const timestamp = new Date();

    try {
      const callResult = await this.callGeminiAPI(userMessage, agentType, promptName, traceId, userId);
      if (!callResult) {
        return null;
      }
      const { response, rawResponse, usedPrompt, modelName } = callResult;

      const conversationData: ConversationData = {
        id: conversationId,
        user_id: userId,
        user_message: userMessage,
        ai_response: response,
        timestamp,
        response_time: 0, // Will be calculated later
        model_name: modelName,
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
        raw_response: JSON.stringify(rawResponse),
        status: 'completed', // 添加必需的status字段
        created_at: timestamp,
        updated_at: timestamp
      };

      return conversationData;
    } catch (error) {
      // 报告当前Token错误
      if (this.currentToken) {
        await this.tokenManager.reportError(
          this.currentToken, 
          error instanceof Error ? error.message : 'Unknown error'
        );
      }
      
      this.moduleLogger.error('Failed to generate AI response after all retries', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId,
        userMessage: userMessage.substring(0, 50) + '...',
        tokenStats: this.tokenManager.getStats()
      });
      
      // 不返回任何响应给用户
      return null;
    }
  }

  /**
   * Generate response with separate user message and context prompt
   * This fixes the issue where context was being saved as user message
   * Also tracks LLM calls for session analysis
   */
  // 新增：为已存在的conversation生成响应的方法
  public async generateResponseForExistingConversation(
    originalUserMessage: string,
    fullContextPrompt: string,
    userId: number,
    agentType: string = 'chat_bot',
    promptName?: string,
    traceId?: string,
    conversationId?: string,
    sessionId?: string
  ): Promise<{ ai_response: string; response_time: number; model_name: string; raw_response?: string } | null> {
    if (!conversationId) {
      this.moduleLogger.error('conversationId is required for generateResponseForExistingConversation');
      return null;
    }

    const startTime = Date.now();
    
    try {
      // 使用fullContextPrompt调用Gemini API
      const callResult = await this.callGeminiAPI(fullContextPrompt, agentType, promptName, traceId, userId);
      if (!callResult) {
        return null;
      }

      const { response, rawResponse, usedPrompt, requestBody, modelName } = callResult;
      const responseTime = Date.now() - startTime;

      // Track LLM call if session ID is provided
      if (sessionId) {
        const callSequence = await this.database.getNextCallSequence(sessionId);
        
        const llmTrace: LLMCallTrace = {
          id: uuidv4(),
          session_id: sessionId,
          conversation_id: conversationId,
          call_sequence: callSequence,
          engine_type: this.mapAgentTypeToEngine(agentType),
          model_name: modelName,
          request: requestBody ? JSON.stringify(requestBody) : undefined,
          response: rawResponse ? JSON.stringify(rawResponse) : undefined,
          prompt_tokens: rawResponse.usageMetadata?.promptTokenCount || 0,
          completion_tokens: rawResponse.usageMetadata?.candidatesTokenCount || 0,
          total_tokens: (rawResponse.usageMetadata?.promptTokenCount || 0) + (rawResponse.usageMetadata?.candidatesTokenCount || 0),
          response_time: responseTime,
          timestamp: new Date(),
          success: true
        };

        await this.database.saveLLMCallTrace(llmTrace);
      }

      return {
        ai_response: response,
        response_time: responseTime,
        model_name: modelName,
        raw_response: JSON.stringify(rawResponse)
      };
      
    } catch (error) {
      const responseTime = Date.now() - startTime;
      this.moduleLogger.error('AI response generation failed for existing conversation', {
        conversationId,
        error: error instanceof Error ? error.message : 'Unknown error',
        responseTime
      });
      return null;
    }
  }

  public async generateResponseWithContext(
    originalUserMessage: string,
    fullContextPrompt: string,
    userId: number,
    agentType: string = 'chat_bot',
    promptName?: string,
    traceId?: string,
    originalMessage?: any,
    sessionId?: string,
    existingConversationId?: string
  ): Promise<ConversationData | null> {
    const conversationId = existingConversationId || uuidv4();
    const timestamp = new Date();

    try {
      // Track LLM call if session ID is provided
      let llmTrace: LLMCallTrace | null = null;
      const startTime = Date.now();
      
      // Use fullContextPrompt for AI call but save originalUserMessage to database
      const callResult = await this.callGeminiAPI(fullContextPrompt, agentType, promptName, traceId, userId);
      if (!callResult) {
        return null;
      }
      const { response, rawResponse, usedPrompt, requestBody, modelName } = callResult;
      
      const endTime = Date.now();
      const responseTime = endTime - startTime;
      
      // Create LLM trace record if session is provided
      if (sessionId) {
        const callSequence = await this.database.getNextCallSequence(sessionId);
        
        llmTrace = {
          id: uuidv4(),
          session_id: sessionId,
          conversation_id: conversationId,
          call_sequence: callSequence,
          engine_type: this.mapAgentTypeToEngine(agentType),
          model_name: modelName,
          request: requestBody ? JSON.stringify(requestBody) : undefined,
          response: rawResponse ? JSON.stringify(rawResponse) : undefined,
          prompt_tokens: rawResponse.usageMetadata?.promptTokenCount || 0,
          completion_tokens: rawResponse.usageMetadata?.candidatesTokenCount || 0,
          total_tokens: rawResponse.usageMetadata?.totalTokenCount || 0,
          response_time: responseTime,
          timestamp: new Date(),
          success: true
        };
        
        // Save LLM trace to database
        try {
          if (llmTrace) {
            await this.database.saveLLMCallTrace(llmTrace);
          }
        } catch (traceError) {
          this.moduleLogger.warn('Failed to save LLM trace', { 
            traceError: traceError instanceof Error ? traceError.message : 'Unknown error',
            sessionId
          });
        }
      }

      const conversationData: ConversationData = {
        id: conversationId,
        user_id: userId,
        user_message: originalUserMessage, // Save original user message, not the context
        ai_response: response,
        timestamp,
        response_time: 0, // Will be calculated later
        model_name: modelName,
        raw_request: originalMessage ? JSON.stringify(originalMessage) : JSON.stringify({ 
          originalMessage: originalUserMessage,
          fullContextPrompt: fullContextPrompt,
          agentType, 
          promptName,
          usedPrompt: usedPrompt ? {
            id: usedPrompt.id,
            prompt_name: usedPrompt.prompt_name,
            version: usedPrompt.version
          } : null
        }),
        raw_response: JSON.stringify(rawResponse),
        status: 'completed', // 添加必需的status字段
        created_at: timestamp,
        updated_at: timestamp
      };

      return conversationData;
    } catch (error) {
      // 报告当前Token错误
      if (this.currentToken) {
        await this.tokenManager.reportError(
          this.currentToken, 
          error instanceof Error ? error.message : 'Unknown error'
        );
      }
      
      this.moduleLogger.error('Failed to generate AI response with context after all retries', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId,
        originalMessage: originalUserMessage.substring(0, 50) + '...',
        tokenStats: this.tokenManager.getStats()
      });
      
      // 不返回任何响应给用户
      return null;
    }
  }

  /**
   * Map agent type to engine type for LLM traces
   */
  private mapAgentTypeToEngine(agentType: string): 'decision' | 'context' | 'persona' | 'main_chat' | 'requirement' {
    switch (agentType) {
      case 'decision_analyzer':
      case 'decision_engine':
        return 'decision';
      case 'context_analyzer':
      case 'context_engine': 
        return 'context';
      case 'persona_engine':
      case 'persona_analyzer':
      case 'persona_chat':
        return 'persona';
      case 'intent_analyzer':
      case 'requirement_analyzer':
        return 'requirement';
      case 'chat_bot':
      case 'enhanced_chat':
      case 'basic_chat':
      default:
        return 'main_chat';
    }
  }

  public async analyzeIntent(
    message: string,
    userId: number,
    traceId?: string
  ): Promise<{ isRequirement: boolean; confidence: number; category?: string; complexity?: string } | null> {
    try {
      const callResult = await this.callGeminiAPI(message, 'intent_analyzer', 'requirement_analysis', traceId, userId);
      if (!callResult) {
        this.moduleLogger.warn('AI service not available, using fallback intent analysis');
        return this.fallbackIntentAnalysis(message);
      }
      const { response } = callResult;
      
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
      // 报告Token错误
      if (this.currentToken) {
        await this.tokenManager.reportError(
          this.currentToken,
          error instanceof Error ? error.message : 'Intent analysis failed'
        );
      }
      
      this.moduleLogger.warn('Intent analysis failed, using fallback', { 
        error: error instanceof Error ? error.message : 'Unknown error',
        message: message.substring(0, 50) + '...' 
      });
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

  // Agent Prompt管理方法
  public async updateAgentPrompt(promptData: AgentPromptData): Promise<boolean> {
    try {
      const success = await this.database.saveAgentPrompt(promptData);
      if (success) {
        // 清除相关缓存
        const cacheKey = `${promptData.agent_type}:${promptData.prompt_name}`;
        this.promptCache.delete(cacheKey);
        this.moduleLogger.info(`Agent prompt updated: ${promptData.id}`);
      }
      return success;
    } catch (error) {
      this.moduleLogger.error('Failed to update agent prompt', { error, id: promptData.id });
      return false;
    }
  }

  public async listAgentPrompts(agentType?: string): Promise<AgentPromptData[]> {
    try {
      return await this.database.getAgentPrompts(agentType);
    } catch (error) {
      this.moduleLogger.error('Failed to list agent prompts', { error, agentType });
      return [];
    }
  }

  public clearPromptCache(): void {
    this.promptCache.clear();
    this.moduleLogger.info('Agent prompt cache cleared');
  }

  public isAuthorizedUser(userId: number): boolean {
    return userId === this.config.authorized_user_id;
  }

  public getBotQQNumber(): number {
    return this.config.bot_qq_number;
  }

  public async getModelInfo(): Promise<{ name: string; apiKeysCount: number }> {
    const stats = await this.tokenManager.getStats();
    return {
      name: this.config.model_name,
      apiKeysCount: stats.total
    };
  }

  /**
   * 获取Token管理器统计信息
   */
  public async getTokenStats(): Promise<TokenStats> {
    return await this.tokenManager.getStats();
  }
  
  /**
   * 重新加载Token配置
   */
  public async reloadTokens(): Promise<void> {
    // 重新初始化AI服务
    this.currentToken = null;
    await this.initializeGenAI();
  }
  
  /**
   * 清除Token黑名单
   */
  public async clearTokenBlacklist(): Promise<number> {
    const clearedCount = await this.tokenManager.clearBlacklist();
    this.moduleLogger.info(`Token blacklist cleared: ${clearedCount} tokens`);
    return clearedCount;
  }
  
  /**
   * 手动触发Token健康检查
   */
  public async runTokenHealthCheck(): Promise<void> {
  }
}

export default AIService;