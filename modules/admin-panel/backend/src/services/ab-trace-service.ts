import {
  ensureAbExperimentSchema,
  getAbExperimentTrace,
  listAbTurnSnapshots
} from '@qq-bot/persistence';
import type {
  AbTraceActionSummaryDto,
  AbTraceArm,
  AbTraceArmSummaryDto,
  AbTraceCandidateActionDto,
  AbTraceDetailDto,
  AbTraceDimensionSummaryDto,
  AbTraceEvalDetailDto,
  AbTraceEvalLabel,
  AbTraceFailureDto,
  AbTraceInitialImpulseDto,
  AbTraceMemoryItemDto,
  AbTraceMemoryTensionSummaryDto,
  AbTracePayloadSizeMarkersDto,
  AbTraceRetrievedMemoryDto,
  AbTraceSceneDetailDto,
  AbTraceSceneMessageDto,
  AbTraceSceneSummaryDto,
  AbTraceSourceRefDto,
  AbTraceStatus,
  AbTraceSummaryDto
} from '../types/ab-trace';

type JsonRecord = Record<string, any>;

let abExperimentSchemaReady: Promise<void> | null = null;

async function ensureAbTraceSchemaReady() {
  if (!abExperimentSchemaReady) {
    abExperimentSchemaReady = ensureAbExperimentSchema();
  }
  await abExperimentSchemaReady;
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asStatus(value: unknown, fallback: AbTraceStatus = 'pending'): AbTraceStatus {
  const status = asString(value);
  return status === 'running' || status === 'completed' || status === 'failed' || status === 'skipped' || status === 'pending'
    ? status
    : fallback;
}

function jsonBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
  } catch {
    return 0;
  }
}

function previewText(value: unknown, maxLength = 180): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) {
    return null;
  }
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function normalizeSourceRefs(value: unknown): AbTraceSourceRefDto[] {
  return asArray(value).map((item) => {
    const record = asRecord(item);
    return {
      kind: asString(record.kind) || 'unknown',
      id: String(record.id ?? ''),
      table: asString(record.table),
      traceId: asString(record.traceId ?? record.trace_id),
      runId: asString(record.runId ?? record.run_id),
      createdAt: asString(record.createdAt ?? record.created_at)
    };
  }).filter((item) => item.id.length > 0);
}

function normalizeSceneMessage(value: unknown): AbTraceSceneMessageDto {
  const record = asRecord(value);
  return {
    id: record.id ?? null,
    role: asString(record.role) || 'event',
    content: typeof record.content === 'string' ? record.content : String(record.content ?? ''),
    senderId: asString(record.senderId ?? record.sender_id),
    senderName: asString(record.senderName ?? record.sender_name),
    timestamp: asString(record.timestamp ?? record.createdAt ?? record.created_at),
    sourceRefs: normalizeSourceRefs(record.sourceRefs ?? record.source_refs),
    metadata: asRecord(record.metadata)
  };
}

function normalizeSceneDetail(sceneValue: unknown): AbTraceSceneDetailDto {
  const scene = asRecord(sceneValue);
  return {
    unreadMessages: asArray(scene.unreadMessages ?? scene.unread_messages).map(normalizeSceneMessage),
    recentContext: asArray(scene.recentContext ?? scene.recent_context).map(normalizeSceneMessage),
    readCutoff: asRecord(scene.readCutoff ?? scene.read_cutoff),
    summary: asString(scene.summary),
    metadata: asRecord(scene.metadata)
  };
}

function buildSceneSummary(snapshot: JsonRecord): AbTraceSceneSummaryDto {
  const scene = normalizeSceneDetail(snapshot.scene);
  return {
    chatType: asString(snapshot.chat_type ?? snapshot.chatType),
    peerId: asString(snapshot.peer_id ?? snapshot.peerId),
    senderId: asString(snapshot.sender_id ?? snapshot.senderId),
    unreadMessageCount: scene.unreadMessages.length,
    recentContextCount: scene.recentContext.length,
    summary: scene.summary || previewText(scene.unreadMessages.map((message) => message.content).join('\n'), 240)
  };
}

function pickCandidateAction(armRun: JsonRecord | null): JsonRecord {
  if (!armRun) {
    return {};
  }
  const output = asRecord(armRun.output_artifact ?? armRun.outputArtifact);
  const direct = asRecord(output.finalCandidateAction ?? output.final_candidate_action);
  if (Object.keys(direct).length > 0) {
    return direct;
  }
  return asRecord(output.action ?? output.candidateAction ?? output.candidate_action);
}

function buildActionSummary(action: JsonRecord): AbTraceActionSummaryDto | null {
  if (Object.keys(action).length === 0) {
    return null;
  }
  return {
    kind: asString(action.kind),
    textPreview: previewText(action.text ?? action.query ?? action.prompt ?? action.silenceReason ?? action.silence_reason),
    confidence: asNumber(action.confidence),
    rationalePreview: previewText(action.rationale)
  };
}

