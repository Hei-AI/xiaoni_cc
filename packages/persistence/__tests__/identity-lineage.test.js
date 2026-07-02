const test = require('node:test');
const assert = require('node:assert/strict');
const { createIdentityLineagePersistence, IdentityLineageValidationError } = require('../identity-lineage');

function createPersistence(overrides = {}) {
  const prisma = overrides.prisma || {};
  return createIdentityLineagePersistence({
    getPrismaClient: () => prisma,
    createSqlAdapter: overrides.createSqlAdapter || (() => ({
      execute: async () => 0,
      close: async () => undefined
    }))
  });
}

test('createXiaoniIdentityRoot hashes snapshot and rejects empty identity data', async () => {
  let createPayload = null;
  const persistence = createPersistence({
    prisma: {
      xiaoniIdentityRoot: {
        findFirst: async () => null,
        create: async ({ data }) => {
          createPayload = data;
          return {
            id: 1n,
            ...data
          };
        }
      }
    }
  });

  const created = await persistence.createXiaoniIdentityRoot({
    identityKey: ' xiaoni ',
    sourcePromptId: 'prompt-main',
    systemInstructionSnapshot: 'first chapter',
    createdBy: 'test'
  });

  assert.equal(createPayload.identity_key, 'xiaoni');
  assert.equal(createPayload.source_prompt_id, 'prompt-main');
  assert.equal(createPayload.system_instruction_snapshot, 'first chapter');
  assert.match(createPayload.system_instruction_hash, /^[a-f0-9]{64}$/);
  assert.equal(created.id, 1);
  assert.equal(created.identity_key, 'xiaoni');

  await assert.rejects(
    () => persistence.createXiaoniIdentityRoot({
      identityKey: '',
      systemInstructionSnapshot: 'first chapter'
    }),
    IdentityLineageValidationError
  );
});

test('createXiaoniIdentityRoot rejects duplicate active genesis for same identity key', async () => {
  const persistence = createPersistence({
    prisma: {
      xiaoniIdentityRoot: {
        findFirst: async () => ({ id: 9n, identity_key: 'xiaoni', status: 'active' })
      }
    }
  });

  await assert.rejects(
    () => persistence.createXiaoniIdentityRoot({
      identityKey: 'xiaoni',
      systemInstructionSnapshot: 'first chapter'
    }),
    (error) => error instanceof IdentityLineageValidationError && error.code === 'active_identity_root_exists'
  );
});

test('ensureXiaoniIdentityRoot is idempotent and records genesis event on first create', async () => {
  const calls = {
    roots: [],
    events: []
  };
  const persistence = createPersistence({
    prisma: {
      xiaoniIdentityRoot: {
        findFirst: async () => null
      },
      $transaction: async (callback) => callback({
        xiaoniIdentityRoot: {
          findFirst: async () => null,
          create: async ({ data }) => {
            calls.roots.push(data);
            return { id: 2n, ...data };
          }
        },
        identityLineageEvent: {
          create: async ({ data }) => {
            calls.events.push(data);
            return { id: 3n, ...data };
          }
        }
      })
    }
  });

  const result = await persistence.ensureXiaoniIdentityRoot({
    identityKey: 'xiaoni',
    sourcePromptId: 'prompt-main',
    systemInstructionSnapshot: 'first chapter',
    createdBy: 'test',
    metadata: { source: 'unit' }
  });

  assert.equal(result.created, true);
  assert.equal(result.root.id, 2);
  assert.equal(result.event.id, 3);
  assert.equal(calls.roots[0].identity_key, 'xiaoni');
  assert.equal(calls.events[0].event_type, 'genesis');
  assert.equal(calls.events[0].source_type, 'runtime_instruction');
  assert.equal(calls.events[0].source_id, 'prompt-main');
  assert.equal(calls.events[0].integrity_status, 'accepted');
  assert.equal(calls.events[0].metadata.system_instruction_hash, calls.roots[0].system_instruction_hash);
});

test('ensureXiaoniIdentityRoot returns existing active root without adding genesis event', async () => {
  const persistence = createPersistence({
    prisma: {
      xiaoniIdentityRoot: {
        findFirst: async () => ({ id: 5n, identity_key: 'xiaoni', status: 'active' })
      }
    }
  });

  const result = await persistence.ensureXiaoniIdentityRoot({
    identityKey: 'xiaoni',
    systemInstructionSnapshot: 'first chapter'
  });

  assert.equal(result.created, false);
  assert.equal(result.root.id, 5);
  assert.equal(result.event, null);
});

