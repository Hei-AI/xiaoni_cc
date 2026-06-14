import { projectAbMemoryContext } from './ab-memory-projector';
import {
  AbArmRun,
  AbFailureDetail,
  AbMemoryStreamItem,
  AbRunStatus,
  AbTurnSnapshot,
  CandidateAction,
  InitialImpulse,
  JsonObject,
  JsonValue,
  MemoryTensionSummary,
  RetrievedMemoryContext
} from './ab-types';
import type {
  TreatmentDeps,
  TreatmentModelExecuteResult,
  TreatmentModelMessage
} from './treatment-deps';

export interface MiniTreatmentRunnerOptions {
  modelName?: string;
  runnerName?: string;
  projectOrNamespace?: string;
  timeoutMs?: number;
}

export interface MiniTreatmentRunResult {
  armRun: AbArmRun;
  initialImpulse?: InitialImpulse | null;
  retrievedMemoryContext?: RetrievedMemoryContext | null;
  memoryTensionSummary?: MemoryTensionSummary | null;
  finalCandidateAction?: CandidateAction | null;
}

type InitialImpulsePayload = {
  initialImpulse?: InitialImpulse;
  initial_impulse?: InitialImpulse;
  candidateDraft?: JsonValue;
  candidate_draft?: JsonValue;
};

type FinalCandidatePayload = {
  memoryTensionSummary?: MemoryTensionSummary;
  memory_tension_summary?: MemoryTensionSummary;
  finalCandidateAction?: CandidateAction;
  final_candidate_action?: CandidateAction;
};

const DEFAULT_MODEL_NAME = 'gpt-5-mini';
const DEFAULT_RUNNER_NAME = 'mini-treatment-runner';
const FORMAT_REPAIR_SCHEMA = [
  'Return only JSON.',
  'For initial_impulse use: {"initialImpulse":{"summary":string,"likelyAction":string,"reasons":string[],"uncertainty":number,"shouldRecall":boolean}}.',
  'For final_candidate_action use: {"memoryTensionSummary":{"summary":string,"supportsSpeaking":string[],"supportsSilence":string[],"continuityRisks":string[],"conflicts":string[],"confidence":number},"finalCandidateAction":{"kind":string,"rationale":string,"confidence":number,...}}.'
].join('\n');

function nowIso(deps: Pick<TreatmentDeps, 'now'>) {
  return deps.now().toISOString();
}

function stableArmRunId(snapshotId: string) {
  return `ab_arm_treatment_${snapshotId.replace(/[^a-zA-Z0-9_-]/g, '_')}`.slice(0, 64);
}

function asJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as JsonValue;
}

function asJsonObject(value: unknown): JsonObject {
  const json = asJsonValue(value);
  return json && typeof json === 'object' && !Array.isArray(json) ? json as JsonObject : {};
}

function compact<T extends Record<string, unknown>>(input: T): JsonObject {
  const output: JsonObject = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) {
      output[key] = asJsonValue(value);
    }
  }
  return output;
}

function safeJsonParse(text: string): JsonObject | null {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as JsonObject : null;
  } catch {
    return null;
  }
}

function responseText(result: TreatmentModelExecuteResult) {
  if (typeof result.outputText === 'string' && result.outputText.trim().length > 0) {
    return result.outputText.trim();
  }
  if (result.rawResponse && typeof result.rawResponse === 'object') {
    return JSON.stringify(result.rawResponse);
  }
  return '';
}

async function parseModelJson<T>(
  deps: TreatmentDeps,
  snapshotId: string,
  modelName: string,
  purpose: 'initial_impulse' | 'final_candidate_action',
  result: TreatmentModelExecuteResult,
  timeoutMs?: number
): Promise<T> {
  const direct = safeJsonParse(responseText(result));
  if (direct) {
    return direct as T;
  }

  const repaired = await deps.executeModel({
    snapshotId,
    purpose: 'format_repair',
    modelName,
    messages: [
      { role: 'system', content: FORMAT_REPAIR_SCHEMA },
      {
        role: 'user',
        content: JSON.stringify({
          purpose,
          invalidOutput: responseText(result)
        })
      }
    ],
    generation: { semantic_retry: false },
    timeoutMs
  });
  const repairedJson = safeJsonParse(responseText(repaired));
  if (!repairedJson) {
    throw new Error(`Mini treatment ${purpose} returned non-JSON output after format repair`);
  }
  return repairedJson as T;
}

function normalizeInitialImpulse(payload: InitialImpulsePayload): InitialImpulse {
  const impulse = payload.initialImpulse || payload.initial_impulse;
  if (!impulse || typeof impulse.summary !== 'string') {
    throw new Error('Mini treatment initial impulse missing summary');
  }
  return {
    summary: impulse.summary,
    likelyAction: impulse.likelyAction || 'unknown',
    reasons: Array.isArray(impulse.reasons) ? impulse.reasons.map(String) : [],
    uncertainty: typeof impulse.uncertainty === 'number' ? impulse.uncertainty : 0.5,
    shouldRecall: impulse.shouldRecall !== false,
    rawModelOutput: asJsonObject(payload),
    metadata: compact({
      candidateDraft: payload.candidateDraft || payload.candidate_draft
    })
  };
}

