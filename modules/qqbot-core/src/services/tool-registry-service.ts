/**
 * 工具注册服务
 * 负责动态工具的注册、搜索和调用
 */

import { DatabaseManager } from './database';
import { logger } from '../utils/logger';
import {
  LLMTool,
  ToolSearchParams,
  ToolSearchResult,
  ToolContext,
  ToolResult
} from '../types';

const moduleLogger = logger.createModuleLogger('tool-registry');

const formatError = (error: unknown) => {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack
    };
  }
  return error;
};

export class ToolRegistryService {
  private database: DatabaseManager;
  private toolExecutors: Map<string, (ctx: ToolContext) => Promise<ToolResult>>;

  constructor(database: DatabaseManager) {
    this.database = database;
    this.toolExecutors = new Map();
    moduleLogger.info('[ToolRegistryService] Initialized');
  }

  /**
   * 注册工具执行器
   */
  registerExecutor(
    methodId: string,
    executor: (ctx: ToolContext) => Promise<ToolResult>
  ): void {
    this.toolExecutors.set(methodId, executor);
    moduleLogger.info(`[ToolRegistryService] Registered executor: ${methodId}`);
  }

  /**
   * 搜索工具
   */
  async search(params: ToolSearchParams): Promise<ToolSearchResult> {
    const {
      query,
      tags = [],
      side_effect,
      max_results = 5,
      category
    } = params;

    let connection: any;
    try {
      connection = await (this.database as any).pool.getConnection();

      // 构建查询条件
      let sql = `
        SELECT
          method_id, name, description, params_schema,
          side_effect, expect_response, category, tags
        FROM llm_tools
        WHERE enabled = true
      `;
      const queryParams: any[] = [];

      // 模糊搜索描述
      if (query) {
        sql += ` AND (description LIKE ? OR name LIKE ?)`;
        queryParams.push(`%${query}%`, `%${query}%`);
      }

      // 分类过滤
      if (category) {
        sql += ` AND category = ?`;
        queryParams.push(category);
      }

      // 副作用过滤
      if (side_effect !== undefined) {
        sql += ` AND side_effect = ?`;
        queryParams.push(side_effect);
      }

      // 标签过滤 (JSON包含查询)
      if (tags.length > 0) {
        const tagConditions = tags.map(() => `JSON_CONTAINS(tags, ?)` ).join(' OR ');
        sql += ` AND (${tagConditions})`;
        tags.forEach(tag => queryParams.push(JSON.stringify(tag)));
      }

      // 限制结果数量
      sql += ` ORDER BY total_calls DESC, success_calls DESC LIMIT ?`;
      queryParams.push(max_results);

      const [rows] = await connection.query(sql, queryParams);
      const tools = (rows as any[]).map(row => ({
        method_id: row.method_id,
        name: row.name,
        description: row.description,
        params_schema: typeof row.params_schema === 'string'
          ? JSON.parse(row.params_schema)
          : row.params_schema,
        side_effect: row.side_effect,
        expect_response: row.expect_response
      }));

      moduleLogger.info(`[ToolRegistryService] Found ${tools.length} tools for query: ${query}`);

      return {
        tools,
        total: tools.length
      };
    } catch (error) {
      moduleLogger.error('[ToolRegistryService] Search error:', { error });
      throw error;
    } finally {
      if (connection) {
        try {
          connection.release();
        } catch (releaseError) {
          moduleLogger.error('[ToolRegistryService] Failed to release connection after search', {
            releaseError: formatError(releaseError)
          });
        }
      }
    }
  }

