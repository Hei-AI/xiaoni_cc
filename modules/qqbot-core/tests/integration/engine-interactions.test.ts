/**
 * Engine Interactions Integration Tests
 * 测试三个引擎之间的协作和集成
 */

import DecisionEngine from '../../src/engines/decision-engine';
import PersonaEngine from '../../src/engines/persona-engine';
import ContextEngine from '../../src/engines/context-engine';
import { MockAIService } from '../mocks/ai-service.mock';
import { MockDatabaseManager } from '../mocks/database.mock';
import { mockMessages, testConfig } from '../mocks/test-data';
import { MessageContext, AIConfig } from '../../src/types';

describe('Engine Interactions Integration', () => {
  let decisionEngine: DecisionEngine;
  let personaEngine: PersonaEngine;
  let contextEngine: ContextEngine;
  let mockAIService: MockAIService;
  let mockDatabase: MockDatabaseManager;
  let mockConfig: AIConfig;

  beforeEach(() => {
    mockConfig = {
      gemini_api_keys: testConfig.testApiKeys,
      model_name: testConfig.modelName,
      authorized_user_id: testConfig.authorizedUserId,
      bot_qq_number: testConfig.botQQNumber,
    };

    mockAIService = new MockAIService(mockConfig);
    mockDatabase = new MockDatabaseManager();
    
    contextEngine = new ContextEngine(mockDatabase as any);
    decisionEngine = new DecisionEngine(mockAIService as any, mockConfig);
    personaEngine = new PersonaEngine(mockAIService as any);
  });

  afterEach(() => {
    mockAIService.setShouldFailIntentAnalysis(false);
    mockAIService.setShouldFailResponseGeneration(false);
    mockDatabase.setShouldFail(false);
  });

  describe('Complete Message Processing Pipeline', () => {
    test('should process technical question through all engines', async () => {
      const messageId = 'technical_pipeline_123';
      
      // Step 1: Build context
      const context = await contextEngine.buildContext(messageId);
      expect(context).toBeDefined();

      // Step 2: Make decision
      const decision = await decisionEngine.analyzeMessage(context);
      expect(decision.shouldRespond).toBe(true);
      expect(decision.confidence).toBeGreaterThan(60);

      // Step 3: Generate persona response (if decision is to respond)
      if (decision.shouldRespond) {
        const responseContext = {
          messageType: 'private' as const,
          userRelation: context.userInfo.is_frequent_user ? 'frequent' : 'occasional',
          conversationTopic: context.topicKeywords || [],
          previousResponses: [],
          timeOfDay: 'afternoon' as const,
          isUrgent: false,
        };

        const personaResponse = await personaEngine.generateResponse('技术问题需要帮助', responseContext);
        
        expect(personaResponse.content).toBeDefined();
        expect(personaResponse.selectedPersona).toBe('technical_expert');
        expect(personaResponse.confidence).toBeGreaterThan(50);
      }
    });

    test('should handle requirement identification workflow', async () => {
      const messageId = 'requirement_workflow_123';
      
      // Build context with requirement-related keywords
      const context = await contextEngine.buildContext(messageId);
      
      // Decision engine should suggest requirement service
      const decision = await decisionEngine.analyzeMessage(context);
      expect(decision.shouldRespond).toBe(true);
      
      // For authorized users with complex requirements
      if (decision.suggestedService === 'requirement') {
        expect(decision.confidence).toBeGreaterThan(70);
        expect(decision.reason).toContain('需求');
      }
    });

    test('should filter spam appropriately across all engines', async () => {
      const messageId = 'spam_filter_123';
      
      // Build context for spam message
      const spamContext = await contextEngine.buildContext(messageId);
      
      // Decision engine should reject spam
      const decision = await decisionEngine.analyzeMessage(spamContext);
      expect(decision.shouldRespond).toBe(false);
      expect(decision.suggestedService).toBe('ignore');

      // Persona engine should still be able to handle it gracefully if called
      const responseContext = {
        messageType: 'private' as const,
        userRelation: 'new',
        conversationTopic: [],
        previousResponses: [],
        timeOfDay: 'afternoon' as const,
        isUrgent: false,
      };

      const personaResponse = await personaEngine.generateResponse('asdfghjkl', responseContext);
      expect(personaResponse.content).toBeDefined();
    });
  });

  describe('Cross-Engine Data Flow', () => {
    test('should pass context data correctly between engines', async () => {
      const messageId = 'data_flow_123';
      
      // Context engine builds comprehensive context
      const context = await contextEngine.buildContext(messageId);
      
      // Decision engine uses context for decision
      const decision = await decisionEngine.analyzeMessage(context);
      
      // Verify data flow
      expect(decision.metadata?.isFromAuthorizedUser).toBeDefined();
      expect(decision.metadata?.hasKeywords).toBeDefined();
      expect(decision.metadata?.contextualScore).toBeDefined();
      
      // Persona engine should use topic keywords from context
      const responseContext = {
        messageType: context.currentMessage.message_type,
        userRelation: context.userInfo.is_frequent_user ? 'frequent' : 'new',
        conversationTopic: context.topicKeywords || [],
        previousResponses: [],
        timeOfDay: 'afternoon' as const,
        isUrgent: false,
      };

      const personaResponse = await personaEngine.generateResponse('测试消息', responseContext);
      expect(personaResponse.selectedPersona).toBeDefined();
    });

    test('should maintain consistency in user relationship assessment', async () => {
      // Add a frequent user to mock database
      mockDatabase.addMockUser(123456789, {
        user_id: 123456789,
        nickname: 'FrequentUser',
        interaction_count: 150,
        is_frequent_user: true,
        last_interaction: new Date(Date.now() - 300000), // 5 minutes ago
      });

      const messageId = 'frequent_user_123';
      const context = await contextEngine.buildContext(messageId);
      
      // Decision engine should recognize frequent user
      const decision = await decisionEngine.analyzeMessage(context);
      expect(decision.confidence).toBeGreaterThan(60); // Higher confidence for frequent users
      
      // Persona engine should adapt to frequent user relationship
      const responseContext = {
        messageType: 'private' as const,
        userRelation: 'frequent' as const,
        conversationTopic: [],
        previousResponses: [],
        timeOfDay: 'afternoon' as const,
        isUrgent: false,
      };

      const personaResponse = await personaEngine.generateResponse('你好', responseContext);
      expect(personaResponse.confidence).toBeGreaterThan(50);
    });
  });

  describe('Error Propagation and Recovery', () => {
    test('should handle ContextEngine failures gracefully', async () => {
      mockDatabase.setShouldFail(true);
      const messageId = 'context_failure_123';
      
      // Context engine should provide minimal context instead of failing
      const context = await contextEngine.buildContext(messageId);
      expect(context).toBeDefined();
      expect(context.conversationSummary).toContain('构建失败');
      
      // Decision engine should still work with minimal context
      const decision = await decisionEngine.analyzeMessage(context);
      expect(decision.shouldRespond).toBeDefined();
      
      // Persona engine should handle minimal context
      const responseContext = {
        messageType: 'private' as const,
        userRelation: 'new',
        conversationTopic: [],
        previousResponses: [],
        timeOfDay: 'afternoon' as const,
        isUrgent: false,
      };

      const personaResponse = await personaEngine.generateResponse('测试', responseContext);
      expect(personaResponse.content).toBeDefined();
    });

    test('should bubble up persona errors when enhancement fails', async () => {
      const responseContext = {
        messageType: 'private' as const,
        userRelation: 'occasional',
        conversationTopic: [],
        previousResponses: [],
        timeOfDay: 'afternoon' as const,
        isUrgent: false,
      };

      const filterSpy = jest
        .spyOn(personaEngine as any, 'applyPersonalityFilters')
        .mockImplementation(() => {
          throw new Error('Mock persona failure');
        });

      await expect(personaEngine.generateResponse('测试', responseContext)).rejects.toThrow(
        'Mock persona failure'
      );

      filterSpy.mockRestore();
    });

    test('should propagate errors when all external services fail', async () => {
      mockDatabase.setShouldFail(true);

      const messageId = 'total_failure_123';
      const context = await contextEngine.buildContext(messageId);

      const analysisSpy = jest
        .spyOn(decisionEngine as any, 'performAIAnalysis')
        .mockRejectedValue(new Error('Mock total failure'));

      await expect(decisionEngine.analyzeMessage(context)).rejects.toThrow('Mock total failure');
      analysisSpy.mockRestore();

      const responseContext = {
        messageType: 'private' as const,
        userRelation: 'new',
        conversationTopic: [],
        previousResponses: [],
        timeOfDay: 'afternoon' as const,
        isUrgent: false,
      };

      const filterSpy = jest
        .spyOn(personaEngine as any, 'applyPersonalityFilters')
        .mockImplementation(() => {
          throw new Error('Mock persona failure');
        });

      await expect(personaEngine.generateResponse('测试', responseContext)).rejects.toThrow(
        'Mock persona failure'
      );

      filterSpy.mockRestore();
    });
  });

  describe('Performance Integration', () => {
    test('should complete full pipeline within reasonable time', async () => {
      const messageId = 'performance_integration_123';
      const startTime = Date.now();
      
      // Full pipeline
      const context = await contextEngine.buildContext(messageId);
      const decision = await decisionEngine.analyzeMessage(context);
      
      if (decision.shouldRespond) {
        const responseContext = {
          messageType: 'private' as const,
          userRelation: 'occasional',
          conversationTopic: context.topicKeywords || [],
          previousResponses: [],
          timeOfDay: 'afternoon' as const,
          isUrgent: false,
        };

        const personaResponse = await personaEngine.generateResponse('性能测试', responseContext);
        expect(personaResponse.processingTime).toBeGreaterThan(0);
      }
      
      const totalTime = Date.now() - startTime;
      expect(totalTime).toBeLessThan(8000); // Complete pipeline under 8 seconds
    });

    test('should handle concurrent processing efficiently', async () => {
      const messageIds = ['concurrent_1', 'concurrent_2', 'concurrent_3', 'concurrent_4'];
      const startTime = Date.now();
      
      const promises = messageIds.map(async messageId => {
        const context = await contextEngine.buildContext(messageId);
        const decision = await decisionEngine.analyzeMessage(context);
        
        if (decision.shouldRespond) {
          const responseContext = {
            messageType: 'private' as const,
            userRelation: 'occasional',
            conversationTopic: context.topicKeywords || [],
            previousResponses: [],
            timeOfDay: 'afternoon' as const,
            isUrgent: false,
          };

          return await personaEngine.generateResponse(`并发测试 ${messageId}`, responseContext);
        }
        return null;
      });

      const results = await Promise.all(promises);
      const totalTime = Date.now() - startTime;
      
      expect(results).toHaveLength(4);
      expect(totalTime).toBeLessThan(15000); // Concurrent processing should be efficient
    });
  });

  describe('Real-world Scenario Simulation', () => {
    test('should handle mixed conversation types appropriately', async () => {
      const scenarios = [
        { messageId: 'technical_1', expectedService: 'chat', expectedPersona: 'technical_expert' },
        { messageId: 'casual_1', expectedService: 'chat', expectedPersona: 'casual_companion' },
        { messageId: 'requirement_1', expectedService: 'requirement', expectedPersona: 'professional_assistant' },
      ];

      for (const scenario of scenarios) {
        const context = await contextEngine.buildContext(scenario.messageId);
        const decision = await decisionEngine.analyzeMessage(context);
        
        if (decision.shouldRespond) {
          expect(decision.suggestedService).toMatch(/(chat|requirement)/);
          
          const responseContext = {
            messageType: 'private' as const,
            userRelation: 'occasional',
            conversationTopic: context.topicKeywords || [],
            previousResponses: [],
            timeOfDay: 'afternoon' as const,
            isUrgent: false,
          };

          const personaResponse = await personaEngine.generateResponse('测试场景', responseContext);
          expect(personaResponse.selectedPersona).toBeDefined();
        }
      }
    });

    test('should adapt to different times of day', async () => {
      const timeScenarios = ['morning', 'afternoon', 'evening', 'night'] as const;
      
      for (const timeOfDay of timeScenarios) {
        const context = await contextEngine.buildContext(`time_test_${timeOfDay}`);
        const decision = await decisionEngine.analyzeMessage(context);
        
        if (decision.shouldRespond) {
          const responseContext = {
            messageType: 'private' as const,
            userRelation: 'frequent',
            conversationTopic: ['问候'],
            previousResponses: [],
            timeOfDay,
            isUrgent: false,
          };

          const personaResponse = await personaEngine.generateResponse('你好', responseContext);
          expect(personaResponse.content).toBeDefined();
          // Different times might influence persona selection or response style
        }
      }
    });

    test('should handle group vs private message differences', async () => {
      const messageTypes = ['private', 'group'] as const;
      
      for (const messageType of messageTypes) {
        const messageId = `${messageType}_message_test`;
        const context = await contextEngine.buildContext(messageId);
        const decision = await decisionEngine.analyzeMessage(context);
        
        if (decision.shouldRespond) {
          const responseContext = {
            messageType,
            userRelation: 'occasional',
            conversationTopic: [],
            previousResponses: [],
            timeOfDay: 'afternoon' as const,
            isUrgent: false,
          };

          const personaResponse = await personaEngine.generateResponse('测试消息', responseContext);
          expect(personaResponse.content).toBeDefined();
          
          // Group messages might have different persona selection or style
          if (messageType === 'group') {
            // Group responses might be more concise or formal
            expect(personaResponse.confidence).toBeGreaterThan(0);
          }
        }
      }
    });
  });

  describe('Data Consistency and Validation', () => {
    test('should maintain data type consistency across engines', async () => {
      const messageId = 'consistency_test_123';
      
      const context = await contextEngine.buildContext(messageId);
      const decision = await decisionEngine.analyzeMessage(context);
      
      // Validate data types
      expect(typeof decision.shouldRespond).toBe('boolean');
      expect(typeof decision.confidence).toBe('number');
      expect(typeof decision.reason).toBe('string');
      expect(['chat', 'requirement', 'ignore']).toContain(decision.suggestedService);
      
      expect(Array.isArray(context.recentMessages)).toBe(true);
      expect(Array.isArray(context.topicKeywords)).toBe(true);
      expect(typeof context.userInfo.user_id).toBe('number');
      expect(typeof context.userInfo.is_frequent_user).toBe('boolean');
    });

    test('should validate confidence score ranges', async () => {
      const messageId = 'confidence_validation_123';
      
      const context = await contextEngine.buildContext(messageId);
      const decision = await decisionEngine.analyzeMessage(context);
      
      expect(decision.confidence).toBeGreaterThanOrEqual(0);
      expect(decision.confidence).toBeLessThanOrEqual(100);
      
      if (decision.shouldRespond) {
        const responseContext = {
          messageType: 'private' as const,
          userRelation: 'occasional',
          conversationTopic: [],
          previousResponses: [],
          timeOfDay: 'afternoon' as const,
          isUrgent: false,
        };

        const personaResponse = await personaEngine.generateResponse('置信度测试', responseContext);
        expect(personaResponse.confidence).toBeGreaterThanOrEqual(0);
        expect(personaResponse.confidence).toBeLessThanOrEqual(100);
      }
    });
  });
});
