import { createHash } from 'node:crypto';
import type {
  AbArmOutputArtifact,
  AbEvalDimensions,
  AbEvalLabel,
  AbEvalResult,
  AbIsolationCheck,
  JsonObject
} from './ab-types';

export type AbEvalFixtureClass =
  | 'attention'
  | 'memory_recall'
  | 'silence'
  | 'plan_continuity'
  | 'bad_case_unknown'
  | 'isolation';

export interface AbEvalFixture {
  id: string;
  fixtureClass: AbEvalFixtureClass;
  title: string;
  snapshotId: string;
  scene: {
    sessionKey: string;
    peerId: string;
    messages: string[];
  };
  expectedLabel: AbEvalLabel;
  expectedTreatmentActionKind: string;
  dimensions: AbEvalDimensions;
  isolationCheck: AbIsolationCheck;
  controlArtifact: AbArmOutputArtifact;
  treatmentArtifact: AbArmOutputArtifact;
  notes: string;
}

export interface CreateEvalResultInput {
  fixture: AbEvalFixture;
  controlArmRunId?: string | null;
  treatmentArmRunId?: string | null;
  now?: Date;
  reviewerNotes?: string | null;
}

export type AbEvalPersistenceInput = Omit<AbEvalResult, 'isolationCheck'> & {
  isolation_check: AbIsolationCheck;
};

function score(score: number, rationale: string) {
  return { score, rationale };
}

function dims(values: [number, number, number, number, number, number], reason: string): AbEvalDimensions {
  return {
    contextuality: score(values[0], reason),
    continuity: score(values[1], reason),
    socialNaturalness: score(values[2], reason),
    actionFit: score(values[3], reason),
    memoryUse: score(values[4], reason),
    isolationIntegrity: score(values[5], 'No production mutation or promotion path is allowed.')
  };
}

function isolation(metadata: JsonObject = {}): AbIsolationCheck {
  return {
    passed: true,
    productionSideEffects: [],
    forbiddenSymbolsObserved: [],
    notes: 'fixture expects treatment-only evaluation state',
    metadata
  };
}

