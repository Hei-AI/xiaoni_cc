import { jest } from '@jest/globals';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import axios from 'axios';
import { AIService } from '../ai-service';
import { AIConfig } from '../../types';
import { DatabaseManager } from '../../services/database';
import { LoggingService } from '../logging-service';
import { getTokenManager } from '../../utils/token-manager';
import { CacheManagerFactory } from '../../utils/cache-manager';

jest.mock('../../utils/token-manager');
jest.mock('axios');

const mockedGetTokenManager = jest.mocked(getTokenManager);
const mockedAxios = jest.mocked(axios);
const originalFetch = global.fetch;

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
  gemini_cli_access_token: 'gemini-cli-access',
  gemini_cli_project_id: 'project-123',
  openai_api_key: 'openai-key',
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
  getAgentPromptById: jest.fn(async () => null),
  saveConversation: jest.fn(async () => undefined)
} as unknown as DatabaseManager;

function createService(): AIService {
  return new AIService(baseConfig, mockDatabase, loggingService);
}

function createJwt(claims: Record<string, any>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${header}.${payload}.signature`;
}

function createJsonResponse(payload: any, init: Partial<Response> & { status?: number; statusText?: string } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    json: async () => payload,
    text: async () => JSON.stringify(payload),
    clone() {
      return createJsonResponse(payload, init);
    }
  } as any;
}

function createGeminiCliStreamResponse(text = 'gemini-cli-response') {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => [
      `data: {"candidates":[{"content":{"parts":[{"text":"${text}"}]}}],"usageMetadata":{"promptTokenCount":4,"candidatesTokenCount":3}}`,
      '',
      'data: [DONE]',
      ''
    ].join('\n')
  } as any;
}

function createDefaultFetchMock(projectId = 'project-123', text = 'gemini-cli-response') {
  return jest.fn(async (input: any) => {
    const url = String(input);
    if (url.includes('/v1internal:loadCodeAssist')) {
      return createJsonResponse({
        currentTier: { id: 'free-tier' },
        cloudaicompanionProject: projectId
      });
    }
    if (url.includes('/v1internal:streamGenerateContent')) {
      return createGeminiCliStreamResponse(text);
    }
    throw new Error(`Unexpected fetch call: ${url}`);
  });
}

function createCodexSseResponse(text = 'codex-response') {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => [
      'data: {"type":"response.output_item.done","item":{"type":"message","role":"assistant","status":"completed","content":[{"type":"output_text","text":"' + text + '"}]}}',
      '',
      'data: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":10,"output_tokens":6,"total_tokens":16}}}',
      '',
      'data: [DONE]',
      ''
    ].join('\n')
  } as any;
}

describe('AIService.generateContent model selection', () => {
  beforeEach(() => {
    googleGenAIExports.__mockedConstructor.mockClear();
    googleGenAIExports.__mockedGenerateContent.mockReset();
    googleGenAIExports.__mockedGenerateContent.mockResolvedValue(mockGenerateContentResponse);
    mockedAxios.mockReset();

    mockTokenManager.getTokenForModel.mockResolvedValue({
      token: 'fake-token',
      tokenId: 1,
      projectName: 'mock-project'
    });

    mockedGetTokenManager.mockReturnValue(mockTokenManager as any);
    (global as any).fetch = createDefaultFetchMock();
  });

  afterEach(() => {
    jest.clearAllMocks();
    CacheManagerFactory.destroyAll();
    global.fetch = originalFetch;
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

    expect((global as any).fetch).toHaveBeenCalledWith(
      'https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer gemini-cli-access'
        })
      })
    );
    expect(mockTokenManager.getTokenForModel).not.toHaveBeenCalled();
    expect(googleGenAIExports.__mockedGenerateContent).not.toHaveBeenCalled();
  });

  it('falls back to request.model when options omitted', async () => {
    const service = createService();

    const request = {
      contents: [{ parts: [{ text: 'pong' }] }],
      model: { name: 'gemini-2.5-flash' }
    };

    const response = await service.generateContent(request, 'trace-456');

    expect((global as any).fetch).toHaveBeenCalledWith(
      'https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse',
      expect.objectContaining({
        method: 'POST'
      })
    );
    expect(response.candidates[0].content.parts[0].text).toBe('gemini-cli-response');
    expect(mockTokenManager.getTokenForModel).not.toHaveBeenCalled();
  });

  it('blacklists the current token when the legacy Google GenAI provider returns 429', async () => {
    const service = createService();
    const quotaError = Object.assign(new Error('Too Many Requests'), { status: 429 });

    googleGenAIExports.__mockedGenerateContent.mockRejectedValue(quotaError);
    (mockDatabase.getAgentPrompt as any).mockResolvedValueOnce({
      id: 'legacy-google-prompt',
      agent_type: 'chat_bot',
      prompt_name: 'basic_chat',
      system_instructions: [],
      model_name: 'gemini-2.5-pro',
      model_config: {
        provider: 'google-legacy'
      },
      advanced_config: undefined,
      config_version: 'v1',
      last_config_update: new Date(),
      is_active: true,
      version: 1,
      created_by: 'test',
      created_at: new Date(),
      updated_at: new Date(),
      description: 'legacy prompt',
      allowed_token_ids: []
    });

    await expect(
      service.generateContent(
        { contents: [{ parts: [{ text: 'ping' }] }] },
        'trace-429',
        {
          agentType: 'chat_bot',
          promptName: 'basic_chat'
        }
      )
    ).rejects.toThrow('Too Many Requests');

    expect(mockTokenManager.markTokenFailedForModel).toHaveBeenCalledWith(
      'fake-token',
      'gemini-2.5-flash',
      quotaError,
      'generateContent'
    );
    expect(mockTokenManager.reportError).not.toHaveBeenCalled();
  });

  it('routes GPT models through the OpenAI responses adapter', async () => {
    const service = createService();
    mockedAxios.mockResolvedValue({
      data: {
        output_text: 'openai-response',
        usage: {
          input_tokens: 12,
          output_tokens: 8,
          total_tokens: 20
        },
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: 'openai-response' }]
          }
        ]
      }
    } as any);

    const response = await service.generateContent(
      { contents: [{ parts: [{ text: 'ping' }] }] },
      'trace-openai',
      {
        modelName: 'gpt-4.1',
        agentType: 'chat_bot',
        promptName: 'basic_chat'
      }
    );

    expect(mockedAxios).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://api.openai.com/v1/responses',
        headers: expect.objectContaining({
          Authorization: 'Bearer openai-key'
        })
      })
    );
    expect(googleGenAIExports.__mockedGenerateContent).not.toHaveBeenCalled();
    expect(response.candidates[0].content.parts[0].text).toBe('openai-response');
  });

  it('routes codex models through the ChatGPT backend adapter using local OAuth credentials', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qqbot-codex-'));
    const oauthPath = path.join(tempDir, 'oauth.json');
    const codexAccessToken = createJwt({
      [ 'https://api.openai.com/auth' ]: {
        chatgpt_account_id: 'acct-codex'
      }
    });
    await fs.writeFile(
      oauthPath,
      JSON.stringify({
        'openai-codex': {
          access: codexAccessToken,
          refresh: 'codex-refresh-token',
          expires: Math.floor(Date.now() / 1000) + 3600
        }
      }),
      'utf8'
    );

    const service = new AIService(
      {
        ...baseConfig,
        openai_api_key: 'openai-key',
        codex_oauth_path: oauthPath
      } as any,
      mockDatabase,
      loggingService
    );

    (global as any).fetch = jest.fn(async (input: any) => {
      const url = String(input);
      if (url.includes('/codex/responses')) {
        return createCodexSseResponse('codex-response');
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });

    const response = await service.generateContent(
      { contents: [{ parts: [{ text: 'ping' }] }] },
      'trace-codex',
      {
        modelName: 'gpt-5.4',
        agentType: 'chat_bot',
        promptName: 'basic_chat'
      }
    );

    expect((global as any).fetch).toHaveBeenCalledWith(
      'https://chatgpt.com/backend-api/codex/responses',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"stream":true'),
        headers: expect.objectContaining({
          Authorization: `Bearer ${codexAccessToken}`,
          'chatgpt-account-id': 'acct-codex',
          Accept: 'text/event-stream',
          originator: 'pi',
          Origin: 'https://chatgpt.com',
          Referer: 'https://chatgpt.com/'
        })
      })
    );

    const firstCodexRequest = ((global as any).fetch as jest.Mock).mock.calls[0][1] as { body: string };
    expect(JSON.parse(firstCodexRequest.body)).toEqual(
      expect.objectContaining({
          store: false,
          stream: true,
          text: { verbosity: 'medium' },
          include: ['reasoning.encrypted_content'],
          parallel_tool_calls: true,
          instructions: 'You are a helpful assistant.'
      })
    );
    expect(response.candidates[0].content.parts[0].text).toBe('codex-response');
  });

  it('refreshes expired codex OAuth credentials before sending the request', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qqbot-codex-refresh-'));
    const oauthPath = path.join(tempDir, 'oauth.json');
    await fs.writeFile(
      oauthPath,
      JSON.stringify({
        'openai-codex': {
          access: 'expired-access-token',
          refresh: 'codex-refresh-token',
          expires: Math.floor(Date.now() / 1000) - 60
        }
      }),
      'utf8'
    );

    const refreshedAccessToken = createJwt({
      [ 'https://api.openai.com/auth' ]: {
        chatgpt_account_id: 'acct-refreshed'
      }
    });

    (global as any).fetch = jest.fn(async (input: any) => {
      const url = String(input);
      if (url === 'https://auth.openai.com/oauth/token') {
        return createJsonResponse({
          access_token: refreshedAccessToken,
          refresh_token: 'codex-refresh-token-2',
          expires_in: 3600
        });
      }
      if (url.includes('/codex/responses')) {
        return createCodexSseResponse('codex-response');
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });

    const service = new AIService(
      {
        ...baseConfig,
        codex_oauth_path: oauthPath
      } as any,
      mockDatabase,
      loggingService
    );

    await service.generateContent(
      { contents: [{ parts: [{ text: 'ping' }] }] },
      'trace-codex-refresh',
      {
        modelName: 'gpt-5.4',
        agentType: 'chat_bot',
        promptName: 'basic_chat'
      }
    );

    expect((global as any).fetch).toHaveBeenCalledWith(
      'https://auth.openai.com/oauth/token',
      expect.objectContaining({ method: 'POST' })
    );
    expect((global as any).fetch).toHaveBeenCalledWith(
      'https://chatgpt.com/backend-api/codex/responses',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Bearer ${refreshedAccessToken}`
        })
      })
    );

    const persisted = JSON.parse(await fs.readFile(oauthPath, 'utf8'));
    expect(persisted['openai-codex'].refresh).toBe('codex-refresh-token-2');
    expect(persisted['openai-codex'].accountId).toBe('acct-refreshed');
  });

  it('retries codex responses after a 401 by refreshing OAuth credentials', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qqbot-codex-retry-'));
    const oauthPath = path.join(tempDir, 'oauth.json');
    const staleAccessToken = createJwt({
      [ 'https://api.openai.com/auth' ]: {
        chatgpt_account_id: 'acct-stale'
      }
    });
    await fs.writeFile(
      oauthPath,
      JSON.stringify({
        'openai-codex': {
          access: staleAccessToken,
          refresh: 'codex-refresh-token',
          expires: Math.floor(Date.now() / 1000) + 3600
        }
      }),
      'utf8'
    );

    const refreshedAccessToken = createJwt({
      [ 'https://api.openai.com/auth' ]: {
        chatgpt_account_id: 'acct-retry'
      }
    });

    (global as any).fetch = jest.fn(async (input: any, init?: { headers?: Record<string, string> }) => {
      const url = String(input);
      if (url.includes('/codex/responses')) {
        const authHeader = init?.headers?.Authorization;
        if (authHeader === `Bearer ${staleAccessToken}`) {
          return {
            ok: false,
            status: 401,
            statusText: 'Unauthorized',
            text: async () => JSON.stringify({ detail: 'expired token' })
          } as any;
        }
        return createCodexSseResponse('retry-success');
      }
      if (url === 'https://auth.openai.com/oauth/token') {
        return createJsonResponse({
          access_token: refreshedAccessToken,
          refresh_token: 'codex-refresh-token-next',
          expires_in: 3600
        });
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });

    const service = new AIService(
      {
        ...baseConfig,
        codex_oauth_path: oauthPath
      } as any,
      mockDatabase,
      loggingService
    );

    const response = await service.generateContent(
      { contents: [{ parts: [{ text: 'ping' }] }] },
      'trace-codex-retry',
      {
        modelName: 'gpt-5.4',
        agentType: 'chat_bot',
        promptName: 'basic_chat'
      }
    );

    expect((global as any).fetch).toHaveBeenNthCalledWith(
      1,
      'https://chatgpt.com/backend-api/codex/responses',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Bearer ${staleAccessToken}`,
          'chatgpt-account-id': 'acct-stale'
        })
      })
    );
    expect((global as any).fetch).toHaveBeenNthCalledWith(
      3,
      'https://chatgpt.com/backend-api/codex/responses',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Bearer ${refreshedAccessToken}`
        })
      })
    );
    expect(response.candidates[0].content.parts[0].text).toBe('retry-success');
  });

  it('routes prompt-configured google-gemini-cli requests through the Gemini CLI provider', async () => {
    const service = new AIService(
      {
        ...baseConfig,
        gemini_cli_access_token: 'gemini-cli-access',
        gemini_cli_project_id: 'project-123'
      } as any,
      mockDatabase,
      loggingService
    );

    (mockDatabase.getAgentPrompt as any).mockResolvedValueOnce({
      id: 'chat-bot-prompt',
      agent_type: 'chat_bot',
      prompt_name: 'basic_chat',
      system_instructions: ['system instruction'],
      model_name: 'gemini-2.5-flash',
      model_config: {
        provider: 'google-gemini-cli'
      },
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
    });

    (global as any).fetch = createDefaultFetchMock();

    const response = await service.generateContent(
      { contents: [{ parts: [{ text: 'ping' }] }] },
      'trace-gemini-cli',
      {
        agentType: 'chat_bot',
        promptName: 'basic_chat'
      }
    );

    expect((global as any).fetch).toHaveBeenCalledWith(
      'https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer gemini-cli-access'
        })
      })
    );
    expect(response.candidates[0].content.parts[0].text).toBe('gemini-cli-response');
  });

  it('discovers and persists the Gemini CLI project via loadCodeAssist before streaming', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qqbot-gemini-cli-'));
    const oauthPath = path.join(tempDir, 'oauth_creds.json');
    await fs.writeFile(
      oauthPath,
      JSON.stringify({
        access_token: 'gemini-cli-access',
        refresh_token: 'gemini-cli-refresh',
        expiry_date: Date.now() + 3600_000
      }),
      'utf8'
    );

    (global as any).fetch = createDefaultFetchMock('discovered-project', 'discovered-response');

    const service = new AIService(
      {
        ...baseConfig,
        gemini_cli_access_token: undefined,
        gemini_cli_refresh_token: undefined,
        gemini_cli_expires_at: undefined,
        gemini_cli_project_id: undefined,
        gemini_cli_oauth_path: oauthPath
      } as any,
      mockDatabase,
      loggingService
    );

    const response = await service.generateContent(
      { contents: [{ parts: [{ text: 'ping' }] }] },
      'trace-gemini-discover',
      {
        modelName: 'gemini-2.5-flash',
        agentType: 'chat_bot',
        promptName: 'basic_chat'
      }
    );

    expect((global as any).fetch).toHaveBeenCalledWith(
      'https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer gemini-cli-access'
        })
      })
    );
    expect((global as any).fetch).toHaveBeenCalledWith(
      'https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse',
      expect.objectContaining({
        body: expect.stringContaining('"project":"discovered-project"')
      })
    );
    expect(response.candidates[0].content.parts[0].text).toBe('discovered-response');

    const persisted = JSON.parse(await fs.readFile(oauthPath, 'utf8'));
    expect(persisted.projectId).toBe('discovered-project');
  });
});
