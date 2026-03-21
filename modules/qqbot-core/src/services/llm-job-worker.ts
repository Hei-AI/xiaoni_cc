/**
 * LLM 任务处理器
 * 异步处理 LLM 调用和工具执行
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseManager } from './database';
import { FunctionCallDispatcher } from './function-call-dispatcher';
import { AIService } from './ai-service';
import { logger } from '../utils/logger';
import {
  LLMJob,
  LLMJobStatus,
  GeminiFunctionCall,
  FunctionCallingMode,
  AgentLoopOutcome
} from '../types';

const moduleLogger = logger.createModuleLogger('llm-job-worker');

const serializeError = (error: unknown) => {
  if (error instanceof Error) {
    const serialized: Record<string, any> = { message: error.message };

    if (error.stack) {
      serialized.stack = error.stack;
    }

    const errorWithMeta = error as Record<string, any>;
    if (errorWithMeta.code) {
      serialized.code = errorWithMeta.code;
    }
    if (errorWithMeta.errno) {
      serialized.errno = errorWithMeta.errno;
    }
    if (errorWithMeta.sqlState || errorWithMeta.sqlstate) {
      serialized.sqlState = errorWithMeta.sqlState ?? errorWithMeta.sqlstate;
    }

    return serialized;
  }

  return error;
};

const releaseConnectionSafely = (connection: any, context: string) => {
  if (!connection) {
    return;
  }

  try {
    connection.release();
  } catch (error) {
    moduleLogger.error('Failed to release database connection', {
      context,
      error: serializeError(error)
    });
  }
};

const normalizeFunctionCallingMode = (mode: unknown): FunctionCallingMode => {
  if (typeof mode !== 'string') {
    return 'ANY';
  }

  const upper = mode.toUpperCase();
  if (upper === 'AUTO' || upper === 'NONE' || upper === 'ANY') {
    return upper as FunctionCallingMode;
  }

  return 'ANY';
};

const getErrorStatusCode = (error: any): number | undefined => {
  if (!error || typeof error !== 'object') {
    return undefined;
  }

  if (typeof error.status === 'number') {
    return error.status;
  }

  if (typeof error.statusCode === 'number') {
    return error.statusCode;
  }

  if (error.response && typeof error.response.status === 'number') {
    return error.response.status;
  }

  if (error.originalError) {
    return getErrorStatusCode(error.originalError);
  }

  return undefined;
};

const isPermanentAuthorizationError = (error: any): boolean => {
  const statusCode = getErrorStatusCode(error);
  if (statusCode === 401 || statusCode === 403) {
    return true;
  }

  const message = typeof error?.message === 'string' ? error.message.toLowerCase() : '';
  return (
    message.includes('permission_denied') ||
    message.includes('api key was reported as leaked') ||
    message.includes('please use another api key') ||
    message.includes('invalid api key')
  );
};

export interface LLMJobWorkerConfig {
  maxConcurrentJobs: number;
  pollIntervalMs: number;
  jobTimeoutMs: number;
  retryDelayMs: number;
}

export interface JobResult {
  success: boolean;
  outcome?: AgentLoopOutcome;
  finalResponse?: string;
  error?: string;
  metadata?: Record<string, any>;
}

export class LLMJobWorker extends EventEmitter {
  private database: DatabaseManager;
  private dispatcher: FunctionCallDispatcher;
  private aiService: AIService;
  private config: LLMJobWorkerConfig;

  private isRunning: boolean = false;
  private activeJobs: Set<string> = new Set();
  private pollTimer?: ReturnType<typeof setTimeout>;

  constructor(
    database: DatabaseManager,
    dispatcher: FunctionCallDispatcher,
    aiService: AIService,
    config?: Partial<LLMJobWorkerConfig>
  ) {
    super();
    this.database = database;
    this.dispatcher = dispatcher;
    this.aiService = aiService;

    // 默认配置
    this.config = {
      maxConcurrentJobs: 5,
      pollIntervalMs: 1000,
      jobTimeoutMs: 300000, // 5分钟
      retryDelayMs: 5000,
      ...config
    };

    moduleLogger.info('LLMJobWorker initialized', this.config);
  }

  /**
   * 启动任务处理器
   */
  start(): void {
    if (this.isRunning) {
      moduleLogger.warn('LLMJobWorker already running');
      return;
    }

    this.isRunning = true;
    moduleLogger.info('LLMJobWorker started');

    // 启动轮询
    this.pollTimer = setInterval(
      () => this.pollAndProcessJobs(),
      this.config.pollIntervalMs
    );

    this.emit('started');
  }

  /**
   * 停止任务处理器
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    // 停止轮询
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }

    // 等待活跃任务完成
    while (this.activeJobs.size > 0) {
      moduleLogger.info(`Waiting for ${this.activeJobs.size} active jobs to complete`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    moduleLogger.info('LLMJobWorker stopped');
    this.emit('stopped');
  }

  /**
   * 创建新任务
   */
  async createJob(params: {
    traceId: string;
    sourceKey: string;
    sourceType: 'private' | 'group';
    contents: any[];
    tools?: any[];
    config?: any;
    metadata?: Record<string, any>;
  }): Promise<string> {
    const jobId = uuidv4();

    let connection: any;
    try {
      connection = await (this.database as any).pool.getConnection();

      await connection.query(
        `INSERT INTO llm_jobs (
          id, trace_id, source_key, source_type, status,
          retry_count, max_retries, contents_json, tools_json, config_json,
          current_turn, max_turns, metadata, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'pending', 0, 3, ?, ?, ?, 1, 10, ?, NOW(), NOW())`,
        [
          jobId,
          params.traceId,
          params.sourceKey,
          params.sourceType,
          JSON.stringify(params.contents),
          params.tools ? JSON.stringify(params.tools) : null,
          params.config ? JSON.stringify(params.config) : null,
          params.metadata ? JSON.stringify(params.metadata) : null
        ]
      );

      releaseConnectionSafely(connection, 'createJob');
      connection = null;

      moduleLogger.info('Created LLM job', { jobId, traceId: params.traceId });
      this.emit('job_created', { jobId, traceId: params.traceId });

      return jobId;
    } catch (error) {
      moduleLogger.error('Failed to create job', {
        error: serializeError(error),
        jobId,
        traceId: params.traceId
      });
      throw error;
    } finally {
      releaseConnectionSafely(connection, 'createJob.finally');
    }
  }

  /**
   * 轮询并处理任务
   */
  private async pollAndProcessJobs(): Promise<void> {
    if (this.activeJobs.size >= this.config.maxConcurrentJobs) {
      return;
    }

    try {
      const jobs = await this.fetchPendingJobs(
        this.config.maxConcurrentJobs - this.activeJobs.size
      );

      for (const job of jobs) {
        if (this.activeJobs.size >= this.config.maxConcurrentJobs) {
          break;
        }

        // 异步处理任务,不阻塞轮询
        this.processJob(job).catch(error => {
          moduleLogger.error('Job processing error', { jobId: job.id, error });
        });
      }
    } catch (error) {
      moduleLogger.error('Poll error', { error });
    }
  }

  /**
   * 获取待处理任务
   */
  private async fetchPendingJobs(limit: number): Promise<LLMJob[]> {
    let connection: any;
    try {
      connection = await (this.database as any).pool.getConnection();

      const [idRows] = await connection.query(
        `SELECT id FROM llm_jobs FORCE INDEX (idx_status_retry_created)
         WHERE status = 'pending'
           AND (next_retry_at IS NULL OR next_retry_at <= NOW())
         ORDER BY created_at ASC
         LIMIT ?`,
        [limit]
      );

      const ids = (idRows as Array<{ id: string }>).map(row => row.id);
      if (ids.length === 0) {
        releaseConnectionSafely(connection, 'fetchPendingJobs.empty');
        connection = null;
        return [];
      }

      const placeholders = ids.map(() => '?').join(',');
      const [rows] = await connection.query(
        `SELECT * FROM llm_jobs WHERE id IN (${placeholders})`,
        ids
      );

      releaseConnectionSafely(connection, 'fetchPendingJobs');
      connection = null;

      const rowMap = new Map<string, any>();
      (rows as any[]).forEach(row => rowMap.set(row.id, row));

      return ids
        .map(id => rowMap.get(id))
        .filter(Boolean)
        .map((row: any) => this.mapRowToJob(row));
    } catch (error) {
      moduleLogger.error('Failed to fetch pending jobs', { error: serializeError(error) });
      return [];
    } finally {
      releaseConnectionSafely(connection, 'fetchPendingJobs.finally');
    }
  }

  /**
   * 处理单个任务
   */
  private async processJob(job: LLMJob): Promise<void> {
    // 标记为活跃
    this.activeJobs.add(job.id);
    this.emit('job_started', { jobId: job.id, traceId: job.trace_id });

    try {
      // 更新状态为 calling
      await this.updateJobStatus(job.id, 'calling');

      // 执行任务
      const result = await this.executeJob(job);

      // 更新最终状态
      if (result.success) {
        await this.completeJob(
          job.id,
          result.finalResponse || '',
          result.metadata || job.metadata || null
        );
        if (this.isToolDrivenChatJob(result.metadata || job.metadata || {})) {
          await this.updateConversationForOutcome(
            job,
            result.outcome || {
              kind: 'side_effect_only',
              summary: result.finalResponse || ''
            }
          );
        }
        this.emit('job_completed', {
          jobId: job.id,
          traceId: job.trace_id,
          finalResponse: result.finalResponse,
          outcome: result.outcome,
          metadata: result.metadata || job.metadata || null
        });
      } else {
        await this.failJob(
          job.id,
          result.error!,
          result.metadata || job.metadata || null
        );
        if (this.isToolDrivenChatJob(result.metadata || job.metadata || {})) {
          await this.updateConversationFailure(
            job,
            result.outcome || {
              kind: 'failed',
              error: result.error
            },
            result.error || 'Job failed'
          );
        }
        this.emit('job_failed', {
          jobId: job.id,
          traceId: job.trace_id,
          error: result.error,
          outcome: result.outcome,
          metadata: result.metadata || job.metadata || null
        });
      }
    } catch (error: any) {
      moduleLogger.error('Job execution error', { jobId: job.id, error });

      // 判断是否需要重试
      if (this.shouldRetryJobError(error) && job.retry_count < job.max_retries) {
        await this.scheduleRetry(job.id, job.retry_count + 1);
        this.emit('job_retry_scheduled', { jobId: job.id, retryCount: job.retry_count + 1 });
      } else {
        const failedMetadata = this.applyLoopOutcomeMetadata(job.metadata || {}, {
          kind: 'failed',
          error: error.message
        });
        await this.failJob(job.id, error.message, failedMetadata);
        if (this.isToolDrivenChatJob(failedMetadata)) {
          await this.updateConversationFailure(job, {
            kind: 'failed',
            error: error.message
          }, error.message);
        }
        this.emit('job_failed', {
          jobId: job.id,
          traceId: job.trace_id,
          error: error.message,
          outcome: {
            kind: 'failed',
            error: error.message
          },
          metadata: failedMetadata
        });
      }
    } finally {
      // 移除活跃标记
      this.activeJobs.delete(job.id);
    }
  }

  /**
   * 执行任务主逻辑
   */
  private async executeJob(job: LLMJob): Promise<JobResult> {
    let contents = Array.isArray(job.contents_json) ? [...job.contents_json] : [];
    let jobMetadata = { ...(job.metadata || {}) };

    type ToolSource = 'job' | 'search' | 'static' | 'invoke';
    const sourcePriority: Record<ToolSource, number> = {
      job: 1,
      search: 2,
      static: 3,
      invoke: 4
    };

    const toolMap = new Map<string, { declaration: any; priority: number }>();
    const registerTool = (declaration?: any, source: ToolSource = 'job') => {
      if (!declaration || typeof declaration !== 'object' || !declaration.name) {
        return;
      }

      const priority = sourcePriority[source] ?? sourcePriority.job;
      const existing = toolMap.get(declaration.name);

      if (!existing || priority >= existing.priority) {
        toolMap.set(declaration.name, {
          declaration: this.sanitizeFunctionDeclaration(declaration),
          priority
        });
      }
    };

    if (Array.isArray(job.tools_json)) {
      job.tools_json.forEach(item => registerTool(item, 'job'));
    }

    this.dispatcher.getStaticToolDeclarations().forEach(tool =>
      registerTool(tool, 'static')
    );

    registerTool(this.dispatcher.getSearchToolsDeclaration(), 'static');

    let tools = Array.from(toolMap.values()).map(entry => entry.declaration);
    tools = this.sanitizeTools(tools);
    tools = this.filterToolsForSource(job.source_type, tools);
    let currentTurn = job.current_turn;

    moduleLogger.info('Executing job', {
      jobId: job.id,
      turn: currentTurn,
      maxTurns: job.max_turns
    });

    while (currentTurn <= job.max_turns) {
      moduleLogger.info('turn_start', {
        jobId: job.id,
        traceId: job.trace_id,
        turn: currentTurn,
        maxTurns: job.max_turns
      });

      // 调用 LLM
      const llmCallId = uuidv4();
      const response = await this.callLLM(job, contents, tools, currentTurn, llmCallId);
      moduleLogger.info('turn_llm_success', {
        jobId: job.id,
        traceId: job.trace_id,
        turn: currentTurn,
        llmCallId
      });

      const assistantTurn = this.buildAssistantTurn(response);
      if (assistantTurn) {
        contents.push(assistantTurn);
      }

      // 检查是否有函数调用
      const functionCalls = this.extractFunctionCalls(response);

      if (functionCalls.length === 0) {
        const finalText = this.extractTextFromResponse(response).trim();
        if (this.isToolDrivenChatJob(jobMetadata)) {
          if (finalText.length > 0 && this.isTextFallbackEnabled()) {
            moduleLogger.warn('protocol_fallback', {
              jobId: job.id,
              traceId: job.trace_id,
              fallback: 'text_to_send_tool'
            });
            const fallbackResult = await this.executeTextFallback(job, jobMetadata, finalText);
            if (fallbackResult.metadata) {
              jobMetadata = fallbackResult.metadata;
            }
            await this.updateJobProgress(job.id, currentTurn, contents, jobMetadata);
            return fallbackResult;
          }

          const outcome: AgentLoopOutcome = {
            kind: 'protocol_error',
            error: 'Chat loop ended without terminal tool invocation',
            summary: 'Chat loop ended without terminal tool invocation'
          };
          jobMetadata = this.applyLoopOutcomeMetadata(jobMetadata, outcome);
          await this.updateJobProgress(job.id, currentTurn, contents, jobMetadata);
          return {
            success: false,
            outcome,
            error: outcome.error,
            metadata: jobMetadata
          };
        }

        return {
          success: true,
          finalResponse: finalText,
          metadata: jobMetadata
        };
      }

      // 处理函数调用
      moduleLogger.info('Processing function calls', {
        jobId: job.id,
        functionCount: functionCalls.length
      });

      const functionResponses: any[] = [];
      const followupContents: any[] = [];
      let terminalOutcome: AgentLoopOutcome | null = null;

      for (let index = 0; index < functionCalls.length; index++) {
        const functionCall = functionCalls[index];
        moduleLogger.info('turn_tool_dispatch', {
          jobId: job.id,
          traceId: job.trace_id,
          turn: currentTurn,
          toolName: functionCall.name
        });
        const dispatchResult = await this.dispatcher.dispatch(functionCall, {
          traceId: job.trace_id,
          jobId: job.id,
          sourceKey: job.source_key,
          userId: jobMetadata.userId,
          groupId: jobMetadata.groupId,
          conversationId: jobMetadata.conversationId,
          agentTurn: currentTurn,
          llmCallId,
          metadata: jobMetadata
        });

        if (dispatchResult.kind === 'fail') {
          return {
            success: false,
            outcome: {
              kind: 'failed',
              toolName: functionCall.name,
              error: dispatchResult.error,
              summary: dispatchResult.error
            },
            error: dispatchResult.error || 'Function dispatch failed',
            metadata: jobMetadata
          };
        }

        if (dispatchResult.metadataPatch) {
          jobMetadata = this.mergeMetadataPatch(jobMetadata, dispatchResult.metadataPatch);
        }

        if (dispatchResult.kind === 'complete') {
          if (index !== functionCalls.length - 1) {
            const outcome: AgentLoopOutcome = {
              kind: 'protocol_error',
              toolName: functionCall.name,
              error: 'Terminal tool call must be the final action in the turn',
              summary: 'Terminal tool call must be the final action in the turn'
            };
            jobMetadata = this.applyLoopOutcomeMetadata(jobMetadata, outcome);
            await this.updateJobProgress(job.id, currentTurn, contents, jobMetadata);
            return {
              success: false,
              outcome,
              error: outcome.error,
              metadata: jobMetadata
            };
          }

          terminalOutcome = dispatchResult.outcome || {
            kind: 'side_effect_only',
            toolName: functionCall.name,
            summary: functionCall.name
          };
          break;
        }

        if (dispatchResult.functionResponse) {
          functionResponses.push(dispatchResult.functionResponse);
        }

        if (Array.isArray(dispatchResult.followupContents) && dispatchResult.followupContents.length > 0) {
          followupContents.push(...dispatchResult.followupContents);
        }

        if (dispatchResult.searchedTools && dispatchResult.searchedTools.length > 0) {
          const invokeDeclaration = this.dispatcher.getInvokeDeclaration(
            dispatchResult.searchedTools
          );
          registerTool(invokeDeclaration, 'invoke');
          tools = Array.from(toolMap.values()).map(entry => entry.declaration);
        }
      }

      for (const funcResp of functionResponses) {
        contents.push({
          role: 'function',
          parts: [{ functionResponse: funcResp }]
        });
      }

      if (followupContents.length > 0) {
        contents.push(...followupContents);
      }

      if (terminalOutcome) {
        jobMetadata = this.applyLoopOutcomeMetadata(jobMetadata, terminalOutcome);
        await this.updateJobProgress(job.id, currentTurn, contents, jobMetadata);
        moduleLogger.info('loop_terminal_outcome', {
          jobId: job.id,
          traceId: job.trace_id,
          outcome: terminalOutcome.kind,
          toolName: terminalOutcome.toolName
        });
        return {
          success: true,
          outcome: terminalOutcome,
          finalResponse: this.buildFinalResponse(terminalOutcome),
          metadata: jobMetadata
        };
      }

      // 更新当前轮次
      currentTurn++;
      await this.updateJobProgress(job.id, currentTurn, contents, jobMetadata);

      // 检查是否超过最大轮次
      if (currentTurn > job.max_turns) {
        const outcome: AgentLoopOutcome = {
          kind: 'failed',
          error: `Exceeded max turns: ${job.max_turns}`,
          summary: `Exceeded max turns: ${job.max_turns}`
        };
        jobMetadata = this.applyLoopOutcomeMetadata(jobMetadata, outcome);
        return {
          success: false,
          outcome,
          error: outcome.error,
          metadata: jobMetadata
        };
      }
    }

    const unexpectedOutcome: AgentLoopOutcome = {
      kind: 'failed',
      error: 'Unexpected end of execution',
      summary: 'Unexpected end of execution'
    };
    return {
      success: false,
      outcome: unexpectedOutcome,
      error: unexpectedOutcome.error,
      metadata: jobMetadata
    };
  }

  /**
   * 调用 LLM
   */
  private async callLLM(
    job: LLMJob,
    contents: any[],
    tools: any[],
    currentTurn: number,
    llmCallId: string
  ): Promise<any> {
    try {
      // 构建请求
      const configuredRequest =
        job.config_json && typeof job.config_json === 'object'
          ? { ...(job.config_json as Record<string, any>) }
          : {};
      const sanitizedTools = this.mergeAndSanitizeTools(
        Array.isArray(configuredRequest.tools) ? configuredRequest.tools : [],
        tools
      );
      const requestTools = this.filterToolsForSource(job.source_type, sanitizedTools);
      const request: Record<string, any> = {
        contents,
        ...configuredRequest,
        tools: requestTools.length > 0 ? requestTools : undefined
      };

      const metadata = job.metadata || {};
      const defaultFunctionCallingMode: FunctionCallingMode = this.isToolDrivenChatJob(metadata)
        ? 'AUTO'
        : 'ANY';

      if (!request.toolConfig || typeof request.toolConfig !== 'object') {
        request.toolConfig = {
          functionCallingConfig: {
            mode: defaultFunctionCallingMode
          }
        };
      } else {
        const fc = request.toolConfig.functionCallingConfig;
        if (!fc || typeof fc !== 'object') {
          request.toolConfig.functionCallingConfig = { mode: defaultFunctionCallingMode };
        } else {
          request.toolConfig.functionCallingConfig.mode = this.isToolDrivenChatJob(metadata)
            ? 'AUTO'
            : normalizeFunctionCallingMode(fc.mode);
        }
      }
      const modelNameFromConfig = (job.config_json && (job.config_json as any).model?.name)
        || (job.config_json && (job.config_json as any).modelName)
        || metadata.modelName;

      if (!request.model && modelNameFromConfig) {
        request.model = { name: modelNameFromConfig };
      }

      moduleLogger.info('Calling LLM', {
        jobId: job.id,
        contentCount: contents.length,
        toolCount: requestTools.length,
        model: modelNameFromConfig || request.model?.name
      });

      // 调用 AIService (这里假设有一个通用的 generateContent 方法)
      const response = await (this.aiService as any).generateContent(
        request,
        job.trace_id,
        {
          modelName: modelNameFromConfig,
          conversationId: metadata.conversationId,
          agentType: metadata.agentType,
          promptName: metadata.promptName,
          promptId: metadata.promptId,
          agentTurn: currentTurn,
          llmCallId
        }
      );

      return response;
    } catch (error) {
      moduleLogger.error('LLM call error', { jobId: job.id, error });
      throw error;
    }
  }

  /**
   * 从响应中提取函数调用
   */
  private extractFunctionCalls(response: any): GeminiFunctionCall[] {
    const functionCalls: GeminiFunctionCall[] = [];

    if (!response || !response.candidates || response.candidates.length === 0) {
      return functionCalls;
    }

    const candidate = response.candidates[0];
    if (!candidate.content || !candidate.content.parts) {
      return functionCalls;
    }

    for (const part of candidate.content.parts) {
      if (part.functionCall) {
        functionCalls.push({
          name: part.functionCall.name,
          args: part.functionCall.args || {}
        });
      }
    }

    return functionCalls;
  }

  /**
   * 从响应中提取文本
   */
  private extractTextFromResponse(response: any): string {
    if (!response || !response.candidates || response.candidates.length === 0) {
      return '';
    }

    const candidate = response.candidates[0];
    if (!candidate.content || !candidate.content.parts) {
      return '';
    }

    const textParts = candidate.content.parts
      .filter((part: any) => part.text)
      .map((part: any) => part.text);

    return textParts.join('\n');
  }

  private buildAssistantTurn(response: any): { role: string; parts: any[] } | null {
    if (!response || !Array.isArray(response.candidates) || response.candidates.length === 0) {
      return null;
    }

    const candidate = response.candidates[0];
    if (!candidate?.content || !Array.isArray(candidate.content.parts) || candidate.content.parts.length === 0) {
      return null;
    }

    return {
      role: candidate.content.role || 'model',
      parts: candidate.content.parts
    };
  }

  private isToolDrivenChatJob(metadata: Record<string, any>): boolean {
    return metadata?.agentType === 'chat_bot';
  }

  private isTextFallbackEnabled(): boolean {
    return process.env.CHAT_AGENT_TEXT_FALLBACK_TO_SEND_TOOL !== 'false';
  }

  private applyLoopOutcomeMetadata(
    metadata: Record<string, any>,
    outcome: AgentLoopOutcome
  ): Record<string, any> {
    return {
      ...metadata,
      loopOutcome: outcome
    };
  }

  private mergeMetadataPatch(
    metadata: Record<string, any>,
    patch: Record<string, any>
  ): Record<string, any> {
    const merged: Record<string, any> = {
      ...metadata,
      ...patch
    };

    if (metadata.chatViewport || patch.chatViewport) {
      merged.chatViewport = {
        ...(metadata.chatViewport || {}),
        ...(patch.chatViewport || {})
      };
    }

    if (metadata.replyAnchorViewport || patch.replyAnchorViewport) {
      merged.replyAnchorViewport = {
        ...(metadata.replyAnchorViewport || {}),
        ...(patch.replyAnchorViewport || {})
      };
    }

    return merged;
  }

  private buildFinalResponse(outcome: AgentLoopOutcome): string {
    if (outcome.kind === 'message_sent') {
      return outcome.message || outcome.summary || '';
    }

    if (outcome.kind === 'side_effect_only') {
      return outcome.summary || outcome.toolName || '';
    }

    if (outcome.kind === 'ended_no_reply') {
      return '';
    }

    return outcome.error || outcome.summary || '';
  }

  private async executeTextFallback(
    job: LLMJob,
    metadata: Record<string, any>,
    finalText: string
  ): Promise<JobResult> {
    const fallbackCall: GeminiFunctionCall = job.source_type === 'group'
      ? {
          name: 'send_qq_group_message',
          args: {
            message: finalText
          }
        }
      : {
          name: 'send_private_chat_message',
          args: {
            user_id: metadata.userId,
            message: finalText
          }
        };

    if (job.source_type === 'private' && !metadata.userId) {
      const outcome: AgentLoopOutcome = {
        kind: 'protocol_error',
        error: 'Missing userId for text fallback',
        summary: 'Missing userId for text fallback'
      };
      const nextMetadata = this.applyLoopOutcomeMetadata(metadata, outcome);
      return {
        success: false,
        outcome,
        error: outcome.error,
        metadata: nextMetadata
      };
    }

    const dispatchResult = await this.dispatcher.dispatch(fallbackCall, {
      traceId: job.trace_id,
      jobId: job.id,
      sourceKey: job.source_key,
      userId: metadata.userId,
      groupId: metadata.groupId,
      metadata
    });

    if (dispatchResult.kind !== 'complete' || !dispatchResult.outcome) {
      const outcome: AgentLoopOutcome = {
        kind: 'protocol_error',
        error: 'Text fallback did not resolve to a terminal send action',
        summary: 'Text fallback did not resolve to a terminal send action'
      };
      const nextMetadata = this.applyLoopOutcomeMetadata(metadata, outcome);
      return {
        success: false,
        outcome,
        error: outcome.error,
        metadata: nextMetadata
      };
    }

    const nextOutcome: AgentLoopOutcome = {
      ...dispatchResult.outcome,
      message: dispatchResult.outcome.message || finalText,
      summary: dispatchResult.outcome.summary || finalText,
      protocolFallback: 'text_to_send_tool'
    };
    const nextMetadata = this.applyLoopOutcomeMetadata(metadata, nextOutcome);

    return {
      success: true,
      outcome: nextOutcome,
      finalResponse: this.buildFinalResponse(nextOutcome),
      metadata: nextMetadata
    };
  }

  /**
   * 更新任务状态
   */
  private async updateJobStatus(jobId: string, status: LLMJobStatus): Promise<void> {
    let connection: any;
    try {
      connection = await (this.database as any).pool.getConnection();

      await connection.query(
        'UPDATE llm_jobs SET status = ?, updated_at = NOW() WHERE id = ?',
        [status, jobId]
      );

      releaseConnectionSafely(connection, 'updateJobStatus');
      connection = null;
    } catch (error) {
      moduleLogger.error('Failed to update job status', {
        jobId,
        status,
        error: serializeError(error)
      });
    } finally {
      releaseConnectionSafely(connection, 'updateJobStatus.finally');
    }
  }

  /**
   * 更新任务轮次
   */
  private async updateJobProgress(
    jobId: string,
    turn: number,
    contents: any[],
    metadata?: Record<string, any> | null
  ): Promise<void> {
    let connection: any;
    try {
      connection = await (this.database as any).pool.getConnection();

      await connection.query(
        `UPDATE llm_jobs
         SET current_turn = ?, contents_json = ?, metadata = ?, updated_at = NOW()
         WHERE id = ?`,
        [
          turn,
          JSON.stringify(contents),
          metadata ? JSON.stringify(metadata) : null,
          jobId
        ]
      );

      releaseConnectionSafely(connection, 'updateJobProgress');
      connection = null;
    } catch (error) {
      moduleLogger.error('Failed to update job progress', {
        jobId,
        turn,
        error: serializeError(error)
      });
    } finally {
      releaseConnectionSafely(connection, 'updateJobProgress.finally');
    }
  }

  /**
   * 完成任务
   */
  private async completeJob(
    jobId: string,
    finalResponse: string,
    metadata?: Record<string, any> | null
  ): Promise<void> {
    let connection: any;
    try {
      connection = await (this.database as any).pool.getConnection();

      await connection.query(
        `UPDATE llm_jobs
         SET status = 'completed',
             final_response = ?,
             metadata = ?,
             completed_at = NOW(),
             updated_at = NOW()
         WHERE id = ?`,
        [finalResponse, metadata ? JSON.stringify(metadata) : null, jobId]
      );

      releaseConnectionSafely(connection, 'completeJob');
      connection = null;

      moduleLogger.info('Job completed', { jobId });
    } catch (error) {
      moduleLogger.error('Failed to complete job', {
        jobId,
        error: serializeError(error)
      });
    } finally {
      releaseConnectionSafely(connection, 'completeJob.finally');
    }
  }

  /**
   * 任务失败
   */
  private async failJob(
    jobId: string,
    errorMessage: string,
    metadata?: Record<string, any> | null
  ): Promise<void> {
    let connection: any;
    try {
      connection = await (this.database as any).pool.getConnection();

      await connection.query(
        `UPDATE llm_jobs
         SET status = 'failed',
             error_message = ?,
             metadata = ?,
             updated_at = NOW()
         WHERE id = ?`,
        [errorMessage, metadata ? JSON.stringify(metadata) : null, jobId]
      );

      releaseConnectionSafely(connection, 'failJob');
      connection = null;

      moduleLogger.info('Job failed', { jobId, error: errorMessage });
    } catch (error) {
      moduleLogger.error('Failed to mark job as failed', {
        jobId,
        error: serializeError(error)
      });
    } finally {
      releaseConnectionSafely(connection, 'failJob.finally');
    }
  }

  private async updateConversationForOutcome(job: LLMJob, outcome: AgentLoopOutcome): Promise<void> {
    const conversationId = job.metadata?.conversationId;
    if (!conversationId || typeof (this.database as any).updateConversationStatus !== 'function') {
      return;
    }

    const aiResponse = this.buildConversationResponse(outcome);
    const modelName = job.metadata?.modelName || null;
    const rawResponse = JSON.stringify({ outcome });
    await (this.database as any).updateConversationStatus(
      conversationId,
      'completed',
      undefined,
      aiResponse,
      0,
      modelName,
      rawResponse
    );
  }

  private async updateConversationFailure(
    job: LLMJob,
    outcome: AgentLoopOutcome,
    errorMessage: string
  ): Promise<void> {
    const conversationId = job.metadata?.conversationId;
    if (!conversationId || typeof (this.database as any).updateConversationStatus !== 'function') {
      return;
    }

    await (this.database as any).updateConversationStatus(
      conversationId,
      'failed',
      errorMessage,
      undefined,
      0,
      job.metadata?.modelName || null,
      JSON.stringify({ outcome })
    );
  }

  private buildConversationResponse(outcome: AgentLoopOutcome): string {
    if (outcome.kind === 'message_sent') {
      return outcome.message || outcome.summary || '';
    }

    if (outcome.kind === 'ended_no_reply') {
      return '';
    }

    return outcome.summary || '';
  }

  /**
   * 安排重试
   */
  private async scheduleRetry(jobId: string, retryCount: number): Promise<void> {
    let connection: any;
    try {
      connection = await (this.database as any).pool.getConnection();

      await connection.query(
        `UPDATE llm_jobs
         SET status = 'pending',
             retry_count = ?,
             next_retry_at = DATE_ADD(NOW(), INTERVAL ? MICROSECOND),
             updated_at = NOW()
         WHERE id = ?`,
        [retryCount, this.config.retryDelayMs * 1000, jobId]
      );

      releaseConnectionSafely(connection, 'scheduleRetry');
      connection = null;

      moduleLogger.info('Job retry scheduled', { jobId, retryCount, retryDelayMs: this.config.retryDelayMs });
    } catch (error) {
      moduleLogger.error('Failed to schedule retry', {
        jobId,
        error: serializeError(error)
      });
    } finally {
      releaseConnectionSafely(connection, 'scheduleRetry.finally');
    }
  }

  /**
   * 获取任务信息
   */
  async getJob(jobId: string): Promise<LLMJob | null> {
    let connection: any;
    try {
      connection = await (this.database as any).pool.getConnection();

      const [rows] = await connection.query(
        'SELECT * FROM llm_jobs WHERE id = ? LIMIT 1',
        [jobId]
      );

      releaseConnectionSafely(connection, 'getJob');
      connection = null;

      const jobs = rows as any[];
      if (jobs.length === 0) {
        return null;
      }

      return this.mapRowToJob(jobs[0]);
    } catch (error) {
      moduleLogger.error('Failed to get job', {
        jobId,
        error: serializeError(error)
      });
      return null;
    } finally {
      releaseConnectionSafely(connection, 'getJob.finally');
    }
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      isRunning: this.isRunning,
      activeJobs: this.activeJobs.size,
      maxConcurrentJobs: this.config.maxConcurrentJobs,
      pollInterval: this.config.pollIntervalMs
    };
  }

  /**
   * 映射数据库行到 LLMJob 对象
   */
  private mapRowToJob(row: any): LLMJob {
    return {
      id: row.id,
      trace_id: row.trace_id,
      source_key: row.source_key,
      source_type: row.source_type,
      status: row.status,
      retry_count: row.retry_count,
      max_retries: row.max_retries,
      next_retry_at: row.next_retry_at,
      contents_json: typeof row.contents_json === 'string'
        ? JSON.parse(row.contents_json)
        : row.contents_json,
      tools_json: row.tools_json
        ? (typeof row.tools_json === 'string' ? JSON.parse(row.tools_json) : row.tools_json)
        : null,
      config_json: row.config_json
        ? (typeof row.config_json === 'string' ? JSON.parse(row.config_json) : row.config_json)
        : null,
      pending_tool: row.pending_tool,
      current_turn: row.current_turn,
      max_turns: row.max_turns,
      final_response: row.final_response,
      error_message: row.error_message,
      metadata: row.metadata
        ? (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata)
        : null,
      created_at: row.created_at,
      updated_at: row.updated_at,
      completed_at: row.completed_at
    };
  }

  private shouldRetryJobError(error: any): boolean {
    if (isPermanentAuthorizationError(error)) {
      moduleLogger.warn('Skipping retry for permanent authorization error', {
        statusCode: getErrorStatusCode(error),
        message: error?.message
      });
      return false;
    }

    return true;
  }

  private sanitizeSchema(schema: any): any {
    if (!schema || typeof schema !== 'object') {
      return schema;
    }

    if (Array.isArray(schema)) {
      return schema.map((item: any) => this.sanitizeSchema(item));
    }

    const cloned: Record<string, any> = { ...schema };
    if (Object.prototype.hasOwnProperty.call(cloned, 'additionalProperties')) {
      delete cloned.additionalProperties;
    }

    if (cloned.properties && typeof cloned.properties === 'object') {
      cloned.properties = Object.entries(cloned.properties).reduce<Record<string, any>>(
        (acc, [key, value]) => {
          acc[key] = this.sanitizeSchema(value);
          return acc;
        },
        {}
      );
    }

    if (cloned.items) {
      cloned.items = this.sanitizeSchema(cloned.items);
    }

    if (cloned.anyOf) {
      cloned.anyOf = cloned.anyOf.map((item: any) => this.sanitizeSchema(item));
    }

    if (cloned.oneOf) {
      cloned.oneOf = cloned.oneOf.map((item: any) => this.sanitizeSchema(item));
    }

    if (cloned.allOf) {
      cloned.allOf = cloned.allOf.map((item: any) => this.sanitizeSchema(item));
    }

    return cloned;
  }

  private sanitizeFunctionDeclaration(declaration: any): any {
    if (!declaration || typeof declaration !== 'object') {
      return declaration;
    }

    const cloned: Record<string, any> = { ...declaration };
    const toolName = typeof cloned.name === 'string' ? cloned.name : undefined;
    const staticOverride = toolName
      ? this.dispatcher.getStaticToolDeclaration(toolName)
      : undefined;

    const sanitizeSchema = (schema: any) =>
      schema !== undefined ? this.sanitizeSchema(schema) : schema;

    if (staticOverride) {
      cloned.description = staticOverride.description ?? cloned.description;
      cloned.parameters = sanitizeSchema(
        staticOverride.parameters !== undefined ? staticOverride.parameters : cloned.parameters
      );
    } else if (cloned.parameters !== undefined) {
      cloned.parameters = sanitizeSchema(cloned.parameters);
    }

    if (cloned.response !== undefined) {
      cloned.response = sanitizeSchema(cloned.response);
    }

    return cloned;
  }

  private sanitizeTools(tools: any[]): any[] {
    if (!Array.isArray(tools)) {
      return [];
    }

    return tools.map(tool => {
      if (!tool || typeof tool !== 'object') {
        return tool;
      }

      const cloned: Record<string, any> = { ...tool };

      if (Array.isArray(cloned.functionDeclarations)) {
        cloned.functionDeclarations = cloned.functionDeclarations
          .map(declaration => this.sanitizeFunctionDeclaration(declaration))
          .filter(Boolean);
      } else if (cloned.parameters !== undefined) {
        cloned.parameters = this.sanitizeSchema(cloned.parameters);
      }

      return cloned;
    });
  }

  private mergeAndSanitizeTools(primaryTools: any[], overrideTools: any[]): any[] {
    const merged = new Map<string, any>();

    const register = (toolList: any[]) => {
      this.sanitizeTools(toolList).forEach(tool => {
        if (!tool || typeof tool !== 'object') {
          return;
        }

        const toolName =
          typeof tool.name === 'string'
            ? tool.name
            : Array.isArray(tool.functionDeclarations) && tool.functionDeclarations.length === 1
              ? tool.functionDeclarations[0]?.name
              : undefined;

        if (toolName) {
          merged.set(toolName, tool);
        }
      });
    };

    register(primaryTools);
    register(overrideTools);

    return Array.from(merged.values());
  }

  private filterToolsForSource(sourceType: 'private' | 'group', tools: any[]): any[] {
    if (!Array.isArray(tools)) {
      return [];
    }

    if (sourceType === 'private') {
      return tools.filter(tool => tool?.name !== 'send_qq_group_message');
    }

    return tools;
  }
}
