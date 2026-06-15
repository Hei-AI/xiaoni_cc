import { UnifiedLLMConfig } from '../../types';

export type ModelContextPolicy = {
  model: string;
  contextWindowTokens: number;
  maxOutputTokens: number;
  defaultReplyBudgetTokens: number;
  softTriggerRatio: number;
  hardBufferRatio: number;
  softTriggerTokens?: number;
};

export type ResolvedModelContextPolicy = ModelContextPolicy & {
  source: 'default' | 'environment' | 'provider-config';
};

type ModelContextPolicyInput = Partial<ModelContextPolicy> & {
  model?: string;
};

const DEFAULT_SOFT_TRIGGER_RATIO = 0.5;
const DEFAULT_HARD_BUFFER_RATIO = 0.1;
const DEFAULT_REPLY_BUDGET_TOKENS = 8192;

const DEFAULT_MODEL_POLICIES: Record<string, ModelContextPolicy> = {
  'gpt-5-mini': {
    model: 'gpt-5-mini',
    contextWindowTokens: 400000,
    maxOutputTokens: 128000,
    defaultReplyBudgetTokens: DEFAULT_REPLY_BUDGET_TOKENS,
    softTriggerRatio: DEFAULT_SOFT_TRIGGER_RATIO,
    hardBufferRatio: DEFAULT_HARD_BUFFER_RATIO
  },
  'gpt-5.4': {
    model: 'gpt-5.4',
    contextWindowTokens: 1050000,
    maxOutputTokens: 128000,
    defaultReplyBudgetTokens: DEFAULT_REPLY_BUDGET_TOKENS,
    softTriggerRatio: DEFAULT_SOFT_TRIGGER_RATIO,
    hardBufferRatio: DEFAULT_HARD_BUFFER_RATIO
  },
  'gpt-5.5': {
    model: 'gpt-5.5',
    contextWindowTokens: 272000,
    maxOutputTokens: 128000,
    defaultReplyBudgetTokens: DEFAULT_REPLY_BUDGET_TOKENS,
    softTriggerRatio: DEFAULT_SOFT_TRIGGER_RATIO,
    hardBufferRatio: DEFAULT_HARD_BUFFER_RATIO
  },
  'gpt-5.5-mini': {
    model: 'gpt-5.5-mini',
    contextWindowTokens: 400000,
    maxOutputTokens: 128000,
    defaultReplyBudgetTokens: DEFAULT_REPLY_BUDGET_TOKENS,
    softTriggerRatio: DEFAULT_SOFT_TRIGGER_RATIO,
    hardBufferRatio: DEFAULT_HARD_BUFFER_RATIO
  },
  'gpt-5-codex': {
    model: 'gpt-5-codex',
    contextWindowTokens: 400000,
    maxOutputTokens: 128000,
    defaultReplyBudgetTokens: DEFAULT_REPLY_BUDGET_TOKENS,
    softTriggerRatio: DEFAULT_SOFT_TRIGGER_RATIO,
    hardBufferRatio: DEFAULT_HARD_BUFFER_RATIO
  },
  'gpt-5.2-codex': {
    model: 'gpt-5.2-codex',
    contextWindowTokens: 400000,
    maxOutputTokens: 128000,
    defaultReplyBudgetTokens: DEFAULT_REPLY_BUDGET_TOKENS,
    softTriggerRatio: DEFAULT_SOFT_TRIGGER_RATIO,
    hardBufferRatio: DEFAULT_HARD_BUFFER_RATIO
  },
  'gpt-5.3-codex': {
    model: 'gpt-5.3-codex',
    contextWindowTokens: 400000,
    maxOutputTokens: 128000,
    defaultReplyBudgetTokens: DEFAULT_REPLY_BUDGET_TOKENS,
    softTriggerRatio: DEFAULT_SOFT_TRIGGER_RATIO,
    hardBufferRatio: DEFAULT_HARD_BUFFER_RATIO,
    softTriggerTokens: 200000
  },
  'codex-mini-latest': {
    model: 'codex-mini-latest',
    contextWindowTokens: 200000,
    maxOutputTokens: 100000,
    defaultReplyBudgetTokens: DEFAULT_REPLY_BUDGET_TOKENS,
    softTriggerRatio: DEFAULT_SOFT_TRIGGER_RATIO,
    hardBufferRatio: DEFAULT_HARD_BUFFER_RATIO
  }
};

const MODEL_ALIASES: Record<string, string> = {
  gmini: 'gpt-5-mini'
};

function normalizeModelName(modelName?: string): string {
  const value = typeof modelName === 'string' ? modelName.trim() : '';
  if (!value) {
    return '';
  }
  const normalized = value.includes('/') ? value.split('/').pop() || value : value;
  return normalized.trim().toLowerCase();
}

