import type {
  AbArmRun,
  AbEvalResult,
  AbMemoryQuery,
  AbMemoryStreamItem,
  AbTurnSnapshot,
  JsonObject,
  JsonValue
} from './ab-types';

export interface TreatmentLogger {
  debug(message: string, metadata?: JsonObject): void;
  info(message: string, metadata?: JsonObject): void;
  warn(message: string, metadata?: JsonObject): void;
  error(message: string, metadata?: JsonObject): void;
}

export interface TreatmentModelMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  metadata?: JsonObject;
}

export interface TreatmentModelToolDefinition {
  name: string;
  description?: string;
  parameters?: JsonObject;
}

export interface TreatmentModelExecuteRequest {
  snapshotId: string;
  armRunId?: string;
  purpose: 'initial_impulse' | 'final_candidate_action' | 'format_repair' | 'eval';
  modelName: string;
  messages: TreatmentModelMessage[];
  tools?: TreatmentModelToolDefinition[];
  toolChoice?: JsonValue;
  generation?: JsonObject;
  timeoutMs?: number;
  metadata?: JsonObject;
}

export interface TreatmentModelExecuteResult {
  requestId?: string | null;
  modelName: string;
  outputText?: string | null;
  toolCalls?: JsonValue[];
  rawResponse?: JsonValue;
  usage?: JsonObject;
  completedAt: string;
}

export interface TreatmentDeps {
  loadSnapshot(snapshotId: string): Promise<AbTurnSnapshot | null>;
  listMemoryStreamItems(namespace: string, query: AbMemoryQuery): Promise<AbMemoryStreamItem[]>;
  executeModel(request: TreatmentModelExecuteRequest): Promise<TreatmentModelExecuteResult>;
  writeArmRun(armRun: AbArmRun): Promise<void>;
  writeMemoryStreamItem(item: AbMemoryStreamItem): Promise<void>;
  writeEvalResult(evalResult: AbEvalResult): Promise<void>;
  now(): Date;
  logger: TreatmentLogger;
}
