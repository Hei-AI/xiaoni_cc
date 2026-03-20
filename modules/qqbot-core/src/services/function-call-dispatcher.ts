/**
 * 函数调用分发器
 * 处理 Gemini 的函数调用,分发到静态工具或动态工具
 */

import { logger } from '../utils/logger';
import { ToolRegistryService } from './tool-registry-service';
import {
  StaticTool,
  ToolContext,
  ToolResult,
  GeminiFunctionCall,
  GeminiFunctionResponse,
  ToolExecutionMode,
  LLMTool,
  AgentLoopOutcome
} from '../types';

const moduleLogger = logger.createModuleLogger('function-dispatcher');

export interface DispatchResult {
  kind: 'continue' | 'complete' | 'fail';
  functionResponse?: GeminiFunctionResponse;
  searchedTools?: any[];
  outcome?: AgentLoopOutcome;
  error?: string;
}

export class FunctionCallDispatcher {
  private staticTools: Map<string, StaticTool>;
  private toolRegistry: ToolRegistryService;

  constructor(toolRegistry: ToolRegistryService) {
    this.staticTools = new Map();
    this.toolRegistry = toolRegistry;
    moduleLogger.info('[FunctionCallDispatcher] Initialized');
  }

  /**
   * 注册静态工具
   */
  async registerStaticTool(tool: StaticTool): Promise<void> {
    this.staticTools.set(tool.name, tool);
    moduleLogger.info(`[FunctionCallDispatcher] Registered static tool: ${tool.name}`);

    try {
      await this.toolRegistry.upsertTool(this.buildRegistryPayload(tool));
    } catch (error: any) {
      moduleLogger.error('[FunctionCallDispatcher] Failed to sync static tool with local registry', {
        tool: tool.name,
        error: error?.message || error
      });
    }
  }

  /**
   * 注册多个静态工具
   */
  async registerStaticTools(tools: StaticTool[]): Promise<void> {
    for (const tool of tools) {
      await this.registerStaticTool(tool);
    }
  }

  /**
   * 分发函数调用
   */
  async dispatch(
    functionCall: GeminiFunctionCall,
    context: {
      traceId: string;
      jobId?: string;
      userId?: number;
      groupId?: number;
      sourceKey: string;
      metadata?: Record<string, any>;
    }
  ): Promise<DispatchResult> {
    const { name, args } = functionCall;

    moduleLogger.info(`[FunctionCallDispatcher] Dispatching function: ${name}`, { args });

    try {
      // 1. 检查是否是 search_tools
      if (name === 'search_tools') {
        return await this.handleSearchTools(args, context);
      }

      // 2. 检查是否是通用 invoke
      if (name === 'invoke') {
        return await this.handleInvoke(args, context);
      }

      // 3. 检查静态工具
      const staticTool = this.staticTools.get(name);
      if (staticTool) {
        return await this.handleStaticTool(staticTool, args, context);
      }

      // 4. 工具未找到
      return {
        kind: 'continue',
        functionResponse: {
          name,
          response: {
            name,
            content: { error: `Tool not found: ${name}` }
          }
        },
        error: `Tool not found: ${name}`
      };
    } catch (error: any) {
      moduleLogger.error(`[FunctionCallDispatcher] Dispatch error for ${name}:`, { error });

      return {
        kind: 'fail',
        error: error.message || 'Function dispatch failed'
      };
    }
  }

  /**
   * 处理 search_tools 调用
   */
  private async handleSearchTools(
    args: any,
    context: { traceId: string; jobId?: string }
  ): Promise<DispatchResult> {
    const { query, tags, side_effect, max_results } = args;

    moduleLogger.info('[FunctionCallDispatcher] Searching tools:', {
      query,
      tags,
      side_effect,
      max_results,
      traceId: context.traceId,
      jobId: context.jobId
    });

    const searchResult = await this.toolRegistry.search({
      query,
      tags,
      side_effect,
      max_results: max_results || 5
    });

    const tools = searchResult.tools;

    // 返回工具列表作为函数响应
    return {
      kind: 'continue',
      functionResponse: {
        name: 'search_tools',
        response: {
          name: 'search_tools',
          content: {
            tools,
            total: searchResult.total,
            message: `Found ${searchResult.total} tools matching your query.`
          }
        }
      },
      searchedTools: tools
    };
  }

