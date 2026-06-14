'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  prepareTimestampWithoutTimezoneForPrisma,
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
    '2026-06-14T05:52:16.211+08:00'
  );
  assert.equal(
    parseTimestampWithoutTimezone(prismaTimestamp).toISOString(),
    '2026-06-13T13:52:16.211Z'
  );
});

test('prepareTimestampWithoutTimezoneForPrisma stores instants without wall-clock shifting', () => {
  assert.equal(
    prepareTimestampWithoutTimezoneForPrisma(new Date('2026-06-13T20:15:05.385Z')).toISOString(),
    '2026-06-13T20:15:05.385Z'
  );
  assert.equal(
    prepareTimestampWithoutTimezoneForPrisma('2026-06-14T04:15:05.385+08:00').toISOString(),
    '2026-06-13T20:15:05.385Z'
  );
  assert.equal(
    prepareTimestampWithoutTimezoneForPrisma('2026-06-14 04:15:05.385').toISOString(),
    '2026-06-13T20:15:05.385Z'
  );
});

test('active persistence SQL does not use timestamp without time zone for instants', () => {
  const root = path.resolve(__dirname, '..');
  const files = fs.readdirSync(root)
    .filter((file) => file.endsWith('.js'))
    .map((file) => path.join(root, file));
  files.push(path.resolve(root, 'prisma', 'schema.prisma'));
  files.push(path.resolve(root, '..', '..', 'database', 'postgres', 'init.sql'));

  const offenders = [];
  for (const filePath of files) {
    const source = fs.readFileSync(filePath, 'utf8');
    const relative = path.relative(path.resolve(root, '..', '..'), filePath);
    if (source.includes('timestamptztz')) {
      offenders.push(`${relative}: contains invalid timestamptztz cast`);
    }
    if (/::timestamp(?!tz)/.test(source)) {
      offenders.push(`${relative}: contains ::timestamp`);
    }
    if (/\bTIMESTAMP\(3\)\b/.test(source)) {
      offenders.push(`${relative}: contains TIMESTAMP(3)`);
    }
    if (/@db\.Timestamp\(/.test(source)) {
      offenders.push(`${relative}: contains @db.Timestamp`);
    }
  }

  assert.deepEqual(offenders, []);
});
