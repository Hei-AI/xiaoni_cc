export function isDbBooleanEnabled(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

export function isAutoReplyAllowed(
  settings: { auto_reply_enabled?: unknown } | null | undefined
): boolean {
  if (!settings) {
    return true;
  }

  return isDbBooleanEnabled(settings.auto_reply_enabled);
}