function buildArmSummary(armRun: JsonRecord | null, arm: AbTraceArm, fallbackStatus: unknown): AbTraceArmSummaryDto | null {
  if (!armRun) {
    return {
      arm,
      status: asStatus(fallbackStatus)
    };
  }
  const failure = asRecord(armRun.failure);
  return {
    arm,
    status: asStatus(armRun.status, asStatus(fallbackStatus)),
    armRunId: asString(armRun.id),
    modelName: asString(armRun.model_name ?? armRun.modelName),
    runnerName: asString(armRun.runner_name ?? armRun.runnerName),
    finalAction: buildActionSummary(pickCandidateAction(armRun)),
    failureCode: asString(failure.code),
    startedAt: asString(armRun.started_at ?? armRun.startedAt),
    completedAt: asString(armRun.completed_at ?? armRun.completedAt)
  };
}

function dimensionScore(dimensions: JsonRecord, camelKey: string, snakeKey?: string): number | null {
  const value = dimensions[camelKey] ?? (snakeKey ? dimensions[snakeKey] : undefined);
  if (typeof value === 'number') {
    return value;
  }
  return asNumber(asRecord(value).score);
}

function buildDimensionSummary(evalResult: JsonRecord | null): AbTraceDimensionSummaryDto | null {
  if (!evalResult) {
    return null;
  }
  const dimensions = asRecord(evalResult.dimensions);
  return {
    contextuality: dimensionScore(dimensions, 'contextuality'),
    continuity: dimensionScore(dimensions, 'continuity'),
    socialNaturalness: dimensionScore(dimensions, 'socialNaturalness', 'social_naturalness'),
    actionFit: dimensionScore(dimensions, 'actionFit', 'action_fit'),
    memoryUse: dimensionScore(dimensions, 'memoryUse', 'memory_use'),
    isolationIntegrity: dimensionScore(dimensions, 'isolationIntegrity', 'isolation_integrity')
  };
}

function buildIsolationSummary(evalResult: JsonRecord | null) {
  const isolation = asRecord(evalResult?.isolation_check ?? evalResult?.isolationCheck);
  const productionSideEffects = asArray(isolation.productionSideEffects ?? isolation.production_side_effects);
  const forbiddenSymbols = asArray(isolation.forbiddenSymbolsObserved ?? isolation.forbidden_symbols_observed);
  return {
    passed: typeof isolation.passed === 'boolean' ? isolation.passed : null,
    productionSideEffectCount: productionSideEffects.length,
    forbiddenSymbolCount: forbiddenSymbols.length
  };
}

function buildPayloadSizeMarkers(snapshot: JsonRecord, treatmentArmRun: JsonRecord | null, evalResult: JsonRecord | null): AbTracePayloadSizeMarkersDto {
  const output = asRecord(treatmentArmRun?.output_artifact ?? treatmentArmRun?.outputArtifact);
  const memoryContext = output.retrievedMemoryContext ?? output.retrieved_memory_context ?? treatmentArmRun?.memory_context ?? treatmentArmRun?.memoryContext;
  return {
    sceneBytes: jsonBytes(snapshot.scene),
    retrievedMemoryBytes: jsonBytes(memoryContext),
    initialImpulseBytes: jsonBytes(output.initialImpulse ?? output.initial_impulse),
    memoryTensionBytes: jsonBytes(output.memoryTensionSummary ?? output.memory_tension_summary),
    finalCandidateBytes: jsonBytes(output.finalCandidateAction ?? output.final_candidate_action),
    evalBytes: jsonBytes(evalResult)
  };
}

function buildTraceSummaryFromRaw(rawTrace: JsonRecord): AbTraceSummaryDto {
  const snapshot = asRecord(rawTrace.snapshot);
  const evalResult = rawTrace.latest_eval_result ? asRecord(rawTrace.latest_eval_result) : null;
  const controlArm = rawTrace.control_arm_run ? asRecord(rawTrace.control_arm_run) : null;
  const treatmentArm = rawTrace.treatment_arm_run ? asRecord(rawTrace.treatment_arm_run) : null;
  return {
    snapshotId: String(snapshot.id),
    traceId: asString(snapshot.trace_id ?? snapshot.traceId),
    runId: asString(snapshot.run_id ?? snapshot.runId),
    createdAt: asString(snapshot.created_at ?? snapshot.createdAt) || '',
    updatedAt: asString(snapshot.updated_at ?? snapshot.updatedAt) || '',
    captureStatus: asString(snapshot.capture_status ?? snapshot.captureStatus) as AbTraceSummaryDto['captureStatus'] || 'created',
    controlStatus: asStatus(snapshot.control_status ?? snapshot.controlStatus),
    treatmentStatus: asStatus(snapshot.treatment_status ?? snapshot.treatmentStatus),
    evalStatus: asStatus(snapshot.eval_status ?? snapshot.evalStatus),
    scene: buildSceneSummary(snapshot),
    controlArm: buildArmSummary(controlArm, 'control', snapshot.control_status ?? snapshot.controlStatus),
    treatmentArm: buildArmSummary(treatmentArm, 'treatment', snapshot.treatment_status ?? snapshot.treatmentStatus),
    evalLabel: asString(evalResult?.label) as AbTraceEvalLabel | null,
    evalDimensions: buildDimensionSummary(evalResult),
    isolationCheck: buildIsolationSummary(evalResult),
    payloadSizeMarkers: buildPayloadSizeMarkers(snapshot, treatmentArm, evalResult),
    hasDetail: true
  };
}