function readPositiveNumber(value: unknown): number | undefined {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
}

function readRatio(value: unknown): number | undefined {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) && numeric > 0 && numeric < 1 ? numeric : undefined;
}

function extractConfiguredPolicies(): Record<string, ModelContextPolicyInput> {
  const rawValue = process.env.MODEL_CONTEXT_POLICIES_JSON;
  if (!rawValue || !rawValue.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawValue);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, ModelContextPolicyInput>;
  } catch {
    return {};
  }
}

function normalizePolicyInput(modelName: string, policy: ModelContextPolicyInput): ModelContextPolicy | null {
  const contextWindowTokens = readPositiveNumber(policy.contextWindowTokens);
  const maxOutputTokens = readPositiveNumber(policy.maxOutputTokens);

  if (!contextWindowTokens || !maxOutputTokens) {
    return null;
  }

  const defaultReplyBudgetTokens =
    readPositiveNumber(policy.defaultReplyBudgetTokens) || DEFAULT_REPLY_BUDGET_TOKENS;
  const softTriggerRatio =
    readRatio(policy.softTriggerRatio) || DEFAULT_SOFT_TRIGGER_RATIO;
  const hardBufferRatio =
    readRatio(policy.hardBufferRatio) || DEFAULT_HARD_BUFFER_RATIO;

  return {
    model: policy.model?.trim() || modelName,
    contextWindowTokens,
    maxOutputTokens,
    defaultReplyBudgetTokens,
    softTriggerRatio,
    hardBufferRatio,
    softTriggerTokens: readPositiveNumber(policy.softTriggerTokens)
  };
}

function extractProviderPolicy(providerConfig?: UnifiedLLMConfig | null): ModelContextPolicyInput {
  const providerSpecific = providerConfig?.model?.providerSpecific || {};
  const nested = providerSpecific.contextPolicy && typeof providerSpecific.contextPolicy === 'object'
    ? providerSpecific.contextPolicy as Record<string, unknown>
    : {};

  return {
    contextWindowTokens: nested.contextWindowTokens ?? providerSpecific.contextWindowTokens,
    maxOutputTokens: nested.maxOutputTokens ?? providerSpecific.maxOutputTokens,
    defaultReplyBudgetTokens: nested.defaultReplyBudgetTokens ?? providerSpecific.defaultReplyBudgetTokens,
    softTriggerRatio: nested.softTriggerRatio ?? providerSpecific.softTriggerRatio,
    hardBufferRatio: nested.hardBufferRatio ?? providerSpecific.hardBufferRatio,
    softTriggerTokens: nested.softTriggerTokens ?? providerSpecific.softTriggerTokens
  };
}

export function resolveModelContextPolicy(
  modelName?: string,
  providerConfig?: UnifiedLLMConfig | null
): ResolvedModelContextPolicy | null {
  const normalizedModel = normalizeModelName(modelName);
  if (!normalizedModel) {
    return null;
  }

  const aliasedModel = MODEL_ALIASES[normalizedModel] || normalizedModel;
  const configuredPolicies = extractConfiguredPolicies();
  const environmentPolicy =
    normalizePolicyInput(aliasedModel, configuredPolicies[normalizedModel] || configuredPolicies[aliasedModel] || {});
  const defaultPolicy = DEFAULT_MODEL_POLICIES[aliasedModel] || null;
  const providerPolicy = normalizePolicyInput(
    aliasedModel,
    extractProviderPolicy(providerConfig)
  );

  if (providerPolicy) {
    return {
      ...providerPolicy,
      source: 'provider-config'
    };
  }

  if (environmentPolicy) {
    return {
      ...environmentPolicy,
      source: 'environment'
    };
  }

  if (defaultPolicy) {
    return {
      ...defaultPolicy,
      source: 'default'
    };
  }

  return null;
}

export function computeContextThresholds(
  policy: ModelContextPolicy,
  requestedMaxOutputTokens?: number
) {
  const requestedReplyBudget = readPositiveNumber(requestedMaxOutputTokens);
  const replyBudgetTokens = Math.min(
    requestedReplyBudget || policy.defaultReplyBudgetTokens,
    policy.maxOutputTokens
  );
  const softTriggerTokens = Math.min(
    policy.softTriggerTokens || Math.floor(policy.contextWindowTokens * policy.softTriggerRatio),
    policy.contextWindowTokens
  );
  const hardCeilingTokens = Math.max(
    1,
    Math.floor((policy.contextWindowTokens - replyBudgetTokens) * (1 - policy.hardBufferRatio))
  );

  return {
    replyBudgetTokens,
    softTriggerTokens,
    hardCeilingTokens
  };
}
