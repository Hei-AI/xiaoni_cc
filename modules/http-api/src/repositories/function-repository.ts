import { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { Buffer } from 'buffer';
import { v4 as uuidv4 } from 'uuid';
import {
  FunctionDefinition,
  FunctionDefinitionRecord,
  FunctionInvokeMethod,
  FunctionAuthType
} from '../types/function';

const JSON_COLUMNS: Array<keyof FunctionDefinitionRecord> = [
  'parameters_schema',
  'tags',
  'retry_policy'
];

const BOOLEAN_COLUMNS: Array<keyof FunctionDefinitionRecord> = [
  'side_effect',
  'expect_response',
  'managed_by_system',
  'enabled'
];

const decodeIfMisencoded = (value?: string | null): string | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }

  try {
    const decoded = Buffer.from(value, 'latin1').toString('utf8');
    return decoded.includes('�') ? value : decoded;
  } catch {
    return value;
  }
};

const decodeSchemaTexts = (schema: any): any => {
  if (!schema) {
    return schema;
  }

  if (typeof schema === 'string') {
    return decodeIfMisencoded(schema) ?? schema;
  }

  if (Array.isArray(schema)) {
    return schema.map(item => decodeSchemaTexts(item));
  }

  if (typeof schema === 'object') {
    const decoded: Record<string, any> = {};
    Object.entries(schema).forEach(([key, value]) => {
      decoded[key] = decodeSchemaTexts(value);
    });
    return decoded;
  }

  return schema;
};

const mapRecordToDefinition = (record: FunctionDefinitionRecord): FunctionDefinition => {
  const getBoolean = (value: number) => value === 1;

  return {
    id: record.id,
    name: record.name,
    displayName: decodeIfMisencoded(record.display_name) ?? record.display_name,
    description: decodeIfMisencoded(record.description),
    parametersSchema: decodeSchemaTexts(record.parameters_schema),
    sideEffect: getBoolean(record.side_effect),
    expectResponse: getBoolean(record.expect_response),
    category: decodeIfMisencoded(record.category),
    tags: Array.isArray(record.tags) ? record.tags : undefined,
    invokeMethod: record.invoke_method,
    invokeUrl: record.invoke_url ?? undefined,
    httpMethod: record.http_method ?? undefined,
    authType: record.auth_type,
    timeoutMs: record.timeout_ms,
    retryPolicy: record.retry_policy ?? undefined,
    executionAdapter: record.execution_adapter ?? undefined,
    managedBySystem: getBoolean(record.managed_by_system),
    enabled: getBoolean(record.enabled),
    createdBy: record.created_by ?? undefined,
    updatedBy: record.updated_by ?? undefined,
    createdAt: record.created_at,
    updatedAt: record.updated_at
  };
};

const parseRecord = (row: RowDataPacket): FunctionDefinitionRecord => {
  const parsed: any = { ...row };

  JSON_COLUMNS.forEach(column => {
    const rawValue = row[column as string];
    if (rawValue === null || rawValue === undefined) {
      parsed[column] = column === 'parameters_schema' ? {} : null;
      return;
    }
    if (typeof rawValue === 'string') {
      try {
        parsed[column] = JSON.parse(rawValue);
      } catch {
        parsed[column] = {};
      }
    } else {
      parsed[column] = rawValue;
    }
  });

  BOOLEAN_COLUMNS.forEach(column => {
    const rawValue = row[column as string];
    if (typeof rawValue === 'boolean') {
      parsed[column] = rawValue ? 1 : 0;
    } else if (typeof rawValue === 'number') {
      parsed[column] = rawValue;
    } else {
      parsed[column] = rawValue ? 1 : 0;
    }
  });

  return parsed as FunctionDefinitionRecord;
};

export interface FunctionListParams {
  search?: string;
  category?: string;
  enabled?: boolean;
  tag?: string;
  sideEffect?: boolean;
  limit?: number;
  offset?: number;
}

export interface FunctionListResult {
  items: FunctionDefinition[];
  total: number;
}

export interface CreateFunctionPayload {
  name: string;
  displayName: string;
  description?: string;
  parametersSchema: any;
  sideEffect?: boolean;
  expectResponse?: boolean;
  category?: string;
  tags?: string[];
  invokeMethod: FunctionInvokeMethod;
  invokeUrl?: string;
  httpMethod?: string;
  authType?: FunctionAuthType;
  timeoutMs?: number;
  retryPolicy?: any;
  executionAdapter?: string;
  managedBySystem?: boolean;
  enabled?: boolean;
  createdBy?: string;
}

export interface UpdateFunctionPayload extends Partial<CreateFunctionPayload> {
  updatedBy?: string;
}