  /**
   * 调用动态工具
   */
  async invoke(
    methodId: string,
    args: any,
    traceId: string,
    jobId?: string
  ): Promise<ToolResult> {
    const startTime = Date.now();

    try {
      // 获取工具定义
      const tool = await this.getTool(methodId);
      if (!tool) {
        return {
          success: false,
          error: `Tool not found: ${methodId}`
        };
      }

      if (!tool.enabled) {
        return {
          success: false,
          error: `Tool is disabled: ${methodId}`
        };
      }

      // 获取执行器
      const executor = this.toolExecutors.get(methodId);
      if (!executor) {
        return {
          success: false,
          error: `No executor registered for tool: ${methodId}`
        };
      }

      // 构建上下文
      const context: ToolContext = {
        trace_id: traceId,
        job_id: jobId,
        source_key: '', // TODO: 从 job 获取
        arguments: args
      };

      // 执行工具 (带超时)
      const result = await this.executeWithTimeout(
        executor(context),
        tool.timeout_ms
      );

      const duration = Date.now() - startTime;

      // 更新统计信息
      await this.updateToolStats(methodId, true, duration);

      // 记录执行日志
      await this.logExecution({
        trace_id: traceId,
        job_id: jobId,
        tool_type: 'dynamic',
        tool_name: tool.name,
        method_id: methodId,
        arguments: args,
        result: result.data,
        status: result.success ? 'success' : 'failed',
        error_message: result.error,
        duration_ms: duration,
        execution_mode: tool.expect_response ? 'returnable' : 'fire-and-forget',
        side_effect: tool.side_effect,
        started_at: new Date(startTime),
        completed_at: new Date()
      });

      return {
        ...result,
        duration_ms: duration
      };
    } catch (error: any) {
      const duration = Date.now() - startTime;

      // 更新失败统计
      await this.updateToolStats(methodId, false, duration);

      moduleLogger.error(`[ToolRegistryService] Invoke error for ${methodId}:`, { error });

      return {
        success: false,
        error: error.message || 'Tool execution failed',
        duration_ms: duration
      };
    }
  }

  /**
   * 获取工具定义
   */
  private async getTool(methodId: string): Promise<LLMTool | null> {
    let connection: any;
    try {
      connection = await (this.database as any).pool.getConnection();
      const [rows] = await connection.query(
        'SELECT * FROM llm_tools WHERE method_id = ? LIMIT 1',
        [methodId]
      );

      const tools = rows as any[];
      if (tools.length === 0) {
        return null;
      }

      const row = tools[0];
      return {
        id: row.id,
        method_id: row.method_id,
        name: row.name,
        description: row.description,
        params_schema: typeof row.params_schema === 'string'
          ? JSON.parse(row.params_schema)
          : row.params_schema,
        category: row.category,
        tags: typeof row.tags === 'string' ? JSON.parse(row.tags) : row.tags,
        side_effect: row.side_effect,
        expect_response: row.expect_response,
        timeout_ms: row.timeout_ms,
        enabled: row.enabled,
        required_permission: row.required_permission,
        version: row.version,
        created_by: row.created_by,
        updated_by: row.updated_by,
        total_calls: row.total_calls,
        success_calls: row.success_calls,
        failed_calls: row.failed_calls,
        avg_duration_ms: row.avg_duration_ms,
        created_at: row.created_at,
        updated_at: row.updated_at
      };
    } catch (error) {
      moduleLogger.error('[ToolRegistryService] Get tool error:', { error });
      return null;
    } finally {
      if (connection) {
        try {
          connection.release();
        } catch (releaseError) {
          moduleLogger.error('[ToolRegistryService] Failed to release connection after getTool', {
            releaseError: formatError(releaseError),
            methodId
          });
        }
      }
    }
  }

