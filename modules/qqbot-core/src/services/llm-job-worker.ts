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
import { LLMJob, LLMJobStatus, GeminiFunctionCall } from '../types';

const moduleLogger = logger.createModuleLogger('llm-job-worker');

export interface LLMJobWorkerConfig {
  maxConcurrentJobs: number;
  pollIntervalMs: number;
  jobTimeoutMs: number;
  retryDelayMs: number;
}

export interface JobResult {
  success: boolean;
  finalResponse?: string;
  error?: string;
}

export class LLMJobWorker extends EventEmitter {
  private database: DatabaseManager;
  private dispatcher: FunctionCallDispatcher;
  private aiService: AIService;
  private config: LLMJobWorkerConfig;

  private isRunning: boolean = false;
  private activeJobs: Set<string> = new Set();
  private pollTimer?: NodeJS.Timeout;

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

    try {
      const connection = await (this.database as any).pool.getConnection();

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

      connection.release();

      moduleLogger.info('Created LLM job', { jobId, traceId: params.traceId });
      this.emit('job_created', { jobId, traceId: params.traceId });

      return jobId;
    } catch (error) {
      moduleLogger.error('Failed to create job', { error });
      throw error;
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
    try {
      const connection = await (this.database as any).pool.getConnection();

      const [rows] = await connection.query(
        `SELECT * FROM llm_jobs
         WHERE status = 'pending'
           AND (next_retry_at IS NULL OR next_retry_at <= NOW())
         ORDER BY created_at ASC
         LIMIT ?`,
        [limit]
      );

      connection.release();

      return (rows as any[]).map(row => this.mapRowToJob(row));
    } catch (error) {
      moduleLogger.error('Failed to fetch pending jobs', { error });
      return [];
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
        await this.completeJob(job.id, result.finalResponse!);
        this.emit('job_completed', {
          jobId: job.id,
          traceId: job.trace_id,
          finalResponse: result.finalResponse,
          metadata: job.metadata || null
        });
      } else {
        await this.failJob(job.id, result.error!);
        this.emit('job_failed', {
          jobId: job.id,
          traceId: job.trace_id,
          error: result.error,
          metadata: job.metadata || null
        });
      }
    } catch (error: any) {
      moduleLogger.error('Job execution error', { jobId: job.id, error });

      // 判断是否需要重试
      if (job.retry_count < job.max_retries) {
        await this.scheduleRetry(job.id, job.retry_count + 1);
        this.emit('job_retry_scheduled', { jobId: job.id, retryCount: job.retry_count + 1 });
      } else {
        await this.failJob(job.id, error.message);
        this.emit('job_failed', {
          jobId: job.id,
          traceId: job.trace_id,
          error: error.message,
          metadata: job.metadata || null
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
    let contents = job.contents_json;
    let tools = job.tools_json || [];
    let currentTurn = job.current_turn;

    moduleLogger.info('Executing job', {
      jobId: job.id,
      turn: currentTurn,
      maxTurns: job.max_turns
    });

    while (currentTurn <= job.max_turns) {
      // 调用 LLM
      const response = await this.callLLM(job, contents, tools);

      // 检查是否有函数调用
      const functionCalls = this.extractFunctionCalls(response);

      if (functionCalls.length === 0) {
        // 没有函数调用,返回最终响应
        const finalText = this.extractTextFromResponse(response);
        return {
          success: true,
          finalResponse: finalText
        };
      }

      // 处理函数调用
      moduleLogger.info('Processing function calls', {
        jobId: job.id,
        functionCount: functionCalls.length
      });

      let shouldContinue = true;
      const functionResponses: any[] = [];

      for (const functionCall of functionCalls) {
        const dispatchResult = await this.dispatcher.dispatch(functionCall, {
          traceId: job.trace_id,
          jobId: job.id,
          sourceKey: job.source_key
        });

        if (dispatchResult.isCompleted) {
          // 工具执行完成,无需继续
          return {
            success: true,
            finalResponse: dispatchResult.finalResponse
          };
        }

        if (dispatchResult.functionResponse) {
          functionResponses.push(dispatchResult.functionResponse);
        }

        if (!dispatchResult.shouldContinue) {
          shouldContinue = false;
          break;
        }

        // 如果搜索到工具,动态添加 invoke 声明
        if (dispatchResult.searchedTools && dispatchResult.searchedTools.length > 0) {
          const invokeDeclaration = this.dispatcher.getInvokeDeclaration(
            dispatchResult.searchedTools
          );
          tools = [...tools, invokeDeclaration];
        }
      }

      if (!shouldContinue) {
        return {
          success: false,
          error: 'Function execution stopped'
        };
      }

      // 将函数响应添加到 contents
      for (const funcResp of functionResponses) {
        contents.push({
          role: 'function',
          parts: [{ functionResponse: funcResp }]
        });
      }

      // 更新当前轮次
      currentTurn++;
      await this.updateJobTurn(job.id, currentTurn);

      // 检查是否超过最大轮次
      if (currentTurn > job.max_turns) {
        return {
          success: false,
          error: `Exceeded max turns: ${job.max_turns}`
        };
      }
    }

    return {
      success: false,
      error: 'Unexpected end of execution'
    };
  }

  /**
   * 调用 LLM
   */
  private async callLLM(job: LLMJob, contents: any[], tools: any[]): Promise<any> {
    try {
      // 构建请求
      const request: Record<string, any> = {
        contents,
        tools: tools.length > 0 ? tools : undefined,
        ...(job.config_json || {})
      };

      const metadata = job.metadata || {};
      const modelNameFromConfig = (job.config_json && (job.config_json as any).model?.name)
        || (job.config_json && (job.config_json as any).modelName)
        || metadata.modelName;

      if (!request.model && modelNameFromConfig) {
        request.model = { name: modelNameFromConfig };
      }

      moduleLogger.info('Calling LLM', {
        jobId: job.id,
        contentCount: contents.length,
        toolCount: tools.length,
        model: modelNameFromConfig || request.model?.name
      });

      // 调用 AIService (这里假设有一个通用的 generateContent 方法)
      const response = await (this.aiService as any).generateContent(
        request,
        job.trace_id,
        {
          modelName: modelNameFromConfig,
          agentType: metadata.agentType,
          promptName: metadata.promptName,
          promptId: metadata.promptId
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

  /**
   * 更新任务状态
   */
  private async updateJobStatus(jobId: string, status: LLMJobStatus): Promise<void> {
    try {
      const connection = await (this.database as any).pool.getConnection();

      await connection.query(
        'UPDATE llm_jobs SET status = ?, updated_at = NOW() WHERE id = ?',
        [status, jobId]
      );

      connection.release();
    } catch (error) {
      moduleLogger.error('Failed to update job status', { jobId, status, error });
    }
  }

  /**
   * 更新任务轮次
   */
  private async updateJobTurn(jobId: string, turn: number): Promise<void> {
    try {
      const connection = await (this.database as any).pool.getConnection();

      await connection.query(
        'UPDATE llm_jobs SET current_turn = ?, updated_at = NOW() WHERE id = ?',
        [turn, jobId]
      );

      connection.release();
    } catch (error) {
      moduleLogger.error('Failed to update job turn', { jobId, turn, error });
    }
  }

  /**
   * 完成任务
   */
  private async completeJob(jobId: string, finalResponse: string): Promise<void> {
    try {
      const connection = await (this.database as any).pool.getConnection();

      await connection.query(
        `UPDATE llm_jobs
         SET status = 'completed',
             final_response = ?,
             completed_at = NOW(),
             updated_at = NOW()
         WHERE id = ?`,
        [finalResponse, jobId]
      );

      connection.release();

      moduleLogger.info('Job completed', { jobId });
    } catch (error) {
      moduleLogger.error('Failed to complete job', { jobId, error });
    }
  }

  /**
   * 任务失败
   */
  private async failJob(jobId: string, errorMessage: string): Promise<void> {
    try {
      const connection = await (this.database as any).pool.getConnection();

      await connection.query(
        `UPDATE llm_jobs
         SET status = 'failed',
             error_message = ?,
             updated_at = NOW()
         WHERE id = ?`,
        [errorMessage, jobId]
      );

      connection.release();

      moduleLogger.info('Job failed', { jobId, error: errorMessage });
    } catch (error) {
      moduleLogger.error('Failed to mark job as failed', { jobId, error });
    }
  }

  /**
   * 安排重试
   */
  private async scheduleRetry(jobId: string, retryCount: number): Promise<void> {
    try {
      const connection = await (this.database as any).pool.getConnection();

      const nextRetryAt = new Date(Date.now() + this.config.retryDelayMs);

      await connection.query(
        `UPDATE llm_jobs
         SET status = 'pending',
             retry_count = ?,
             next_retry_at = ?,
             updated_at = NOW()
         WHERE id = ?`,
        [retryCount, nextRetryAt, jobId]
      );

      connection.release();

      moduleLogger.info('Job retry scheduled', { jobId, retryCount, nextRetryAt });
    } catch (error) {
      moduleLogger.error('Failed to schedule retry', { jobId, error });
    }
  }

  /**
   * 获取任务信息
   */
  async getJob(jobId: string): Promise<LLMJob | null> {
    try {
      const connection = await (this.database as any).pool.getConnection();

      const [rows] = await connection.query(
        'SELECT * FROM llm_jobs WHERE id = ? LIMIT 1',
        [jobId]
      );

      connection.release();

      const jobs = rows as any[];
      if (jobs.length === 0) {
        return null;
      }

      return this.mapRowToJob(jobs[0]);
    } catch (error) {
      moduleLogger.error('Failed to get job', { jobId, error });
      return null;
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
}