function normalizeMemoryItem(value: unknown): AbTraceMemoryItemDto {
  const record = asRecord(value);
  return {
    id: String(record.id ?? ''),
    type: asString(record.type) as AbTraceMemoryItemDto['type'] || 'observation',
    subtype: asString(record.subtype),
    content: typeof record.content === 'string' ? record.content : String(record.content ?? ''),
    score: asNumber(record.score),
    relevanceScore: asNumber(record.relevanceScore ?? record.relevance_score),
    recencyScore: asNumber(record.recencyScore ?? record.recency_score),
    importanceScore: asNumber(record.importanceScore ?? record.importance_score ?? record.importance),
    confidence: asNumber(record.confidence),
    sourceRefs: normalizeSourceRefs(record.sourceRefs ?? record.sourceEventRefs ?? record.source_event_refs),
    createdAt: asString(record.createdAt ?? record.created_at),
    updatedAt: asString(record.updatedAt ?? record.updated_at),
    metadata: asRecord(record.metadata ?? record.provenance)
  };
}

function normalizeRetrievedMemory(value: unknown): AbTraceRetrievedMemoryDto {
  const memory = asRecord(value);
  return {
    namespace: asString(memory.namespace) || 'unknown',
    observations: asArray(memory.observations).map(normalizeMemoryItem),
    reflections: asArray(memory.reflections).map(normalizeMemoryItem),
    plans: asArray(memory.plans).map(normalizeMemoryItem),
    selfState: asArray(memory.selfState ?? memory.self_state).map(normalizeMemoryItem),
    budget: asRecord(memory.budget)
  };
}

function normalizeInitialImpulse(value: unknown): AbTraceInitialImpulseDto | null {
  const impulse = asRecord(value);
  if (Object.keys(impulse).length === 0) {
    return null;
  }
  return {
    summary: asString(impulse.summary) || '',
    likelyAction: asString(impulse.likelyAction ?? impulse.likely_action),
    reasons: asArray(impulse.reasons).map(String),
    uncertainty: asNumber(impulse.uncertainty),
    shouldRecall: typeof impulse.shouldRecall === 'boolean' ? impulse.shouldRecall : typeof impulse.should_recall === 'boolean' ? impulse.should_recall : null,
    rawModelOutput: impulse.rawModelOutput ?? impulse.raw_model_output,
    metadata: asRecord(impulse.metadata)
  };
}

function normalizeMemoryTension(value: unknown): AbTraceMemoryTensionSummaryDto | null {
  const tension = asRecord(value);
  if (Object.keys(tension).length === 0) {
    return null;
  }
  return {
    summary: asString(tension.summary) || '',
    supportsSpeaking: asArray(tension.supportsSpeaking ?? tension.supports_speaking).map(String),
    supportsSilence: asArray(tension.supportsSilence ?? tension.supports_silence).map(String),
    continuityRisks: asArray(tension.continuityRisks ?? tension.continuity_risks).map(String),
    conflicts: asArray(tension.conflicts).map(String),
    recommendedPosture: asString(tension.recommendedPosture ?? tension.recommended_posture),
    confidence: asNumber(tension.confidence),
    metadata: asRecord(tension.metadata)
  };
}

function normalizeCandidateAction(value: unknown): AbTraceCandidateActionDto | null {
  const action = asRecord(value);
  if (Object.keys(action).length === 0) {
    return null;
  }
  return {
    kind: asString(action.kind) || 'unknown',
    rationale: asString(action.rationale),
    confidence: asNumber(action.confidence),
    text: asString(action.text),
    targetGroupId: asString(action.targetGroupId ?? action.target_group_id),
    targetUserId: asString(action.targetUserId ?? action.target_user_id),
    query: asString(action.query),
    prompt: asString(action.prompt),
    intendedUse: asString(action.intendedUse ?? action.intended_use),
    silenceReason: asString(action.silenceReason ?? action.silence_reason),
    memoryItemIds: asArray(action.memoryItemIds ?? action.memory_item_ids).map(String),
    metadata: asRecord(action.metadata)
  };
}