export const AB_EVAL_FIXTURES: readonly AbEvalFixture[] = Object.freeze([
  {
    id: 'fixture-attention',
    fixtureClass: 'attention',
    title: 'Notices direct addressee in a busy group thread',
    snapshotId: 'eval-snapshot-attention',
    scene: {
      sessionKey: 'qq:group:eval-attention',
      peerId: 'eval-attention',
      messages: ['A: 继续刚才的话题', 'B: @小腻 你看这句是在问你吗？']
    },
    expectedLabel: 'mini_better',
    expectedTreatmentActionKind: 'speak_in_group_candidate',
    dimensions: dims([0.9, 0.7, 0.8, 0.9, 0.6, 1], 'Treatment should attend to direct address without over-answering.'),
    isolationCheck: isolation({ fixtureClass: 'attention' }),
    controlArtifact: { finalCandidateAction: { kind: 'stay_silent_candidate', rationale: 'missed addressee', confidence: 0.35, silenceReason: 'unclear target' } },
    treatmentArtifact: { finalCandidateAction: { kind: 'speak_in_group_candidate', rationale: 'directly addressed', confidence: 0.82, text: '我觉得是在问我，这句可以接。' } },
    notes: 'Covers attention rather than long memory.'
  },
  {
    id: 'fixture-memory-recall',
    fixtureClass: 'memory_recall',
    title: 'Recalls prior preference before choosing tone',
    snapshotId: 'eval-snapshot-memory-recall',
    scene: {
      sessionKey: 'qq:private:eval-memory',
      peerId: 'eval-memory',
      messages: ['用户: 今天还是别太正式，像上次那样就好。']
    },
    expectedLabel: 'mini_better',
    expectedTreatmentActionKind: 'private_reply_candidate',
    dimensions: dims([0.85, 0.9, 0.9, 0.86, 0.95, 1], 'Treatment should use recalled preference to avoid customer-service tone.'),
    isolationCheck: isolation({ fixtureClass: 'memory_recall' }),
    controlArtifact: { finalCandidateAction: { kind: 'private_reply_candidate', rationale: 'generic answer', confidence: 0.55, text: '好的，我会尽量正式说明。', targetUserId: 'eval-memory' } },
    treatmentArtifact: { finalCandidateAction: { kind: 'private_reply_candidate', rationale: 'uses remembered casual preference', confidence: 0.86, text: '懂，那我就按上次那个轻一点的说法来。', targetUserId: 'eval-memory' } },
    notes: 'Covers memory recall as a positive behavior change.'
  },
  {
    id: 'fixture-silence',
    fixtureClass: 'silence',
    title: 'Stays silent when group members are talking past Xiaoni',
    snapshotId: 'eval-snapshot-silence',
    scene: {
      sessionKey: 'qq:group:eval-silence',
      peerId: 'eval-silence',
      messages: ['A: 哈哈哈', 'B: 我懂你意思', 'C: 先别打断']
    },
    expectedLabel: 'mini_better',
    expectedTreatmentActionKind: 'stay_silent_candidate',
    dimensions: dims([0.82, 0.75, 0.95, 0.92, 0.7, 1], 'Treatment should score silence as the socially natural action.'),
    isolationCheck: isolation({ fixtureClass: 'silence' }),
    controlArtifact: { finalCandidateAction: { kind: 'speak_in_group_candidate', rationale: 'fills silence', confidence: 0.4, text: '哈哈确实。' } },
    treatmentArtifact: { finalCandidateAction: { kind: 'stay_silent_candidate', rationale: 'not addressed and thread is already flowing', confidence: 0.9, silenceReason: 'avoid interruption' } },
    notes: 'Represents correct silence, not failure.'
  },
  {
    id: 'fixture-plan-continuity',
    fixtureClass: 'plan_continuity',
    title: 'Continues a pending short-term promise',
    snapshotId: 'eval-snapshot-plan-continuity',
    scene: {
      sessionKey: 'qq:private:eval-plan',
      peerId: 'eval-plan',
      messages: ['用户: 你刚刚说等我贴日志再看，我贴好了。']
    },
    expectedLabel: 'mini_better',
    expectedTreatmentActionKind: 'private_reply_candidate',
    dimensions: dims([0.86, 0.96, 0.84, 0.9, 0.9, 1], 'Treatment should continue the pending plan rather than restart.'),
    isolationCheck: isolation({ fixtureClass: 'plan_continuity' }),
    controlArtifact: { finalCandidateAction: { kind: 'private_reply_candidate', rationale: 'starts over', confidence: 0.58, text: '你想让我看什么？', targetUserId: 'eval-plan' } },
    treatmentArtifact: { finalCandidateAction: { kind: 'private_reply_candidate', rationale: 'continues promised log review', confidence: 0.88, text: '我接着看这段日志，先从报错行开始。', targetUserId: 'eval-plan' } },
    notes: 'Requires active plan memory.'
  },
  {
    id: 'fixture-bad-case-unknown',
    fixtureClass: 'bad_case_unknown',
    title: 'Marks ambiguous bad case as unclear',
    snapshotId: 'eval-snapshot-bad-case-unknown',
    scene: {
      sessionKey: 'qq:group:eval-unknown',
      peerId: 'eval-unknown',
      messages: ['A: 那个先这样吧', 'B: 嗯']
    },
    expectedLabel: 'unclear',
    expectedTreatmentActionKind: 'stay_silent_candidate',
    dimensions: dims([0.55, 0.5, 0.7, 0.58, 0.45, 1], 'Evaluator should avoid pretending the ambiguous case has a clear winner.'),
    isolationCheck: isolation({ fixtureClass: 'bad_case_unknown' }),
    controlArtifact: { finalCandidateAction: { kind: 'stay_silent_candidate', rationale: 'ambiguous', confidence: 0.55, silenceReason: 'unclear' } },
    treatmentArtifact: { finalCandidateAction: { kind: 'stay_silent_candidate', rationale: 'ambiguous', confidence: 0.6, silenceReason: 'unclear' } },
    notes: 'Guards against overfitting known bad cases.'
  },
  {
    id: 'fixture-isolation',
    fixtureClass: 'isolation',
    title: 'Verifies treatment output remains non-promotional and side-effect free',
    snapshotId: 'eval-snapshot-isolation',
    scene: {
      sessionKey: 'qq:private:eval-isolation',
      peerId: 'eval-isolation',
      messages: ['用户: 这个实验结果会影响你现在给我的回复吗？']
    },
    expectedLabel: 'tie',
    expectedTreatmentActionKind: 'private_reply_candidate',
    dimensions: dims([0.75, 0.75, 0.8, 0.78, 0.7, 1], 'Evaluator output must include isolation integrity without promotion fields.'),
    isolationCheck: isolation({ fixtureClass: 'isolation', promotion: false }),
    controlArtifact: { finalCandidateAction: { kind: 'private_reply_candidate', rationale: 'answers directly', confidence: 0.78, text: '不会。', targetUserId: 'eval-isolation' } },
    treatmentArtifact: { finalCandidateAction: { kind: 'private_reply_candidate', rationale: 'candidate only, no side effects', confidence: 0.8, text: '不会，它只作为实验候选，不会改现在的回复。', targetUserId: 'eval-isolation' } },
    notes: 'Explicit isolation fixture.'
  }
]);

export function listAbEvalFixtures() {
  return [...AB_EVAL_FIXTURES];
}

export function getAbEvalFixture(id: string) {
  return AB_EVAL_FIXTURES.find((fixture) => fixture.id === id) ?? null;
}

function deterministicEvalId(snapshotId: string, fixtureId: string) {
  const hash = createHash('sha1').update(`${snapshotId}:${fixtureId}`).digest('hex');
  return `ab_eval_${hash}`;
}

export function createAbEvalResultForFixture(input: CreateEvalResultInput): AbEvalResult {
  const now = (input.now ?? new Date()).toISOString();
  return {
    id: deterministicEvalId(input.fixture.snapshotId, input.fixture.id),
    snapshotId: input.fixture.snapshotId,
    controlArmRunId: input.controlArmRunId ?? null,
    treatmentArmRunId: input.treatmentArmRunId ?? null,
    label: input.fixture.expectedLabel,
    dimensions: input.fixture.dimensions,
    reviewerNotes: input.reviewerNotes ?? input.fixture.notes,
    isolationCheck: input.fixture.isolationCheck,
    fixtureId: input.fixture.id,
    createdAt: now,
    updatedAt: now
  };
}

export function serializeAbEvalResultForPersistence(result: AbEvalResult): AbEvalPersistenceInput {
  const { isolationCheck, ...rest } = result;
  return {
    ...rest,
    isolation_check: isolationCheck
  };
}

export function createAbEvalFixtureReport(now: Date = new Date('2026-04-29T00:00:00.000Z')) {
  return listAbEvalFixtures().map((fixture) => {
    const result = createAbEvalResultForFixture({ fixture, now });
    return {
      fixtureId: fixture.id,
      fixtureClass: fixture.fixtureClass,
      snapshotId: fixture.snapshotId,
      label: result.label,
      dimensions: result.dimensions,
      isolation_check: result.isolationCheck,
      expectedTreatmentActionKind: fixture.expectedTreatmentActionKind
    };
  });
}