test('appendIdentityChangeCandidate creates candidate, lineage event, and typed evidence refs in one transaction', async () => {
  const calls = {
    candidates: [],
    events: [],
    refs: []
  };
  const persistence = createPersistence({
    prisma: {
      $transaction: async (callback) => callback({
        identityChangeCandidate: {
          create: async ({ data }) => {
            calls.candidates.push(data);
            return { id: 7n, ...data };
          }
        },
        identityLineageEvent: {
          create: async ({ data }) => {
            calls.events.push(data);
            return { id: 8n, ...data };
          }
        },
        identityEvidenceRef: {
          create: async ({ data }) => {
            calls.refs.push(data);
            return { id: BigInt(20 + calls.refs.length), ...data };
          }
        }
      })
    }
  });

  const result = await persistence.appendIdentityChangeCandidate({
    identityKey: 'xiaoni',
    candidateType: 'guided_growth',
    proposedBy: 'feedback_reflection',
    beforeSummary: 'earlier posture',
    claimText: 'new social boundary should become durable',
    afterSummary: 'new social boundary accepted',
    evidenceRefs: [{
      sourceType: 'conversation_item',
      sourceId: 123,
      traceId: 'trace-1',
      runId: 'run-1',
      confidence: 'high'
    }]
  });

  assert.equal(calls.candidates.length, 1);
  assert.equal(calls.candidates[0].identity_key, 'xiaoni');
  assert.equal(calls.candidates[0].candidate_type, 'guided_growth');
  assert.equal(calls.candidates[0].claim_text, 'new social boundary should become durable');
  assert.equal(calls.events.length, 1);
  assert.equal(calls.events[0].event_type, 'candidate_proposed');
  assert.equal(calls.events[0].source_type, 'identity_change_candidate');
  assert.equal(calls.events[0].source_id, '7');
  assert.equal(calls.events[0].change_candidate_id, 7n);
  assert.equal(calls.refs.length, 1);
  assert.equal(calls.refs[0].identity_key, 'xiaoni');
  assert.equal(calls.refs[0].identity_event_id, 8n);
  assert.equal(calls.refs[0].change_candidate_id, 7n);
  assert.equal(calls.refs[0].source_type, 'conversation_item');
  assert.equal(calls.refs[0].source_id, '123');
  assert.equal(calls.refs[0].trace_id, 'trace-1');
  assert.equal(result.candidate.id, 7);
  assert.equal(result.event.id, 8);
  assert.equal(result.evidenceRefs[0].id, 21);
});

test('createAcceptedIdentityFact records durable facts separately from candidates', async () => {
  const calls = {
    facts: [],
    events: [],
    refs: []
  };
  const persistence = createPersistence({
    prisma: {
      $transaction: async (callback) => callback({
        acceptedIdentityFact: {
          create: async ({ data }) => {
            calls.facts.push(data);
            return { id: 31n, ...data };
          }
        },
        identityLineageEvent: {
          create: async ({ data }) => {
            calls.events.push(data);
            return { id: 32n, ...data };
          }
        },
        identityEvidenceRef: {
          create: async ({ data }) => {
            calls.refs.push(data);
            return { id: 33n, ...data };
          }
        }
      })
    }
  });

  const result = await persistence.createAcceptedIdentityFact({
    identityKey: 'xiaoni',
    factKey: 'self.boundary.group_reply',
    factText: '在群里先观场，再观己，不把围观误当成邀请。',
    factType: 'self_boundary',
    sourceCandidateId: 7,
    confidence: 'high',
    activationTags: ['group', 'participation'],
    evidenceRefs: [{
      sourceType: 'identity_change_candidate',
      sourceId: 7
    }]
  });

  assert.equal(calls.facts[0].identity_key, 'xiaoni');
  assert.equal(calls.facts[0].fact_key, 'self.boundary.group_reply');
  assert.equal(calls.facts[0].source_candidate_id, 7n);
  assert.deepEqual(calls.facts[0].activation_tags, ['group', 'participation']);
  assert.equal(calls.events[0].event_type, 'fact_accepted');
  assert.equal(calls.events[0].accepted_fact_id, 31n);
  assert.equal(calls.events[0].change_candidate_id, 7n);
  assert.equal(calls.refs[0].accepted_fact_id, 31n);
  assert.equal(calls.refs[0].change_candidate_id, 7n);
  assert.equal(result.fact.id, 31);
});

test('appendIdentityLineageEvent rejects unsupported evidence source types', async () => {
  const persistence = createPersistence({
    prisma: {
      $transaction: async (callback) => callback({
        identityLineageEvent: {
          create: async ({ data }) => ({ id: 3n, ...data })
        },
        identityEvidenceRef: {
          create: async ({ data }) => ({ id: 4n, ...data })
        }
      })
    }
  });

  await assert.rejects(
    () => persistence.appendIdentityLineageEvent({
      identityKey: 'xiaoni',
      eventType: 'natural_growth',
      sourceType: 'manual_operator',
      summaryText: 'growth event',
      evidenceRefs: [{
        sourceType: 'untyped_blob',
        sourceId: 'abc'
      }]
    }),
    (error) => error instanceof IdentityLineageValidationError && error.code === 'sourceType_unsupported'
  );
});