export const FunctionRepository = (pool: Pool) => ({
  async listFunctions(params: FunctionListParams): Promise<FunctionListResult> {
    const {
      search,
      category,
      enabled,
      tag,
      sideEffect,
      limit = 20,
      offset = 0
    } = params;

    const filters: string[] = [];
    const args: any[] = [];

    if (search) {
      filters.push('(name LIKE ? OR display_name LIKE ? OR description LIKE ?)');
      const wildcard = `%${search}%`;
      args.push(wildcard, wildcard, wildcard);
    }

    if (category) {
      filters.push('category = ?');
      args.push(category);
    }

    if (typeof enabled === 'boolean') {
      filters.push('enabled = ?');
      args.push(enabled ? 1 : 0);
    }

    if (typeof sideEffect === 'boolean') {
      filters.push('side_effect = ?');
      args.push(sideEffect ? 1 : 0);
    }

    if (tag) {
      filters.push("JSON_CONTAINS(tags, ?, '$')");
      args.push(JSON.stringify(tag));
    }

    const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';

    const [rows] = await pool.query<RowDataPacket[]>(
      `
      SELECT SQL_CALC_FOUND_ROWS *
      FROM llm_function_definitions
      ${whereClause}
      ORDER BY managed_by_system DESC, created_at DESC
      LIMIT ?
      OFFSET ?
    `,
      [...args, limit, offset]
    );

    const [countRows] = await pool.query<RowDataPacket[]>('SELECT FOUND_ROWS() as total');
    const total = countRows[0]?.total ?? 0;

    const items = rows.map(row => mapRecordToDefinition(parseRecord(row)));
    return { items, total };
  },

  async findById(id: string): Promise<FunctionDefinition | null> {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM llm_function_definitions WHERE id = ?',
      [id]
    );

    if (rows.length === 0) {
      return null;
    }

    return mapRecordToDefinition(parseRecord(rows[0]));
  },

  async findByName(name: string): Promise<FunctionDefinition | null> {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM llm_function_definitions WHERE name = ?',
      [name]
    );

    if (rows.length === 0) {
      return null;
    }

    return mapRecordToDefinition(parseRecord(rows[0]));
  },

  async createFunction(payload: CreateFunctionPayload): Promise<FunctionDefinition> {
    const id = uuidv4();
    const now = new Date();
    const {
      name,
      displayName,
      description,
      parametersSchema,
      sideEffect = false,
      expectResponse = true,
      category,
      tags,
      invokeMethod,
      invokeUrl,
      httpMethod,
      authType = 'NONE',
      timeoutMs = 30000,
      retryPolicy,
      executionAdapter,
      managedBySystem = false,
      enabled = true,
      createdBy
    } = payload;

    await pool.execute<ResultSetHeader>(
      `INSERT INTO llm_function_definitions (
        id, name, display_name, description,
        parameters_schema, side_effect, expect_response,
        category, tags, invoke_method, invoke_url,
        http_method, auth_type, timeout_ms, retry_policy, execution_adapter,
        managed_by_system, enabled, created_by, updated_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        name,
        displayName,
        description ?? null,
        JSON.stringify(parametersSchema ?? {}),
        sideEffect ? 1 : 0,
        expectResponse ? 1 : 0,
        category ?? null,
        tags ? JSON.stringify(tags) : null,
        invokeMethod,
        invokeUrl ?? null,
        httpMethod ?? null,
        authType,
        timeoutMs,
        retryPolicy ? JSON.stringify(retryPolicy) : null,
        executionAdapter ?? null,
        managedBySystem ? 1 : 0,
        enabled ? 1 : 0,
        createdBy ?? null,
        createdBy ?? null,
        now,
        now
      ]
    );

    return this.findById(id) as Promise<FunctionDefinition>;
  },

  async updateFunction(id: string, payload: UpdateFunctionPayload): Promise<FunctionDefinition | null> {
    const existing = await this.findById(id);
    if (!existing) {
      return null;
    }

    const fields: string[] = [];
    const args: any[] = [];

    const mapBoolean = (value?: boolean) => (typeof value === 'boolean' ? (value ? 1 : 0) : undefined);

    const updateMapping: Record<string, any> = {
      name: payload.name,
      display_name: payload.displayName,
      description: payload.description,
      parameters_schema: payload.parametersSchema ? JSON.stringify(payload.parametersSchema) : undefined,
      side_effect: mapBoolean(payload.sideEffect),
      expect_response: mapBoolean(payload.expectResponse),
      category: payload.category,
      tags: payload.tags ? JSON.stringify(payload.tags) : undefined,
      invoke_method: payload.invokeMethod,
      invoke_url: payload.invokeUrl,
      http_method: payload.httpMethod,
      auth_type: payload.authType,
      timeout_ms: payload.timeoutMs,
      retry_policy: payload.retryPolicy ? JSON.stringify(payload.retryPolicy) : undefined,
      execution_adapter: payload.executionAdapter,
      managed_by_system: mapBoolean(payload.managedBySystem),
      enabled: mapBoolean(payload.enabled),
      updated_by: payload.updatedBy ?? existing.updatedBy ?? null,
      updated_at: new Date()
    };

    Object.entries(updateMapping).forEach(([column, value]) => {
      if (value !== undefined) {
        fields.push(`${column} = ?`);
        args.push(value);
      }
    });

    if (fields.length === 0) {
      return existing;
    }

    await pool.execute<ResultSetHeader>(
      `UPDATE llm_function_definitions
       SET ${fields.join(', ')}
       WHERE id = ?`,
      [...args, id]
    );

    return this.findById(id);
  },

  async setFunctionEnabled(id: string, enabled: boolean, actor?: string): Promise<boolean> {
    const [result] = await pool.execute<ResultSetHeader>(
      `UPDATE llm_function_definitions
       SET enabled = ?, updated_by = ?, updated_at = ?
       WHERE id = ?`,
      [enabled ? 1 : 0, actor ?? null, new Date(), id]
    );

    return result.affectedRows > 0;
  }
});

export type FunctionRepositoryType = ReturnType<typeof FunctionRepository>;