  /**
   * 处理 invoke 调用
   */
  private async handleInvoke(
    args: any,
    context: {
      traceId: string;
      jobId?: string;
      userId?: number;
      groupId?: number;
      sourceKey: string;
    }
  ): Promise<DispatchResult> {
    const { method_id, arguments: toolArgs, expect_response = true } = args;

    moduleLogger.info('[FunctionCallDispatcher] Invoking dynamic tool:', {
      method_id,
      expect_response
    });

    const result = await this.toolRegistry.invoke(
      method_id,
      toolArgs,
      context.traceId,
      context.jobId
    );

    // 根据 expect_response 决定是否继续
    if (expect_response) {
      // 返回结果给LLM
      return {
        kind: 'continue',
        functionResponse: {
          name: 'invoke',
          response: {
            name: 'invoke',
            content: result.success
              ? result.data
              : { error: result.error }
          }
        }
      };
    }

    if (!result.success) {
      return {
        kind: 'continue',
        functionResponse: {
          name: 'invoke',
          response: {
            name: 'invoke',
            content: { error: result.error || 'Tool execution failed' }
          }
        },
        error: result.error
      };
    }

    return {
      kind: 'complete',
      outcome: {
        kind: 'side_effect_only',
        toolName: 'invoke',
        summary: typeof args?.message === 'string' && args.message.trim().length > 0
          ? args.message.trim()
          : `Dynamic tool ${method_id} executed without return payload`
      }
    };
  }

  /**
   * 处理静态工具调用
   */
  private async handleStaticTool(
    tool: StaticTool,
    args: any,
    context: {
      traceId: string;
          jobId?: string;
          userId?: number;
          groupId?: number;
          sourceKey: string;
          metadata?: Record<string, any>;
        }
  ): Promise<DispatchResult> {
    moduleLogger.info(`[FunctionCallDispatcher] Executing static tool: ${tool.name}`);

    const toolContext: ToolContext = {
      trace_id: context.traceId,
      job_id: context.jobId,
      user_id: context.userId,
      group_id: context.groupId,
      source_key: context.sourceKey,
      arguments: args,
      metadata: context.metadata
    };

    const result: ToolResult = await tool.handler(toolContext);

    // 记录执行日志
    await this.logStaticToolExecution(tool.name, tool.mode, toolContext, result);

    if (!result.success) {
      return {
        kind: 'continue',
        functionResponse: {
          name: tool.name,
          response: {
            name: tool.name,
            content: { error: result.error || 'Tool execution failed' }
          }
        },
        error: result.error || 'Tool execution failed'
      };
    }

    // 根据模式决定返回值
    if (tool.mode === 'returnable' || tool.loopBehavior?.completion === 'continue') {
      return {
        kind: 'continue',
        functionResponse: {
          name: tool.name,
          response: {
            name: tool.name,
            content: result.data ?? { status: 'ok' }
          }
        }
      };
    }

    return {
      kind: 'complete',
      outcome: this.buildTerminalOutcome(tool, result)
    };
  }

