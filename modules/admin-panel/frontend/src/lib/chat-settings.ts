export type ChatSettingsState = {
  is_enabled?: number | boolean | null;
  auto_reply_enabled?: number | boolean | null;
};

export type ChatSettingsToggleField = 'is_enabled' | 'auto_reply_enabled';

export function isChatSettingEnabled(value: unknown): boolean {
  return Boolean(value);
}

export function applyChatSettingToggle<T extends ChatSettingsState>(
  _current: T,
  field: ChatSettingsToggleField,
  checked: boolean
): Partial<T> {
  const nextValue = checked ? 1 : 0;
  if (field === 'is_enabled' && !checked) {
    return {
      is_enabled: 0,
      auto_reply_enabled: 0,
    } as Partial<T>;
  }

  return {
    [field]: nextValue,
  } as Partial<T>;
}

export function isChatSettingToggleDisabled(state: ChatSettingsState, field: ChatSettingsToggleField): boolean {
  if (field === 'is_enabled') {
    return false;
  }
  return !isChatSettingEnabled(state.is_enabled);
}
