'use strict';

const STORAGE_TIMEZONE = 'Asia/Shanghai';
const STORAGE_OFFSET = '+08:00';
const STORAGE_OFFSET_MINUTES = 8 * 60;
const STORAGE_OFFSET_MS = STORAGE_OFFSET_MINUTES * 60 * 1000;
const TIMESTAMP_WITHOUT_TZ_OID = 1114;
const TIMESTAMPTZ_OID = 1184;

const TIMESTAMP_FIELD_NAMES = new Set([
  'timestamp',
  'event_time',
  'sort_time',
  'started_at',
  'ended_at',
  'completed_at',
  'created_at',
  'updated_at',
  'read_at',
  'received_at',
  'message_timestamp',
  'available_at',
  'locked_at',
  'processing_started_at',
  'last_activity',
  'expires_at',
  'request_timestamp',
  'response_timestamp',
  'replayed_at',
  'last_received_at',
  'queued_at',
  'processed_at',
  'import_started_at',
  'last_import_time',
  'first_seen',
  'last_seen'
]);

function pad(value, width = 2) {
  return String(value).padStart(width, '0');
}

function getShiftedUtcDate(value) {
  return new Date(value.getTime() + STORAGE_OFFSET_MS);
}

function formatEast8WallClock(value) {
  const shifted = getShiftedUtcDate(value);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())} ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}.${pad(shifted.getUTCMilliseconds(), 3)}`;
}

function formatEast8IsoOffset(value) {
  const shifted = getShiftedUtcDate(value);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}.${pad(shifted.getUTCMilliseconds(), 3)}${STORAGE_OFFSET}`;
}

function normalizeWallClockString(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const match = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?$/
  );
  if (!match) {
    return null;
  }

  const [, year, month, day, hour, minute, second, fraction = '0'] = match;
  return `${year}-${month}-${day} ${hour}:${minute}:${second}.${fraction.slice(0, 3).padEnd(3, '0')}`;
}

function parseWallClockWithOffset(value, offsetMinutes) {
  const normalized = normalizeWallClockString(value);
  if (!normalized) {
    return null;
  }

  const match = normalized.match(
    /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d{3})$/
  );
  if (!match) {
    return null;
  }

  const [, year, month, day, hour, minute, second, millisecond] = match;
  const utcMillis = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    Number(millisecond)
  ) - offsetMinutes * 60 * 1000;

  const parsed = new Date(utcMillis);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseInstantValue(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function hasExplicitTimezone(value) {
  return /(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(value.trim());
}

function parseStoredTimestamp(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value !== 'string') {
    return parseInstantValue(value);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (hasExplicitTimezone(trimmed)) {
    return parseInstantValue(trimmed);
  }

  const normalized = normalizeWallClockString(trimmed);
  if (!normalized) {
    return parseInstantValue(trimmed);
  }

  return parseWallClockWithOffset(normalized, STORAGE_OFFSET_MINUTES);
}

function formatUtcWallClock(value) {
  return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())} ${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}:${pad(value.getUTCSeconds())}.${pad(value.getUTCMilliseconds(), 3)}`;
}

function parseTimestampWithoutTimezone(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return parseWallClockWithOffset(formatUtcWallClock(value), STORAGE_OFFSET_MINUTES);
  }

  if (typeof value !== 'string') {
    return parseInstantValue(value);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (hasExplicitTimezone(trimmed)) {
    return parseInstantValue(trimmed);
  }

  const normalized = normalizeWallClockString(trimmed);
  if (!normalized) {
    return parseInstantValue(trimmed);
  }

  return parseWallClockWithOffset(normalized, STORAGE_OFFSET_MINUTES);
}

function serializeTimestampWithoutTimezoneForApi(value) {
  const instant = parseTimestampWithoutTimezone(value);
  if (!instant) {
    return value ?? null;
  }
  return formatEast8IsoOffset(instant);
}

function serializeTimestampForStorage(value) {
  const instant = parseInstantValue(value);
  if (!instant) {
    return value ?? null;
  }
  return formatEast8WallClock(instant);
}

function prepareTimestampWithoutTimezoneForPrisma(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : getShiftedUtcDate(value);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    if (hasExplicitTimezone(trimmed)) {
      const instant = parseInstantValue(trimmed);
      return instant ? getShiftedUtcDate(instant) : null;
    }
    const normalized = normalizeWallClockString(trimmed);
    if (normalized) {
      return new Date(`${normalized.replace(' ', 'T')}Z`);
    }
  }

  const instant = parseInstantValue(value);
  return instant ? getShiftedUtcDate(instant) : null;
}

function serializeTimestampForApi(value) {
  const instant = parseStoredTimestamp(value);
  if (!instant) {
    return value ?? null;
  }
  return formatEast8IsoOffset(instant);
}

function isTimestampFieldName(fieldName) {
  if (!fieldName) {
    return false;
  }

  return TIMESTAMP_FIELD_NAMES.has(fieldName)
    || fieldName.endsWith('_at')
    || fieldName.endsWith('_timestamp');
}

function normalizeTimestampField(fieldName, value) {
  if (!isTimestampFieldName(fieldName)) {
    return value;
  }

  return serializeTimestampForApi(value);
}

function normalizeRowTimestampFields(record) {
  if (!record || typeof record !== 'object') {
    return record;
  }

  const normalized = Array.isArray(record) ? [] : {};
  for (const [key, value] of Object.entries(record)) {
    normalized[key] = normalizeTimestampField(key, value);
  }
  return normalized;
}

function prepareSqlParameter(value) {
  if (value instanceof Date) {
    return serializeTimestampForStorage(value);
  }
  if (Array.isArray(value)) {
    return value.map(prepareSqlParameter);
  }
  return value;
}

function getEast8StartOfDay(value = new Date()) {
  const instant = parseInstantValue(value) || new Date();
  const shifted = getShiftedUtcDate(instant);
  return new Date(Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
    0,
    0,
    0,
    0
  ) - STORAGE_OFFSET_MS);
}

module.exports = {
  STORAGE_TIMEZONE,
  STORAGE_OFFSET,
  TIMESTAMP_WITHOUT_TZ_OID,
  TIMESTAMPTZ_OID,
  parseInstantValue,
  parseStoredTimestamp,
  parseTimestampWithoutTimezone,
  serializeTimestampForStorage,
  serializeTimestampForApi,
  serializeTimestampWithoutTimezoneForApi,
  prepareTimestampWithoutTimezoneForPrisma,
  normalizeTimestampField,
  normalizeRowTimestampFields,
  prepareSqlParameter,
  getEast8StartOfDay,
  formatEast8IsoOffset,
  formatEast8WallClock
};
