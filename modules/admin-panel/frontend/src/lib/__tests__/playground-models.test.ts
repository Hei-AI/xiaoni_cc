import type { PlaygroundProviderConfig } from '@/types/playground';
import {
  applyPlaygroundModelOverride,
  defaultModelForPlaygroundProvider,
  derivePlaygroundModelOverride,
  getPromptDefaultModelName,
} from '@/lib/playground-models';

function makeProviderConfig(overrides: Partial<PlaygroundProviderConfig> = {}): PlaygroundProviderConfig {
  return {
    provider: 'google-gemini-cli',
    generation: {},
    thinking: {},
    safety: [],
    tools: {},
    context: {},
    providerSpecific: {},
    ...overrides,
  };
}

describe('playground-models', () => {
  it('treats a stored prompt model as inherited instead of an override', () => {
    const override = derivePlaygroundModelOverride(
      makeProviderConfig({
        context: { modelName: 'gemini-2.5-flash' },
      }),
      { model_name: 'gemini-2.5-flash' }
    );

    expect(override).toBe('');
  });

  it('keeps a different stored model as an explicit override', () => {
    const override = derivePlaygroundModelOverride(
      makeProviderConfig({
        context: { modelName: 'gemini-2.5-pro' },
      }),
      { model_name: 'gemini-2.5-flash' }
    );

    expect(override).toBe('gemini-2.5-pro');
  });

  it('drops the stored provider default when no prompt model exists', () => {
    const override = derivePlaygroundModelOverride(
      makeProviderConfig({
        provider: 'openai',
        context: { modelName: 'gpt-5.4-mini' },
      }),
      null
    );

    expect(override).toBe('');
    expect(defaultModelForPlaygroundProvider('openai')).toBe('gpt-5.4-mini');
    expect(getPromptDefaultModelName(null)).toBeNull();
  });

  it('writes modelName only when an override is present', () => {
    const withOverride = applyPlaygroundModelOverride(makeProviderConfig(), 'gemini-2.5-pro');
    expect(withOverride.context?.modelName).toBe('gemini-2.5-pro');

    const withoutOverride = applyPlaygroundModelOverride(withOverride, '');
    expect(withoutOverride.context?.modelName).toBeUndefined();
  });
});
