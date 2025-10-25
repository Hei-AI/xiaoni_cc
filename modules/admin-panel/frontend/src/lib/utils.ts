import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Normalizes timestamps that arrive without timezone information (assumed UTC)
// and formats them explicitly in Asia/Shanghai to avoid browser-dependent shifts.
export function formatTimestamp(
  value?: string | Date,
  {
    locale = 'zh-CN',
    timeZone = 'Asia/Shanghai',
    hour12 = false,
    fallback = '-'
  }: {
    locale?: string;
    timeZone?: string;
    hour12?: boolean;
    fallback?: string;
  } = {}
): string {
  if (!value) {
    return fallback;
  }

  const toDate = (input: string | Date): Date | null => {
    if (input instanceof Date) {
      return Number.isNaN(input.getTime()) ? null : input;
    }

    const trimmed = input.trim();
    if (!trimmed) {
      return null;
    }

    const hasTzInfo = /[zZ]|[+-]\d{2}:?\d{2}$/.test(trimmed);
    let normalized = trimmed;

    if (!hasTzInfo) {
      if (/^\d{4}[-/]\d{2}[-/]\d{2}[\sT]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(trimmed)) {
        const sanitized = trimmed.replace(/\//g, '-').replace(' ', 'T');
        normalized = `${sanitized}Z`;
      } else if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
        normalized = `${trimmed}Z`;
      }
    }

    const parsed = new Date(normalized);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }

    const fallbackDate = new Date(trimmed);
    return Number.isNaN(fallbackDate.getTime()) ? null : fallbackDate;
  };

  const date = toDate(value);
  if (!date) {
    return fallback;
  }

  return date.toLocaleString(locale, { timeZone, hour12 });
}
