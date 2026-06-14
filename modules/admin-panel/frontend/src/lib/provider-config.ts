import type {
  PlaygroundProviderConfig,
  PlaygroundProviderId,
} from '@/types/playground';

type PromptConfigLike = {
  id?: string | null;
  prompt_name?: string | null;
  model_name?: string | null;
  model_config?: unknown;
  advanced_config?: unknown;
} | null | undefined;

const DEFAULT_VERSION = {
  version: '1.0.0',
  createdAt: '1970-01-01T00:00:00.000Z',
  updatedAt: '1970-01-01T00:00:00.000Z',
  createdBy: 'playground',
  updatedBy: 'playground',
  isActive: true,
};

export const PROVIDER_OPTIONS: Array<{
  value: PlaygroundProviderId;
  label: string;
}> = [
  { value: 'google-gemini-cli', label: 'Google Gemini CLI' },
  { value: 'google-legacy', label: 'Google Legacy API' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'codex', label: 'Codex' },
  { value: 'codex-local', label: 'Codex Local' },
];

export const PLAYGROUND_PROVIDER_MODEL_OPTIONS: Record<PlaygroundProviderId, string[]> = {
  google: [
    'gemini-2.5-flash',
    'gemini-2.5-pro',
  ],
  'google-gemini-cli': [
    'gemini-2.5-flash',
    'gemini-2.5-pro',
  ],
  'google-legacy': [
    'gemini-2.5-flash',
    'gemini-2.5-pro',
  ],
  openai: [
    'gpt-5-mini',
    'gpt-5.4',
    'gpt-5.5',
  ],
  codex: [
    'gpt-5-mini',
    'gpt-5.3-codex',
  ],
  'codex-local': [
    'gpt-5.5',
    'gpt-5-mini',
    'gpt-5.4',
  ],
  custom: [],
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

function normalizeSupportedPlaygroundTools(value: unknown): Record<string, unknown> {
  const record = asRecord(parseMaybeJson(value)) || {};
  const definitions = Array.isArray(record.definitions) ? record.definitions : [];
  const toolChoice = Object.prototype.hasOwnProperty.call(record, 'toolChoice')
    ? record.toolChoice ?? null
    : null;

  const next: Record<string, unknown> = {};
  if (definitions.length > 0) {
    next.definitions = definitions;
  }
  if (toolChoice !== null) {
    next.toolChoice = toolChoice;
  }
  return next;
}

export function normalizePromptProvider(value: unknown): PlaygroundProviderId {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'openai') return 'openai';
  if (normalized === 'codex' || normalized === 'openai-codex') return 'codex';
  if (
    normalized === 'codex-local' ||
    normalized === 'openai-codex-local' ||
    normalized === 'local-codex' ||
    normalized === 'codex-openai'
  ) return 'codex-local';
  if (normalized === 'custom') return 'custom';
  if (
    normalized === 'google-legacy' ||
    normalized === 'google' ||
    normalized === 'gemini-api' ||
    normalized === 'google-api'
  ) {
    return normalized === 'google' ? 'google' : 'google-legacy';
  }
  return 'google-gemini-cli';
}

