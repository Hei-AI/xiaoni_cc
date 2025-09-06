/**
 * DecisionEngine Unit Tests
 * 测试决策引擎的核心决策逻辑
 */

import DecisionEngine from '../../../src/engines/decision-engine';
import { MockAIService } from '../../mocks/ai-service.mock';
import { mockContexts, testConfig } from '../../mocks/test-data';
import { AIConfig } from '../../../src/types';

describe('DecisionEngine', () => {
  let decisionEngine: DecisionEngine;
  let mockAIService: MockAIService;
  let mockConfig: AIConfig;

  beforeEach(() => {
    mockConfig = {
      gemini_api_keys: testConfig.testApiKeys,
      model_name: testConfig.modelName,
      authorized_user_id: testConfig.authorizedUserId,
      bot_qq_number: testConfig.botQQNumber,
    };

    mockAIService = new MockAIService(mockConfig);
    decisionEngine = new DecisionEngine(mockAIService as any, mockConfig);
  });

  afterEach(() => {
    mockAIService.setShouldFailIntentAnalysis(false);
    mockAIService.setShouldFailResponseGeneration(false);
  });

  describe('Core Decision Logic', () => {
    test('should respond to authorized user technical questions', async () => {
      const decision = await decisionEngine.analyzeMessage(mockContexts.technicalContext);

      expect(decision.shouldRespond).toBe(true);
      expect(decision.confidence).toBeGreaterThan(70);
      expect(decision.suggestedService).toBe('chat');
      expect(decision.reason).toContain('授权用户');
      expect(decision.metadata?.isFromAuthorizedUser).toBe(true);
      expect(decision.metadata?.hasKeywords).toBe(true);
    });

    test('should suggest requirement service for development requests', async () => {
      const decision = await decisionEngine.analyzeMessage(mockContexts.requirementContext);

      expect(decision.shouldRespond).toBe(true);
      expect(decision.confidence).toBeGreaterThan(80);
      expect(decision.suggestedService).toBe('requirement');
      expect(decision.reason).toContain('开发需求');
    });

    test('should respond to group mentions', async () => {
      const decision = await decisionEngine.analyzeMessage(mockContexts.groupContext);

      expect(decision.shouldRespond).toBe(true);
      expect(decision.confidence).toBeGreaterThan(60);
      expect(decision.metadata?.isDirectMention).toBe(true);
    });

    test('should not respond to spam from unauthorized users', async () => {
      const decision = await decisionEngine.analyzeMessage(mockContexts.spamContext);

      expect(decision.shouldRespond).toBe(false);
      expect(decision.confidence).toBeLessThan(50);
      expect(decision.suggestedService).toBe('ignore');
      expect(decision.reason).toContain('非授权用户');
      expect(decision.metadata?.isFromAuthorizedUser).toBe(false);
    });

    test('should handle casual conversation appropriately', async () => {
      const decision = await decisionEngine.analyzeMessage(mockContexts.casualContext);

      // Casual conversation from new users might get lower confidence
      expect(decision).toHaveProperty('shouldRespond');
      expect(decision).toHaveProperty('confidence');
      expect(decision.confidence).toBeGreaterThan(0);
      expect(decision.confidence).toBeLessThan(100);
    });
  });

  describe('Rule-based Filtering', () => {
    test('should detect question words correctly', () => {
      const questionContext = {
        ...mockContexts.technicalContext,
        currentMessage: {
          ...mockContexts.technicalContext.currentMessage,
          message: '这个问题怎么解决？能帮我看看吗？'
        }
      };

      return decisionEngine.analyzeMessage(questionContext).then(decision => {
        expect(decision.metadata?.containsQuestionWords).toBe(true);
      });
    });

    test('should detect @ mentions correctly', () => {
      const atMentionContext = {
        ...mockContexts.groupContext,
        currentMessage: {
          ...mockContexts.groupContext.currentMessage,
          message: `[CQ:at,qq=${testConfig.botQQNumber}] 你好`
        }
      };

      return decisionEngine.analyzeMessage(atMentionContext).then(decision => {
        expect(decision.metadata?.isDirectMention).toBe(true);
      });
    });

    test('should identify technical keywords', async () => {
      const technicalContext = {
        ...mockContexts.technicalContext,
        topicKeywords: ['bug', 'error', '代码', 'API']
      };

      const decision = await decisionEngine.analyzeMessage(technicalContext);
      expect(decision.metadata?.hasKeywords).toBe(true);
    });
  });

  describe('Contextual Analysis', () => {
    test('should boost confidence for frequent users', async () => {
      const frequentUserContext = {
        ...mockContexts.technicalContext,
        userInfo: {
          ...mockContexts.technicalContext.userInfo,
          is_frequent_user: true,
          recent_interaction_count: 100
        }
      };

      const decision = await decisionEngine.analyzeMessage(frequentUserContext);
      expect(decision.confidence).toBeGreaterThan(70);
    });

    test('should consider group activity level', async () => {
      const activeGroupContext = {
        ...mockContexts.groupContext,
        groupInfo: {
          group_id: 987654,
          recent_activity_level: 'high' as const,
          participant_count: 50
        }
      };

      const decision = await decisionEngine.analyzeMessage(activeGroupContext);
      expect(decision.confidence).toBeGreaterThan(0);
    });

    test('should analyze conversation topic relevance', async () => {
      const relevantTopicContext = {
        ...mockContexts.technicalContext,
        topicKeywords: ['bug', '错误', '帮助', '分析'],
        conversationSummary: '正在讨论技术问题和解决方案'
      };

      const decision = await decisionEngine.analyzeMessage(relevantTopicContext);
      expect(decision.confidence).toBeGreaterThan(60);
      expect(decision.metadata?.contextualScore).toBeDefined();
    });
  });

  describe('LLM Enhancement', () => {
    test('should use LLM analysis for complex decisions', async () => {
      const complexContext = mockContexts.requirementContext;
      const decision = await decisionEngine.analyzeMessage(complexContext);

      expect(decision.confidence).toBeGreaterThan(70);
      expect(decision.reason).toBeTruthy();
      expect(decision.suggestedService).toMatch(/chat|requirement/);
    });

    test('should handle LLM service failures gracefully', async () => {
      mockAIService.setShouldFailResponseGeneration(true);

      const decision = await decisionEngine.analyzeMessage(mockContexts.casualContext);
      
      // Should fall back to rule-based decision
      expect(decision.shouldRespond).toBeDefined();
      expect(decision.confidence).toBeGreaterThan(0);
      expect(decision.reason).toContain('规则判断');
    });
  });

  describe('Edge Cases and Error Handling', () => {
    test('should handle empty messages', async () => {
      const emptyContext = {
        ...mockContexts.casualContext,
        currentMessage: {
          ...mockContexts.casualContext.currentMessage,
          message: ''
        }
      };

      const decision = await decisionEngine.analyzeMessage(emptyContext);
      expect(decision.shouldRespond).toBe(false);
      expect(decision.suggestedService).toBe('ignore');
    });

    test('should handle messages with only whitespace', async () => {
      const whitespaceContext = {
        ...mockContexts.casualContext,
        currentMessage: {
          ...mockContexts.casualContext.currentMessage,
          message: '   \n\t   '
        }
      };

      const decision = await decisionEngine.analyzeMessage(whitespaceContext);
      expect(decision.shouldRespond).toBe(false);
    });

    test('should handle very long messages', async () => {
      const longMessage = 'a'.repeat(10000);
      const longMessageContext = {
        ...mockContexts.technicalContext,
        currentMessage: {
          ...mockContexts.technicalContext.currentMessage,
          message: longMessage
        }
      };

      const decision = await decisionEngine.analyzeMessage(longMessageContext);
      expect(decision).toHaveProperty('shouldRespond');
      expect(decision).toHaveProperty('confidence');
    });

    test('should handle missing context properties gracefully', async () => {
      const incompleteContext = {
        currentMessage: mockContexts.technicalContext.currentMessage,
        recentMessages: [],
        userInfo: mockContexts.technicalContext.userInfo,
        // Missing groupInfo, conversationSummary, topicKeywords
      } as any;

      const decision = await decisionEngine.analyzeMessage(incompleteContext);
      expect(decision.shouldRespond).toBeDefined();
      expect(decision.confidence).toBeGreaterThan(0);
    });
  });

  describe('Performance and Reliability', () => {
    test('should complete analysis within reasonable time', async () => {
      const startTime = Date.now();
      
      await decisionEngine.analyzeMessage(mockContexts.technicalContext);
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
    });

    test('should provide consistent results for same input', async () => {
      const context = mockContexts.technicalContext;
      
      const decision1 = await decisionEngine.analyzeMessage(context);
      const decision2 = await decisionEngine.analyzeMessage(context);
      
      expect(decision1.shouldRespond).toBe(decision2.shouldRespond);
      expect(decision1.suggestedService).toBe(decision2.suggestedService);
      // Note: confidence might vary slightly due to LLM randomness
    });

    test('should handle concurrent analysis requests', async () => {
      const contexts = [
        mockContexts.technicalContext,
        mockContexts.casualContext,
        mockContexts.requirementContext,
      ];

      const promises = contexts.map(context => 
        decisionEngine.analyzeMessage(context)
      );

      const decisions = await Promise.all(promises);
      
      expect(decisions).toHaveLength(3);
      decisions.forEach(decision => {
        expect(decision).toHaveProperty('shouldRespond');
        expect(decision).toHaveProperty('confidence');
      });
    });
  });

  describe('Configuration and Setup', () => {
    test('should initialize with correct configuration', () => {
      expect(decisionEngine).toBeInstanceOf(DecisionEngine);
      // Additional checks would require access to private properties
    });

    test('should validate authorized user correctly', async () => {
      const authorizedContext = mockContexts.technicalContext;
      const unauthorizedContext = mockContexts.spamContext;

      const authorizedDecision = await decisionEngine.analyzeMessage(authorizedContext);
      const unauthorizedDecision = await decisionEngine.analyzeMessage(unauthorizedContext);

      expect(authorizedDecision.metadata?.isFromAuthorizedUser).toBe(true);
      expect(unauthorizedDecision.metadata?.isFromAuthorizedUser).toBe(false);
    });
  });
});