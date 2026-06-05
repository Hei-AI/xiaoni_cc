import test from 'node:test';
import assert from 'node:assert/strict';
import { MiniTreatmentRunner } from '../services/mini-treatment-runner';
import type {
  AbArmRun,
  AbMemoryStreamItem,
  AbTurnSnapshot,
  RetrievedMemoryContext
} from '../services/ab-types';
import type { TreatmentDeps, TreatmentModelExecuteRequest } from '../services/treatment-deps';

const memoryContext: RetrievedMemoryContext = {
  namespace: 'ab:treatment:exp:s:p',
  observations: [],
  reflections: [],
  plans: [],
  budget: {
    observationsTokens: 0,
    reflectionsTokens: 0,
    plansTokens: 0,
    totalTokens: 0,
    truncated: false
  }
};

const snapshot: AbTurnSnapshot = {
  id: 'snap-1',
  sourceKey: 'queue:snap-1',
  traceId: 'trace-1',
  runId: 'run-1',
  sessionKey: 's',
  chatType: 'group',
  peerId: 'p',
  senderId: 'u',
  queueMessageIds: ['q1'],
  providerEventIds: ['evt1'],
  scene: {
    unreadMessages: [{ role: 'user', content: '@小腻 这个你怎么看' }],
    recentContext: [{ role: 'assistant', content: '前文' }],
    readCutoff: { messageId: 'm0' },
    metadata: {}
  },
  memoryStreamView: memoryContext,
  retrievalPolicy: {
    relevanceWeight: 1,
    recencyWeight: 1,
    importanceWeight: 1,
    typeLimits: {
      observations: { maxItems: 4, maxTokens: 200 },
      reflections: { maxItems: 4, maxTokens: 200 },
      plans: { maxItems: 2, maxTokens: 100 },
      selfState: { maxItems: 1, maxTokens: 100 }
    },
    totalSoftCapTokens: 400,
    totalHardCapTokens: 600
  },
  runtimeConfig: {
    controlModelName: 'gpt-5.4',
    treatmentModelName: 'gpt-5.4-mini',
    promptVersions: { main: 'v1' }
  },
  captureStatus: 'created',
  controlStatus: 'pending',
  treatmentStatus: 'pending',
  evalStatus: 'pending',
  createdAt: '2026-04-29T00:00:00.000Z',
  updatedAt: '2026-04-29T00:00:00.000Z'
};

function memoryItem(overrides: Partial<AbMemoryStreamItem>): AbMemoryStreamItem {
  return {
    id: overrides.id || 'mem-1',
    namespace: 'ab:treatment:exp:s:p',
    arm: 'treatment',
    type: overrides.type || 'observation',
    subtype: overrides.subtype ?? null,
    content: overrides.content || 'direct addressee observation',
    retrievalText: overrides.retrievalText ?? null,
    embeddingText: null,
    importance: overrides.importance ?? 0.8,
    confidence: 0.9,
    status: 'active',
    sourceEventRefs: [],
    provenance: {},
    ttlExpiresAt: null,
    fulfilledAt: null,
    createdAt: '2026-04-29T00:00:00.000Z',
    updatedAt: '2026-04-29T00:00:00.000Z'
  };
}

function createDeps(overrides: Partial<TreatmentDeps> = {}) {
  const calls: TreatmentModelExecuteRequest[] = [];
  const armRuns: AbArmRun[] = [];
  const deps: TreatmentDeps = {
    loadSnapshot: async () => snapshot,
    listMemoryStreamItems: async () => [
      memoryItem({ id: 'obs-1', type: 'observation', content: '小腻 was directly addressed' }),
      memoryItem({ id: 'ref-1', type: 'reflection', content: 'avoid customer service tone' }),
      memoryItem({ id: 'plan-1', type: 'plan', content: 'continue the pending answer' })
    ],
    executeModel: async (request) => {
      calls.push(request);
      if (request.purpose === 'initial_impulse') {
        return {
          modelName: request.modelName,
          outputText: JSON.stringify({
            initialImpulse: {
              summary: 'directly addressed',
              likelyAction: 'speak_in_group_candidate',
              reasons: ['mention'],
              uncertainty: 0.2,
              shouldRecall: true
            }
          }),
          completedAt: '2026-04-29T00:00:01.000Z'
        };
      }
      if (request.purpose === 'final_candidate_action') {
        return {
          modelName: request.modelName,
          outputText: JSON.stringify({
            memoryTensionSummary: {
              summary: 'memory supports a short reply',
              supportsSpeaking: ['direct address'],
              supportsSilence: [],
              continuityRisks: [],
              conflicts: [],
              confidence: 0.8
            },
            finalCandidateAction: {
              kind: 'speak_in_group_candidate',
              rationale: 'directly addressed and has relevant memory',
              confidence: 0.85,
              text: '我觉得这里可以接一下。'
            }
          }),
          completedAt: '2026-04-29T00:00:02.000Z'
        };
      }
      return {
        modelName: request.modelName,
        outputText: '{}',
        completedAt: '2026-04-29T00:00:03.000Z'
      };
    },
    writeArmRun: async (armRun) => {
      armRuns.push(armRun);
    },
    writeMemoryStreamItem: async () => undefined,
    writeEvalResult: async () => undefined,
    now: () => new Date(`2026-04-29T00:00:0${armRuns.length}.000Z`),
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined
    },
    ...overrides
  };
  return { deps, calls, armRuns };
}