export function inferProviderFromModelName(modelName?: string | null): PlaygroundProviderId {
  const normalized = (modelName || '').trim().toLowerCase();
  if (
    normalized.includes('codex') ||
    normalized === 'gpt-5-mini' ||
    normalized === 'gpt-5.4' ||
    normalized === 'gpt-5.5' ||
    normalized === 'gpt-5.5-mini' ||
    normalized === 'gpt-5.3-codex' ||
    normalized === 'gpt-5.3-codex-spark' ||
    normalized === 'gpt-5.2-codex'
  ) {
    return 'codex-local';
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

export function defaultModelForProvider(provider: PlaygroundProviderId): string {
  switch (provider) {
    case 'openai':
      return 'gpt-5-mini';
    case 'codex-local':
      return 'gpt-5.5';
    case 'codex':
      return 'gpt-5-mini';
    case 'google':
    case 'google-legacy':
      return 'gemini-2.5-flash';
    case 'custom':
      return 'custom-model';
    case 'google-gemini-cli':
    default:
      return 'gemini-2.5-flash';
  }
}

export function createDefaultPlaygroundProviderConfig(
  provider: PlaygroundProviderId = 'google-gemini-cli'
): PlaygroundProviderConfig {
  return {
    id: 'playground-provider',
    name: 'Playground Provider Config',
    category: 'playground',
    model: {
      name: null,
      provider,
      providerSpecific: {},
    },
    generation: {
      temperature: 0.7,
      topP: 0.95,
      topK: 40,
      maxOutputTokens: 2048,
    },
    thinking: {},
    safety: [],
    tools: {},
    context: {},
    performance: {},
    version: { ...DEFAULT_VERSION },
  };
}

export function normalizePlaygroundProviderConfig(
  value: unknown,
  fallbackProvider?: PlaygroundProviderId
): PlaygroundProviderConfig {
  const record = asRecord(parseMaybeJson(value));
  if (!record) {
    return createDefaultPlaygroundProviderConfig(fallbackProvider);
  }

  const model = asRecord(record.model);
  if (model && typeof model.name === 'string' && typeof model.provider === 'string') {
    const provider = normalizePromptProvider(model.provider);
    return {
      id: typeof record.id === 'string' ? record.id : 'playground-provider',
      name: typeof record.name === 'string' ? record.name : 'Playground Provider Config',
      description: typeof record.description === 'string' ? record.description : undefined,
      category: typeof record.category === 'string' ? record.category : 'playground',
      model: {
        ...model,
        name: normalizeModelName(model.name),
        provider,
        providerSpecific: asRecord(parseMaybeJson(model.providerSpecific)) || {},
        allowedTokenIds: Array.isArray(model.allowedTokenIds) ? model.allowedTokenIds.filter((item): item is number => typeof item === 'number') : undefined,
        fallbackModels: Array.isArray(model.fallbackModels) ? model.fallbackModels.filter((item): item is string => typeof item === 'string') : undefined,
      },
      generation: asRecord(parseMaybeJson(record.generation)) || {},
      thinking: asRecord(parseMaybeJson(record.thinking)) || {},
      safety: Array.isArray(parseMaybeJson(record.safety))
        ? (parseMaybeJson(record.safety) as Array<Record<string, unknown>>)
        : [],
      tools: asRecord(parseMaybeJson(record.tools)) || {},
      context: asRecord(parseMaybeJson(record.context)) || {},
      performance: asRecord(parseMaybeJson(record.performance)) || {},
      version: asRecord(parseMaybeJson(record.version)) || { ...DEFAULT_VERSION },
    };
  }

  const provider = normalizePromptProvider(record.provider ?? fallbackProvider);
  const context = asRecord(parseMaybeJson(record.context)) || {};
  const generation = asRecord(parseMaybeJson(record.generation)) || {};
  const stopSequences = Array.isArray(generation.stopSequences)
    ? generation.stopSequences
    : Array.isArray(generation.stop)
      ? generation.stop
      : generation.stop !== undefined
        ? [generation.stop]
        : undefined;

  return {
    id: 'playground-provider',
    name: 'Playground Provider Config',
    category: 'playground',
    model: {
      name: normalizeModelName(context.modelName),
      provider,
      providerSpecific: asRecord(parseMaybeJson(record.providerSpecific)) || {},
    },
    generation: {
      ...generation,
      ...(stopSequences ? { stopSequences } : {}),
    },
    thinking: asRecord(parseMaybeJson(record.thinking)) || {},
    safety: Array.isArray(parseMaybeJson(record.safety))
      ? (parseMaybeJson(record.safety) as Array<Record<string, unknown>>)
      : [],
    tools: asRecord(parseMaybeJson(record.tools)) || {},
    context,
    performance: asRecord(parseMaybeJson(record.performance)) || {},
    version: { ...DEFAULT_VERSION },
  };
}

export function getProviderLabel(provider: PlaygroundProviderId): string {
  return PROVIDER_OPTIONS.find((option) => option.value === provider)?.label || provider;
}

export function getPlaygroundProviderId(providerConfig: PlaygroundProviderConfig): PlaygroundProviderId {
  return normalizePromptProvider(providerConfig.model?.provider);
}

export function getPlaygroundModelName(providerConfig: PlaygroundProviderConfig): string | null {
  return normalizeModelName(providerConfig.model?.name);
}

export function getPlaygroundProviderSpecific(providerConfig: PlaygroundProviderConfig): Record<string, unknown> {
  return asRecord(parseMaybeJson(providerConfig.model?.providerSpecific)) || {};
}

export function withPlaygroundProviderId(
  providerConfig: PlaygroundProviderConfig,
  provider: PlaygroundProviderId
): PlaygroundProviderConfig {
  const normalized = normalizePlaygroundProviderConfig(providerConfig, provider);

  return {
    ...normalized,
    model: {
      ...normalized.model,
      provider,
    },
  };
}

export function withPlaygroundModelName(
  providerConfig: PlaygroundProviderConfig,
  modelName: string
): PlaygroundProviderConfig {
  const normalized = normalizePlaygroundProviderConfig(providerConfig);
  return {
    ...normalized,
    model: {
      ...normalized.model,
      name: modelName,
    },
  };
}

export function withPlaygroundProviderSpecific(
  providerConfig: PlaygroundProviderConfig,
  providerSpecific: Record<string, unknown>
): PlaygroundProviderConfig {
  const normalized = normalizePlaygroundProviderConfig(providerConfig);
  return {
    ...normalized,
    model: {
      ...normalized.model,
      providerSpecific,
    },
  };
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
  const next = createDefaultPlaygroundProviderConfig(provider);

  return {
    ...next,
    model: {
      ...next.model,
      name: normalizeModelName(prompt?.model_name),
      provider,
      providerSpecific,
    },
    generation: generationConfig || next.generation,
    thinking: asRecord(parseMaybeJson(advancedConfig.thinkingConfig)) || {},
    safety: Array.isArray(parseMaybeJson(advancedConfig.safetySettings))
      ? (parseMaybeJson(advancedConfig.safetySettings) as Array<Record<string, unknown>>)
      : [],
    tools: normalizeSupportedPlaygroundTools(advancedConfig.toolsConfig),
    context: {
      promptId: prompt?.id || null,
      promptName: prompt?.prompt_name || null,
    },
    performance: typeof generationConfig?.timeout === 'number'
      ? { timeout: generationConfig.timeout }
      : {},
  };
}
