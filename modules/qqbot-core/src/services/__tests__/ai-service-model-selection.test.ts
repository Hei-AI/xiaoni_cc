import { jest } from '@jest/globals';
import { AIService } from '../ai-service';
import { AIConfig } from '../../types';
import { DatabaseManager } from '../../services/database';
import { LoggingService } from '../logging-service';
import { getTokenManager } from '../../utils/token-manager';
import { CacheManagerFactory } from '../../utils/cache-manager';

jest.mock('../../utils/token-manager');

const mockedGetTokenManager = jest.mocked(getTokenManager);

const mockGenerateContentResponse = {
  text: 'mock-response',
  usageMetadata: {
    promptTokenCount: 10,
    candidatesTokenCount: 5
  },
  candidates: [
    {
      content: {
        parts: [{ text: 'mock-response' }]
      }
    }
  ]
};

jest.mock('@google/genai', () => {
  const mockedGenerateContent = jest.fn();
  const googleGenAIConstructor = jest.fn().mockImplementation(() => ({
    models: {
      generateContent: mockedGenerateContent
    }
  }));

  return {
    GoogleGenAI: googleGenAIConstructor,
    HarmCategory: {
      HARM_CATEGORY_HARASSMENT: 'HARM_CATEGORY_HARASSMENT',
      HARM_CATEGORY_HATE_SPEECH: 'HARM_CATEGORY_HATE_SPEECH',
      HARM_CATEGORY_SEXUALLY_EXPLICIT: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
      HARM_CATEGORY_DANGEROUS_CONTENT: 'HARM_CATEGORY_DANGEROUS_CONTENT',
      HARM_CATEGORY_CIVIC_INTEGRITY: 'HARM_CATEGORY_CIVIC_INTEGRITY'
    },
    HarmBlockThreshold: {
      BLOCK_NONE: 'BLOCK_NONE'
    },
    __mockedGenerateContent: mockedGenerateContent,
    __mockedConstructor: googleGenAIConstructor
  };
});

const googleGenAIExports = jest.requireMock('@google/genai') as {
  __mockedGenerateContent: jest.MockedFunction<(options: any) => Promise<any>>;
  __mockedConstructor: jest.Mock;
};

const mockTokenManager = {
  getTokenForModel: jest.fn(),
  reportError: jest.fn(),
  reportSuccess: jest.fn(),
  markTokenFailedForModel: jest.fn()
} as unknown as {
  getTokenForModel: jest.MockedFunction<
    (model: string, agentType: string, promptName: string) => Promise<{
      token: string;
      tokenId: number;
      projectName: string;
    }>
  >;
  reportError: jest.MockedFunction<(token: string, message: string) => Promise<void>>;
  reportSuccess: jest.MockedFunction<(token: string, responseTimeMs?: number) => Promise<void>>;
  markTokenFailedForModel: jest.MockedFunction<
    (token: string, modelName: string, error: any, context?: string) => Promise<void>
  >;
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
    googleGenAIExports.__mockedConstructor.mockClear();
    googleGenAIExports.__mockedGenerateContent.mockReset();
    googleGenAIExports.__mockedGenerateContent.mockResolvedValue(mockGenerateContentResponse);

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

    expect(googleGenAIExports.__mockedGenerateContent).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gemini-2.5-pro' })
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

    expect(googleGenAIExports.__mockedGenerateContent).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gemini-2.5-flash' })
    );
  });

  it('blacklists the current token when Google GenAI returns 429', async () => {
    const service = createService();
    const quotaError = Object.assign(new Error('Too Many Requests'), { status: 429 });

    googleGenAIExports.__mockedGenerateContent.mockRejectedValue(quotaError);

    await expect(
      service.generateContent(
        { contents: [{ parts: [{ text: 'ping' }] }] },
        'trace-429',
        {
          modelName: 'gemini-2.5-pro',
          agentType: 'chat_bot',
          promptName: 'basic_chat'
        }
      )
    ).rejects.toThrow('Too Many Requests');

    expect(mockTokenManager.markTokenFailedForModel).toHaveBeenCalledWith(
      'fake-token',
      'gemini-2.5-pro',
      quotaError,
      'generateContent'
    );
    expect(mockTokenManager.reportError).not.toHaveBeenCalled();
  });
});
