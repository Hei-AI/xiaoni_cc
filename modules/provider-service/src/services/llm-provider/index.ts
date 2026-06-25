import { aiConfig } from '../../config';
import { UnifiedLLMConfig } from '../../types';
import { AnthropicProvider } from './anthropic-provider';
import { CodexLocalProvider } from './codex-local-provider';
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
    case 'codex-local':
      return new CodexLocalProvider(aiConfig);
    case 'anthropic':
      // The agent leaves max_output_tokens unset on main-loop/fork turns; without a
      // default the translate caps at 16k, which with adaptive thinking (thinking
      // tokens count toward max_tokens) truncates complex turns. Default to the
      // claude-opus-4-6 model-context-policy ceiling (64k). It is only a cap — billed
      // per token actually generated — so a higher ceiling has no cost downside.
      return new AnthropicProvider(aiConfig, {
        defaultMaxTokens: Number(process.env.ANTHROPIC_MAX_OUTPUT_TOKENS) || 64000
      });
    case 'google':
    case 'google-legacy':
    case 'google-gemini-cli':
    default:
      return new GeminiCliProvider(aiConfig);
  }
}
