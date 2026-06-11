export interface ProviderRequestInputSummary {
  inputCount: number;
  lastItemIndex: number;
  lastItemLabel: string;
  lastItemText: string;
  lastSystemReminderIndex: number | null;
  lastSystemReminderText: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function truncateText(value: string, maxLength = 360) {
  const normalized = value.trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}...`;
}

export function readResponseMessageText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .map((part) => {
      const partRecord = asRecord(part);
      if (!partRecord) {
        return '';
      }
      if (typeof partRecord.text === 'string') {
        return partRecord.text;
      }
      if (typeof partRecord.refusal === 'string') {
        return partRecord.refusal;
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function describeInputItem(item: unknown) {
  const record = asRecord(item);
  if (!record) {
    return 'unknown';
  }

  const type = typeof record.type === 'string' ? record.type : 'unknown';
  const role = typeof record.role === 'string' ? record.role : '';
  const phase = typeof record.phase === 'string' ? record.phase : '';
  const name = typeof record.name === 'string' ? record.name : '';
  return [role, type, phase, name].filter(Boolean).join(' / ') || type;
}

function readInputItemText(item: unknown) {
  const record = asRecord(item);
  if (!record) {
    return '';
  }
  return readResponseMessageText(record.content);
}

export function summarizeProviderRequestInputBody(body: unknown): ProviderRequestInputSummary | null {
  const record = asRecord(body);
  const input = Array.isArray(record?.input) ? record.input : null;
  if (!input || input.length === 0) {
    return null;
  }

  const lastItemIndex = input.length - 1;
  const lastItem = input[lastItemIndex];
  let lastSystemReminderIndex: number | null = null;
  let lastSystemReminderText: string | null = null;

  for (let index = input.length - 1; index >= 0; index -= 1) {
    const text = readInputItemText(input[index]);
    if (text.includes('<system_reminder>')) {
      lastSystemReminderIndex = index;
      lastSystemReminderText = truncateText(text);
      break;
    }
  }

  return {
    inputCount: input.length,
    lastItemIndex,
    lastItemLabel: describeInputItem(lastItem),
    lastItemText: truncateText(readInputItemText(lastItem)),
    lastSystemReminderIndex,
    lastSystemReminderText,
  };
}
