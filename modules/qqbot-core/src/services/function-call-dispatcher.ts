/**
 * 函数调用分发器
 * 处理 Gemini 的函数调用,分发到静态工具或动态工具
 */

import { logger } from '../utils/logger';
import { ToolRegistryService } from './tool-registry-service';
import {
  FunctionRegistryClient,
  FunctionInvokeResult,
  RegistryFunctionUpsertPayload
} from './function-registry-client';
import {
  StaticTool,
  ToolContext,
  ToolResult,
  GeminiFunctionCall,
  GeminiFunctionResponse,
  ToolExecutionMode,
  LLMTool
} from '../types';

const moduleLogger = logger.createModuleLogger('function-dispatcher');

export interface DispatchResult {
  // 是否需要继续LLM调用
  shouldContinue: boolean;

  // 函数响应 (返回给LLM)
  functionResponse?: GeminiFunctionResponse;

  // 最终文本响应 (fire-and-forget或完成)
  finalResponse?: string;

  // 是否需要抑制发送最终回复 (例如工具已直接向用户发消息)
  suppressAutoReply?: boolean;

  // 搜索到的工具 (search_tools结果)
  searchedTools?: any[];

  // 是否已完成
  isCompleted: boolean;

  // 错误信息
  error?: string;
}

export class FunctionCallDispatcher {
  private staticTools: Map<string, StaticTool>;
  private toolRegistry: ToolRegistryService;
  private functionRegistryClient?: FunctionRegistryClient;

  constructor(toolRegistry: ToolRegistryService, functionRegistryClient?: FunctionRegistryClient) {
    this.staticTools = new Map();
    this.toolRegistry = toolRegistry;
    this.functionRegistryClient = functionRegistryClient;
    moduleLogger.info('[FunctionCallDispatcher] Initialized');
  }

