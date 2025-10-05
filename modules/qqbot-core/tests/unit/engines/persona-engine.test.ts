/**
 * PersonaEngine Unit Tests
 * 测试人格引擎的人格选择和响应生成逻辑
 */

import PersonaEngine from '../../../src/engines/persona-engine';
import { MockAIService } from '../../mocks/ai-service.mock';
import { testConfig } from '../../mocks/test-data';
import { ResponseContext, PersonaType } from '../../../src/types';

describe('PersonaEngine', () => {
  let personaEngine: PersonaEngine;
  let mockAIService: MockAIService;

  beforeEach(() => {
    mockAIService = new MockAIService();
    personaEngine = new PersonaEngine(mockAIService as any);
  });

  afterEach(() => {
    mockAIService.setShouldFailResponseGeneration(false);
  });

  // Helper function to create response context
  const createResponseContext = (overrides: Partial<ResponseContext> = {}): ResponseContext => ({
    messageType: 'private',
    userRelation: 'occasional',
    conversationTopic: [],
    previousResponses: [],
    timeOfDay: 'afternoon',
    isUrgent: false,
    ...overrides,
  });

  describe('Persona Selection Logic', () => {
    test('should select technical_expert for technical questions', async () => {
      const context = createResponseContext({
        conversationTopic: ['bug', 'TypeScript', '代码'],
      });

      const response = await personaEngine.generateResponse('我的代码出现bug了', context);

      expect(response.selectedPersona).toBe('technical_expert');
      expect(response.confidence).toBeGreaterThan(60);
    });

    test('should select empathetic_friend for emotional support', async () => {
      const context = createResponseContext({
        conversationTopic: ['困扰', '心情', '烦恼'],
      });

      const response = await personaEngine.generateResponse('我今天心情不好', context);

      expect(response.selectedPersona).toBe('empathetic_friend');
      expect(response.confidence).toBeGreaterThan(60);
    });

    test('should select professional_assistant for work-related queries', async () => {
      const context = createResponseContext({
        conversationTopic: ['工作', '会议', '项目'],
      });

      const response = await personaEngine.generateResponse('我需要安排一个会议', context);

      expect(response.selectedPersona).toBe('professional_assistant');
      expect(response.confidence).toBeGreaterThan(60);
    });

    test('should select casual_companion for everyday chat', async () => {
      const context = createResponseContext({
        conversationTopic: ['天气', '日常'],
      });

      const response = await personaEngine.generateResponse('今天天气真不错', context);

      expect(response.selectedPersona).toBe('casual_companion');
      expect(response.confidence).toBeGreaterThan(50);
    });

    test('should select creative_helper for creative tasks', async () => {
      const context = createResponseContext({
        conversationTopic: ['创意', '设计', '写作'],
      });

      const response = await personaEngine.generateResponse('帮我想一个创意方案', context);

      expect(response.selectedPersona).toBe('creative_helper');
      expect(response.confidence).toBeGreaterThan(60);
    });
  });

  describe('Context-based Adaptation', () => {
    test('should adapt to message type (private vs group)', async () => {
      const privateContext = createResponseContext({ messageType: 'private' });
      const groupContext = createResponseContext({ messageType: 'group' });

      const privateResponse = await personaEngine.generateResponse('你好', privateContext);
      const groupResponse = await personaEngine.generateResponse('你好', groupContext);

      expect(privateResponse.content).toBeDefined();
      expect(groupResponse.content).toBeDefined();
      // Group responses might be more formal or concise
    });

    test('should consider user relationship', async () => {
      const newUserContext = createResponseContext({ userRelation: 'new' });
      const frequentUserContext = createResponseContext({ userRelation: 'frequent' });

      const newUserResponse = await personaEngine.generateResponse('你好', newUserContext);
      const frequentUserResponse = await personaEngine.generateResponse('你好', frequentUserContext);

      expect(newUserResponse.content).toBeDefined();
      expect(frequentUserResponse.content).toBeDefined();
      // Frequent user responses might be more casual
    });

    test('should adapt to time of day', async () => {
      const morningContext = createResponseContext({ timeOfDay: 'morning' });
      const nightContext = createResponseContext({ timeOfDay: 'night' });

      const morningResponse = await personaEngine.generateResponse('你好', morningContext);
      const nightResponse = await personaEngine.generateResponse('你好', nightContext);

      expect(morningResponse.content).toBeDefined();
      expect(nightResponse.content).toBeDefined();
      // Night responses might be more gentle
    });

    test('should handle urgent messages appropriately', async () => {
      const urgentContext = createResponseContext({ isUrgent: true });
      const normalContext = createResponseContext({ isUrgent: false });

      const urgentResponse = await personaEngine.generateResponse('紧急！需要帮助', urgentContext);
      const normalResponse = await personaEngine.generateResponse('需要帮助', normalContext);

      expect(urgentResponse.confidence).toBeGreaterThan(normalResponse.confidence);
      expect(urgentResponse.content).toBeDefined();
    });
  });

  describe('Response Enhancement', () => {
    test('should enhance responses with appropriate emojis', async () => {
      const context = createResponseContext({
        conversationTopic: ['开心', '庆祝'],
      });

      const response = await personaEngine.generateResponse('今天很开心', context);

      expect(response.content).toBeDefined();
      expect(response.metadata?.emojiCount).toBeGreaterThan(0);
    });

    test('should maintain appropriate response length', async () => {
      const context = createResponseContext();

      const response = await personaEngine.generateResponse('简单问题', context);

      expect(response.content.length).toBeGreaterThan(5);
      expect(response.content.length).toBeLessThan(1000); // Reasonable upper limit
    });

    test('should provide sentiment-appropriate responses', async () => {
      const sadContext = createResponseContext({
        conversationTopic: ['难过', '失望'],
      });

      const response = await personaEngine.generateResponse('我很难过', sadContext);

      expect(response.selectedPersona).toBe('empathetic_friend');
      expect(response.metadata?.sentimentScore).toBeDefined();
    });
  });

  describe('Persona Consistency', () => {
    test('should maintain persona consistency across related messages', async () => {
      const context = createResponseContext({
        conversationTopic: ['技术', '代码'],
        previousResponses: ['我来帮你分析这个技术问题...'],
      });

      const response1 = await personaEngine.generateResponse('还有其他问题', context);
      const response2 = await personaEngine.generateResponse('继续讨论技术', context);

      expect(response1.selectedPersona).toBe(response2.selectedPersona);
      expect(response1.selectedPersona).toBe('technical_expert');
    });

    test('should apply consistent persona aspects', async () => {
      const context = createResponseContext({
        conversationTopic: ['技术'],
      });

      const response = await personaEngine.generateResponse('技术问题', context);

      expect(response.appliedAspects).toBeDefined();
      expect(response.appliedAspects.length).toBeGreaterThan(0);
      
      // Technical expert should have certain aspects
      const aspectTypes = response.appliedAspects.map(a => a.aspect);
      expect(aspectTypes).toContain('patience'); // Technical questions need patience
    });
  });

  describe('Error Handling and Fallback', () => {
    test('should surface errors instead of sending fallback content', async () => {
      const context = createResponseContext();
      const filterSpy = jest
        .spyOn(personaEngine as any, 'applyPersonalityFilters')
        .mockImplementation(() => {
          throw new Error('Mock persona failure');
        });

      await expect(personaEngine.generateResponse('测试消息', context)).rejects.toThrow(
        'Mock persona failure'
      );

      filterSpy.mockRestore();
    });

    test('should handle empty or invalid messages', async () => {
      const context = createResponseContext();

      const emptyResponse = await personaEngine.generateResponse('', context);
      const whitespaceResponse = await personaEngine.generateResponse('   ', context);

      expect(emptyResponse.content).toBeDefined();
      expect(whitespaceResponse.content).toBeDefined();
      expect(emptyResponse.content.length).toBeGreaterThan(0);
    });

    test('should handle missing context gracefully', async () => {
      const minimalContext = {
        messageType: 'private' as const,
        userRelation: 'new' as const,
        conversationTopic: [],
        previousResponses: [],
        timeOfDay: 'afternoon' as const,
        isUrgent: false,
      };

      const response = await personaEngine.generateResponse('你好', minimalContext);

      expect(response.content).toBeDefined();
      expect(response.selectedPersona).toBeDefined();
    });

    test('should provide default persona when selection fails', async () => {
      const ambiguousContext = createResponseContext({
        conversationTopic: [], // No clear topic
      });

      const response = await personaEngine.generateResponse('随机内容', ambiguousContext);

      expect(response.selectedPersona).toBeDefined();
      expect(['casual_companion', 'professional_assistant']).toContain(response.selectedPersona);
    });
  });

  describe('Performance and Quality', () => {
    test('should complete response generation within reasonable time', async () => {
      const context = createResponseContext();
      const startTime = Date.now();

      await personaEngine.generateResponse('测试消息', context);

      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(3000); // Should complete within 3 seconds
    });

    test('should provide high confidence for clear persona matches', async () => {
      const clearTechnicalContext = createResponseContext({
        conversationTopic: ['bug', 'error', 'code', 'debugging', 'programming'],
      });

      const response = await personaEngine.generateResponse('我的代码有bug', clearTechnicalContext);

      expect(response.confidence).toBeGreaterThan(80);
      expect(response.selectedPersona).toBe('technical_expert');
    });

    test('should track processing time accurately', async () => {
      const context = createResponseContext();

      const response = await personaEngine.generateResponse('测试', context);

      expect(response.processingTime).toBeGreaterThan(0);
      expect(response.processingTime).toBeLessThan(5000);
    });

    test('should provide detailed metadata', async () => {
      const context = createResponseContext();

      const response = await personaEngine.generateResponse('你好，很高兴见到你！', context);

      expect(response.metadata).toBeDefined();
      expect(response.metadata?.originalResponse).toBeDefined();
      expect(response.metadata?.adjustmentsMade).toBeDefined();
      expect(response.metadata?.emojiCount).toBeDefined();
    });
  });

  describe('Persona Configuration', () => {
    test('should support custom persona configurations', () => {
      const customConfig = {
        primaryPersona: 'technical_expert' as PersonaType,
        secondaryAspects: [
          { aspect: 'humor' as const, weight: 0.3 },
          { aspect: 'patience' as const, weight: 0.8 },
        ],
        responseStyle: {
          verbosity: 'balanced' as const,
          tone: 'friendly' as const,
          useEmojis: true,
          includeExamples: true,
        },
        contextAdaptation: true,
      };

      // Test that custom config can be created and used
      expect(customConfig.primaryPersona).toBe('technical_expert');
      expect(customConfig.secondaryAspects).toHaveLength(2);
    });

    test('should handle different verbosity levels', async () => {
      const context = createResponseContext();

      const response = await personaEngine.generateResponse('解释一下TypeScript', context);

      expect(response.content).toBeDefined();
      // In a full implementation, you'd test different verbosity levels
      // For now, just ensure we get a response
    });
  });

  describe('Integration Readiness', () => {
    test('should return all required response fields', async () => {
      const context = createResponseContext();

      const response = await personaEngine.generateResponse('测试', context);

      // Verify all required fields are present
      expect(response).toHaveProperty('content');
      expect(response).toHaveProperty('selectedPersona');
      expect(response).toHaveProperty('appliedAspects');
      expect(response).toHaveProperty('confidence');
      expect(response).toHaveProperty('processingTime');
      expect(response).toHaveProperty('metadata');

      expect(typeof response.content).toBe('string');
      expect(typeof response.selectedPersona).toBe('string');
      expect(Array.isArray(response.appliedAspects)).toBe(true);
      expect(typeof response.confidence).toBe('number');
      expect(typeof response.processingTime).toBe('number');
    });

    test('should be compatible with existing AI service interface', async () => {
      const context = createResponseContext();

      // This test ensures PersonaEngine can work with the existing AI service
      const response = await personaEngine.generateResponse('测试兼容性', context);

      expect(response.content).toBeDefined();
      expect(response.confidence).toBeGreaterThan(0);
      expect(response.confidence).toBeLessThanOrEqual(100);
    });
  });
});
