import type { PlaygroundProviderConfig } from '@/types/playground';

type PromptConfigLike = {
  id?: string | null;
  prompt_name?: string | null;
  model_name?: string | null;
  model_config?: unknown;
  advanced_config?: unknown;
} | null | undefined;

export const PROVIDER_OPTIONS: Array<{
  value: PlaygroundProviderConfig['provider'];
  label: string;
}> = [
  { value: 'google-gemini-cli', label: 'Google Gemini CLI' },
  { value: 'google-legacy', label: 'Google Legacy API' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'codex', label: 'Codex' },
];

export const PLAYGROUND_PROVIDER_MODEL_OPTIONS: Record<PlaygroundProviderConfig['provider'], string[]> = {
  'google-gemini-cli': [
    'gemini-2.5-flash',
    'gemini-2.5-pro',
  ],
  'google-legacy': [
    'gemini-2.5-flash',
    'gemini-2.5-pro',
  ],
  openai: [
    'gpt-5.4-mini',
    'gpt-5.4',
  ],
  codex: [
    'gpt-5.4-mini',
    'gpt-5.3-codex',
  ],
};

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }

  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }

  return value;
}

function normalizeModelName(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function normalizePromptProvider(value: unknown): PlaygroundProviderConfig['provider'] {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'openai') return 'openai';
  if (normalized === 'codex' || normalized === 'openai-codex') return 'codex';
  if (
    normalized === 'google-legacy' ||
    normalized === 'google' ||
    normalized === 'gemini-api' ||
    normalized === 'google-api'
  ) {
    return 'google-legacy';
  }
  return 'google-gemini-cli';
}

export function inferProviderFromModelName(modelName?: string | null): PlaygroundProviderConfig['provider'] {
  const normalized = (modelName || '').trim().toLowerCase();
  if (
    normalized.includes('codex') ||
    normalized === 'gpt-5-mini' ||
    normalized === 'gpt-5.4-mini' ||
    normalized === 'gpt-5.3-codex' ||
    normalized === 'gpt-5.3-codex-spark' ||
    normalized === 'gpt-5.2-codex'
  ) {
    return 'codex';
  }

  if (
    normalized.startsWith('gpt-') ||
    normalized.startsWith('o1') ||
    normalized.startsWith('o3') ||
    normalized.startsWith('o4')
  ) {
    return 'openai';
  }

  return 'google-gemini-cli';
}

export function defaultModelForProvider(provider: PlaygroundProviderConfig['provider']): string {
  switch (provider) {
    case 'openai':
      return 'gpt-5.4-mini';
    case 'codex':
      return 'gpt-5.4-mini';
    case 'google-legacy':
      return 'gemini-2.5-flash';
    case 'google-gemini-cli':
    default:
      return 'gemini-2.5-flash';
  }
}

export function getProviderLabel(provider: PlaygroundProviderConfig['provider']): string {
  return PROVIDER_OPTIONS.find((option) => option.value === provider)?.label || provider;
}

export function resolvePromptProviderConfig(prompt?: PromptConfigLike): PlaygroundProviderConfig {
  const modelConfig = asRecord(parseMaybeJson(prompt?.model_config)) || {};
  const advancedConfig = asRecord(parseMaybeJson(prompt?.advanced_config)) || {};
  const advancedModel = asRecord(advancedConfig.model);
  const provider = normalizePromptProvider(
    modelConfig.provider
      ?? advancedConfig.provider
      ?? advancedModel?.provider
      ?? inferProviderFromModelName(prompt?.model_name)
  );
  const generationConfig = asRecord(parseMaybeJson(advancedConfig.generationConfig));
  const providerSpecific = {
    ...(asRecord(parseMaybeJson(modelConfig.providerSpecific)) || {}),
    ...(asRecord(parseMaybeJson(advancedModel?.providerSpecific)) || {}),
  };

  return {
    provider,
    generation: generationConfig || {
      temperature: modelConfig.temperature ?? 0.7,
      topP: modelConfig.topP ?? 0.95,
      topK: modelConfig.topK ?? 40,
      maxOutputTokens: modelConfig.maxOutputTokens ?? 2048,
    },
    thinking: asRecord(parseMaybeJson(advancedConfig.thinkingConfig)) || {},
    safety: Array.isArray(parseMaybeJson(advancedConfig.safetySettings))
      ? (parseMaybeJson(advancedConfig.safetySettings) as Array<Record<string, unknown>>)
      : [],
    tools: asRecord(parseMaybeJson(advancedConfig.toolsConfig)) || {},
    context: {
      promptId: prompt?.id || null,
      promptName: prompt?.prompt_name || null,
      modelName: normalizeModelName(prompt?.model_name) || defaultModelForProvider(provider),
    },
    providerSpecific,
  };
}
