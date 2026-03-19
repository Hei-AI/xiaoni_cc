import { AIConfig } from '../../types';
import { getTokenManager } from '../../utils/token-manager';
import { GeminiProvider } from './gemini-provider';
import { GeminiCliProvider } from './gemini-cli-provider';
import { CodexProvider } from './codex-provider';
import { OpenAIProvider } from './openai-provider';
import { LLMProvider, LLMProviderId } from './types';

type TokenManagerInstance = ReturnType<typeof getTokenManager>;

export function createLLMProvider(params: {
  providerId: LLMProviderId;
  aiConfig: AIConfig;
  tokenManager: TokenManagerInstance;
}): LLMProvider {
  switch (params.providerId) {
    case 'google':
    case 'google-gemini-cli':
      return new GeminiCliProvider(params.aiConfig);
    case 'google-legacy':
      return new GeminiProvider(params.tokenManager);
    case 'openai':
      return new OpenAIProvider(params.aiConfig);
    case 'codex':
      return new CodexProvider(params.aiConfig);
    default:
      return new GeminiCliProvider(params.aiConfig);
  }
}