function normalizeFailure(value: unknown): AbTraceFailureDto | null {
  const failure = asRecord(value);
  if (Object.keys(failure).length === 0) {
    return null;
  }
  return {
    code: asString(failure.code) || 'unknown',
    message: asString(failure.message) || '',
    retryable: typeof failure.retryable === 'boolean' ? failure.retryable : undefined,
    stack: asString(failure.stack),
    cause: failure.cause,
    occurredAt: asString(failure.occurredAt ?? failure.occurred_at)
  };
}

function normalizeEvalDetail(value: unknown): AbTraceEvalDetailDto | null {
  const evalResult = asRecord(value);
  if (Object.keys(evalResult).length === 0) {
    return null;
  }
  const isolation = asRecord(evalResult.isolation_check ?? evalResult.isolationCheck);
  return {
    label: asString(evalResult.label) as AbTraceEvalLabel || 'unclear',
    dimensions: asRecord(evalResult.dimensions) as AbTraceEvalDetailDto['dimensions'],
    reviewerNotes: asString(evalResult.reviewer_notes ?? evalResult.reviewerNotes),
    isolationCheck: Object.keys(isolation).length > 0 ? {
      passed: Boolean(isolation.passed),
      productionSideEffects: asArray(isolation.productionSideEffects ?? isolation.production_side_effects).map(String),
      forbiddenSymbolsObserved: asArray(isolation.forbiddenSymbolsObserved ?? isolation.forbidden_symbols_observed).map(String),
      notes: asString(isolation.notes),
      metadata: asRecord(isolation.metadata)
    } : null,
    fixtureId: asString(evalResult.fixture_id ?? evalResult.fixtureId)
  };
}

export async function listAbTraceSummaries(filters: { runId?: string; traceId?: string; limit?: number } = {}): Promise<AbTraceSummaryDto[]> {
  await ensureAbTraceSchemaReady();
  const snapshots = await listAbTurnSnapshots({
    runId: filters.runId,
    traceId: filters.traceId,
    limit: filters.limit ?? 50
  });
  const traces = await Promise.all(
    snapshots.map((snapshot: JsonRecord) => getAbExperimentTrace(String(snapshot.id)))
  );
  return traces.filter(Boolean).map((trace) => buildTraceSummaryFromRaw(asRecord(trace)));
}

export async function getAbTraceSummary(snapshotId: string): Promise<AbTraceSummaryDto | null> {
  await ensureAbTraceSchemaReady();
  const trace = await getAbExperimentTrace(snapshotId);
  return trace ? buildTraceSummaryFromRaw(asRecord(trace)) : null;
}

export async function getAbTraceDetail(snapshotId: string): Promise<AbTraceDetailDto | null> {
  await ensureAbTraceSchemaReady();
  const trace = await getAbExperimentTrace(snapshotId);
  if (!trace) {
    return null;
  }
  const rawTrace = asRecord(trace);
  const snapshot = asRecord(rawTrace.snapshot);
  const treatmentArmRun = rawTrace.treatment_arm_run ? asRecord(rawTrace.treatment_arm_run) : null;
  const treatmentOutput = asRecord(treatmentArmRun?.output_artifact ?? treatmentArmRun?.outputArtifact);
  const memoryContext = treatmentOutput.retrievedMemoryContext
    ?? treatmentOutput.retrieved_memory_context
    ?? treatmentArmRun?.memory_context
    ?? treatmentArmRun?.memoryContext
    ?? snapshot.memory_stream_view
    ?? snapshot.memoryStreamView;

  return {
    summary: buildTraceSummaryFromRaw(rawTrace),
    providerEventIds: asArray(snapshot.provider_event_ids ?? snapshot.providerEventIds),
    queueMessageIds: asArray(snapshot.queue_message_ids ?? snapshot.queueMessageIds),
    scene: normalizeSceneDetail(snapshot.scene),
    retrievedMemory: normalizeRetrievedMemory(memoryContext),
    initialImpulse: normalizeInitialImpulse(treatmentOutput.initialImpulse ?? treatmentOutput.initial_impulse),
    memoryTensionSummary: normalizeMemoryTension(treatmentOutput.memoryTensionSummary ?? treatmentOutput.memory_tension_summary),
    finalCandidateAction: normalizeCandidateAction(treatmentOutput.finalCandidateAction ?? treatmentOutput.final_candidate_action ?? pickCandidateAction(treatmentArmRun)),
    failure: normalizeFailure(treatmentArmRun?.failure),
    eval: normalizeEvalDetail(rawTrace.latest_eval_result)
  };
}
