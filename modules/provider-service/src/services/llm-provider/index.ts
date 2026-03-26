import { aiConfig } from '../../config';
import { UnifiedLLMConfig } from '../../types';
import { CodexProvider } from './codex-provider';
import { GeminiCliProvider } from './gemini-cli-provider';
import { OpenAIProvider } from './openai-provider';
import { inferProviderFromModelName, resolveProviderFromUnifiedConfig } from './provider-config';
import { LLMProvider, LLMProviderId } from './types';

export function resolveProviderId(config?: UnifiedLLMConfig | null, modelName?: string): LLMProviderId {
  const fromConfig = config ? resolveProviderFromUnifiedConfig(config) : undefined;
  const resolved = fromConfig || inferProviderFromModelName(modelName);

  if (resolved === 'google' || resolved === 'google-legacy') {
    return 'google-gemini-cli';
  }

  return resolved;
}

export function createProviderClient(providerId: LLMProviderId): LLMProvider {
  switch (providerId) {
    case 'openai':
      return new OpenAIProvider(aiConfig);
    case 'codex':
      return new CodexProvider(aiConfig);
    case 'google':
    case 'google-legacy':
    case 'google-gemini-cli':
    default:
      return new GeminiCliProvider(aiConfig);
  }
}
