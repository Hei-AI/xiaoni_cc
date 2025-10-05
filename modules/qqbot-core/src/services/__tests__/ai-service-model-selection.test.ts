import axios from 'axios';
import { jest } from '@jest/globals';
import { AIService } from '../ai-service';
import { AIConfig } from '../../types';
import { DatabaseManager } from '../../services/database';
import { LoggingService } from '../logging-service';
import { getTokenManager } from '../../utils/token-manager';
import { CacheManagerFactory } from '../../utils/cache-manager';

jest.mock('axios');
jest.mock('../../utils/token-manager');

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedGetTokenManager = jest.mocked(getTokenManager);

const mockTokenManager = {
  getTokenForModel: jest.fn(),
  reportError: jest.fn()
} as unknown as {
  getTokenForModel: jest.MockedFunction<
    (model: string, agentType: string, promptName: string) => Promise<{
      token: string;
      tokenId: number;
      projectName: string;
    }>
  >;
  reportError: jest.MockedFunction<(model: string, message: string) => Promise<void>>;
};

const baseConfig: AIConfig = {
  gemini_api_keys: ['fake-key'],
  model_name: 'gemini-2.5-flash',
  authorized_user_id: 0,
  bot_qq_number: 0
} as any;

const loggingService = {
  logLLMCall: jest.fn(),
  logEventStart: jest.fn(),
  logEventEnd: jest.fn()
} as unknown as LoggingService;

const mockDatabase = {
  getAgentPrompt: jest.fn(async (agentType: string) => ({
    id: `${agentType}-prompt`,
    agent_type: (agentType || 'chat_bot') as any,
    prompt_name: `${agentType || 'chat_bot'}_default`,
    system_instructions: [],
    model_name: 'gemini-2.5-flash',
    model_config: {},
    advanced_config: undefined,
    config_version: 'v1',
    last_config_update: new Date(),
    is_active: true,
    version: 1,
    created_by: 'test',
    created_at: new Date(),
    updated_at: new Date(),
    description: 'mock prompt',
    allowed_token_ids: []
  })),
  getAgentPromptById: jest.fn(async () => null)
} as unknown as DatabaseManager;

function createService(): AIService {
  return new AIService(baseConfig, mockDatabase, loggingService);
}

describe('AIService.generateContent model selection', () => {
  beforeEach(() => {
    mockedAxios.post.mockResolvedValue({
      data: {
        candidates: [
          {
            content: {
              parts: [{ text: 'mock-response' }]
            }
          }
        ]
      }
    } as any);

    mockTokenManager.getTokenForModel.mockResolvedValue({
      token: 'fake-token',
      tokenId: 1,
      projectName: 'mock-project'
    });

    mockedGetTokenManager.mockReturnValue(mockTokenManager as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
    CacheManagerFactory.destroyAll();
  });

  it('uses explicit options when provided', async () => {
    const service = createService();

    const request = {
      contents: [{ parts: [{ text: 'ping' }] }]
    };

    await service.generateContent(request, 'trace-123', {
      modelName: 'gemini-2.5-pro',
      agentType: 'chat_bot',
      promptName: 'basic_chat'
    });

    expect(mockTokenManager.getTokenForModel).toHaveBeenCalledWith(
      'gemini-2.5-pro',
      'chat_bot',
      'basic_chat'
    );

    expect(mockedAxios.post).toHaveBeenCalledWith(
      expect.stringContaining('gemini-2.5-pro:generateContent'),
      expect.any(Object),
      expect.objectContaining({ timeout: 30000 })
    );
  });

  it('falls back to request.model when options omitted', async () => {
    const service = createService();

    const request = {
      contents: [{ parts: [{ text: 'pong' }] }],
      model: { name: 'gemini-2.5-flash' }
    };

    await service.generateContent(request, 'trace-456');

    expect(mockTokenManager.getTokenForModel).toHaveBeenCalledWith(
      'gemini-2.5-flash',
      'tool_system',
      'direct_call'
    );

    expect(mockedAxios.post).toHaveBeenCalledWith(
      expect.stringContaining('gemini-2.5-flash:generateContent'),
      expect.any(Object),
      expect.any(Object)
    );
  });
});
