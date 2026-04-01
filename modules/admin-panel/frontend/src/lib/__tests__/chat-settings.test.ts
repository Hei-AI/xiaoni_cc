import {
  applyChatSettingToggle,
  isChatSettingToggleDisabled,
} from '../chat-settings';

describe('chat-settings helpers', () => {
  it('clears learning and reply when receive is turned off', () => {
    expect(applyChatSettingToggle({
      is_enabled: 1,
      continuous_learning_enabled: 1,
      auto_reply_enabled: 1,
    }, 'is_enabled', false)).toEqual({
      is_enabled: 0,
      continuous_learning_enabled: 0,
      auto_reply_enabled: 0,
    });
  });

  it('disables child toggles when receive is off', () => {
    expect(isChatSettingToggleDisabled({ is_enabled: 0 }, 'continuous_learning_enabled')).toBe(true);
    expect(isChatSettingToggleDisabled({ is_enabled: 0 }, 'auto_reply_enabled')).toBe(true);
    expect(isChatSettingToggleDisabled({ is_enabled: 1 }, 'auto_reply_enabled')).toBe(false);
  });
});
