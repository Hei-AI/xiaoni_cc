export interface ActionStreamTagOption {
  key: string;
  label: string;
  tone?: string;
  count?: number;
}

export function parseActionStreamTagParam(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of value.split(',')) {
    const key = raw.trim().toLowerCase();
    if (key && !seen.has(key)) {
      seen.add(key);
      tags.push(key);
    }
  }
  return tags;
}

export function serializeActionStreamTags(tags: readonly string[]): string | null {
  const seen = new Set<string>();
  const normalized = tags
    .map((tag) => tag.trim().toLowerCase())
    .filter((tag) => {
      if (!tag || seen.has(tag)) {
        return false;
      }
      seen.add(tag);
      return true;
    });
  return normalized.length ? normalized.join(',') : null;
}

export function toggleActionStreamTag(tags: readonly string[], key: string): string[] {
  const normalized = key.trim().toLowerCase();
  if (!normalized) {
    return [...tags];
  }
  return tags.includes(normalized)
    ? tags.filter((tag) => tag !== normalized)
    : [...tags, normalized];
}

export function mergeSelectedActionStreamTags(
  availableTags: readonly ActionStreamTagOption[],
  selectedKeys: readonly string[]
): ActionStreamTagOption[] {
  const byKey = new Map<string, ActionStreamTagOption>();
  for (const tag of availableTags) {
    const key = tag.key.trim().toLowerCase();
    if (key) {
      byKey.set(key, { ...tag, key });
    }
  }
  for (const selected of selectedKeys) {
    const key = selected.trim().toLowerCase();
    if (key && !byKey.has(key)) {
      byKey.set(key, {
        key,
        label: key,
        tone: 'neutral',
        count: 0,
      });
    }
  }
  return Array.from(byKey.values());
}
