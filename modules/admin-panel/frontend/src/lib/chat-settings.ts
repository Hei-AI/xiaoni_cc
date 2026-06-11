export type ChatSettingsState = {
  is_enabled?: number | boolean | null;
};

export type ChatSettingsToggleField = 'is_enabled';

export function isChatSettingEnabled(value: unknown): boolean {
  return Boolean(value);
}

export function applyChatSettingToggle<T extends ChatSettingsState>(
  _current: T,
  field: ChatSettingsToggleField,
  checked: boolean
): Partial<T> {
  const nextValue = checked ? 1 : 0;
  return {
    [field]: nextValue,
  } as Partial<T>;
}

export function isChatSettingToggleDisabled(state: ChatSettingsState, field: ChatSettingsToggleField): boolean {
  void state;
  void field;
  return false;
}
