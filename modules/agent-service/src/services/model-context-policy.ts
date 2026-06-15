type ModelContextPolicy = {
  model: string;
  contextWindowTokens: number;
  maxOutputTokens: number;
};

const DEFAULT_MODEL_POLICIES: Record<string, ModelContextPolicy> = {
  'gpt-5-mini': {
    model: 'gpt-5-mini',
    contextWindowTokens: 400000,
    maxOutputTokens: 128000
  },
  'gpt-5.4': {
    model: 'gpt-5.4',
    contextWindowTokens: 1050000,
    maxOutputTokens: 128000
  },
  'gpt-5.5': {
    model: 'gpt-5.5',
    contextWindowTokens: 272000,
    maxOutputTokens: 128000
  },
  'gpt-5.5-mini': {
    model: 'gpt-5.5-mini',
    contextWindowTokens: 400000,
    maxOutputTokens: 128000
  },
  'gpt-5-codex': {
    model: 'gpt-5-codex',
    contextWindowTokens: 400000,
    maxOutputTokens: 128000
  },
  'gpt-5.2-codex': {
    model: 'gpt-5.2-codex',
    contextWindowTokens: 400000,
    maxOutputTokens: 128000
  },
  'gpt-5.3-codex': {
    model: 'gpt-5.3-codex',
    contextWindowTokens: 400000,
    maxOutputTokens: 128000
  },
  'codex-mini-latest': {
    model: 'codex-mini-latest',
    contextWindowTokens: 200000,
    maxOutputTokens: 100000
  }
};

const MODEL_ALIASES: Record<string, string> = {
  gmini: 'gpt-5-mini'
};

function normalizeModelName(modelName?: string) {
  const value = typeof modelName === 'string' ? modelName.trim() : '';
  if (!value) {
    return '';
  }
  const normalized = value.includes('/') ? value.split('/').pop() || value : value;
  return normalized.trim().toLowerCase();
}

function readPositiveNumber(value: unknown) {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
}

export function resolveModelContextPolicy(
  modelName?: string,
  parameters?: Record<string, unknown> | null
): ModelContextPolicy | null {
  const normalizedModel = normalizeModelName(modelName);
  if (!normalizedModel) {
    return null;
  }

  const aliasedModel = MODEL_ALIASES[normalizedModel] || normalizedModel;
  const providerSpecific = parameters?.model_config
    && typeof parameters.model_config === 'object'
    && !Array.isArray(parameters.model_config)
      ? parameters.model_config as Record<string, unknown>
      : {};

  const contextWindowTokens = readPositiveNumber(providerSpecific.contextWindowTokens);
  const maxOutputTokens = readPositiveNumber(providerSpecific.maxOutputTokens);
  if (contextWindowTokens && maxOutputTokens) {
    return {
      model: aliasedModel,
      contextWindowTokens,
      maxOutputTokens
    };
  }

  return DEFAULT_MODEL_POLICIES[aliasedModel] || null;
}