  /**
   * 执行工具 (带超时)
   */
  private async executeWithTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error('Tool execution timeout')), timeoutMs)
      )
    ]);
  }

  /**
   * 更新工具统计信息
   */
  private async updateToolStats(
    methodId: string,
    success: boolean,
    durationMs: number
  ): Promise<void> {
    let connection: any;
    try {
      connection = await (this.database as any).pool.getConnection();

      if (success) {
        await connection.query(
          `UPDATE llm_tools
           SET total_calls = total_calls + 1,
               success_calls = success_calls + 1,
               avg_duration_ms = (COALESCE(avg_duration_ms, 0) * success_calls + ?) / (success_calls + 1),
               updated_at = NOW()
           WHERE method_id = ?`,
          [durationMs, methodId]
        );
      } else {
        await connection.query(
          `UPDATE llm_tools
           SET total_calls = total_calls + 1,
               failed_calls = failed_calls + 1,
               updated_at = NOW()
           WHERE method_id = ?`,
          [methodId]
        );
      }
    } catch (error) {
      moduleLogger.error('[ToolRegistryService] Update stats error:', { error });
    } finally {
      if (connection) {
        try {
          connection.release();
        } catch (releaseError) {
          moduleLogger.error('[ToolRegistryService] Failed to release connection after updateToolStats', {
            releaseError: formatError(releaseError),
            methodId
          });
        }
      }
    }
  }

  /**
   * 记录工具执行日志
   */
  private async logExecution(log: Omit<any, 'id'>): Promise<void> {
    let connection: any;
    try {
      connection = await (this.database as any).pool.getConnection();
      await connection.query(
        `INSERT INTO tool_execution_logs (
          trace_id, job_id, tool_type, tool_name, method_id,
          arguments, result, status, error_message, duration_ms,
          execution_mode, side_effect, started_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          log.trace_id,
          log.job_id || null,
          log.tool_type,
          log.tool_name,
          log.method_id || null,
          JSON.stringify(log.arguments),
          log.result ? JSON.stringify(log.result) : null,
          log.status,
          log.error_message || null,
          log.duration_ms || null,
          log.execution_mode,
          log.side_effect,
          log.started_at,
          log.completed_at || null
        ]
      );
    } catch (error) {
      moduleLogger.error('[ToolRegistryService] Log execution error:', { error });
    } finally {
      if (connection) {
        try {
          connection.release();
        } catch (releaseError) {
          moduleLogger.error('[ToolRegistryService] Failed to release connection after logExecution', {
            releaseError: formatError(releaseError),
            traceId: log.trace_id,
            methodId: log.method_id
          });
        }
      }
    }
  }

  /**
   * 创建或更新工具
   */
  async upsertTool(tool: Omit<LLMTool, 'id' | 'created_at' | 'updated_at'>): Promise<number> {
    let connection: any;
    try {
      connection = await (this.database as any).pool.getConnection();

      const [result] = await connection.query(
        `INSERT INTO llm_tools (
          method_id, name, description, params_schema, category, tags,
          side_effect, expect_response, timeout_ms, enabled, required_permission,
          version, created_by, updated_by, total_calls, success_calls, failed_calls
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0)
        ON DUPLICATE KEY UPDATE
          name = VALUES(name),
          description = VALUES(description),
          params_schema = VALUES(params_schema),
          category = VALUES(category),
          tags = VALUES(tags),
          side_effect = VALUES(side_effect),
          expect_response = VALUES(expect_response),
          timeout_ms = VALUES(timeout_ms),
          enabled = VALUES(enabled),
          required_permission = VALUES(required_permission),
          version = VALUES(version),
          updated_by = VALUES(updated_by),
          updated_at = NOW()`,
        [
          tool.method_id,
          tool.name,
          tool.description,
          JSON.stringify(tool.params_schema),
          tool.category || null,
          tool.tags ? JSON.stringify(tool.tags) : null,
          tool.side_effect,
          tool.expect_response,
          tool.timeout_ms,
          tool.enabled,
          tool.required_permission || null,
          tool.version,
          tool.created_by || null,
          tool.updated_by || null
        ]
      );

      const insertId = (result as any).insertId;
      moduleLogger.info(`[ToolRegistryService] Upserted tool: ${tool.method_id} (id: ${insertId})`);
      return insertId;
    } catch (error) {
      moduleLogger.error('[ToolRegistryService] Upsert tool error:', { error });
      throw error;
    } finally {
      if (connection) {
        try {
          connection.release();
        } catch (releaseError) {
          moduleLogger.error('[ToolRegistryService] Failed to release connection after upsertTool', {
            releaseError: formatError(releaseError),
            methodId: tool.method_id
          });
        }
      }
    }
  }

  /**
   * 获取所有启用的工具
   */
  async getEnabledTools(): Promise<LLMTool[]> {
    let connection: any;
    try {
      connection = await (this.database as any).pool.getConnection();
      const [rows] = await connection.query(
        'SELECT * FROM llm_tools WHERE enabled = true ORDER BY total_calls DESC'
      );

      return (rows as any[]).map(row => ({
        id: row.id,
        method_id: row.method_id,
        name: row.name,
        description: row.description,
        params_schema: typeof row.params_schema === 'string'
          ? JSON.parse(row.params_schema)
          : row.params_schema,
        category: row.category,
        tags: typeof row.tags === 'string' ? JSON.parse(row.tags) : row.tags,
        side_effect: row.side_effect,
        expect_response: row.expect_response,
        timeout_ms: row.timeout_ms,
        enabled: row.enabled,
        required_permission: row.required_permission,
        version: row.version,
        created_by: row.created_by,
        updated_by: row.updated_by,
        total_calls: row.total_calls,
        success_calls: row.success_calls,
        failed_calls: row.failed_calls,
        avg_duration_ms: row.avg_duration_ms,
        created_at: row.created_at,
        updated_at: row.updated_at
      }));
    } catch (error) {
      moduleLogger.error('[ToolRegistryService] Get enabled tools error:', { error });
      return [];
    } finally {
      if (connection) {
        try {
          connection.release();
        } catch (releaseError) {
          moduleLogger.error('[ToolRegistryService] Failed to release connection after getEnabledTools', {
            releaseError: formatError(releaseError)
          });
        }
      }
    }
  }
}
