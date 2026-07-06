import test from 'node:test';
import assert from 'node:assert/strict';
import { __isOurExpiredFileForTest } from '../llm-provider/anthropic-files-service';

// The TTL cleaner may DELETE a file from the org Files store, so both safety gates
// must hold before it does: (1) the file is one of ours (xiaoni- prefix), and
// (2) its created_at positively parses to older than the cutoff. Anything else —
// another integration's file, unknown age, a too-recent upload — must be left alone.

const CUTOFF = Date.parse('2026-07-01T00:00:00Z'); // now - TTL
const OLD = '2026-06-25T00:00:00Z'; // before cutoff
const RECENT = '2026-07-04T00:00:00Z'; // after cutoff

test('our prefix + older than cutoff → delete candidate', () => {
  assert.equal(
    __isOurExpiredFileForTest({ id: 'file_1', filename: 'xiaoni-deadbeef.png', created_at: OLD }, CUTOFF),
    true
  );
});

test('our prefix but too recent → skip', () => {
  assert.equal(
    __isOurExpiredFileForTest({ id: 'file_2', filename: 'xiaoni-deadbeef.png', created_at: RECENT }, CUTOFF),
    false
  );
});

test('someone else\'s file, even if old → skip (prefix gate)', () => {
  assert.equal(
    __isOurExpiredFileForTest({ id: 'file_3', filename: 'report-q4.pdf', created_at: OLD }, CUTOFF),
    false
  );
});

test('missing filename → skip', () => {
  assert.equal(__isOurExpiredFileForTest({ id: 'file_4', created_at: OLD }, CUTOFF), false);
});

test('our prefix but missing created_at → skip (unknown age)', () => {
  assert.equal(
    __isOurExpiredFileForTest({ id: 'file_5', filename: 'xiaoni-deadbeef.png' }, CUTOFF),
    false
  );
});

test('our prefix but unparseable created_at → skip (unknown age)', () => {
  assert.equal(
    __isOurExpiredFileForTest({ id: 'file_6', filename: 'xiaoni-deadbeef.png', created_at: 'not-a-date' }, CUTOFF),
    false
  );
});

test('exactly at the cutoff → skip (strictly older required)', () => {
  assert.equal(
    __isOurExpiredFileForTest(
      { id: 'file_7', filename: 'xiaoni-deadbeef.png', created_at: new Date(CUTOFF).toISOString() },
      CUTOFF
    ),
    false
  );
});
