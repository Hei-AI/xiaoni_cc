export function readOptionalText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function formatPromptBindingLabel(params: {
  promptId?: string | null;
  promptName?: string | null;
}): string {
  const promptName = readOptionalText(params.promptName);
  if (promptName) {
    return promptName;
  }

  const promptId = readOptionalText(params.promptId);
  if (!promptId) {
    return '未绑定';
  }

  return `已绑定但模板不可用 (${promptId})`;
}

export function formatConfiguredValue(value: unknown, fallback = '未配置'): string {
  return readOptionalText(value) || fallback;
}

export function formatReturnedValue(value: unknown, fallback = '后端未返回'): string {
  return readOptionalText(value) || fallback;
}