function normalizeMemoryTension(payload: FinalCandidatePayload): MemoryTensionSummary {
  const summary = payload.memoryTensionSummary || payload.memory_tension_summary;
  if (!summary || typeof summary.summary !== 'string') {
    return {
      summary: 'No explicit memory tension summary returned.',
      supportsSpeaking: [],
      supportsSilence: [],
      continuityRisks: [],
      conflicts: [],
      confidence: 0
    };
  }
  return {
    summary: summary.summary,
    supportsSpeaking: Array.isArray(summary.supportsSpeaking) ? summary.supportsSpeaking.map(String) : [],
    supportsSilence: Array.isArray(summary.supportsSilence) ? summary.supportsSilence.map(String) : [],
    continuityRisks: Array.isArray(summary.continuityRisks) ? summary.continuityRisks.map(String) : [],
    conflicts: Array.isArray(summary.conflicts) ? summary.conflicts.map(String) : [],
    confidence: typeof summary.confidence === 'number' ? summary.confidence : 0,
    metadata: summary.metadata
  };
}

function normalizeCandidateAction(payload: FinalCandidatePayload): CandidateAction {
  const action = payload.finalCandidateAction || payload.final_candidate_action;
  if (!action || typeof action.kind !== 'string' || typeof action.rationale !== 'string') {
    throw new Error('Mini treatment final candidate action missing kind or rationale');
  }
  return {
    ...action,
    confidence: typeof action.confidence === 'number' ? action.confidence : 0.5
  } as CandidateAction;
}

function snapshotQueryText(snapshot: AbTurnSnapshot) {
  const unread = snapshot.scene?.unreadMessages || [];
  const recent = snapshot.scene?.recentContext || [];
  return [...recent, ...unread]
    .map((message) => message.content)
    .filter(Boolean)
    .join('\n')
    .slice(-6000);
}

function buildInitialMessages(snapshot: AbTurnSnapshot): TreatmentModelMessage[] {
  return [
    {
      role: 'system',
      content: [
        'You are the isolated gpt-5-mini A/B treatment arm for Xiaoni.',
        'Do not send messages or call production tools. Produce candidate artifacts only.',
        'Pass 1: judge the scene and return JSON with initialImpulse. A candidate draft is allowed but not final.'
      ].join('\n')
    },
    {
      role: 'user',
      content: JSON.stringify({
        snapshotId: snapshot.id,
        scene: snapshot.scene,
        runtimeConfig: snapshot.runtimeConfig,
        retrievalPolicy: snapshot.retrievalPolicy
      })
    }
  ];
}

function buildFinalMessages(
  snapshot: AbTurnSnapshot,
  initialImpulse: InitialImpulse,
  memoryContext: RetrievedMemoryContext
): TreatmentModelMessage[] {
  return [
    {
      role: 'system',
      content: [
        'You are the isolated gpt-5-mini A/B treatment arm for Xiaoni.',
        'Pass 2: use the frozen snapshot plus retrieved observations/reflections/plans to produce one final candidate action.',
        'Return JSON only. This is not an allow/deny gate and must not mutate production state.'
      ].join('\n')
    },
    {
      role: 'user',
      content: JSON.stringify({
        snapshotId: snapshot.id,
        scene: snapshot.scene,
        initialImpulse,
        retrievedMemoryContext: memoryContext
      })
    }
  ];
}

function failureDetail(error: unknown, deps: Pick<TreatmentDeps, 'now'>): AbFailureDetail {
  return {
    code: 'mini_treatment_failed',
    message: error instanceof Error ? error.message : String(error),
    retryable: false,
    stack: error instanceof Error ? error.stack || null : null,
    occurredAt: nowIso(deps)
  };
}

function buildArmRun(params: {
  snapshot: AbTurnSnapshot;
  status: AbRunStatus;
  modelName: string;
  runnerName: string;
  projectOrNamespace: string;
  startedAt: string;
  completedAt?: string | null;
  inputSummary?: JsonObject;
  outputArtifact?: JsonObject;
  memoryContext?: RetrievedMemoryContext | null;
  failure?: AbFailureDetail | null;
}): AbArmRun {
  return {
    id: stableArmRunId(params.snapshot.id),
    snapshotId: params.snapshot.id,
    arm: 'treatment',
    projectOrNamespace: params.projectOrNamespace,
    runnerName: params.runnerName,
    modelName: params.modelName,
    inputSummary: params.inputSummary || {},
    outputArtifact: params.outputArtifact || {},
    memoryContext: params.memoryContext || params.snapshot.memoryStreamView,
    failure: params.failure || null,
    startedAt: params.startedAt,
    completedAt: params.completedAt || null,
    status: params.status
  };
}

