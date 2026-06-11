import { applyChatSettingToggle, isChatSettingToggleDisabled } from '../chat-settings';

describe('chat-settings helpers', () => {
  it('updates the single IM entry switch', () => {
    expect(applyChatSettingToggle({ is_enabled: 1 }, 'is_enabled', false)).toEqual({
      is_enabled: 0,
    });
  });

  it('does not disable the IM entry switch through child-toggle rules', () => {
    expect(isChatSettingToggleDisabled({ is_enabled: 0 }, 'is_enabled')).toBe(false);
  });
});
