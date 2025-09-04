import { AIService } from '../src/services/ai-service';
import { DatabaseManager } from '../src/services/database';
import { AgentPromptData } from '../src/types';

/**
 * AI服务缓存修复测试
 * 测试场景：验证cached.updated_at.getTime错误修复
 */
describe('AI Service Cache Fix', () => {
  let aiService: AIService;
  let mockDatabase: jest.Mocked<DatabaseManager>;

  beforeEach(() => {
    // 创建数据库模拟
    mockDatabase = {
      getAgentPrompt: jest.fn(),
    } as any;

    // 创建AI服务实例
    const mockConfig = {
      model_name: 'gemini-2.5-flash',
      authorized_user_id: 123456,
      bot_qq_number: 1129974489,
    };
    
    aiService = new AIService(mockConfig as any, mockDatabase);
  });

  test('应该正确处理string类型的updated_at字段', async () => {
    const mockPromptData: AgentPromptData = {
      id: 'test-prompt-1',
      agent_type: 'chat_bot',
      prompt_name: 'test_prompt',
      system_instructions: ['Test instruction'],
      user_prompt_template: undefined,
      context_variables: {},
      model_config: { temperature: 0.7 },
      is_active: true,
      version: 1,
      created_by: 'test',
      created_at: new Date('2025-09-01T10:00:00.000Z'),
      updated_at: '2025-09-01T10:00:00.000Z' as any, // 模拟从数据库返回的字符串类型
      description: 'Test prompt'
    };

    // 设置数据库返回模拟数据
    mockDatabase.getAgentPrompt.mockResolvedValue(mockPromptData);

    // 通过反射访问private方法进行测试
    const getAgentPrompt = (aiService as any).getAgentPrompt.bind(aiService);
    
    // 第一次调用 - 应该从数据库获取并缓存
    let result = await getAgentPrompt('chat_bot', 'test_prompt');
    expect(result).toBeDefined();
    expect(result?.id).toBe('test-prompt-1');
    expect(mockDatabase.getAgentPrompt).toHaveBeenCalledTimes(1);

    // 第二次调用 - 应该使用缓存，不会出现getTime错误
    result = await getAgentPrompt('chat_bot', 'test_prompt');
    expect(result).toBeDefined();
    expect(result?.id).toBe('test-prompt-1');
    // 由于缓存未过期，不应该再次调用数据库
    expect(mockDatabase.getAgentPrompt).toHaveBeenCalledTimes(1);
  });

  test('应该正确处理Date类型的updated_at字段', async () => {
    const mockPromptData: AgentPromptData = {
      id: 'test-prompt-2',
      agent_type: 'intent_analyzer',
      prompt_name: 'requirement_analysis',
      system_instructions: ['Analysis instruction'],
      user_prompt_template: undefined,
      context_variables: {},
      model_config: { temperature: 0.3 },
      is_active: true,
      version: 1,
      created_by: 'test',
      created_at: new Date('2025-09-01T10:00:00.000Z'),
      updated_at: new Date('2025-09-01T10:00:00.000Z'), // 正确的Date类型
      description: 'Analysis prompt'
    };

    mockDatabase.getAgentPrompt.mockResolvedValue(mockPromptData);
    const getAgentPrompt = (aiService as any).getAgentPrompt.bind(aiService);
    
    // 调用应该正常工作，不会出错
    const result = await getAgentPrompt('intent_analyzer', 'requirement_analysis');
    expect(result).toBeDefined();
    expect(result?.id).toBe('test-prompt-2');
  });

  test('应该正确处理无效的updated_at字段', async () => {
    const mockPromptData: AgentPromptData = {
      id: 'test-prompt-3',
      agent_type: 'chat_bot',
      prompt_name: 'invalid_prompt',
      system_instructions: ['Invalid instruction'],
      user_prompt_template: undefined,
      context_variables: {},
      model_config: { temperature: 0.7 },
      is_active: true,
      version: 1,
      created_by: 'test',
      created_at: new Date('2025-09-01T10:00:00.000Z'),
      updated_at: null as any, // 无效的updated_at
      description: 'Invalid prompt'
    };

    mockDatabase.getAgentPrompt.mockResolvedValue(mockPromptData);
    const getAgentPrompt = (aiService as any).getAgentPrompt.bind(aiService);
    
    // 第一次调用 - 应该处理无效的updated_at，不会报错
    let result = await getAgentPrompt('chat_bot', 'invalid_prompt');
    expect(result).toBeDefined();
    expect(result?.id).toBe('test-prompt-3');
    
    // 第二次调用 - 由于updated_at无效，应该重新从数据库获取
    result = await getAgentPrompt('chat_bot', 'invalid_prompt');
    expect(result).toBeDefined();
    expect(mockDatabase.getAgentPrompt).toHaveBeenCalledTimes(2);
  });

  test('缓存过期后应该重新获取数据', async () => {
    // 设置一个很短的缓存超时时间来测试过期逻辑
    (aiService as any).cacheTimeout = 1; // 1ms

    const mockPromptData: AgentPromptData = {
      id: 'test-prompt-4',
      agent_type: 'chat_bot',
      prompt_name: 'expire_test',
      system_instructions: ['Expire test'],
      user_prompt_template: undefined,
      context_variables: {},
      model_config: { temperature: 0.7 },
      is_active: true,
      version: 1,
      created_by: 'test',
      created_at: new Date(),
      updated_at: new Date(),
      description: 'Expire test prompt'
    };

    mockDatabase.getAgentPrompt.mockResolvedValue(mockPromptData);
    const getAgentPrompt = (aiService as any).getAgentPrompt.bind(aiService);
    
    // 第一次调用
    await getAgentPrompt('chat_bot', 'expire_test');
    expect(mockDatabase.getAgentPrompt).toHaveBeenCalledTimes(1);

    // 等待缓存过期
    await new Promise(resolve => setTimeout(resolve, 10));
    
    // 第二次调用 - 缓存已过期，应该重新获取
    await getAgentPrompt('chat_bot', 'expire_test');
    expect(mockDatabase.getAgentPrompt).toHaveBeenCalledTimes(2);
  });
});