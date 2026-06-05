import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAbEvalFixtureReport,
  createAbEvalResultForFixture,
  listAbEvalFixtures,
  serializeAbEvalResultForPersistence
} from '../services/ab-eval-fixtures';

const requiredClasses = [
  'attention',
  'memory_recall',
  'silence',
  'plan_continuity',
  'bad_case_unknown',
  'isolation'
];

test('eval fixtures cover all required classes', () => {
  const fixtures = listAbEvalFixtures();
  const classes = fixtures.map((fixture) => fixture.fixtureClass).sort();
  assert.deepEqual(classes, [...requiredClasses].sort());
  assert.equal(new Set(fixtures.map((fixture) => fixture.id)).size, fixtures.length);
  assert.ok(fixtures.some((fixture) => fixture.fixtureClass === 'silence' && fixture.expectedTreatmentActionKind === 'silent_candidate'));
  assert.ok(fixtures.some((fixture) => fixture.fixtureClass === 'memory_recall' && fixture.expectedLabel === 'mini_better'));
});

test('fixture eval results are deterministic for repeated runs', () => {
  const now = new Date('2026-04-29T00:00:00.000Z');
  const fixture = listAbEvalFixtures()[0];
  assert.ok(fixture);

  const first = createAbEvalResultForFixture({
    fixture,
    controlArmRunId: 'control-1',
    treatmentArmRunId: 'treatment-1',
    now
  });
  const second = createAbEvalResultForFixture({
    fixture,
    controlArmRunId: 'control-1',
    treatmentArmRunId: 'treatment-1',
    now
  });

  assert.deepEqual(second, first);
  assert.match(first.id, /^ab_eval_[a-f0-9]{40}$/);
  assert.equal(first.snapshotId, fixture.snapshotId);
});

test('fixture report is stable and includes every eval dimension', () => {
  const first = createAbEvalFixtureReport();
  const second = createAbEvalFixtureReport();
  assert.deepEqual(second, first);
  assert.equal(first.length, requiredClasses.length);

  for (const entry of first) {
    assert.deepEqual(Object.keys(entry.dimensions).sort(), [
      'actionFit',
      'contextuality',
      'continuity',
      'isolationIntegrity',
      'memoryUse',
      'socialNaturalness'
    ]);
    assert.ok(entry.snapshotId.startsWith('eval-snapshot-'));
  }
});

test('eval persistence payload uses isolation_check and exposes no promotion fields', () => {
  const fixture = listAbEvalFixtures().find((item) => item.fixtureClass === 'isolation');
  assert.ok(fixture);
  const result = createAbEvalResultForFixture({
    fixture,
    now: new Date('2026-04-29T00:00:00.000Z')
  });
  const payload = serializeAbEvalResultForPersistence(result);

  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'isolation_check'), true);
  assert.equal(payload.isolation_check.passed, true);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'isolationCheck'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'promotion'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'promotionFields'), false);
});
