import { Pool, ResultSetHeader } from 'mysql2/promise';
import { FunctionExecutionStatus } from '../types/function';

export interface FunctionExecutionLogPayload {
  traceId?: string;
  functionId?: string;
  promptId?: number;
  jobId?: string;
  sourceKey?: string;
  requestArguments: Record<string, unknown>;
  requestContext?: Record<string, unknown>;
  responseData?: Record<string, unknown>;
  errorMessage?: string;
  status: FunctionExecutionStatus;
  durationMs?: number;
  startedAt: Date;
  completedAt?: Date;
}

export const FunctionExecutionLogRepository = (pool: Pool) => ({
  async insert(payload: FunctionExecutionLogPayload): Promise<void> {
    await pool.execute<ResultSetHeader>(
      `INSERT INTO function_execution_logs (
        trace_id,
        function_id,
        prompt_id,
        job_id,
        source_key,
        request_arguments,
        request_context,
        response_data,
        error_message,
        status,
        duration_ms,
        started_at,
        completed_at,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.traceId ?? null,
        payload.functionId ?? null,
        payload.promptId ?? null,
        payload.jobId ?? null,
        payload.sourceKey ?? null,
        JSON.stringify(payload.requestArguments ?? {}),
        payload.requestContext ? JSON.stringify(payload.requestContext) : null,
        payload.responseData ? JSON.stringify(payload.responseData) : null,
        payload.errorMessage ?? null,
        payload.status,
        payload.durationMs ?? null,
        payload.startedAt,
        payload.completedAt ?? null,
        new Date()
      ]
    );
  }
});

export type FunctionExecutionLogRepositoryType = ReturnType<typeof FunctionExecutionLogRepository>;
