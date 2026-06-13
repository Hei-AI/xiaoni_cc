'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseTimestampWithoutTimezone,
  serializeTimestampForApi,
  serializeTimestampWithoutTimezoneForApi
} = require('../time');

test('serializeTimestampForApi preserves fractional seconds from PostgreSQL text', () => {
  assert.equal(
    serializeTimestampForApi('2026-06-13 18:45:56.55'),
    '2026-06-13T18:45:56.550+08:00'
  );
  assert.equal(
    serializeTimestampForApi('2026-06-13 18:45:56.005'),
    '2026-06-13T18:45:56.005+08:00'
  );
});

test('serializeTimestampWithoutTimezoneForApi treats Date UTC fields as stored wall clock', () => {
  const prismaTimestamp = new Date('2026-06-13T21:52:16.211Z');
  assert.equal(
    serializeTimestampWithoutTimezoneForApi(prismaTimestamp),
    '2026-06-13T21:52:16.211+08:00'
  );
  assert.equal(
    parseTimestampWithoutTimezone(prismaTimestamp).toISOString(),
    '2026-06-13T13:52:16.211Z'
  );
});
