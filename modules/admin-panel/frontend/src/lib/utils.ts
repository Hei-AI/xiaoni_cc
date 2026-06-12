import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const EAST8_OFFSET = '+08:00';
const EAST8_OFFSET_MS = 8 * 60 * 60 * 1000;

function pad(value: number, width = 2) {
  return String(value).padStart(width, '0');
}

function getShiftedUtcDate(value: Date) {
  return new Date(value.getTime() + EAST8_OFFSET_MS);
}

export function parseTimestampValue(value?: string | Date | number | null): Date | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const hasTzInfo = /[zZ]|[+-]\d{2}:?\d{2}$/.test(trimmed);
  let normalized = trimmed;

  if (!hasTzInfo) {
    if (/^\d{4}[-/]\d{2}[-/]\d{2}[\sT]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(trimmed)) {
      normalized = `${trimmed.replace(/\//g, '-').replace(' ', 'T')}${EAST8_OFFSET}`;
    } else if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
      normalized = `${trimmed}${EAST8_OFFSET}`;
    }
  }

  const parsed = new Date(normalized);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
  }

  const fallbackDate = new Date(trimmed);
  return Number.isNaN(fallbackDate.getTime()) ? null : fallbackDate;
}

function buildFormatOptions(
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
) {
  return { locale, timeZone, hour12, fallback };
}

export function formatTimestamp(
  value?: string | Date | number | null,
  options?: {
    locale?: string;
    timeZone?: string;
    hour12?: boolean;
    fallback?: string;
  }
): string {
  const { locale, timeZone, hour12, fallback } = buildFormatOptions(options);
  const date = parseTimestampValue(value);
  if (!date) {
    return fallback;
  }

  return date.toLocaleString(locale, { timeZone, hour12 });
}

export function formatIsoOffset(
  value?: string | Date | number | null,
  options?: {
    fallback?: string;
  }
): string {
  const fallback = options?.fallback ?? '-';
  const date = parseTimestampValue(value);
  if (!date) {
    return fallback;
  }

  const shifted = getShiftedUtcDate(date);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}.${pad(shifted.getUTCMilliseconds(), 3)}${EAST8_OFFSET}`;
}

export function getEast8StartOfDay(value?: string | Date | number | null): Date {
  const date = parseTimestampValue(value) ?? new Date();
  const shifted = getShiftedUtcDate(date);
  return new Date(Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
    0,
    0,
    0,
    0
  ) - EAST8_OFFSET_MS);
}

export function formatDateOnly(
  value?: string | Date | number | null,
  options?: {
    locale?: string;
    timeZone?: string;
    fallback?: string;
  }
): string {
  const { locale, timeZone, fallback } = buildFormatOptions(options);
  const date = parseTimestampValue(value);
  if (!date) {
    return fallback;
  }

  return date.toLocaleDateString(locale, { timeZone });
}

export function formatDateTimeCompact(
  value?: string | Date | number | null,
  options?: {
    fallback?: string;
  }
): string {
  const date = parseTimestampValue(value);
  if (!date) {
    return options?.fallback ?? '-';
  }

  const shifted = getShiftedUtcDate(date);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())} ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}`;
}

export function formatTimeOnly(
  value?: string | Date | number | null,
  options?: {
    locale?: string;
    timeZone?: string;
    hour12?: boolean;
    fallback?: string;
    withMilliseconds?: boolean;
  }
): string {
  const { locale, timeZone, hour12, fallback } = buildFormatOptions(options);
  const date = parseTimestampValue(value);
  if (!date) {
    return fallback;
  }

  const formatted = date.toLocaleTimeString(locale, {
    timeZone,
    hour12,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  if (!options?.withMilliseconds) {
    return formatted;
  }

  return `${formatted}.${date.getMilliseconds().toString().padStart(3, '0')}`;
}