test('MiniTreatmentRunner executes fixed pass1 recall pass2 and writes treatment arm only', async () => {
  const { deps, calls, armRuns } = createDeps();
  const runner = new MiniTreatmentRunner(deps, {
    modelName: 'gpt-5.4-mini',
    projectOrNamespace: 'ab:treatment:exp:s:p'
  });

  const result = await runner.run('snap-1');

  assert.deepEqual(calls.map((call) => call.purpose), ['initial_impulse', 'final_candidate_action']);
  assert.equal(armRuns.length, 2);
  assert.deepEqual(armRuns.map((run) => run.arm), ['treatment', 'treatment']);
  assert.deepEqual(armRuns.map((run) => run.status), ['running', 'completed']);
  assert.equal(result.finalCandidateAction?.kind, 'speak_in_group_candidate');
  assert.equal(result.retrievedMemoryContext?.observations.length, 1);
  assert.equal(result.retrievedMemoryContext?.reflections.length, 1);
  assert.equal(result.retrievedMemoryContext?.plans.length, 1);
  assert.equal(armRuns[1].outputArtifact.initialImpulse?.summary, 'directly addressed');
  assert.equal(armRuns[1].outputArtifact.finalCandidateAction?.kind, 'speak_in_group_candidate');
  assert.equal((armRuns[1].inputSummary.metadata as any).semanticRetry, false);
});

test('MiniTreatmentRunner uses format repair without semantic retry for invalid JSON', async () => {
  const { deps, calls } = createDeps({
    executeModel: async (request) => {
      calls.push(request);
      if (request.purpose === 'initial_impulse') {
        return { modelName: request.modelName, outputText: 'not json', completedAt: '2026-04-29T00:00:01.000Z' };
      }
      if (request.purpose === 'format_repair') {
        return {
          modelName: request.modelName,
          outputText: JSON.stringify({
            initialImpulse: {
              summary: 'repaired',
              likelyAction: 'unknown',
              reasons: [],
              uncertainty: 0.5,
              shouldRecall: true
            }
          }),
          completedAt: '2026-04-29T00:00:02.000Z'
        };
      }
      return {
        modelName: request.modelName,
        outputText: JSON.stringify({
          finalCandidateAction: {
            kind: 'silent_candidate',
            rationale: 'candidate only',
            confidence: 0.7,
            silenceReason: 'not enough signal'
          }
        }),
        completedAt: '2026-04-29T00:00:03.000Z'
      };
    }
  });

  const runner = new MiniTreatmentRunner(deps, { projectOrNamespace: 'ab:treatment:exp:s:p' });
  const result = await runner.run('snap-1');

  assert.deepEqual(calls.map((call) => call.purpose), ['initial_impulse', 'format_repair', 'final_candidate_action']);
  assert.equal((calls[1].generation as any).semantic_retry, false);
  assert.equal(result.armRun.status, 'completed');
});

test('MiniTreatmentRunner records treatment failure without throwing after snapshot load', async () => {
  const { deps, armRuns } = createDeps({
    executeModel: async () => {
      throw new Error('provider timeout');
    }
  });
  const runner = new MiniTreatmentRunner(deps, { projectOrNamespace: 'ab:treatment:exp:s:p' });

  const result = await runner.run('snap-1');

  assert.equal(result.armRun.status, 'failed');
  assert.equal(result.armRun.failure?.message, 'provider timeout');
  assert.deepEqual(armRuns.map((run) => run.status), ['running', 'failed']);
});