  /**
   * 记录静态工具执行日志
   */
  private async logStaticToolExecution(
    toolName: string,
    executionMode: ToolExecutionMode,
    context: ToolContext,
    result: ToolResult
  ): Promise<void> {
    let connection: any;
    try {
      // 通过 toolRegistry 的数据库连接记录
      connection = await (this.toolRegistry as any).database.pool.getConnection();

      await connection.query(
        `INSERT INTO tool_execution_logs (
          trace_id, job_id, tool_type, tool_name,
          arguments, result, status, error_message, duration_ms,
          execution_mode, side_effect, started_at, completed_at
        ) VALUES (?, ?, 'static', ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [
          context.trace_id,
          context.job_id || null,
          toolName,
          JSON.stringify(context.arguments),
          result.data ? JSON.stringify(result.data) : null,
          result.success ? 'success' : 'failed',
          result.error || null,
          result.duration_ms || null,
          executionMode,
          false
        ]
      );
    } catch (error) {
      moduleLogger.error('[FunctionCallDispatcher] Log static tool error:', { error });
    } finally {
      if (connection) {
        try {
          connection.release();
        } catch (releaseError) {
          moduleLogger.error('[FunctionCallDispatcher] Failed to release connection after logging static tool', {
            releaseError: releaseError instanceof Error
              ? { message: releaseError.message, stack: releaseError.stack }
              : releaseError
          });
        }
      }
    }
  }

  private buildStaticDeclaration(tool: StaticTool): { name: string; description: string; parameters?: any } {
    return {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    };
  }

  /**
   * 获取所有静态工具声明 (用于 Gemini payload)
   */
  getStaticToolDeclarations(): any[] {
    const declarations: any[] = [];

    this.staticTools.forEach((tool) => {
      declarations.push(this.buildStaticDeclaration(tool));
    });

    return declarations;
  }

  /**
   * 按名称获取单个静态工具声明
   */
  getStaticToolDeclaration(name: string): { name: string; description: string; parameters?: any } | undefined {
    const tool = this.staticTools.get(name);
    if (!tool) {
      return undefined;
    }
    return this.buildStaticDeclaration(tool);
  }

  private buildRegistryPayload(tool: StaticTool): Omit<LLMTool, 'id' | 'created_at' | 'updated_at'> {
    const metadata = tool.registryMetadata || {};
    const expectResponse = metadata.expectResponse ?? (tool.mode !== 'fire-and-forget');

    return {
      method_id: tool.name,
      name: metadata.displayName || tool.description || tool.name,
      description: tool.description,
      params_schema: tool.parameters,
      category: metadata.category,
      tags: metadata.tags,
      side_effect: metadata.sideEffect ?? false,
      expect_response: expectResponse,
      timeout_ms: metadata.timeoutMs ?? 10000,
      enabled: metadata.enabled ?? true,
      required_permission: metadata.requiredPermission,
      version: metadata.version || '1.0.0',
      created_by: metadata.createdBy || 'system',
      updated_by: metadata.updatedBy || metadata.createdBy || 'system',
      total_calls: 0,
      success_calls: 0,
      failed_calls: 0
    };
  }

  /**
   * 获取 search_tools 声明
   */
  getSearchToolsDeclaration(): any {
    return {
      name: 'search_tools',
      description: '当你想完成某个任务但不确定有哪些工具可用时,使用此函数搜索工具。返回匹配的工具列表及其参数定义。',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '描述你想完成的任务或需要的功能'
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: '可选的标签过滤 (例如: ["user", "admin", "system"])'
          },
          side_effect: {
            type: 'boolean',
            description: '是否需要有副作用的工具 (true=修改数据, false=仅读取)'
          },
          max_results: {
            type: 'integer',
            description: '最多返回多少个工具 (默认5个)',
            default: 5
          }
        },
        required: ['query', 'side_effect']
      }
    };
  }

  /**
   * 获取通用 invoke 声明 (动态生成,基于搜索结果)
   */
  getInvokeDeclaration(searchedTools: any[]): any {
    // 将搜索到的工具参数合并到 invoke 的描述中
    const toolDescriptions = searchedTools
      .map(t => `- ${t.method_id}: ${t.description}`)
      .join('\n');

    return {
      name: 'invoke',
      description: `执行动态工具。可用工具:\n${toolDescriptions}`,
      parameters: {
        type: 'object',
        properties: {
          method_id: {
            type: 'string',
            description: '要调用的工具ID',
            enum: searchedTools.map(t => t.method_id)
          },
          arguments: {
            type: 'object',
            description: '工具参数 (根据工具的params_schema传入)'
          },
          expect_response: {
            type: 'boolean',
            description: '是否期望工具返回结果 (默认true)',
            default: true
          }
        },
        required: ['method_id', 'arguments']
      }
    };
  }

  private buildTerminalOutcome(tool: StaticTool, result: ToolResult): AgentLoopOutcome {
    const configuredKind = tool.loopBehavior?.outcomeKind || 'side_effect_only';
    const data = result.data && typeof result.data === 'object' ? result.data : {};

    if (configuredKind === 'ended_no_reply') {
      return {
        kind: 'ended_no_reply',
        toolName: tool.name,
        summary: typeof (data as any).reason === 'string'
          ? (data as any).reason
          : 'Conversation ended without reply',
        suppressed: Boolean((data as any).status === 'suppressed')
      };
    }

    if (configuredKind === 'message_sent') {
      if ((data as any).status === 'suppressed') {
        return {
          kind: 'ended_no_reply',
          toolName: tool.name,
          summary: typeof (data as any).reason === 'string'
            ? (data as any).reason
            : 'Auto reply disabled',
          message: typeof (data as any).message === 'string' ? (data as any).message : undefined,
          suppressed: true
        };
      }

      return {
        kind: 'message_sent',
        toolName: tool.name,
        message: typeof (data as any).message === 'string' ? (data as any).message : undefined,
        summary: this.buildOutcomeSummary(tool.name, data)
      };
    }

    return {
      kind: 'side_effect_only',
      toolName: tool.name,
      summary: this.buildOutcomeSummary(tool.name, data)
    };
  }

  private buildOutcomeSummary(toolName: string, data: Record<string, any>): string {
    if (toolName === 'send_private_chat_message' || toolName === 'send_qq_group_message') {
      if (typeof data.message === 'string' && data.message.trim().length > 0) {
        return data.message.trim();
      }
    }

    if (toolName === 'send_meme_image') {
      const tags = Array.isArray(data.tags) ? data.tags.join(',') : '';
      return data.meme_id ? `sent meme ${data.meme_id}${tags ? ` (${tags})` : ''}` : 'sent meme image';
    }

    if (toolName === 'save_meme_image') {
      const tags = Array.isArray(data.tags) ? data.tags.join(',') : '';
      return data.meme_id ? `stored meme ${data.meme_id}${tags ? ` (${tags})` : ''}` : 'stored meme image';
    }

    if (typeof data.message === 'string' && data.message.trim().length > 0) {
      return data.message.trim();
    }

    if (typeof data.status === 'string' && data.status.trim().length > 0) {
      return `${toolName}:${data.status.trim()}`;
    }

    return toolName;
  }
}
