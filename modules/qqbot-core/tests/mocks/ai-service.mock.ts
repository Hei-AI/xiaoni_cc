/**
 * AI Service Mock for Testing
 * 模拟AI服务的各种响应情况
 */

import { AIConfig } from '../../src/types';
import { testConfig } from './test-data';

export class MockAIService {
  private config: AIConfig;
  private shouldFailIntentAnalysis: boolean = false;
  private shouldFailResponseGeneration: boolean = false;

  constructor(config?: Partial<AIConfig>) {
    this.config = {
      gemini_api_keys: testConfig.testApiKeys,
      model_name: testConfig.modelName,
      authorized_user_id: testConfig.authorizedUserId,
      bot_qq_number: testConfig.botQQNumber,
      ...config,
    };
  }

  // Mock intent analysis results
  async analyzeIntent(message: string, userId: number) {
    if (this.shouldFailIntentAnalysis) {
      throw new Error('Mock AI service intent analysis failed');
    }

    // Simulate different intent analysis results based on message content
    if (message.includes('实现') && message.includes('功能') && message.length > 50) {
      return {
        isRequirement: true,
        confidence: 85,
        category: '功能开发',
        complexity: '中等',
        reasoning: '包含明确的开发需求描述'
      };
    }

    if (message.includes('bug') || message.includes('错误') || message.includes('问题')) {
      return {
        isRequirement: true,
        confidence: 70,
        category: '问题解决',
        complexity: '简单',
        reasoning: '包含技术问题关键词'
      };
    }

    return {
      isRequirement: false,
      confidence: 30,
      category: '普通对话',
      complexity: '无',
      reasoning: '未识别到明确需求'
    };
  }

  // Mock response generation
  async generateResponse(message: string, userId: number) {
    if (this.shouldFailResponseGeneration) {
      throw new Error('Mock AI service response generation failed');
    }

    // Simulate different responses based on message content
    let response = '';
    
    if (message.includes('技术') || message.includes('代码') || message.includes('bug')) {
      response = '我了解你遇到的技术问题。让我来帮你分析一下可能的解决方案...';
    } else if (message.includes('天气')) {
      response = '是啊，今天天气确实不错呢！适合外出走走。';
    } else if (message.includes('你好')) {
      response = '你好！很高兴与你对话，有什么我可以帮助你的吗？';
    } else {
      response = '我理解你的意思。让我想想怎么回应比较好...';
    }

    return {
      id: `conversation_${Date.now()}_${userId}`,
      user_id: userId,
      user_message: message,
      ai_response: response,
      timestamp: new Date(),
      response_time: 150, // Mock 150ms response time
      model_name: this.config.model_name,
      created_at: new Date(),
      updated_at: new Date(),
    };
  }

  // Mock helper methods
  isAuthorizedUser(userId: number): boolean {
    return userId === this.config.authorized_user_id;
  }

  getBotQQNumber(): number {
    return this.config.bot_qq_number;
  }

  async getModelInfo() {
    return {
      name: this.config.model_name,
      version: '1.0',
      provider: 'mock',
    };
  }

  // Test helpers to control mock behavior
  setShouldFailIntentAnalysis(shouldFail: boolean) {
    this.shouldFailIntentAnalysis = shouldFail;
  }

  setShouldFailResponseGeneration(shouldFail: boolean) {
    this.shouldFailResponseGeneration = shouldFail;
  }

  // Mock LLM analysis for decision engine
  async analyzeLLM(prompt: string): Promise<{ response: string; confidence: number }> {
    if (this.shouldFailResponseGeneration) {
      throw new Error('Mock LLM analysis failed');
    }

    // Simulate LLM decision analysis
    if (prompt.includes('垃圾') || prompt.includes('spam')) {
      return {
        response: '这是垃圾信息，不建议回复',
        confidence: 90
      };
    }

    if (prompt.includes('技术') || prompt.includes('问题') || prompt.includes('帮助')) {
      return {
        response: '这是有意义的技术询问，建议回复',
        confidence: 85
      };
    }

    if (prompt.includes('需求') || prompt.includes('实现') || prompt.includes('开发')) {
      return {
        response: '这是开发需求，建议使用requirement服务',
        confidence: 80
      };
    }

    return {
      response: '这是普通对话，可以回复',
      confidence: 60
    };
  }
}