  /**
   * 注册静态工具
   */
  async registerStaticTool(tool: StaticTool): Promise<void> {
    this.staticTools.set(tool.name, tool);
    moduleLogger.info(`[FunctionCallDispatcher] Registered static tool: ${tool.name}`);

    try {
      await this.syncStaticToolWithRegistry(tool);
    } catch (error: any) {
      moduleLogger.error('[FunctionCallDispatcher] Failed to sync static tool with registry', {
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

      // 4. 检查函数注册中心
      const registryFunctionId = this.getRegistryFunctionId(name, context.metadata);
      if (registryFunctionId && this.functionRegistryClient?.isEnabled()) {
        return await this.handleRegistryFunction(registryFunctionId, name, args, context);
      }

      // 5. 工具未找到
      return {
        shouldContinue: true,
        functionResponse: {
          name,
          response: {
            name,
            content: { error: `Tool not found: ${name}` }
          }
        },
        isCompleted: false,
        error: `Tool not found: ${name}`
      };
    } catch (error: any) {
      moduleLogger.error(`[FunctionCallDispatcher] Dispatch error for ${name}:`, { error });

      return {
        shouldContinue: false,
        isCompleted: false,
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
      shouldContinue: true,
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
      searchedTools: tools,
      isCompleted: false
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
        shouldContinue: true,
        functionResponse: {
          name: 'invoke',
          response: {
            name: 'invoke',
            content: result.success
              ? result.data
              : { error: result.error }
          }
        },
        isCompleted: false
      };
    } else {
      // Fire-and-forget模式,直接完成
      return {
        shouldContinue: false,
        finalResponse: result.success
          ? (typeof args?.message === 'string' ? args.message : '')
          : (result.error || 'Tool execution failed'),
        suppressAutoReply: true,
        isCompleted: true,
        error: result.success ? undefined : result.error
      };
    }
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

    // 根据模式决定返回值
    if (tool.mode === 'returnable') {
      return {
        shouldContinue: true,
        functionResponse: {
          name: tool.name,
          response: {
            name: tool.name,
            content: result.success ? result.data : { error: result.error }
          }
        },
        isCompleted: false
      };
    } else {
      // Fire-and-forget模式
      return {
        shouldContinue: false,
        finalResponse: result.success
          ? (result.data && typeof result.data.message === 'string'
              ? result.data.message
              : '')
          : (result.error || 'Tool execution failed'),
        suppressAutoReply: true,
        isCompleted: true,
        error: result.success ? undefined : result.error
      };
    }
  }

  private getRegistryFunctionId(
    functionName: string,
    metadata?: Record<string, any>
  ): string | undefined {
    if (!metadata) {
      return undefined;
    }

    const mapping = metadata.functionNameToId || metadata.function_name_to_id;
    if (mapping && typeof mapping === 'object') {
      const match = mapping[functionName];
      return typeof match === 'string' ? match : undefined;
    }

    return undefined;
  }

  private async handleRegistryFunction(
    functionId: string,
    functionName: string,
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
    if (!this.functionRegistryClient) {
      return {
        shouldContinue: true,
        functionResponse: {
          name: functionName,
          response: {
            name: functionName,
            content: { error: 'Function registry client not configured' }
          }
        },
        isCompleted: false,
        error: 'Function registry client not configured'
      };
    }

    try {
      const invocationContext: Record<string, any> = {
        sourceKey: context.sourceKey,
        userId: context.userId,
        groupId: context.groupId,
        promptId: context.metadata?.promptId,
        conversationId: context.metadata?.conversationId,
        messageId: context.metadata?.messageId,
        sessionId: context.metadata?.sessionId
      };

      const result = await this.functionRegistryClient.invokeFunction(functionId, {
        traceId: context.traceId,
        jobId: context.jobId,
        arguments: args || {},
        context: invocationContext,
        requestMode: context.metadata?.functionCallingMode
      }) as FunctionInvokeResult;

      const responseContent = result?.success
        ? (result.data ?? { status: 'success' })
        : { error: result?.error || 'Function execution failed' };

      return {
        shouldContinue: true,
        functionResponse: {
          name: functionName,
          response: {
            name: functionName,
            content: responseContent
          }
        },
        suppressAutoReply: result?.suppressAutoReply,
        isCompleted: false,
        error: result?.success ? undefined : result?.error
      };
    } catch (error: any) {
      moduleLogger.error('[FunctionCallDispatcher] Registry function invocation failed', {
        functionId,
        functionName,
        error: error?.message
      });

      return {
        shouldContinue: true,
        functionResponse: {
          name: functionName,
          response: {
            name: functionName,
            content: { error: error?.message || 'Function execution failed' }
          }
        },
        isCompleted: false,
        error: error?.message || 'Function execution failed'
      };
    }
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

  /**
   * 获取所有静态工具声明 (用于 Gemini payload)
   */
  getStaticToolDeclarations(): any[] {
    const declarations: any[] = [];

    this.staticTools.forEach((tool) => {
      declarations.push({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      });
    });

    return declarations;
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

  private buildFunctionDefinitionPayload(tool: StaticTool): RegistryFunctionUpsertPayload {
    const metadata = tool.registryMetadata || {};
    const expectResponse = metadata.expectResponse ?? (tool.mode !== 'fire-and-forget');
    const timeoutMs = metadata.timeoutMs ?? 10000;
    const createdBy = metadata.createdBy || 'system';

    return {
      name: tool.name,
      displayName: metadata.displayName || tool.description || tool.name,
      description: tool.description,
      parametersSchema: tool.parameters,
      sideEffect: metadata.sideEffect ?? false,
      expectResponse,
      category: metadata.category,
      tags: metadata.tags,
      invokeMethod: 'INTERNAL',
      invokeUrl: undefined,
      httpMethod: undefined,
      authType: 'NONE',
      timeoutMs,
      retryPolicy: undefined,
      executionAdapter: undefined,
      managedBySystem: true,
      enabled: metadata.enabled ?? true,
      createdBy,
      updatedBy: metadata.updatedBy
    };
  }

  private async syncStaticToolWithRegistry(tool: StaticTool): Promise<void> {
    const payload = this.buildRegistryPayload(tool);
    await this.toolRegistry.upsertTool(payload);

    if (this.functionRegistryClient?.isEnabled()) {
      try {
        const functionPayload = this.buildFunctionDefinitionPayload(tool);
        await this.functionRegistryClient.upsertFunctionDefinition(functionPayload);
      } catch (error: any) {
        moduleLogger.error(
          '[FunctionCallDispatcher] Failed to sync function definition to registry',
          {
            tool: tool.name,
            error: error?.message || error
          }
        );
      }
    }
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
}
