import { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import {
  PromptFunctionBinding,
  PromptFunctionBindingRecord,
  FunctionDefinition
} from '../types/function';
import { FunctionRepositoryType } from './function-repository';

const jsonSafeParse = (value: any) => {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  return value;
};

const mapRecord = (record: PromptFunctionBindingRecord): PromptFunctionBinding => ({
  id: record.id,
  promptId: record.prompt_id,
  functionId: record.function_id,
  priority: record.priority ?? undefined,
  metadata: jsonSafeParse(record.metadata),
  createdBy: record.created_by ?? undefined,
  updatedBy: record.updated_by ?? undefined,
  createdAt: record.created_at,
  updatedAt: record.updated_at
});

export interface PromptBindingPayload {
  functionIds: string[];
  actor?: string;
}

export const PromptBindingRepository = (pool: Pool, functionRepository: FunctionRepositoryType) => ({
  async getBindingsByPrompt(promptId: string): Promise<PromptFunctionBinding[]> {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM prompt_function_bindings WHERE prompt_id = ? ORDER BY priority ASC, id ASC',
      [promptId]
    );
    return rows.map(row => mapRecord(row as PromptFunctionBindingRecord));
  },

  async replaceBindings(promptId: string, payload: PromptBindingPayload): Promise<PromptFunctionBinding[]> {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      await connection.execute('DELETE FROM prompt_function_bindings WHERE prompt_id = ?', [promptId]);

      const now = new Date();
      const actor = payload.actor ?? null;

      for (let index = 0; index < payload.functionIds.length; index += 1) {
        const functionId = payload.functionIds[index];
        await connection.execute<ResultSetHeader>(
          `INSERT INTO prompt_function_bindings
            (prompt_id, function_id, calling_mode, priority, metadata, created_by, updated_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            promptId,
            functionId,
            'AUTO',
            index,
            null,
            actor,
            actor,
            now,
            now
          ]
        );
      }

      await connection.commit();

      return this.getBindingsByPrompt(promptId);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  async getPromptFunctions(promptId: string): Promise<{
    promptId: string;
    functions: FunctionDefinition[];
  }> {
    const bindings = await this.getBindingsByPrompt(promptId);
    const functions = await Promise.all(
      bindings.map(binding => functionRepository.findById(binding.functionId))
    );

    return {
      promptId,
      functions: functions.filter(Boolean) as FunctionDefinition[]
    };
  }
});

export type PromptBindingRepositoryType = ReturnType<typeof PromptBindingRepository>;