test('recordIdentityFork requires parent identity and fork point', async () => {
  const persistence = createPersistence();

  await assert.rejects(
    () => persistence.recordIdentityFork({
      identityKey: 'xiaoni-alt',
      summaryText: 'fork without parent',
      forkPointEventId: 1
    }),
    (error) => error instanceof IdentityLineageValidationError && error.code === 'forkedFromIdentityKey_required'
  );

  await assert.rejects(
    () => persistence.recordIdentityFork({
      identityKey: 'xiaoni-alt',
      forkedFromIdentityKey: 'xiaoni',
      summaryText: 'fork without point'
    }),
    (error) => error instanceof IdentityLineageValidationError && error.code === 'fork_point_event_id_required'
  );
});

test('recordForgettingTombstone tombstones evidence without rewriting source refs', async () => {
  const calls = {
    events: [],
    refs: []
  };
  const persistence = createPersistence({
    prisma: {
      $transaction: async (callback) => callback({
        identityLineageEvent: {
          create: async ({ data }) => {
            calls.events.push(data);
            return { id: 10n, ...data };
          }
        },
        identityEvidenceRef: {
          create: async ({ data }) => {
            calls.refs.push(data);
            return { id: 11n, ...data };
          }
        }
      })
    }
  });

  const result = await persistence.recordForgettingTombstone({
    identityKey: 'xiaoni',
    sourceId: 'operator-redaction-1',
    evidenceRefs: [{
      sourceType: 'conversation_item',
      sourceId: 456
    }]
  });

  assert.equal(calls.events[0].event_type, 'forgetting');
  assert.equal(calls.refs[0].source_type, 'conversation_item');
  assert.equal(calls.refs[0].source_id, '456');
  assert.equal(calls.refs[0].redaction_status, 'tombstoned');
  assert.equal(result.evidenceRefs[0].redaction_status, 'tombstoned');
});

test('recordContinuityTrial records an explicit continuity trial event', async () => {
  let createPayload = null;
  const persistence = createPersistence({
    prisma: {
      identityLineageEvent: {
        create: async ({ data }) => {
          createPayload = data;
          return { id: 12n, ...data };
        }
      }
    }
  });

  const result = await persistence.recordContinuityTrial({
    identityKey: 'xiaoni',
    summaryText: 'passed trial against genesis and recent experience',
    sourceType: 'continuity_trial',
    sourceId: 'trial-20260425'
  });

  assert.equal(createPayload.event_type, 'continuity_trial');
  assert.equal(createPayload.source_type, 'continuity_trial');
  assert.equal(createPayload.integrity_status, 'accepted');
  assert.equal(result.event.id, 12);
});

test('recordRuntimeIdentityActivationTrace stores runtime-only activation evidence', async () => {
  let createPayload = null;
  const persistence = createPersistence({
    prisma: {
      runtimeIdentityActivationTrace: {
        create: async ({ data }) => {
          createPayload = data;
          return { id: 30n, ...data };
        }
      }
    }
  });

  const result = await persistence.recordRuntimeIdentityActivationTrace({
    identityKey: 'xiaoni',
    runId: 'run-1',
    traceId: 'trace-1',
    conversationId: '998',
    sceneFingerprint: 'group:253631878',
    cueSummary: 'conversation touched growth history',
    activatedRefs: [{ sourceType: 'accepted_identity_fact', sourceId: '21' }],
    suppressedRefs: [{ sourceType: 'identity_evidence_ref', sourceId: '22' }],
    selectedSkillRef: 'social-boundary',
    activationReason: 'identity-relevant cue'
  });

  assert.equal(createPayload.identity_key, 'xiaoni');
  assert.deepEqual(createPayload.activated_refs, [{ sourceType: 'accepted_identity_fact', sourceId: '21' }]);
  assert.deepEqual(createPayload.suppressed_refs, [{ sourceType: 'identity_evidence_ref', sourceId: '22' }]);
  assert.equal(result.id, 30);
});

test('ensureIdentityLineageSchema creates new Phase 1 tables and migrates legacy sidecars', async () => {
  const statements = [];
  const persistence = createPersistence({
    createSqlAdapter: () => ({
      execute: async (statement) => {
        statements.push(statement);
        return 0;
      },
      close: async () => undefined
    })
  });

  await persistence.ensureIdentityLineageSchema();

  assert.ok(statements.some((statement) => statement.includes('CREATE TABLE IF NOT EXISTS identity_change_candidates')));
  assert.ok(statements.some((statement) => statement.includes('CREATE TABLE IF NOT EXISTS accepted_identity_facts')));
  assert.ok(statements.some((statement) => statement.includes('CREATE TABLE IF NOT EXISTS runtime_identity_activation_traces')));
  assert.ok(statements.some((statement) => statement.includes('migrated_from')));
  assert.ok(statements.every((statement) => !statement.includes('CREATE TABLE IF NOT EXISTS identity_change_journal')));
});
