import { UnifiedLLMConfig } from '../../types';

export type ResolvedProviderConfig = {
  provider: 'google' | 'google-gemini-cli' | 'google-legacy' | 'openai' | 'codex';
  providerSpecific?: Record<string, any>;
};

const MODEL_PROVIDER_OVERRIDES_ENV = 'MODEL_PROVIDER_OVERRIDES_JSON';

function normalizeProvider(value: unknown): ResolvedProviderConfig['provider'] | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'google-gemini-cli' || normalized === 'gemini-cli') {
    return 'google-gemini-cli';
  }
  if (normalized === 'google' || normalized === 'gemini') {
    return 'google-gemini-cli';
  }
  if (
    normalized === 'google-legacy' ||
    normalized === 'google-api' ||
    normalized === 'gemini-api' ||
    normalized === 'google-direct' ||
    normalized === 'gemini-direct'
  ) {
    return 'google-legacy';
  }
  if (normalized === 'openai') {
    return 'openai';
  }
  if (normalized === 'codex' || normalized === 'openai-codex') {
    return 'codex';
  }
  return undefined;
}

export function inferProviderFromModelName(modelName?: string): ResolvedProviderConfig['provider'] {
  const normalized = (modelName || '').trim().toLowerCase();
  const override = resolveProviderOverride(normalized);

  if (override) {
    return override;
  }

  if (
    normalized.includes('codex') ||
    normalized === 'gpt-5-mini' ||
    normalized === 'gpt-5.4' ||
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

function resolveProviderOverride(normalizedModelName: string): ResolvedProviderConfig['provider'] | undefined {
  if (!normalizedModelName) {
    return undefined;
  }

  const raw = process.env[MODEL_PROVIDER_OVERRIDES_ENV];
  if (!raw || !raw.trim()) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return undefined;
    }

    const direct = normalizeProvider((parsed as Record<string, unknown>)[normalizedModelName]);
    if (direct) {
      return direct;
    }

    const shortName = normalizedModelName.includes('/') ? normalizedModelName.split('/').pop() || normalizedModelName : normalizedModelName;
    return normalizeProvider((parsed as Record<string, unknown>)[shortName]);
  } catch {
    return undefined;
  }
}

export function resolveProviderConfigFromPrompt(agentPrompt: any): ResolvedProviderConfig {
  const modelConfig = normalizeJsonField(agentPrompt?.model_config);
  const advancedConfig = normalizeJsonField(agentPrompt?.advanced_config);

  const explicitProvider =
    normalizeProvider(modelConfig?.provider) ||
    normalizeProvider(advancedConfig?.model?.provider) ||
    normalizeProvider(advancedConfig?.provider);

  const provider = explicitProvider || inferProviderFromModelName(agentPrompt?.model_name);

  const providerSpecific = {
    ...(modelConfig?.providerSpecific && typeof modelConfig.providerSpecific === 'object'
      ? modelConfig.providerSpecific
      : {}),
    ...(advancedConfig?.model?.providerSpecific && typeof advancedConfig.model.providerSpecific === 'object'
      ? advancedConfig.model.providerSpecific
      : {})
  };

  if (typeof modelConfig?.baseUrl === 'string' && modelConfig.baseUrl.trim()) {
    providerSpecific.baseUrl = modelConfig.baseUrl.trim();
  }
  if (typeof advancedConfig?.model?.baseUrl === 'string' && advancedConfig.model.baseUrl.trim()) {
    providerSpecific.baseUrl = advancedConfig.model.baseUrl.trim();
  }
  if (typeof modelConfig?.responsesPath === 'string' && modelConfig.responsesPath.trim()) {
    providerSpecific.responsesPath = modelConfig.responsesPath.trim();
  }
  if (
    typeof advancedConfig?.model?.responsesPath === 'string' &&
    advancedConfig.model.responsesPath.trim()
  ) {
    providerSpecific.responsesPath = advancedConfig.model.responsesPath.trim();
  }

  return {
    provider,
    providerSpecific: Object.keys(providerSpecific).length > 0 ? providerSpecific : undefined
  };
}

export function resolveProviderFromUnifiedConfig(config?: UnifiedLLMConfig | null): ResolvedProviderConfig['provider'] {
  if (!config) {
    return 'google-gemini-cli';
  }

  return normalizeProvider(config.model.provider) || inferProviderFromModelName(config.model.name);
}

function normalizeJsonField(value: unknown): Record<string, any> {
  if (!value) {
    return {};
  }

  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }

  return typeof value === 'object' ? (value as Record<string, any>) : {};
}