export class MiniTreatmentRunner {
  constructor(
    private readonly deps: TreatmentDeps,
    private readonly options: MiniTreatmentRunnerOptions = {}
  ) {}

  async run(snapshotId: string): Promise<MiniTreatmentRunResult> {
    const startedAt = nowIso(this.deps);
    const modelName = this.options.modelName || DEFAULT_MODEL_NAME;
    const runnerName = this.options.runnerName || DEFAULT_RUNNER_NAME;
    const snapshot = await this.deps.loadSnapshot(snapshotId);
    if (!snapshot) {
      throw new Error(`AB snapshot not found: ${snapshotId}`);
    }
    const projectOrNamespace = this.options.projectOrNamespace ||
      snapshot.memoryStreamView?.namespace ||
      `ab:treatment:${snapshot.sessionKey || snapshot.id}`;

    await this.deps.writeArmRun(buildArmRun({
      snapshot,
      status: 'running',
      modelName,
      runnerName,
      projectOrNamespace,
      startedAt
    }));

    try {
      const initialResult = await this.deps.executeModel({
        snapshotId: snapshot.id,
        purpose: 'initial_impulse',
        modelName,
        messages: buildInitialMessages(snapshot),
        generation: { step: 1, fixed_step_loop: true },
        timeoutMs: this.options.timeoutMs
      });
      const initialPayload = await parseModelJson<InitialImpulsePayload>(
        this.deps,
        snapshot.id,
        modelName,
        'initial_impulse',
        initialResult,
        this.options.timeoutMs
      );
      const initialImpulse = normalizeInitialImpulse(initialPayload);

      const memoryItems = await this.deps.listMemoryStreamItems(projectOrNamespace, {
        text: snapshotQueryText(snapshot),
        sessionKey: snapshot.sessionKey,
        peerId: snapshot.peerId,
        senderId: snapshot.senderId,
        types: ['observation', 'reflection', 'plan'],
        metadata: { initialImpulse: asJsonObject(initialImpulse) }
      });
      const memoryContext = await projectAbMemoryContext({
        namespace: projectOrNamespace,
        queryText: snapshotQueryText(snapshot),
        retrievalPolicy: snapshot.retrievalPolicy,
        sessionKey: snapshot.sessionKey,
        peerId: snapshot.peerId,
        senderId: snapshot.senderId,
        arm: 'treatment',
        items: memoryItems as AbMemoryStreamItem[]
      });

      const finalResult = await this.deps.executeModel({
        snapshotId: snapshot.id,
        purpose: 'final_candidate_action',
        modelName,
        messages: buildFinalMessages(snapshot, initialImpulse, memoryContext),
        generation: { step: 2, fixed_step_loop: true },
        timeoutMs: this.options.timeoutMs
      });
      const finalPayload = await parseModelJson<FinalCandidatePayload>(
        this.deps,
        snapshot.id,
        modelName,
        'final_candidate_action',
        finalResult,
        this.options.timeoutMs
      );
      const memoryTensionSummary = normalizeMemoryTension(finalPayload);
      const finalCandidateAction = normalizeCandidateAction(finalPayload);
      const completedAt = nowIso(this.deps);
      const outputArtifact = asJsonObject({
        initialImpulse,
        retrievedMemoryContext: memoryContext,
        memoryTensionSummary,
        finalCandidateAction,
        modelUsage: compact({
          initial: initialResult.usage,
          final: finalResult.usage
        })
      });
      const armRun = buildArmRun({
        snapshot,
        status: 'completed',
        modelName,
        runnerName,
        projectOrNamespace,
        startedAt,
        completedAt,
        inputSummary: {
          sceneTokenEstimate: snapshot.scene?.unreadMessages?.reduce((sum, item) => sum + Math.ceil(item.content.length / 4), 0) || 0,
          memoryTokenEstimate: memoryContext.budget.totalTokens,
          promptVersion: snapshot.runtimeConfig?.promptVersions?.main || null,
          metadata: {
            fixedStepLoop: true,
            semanticRetry: false
          }
        },
        outputArtifact,
        memoryContext
      });
      await this.deps.writeArmRun(armRun);
      return {
        armRun,
        initialImpulse,
        retrievedMemoryContext: memoryContext,
        memoryTensionSummary,
        finalCandidateAction
      };
    } catch (error) {
      const failed = buildArmRun({
        snapshot,
        status: 'failed',
        modelName,
        runnerName,
        projectOrNamespace,
        startedAt,
        completedAt: nowIso(this.deps),
        failure: failureDetail(error, this.deps)
      });
      await this.deps.writeArmRun(failed);
      this.deps.logger.warn('Mini treatment runner failed', {
        snapshotId,
        error: failed.failure as unknown as JsonValue
      });
      return { armRun: failed };
    }
  }
}
